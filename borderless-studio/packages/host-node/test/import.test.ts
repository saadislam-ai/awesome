/**
 * Word export and the importers. Round trips prove both directions: the
 * sample book is written as a Word file and as an EPUB and read back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import {
  addImportToProject, bundledSpecsDir, cleanTitle, createBook, exportDocx, exportEpub, htmlToMarkdown, importDocx, importEpub, importFile, importMarkdown,
  importPlainText, loadSpecs, openBook, roundedWordCount, rtfToMarkdown, textNodes, type BuildContext,
} from '@borderless/core';
import { NodeHost, REPO_ROOT } from '../src/nodeHost';

const host = new NodeHost();
const tmp = path.join(os.tmpdir(), `borderless-import-${process.pid}`).replace(/\\/g, '/');
let ctx: BuildContext;

beforeAll(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  const { resources } = await host.paths();
  ctx = { host, project: await openBook(host, path.join(REPO_ROOT, 'sample-book').replace(/\\/g, '/')), specs: await loadSpecs(host, bundledSpecsDir(resources)), resourcesDir: resources };
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('Word export', () => {
  it('writes the manuscript format: title page with word count, header, double spacing', async () => {
    const res = await exportDocx(ctx, { formatId: 'ebook', layout: 'manuscript', outFile: `${tmp}/ms.docx` });
    expect(res.ok).toBe(true);
    expect(res.footnotes).toBe(40);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(res.docxPath)));
    const doc = strFromU8(zip['word/document.xml']);
    expect(doc).toContain('about 62,000 words');
    expect(doc).toContain('THE SALT ROAD');
    expect(doc).toContain('THE END');
    expect(strFromU8(zip['word/header1.xml'])).toContain('Islam / THE SALT ROAD / ');
    expect(strFromU8(zip['word/styles.xml'])).toContain('w:line="480"');
    // Pages generated for print (copyright, contents) are not part of a manuscript.
    expect(doc).not.toContain('All rights reserved');
    expect(Object.keys(zip).filter((n) => n.startsWith('word/media/'))).toHaveLength(3);
    expect(roundedWordCount(62498)).toBe(62000);
    expect(roundedWordCount(8449)).toBe(8400);
  });

  it('writes a retail file whose chapters carry the Heading 1 style', async () => {
    const res = await exportDocx(ctx, { formatId: 'ebook', layout: 'retail', outFile: `${tmp}/retail.docx` });
    const zip = unzipSync(new Uint8Array(fs.readFileSync(res.docxPath)));
    const doc = strFromU8(zip['word/document.xml']);
    expect((doc.match(/<w:pStyle w:val="Heading1"\/>/g) ?? []).length).toBeGreaterThanOrEqual(19);
    expect(zip['word/header1.xml']).toBeUndefined();
    expect(doc).toContain('* * *');
  });
});

/** A Word file made by hand: paragraphs with a few properties, and page breaks. */
interface HandPara { text: string; style?: string; center?: boolean; bold?: boolean; breakBefore?: boolean }
const BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
function handDocx(parts: (HandPara | string)[]): Uint8Array {
  const body = parts
    .map((p) => (typeof p === 'string' ? p : `<w:p><w:pPr>${p.style ? `<w:pStyle w:val="${p.style}"/>` : ''}${p.breakBefore ? '<w:pageBreakBefore/>' : ''}${p.center ? '<w:jc w:val="center"/>' : ''}</w:pPr><w:r>${p.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${p.text}</w:t></w:r></w:p>`))
    .join('');
  return zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`) });
}

describe('Word import', () => {
  it('reads the exported file back: chapters, parts, footnotes, italics and pictures', async () => {
    const book = importDocx(new Uint8Array(fs.readFileSync(`${tmp}/retail.docx`)), 'retail.docx');
    expect(book.title).toContain('The Salt Road');
    expect(book.author).toBe('Dr Saad Islam');
    expect(book.items.filter((i) => i.kind === 'chapter').length).toBeGreaterThanOrEqual(19);
    expect(book.items.filter((i) => i.kind === 'part')).toHaveLength(3);
    expect(book.images).toHaveLength(3);
    const first = book.items.find((i) => /The River/.test(i.title))!;
    expect(first.text).toContain('Rafiq thought: *enough*.');
    expect(first.text).toMatch(/\[\^n\d+\]/);
    expect(first.text).toMatch(/^\[\^n\d+\]: /m);
    expect(first.text).toContain('\n\n***\n\n');
    const words = book.items.reduce((n, i) => n + i.text.split(/\s+/).filter(Boolean).length, 0);
    expect(words).toBeGreaterThan(60000);
  });

  it('reads the manuscript format back without its title page and "THE END"', () => {
    const book = importDocx(new Uint8Array(fs.readFileSync(`${tmp}/ms.docx`)), 'ms.docx');
    const titles = book.items.map((i) => i.title);
    expect(titles).not.toContain('Opening pages');
    expect(titles.slice(0, 2)).toEqual(['Dedication', 'Epigraph']);
    expect(book.items[0].text).toBe('For everyone who has waited for a ferry\n');
    expect(book.items[1].text).toMatch(/impatient\.\n\n- Anne Morrow Lindbergh, Gift from the Sea\n$/);
    expect(book.items.some((i) => /THE END/.test(i.text))).toBe(false);
    expect(book.notes.join(' ')).toMatch(/THE END/);
    // The numbered questions come back as a list, and chapter headings in two lines as one title.
    expect(book.items.find((i) => /^Reading Group/.test(i.title))!.text).toMatch(/^1\. Who is waiting[^\n]+\n2\. What does/);
    expect(book.items.filter((i) => i.kind === 'chapter').map((i) => cleanTitle(i.title))).toContain('The River');
    expect(book.items.some((i) => i.title.includes('\\'))).toBe(false);
  });

  it('turns Word tracked changes and comments into suggestions', () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0"?><w:document ${W}><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One: Arrival</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">She </w:t></w:r><w:ins w:id="1" w:author="Ed"><w:r><w:t xml:space="preserve">quickly </w:t></w:r></w:ins><w:r><w:t xml:space="preserve">left the </w:t></w:r>' +
      '<w:del w:id="2" w:author="Ed"><w:r><w:delText>old </w:delText></w:r></w:del><w:r><w:rPr><w:i/></w:rPr><w:t>grey</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> house</w:t></w:r><w:r><w:t>.</w:t></w:r>' +
      '<w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      '<w:p><w:r><w:t>* * *</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> and a 2*3 sum.</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const comments = `<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0" w:author="Ed"><w:p><w:r><w:t>Which house?</w:t></w:r></w:p></w:comment></w:comments>`;
    const bytes = zipSync({ 'word/document.xml': strToU8(doc), 'word/comments.xml': strToU8(comments) });
    const book = importDocx(bytes, 'My_Novel-draft.docx');
    expect(book.title).toBe('My Novel draft');
    expect(book.items).toHaveLength(1);
    expect(book.items[0].title).toBe('Chapter One: Arrival');
    expect(cleanTitle(book.items[0].title)).toBe('Arrival');
    expect(book.items[0].text).toBe('She {++quickly ++}left the {--old --}*grey house*.{>>@Ed: Which house?<<}\n\n***\n\n**Bold** and a 2\\*3 sum.\n');
    expect(book.notes.join(' ')).toMatch(/1 comment from Word/);
  });

  it('reads a manuscript typed without heading styles: title page, dedication, copyright page, chapter titles and typed lists', () => {
    const bytes = handDocx([
      { text: 'Jane Doe' }, { text: '12 Example Street' }, { text: 'about 80,000 words' },
      { text: 'THE LONG WAY HOME', center: true }, { text: 'by Jane Doe', center: true },
      BREAK,
      { text: 'Copyright (c) 2024 Jane Doe. All rights reserved.' },
      BREAK,
      { text: 'For Mum', center: true },
      { text: 'Chapter One', center: true, breakBefore: true },
      { text: 'The River', center: true, bold: true },
      { text: 'It rained for a week.' },
      { text: '1.\tFirst point' }, { text: '2.\tSecond point' },
      { text: '•\tA bullet' },
      { text: '#', center: true },
      { text: 'Then it stopped, and that was the end' },
      { text: 'Chapter Two', center: true, breakBefore: true },
      { text: 'The road was dry.' },
      { text: 'THE END', center: true },
    ]);
    const book = importDocx(bytes, 'draft 7.docx');
    expect(book.title).toBe('The Long Way Home');
    expect(book.author).toBe('Jane Doe');
    expect(book.items.map((i) => `${i.kind}:${i.title}`)).toEqual(['front:Copyright page from the imported file', 'front:Dedication', 'chapter:Chapter One: The River', 'chapter:Chapter Two']);
    expect(book.items[0].excluded).toBe(true);
    expect(book.items[1].text).toBe('For Mum\n');
    expect(book.items[2].text).toBe('It rained for a week.\n\n1. First point\n2. Second point\n\n- A bullet\n\n***\n\nThen it stopped, and that was the end\n');
    expect(book.items[3].text).toBe('The road was dry.\n');
    expect(book.notes.join(' ')).toMatch(/THE END/);
    expect(book.notes.join(' ')).toMatch(/copyright page/i);
  });

  it('starts a chapter at every page break when a file has no chapter headings', () => {
    const para = 'A long paragraph of text that goes on. '.repeat(3).trim();
    const book = importDocx(handDocx([{ text: 'ONE', center: true }, { text: para }, BREAK, { text: 'TWO', center: true }, { text: para }, { text: para }, BREAK, { text: para }]), 'story.docx');
    expect(book.items.map((i) => `${i.kind}:${i.title}`)).toEqual(['chapter:ONE', 'chapter:TWO', 'chapter:']);
    expect(book.items[1].text).toBe(`${para}\n\n${para}\n`);
    expect(book.notes.join(' ')).toMatch(/every page break/);
    // Without page breaks either, the text arrives as one chapter and the note says how to do better.
    const single = importDocx(handDocx([{ text: para }, { text: para }]), 'story.docx');
    expect(single.items.map((i) => i.kind)).toEqual(['chapter']);
    expect(single.notes.join(' ')).toMatch(/Heading 1/);
  });

  it('joins a chapter number and a title that sit in separate headings, and drops bare numbers', () => {
    const book = importDocx(handDocx([{ text: 'Chapter 3', style: 'Heading1' }, { text: 'The Storm', style: 'Heading2' }, { text: 'Rain.' }, { text: '12. Salt', style: 'Heading1' }, { text: 'Dry.' }, { text: 'Seven', style: 'Heading1' }, { text: 'Wind.' }]));
    expect(book.items.map((i) => i.title)).toEqual(['Chapter 3: The Storm', '12. Salt', 'Seven']);
    expect(book.items.map((i) => cleanTitle(i.title))).toEqual(['The Storm', 'Salt', '']);
    expect(book.items[0].text).toBe('Rain.\n');
    expect(cleanTitle('24 Hours')).toBe('24 Hours');
    expect(cleanTitle('1984')).toBe('1984');
  });

  it('explains what is wrong with a file that is not a Word document', () => {
    expect(() => importDocx(new Uint8Array([1, 2, 3]))).toThrow(/could not be opened as a Word document/);
  });
});

describe('other importers', () => {
  it('splits Markdown at its top level headings', () => {
    const book = importMarkdown('---\ntitle: "River Book"\nauthor: A. Writer\n---\nA note.\n\n# Dedication\n\nFor you.\n\n# Chapter 1: The Ferry\n\nText *here*.\n\n## A section\n\nMore.\n\n# Acknowledgements\n\nThanks.\n', 'x.md');
    expect([book.title, book.author]).toEqual(['River Book', 'A. Writer']);
    expect(book.items.map((i) => `${i.kind}:${i.title}`)).toEqual(['front:Opening pages', 'front:Dedication', 'chapter:Chapter 1: The Ferry', 'back:Acknowledgements']);
    expect(book.items[2].text).toBe('Text *here*.\n\n## A section\n\nMore.\n');
  });

  it('finds chapters and scene breaks in plain text and re-joins hard wrapped lines', () => {
    const txt = 'CHAPTER ONE\n\nThe rain came in over the river mouth, quiet and unfinished,\nthough nobody had asked. Farid kept walking down the long white road.\n\n* * *\n\nA new scene with a 2*3 sum.\n\nChapter Two\n\nSecond.\n';
    const book = importPlainText(txt, 'my-draft.txt');
    expect(book.title).toBe('my draft');
    expect(book.items.map((i) => i.title)).toEqual(['CHAPTER ONE', 'Chapter Two']);
    expect(book.items[0].text).toBe('The rain came in over the river mouth, quiet and unfinished, though nobody had asked. Farid kept walking down the long white road.\n\n***\n\nA new scene with a 2\\*3 sum.\n');
    expect(cleanTitle('CHAPTER ONE')).toBe('');
    expect(cleanTitle('Chapter Twenty-One. Home')).toBe('Home');
    expect(cleanTitle('Part II: The Sea')).toBe('The Sea');
    expect(cleanTitle('Prologue')).toBe('Prologue');
  });

  it('converts HTML to Markdown', () => {
    const { title, markdown } = htmlToMarkdown('<html><head><title>x</title><style>p{}</style></head><body><h1>The Ferry</h1><p>Rain <em>came</em> &amp; <b>went</b>.<br/>Next line.</p><hr/><blockquote><p>Quoted.</p></blockquote><ul><li>one</li><li>two</li></ul><h2>Later</h2><p>A <a href="https://example.com">link</a>.</p></body></html>');
    expect(title).toBe('The Ferry');
    expect(markdown).toBe('Rain *came* & **went**.\\\nNext line.\n\n***\n\n> Quoted.\n\n- one\n- two\n\n## Later\n\nA [link](https://example.com).\n');
  });

  it('converts RTF to Markdown, with italics, bold and typographic characters', () => {
    const rtf = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0\\fs24 The \\i quiet\\i0  river.\\par\n\\b Bold\\b0  text with \\u8220?quotes\\u8221? and an apostrophe\\rquote s mark.\\par {\\*\\generator Scrivener;}Caf\\\'e9.\\par}';
    expect(rtfToMarkdown(rtf)).toBe('The *quiet* river.\n\n**Bold** text with \u201Cquotes\u201D and an apostrophe\u2019s mark.\n\nCafé.\n');
  });

  it('reads back the EPUB the app itself exports', async () => {
    const epub = await exportEpub(ctx, { formatId: 'ebook', skipCheck: true, outFile: `${tmp}/book.epub` });
    const book = importEpub(epub.result.bytes, 'book.epub');
    expect(book.title).toContain('The Salt Road');
    expect(book.language).toBe('en-AU');
    expect(book.items.filter((i) => i.kind === 'chapter').length).toBeGreaterThanOrEqual(19);
    expect(book.images.length).toBeGreaterThanOrEqual(3);
    expect(book.items.some((i) => /Farid kept walking/.test(i.text))).toBe(true);
  });

  it('imports the Draft folder of a Scrivener project', async () => {
    const scriv = `${tmp}/Novel.scriv`;
    fs.mkdirSync(`${scriv}/Files/Data/AAA`, { recursive: true });
    fs.mkdirSync(`${scriv}/Files/Data/BBB`, { recursive: true });
    fs.mkdirSync(`${scriv}/Files/Data/CCC`, { recursive: true });
    fs.writeFileSync(`${scriv}/Files/Data/AAA/content.rtf`, '{\\rtf1 Scene one of the \\i first\\i0  chapter.\\par}');
    fs.writeFileSync(`${scriv}/Files/Data/BBB/content.rtf`, '{\\rtf1 Scene two.\\par}');
    fs.writeFileSync(`${scriv}/Files/Data/CCC/content.rtf`, '{\\rtf1 Not compiled.\\par}');
    fs.writeFileSync(`${scriv}/Novel.scrivx`, '<?xml version="1.0"?><ScrivenerProject><Binder>' +
      '<BinderItem UUID="D" Type="DraftFolder"><Title>Manuscript</Title><Children>' +
      '<BinderItem UUID="F1" Type="Folder"><Title>Arrival</Title><Children>' +
      '<BinderItem UUID="AAA" Type="Text"><Title>One</Title></BinderItem><BinderItem UUID="BBB" Type="Text"><Title>Two</Title></BinderItem>' +
      '<BinderItem UUID="CCC" Type="Text"><Title>Cut</Title><MetaData><IncludeInCompile>No</IncludeInCompile></MetaData></BinderItem>' +
      '</Children></BinderItem></Children></BinderItem>' +
      '<BinderItem UUID="R" Type="ResearchFolder"><Title>Research</Title></BinderItem></Binder></ScrivenerProject>');
    const book = await importFile(host, scriv);
    expect(book.title).toBe('Novel');
    expect(book.items).toEqual([{ title: 'Arrival', kind: 'chapter', text: 'Scene one of the *first* chapter.\n\n***\n\nScene two.\n' }]);
  });

  it('adds an import to a new book without touching what is there', async () => {
    const project = await createBook(host, { parentDir: tmp, title: 'Imported', author: 'A. Writer', genre: 'novel' });
    const before = textNodes(project.binder).length;
    const imported = importMarkdown('# Dedication\n\nFor you.\n\n# Part One: Water\n\n# Chapter One: The Ferry\n\nText one.\n\n# Chapter Two\n\nText two.\n\n# Acknowledgements\n\nThanks.\n');
    const summary = await addImportToProject(project, imported);
    expect(summary).toMatchObject({ chapters: 2, parts: 1, frontAndBack: 2 });
    const body = project.binder.roots.find((r) => r.role === 'body')!;
    const part = body.children!.find((n) => n.type === 'part')!;
    expect(part.title).toBe('Water');
    expect(part.children!.map((c) => c.title)).toEqual(['The Ferry', '']);
    // The empty starter dedication of the new book was filled in, not duplicated.
    const front = project.binder.roots.find((r) => r.role === 'front')!;
    expect(front.children!.filter((n) => n.kind === 'dedication')).toHaveLength(1);
    expect(await project.readDoc(front.children!.find((n) => n.kind === 'dedication')!.id)).toBe('For you.\n');
    expect(textNodes(project.binder).length).toBeGreaterThan(before);
    await expect(importFile(host, `${tmp}/nothing.xyz`)).rejects.toThrow(/cannot be imported/);
  });
});
