/**
 * A Bangla book from start to finish: created, typeset for print, exported as
 * an ebook, and checked against the platforms' language rules. The folder and
 * file names contain Bangla letters on purpose.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import {
  bundledSpecsDir, createBook, exportEpub, exportInterior, inspectPdf, loadSpecs, preflightInteriorFile,
  type BuildContext, type EpubExport, type InteriorExport,
} from '@borderless/core';
import { NodeHost } from '../src/nodeHost';

const host = new NodeHost();
const parent = path.join(os.tmpdir(), `borderless-bangla-${process.pid}`).replace(/\\/g, '/');
const PARA = 'আমার সোনার বাংলা, আমি তোমায় ভালোবাসি। নদীর ধারে সন্ধ্যা নামে, আর খেয়াঘাটে মানুষ অপেক্ষা করে।';
const TITLE = 'নদীর গল্প';
let ctx: BuildContext;
let haveTypst = false;
let interior: InteriorExport;
let epub: EpubExport;

beforeAll(async () => {
  haveTypst = (await host.toolInfo('typst')).found;
  const { resources } = await host.paths();
  const project = await createBook(host, { parentDir: parent, title: TITLE, author: 'সাদ ইসলাম', genre: 'novel', language: 'bn', trim: '5.5x8.5', paper: 'cream' });
  const body = project.binder.roots.find((r) => r.role === 'body')!;
  for (const child of [...(body.children ?? [])]) await project.removeNode(child.id);
  for (let c = 0; c < 4; c++) {
    const chapter = await project.addNode(body.id, { type: 'chapter', kind: 'chapter', title: `${TITLE} ${c + 1}`, numbered: true });
    await project.addNode(chapter.id, { type: 'doc', kind: 'scene', title: 'Scene', text: Array.from({ length: 30 }, () => PARA).join('\n\n') + '\n' });
  }
  const paperback = project.book.formats.find((f) => f.id === 'paperback')!;
  paperback.isbn = '9781234567897';
  paperback.platforms = ['kdp', 'ingramspark'];
  await project.saveBook();
  ctx = { host, project, specs: await loadSpecs(host, bundledSpecsDir(resources)), resourcesDir: resources };
  if (!haveTypst) return;
  interior = await exportInterior(ctx, { formatId: 'paperback', platform: 'ingramspark' });
  epub = await exportEpub(ctx, { formatId: 'ebook' });
});

afterAll(() => {
  fs.rmSync(parent, { recursive: true, force: true });
});

describe('a Bangla book', () => {
  it('starts with settings that suit the script', () => {
    const d = ctx.project.book.design;
    expect(d.bodyFont).toBe('Noto Serif Bengali');
    expect(d.hyphenate).toBe(false);
    expect(d.lineHeight).toBeGreaterThanOrEqual(1.5);
    expect(ctx.project.book.style.spelling).toBe('bn');
  });

  it('is typeset for IngramSpark with an embedded Bengali font', async () => {
    if (!haveTypst) return;
    expect(interior.warnings.filter((w) => w.severity === 'fail')).toEqual([]);
    expect(interior.pageCount).toBeGreaterThanOrEqual(18);
    const report = await inspectPdf(new Uint8Array(fs.readFileSync(interior.pdfPath)));
    expect(report.fonts.length).toBeGreaterThan(0);
    expect(report.fonts.some((f) => /NotoSerifBengali/.test(f.name))).toBe(true);
    for (const f of report.fonts) expect(f.embedded, f.name).toBe(true);
    expect(report.pdfx).toBe('PDF/X-1a:2001');
    // The file name carries the Bangla title.
    expect(path.basename(interior.pdfPath)).toContain('নদীর');
  });

  it('passes IngramSpark preflight but is refused for KDP because of the language', async () => {
    if (!haveTypst) return;
    const ingram = await preflightInteriorFile(ctx, interior, 'ingramspark');
    expect(ingram.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(ingram.checks.find((c) => c.id === 'language')!.status).toBe('pass');
    const kdp = await preflightInteriorFile(ctx, await exportInterior(ctx, { formatId: 'paperback', platform: 'kdp' }), 'kdp');
    expect(kdp.ready).toBe(false);
    const language = kdp.checks.find((c) => c.id === 'language')!;
    expect(language.status).toBe('fail');
    expect(language.detail).toMatch(/does not list "bn"/);
  });

  it('becomes a valid EPUB marked as Bangla, even though its file name is not plain ASCII', () => {
    if (!haveTypst) return;
    const zip = unzipSync(epub.result.bytes);
    const opf = strFromU8(zip['OEBPS/content.opf']);
    expect(opf).toContain('<dc:language>bn</dc:language>');
    expect(opf).toContain(TITLE);
    const chapter = epub.result.files.find((f) => /chapter/.test(f.path))!.content;
    expect(chapter).toMatch(/xml:lang="bn"/);
    expect(chapter).toContain('আমার সোনার');
    if (epub.check.ran) {
      expect(epub.check.errors).toBe(0);
      expect(epub.check.passed).toBe(true);
    } else {
      // Without Java the check cannot run; the reason must be reported, not hidden.
      expect(epub.check.problem).toBeTruthy();
    }
  });
});
