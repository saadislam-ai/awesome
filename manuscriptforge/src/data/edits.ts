import { isAbort, AiError, type AiProvider } from '../core/ai/provider';
import { chunkChapter, DEFAULT_CHUNK_WORDS } from '../core/edit/chunk';
import { applyDecisions, diffText, type ChangeKind, type Decision, type Decisions, type Hunk } from '../core/edit/diff';
import { markupToRuns, runsToMarkup } from '../core/edit/markup';
import { editChunk, regenerateParagraph, withRetry } from '../core/edit/pipeline';
import type { Chunk, EditLevel, EditOptions, EditStrength, Flag, ParagraphEdit } from '../core/edit/types';
import type { Block } from '../core/model/blocks';
import { newId, nowIso } from '../core/util/id';
import type { Db, SqlStatement } from '../platform/types';
import type { Library } from './library';

export type JobStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobScope {
  chapterIds: string[];
  /** Only these paragraphs of the (single) chapter, when a selection is edited. */
  range?: { from: number; to: number };
}

export interface NewJob {
  bookId: string;
  level: EditLevel;
  strength: EditStrength;
  scope: JobScope;
  styleGuide?: string;
  /** Name of the model, stored for the record. */
  model: string;
  maxWords?: number;
}

export interface EditJob {
  id: string;
  bookId: string;
  level: EditLevel;
  strength: EditStrength;
  status: JobStatus;
  scope: JobScope;
  options: EditOptions;
  model: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  // Progress.
  tasks: number;
  tasksDone: number;
  tasksFailed: number;
  words: number;
  wordsDone: number;
  suggestions: number;
  skipped: number;
  tokens: number;
  ms: number;
}

export interface Suggestion {
  id: string;
  bookId: string;
  chapterId: string;
  jobId: string | null;
  blockIndex: number;
  level: EditLevel;
  original: string;
  revised: string;
  note: string;
  flags: Flag[];
  decisions: Decisions;
  status: 'pending' | 'resolved' | 'stale';
  createdAt: string;
  /** Word-level changes, computed from the original and revised text. */
  hunks: Hunk[];
}

interface JobRow {
  id: string; book_id: string; level: string; strength: string; status: string; scope: string; options: string; model: string;
  error: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  tasks: number; tasks_done: number; tasks_failed: number; words: number; words_done: number; suggestions: number;
  skipped: number; tokens: number; ms: number;
}

interface TaskRow {
  id: string; job_id: string; chapter_id: string; position: number; status: string; input: string; words: number;
}

interface SuggestionRow {
  id: string; book_id: string; chapter_id: string; job_id: string | null; block_index: number; level: string; original: string;
  revised: string; note: string; flags: string; decisions: string; status: string; created_at: string;
}

const JOB_SELECT = `
  SELECT j.*,
    (SELECT count(*) FROM edit_tasks t WHERE t.job_id = j.id) AS tasks,
    (SELECT count(*) FROM edit_tasks t WHERE t.job_id = j.id AND t.status = 'done') AS tasks_done,
    (SELECT count(*) FROM edit_tasks t WHERE t.job_id = j.id AND t.status = 'failed') AS tasks_failed,
    (SELECT coalesce(sum(t.words), 0) FROM edit_tasks t WHERE t.job_id = j.id) AS words,
    (SELECT coalesce(sum(t.words), 0) FROM edit_tasks t WHERE t.job_id = j.id AND t.status IN ('done', 'failed')) AS words_done,
    (SELECT coalesce(sum(t.suggestions), 0) FROM edit_tasks t WHERE t.job_id = j.id) AS suggestions,
    (SELECT coalesce(sum(t.skipped), 0) FROM edit_tasks t WHERE t.job_id = j.id) AS skipped,
    (SELECT coalesce(sum(t.tokens), 0) FROM edit_tasks t WHERE t.job_id = j.id) AS tokens,
    (SELECT coalesce(sum(t.ms), 0) FROM edit_tasks t WHERE t.job_id = j.id) AS ms
  FROM edit_jobs j`;

function toJob(r: JobRow): EditJob {
  return {
    id: r.id, bookId: r.book_id, level: r.level as EditLevel, strength: r.strength as EditStrength, status: r.status as JobStatus,
    scope: JSON.parse(r.scope), options: JSON.parse(r.options), model: r.model, error: r.error, createdAt: r.created_at,
    startedAt: r.started_at, finishedAt: r.finished_at, tasks: r.tasks, tasksDone: r.tasks_done, tasksFailed: r.tasks_failed,
    words: r.words, wordsDone: r.words_done, suggestions: r.suggestions, skipped: r.skipped, tokens: r.tokens, ms: r.ms,
  };
}

function toSuggestion(r: SuggestionRow): Suggestion {
  return {
    id: r.id, bookId: r.book_id, chapterId: r.chapter_id, jobId: r.job_id, blockIndex: r.block_index, level: r.level as EditLevel,
    original: r.original, revised: r.revised, note: r.note, flags: JSON.parse(r.flags), decisions: JSON.parse(r.decisions),
    status: r.status as Suggestion['status'], createdAt: r.created_at, hunks: diffText(r.original, r.revised),
  };
}

/** The text a paragraph should hold right now, given what has been decided so far. */
function currentText(s: Pick<Suggestion, 'original' | 'hunks' | 'decisions'>): string {
  return applyDecisions(s.original, s.hunks, s.decisions);
}

/** Finds the paragraph a suggestion belongs to, even if paragraphs were added or removed above it. */
function findBlock(blocks: Block[], markup: string, hint: number): number {
  const matches = (index: number) => {
    const block = blocks[index];
    return !!block && block.type !== 'break' && runsToMarkup(block.runs) === markup;
  };
  if (matches(hint)) return hint;
  for (let distance = 1; distance < blocks.length; distance++) {
    if (matches(hint - distance)) return hint - distance;
    if (matches(hint + distance)) return hint + distance;
  }
  return -1;
}

export interface DecisionRequest {
  suggestionId: string;
  /** Decisions to record, by change index. `null` returns a change to undecided. */
  changes: Record<number, Decision | null>;
}

export interface BulkFilter {
  kinds?: ChangeKind[];
  /** Leave out suggestions that carry a warning, so those are always looked at one by one. */
  skipFlagged?: boolean;
}

/**
 * AI editing jobs and the suggestions they produce.
 *
 * A job never changes the book. It only records suggestions. The book's text
 * changes when the publisher accepts a change, and every such change can be
 * undone by rejecting it again or through the version history.
 */
export class EditStore {
  private safeguarded = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly library: Library,
  ) {}

  // ----- Jobs ----------------------------------------------------------

  /** Plans a job: cuts the chosen chapters into passages and queues them. */
  async createJob(input: NewJob): Promise<EditJob> {
    const book = await this.library.getBook(input.bookId);
    if (!book) throw new Error('This book no longer exists.');
    const options: EditOptions = {
      level: input.level,
      strength: input.strength,
      language: book.language,
      bookType: book.bookType,
      instructions: book.instructions,
      styleGuide: input.styleGuide ?? '',
    };
    const id = newId('job');
    const now = nowIso();
    const statements: SqlStatement[] = [
      {
        sql: 'INSERT INTO edit_jobs (id, book_id, level, strength, status, scope, options, model, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        params: [id, input.bookId, input.level, input.strength, 'queued', JSON.stringify(input.scope), JSON.stringify(options), input.model, now],
      },
    ];
    let position = 0;
    const chapters = await this.library.getAllChapters(input.bookId);
    for (const chapter of chapters) {
      if (!input.scope.chapterIds.includes(chapter.id)) continue;
      const chunks = chunkChapter(chapter.blocks, { level: input.level, maxWords: input.maxWords ?? DEFAULT_CHUNK_WORDS, range: input.scope.range });
      for (const chunk of chunks) {
        statements.push({
          sql: 'INSERT INTO edit_tasks (id, job_id, chapter_id, position, status, input, words) VALUES (?,?,?,?,?,?,?)',
          params: [newId('task'), id, chapter.id, position++, 'queued', JSON.stringify(chunk), chunk.words],
        });
      }
    }
    if (!position) throw new Error('There is no text to edit in the chosen chapters.');
    await this.db.batch(statements);
    this.safeguarded.delete(input.bookId);
    return (await this.getJob(id))!;
  }

  async getJob(id: string): Promise<EditJob | null> {
    const rows = await this.db.select<JobRow>(`${JOB_SELECT} WHERE j.id = ?`, [id]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  /** Jobs, newest first. */
  async listJobs(bookId?: string): Promise<EditJob[]> {
    const rows = bookId
      ? await this.db.select<JobRow>(`${JOB_SELECT} WHERE j.book_id = ? ORDER BY j.created_at DESC, j.rowid DESC`, [bookId])
      : await this.db.select<JobRow>(`${JOB_SELECT} ORDER BY j.created_at DESC, j.rowid DESC`);
    return rows.map(toJob);
  }

  /** The next job that should run: one already running, else the oldest queued one. */
  async nextRunnableJob(): Promise<EditJob | null> {
    const rows = await this.db.select<JobRow>(
      `${JOB_SELECT} WHERE j.status IN ('running', 'queued') ORDER BY CASE j.status WHEN 'running' THEN 0 ELSE 1 END, j.created_at, j.rowid LIMIT 1`,
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async setJobStatus(id: string, status: JobStatus, error: string | null = null): Promise<void> {
    const now = nowIso();
    await this.db.execute(
      `UPDATE edit_jobs SET status = ?, error = ?,
         started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
         finished_at = CASE WHEN ? IN ('done', 'cancelled') THEN ? ELSE NULL END
       WHERE id = ?`,
      [status, error, status, now, status, now, id],
    );
  }

  /**
   * Called when the app starts. A job that was running when the app was
   * closed is put on hold, and its unfinished passage is queued again, so
   * nothing is lost and nothing runs without the publisher knowing.
   */
  async recoverInterrupted(): Promise<number> {
    const interrupted = await this.db.select<{ id: string }>("SELECT id FROM edit_jobs WHERE status = 'running'");
    await this.db.batch([
      { sql: "UPDATE edit_tasks SET status = 'queued' WHERE status = 'running'" },
      { sql: "UPDATE edit_jobs SET status = 'paused', error = 'The app was closed while this job was running.' WHERE status = 'running'" },
    ]);
    return interrupted.length;
  }

  async deleteJob(id: string): Promise<void> {
    await this.db.execute('DELETE FROM edit_jobs WHERE id = ?', [id]);
  }

  /** Queues the failed passages of a finished job again. */
  async retryFailed(id: string): Promise<void> {
    await this.db.batch([
      { sql: "UPDATE edit_tasks SET status = 'queued', error = NULL WHERE job_id = ? AND status = 'failed'", params: [id] },
      { sql: "UPDATE edit_jobs SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?", params: [id] },
    ]);
  }

  private async takeTask(jobId: string): Promise<{ id: string; chapterId: string; chunk: Chunk } | null> {
    const rows = await this.db.select<TaskRow>("SELECT * FROM edit_tasks WHERE job_id = ? AND status = 'queued' ORDER BY position LIMIT 1", [jobId]);
    const row = rows[0];
    if (!row) return null;
    await this.db.execute("UPDATE edit_tasks SET status = 'running' WHERE id = ?", [row.id]);
    return { id: row.id, chapterId: row.chapter_id, chunk: JSON.parse(row.input) as Chunk };
  }

  /**
   * Runs the next passage of a job. Returns false when the job has no
   * passages left. Throws when the passage could not be processed; the
   * passage is then queued again (if stopped or the engine is unreachable) or
   * marked as failed.
   */
  async runNextTask(job: EditJob, provider: AiProvider, signal: AbortSignal, onToken?: (text: string) => void): Promise<boolean> {
    const task = await this.takeTask(job.id);
    if (!task) return false;
    const started = Date.now();
    try {
      // The text may have been edited since the job was planned. Only
      // paragraphs that are still exactly as planned are sent.
      const chapter = await this.library.getChapter(task.chapterId);
      const items = chapter
        ? task.chunk.items.filter((item) => {
            const block = chapter.blocks[item.blockIndex];
            return block && block.type !== 'break' && runsToMarkup(block.runs) === item.markup;
          })
        : [];
      const skippedChanged = task.chunk.items.length - items.length;
      let edits: ParagraphEdit[] = [];
      let skipped = skippedChanged;
      let tokens = 0;
      if (items.length) {
        const chunk: Chunk = { ...task.chunk, items: items.map((item, index) => ({ ...item, n: index + 1 })) };
        const result = await withRetry(() => editChunk(provider, chunk, job.options, { signal, onToken }));
        edits = result.edits;
        skipped += result.discarded + result.missing;
        tokens = result.completionTokens;
      }
      const now = nowIso();
      const statements: SqlStatement[] = [];
      for (const edit of edits) {
        // A newer suggestion for the same untouched paragraph replaces an older one.
        statements.push({
          sql: "DELETE FROM suggestions WHERE chapter_id = ? AND original = ? AND status = 'pending' AND decisions = '{}'",
          params: [task.chapterId, edit.original],
        });
        statements.push({
          sql: `INSERT INTO suggestions (id, book_id, chapter_id, job_id, block_index, level, original, revised, note, flags, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          params: [newId('sg'), job.bookId, task.chapterId, job.id, edit.blockIndex, job.level, edit.original, edit.revised, edit.note, JSON.stringify(edit.flags), now],
        });
      }
      statements.push({
        sql: "UPDATE edit_tasks SET status = 'done', suggestions = ?, skipped = ?, tokens = ?, ms = ?, error = NULL WHERE id = ?",
        params: [edits.length, skipped, tokens, Date.now() - started, task.id],
      });
      await this.db.batch(statements);
      return true;
    } catch (e) {
      const requeue = isAbort(e) || (e instanceof AiError && e.engineDown);
      await this.db.execute('UPDATE edit_tasks SET status = ?, error = ?, ms = ? WHERE id = ?', [
        requeue ? 'queued' : 'failed',
        requeue ? null : e instanceof Error ? e.message : String(e),
        Date.now() - started,
        task.id,
      ]);
      throw e;
    }
  }

  // ----- Suggestions ---------------------------------------------------

  async listSuggestions(bookId: string, chapterId?: string): Promise<Suggestion[]> {
    const rows = chapterId
      ? await this.db.select<SuggestionRow>('SELECT * FROM suggestions WHERE book_id = ? AND chapter_id = ? ORDER BY block_index, created_at', [bookId, chapterId])
      : await this.db.select<SuggestionRow>('SELECT * FROM suggestions WHERE book_id = ? ORDER BY chapter_id, block_index, created_at', [bookId]);
    return rows.map(toSuggestion);
  }

  /** Number of suggestions still waiting for a decision, per chapter. */
  async pendingByChapter(bookId: string): Promise<Record<string, number>> {
    const rows = await this.db.select<{ chapter_id: string; n: number }>(
      "SELECT chapter_id, count(*) AS n FROM suggestions WHERE book_id = ? AND status = 'pending' GROUP BY chapter_id",
      [bookId],
    );
    return Object.fromEntries(rows.map((r) => [r.chapter_id, r.n]));
  }

  private async getSuggestion(id: string): Promise<Suggestion> {
    const rows = await this.db.select<SuggestionRow>('SELECT * FROM suggestions WHERE id = ?', [id]);
    if (!rows[0]) throw new Error('This suggestion no longer exists.');
    return toSuggestion(rows[0]);
  }

  /** Saves the text as it is before the first AI change is applied, so the whole review can be undone. */
  private async safeguard(bookId: string): Promise<void> {
    if (this.safeguarded.has(bookId)) return;
    this.safeguarded.add(bookId);
    await this.library.createSnapshot(bookId, 'Before AI edits', 'safety');
  }

  /**
   * Records decisions and updates the chapter text to match, in one step.
   * All requests must be for the same chapter. Returns the ids of
   * suggestions that could not be applied because their paragraph was
   * changed by hand in the meantime; those are marked as out of date.
   */
  async decide(requests: DecisionRequest[]): Promise<{ stale: string[] }> {
    if (!requests.length) return { stale: [] };
    const suggestions = await Promise.all(requests.map((r) => this.getSuggestion(r.suggestionId)));
    const chapterId = suggestions[0].chapterId;
    if (suggestions.some((s) => s.chapterId !== chapterId)) throw new Error('Decisions must be for one chapter at a time.');
    const chapter = await this.library.getChapter(chapterId);
    if (!chapter) throw new Error('This chapter no longer exists.');
    await this.safeguard(suggestions[0].bookId);

    const blocks = chapter.blocks.slice();
    const statements: SqlStatement[] = [];
    const stale: string[] = [];
    const now = nowIso();
    suggestions.forEach((suggestion, i) => {
      const index = findBlock(blocks, currentText(suggestion), suggestion.blockIndex);
      if (index < 0) {
        stale.push(suggestion.id);
        statements.push({ sql: "UPDATE suggestions SET status = 'stale', resolved_at = ? WHERE id = ?", params: [now, suggestion.id] });
        return;
      }
      const decisions: Decisions = { ...suggestion.decisions };
      for (const [key, value] of Object.entries(requests[i].changes)) {
        if (value === null) delete decisions[Number(key)];
        else decisions[Number(key)] = value;
      }
      const block = blocks[index] as Exclude<Block, { type: 'break' }>;
      blocks[index] = { ...block, runs: markupToRuns(applyDecisions(suggestion.original, suggestion.hunks, decisions)) };
      const resolved = suggestion.hunks.every((h) => decisions[h.index] !== undefined);
      statements.push({
        sql: 'UPDATE suggestions SET decisions = ?, status = ?, block_index = ?, resolved_at = ? WHERE id = ?',
        params: [JSON.stringify(decisions), resolved ? 'resolved' : 'pending', index, resolved ? now : null, suggestion.id],
      });
    });
    await this.library.saveChapter(chapterId, blocks, statements);
    return { stale };
  }

  /** Accepts or rejects every undecided change in a chapter that passes the filter. */
  async decideAll(bookId: string, chapterId: string, decision: Decision, filter: BulkFilter = {}): Promise<{ changed: number; stale: string[] }> {
    const suggestions = (await this.listSuggestions(bookId, chapterId)).filter((s) => s.status === 'pending');
    const requests: DecisionRequest[] = [];
    let changed = 0;
    for (const suggestion of suggestions) {
      if (filter.skipFlagged && suggestion.flags.length && decision === 'accept') continue;
      const changes: Record<number, Decision> = {};
      for (const hunk of suggestion.hunks) {
        if (suggestion.decisions[hunk.index] !== undefined) continue;
        if (filter.kinds && !filter.kinds.includes(hunk.kind)) continue;
        changes[hunk.index] = decision;
        changed++;
      }
      if (Object.keys(changes).length) requests.push({ suggestionId: suggestion.id, changes });
    }
    const { stale } = await this.decide(requests);
    return { changed, stale };
  }

  /**
   * Replaces the proposed text of a suggestion (after a manual edit of the
   * proposal, or a new attempt by the model). Decisions made so far are
   * cleared and the paragraph goes back to the author's original first.
   */
  async revise(id: string, revised: string, note?: string, flags?: Flag[]): Promise<void> {
    const suggestion = await this.getSuggestion(id);
    const chapter = await this.library.getChapter(suggestion.chapterId);
    if (!chapter) throw new Error('This chapter no longer exists.');
    const blocks = chapter.blocks.slice();
    const index = findBlock(blocks, currentText(suggestion), suggestion.blockIndex);
    if (index < 0) {
      await this.db.execute("UPDATE suggestions SET status = 'stale', resolved_at = ? WHERE id = ?", [nowIso(), id]);
      throw new Error('This paragraph was changed by hand since the suggestion was made, so the suggestion is out of date.');
    }
    const block = blocks[index] as Exclude<Block, { type: 'break' }>;
    blocks[index] = { ...block, runs: markupToRuns(suggestion.original) };
    const unchanged = revised === suggestion.original;
    await this.library.saveChapter(suggestion.chapterId, blocks, [
      {
        sql: `UPDATE suggestions SET revised = ?, note = ?, flags = ?, decisions = '{}', status = ?, block_index = ?, resolved_at = ? WHERE id = ?`,
        params: [revised, note ?? suggestion.note, JSON.stringify(flags ?? suggestion.flags), unchanged ? 'resolved' : 'pending', index, unchanged ? nowIso() : null, id],
      },
    ]);
  }

  /** Has the model redo one suggestion, following a note from the publisher. */
  async regenerate(id: string, provider: AiProvider, note: string, options: EditOptions, signal?: AbortSignal): Promise<void> {
    const suggestion = await this.getSuggestion(id);
    const redo = await regenerateParagraph(provider, suggestion.original, suggestion.revised, note, options, { signal });
    await this.revise(id, redo.revised, redo.note, redo.flags);
  }

  /** Removes one suggestion from the list. The book's text is left as it is. */
  async dismiss(id: string): Promise<void> {
    await this.db.execute('DELETE FROM suggestions WHERE id = ?', [id]);
  }

  /** Removes suggestions that are finished with: fully decided or out of date. */
  async clearResolved(bookId: string): Promise<void> {
    await this.db.execute("DELETE FROM suggestions WHERE book_id = ? AND status != 'pending'", [bookId]);
  }
}

export interface RunnerState {
  /** The job being worked on, if any. */
  jobId: string | null;
  /** Text of the reply as it streams in, for a live preview. */
  preview: string;
  /** Why the queue stopped, when it stopped because of a problem. */
  problem: string | null;
}

/**
 * Works through editing jobs one passage at a time. One passage runs at
 * once (a local model serves one request at a time). The queue can be
 * paused, resumed and cancelled, and because every passage is stored in the
 * database, a job can be continued after the app has been closed.
 */
export class JobRunner {
  state: RunnerState = { jobId: null, preview: '', problem: null };
  private abort: AbortController | null = null;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly store: EditStore,
    /** Returns the model to use, or null when none is ready. */
    private readonly getProvider: () => AiProvider | null,
    private readonly onChange: () => void = () => undefined,
  ) {}

  get busy(): boolean {
    return this.loop !== null;
  }

  /** Starts working if there is work and nothing is running. Safe to call at any time. */
  kick(): void {
    if (this.loop) return;
    this.loop = this.run().finally(() => {
      this.loop = null;
      this.abort = null;
      this.state = { ...this.state, jobId: null, preview: '' };
      this.onChange();
    });
  }

  /** Resolves when the queue has stopped (finished, paused or blocked). */
  async idle(): Promise<void> {
    while (this.loop) await this.loop;
  }

  private async run(): Promise<void> {
    for (;;) {
      const job = await this.store.nextRunnableJob();
      if (!job) return;
      const provider = this.getProvider();
      if (!provider) {
        this.state = { ...this.state, problem: 'No AI model is loaded. Load a model in Settings, then resume.' };
        await this.store.setJobStatus(job.id, 'paused', this.state.problem);
        continue;
      }
      if (job.status !== 'running') await this.store.setJobStatus(job.id, 'running');
      this.state = { jobId: job.id, preview: '', problem: null };
      this.abort = new AbortController();
      this.onChange();
      try {
        const more = await this.store.runNextTask(job, provider, this.abort.signal, (text) => {
          this.state = { ...this.state, preview: (this.state.preview + text).slice(-600) };
          this.onChange();
        });
        if (!more) await this.store.setJobStatus(job.id, 'done');
      } catch (e) {
        if (isAbort(e)) {
          // pause() or cancel() already recorded the new status.
        } else if (e instanceof AiError && e.engineDown) {
          // The engine is not answering: stop here rather than failing passage after passage.
          this.state = { ...this.state, problem: e.message };
          await this.store.setJobStatus(job.id, 'paused', e.message);
        }
        // Any other failure was recorded on the passage itself; the job moves on.
      }
      this.state = { ...this.state, preview: '' };
      this.onChange();
    }
  }

  /** Puts a job on hold. The passage in progress is stopped and will be redone on resume. */
  async pause(jobId: string): Promise<void> {
    await this.store.setJobStatus(jobId, 'paused');
    if (this.state.jobId === jobId) this.abort?.abort();
    await this.idleIfStopped(jobId);
    this.onChange();
  }

  async resume(jobId: string): Promise<void> {
    await this.store.setJobStatus(jobId, 'queued');
    this.state = { ...this.state, problem: null };
    this.kick();
    this.onChange();
  }

  /** Stops a job for good. Suggestions it already made are kept. */
  async cancel(jobId: string): Promise<void> {
    await this.store.setJobStatus(jobId, 'cancelled');
    if (this.state.jobId === jobId) this.abort?.abort();
    await this.idleIfStopped(jobId);
    this.onChange();
  }

  private async idleIfStopped(jobId: string): Promise<void> {
    // Give the passage in progress a moment to wind down, so callers see a settled state.
    for (let i = 0; i < 50 && this.state.jobId === jobId && this.loop; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
