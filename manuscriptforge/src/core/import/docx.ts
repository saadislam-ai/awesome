import { strFromU8, unzipSync } from 'fflate';
import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';
import type { Align, DraftBlock, HeadingLevel, Run } from '../model/blocks';
import { finalizeBlocks, ImportError, type ImportMeta, type ImportResult } from './common';
import { normalizeLanguage } from '../text/language';

interface StyleDef {
  name: string;
  basedOn?: string;
  outline?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  align?: Align | 'left';
  pb?: boolean;
  list?: boolean;
}

interface ResolvedStyle extends StyleDef {
  headingLevel?: HeadingLevel;
  isToc: boolean;
  isTitle: boolean;
  isQuote: boolean;
}

function isEl(node: ChildNode): node is Element {
  return node.type === 'tag';
}

function kids(el: Element | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const c of el.children) if (isEl(c) && (!name || c.name === name)) out.push(c);
  return out;
}

function kid(el: Element | undefined, name: string): Element | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (isEl(c) && c.name === name) return c;
  return undefined;
}

function val(el: Element | undefined): string | undefined {
  return el?.attribs['w:val'];
}

/** Reads an on/off property such as <w:b/> or <w:b w:val="0"/>. */
function toggle(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = val(el);
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
}

function textOf(el: Element): string {
  let out = '';
  for (const c of el.children) {
    if (c.type === 'text') out += c.data;
    else if (isEl(c)) out += textOf(c);
  }
  return out;
}

function parseXml(bytes: Uint8Array | undefined): Element | undefined {
  if (!bytes) return undefined;
  const doc = parseDocument(strFromU8(bytes), { xmlMode: true, decodeEntities: true });
  return doc.children.find(isEl);
}

function findDeep(el: Element | undefined, name: string): Element | undefined {
  if (!el) return undefined;
  if (el.name === name) return el;
  for (const c of el.children) {
    if (isEl(c)) {
      const hit = findDeep(c, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

function alignOf(jc: string | undefined): Align | 'left' | undefined {
  if (!jc) return undefined;
  if (jc === 'center') return 'center';
  if (jc === 'right' || jc === 'end') return 'right';
  return 'left';
}

function readRunProps(rPr: Element | undefined): Pick<StyleDef, 'b' | 'i' | 'u' | 's'> {
  const strike = toggle(kid(rPr, 'w:strike'));
  const dstrike = toggle(kid(rPr, 'w:dstrike'));
  return {
    b: toggle(kid(rPr, 'w:b')),
    i: toggle(kid(rPr, 'w:i')),
    u: toggle(kid(rPr, 'w:u')),
    s: strike ?? dstrike,
  };
}

function readStyles(root: Element | undefined): Map<string, StyleDef> {
  const styles = new Map<string, StyleDef>();
  for (const style of kids(root, 'w:style')) {
    const id = style.attribs['w:styleId'];
    if (!id) continue;
    const pPr = kid(style, 'w:pPr');
    const outline = val(kid(pPr, 'w:outlineLvl'));
    styles.set(id, {
      name: val(kid(style, 'w:name')) ?? id,
      basedOn: val(kid(style, 'w:basedOn')),
      outline: outline !== undefined ? Number(outline) : undefined,
      align: alignOf(val(kid(pPr, 'w:jc'))),
      pb: toggle(kid(pPr, 'w:pageBreakBefore')),
      list: kid(pPr, 'w:numPr') ? true : undefined,
      ...readRunProps(kid(style, 'w:rPr')),
    });
  }
  return styles;
}

function readNumbering(root: Element | undefined): Map<string, boolean> {
  const abstractOrdered = new Map<string, boolean>();
  for (const abs of kids(root, 'w:abstractNum')) {
    const id = abs.attribs['w:abstractNumId'];
    const fmt = val(kid(kid(abs, 'w:lvl'), 'w:numFmt'));
    if (id) abstractOrdered.set(id, !!fmt && fmt !== 'bullet' && fmt !== 'none');
  }
  const ordered = new Map<string, boolean>();
  for (const num of kids(root, 'w:num')) {
    const id = num.attribs['w:numId'];
    const abs = val(kid(num, 'w:abstractNumId'));
    if (id && abs !== undefined) ordered.set(id, abstractOrdered.get(abs) ?? false);
  }
  return ordered;
}

const INLINE_WRAPPERS = new Set(['w:hyperlink', 'w:smartTag', 'w:ins', 'w:moveTo', 'w:fldSimple', 'w:sdt', 'w:sdtContent', 'w:customXml', 'w:bdo', 'w:dir']);

/** Imports a Word .docx file. */
export function importDocx(bytes: Uint8Array): ImportResult {
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new ImportError(
      'This looks like an older .doc file or a password-protected document. Open it in Word, remove any password, and save it as .docx.',
    );
  }
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes, {
      filter: (f) => /^(word\/(document|styles|numbering|footnotes|endnotes)\.xml|docProps\/core\.xml)$/.test(f.name),
    });
  } catch {
    throw new ImportError('This file could not be opened as a Word document. It may be damaged.');
  }
  const documentRoot = parseXml(zip['word/document.xml']);
  const body = findDeep(documentRoot, 'w:body');
  if (!body) throw new ImportError('This file is not a Word document: it has no document content.');

  const styleDefs = readStyles(parseXml(zip['word/styles.xml']));
  const numbering = readNumbering(parseXml(zip['word/numbering.xml']));
  const resolved = new Map<string, ResolvedStyle>();
  const warnings: string[] = [];

  const resolveStyle = (id: string | undefined, depth = 0): ResolvedStyle | undefined => {
    if (!id) return undefined;
    const cached = resolved.get(id);
    if (cached) return cached;
    const def = styleDefs.get(id);
    if (!def) return undefined;
    const parent = depth < 12 ? resolveStyle(def.basedOn, depth + 1) : undefined;
    const merged: ResolvedStyle = { ...def, isToc: false, isTitle: false, isQuote: false };
    for (const key of ['b', 'i', 'u', 's', 'align', 'pb', 'outline', 'list'] as const) {
      if (merged[key] === undefined && parent?.[key] !== undefined) (merged as unknown as Record<string, unknown>)[key] = parent[key];
    }
    const name = def.name.toLowerCase();
    const m = /^heading\s*(\d)/.exec(name);
    if (m) merged.headingLevel = Math.min(Math.max(Number(m[1]), 1), 4) as HeadingLevel;
    else if (name === 'title') merged.headingLevel = 1;
    else if (merged.outline !== undefined && merged.outline >= 0 && merged.outline < 9) {
      merged.headingLevel = Math.min(merged.outline + 1, 4) as HeadingLevel;
    } else if (parent?.headingLevel) merged.headingLevel = parent.headingLevel;
    merged.isToc = /^toc\s*(\d|heading)/.test(name) || /^contents\s*\d/.test(name);
    merged.isTitle = name === 'title';
    merged.isQuote = /^(quote|intense quote|block text|block quote|blockquote|block quotation|quotations?)$/.test(name) || !!parent?.isQuote;
    resolved.set(id, merged);
    return merged;
  };

  // Footnotes and endnotes are numbered in order of first reference.
  const noteTexts = new Map<string, string>();
  const readNotes = (root: Element | undefined, tag: string, prefix: string) => {
    for (const note of kids(root, tag)) {
      if (note.attribs['w:type']) continue; // separators
      const text = kids(note, 'w:p')
        .map((p) => collectPlain(p))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) noteTexts.set(prefix + note.attribs['w:id'], text);
    }
  };
  const collectPlain = (el: Element): string => {
    let out = '';
    for (const c of el.children) {
      if (!isEl(c)) continue;
      if (c.name === 'w:t') out += textOf(c);
      else if (c.name === 'w:tab') out += ' ';
      else if (c.name === 'w:del' || c.name === 'w:moveFrom') continue;
      else out += collectPlain(c);
    }
    return out;
  };
  readNotes(parseXml(zip['word/footnotes.xml']), 'w:footnote', 'f');
  readNotes(parseXml(zip['word/endnotes.xml']), 'w:endnote', 'e');
  const noteOrder: string[] = [];

  const blocks: DraftBlock[] = [];
  let images = 0;
  let textBoxes = 0;
  let pendingPb = false;
  let styledTitle: string | undefined;

  const paragraphBlock = (p: Element) => {
    const pPr = kid(p, 'w:pPr');
    const style = resolveStyle(val(kid(pPr, 'w:pStyle')));
    if (style?.isToc) return;

    const directOutline = val(kid(pPr, 'w:outlineLvl'));
    let headingLevel = style?.headingLevel;
    if (!headingLevel && directOutline !== undefined && Number(directOutline) < 9) {
      headingLevel = Math.min(Number(directOutline) + 1, 4) as HeadingLevel;
    }
    const align = alignOf(val(kid(pPr, 'w:jc'))) ?? style?.align;
    const numPr = kid(pPr, 'w:numPr');
    const numId = val(kid(numPr, 'w:numId'));
    const isList = !headingLevel && ((numPr && numId !== '0') || (!numPr && style?.list));
    let pb = pendingPb || (toggle(kid(pPr, 'w:pageBreakBefore')) ?? style?.pb ?? false);
    pendingPb = false;

    const runs: Run[] = [];
    let hasText = false;
    let isRule = false;

    const run = (r: Element) => {
      const rPr = kid(r, 'w:rPr');
      if (toggle(kid(rPr, 'w:vanish'))) return;
      const direct = readRunProps(rPr);
      const charStyle = resolveStyle(val(kid(rPr, 'w:rStyle')));
      const mark = (key: 'b' | 'i' | 'u' | 's'): boolean => direct[key] ?? charStyle?.[key] ?? style?.[key] ?? false;
      const caps = toggle(kid(rPr, 'w:caps'));
      const emit = (text: string) => {
        if (!text) return;
        const out: Run = { text: caps ? text.toUpperCase() : text };
        if (mark('b') && !headingLevel) out.b = true;
        if (mark('i')) out.i = true;
        if (mark('u')) out.u = true;
        if (mark('s')) out.s = true;
        runs.push(out);
        if (text.trim()) hasText = true;
      };
      for (const c of r.children) {
        if (!isEl(c)) continue;
        switch (c.name) {
          case 'w:t':
            emit(textOf(c));
            break;
          case 'w:tab':
            emit('\t');
            break;
          case 'w:br': {
            const type = c.attribs['w:type'];
            if (type === 'page' || type === 'column') {
              if (hasText) pendingPb = true;
              else pb = true;
            } else emit('\n');
            break;
          }
          case 'w:cr':
            emit('\n');
            break;
          case 'w:noBreakHyphen':
            emit('‑');
            break;
          case 'w:footnoteReference':
          case 'w:endnoteReference': {
            const key = (c.name === 'w:footnoteReference' ? 'f' : 'e') + c.attribs['w:id'];
            if (noteTexts.has(key)) {
              let index = noteOrder.indexOf(key);
              if (index < 0) index = noteOrder.push(key) - 1;
              emit(`[${index + 1}]`);
            }
            break;
          }
          case 'w:pict':
            // Word stores a horizontal rule as a small drawing.
            if (findDeep(c, 'v:rect')?.attribs['o:hr']) {
              isRule = true;
              break;
            }
            images++;
            if (findDeep(c, 'w:txbxContent')) textBoxes++;
            break;
          case 'w:drawing':
          case 'w:object':
            images++;
            if (findDeep(c, 'w:txbxContent')) textBoxes++;
            break;
          case 'mc:AlternateContent':
            images++;
            if (findDeep(c, 'w:txbxContent')) textBoxes++;
            break;
          default:
            break;
        }
      }
    };

    const walkInline = (nodes: ChildNode[]) => {
      for (const node of nodes) {
        if (!isEl(node)) continue;
        if (node.name === 'w:r') run(node);
        else if (INLINE_WRAPPERS.has(node.name)) walkInline(node.children);
      }
    };
    walkInline(p.children);

    // A section break ends the page after this paragraph.
    const sect = kid(pPr, 'w:sectPr');
    if (sect && val(kid(sect, 'w:type')) !== 'continuous') pendingPb = true;

    if (isRule && !hasText) {
      blocks.push({ type: 'break' });
      return;
    }
    if (style?.isTitle && hasText && styledTitle === undefined) styledTitle = runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();

    let block: DraftBlock;
    if (style?.isQuote && hasText && !headingLevel) {
      block = { type: 'quote', runs };
    } else if (headingLevel && hasText) {
      block = { type: 'heading', level: headingLevel, runs };
      if (align === 'right') block.align = 'right';
    } else if (isList && hasText) {
      block = { type: 'list', ordered: numbering.get(numId ?? '') ?? false, runs };
    } else {
      block = { type: 'paragraph', runs };
      if (hasText && (align === 'center' || align === 'right')) block.align = align;
    }
    if (pb) block.pb = true;
    blocks.push(block);
  };

  const walkBody = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (!isEl(node)) continue;
      if (node.name === 'w:p') paragraphBlock(node);
      else if (node.name === 'w:tbl') {
        for (const row of kids(node, 'w:tr')) for (const cell of kids(row, 'w:tc')) walkBody(cell.children);
      } else if (node.name === 'w:sdt') walkBody(kid(node, 'w:sdtContent')?.children ?? []);
      else if (node.name === 'w:ins' || node.name === 'w:moveTo' || node.name === 'w:customXml') walkBody(node.children);
    }
  };
  walkBody(body.children);

  if (noteOrder.length) {
    blocks.push({ type: 'heading', level: 1, runs: [{ text: 'Notes' }], pb: true });
    noteOrder.forEach((key, index) => {
      blocks.push({ type: 'paragraph', runs: [{ text: `[${index + 1}] ${noteTexts.get(key)}` }] });
    });
    warnings.push(
      `${noteOrder.length} footnote${noteOrder.length === 1 ? ' was' : 's were'} converted to numbered notes in a "Notes" chapter at the end of the book.`,
    );
  }
  if (images) warnings.push(`${images} image${images === 1 ? ' was' : 's were'} not imported. ManuscriptForge works on the text of a book.`);
  if (textBoxes) warnings.push(`${textBoxes} text box${textBoxes === 1 ? '' : 'es'} could not be imported. Check that no text is missing.`);

  const meta: ImportMeta = {};
  const core = parseXml(zip['docProps/core.xml']);
  const title = findDeep(core, 'dc:title');
  const creator = findDeep(core, 'dc:creator');
  const language = findDeep(core, 'dc:language');
  if (title && textOf(title).trim()) meta.title = textOf(title).trim();
  if (!meta.title && styledTitle) meta.title = styledTitle;
  if (creator && textOf(creator).trim()) meta.author = textOf(creator).trim();
  if (language) meta.language = normalizeLanguage(textOf(language));

  return { format: 'docx', blocks: finalizeBlocks(blocks), meta, warnings };
}
