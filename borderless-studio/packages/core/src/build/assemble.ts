/**
 * Assembly: turn a book project (binder + Markdown files + metadata) into an
 * ordered list of sections that every exporter can render. This is where
 * chapter numbers are assigned, scenes are joined with scene breaks, and the
 * generated pages (half title, title page, copyright page, contents) are
 * produced from metadata.
 */
import {
  authorsLine, baseLanguage, getFormat, primaryAuthor,
  type Binder, type BinderNode, type Book, type BookFormat, type SectionKind,
} from '../model/book';
import { applyDesignOverride, type Design } from '../model/design';
import type { CriticView } from '../markdown/critic';
import { countCritic } from '../markdown/critic';
import type { Block, Inline, ParseWarning } from '../markdown/ir';
import { blocksText, collectImages, walkInlines } from '../markdown/ir';
import { parseMarkdown } from '../markdown/parse';
import { countDashes, smartenBlocks, smartenText } from '../markdown/typography';
import { countWords } from '../util/text';
import { chapterLabel, partLabel, stringsFor, usesBengaliDigits, type BookStrings } from './strings';
import { toBengaliDigits } from '../util/text';

export type Zone = 'front' | 'body' | 'back';

export interface SectionOrigin {
  /** Binder node the blocks came from. */
  nodeId: string;
  title: string;
  /** Index range [from, to) into the section's blocks. */
  from: number;
  to: number;
}

export interface AssembledSection {
  id: string;
  kind: SectionKind;
  zone: Zone;
  title: string;
  subtitle: string;
  /** "Chapter One", "Part II" ... Empty when the section has no label. */
  label: string;
  number: number | null;
  /** Short label for the contents page ("1"). */
  tocLabel: string;
  /** Text for the running head. */
  head: string;
  blocks: Block[];
  /** Structured data for generated sections (title page, also by ...). */
  data: Record<string, unknown>;
  /** List in the table of contents. */
  toc: boolean;
  /** Start on a right hand page (print). */
  recto: boolean;
  origins: SectionOrigin[];
}

export interface BuildWarning {
  severity: 'info' | 'warn' | 'fail';
  code: string;
  message: string;
  /** Where in the manuscript, when known. */
  nodeId?: string;
  line?: number;
}

export interface AssembledBook {
  book: Book;
  format: BookFormat;
  design: Design;
  strings: BookStrings;
  sections: AssembledSection[];
  warnings: BuildWarning[];
  stats: {
    words: number;
    chapters: number;
    notes: number;
    images: string[];
    indexMarkers: number;
    pendingChanges: number;
    comments: number;
    emDashes: number;
    enDashes: number;
    typedDashes: number;
  };
}

export interface AlsoByGroup {
  label: string;
  titles: string[];
}

export interface AssembleOptions {
  formatId: string;
  /** How pending tracked changes are read: "original" ignores suggestions, "accepted" applies them. */
  criticView?: CriticView;
  /** Display form of an ISBN (hyphenated when the publisher prefix is known). */
  isbnDisplay?: (isbn: string) => string;
  /** Other books for the "Also by" page (series manager supplies this). */
  alsoBy?: AlsoByGroup[];
  /** Sample builder: keep only the first N body chapters. */
  sampleChapters?: number;
  /** List every format's ISBN on the copyright page instead of only this format's. */
  listAllIsbns?: boolean;
  /** Extra notice printed on the copyright page (advance reader copies). */
  notice?: string;
}

const CHAPTER_LIKE: ReadonlySet<SectionKind> = new Set<SectionKind>([
  'chapter', 'scene', 'interlude', 'prologue', 'epilogue', 'foreword', 'preface', 'introduction', 'afterword',
  'acknowledgements', 'about-author', 'note-to-readers', 'reading-group', 'bibliography', 'appendix', 'glossary', 'generic',
]);

const FRONT_RECTO: ReadonlySet<SectionKind> = new Set<SectionKind>([
  'half-title', 'title-page', 'dedication', 'epigraph', 'toc', 'foreword', 'preface', 'introduction', 'prologue',
]);

const text = (v: string): Inline => ({ t: 'text', v });
const para = (...c: (Inline | string)[]): Block => ({ t: 'p', c: c.map((x) => (typeof x === 'string' ? text(x) : x)) });

function formatName(format: BookFormat, s: BookStrings): string {
  if (format.largePrint) return s.formatNames.largePrint;
  return s.formatNames[format.type];
}

/** The copyright (imprint) page, built from metadata. */
export function copyrightBlocks(book: Book, format: BookFormat, opts: AssembleOptions, design: Design): Block[] {
  const s = stringsFor(book.language);
  const bn = usesBengaliDigits(book.language);
  const year = bn ? toBengaliDigits(book.copyright.year) : String(book.copyright.year);
  const isbnText = opts.isbnDisplay ?? ((x: string) => x);
  const out: Block[] = [];
  const place = [book.publisherCity, book.publisherCountry].filter(Boolean).join(', ');
  out.push(para(`${s.publishedBy} ${book.imprint}${place ? ', ' + place : ''}`));
  if (book.publisherWebsite) out.push(para(book.publisherWebsite));
  const holder = book.copyright.holder || primaryAuthor(book);
  out.push(para(`${s.copyrightWord} © ${year} ${holder}`));
  if (s.moralRight) out.push(para(s.moralRight));
  if (book.copyright.rightsStatement) out.push(para(book.copyright.rightsStatement));
  if (opts.notice) out.push(para({ t: 'strong', c: [text(opts.notice)] }));
  if (book.copyright.nlaCatalogueLine && s.nlaLine) out.push(para(s.nlaLine));
  const formats = opts.listAllIsbns ? [format, ...book.formats.filter((f) => f.id !== format.id && f.enabled && f.isbn)] : [format];
  const isbnLines: Inline[] = [];
  for (const f of formats) {
    if (!f.isbn) continue;
    if (isbnLines.length) isbnLines.push({ t: 'br' });
    isbnLines.push(text(`ISBN ${isbnText(f.isbn)} (${formatName(f, s)})`));
  }
  if (isbnLines.length) out.push({ t: 'p', c: isbnLines });
  const edition = book.editionStatement || `${s.firstPublished} ${year}`;
  out.push(para(/\d{4}|[০-৯]{4}/.test(edition) ? edition : `${edition} ${year}`));
  for (const line of book.copyright.extraLines) if (line.trim()) out.push(para(line));
  if (format.type !== 'ebook' && s.typesetIn) out.push(para(`${s.typesetIn} ${design.bodyFont}`));
  return smartenBlocks(out, book.style);
}

/** Split an epigraph into the quotation and its source ("- Author, Work" on the last line). */
function splitEpigraph(blocks: Block[], node: BinderNode): { blocks: Block[]; source: string } {
  const given = typeof node.data?.source === 'string' ? (node.data.source as string) : '';
  if (given) return { blocks, source: given };
  const last = blocks[blocks.length - 1];
  if (last && last.t === 'p') {
    const t = blocksText([last]).trim();
    const m = /^(?:-{1,3}|~|—|–)\s*(.+)$/.exec(t);
    if (m && blocks.length > 1) return { blocks: blocks.slice(0, -1), source: m[1] };
  }
  return { blocks, source: '' };
}

export function assembleBook(
  book: Book,
  binder: Binder,
  docs: Map<string, string>,
  opts: AssembleOptions,
): AssembledBook {
  const format = getFormat(book, opts.formatId);
  const design = applyDesignOverride(book.design, format.designOverride);
  const s = stringsFor(book.language);
  const warnings: BuildWarning[] = [];
  const sections: AssembledSection[] = [];
  const isPrint = format.type !== 'ebook';
  const stats: AssembledBook['stats'] = {
    words: 0, chapters: 0, notes: 0, images: [], indexMarkers: 0,
    pendingChanges: 0, comments: 0, emDashes: 0, enDashes: 0, typedDashes: 0,
  };
  const images = new Set<string>();
  let chapterNo = 0;
  let partNo = 0;
  let bodyChapters = 0;
  let afterPart = false;

  const included = (n: BinderNode): boolean =>
    n.include !== false && (!n.onlyFormats || n.onlyFormats.length === 0 || n.onlyFormats.includes(format.id));

  const smart = (t: string) => smartenText(t, book.style);

  /** Parse one document and collect its statistics. */
  const parseDoc = (node: BinderNode): Block[] => {
    if (!node.file) return [];
    const src = docs.get(node.id) ?? '';
    const critic = countCritic(src);
    stats.pendingChanges += critic.changes;
    stats.comments += critic.comments;
    const parsed = parseMarkdown(src, { criticView: opts.criticView ?? 'original' });
    for (const w of parsed.warnings as ParseWarning[]) {
      warnings.push({ severity: 'warn', code: 'markdown', message: w.message, nodeId: node.id, line: w.line });
    }
    const plain = blocksText(parsed.blocks);
    const d = countDashes(plain, book.style.dashPolicy.includeTypedHyphens);
    stats.emDashes += d.em;
    stats.enDashes += d.en;
    stats.typedDashes += d.typed;
    return smartenBlocks(parsed.blocks, book.style);
  };

  const finish = (sec: AssembledSection): void => {
    for (const img of collectImages(sec.blocks)) images.add(img);
    walkInlines(sec.blocks, (n) => {
      if (n.t === 'fn') stats.notes++;
      if (n.t === 'index') stats.indexMarkers++;
    });
    if (sec.zone === 'body') stats.words += countWords(blocksText(sec.blocks));
    sections.push(sec);
  };

  const base = (node: BinderNode, zone: Zone, kind: SectionKind): AssembledSection => {
    const title = smart(node.title || s.kinds[kind] || '');
    return {
      id: node.id, kind, zone, title, subtitle: smart(node.subtitle ?? ''), label: '', number: null, tocLabel: '',
      head: title, blocks: [], data: {}, toc: false, recto: false, origins: [],
    };
  };

  /** Chapter text: its own file, then each child document, separated by scene breaks. */
  const gather = (node: BinderNode, sec: AssembledSection): void => {
    const pieces: { node: BinderNode; blocks: Block[] }[] = [];
    if (node.file) pieces.push({ node, blocks: parseDoc(node) });
    for (const child of node.children ?? []) {
      if (!included(child) || !child.file) continue;
      pieces.push({ node: child, blocks: parseDoc(child) });
    }
    for (const p of pieces) {
      if (p.blocks.length === 0) continue;
      if (sec.blocks.length > 0 && sec.blocks[sec.blocks.length - 1].t !== 'scenebreak' && p.blocks[0].t !== 'scenebreak') {
        sec.blocks.push({ t: 'scenebreak' });
      }
      const from = sec.blocks.length;
      sec.blocks.push(...p.blocks);
      sec.origins.push({ nodeId: p.node.id, title: p.node.title, from, to: sec.blocks.length });
    }
  };

  const chapterLike = (node: BinderNode, zone: Zone): void => {
    const kind = node.kind === 'scene' ? 'chapter' : node.kind;
    const sec = base(node, zone, kind);
    gather(node, sec);
    const numbered = zone === 'body' && kind === 'chapter' && node.numbered !== false;
    if (numbered) {
      chapterNo++;
      sec.number = chapterNo;
      sec.label = smart(chapterLabel(chapterNo, design.chapterOpener.numberStyle, book.language));
      sec.tocLabel = usesBengaliDigits(book.language) ? toBengaliDigits(chapterNo) : String(chapterNo);
      // A chapter with a number but no title of its own is known by its label.
      if (/^chapter title$/i.test(node.title) || node.title.trim() === '') sec.title = '';
      sec.head = sec.title || sec.label || `${s.chapter} ${sec.tocLabel}`;
    }
    if (zone === 'body') {
      bodyChapters++;
      if (kind === 'chapter') stats.chapters++;
    }
    sec.toc = true;
    sec.recto = design.chapterOpener.startOn === 'recto' || afterPart || (zone === 'front' && FRONT_RECTO.has(kind));
    afterPart = false;
    if (sec.blocks.length === 0) {
      warnings.push({
        severity: 'warn', code: 'empty-section', nodeId: node.id,
        message: `"${node.title || sec.label || kind}" has no text. Empty chapters are flagged by retailers; write it or untick "include".`,
      });
    }
    finish(sec);
  };

  const generated = (node: BinderNode, zone: Zone): void => {
    const sec = base(node, zone, node.kind);
    switch (node.kind) {
      case 'half-title':
        sec.data = { title: smart(book.title) };
        sec.recto = true;
        if (!isPrint) return; // ebooks do not need a half title
        break;
      case 'title-page': {
        const others = book.contributors
          .filter((c) => c.role !== 'author')
          .map((c) => `${roleLabel(c.role)} ${c.name}`);
        sec.data = {
          title: smart(book.title),
          subtitle: smart(book.subtitle),
          author: authorsLine(book),
          contributors: others,
          imprint: book.imprint,
          imprintPlace: book.publisherCity,
          series: book.series ? smart(seriesLine(book)) : '',
          logo: typeof node.data?.logo === 'string' ? node.data.logo : null,
          titleSizePt: book.title.length > 34 ? 24 : book.title.length > 20 ? 28 : 32,
        };
        sec.title = smart(book.title);
        sec.recto = true;
        break;
      }
      case 'copyright':
        sec.blocks = copyrightBlocks(book, format, opts, design);
        break;
      case 'toc':
        sec.title = smart(node.title && node.title !== 'Contents' ? node.title : s.contents);
        sec.recto = true;
        break;
      case 'also-by': {
        const groups = opts.alsoBy ?? ((node.data?.groups as AlsoByGroup[] | undefined) ?? []);
        if (groups.every((g) => g.titles.length === 0)) return;
        const author = primaryAuthor(book);
        sec.title = smart(node.title && node.title !== 'Also by the Author' ? node.title : `${s.alsoBy} ${author}`);
        sec.data = { groups: groups.map((g) => ({ label: smart(g.label), titles: g.titles.map(smart) })) };
        sec.recto = design.chapterOpener.startOn === 'recto';
        break;
      }
      case 'index':
        sec.title = smart(node.title || s.index);
        sec.data = { rangeMark: book.style.dashPolicy.mode === 'allow' ? '–' : '-' };
        sec.toc = true;
        sec.recto = design.chapterOpener.startOn === 'recto';
        break;
      case 'endnotes':
        sec.title = smart(node.title || s.notes);
        sec.toc = true;
        sec.recto = design.chapterOpener.startOn === 'recto';
        break;
      default:
        return;
    }
    sec.head = sec.title;
    finish(sec);
  };

  const display = (node: BinderNode, zone: Zone): void => {
    // Dedication and epigraph: short text on a page of its own.
    const sec = base(node, zone, node.kind);
    const from = 0;
    sec.blocks = parseDoc(node);
    if (sec.blocks.length === 0) return; // nothing written yet: leave the page out silently
    if (node.kind === 'epigraph') {
      const split = splitEpigraph(sec.blocks, node);
      sec.blocks = split.blocks;
      sec.data = { source: smart(split.source) };
    }
    sec.origins.push({ nodeId: node.id, title: node.title, from, to: sec.blocks.length });
    sec.recto = true;
    finish(sec);
  };

  const visit = (node: BinderNode, zone: Zone): void => {
    if (!included(node)) return;
    if (node.type === 'part') {
      partNo++;
      const sec = base(node, zone, 'part');
      sec.number = partNo;
      sec.label = smart(partLabel(partNo, design.partNumberStyle, book.language));
      sec.head = sec.title || sec.label;
      sec.toc = true;
      sec.recto = true;
      if (node.file) {
        sec.blocks = parseDoc(node);
        sec.origins.push({ nodeId: node.id, title: node.title, from: 0, to: sec.blocks.length });
      }
      finish(sec);
      afterPart = true;
      for (const c of node.children ?? []) visit(c, zone);
      return;
    }
    if (node.generated && !node.file) return generated(node, zone);
    if (node.generated && node.file && (docs.get(node.id) ?? '').trim() === '') return generated(node, zone);
    if (node.kind === 'dedication' || node.kind === 'epigraph') return display(node, zone);
    if (node.type === 'chapter' || CHAPTER_LIKE.has(node.kind) || node.file) {
      if (opts.sampleChapters && zone === 'body' && bodyChapters >= opts.sampleChapters) return;
      if (opts.sampleChapters && zone === 'back' && !['about-author', 'also-by'].includes(node.kind)) return;
      return chapterLike(node, zone);
    }
  };

  for (const root of binder.roots) {
    const zone: Zone = root.role ?? 'body';
    for (const child of root.children ?? []) visit(child, zone);
  }

  // The first page of the body always starts on a right hand page as page 1.
  const firstBody = sections.find((x) => x.zone === 'body');
  if (firstBody) firstBody.recto = true;

  // Drop an index that has nothing to list, and a contents page with nothing to show.
  const tocEntries = sections.filter((x) => x.toc).length;
  const cleaned = sections.filter((sec) => {
    if (sec.kind === 'index' && stats.indexMarkers === 0) {
      warnings.push({ severity: 'info', code: 'empty-index', message: 'The index was left out because no terms are tagged yet. Tag terms with :index[Term].' });
      return false;
    }
    if (sec.kind === 'toc' && tocEntries < 2) return false;
    return true;
  });

  if (stats.pendingChanges > 0) {
    warnings.push({
      severity: 'warn', code: 'pending-changes',
      message: `${stats.pendingChanges} tracked change${stats.pendingChanges === 1 ? ' is' : 's are'} still pending. This export uses the ${
        (opts.criticView ?? 'original') === 'original' ? 'original text (suggestions ignored)' : 'text with every suggestion accepted'
      }.`,
    });
  }
  if (book.style.dashPolicy.mode !== 'allow') {
    const total = stats.emDashes + stats.enDashes + stats.typedDashes;
    if (total > 0) {
      warnings.push({
        severity: 'warn', code: 'dashes',
        message: `Your dash policy avoids em and en dashes, but the text still contains ${total} (${stats.emDashes} em, ${stats.enDashes} en, ${stats.typedDashes} typed as "--"). Run the Typography cleaner to review them.`,
      });
    }
  }
  stats.images = [...images];
  if (baseLanguage(book.language) === 'bn' && design.hyphenate) {
    warnings.push({ severity: 'info', code: 'bn-hyphenation', message: 'Hyphenation is not available for Bangla; lines break between words.' });
  }
  return { book, format, design, strings: s, sections: cleaned, warnings, stats };
}

function roleLabel(role: string): string {
  switch (role) {
    case 'editor': return 'Edited by';
    case 'illustrator': return 'Illustrated by';
    case 'translator': return 'Translated by';
    case 'foreword': return 'Foreword by';
    case 'photographer': return 'Photographs by';
    case 'narrator': return 'Read by';
    default: return 'With';
  }
}

export function seriesLine(book: Book): string {
  if (!book.series) return '';
  const n = book.series.number;
  if (n === null || n === undefined) return book.series.name;
  const num = usesBengaliDigits(book.language) ? toBengaliDigits(n) : String(n);
  return `${book.series.name}, Book ${num}`;
}
