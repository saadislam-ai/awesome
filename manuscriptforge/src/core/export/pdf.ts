import { chartSvg } from '../analysis/charts';
import type { Report, ReportBlock } from '../analysis/report';
import type { Block, Run } from '../model/blocks';
import { hasPrintableTitle, type ExportBook } from './common';

/** The four font files a PDF is set in: one family, wide in the languages it covers. */
export interface PdfFonts {
  normal: Uint8Array;
  bold: Uint8Array;
  italics: Uint8Array;
  bolditalics: Uint8Array;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const UNSUPPORTED_SCRIPTS: [RegExp, string][] = [
  [/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, 'Chinese or Japanese'],
  [/\p{Script=Hangul}/u, 'Korean'],
  [/\p{Script=Arabic}/u, 'Arabic script'],
  [/\p{Script=Hebrew}/u, 'Hebrew'],
  [/[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Gujarati}\p{Script=Gurmukhi}]/u, 'an Indic script'],
  [/\p{Script=Thai}/u, 'Thai'],
];

/**
 * The PDF font covers Latin, Greek and Cyrillic alphabets. Returns the name
 * of a script in the text that it cannot print, or null when all is well.
 */
export function unsupportedScript(text: string): string | null {
  for (const [pattern, name] of UNSUPPORTED_SCRIPTS) if (pattern.test(text)) return name;
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

let fontsRegistered = false;

/** Turns a document definition into the bytes of a PDF file. The PDF library is loaded only when first needed. */
export async function renderPdf(definition: Record<string, unknown>, fonts: PdfFonts): Promise<Uint8Array> {
  const module = await import('pdfmake/build/pdfmake.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake = ((module as any).default ?? module) as any;
  if (!fontsRegistered) {
    pdfMake.addVirtualFileSystem({ 'Book.ttf': toBase64(fonts.normal), 'Book-Bold.ttf': toBase64(fonts.bold), 'Book-Italic.ttf': toBase64(fonts.italics), 'Book-BoldItalic.ttf': toBase64(fonts.bolditalics) });
    pdfMake.addFonts({ Book: { normal: 'Book.ttf', bold: 'Book-Bold.ttf', italics: 'Book-Italic.ttf', bolditalics: 'Book-BoldItalic.ttf' } });
    fontsRegistered = true;
  }
  const buffer = await pdfMake.createPdf({ ...definition, defaultStyle: { font: 'Book', ...(definition.defaultStyle as object) } }).getBuffer();
  return new Uint8Array(buffer);
}

function inline(runs: Run[]): Node[] {
  return runs.filter((r) => r.text).map((r) => {
    const node: Node = { text: r.text };
    if (r.b) node.bold = true;
    if (r.i) node.italics = true;
    const decoration = [r.u ? 'underline' : '', r.s ? 'lineThrough' : ''].filter(Boolean);
    if (decoration.length) node.decoration = decoration;
    return node;
  });
}

function manuscriptBlocks(blocks: Block[]): Node[] {
  const out: Node[] = [];
  let afterBreak = true;
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'break') {
      out.push({ text: '* * *', alignment: 'center', margin: [0, 10, 0, 10] });
      afterBreak = true;
      i++;
    } else if (block.type === 'heading') {
      out.push({ text: inline(block.runs), bold: true, fontSize: block.level <= 2 ? 13 : 12, margin: [0, 14, 0, 6], alignment: block.align ?? 'left' });
      afterBreak = true;
      i++;
    } else if (block.type === 'quote') {
      out.push({ text: inline(block.runs), margin: [28, 4, 28, 4] });
      i++;
    } else if (block.type === 'list') {
      const items: Node[] = [];
      const ordered = block.ordered;
      while (i < blocks.length) {
        const item = blocks[i];
        if (item.type !== 'list' || item.ordered !== ordered) break;
        items.push({ text: inline(item.runs) });
        i++;
      }
      out.push({ [ordered ? 'ol' : 'ul']: items, margin: [14, 4, 0, 4] });
    } else {
      // As in a printed book: paragraphs are indented, except the first after a heading or a break.
      const node: Node = { text: block.runs.length ? inline(block.runs) : ' ' };
      if (block.align) node.alignment = block.align;
      else {
        node.alignment = 'justify';
        if (!afterBreak) node.leadingIndent = 20;
      }
      out.push(node);
      afterBreak = false;
      i++;
    }
  }
  return out;
}

/** A reading copy of the book: title page, one chapter per new page, page numbers. */
export function manuscriptPdfDefinition(book: ExportBook): Record<string, unknown> {
  const content: Node[] = [
    { text: book.title, fontSize: 24, bold: true, alignment: 'center', margin: [0, 200, 0, 14] },
    ...(book.author ? [{ text: book.author, fontSize: 14, alignment: 'center' }] : []),
  ];
  for (const chapter of book.chapters) {
    // A chapter that only repeats the title page adds nothing in a PDF that has its own.
    if (/^title page$/i.test(chapter.title.trim())) continue;
    const blocks = manuscriptBlocks(chapter.blocks);
    const head: Node = hasPrintableTitle(chapter)
      ? { text: chapter.title, fontSize: 16, bold: true, alignment: 'center', margin: [0, 60, 0, 28], pageBreak: 'before' }
      : { text: '', pageBreak: 'before' };
    content.push(head, ...blocks);
  }
  return {
    pageSize: 'A4',
    pageMargins: [80, 72, 80, 72],
    info: { title: book.title, author: book.author },
    defaultStyle: { fontSize: 11, lineHeight: 1.35 },
    footer: (page: number) => (page > 1 ? { text: String(page), alignment: 'center', fontSize: 9, margin: [0, 24, 0, 0] } : ''),
    content,
  };
}

function reportBlock(block: ReportBlock): Node[] {
  switch (block.kind) {
    case 'p':
      return [{ text: block.text, margin: [0, 3, 0, 5], ...(block.muted ? { color: '#666666', fontSize: 9 } : {}) }];
    case 'bullets':
      // The PDF library rewrites the lists it is given, so it gets its own copies, never the report's.
      return [{ ul: block.items.map((text) => ({ text })), margin: [4, 0, 0, 8] }];
    case 'numbered':
      return [{ ol: block.items.map((text) => ({ text })), margin: [4, 0, 0, 8] }];
    case 'facts':
      return [{ table: { widths: [120, '*'], body: block.rows.map(([k, v]) => [{ text: k, color: '#666666' }, v]) }, layout: 'noBorders', margin: [0, 2, 0, 8] }];
    case 'table': {
      const total = (block.widths ?? block.head.map(() => 1)).reduce((a, b) => a + b, 0);
      // Columns share the page width in the proportions given.
      const widths = (block.widths ?? block.head.map(() => 1)).map((w) => `${((w / total) * 96).toFixed(1)}%`);
      return [{
        table: { headerRows: 1, widths, body: [block.head.map((h) => ({ text: h, bold: true, fontSize: 9 })), ...block.rows.map((row) => row.map((cell) => ({ text: cell, fontSize: 9 })))] },
        layout: 'lightHorizontalLines', margin: [0, 4, 0, 10],
      }];
    }
    case 'chart':
      return [{ unbreakable: true, stack: [{ text: block.chart.title, fontSize: 9, bold: true, margin: [0, 8, 0, 2] }, { svg: chartSvg(block.chart, 440, 150), width: 440 }], margin: [0, 0, 0, 6] }];
  }
}

/** The analysis report laid out for printing. */
export function reportPdfDefinition(report: Report): Record<string, unknown> {
  const content: Node[] = [
    { text: report.title, fontSize: 18, bold: true, margin: [0, 0, 0, 4] },
    { text: report.subtitle, color: '#666666', margin: [0, 0, 0, 14] },
  ];
  for (const section of report.sections) {
    content.push({ text: section.heading, fontSize: 13, bold: true, margin: [0, 12, 0, 6] });
    for (const block of section.blocks) content.push(...reportBlock(block));
  }
  return {
    pageSize: 'A4',
    pageMargins: [56, 56, 56, 56],
    info: { title: report.title },
    defaultStyle: { fontSize: 10, lineHeight: 1.25 },
    footer: (page: number, pages: number) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, color: '#666666', margin: [0, 20, 0, 0] }),
    content,
  };
}
