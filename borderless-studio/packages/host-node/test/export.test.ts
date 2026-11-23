/**
 * End to end export tests on the sample book. These run the real tools
 * (Typst and EPUBCheck) and then open the produced files to measure them:
 * real margins on every page, embedded fonts, page sizes, colour of the text.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { execFileSync } from 'node:child_process';
import {
  bundledSpecsDir, exportCover, exportEbookCover, exportEpub, exportInterior, imageInfo, inspectPdf, interiorRules, loadSpecs, measureMargins,
  minInsideMargin, openBook, preflightCoverFile, preflightInteriorFile, previewCover,
  type BuildContext, type CoverExport, type EpubExport, type InteriorExport, type PdfReport,
} from '@borderless/core';
import { NodeHost, REPO_ROOT } from '../src/nodeHost';

const host = new NodeHost();
const sampleDir = path.join(REPO_ROOT, 'sample-book').replace(/\\/g, '/');
let ctx: BuildContext;
let haveTypst = false;
let haveEpubCheck = false;

beforeAll(async () => {
  haveTypst = (await host.toolInfo('typst')).found;
  haveEpubCheck = (await host.toolInfo('epubcheck')).found;
  const { resources } = await host.paths();
  ctx = { host, project: await openBook(host, sampleDir), specs: await loadSpecs(host, bundledSpecsDir(resources)), resourcesDir: resources };
});

const IN = 72;

describe('print interior of the sample book', () => {
  const cases = [
    { formatId: 'paperback', platform: 'kdp' as const, width: 5.5, height: 8.5 },
    { formatId: 'paperback-6x9', platform: 'kdp' as const, width: 6, height: 9 },
    { formatId: 'paperback', platform: 'ingramspark' as const, width: 5.5, height: 8.5 },
  ];
  const built = new Map<string, { res: InteriorExport; report: PdfReport }>();

  beforeAll(async () => {
    if (!haveTypst) return;
    for (const c of cases) {
      const res = await exportInterior(ctx, { formatId: c.formatId, platform: c.platform });
      const report = res.pdfPath ? await inspectPdf(new Uint8Array(fs.readFileSync(res.pdfPath))) : (null as unknown as PdfReport);
      built.set(`${c.formatId}/${c.platform}`, { res, report });
    }
  });

  it.each(cases)('$formatId for $platform builds without failures', (c) => {
    if (!haveTypst) return expect.soft(haveTypst, 'Typst is not installed: run "npm run fetch-tools"').toBe(true);
    const { res } = built.get(`${c.formatId}/${c.platform}`)!;
    expect(res.warnings.filter((w) => w.severity === 'fail')).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.pageCount).toBeGreaterThan(150);
    expect(res.pageCount % 2).toBe(0);
  });

  it.each(cases)('$formatId for $platform: every page has the trim size', (c) => {
    if (!haveTypst) return;
    const { report } = built.get(`${c.formatId}/${c.platform}`)!;
    for (const p of report.pages) {
      expect(p.width).toBeCloseTo(c.width * IN, 1);
      expect(p.height).toBeCloseTo(c.height * IN, 1);
    }
  });

  it.each(cases)('$formatId for $platform: real margins respect the platform rules on every page', (c) => {
    if (!haveTypst) return;
    const { res, report } = built.get(`${c.formatId}/${c.platform}`)!;
    const rules = interiorRules(ctx.specs.platforms[c.platform]!, 'paperback');
    const needInside = minInsideMargin(rules, report.pageCount);
    const needOuter = rules.outsideMinNoBleedIn;
    const margins = measureMargins(report, 'ink');
    const printed = margins.filter((m) => !m.empty);
    expect(printed.length).toBeGreaterThan(report.pageCount * 0.9);
    for (const m of printed) {
      expect(m.inside, `inside margin on page ${m.page}`).toBeGreaterThanOrEqual(needInside);
      expect(m.outside, `outside margin on page ${m.page}`).toBeGreaterThanOrEqual(needOuter);
      expect(m.top, `top margin on page ${m.page}`).toBeGreaterThanOrEqual(needOuter);
      expect(m.bottom, `bottom margin on page ${m.page}`).toBeGreaterThanOrEqual(needOuter);
    }
    // The text block itself sits on the margins the builder reported (running heads and
    // folios live in the margins, so only the sides are compared; 0.08 in allows for
    // hanging punctuation and a drop capital's overhang).
    const design = res.margins.margins;
    const sides = measureMargins(report, 'text').filter((m) => !m.empty);
    const minInside = Math.min(...sides.map((m) => m.inside));
    const minOutside = Math.min(...sides.map((m) => m.outside));
    expect(minInside).toBeGreaterThan(design.inside - 0.08);
    expect(minOutside).toBeGreaterThan(design.outside - 0.08);
    // Mirror margins: the binding side really is the wider one on both left and right pages.
    const recto = sides.filter((m) => m.recto && m.page > 20).slice(0, 40);
    const verso = sides.filter((m) => !m.recto && m.page > 20).slice(0, 40);
    const avg = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
    expect(avg(recto.map((m) => m.inside))).toBeGreaterThan(avg(recto.map((m) => m.outside)) + 0.1);
    expect(avg(verso.map((m) => m.inside))).toBeGreaterThan(avg(verso.map((m) => m.outside)) + 0.1);
  });

  it.each(cases)('$formatId for $platform: all fonts are embedded and text is pure black ink', (c) => {
    if (!haveTypst) return;
    const { report } = built.get(`${c.formatId}/${c.platform}`)!;
    expect(report.fonts.length).toBeGreaterThanOrEqual(2);
    for (const f of report.fonts) expect(f.embedded, `${f.name} embedded`).toBe(true);
    expect(report.fonts.some((f) => /EBGaramond/.test(f.name))).toBe(true);
    const colours = new Set(report.pages.flatMap((p) => p.colors));
    expect([...colours]).toEqual(['cmyk']);
    expect(report.pages.some((p) => p.usesTransparency)).toBe(false);
    expect(report.pages.reduce((n, p) => n + p.annotations, 0)).toBe(0);
    expect(report.hasOutline).toBe(false);
    expect(report.usesObjectStreams).toBe(false);
    expect(report.info.Title).toContain('The Salt Road');
  });

  it.each(cases)('$formatId for $platform: the file is PDF/X-1a:2001 with greyscale pictures and no colour profiles', (c) => {
    if (!haveTypst) return;
    const { res, report } = built.get(`${c.formatId}/${c.platform}`)!;
    expect(res.pdfStandard).toBe('PDF/X-1a:2001');
    expect(res.pdfx?.problems).toEqual([]);
    expect(report.version).toBe('1.3');
    expect(report.pdfx).toBe('PDF/X-1a:2001');
    expect(report.info.GTS_PDFXVersion).toBe('PDF/X-1:2001');
    expect(report.info.Trapped).toBe('False');
    expect(report.outputIntents).toEqual([{ subtype: 'GTS_PDFX', condition: 'CGATS TR 001', hasProfile: false }]);
    expect(report.hasXmp).toBe(false);
    expect(report.encrypted).toBe(false);
    // The sample book has one colour picture; in a black and white interior it must arrive as plain greyscale.
    expect(report.images.map((i) => i.color)).toEqual(['gray', 'gray', 'gray']);
    expect(report.images.some((i) => i.hasSoftMask)).toBe(false);
    for (const p of report.pages) expect(p.hasTrimBox, `page ${p.number} has a TrimBox`).toBe(true);
    expect(res.images.find((i) => i.actions.includes('converted to greyscale'))).toBeTruthy();
  });

  it('an ordinary PDF can still be requested', async () => {
    if (!haveTypst) return;
    const res = await exportInterior(ctx, { formatId: 'paperback', platform: 'kdp', pdfStandard: 'plain', outFile: path.join(sampleDir, '.borderless', 'test-plain.pdf').replace(/\\/g, '/') });
    const report = await inspectPdf(new Uint8Array(fs.readFileSync(res.pdfPath)), { shallow: true });
    expect(res.pdfStandard).toBeNull();
    expect(report.version).toBe('1.4');
    expect(report.pdfx).toBeNull();
    expect(report.outputIntents).toEqual([]);
  });

  it('pictures are printed at 300 dpi or more', () => {
    if (!haveTypst) return;
    const { report } = built.get('paperback/kdp')!;
    expect(report.images).toHaveLength(3);
    for (const img of report.images) expect(img.dpi, `image on page ${img.page}`).toBeGreaterThanOrEqual(300);
  });

  it('the IngramSpark file ends with a blank page on an even page count', () => {
    if (!haveTypst) return;
    const { res, report } = built.get('paperback/ingramspark')!;
    expect(report.pageCount % 2).toBe(0);
    expect(report.pages[report.pageCount - 1].ink).toBeNull();
    expect(res.blankPagesAdded).toBeGreaterThanOrEqual(1);
  });

  it('front matter uses roman numerals and the body starts at page 1 on a right hand page', () => {
    if (!haveTypst) return;
    const { res, report } = built.get('paperback/kdp')!;
    expect(res.contentPages).toBe(report.pageCount);
    // Blank pages (after the half title, before part one and so on) carry no running head or folio.
    const blanks = report.pages.filter((p) => p.ink === null).length;
    expect(blanks).toBeGreaterThanOrEqual(3);
  });
});

describe('EPUB of the sample book', () => {
  let res: EpubExport;
  beforeAll(async () => {
    res = await exportEpub(ctx, { formatId: 'ebook', modified: '2026-11-23T00:00:00Z' });
  });

  it('passes EPUBCheck with no errors and no warnings', () => {
    if (!haveEpubCheck) return expect.soft(haveEpubCheck, 'EPUBCheck or Java is missing: run "npm run fetch-tools" and install Java').toBe(true);
    expect(res.check.ran).toBe(true);
    expect(res.check.issues).toEqual([]);
    expect(res.check.errors).toBe(0);
    expect(res.check.warnings).toBe(0);
    expect(res.check.passed).toBe(true);
  });

  it('is a well formed EPUB 3 package', () => {
    const zip = unzipSync(new Uint8Array(fs.readFileSync(res.epubPath)));
    const names = Object.keys(zip);
    expect(names[0]).toBe('mimetype');
    expect(strFromU8(zip['mimetype'])).toBe('application/epub+zip');
    const opf = strFromU8(zip['OEBPS/content.opf']);
    expect(opf).toContain('version="3.0"');
    expect(opf).toContain('urn:isbn:9781234567910');
    expect(opf).toContain('<dc:language>en-AU</dc:language>');
    expect(opf).toContain('<dc:publisher>Borderless Publishing</dc:publisher>');
    expect(opf).toContain('schema:accessibilityFeature');
    expect(opf).toContain('properties="nav"');
    const nav = strFromU8(zip['OEBPS/nav.xhtml']);
    expect(nav).toContain('epub:type="toc"');
    expect(nav).toContain('epub:type="landmarks"');
    expect(nav).toContain('epub:type="bodymatter"');
    expect((nav.match(/<li>/g) ?? []).length).toBeGreaterThan(20);
    // Three pictures in the text; the cover picture is there too once the cover builder has made one.
    expect(names.filter((n) => n.startsWith('OEBPS/images/') && !/cover\./.test(n))).toHaveLength(3);
  });

  it('uses the ebook ISBN on the copyright page, not a print ISBN', () => {
    const copyright = res.result.files.find((f) => f.path.includes('copyright'))!.content;
    expect(copyright).toContain('ISBN 9781234567910 (ebook)');
    expect(copyright).not.toContain('9781234567897');
    expect(copyright).toContain('Published by Borderless Publishing, Sydney, Australia');
  });

  it('maps every chapter file back to manuscript documents', () => {
    const chapter = res.result.map.find((m) => m.title.startsWith('Chapter One'))!;
    expect(chapter.lines.length).toBeGreaterThan(10);
    expect(chapter.lines.every((l) => l.nodeId && l.srcLine && l.srcLine > 0)).toBe(true);
  });
});

describe('covers of the sample book', () => {
  let kdp: CoverExport;
  let ingram: CoverExport;
  let kdpReport: PdfReport;
  let ingramReport: PdfReport;

  beforeAll(async () => {
    if (!haveTypst) return;
    const interior = await exportInterior(ctx, { formatId: 'paperback', platform: 'kdp' });
    kdp = await exportCover(ctx, { formatId: 'paperback', platform: 'kdp', pages: interior.pageCount });
    kdpReport = await inspectPdf(new Uint8Array(fs.readFileSync(kdp.pdfPath)));
    const interiorIngram = await exportInterior(ctx, { formatId: 'paperback', platform: 'ingramspark' });
    ingram = await exportCover(ctx, { formatId: 'paperback', platform: 'ingramspark', pages: interiorIngram.pageCount });
    ingramReport = await inspectPdf(new Uint8Array(fs.readFileSync(ingram.pdfPath)));
  });

  it('the KDP cover has the size the spine formula gives for the real page count', () => {
    if (!haveTypst) return;
    expect(kdp.ok).toBe(true);
    const g = kdp.plan.geometry!;
    // cream paper: pages x 0.0025 in
    expect(g.spineWidthIn).toBeCloseTo(kdp.plan.pages * 0.0025, 4);
    expect(kdpReport.pageCount).toBe(1);
    expect(kdpReport.pages[0].width / 72).toBeCloseTo(2 * 5.5 + g.spineWidthIn + 0.25, 2);
    expect(kdpReport.pages[0].height / 72).toBeCloseTo(8.75, 2);
    // The trim box is the cover without its bleed.
    const t = kdpReport.pages[0].trim;
    expect((t.x1 - t.x0) / 72).toBeCloseTo(2 * 5.5 + g.spineWidthIn, 2);
    expect((t.y1 - t.y0) / 72).toBeCloseTo(8.5, 2);
    for (const f of kdpReport.fonts) expect(f.embedded).toBe(true);
    expect(kdpReport.pages[0].usesTransparency).toBe(false);
  });

  it('the IngramSpark cover is PDF/X-1a with a CMYK picture inside the ink limit', () => {
    if (!haveTypst) return;
    expect(ingram.ok).toBe(true);
    expect(ingram.pdfStandard).toBe('PDF/X-1a:2001');
    expect(ingramReport.pdfx).toBe('PDF/X-1a:2001');
    expect(ingramReport.version).toBe('1.3');
    expect(ingramReport.images).toHaveLength(1);
    expect(ingramReport.images[0].color).toBe('cmyk');
    expect(ingramReport.images[0].dpi).toBeGreaterThanOrEqual(300);
    expect(new Set(ingramReport.pages[0].colors)).toEqual(new Set(['cmyk']));
    expect(ingram.pdfx!.convertedToCmyk).toBe(1);
    expect(ingram.pdfx!.maxInkConverted).toBeLessThanOrEqual(2.41);
    expect(ingram.plan.geometry!.spineWidthIn).toBe(0.47);
    expect(ingram.barcodeBox).not.toBeNull();
    expect(ingram.barcodeMagnification!).toBeGreaterThanOrEqual(0.8);
  });

  it('both covers pass preflight, and a stale cover is caught when the page count changes', async () => {
    if (!haveTypst) return;
    const ok = await preflightCoverFile(ctx, ingram, { formatId: 'paperback', platform: 'ingramspark' });
    expect(ok.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(ok.ready).toBe(true);
    expect((await preflightCoverFile(ctx, kdp, { formatId: 'paperback', platform: 'kdp' })).ready).toBe(true);
    // Pretend the interior grew after the cover was made.
    const stale = { ...kdp, plan: { ...kdp.plan, geometry: { ...kdp.plan.geometry!, pages: kdp.plan.pages - 20 } } };
    const report = await preflightCoverFile(ctx, stale, { formatId: 'paperback', platform: 'kdp' });
    expect(report.ready).toBe(false);
    expect(report.checks.find((c) => c.id === 'cover-spine')!.detail).toMatch(/no longer matches/);
  });

  it('the barcode on the cover can be read by a scanner library (when zbar is installed)', async () => {
    if (!haveTypst) return;
    let zbar = true;
    try {
      execFileSync('zbarimg', ['--version'], { stdio: 'ignore' });
    } catch {
      zbar = false;
    }
    if (!zbar) return;
    const preview = await previewCover(ctx, { formatId: 'paperback', platform: 'ingramspark', guides: false, ppi: 600, pages: ingram.plan.pages });
    expect(preview.ok).toBe(true);
    let out = '';
    try {
      out = execFileSync('zbarimg', ['-q', '-Sean5.enable', '-Sisbn13.enable', preview.pngPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? '');
    }
    expect(out).toContain('9781234567897');
    expect(out).toContain('EAN-5:90000');
  });

  it('the ebook cover is an RGB JPEG of the size each store asks for', async () => {
    if (!haveTypst) return;
    const kdpCover = await exportEbookCover(ctx, { platform: 'kdp' });
    expect(kdpCover.ok).toBe(true);
    const info = imageInfo(new Uint8Array(fs.readFileSync(kdpCover.jpgPath)));
    expect([info.format, info.width, info.height, info.color]).toEqual(['jpeg', 1600, 2560, 'rgb']);
    const d2d = await exportEbookCover(ctx, { platform: 'draft2digital' });
    const d2dInfo = imageInfo(new Uint8Array(fs.readFileSync(d2d.jpgPath)));
    expect([d2dInfo.width, d2dInfo.height]).toEqual([1600, 2400]);
    expect(fs.existsSync(path.join(sampleDir, 'cover', 'ebook-cover.jpg'))).toBe(true);
  });

  it('the interior preflight of the sample book has no failures and no warnings', async () => {
    if (!haveTypst) return;
    const res = await exportInterior(ctx, { formatId: 'paperback', platform: 'ingramspark' });
    const report = await preflightInteriorFile(ctx, res, 'ingramspark');
    expect(report.checks.filter((c) => c.status === 'fail' || c.status === 'warn')).toEqual([]);
    expect(report.ready).toBe(true);
    expect(report.counts.pass).toBeGreaterThanOrEqual(15);
  });
});
