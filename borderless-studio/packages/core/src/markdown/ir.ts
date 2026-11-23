/**
 * The intermediate representation (IR) of manuscript text. Markdown is parsed
 * into this small tree once, and every exporter (Typst for print, XHTML for
 * EPUB, DOCX for manuscripts) renders from it. Exporters therefore never see
 * Markdown syntax and cannot disagree about what the text means.
 *
 * Field names are short because the whole book is serialised to JSON and read
 * by the Typst template library.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'em'; c: Inline[] }
  | { t: 'strong'; c: Inline[] }
  /** Small capitals. */
  | { t: 'sc'; c: Inline[] }
  | { t: 'sup'; c: Inline[] }
  | { t: 'sub'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  /** A footnote or endnote, with its text carried at the point of reference. */
  | { t: 'fn'; id: string; c: Block[] }
  /** A forced line break inside a paragraph. */
  | { t: 'br' }
  /** An invisible index marker: the page it lands on is listed under `term`. */
  | { t: 'index'; term: string; sub?: string }
  /** Highlighted text (editorial only; exported as normal text). */
  | { t: 'mark'; c: Inline[] }
  | { t: 'img'; src: string; alt: string };

export type Block =
  | { t: 'p'; c: Inline[]; line?: number }
  /** A heading inside a chapter. Level 1 is the largest. */
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[]; id: string; line?: number }
  | { t: 'scenebreak'; line?: number }
  | { t: 'quote'; c: Block[]; line?: number }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][]; line?: number }
  | {
      t: 'table';
      align: ('left' | 'center' | 'right' | null)[];
      head: Inline[][];
      rows: Inline[][][];
      caption?: Inline[];
      line?: number;
    }
  | {
      t: 'figure';
      src: string;
      alt: string;
      caption?: Inline[];
      /** Width as a fraction of the text block (0 to 1). */
      width?: number;
      /** "page" fills the whole page edge to edge (needs a bleed format). */
      bleed?: 'page' | 'none';
      line?: number;
    }
  | { t: 'callout'; kind: string; title?: Inline[]; c: Block[]; line?: number }
  /** Poetry: stanzas of lines, never rewrapped. */
  | { t: 'verse'; stanzas: Inline[][][]; line?: number }
  | { t: 'align'; align: 'center' | 'right'; c: Block[]; line?: number }
  | { t: 'code'; v: string; line?: number }
  | { t: 'pagebreak'; line?: number };

export interface ParseWarning {
  message: string;
  line?: number;
}

export interface ParsedDoc {
  blocks: Block[];
  warnings: ParseWarning[];
}

/** Plain text of inline content, without any markup. */
export function inlineText(inlines: Inline[]): string {
  let out = '';
  for (const n of inlines) {
    switch (n.t) {
      case 'text':
      case 'code':
        out += n.v;
        break;
      case 'br':
        out += ' ';
        break;
      case 'em':
      case 'strong':
      case 'sc':
      case 'sup':
      case 'sub':
      case 'link':
      case 'mark':
        out += inlineText(n.c);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Plain text of blocks, one paragraph per line. Footnote text is not included. */
export function blocksText(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'p':
      case 'h':
        out.push(inlineText(b.c));
        break;
      case 'quote':
      case 'callout':
      case 'align':
        out.push(blocksText(b.c));
        break;
      case 'list':
        for (const item of b.items) out.push(blocksText(item));
        break;
      case 'verse':
        for (const st of b.stanzas) out.push(st.map(inlineText).join('\n'));
        break;
      case 'table':
        out.push(b.head.map(inlineText).join(' | '));
        for (const r of b.rows) out.push(r.map(inlineText).join(' | '));
        break;
      case 'figure':
        if (b.caption) out.push(inlineText(b.caption));
        break;
      case 'code':
        out.push(b.v);
        break;
      default:
        break;
    }
  }
  return out.join('\n');
}

/** Visit every inline node (depth first), including those inside footnotes. */
export function walkInlines(blocks: Block[], visit: (n: Inline) => void): void {
  const doInlines = (list: Inline[]) => {
    for (const n of list) {
      visit(n);
      if ('c' in n && Array.isArray(n.c)) {
        if (n.t === 'fn') walkInlines(n.c, visit);
        else doInlines(n.c as Inline[]);
      }
    }
  };
  for (const b of blocks) {
    switch (b.t) {
      case 'p':
      case 'h':
        doInlines(b.c);
        break;
      case 'quote':
      case 'callout':
      case 'align':
        if (b.t === 'callout' && b.title) doInlines(b.title);
        walkInlines(b.c, visit);
        break;
      case 'list':
        for (const item of b.items) walkInlines(item, visit);
        break;
      case 'verse':
        for (const st of b.stanzas) for (const line of st) doInlines(line);
        break;
      case 'table':
        for (const cell of b.head) doInlines(cell);
        for (const row of b.rows) for (const cell of row) doInlines(cell);
        if (b.caption) doInlines(b.caption);
        break;
      case 'figure':
        if (b.caption) doInlines(b.caption);
        break;
      default:
        break;
    }
  }
}

/** Every image path used by a list of blocks. */
export function collectImages(blocks: Block[]): string[] {
  const out = new Set<string>();
  const visitBlocks = (list: Block[]) => {
    for (const b of list) {
      if (b.t === 'figure') out.add(b.src);
      else if (b.t === 'quote' || b.t === 'callout' || b.t === 'align') visitBlocks(b.c);
      else if (b.t === 'list') b.items.forEach(visitBlocks);
    }
  };
  visitBlocks(blocks);
  walkInlines(blocks, (n) => {
    if (n.t === 'img') out.add(n.src);
    if (n.t === 'fn') visitBlocks(n.c);
  });
  return [...out];
}
