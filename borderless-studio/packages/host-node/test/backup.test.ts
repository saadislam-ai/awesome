/**
 * Backups (zip files of a book folder) and the optional Git history.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import {
  autoBackupIfDue, backupSlug, createBackup, createBook, gitRecord, gitStart, gitState, hasGitFolder, listBackups, openBook, parseBackupName, pruneBackups, restoreBackup,
  textNodes, type Project,
} from '@borderless/core';
import { NodeHost } from '../src/nodeHost';

const host = new NodeHost();
const tmp = path.join(os.tmpdir(), `borderless-backup-${process.pid}`).replace(/\\/g, '/');
const dest = `${tmp}/backups`;
let project: Project;
let firstDoc: string;

beforeAll(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  project = await createBook(host, { parentDir: `${tmp}/books`, title: 'The Tide Book', author: 'A. Writer', genre: 'novel' });
  firstDoc = textNodes(project.binder).find((n) => n.kind === 'scene')!.id;
  await project.writeDoc(firstDoc, 'The first version of the text.\n');
  fs.mkdirSync(project.path('exports'), { recursive: true });
  fs.writeFileSync(project.path('exports', 'big.pdf'), 'pretend pdf');
  fs.mkdirSync(project.path('.borderless', 'build'), { recursive: true });
  fs.writeFileSync(project.path('.borderless', 'build', 'cache.bin'), 'cache');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('backups', () => {
  it('packs the book folder into a zip, without build files and exports', async () => {
    const made = await createBackup(project, { destDir: dest, label: 'Before the big edit', now: new Date(2026, 4, 3, 14, 5, 9) });
    expect(made.name).toBe('the-tide-book_2026-05-03_140509_before-the-big-edit.zip');
    const names = Object.keys(unzipSync(new Uint8Array(fs.readFileSync(made.path))));
    expect(names).toContain('the-tide-book/book.json');
    expect(names).toContain('the-tide-book/manuscript/binder.json');
    expect(names).toContain('the-tide-book/backup.json');
    expect(names.some((n) => n.includes('.borderless') || n.includes('exports/'))).toBe(false);
    expect(parseBackupName(made.name)).toMatchObject({ slug: 'the-tide-book', automatic: false, label: 'before the big edit' });
    const withExports = await createBackup(project, { destDir: dest, includeExports: true, now: new Date(2026, 4, 3, 14, 6, 0) });
    expect(Object.keys(unzipSync(new Uint8Array(fs.readFileSync(withExports.path))))).toContain('the-tide-book/exports/big.pdf');
  });

  it('never writes over a backup made in the same second', async () => {
    const now = new Date(2026, 4, 4, 9, 0, 0);
    const a = await createBackup(project, { destDir: dest, now });
    const b = await createBackup(project, { destDir: dest, now });
    expect(a.name).not.toBe(b.name);
    expect(fs.existsSync(a.path) && fs.existsSync(b.path)).toBe(true);
  });

  it('restores into a new folder and leaves the book alone', async () => {
    const made = await createBackup(project, { destDir: dest, now: new Date(2026, 4, 5, 9, 0, 0) });
    await project.writeDoc(firstDoc, 'A later version that replaced the first.\n');
    const restored = await restoreBackup(host, made.path, `${tmp}/books`);
    expect(restored).toBe(`${tmp}/books/the-tide-book-restored`);
    const copy = await openBook(host, restored);
    expect(await copy.readDoc(firstDoc)).toBe('The first version of the text.\n');
    expect(await project.readDoc(firstDoc)).toBe('A later version that replaced the first.\n');
    expect(fs.existsSync(`${restored}/backup.json`)).toBe(false);
    // A second restore gets another name instead of writing into the first.
    expect(await restoreBackup(host, made.path, `${tmp}/books`)).toBe(`${tmp}/books/the-tide-book-restored-2`);
  });

  it('refuses a zip that is not a backup, and ignores entries that point outside the folder', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    fs.writeFileSync(`${tmp}/other.zip`, zipSync({ 'notes.txt': strToU8('hello') }));
    await expect(restoreBackup(host, `${tmp}/other.zip`, `${tmp}/books`)).rejects.toThrow(/not a Borderless Studio backup/);
    fs.writeFileSync(`${tmp}/broken.zip`, 'not a zip at all');
    await expect(restoreBackup(host, `${tmp}/broken.zip`, `${tmp}/books`)).rejects.toThrow(/could not be opened/);
    fs.writeFileSync(`${tmp}/evil.zip`, zipSync({ 'bk/book.json': strToU8('{}'), 'bk/../../escaped.txt': strToU8('x'), 'bk/manuscript/ok.md': strToU8('ok') }));
    const dir = await restoreBackup(host, `${tmp}/evil.zip`, `${tmp}/evil-out`);
    expect(fs.existsSync(`${dir}/manuscript/ok.md`)).toBe(true);
    expect(fs.existsSync(`${tmp}/escaped.txt`)).toBe(false);
    expect(fs.existsSync(`${tmp}/evil-out/escaped.txt`)).toBe(false);
  });

  it('makes the daily backup only when it is due and something changed, and keeps the newest few', async () => {
    const auto = `${tmp}/auto`;
    const day = (n: number) => new Date(Date.now() + n * 24 * 3_600_000);
    const first = await autoBackupIfDue(project, auto, { now: day(1) });
    expect(first?.automatic).toBe(true);
    expect(await autoBackupIfDue(project, auto, { now: new Date(day(1).getTime() + 3_600_000) })).toBeNull(); // too soon
    expect(await autoBackupIfDue(project, auto, { now: day(3) })).toBeNull(); // nothing changed since
    for (let n = 4; n <= 8; n++) {
      const later = day(n);
      fs.utimesSync(project.path('book.json'), later, new Date(later.getTime() - 60_000));
      expect(await autoBackupIfDue(project, auto, { now: later, keep: 3 })).not.toBeNull();
    }
    const list = await listBackups(host, auto, backupSlug(project));
    expect(list).toHaveLength(3);
    expect(list[0].createdAt > list[2].createdAt).toBe(true);
    // Backups made by hand are never pruned.
    await createBackup(project, { destDir: auto, label: 'keep me', now: day(-30) });
    expect(await pruneBackups(host, auto, backupSlug(project), 1)).toBe(2);
    expect((await listBackups(host, auto)).some((b) => b.label === 'keep me')).toBe(true);
  });
});

let gitInstalled = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  gitInstalled = false;
}

describe.skipIf(!gitInstalled)('git version history', () => {
  it('starts a history, records versions and reports what changed', async () => {
    const book = await createBook(host, { parentDir: `${tmp}/gitbooks`, title: 'Versions', author: 'A. Writer', genre: 'novel' });
    const doc = textNodes(book.binder).find((n) => n.kind === 'scene')!.id;
    expect(await hasGitFolder(host, book.dir)).toBe(false);
    await gitStart(host, book.dir);
    expect(await hasGitFolder(host, book.dir)).toBe(true);
    let state = await gitState(host, book.dir);
    expect(state).toMatchObject({ available: true, isRepo: true, insideLargerRepo: false });
    expect(state.changed).toBeGreaterThan(0);
    expect(state.versions).toHaveLength(0);
    expect((await gitRecord(host, book.dir, 'First draft', 'A. Writer')).recorded).toBe(true);
    await book.writeDoc(doc, 'New words.\n');
    expect((await gitState(host, book.dir)).changed).toBe(1);
    await gitRecord(host, book.dir, 'Chapter one "rewritten"', 'A. Writer');
    expect((await gitRecord(host, book.dir, 'Nothing new')).recorded).toBe(false);
    state = await gitState(host, book.dir);
    expect(state.changed).toBe(0);
    expect(state.versions.map((v) => v.message)).toEqual(['Chapter one "rewritten"', 'First draft']);
    expect(state.versions[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not run hooks stored in the folder', async () => {
    const book = await createBook(host, { parentDir: `${tmp}/gitbooks`, title: 'Hooked', author: 'A. Writer', genre: 'novel' });
    await gitStart(host, book.dir);
    const hook = book.path('.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, `#!/bin/sh\ntouch "${tmp}/hook-ran"\nexit 1\n`, { mode: 0o755 });
    expect((await gitRecord(host, book.dir, 'With a hook present')).recorded).toBe(true);
    expect(fs.existsSync(`${tmp}/hook-ran`)).toBe(false);
  });
});
