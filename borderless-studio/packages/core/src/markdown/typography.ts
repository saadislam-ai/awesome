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
import type { Book, DashPolicy, TextStyle } from '../model/book';
import { languageInfo, type QuoteMarks } from '../i18n/languages';
import type { Block, Inline } from './ir';

/** The house style plus the language of the book, which decides the quotation marks. */
export type LocalTextStyle = TextStyle & { language?: string };

/** The text style used when a book is exported. */
export const bookTextStyle = (book: Pick<Book, 'style' | 'language'>): LocalTextStyle => ({ ...book.style, language: book.language });

/** Carried from one text run to the next inside a paragraph. */
export interface SmartenState {
  last: string;
  /** Inner quotations opened and not yet closed. */
  inner?: number;
}

export const CH = {
  ldquo: '\u201C',
  rdquo: '\u201D',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ellipsis: '\u2026',
  emDash: '\u2014',
  enDash: '\u2013',
  nbsp: '\u00A0',
  thinNbsp: '\u202F',
  hyphen: '-',
  prime: '\u2032',
  doublePrime: '\u2033',
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
const isOpenPunct = (c: string) => c !== '' && '([{\u2014\u2013-/\u201C\u2018'.includes(c);
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
    return text.replace(/\.[ \u00A0]?\.[ \u00A0]?\.(?!\.)/g, CH.ellipsis);
  }
  // spaced-dots: three dots held together by non breaking spaces
  return text.replace(/\u2026|\.[ \u00A0]?\.[ \u00A0]?\.(?!\.)/g, `.${CH.nbsp}.${CH.nbsp}.`);
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

const ENGLISH_MARKS = /[\u201C\u201D\u2018\u2019]/;

/**
 * Turn English curly quotes into the marks of another language. A closing
 * single quote is told apart from an apostrophe by counting the inner
 * quotations that are open: "l\u2019ami" keeps its apostrophe.
 */
export function localQuotes(text: string, q: QuoteMarks, state: SmartenState = { last: '' }): string {
  if (!ENGLISH_MARKS.test(text)) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === CH.ldquo) out += q.open;
    else if (c === CH.rdquo) out += q.close;
    else if (c === CH.lsquo) {
      out += q.innerOpen;
      state.inner = (state.inner ?? 0) + 1;
    } else if (c === CH.rsquo && (state.inner ?? 0) > 0 && !isWordChar(text[i + 1] ?? '')) {
      out += q.innerClose;
      state.inner = (state.inner ?? 1) - 1;
    } else out += c;
  }
  return out;
}

/**
 * French spacing: a narrow no-break space inside guillemets and before
 * ; : ! ? so they never start a line. Times (12:30) and web addresses are left alone.
 */
export function frenchSpacing(text: string): string {
  const s = CH.thinNbsp;
  return text
    .replace(/\u00AB[ \u00A0\u202F]*/g, `\u00AB${s}`)
    .replace(/[ \u00A0\u202F]*\u00BB/g, `${s}\u00BB`)
    .replace(/([\p{L}\p{N}\u00BB)\]\u2026])[ \u00A0]?([;:!?])(?=\s|$|[\u00BB!?])/gu, `$1${s}$2`);
}

/** Apply export time typography to one text run. */
export function smartenText(text: string, style: LocalTextStyle, before = '', state: SmartenState = { last: before }): string {
  let t = text;
  t = fixEllipses(t, style.ellipsis);
  t = typedDashes(t, style.dashPolicy);
  const lang = style.language ? languageInfo(style.language) : null;
  if (style.smartQuotes) {
    t = smartQuotes(t, before, style.quoteStyle === 'single');
    const q = lang?.quotes;
    if (q && (q.open !== CH.ldquo || q.close !== CH.rdquo || q.innerOpen !== CH.lsquo || q.innerClose !== CH.rsquo)) t = localQuotes(t, q, state);
  }
  if (lang?.quotes.spaced) t = frenchSpacing(t);
  t = nonBreakingSpaces(t);
  return t;
}

/**
 * Apply export time typography to inline content. Quote direction depends on
 * the neighbouring characters, so the last character of the previous text run
 * is carried across emphasis and other inline boundaries.
 */
export function smartenInlines(inlines: Inline[], style: LocalTextStyle, state: SmartenState = { last: '' }): Inline[] {
  return inlines.map((n): Inline => {
    switch (n.t) {
      case 'text': {
        const v = smartenText(n.v, style, state.last, state);
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

export function smartenBlocks(blocks: Block[], style: LocalTextStyle): Block[] {
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
  const em = (text.match(/\u2014/g) ?? []).length;
  const en = (text.match(/\u2013/g) ?? []).length;
  const typed = includeTyped ? (text.match(/(?<!-)-{2,3}(?!-)/g) ?? []).length : 0;
  return { em, en, typed };
}
