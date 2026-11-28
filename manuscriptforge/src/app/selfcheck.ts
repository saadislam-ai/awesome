import { detectChapters, importManuscript } from '../core/import';
import { blockText, paragraph } from '../core/model/blocks';
import { Library } from '../data/library';
import type { Platform } from '../platform';

export interface CheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CheckReport {
  passed: boolean;
  steps: CheckStep[];
  platform: Platform['info'];
  finishedAt: string;
}

const SAMPLE = `The Self-Check Sample

Chapter One

The quick brown fox jumps over the lazy dog. Café, naïve, Привет, 你好.

* * *

A second scene follows the break.

Chapter Two

This chapter exists so that splitting can be checked.
`;

/**
 * Exercises the whole storage path end to end with a small throwaway book:
 * import, original file, editing, snapshots, restore, search and backup.
 * It cleans up after itself and never touches real books.
 */
export async function runSelfCheck(platform: Platform, library: Library): Promise<CheckReport> {
  const steps: CheckStep[] = [];
  let bookId: string | null = null;
  const step = async (name: string, action: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, detail: await action() });
    } catch (e) {
      steps.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };
  const expect = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };

  await step('Database reads and writes', async () => {
    const value = `check-${Date.now()}`;
    await library.setSetting('selfcheck', value);
    expect((await library.getSetting('selfcheck', '')) === value, 'A saved setting did not read back.');
    return 'Settings round trip works.';
  });

  const bytes = new TextEncoder().encode(SAMPLE);
  await step('Import and chapter detection', async () => {
    const result = await importManuscript('self-check.txt', bytes);
    const { chapters } = detectChapters(result.blocks, 'auto', { title: 'The Self-Check Sample' });
    expect(chapters.map((c) => c.title).join('|') === 'Title page|Chapter One|Chapter Two', `Unexpected chapters: ${chapters.map((c) => c.title).join(', ')}`);
    const book = await library.createBook({
      category: 'mine', title: 'Self-check sample (safe to delete)', chapters, language: result.meta.language,
      source: { name: 'self-check.txt', format: 'txt', bytes },
    });
    bookId = book.id;
    return `${chapters.length} chapters, ${book.wordCount} words.`;
  });

  await step('Original file is stored untouched', async () => {
    expect(!!bookId, 'The sample book was not created.');
    const book = (await library.getBook(bookId!))!;
    const original = await library.readOriginal(book);
    expect(!!original && original.length === bytes.length && original.every((b, i) => b === bytes[i]), 'The stored original differs from the imported file.');
    return `${bytes.length} bytes match.`;
  });

  await step('Edit, snapshot and restore', async () => {
    expect(!!bookId, 'The sample book was not created.');
    const heads = await library.listChapters(bookId!);
    const before = await library.getAllChapters(bookId!);
    await library.saveChapter(heads[1].id, [paragraph('Rewritten.')]);
    await library.createSnapshot(bookId!, 'Self-check snapshot', 'manual');
    const original = (await library.listVersions(bookId!)).find((v) => v.kind === 'original');
    expect(!!original, 'The original version is missing.');
    await library.restoreVersion(bookId!, original!.id);
    const after = await library.getAllChapters(bookId!);
    expect(JSON.stringify(after.map((c) => c.blocks)) === JSON.stringify(before.map((c) => c.blocks)), 'Restoring the original did not bring back the same text.');
    expect(blockText(after[1].blocks[0]).includes('Привет'), 'Non-English text was damaged.');
    return 'The original was restored exactly.';
  });

  await step('Search inside books', async () => {
    const hits = await library.searchText('quick brown fox');
    expect(hits.some((h) => h.bookId === bookId), 'The sample text was not found.');
    return `${hits.length} match found.`;
  });

  await step('Backup', async () => {
    if (platform.info.kind !== 'desktop') return 'Skipped: backups are made by the desktop app.';
    const backup = await platform.backupNow();
    expect(!!backup && backup.sizeBytes > 0, 'No backup file was written.');
    return `${backup!.name} written.`;
  });

  await step('Clean up', async () => {
    if (bookId) await library.deleteBook(bookId);
    const left = (await library.listBooks()).filter((b) => b.id === bookId);
    expect(left.length === 0, 'The sample book could not be removed.');
    return 'Sample book removed.';
  });

  return { passed: steps.every((s) => s.ok), steps, platform: platform.info, finishedAt: new Date().toISOString() };
}
