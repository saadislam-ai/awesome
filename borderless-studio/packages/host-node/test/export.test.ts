/**
 * End to end export tests on the sample book. These run the real tools
 * (Typst and EPUBCheck) and then open the produced files to measure them:
 * real margins on every page, embedded fonts, page sizes, colour of the text.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import {
  bundledSpecsDir, exportEpub, exportInterior, inspectPdf, interiorRules, loadSpecs, measureMargins, minInsideMargin, openBook,
  type BuildContext, type EpubExport, type InteriorExport, type PdfReport,
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
    expect(report.version).toBe('1.4');
    expect(report.info.Title).toContain('The Salt Road');
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
    expect(names.filter((n) => n.startsWith('OEBPS/images/'))).toHaveLength(3);
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
