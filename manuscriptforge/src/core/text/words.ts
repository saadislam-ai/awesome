import { blockText, type Block } from '../model/blocks';

// Scripts written without spaces between words need a real word segmenter.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const UNSPACED_SCRIPT_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
const WORD = /[\p{L}\p{N}]+(?:['’\-‑][\p{L}\p{N}]+)*/gu;

let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  }
  return segmenter;
}

/**
 * Counts words in any language. Latin, Cyrillic, Arabic and similar scripts
 * are counted with a fast pattern. Chinese, Japanese, Thai and other scripts
 * without spaces use the platform word segmenter.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  if (!UNSPACED_SCRIPT.test(text)) {
    const m = text.match(WORD);
    return m ? m.length : 0;
  }
  const seg = getSegmenter();
  if (seg) {
    let n = 0;
    for (const part of seg.segment(text)) if (part.isWordLike) n++;
    return n;
  }
  // Fallback: each unspaced-script character counts as a word.
  const unspaced = text.match(UNSPACED_SCRIPT_CHAR)?.length ?? 0;
  const rest = text.replace(UNSPACED_SCRIPT_CHAR, ' ').match(WORD)?.length ?? 0;
  return unspaced + rest;
}

export function countBlockWords(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) if (b.type !== 'break') n += countWords(blockText(b));
  return n;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
