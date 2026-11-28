import { createHash } from 'node:crypto';
import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectChapters } from '../../src/core/import';
import { blockText, paragraph, type Block } from '../../src/core/model/blocks';
import { sha256 } from '../../src/core/util/hash';
import { Library, ORIGINAL_VERSION_NAME } from '../../src/data/library';
import { MemoryFiles } from '../../src/platform/memory';
import { createSqlJsDb } from '../../src/platform/sqljs';
import type { Db } from '../../src/platform/types';
import { fixture, importFixture } from './helpers';

let db: Db;
let files: MemoryFiles;
let library: Library;

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = createSqlJsDb(new SQL.Database());
  files = new MemoryFiles();
  library = new Library(db, files);
  await library.init();
});

async function importNovel(category: 'mine' | 'submission' = 'mine') {
  const result = await importFixture('novel.docx');
  const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
  return library.createBook({
    category,
    title: result.meta.title!,
    author: result.meta.author,
    language: result.meta.language,
    tags: ['mystery', 'Mystery', ' coastal '],
    chapters,
    source: { name: 'novel.docx', format: 'docx', bytes: fixture('novel.docx') },
  });
}

const count = async (table: string) => (await db.select<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

describe('hashing', () => {
  it('matches the published SHA-256 test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    // Multi-byte text, checked against Node's own implementation.
    for (const text of ['é'.repeat(1000), 'Привет, 世界 🌍', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)]) {
      expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
    expect(sha256('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('books', () => {
  it('stores an imported book with its chapters, word count and untouched original file', async () => {
    const book = await importNovel();
    expect(book).toMatchObject({
      category: 'mine', title: 'The Lighthouse at Marrow Point', author: 'Eleanor Vance', language: 'en', status: 'imported',
      tags: ['mystery', 'coastal'], sourceFormat: 'docx', decision: null,
    });
    expect(book.wordCount).toBeGreaterThan(550);
    const heads = await library.listChapters(book.id);
    expect(heads.map((h) => h.title)).toEqual(['Title page', 'Prologue', 'Chapter One', 'Chapter Two', 'Chapter Three']);
    expect(heads.reduce((n, h) => n + h.wordCount, 0)).toBe(book.wordCount);
    expect(await library.readOriginal(book)).toEqual(fixture('novel.docx'));
  });

  it('gives submissions a received date and a decision', async () => {
    const book = await importNovel('submission');
    expect(book.decision).toBe('under_review');
    expect(book.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const updated = await library.updateBook(book.id, { decision: 'accept', authorContact: 'eleanor@example.com', neverCloud: true });
    expect(updated).toMatchObject({ decision: 'accept', authorContact: 'eleanor@example.com', neverCloud: true });
  });

  it('deletes a book completely, including versions and the original file', async () => {
    const book = await importNovel();
    const keep = await importNovel();
    await library.deleteBook(book.id);
    expect((await library.listBooks()).map((b) => b.id)).toEqual([keep.id]);
    expect([...files.entries.keys()].every((k) => k.startsWith(`books/${keep.id}/`))).toBe(true);
    expect(await count('chapters')).toBe(5);
    expect(await count('versions')).toBe(1);
    // The surviving book can still restore its original.
    expect((await library.getVersionChapters((await library.listVersions(keep.id))[0].id)).length).toBe(5);
  });

  it('searches inside books in any letter case and any script', async () => {
    const book = await importNovel();
    await library.createBook({ category: 'mine', title: 'Русская книга', chapters: [{ title: 'Глава 1', blocks: [paragraph('Привет, Мир! Это тест.')] }] });
    const hits = await library.searchText('HARBOUR MASTER');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ bookId: book.id, chapterTitle: 'Chapter Two' });
    expect(hits[0].snippet).toContain('The harbour master was a broad');
    expect((await library.searchText('привет, мир'))[0].bookTitle).toBe('Русская книга');
    expect(await library.searchText('100%')).toEqual([]);
    expect(await library.searchText('x')).toEqual([]);
  });
});

describe('chapters', () => {
  it('saves edits, updates word counts and marks the book as in editing', async () => {
    const book = await importNovel();
    const heads = await library.listChapters(book.id);
    const chapter = (await library.getChapter(heads[2].id))!;
    const blocks: Block[] = [...chapter.blocks, paragraph('Three extra words.')];
    const saved = await library.saveChapter(chapter.id, blocks);
    expect(saved.wordCount).toBe(chapter.wordCount + 3);
    expect(saved.bookWordCount).toBe(book.wordCount + 3);
    expect((await library.getBook(book.id))!.status).toBe('editing');
    expect((await library.getChapter(chapter.id))!.blocks).toEqual(blocks);
  });

  it('splits, merges, reorders, adds and deletes chapters without losing text', async () => {
    const book = await importNovel();
    const before = (await library.getAllChapters(book.id)).flatMap((c) => c.blocks.map(blockText));
    let heads = await library.listChapters(book.id);

    const newId = await library.splitChapter(heads[2].id, 6);
    heads = await library.listChapters(book.id);
    expect(heads.map((h) => h.title)).toEqual(['Title page', 'Prologue', 'Chapter One', 'New chapter', 'Chapter Two', 'Chapter Three']);
    expect(heads[3].id).toBe(newId);
    expect(heads.map((h) => h.position)).toEqual([0, 1, 2, 3, 4, 5]);

    await library.mergeChapterWithPrevious(newId!);
    heads = await library.listChapters(book.id);
    expect(heads.map((h) => h.title)).toEqual(['Title page', 'Prologue', 'Chapter One', 'Chapter Two', 'Chapter Three']);
    const after = (await library.getAllChapters(book.id)).flatMap((c) => c.blocks.map(blockText));
    // The scene break that sat at the split point is the only thing trimmed.
    expect(after).toEqual(before.filter((_, i) => i !== before.indexOf('* * *')));

    await library.moveChapter(heads[4].id, -1);
    const added = await library.addChapter(book.id, heads[1].id, 'Interlude');
    heads = await library.listChapters(book.id);
    expect(heads.map((h) => h.title)).toEqual(['Title page', 'Prologue', 'Interlude', 'Chapter One', 'Chapter Three', 'Chapter Two']);
    await library.deleteChapter(added.id);
    expect((await library.listChapters(book.id)).map((h) => h.position)).toEqual([0, 1, 2, 3, 4]);
    expect((await library.getBook(book.id))!.wordCount).toBe(book.wordCount);
  });

  it('refuses to delete the last chapter', async () => {
    const book = await library.createBook({ category: 'mine', title: 'One', chapters: [{ title: 'Only', blocks: [paragraph('Text.')] }] });
    const [only] = await library.listChapters(book.id);
    await expect(library.deleteChapter(only.id)).rejects.toThrow(/at least one chapter/);
  });
});

describe('version history', () => {
  it('keeps the original import as a version that cannot be deleted or renamed', async () => {
    const book = await importNovel();
    const [original] = await library.listVersions(book.id);
    expect(original).toMatchObject({ name: ORIGINAL_VERSION_NAME, kind: 'original', chapterCount: 5, wordCount: book.wordCount });
    await expect(library.deleteVersion(original.id)).rejects.toThrow(/always kept/);
    await library.renameVersion(original.id, 'Hacked');
    expect((await library.listVersions(book.id))[0].name).toBe(ORIGINAL_VERSION_NAME);
  });

  it('restores any version exactly, and a restore can be undone', async () => {
    const book = await importNovel();
    const original = await library.getAllChapters(book.id);
    const heads = await library.listChapters(book.id);

    await library.saveChapter(heads[1].id, [paragraph('A completely rewritten prologue.')]);
    await library.renameChapter(heads[2].id, 'Chapter 1: The Key');
    await library.deleteChapter(heads[4].id);
    expect(await library.hasUnsavedChanges(book.id)).toBe(true);
    const draft = await library.createSnapshot(book.id, 'Second draft', 'manual');
    expect(await library.hasUnsavedChanges(book.id)).toBe(false);
    const edited = await library.getAllChapters(book.id);

    const originalVersion = (await library.listVersions(book.id)).find((v) => v.kind === 'original')!;
    await library.restoreVersion(book.id, originalVersion.id);
    const restored = await library.getAllChapters(book.id);
    expect(restored.map((c) => [c.id, c.title, c.blocks])).toEqual(original.map((c) => [c.id, c.title, c.blocks]));
    expect((await library.getBook(book.id))!.wordCount).toBe(book.wordCount);
    // The state before the restore was already saved as "Second draft", so no extra safety copy was needed.
    expect((await library.listVersions(book.id)).map((v) => v.kind).sort()).toEqual(['manual', 'original']);

    await library.restoreVersion(book.id, draft!.id);
    expect((await library.getAllChapters(book.id)).map((c) => [c.title, c.blocks])).toEqual(edited.map((c) => [c.title, c.blocks]));
  });

  it('saves a safety copy before restoring over unsaved work', async () => {
    const book = await importNovel();
    const heads = await library.listChapters(book.id);
    await library.saveChapter(heads[1].id, [paragraph('Unsaved work that must not be lost.')]);
    const original = (await library.listVersions(book.id))[0];
    await library.restoreVersion(book.id, original.id);
    const versions = await library.listVersions(book.id);
    const safety = versions.find((v) => v.kind === 'safety')!;
    expect(safety.name).toBe(`Before restoring "${ORIGINAL_VERSION_NAME}"`);
    const chapters = await library.getVersionChapters(safety.id);
    expect(blockText(chapters[1].blocks[0])).toBe('Unsaved work that must not be lost.');
  });

  it('stores unchanged chapters only once across versions', async () => {
    const book = await importNovel();
    const heads = await library.listChapters(book.id);
    expect(await count('blobs')).toBe(5);
    await library.saveChapter(heads[3].id, [paragraph('Changed.')]);
    await library.createSnapshot(book.id, 'After one change', 'manual');
    expect(await count('blobs')).toBe(6);
    expect(await count('version_chapters')).toBe(10);
  });

  it('skips automatic snapshots when nothing changed and keeps only the newest ones', async () => {
    const book = await importNovel();
    const heads = await library.listChapters(book.id);
    expect(await library.createSnapshot(book.id, 'Auto-save', 'auto')).toBeNull();
    for (let i = 0; i < 34; i++) {
      await library.saveChapter(heads[1].id, [paragraph(`Draft number ${i}.`)]);
      expect(await library.createSnapshot(book.id, `Auto-save ${i}`, 'auto')).not.toBeNull();
    }
    const versions = await library.listVersions(book.id);
    expect(versions.filter((v) => v.kind === 'auto')).toHaveLength(30);
    expect(versions.filter((v) => v.kind === 'auto')[0].name).toBe('Auto-save 33');
    expect(versions.some((v) => v.kind === 'original')).toBe(true);
    // Text that belonged only to pruned snapshots is gone: 4 untouched chapters + original prologue + 30 drafts.
    expect(await count('blobs')).toBe(35);
  });
});

describe('settings, log and upgrades', () => {
  it('round-trips settings and caps the log', async () => {
    expect(await library.getSetting('theme', 'light')).toBe('light');
    await library.setSetting('theme', 'sepia');
    await library.setSetting('editor', { size: 19 });
    expect(await library.getSetting('theme', 'light')).toBe('sepia');
    expect(await library.getSetting('editor', { size: 0 })).toEqual({ size: 19 });
    await library.addLog('error', 'import', 'Could not open file', 'details');
    expect((await library.listLogs())[0]).toMatchObject({ level: 'error', scope: 'import', message: 'Could not open file' });
  });

  it('opens an existing library again without changing it, and refuses a newer one', async () => {
    const book = await importNovel();
    const again = new Library(db, files);
    await again.init();
    expect((await again.listBooks()).map((b) => b.id)).toEqual([book.id]);
    await db.execute('UPDATE schema_info SET version = 999');
    await expect(new Library(db, files).init()).rejects.toThrow(/newer version/);
  });

  it('rolls back completely when an import fails part way', async () => {
    const failing: Db = {
      ...db,
      batch: async (statements) => {
        if (statements.some((s) => s.sql.includes('INSERT INTO versions'))) throw new Error('disk full');
        return db.batch(statements);
      },
    };
    const broken = new Library(failing, files);
    await expect(
      broken.createBook({ category: 'mine', title: 'X', chapters: [{ title: 'A', blocks: [paragraph('Text.')] }], source: { name: 'x.txt', format: 'txt', bytes: new Uint8Array([1]) } }),
    ).rejects.toThrow(/disk full/);
    expect(await count('books')).toBe(0);
    expect(await count('chapters')).toBe(0);
    expect(files.entries.size).toBe(0);
  });
});
