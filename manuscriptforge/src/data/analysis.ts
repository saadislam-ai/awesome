import { AiError, isAbort, type AiProvider } from '../core/ai/provider';
import { assignRoles, emptyBible, keepLockedEntries, mergeSegment, type BookBible } from '../core/analysis/bible';
import {
  analyseSegment, bookIssueCategory, DEFAULT_SEGMENT_WORDS, issueSeverity, placeIssues, segmentChapter, synthesise, type BookKind, type Segment, type Synthesis,
} from '../core/analysis/deep';
import { findIssues } from '../core/analysis/rules';
import { computeStats, contentChapters, type AnalysisChapter } from '../core/analysis/stats';
import { locateQuote } from '../core/analysis/text';
import { CATEGORY_INFO, type BookStats, type Issue } from '../core/analysis/types';
import { withRetry } from '../core/edit/pipeline';
import { blockText } from '../core/model/blocks';
import { newId, nowIso } from '../core/util/id';
import type { Db, SqlStatement } from '../platform/types';
import type { Library } from './library';
import type { WorkSource } from './runner';

export type AnalysisStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled';

/** What the AI noted about one chapter. */
export interface ChapterNotes {
  chapterId: string;
  number: number;
  title: string;
  summary: string;
  /** Tension (fiction) or engagement, 1 to 10. */
  tension: number;
  pace: 'slow' | 'steady' | 'fast';
  words: number;
}

export interface AnalysisResult {
  chapters: ChapterNotes[];
  synthesis: Synthesis | null;
}

export interface Analysis {
  id: string;
  bookId: string;
  status: AnalysisStatus;
  /** True when the AI reads the book, false for the quick check only. */
  deep: boolean;
  model: string;
  /** Fingerprint of the text that was analysed. */
  signature: string;
  stats: BookStats;
  result: AnalysisResult | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  tasks: number;
  tasksDone: number;
  tasksFailed: number;
  words: number;
  wordsDone: number;
  ms: number;
}

export interface StoredIssue extends Issue {
  id: string;
  status: 'open' | 'dismissed';
}

interface Draft {
  bible: BookBible;
  passages: number;
  summaries: string[];
  chapters: (ChapterNotes & { parts: number; tensionSum: number; paces: string[]; povs: string[]; tenses: string[] })[];
}

interface AnalysisRow {
  id: string; book_id: string; status: string; deep: number; model: string; signature: string; stats: string; draft: string; result: string | null;
  error: string | null; created_at: string; finished_at: string | null;
  tasks: number; tasks_done: number; tasks_failed: number; words: number; words_done: number; ms: number;
}

const SELECT = `
  SELECT a.*,
    (SELECT count(*) FROM analysis_tasks t WHERE t.analysis_id = a.id) AS tasks,
    (SELECT count(*) FROM analysis_tasks t WHERE t.analysis_id = a.id AND t.status = 'done') AS tasks_done,
    (SELECT count(*) FROM analysis_tasks t WHERE t.analysis_id = a.id AND t.status = 'failed') AS tasks_failed,
    (SELECT coalesce(sum(t.words), 0) FROM analysis_tasks t WHERE t.analysis_id = a.id) AS words,
    (SELECT coalesce(sum(t.words), 0) FROM analysis_tasks t WHERE t.analysis_id = a.id AND t.status IN ('done', 'failed')) AS words_done,
    (SELECT coalesce(sum(t.ms), 0) FROM analysis_tasks t WHERE t.analysis_id = a.id) AS ms
  FROM analyses a`;

function toAnalysis(r: AnalysisRow): Analysis {
  return {
    id: r.id, bookId: r.book_id, status: r.status as AnalysisStatus, deep: !!r.deep, model: r.model, signature: r.signature, stats: JSON.parse(r.stats),
    result: r.result ? JSON.parse(r.result) : null, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at, tasks: r.tasks,
    tasksDone: r.tasks_done, tasksFailed: r.tasks_failed, words: r.words, wordsDone: r.words_done, ms: r.ms,
  };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

function issueInsert(bookId: string, analysisId: string, position: number, issue: Issue): SqlStatement {
  return {
    sql: `INSERT INTO issues (id, book_id, analysis_id, position, chapter_id, block_index, category, severity, quote, title, detail, suggestion, source)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    params: [newId('is'), bookId, analysisId, position, issue.chapterId, issue.blockIndex, issue.category, issue.severity, issue.quote, issue.title, issue.detail, issue.suggestion, issue.source],
  };
}

/**
 * Analyses of books and what they found.
 *
 * Every analysis starts with the quick check, which needs no AI and finishes
 * at once. A full analysis then queues one step per passage for the model to
 * read, and a final step that assesses the whole book and writes the Book
 * Bible. Like editing jobs, it can be paused and survives the app closing.
 */
export class AnalysisStore implements WorkSource<Analysis> {
  constructor(
    private readonly db: Db,
    private readonly library: Library,
  ) {}

  owns(id: string): boolean {
    return id.startsWith('an_');
  }

  private async input(bookId: string) {
    const book = await this.library.getBook(bookId);
    if (!book) throw new Error('This book no longer exists.');
    const chapters: AnalysisChapter[] = (await this.library.getAllChapters(bookId)).map((c) => ({ id: c.id, title: c.title, blocks: c.blocks }));
    return { book, chapters };
  }

  /** Runs the quick check now and, for a full analysis, queues the AI reading. Replaces any earlier analysis of the book. */
  async start(bookId: string, options: { deep: boolean; model?: string; segmentWords?: number }): Promise<Analysis> {
    const { book, chapters } = await this.input(bookId);
    const analysisInput = { language: book.language, bookType: book.bookType, chapters };
    const stats = computeStats(analysisInput);
    if (!stats.words) throw new Error('This book has no text to analyse.');
    const issues = findIssues(analysisInput, stats);
    const id = newId('an');
    const now = nowIso();
    const draft: Draft = { bible: emptyBible(), passages: 0, summaries: [], chapters: [] };
    const statements: SqlStatement[] = [
      { sql: 'DELETE FROM analyses WHERE book_id = ?', params: [bookId] },
      {
        sql: 'INSERT INTO analyses (id, book_id, status, deep, model, signature, stats, draft, created_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        params: [id, bookId, options.deep ? 'queued' : 'done', options.deep ? 1 : 0, options.model ?? '', await this.library.textSignature(bookId), JSON.stringify(stats), JSON.stringify(draft), now, options.deep ? null : now],
      },
      ...issues.map((issue, position) => issueInsert(bookId, id, position, issue)),
      { sql: "UPDATE books SET status = 'analyzed' WHERE id = ? AND status = 'imported'", params: [bookId] },
    ];
    if (options.deep) {
      let position = 0;
      contentChapters(chapters).forEach((chapter, index) => {
        for (const segment of segmentChapter(chapter, index + 1, options.segmentWords ?? DEFAULT_SEGMENT_WORDS)) {
          statements.push({
            sql: 'INSERT INTO analysis_tasks (id, analysis_id, position, kind, status, input, words) VALUES (?,?,?,?,?,?,?)',
            params: [newId('at'), id, position++, 'segment', 'queued', JSON.stringify(segment), segment.words],
          });
        }
      });
      statements.push({
        sql: 'INSERT INTO analysis_tasks (id, analysis_id, position, kind, status, input, words) VALUES (?,?,?,?,?,?,?)',
        params: [newId('at'), id, position, 'synthesis', 'queued', '{}', Math.round(stats.words * 0.03)],
      });
    }
    await this.db.batch(statements);
    // Even without AI, record what the numbers say about the author's voice.
    const existing = await this.getBible(bookId);
    if (!existing) {
      const bible = emptyBible();
      bible.voice.numbers = stats.voice;
      if (stats.narration) {
        bible.pov = stats.narration.person === 'unclear' ? '' : `${stats.narration.person} person`;
        bible.tense = stats.narration.tense === 'unclear' ? '' : stats.narration.tense;
      }
      await this.saveBible(bookId, bible);
    } else if (!existing.voice.numbers || !options.deep) {
      await this.saveBible(bookId, { ...existing, voice: { ...existing.voice, numbers: stats.voice } });
    }
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Analysis | null> {
    const rows = await this.db.select<AnalysisRow>(`${SELECT} WHERE a.id = ?`, [id]);
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  /** The current analysis of a book, if it has one. */
  async latest(bookId: string): Promise<Analysis | null> {
    const rows = await this.db.select<AnalysisRow>(`${SELECT} WHERE a.book_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`, [bookId]);
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  /** True when the book's text has changed since it was analysed. */
  async isStale(analysis: Analysis): Promise<boolean> {
    return (await this.library.textSignature(analysis.bookId)) !== analysis.signature;
  }

  async nextRunnable(): Promise<Analysis | null> {
    const rows = await this.db.select<AnalysisRow>(
      `${SELECT} WHERE a.status IN ('running', 'queued') ORDER BY CASE a.status WHEN 'running' THEN 0 ELSE 1 END, a.created_at, a.rowid LIMIT 1`,
    );
    return rows[0] ? toAnalysis(rows[0]) : null;
  }

  async setStatus(id: string, status: AnalysisStatus, error: string | null = null): Promise<void> {
    const now = nowIso();
    await this.db.execute(
      `UPDATE analyses SET status = ?, error = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
         finished_at = CASE WHEN ? IN ('done', 'cancelled') THEN ? ELSE NULL END
       WHERE id = ?`,
      [status, error, status, now, status, now, id],
    );
    if (status === 'cancelled') {
      // Keep what was learned before the analysis was stopped.
      const analysis = await this.get(id);
      if (analysis && !analysis.result) await this.finish(analysis, null, []);
    }
  }

  /** Called when the app starts: an analysis that was running is put on hold. */
  async recoverInterrupted(): Promise<number> {
    const interrupted = await this.db.select<{ id: string }>("SELECT id FROM analyses WHERE status = 'running'");
    await this.db.batch([
      { sql: "UPDATE analysis_tasks SET status = 'queued' WHERE status = 'running'" },
      { sql: "UPDATE analyses SET status = 'paused', error = 'The app was closed while this analysis was running.' WHERE status = 'running'" },
    ]);
    return interrupted.length;
  }

  private async draftOf(id: string): Promise<Draft> {
    const rows = await this.db.select<{ draft: string }>('SELECT draft FROM analyses WHERE id = ?', [id]);
    return JSON.parse(rows[0]?.draft ?? '{}') as Draft;
  }

  private async issueCount(id: string): Promise<number> {
    return (await this.db.select<{ n: number }>('SELECT coalesce(max(position), -1) + 1 AS n FROM issues WHERE analysis_id = ?', [id]))[0].n;
  }

  async runNextTask(job: Analysis, provider: AiProvider, signal: AbortSignal, onToken?: (text: string) => void): Promise<boolean> {
    const rows = await this.db.select<{ id: string; kind: string; input: string }>(
      "SELECT id, kind, input FROM analysis_tasks WHERE analysis_id = ? AND status = 'queued' ORDER BY position LIMIT 1",
      [job.id],
    );
    const task = rows[0];
    if (!task) return false;
    await this.db.execute("UPDATE analysis_tasks SET status = 'running' WHERE id = ?", [task.id]);
    const started = Date.now();
    const { book, chapters } = await this.input(job.bookId);
    const kind = book.bookType as BookKind;
    const draft = await this.draftOf(job.id);
    try {
      if (task.kind === 'segment') {
        const segment = JSON.parse(task.input) as Segment;
        const { notes, tokens } = await withRetry(() =>
          analyseSegment(
            provider,
            segment,
            { kind, language: book.language, bookTitle: book.title, storySoFar: draft.summaries, knownCharacters: [...draft.bible.characters].sort((a, b) => b.mentions - a.mentions), instructions: book.instructions },
            { signal, onToken },
          ),
        );
        mergeSegment(draft.bible, notes, segment.chapterNumber);
        draft.passages++;
        if (notes.summary) draft.summaries.push(`Chapter ${segment.chapterNumber}${segment.parts > 1 ? `, part ${segment.part}` : ''}: ${notes.summary}`);
        let chapter = draft.chapters.find((c) => c.chapterId === segment.chapterId);
        if (!chapter) {
          chapter = { chapterId: segment.chapterId, number: segment.chapterNumber, title: segment.chapterTitle, summary: '', tension: 0, pace: 'steady', words: 0, parts: 0, tensionSum: 0, paces: [], povs: [], tenses: [] };
          draft.chapters.push(chapter);
        }
        chapter.parts++;
        chapter.words += segment.words;
        chapter.tensionSum += notes.tension;
        chapter.tension = Math.round((chapter.tensionSum / chapter.parts) * 10) / 10;
        chapter.paces.push(notes.pace);
        chapter.pace = (mostCommon(chapter.paces) || 'steady') as ChapterNotes['pace'];
        chapter.povs.push(notes.pov);
        chapter.tenses.push(notes.tense);
        chapter.summary = [chapter.summary, notes.summary].filter(Boolean).join(' ').slice(0, 900);

        const position = await this.issueCount(job.id);
        const placed = placeIssues(segment, notes, kind, locateQuote);
        await this.db.batch([
          ...placed.map((issue, i) =>
            issueInsert(job.bookId, job.id, position + i, {
              category: issue.category, severity: issue.severity, chapterId: segment.chapterId, blockIndex: issue.blockIndex, quote: issue.quote,
              title: CATEGORY_INFO[issue.category].label, detail: issue.problem, suggestion: issue.suggestion, source: 'ai',
            }),
          ),
          { sql: 'UPDATE analyses SET draft = ? WHERE id = ?', params: [JSON.stringify(draft), job.id] },
          { sql: "UPDATE analysis_tasks SET status = 'done', output = ?, tokens = ?, ms = ?, error = NULL WHERE id = ?", params: [JSON.stringify(notes), tokens, Date.now() - started, task.id] },
        ]);
        return true;
      }

      // The last step: assess the whole book and write the Book Bible.
      const content = contentChapters(chapters);
      const excerpt = (chapter: AnalysisChapter | undefined) =>
        chapter ? chapter.blocks.filter((b) => b.type === 'paragraph').map(blockText).join(' ').split(/\s+/).slice(0, 130).join(' ') : '';
      const samples = [...new Set([content[0], content[Math.floor(content.length / 2)], content[content.length - 1]])].map(excerpt).filter((s) => s.length > 80);
      const sorted = [...draft.chapters].sort((a, b) => a.number - b.number);
      assignRoles(draft.bible, draft.passages);
      let synthesis: Synthesis | null = null;
      let tokens = 0;
      let failure: unknown = null;
      try {
        const done = await withRetry(() =>
          synthesise(
            provider,
            { kind, language: book.language, bookTitle: book.title, stats: job.stats, chapters: sorted, characters: draft.bible.characters, samples, instructions: book.instructions },
            { signal, onToken },
          ),
        );
        synthesis = done.synthesis;
        tokens = done.tokens;
      } catch (e) {
        if (isAbort(e) || (e instanceof AiError && e.engineDown)) throw e;
        // The chapter notes are still worth keeping when the final assessment fails.
        failure = e;
      }
      const position = await this.issueCount(job.id);
      const bookIssues: Issue[] = (synthesis?.bookIssues ?? []).map((raw) => {
        const category = bookIssueCategory(kind, raw.type);
        const chapter = raw.chapter ? sorted.find((c) => c.number === raw.chapter) : undefined;
        return {
          category, severity: issueSeverity(raw.severity), chapterId: chapter?.chapterId ?? null, blockIndex: null, quote: '',
          title: `${CATEGORY_INFO[category].label}${chapter ? ` in ${chapter.title}` : ' across the book'}`, detail: raw.problem, suggestion: raw.suggestion, source: 'ai',
        };
      });
      await this.finish({ ...job }, synthesis, bookIssues.map((issue, i) => issueInsert(job.bookId, job.id, position + i, issue)), draft);
      await this.db.execute('UPDATE analysis_tasks SET status = ?, tokens = ?, ms = ?, error = ? WHERE id = ?', [
        failure ? 'failed' : 'done', tokens, Date.now() - started, failure ? (failure instanceof Error ? failure.message : String(failure)) : null, task.id,
      ]);
      return true;
    } catch (e) {
      const requeue = isAbort(e) || (e instanceof AiError && e.engineDown);
      await this.db.execute('UPDATE analysis_tasks SET status = ?, error = ?, ms = ? WHERE id = ?', [
        requeue ? 'queued' : 'failed', requeue ? null : e instanceof Error ? e.message : String(e), Date.now() - started, task.id,
      ]);
      throw e;
    }
  }

  /** Stores the result and builds the Book Bible from everything the passages yielded. */
  private async finish(job: Analysis, synthesis: Synthesis | null, extra: SqlStatement[], given?: Draft): Promise<void> {
    const draft = given ?? (await this.draftOf(job.id));
    if (!given) assignRoles(draft.bible, draft.passages);
    const sorted = [...draft.chapters].sort((a, b) => a.number - b.number);
    const result: AnalysisResult = {
      chapters: sorted.map(({ chapterId, number, title, summary, tension, pace, words }) => ({ chapterId, number, title, summary, tension, pace, words })),
      synthesis,
    };
    const statements: SqlStatement[] = [...extra, { sql: 'UPDATE analyses SET result = ? WHERE id = ?', params: [JSON.stringify(result), job.id] }];
    if (draft.passages > 0) {
      const bible = draft.bible;
      const allPov = sorted.flatMap((c) => c.povs);
      const allTense = sorted.flatMap((c) => c.tenses);
      bible.pov = mostCommon(allPov) || (job.stats.narration && job.stats.narration.person !== 'unclear' ? `${job.stats.narration.person} person` : '');
      bible.tense = mostCommon(allTense) || (job.stats.narration && job.stats.narration.tense !== 'unclear' ? job.stats.narration.tense : '');
      bible.chapterSummaries = sorted.map((c) => ({ chapterId: c.chapterId, title: c.title, summary: c.summary }));
      bible.voice = { numbers: job.stats.voice, description: synthesis?.voice.description ?? '', dialogueStyle: synthesis?.voice.dialogueStyle ?? '', devices: synthesis?.voice.devices ?? [] };
      if (synthesis) {
        bible.summary = synthesis.summary;
        bible.themes = synthesis.themes;
        bible.tone = synthesis.tone;
        for (const arc of synthesis.arcs) {
          const character = bible.characters.find((c) => c.name.toLowerCase() === arc.name.toLowerCase() || c.aliases.some((a) => a.toLowerCase() === arc.name.toLowerCase()));
          if (character) character.arc = arc.arc;
        }
      }
      const merged = keepLockedEntries(bible, await this.getBible(job.bookId));
      merged.updatedAt = nowIso();
      statements.push({
        sql: 'INSERT INTO bibles (book_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
        params: [job.bookId, JSON.stringify(merged), merged.updatedAt],
      });
    }
    await this.db.batch(statements);
  }

  // ----- Findings ------------------------------------------------------

  async listIssues(bookId: string): Promise<StoredIssue[]> {
    const rows = await this.db.select<{
      id: string; chapter_id: string | null; block_index: number | null; category: string; severity: string; quote: string; title: string;
      detail: string; suggestion: string; source: string; status: string;
    }>(
      `SELECT i.* FROM issues i JOIN analyses a ON a.id = i.analysis_id
       WHERE i.book_id = ? AND a.id = (SELECT id FROM analyses WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)
       ORDER BY i.position`,
      [bookId, bookId],
    );
    return rows.map((r) => ({
      id: r.id, chapterId: r.chapter_id, blockIndex: r.block_index, category: r.category as Issue['category'], severity: r.severity as Issue['severity'],
      quote: r.quote, title: r.title, detail: r.detail, suggestion: r.suggestion, source: r.source as Issue['source'], status: r.status as StoredIssue['status'],
    }));
  }

  async setIssueStatus(id: string, status: StoredIssue['status']): Promise<void> {
    await this.db.execute('UPDATE issues SET status = ? WHERE id = ?', [status, id]);
  }

  // ----- The Book Bible ------------------------------------------------

  async getBible(bookId: string): Promise<BookBible | null> {
    const rows = await this.db.select<{ data: string }>('SELECT data FROM bibles WHERE book_id = ?', [bookId]);
    if (!rows[0]) return null;
    try {
      return { ...emptyBible(), ...(JSON.parse(rows[0].data) as BookBible) };
    } catch {
      return null;
    }
  }

  async saveBible(bookId: string, bible: BookBible): Promise<void> {
    const updatedAt = nowIso();
    await this.db.execute(
      'INSERT INTO bibles (book_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      [bookId, JSON.stringify({ ...bible, updatedAt }), updatedAt],
    );
  }
}
