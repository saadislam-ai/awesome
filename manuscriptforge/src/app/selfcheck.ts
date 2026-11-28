import { diffText } from '../core/edit/diff';
import { editChunk } from '../core/edit/pipeline';
import { exportBook } from '../core/export';
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

  await step('Export', async () => {
    expect(!!bookId, 'The sample book was not created.');
    const book = (await library.getBook(bookId!))!;
    const chapters = (await library.getAllChapters(bookId!)).map((c) => ({ id: c.id, title: c.title, blocks: c.blocks }));
    const result = exportBook({ title: 'self-check-export', author: '', language: book.language, chapters }, 'docx');
    expect(result.bytes.length > 2000, 'The exported file is empty.');
    if (!platform.info.selftest) return `A Word file of ${result.bytes.length} bytes was produced (not saved).`;
    const saved = await platform.saveFile(result.fileName, result.extension, result.bytes);
    expect(!!saved, 'The exported file was not saved.');
    return `Saved ${saved}.`;
  });

  const ai = platform.ai;
  if (ai) {
    await step('AI engine', async () => {
      const [hardware, engines] = await Promise.all([ai.hardware(), ai.findEngines()]);
      const memory = `${Math.round(hardware.ramBytes / 1024 ** 3)} GB memory, ${hardware.cpuCores} cores, ${hardware.gpus.length ? hardware.gpus.map((g) => g.name).join(', ') : 'no usable graphics card'}`;
      if (!engines.length) {
        expect(!platform.info.selftestModel, 'A model was given for the self-check but the AI engine was not found.');
        return `${memory}. The AI engine is not installed.`;
      }
      return `${memory}. Engine: llama.cpp ${engines[0].version ?? ''} (${engines[0].variant}).`;
    });

    const modelPath = platform.info.selftestModel;
    if (modelPath) {
      await step('AI model loads and edits', async () => {
        const [engine] = await ai.findEngines();
        const [model] = await ai.listModels([modelPath]);
        expect(!!model?.meta, `The model file could not be read: ${model?.problem ?? 'not found'}`);
        await ai.startEngine({ binary: engine.path, model: modelPath, context: 4096 });
        try {
          const provider = ai.provider(model.meta!.name ?? 'model');
          let streamed = 0;
          const original = 'Teh keeper had forgoten his lamp, and the stairs were dark.';
          const result = await editChunk(
            provider,
            { items: [{ n: 1, blockIndex: 0, markup: original }], contextBefore: '', words: 11 },
            { level: 'proofread', strength: 'medium', language: 'en', bookType: 'fiction' },
            { onToken: () => streamed++ },
          );
          expect(streamed > 3, 'The reply did not arrive as a stream.');
          const fixes = result.edits[0] ? diffText(original, result.edits[0].revised).map((h) => `${h.before} to ${h.after}`) : [];

          // A long reply must stop promptly when cancelled.
          const stop = new AbortController();
          let pieces = 0;
          const cancelled = await provider
            .chat({ messages: [{ role: 'user', content: 'Count from 1 to 400, one number per line.' }], maxTokens: 1500 }, { signal: stop.signal, onToken: () => ++pieces === 10 && stop.abort() })
            .then(() => false, (e) => (e as { name?: string })?.name === 'AbortError');
          expect(cancelled, 'A running reply could not be cancelled.');
          return `${model.meta!.name} (${model.meta!.quantization}) at ${result.tokensPerSecond?.toFixed(1) ?? '?'} tokens per second. Changes proposed: ${fixes.length ? fixes.join('; ') : 'none'}. Cancelling works.`;
        } finally {
          await ai.stopEngine();
        }
      });
    }
  }

  await step('Clean up', async () => {
    if (bookId) await library.deleteBook(bookId);
    const left = (await library.listBooks()).filter((b) => b.id === bookId);
    expect(left.length === 0, 'The sample book could not be removed.');
    return 'Sample book removed.';
  });

  return { passed: steps.every((s) => s.ok), steps, platform: platform.info, finishedAt: new Date().toISOString() };
}
