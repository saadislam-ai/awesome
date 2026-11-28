import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG, rateFit, recommendModels } from '../../src/core/ai/catalog';
import { compareBooks } from '../../src/core/edit/compare';
import { markupSpans, sliceMarkup } from '../../src/core/edit/markup';
import { paragraph, type Block } from '../../src/core/model/blocks';

const GB = 1024 ** 3;
const DESKTOP = { ramBytes: 64 * GB, vramBytes: 24 * GB, unifiedMemory: false };

describe('model recommendations', () => {
  it('rates models for a 24 GB graphics card with 64 GB of memory', () => {
    const rated = Object.fromEntries(recommendModels(DESKTOP).map((r) => [r.model.id, r.fit]));
    expect(rated).toEqual({
      'qwen2.5-32b': 'gpu', 'gemma-3-27b': 'gpu', 'mistral-small-24b': 'gpu', 'qwen2.5-14b': 'gpu', 'gemma-3-12b': 'gpu',
      'qwen2.5-7b': 'gpu', 'gemma-3-4b': 'gpu', 'llama-3.3-70b': 'split',
    });
    const top = recommendModels(DESKTOP);
    expect(top.filter((r) => r.recommended).map((r) => r.model.id)).toEqual(['qwen2.5-32b']);
    expect(top[top.length - 1].model.id).toBe('llama-3.3-70b');
  });

  it('adapts to smaller and different computers', () => {
    const laptop = { ramBytes: 16 * GB, vramBytes: 0, unifiedMemory: false };
    expect(rateFit(4.7 * GB, laptop)).toBe('cpu');
    expect(rateFit(19.8 * GB, laptop)).toBe('too-big');
    expect(recommendModels(laptop).find((r) => r.recommended)!.model.id).toBe('qwen2.5-7b');
    const mac = { ramBytes: 32 * GB, vramBytes: 32 * GB, unifiedMemory: true };
    expect(rateFit(16.5 * GB, mac)).toBe('gpu');
    expect(rateFit(42.5 * GB, mac)).toBe('too-big');
    const midCard = { ramBytes: 32 * GB, vramBytes: 8 * GB, unifiedMemory: false };
    expect(rateFit(4.7 * GB, midCard)).toBe('gpu');
    expect(rateFit(16.5 * GB, midCard)).toBe('split');
    // A bigger context needs more memory: the 32B model no longer fits whole at 32k.
    expect(rateFit(19_851_336_576, DESKTOP, 32768)).toBe('split');
  });

  it('lists only secure download addresses with plain file names', () => {
    for (const model of MODEL_CATALOG) {
      expect(model.url.startsWith('https://huggingface.co/')).toBe(true);
      expect(model.url.endsWith(`/${model.fileName}`)).toBe(true);
      expect(model.fileName).toMatch(/^[A-Za-z0-9._-]+\.gguf$/);
      expect(model.licence).toBeTruthy();
    }
    expect(new Set(MODEL_CATALOG.map((m) => m.id)).size).toBe(MODEL_CATALOG.length);
  });
});

describe('formatted slices for display', () => {
  it('cuts through formatted text at any point', () => {
    const markup = 'He read *The Long Road* twice, \\*really\\*.';
    const spans = markupSpans(markup);
    expect(sliceMarkup(spans, 0, markup.length)).toEqual([{ text: 'He read ' }, { text: 'The Long Road', i: true }, { text: ' twice, *really*.' }]);
    const from = markup.indexOf('Long');
    expect(sliceMarkup(spans, from, from + 4)).toEqual([{ text: 'Long', i: true }]);
    expect(sliceMarkup(spans, 3, from + 4)).toEqual([{ text: 'read ' }, { text: 'The Long', i: true }]);
    expect(sliceMarkup(spans, 5, 5)).toEqual([]);
  });
});

describe('comparing two versions of a book', () => {
  const before = [
    { id: 'a', title: 'One', blocks: [paragraph('The cat sat on the mat.'), paragraph('It was warm.'), paragraph('This goes away completely now.')] as Block[] },
    { id: 'b', title: 'Two', blocks: [paragraph('Unchanged chapter.')] as Block[] },
    { id: 'c', title: 'Gone', blocks: [paragraph('A removed chapter of five words.')] as Block[] },
  ];
  const after = [
    { id: 'a', title: 'One: The Cat', blocks: [paragraph('The cat sat upon the mat.'), paragraph('A new line here.'), paragraph('It was warm.')] as Block[] },
    { id: 'b', title: 'Two', blocks: [paragraph('Unchanged chapter.')] as Block[] },
    { id: 'd', title: 'New', blocks: [paragraph('Fresh words.')] as Block[] },
  ];

  it('finds changed, added and removed paragraphs and chapters with word counts', () => {
    const result = compareBooks(before, after);
    expect(result.chapters.map((c) => [c.title, c.status])).toEqual([['One: The Cat', 'changed'], ['Two', 'same'], ['New', 'added'], ['Gone', 'removed']]);
    const one = result.chapters[0];
    expect(one.titleBefore).toBe('One');
    expect(one.rows.map((r) => r.type)).toEqual(['changed', 'added', 'same', 'removed']);
    expect(one.rows[0].hunks!.map((h) => [h.before, h.after])).toEqual([['on', 'upon']]);
    expect(result).toMatchObject({ paragraphsChanged: 1, paragraphsAdded: 2, paragraphsRemoved: 2, wordsAdded: 1 + 4 + 2, wordsRemoved: 1 + 5 + 6 });
  });

  it('reports no differences for identical versions', () => {
    expect(compareBooks(before, before)).toMatchObject({ changes: 0, wordsAdded: 0, wordsRemoved: 0 });
  });
});
