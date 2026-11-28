import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectChapters, ImportError, importManuscript, sniffFormat } from '../../src/core/import';
import { blockText, type Block } from '../../src/core/model/blocks';
import { importFixture, loadPdfForTests, outline } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const texts = (blocks: Block[]) => blocks.map(blockText);

describe('the same novel imported from every format', () => {
  const formats = ['novel.docx', 'novel.epub', 'novel.rtf', 'novel-pandoc.rtf', 'novel.pdf', 'novel.txt', 'novel-wrapped.txt'];
  for (const name of formats) {
    it(`${name}: finds the prologue and three chapters with all their text`, async () => {
      const result = await importFixture(name);
      const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
      const story = chapters.filter((c) => c.title !== 'Title page');
      expect(story.map((c) => c.title)).toEqual(['Prologue', 'Chapter One', 'Chapter Two', 'Chapter Three']);
      expect(story.map((c) => c.blocks.length)).toEqual([2, 9, 6, 4]);
      expect(result.meta.language).toBe('en');

      const one = story[1].blocks;
      expect(blockText(one[0])).toMatch(/^Mara Ellison had inherited three things from her grandfather/);
      expect(blockText(one[0])).toMatch(/tried not to think about any of them\.$/);
      expect(one[5]).toEqual({ type: 'break' });
      const last = story[3].blocks[3];
      expect(blockText(last)).toMatch(/a second light answered\.$/);
    });
  }

  it('keeps italics from formats that carry formatting', async () => {
    for (const name of ['novel.docx', 'novel.epub', 'novel.rtf', 'novel-pandoc.rtf', 'novel.pdf']) {
      const result = await importFixture(name);
      const line = result.blocks.find((b) => b.type === 'paragraph' && blockText(b).includes('Light the lamp on the ninth'));
      expect(line, name).toBeDefined();
      const runs = (line as Extract<Block, { type: 'paragraph' }>).runs;
      const italic = runs.filter((r) => r.i).map((r) => r.text).join('|');
      expect(italic, name).toContain('Light the lamp on the ninth');
      expect(runs.find((r) => r.text.includes('it said'))?.i, name).toBeUndefined();
    }
  });

  it('reads title and author from the file when present', async () => {
    for (const name of ['novel.docx', 'novel.epub', 'novel.rtf', 'novel.pdf']) {
      const { meta } = await importFixture(name);
      expect(meta.title, name).toBe('The Lighthouse at Marrow Point');
      expect(meta.author, name).toBe('Eleanor Vance');
    }
  });
});

describe('manuscript without heading styles', () => {
  for (const name of ['manuscript.docx', 'manuscript.rtf', 'manuscript.pdf']) {
    it(`${name}: recognises "Chapter One" lines and joins the chapter title`, async () => {
      const result = await importFixture(name);
      const { chapters, strategy } = detectChapters(result.blocks, 'auto', result.meta);
      expect(strategy).toBe('patterns');
      expect(chapters.map((c) => c.title)).toEqual(['Title page', 'Chapter One: The Caravan', 'Chapter Two: The Liar']);
      expect(texts(chapters[0].blocks)).toEqual(['THE SALT ROAD', 'by Henry Aldous']);
      // The centred "#" line is a scene break.
      expect(chapters[1].blocks[4]).toEqual({ type: 'break' });
      expect(blockText(chapters[2].blocks[1])).toBe('Idris counted too. There were forty-one.');
    });
  }
});

describe('non-fiction', () => {
  it('keeps sections, lists, quotes and footnotes from Word', async () => {
    const result = await importFixture('nonfiction.docx');
    const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
    expect(chapters.map((c) => c.title)).toEqual([
      'Title page',
      'Introduction',
      'Chapter 1: Why Attention Leaks',
      'Chapter 2: Building the Quiet Hour',
      'Notes',
    ]);
    const lines = outline(chapters[2].blocks);
    expect(lines).toContain('h2: The three leaks');
    expect(lines).toContain('ul: Notifications that interrupt a task before it has taken shape.');
    expect(lines).toContain('ol: Write down the time whenever you switch tasks.');
    expect(outline(chapters[3].blocks).some((l) => l.startsWith('quote: Protect the hour'))).toBe(true);
    expect(blockText(chapters[1].blocks[0])).toMatch(/where we notice it\.\[1\]$/);
    expect(texts(chapters[4].blocks)[1]).toMatch(/^\[2\] He agreed to let me share the figure/);
    expect(result.warnings.join(' ')).toMatch(/2 footnotes were converted/);
    const bold = chapters[2].blocks.flatMap((b) => (b.type === 'break' ? [] : b.runs)).filter((r) => r.b);
    expect(bold.map((r) => r.text)).toEqual(['sixty-three']);
  });

  it('imports the EPUB edition with the same chapters', async () => {
    const result = await importFixture('nonfiction.epub');
    const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
    expect(chapters.slice(1, 4).map((c) => c.title)).toEqual(['Introduction', 'Chapter 1: Why Attention Leaks', 'Chapter 2: Building the Quiet Hour']);
    expect(outline(chapters[3].blocks).some((l) => l.startsWith('quote: Protect the hour'))).toBe(true);
  });
});

describe('other book types and languages', () => {
  it('keeps a picture book as one piece and separates its title page', async () => {
    const result = await importFixture('picturebook.docx');
    const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
    expect(chapters.map((c) => c.title)).toEqual(['Title page', 'Full text']);
    expect(chapters[1].blocks).toHaveLength(10);
    expect(blockText(chapters[1].blocks[9])).toBe('And the very next day, it did.');
  });

  for (const name of ['spanish.docx', 'spanish.epub', 'spanish.pdf', 'spanish.txt']) {
    it(`${name}: detects Spanish and its "Capítulo" chapters, accents intact`, async () => {
      const result = await importFixture(name);
      expect(result.meta.language).toBe('es');
      const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
      const story = chapters.filter((c) => c.title !== 'Title page');
      expect(story.map((c) => c.title)).toEqual(['Capítulo 1', 'Capítulo 2']);
      expect(blockText(story[0].blocks[1])).toBe('—No toques las rosas amarillas —me decía ella cada mañana—. Esas no son nuestras.');
    });
  }
});

/** Builds a minimal .docx around the given body XML. */
function docx(body: string, extra: Record<string, string> = {}): Uint8Array {
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${ns}><w:body>${body}</w:body></w:document>`),
  };
  for (const [name, xml] of Object.entries(extra)) files[name] = strToU8(xml.replace('<w:styles>', `<w:styles ${ns}>`));
  return zipSync(files);
}
const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text: string, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('Word documents: details', () => {
  it('accepts tracked insertions and drops tracked deletions', async () => {
    const body = p(`${r('The ')}<w:ins w:id="1" w:author="Ed">${r('quick ')}</w:ins><w:del w:id="2" w:author="Ed"><w:r><w:delText>slow </w:delText></w:r></w:del>${r('fox &amp; the hound.')}`);
    const result = await importManuscript('a.docx', docx(body));
    expect(texts(result.blocks)).toEqual(['The quick fox & the hound.']);
  });

  it('honours formatting switched off and formatting that comes from styles', async () => {
    const styles = `<w:styles>
      <w:style w:type="character" w:styleId="Em"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Letter"><w:name w:val="Letter"/><w:rPr><w:i/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Kapitel"><w:name w:val="heading 1"/></w:style>
      <w:style w:type="paragraph" w:styleId="Sub"><w:name w:val="Custom Sub"/><w:basedOn w:val="Kapitel"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
    </w:styles>`;
    const body =
      p(r('Erstes Kapitel', '<w:b/>'), '<w:pStyle w:val="Kapitel"/>') +
      p(r('Unterabschnitt'), '<w:pStyle w:val="Sub"/>') +
      p(r('plain ') + r('styled', '<w:rStyle w:val="Em"/>') + r(' bold', '<w:b/><w:i w:val="0"/>') + r(' off', '<w:b w:val="false"/>')) +
      p(r('A whole letter in italics, ') + r('except this', '<w:i w:val="0"/>'), '<w:pStyle w:val="Letter"/>');
    const result = await importManuscript('a.docx', docx(body, { 'word/styles.xml': styles }));
    expect(result.blocks).toEqual([
      { type: 'heading', level: 1, runs: [{ text: 'Erstes Kapitel' }] },
      { type: 'heading', level: 2, runs: [{ text: 'Unterabschnitt' }] },
      { type: 'paragraph', runs: [{ text: 'plain ' }, { text: 'styled', i: true }, { text: ' bold', b: true }, { text: ' off' }] },
      { type: 'paragraph', runs: [{ text: 'A whole letter in italics, ', i: true }, { text: 'except this' }] },
    ]);
  });

  it('treats a rare blank paragraph as a scene break and marks page breaks', async () => {
    const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    const body = [
      p(r('One.')), p(r('Two.')), p(r('Three.')), p(r('Four.')), p(r('Five.')), p(r('Six.')), p(''),
      p(r('After the gap.')), pageBreak, p(r('New page.')), p(r('Last, with a line') + '<w:r><w:br/></w:r>' + r('break.')),
    ].join('');
    const result = await importManuscript('a.docx', docx(body));
    expect(outline(result.blocks)).toEqual([
      'p: One.', 'p: Two.', 'p: Three.', 'p: Four.', 'p: Five.', 'p: Six.', '[break]', 'p: After the gap.',
      '^p: New page.', 'p: Last, with a line\nbreak.',
    ]);
  });

  it('ignores blank paragraphs used only as spacing, but keeps a longer gap as a scene break', async () => {
    const body = [p(r('One.')), p(''), p(r('Two.')), p(''), p(r('Three.')), p(''), p(''), p(''), p(r('Four.')), p(''), p(r('Five.'))].join('');
    const result = await importManuscript('a.docx', docx(body));
    expect(outline(result.blocks)).toEqual(['p: One.', 'p: Two.', 'p: Three.', '[break]', 'p: Four.', 'p: Five.']);
  });

  it('skips an automatic table of contents and hidden text', async () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style></w:styles>';
    const body = p(r('Chapter 1\t3'), '<w:pStyle w:val="TOC1"/>') + p(r('Visible') + r(' secret', '<w:vanish/>'));
    const result = await importManuscript('a.docx', docx(body, { 'word/styles.xml': styles }));
    expect(texts(result.blocks)).toEqual(['Visible']);
  });

  it('explains old .doc files and damaged files in plain language', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(importManuscript('old.docx', ole)).rejects.toThrow(/older \.doc file or a password-protected/);
    await expect(importManuscript('old.doc', enc('whatever'))).rejects.toThrow(/save it as \.docx/);
    await expect(importManuscript('book.docx', enc('not a zip'))).rejects.toBeInstanceOf(ImportError);
    await expect(importManuscript('book.pages', enc('x'))).rejects.toThrow(/Pages/);
    await expect(importManuscript('empty.txt', new Uint8Array())).rejects.toThrow(/empty/);
    await expect(importManuscript('blank.txt', enc('  \n\n  '))).rejects.toThrow(/No text was found/);
  });
});

describe('RTF: details', () => {
  const rtf = (body: string) => enc(`{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\info{\\title My Book}{\\author A. Writer}{\\subject Ignored}}${body}}`);

  it('decodes Unicode escapes, code page bytes and special characters', async () => {
    const body = "\\pard Caf\\'e9 \\u8220\\'93quoted\\u8221\\'94 \\emdash  na\\u239?ve \\u1055?\\u1088?\\u1080?\\u1074?\\u1077?\\u1090? \\{braces\\}\\par";
    const result = await importManuscript('a.rtf', rtf(body));
    expect(texts(result.blocks)).toEqual(['Café “quoted” — naïve Привет {braces}']);
    expect(result.meta).toMatchObject({ title: 'My Book', author: 'A. Writer' });
  });

  it('tracks bold and italic through groups and resets', async () => {
    const body = '\\pard plain {\\b bold {\\i both} bold} \\i italic\\i0  \\ul under\\ulnone  end\\par\\pard\\qc centred\\par';
    const result = await importManuscript('a.rtf', rtf(body));
    expect(result.blocks).toEqual([
      {
        type: 'paragraph',
        runs: [
          { text: 'plain ' }, { text: 'bold ', b: true }, { text: 'both', b: true, i: true }, { text: ' bold', b: true },
          { text: ' ' }, { text: 'italic', i: true }, { text: ' ' }, { text: 'under', u: true }, { text: ' end' },
        ],
      },
      { type: 'paragraph', align: 'center', runs: [{ text: 'centred' }] },
    ]);
  });

  it('skips pictures, headers and other non-text groups', async () => {
    const body = '{\\header Running head\\par}{\\*\\generator Some App;}\\pard Body{\\pict\\pngblip 89504e47}\\par{\\footnote A note.}\\pard Second\\par';
    const result = await importManuscript('a.rtf', rtf(body));
    expect(texts(result.blocks)).toEqual(['Body', 'Second']);
    expect(result.warnings.join(' ')).toMatch(/1 footnote was not imported/);
  });
});

describe('plain text and Markdown: details', () => {
  it('reads UTF-16, UTF-8 with a byte-order mark, and old Windows text', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Zoë sat.'].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(texts((await importManuscript('a.txt', utf16)).blocks)).toEqual(['Zoë sat.']);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Zoë sat.')]);
    expect(texts((await importManuscript('a.txt', bom)).blocks)).toEqual(['Zoë sat.']);
    const cp1252 = new Uint8Array([0x93, 0x5a, 0x6f, 0xeb, 0x94, 0x20, 0x97, 0x20, 0x73, 0x61, 0x74]);
    expect(texts((await importManuscript('a.txt', cp1252)).blocks)).toEqual(['“Zoë” — sat']);
  });

  it('turns Markdown structure into blocks', async () => {
    const md = '---\ntitle: T\nauthor: A\n---\n\n# One\n\nSome *italic* and **bold** text\nwrapped.\n\n> Quoted.\n\n***\n\n- item\n\n## Sub\n\nEnd.\n';
    const result = await importManuscript('a.md', enc(md));
    expect(result.meta).toMatchObject({ title: 'T', author: 'A' });
    expect(outline(result.blocks)).toEqual(['h1: One', 'p: Some italic and bold text wrapped.', 'quote: Quoted.', '[break]', 'ul: item', 'h2: Sub', 'p: End.']);
  });
});

describe('format detection', () => {
  it('trusts content over the file name', async () => {
    expect(sniffFormat('wrong-name.txt', enc('%PDF-1.7 ...'))).toBe('pdf');
    expect(sniffFormat('wrong-name.txt', enc('{\\rtf1 hello}'))).toBe('rtf');
    expect(sniffFormat('notes', enc('hello'))).toBe('txt');
    expect(() => sniffFormat('book.pdf', enc('hello'))).toThrow(/not a valid PDF/);
    expect(() => sniffFormat('book.xyz', enc('hello'))).toThrow(/not supported/);
  });

  it('refuses a PDF without a text layer instead of importing nothing', async () => {
    // A valid one-page PDF with no text at all, as a scan would be.
    const pdf =
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
    await expect(importManuscript('scan.pdf', enc(pdf), { loadPdf: loadPdfForTests })).rejects.toThrow(/no text layer/);
  });
});
