/**
 * Samples, advance reader copies and the in-app ebook preview.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import {
  PREVIEW_THEME_MARKER, assembleProject, bundledSpecsDir, epubPreview, exportEpub, exportInterior, inspectPdf, loadSpecs, openBook, preflightInteriorFile, type BuildContext,
} from '@borderless/core';
import { NodeHost, REPO_ROOT } from '../src/nodeHost';

const host = new NodeHost();
const tmp = path.join(os.tmpdir(), `borderless-extras-${process.pid}`).replace(/\\/g, '/');
let ctx: BuildContext;

beforeAll(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  const { resources } = await host.paths();
  ctx = { host, project: await openBook(host, path.join(REPO_ROOT, 'sample-book').replace(/\\/g, '/')), specs: await loadSpecs(host, bundledSpecsDir(resources)), resourcesDir: resources };
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('samples and advance reader copies', () => {
  it('a sample keeps the first chapters and ends with a page that says where to find the book', async () => {
    const full = await assembleProject(ctx, { formatId: 'ebook' });
    const sample = await assembleProject(ctx, { formatId: 'ebook', sampleChapters: 2, sampleEnding: 'This is the end of the sample.\n\nThe whole book is in the shops.' });
    const chapters = (b: typeof full) => b.sections.filter((s) => s.kind === 'chapter').length;
    expect(chapters(full)).toBeGreaterThan(10);
    expect(chapters(sample)).toBe(2);
    const body = sample.sections.filter((s) => s.zone === 'body');
    const last = body[body.length - 1];
    expect(last.id).toBe('sample-ending');
    expect(JSON.stringify(last.blocks)).toContain('The whole book is in the shops.');
    // Back matter of a sample: only the pages that help a reader find more.
    expect(sample.sections.filter((s) => s.zone === 'back').every((s) => ['about-author', 'also-by'].includes(s.kind))).toBe(true);
    // Without the option nothing is added.
    expect((await assembleProject(ctx, { formatId: 'ebook', sampleChapters: 2 })).sections.some((s) => s.id === 'sample-ending')).toBe(false);
  });

  it('builds the sample as an EPUB and the advance copy as a watermarked PDF without touching the store files', async () => {
    const epub = await exportEpub(ctx, { formatId: 'ebook', sampleChapters: 2, sampleEnding: 'End of the sample.', variant: 'sample', skipCheck: true, outFile: `${tmp}/sample.epub` });
    expect(epub.ok).toBe(true);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(epub.epubPath)));
    const text = Object.keys(zip).filter((n) => n.endsWith('.xhtml')).map((n) => strFromU8(zip[n])).join('\n');
    expect(text).toContain('End of the sample.');
    const arc = await exportInterior(ctx, { formatId: 'paperback', platform: 'kdp', sampleChapters: 1, watermark: 'Advance reader copy', notice: 'Not for sale.', variant: 'arc', pdfStandard: 'plain', outFile: `${tmp}/arc.pdf` });
    expect(arc.ok).toBe(true);
    const report = await inspectPdf(new Uint8Array(fs.readFileSync(arc.pdfPath!)));
    expect(report.pageCount).toBe(arc.pageCount);
    expect(arc.pageCount).toBeLessThan(60);
    // The record of the last real build (used for cover and price) is not replaced by a sample.
    const record = ctx.project.path('.borderless', 'build', 'paperback-kdp-arc', 'last.json');
    expect(fs.existsSync(record)).toBe(false);
  }, 120_000);
});

describe('large print edition', () => {
  it('is held against the large print guidance when its interior is checked', async () => {
    // A copy of the sample book, whose large print edition is set up the way the Editions screen sets one up (16 pt, ragged right, no hyphenation).
    const dir = `${tmp}/large-print-book`;
    fs.cpSync(path.join(REPO_ROOT, 'sample-book'), dir, { recursive: true });
    const project = await openBook(host, dir);
    const edition = project.book.formats.find((f) => f.id === 'large-print')!;
    expect(edition).toMatchObject({ largePrint: true, designOverride: { fontSizePt: 16, justify: false, hyphenate: false } });
    const lp: BuildContext = { ...ctx, project };
    const interior = await exportInterior(lp, { formatId: 'large-print', platform: 'kdp', sampleChapters: 2, variant: 'test', outFile: `${tmp}/large.pdf` });
    expect(interior.ok).toBe(true);
    const report = await preflightInteriorFile(lp, interior, 'kdp');
    const lpChecks = Object.fromEntries(report.checks.filter((c) => c.id.startsWith('lp-')).map((c) => [c.id, c.status]));
    expect(lpChecks).toMatchObject({ 'lp-size': 'info', 'lp-leading': 'pass', 'lp-align': 'pass', 'lp-hyphens': 'pass', 'lp-typeface': 'info' });
    expect(lpChecks['lp-italics']).toBe('info');
    // An ordinary edition is not held against these rules.
    const plain = await exportInterior(lp, { formatId: 'paperback-6x9', platform: 'kdp', sampleChapters: 1, variant: 'test', outFile: `${tmp}/plain.pdf` });
    expect((await preflightInteriorFile(lp, plain, 'kdp')).checks.some((c) => c.id.startsWith('lp-'))).toBe(false);
    // Making the type too small is a failure that says what to do.
    edition.designOverride = { fontSizePt: 13, lineHeight: 1.4, hyphenate: false, justify: false };
    const small = await exportInterior(lp, { formatId: 'large-print', platform: 'kdp', sampleChapters: 1, variant: 'test', outFile: `${tmp}/small.pdf` });
    const failed = (await preflightInteriorFile(lp, small, 'kdp')).checks.find((c) => c.id === 'lp-size')!;
    expect(failed.status).toBe('fail');
    expect(failed.fix).toMatch(/at least 16 pt/);
  }, 180_000);
});

describe('ebook preview', () => {
  it('turns the EPUB into self-contained pages with a contents list', async () => {
    const epub = await exportEpub(ctx, { formatId: 'ebook', skipCheck: true, outFile: `${tmp}/book.epub` });
    const preview = epubPreview(new Uint8Array(fs.readFileSync(epub.epubPath)));
    expect(preview.title).toContain('The Salt Road');
    expect(preview.docs.length).toBe(epub.result.spine.length);
    expect(preview.toc.length).toBeGreaterThan(15);
    expect(preview.toc.some((t) => /The River/.test(t.title))).toBe(true);
    for (const doc of preview.docs) {
      expect(doc.xhtml).toContain(PREVIEW_THEME_MARKER);
      expect(doc.xhtml).not.toMatch(/<link\b/i);
      expect(doc.xhtml).not.toMatch(/<script\b/i);
      // Nothing points outside the page: pictures and fonts are inside it.
      expect(doc.xhtml).not.toMatch(/\bsrc="(?!data:)[^"]+"/);
      expect(doc.xhtml).not.toMatch(/url\("(?!data:)[^"]+"\)/);
      // Links to other pages are switched off; links inside a page (notes) are kept.
      expect(doc.xhtml).not.toMatch(/<a\b[^>]*\shref="[^#"][^"]*"/);
    }
    expect(preview.docs.some((d) => /src="data:image\/(png|jpeg);base64,/.test(d.xhtml))).toBe(true);
    expect(preview.docs.some((d) => /<a\b[^>]*\shref="#/.test(d.xhtml))).toBe(true);
  });

  it('explains what is wrong with a file that is not an EPUB', () => {
    expect(() => epubPreview(new Uint8Array([1, 2, 3]))).toThrow(/could not be opened as an EPUB/);
  });
});
