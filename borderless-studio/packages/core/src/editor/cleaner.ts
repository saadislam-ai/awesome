/**
 * Typography cleaner for the manuscript itself. It proposes edits to the
 * Markdown source (never touching markup, links, code or tracked changes):
 * straight quotes to curly quotes, apostrophes, ellipses, doubled spaces, and
 * the dash policy. The edits can be applied directly or turned into tracked
 * suggestions so each one can be accepted or rejected.
 */
import type { TextStyle } from '../model/book';
import { critic, parseCritic } from '../markdown/critic';
import { maskMarkdown } from '../markdown/mask';
import { CH, dashReplacement } from '../markdown/typography';

export type CleanRule = 'quotes' | 'ellipsis' | 'dash' | 'spaces';

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  rule: CleanRule;
  /** Text being replaced, for the review list. */
  before: string;
}

export interface DashFinding {
  from: number;
  to: number;
  text: string;
  kind: 'em' | 'en' | 'typed';
}

const isSpace = (c: string) => c === '' || /\s/.test(c);
const isOpenPunct = (c: string) => c !== '' && '([{\u2014\u2013-/\u201C\u2018'.includes(c);
const isWordChar = (c: string) => c !== '' && /[\p{L}\p{N}\p{M}]/u.test(c);
const ELISION = /^(?:tis|twas|twere|twill|n)(?![\p{L}])/iu;

/** Where em dashes, en dashes and typed double hyphens are in the prose. */
export function findDashes(src: string, includeTyped = true): DashFinding[] {
  const masked = maskMarkdown(src, { hideDeletions: true });
  const out: DashFinding[] = [];
  const re = includeTyped ? /[\u2013\u2014]|(?<!-)-{2,3}(?!-)/g : /[\u2013\u2014]/g;
  for (const m of masked.matchAll(re)) {
    out.push({ from: m.index, to: m.index + m[0].length, text: m[0], kind: m[0] === CH.emDash ? 'em' : m[0] === CH.enDash ? 'en' : 'typed' });
  }
  return out;
}

/** Proposed typography fixes for one document. Edits never overlap and are sorted by position. */
export function typographyEdits(src: string, style: TextStyle): TextEdit[] {
  // Text inside pending tracked changes is left alone: it is still under review.
  const masked = maskMarkdown(src, { hideDeletions: true, hideInsertions: true });
  const inCritic = parseCritic(src).map((s) => [s.start, s.endWithMeta] as const);
  const blocked = (i: number) => inCritic.some(([a, b]) => i >= a && i < b);
  const edits: TextEdit[] = [];
  const push = (from: number, to: number, insert: string, rule: CleanRule) => {
    if (blocked(from) || src.slice(from, to) === insert) return;
    edits.push({ from, to, insert, rule, before: src.slice(from, to) });
  };

  if (style.smartQuotes) {
    for (let i = 0; i < masked.length; i++) {
      const c = masked[i];
      if (c !== '"' && c !== "'") continue;
      const prev = i > 0 ? masked[i - 1] : '';
      const next = masked[i + 1] ?? '';
      const opening = (isSpace(prev) || isOpenPunct(prev)) && !isSpace(next);
      if (c === '"') {
        push(i, i + 1, opening ? CH.ldquo : CH.rdquo, 'quotes');
      } else if (isWordChar(prev)) {
        push(i, i + 1, CH.rsquo, 'quotes');
      } else {
        const rest = masked.slice(i + 1, i + 8);
        const elision = /^\d\ds?(?!\d)/.test(rest) || ELISION.test(rest);
        push(i, i + 1, opening && !elision ? CH.lsquo : CH.rsquo, 'quotes');
      }
    }
  }

  if (style.ellipsis !== 'leave') {
    const target = style.ellipsis === 'character' ? CH.ellipsis : `.${CH.nbsp}.${CH.nbsp}.`;
    const re = style.ellipsis === 'character' ? /\.[ \u00A0]?\.[ \u00A0]?\.(?!\.)/g : /\u2026|\.[ \u00A0]?\.[ \u00A0]?\.(?!\.)/g;
    for (const m of masked.matchAll(re)) push(m.index, m.index + m[0].length, target, 'ellipsis');
  }

  const policy = style.dashPolicy;
  if (policy.mode === 'replace') {
    for (const d of findDashes(src, policy.includeTypedHyphens)) {
      // Swallow the spaces around the dash so that the replacement is spaced correctly.
      let from = d.from;
      let to = d.to;
      const prev = masked.slice(0, from).trimEnd().slice(-1);
      const next = masked.slice(to).trimStart().slice(0, 1);
      const rep = dashReplacement(d.text, policy, prev, next);
      if (rep.startsWith(',') || rep.startsWith(':') || rep.startsWith(CH.ellipsis)) while (from > 0 && src[from - 1] === ' ') from--;
      if (rep.startsWith(' ')) while (from > 0 && src[from - 1] === ' ') from--;
      if (rep.endsWith(' ')) while (to < src.length && src[to] === ' ') to++;
      push(from, to, rep, 'dash');
    }
  } else if (policy.mode === 'allow') {
    for (const m of masked.matchAll(/(?<!-)---(?!-)/g)) push(m.index, m.index + 3, CH.emDash, 'dash');
    for (const m of masked.matchAll(/(?<!-)--(?!-)/g)) push(m.index, m.index + 2, CH.enDash, 'dash');
  }

  // Doubled spaces inside a line (not indentation, not table padding).
  for (const m of masked.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index) < 0 ? src.length : src.indexOf('\n', m.index));
    if (line.includes('|')) continue;
    push(m.index, m.index + m[0].length, ' ', 'spaces');
  }

  edits.sort((a, b) => a.from - b.from);
  // Drop any overlap (a dash edit that swallowed a doubled space, for example).
  const out: TextEdit[] = [];
  let lastEnd = -1;
  for (const e of edits) {
    if (e.from < lastEnd) continue;
    out.push(e);
    lastEnd = e.to;
  }
  return out;
}

/**
 * Apply edits to the source. With `asSuggestions`, each edit becomes a tracked
 * change (a CriticMarkup substitution) attributed to "cleaner".
 */
export function applyEdits(src: string, edits: TextEdit[], asSuggestions = false): string {
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    out += src.slice(cursor, e.from);
    out += asSuggestions ? critic.substitute(src.slice(e.from, e.to), e.insert, 'cleaner') : e.insert;
    cursor = e.to;
  }
  return out + src.slice(cursor);
}

export function summariseEdits(edits: TextEdit[]): Record<CleanRule, number> {
  const s: Record<CleanRule, number> = { quotes: 0, ellipsis: 0, dash: 0, spaces: 0 };
  for (const e of edits) s[e.rule]++;
  return s;
}
