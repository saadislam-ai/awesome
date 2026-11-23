import { describe, expect, it } from 'vitest';
import {
  addIsbns, assignIsbn, checkBookIsbns, cleanIsbn, displayIsbn, emptyRegister, expandBlock, formatIsbn, freeIsbns,
  isbn10to13, isbn13CheckDigit, validateIsbn,
} from '../src/isbn';

describe('ISBN checksum', () => {
  it('computes the ISBN-13 check digit', () => {
    expect(isbn13CheckDigit('978030640615')).toBe(7); // the worked example in the ISBN manual
    expect(isbn13CheckDigit('978186197271')).toBe(2);
    expect(isbn13CheckDigit('978123456789')).toBe(7);
  });

  it('accepts valid ISBN-13 numbers with or without hyphens', () => {
    expect(validateIsbn('978-0-306-40615-7')).toEqual({ valid: true, isbn13: '9780306406157' });
    expect(validateIsbn('ISBN 9781861972712').valid).toBe(true);
    expect(validateIsbn('979-10-90636-07-1').valid).toBe(true);
  });

  it('rejects a wrong check digit and says what it should be', () => {
    const r = validateIsbn('978-0-306-40615-8');
    expect(r.valid).toBe(false);
    expect(r.problem).toContain('should be 7');
  });

  it('rejects wrong lengths, letters and wrong prefixes', () => {
    expect(validateIsbn('97803064061').valid).toBe(false);
    expect(validateIsbn('97803064O6157').valid).toBe(false);
    expect(validateIsbn('1234567890128').problem).toContain('978 or 979');
    expect(validateIsbn('').valid).toBe(false);
  });

  it('converts a valid ISBN-10 and rejects a bad one', () => {
    expect(isbn10to13('0306406152')).toBe('9780306406157');
    expect(validateIsbn('0-306-40615-2')).toEqual({ valid: true, isbn13: '9780306406157' });
    expect(validateIsbn('0-306-40615-3').valid).toBe(false);
    expect(validateIsbn('080442957X').valid).toBe(true);
  });

  it('cleans punctuation', () => {
    expect(cleanIsbn(' ISBN-13: 978 0 306 40615 7 ')).toBe('9780306406157');
  });
});

describe('ISBN display', () => {
  it('never guesses hyphens without a known publisher prefix', () => {
    expect(formatIsbn('9780648000013')).toBe('9780648000013');
  });
  it('splits exactly at a known publisher prefix', () => {
    expect(formatIsbn('9780648000013', ['978-0-6480000'])).toBe('978-0-6480000-1-3');
  });
  it('keeps hyphens exactly as they were typed into the register', () => {
    const reg = emptyRegister();
    addIsbns(reg, '978-0-306-40615-7', 'test');
    expect(displayIsbn(reg, '9780306406157')).toBe('978-0-306-40615-7');
  });
});

describe('ISBN register', () => {
  it('adds a block, reports duplicates and invalid numbers', () => {
    const reg = emptyRegister();
    const block = expandBlock('978-1-234567-80-4', 10);
    expect(block).toHaveLength(10);
    expect(block.every((i) => validateIsbn(i).valid)).toBe(true);
    const res = addIsbns(reg, block.join('\n') + '\n9781234567804\n978123', 'Block of 10');
    expect(res.added).toHaveLength(10);
    expect(res.rejected).toHaveLength(2);
    expect(freeIsbns(reg)).toHaveLength(10);
  });

  it('assigns one ISBN per format and refuses reuse', () => {
    const reg = emptyRegister();
    const [a, b] = expandBlock('9781234567804', 2);
    addIsbns(reg, `${a}\n${b}`, 'b');
    assignIsbn(reg, a, { bookId: 'bk1', bookTitle: 'One', formatId: 'paperback', formatLabel: 'Paperback' }, '2026-11-23');
    expect(freeIsbns(reg)).toHaveLength(1);
    expect(() => assignIsbn(reg, a, { bookId: 'bk1', bookTitle: 'One', formatId: 'ebook', formatLabel: 'Ebook' }, '2026-11-23')).toThrow(/already assigned/);
    expect(() => assignIsbn(reg, a, { bookId: 'bk2', bookTitle: 'Two', formatId: 'paperback', formatLabel: 'Paperback' }, '2026-11-23')).toThrow(/own ISBN/);
    // Assigning the same ISBN to the same format again is harmless.
    expect(() => assignIsbn(reg, a, { bookId: 'bk1', bookTitle: 'One', formatId: 'paperback', formatLabel: 'Paperback' }, '2026-11-24')).not.toThrow();
  });

  it('finds the same ISBN on two formats and ISBNs registered elsewhere', () => {
    const reg = emptyRegister();
    const [a, b] = expandBlock('9781234567804', 2);
    addIsbns(reg, `${a}\n${b}`, 'b');
    assignIsbn(reg, b, { bookId: 'other', bookTitle: 'Other Book', formatId: 'ebook', formatLabel: 'Ebook' }, '2026-01-01');
    const problems = checkBookIsbns(reg, {
      id: 'bk1', title: 'One',
      formats: [
        { id: 'paperback', label: 'Paperback', isbn: a, enabled: true },
        { id: 'hardcover', label: 'Hardcover', isbn: a, enabled: true },
        { id: 'ebook', label: 'Ebook', isbn: b, enabled: true },
        { id: 'lp', label: 'Large print', isbn: '9780306406158', enabled: true },
      ],
    });
    expect(problems.some((p) => /same ISBN/.test(p.message))).toBe(true);
    expect(problems.some((p) => /registered to "Other Book"/.test(p.message))).toBe(true);
    expect(problems.some((p) => /check digit/.test(p.message))).toBe(true);
  });
});
