import { describe, expect, it } from 'vitest';
import { detectChapters } from '../../src/core/import';
import type { Block } from '../../src/core/model/blocks';
import { blockCount, blocksToDoc, docToBlocks } from '../../src/features/editor/convert';
import { importFixture } from './helpers';

describe('editor document conversion', () => {
  it('round-trips every kind of block without change', () => {
    const blocks: Block[] = [
      { type: 'heading', level: 2, runs: [{ text: 'Section' }] },
      { type: 'paragraph', runs: [{ text: 'Plain ' }, { text: 'bold', b: true }, { text: ' and ' }, { text: 'both', b: true, i: true }, { text: ' x', u: true, s: true }] },
      { type: 'paragraph', align: 'center', runs: [{ text: 'A line\nand another' }] },
      { type: 'quote', runs: [{ text: 'First quoted.' }] },
      { type: 'quote', runs: [{ text: 'Second quoted.' }] },
      { type: 'break' },
      { type: 'list', ordered: false, runs: [{ text: 'a' }] },
      { type: 'list', ordered: false, runs: [{ text: 'b' }] },
      { type: 'list', ordered: true, runs: [{ text: 'one' }] },
      { type: 'paragraph', runs: [] },
      { type: 'heading', level: 3, align: 'right', runs: [{ text: 'End', i: true }] },
    ];
    const doc = blocksToDoc(blocks);
    expect(doc.content!.map((n) => n.type)).toEqual(['heading', 'paragraph', 'paragraph', 'blockquote', 'horizontalRule', 'bulletList', 'orderedList', 'paragraph', 'heading']);
    expect(docToBlocks(doc)).toEqual(blocks);
    expect(doc.content!.reduce((n, node) => n + blockCount(node), 0)).toBe(blocks.length);
  });

  it('gives the editor an empty paragraph for an empty chapter and drops it again on save', () => {
    expect(blocksToDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(docToBlocks({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
    expect(docToBlocks({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }, { type: 'paragraph' }] })).toEqual([
      { type: 'paragraph', runs: [{ text: 'Hi' }] },
    ]);
  });

  it('round-trips real imported books exactly', async () => {
    for (const name of ['novel.docx', 'nonfiction.docx', 'manuscript.docx', 'spanish.epub']) {
      const result = await importFixture(name);
      for (const chapter of detectChapters(result.blocks, 'auto', result.meta).chapters) {
        expect(docToBlocks(blocksToDoc(chapter.blocks)), `${name}: ${chapter.title}`).toEqual(chapter.blocks);
      }
    }
  });
});
