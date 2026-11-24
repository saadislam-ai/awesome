/**
 * The library: one folder that holds everything belonging to the publisher.
 *
 *   Borderless Studio/            (default: inside Documents)
 *     library.json                which book folders belong to the library
 *     publisher.json              imprint, default author, currency, donation settings
 *     isbns.json                  the ISBN register
 *     specs/                      your edited copies of the platform spec files
 *     books/<book folder>/        new books are created here (books can live elsewhere too)
 *
 * All of it is plain JSON. The SQLite database in the app's data folder is
 * only an index over these files (for a fast book list and library search);
 * deleting it loses nothing.
 */
import type { Host } from '../host';
import { readJson, writeJson } from '../host';
import { emptyRegister, type IsbnRegister } from '../isbn';
import { BookSchema, primaryAuthor, textNodes, type Book } from '../model/book';
import { LAYOUT } from '../project/layout';
import { createBook, openBook, type NewBookOptions, type Project } from '../project/store';
import { bundledSpecsDir, loadSpecs, type SpecSet } from '../specs';
import { maskMarkdown } from '../markdown/mask';
import { joinPath, normPath } from '../util/paths';
import { countWords } from '../util/text';

export interface AppSettings {
  schema: 1;
  /** Folder of the library. Empty until the first start has chosen one. */
  libraryDir: string;
  theme: 'light' | 'dark' | 'sepia';
  editorFont: string;
  editorFontSizePx: number;
  editorWidthEm: number;
  typewriterScrolling: boolean;
  focusMode: boolean;
  spellcheck: boolean;
  autosaveSeconds: number;
  /** Tool locations set by hand (tool id to path). */
  toolPaths: Record<string, string>;
  /** Book opened last, to return to it on start. */
  lastBook: string;
  /** Backups of books as zip files. */
  backup: {
    /** Folder for the zip files. Empty means "backups" inside the library folder. */
    dir: string;
    /** Make a backup once a day when a book has changed. */
    auto: boolean;
    /** How many automatic backups to keep for each book. Backups made by hand are never removed. */
    keep: number;
  };
  /** Book folders in which the user has switched Git version history on. Git is never run anywhere else. */
  gitBooks: string[];
  /** Optional AI assistant. Off unless switched on here. */
  ai: {
    enabled: boolean;
    provider: 'ollama' | 'claude';
    ollamaUrl: string;
    ollamaModel: string;
    claudeModel: string;
    /**
     * No longer used: the key is kept in the operating system's keychain (see Host.secrets).
     * A key found here from an earlier version is moved there and this field is emptied.
     */
    claudeApiKey: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  schema: 1,
  libraryDir: '',
  theme: 'light',
  editorFont: 'EB Garamond',
  editorFontSizePx: 19,
  editorWidthEm: 34,
  typewriterScrolling: false,
  focusMode: false,
  spellcheck: true,
  autosaveSeconds: 1.5,
  toolPaths: {},
  lastBook: '',
  backup: { dir: '', auto: true, keep: 10 },
  gitBooks: [],
  ai: { enabled: false, provider: 'ollama', ollamaUrl: 'http://localhost:11434', ollamaModel: 'llama3.1', claudeModel: 'claude-opus-5-5', claudeApiKey: '' },
};

export interface PublisherProfile {
  schema: 1;
  imprint: string;
  city: string;
  country: string;
  website: string;
  defaultAuthor: string;
  authorBio: string;
  defaultLanguage: string;
  baseCurrency: string;
  /** IngramSpark wholesale discount you use, percent. */
  ingramDiscountPercent: number;
  donation: { enabled: boolean; charity: string; note: string };
}

export const DEFAULT_PUBLISHER: PublisherProfile = {
  schema: 1,
  imprint: 'Borderless Publishing',
  city: 'Sydney',
  country: 'Australia',
  website: '',
  defaultAuthor: 'Dr Saad Islam',
  authorBio: '',
  defaultLanguage: 'en-AU',
  baseCurrency: 'AUD',
  ingramDiscountPercent: 30,
  donation: { enabled: false, charity: '', note: '' },
};

export interface BookSummary {
  path: string;
  id: string;
  title: string;
  subtitle: string;
  author: string;
  genre: string;
  language: string;
  /** Series name and number as one line for display ("The Delta Books 2"). */
  series: string;
  /** Series name alone; empty for a standalone book. */
  seriesName: string;
  seriesNumber: number | null;
  formats: { id: string; type: string; label: string; enabled: boolean; isbn: string; trim: string; platforms: string[] }[];
  words: number;
  updatedAt: string;
  /** Set when the folder is missing or its book.json cannot be read. */
  problem?: string;
}

interface LibraryFile {
  schema: 1;
  books: { path: string; addedAt: string }[];
}

const SETTINGS_FILE = 'settings.json';

export async function loadSettings(host: Host): Promise<AppSettings> {
  const { userData } = await host.paths();
  const p = joinPath(userData, SETTINGS_FILE);
  if (!(await host.exists(p))) return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = await readJson<Partial<AppSettings>>(host, p);
    return { ...structuredClone(DEFAULT_SETTINGS), ...raw, ai: { ...DEFAULT_SETTINGS.ai, ...(raw.ai ?? {}) }, backup: { ...DEFAULT_SETTINGS.backup, ...(raw.backup ?? {}) }, gitBooks: Array.isArray(raw.gitBooks) ? raw.gitBooks : [] };
  } catch {
    // A damaged settings file must never stop the app from starting.
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(host: Host, settings: AppSettings): Promise<void> {
  const { userData } = await host.paths();
  await host.mkdirp(userData);
  await writeJson(host, joinPath(userData, SETTINGS_FILE), settings);
}

export class Library {
  private constructor(
    readonly host: Host,
    readonly dir: string,
    private file: LibraryFile,
  ) {}

  /** Open the library folder, creating it (and its files) when it does not exist yet. */
  static async open(host: Host, dir: string): Promise<Library> {
    const d = normPath(dir);
    await host.mkdirp(joinPath(d, 'books'));
    await host.mkdirp(joinPath(d, 'specs'));
    const libPath = joinPath(d, 'library.json');
    let file: LibraryFile = { schema: 1, books: [] };
    if (await host.exists(libPath)) {
      try {
        file = await readJson<LibraryFile>(host, libPath);
        if (!Array.isArray(file.books)) file = { schema: 1, books: [] };
      } catch {
        // Keep the damaged file for inspection and start a fresh list; book folders are untouched.
        await host.copy(libPath, joinPath(d, `library.damaged-${Date.now()}.json`));
      }
    }
    const lib = new Library(host, d, file);
    // Book folders that sit in books/ but are not listed (copied in by hand) are picked up.
    for (const e of await host.list(joinPath(d, 'books'))) {
      const p = joinPath(d, 'books', e.name);
      if (e.isDir && (await host.exists(joinPath(p, LAYOUT.book))) && !file.books.some((b) => normPath(b.path) === p)) {
        file.books.push({ path: p, addedAt: new Date().toISOString() });
      }
    }
    await lib.save();
    if (!(await host.exists(joinPath(d, 'publisher.json')))) await writeJson(host, joinPath(d, 'publisher.json'), DEFAULT_PUBLISHER);
    if (!(await host.exists(joinPath(d, 'isbns.json')))) await writeJson(host, joinPath(d, 'isbns.json'), emptyRegister());
    return lib;
  }

  private async save(): Promise<void> {
    await writeJson(this.host, joinPath(this.dir, 'library.json'), this.file);
  }

  /** Where backups go when the settings do not name another folder. */
  get backupsDir(): string {
    return joinPath(this.dir, 'backups');
  }

  get booksDir(): string {
    return joinPath(this.dir, 'books');
  }

  get specsDir(): string {
    return joinPath(this.dir, 'specs');
  }

  bookPaths(): string[] {
    return this.file.books.map((b) => normPath(b.path));
  }

  async publisher(): Promise<PublisherProfile> {
    const raw: Partial<PublisherProfile> = await readJson<Partial<PublisherProfile>>(this.host, joinPath(this.dir, 'publisher.json')).catch(() => ({}));
    return { ...structuredClone(DEFAULT_PUBLISHER), ...raw, donation: { ...DEFAULT_PUBLISHER.donation, ...(raw.donation ?? {}) } };
  }

  async savePublisher(p: PublisherProfile): Promise<void> {
    await writeJson(this.host, joinPath(this.dir, 'publisher.json'), p);
  }

  async isbnRegister(): Promise<IsbnRegister> {
    const raw: Partial<IsbnRegister> = await readJson<Partial<IsbnRegister>>(this.host, joinPath(this.dir, 'isbns.json')).catch(() => ({}));
    return { ...emptyRegister(), ...raw, prefixes: raw.prefixes ?? [], records: raw.records ?? [] };
  }

  async saveIsbnRegister(reg: IsbnRegister): Promise<void> {
    await writeJson(this.host, joinPath(this.dir, 'isbns.json'), reg);
  }

  async specs(): Promise<SpecSet> {
    const { resources } = await this.host.paths();
    return loadSpecs(this.host, bundledSpecsDir(resources), this.specsDir);
  }

  /** Create a new book inside the library and list it. */
  async createBook(opts: Omit<NewBookOptions, 'parentDir'> & { parentDir?: string }): Promise<Project> {
    const project = await createBook(this.host, { ...opts, parentDir: opts.parentDir ?? this.booksDir });
    await this.addBook(project.dir);
    return project;
  }

  /** Add an existing book folder to the library list (the folder is not moved). */
  async addBook(path: string): Promise<void> {
    const p = normPath(path);
    if (!(await this.host.exists(joinPath(p, LAYOUT.book)))) {
      throw new Error(`"${p}" is not a Borderless Studio book folder (no book.json found).`);
    }
    if (!this.file.books.some((b) => normPath(b.path) === p)) {
      this.file.books.push({ path: p, addedAt: new Date().toISOString() });
      await this.save();
    }
  }

  /** Take a book off the list. The folder and everything in it stays on disk. */
  async forgetBook(path: string): Promise<void> {
    const p = normPath(path);
    this.file.books = this.file.books.filter((b) => normPath(b.path) !== p);
    await this.save();
    await this.host.db?.exec('DELETE FROM books WHERE path = ?', [p]).catch(() => undefined);
  }

  async openBook(path: string): Promise<Project> {
    return openBook(this.host, normPath(path));
  }

  /* ---------------------------------------------------------------- */
  /* Summaries and the index                                           */
  /* ---------------------------------------------------------------- */

  private async ensureIndex(): Promise<boolean> {
    if (!this.host.db) return false;
    try {
      await this.host.db.exec(
        'CREATE TABLE IF NOT EXISTS books (path TEXT PRIMARY KEY, id TEXT, title TEXT, summary TEXT, mtime REAL, indexed_at TEXT)',
      );
      await this.host.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(book_path UNINDEXED, node_id UNINDEXED, title, body)');
      return true;
    } catch {
      return false;
    }
  }

  private summarise(path: string, book: Book, words: number): BookSummary {
    return {
      path,
      id: book.id,
      title: book.title,
      subtitle: book.subtitle,
      author: primaryAuthor(book),
      genre: book.genre,
      language: book.language,
      series: book.series ? `${book.series.name}${book.series.number !== null ? ' ' + book.series.number : ''}` : '',
      seriesName: book.series?.name ?? '',
      seriesNumber: book.series?.number ?? null,
      formats: book.formats.map((f) => ({ id: f.id, type: f.type, label: f.label || f.id, enabled: f.enabled, isbn: f.isbn, trim: f.trim, platforms: f.platforms })),
      words,
      updatedAt: book.updatedAt,
    };
  }

  /**
   * Book list for the library screen. Summaries come from the index when the
   * book.json file has not changed since it was indexed, so a large library
   * opens at once; everything else is read from the folders.
   */
  async listBooks(): Promise<BookSummary[]> {
    const indexed = await this.ensureIndex();
    const out: BookSummary[] = [];
    for (const path of this.bookPaths()) {
      const bookFile = joinPath(path, LAYOUT.book);
      const stat = await this.host.stat(bookFile);
      if (!stat) {
        out.push({ path, id: '', title: path.split('/').pop() ?? path, subtitle: '', author: '', genre: '', language: '', series: '', seriesName: '', seriesNumber: null, formats: [], words: 0, updatedAt: '', problem: 'The folder was not found. It may have been moved or the drive is not connected.' });
        continue;
      }
      if (indexed) {
        const rows = await this.host.db!.query<{ summary: string; mtime: number }>('SELECT summary, mtime FROM books WHERE path = ?', [path]).catch(() => []);
        if (rows[0] && Math.abs(rows[0].mtime - stat.mtimeMs) < 1) {
          try {
            const cached = JSON.parse(rows[0].summary) as BookSummary;
            // A summary stored by an older version lacks newer fields: it is rebuilt below.
            if (cached.seriesName !== undefined) {
              out.push(cached);
              continue;
            }
          } catch {
            /* fall through and rebuild */
          }
        }
      }
      try {
        const book = BookSchema.parse(await readJson(this.host, bookFile));
        const words = await this.countWords(path);
        const summary = this.summarise(path, book, words);
        out.push(summary);
        if (indexed) {
          await this.host
            .db!.exec('INSERT OR REPLACE INTO books (path, id, title, summary, mtime, indexed_at) VALUES (?, ?, ?, ?, ?, ?)', [
              path, book.id, book.title, JSON.stringify(summary), stat.mtimeMs, new Date().toISOString(),
            ])
            .catch(() => undefined);
        }
      } catch (e) {
        out.push({ path, id: '', title: path.split('/').pop() ?? path, subtitle: '', author: '', genre: '', language: '', series: '', seriesName: '', seriesNumber: null, formats: [], words: 0, updatedAt: '', problem: `book.json could not be read: ${(e as Error).message}` });
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  private async countWords(path: string): Promise<number> {
    try {
      const project = await openBook(this.host, path);
      return await project.manuscriptWords();
    } catch {
      return 0;
    }
  }

  /** Refresh the index entry of a book after it was edited (summary and searchable text). */
  async reindexBook(project: Project): Promise<void> {
    if (!(await this.ensureIndex())) return;
    const db = this.host.db!;
    const path = normPath(project.dir);
    try {
      const stat = await this.host.stat(joinPath(path, LAYOUT.book));
      const words = await project.manuscriptWords();
      await db.exec('INSERT OR REPLACE INTO books (path, id, title, summary, mtime, indexed_at) VALUES (?, ?, ?, ?, ?, ?)', [
        path, project.book.id, project.book.title, JSON.stringify(this.summarise(path, project.book, words)), stat?.mtimeMs ?? 0, new Date().toISOString(),
      ]);
      await db.exec('DELETE FROM docs WHERE book_path = ?', [path]);
      for (const node of textNodes(project.binder)) {
        const text = maskMarkdown(await project.readDoc(node.id));
        if (countWords(text) === 0) continue;
        await db.exec('INSERT INTO docs (book_path, node_id, title, body) VALUES (?, ?, ?, ?)', [path, node.id, node.title, text]);
      }
    } catch {
      /* the index is a convenience; a failure here must never affect the book */
    }
  }

  /** Search the text of every indexed book. Returns the best matches with a short excerpt. */
  async search(query: string, limit = 50): Promise<{ bookPath: string; nodeId: string; title: string; excerpt: string }[]> {
    if (!query.trim() || !(await this.ensureIndex())) return [];
    const terms = query.match(/[\p{L}\p{N}]+/gu);
    if (!terms) return [];
    const match = terms.map((t) => `"${t}"`).join(' ');
    return this.host
      .db!.query<{ bookPath: string; nodeId: string; title: string; excerpt: string }>(
        "SELECT book_path AS bookPath, node_id AS nodeId, title, snippet(docs, 3, '[', ']', ' ... ', 14) AS excerpt FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?",
        [match, limit],
      )
      .catch(() => []);
  }
}

/** Default library location for a first start. */
export async function defaultLibraryDir(host: Host): Promise<string> {
  const { documents } = await host.paths();
  return joinPath(documents, 'Borderless Studio');
}
