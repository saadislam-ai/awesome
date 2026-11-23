/**
 * Typography rules: smart quotes, apostrophes, ellipses, non breaking spaces
 * and the dash policy. Two users of this file:
 *
 *   1. The exporters call `smartenInlines` so that printed and ebook text has
 *      proper quotation marks even if the manuscript was typed with straight
 *      ones. This never changes the manuscript files.
 *   2. The Typography cleaner in the editor calls `cleanTypography` to list
 *      proposed fixes for the manuscript itself.
 *
 * Special characters are written as escapes on purpose so this source file
 * stays plain ASCII and no editor can silently "fix" them.
 */
import type { DashPolicy, TextStyle } from '../model/book';
import type { Block, Inline } from './ir';

export const CH = {
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  ellipsis: '…',
  emDash: '—',
  enDash: '–',
  nbsp: ' ',
  thinNbsp: ' ',
  hyphen: '-',
  prime: '′',
  doublePrime: '″',
} as const;

/**
 * Words that start with an apostrophe (an elision), where a "smart" opening
 * quote would be wrong. The short list is used when dialogue itself is set in
 * single quotes, because there a sentence such as 'Em, come here' really does
 * start with an opening quote.
 */
const ELISIONS_SAFE = ['tis', 'twas', 'twere', 'twill', 'n'];
const ELISIONS_MORE = ['til', 'em', 'cause', 'cos', 'coz', 'bout', 'neath', 'tween', 'twixt', 'nuff'];
const elisionRe = (list: string[]) => new RegExp(`^(?:${list.join('|')})(?![\\p{L}])`, 'iu');
const ELISION_SAFE_RE = elisionRe(ELISIONS_SAFE);
const ELISION_ALL_RE = elisionRe([...ELISIONS_SAFE, ...ELISIONS_MORE]);

const isSpace = (c: string) => c === '' || /\s/.test(c) || c === CH.nbsp;
const isOpenPunct = (c: string) => c !== '' && '([{—–-/“‘'.includes(c);
const isWordChar = (c: string) => c !== '' && /[\p{L}\p{N}\p{M}]/u.test(c);

/**
 * Convert straight quotes in a single string to curly quotes and apostrophes.
 * `before` is the character that precedes the string (used when a paragraph
 * is split across several inline nodes). `singleDialogue` says that the book
 * sets dialogue in single quotes.
 */
export function smartQuotes(text: string, before = '', singleDialogue = false): string {
  if (!/["']/.test(text)) return text;
  const elision = singleDialogue ? ELISION_SAFE_RE : ELISION_ALL_RE;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '"' && c !== "'") {
      out += c;
      continue;
    }
    const prev = out.length ? out[out.length - 1] : before;
    const next = text[i + 1] ?? '';
    const opening = (isSpace(prev) || isOpenPunct(prev)) && !isSpace(next);
    if (c === '"') {
      out += opening ? CH.ldquo : CH.rdquo;
      continue;
    }
    // Single quote or apostrophe. After a letter or digit it is an apostrophe
    // or a closing quote, which are the same character.
    if (isWordChar(prev)) {
      out += CH.rsquo;
      continue;
    }
    const rest = text.slice(i + 1);
    if (/^\d\ds?(?!\d)/.test(rest) || elision.test(rest)) {
      // '90s, 'tis: an apostrophe, not an opening quote.
      out += CH.rsquo;
      continue;
    }
    out += opening ? CH.lsquo : CH.rsquo;
  }
  return out;
}

/** Honorifics that should not be separated from the name that follows. */
const HONORIFICS = ['Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'Fr', 'Rev', 'Hon', 'Capt', 'Lt', 'Col', 'Gen', 'Sgt'];
const HONORIFIC_RE = new RegExp(`\\b(${HONORIFICS.join('|')})(\\.?) (?=\\p{Lu})`, 'gu');
const UNIT_RE = /(\d) (?=(?:mm|cm|km|kg|mg|ml|kB|MB|GB|am|pm|a\.m\.|p\.m\.|BC|AD|BCE|CE|per cent|percent)\b)/g;
const INITIALS_RE = /\b(\p{Lu}\.) (?=\p{Lu}\.)/gu;
const PAGE_REF_RE = /\b(pp?\.|no\.|vol\.|ch\.|fig\.|c\.) (?=\d)/gi;

/** Insert non breaking spaces where a line break would look wrong. */
export function nonBreakingSpaces(text: string): string {
  return text
    .replace(HONORIFIC_RE, `$1$2${CH.nbsp}`)
    .replace(UNIT_RE, `$1${CH.nbsp}`)
    .replace(INITIALS_RE, `$1${CH.nbsp}`)
    .replace(PAGE_REF_RE, `$1${CH.nbsp}`);
}

/** Normalise ellipses according to the house style. */
export function fixEllipses(text: string, mode: TextStyle['ellipsis']): string {
  if (mode === 'leave') return text;
  if (mode === 'character') {
    return text.replace(/\.[  ]?\.[  ]?\.(?!\.)/g, CH.ellipsis);
  }
  // spaced-dots: three dots held together by non breaking spaces
  return text.replace(/…|\.[  ]?\.[  ]?\.(?!\.)/g, `.${CH.nbsp}.${CH.nbsp}.`);
}

/**
 * Typed dashes. When the house style allows dashes, "---" and "--" become
 * real em and en dashes at export. When it does not, they are left exactly as
 * typed so nothing is hidden: the preflight report flags them instead.
 */
export function typedDashes(text: string, policy: DashPolicy): string {
  if (policy.mode !== 'allow') return text;
  return text.replace(/(^|[^-])---(?!-)/g, `$1${CH.emDash}`).replace(/(^|[^-])--(?!-)/g, `$1${CH.enDash}`);
}

/** Replacement for one dash according to the policy. `rangeContext` is true between two digits. */
export function dashReplacement(dash: string, policy: DashPolicy, prev: string, next: string): string {
  const between = /\d/.test(prev) && /\d/.test(next);
  if (between) return policy.enDashRangeReplacement === 'to' ? ' to ' : '-';
  switch (policy.emDashReplacement) {
    case 'comma':
      return ', ';
    case 'colon':
      return ': ';
    case 'ellipsis':
      return CH.ellipsis + ' ';
    case 'spaced-hyphen':
    default:
      return ' - ';
  }
}

/** Apply export time typography to one text run. */
export function smartenText(text: string, style: TextStyle, before = ''): string {
  let t = text;
  t = fixEllipses(t, style.ellipsis);
  t = typedDashes(t, style.dashPolicy);
  if (style.smartQuotes) t = smartQuotes(t, before, style.quoteStyle === 'single');
  t = nonBreakingSpaces(t);
  return t;
}

/**
 * Apply export time typography to inline content. Quote direction depends on
 * the neighbouring characters, so the last character of the previous text run
 * is carried across emphasis and other inline boundaries.
 */
export function smartenInlines(inlines: Inline[], style: TextStyle, state = { last: '' }): Inline[] {
  return inlines.map((n): Inline => {
    switch (n.t) {
      case 'text': {
        const v = smartenText(n.v, style, state.last);
        if (v.length) state.last = v[v.length - 1];
        return { t: 'text', v };
      }
      case 'em':
      case 'strong':
      case 'sc':
      case 'sup':
      case 'sub':
      case 'mark':
        return { ...n, c: smartenInlines(n.c, style, state) };
      case 'link':
        return { ...n, c: smartenInlines(n.c, style, state) };
      case 'fn':
        return { ...n, c: smartenBlocks(n.c, style) };
      case 'br':
        state.last = '';
        return n;
      case 'code':
        state.last = 'x';
        return n;
      default:
        return n;
    }
  });
}

export function smartenBlocks(blocks: Block[], style: TextStyle): Block[] {
  return blocks.map((b): Block => {
    switch (b.t) {
      case 'p':
      case 'h':
        return { ...b, c: smartenInlines(b.c, style) };
      case 'quote':
      case 'align':
        return { ...b, c: smartenBlocks(b.c, style) };
      case 'callout':
        return { ...b, title: b.title ? smartenInlines(b.title, style) : undefined, c: smartenBlocks(b.c, style) };
      case 'list':
        return { ...b, items: b.items.map((it) => smartenBlocks(it, style)) };
      case 'verse':
        return { ...b, stanzas: b.stanzas.map((st) => st.map((line) => smartenInlines(line, style))) };
      case 'table':
        return {
          ...b,
          head: b.head.map((c) => smartenInlines(c, style)),
          rows: b.rows.map((r) => r.map((c) => smartenInlines(c, style))),
          caption: b.caption ? smartenInlines(b.caption, style) : undefined,
        };
      case 'figure':
        return { ...b, caption: b.caption ? smartenInlines(b.caption, style) : undefined };
      default:
        return b;
    }
  });
}

/** Count em and en dashes (and typed double hyphens) in plain text. */
export function countDashes(text: string, includeTyped = true): { em: number; en: number; typed: number } {
  const em = (text.match(/—/g) ?? []).length;
  const en = (text.match(/–/g) ?? []).length;
  const typed = includeTyped ? (text.match(/(?<!-)-{2,3}(?!-)/g) ?? []).length : 0;
  return { em, en, typed };
}
