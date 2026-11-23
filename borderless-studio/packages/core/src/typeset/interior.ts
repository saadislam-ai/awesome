/**
 * Print interior builder. Takes an assembled book, works out the page
 * geometry from the platform rules, writes build.json for the Typst book
 * library, runs Typst, and repeats if the page count that comes back needs a
 * different gutter margin than the one used.
 */
import { PDFDocument } from 'pdf-lib';
import type { Host } from '../host';
import type { AssembledBook, AssembledSection, BuildWarning } from '../build/assemble';
import { stringsFor, usesBengaliDigits } from '../build/strings';
import {
  checkPageCount, minInsideMargin, paddedPageCount, pageSize, resolveMargins,
  type InteriorRules, type ResolvedMargins,
} from '../calc/geometry';
import { inToPt } from '../calc/units';
import { fontCaps, fontInfo, fontStack } from '../fonts/catalog';
import type { Block, Inline } from '../markdown/ir';
import { baseLanguage, languageRegion, primaryAuthor, authorsLine } from '../model/book';
import { preferredMargins, type Design } from '../model/design';
import { extname, joinPath } from '../util/paths';
import { hashString, roundTo } from '../util/text';
import { finalizePrint } from '../pdf/finalize';
import type { PdfxOptions, PdfxSummary } from '../pdf/pdfx';
import { prepareImageForPrint } from '../image/prepare';

export interface TrimSize {
  id: string;
  widthIn: number;
  heightIn: number;
}

export interface InteriorOptions {
  /** Folder of the book project. */
  projectDir: string;
  /** Folder used for this build (created if needed, safe to delete). */
  buildDir: string;
  /** Where the finished PDF is written. */
  outFile: string;
  trim: TrimSize;
  rules: InteriorRules;
  /** Allowed page range for this trim, paper and ink (from the spec file). */
  pageLimits?: { min: number; max: number };
  /** Folder with the bundled Typst library ("lib"). */
  typstLibDir: string;
  /** Folders Typst searches for fonts: bundled fonts first, then project fonts. */
  fontDirs: string[];
  /** Pale diagonal text on every page (advance reader copies). */
  watermark?: string;
  /** PDF outline entries and live links: on for reading copies, off for print files. */
  bookmarks?: boolean;
  /** Page count from an earlier build, as the starting guess. */
  pageCountHint?: number;
  /** Convert colour pictures to greyscale (black and white interiors). */
  greyscaleImages?: boolean;
  /** Write a PDF/X-1a:2001 file (IngramSpark, and preferred by KDP). */
  pdfx?: PdfxOptions | null;
}

/** A picture as it went into the print file. */
export interface StagedImage {
  /** Path as written in the manuscript. */
  src: string;
  widthPx: number;
  heightPx: number;
  format: string;
  /** What was done to the copy used for print ("converted to greyscale"). Empty when the original was used. */
  actions: string[];
}

export interface InteriorResult {
  ok: boolean;
  pdfPath: string;
  /** Pages in the PDF as written (after padding to the press's multiple). */
  pageCount: number;
  /** Pages of content before blank padding pages were added. */
  contentPages: number;
  blankPagesAdded: number;
  margins: ResolvedMargins;
  page: { trimWidthIn: number; trimHeightIn: number; bleedIn: number; pdfWidthIn: number; pdfHeightIn: number };
  /** Number of Typst runs it took for the gutter to settle. */
  passes: number;
  warnings: BuildWarning[];
  /** Raw Typst messages, for the log. */
  log: string;
  /** "PDF/X-1a:2001", or null for an ordinary PDF. */
  pdfStandard: string | null;
  pdfx?: PdfxSummary;
  images: StagedImage[];
}

/* ------------------------------------------------------------------ */
/* Typst specific preparation of sections                              */
/* ------------------------------------------------------------------ */

const WRAPPERS = new Set(['em', 'strong', 'sc', 'sup', 'sub', 'mark', 'link']);

/**
 * Split inline content into words (at ordinary spaces), keeping emphasis and
 * other wrappers around each piece. Needed for drop capitals and small
 * capital lead-ins, where Typst must know where each word starts.
 */
export function splitWords(inlines: Inline[]): Inline[][] {
  const words: Inline[][] = [[]];
  const cur = () => words[words.length - 1];
  for (const n of inlines) {
    if (n.t === 'text') {
      const parts = n.v.split(' ');
      parts.forEach((p, i) => {
        if (i > 0) words.push([]);
        if (p) cur().push({ t: 'text', v: p });
      });
    } else if (WRAPPERS.has(n.t) && 'c' in n) {
      const inner = splitWords(n.c as Inline[]);
      inner.forEach((w, i) => {
        if (i > 0) words.push([]);
        if (w.length) cur().push({ ...(n as object), c: w } as Inline);
      });
    } else {
      cur().push(n);
    }
  }
  return words.filter((w, i) => w.length > 0 || i === 0);
}

const OPENING_QUOTES = /^[\u201C\u2018"'\u00AB\u2039(\[]+/;

/** First letter of the paragraph for a drop capital, or null when the text does not start with a cased letter. */
function takeCap(words: Inline[][]): { cap: string; words: Inline[][] } | null {
  const first = words[0];
  if (!first || first.length === 0) return null;
  // Find the first text node, descending into wrappers.
  const path: Inline[] = [];
  let node: Inline | undefined = first[0];
  while (node && node.t !== 'text') {
    if (WRAPPERS.has(node.t) && 'c' in node && (node.c as Inline[]).length) {
      path.push(node);
      node = (node.c as Inline[])[0];
    } else return null;
  }
  if (!node || node.t !== 'text') return null;
  const stripped = node.v.replace(OPENING_QUOTES, '');
  const ch = [...stripped][0];
  if (!ch || !/\p{Lu}|\p{Ll}/u.test(ch)) return null;
  const rest = stripped.slice(ch.length);
  // Rebuild the first word without the cap letter.
  let rebuilt: Inline[] = rest ? [{ t: 'text', v: rest }] : [];
  let tail: Inline[] = [];
  let host: Inline[] = first;
  const chain: Inline[][] = [first];
  for (const p of path) chain.push((p as { c: Inline[] }).c);
  for (let i = chain.length - 1; i >= 0; i--) {
    tail = chain[i].slice(1);
    rebuilt = [...rebuilt, ...tail];
    if (i > 0) rebuilt = rebuilt.length ? [{ ...(path[i - 1] as object), c: rebuilt } as Inline] : [];
    host = chain[i];
  }
  void host;
  return { cap: ch.toUpperCase(), words: [rebuilt, ...words.slice(1)] };
}

/** Add drop capital and lead-in instructions to the first paragraph of a section. */
function markOpening(blocks: Block[], design: Design): Block[] {
  const op = design.chapterOpener;
  if (!op.dropCap.enabled && op.leadIn === 'none') return blocks;
  const first = blocks[0];
  if (!first || first.t !== 'p') return blocks;
  let words = splitWords(first.c);
  if (words.length === 0 || (words.length === 1 && words[0].length === 0)) return blocks;
  let cap: string | null = null;
  if (op.dropCap.enabled) {
    const taken = takeCap(words);
    if (taken) {
      cap = taken.cap;
      words = taken.words;
    }
  }
  if (!cap && op.leadIn === 'none') return blocks;
  const open: Record<string, unknown> = { words };
  if (cap) {
    open.cap = cap;
    open.capLines = op.dropCap.lines;
  }
  if (op.leadIn === 'words') {
    // Count real words (an empty remainder after a one letter drop cap does not count).
    let need = op.leadInWords;
    let n = 0;
    for (const w of words) {
      if (need <= 0) break;
      n++;
      if (w.length > 0) need--;
    }
    open.scWords = n;
  } else if (op.leadIn === 'line') {
    open.scLine = true;
  }
  return [{ ...first, open } as Block, ...blocks.slice(1)];
}

interface NoteItem {
  n: number;
  c: Block[];
}

/** Replace footnotes with numbered references and return the collected notes. */
function extractNotes(blocks: Block[], startAt = 1): { blocks: Block[]; notes: NoteItem[] } {
  const notes: NoteItem[] = [];
  let n = startAt;
  const inl = (list: Inline[]): Inline[] =>
    list.map((x): Inline => {
      if (x.t === 'fn') {
        const item = { n: n++, c: x.c };
        notes.push(item);
        return { t: 'noteref', n: item.n } as unknown as Inline;
      }
      if ('c' in x && Array.isArray(x.c)) return { ...x, c: inl(x.c as Inline[]) } as Inline;
      return x;
    });
  const blk = (list: Block[]): Block[] =>
    list.map((b): Block => {
      switch (b.t) {
        case 'p':
        case 'h':
          return { ...b, c: inl(b.c) };
        case 'quote':
        case 'align':
          return { ...b, c: blk(b.c) };
        case 'callout':
          return { ...b, title: b.title ? inl(b.title) : undefined, c: blk(b.c) };
        case 'list':
          return { ...b, items: b.items.map(blk) };
        case 'verse':
          return { ...b, stanzas: b.stanzas.map((st) => st.map(inl)) };
        case 'table':
          return { ...b, head: b.head.map(inl), rows: b.rows.map((r) => r.map(inl)), caption: b.caption ? inl(b.caption) : undefined };
        case 'figure':
          return { ...b, caption: b.caption ? inl(b.caption) : undefined };
        default:
          return b;
      }
    });
  return { blocks: blk(blocks), notes };
}

/** Rewrite image paths to the copies inside the build folder. */
function mapImages(blocks: Block[], map: Map<string, string>): Block[] {
  const inl = (list: Inline[]): Inline[] =>
    list.map((x): Inline => {
      if (x.t === 'img') return { ...x, src: map.get(x.src) ?? x.src };
      if (x.t === 'fn') return { ...x, c: mapImages(x.c, map) };
      if ('c' in x && Array.isArray(x.c)) return { ...x, c: inl(x.c as Inline[]) } as Inline;
      return x;
    });
  return blocks.map((b): Block => {
    switch (b.t) {
      case 'figure':
        return { ...b, src: map.get(b.src) ?? b.src, caption: b.caption ? inl(b.caption) : undefined };
      case 'p':
      case 'h':
        return { ...b, c: inl(b.c) };
      case 'quote':
      case 'align':
      case 'callout':
        return { ...b, c: mapImages(b.c, map) } as Block;
      case 'list':
        return { ...b, items: b.items.map((it) => mapImages(it, map)) };
      default:
        return b;
    }
  });
}

const DISPLAY_KINDS = new Set(['half-title', 'title-page', 'copyright', 'dedication', 'epigraph', 'toc', 'part', 'also-by', 'index']);

/** Height of one line of the running head or folio, in points, with a little air. */
function furnitureSizes(design: Design): { headPt: number; footPt: number } {
  const hasHead = design.runningHeads.enabled || design.folio.position === 'top-outside';
  const headSize = Math.max(design.runningHeads.enabled ? design.runningHeads.sizePt : 0, design.folio.position === 'top-outside' ? design.folio.sizePt : 0);
  const hasFoot = design.folio.position !== 'none';
  // 1.35 x the type size covers the full ascent and descent of the font, so
  // even accented capitals in a running head stay inside the safe area.
  return {
    headPt: hasHead ? headSize * 1.35 + (design.runningHeads.rule ? 4 : 0) : 0,
    footPt: hasFoot ? design.folio.sizePt * 1.35 : 0,
  };
}

/** Margins for a page count, without building the whole spec. */
export function buildMargins(
  assembled: AssembledBook,
  opts: Pick<InteriorOptions, 'trim' | 'rules'>,
  pageCount: number,
): ResolvedMargins {
  const { design, format } = assembled;
  return resolveMargins(
    preferredMargins(design, opts.trim.widthIn, opts.trim.heightIn), opts.rules, pageCount, format.bleed, furnitureSizes(design),
  );
}

export interface TypstBuildSpec {
  cfg: Record<string, unknown>;
  sections: Record<string, unknown>[];
}

/** Everything the Typst library needs, as plain data. */
export function buildInteriorSpec(
  assembled: AssembledBook,
  opts: Pick<InteriorOptions, 'trim' | 'rules' | 'watermark' | 'bookmarks'>,
  pageCount: number,
  imageMap: Map<string, string> = new Map(),
): { spec: TypstBuildSpec; margins: ResolvedMargins } {
  const { book, format, design } = assembled;
  const { trim, rules } = opts;
  const size = pageSize(trim.widthIn, trim.heightIn, format.bleed, rules);
  const margins = buildMargins(assembled, opts, pageCount);
  const m = margins.margins;
  const pitchPt = roundTo(design.fontSizePt * design.lineHeight, 3);
  const textHeightPt = inToPt(trim.heightIn - m.top - m.bottom);
  const bodyInfo = fontInfo(design.bodyFont);
  const headInfo = fontInfo(design.headingFont);
  const strings = stringsFor(book.language);

  const cfg: Record<string, unknown> = {
    meta: {
      title: book.title,
      subtitle: book.subtitle,
      author: primaryAuthor(book),
      authors: book.contributors.filter((c) => c.role === 'author').map((c) => c.name),
      authorsLine: authorsLine(book),
      lang: baseLanguage(book.language),
      region: languageRegion(book.language),
      keywords: [],
    },
    page: {
      widthPt: roundTo(inToPt(trim.widthIn), 3),
      heightPt: roundTo(inToPt(trim.heightIn), 3),
      bleedPt: roundTo(inToPt(size.bleedIn), 3),
      margins: {
        topPt: roundTo(inToPt(m.top), 3),
        bottomPt: roundTo(inToPt(m.bottom), 3),
        insidePt: roundTo(inToPt(m.inside), 3),
        outsidePt: roundTo(inToPt(m.outside), 3),
      },
      headerGapPt: roundTo(inToPt(margins.headerGapIn), 3),
      footerGapPt: roundTo(inToPt(margins.footerGapIn), 3),
    },
    design,
    pitchPt,
    textHeightPt: roundTo(textHeightPt, 3),
    fonts: {
      body: fontStack(design.bodyFont, bodyInfo?.kind ?? 'serif'),
      heading: fontStack(design.headingFont, headInfo?.kind ?? 'serif'),
      sans: fontStack(design.sansFont, 'sans'),
      mono: 'DejaVu Sans Mono',
    },
    fontCaps: { body: fontCaps(design.bodyFont), heading: fontCaps(design.headingFont), sans: fontCaps(design.sansFont) },
    capHeightEm: bodyInfo?.capHeightEm ?? 0.66,
    headingCapHeightEm: headInfo?.capHeightEm ?? 0.66,
    digits: usesBengaliDigits(book.language) ? 'bengali' : 'latin',
    links: Boolean(opts.bookmarks),
    bookmarks: Boolean(opts.bookmarks),
    watermark: opts.watermark ?? null,
    strings: { chapter: strings.chapter, part: strings.part, contents: strings.contents, notes: strings.notes, index: strings.index },
  };

  const notesMode = design.notes;
  const bookNotes: { title: string; items: NoteItem[] }[] = [];
  const zonesSeen = new Set<string>();
  const sections: Record<string, unknown>[] = [];

  const push = (sec: AssembledSection, blocks: Block[]) => {
    const first = !zonesSeen.has(sec.zone);
    zonesSeen.add(sec.zone);
    sections.push({
      id: sec.id,
      kind: sec.kind,
      zone: sec.zone,
      title: sec.title,
      subtitle: sec.subtitle,
      label: sec.label,
      tocLabel: sec.tocLabel,
      head: sec.head,
      blocks: mapImages(blocks, imageMap),
      data: sec.data,
      toc: sec.toc,
      recto: sec.recto,
      firstOfZone: first,
      showHeading: true,
    });
  };

  for (const sec of assembled.sections) {
    if (sec.kind === 'endnotes') {
      // Book level notes are appended where the author put the Notes section.
      if (notesMode !== 'endnotes-book' || bookNotes.length === 0) continue;
      const blocks: Block[] = bookNotes.map((g) => ({ t: 'notes', title: g.title, items: g.items }) as unknown as Block);
      push(sec, blocks);
      bookNotes.length = 0;
      continue;
    }
    let blocks = sec.blocks;
    const isText = !DISPLAY_KINDS.has(sec.kind);
    if (isText && notesMode !== 'footnotes') {
      const ex = extractNotes(blocks);
      blocks = ex.blocks;
      if (ex.notes.length) {
        if (notesMode === 'endnotes-chapter') {
          blocks = [...blocks, { t: 'notes', title: strings.notes, items: ex.notes } as unknown as Block];
        } else {
          bookNotes.push({ title: [sec.label, sec.title].filter(Boolean).join(': ') || sec.title, items: ex.notes });
        }
      }
    }
    if (isText && sec.zone === 'body') blocks = markOpening(blocks, design);
    push(sec, blocks);
  }
  // Book level notes with no Notes section in the binder: add one at the end.
  if (bookNotes.length) {
    sections.push({
      id: 'generated-notes', kind: 'endnotes', zone: 'back', title: strings.notes, subtitle: '', label: '', tocLabel: '',
      head: strings.notes, data: {}, toc: true, recto: design.chapterOpener.startOn === 'recto', firstOfZone: !zonesSeen.has('back'), showHeading: true,
      blocks: bookNotes.map((g) => ({ t: 'notes', title: g.title, items: g.items })),
    });
  }
  return { spec: { cfg, sections }, margins };
}

/* ------------------------------------------------------------------ */
/* Running Typst                                                       */
/* ------------------------------------------------------------------ */

const MAIN_TYP = '#import "lib/book.typ": render-book\n#render-book(json("build.json"))\n';

/** Turn Typst's stderr into warnings a person can act on. */
export function parseTypstLog(stderr: string): BuildWarning[] {
  const out: BuildWarning[] = [];
  const seen = new Set<string>();
  for (const m of stderr.matchAll(/^(error|warning): (.+)$/gm)) {
    const text = m[2].trim();
    const key = m[1] + text;
    if (seen.has(key)) continue;
    seen.add(key);
    let message = text;
    if (/unknown font family/.test(text)) {
      message = `A font could not be found (${text.replace(/^unknown font family:\s*/, '')}). Choose one of the bundled fonts or add the font file to the project's fonts folder.`;
    } else if (/did not converge/.test(text)) {
      message = 'The page layout needed more attempts than usual to settle. Check the contents page and index page numbers in the preview.';
    } else if (/file not found/.test(text)) {
      message = `A picture or file used in the book could not be found (${text}).`;
    }
    out.push({ severity: m[1] === 'error' ? 'fail' : 'warn', code: 'typst', message });
  }
  return out;
}

async function copyLib(host: Host, from: string, to: string): Promise<void> {
  await host.mkdirp(to);
  for (const e of await host.list(from)) {
    if (e.isFile && e.name.endsWith('.typ')) {
      const text = await host.readText(joinPath(from, e.name));
      const dest = joinPath(to, e.name);
      // Avoid rewriting unchanged files so Typst's own caching stays effective.
      if (!(await host.exists(dest)) || (await host.readText(dest)) !== text) await host.writeText(dest, text);
    }
  }
}

/**
 * Put the pictures a book uses into the build folder, prepared for print
 * (greyscale for black and white interiors, transparency flattened). The
 * originals in the book folder are never changed. Prepared copies are reused
 * on the next build as long as the original file is unchanged.
 */
async function stageImages(
  host: Host,
  images: string[],
  opts: InteriorOptions,
  warnings: BuildWarning[],
): Promise<{ map: Map<string, string>; staged: StagedImage[] }> {
  const map = new Map<string, string>();
  const staged: StagedImage[] = [];
  if (images.length === 0) return { map, staged };
  await host.mkdirp(joinPath(opts.buildDir, 'img'));
  const grey = opts.greyscaleImages ?? false;
  for (const src of images) {
    const abs = /^([A-Za-z]:)?\//.test(src) ? src : joinPath(opts.projectDir, src);
    const stat = await host.stat(abs);
    if (!stat || !stat.isFile) {
      warnings.push({ severity: 'fail', code: 'missing-image', message: `The picture "${src}" was not found in the book folder.` });
      continue;
    }
    const key = hashString(`${src}|${stat.size}|${Math.round(stat.mtimeMs)}|${grey ? 'grey' : 'colour'}|v1`);
    const notePath = joinPath(opts.buildDir, 'img', `${key}.json`);
    let note: (StagedImage & { file: string; caution?: string }) | null = null;
    if (await host.exists(notePath)) {
      try {
        const cached = JSON.parse(await host.readText(notePath)) as StagedImage & { file: string; caution?: string };
        if (await host.exists(joinPath(opts.buildDir, cached.file))) note = cached;
      } catch {
        note = null;
      }
    }
    if (!note) {
      const prepared = prepareImageForPrint(await host.readBinary(abs), { greyscale: grey });
      if (prepared.problem) {
        warnings.push({ severity: 'fail', code: 'image-unusable', message: `The picture "${src}" cannot be used: ${prepared.problem}` });
        continue;
      }
      const file = `img/${key}${prepared.ext || extname(abs)}`;
      if (prepared.changed) await host.writeBinary(joinPath(opts.buildDir, file), prepared.bytes);
      else await host.copy(abs, joinPath(opts.buildDir, file));
      note = {
        src, file, widthPx: prepared.info.width, heightPx: prepared.info.height, format: prepared.info.format,
        actions: prepared.actions, caution: prepared.caution,
      };
      await host.writeText(notePath, JSON.stringify(note));
    }
    if (note.caution) warnings.push({ severity: 'warn', code: 'image-format', message: `Picture "${src}": ${note.caution}` });
    map.set(src, note.file);
    staged.push({ src, widthPx: note.widthPx, heightPx: note.heightPx, format: note.format, actions: note.actions });
  }
  return { map, staged };
}

export async function typstCompile(
  host: Host,
  buildDir: string,
  fontDirs: string[],
  input: string,
  output: string,
  extra: string[] = [],
): Promise<{ code: number; stderr: string }> {
  const args = ['compile', '--root', buildDir, '--ignore-system-fonts'];
  for (const d of fontDirs) args.push('--font-path', d);
  args.push(...extra, joinPath(buildDir, input), output);
  const res = await host.runTool('typst', args, { cwd: buildDir, timeoutMs: 300_000 });
  return { code: res.code, stderr: res.stderr || res.stdout };
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPageCount();
}

/**
 * Build the interior PDF. The gutter margin depends on the page count and the
 * page count depends on the gutter, so the build runs again when the count
 * lands in a different margin band than the one assumed (at most four runs).
 */
export async function buildInterior(host: Host, assembled: AssembledBook, opts: InteriorOptions): Promise<InteriorResult> {
  const warnings: BuildWarning[] = [...assembled.warnings];
  const { rules, trim } = opts;
  const format = assembled.format;
  await host.mkdirp(opts.buildDir);
  await copyLib(host, opts.typstLibDir, joinPath(opts.buildDir, 'lib'));
  await host.writeText(joinPath(opts.buildDir, 'main.typ'), MAIN_TYP);
  const { map: imageMap, staged: stagedImages } = await stageImages(host, assembled.stats.images, opts, warnings);
  const pdfStandard = opts.pdfx ? 'PDF/X-1a:2001' : null;
  const outTmp = joinPath(opts.buildDir, 'interior.pdf');

  // First guess: an earlier result, or a rough estimate from the word count.
  const d = assembled.design;
  const wordsPerPage = Math.max(100, (trim.widthIn * trim.heightIn * 1560) / (d.fontSizePt * d.fontSizePt * d.lineHeight));
  let guess = opts.pageCountHint ?? Math.max(24, Math.round(assembled.stats.words / wordsPerPage) + assembled.sections.length);
  let passes = 0;
  let log = '';
  let margins!: ResolvedMargins;
  let contentPages = 0;
  let bytes: Uint8Array | null = null;
  let pdfx: PdfxSummary | undefined;
  const insideFor = (pages: number) => buildMargins(assembled, opts, pages).margins.inside;

  // A wider gutter can only add pages and a narrower one can only remove
  // them, so this loop moves in one direction and always settles. Six runs
  // is more than the number of margin bands any platform defines.
  while (passes < 6) {
    passes++;
    const built = buildInteriorSpec(assembled, opts, guess, imageMap);
    margins = built.margins;
    await host.writeText(joinPath(opts.buildDir, 'build.json'), JSON.stringify(built.spec));
    const res = await typstCompile(host, opts.buildDir, opts.fontDirs, 'main.typ', outTmp, ['--no-pdf-tags', '--pdf-standard', '1.4']);
    log += res.stderr;
    if (res.code !== 0) {
      const parsed = parseTypstLog(res.stderr);
      warnings.push(
        ...(parsed.some((w) => w.severity === 'fail')
          ? parsed
          : [{
              severity: 'fail' as const, code: 'typst',
              message: res.code === -1
                ? 'The typesetting engine (Typst) could not be started. Check Settings, Tools.'
                : `Typesetting failed: ${res.stderr.slice(0, 600)}`,
            }]),
      );
      return {
        ok: false, pdfPath: '', pageCount: 0, contentPages: 0, blankPagesAdded: 0, margins,
        page: pageSize(trim.widthIn, trim.heightIn, format.bleed, rules), passes, warnings, log,
        pdfStandard, images: stagedImages,
      };
    }
    bytes = await host.readBinary(outTmp);
    contentPages = await pdfPageCount(bytes);
    const finalCount = paddedPageCount(contentPages + (rules.lastPageBlank ? 1 : 0), rules);
    if (Math.abs(insideFor(finalCount) - margins.margins.inside) < 0.0005) break;
    guess = finalCount;
  }

  warnings.push(...parseTypstLog(log).filter((w) => w.severity !== 'fail'));
  for (const r of margins.raised) warnings.push({ severity: 'info', code: 'margin-raised', message: r });

  // Pad to the press's page multiple, and keep the last page empty where required.
  let total = contentPages;
  let add = 0;
  if (rules.lastPageBlank) add += 1;
  add += paddedPageCount(total + add, rules) - (total + add);
  if (bytes) {
    // Print files carry no links or bookmarks; reading copies (samples, review copies) keep them.
    const finished = await finalizePrint(bytes, {
      addBlankPages: add,
      removeAnnotations: !opts.bookmarks,
      removeOutline: !opts.bookmarks,
      removeXmp: !opts.bookmarks,
      title: assembled.book.subtitle ? `${assembled.book.title}: ${assembled.book.subtitle}` : assembled.book.title,
      author: authorsLine(assembled.book),
      version: [1, 4],
      pdfx: opts.pdfx ?? undefined,
    });
    bytes = finished.bytes;
    pdfx = finished.pdfx;
    for (const problem of pdfx?.problems ?? []) {
      warnings.push({ severity: 'fail', code: 'pdfx', message: `The file does not meet PDF/X-1a: ${problem}` });
    }
    total += add;
  }
  await host.mkdirp(opts.outFile.slice(0, opts.outFile.lastIndexOf('/')));
  if (bytes) await host.writeBinary(opts.outFile, bytes);

  const limits = opts.pageLimits ?? { min: rules.minPages, max: rules.maxPages };
  const check = checkPageCount(total, limits.min, limits.max, rules.platformName);
  if (!check.ok) warnings.push({ severity: 'fail', code: 'page-count', message: check.message! });
  const finalInsideMin = minInsideMargin(rules, total);
  if (margins.margins.inside + 1e-6 < finalInsideMin) {
    warnings.push({
      severity: 'fail', code: 'gutter',
      message: `The inside margin (${margins.margins.inside} in) is below the ${rules.platformName} minimum of ${finalInsideMin} in for ${total} pages.`,
    });
  }
  return {
    ok: !warnings.some((w) => w.severity === 'fail'),
    pdfPath: opts.outFile,
    pageCount: total,
    contentPages,
    blankPagesAdded: add,
    margins,
    page: pageSize(trim.widthIn, trim.heightIn, format.bleed, rules),
    passes,
    warnings,
    log,
    pdfStandard,
    pdfx,
    images: stagedImages,
  };
}
