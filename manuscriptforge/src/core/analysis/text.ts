import { sentenceRanges } from '../edit/diff';
import { countWords } from '../text/words';

export function splitSentences(text: string): string[] {
  return sentenceRanges(text)
    .map(([start, end]) => text.slice(start, end).trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function wordsOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
}

/** Estimates the syllables of an English word. Good to within one for most words. */
export function countSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return w ? 1 : 0;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

const QUOTED = /“[^”]*”|"[^"]*"|«[^»]*»|„[^“”]*[“”]/g;
const DASH_DIALOGUE = /^\s*[—–―-]\s*\S/;

/** Splits a paragraph into its spoken part and its narration. */
export function splitDialogue(paragraph: string): { dialogue: string; narration: string } {
  if (DASH_DIALOGUE.test(paragraph) && !/[“"«]/.test(paragraph)) {
    // Spanish, French and Russian books open speech with a dash. The speaker tag sits between dashes.
    const parts = paragraph.replace(/^\s*[—–―-]\s*/, '').split(/\s*[—–―]\s*/);
    return { dialogue: parts.filter((_, i) => i % 2 === 0).join(' ').trim(), narration: parts.filter((_, i) => i % 2 === 1).join(' ').trim() };
  }
  const spoken = paragraph.match(QUOTED) ?? [];
  return { dialogue: spoken.join(' '), narration: paragraph.replace(QUOTED, ' ').replace(/\s+/g, ' ') };
}

export function dialogueShare(paragraphs: string[]): number {
  let spoken = 0;
  let total = 0;
  for (const p of paragraphs) {
    total += countWords(p);
    spoken += countWords(splitDialogue(p).dialogue);
  }
  return total ? spoken / total : 0;
}

export interface Readability {
  readingEase: number | null;
  grade: number | null;
  lix: number;
}

/** Readability of a text. Flesch scores need syllables, so they are given for English only. */
export function readability(words: string[], sentences: number, english: boolean): Readability {
  const n = words.length;
  if (!n || !sentences) return { readingEase: null, grade: null, lix: 0 };
  const long = words.filter((w) => w.length > 6).length;
  const lix = n / sentences + (100 * long) / n;
  if (!english) return { readingEase: null, grade: null, lix: round(lix) };
  let syllables = 0;
  for (const w of words) syllables += countSyllables(w);
  const readingEase = 206.835 - 1.015 * (n / sentences) - 84.6 * (syllables / n);
  const grade = 0.39 * (n / sentences) + 11.8 * (syllables / n) - 15.59;
  return { readingEase: round(Math.max(0, Math.min(120, readingEase))), grade: round(Math.max(0, grade)), lix: round(lix) };
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Finds where a quotation sits in a list of paragraphs, tolerating different quote marks and spacing. */
export function locateQuote(paragraphs: string[], quote: string): { index: number; text: string } | null {
  const normalise = (s: string) => s.toLowerCase().replace(/[“”„«»"]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const needle = normalise(quote).replace(/^["'…. ]+|["'…. ]+$/g, '');
  if (needle.length < 4) return null;
  for (let i = 0; i < paragraphs.length; i++) {
    if (normalise(paragraphs[i]).includes(needle)) return { index: i, text: quote.trim() };
  }
  // Models often paraphrase the end of a long quotation: try its opening words.
  const head = needle.split(' ').slice(0, 6).join(' ');
  if (head.length >= 12) {
    for (let i = 0; i < paragraphs.length; i++) {
      const at = normalise(paragraphs[i]).indexOf(head);
      if (at >= 0) return { index: i, text: paragraphs[i].slice(at, at + head.length) };
    }
  }
  return null;
}
