/**
 * Books in other languages from start to finish: a French novel and an Arabic
 * novel are created, typeset for print and exported as ebooks. The French
 * book must get French quotation marks and words; the Arabic book must be set
 * right to left, bound on the right, in a font that has Arabic letters.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { strFromU8, unzipSync } from 'fflate';
import {
  BookSchema, bundledSpecsDir, changeBookLanguage, chapterLabel, LAYOUT, createBook, digitSetFor, exportEpub, exportInterior, inspectPdf, languageChoices, languageInfo,
  loadSpecs, smartenText, stringsFor, toDigits, TextStyleSchema, type BuildContext, type EpubExport, type InteriorExport,
} from '@borderless/core';
import { NodeHost } from '../src/nodeHost';

const host = new NodeHost();
const parent = path.join(os.tmpdir(), `borderless-languages-${process.pid}`).replace(/\\/g, '/');
let haveTypst = false;

async function makeBook(language: string, title: string, author: string, para: string): Promise<BuildContext> {
  const { resources } = await host.paths();
  const project = await createBook(host, { parentDir: parent, title, author, genre: 'novel', language, trim: '5.5x8.5', paper: 'cream' });
  const body = project.binder.roots.find((r) => r.role === 'body')!;
  for (const child of [...(body.children ?? [])]) await project.removeNode(child.id);
  for (let c = 0; c < 3; c++) {
    const chapter = await project.addNode(body.id, { type: 'chapter', kind: 'chapter', title: `${title} ${c + 1}`, numbered: true });
    await project.addNode(chapter.id, { type: 'doc', kind: 'scene', title: 'Scene', text: Array.from({ length: 40 }, () => para).join('\n\n') + '\n' });
  }
  const paperback = project.book.formats.find((f) => f.id === 'paperback')!;
  paperback.isbn = '9781234567897';
  paperback.platforms = ['ingramspark'];
  await project.saveBook();
  return { host, project, specs: await loadSpecs(host, bundledSpecsDir(resources)), resourcesDir: resources };
}

/** Text of one PDF page, when poppler's pdftotext is installed. */
function pageText(pdf: string, page: number): string | null {
  try {
    return execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', pdf, '-'], { encoding: 'utf8' });
  } catch {
    return null;
  }
}

beforeAll(async () => {
  haveTypst = (await host.toolInfo('typst')).found;
});

afterAll(() => {
  if (!process.env.KEEP_LANG_BOOKS) fs.rmSync(parent, { recursive: true, force: true });
});

describe('the language list', () => {
  it('knows the main publishing languages, with their direction, quotation marks and ONIX codes', () => {
    const tags = languageChoices().map(([tag]) => tag);
    for (const t of ['en-AU', 'fr', 'es', 'ar', 'de', 'pt-BR', 'it', 'zh-Hans', 'ja', 'ru', 'hi', 'bn', 'he', 'fa', 'ur', 'sw', 'id']) expect(tags).toContain(t);
    expect(languageInfo('ar').dir).toBe('rtl');
    expect(languageInfo('he-IL').dir).toBe('rtl');
    expect(languageInfo('fr-CA').dir).toBe('ltr');
    expect(languageInfo('fr').onix).toBe('fre');
    expect(languageInfo('es-MX').onix).toBe('spa');
    expect(languageInfo('ar').onix).toBe('ara');
    expect(languageInfo('xx').onix).toBe('und');
  });

  it('puts each language\'s own quotation marks into exported text', () => {
    const style = (language: string) => ({ ...TextStyleSchema.parse({}), language });
    expect(smartenText('Il dit "bonjour" et partit.', style('fr'))).toBe('Il dit \u00AB\u202Fbonjour\u202F\u00BB et partit.');
    expect(smartenText('Vraiment ? Oui !', style('fr'))).toBe('Vraiment\u202F? Oui\u202F!');
    expect(smartenText('Il est 12:30, c\'est l\'heure.', style('fr'))).toBe('Il est 12:30, c\u2019est l\u2019heure.');
    expect(smartenText('Dijo "hola" y se fue.', style('es'))).toBe('Dijo \u00ABhola\u00BB y se fue.');
    expect(smartenText('Er sagte "ja \'bitte\' doch".', style('de'))).toBe('Er sagte „ja ‚bitte\u2018 doch\u201C.');
    expect(smartenText('She said "hello".', style('en-AU'))).toBe('She said \u201Chello\u201D.');
    expect(smartenText('قال "مرحبا".', style('ar'))).toBe('قال \u00ABمرحبا\u00BB.');
  });

  it('prints chapter words and numbers in the book\'s language', () => {
    expect(chapterLabel(21, 'chapter-words', 'fr')).toBe('Chapitre Vingt et un');
    expect(chapterLabel(16, 'chapter-words', 'es')).toBe('Capítulo Dieciséis');
    expect(chapterLabel(21, 'chapter-words', 'de')).toBe('Kapitel Einundzwanzig');
    expect(chapterLabel(12, 'chapter-arabic', 'ar')).toBe('الفصل ١٢');
    expect(chapterLabel(12, 'chapter-arabic', 'ar', undefined, 'latin')).toBe('الفصل 12');
    expect(chapterLabel(4, 'roman', 'ar')).toBe('٤');
    expect(toDigits(2026, digitSetFor('fa'))).toBe('۲۰۲۶');
    expect(toDigits(2026, digitSetFor('hi'))).toBe('2026');
    expect(stringsFor('es-MX').contents).toBe('Índice');
    expect(stringsFor('sw').contents).toBe('Contents');
  });
});

describe('changing the language of a book', () => {
  it('moves the spelling and the default copyright sentences to the new language, but keeps what the author wrote', () => {
    const book = BookSchema.parse({ id: 'b', title: 'T' });
    changeBookLanguage(book, 'es');
    expect(book.style.spelling).toBe('es');
    expect(book.editionStatement).toBe('Primera edici\u00F3n');
    expect(book.copyright.rightsStatement).toMatch(/^Reservados todos los derechos/);
    book.editionStatement = 'Segunda edici\u00F3n revisada';
    changeBookLanguage(book, 'en-GB');
    expect(book.style.spelling).toBe('en-GB');
    expect(book.editionStatement).toBe('Segunda edici\u00F3n revisada');
    expect(book.copyright.rightsStatement).toMatch(/^All rights reserved/);
  });
});

describe('a French book', () => {
  let ctx: BuildContext;
  let interior: InteriorExport;
  let epub: EpubExport;
  beforeAll(async () => {
    ctx = await makeBook('fr', 'La Route du sel', 'Saad Islam', 'Elle regarda la mer et dit : "Demain, nous partirons." Il répondit : "Pourquoi pas aujourd\'hui ?" Le vent soufflait sur les dunes, et les chameaux attendaient en silence.');
    if (!haveTypst) return;
    interior = await exportInterior(ctx, { formatId: 'paperback', platform: 'ingramspark' });
    epub = await exportEpub(ctx, { formatId: 'ebook' });
  }, 120000);

  it('starts with French spelling and a font that prints French', () => {
    expect(ctx.project.book.style.spelling).toBe('fr');
    expect(ctx.project.book.design.bodyFont).toBe('EB Garamond');
    expect(ctx.project.book.design.hyphenate).toBe(true);
  });

  it('is typeset with French words and quotation marks', async () => {
    if (!haveTypst) return;
    expect(interior.warnings.filter((w) => w.severity === 'fail')).toEqual([]);
    const report = await inspectPdf(new Uint8Array(fs.readFileSync(interior.pdfPath)));
    for (const f of report.fonts) expect(f.embedded, f.name).toBe(true);
    const all = Array.from({ length: Math.min(interior.pageCount, 14) }, (_v, i) => pageText(interior.pdfPath, i + 1) ?? '').join('\n');
    if (all.trim()) {
      expect(all).toContain('\u00AB');
      expect(all).toMatch(/Chapitre|Table des matières|Publié par/);
    }
  });

  it('becomes an EPUB marked as French with French quotation marks', () => {
    if (!haveTypst) return;
    const zip = unzipSync(epub.result.bytes);
    const opf = strFromU8(zip['OEBPS/content.opf']);
    expect(opf).toContain('<dc:language>fr</dc:language>');
    expect(opf).not.toContain('page-progression-direction');
    const chapter = epub.result.files.find((f) => /chapter/.test(f.path))!.content;
    expect(chapter).toContain('\u00AB\u202FDemain, nous partirons.\u202F\u00BB');
    expect(chapter).toContain('aujourd\u2019hui\u202F?');
    if (epub.check.ran) expect(epub.check.errors).toBe(0);
  });
});

describe('an Arabic book', () => {
  let ctx: BuildContext;
  let interior: InteriorExport;
  let epub: EpubExport;
  const PARA = 'كان البحر هادئًا في ذلك المساء، وكانت السفن تعود إلى الميناء واحدة بعد أخرى. قالت له: "سنرحل غدًا مع الفجر."';
  beforeAll(async () => {
    ctx = await makeBook('ar', 'طريق الملح', 'سعد إسلام', PARA);
    if (!haveTypst) return;
    interior = await exportInterior(ctx, { formatId: 'paperback', platform: 'ingramspark' });
    epub = await exportEpub(ctx, { formatId: 'ebook' });
  }, 120000);

  it('starts with an Arabic font, no hyphenation and no drop capitals', () => {
    const d = ctx.project.book.design;
    expect(d.bodyFont).toBe('Amiri');
    expect(d.hyphenate).toBe(false);
    expect(d.chapterOpener.dropCap.enabled).toBe(false);
    expect(d.lineHeight).toBeGreaterThanOrEqual(1.5);
  });

  it('is typeset right to left in an embedded Arabic font, bound on the right', async () => {
    if (!haveTypst) return;
    expect(interior.warnings.filter((w) => w.severity === 'fail')).toEqual([]);
    const report = await inspectPdf(new Uint8Array(fs.readFileSync(interior.pdfPath)));
    expect(report.fonts.some((f) => /Amiri/.test(f.name))).toBe(true);
    for (const f of report.fonts) expect(f.embedded, f.name).toBe(true);
    const build = JSON.parse(fs.readFileSync(ctx.project.path(LAYOUT.buildDir, 'paperback-ingramspark', 'build.json'), 'utf8')) as { cfg: { meta: { dir: string; cursive: boolean }; digits: string } };
    expect(build.cfg.meta.dir).toBe('rtl');
    expect(build.cfg.meta.cursive).toBe(true);
    expect(build.cfg.digits).toBe('arabic-indic');
  });

  it('becomes an EPUB that reading apps open right to left', () => {
    if (!haveTypst) return;
    const zip = unzipSync(epub.result.bytes);
    const opf = strFromU8(zip['OEBPS/content.opf']);
    expect(opf).toContain('<dc:language>ar</dc:language>');
    expect(opf).toContain('page-progression-direction="rtl"');
    const chapter = epub.result.files.find((f) => /chapter/.test(f.path))!.content;
    expect(chapter).toMatch(/<html[^>]*dir="rtl"/);
    expect(chapter).toContain('\u00ABسنرحل');
    const css = strFromU8(zip['OEBPS/css/book.css']);
    expect(css).not.toMatch(/letter-spacing:\s*0\.\d/);
    expect(css).toMatch(/h2 \{[^}]*text-align: right/);
    if (epub.check.ran) expect(epub.check.errors).toBe(0);
  });
});
