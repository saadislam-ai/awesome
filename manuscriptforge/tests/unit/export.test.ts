import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { compareSummary, exportBook, exportDocx, exportEpub, exportFileName, exportMarkdown, exportText, type ExportBook, type ExportChapter } from '../../src/core/export';
import { detectChapters, importManuscript } from '../../src/core/import';
import { blockText, paragraph, type Block } from '../../src/core/model/blocks';
import { importFixture } from './helpers';

function has(tool: string): boolean {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_OFFICE = has('soffice');
const HAS_PANDOC = has('pandoc');

async function fixtureBook(name: string): Promise<ExportBook> {
  const result = await importFixture(name);
  const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
  return { title: result.meta.title ?? 'Untitled', author: result.meta.author ?? '', language: result.meta.language ?? 'en', chapters: chapters.map((c, i) => ({ id: `c${i}`, ...c })) };
}

/** Reads an exported file back with the app's own importer. */
async function readBack(fileName: string, bytes: Uint8Array, book: ExportBook) {
  const result = await importManuscript(fileName, bytes);
  return detectChapters(result.blocks, 'auto', { title: book.title, author: book.author }).chapters;
}

const texts = (chapters: { title: string; blocks: Block[] }[]) => chapters.map((c) => [c.title, ...c.blocks.map(blockText)]);

describe('Word export', () => {
  it('writes a manuscript that reads back with the same chapters, text and formatting', async () => {
    for (const name of ['novel.docx', 'nonfiction.docx', 'spanish.epub']) {
      const book = await fixtureBook(name);
      const back = await readBack('out.docx', exportDocx(book), book);
      expect(texts(back), name).toEqual(texts(book.chapters));
      const formatted = (chapters: ExportChapter[] | typeof back) =>
        chapters.flatMap((c) => c.blocks.flatMap((b) => (b.type === 'break' ? [] : b.runs.filter((r) => r.i || r.b).map((r) => `${r.i ? 'i' : ''}${r.b ? 'b' : ''}:${r.text.trim()}`))));
      expect(formatted(back), name).toEqual(formatted(book.chapters));
      expect(back.flatMap((c) => c.blocks.map((b) => b.type)), name).toEqual(book.chapters.flatMap((c) => c.blocks.map((b) => b.type)));
    }
  });

  it('restarts numbered lists and escapes special characters', async () => {
    const book: ExportBook = {
      title: 'Tom & Jerry <2>', author: 'A "B" C', language: 'en',
      chapters: [{ title: 'Lists & things', blocks: [
        { type: 'list', ordered: true, runs: [{ text: 'one' }] }, { type: 'list', ordered: true, runs: [{ text: 'two' }] },
        paragraph('Between <lists> & "quotes".'),
        { type: 'list', ordered: true, runs: [{ text: 'again one' }] }, { type: 'list', ordered: false, runs: [{ text: 'bullet' }] },
        paragraph('Line one\nline two'),
      ] }],
    };
    const zip = unzipSync(exportDocx(book));
    const doc = strFromU8(zip['word/document.xml']);
    expect([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1])).toEqual(['1', '1', '2', '3']);
    expect(strFromU8(zip['word/numbering.xml'])).toContain('<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride');
    expect(doc).toContain('Between &lt;lists&gt; &amp; &quot;quotes&quot;.');
    expect(doc).toContain('Line one</w:t><w:br/><w:t xml:space="preserve">line two');
    expect(strFromU8(zip['docProps/core.xml'])).toContain('<dc:title>Tom &amp; Jerry &lt;2&gt;</dc:title>');
    const back = await readBack('out.docx', exportDocx(book), book);
    expect(back[0].blocks.map((b) => (b.type === 'list' ? b.ordered : null))).toEqual([true, true, null, true, false, null]);
  });

  it.runIf(HAS_OFFICE)('opens in LibreOffice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-docx-'));
    writeFileSync(join(dir, 'book.docx'), exportDocx(await fixtureBook('nonfiction.docx')));
    execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', dir, join(dir, 'book.docx')], { stdio: 'ignore' });
    const text = readFileSync(join(dir, 'book.txt'), 'utf8');
    expect(text).toContain('Chapter 1: Why Attention Leaks');
    expect(text).toContain('Protect the hour as you would protect a meeting');
    expect(text).toMatch(/1\. Write down the time whenever you switch tasks\./);
  });
});

describe('Word export with tracked changes', () => {
  async function versions() {
    const before = await fixtureBook('novel.docx');
    const after: ExportBook = JSON.parse(JSON.stringify(before));
    const one = after.chapters[2];
    // An edit inside a paragraph that has italics, a removed paragraph, an added one, and a retitled chapter.
    const edited = one.blocks[7] as Extract<Block, { type: 'paragraph' }>;
    edited.runs = [{ text: 'Light the lamp on the tenth', i: true }, { text: ', the note said. ' }, { text: 'Someone is coming home', i: true }, { text: '.' }];
    one.blocks.splice(3, 1);
    one.blocks.splice(1, 0, paragraph('A newly written paragraph.'));
    after.chapters[3].title = 'Chapter Two: The Harbour Master';
    // A removed chapter and a new one.
    after.chapters.splice(1, 1);
    after.chapters.push({ id: 'new', title: 'Epilogue', blocks: [paragraph('The light still burns.')] });
    return { before, after };
  }

  /** Undoes every tracked change in the XML, the way "Reject All" does in Word. */
  function rejectAll(docx: Uint8Array): Uint8Array {
    const zip = unzipSync(docx);
    let xml = strFromU8(zip['word/document.xml']);
    xml = xml.replace(/<w:p>(?:(?!<\/w:p>).)*?<w:pPr>(?:(?!<\/w:pPr>).)*?<w:rPr><w:ins [^>]*\/><\/w:rPr><\/w:pPr>.*?<\/w:p>/gs, '');
    xml = xml.replace(/<w:rPr><w:del [^>]*\/><\/w:rPr>/g, '');
    xml = xml.replace(/<w:ins [^>]*[^/]>.*?<\/w:ins>/gs, '');
    xml = xml.replace(/<w:del [^>]*[^/]>(.*?)<\/w:del>/gs, '$1').replace(/w:delText/g, 'w:t');
    return zipSync({ ...zip, 'word/document.xml': strToU8(xml) });
  }

  it('accepting all changes gives the new text, rejecting all gives the old text', async () => {
    const { before, after } = await versions();
    const docx = exportDocx(after, { compareTo: before.chapters, revisionAuthor: 'Editor', revisionDate: new Date('2026-11-28T10:00:00Z') });
    const xml = strFromU8(unzipSync(docx)['word/document.xml']);
    expect(xml).toContain('w:author="Editor" w:date="2026-11-28T10:00:00Z"');
    expect(xml).toContain('<w:delText xml:space="preserve">ninth</w:delText>');
    expect(xml).toContain('<w:t xml:space="preserve">tenth</w:t>');
    // Ids of tracked changes are unique.
    const ids = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(10);

    // The app's importer accepts insertions and drops deletions, like "Accept All".
    expect(texts(await readBack('tracked.docx', docx, after))).toEqual(texts(after.chapters));
    expect(texts(await readBack('rejected.docx', rejectAll(docx), before))).toEqual(texts(before.chapters));
  });

  it('keeps italics on both sides of a change', async () => {
    const { before, after } = await versions();
    const xml = strFromU8(unzipSync(exportDocx(after, { compareTo: before.chapters }))['word/document.xml']);
    expect(xml).toMatch(/<w:del [^>]*><w:r><w:rPr><w:i\/><\/w:rPr><w:delText xml:space="preserve">ninth<\/w:delText><\/w:r><\/w:del>/);
    expect(xml).toMatch(/<w:ins [^>]*><w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">tenth<\/w:t><\/w:r><\/w:ins>/);
  });

  it('writes no tracked changes when nothing changed, and summarises differences', async () => {
    const { before, after } = await versions();
    const same = strFromU8(unzipSync(exportDocx(before, { compareTo: before.chapters }))['word/document.xml']);
    expect(same).not.toMatch(/<w:(ins|del) /);
    expect(compareSummary(before.chapters, before.chapters)).toEqual({ changed: 0, added: 0, removed: 0 });
    expect(compareSummary(before.chapters, after.chapters)).toEqual({ changed: 1, added: 2, removed: 3 });
  });

  it.runIf(HAS_OFFICE)('LibreOffice recognises the changes as real tracked changes', async () => {
    const { before, after } = await versions();
    const dir = mkdtempSync(join(tmpdir(), 'mf-tracked-'));
    writeFileSync(join(dir, 'tracked.docx'), exportDocx(after, { compareTo: before.chapters }));
    execFileSync('soffice', ['--headless', '--convert-to', 'fodt', '--outdir', dir, join(dir, 'tracked.docx')], { stdio: 'ignore' });
    const fodt = readFileSync(join(dir, 'tracked.fodt'), 'utf8');
    expect(fodt).toContain('<text:tracked-changes');
    expect((fodt.match(/<text:insertion>/g) ?? []).length).toBeGreaterThan(3);
    expect((fodt.match(/<text:deletion>/g) ?? []).length).toBeGreaterThan(3);
    expect(fodt).toContain('ninth');
    expect(fodt).toContain('tenth');
  });
});

describe('EPUB export', () => {
  it('is a valid container that reads back with the same chapters and text', async () => {
    for (const name of ['novel.docx', 'nonfiction.docx', 'spanish.epub']) {
      const book = await fixtureBook(name);
      const epub = exportEpub(book, new Date('2026-11-28T10:00:00Z'));
      // The first entry must be an uncompressed "mimetype" file.
      expect(strFromU8(epub.subarray(30, 38))).toBe('mimetype');
      expect(epub[8] | (epub[9] << 8)).toBe(0);
      expect(strFromU8(epub.subarray(38, 58))).toBe('application/epub+zip');

      const back = await readBack('out.epub', epub, book);
      expect(texts(back), name).toEqual(texts(book.chapters));
      const italics = (chapters: { blocks: Block[] }[]) => chapters.flatMap((c) => c.blocks.flatMap((b) => (b.type === 'break' ? [] : b.runs.filter((r) => r.i).map((r) => r.text.trim()))));
      expect(italics(back), name).toEqual(italics(book.chapters));
      const zip = unzipSync(epub);
      expect(strFromU8(zip['OEBPS/content.opf'])).toContain(`<dc:language>${book.language}</dc:language>`);
      expect(strFromU8(zip['OEBPS/nav.xhtml'])).toContain(book.chapters[1].title);
    }
  });

  it.runIf(HAS_PANDOC)('opens in another program (pandoc)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-epub-'));
    const file = join(dir, 'book.epub');
    writeFileSync(file, exportEpub(await fixtureBook('novel.docx')));
    const text = execFileSync('pandoc', [file, '-f', 'epub', '-t', 'plain', '--wrap=none'], { encoding: 'utf8' });
    expect(text).toContain('Chapter Three');
    expect(text).toContain('a second light answered.');
    expect(existsSync(file)).toBe(true);
  });
});

describe('Markdown and plain text export', () => {
  it('Markdown reads back with the same chapters, text and italics', async () => {
    for (const name of ['novel.docx', 'nonfiction.docx']) {
      const book = await fixtureBook(name);
      const md = exportMarkdown(book);
      expect(md.startsWith(`---\ntitle: ${JSON.stringify(book.title)}\nauthor: ${JSON.stringify(book.author)}\nlang: en\n---\n`)).toBe(true);
      const back = await readBack('out.md', new TextEncoder().encode(md), book);
      expect(texts(back), name).toEqual(texts(book.chapters));
    }
    const book = await fixtureBook('novel.docx');
    expect(exportMarkdown(book)).toContain('*Light the lamp on the ninth,* it said. *Someone is coming home.*');
  });

  it('plain text keeps every paragraph in order', async () => {
    const book = await fixtureBook('novel.docx');
    const text = exportText(book);
    const expected = book.chapters.flatMap((c) => [...(c.title === 'Title page' ? [] : [c.title]), ...c.blocks.map(blockText)]);
    expect(text.split('\n').filter((line) => line.trim())).toEqual(expected);
  });

  it('names files safely and picks the right format', async () => {
    expect(exportFileName('What? A "Book": Part 1/2.', 'docx')).toBe('What A Book Part 1 2.docx');
    expect(exportFileName('   ', 'epub')).toBe('Manuscript.epub');
    const book = await fixtureBook('novel.docx');
    expect(exportBook(book, 'docx-tracked', book.chapters).fileName).toBe('The Lighthouse at Marrow Point (tracked changes).docx');
    expect(() => exportBook(book, 'docx-tracked')).toThrow(/Choose the version/);
    expect(new TextDecoder().decode(exportBook(book, 'txt').bytes)).toContain('Chapter One');
  });
});
