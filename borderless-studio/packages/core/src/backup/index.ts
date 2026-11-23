/**
 * Backups and version history for a book folder.
 *
 * A backup is one zip file of the whole book folder: manuscript, pictures,
 * cover, settings and snapshots. Files the app can build again are left out
 * (exported files are included only when asked for). A backup can be opened
 * with any unzip program. Restoring always unpacks into a new folder next to
 * the others; it never writes over a book.
 *
 * Git is optional. When Git is installed, a book folder can be given a
 * version history: every "version" is an ordinary commit that any Git tool
 * can read. The app only runs Git in folders you have switched it on for,
 * because settings stored inside a Git folder can start other programs.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Host } from '../host';
import type { Project } from '../project/store';
import { basename, dirname, joinPath, normPath, slugify } from '../util/paths';

export interface BackupInfo {
  name: string;
  path: string;
  sizeBytes: number;
  /** When the backup was made (ISO date and time). */
  createdAt: string;
  /** The note typed when the backup was made, if any. */
  label: string;
  /** Made by the daily automatic backup. Only these are ever removed automatically. */
  automatic: boolean;
}

export interface BackupOptions {
  /** Folder the zip file goes into. */
  destDir: string;
  label?: string;
  automatic?: boolean;
  /** Also pack the exports folder (finished PDF and EPUB files). */
  includeExports?: boolean;
  now?: Date;
}

/** Never part of a backup: build files the app makes again, and Git's own data. */
const SKIP_DIRS = new Set(['.borderless', '.git', 'node_modules']);
/** Files that are compressed already; packing them again only costs time. */
const STORED = /\.(jpe?g|png|gif|webp|zip|epub|pdf|docx|mp3|m4a|woff2?)$/i;

const two = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;

/** The part of a backup's file name that says which book it belongs to. */
export function backupSlug(project: Project): string {
  return slugify(basename(project.dir), 60) || 'book';
}

/** Read date, kind and note back from a backup's file name. */
export function parseBackupName(name: string): { slug: string; createdAt: string; automatic: boolean; label: string } | null {
  const m = /^(.+)_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(_auto)?(?:_(.+))?\.zip$/i.exec(name);
  if (!m) return null;
  const date = new Date(Number(m[2]), Number(m[3]) - 1, Number(m[4]), Number(m[5]), Number(m[6]), Number(m[7]));
  if (Number.isNaN(date.getTime())) return null;
  return { slug: m[1], createdAt: date.toISOString(), automatic: Boolean(m[8]), label: (m[9] ?? '').replace(/-/g, ' ') };
}

async function collect(host: Host, dir: string, rel: string, includeExports: boolean, out: { rel: string; abs: string; mtimeMs: number }[]): Promise<void> {
  for (const entry of await host.list(dir)) {
    const abs = joinPath(dir, entry.name);
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDir) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (!rel && entry.name === 'exports' && !includeExports) continue;
      await collect(host, abs, path, includeExports, out);
    } else if (entry.isFile) {
      out.push({ rel: path, abs, mtimeMs: entry.mtimeMs });
    }
  }
}

/** Pack the book folder into one zip file in the backup folder. */
export async function createBackup(project: Project, opts: BackupOptions): Promise<BackupInfo> {
  const host = project.host;
  const now = opts.now ?? new Date();
  const files: { rel: string; abs: string; mtimeMs: number }[] = [];
  await collect(host, project.dir, '', opts.includeExports ?? false, files);
  const top = basename(project.dir);
  const zip: Zippable = {};
  for (const f of files) {
    const data = await host.readBinary(f.abs);
    // Zip cannot store dates before 1980; a missing date falls back to now.
    const mtime = f.mtimeMs > 315_619_200_000 ? new Date(f.mtimeMs) : now;
    zip[`${top}/${f.rel}`] = [data, { level: STORED.test(f.rel) ? 0 : 6, mtime }];
  }
  const label = (opts.label ?? '').trim();
  const note = { app: 'Borderless Studio', schema: 1, title: project.book.title, folder: top, createdAt: now.toISOString(), label, automatic: Boolean(opts.automatic), files: files.length, includesExports: Boolean(opts.includeExports) };
  zip[`${top}/backup.json`] = [strToU8(JSON.stringify(note, null, 2) + '\n'), { level: 6, mtime: now }];
  const bytes = zipSync(zip);

  await host.mkdirp(opts.destDir);
  const labelSlug = label ? slugify(label, 40) : '';
  const base = `${backupSlug(project)}_${stamp(now)}${opts.automatic ? '_auto' : ''}${labelSlug ? '_' + labelSlug : ''}`;
  let name = `${base}.zip`;
  // Two backups in the same second get different names; nothing is ever written over.
  for (let n = 2; await host.exists(joinPath(opts.destDir, name)); n++) name = `${base}-${n}.zip`;
  const path = joinPath(opts.destDir, name);
  await host.writeBinary(path, bytes);
  return { name, path, sizeBytes: bytes.length, createdAt: now.toISOString(), label, automatic: Boolean(opts.automatic) };
}

/** The backups in a folder, newest first. With a slug, only those of one book. */
export async function listBackups(host: Host, destDir: string, slug?: string): Promise<BackupInfo[]> {
  if (!(await host.exists(destDir))) return [];
  const out: BackupInfo[] = [];
  for (const entry of await host.list(destDir)) {
    if (!entry.isFile) continue;
    const parsed = parseBackupName(entry.name);
    if (!parsed || (slug && parsed.slug !== slug)) continue;
    out.push({ name: entry.name, path: joinPath(destDir, entry.name), sizeBytes: entry.size, createdAt: parsed.createdAt, label: parsed.label, automatic: parsed.automatic });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.name.localeCompare(a.name)));
}

/** Remove the oldest automatic backups of one book beyond the number to keep. Backups made by hand are never removed. */
export async function pruneBackups(host: Host, destDir: string, slug: string, keep: number): Promise<number> {
  const automatic = (await listBackups(host, destDir, slug)).filter((b) => b.automatic);
  const extra = automatic.slice(Math.max(1, keep));
  for (const b of extra) await host.remove(b.path);
  return extra.length;
}

/**
 * Unpack a backup into a new folder inside parentDir and return that folder.
 * An existing folder is never written into: the copy gets a new name.
 */
export async function restoreBackup(host: Host, zipPath: string, parentDir: string): Promise<string> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(await host.readBinary(zipPath));
  } catch {
    throw new Error('This file could not be opened as a zip file. It may be damaged or incomplete.');
  }
  const names = Object.keys(entries).filter((n) => !n.endsWith('/'));
  const bookFile = names.find((n) => /(^|\/)book\.json$/.test(n) && n.split('/').length <= 2);
  if (!bookFile) throw new Error('This zip file is not a Borderless Studio backup: it has no book.json inside.');
  const top = bookFile.includes('/') ? bookFile.split('/')[0] : '';
  const folder = slugify(top || basename(zipPath).replace(/\.zip$/i, ''), 60) || 'book';
  let target = joinPath(parentDir, `${folder}-restored`);
  for (let n = 2; await host.exists(target); n++) target = joinPath(parentDir, `${folder}-restored-${n}`);
  for (const name of names) {
    const rel = top ? (name.startsWith(top + '/') ? name.slice(top.length + 1) : '') : name;
    // Entries that try to leave the folder ("..", absolute paths, drive letters) are not written.
    if (!rel || rel === 'backup.json' || rel.split('/').some((part) => part === '..' || part === '') || /^[A-Za-z]:/.test(rel) || rel.includes('\\')) continue;
    const dest = joinPath(target, rel);
    await host.mkdirp(dirname(dest));
    await host.writeBinary(dest, entries[name]);
  }
  return normPath(target);
}

/** The time of the last change to the text or the settings of a book. */
async function lastChange(project: Project): Promise<number> {
  let latest = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (!(await project.host.exists(dir))) return;
    for (const e of await project.host.list(dir)) {
      if (e.isDir) {
        if (depth < 3 && !e.name.startsWith('.')) await walk(joinPath(dir, e.name), depth + 1);
      } else if (e.mtimeMs > latest) latest = e.mtimeMs;
    }
  };
  for (const part of ['manuscript', 'metadata', 'cover', 'bible']) await walk(project.path(part), 0);
  const book = await project.host.stat(project.path('book.json'));
  if (book && book.mtimeMs > latest) latest = book.mtimeMs;
  return latest;
}

/**
 * The daily safety net: make a backup when the newest one is older than
 * everyHours and the book has changed since. Returns the new backup, or null
 * when none was needed.
 */
export async function autoBackupIfDue(project: Project, destDir: string, opts: { everyHours?: number; keep?: number; now?: Date } = {}): Promise<BackupInfo | null> {
  const now = opts.now ?? new Date();
  const slug = backupSlug(project);
  const newest = (await listBackups(project.host, destDir, slug))[0];
  if (newest) {
    const at = new Date(newest.createdAt).getTime();
    if (now.getTime() - at < (opts.everyHours ?? 24) * 3_600_000) return null;
    if ((await lastChange(project)) <= at) return null;
  }
  const made = await createBackup(project, { destDir, automatic: true, now });
  await pruneBackups(project.host, destDir, slug, opts.keep ?? 10);
  return made;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export interface GitVersion {
  hash: string;
  date: string;
  message: string;
}

export interface GitState {
  /** Git is installed on this computer. */
  available: boolean;
  /** How to get Git when it is missing. */
  hint: string;
  /** The book folder (or a folder above it) has a Git history. */
  isRepo: boolean;
  /** The history belongs to a folder above the book folder (for example the whole library). */
  insideLargerRepo: boolean;
  /** Files changed since the last recorded version. */
  changed: number;
  versions: GitVersion[];
}

/** Does the folder itself contain Git data? Checked without running Git. */
export async function hasGitFolder(host: Host, dir: string): Promise<boolean> {
  return host.exists(joinPath(dir, '.git'));
}

/**
 * Options given to every Git call: hooks and file system monitors stored in
 * the folder are switched off, so recording a version cannot start another
 * program even if the folder came from someone else.
 */
function safeArgs(host: Host): string[] {
  const nowhere = host.os === 'windows' ? 'NUL' : '/dev/null';
  return ['-c', `core.hooksPath=${nowhere}`, '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '--no-pager'];
}

async function git(host: Host, dir: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const res = await host.runTool('git', [...safeArgs(host), ...args], { cwd: dir, timeoutMs: 60_000 });
  return { ok: res.code === 0, out: res.stdout, err: res.stderr };
}

/** What Git knows about a book folder. Only call this for folders the user has switched version history on for. */
export async function gitState(host: Host, dir: string): Promise<GitState> {
  const info = await host.toolInfo('git');
  const state: GitState = { available: info.found, hint: info.hint ?? 'Git is optional. Install it from git-scm.com to keep a version history.', isRepo: false, insideLargerRepo: false, changed: 0, versions: [] };
  if (!info.found) return state;
  const top = await git(host, dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return state;
  state.isRepo = true;
  state.insideLargerRepo = normPath(top.out.trim()).toLowerCase() !== normPath(dir).toLowerCase();
  const status = await git(host, dir, ['status', '--porcelain', '--', '.']);
  state.changed = status.ok ? status.out.split('\n').filter((l) => l.trim()).length : 0;
  const log = await git(host, dir, ['log', '-n', '30', '--date=iso-strict', '--pretty=format:%h%x09%ad%x09%s', '--', '.']);
  if (log.ok) {
    state.versions = log.out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split('\t');
        return { hash, date, message: rest.join('\t') };
      });
  }
  return state;
}

/** Give a book folder a Git history of its own (does nothing when it already has one). */
export async function gitStart(host: Host, dir: string): Promise<void> {
  if (!(await hasGitFolder(host, dir))) {
    const res = await git(host, dir, ['init']);
    if (!res.ok) throw new Error(`Git could not start a history in this folder: ${res.err.trim() || res.out.trim()}`);
  }
  // Build files and exports can be made again, so they stay out of the history.
  const ignore = joinPath(dir, '.gitignore');
  if (!(await host.exists(ignore))) await host.writeText(ignore, '.borderless/\nexports/\n');
}

/**
 * Record the current state of the book folder as a version (a commit).
 * The author's name is used when Git has no name configured on this computer.
 */
export async function gitRecord(host: Host, dir: string, message: string, authorName = 'Author'): Promise<{ recorded: boolean; message: string }> {
  const add = await git(host, dir, ['add', '-A', '--', '.']);
  if (!add.ok) throw new Error(`Git could not read the folder: ${add.err.trim()}`);
  const staged = await git(host, dir, ['status', '--porcelain', '--', '.']);
  if (staged.ok && !staged.out.trim()) return { recorded: false, message: 'Nothing has changed since the last version.' };
  const name = await git(host, dir, ['config', 'user.name']);
  const email = await git(host, dir, ['config', 'user.email']);
  const identity: string[] = [];
  if (!name.out.trim()) identity.push('-c', `user.name=${authorName || 'Author'}`);
  if (!email.out.trim()) identity.push('-c', 'user.email=author@borderless-studio.invalid');
  const text = message.trim() || 'Version recorded in Borderless Studio';
  const res = await host.runTool('git', [...safeArgs(host), ...identity, 'commit', '-m', text, '--', '.'], { cwd: dir, timeoutMs: 120_000 });
  if (res.code !== 0) throw new Error(`Git could not record the version: ${(res.stderr || res.stdout).trim().split('\n').slice(0, 3).join(' ')}`);
  return { recorded: true, message: text };
}
