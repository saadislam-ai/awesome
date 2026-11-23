/** Small text helpers shared by exporters and analysis code. */

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

export function fromUtf8(b: Uint8Array): string {
  return decoder.decode(b);
}

/**
 * Count words the way authors expect: runs of letters or digits, with inner
 * apostrophes and hyphens kept inside one word. Works for Latin and Bengali
 * text because it relies on Unicode letter and mark classes.
 */
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['\u2019\-][\p{L}\p{N}\p{M}]+)*/gu;

export function countWords(text: string): number {
  const m = text.match(WORD_RE);
  return m ? m.length : 0;
}

export function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/** ISO date (YYYY-MM-DD) for a Date in local time. */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Timestamp that is safe inside file names on every platform: 2026-11-23_04-32-46. */
export function fileStamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** The same with milliseconds (2026-11-23_04-32-46-123), for files that can be created in quick succession. */
export function fileStampMs(d: Date = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

/** Round to a fixed number of decimals without floating point noise. */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Roman numerals for front matter page numbers and part numbers. */
export function toRoman(n: number, upper = false): string {
  if (n <= 0 || n >= 4000) return String(n);
  const map: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let out = '';
  let rest = n;
  for (const [v, s] of map) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return upper ? out.toUpperCase() : out;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Spell out a chapter number in English ("Twenty-One"). Falls back to digits above 999. */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = n % 10;
    return o ? `${t}-${ONES[o]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  const r = n % 100;
  return r ? `${h} and ${numberToWords(r)}` : h;
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

/** Bengali digits for Bangla page and chapter numbers. */
export function toBengaliDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x09e6 + Number(d)));
}

/** Stable, fast, non cryptographic hash (FNV-1a, 32 bit) rendered as hex. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
