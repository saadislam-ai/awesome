import { mergeChapterIntoPrevious, splitChapterAt } from '../core/import/chapters';
import type { SourceFormat } from '../core/import/common';
import { blocksPlainText, type Block, type ChapterDraft } from '../core/model/blocks';
import type {
  Book,
  BookCategory,
  BookStatus,
  BookType,
  Chapter,
  ChapterHead,
  Decision,
  SearchHit,
  Version,
  VersionChapter,
  VersionKind,
} from '../core/model/book';
import { countBlockWords } from '../core/text/words';
import { sha256 } from '../core/util/hash';
import { newId, nowIso, safeFileName } from '../core/util/id';
import type { Db, FileStore, SqlParam, SqlStatement } from '../platform/types';
import { migrate } from './schema';

export interface NewBook {
  category: BookCategory;
  title: string;
  author?: string;
  bookType?: BookType;
  genre?: string;
  language?: string;
  tags?: string[];
  chapters: ChapterDraft[];
  /** The file the book was imported from. It is kept untouched. */
  source?: { name: string; format: SourceFormat; bytes: Uint8Array };
  authorContact?: string;
  receivedAt?: string | null;
}

export type BookPatch = Partial<
  Pick<
    Book,
    | 'category' | 'title' | 'author' | 'bookType' | 'genre' | 'language' | 'status' | 'tags' | 'notes'
    | 'instructions' | 'neverCloud' | 'authorContact' | 'receivedAt' | 'decision'
  >
>;

export const ORIGINAL_VERSION_NAME = 'Original manuscript';
const AUTO_SNAPSHOTS_TO_KEEP = 30;
const SAFETY_SNAPSHOTS_TO_KEEP = 10;

interface BookRow {
  id: string; category: string; title: string; author: string; book_type: string; genre: string; language: string;
  status: string; word_count: number; tags: string; notes: string; instructions: string; never_cloud: number;
  source_name: string | null; source_format: string | null; original_path: string | null; author_contact: string;
  received_at: string | null; decision: string | null; created_at: string; updated_at: string; last_opened_at: string | null;
}

interface ChapterRow {
  id: string; book_id: string; position: number; title: string; word_count: number; updated_at: string;
  content?: string; hash?: string;
}

interface VersionRow {
  id: string; book_id: string; name: string; kind: string; note: string; word_count: number; chapter_count: number;
  signature: string; created_at: string;
}

const PATCH_COLUMNS: Record<keyof BookPatch, string> = {
  category: 'category', title: 'title', author: 'author', bookType: 'book_type', genre: 'genre', language: 'language',
  status: 'status', tags: 'tags', notes: 'notes', instructions: 'instructions', neverCloud: 'never_cloud',
  authorContact: 'author_contact', receivedAt: 'received_at', decision: 'decision',
};

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function toBook(r: BookRow): Book {
  return {
    id: r.id,
    category: r.category as BookCategory,
    title: r.title,
    author: r.author,
    bookType: r.book_type as BookType,
    genre: r.genre,
    language: r.language,
    status: r.status as BookStatus,
    wordCount: r.word_count,
    tags: parseTags(r.tags),
    notes: r.notes,
    instructions: r.instructions,
    neverCloud: !!r.never_cloud,
    sourceName: r.source_name,
    sourceFormat: r.source_format as SourceFormat | null,
    originalPath: r.original_path,
    authorContact: r.author_contact,
    receivedAt: r.received_at,
    decision: r.decision as Decision | null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastOpenedAt: r.last_opened_at,
  };
}

function toHead(r: ChapterRow): ChapterHead {
  return { id: r.id, bookId: r.book_id, position: r.position, title: r.title, wordCount: r.word_count, updatedAt: r.updated_at };
}

function toVersion(r: VersionRow): Version {
  return {
    id: r.id, bookId: r.book_id, name: r.name, kind: r.kind as VersionKind, note: r.note,
    wordCount: r.word_count, chapterCount: r.chapter_count, createdAt: r.created_at,
  };
}

/** Everything stored about one chapter's content, derived from its blocks. */
function derive(blocks: Block[]) {
  const content = JSON.stringify(blocks);
  const plain = blocksPlainText(blocks);
  return { content, hash: sha256(content), plain, search: plain.toLowerCase(), words: countBlockWords(blocks) };
}

function signatureOf(chapters: { title: string; hash: string }[]): string {
  return sha256(chapters.map((c) => `${c.title}\u0001${c.hash}`).join('\u0002'));
}

function cleanTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out;
}

function insertChapter(bookId: string, id: string, position: number, title: string, blocks: Block[], now: string): SqlStatement {
  const d = derive(blocks);
  return {
    sql: 'INSERT INTO chapters (id, book_id, position, title, content, hash, plain, search, word_count, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    params: [id, bookId, position, title, d.content, d.hash, d.plain, d.search, d.words, now],
  };
}

function refreshTotals(bookId: string, now: string): SqlStatement {
  return {
    sql: 'UPDATE books SET word_count = (SELECT coalesce(sum(word_count), 0) FROM chapters WHERE book_id = ?), updated_at = ? WHERE id = ?',
    params: [bookId, now, bookId],
  };
}

/**
 * The library: every book, its chapters and its version history.
 *
 * All multi-step changes go through `db.batch`, so a crash or a closed
 * window can never leave a book half-updated.
 */
export class Library {
  constructor(
    private readonly db: Db,
    private readonly files: FileStore,
  ) {}

  async init(): Promise<void> {
    await migrate(this.db);
  }

  // ----- Books ---------------------------------------------------------

  async createBook(input: NewBook): Promise<Book> {
    const id = newId('bk');
    const now = nowIso();
    const chapters = input.chapters.length ? input.chapters : [{ title: 'Chapter 1', blocks: [] }];
    let originalPath: string | null = null;
    if (input.source) {
      originalPath = `books/${id}/original/${safeFileName(input.source.name)}`;
      await this.files.write(originalPath, input.source.bytes);
    }

    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO books (id, category, title, author, book_type, genre, language, status, tags, source_name, source_format,
              original_path, author_contact, received_at, decision, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          id, input.category, input.title.trim() || 'Untitled', (input.author ?? '').trim(), input.bookType ?? 'fiction',
          (input.genre ?? '').trim(), input.language ?? 'und', 'imported', JSON.stringify(cleanTags(input.tags)),
          input.source?.name ?? null, input.source?.format ?? null, originalPath, (input.authorContact ?? '').trim(),
          input.category === 'submission' ? (input.receivedAt ?? now.slice(0, 10)) : null,
          input.category === 'submission' ? 'under_review' : null, now, now,
        ],
      },
    ];
    chapters.forEach((chapter, position) => {
      statements.push(insertChapter(id, newId('ch'), position, chapter.title.trim() || `Chapter ${position + 1}`, chapter.blocks, now));
    });
    statements.push(refreshTotals(id, now));

    try {
      await this.db.batch(statements);
      // The first version is the untouched import. It can never be changed or deleted.
      await this.createSnapshot(id, ORIGINAL_VERSION_NAME, 'original', input.source ? `Imported from ${input.source.name}` : '');
    } catch (e) {
      await this.db.execute('DELETE FROM books WHERE id = ?', [id]).catch(() => undefined);
      if (originalPath) await this.files.remove(`books/${id}`).catch(() => undefined);
      throw e;
    }
    return (await this.getBook(id))!;
  }

  async listBooks(): Promise<Book[]> {
    const rows = await this.db.select<BookRow>('SELECT * FROM books ORDER BY coalesce(last_opened_at, created_at) DESC');
    return rows.map(toBook);
  }

  async getBook(id: string): Promise<Book | null> {
    const rows = await this.db.select<BookRow>('SELECT * FROM books WHERE id = ?', [id]);
    return rows[0] ? toBook(rows[0]) : null;
  }

  async updateBook(id: string, patch: BookPatch): Promise<Book> {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    for (const key of Object.keys(patch) as (keyof BookPatch)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      sets.push(`${PATCH_COLUMNS[key]} = ?`);
      if (key === 'tags') params.push(JSON.stringify(cleanTags(value as string[])));
      else if (key === 'neverCloud') params.push(value ? 1 : 0);
      else if (key === 'title') params.push((value as string).trim() || 'Untitled');
      else params.push(value as SqlParam);
    }
    if (patch.category === 'submission') {
      sets.push("decision = coalesce(decision, 'under_review')", 'received_at = coalesce(received_at, ?)');
      params.push(nowIso().slice(0, 10));
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(nowIso(), id);
      await this.db.execute(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    const book = await this.getBook(id);
    if (!book) throw new Error('This book no longer exists.');
    return book;
  }

  async markOpened(id: string): Promise<void> {
    await this.db.execute('UPDATE books SET last_opened_at = ? WHERE id = ?', [nowIso(), id]);
  }

  /** Deletes a book with all its chapters, versions and its stored original file. */
  async deleteBook(id: string): Promise<void> {
    await this.db.execute('DELETE FROM books WHERE id = ?', [id]);
    await this.collectGarbage();
    await this.files.remove(`books/${id}`);
  }

  async readOriginal(book: Book): Promise<Uint8Array | null> {
    if (!book.originalPath || !(await this.files.exists(book.originalPath))) return null;
    return this.files.read(book.originalPath);
  }

  /** Full-text search inside every book. Case-insensitive in any language. */
  async searchText(query: string, limit = 60): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const like = `%${needle.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const rows = await this.db.select<{ book_id: string; book_title: string; id: string; title: string; pos: number; snippet: string }>(
      `SELECT c.book_id, b.title AS book_title, c.id, c.title, instr(c.search, ?) AS pos,
              substr(c.plain, max(1, instr(c.search, ?) - 70), 200) AS snippet
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.search LIKE ? ESCAPE '\\'
       ORDER BY b.title, c.position LIMIT ?`,
      [needle, needle, like, limit],
    );
    return rows.map((r) => ({
      bookId: r.book_id,
      bookTitle: r.book_title,
      chapterId: r.id,
      chapterTitle: r.title,
      snippet: (r.pos > 71 ? '…' : '') + r.snippet.replace(/\s+/g, ' ').trim() + '…',
    }));
  }

  // ----- Chapters ------------------------------------------------------

  async listChapters(bookId: string): Promise<ChapterHead[]> {
    const rows = await this.db.select<ChapterRow>(
      'SELECT id, book_id, position, title, word_count, updated_at FROM chapters WHERE book_id = ? ORDER BY position',
      [bookId],
    );
    return rows.map(toHead);
  }

  async getChapter(id: string): Promise<Chapter | null> {
    const rows = await this.db.select<ChapterRow>(
      'SELECT id, book_id, position, title, word_count, updated_at, content FROM chapters WHERE id = ?',
      [id],
    );
    const row = rows[0];
    return row ? { ...toHead(row), blocks: JSON.parse(row.content!) as Block[] } : null;
  }

  async getAllChapters(bookId: string): Promise<Chapter[]> {
    const rows = await this.db.select<ChapterRow>(
      'SELECT id, book_id, position, title, word_count, updated_at, content FROM chapters WHERE book_id = ? ORDER BY position',
      [bookId],
    );
    return rows.map((row) => ({ ...toHead(row), blocks: JSON.parse(row.content!) as Block[] }));
  }

  /**
   * Saves edited chapter text. Returns the chapter's new word count.
   * `alongside` statements are applied in the same transaction as the text.
   */
  async saveChapter(id: string, blocks: Block[], alongside: SqlStatement[] = []): Promise<{ wordCount: number; bookWordCount: number }> {
    const rows = await this.db.select<{ book_id: string; hash: string }>('SELECT book_id, hash FROM chapters WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) throw new Error('This chapter no longer exists.');
    const d = derive(blocks);
    const now = nowIso();
    if (d.hash !== row.hash) {
      await this.db.batch([
        {
          sql: 'UPDATE chapters SET content = ?, hash = ?, plain = ?, search = ?, word_count = ?, updated_at = ? WHERE id = ?',
          params: [d.content, d.hash, d.plain, d.search, d.words, now, id],
        },
        refreshTotals(row.book_id, now),
        // The first manual edit moves a freshly imported book into editing.
        { sql: "UPDATE books SET status = 'editing' WHERE id = ? AND status IN ('imported', 'analyzed')", params: [row.book_id] },
        ...alongside,
      ]);
    } else if (alongside.length) {
      await this.db.batch(alongside);
    }
    const total = await this.db.select<{ word_count: number }>('SELECT word_count FROM books WHERE id = ?', [row.book_id]);
    return { wordCount: d.words, bookWordCount: total[0]?.word_count ?? 0 };
  }

  async renameChapter(id: string, title: string): Promise<void> {
    const now = nowIso();
    await this.db.execute('UPDATE chapters SET title = ?, updated_at = ? WHERE id = ?', [title.trim() || 'Untitled chapter', now, id]);
  }

  /** Replaces a book's chapter list with `chapters`, keeping ids where given. */
  private replaceChapters(bookId: string, chapters: { id?: string; title: string; blocks: Block[] }[], now: string): SqlStatement[] {
    const statements: SqlStatement[] = [{ sql: 'DELETE FROM chapters WHERE book_id = ?', params: [bookId] }];
    chapters.forEach((c, position) => statements.push(insertChapter(bookId, c.id ?? newId('ch'), position, c.title, c.blocks, now)));
    statements.push(refreshTotals(bookId, now));
    return statements;
  }

  private async reorder(bookId: string, orderedIds: string[], now: string): Promise<void> {
    await this.db.batch([
      ...orderedIds.map((id, position) => ({ sql: 'UPDATE chapters SET position = ? WHERE id = ?', params: [position, id] })),
      refreshTotals(bookId, now),
    ]);
  }

  async addChapter(bookId: string, afterChapterId: string | null, title = 'New chapter'): Promise<ChapterHead> {
    const heads = await this.listChapters(bookId);
    const id = newId('ch');
    const now = nowIso();
    const index = afterChapterId ? heads.findIndex((h) => h.id === afterChapterId) + 1 : heads.length;
    const order = heads.map((h) => h.id);
    order.splice(index, 0, id);
    await this.db.batch([
      insertChapter(bookId, id, heads.length, title, [], now),
      ...order.map((cid, position) => ({ sql: 'UPDATE chapters SET position = ? WHERE id = ?', params: [position, cid] })),
      refreshTotals(bookId, now),
    ]);
    return (await this.listChapters(bookId)).find((h) => h.id === id)!;
  }

  async deleteChapter(id: string): Promise<void> {
    const rows = await this.db.select<{ book_id: string }>('SELECT book_id FROM chapters WHERE id = ?', [id]);
    if (!rows[0]) return;
    const bookId = rows[0].book_id;
    const heads = await this.listChapters(bookId);
    if (heads.length <= 1) throw new Error('A book needs at least one chapter.');
    await this.db.execute('DELETE FROM chapters WHERE id = ?', [id]);
    await this.reorder(bookId, heads.filter((h) => h.id !== id).map((h) => h.id), nowIso());
  }

  async moveChapter(id: string, direction: -1 | 1): Promise<void> {
    const rows = await this.db.select<{ book_id: string }>('SELECT book_id FROM chapters WHERE id = ?', [id]);
    if (!rows[0]) return;
    const order = (await this.listChapters(rows[0].book_id)).map((h) => h.id);
    const from = order.indexOf(id);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    await this.reorder(rows[0].book_id, order, nowIso());
  }

  /** Starts a new chapter at the given block. Returns the id of the new chapter. */
  async splitChapter(id: string, blockIndex: number): Promise<string | null> {
    const chapter = await this.getChapter(id);
    if (!chapter) return null;
    const all = await this.getAllChapters(chapter.bookId);
    const index = all.findIndex((c) => c.id === id);
    const drafts = splitChapterAt(all.map((c) => ({ title: c.title, blocks: c.blocks })), index, blockIndex);
    if (drafts.length === all.length) return null;
    const newChapterId = newId('ch');
    const ids = [...all.slice(0, index + 1).map((c) => c.id), newChapterId, ...all.slice(index + 1).map((c) => c.id)];
    await this.db.batch(this.replaceChapters(chapter.bookId, drafts.map((d, i) => ({ ...d, id: ids[i] })), nowIso()));
    return newChapterId;
  }

  /** Joins a chapter onto the one before it. Returns the id of the chapter that now holds both. */
  async mergeChapterWithPrevious(id: string): Promise<string | null> {
    const chapter = await this.getChapter(id);
    if (!chapter) return null;
    const all = await this.getAllChapters(chapter.bookId);
    const index = all.findIndex((c) => c.id === id);
    if (index <= 0) return null;
    const drafts = mergeChapterIntoPrevious(all.map((c) => ({ title: c.title, blocks: c.blocks })), index);
    const ids = all.filter((_, i) => i !== index).map((c) => c.id);
    await this.db.batch(this.replaceChapters(chapter.bookId, drafts.map((d, i) => ({ ...d, id: ids[i] })), nowIso()));
    return ids[index - 1];
  }

  // ----- Version history ----------------------------------------------

  private async currentState(bookId: string): Promise<{ rows: Required<ChapterRow>[]; signature: string }> {
    const rows = await this.db.select<Required<ChapterRow>>(
      'SELECT id, book_id, position, title, word_count, updated_at, content, hash FROM chapters WHERE book_id = ? ORDER BY position',
      [bookId],
    );
    return { rows, signature: signatureOf(rows) };
  }

  /** True when the book's text differs from every saved version. */
  async hasUnsavedChanges(bookId: string): Promise<boolean> {
    const { signature } = await this.currentState(bookId);
    const match = await this.db.select('SELECT 1 AS found FROM versions WHERE book_id = ? AND signature = ? LIMIT 1', [bookId, signature]);
    return match.length === 0;
  }

  /**
   * Saves the book's current text as a version. Automatic and safety
   * snapshots are skipped (returning null) when an identical version exists.
   */
  async createSnapshot(bookId: string, name: string, kind: VersionKind, note = ''): Promise<Version | null> {
    if (kind === 'auto' || kind === 'safety') {
      // A cheap check first: this runs often and usually finds nothing new to save.
      const heads = await this.db.select<{ title: string; hash: string }>('SELECT title, hash FROM chapters WHERE book_id = ? ORDER BY position', [bookId]);
      const same = await this.db.select('SELECT 1 AS found FROM versions WHERE book_id = ? AND signature = ? LIMIT 1', [bookId, signatureOf(heads)]);
      if (same.length) return null;
    }
    const { rows, signature } = await this.currentState(bookId);
    const id = newId('v');
    const now = nowIso();
    const words = rows.reduce((n, r) => n + r.word_count, 0);
    const statements: SqlStatement[] = [];
    const stored = new Set<string>();
    for (const row of rows) {
      if (stored.has(row.hash)) continue;
      stored.add(row.hash);
      statements.push({ sql: 'INSERT OR IGNORE INTO blobs (hash, content) VALUES (?, ?)', params: [row.hash, row.content] });
    }
    statements.push({
      sql: 'INSERT INTO versions (id, book_id, name, kind, note, word_count, chapter_count, signature, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      params: [id, bookId, name.trim() || 'Snapshot', kind, note, words, rows.length, signature, now],
    });
    for (const row of rows) {
      statements.push({
        sql: 'INSERT INTO version_chapters (version_id, position, chapter_id, title, blob_hash, word_count) VALUES (?,?,?,?,?,?)',
        params: [id, row.position, row.id, row.title, row.hash, row.word_count],
      });
    }
    await this.db.batch(statements);
    if (kind === 'auto' || kind === 'safety') await this.pruneSnapshots(bookId);
    const created = await this.db.select<VersionRow>('SELECT * FROM versions WHERE id = ?', [id]);
    return toVersion(created[0]);
  }

  /** Versions, newest first. */
  async listVersions(bookId: string): Promise<Version[]> {
    const rows = await this.db.select<VersionRow>('SELECT * FROM versions WHERE book_id = ? ORDER BY created_at DESC, rowid DESC', [bookId]);
    return rows.map(toVersion);
  }

  async getVersionChapters(versionId: string): Promise<VersionChapter[]> {
    const rows = await this.db.select<{ position: number; title: string; word_count: number; content: string }>(
      `SELECT vc.position, vc.title, vc.word_count, b.content
       FROM version_chapters vc JOIN blobs b ON b.hash = vc.blob_hash
       WHERE vc.version_id = ? ORDER BY vc.position`,
      [versionId],
    );
    return rows.map((r) => ({ position: r.position, title: r.title, wordCount: r.word_count, blocks: JSON.parse(r.content) as Block[] }));
  }

  /**
   * Puts the book back to a saved version. The text as it was just before
   * the restore is saved first, so a restore can itself be undone.
   */
  async restoreVersion(bookId: string, versionId: string): Promise<void> {
    const version = (await this.db.select<VersionRow>('SELECT * FROM versions WHERE id = ? AND book_id = ?', [versionId, bookId]))[0];
    if (!version) throw new Error('This version no longer exists.');
    await this.createSnapshot(bookId, `Before restoring "${version.name}"`, 'safety');
    const rows = await this.db.select<{ chapter_id: string; title: string; content: string }>(
      `SELECT vc.chapter_id, vc.title, b.content FROM version_chapters vc JOIN blobs b ON b.hash = vc.blob_hash
       WHERE vc.version_id = ? ORDER BY vc.position`,
      [versionId],
    );
    const used = new Set<string>();
    const chapters = rows.map((r) => {
      // Reuse chapter ids so links to chapters stay valid, guarding against duplicates.
      const id = used.has(r.chapter_id) ? newId('ch') : r.chapter_id;
      used.add(id);
      return { id, title: r.title, blocks: JSON.parse(r.content) as Block[] };
    });
    await this.db.batch(this.replaceChapters(bookId, chapters, nowIso()));
  }

  async renameVersion(versionId: string, name: string): Promise<void> {
    await this.db.execute("UPDATE versions SET name = ? WHERE id = ? AND kind != 'original'", [name.trim() || 'Snapshot', versionId]);
  }

  async deleteVersion(versionId: string): Promise<void> {
    const rows = await this.db.select<{ kind: string }>('SELECT kind FROM versions WHERE id = ?', [versionId]);
    if (!rows[0]) return;
    if (rows[0].kind === 'original') throw new Error('The original manuscript is always kept and cannot be deleted.');
    await this.db.execute('DELETE FROM versions WHERE id = ?', [versionId]);
    await this.collectGarbage();
  }

  private async pruneSnapshots(bookId: string): Promise<void> {
    for (const [kind, keep] of [['auto', AUTO_SNAPSHOTS_TO_KEEP], ['safety', SAFETY_SNAPSHOTS_TO_KEEP]] as const) {
      await this.db.execute(
        `DELETE FROM versions WHERE book_id = ? AND kind = ? AND id NOT IN (
           SELECT id FROM versions WHERE book_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        [bookId, kind, bookId, kind, keep],
      );
    }
    await this.collectGarbage();
  }

  /** Removes stored chapter text that no version refers to any more. */
  private async collectGarbage(): Promise<void> {
    await this.db.execute('DELETE FROM blobs WHERE hash NOT IN (SELECT blob_hash FROM version_chapters)');
  }

  // ----- Settings and log ---------------------------------------------

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.db.select<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!rows[0]) return fallback;
    try {
      return JSON.parse(rows[0].value) as T;
    } catch {
      return fallback;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.execute(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
  }

  async addLog(level: 'info' | 'warn' | 'error', scope: string, message: string, detail?: string): Promise<void> {
    await this.db.batch([
      { sql: 'INSERT INTO logs (ts, level, scope, message, detail) VALUES (?,?,?,?,?)', params: [nowIso(), level, scope, message, detail ?? null] },
      { sql: 'DELETE FROM logs WHERE id <= (SELECT max(id) FROM logs) - 2000' },
    ]);
  }

  async listLogs(limit = 300): Promise<{ id: number; ts: string; level: string; scope: string; message: string; detail: string | null }[]> {
    return this.db.select('SELECT id, ts, level, scope, message, detail FROM logs ORDER BY id DESC LIMIT ?', [limit]);
  }

  async clearLogs(): Promise<void> {
    await this.db.execute('DELETE FROM logs');
  }
}
