/**
 * ISBN handling: checksum validation, conversion, hyphenation for display and
 * the publisher's ISBN register (which ISBN is assigned to which format).
 */

export interface IsbnCheck {
  valid: boolean;
  /** 13 digits without hyphens when valid. */
  isbn13?: string;
  /** Plain English explanation when not valid. */
  problem?: string;
}

/** Remove hyphens, spaces and an "ISBN" prefix. */
export function cleanIsbn(input: string): string {
  return input.replace(/^\s*isbn(?:-1[03])?:?\s*/i, '').replace(/[\s‐-―-]/g, '').toUpperCase();
}

/** Check digit for the first 12 digits of an ISBN-13 (weights 1 and 3 alternating). */
export function isbn13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('An ISBN-13 check digit needs exactly 12 digits.');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Check character for the first 9 digits of an ISBN-10 (may be "X"). */
export function isbn10CheckChar(first9: string): string {
  if (!/^\d{9}$/.test(first9)) throw new Error('An ISBN-10 check digit needs exactly 9 digits.');
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

export function isbn10to13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9);
  return core + isbn13CheckDigit(core);
}

/** Validate an ISBN-13 (or convert a valid ISBN-10) and explain any problem. */
export function validateIsbn(input: string): IsbnCheck {
  const s = cleanIsbn(input);
  if (s === '') return { valid: false, problem: 'No ISBN entered.' };
  if (/^\d{9}[\dX]$/.test(s)) {
    if (isbn10CheckChar(s.slice(0, 9)) !== s[9]) {
      return { valid: false, problem: 'This looks like an ISBN-10 but its check digit is wrong. Please retype it.' };
    }
    return { valid: true, isbn13: isbn10to13(s) };
  }
  if (!/^\d+$/.test(s)) return { valid: false, problem: 'An ISBN may only contain digits (and hyphens).' };
  if (s.length !== 13) return { valid: false, problem: `An ISBN-13 has 13 digits; this has ${s.length}.` };
  if (!s.startsWith('978') && !s.startsWith('979')) {
    return { valid: false, problem: 'An ISBN-13 starts with 978 or 979.' };
  }
  const expected = isbn13CheckDigit(s.slice(0, 12));
  if (expected !== Number(s[12])) {
    return {
      valid: false,
      problem: `The check digit is wrong (the last digit should be ${expected}). One of the digits was probably mistyped.`,
    };
  }
  return { valid: true, isbn13: s };
}

/**
 * Hyphenate for display. Correct hyphenation depends on the international
 * range table, which is not bundled, so this function never guesses:
 *
 *   - if the publisher prefix is known (for example "978-0-6480000", as printed
 *     on the list Thorpe-Bowker sends with a block), the ISBN is split exactly
 *     at that prefix;
 *   - otherwise the 13 digits are returned unbroken, which is always valid.
 */
export function formatIsbn(isbn13: string, prefixes: string[] = []): string {
  const s = cleanIsbn(isbn13);
  if (s.length !== 13) return isbn13;
  for (const prefix of prefixes) {
    const digits = cleanIsbn(prefix);
    if (digits.length >= 5 && digits.length <= 11 && s.startsWith(digits)) {
      const head = prefix.trim().replace(/[\s\u2010-\u2015]/g, '-').replace(/-+$/, '');
      return `${head}-${s.slice(digits.length, 12)}-${s[12]}`;
    }
  }
  return s;
}

/** Keep the hyphens a user typed, if (and only if) the digits are a valid ISBN-13. */
export function keepTypedHyphens(input: string): string | undefined {
  const t = input.trim().replace(/^isbn(?:-13)?:?\s*/i, '').replace(/[\s\u2010-\u2015]/g, '-');
  if (!/^\d+(-\d+){3,4}$/.test(t)) return undefined;
  return validateIsbn(t).valid ? t : undefined;
}

/* ------------------------------------------------------------------ */
/* The publisher's ISBN register (library/isbns.json)                  */
/* ------------------------------------------------------------------ */

export interface IsbnRecord {
  isbn: string;
  /** The ISBN exactly as it was typed with hyphens, when it was typed that way. */
  display?: string;
  /** Free label for the block it came from, for example "Thorpe-Bowker block of 10, 2025". */
  block: string;
  assigned: null | {
    bookId: string;
    bookTitle: string;
    formatId: string;
    formatLabel: string;
    date: string;
  };
  /** Registered with the ISBN agency (title details lodged at MyIdentifiers). */
  registered: boolean;
  note: string;
}

export interface IsbnRegister {
  schema: 1;
  /** Publisher prefixes such as "978-0-6480000", used only to hyphenate for display. */
  prefixes: string[];
  records: IsbnRecord[];
}

export const emptyRegister = (): IsbnRegister => ({ schema: 1, prefixes: [], records: [] });

/** Display form of an ISBN from the register: typed hyphens first, then a known prefix, then plain digits. */
export function displayIsbn(register: IsbnRegister | null | undefined, isbn: string): string {
  const s = cleanIsbn(isbn);
  const rec = register?.records.find((r) => r.isbn === s);
  if (rec?.display) return rec.display;
  return formatIsbn(s, register?.prefixes ?? []);
}

export interface AddResult {
  added: string[];
  rejected: { input: string; problem: string }[];
}

/** Add ISBNs (one per line, any punctuation) to the register. Duplicates and invalid numbers are reported, not stored. */
export function addIsbns(register: IsbnRegister, lines: string, block: string): AddResult {
  const result: AddResult = { added: [], rejected: [] };
  for (const raw of lines.split(/[\n,;]+/)) {
    const input = raw.trim();
    if (!input) continue;
    const v = validateIsbn(input);
    if (!v.valid || !v.isbn13) {
      result.rejected.push({ input, problem: v.problem ?? 'Not a valid ISBN.' });
      continue;
    }
    if (register.records.some((r) => r.isbn === v.isbn13)) {
      result.rejected.push({ input, problem: 'Already in the register.' });
      continue;
    }
    register.records.push({ isbn: v.isbn13, display: keepTypedHyphens(input), block, assigned: null, registered: false, note: '' });
    result.added.push(v.isbn13);
  }
  return result;
}

/**
 * Expand a contiguous block from its first ISBN. Thorpe-Bowker sells blocks of
 * 10, 100 or 1000 that differ only in the title digits before the check digit.
 */
export function expandBlock(firstIsbn: string, count: number): string[] {
  const v = validateIsbn(firstIsbn);
  if (!v.valid || !v.isbn13) throw new Error(v.problem ?? 'Not a valid ISBN.');
  const out: string[] = [];
  const base = BigInt(v.isbn13.slice(0, 12));
  for (let i = 0; i < count; i++) {
    const first12 = (base + BigInt(i)).toString().padStart(12, '0');
    out.push(first12 + isbn13CheckDigit(first12));
  }
  return out;
}

export function freeIsbns(register: IsbnRegister): IsbnRecord[] {
  return register.records.filter((r) => !r.assigned);
}

export interface AssignTarget {
  bookId: string;
  bookTitle: string;
  formatId: string;
  formatLabel: string;
}

/**
 * Assign an ISBN to one format of one book. Refuses to reuse an ISBN that
 * already belongs to a different book or format: every format needs its own.
 */
export function assignIsbn(register: IsbnRegister, isbn: string, target: AssignTarget, date: string): IsbnRecord {
  const v = validateIsbn(isbn);
  if (!v.valid || !v.isbn13) throw new Error(v.problem ?? 'Not a valid ISBN.');
  let rec = register.records.find((r) => r.isbn === v.isbn13);
  if (!rec) {
    rec = { isbn: v.isbn13, display: keepTypedHyphens(isbn), block: 'Added on assignment', assigned: null, registered: false, note: '' };
    register.records.push(rec);
  }
  if (rec.assigned && (rec.assigned.bookId !== target.bookId || rec.assigned.formatId !== target.formatId)) {
    throw new Error(
      `ISBN ${displayIsbn(register, rec.isbn)} is already assigned to "${rec.assigned.bookTitle}" (${rec.assigned.formatLabel}). ` +
        'Each format of each book needs its own ISBN.',
    );
  }
  rec.assigned = { ...target, date };
  return rec;
}

export function releaseIsbn(register: IsbnRegister, isbn: string): void {
  const rec = register.records.find((r) => r.isbn === cleanIsbn(isbn));
  if (rec) rec.assigned = null;
}

export interface IsbnProblem {
  isbn: string;
  severity: 'fail' | 'warn';
  message: string;
}

/**
 * Cross check the formats of a book against the register: invalid numbers,
 * the same ISBN on two formats, or an ISBN that the register says belongs
 * somewhere else.
 */
export function checkBookIsbns(
  register: IsbnRegister,
  book: { id: string; title: string; formats: { id: string; label: string; isbn: string; enabled: boolean }[] },
): IsbnProblem[] {
  const problems: IsbnProblem[] = [];
  const seen = new Map<string, string>();
  for (const f of book.formats) {
    if (!f.enabled || !f.isbn) continue;
    const v = validateIsbn(f.isbn);
    if (!v.valid || !v.isbn13) {
      problems.push({ isbn: f.isbn, severity: 'fail', message: `${f.label || f.id}: ${v.problem}` });
      continue;
    }
    const other = seen.get(v.isbn13);
    if (other) {
      problems.push({
        isbn: v.isbn13,
        severity: 'fail',
        message: `The same ISBN is used for "${other}" and "${f.label || f.id}". Each format needs its own ISBN.`,
      });
    }
    seen.set(v.isbn13, f.label || f.id);
    const rec = register.records.find((r) => r.isbn === v.isbn13);
    if (!rec) {
      problems.push({ isbn: v.isbn13, severity: 'warn', message: `ISBN ${displayIsbn(register, v.isbn13)} is not in your ISBN register.` });
    } else if (rec.assigned && (rec.assigned.bookId !== book.id || rec.assigned.formatId !== f.id)) {
      problems.push({
        isbn: v.isbn13,
        severity: 'fail',
        message: `ISBN ${displayIsbn(register, v.isbn13)} is registered to "${rec.assigned.bookTitle}" (${rec.assigned.formatLabel}).`,
      });
    }
  }
  return problems;
}
