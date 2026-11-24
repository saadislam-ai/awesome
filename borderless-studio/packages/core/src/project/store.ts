/**
 * The project store: creating, opening and saving a book folder.
 *
 * Safety rules that protect the author's writing:
 *   1. Every save is atomic (the Host writes to a temporary file and renames).
 *   2. Before a document is overwritten, its previous version is copied to
 *      snapshots/ if the last snapshot is older than a few minutes, or if the
 *      new version is much shorter (a guard against accidental mass deletion).
 *   3. Nothing is ever deleted outright: removed documents go to
 *      manuscript/.trash with a timestamp.
 *   4. A document is never written if the text has not changed, and an empty
 *      string never replaces a non empty document without a snapshot.
 */
import { applyLanguageDefaults } from '../i18n/design';
import type { Host } from '../host';
import { readJson, writeJson } from '../host';
import {
  BibleSchema, BinderSchema, BookSchema, WritingLogSchema,
  type Bible, type Binder, type BinderNode, type Book, type BookFormat, type Genre, type PlatformId, type WritingLog,
  findNode, findParent, textNodes, walkBinder,
} from '../model/book';
import { designFromTemplate } from '../model/design';
import { prefixedId, shortId } from '../util/ids';
import { basename, joinPath, slugify } from '../util/paths';
import { countWords, fileStamp, fileStampMs, isoDate } from '../util/text';
import { maskMarkdown } from '../markdown/mask';
import { LAYOUT, PROJECT_README } from './layout';
import { GENRE_TEMPLATES, genreStructure, instantiate, type NewNodeSpec } from './templates';

export interface NewBookOptions {
  /** Folder that will contain the new book folder. */
  parentDir: string;
  /** Name of the new folder (default: made from the title). */
  folderName?: string;
  title: string;
  subtitle?: string;
  author: string;
  genre: Genre;
  language?: string;
  imprint?: string;
  /** Which formats to set up, with trim, paper and platforms. */
  formats?: Partial<BookFormat>[];
  platforms?: PlatformId[];
  trim?: string;
  paper?: 'white' | 'cream';
}

export interface SnapshotInfo {
  /** File name inside snapshots/docs/<nodeId>/. */
  name: string;
  path: string;
  /** ISO like timestamp parsed from the name. */
  stamp: string;
  label: string;
  size: number;
}

export interface SnapshotPolicy {
  /** Minimum minutes between automatic snapshots of the same document. */
  intervalMinutes: number;
  /** Take a snapshot regardless of the interval when this share of the text disappears. */
  bigDeletionShare: number;
  bigDeletionChars: number;
}

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = { intervalMinutes: 10, bigDeletionShare: 0.2, bigDeletionChars: 400 };

const makeFileName = (title: string, id: string) => `${slugify(title || 'untitled', 40)}-${id.replace(/^[a-z]+_/, '')}.md`;

export function sortName(name: string): string {
  const clean = name.replace(/^(dr|prof|mr|mrs|ms|mx)\.?\s+/i, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return clean;
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
}

/** Default formats for a new book: paperback, hardcover and ebook, each waiting for its own ISBN. */
export function defaultFormats(trim: string, paper: 'white' | 'cream', platforms: PlatformId[]): BookFormat[] {
  const print = platforms.filter((p) => p === 'kdp' || p === 'ingramspark');
  const base = { isbn: '', enabled: true, paper, ink: 'bw' as const, bleed: false, coverFinish: 'matte' as const };
  const fmt = (f: Partial<BookFormat> & Pick<BookFormat, 'id' | 'type' | 'label'>): BookFormat =>
    ({
      ...base,
      trim,
      binding: 'case-laminate',
      largePrint: false,
      platforms: [],
      platformOptions: {},
      ebook: { embedFonts: false, dropCaps: true, sceneBreakImage: false, inlineToc: true },
      ...f,
    }) as BookFormat;
  return [
    fmt({ id: 'paperback', type: 'paperback', label: 'Paperback', platforms: print }),
    fmt({ id: 'hardcover', type: 'hardcover', label: 'Hardcover', platforms: print, enabled: false }),
    fmt({ id: 'ebook', type: 'ebook', label: 'Ebook', platforms: platforms.length ? platforms : ['kdp'] }),
  ];
}

/** Create a new book folder on disk and return the opened project. */
export async function createBook(host: Host, opts: NewBookOptions): Promise<Project> {
  const tpl = GENRE_TEMPLATES[opts.genre];
  const now = new Date();
  const folder = opts.folderName ? slugify(opts.folderName, 60) : slugify(opts.title, 60);
  let dir = joinPath(opts.parentDir, folder);
  // Never write into an existing folder.
  let n = 2;
  while (await host.exists(dir)) dir = joinPath(opts.parentDir, `${folder}-${n++}`);

  const platforms = opts.platforms ?? ['kdp', 'ingramspark', 'draft2digital'];
  const book: Book = BookSchema.parse({
    id: prefixedId('bk', 8),
    title: opts.title,
    subtitle: opts.subtitle ?? '',
    contributors: [{ role: 'author', name: opts.author, sortName: sortName(opts.author) }],
    language: opts.language ?? 'en-AU',
    genre: opts.genre,
    imprint: opts.imprint ?? 'Borderless Publishing',
    copyright: { year: now.getFullYear(), holder: opts.author.replace(/^(dr|prof)\.?\s+/i, '') },
    design: designFromTemplate(tpl.design),
    formats: defaultFormats(opts.trim ?? tpl.trim, opts.paper ?? tpl.paper, platforms),
    history: [{ date: isoDate(now), edition: 1, formatId: '', change: 'Book created.' }],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  applyLanguageDefaults(book);
  if (opts.formats) {
    book.formats = book.formats.map((f) => ({ ...f, ...(opts.formats!.find((o) => o.id === f.id) ?? {}) }));
  }

  const files: { file: string; text: string }[] = [];
  const structure = genreStructure(opts.genre);
  const group = (role: 'front' | 'body' | 'back', title: string, specs: NewNodeSpec[]): BinderNode => ({
    id: `root_${role}`,
    type: 'group',
    role,
    kind: 'generic',
    title,
    include: true,
    children: specs.map((s) => instantiate(s, makeFileName, files)),
  });
  const binder: Binder = {
    schema: 1,
    roots: [
      group('front', 'Front matter', structure.front),
      group('body', 'Manuscript', structure.body),
      group('back', 'Back matter', structure.back),
    ],
  };

  for (const d of [
    LAYOUT.manuscriptDir, LAYOUT.bibleDir, LAYOUT.imagesDir, LAYOUT.coverArtDir, LAYOUT.metadataDir,
    LAYOUT.statsDir, LAYOUT.docSnapshotsDir, LAYOUT.exportsDir,
  ]) {
    await host.mkdirp(joinPath(dir, d));
  }
  for (const f of files) await host.writeText(joinPath(dir, LAYOUT.manuscriptDir, f.file), f.text);
  await writeJson(host, joinPath(dir, LAYOUT.book), book);
  await writeJson(host, joinPath(dir, LAYOUT.binder), binder);
  await writeJson(host, joinPath(dir, LAYOUT.bible), BibleSchema.parse({}));
  await writeJson(host, joinPath(dir, LAYOUT.writingLog), WritingLogSchema.parse({}));
  await host.writeText(joinPath(dir, LAYOUT.readme), PROJECT_README);
  await host.writeText(joinPath(dir, '.gitignore'), '.borderless/\nexports/\n');
  return openBook(host, dir);
}

/** Open an existing book folder. Throws a readable error when a file is damaged. */
export async function openBook(host: Host, dir: string): Promise<Project> {
  const bookPath = joinPath(dir, LAYOUT.book);
  if (!(await host.exists(bookPath))) {
    throw new Error(`"${dir}" is not a Borderless Studio book folder (no book.json found).`);
  }
  const parse = <T>(schema: { parse(v: unknown): T }, value: unknown, file: string): T => {
    try {
      return schema.parse(value);
    } catch (e) {
      throw new Error(`The file ${file} has a problem and could not be read: ${(e as Error).message}`);
    }
  };
  const book = parse(BookSchema, await readJson(host, bookPath), LAYOUT.book);
  const binderPath = joinPath(dir, LAYOUT.binder);
  const binder = parse(BinderSchema, await readJson(host, binderPath), LAYOUT.binder);
  const biblePath = joinPath(dir, LAYOUT.bible);
  const bible = (await host.exists(biblePath))
    ? parse(BibleSchema, await readJson(host, biblePath), LAYOUT.bible)
    : BibleSchema.parse({});
  return new Project(host, dir, book, binder, bible);
}

export class Project {
  /** Text of each document as it currently is on disk (after the last successful save). */
  private saved = new Map<string, string>();
  private lastSnapshotAt = new Map<string, number>();
  /** One save at a time per file, in order. */
  private queues = new Map<string, Promise<unknown>>();
  snapshotPolicy: SnapshotPolicy = { ...DEFAULT_SNAPSHOT_POLICY };

  constructor(
    readonly host: Host,
    readonly dir: string,
    public book: Book,
    public binder: Binder,
    public bible: Bible,
  ) {}

  path(...rel: string[]): string {
    return joinPath(this.dir, ...rel);
  }

  docPath(node: BinderNode): string {
    if (!node.file) throw new Error(`"${node.title}" has no text file.`);
    return this.path(LAYOUT.manuscriptDir, node.file);
  }

  private enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    this.queues.set(key, next.catch(() => undefined));
    return next;
  }

  /* ---------------------------------------------------------------- */
  /* book.json, binder, bible                                          */
  /* ---------------------------------------------------------------- */

  async saveBook(): Promise<void> {
    this.book.updatedAt = new Date().toISOString();
    await this.enqueue(LAYOUT.book, () => writeJson(this.host, this.path(LAYOUT.book), this.book));
  }

  async saveBinder(): Promise<void> {
    await this.enqueue(LAYOUT.binder, () => writeJson(this.host, this.path(LAYOUT.binder), this.binder));
  }

  async saveBible(): Promise<void> {
    await this.host.mkdirp(this.path(LAYOUT.bibleDir));
    await this.enqueue(LAYOUT.bible, () => writeJson(this.host, this.path(LAYOUT.bible), this.bible));
  }

  /** Add a line to the edition history (the per book changelog). */
  async addHistory(change: string, formatId = ''): Promise<void> {
    this.book.history.push({ date: isoDate(), edition: this.book.editionNumber, formatId, change });
    await this.saveBook();
  }

  /** Read any JSON file of the project (listing, pricing, cover ...) with a fallback when it does not exist yet. */
  async readData<T>(rel: string, fallback: T): Promise<T> {
    const p = this.path(rel);
    if (!(await this.host.exists(p))) return fallback;
    return readJson<T>(this.host, p);
  }

  async writeData(rel: string, value: unknown): Promise<void> {
    const p = this.path(rel);
    await this.host.mkdirp(p.slice(0, p.lastIndexOf('/')));
    await this.enqueue(rel, () => writeJson(this.host, p, value));
  }

  /* ---------------------------------------------------------------- */
  /* Documents                                                         */
  /* ---------------------------------------------------------------- */

  node(id: string): BinderNode {
    const n = findNode(this.binder, id);
    if (!n) throw new Error(`There is no document with the id "${id}" in this book.`);
    return n;
  }

  async readDoc(nodeId: string): Promise<string> {
    const node = this.node(nodeId);
    if (!node.file) return '';
    const p = this.docPath(node);
    const text = (await this.host.exists(p)) ? (await this.host.readText(p)).replace(/\r\n?/g, '\n') : '';
    this.saved.set(node.file, text);
    return text;
  }

  /**
   * Save a document. Returns true when something was written. The previous
   * version is snapshotted first when the policy says so.
   */
  async writeDoc(nodeId: string, text: string, opts: { snapshotLabel?: string } = {}): Promise<boolean> {
    const node = this.node(nodeId);
    if (!node.file) throw new Error(`"${node.title}" is generated from metadata and has no text file.`);
    const file = node.file;
    return this.enqueue(file, async () => {
      const p = this.docPath(node);
      let before = this.saved.get(file);
      if (before === undefined) {
        before = (await this.host.exists(p)) ? (await this.host.readText(p)).replace(/\r\n?/g, '\n') : '';
      }
      if (before === text && !opts.snapshotLabel) return false;
      if (before !== '' && before !== text) {
        const last = this.lastSnapshotAt.get(file) ?? 0;
        const due = Date.now() - last > this.snapshotPolicy.intervalMinutes * 60_000;
        const removed = before.length - text.length;
        const bigDeletion =
          removed > this.snapshotPolicy.bigDeletionChars && removed > before.length * this.snapshotPolicy.bigDeletionShare;
        if (due || bigDeletion || opts.snapshotLabel) {
          await this.writeSnapshot(node, before, opts.snapshotLabel ?? (bigDeletion && !due ? 'before large deletion' : ''));
        }
      }
      await this.host.mkdirp(this.path(LAYOUT.manuscriptDir));
      await this.host.writeText(p, text);
      this.saved.set(file, text);
      return true;
    });
  }

  private async writeSnapshot(node: BinderNode, text: string, label: string): Promise<string> {
    const dir = this.path(LAYOUT.docSnapshotsDir, node.id);
    await this.host.mkdirp(dir);
    // Millisecond stamps keep snapshots in order; the counter guarantees that one
    // snapshot can never overwrite another, even when two are taken at once.
    const suffix = label ? '--' + slugify(label, 40) : '';
    let stamp = fileStampMs();
    let p = joinPath(dir, `${stamp}${suffix}.md`);
    for (let n = 1; await this.host.exists(p); n++) {
      stamp = fileStampMs(new Date(Date.now() + n));
      p = joinPath(dir, `${stamp}${suffix}.md`);
    }
    await this.host.writeText(p, text);
    if (node.file) this.lastSnapshotAt.set(node.file, Date.now());
    return p;
  }

  /** Take a named snapshot of the current saved text of a document. */
  async snapshotDoc(nodeId: string, label: string): Promise<string> {
    const node = this.node(nodeId);
    const text = await this.readDoc(nodeId);
    return this.writeSnapshot(node, text, label || 'manual');
  }

  async listSnapshots(nodeId: string): Promise<SnapshotInfo[]> {
    const dir = this.path(LAYOUT.docSnapshotsDir, nodeId);
    if (!(await this.host.exists(dir))) return [];
    const entries = await this.host.list(dir);
    return entries
      .filter((e) => e.isFile && e.name.endsWith('.md'))
      .map((e) => {
        const stem = e.name.slice(0, -3);
        const [stamp, ...rest] = stem.split('--');
        return { name: e.name, path: joinPath(dir, e.name), stamp, label: rest.join('--').replace(/-/g, ' '), size: e.size };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  async readSnapshot(nodeId: string, name: string): Promise<string> {
    return this.host.readText(this.path(LAYOUT.docSnapshotsDir, nodeId, basename(name)));
  }

  /** Put an old version back. The current text is snapshotted first, so a restore can itself be undone. */
  async restoreSnapshot(nodeId: string, name: string): Promise<string> {
    const text = await this.readSnapshot(nodeId, name);
    await this.writeDoc(nodeId, text, { snapshotLabel: 'before restore' });
    return text;
  }

  /**
   * Thin out old automatic snapshots: keep everything from the last day, one
   * per hour for a week, one per day for three months, then one per week.
   * Labelled snapshots are never removed.
   */
  async pruneSnapshots(nodeId: string, now: Date = new Date()): Promise<number> {
    const snaps = await this.listSnapshots(nodeId);
    const keep = new Set<string>();
    const buckets = new Set<string>();
    for (const s of snaps) {
      if (s.label) {
        keep.add(s.name);
        continue;
      }
      const t = Date.parse(s.stamp.slice(0, 19).replace('_', 'T').replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3') + 'Z');
      if (Number.isNaN(t)) {
        keep.add(s.name);
        continue;
      }
      const ageH = (now.getTime() - t) / 3_600_000;
      let bucket: string;
      if (ageH <= 24) bucket = s.name;
      else if (ageH <= 24 * 7) bucket = 'h' + s.stamp.slice(0, 13);
      else if (ageH <= 24 * 90) bucket = 'd' + s.stamp.slice(0, 10);
      else bucket = 'w' + Math.floor(t / (7 * 24 * 3_600_000));
      if (!buckets.has(bucket)) {
        buckets.add(bucket);
        keep.add(s.name);
      }
    }
    let removed = 0;
    for (const s of snaps) {
      if (!keep.has(s.name)) {
        await this.host.remove(s.path);
        removed++;
      }
    }
    return removed;
  }

  /** Text of every document, keyed by binder node id. */
  async readAllDocs(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const node of textNodes(this.binder)) out.set(node.id, await this.readDoc(node.id));
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Binder operations                                                 */
  /* ---------------------------------------------------------------- */

  /** Add a node under `parentId` at `index` (end when omitted). Creates its text file when needed. */
  async addNode(parentId: string, spec: NewNodeSpec, index?: number): Promise<BinderNode> {
    const parent = this.node(parentId);
    if (parent.type === 'doc') throw new Error('A document cannot contain other items.');
    const files: { file: string; text: string }[] = [];
    const node = instantiate(spec, makeFileName, files);
    for (const f of files) await this.host.writeText(this.path(LAYOUT.manuscriptDir, f.file), f.text);
    parent.children = parent.children ?? [];
    parent.children.splice(index ?? parent.children.length, 0, node);
    await this.saveBinder();
    return node;
  }

  /** Move a node to a new parent and position. Returns false when the move is not allowed. */
  async moveNode(id: string, newParentId: string, index: number): Promise<boolean> {
    const node = this.node(id);
    const oldParent = findParent(this.binder, id);
    const newParent = this.node(newParentId);
    if (!oldParent || node.type === 'group' || newParent.type === 'doc') return false;
    // A node cannot be moved into itself or its own children.
    let inside = false;
    walkBinder([node], (n) => {
      if (n.id === newParentId) inside = true;
    });
    if (inside) return false;
    // Parts only live at the top of the body; chapters cannot hold chapters or parts.
    if (node.type === 'part' && newParent.type !== 'group') return false;
    if (node.type === 'chapter' && newParent.type === 'chapter') return false;
    const from = oldParent.children!.indexOf(node);
    oldParent.children!.splice(from, 1);
    newParent.children = newParent.children ?? [];
    let to = index;
    if (oldParent === newParent && from < index) to = index - 1;
    newParent.children.splice(Math.max(0, Math.min(to, newParent.children.length)), 0, node);
    await this.saveBinder();
    return true;
  }

  async updateNode(id: string, patch: Partial<BinderNode>): Promise<BinderNode> {
    const node = this.node(id);
    const { id: _id, children: _children, type: _type, ...rest } = patch;
    Object.assign(node, rest);
    await this.saveBinder();
    return node;
  }

  /** Remove a node. Its text files move to manuscript/.trash; nothing is destroyed. */
  async removeNode(id: string): Promise<void> {
    const node = this.node(id);
    const parent = findParent(this.binder, id);
    if (!parent || node.type === 'group') throw new Error('This item cannot be removed.');
    const stamp = fileStamp();
    const withFiles: BinderNode[] = [];
    walkBinder([node], (n) => {
      if (n.file) withFiles.push(n);
    });
    if (withFiles.length) await this.host.mkdirp(this.path(LAYOUT.trashDir));
    for (const n of withFiles) {
      const from = this.docPath(n);
      if (await this.host.exists(from)) {
        await this.host.rename(from, this.path(LAYOUT.trashDir, `${stamp}--${n.file}`));
      }
      this.saved.delete(n.file!);
    }
    // Keep the removed binder entry too, so the item can be put back by hand.
    await this.host.writeText(
      this.path(LAYOUT.trashDir, `${stamp}--${slugify(node.title || node.kind)}-${shortId(4)}.binder.json`),
      JSON.stringify(node, null, 2) + '\n',
    );
    parent.children = (parent.children ?? []).filter((c) => c !== node);
    await this.saveBinder();
  }

  /** Give a generated section an editable text file (or the other way round). */
  async setGenerated(id: string, generated: boolean, starterText = ''): Promise<BinderNode> {
    const node = this.node(id);
    if (!generated && !node.file) {
      node.file = makeFileName(node.title, node.id);
      await this.host.writeText(this.docPath(node), starterText);
    }
    node.generated = generated;
    await this.saveBinder();
    return node;
  }

  /* ---------------------------------------------------------------- */
  /* Word counts and the writing log                                   */
  /* ---------------------------------------------------------------- */

  /** Words per document (markup and comments are not counted). */
  async wordCounts(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const [id, text] of await this.readAllDocs()) out.set(id, countWords(maskMarkdown(text)));
    return out;
  }

  /** Manuscript total: only the body, and only documents included in exports. */
  async manuscriptWords(): Promise<number> {
    const counts = await this.wordCounts();
    let total = 0;
    const body = this.binder.roots.find((r) => r.role === 'body');
    if (!body) return 0;
    walkBinder([body], (n) => {
      if (n.include === false) return false;
      if (n.file) total += counts.get(n.id) ?? 0;
    });
    return total;
  }

  async readWritingLog(): Promise<WritingLog> {
    return WritingLogSchema.parse(await this.readData(LAYOUT.writingLog, { schema: 1, days: [] }));
  }

  /**
   * Record progress for today. `total` is the manuscript word count now;
   * the day's net words are the difference to the previous day's total.
   */
  async logWriting(total: number, minutes = 0, newSession = false, today: string = isoDate()): Promise<WritingLog> {
    const log = await this.readWritingLog();
    const days = log.days;
    let day = days.find((d) => d.date === today);
    const prev = [...days].filter((d) => d.date < today).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const baseline = prev ? prev.total : days.length === 0 ? total : (day?.total ?? total) - (day?.words ?? 0);
    if (!day) {
      day = { date: today, words: 0, total, minutes: 0, sessions: 0 };
      days.push(day);
    }
    day.total = total;
    day.words = total - baseline;
    day.minutes = Math.round((day.minutes + minutes) * 10) / 10;
    if (newSession) day.sessions += 1;
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    await this.writeData(LAYOUT.writingLog, log);
    return log;
  }
}

/** Current streak: consecutive days, ending today or yesterday, on which the daily goal was met. */
export function writingStreak(log: WritingLog, dailyGoal: number, today: string = isoDate()): number {
  const met = new Set(log.days.filter((d) => d.words >= Math.max(1, dailyGoal)).map((d) => d.date));
  const day = new Date(today + 'T12:00:00');
  if (!met.has(isoDate(day))) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (met.has(isoDate(day))) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return streak;
}
