import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createBook, openBook, writingStreak, LAYOUT } from '@borderless/core';
import { NodeHost } from '../src/nodeHost';

let tmp: string;
const host = new NodeHost();

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bstudio-store-')).replace(/\\/g, '/');
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('book projects on disk', () => {
  it('creates a plain folder that can be read without the app', async () => {
    const p = await createBook(host, { parentDir: tmp, title: 'A Test Book', author: 'Dr Saad Islam', genre: 'novel' });
    expect(fs.existsSync(path.join(p.dir, 'book.json'))).toBe(true);
    expect(fs.existsSync(path.join(p.dir, 'manuscript', 'binder.json'))).toBe(true);
    expect(fs.existsSync(path.join(p.dir, 'README.txt'))).toBe(true);
    const book = JSON.parse(fs.readFileSync(path.join(p.dir, 'book.json'), 'utf8'));
    expect(book.title).toBe('A Test Book');
    expect(book.imprint).toBe('Borderless Publishing');
    expect(book.contributors[0].sortName).toBe('Islam, Saad');
    expect(book.style.dashPolicy.mode).toBe('flag');
    expect(book.formats.map((f: { id: string }) => f.id)).toEqual(['paperback', 'hardcover', 'ebook']);
    expect(fs.readdirSync(path.join(p.dir, 'manuscript')).some((f) => f.endsWith('.md'))).toBe(true);
  });

  it('never writes into an existing folder', async () => {
    const a = await createBook(host, { parentDir: tmp, title: 'Twice', author: 'A', genre: 'novel' });
    const b = await createBook(host, { parentDir: tmp, title: 'Twice', author: 'A', genre: 'novel' });
    expect(a.dir).not.toBe(b.dir);
  });

  it('saves documents atomically and leaves no temporary files', async () => {
    const p = await createBook(host, { parentDir: tmp, title: 'Atomic', author: 'A', genre: 'novel' });
    const scene = p.binder.roots[1].children![0].children![0];
    expect(await p.writeDoc(scene.id, 'First version of the scene.\n')).toBe(true);
    expect(await p.writeDoc(scene.id, 'First version of the scene.\n')).toBe(false); // unchanged: nothing written
    const files = fs.readdirSync(path.join(p.dir, 'manuscript'));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    const reopened = await openBook(host, p.dir);
    expect(await reopened.readDoc(scene.id)).toBe('First version of the scene.\n');
  });

  it('snapshots the previous version before a large deletion', async () => {
    const p = await createBook(host, { parentDir: tmp, title: 'Snapshots', author: 'A', genre: 'novel' });
    const scene = p.binder.roots[1].children![0].children![0];
    const long = 'A long paragraph of precious writing. '.repeat(60);
    await p.writeDoc(scene.id, long);
    // Within the snapshot interval, a small edit does not make a snapshot...
    p.snapshotPolicy.intervalMinutes = 60;
    await p.writeDoc(scene.id, long + 'More.');
    const before = (await p.listSnapshots(scene.id)).length;
    // ...but wiping most of the text does.
    await p.writeDoc(scene.id, 'Oops.');
    const snaps = await p.listSnapshots(scene.id);
    expect(snaps.length).toBe(before + 1);
    expect(await p.readSnapshot(scene.id, snaps[0].name)).toBe(long + 'More.');
    // Restoring brings the text back and keeps the "Oops." version as another snapshot.
    await p.restoreSnapshot(scene.id, snaps[0].name);
    expect(await p.readDoc(scene.id)).toBe(long + 'More.');
    expect((await p.listSnapshots(scene.id)).length).toBe(before + 2);
  });

  it('moves removed documents to the trash instead of deleting them', async () => {
    const p = await createBook(host, { parentDir: tmp, title: 'Trash', author: 'A', genre: 'novel' });
    const chapter = p.binder.roots[1].children![0];
    const scene = chapter.children![0];
    await p.writeDoc(scene.id, 'Do not lose me.');
    await p.removeNode(scene.id);
    expect(chapter.children).toHaveLength(0);
    const trash = fs.readdirSync(path.join(p.dir, LAYOUT.trashDir));
    const kept = trash.find((f) => f.endsWith('.md'));
    expect(kept).toBeTruthy();
    expect(fs.readFileSync(path.join(p.dir, LAYOUT.trashDir, kept!), 'utf8')).toBe('Do not lose me.');
    expect(trash.some((f) => f.endsWith('.binder.json'))).toBe(true);
  });

  it('adds, moves and reorders binder items', async () => {
    const p = await createBook(host, { parentDir: tmp, title: 'Binder', author: 'A', genre: 'novel' });
    const body = p.binder.roots[1];
    const ch2 = await p.addNode(body.id, { type: 'chapter', kind: 'chapter', title: 'Second', numbered: true, text: 'Two.' });
    const ch3 = await p.addNode(body.id, { type: 'chapter', kind: 'chapter', title: 'Third', numbered: true, text: 'Three.' });
    expect(body.children!.map((c) => c.title)).toEqual(['Chapter title', 'Second', 'Third']);
    expect(await p.moveNode(ch3.id, body.id, 0)).toBe(true);
    expect(body.children!.map((c) => c.title)).toEqual(['Third', 'Chapter title', 'Second']);
    // A chapter cannot be dropped inside another chapter, and nothing can move into itself.
    expect(await p.moveNode(ch2.id, ch3.id, 0)).toBe(false);
    expect(await p.moveNode(ch3.id, ch3.id, 0)).toBe(false);
    const reopened = await openBook(host, p.dir);
    expect(reopened.binder.roots[1].children!.map((c) => c.title)).toEqual(['Third', 'Chapter title', 'Second']);
  });

  it('counts words without markup and keeps a writing log with a streak', async () => {
    const p = await createBook(host, { parentDir: tmp, title: 'Words', author: 'A', genre: 'novel' });
    const scene = p.binder.roots[1].children![0].children![0];
    await p.writeDoc(scene.id, 'One *two* three {>>not counted<<} four.\n\n[^1]: five six');
    expect(await p.manuscriptWords()).toBe(6);
    await p.logWriting(1000, 30, true, '2026-11-20');
    await p.logWriting(2200, 45, true, '2026-11-21');
    const log = await p.logWriting(3300, 20, true, '2026-11-22');
    expect(log.days.map((d) => d.words)).toEqual([0, 1200, 1100]);
    expect(writingStreak(log, 1000, '2026-11-22')).toBe(2);
    expect(writingStreak(log, 1000, '2026-11-23')).toBe(2); // yesterday still counts until today is over
    expect(writingStreak(log, 1000, '2026-11-25')).toBe(0);
  });

  it('refuses to open a folder that is not a book, with a clear message', async () => {
    await expect(openBook(host, tmp)).rejects.toThrow(/not a Borderless Studio book folder/);
  });
});
