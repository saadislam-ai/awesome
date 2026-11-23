/**
 * Building cover files: the print cover PDF for a platform, preview pictures
 * with guides, and the ebook cover.
 */
import type { BuildWarning } from '../build/assemble';
import type { Cmyk } from '../color/cmyk';
import { fontStack } from '../fonts/catalog';
import type { Host } from '../host';
import { imageInfo } from '../image/info';
import { encodeJpeg } from '../image/jpeg';
import { decodeImage } from '../image/prepare';
import { decodePng, encodePng, flattenAlpha } from '../image/png';
import type { Inline } from '../markdown/ir';
import { parseMarkdown } from '../markdown/parse';
import { smartenBlocks, smartenText } from '../markdown/typography';
import { authorsLine, type Book, type BookFormat } from '../model/book';
import { finalizePrint } from '../pdf/finalize';
import type { PdfxOptions, PdfxSummary } from '../pdf/pdfx';
import { typstCompile, parseTypstLog } from '../typeset/interior';
import { extname, joinPath } from '../util/paths';
import { hashString } from '../util/text';
import { PDFDocument } from 'pdf-lib';
import { layoutBarcode, priceAddon } from './barcode';
import { COVER_KIND_LABEL, inset, type CoverGeometry, type Rect } from './geometry';
import { contrastRatio, hexToRgb, type CoverDesign } from './model';

export interface CoverBuildInput {
  book: Book;
  format: BookFormat;
  design: CoverDesign;
  geometry: CoverGeometry;
  /** Hyphenated ISBN for the line above the barcode. */
  isbnDisplay?: string;
  /** Imprint and website for the back cover and spine. */
  imprint?: string;
  website?: string;
  /** Rich black for large dark areas, as ink percentages, when the platform names one. */
  richBlack?: [number, number, number, number] | null;
}

export interface CoverRenderOptions {
  /** cmyk for print files, rgb for previews and the ebook cover. */
  mode: 'cmyk' | 'rgb';
  guides?: boolean;
  /** Converts a screen colour to inks (needed for cmyk mode). */
  toCmyk?: (r: number, g: number, b: number) => Cmyk;
  /** Staged picture paths, relative to the build folder. */
  images: { front: string | null; wrap: string | null };
  /** Render only the front cover on a page of this size (ebook cover), inches. */
  frontOnly?: { widthIn: number; heightIn: number };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function paragraphsOf(text: string, book: Book): Inline[][] {
  if (!text.trim()) return [];
  const blocks = smartenBlocks(parseMarkdown(text).blocks, book.style);
  const out: Inline[][] = [];
  for (const b of blocks) if (b.t === 'p' || b.t === 'h') out.push(b.c);
  return out;
}

/** The barcode an edition gets on a platform: drawn, left to the platform, or absent. */
export function barcodePlan(design: CoverDesign, geometry: CoverGeometry, format: BookFormat): { mode: 'own' | 'placeholder' | 'none'; reason?: string } {
  if (geometry.kind === 'dust-jacket' || geometry.kind === 'paperback' || geometry.kind === 'case-laminate') {
    if (design.barcode.mode === 'none' && !geometry.barcodeRequired) return { mode: 'none' };
    if (design.barcode.mode === 'platform' && geometry.platformAddsBarcode && !geometry.barcodeRequired) return { mode: 'placeholder' };
    if (!format.isbn) {
      return geometry.platformAddsBarcode && !geometry.barcodeRequired
        ? { mode: 'placeholder', reason: `No ISBN is set for this edition, so the barcode area is left free for ${geometry.platformName} to print its own.` }
        : { mode: 'none', reason: `${geometry.platformName} needs a barcode, but this edition has no ISBN yet.` };
    }
    return { mode: 'own' };
  }
  return { mode: 'none' };
}

/** Everything the Typst cover library needs, as plain data. */
export function buildCoverSpec(input: CoverBuildInput, opts: CoverRenderOptions): { spec: Record<string, unknown>; warnings: BuildWarning[] } {
  const { book, format, design, geometry: g } = input;
  const warnings: BuildWarning[] = [];
  const cmyk = opts.mode === 'cmyk';
  const colour = (hex: string, use: 'text' | 'area'): number[] => {
    const [r, gg, b] = hexToRgb(hex);
    if (!cmyk) return [r, gg, b];
    if (r === 255 && gg === 255 && b === 255) return [0, 0, 0, 0];
    const dark = r < 26 && gg < 26 && b < 26;
    // Small black type prints in black ink only; a mix of four inks blurs when the plates are slightly off.
    if (dark && use === 'text') return [0, 0, 0, 100];
    if (dark && use === 'area' && input.richBlack) return [...input.richBlack];
    const c = opts.toCmyk ? opts.toCmyk(r, gg, b) : ([1 - r / 255, 1 - gg / 255, 1 - b / 255, 0] as Cmyk);
    return c.map((v) => round1(v * 100));
  };
  const background = design.colors.background;
  const backBackground = design.colors.backBackground ?? background;
  const backText = design.colors.backText ?? design.colors.text;
  if (contrastRatio(design.colors.text, background) < 3 && !design.art.front && !design.art.wrap) {
    warnings.push({ severity: 'warn', code: 'cover-contrast', message: 'The front cover text and background colours are very close; the title may be hard to read.' });
  }
  if (contrastRatio(backText, backBackground) < 4.5 && !design.art.wrap) {
    warnings.push({ severity: 'warn', code: 'cover-contrast-back', message: 'The back cover text has weak contrast against its background; small type needs strong contrast to be readable in print.' });
  }

  const title = smartenText(design.front.title.trim() || book.title, book.style);
  const subtitle = design.front.showSubtitle ? smartenText(design.front.subtitle.trim() || book.subtitle, book.style) : '';
  const author = design.front.author.trim() || authorsLine(book);
  const imprint = input.imprint ?? book.imprint;

  let page = { w: g.widthIn, h: g.heightIn };
  let panels: Record<string, unknown>;
  // The cover area inside the file: the whole file, or the middle of a template sheet.
  let full: Rect = g.art;
  if (opts.frontOnly) {
    page = { w: opts.frontOnly.widthIn, h: opts.frontOnly.heightIn };
    const whole: Rect = { x: 0, y: 0, w: page.w, h: page.h };
    full = whole;
    const margin = Math.min(page.w, page.h) * 0.06;
    panels = {
      trim: whole, back: whole, spine: { x: 0, y: 0, w: 0, h: page.h }, front: whole, backFlap: null, frontFlap: null, hinges: [],
      safeBack: whole, safeFront: inset(whole, margin), safeSpine: null, safeBackFlap: null, safeFrontFlap: null, frontBleed: whole,
    };
  } else {
    // The front picture runs off the top, bottom and outer edge; at the spine side it stops at the fold.
    const frontBleed: Rect = { x: g.front.x, y: full.y, w: (g.frontFlap ? g.frontFlap.x : full.x + full.w) - g.front.x, h: full.h };
    panels = {
      trim: g.trim, back: g.back, spine: g.spine, front: g.front, backFlap: g.backFlap, frontFlap: g.frontFlap, hinges: g.hinges,
      safeBack: g.safe.back, safeFront: g.safe.front, safeSpine: g.safe.spine, safeBackFlap: g.safe.backFlap, safeFrontFlap: g.safe.frontFlap,
      frontBleed,
    };
  }

  // Barcode
  let barcode: Record<string, unknown> | null = null;
  if (!opts.frontOnly) {
    const plan = barcodePlan(design, g, format);
    if (plan.reason) warnings.push({ severity: plan.mode === 'none' && g.barcodeRequired ? 'fail' : 'warn', code: 'barcode', message: plan.reason });
    if (plan.mode === 'placeholder') {
      barcode = { box: g.barcode, bars: [], texts: [], placeholder: true };
    } else if (plan.mode === 'own') {
      const addon = design.barcode.addon === 'none' ? null : design.barcode.addon === 'price' ? priceAddon(design.barcode.currency, design.barcode.price ?? undefined) : '90000';
      let layout = layoutBarcode(format.isbn, { addon, isbnDisplay: input.isbnDisplay, fitWidthIn: g.barcode.w, fitHeightIn: g.barcode.h });
      if (!layout && addon) {
        layout = layoutBarcode(format.isbn, { addon: null, isbnDisplay: input.isbnDisplay, fitWidthIn: g.barcode.w, fitHeightIn: g.barcode.h });
        if (layout) warnings.push({ severity: 'warn', code: 'barcode-addon', message: 'The price add-on does not fit the barcode area at a scannable size, so the barcode is printed without it.' });
      }
      if (!layout) {
        warnings.push({ severity: 'fail', code: 'barcode-size', message: 'The barcode does not fit its area at the smallest scannable size (80 %).' });
      } else {
        // Right aligned in the reserved area, sitting on its bottom edge.
        const bx = g.barcode.x + g.barcode.w - layout.widthIn;
        const by = g.barcode.y + g.barcode.h - layout.heightIn;
        barcode = {
          box: { x: bx, y: by, w: layout.widthIn, h: layout.heightIn },
          bars: layout.bars.map((b) => [bx + b.x, by + b.y, b.w, b.h]),
          texts: layout.texts.map((t) => ({ x: bx + t.x, y: by + t.y, t: t.text, s: t.sizePt, a: t.anchor })),
          placeholder: false,
          magnification: layout.magnification,
        };
      }
    }
  }

  const wrapOnly = Boolean(opts.images.wrap) && design.art.wrapHasText && !opts.frontOnly;
  const spec = {
    meta: { title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title, author: authorsLine(book), kind: COVER_KIND_LABEL[g.kind] },
    lang: book.language.split(/[-_]/)[0],
    mode: opts.mode,
    guides: Boolean(opts.guides),
    only: opts.frontOnly ? 'front' : null,
    page,
    panels,
    layout: design.layout,
    colors: {
      background: colour(background, 'area'),
      text: colour(design.colors.text, 'text'),
      accent: colour(design.colors.accent, 'text'),
      backBackground: colour(backBackground, 'area'),
      backText: colour(backText, 'text'),
      band: colour(design.colors.band ?? background, 'area'),
    },
    fonts: {
      title: fontStack(design.fonts.title), body: fontStack(design.fonts.body), sans: fontStack('Source Sans 3', 'sans'),
      titleCase: design.fonts.titleCase, titleWeight: design.fonts.titleWeight,
    },
    front: { title, subtitle, author, tagline: smartenText(design.front.tagline, book.style) },
    spine: {
      textAllowed: g.spineTextAllowed,
      title: design.spine.showTitle ? title : '',
      author: design.spine.showAuthor ? author : '',
      imprint: design.spine.showImprint ? imprint : '',
    },
    back: {
      headline: smartenText(design.back.headline, book.style),
      blurb: paragraphsOf(design.back.blurb, book),
      bio: paragraphsOf(design.back.bio, book),
      imprint: design.back.showImprint ? imprint : '',
      website: design.back.showWebsite ? (input.website ?? book.publisherWebsite ?? '') : '',
      align: design.back.align,
    },
    flaps: { front: paragraphsOf(design.flaps.front, book), back: paragraphsOf(design.flaps.back, book) },
    art: { front: opts.images.front, frontMode: design.art.frontMode, wrap: opts.frontOnly ? null : opts.images.wrap, wrapOnly },
    barcode,
    full,
  };
  if (!g.spineTextAllowed && g.spineTextReason && !opts.frontOnly) warnings.push({ severity: 'info', code: 'spine-text', message: `No text on the spine: ${g.spineTextReason}` });
  return { spec, warnings };
}

/* ------------------------------------------------------------------ */
/* Running Typst                                                       */
/* ------------------------------------------------------------------ */

export interface CoverEnv {
  host: Host;
  /** Folder of the book project. */
  projectDir: string;
  /** Build folder for cover work (created if needed). */
  buildDir: string;
  typstLibDir: string;
  fontDirs: string[];
}

const COVER_MAIN = '#import "lib/cover.typ": render-cover\n#render-cover(json("cover.json"))\n';

async function prepareEnv(env: CoverEnv): Promise<void> {
  const { host } = env;
  await host.mkdirp(joinPath(env.buildDir, 'lib'));
  await host.mkdirp(joinPath(env.buildDir, 'img'));
  for (const e of await host.list(env.typstLibDir)) {
    if (!e.isFile || !e.name.endsWith('.typ')) continue;
    const text = await host.readText(joinPath(env.typstLibDir, e.name));
    const dest = joinPath(env.buildDir, 'lib', e.name);
    if (!(await host.exists(dest)) || (await host.readText(dest)) !== text) await host.writeText(dest, text);
  }
  await host.writeText(joinPath(env.buildDir, 'cover-main.typ'), COVER_MAIN);
}

/**
 * Copy a cover picture into the build folder. Transparent pictures are
 * flattened onto the given background colour, because print files may not
 * contain transparency. Returns the path relative to the build folder.
 */
export async function stageCoverImage(env: CoverEnv, relPath: string | null, background: [number, number, number], warnings: BuildWarning[]): Promise<string | null> {
  if (!relPath) return null;
  const { host } = env;
  const abs = /^([A-Za-z]:)?\//.test(relPath) ? relPath : joinPath(env.projectDir, relPath);
  const stat = await host.stat(abs);
  if (!stat || !stat.isFile) {
    warnings.push({ severity: 'fail', code: 'cover-art-missing', message: `The cover picture "${relPath}" was not found.` });
    return null;
  }
  const bytes = await host.readBinary(abs);
  const info = imageInfo(bytes);
  if (info.format !== 'png' && info.format !== 'jpeg') {
    warnings.push({ severity: 'fail', code: 'cover-art-type', message: `The cover picture "${relPath}" must be a PNG or JPEG file.` });
    return null;
  }
  const key = hashString(`${relPath}|${stat.size}|${Math.round(stat.mtimeMs)}|${background.join(',')}`);
  let name = `img/${key}${extname(abs).toLowerCase() || '.png'}`;
  if (info.format === 'png' && (info.hasAlpha || (info.bitsPerChannel ?? 8) > 8)) {
    name = `img/${key}.png`;
    if (!(await host.exists(joinPath(env.buildDir, name)))) {
      await host.writeBinary(joinPath(env.buildDir, name), encodePng(flattenAlpha(decodePng(bytes), background), info.dpiX));
    }
  } else if (!(await host.exists(joinPath(env.buildDir, name)))) {
    await host.copy(abs, joinPath(env.buildDir, name));
  }
  return name;
}

export interface CoverPdfResult {
  ok: boolean;
  pdfPath: string;
  widthIn: number;
  heightIn: number;
  pdfStandard: string | null;
  pdfx?: PdfxSummary;
  /** Where the barcode was drawn, inches from the top left of the file; null when the file has none. */
  barcodeBox: Rect | null;
  barcodeMagnification: number | null;
  warnings: BuildWarning[];
  log: string;
}

async function runTypst(env: CoverEnv, spec: Record<string, unknown>, out: string, extra: string[], warnings: BuildWarning[]): Promise<{ ok: boolean; log: string }> {
  await prepareEnv(env);
  await env.host.writeText(joinPath(env.buildDir, 'cover.json'), JSON.stringify(spec));
  const res = await typstCompile(env.host, env.buildDir, env.fontDirs, 'cover-main.typ', out, extra);
  if (res.code !== 0) {
    const parsed = parseTypstLog(res.stderr).filter((w) => w.severity === 'fail');
    warnings.push(...(parsed.length ? parsed : [{
      severity: 'fail' as const, code: 'typst',
      message: res.code === -1 ? 'The typesetting engine (Typst) could not be started. Check Settings, Tools.' : `The cover could not be typeset: ${res.stderr.slice(0, 500)}`,
    }]));
    return { ok: false, log: res.stderr };
  }
  return { ok: true, log: res.stderr };
}

/** Build the print cover PDF. With `pdfx` the file becomes PDF/X-1a and pictures are converted to CMYK. */
export async function buildCoverPdf(
  env: CoverEnv, input: CoverBuildInput, outFile: string,
  opts: { toCmyk?: (r: number, g: number, b: number) => Cmyk; pdfx?: PdfxOptions | null },
): Promise<CoverPdfResult> {
  const warnings: BuildWarning[] = [];
  const g = input.geometry;
  const bg = hexToRgb(input.design.colors.background);
  const images = {
    front: await stageCoverImage(env, input.design.art.front, bg, warnings),
    wrap: await stageCoverImage(env, input.design.art.wrap, bg, warnings),
  };
  const built = buildCoverSpec(input, { mode: 'cmyk', toCmyk: opts.toCmyk, images });
  warnings.push(...built.warnings);
  const tmp = joinPath(env.buildDir, 'cover.pdf');
  const run = await runTypst(env, built.spec, tmp, ['--no-pdf-tags', '--pdf-standard', '1.4'], warnings);
  const bc = built.spec.barcode as { box: Rect; placeholder: boolean; magnification?: number } | null;
  const barcodeBox = bc && !bc.placeholder ? bc.box : null;
  const barcodeMagnification = bc && !bc.placeholder ? (bc.magnification ?? 1) : null;
  const fail = (): CoverPdfResult => ({ ok: false, pdfPath: '', widthIn: g.widthIn, heightIn: g.heightIn, pdfStandard: null, barcodeBox, barcodeMagnification, warnings, log: run.log });
  if (!run.ok) return fail();
  // State where the cover is trimmed (or folded), then finish like any print file.
  const doc = await PDFDocument.load(await env.host.readBinary(tmp), { updateMetadata: false });
  const page = doc.getPage(0);
  const H = g.heightIn * 72;
  page.setTrimBox(g.trim.x * 72, H - (g.trim.y + g.trim.h) * 72, g.trim.w * 72, g.trim.h * 72);
  page.setBleedBox(g.art.x * 72, H - (g.art.y + g.art.h) * 72, g.art.w * 72, g.art.h * 72);
  const withBoxes = await doc.save({ useObjectStreams: false });
  const finished = await finalizePrint(withBoxes, {
    removeAnnotations: true, removeOutline: true, removeXmp: true,
    title: `${input.book.title} (${COVER_KIND_LABEL[g.kind].toLowerCase()})`, author: authorsLine(input.book),
    version: [1, 4], pdfx: opts.pdfx ?? undefined,
  });
  for (const problem of finished.pdfx?.problems ?? []) warnings.push({ severity: 'fail', code: 'pdfx', message: `The cover does not meet PDF/X-1a: ${problem}` });
  if (finished.pdfx && g.maxInkPercent && finished.pdfx.maxInkConverted * 100 > g.maxInkPercent + 1) {
    warnings.push({ severity: 'fail', code: 'ink-limit', message: `A cover picture reaches ${Math.round(finished.pdfx.maxInkConverted * 100)} % total ink; ${g.platformName} allows ${g.maxInkPercent} %.` });
  }
  await env.host.mkdirp(outFile.slice(0, outFile.lastIndexOf('/')));
  await env.host.writeBinary(outFile, finished.bytes);
  return {
    ok: !warnings.some((w) => w.severity === 'fail'), pdfPath: outFile, widthIn: g.widthIn, heightIn: g.heightIn,
    pdfStandard: finished.pdfx ? 'PDF/X-1a:2001' : null, pdfx: finished.pdfx, barcodeBox, barcodeMagnification, warnings, log: run.log,
  };
}

/** Render the whole cover as a PNG picture for the screen, optionally with trim, fold and safe zone guides. */
export async function renderCoverPreview(env: CoverEnv, input: CoverBuildInput, outFile: string, opts: { guides?: boolean; ppi?: number } = {}): Promise<{ ok: boolean; pngPath: string; warnings: BuildWarning[] }> {
  const warnings: BuildWarning[] = [];
  const bg = hexToRgb(input.design.colors.background);
  const images = {
    front: await stageCoverImage(env, input.design.art.front, bg, warnings),
    wrap: await stageCoverImage(env, input.design.art.wrap, bg, warnings),
  };
  const built = buildCoverSpec(input, { mode: 'rgb', guides: opts.guides ?? true, images });
  warnings.push(...built.warnings);
  await env.host.mkdirp(outFile.slice(0, outFile.lastIndexOf('/')));
  const run = await runTypst(env, built.spec, outFile, ['--format', 'png', '--ppi', String(opts.ppi ?? 110)], warnings);
  return { ok: run.ok, pngPath: run.ok ? outFile : '', warnings };
}

export interface EbookCoverResult {
  ok: boolean;
  jpgPath: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
  warnings: BuildWarning[];
}

/**
 * Build the ebook cover: the front cover alone, as an RGB JPEG of the pixel
 * size the store asks for. The front design is laid out again for the
 * store's proportions, so nothing is stretched or cropped.
 */
export async function buildEbookCover(env: CoverEnv, input: CoverBuildInput, outFile: string, size: { widthPx: number; heightPx: number }, quality = 92): Promise<EbookCoverResult> {
  const warnings: BuildWarning[] = [];
  const bg = hexToRgb(input.design.colors.background);
  const result: EbookCoverResult = { ok: false, jpgPath: '', widthPx: size.widthPx, heightPx: size.heightPx, sizeBytes: 0, warnings };
  // A finished wrap picture already contains the front cover: crop it out instead of typesetting.
  const wrapPath = input.design.art.wrap && input.design.art.wrapHasText ? input.design.art.wrap : null;
  const images = { front: await stageCoverImage(env, input.design.art.front, bg, warnings), wrap: null as string | null };
  if (wrapPath && !images.front) {
    warnings.push({ severity: 'warn', code: 'ebook-cover-wrap', message: 'The cover is a finished wrap picture. Add the front cover picture on its own (cover art, front) to make the ebook cover.' });
    return result;
  }
  // Work on a page 5 inches wide; the resolution then gives the exact pixel size.
  const widthIn = 5;
  const heightIn = (widthIn * size.heightPx) / size.widthPx;
  const built = buildCoverSpec(input, { mode: 'rgb', guides: false, images, frontOnly: { widthIn, heightIn } });
  warnings.push(...built.warnings.filter((w) => w.code.startsWith('cover-contrast')));
  const png = joinPath(env.buildDir, 'ebook-cover.png');
  const run = await runTypst(env, built.spec, png, ['--format', 'png', '--ppi', String(size.widthPx / widthIn)], warnings);
  if (!run.ok) return result;
  let img = decodePng(await env.host.readBinary(png));
  if (img.channels === 2 || img.channels === 4) img = flattenAlpha(img, bg);
  const jpg = encodeJpeg(img, quality);
  await env.host.mkdirp(outFile.slice(0, outFile.lastIndexOf('/')));
  await env.host.writeBinary(outFile, jpg);
  return { ok: true, jpgPath: outFile, widthPx: img.width, heightPx: img.height, sizeBytes: jpg.length, warnings };
}

export { decodeImage };
