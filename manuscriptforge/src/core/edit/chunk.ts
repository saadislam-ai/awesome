import type { Block } from '../model/blocks';
import { countWords } from '../text/words';
import { markupToPlain, runsToMarkup } from './markup';
import type { Chunk, ChunkItem, EditLevel } from './types';

export interface ChunkingOptions {
  level: EditLevel;
  /** Target size of one passage in words. Smaller passages keep a small model on task. */
  maxWords?: number;
  /** Only paragraphs in this range of the chapter are edited (both ends inclusive). */
  range?: { from: number; to: number };
}

export const DEFAULT_CHUNK_WORDS = 450;

/**
 * Cuts a chapter into passages for the model. A model can never be given a
 * whole book, so each passage is a run of whole paragraphs of manageable
 * size, with the end of the preceding text attached for continuity.
 */
export function chunkChapter(blocks: Block[], options: ChunkingOptions): Chunk[] {
  const maxWords = options.maxWords ?? DEFAULT_CHUNK_WORDS;
  const chunks: Chunk[] = [];
  let items: ChunkItem[] = [];
  let words = 0;
  let context = '';
  let recent: string[] = [];

  const close = () => {
    if (items.length) chunks.push({ items, contextBefore: context, words });
    items = [];
    words = 0;
    context = tail(recent.join(' '), 90);
  };

  blocks.forEach((block, blockIndex) => {
    if (block.type === 'break') {
      // A scene break is a natural place to end a passage that is already substantial.
      if (words >= maxWords * 0.6) close();
      return;
    }
    const markup = runsToMarkup(block.runs);
    const plain = markupToPlain(markup);
    const count = countWords(plain);
    recent.push(plain);
    if (recent.length > 4) recent = recent.slice(-4);
    if (!count) return;
    const inRange = !options.range || (blockIndex >= options.range.from && blockIndex <= options.range.to);
    // Headings are proofread for typos but never restyled.
    const editable = inRange && (block.type !== 'heading' || options.level === 'proofread');
    if (!editable) return;
    if (items.length && words + count > maxWords) {
      // The paragraph that does not fit starts the next passage.
      recent.pop();
      close();
      recent.push(plain);
    }
    if (!items.length) context = tail(recent.slice(0, -1).join(' '), 90);
    items.push({ n: items.length + 1, blockIndex, markup, ...(block.type === 'heading' ? { heading: true } : {}) });
    words += count;
  });
  close();
  return chunks;
}

function tail(text: string, words: number): string {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length <= words ? parts.join(' ') : '… ' + parts.slice(-words).join(' ');
}
