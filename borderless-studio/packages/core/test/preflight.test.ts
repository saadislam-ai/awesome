/**
 * Preflight must catch real problems. These tests hand it deliberately
 * broken files and books and check that each fault is reported.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  BookSchema, encodePng, formatPreflight, inspectPdf, interiorRules, languageProblem, manuscriptChecks, parsePlatformSpec, preflightEpub,
  preflightInterior, type Book, type Check, type EpubCheckResult, type PreflightReport, type RasterImage,
} from '../src/index';

const specsDir = path.resolve(__dirname, '..', '..', '..', 'specs');
const spec = (name: string) => parsePlatformSpec(fs.readFileSync(path.join(specsDir, `${name}.json`), 'utf8')).value!;
const kdp = spec('kdp');
const ingram = spec('ingramspark');
const d2d = spec('draft2digital');

function book(overrides: Record<string, unknown> = {}): Book {
  return BookSchema.parse({
    id: 'bk_test', title: 'A Test Book', contributors: [{ name: 'A. Writer', role: 'author' }], language: 'en-AU',
    formats: [
      { id: 'paperback', type: 'paperback', label: 'Paperback', trim: '5.5x8.5', isbn: '9781234567897', platforms: ['kdp', 'ingramspark'] },
      { id: 'ebook', type: 'ebook', label: 'Ebook', isbn: '9781234567910', platforms: ['kdp', 'draft2digital'] },
    ],
    ...overrides,
  });
}

const find = (r: PreflightReport, id: string): Check => {
  const c = r.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check "${id}" in: ${r.checks.map((x) => x.id).join(', ')}`);
  return c;
};

/** A small PDF with a list of faults: wrong size on one page, text in the gutter, an unembedded font, a coarse RGB picture, a link. */
async function faultyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); // standard fonts are referenced, not embedded
  const w = 5.5 * 72;
  const h = 8.5 * 72;
  for (let i = 0; i < 30; i++) {
    const page = doc.addPage(i === 4 ? [w + 20, h] : [w, h]);
    // 0.75 in margins everywhere, except page 3 where the text starts 0.1 in from the spine edge.
    page.drawText('Body text of the page for measuring margins.', { x: i === 2 ? 7 : 60, y: h / 2, size: i === 6 ? 5 : 11, font, color: i === 7 ? rgb(0.8, 0, 0) : undefined });
  }
  const px = 90;
  const data = new Uint8Array(px * px * 3).fill(120);
  const img = await doc.embedPng(encodePng({ width: px, height: px, channels: 3, data } as RasterImage));
  doc.getPage(9).drawImage(img, { x: 60, y: 100, width: 216, height: 216 }); // 90 px over 3 in = 30 dpi
  return doc.save({ useObjectStreams: false });
}

describe('interior preflight on a faulty file', () => {
  it('reports every planted fault', async () => {
    const bytes = await faultyPdf();
    const b = book();
    const report = preflightInterior({
      report: await inspectPdf(bytes), spec: ingram, rules: interiorRules(ingram, 'paperback'), book: b, format: b.formats[0],
      trim: { widthIn: 5.5, heightIn: 8.5 }, pageLimits: { min: 18, max: 1050 }, fileSizeBytes: bytes.length,
    });
    expect(report.ready).toBe(false);
    expect(find(report, 'page-size').status).toBe('fail');
    expect(find(report, 'page-size').pages).toEqual([5]);
    expect(find(report, 'last-page').status).toBe('fail');
    expect(find(report, 'margin-inside').status).toBe('fail');
    expect(find(report, 'margin-inside').pages).toContain(3);
    expect(find(report, 'fonts-embedded').status).toBe('fail');
    expect(find(report, 'picture-dpi').status).toBe('fail');
    expect(find(report, 'picture-dpi').detail).toMatch(/30 dpi/);
    expect(find(report, 'picture-colour').status).toBe('warn');
    expect(find(report, 'picture-space').status).toBe('fail');
    expect(find(report, 'text-colour').status).toBe('fail');
    // The test file writes all its text in RGB (page 8 in red), so every page is reported.
    expect(find(report, 'text-colour').pages).toContain(8);
    // IngramSpark prefers PDF/X but does not refuse an ordinary PDF: a note, not a failure.
    expect(find(report, 'pdf-standard').status).toBe('info');
    // Failures are listed first, and the text report says what to do.
    expect(report.checks[0].status).toBe('fail');
    const text = formatPreflight(report);
    expect(text).toMatch(/Not ready: \d+ problems to fix/);
    expect(text).toMatch(/What to do:/);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it('applies the KDP minimum type size and page limits', async () => {
    const bytes = await faultyPdf();
    const b = book();
    const report = preflightInterior({
      report: await inspectPdf(bytes), spec: kdp, rules: interiorRules(kdp, 'paperback'), book: b, format: b.formats[0],
      trim: { widthIn: 5.5, heightIn: 8.5 }, pageLimits: { min: 72, max: 828 }, fileSizeBytes: bytes.length,
    });
    expect(find(report, 'font-size').status).toBe('warn');
    expect(find(report, 'font-size').pages).toEqual([7]);
    expect(find(report, 'page-count').status).toBe('fail');
    expect(find(report, 'page-count').detail).toMatch(/30 pages/);
  });
});

describe('book level checks', () => {
  it('fails a Bangla book on KDP and names the reason', () => {
    expect(languageProblem(kdp, 'paperback', 'bn-BD')).toMatch(/does not list "bn"/);
    expect(languageProblem(kdp, 'ebook', 'bn')).toMatch(/Bengali/);
    expect(languageProblem(kdp, 'paperback', 'en-AU')).toBeNull();
    expect(languageProblem(ingram, 'paperback', 'bn-BD')).toBeNull();
    expect(languageProblem(d2d, 'paperback', 'bn')).toMatch(/Latin/);
  });

  it('warns about a missing ISBN and fails a reused or invalid one', async () => {
    const check: EpubCheckResult = { ran: true, passed: true, errors: 0, warnings: 0, issues: [], checker: 'EPUBCheck 5.4.0' };
    const none = book({ formats: [{ id: 'ebook', type: 'ebook', label: 'Ebook', platforms: ['kdp'] }] });
    expect(find(preflightEpub({ spec: kdp, book: none, format: none.formats[0], check, fileSizeBytes: 1000 }), 'isbn').status).toBe('warn');
    const twice = book({ formats: [
      { id: 'paperback', type: 'paperback', label: 'Paperback', isbn: '9781234567897' },
      { id: 'ebook', type: 'ebook', label: 'Ebook', isbn: '9781234567897' },
    ] });
    const r = preflightEpub({ spec: kdp, book: twice, format: twice.formats[1], check, fileSizeBytes: 1000 });
    expect(find(r, 'isbn-reuse').status).toBe('fail');
    const bad = book({ formats: [{ id: 'ebook', type: 'ebook', label: 'Ebook', isbn: '9781234567890' }] });
    expect(find(preflightEpub({ spec: kdp, book: bad, format: bad.formats[0], check, fileSizeBytes: 1000 }), 'isbn').status).toBe('fail');
  });
});

describe('ebook preflight', () => {
  const b = book();
  const ebook = b.formats[1];
  const ok: EpubCheckResult = { ran: true, passed: true, errors: 0, warnings: 0, issues: [], checker: 'EPUBCheck 5.4.0' };
  const cover = (width: number, height: number, format: 'jpeg' | 'png' = 'jpeg', color: 'rgb' | 'cmyk' = 'rgb') =>
    ({ info: { format, width, height, color, hasAlpha: false, hasIccProfile: false }, sizeBytes: 800_000 });

  it('passes a valid file with the recommended cover', () => {
    const r = preflightEpub({ spec: kdp, book: b, format: ebook, check: ok, fileSizeBytes: 500_000, cover: cover(1600, 2560) });
    expect(r.ready).toBe(true);
    expect(r.counts.warn).toBe(0);
    expect(find(r, 'cover').status).toBe('pass');
  });

  it('fails EPUBCheck errors, a tiny cover, a CMYK cover and an oversized file', () => {
    const failed: EpubCheckResult = { ...ok, passed: false, errors: 3 };
    expect(find(preflightEpub({ spec: kdp, book: b, format: ebook, check: failed, fileSizeBytes: 1 }), 'epubcheck').status).toBe('fail');
    expect(find(preflightEpub({ spec: kdp, book: b, format: ebook, check: ok, fileSizeBytes: 1, cover: cover(400, 640) }), 'cover').status).toBe('fail');
    expect(find(preflightEpub({ spec: kdp, book: b, format: ebook, check: ok, fileSizeBytes: 1, cover: cover(1600, 2560, 'jpeg', 'cmyk') }), 'cover').detail).toMatch(/CMYK/);
    expect(find(preflightEpub({ spec: kdp, book: b, format: ebook, check: ok, fileSizeBytes: 700 * 1024 * 1024 }), 'file-size').status).toBe('fail');
  });

  it('knows that Draft2Digital wants a different cover shape than KDP', () => {
    const r = preflightEpub({ spec: d2d, book: b, format: ebook, check: ok, fileSizeBytes: 1, cover: cover(1600, 2560) });
    expect(find(r, 'cover').status).toBe('warn');
    expect(find(r, 'cover').detail).toMatch(/1600 x 2400/);
  });

  it('treats a missing EPUBCheck as a failure only where validation is required', () => {
    const missing: EpubCheckResult = { ran: false, passed: false, errors: 0, warnings: 0, issues: [], checker: '', problem: 'Java was not found.' };
    expect(find(preflightEpub({ spec: kdp, book: b, format: ebook, check: missing, fileSizeBytes: 1 }), 'epubcheck').status).toBe('warn');
    expect(find(preflightEpub({ spec: d2d, book: b, format: ebook, check: missing, fileSizeBytes: 1 }), 'epubcheck').status).toBe('fail');
  });
});

describe('manuscript checks', () => {
  it('finds open tracked changes, placeholders and long dashes', () => {
    const b = book();
    const docs = [
      { nodeId: 'a', title: 'One', text: 'A clean paragraph.\n\nShe {++quickly++} left. {>>check this<<}' },
      { nodeId: 'b', title: 'Two', text: 'The year was TK and the rain \u2014 as always \u2014 fell.' },
    ];
    const checks = manuscriptChecks(docs, b);
    const by = (id: string) => checks.find((c) => c.id === id)!;
    expect(by('tracked-changes').status).toBe('warn');
    expect(by('tracked-changes').detail).toMatch(/1 tracked change and 1 comment/);
    expect(by('tracked-changes').nodeId).toBe('a');
    expect(by('placeholders').detail).toMatch(/"TK"/);
    expect(by('placeholders').nodeId).toBe('b');
    expect(by('dashes').status).toBe('warn');
    expect(by('dashes').detail).toMatch(/2 long dashes/);
  });

  it('is silent about dashes when the style rules allow them', () => {
    const b = book({ style: { dashPolicy: { mode: 'allow' } } });
    const checks = manuscriptChecks([{ nodeId: 'a', title: 'One', text: 'Rain \u2014 again.' }], b);
    expect(checks.find((c) => c.id === 'dashes')).toBeUndefined();
    expect(checks.find((c) => c.id === 'tracked-changes')!.status).toBe('pass');
  });
});
