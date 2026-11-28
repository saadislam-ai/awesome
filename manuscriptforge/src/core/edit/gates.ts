import { countWords } from '../text/words';
import { classifyChange, diffText } from './diff';
import { countFormattedSpans, markupToPlain } from './markup';
import type { EditLevel, EditStrength, Flag } from './types';

const LENGTH_BOUNDS: Record<EditLevel, Record<EditStrength, [number, number]>> = {
  proofread: { light: [0.88, 1.12], medium: [0.85, 1.15], heavy: [0.8, 1.2] },
  line: { light: [0.75, 1.2], medium: [0.6, 1.3], heavy: [0.45, 1.4] },
};

const QUOTES = /["“”«»„]/g;

/** Capitalised words that are not simply the first word of a sentence. */
function properNouns(plain: string): Set<string> {
  const names = new Set<string>();
  const pattern = /(^|[.!?…:]["”’)]*\s+|["“‘(—–-]\s*)?(\p{Lu}[\p{L}’'-]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(plain))) {
    if (m[1] === undefined && m.index > 0) names.add(m[2]);
  }
  return names;
}

function numbers(plain: string): string[] {
  return (plain.match(/\d+(?:[.,]\d+)*/g) ?? []).sort();
}

/**
 * Decides whether a reply for one paragraph is usable at all. Unusable
 * replies are thrown away and the author's text is kept.
 */
export function isUsableRevision(original: string, revised: string): boolean {
  if (!revised.trim()) return false;
  if (/<\/?(?:p|note)\b/i.test(revised)) return false;
  const before = countWords(markupToPlain(original));
  const after = countWords(markupToPlain(revised));
  if (before >= 8 && (after < before * 0.3 || after > before * 2.5)) return false;
  // A reply in a different script is a translation, not an edit.
  const script = (text: string) => (/[\p{Script=Cyrillic}]/u.test(text) ? 'c' : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? 'h' : /[\p{Script=Arabic}]/u.test(text) ? 'a' : 'l');
  if (before >= 5 && script(original) !== script(revised)) return false;
  return true;
}

/**
 * Checks a proposed paragraph against the original and lists anything a
 * person should look at before accepting it. These are warnings, not
 * verdicts: the change is still offered, with the warning attached.
 */
export function checkRevision(original: string, revised: string, level: EditLevel, strength: EditStrength): Flag[] {
  const flags: Flag[] = [];
  const plainBefore = markupToPlain(original);
  const plainAfter = markupToPlain(revised);

  const namesBefore = properNouns(plainBefore);
  const namesAfter = properNouns(plainAfter);
  const allAfter = plainAfter.toLowerCase();
  const allBefore = plainBefore.toLowerCase();
  const lost = [...namesBefore].some((name) => !allAfter.includes(name.toLowerCase()));
  const gained = [...namesAfter].some((name) => !allBefore.includes(name.toLowerCase()));
  if (lost || gained) flags.push('names');

  if (numbers(plainBefore).join('|') !== numbers(plainAfter).join('|')) flags.push('numbers');

  const wordsBefore = countWords(plainBefore);
  const wordsAfter = countWords(plainAfter);
  const [low, high] = LENGTH_BOUNDS[level][strength];
  if (wordsBefore >= 12 && (wordsAfter < wordsBefore * low || wordsAfter > wordsBefore * high)) flags.push('length');

  if (countFormattedSpans(original) !== countFormattedSpans(revised)) flags.push('formatting');
  if ((plainBefore.match(QUOTES)?.length ?? 0) !== (plainAfter.match(QUOTES)?.length ?? 0)) flags.push('dialogue');

  if (level === 'proofread') {
    const rewrites = diffText(original, revised).filter((h) => classifyChange(h.before, h.after) === 'rewrite').length;
    if (rewrites > 0) flags.push('beyond-proofread');
  }
  return flags;
}
