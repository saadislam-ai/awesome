/**
 * Samples, advance reader copies and the in-app ebook preview.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import {
  DEFAULT_PUBLISHER, PREVIEW_THEME_MARKER, assembleProject, bundledSpecsDir, defaultAudioOptions, durationText, epubPreview, exportAudiobookKit, exportEbookCover, exportEpub, exportInterior,
  exportMarketingKit, imageInfo, inspectPdf, loadListing, loadSpecs, marketingCopy, marketingFacts, newBibleEntry, openBook, planAudiobook, preflightInteriorFile, saveListing, textNodes,
  type BuildContext,
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

describe('audiobook kit', () => {
  it('plans one file for each chapter, with credits, a sample, and an estimate of the length', async () => {
    const { plan, spec } = await planAudiobook(ctx, { ...defaultAudioOptions(), narrator: 'Nadia Karim', productionYear: 2027 });
    expect(spec.verified).toBe(false);
    expect(plan.files[0]).toMatchObject({ kind: 'opening-credits', name: '01_Opening_Credits', script: 'The Salt Road. A Sample Book of Placeholder Text. Written by Dr Saad Islam. Narrated by Nadia Karim.' });
    const last = plan.files[plan.files.length - 1];
    expect(last.kind).toBe('closing-credits');
    expect(last.script).toMatch(/^This has been The Salt Road\. Written by Dr Saad Islam\. Narrated by Nadia Karim\. Copyright \d{4} by .+\. Production copyright 2027 by Borderless Publishing\.$/);
    const chapters = plan.files.filter((f) => /_Chapter_\d\d$/.test(f.name));
    expect(chapters).toHaveLength(19);
    // The first chapter's file opens with the part title and the chapter heading, then the text.
    expect(chapters[0].script).toMatch(/^Part One: The Crossing\.\n\nChapter One: The River\.\n\n/);
    expect(chapters[0].script).toContain('[pause]');
    // Notes are kept apart for the narrator and do not count as spoken words.
    expect(chapters[0].script).toContain('[Notes of this section, for the narrator. Not read unless agreed.]');
    expect(chapters[0].decisions.join(' ')).toMatch(/note/);
    expect(plan.files.some((f) => /Copyright|Contents|Index/.test(f.title))).toBe(false);
    expect(plan.leftOut.join(' ')).toMatch(/copyright page is not read/);
    // About 62,000 words at 9,300 words an hour is between six and seven hours.
    expect(plan.totalWords).toBeGreaterThan(60000);
    expect(plan.totalMinutes).toBeGreaterThan(380);
    expect(plan.totalMinutes).toBeLessThan(440);
    expect(durationText(plan.totalMinutes)).toMatch(/^[67] h \d\d min$/);
    expect(plan.sample!.minutes).toBeLessThanOrEqual(spec.narration.retailSampleMaxMinutes);
    expect(plan.sample!.script.startsWith('Part One: The Crossing.')).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/how to say it/);
    // Without a narrator the credits say so instead of leaving a gap.
    const unnamed = await planAudiobook(ctx, defaultAudioOptions());
    expect(unnamed.plan.files[0].script).toContain('[name of the narrator]');
    expect(unnamed.plan.warnings.join(' ')).toMatch(/No narrator is named/);
  });

  it('writes the scripts, the plan, the pronunciation guide and the requirements', async () => {
    const dir = `${tmp}/audio-book`;
    fs.cpSync(path.join(REPO_ROOT, 'sample-book'), dir, { recursive: true });
    const project = await openBook(host, dir);
    project.bible.entries.push({ ...newBibleEntry('place', 'Khulna'), pronunciation: 'KOOL-nah', summary: 'City on the delta' });
    const kit = await exportAudiobookKit({ ...ctx, project }, { ...defaultAudioOptions(), narrator: 'Nadia Karim' });
    expect(kit.dir).toBe(`${dir}/exports/audiobook`);
    const scripts = fs.readdirSync(`${kit.dir}/script`).sort();
    expect(scripts[0]).toBe('01_Opening_Credits.txt');
    expect(scripts).toContain('Retail_Sample.txt');
    expect(scripts.length).toBe(kit.plan.files.length + 1);
    expect(fs.readFileSync(`${kit.dir}/pronunciation-guide.txt`, 'utf8')).toContain('Khulna: KOOL-nah  (City on the delta)');
    const csv = fs.readFileSync(`${kit.dir}/recording-plan.csv`, 'utf8').split('\n');
    expect(csv[0]).toBe('File,Section,Words,Estimated minutes,To decide');
    expect(csv.length).toBe(kit.plan.files.length + 3);
    const req = fs.readFileSync(`${kit.dir}/requirements.txt`, 'utf8');
    expect(req).toMatch(/not yet confirmed against the official page/);
    expect(req).toMatch(/\[ \] Loudness: Each file measures between -23 dB and -18 dB RMS\./);
    expect(req).toContain('https://www.acx.com/');
  });
});

describe('marketing kit', () => {
  it('makes the copy, a one page sell sheet and quote cards from the book itself', async () => {
    const dir = `${tmp}/marketing-book`;
    fs.cpSync(path.join(REPO_ROOT, 'sample-book'), dir, { recursive: true });
    const project = await openBook(host, dir);
    const scene = textNodes(project.binder).find((n) => n.kind === 'scene')!;
    const text = await project.readDoc(scene.id);
    await project.writeDoc(scene.id, text.replace('The smell of rain came in over the river mouth', '{==The smell of *rain* came in over the river mouth==}') + '\n\n{==Short.==} {==A second line worth keeping, about salt and patience and the long road home.==}\n');
    await saveListing(project, { ...(await loadListing(project)), description: 'A family waits for a ferry that may never come.\n\nOver one long dry season, three generations learn what a border costs.', shortDescription: 'Three generations, one river, and the ferry that connects them.', keywords: ['river', 'family saga'], thema: ['FBA'] });
    const mctx: BuildContext = { ...ctx, project };
    await exportEbookCover(mctx, { formatId: 'ebook', platform: 'kdp' });
    const kit = await exportMarketingKit(mctx, { publisher: { ...DEFAULT_PUBLISHER, authorBio: 'Dr Saad Islam writes in Sydney.', website: 'example.org' }, sizes: ['square', 'wide'] });
    expect(kit.warnings).toEqual([]);

    // Quotations are the highlighted passages; a fragment that is too short is not one.
    expect(kit.facts.quotes.map((q) => q.text)).toEqual(['The smell of rain came in over the river mouth', 'A second line worth keeping, about salt and patience and the long road home.']);
    expect(kit.facts.quotes[0].from).toBe('The River');

    const copy = fs.readFileSync(kit.copyPath, 'utf8');
    expect(copy).toContain('## In one line\n\nThree generations, one river, and the ferry that connects them.');
    expect(copy).toContain('Over one long dry season, three generations learn what a border costs.');
    expect(copy).toContain('- Author: Dr Saad Islam');
    expect(copy).toMatch(/- Paperback[^\n]*ISBN 978/);
    expect(copy).toContain('Bookshops and libraries can order the printed editions from Ingram');
    expect(copy).toContain('> The smell of rain came in over the river mouth');
    expect(copy).toContain('Blessings Foundation Bangladesh');
    expect(copy).not.toMatch(/[\u2013\u2014]/);

    // The sell sheet is a single page with its fonts inside.
    const sheet = await inspectPdf(new Uint8Array(fs.readFileSync(kit.sheetPath!)));
    expect(sheet.pageCount).toBe(1);
    expect(sheet.fonts.length).toBeGreaterThan(0);
    expect(sheet.fonts.every((f) => f.embedded)).toBe(true);

    // Two quotations in two sizes, each picture exactly the size a social site expects.
    expect(kit.cards).toHaveLength(4);
    const sizes = kit.cards.map((c) => { const i = imageInfo(new Uint8Array(fs.readFileSync(c.path))); return `${c.size}:${i.width}x${i.height}`; });
    expect(sizes).toEqual(['square:1080x1080', 'wide:1200x675', 'square:1080x1080', 'wide:1200x675']);
  }, 120_000);

  it('says what is missing instead of inventing it', async () => {
    const facts = await marketingFacts(ctx, await assembleProject(ctx, { formatId: 'ebook' }), null);
    expect(facts.quotes).toEqual([]);
    expect(facts.description).toEqual([]);
    const copy = marketingCopy(facts);
    expect(copy).toContain('(Nothing yet. Fill this in under Publish, Listing.)');
    expect(copy).toContain('(None yet. In the Writer, select a sentence and press the highlighter button');
    expect(copy).not.toMatch(/About the price/);
  });
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
