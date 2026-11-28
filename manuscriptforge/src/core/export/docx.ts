import { strToU8, zipSync } from 'fflate';
import { alignBlocks, diffTokens, tokenize } from '../edit/diff';
import { blockText, type Block, type Run } from '../model/blocks';
import { escapeXml, hasPrintableTitle, type ExportBook, type ExportChapter } from './common';

export interface DocxOptions {
  /**
   * An earlier version of the same book. When given, every difference
   * between it and the book is written as a tracked change.
   */
  compareTo?: ExportChapter[];
  /** Name shown in Word as the author of the tracked changes. */
  revisionAuthor?: string;
  /** Date of the tracked changes. Defaults to now. */
  revisionDate?: Date;
}

type Change = 'ins' | 'del' | undefined;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A block as it is written: scene breaks become a centred line, chapter titles a heading. */
type Para =
  | { kind: 'title'; runs: Run[] }
  | { kind: 'block'; block: Block };

function paraRuns(p: Para): Run[] {
  if (p.kind === 'title') return p.runs;
  return p.block.type === 'break' ? [{ text: '* * *' }] : p.block.runs;
}

function paraKey(p: Para): string {
  const type = p.kind === 'title' ? 'title' : p.block.type === 'heading' ? `h${p.block.level}` : p.block.type;
  return `${type}\u0001${paraRuns(p).map((r) => r.text).join('')}`;
}

class Writer {
  private id = 1;
  private lists = 0;
  private lastListKey = '';
  readonly numIds: { id: number; ordered: boolean }[] = [];
  private readonly stamp: string;

  constructor(author: string, date: Date) {
    this.stamp = `w:author="${escapeXml(author)}" w:date="${date.toISOString().replace(/\.\d+Z$/, 'Z')}"`;
  }

  private mark(change: 'ins' | 'del'): string {
    return `<w:${change} w:id="${this.id++}" ${this.stamp}/>`;
  }

  private run(run: Run, change: Change): string {
    const props = `${run.b ? '<w:b/>' : ''}${run.i ? '<w:i/>' : ''}${run.s ? '<w:strike/>' : ''}${run.u ? '<w:u w:val="single"/>' : ''}`;
    const tag = change === 'del' ? 'w:delText' : 'w:t';
    const parts = run.text.split('\n');
    let inner = '';
    parts.forEach((part, index) => {
      if (index > 0) inner += '<w:br/>';
      if (part) inner += `<${tag} xml:space="preserve">${escapeXml(part)}</${tag}>`;
    });
    const xml = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${inner}</w:r>`;
    if (!change) return xml;
    return `<w:${change} w:id="${this.id++}" ${this.stamp}>${xml}</w:${change}>`;
  }

  private runs(runs: Run[], change: Change): string {
    return runs.filter((r) => r.text).map((r) => this.run(r, change)).join('');
  }

  /** Runs for a paragraph that exists in both versions but was edited. */
  private trackedRuns(before: Run[], after: Run[]): string {
    const split = (runs: Run[]) => runs.flatMap((run) => tokenize(run.text).map((text) => ({ ...run, text })));
    const a = split(before);
    const b = split(after);
    let xml = '';
    const flush = (tokens: Run[], change: Change) => {
      // Join neighbouring tokens with the same formatting back into one run.
      const merged: Run[] = [];
      for (const token of tokens) {
        const last = merged[merged.length - 1];
        if (last && last.b === token.b && last.i === token.i && last.u === token.u && last.s === token.s) last.text += token.text;
        else merged.push({ ...token });
      }
      xml += this.runs(merged, change);
    };
    for (const op of diffTokens(a.map((t) => t.text), b.map((t) => t.text))) {
      if (op.type === 'equal') flush(b.slice(op.b, op.b + op.count), undefined);
      else if (op.type === 'delete') flush(a.slice(op.a, op.a + op.count), 'del');
      else flush(b.slice(op.b, op.b + op.count), 'ins');
    }
    return xml;
  }

  private properties(p: Para, pageBreak: boolean, change: Change): string {
    let props = '';
    if (p.kind === 'title') {
      props += '<w:pStyle w:val="Heading1"/>';
      this.lastListKey = '';
    } else {
      const block = p.block;
      if (block.type === 'heading') props += `<w:pStyle w:val="Heading${Math.min(block.level + 1, 4)}"/>`;
      else if (block.type === 'quote') props += '<w:pStyle w:val="Quote"/>';
      else if (block.type === 'break') props += '<w:pStyle w:val="SceneBreak"/>';
      else if (block.type === 'list') props += '<w:pStyle w:val="ListParagraph"/>';
      else if (block.align) props += '<w:pStyle w:val="NoIndent"/>';
      if (block.type === 'list') {
        // Each separate list gets its own numbering, so numbered lists restart at 1.
        const key = `${block.ordered}`;
        if (this.lastListKey !== key) {
          this.lists++;
          this.numIds.push({ id: this.lists, ordered: block.ordered });
          this.lastListKey = key;
        }
        props += `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${this.lists}"/></w:numPr>`;
      } else this.lastListKey = '';
      if ((block.type === 'paragraph' || block.type === 'heading') && block.align) props += `<w:jc w:val="${block.align}"/>`;
    }
    if (pageBreak) props = props.replace(/(<w:pStyle[^>]*\/>)?/, (m) => `${m}<w:pageBreakBefore/>`);
    // A tracked change to the paragraph mark means the whole paragraph was added or removed.
    if (change) props += `<w:rPr>${this.mark(change)}</w:rPr>`;
    return props ? `<w:pPr>${props}</w:pPr>` : '';
  }

  paragraph(p: Para, pageBreak: boolean, change: Change): string {
    return `<w:p>${this.properties(p, pageBreak, change)}${this.runs(paraRuns(p), change)}</w:p>`;
  }

  modified(before: Para, after: Para, pageBreak: boolean): string {
    return `<w:p>${this.properties(after, pageBreak, undefined)}${this.trackedRuns(paraRuns(before), paraRuns(after))}</w:p>`;
  }
}

function paras(chapter: ExportChapter): Para[] {
  const list: Para[] = [];
  if (hasPrintableTitle(chapter)) list.push({ kind: 'title', runs: [{ text: chapter.title }] });
  for (const block of chapter.blocks) list.push({ kind: 'block', block });
  return list;
}

function body(book: ExportBook, options: DocxOptions, writer: Writer): string {
  let xml = '';
  let first = true;
  const emit = (list: Para[], change: Change) => {
    list.forEach((p, index) => {
      xml += writer.paragraph(p, index === 0 && !first, change);
    });
    if (list.length) first = false;
  };

  if (!options.compareTo) {
    for (const chapter of book.chapters) emit(paras(chapter), undefined);
    return xml;
  }

  const old = options.compareTo;
  const oldIndex = new Map(old.map((c, i) => [c.id, i]));
  const emitted = new Set<number>();
  for (const chapter of book.chapters) {
    const match = chapter.id !== undefined ? oldIndex.get(chapter.id) : undefined;
    if (match === undefined) {
      emit(paras(chapter), 'ins');
      continue;
    }
    // Chapters removed since the old version appear where they used to be.
    for (let i = 0; i < match; i++) {
      if (!emitted.has(i) && !book.chapters.some((c) => c.id === old[i].id)) {
        emit(paras(old[i]), 'del');
        emitted.add(i);
      }
    }
    emitted.add(match);
    const before = paras(old[match]);
    const after = paras(chapter);
    const pairs = alignBlocks(before.map(paraKey), after.map(paraKey));
    let firstInChapter = true;
    for (const pair of pairs) {
      const pageBreak = firstInChapter && !first;
      if (pair.a !== undefined && pair.b !== undefined) {
        const same = JSON.stringify(paraRuns(before[pair.a])) === JSON.stringify(paraRuns(after[pair.b]));
        xml += same ? writer.paragraph(after[pair.b], pageBreak, undefined) : writer.modified(before[pair.a], after[pair.b], pageBreak);
      } else if (pair.b !== undefined) xml += writer.paragraph(after[pair.b], pageBreak, 'ins');
      else xml += writer.paragraph(before[pair.a!], pageBreak, 'del');
      firstInChapter = false;
    }
    if (pairs.length) first = false;
  }
  old.forEach((chapter, i) => {
    if (!emitted.has(i) && !book.chapters.some((c) => c.id === chapter.id)) emit(paras(chapter), 'del');
  });
  return xml;
}

const STYLES = `${XML}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="NoIndent"><w:name w:val="No Indent"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="1440" w:after="480"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:firstLine="0"/><w:contextualSpacing/></w:pPr></w:style>
</w:styles>`;

function numbering(numIds: { id: number; ordered: boolean }[]): string {
  const level = (format: string, text: string) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  return `${XML}<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level('bullet', '•')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level('decimal', '%1.')}</w:abstractNum>
${numIds
  .map(
    (n) =>
      `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.ordered ? 1 : 0}"/>${n.ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`,
  )
  .join('')}
</w:numbering>`;
}

/**
 * Writes the book as a Word document in standard manuscript format. With
 * `compareTo`, differences from that earlier version are real Word tracked
 * changes: insertions, deletions, and added or removed paragraphs.
 */
export function exportDocx(book: ExportBook, options: DocxOptions = {}): Uint8Array {
  const date = options.revisionDate ?? new Date();
  const writer = new Writer(options.revisionAuthor ?? 'ManuscriptForge', date);
  const content = body(book, options, writer);
  const section = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const iso = date.toISOString().replace(/\.\d+Z$/, 'Z');
  const language = book.language && book.language !== 'und' ? `<dc:language>${escapeXml(book.language)}</dc:language>` : '';
  const files: Record<string, string> = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
    'word/document.xml': `${XML}<w:document ${W}><w:body>${content}${section}</w:body></w:document>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': numbering(writer.numIds),
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(book.title)}</dc:title><dc:creator>${escapeXml(book.author)}</dc:creator>${language}<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

/** Counts used in the export screen: how much changed between two versions. */
export function compareSummary(before: ExportChapter[], after: ExportChapter[]): { changed: number; added: number; removed: number } {
  let changed = 0;
  let added = 0;
  let removed = 0;
  const oldById = new Map(before.map((c) => [c.id, c]));
  for (const chapter of after) {
    const old = chapter.id !== undefined ? oldById.get(chapter.id) : undefined;
    if (!old) {
      added += chapter.blocks.length;
      continue;
    }
    for (const pair of alignBlocks(old.blocks.map(blockText), chapter.blocks.map(blockText))) {
      if (pair.a === undefined) added++;
      else if (pair.b === undefined) removed++;
      else if (JSON.stringify(old.blocks[pair.a]) !== JSON.stringify(chapter.blocks[pair.b])) changed++;
    }
  }
  for (const chapter of before) if (!after.some((c) => c.id === chapter.id)) removed += chapter.blocks.length;
  return { changed, added, removed };
}
