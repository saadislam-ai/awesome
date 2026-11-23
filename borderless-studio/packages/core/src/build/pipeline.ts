/**
 * Export pipelines: the few functions the app and the command line tool call
 * to turn a project into finished files.
 */
import type { Host } from '../host';
import { strictestRules, type InteriorRules } from '../calc/geometry';
import { FONT_CATALOG } from '../fonts/catalog';
import type { CriticView } from '../markdown/critic';
import { getFormat, type PlatformId } from '../model/book';
import { displayIsbn, type IsbnRegister } from '../isbn';
import { LAYOUT } from '../project/layout';
import type { Project } from '../project/store';
import { interiorRules, trimAvailability, type SpecSet } from '../specs';
import { buildInterior, renderInteriorPreview, type InteriorPreview, type InteriorResult } from '../typeset/interior';
import { buildEpub, mediaTypeForImage, type EpubFont, type EpubImage, type EpubResult } from '../epub/build';
import { runEpubCheck, type EpubCheckResult } from '../epub/epubcheck';
import { joinPath, slugify } from '../util/paths';
import { rgbToCmykConverter } from '../color/cmyk';
import type { PdfxOptions } from '../pdf/pdfx';
import { inspectPdf } from '../pdf/inspect';
import { imageInfo } from '../image/info';
import { textNodes } from '../model/book';
import { buildCoverPdf, buildEbookCover, renderCoverPreview, type CoverBuildInput, type CoverEnv, type CoverPdfResult, type EbookCoverResult } from '../cover/build';
import { coverGeometry, coverKindsFor, type CoverGeometryResult, type CoverKind } from '../cover/geometry';
import { CoverDesignSchema, type CoverDesign } from '../cover/model';
import { bookMockup } from '../cover/mockup';
import { buildDocx, type DocxLayout } from '../docx/write';
import { decodePng, encodePng, flattenAlpha } from '../image/png';
import { formatPreflight, manuscriptChecks, preflightCover, preflightEpub, preflightInterior, summarise, type ManuscriptDoc, type PreflightReport } from '../preflight/index';
import { assembleBook, type AlsoByGroup, type AssembledBook, type BuildWarning } from './assemble';

export interface BuildContext {
  host: Host;
  project: Project;
  specs: SpecSet;
  /** Folder with bundled fonts, the Typst library and lookups. */
  resourcesDir: string;
  /** The publisher's ISBN register, for hyphenated ISBNs on the copyright page. */
  isbnRegister?: IsbnRegister | null;
  alsoBy?: AlsoByGroup[];
}

export interface ExportCommon {
  formatId: string;
  criticView?: CriticView;
  /** Only the first N chapters (sample builder). */
  sampleChapters?: number;
  /** Text of the closing page of a sample ("The whole book is available from ..."). */
  sampleEnding?: string;
  /** Advance reader copy: watermark text and a notice on the copyright page. */
  watermark?: string;
  notice?: string;
  /** Suffix added to the output file name, for example "sample" or "arc". */
  variant?: string;
}

export async function assembleProject(ctx: BuildContext, opts: ExportCommon): Promise<AssembledBook> {
  const docs = await ctx.project.readAllDocs();
  return assembleBook(ctx.project.book, ctx.project.binder, docs, {
    formatId: opts.formatId,
    criticView: opts.criticView,
    sampleChapters: opts.sampleChapters,
    sampleEnding: opts.sampleEnding,
    notice: opts.notice,
    alsoBy: ctx.alsoBy,
    isbnDisplay: (isbn) => displayIsbn(ctx.isbnRegister ?? null, isbn),
  });
}

export function fontDirs(ctx: BuildContext): string[] {
  const base = joinPath(ctx.resourcesDir, 'fonts');
  // One --font-path per family folder keeps Typst's scan small; the project's own fonts folder comes last.
  return [base, ctx.project.path('fonts')];
}

export function exportBaseName(ctx: BuildContext, opts: ExportCommon, platform?: string): string {
  const parts = [slugify(ctx.project.book.title, 40), opts.formatId];
  if (platform) parts.push(platform);
  if (opts.variant) parts.push(opts.variant);
  return parts.join('_');
}

export interface InteriorExport extends InteriorResult {
  platforms: PlatformId[];
  rules: InteriorRules;
  assembled: AssembledBook;
}

export interface InteriorExportOptions extends ExportCommon {
  /**
   * The platform the file is for. Each platform gets its own PDF because the
   * page count rules differ (IngramSpark needs a blank last page, for example).
   */
  platform: PlatformId;
  outFile?: string;
  bookmarks?: boolean;
  pageCountHint?: number;
  /**
   * "auto" (default) writes PDF/X-1a when the platform's spec file lists it;
   * "plain" always writes an ordinary PDF.
   */
  pdfStandard?: 'auto' | 'plain';
}

/** Location of the CMYK profile that describes the press condition used for colour conversion. */
export const PRINT_PROFILE = 'icc/CGATS001Compat-v2-micro.icc';

/**
 * PDF/X settings for a platform and format, or null when the platform does
 * not ask for PDF/X. The colour converter is only built when the interior or
 * cover can contain colour.
 */
export async function pdfxOptions(ctx: BuildContext, platform: PlatformId, needsColour: boolean, maxInkPercent?: number | null): Promise<PdfxOptions | null> {
  const spec = ctx.specs.platforms[platform];
  const standards = spec?.print?.interiorFile.pdfStandards ?? [];
  if (!standards.some((s) => /^PDF\/X-1a/i.test(s))) return null;
  const opts: PdfxOptions = {};
  if (needsColour) {
    const profilePath = joinPath(ctx.resourcesDir, PRINT_PROFILE);
    if (await ctx.host.exists(profilePath)) {
      const conv = rgbToCmykConverter(await ctx.host.readBinary(profilePath), { inkLimit: (maxInkPercent ?? 240) / 100 });
      opts.rgbToCmyk = (rgb) => conv.pixels(rgb, 3);
    }
  }
  return opts;
}

/** Build the print interior PDF for one format and one platform. */
export async function exportInterior(ctx: BuildContext, opts: InteriorExportOptions): Promise<InteriorExport> {
  const { project, specs, host } = ctx;
  const format = getFormat(project.book, opts.formatId);
  if (format.type === 'ebook') throw new Error('The ebook format has no print interior. Choose a paperback or hardcover format.');
  const spec = specs.platforms[opts.platform];
  if (!spec || !spec.print) throw new Error(`There is no print spec file for ${opts.platform}. Check the Spec updater screen.`);
  const assembled = await assembleProject(ctx, opts);
  const rules = interiorRules(spec, format.type);
  const avail = trimAvailability(spec, format);
  const pre: BuildWarning[] = [];
  if (avail.problem) pre.push({ severity: 'fail', code: 'trim-unavailable', message: avail.problem });
  if (!avail.trim) {
    return {
      ok: false, pdfPath: '', pageCount: 0, contentPages: 0, blankPagesAdded: 0,
      margins: { margins: { top: 0, bottom: 0, inside: 0, outside: 0 }, raised: [], headerGapIn: 0, footerGapIn: 0 },
      page: { trimWidthIn: 0, trimHeightIn: 0, bleedIn: 0, pdfWidthIn: 0, pdfHeightIn: 0 },
      passes: 0, warnings: [...assembled.warnings, ...pre], log: '', pdfStandard: null, images: [], platforms: [opts.platform], rules, assembled,
    };
  }
  const base = exportBaseName(ctx, opts, opts.platform);
  const outFile = opts.outFile ?? project.path(LAYOUT.exportsDir, `${base}_interior.pdf`);
  const result = await buildInterior(host, assembled, {
    projectDir: project.dir,
    buildDir: project.path(LAYOUT.buildDir, `${opts.formatId}-${opts.platform}${opts.variant ? '-' + opts.variant : ''}`),
    outFile,
    trim: { id: avail.trim.id, widthIn: avail.trim.widthIn, heightIn: avail.trim.heightIn },
    rules,
    pageLimits: avail.pages ?? undefined,
    typstLibDir: joinPath(ctx.resourcesDir, 'typst', 'lib'),
    fontDirs: fontDirs(ctx),
    watermark: opts.watermark,
    bookmarks: opts.bookmarks,
    pageCountHint: opts.pageCountHint,
    greyscaleImages: format.ink === 'bw' && assembled.design.greyscaleImages,
    // Reading copies with bookmarks and links are ordinary PDFs: PDF/X forbids links.
    pdfx: opts.pdfStandard === 'plain' || opts.bookmarks
      ? null
      : await pdfxOptions(ctx, opts.platform, format.ink !== 'bw' || !assembled.design.greyscaleImages, spec.print.interiorFile.maxInkPercent),
  });
  result.warnings.unshift(...pre);
  if (pre.some((w) => w.severity === 'fail')) result.ok = false;
  // Remember the page count: the cover's spine width depends on it. Samples and review copies do not count.
  if (result.pageCount > 0 && !opts.variant && !opts.sampleChapters) {
    await project.writeData(`${LAYOUT.buildDir}/${opts.formatId}-${opts.platform}/last.json`, { pageCount: result.pageCount, builtAt: new Date().toISOString() });
  }
  return { ...result, platforms: [opts.platform], rules, assembled };
}

export interface InteriorPreviewRequest {
  formatId: string;
  /** Platforms whose rules the preview should respect. Defaults to every print platform of the edition. */
  platforms?: PlatformId[];
  from: number;
  to: number;
  ppi?: number;
  criticView?: CriticView;
}

export interface InteriorPreviewExport extends InteriorPreview {
  platforms: PlatformId[];
  rules: InteriorRules;
  problems: string[];
}

/**
 * Draw pages of an edition for the design screen. When the edition goes to
 * several platforms the strictest rule of each kind is used, which is what a
 * single design has to satisfy.
 */
export async function previewInterior(ctx: BuildContext, req: InteriorPreviewRequest): Promise<InteriorPreviewExport> {
  const { project, specs, host } = ctx;
  const format = getFormat(project.book, req.formatId);
  if (format.type === 'ebook') throw new Error('The ebook edition has no pages to preview. Choose a paperback or hardcover edition.');
  const type = format.type;
  const platforms = (req.platforms ?? format.platforms).filter((p) => specs.platforms[p]?.print?.formats[type]);
  const rules = combinedRules(specs, platforms, type);
  const problems: string[] = [];
  let trim: { id: string; widthIn: number; heightIn: number } | null = null;
  for (const p of platforms) {
    const avail = trimAvailability(specs.platforms[p]!, format);
    if (avail.problem) problems.push(avail.problem);
    if (avail.trim && !trim) trim = { id: avail.trim.id, widthIn: avail.trim.widthIn, heightIn: avail.trim.heightIn };
  }
  if (!trim) {
    // No platform offers this size: still show the pages, so the design can be judged.
    const m = /^([\d.]+)x([\d.]+)$/.exec(format.trim);
    trim = { id: format.trim, widthIn: m ? Number(m[1]) : 6, heightIn: m ? Number(m[2]) : 9 };
    if (platforms.length === 0) problems.push('No print platform is selected for this edition, so general print rules are used for the preview.');
  }
  const assembled = await assembleProject(ctx, { formatId: req.formatId, criticView: req.criticView });
  const known = platforms.length ? await lastPageCount(ctx, req.formatId, platforms[0]) : null;
  const res = await renderInteriorPreview(host, assembled, {
    projectDir: project.dir,
    buildDir: project.path(LAYOUT.buildDir, `preview-${req.formatId}`),
    outFile: '',
    trim, rules,
    typstLibDir: joinPath(ctx.resourcesDir, 'typst', 'lib'),
    fontDirs: fontDirs(ctx),
    greyscaleImages: format.ink === 'bw' && assembled.design.greyscaleImages,
    from: req.from, to: req.to, ppi: req.ppi, pageCount: known ?? undefined,
  });
  return { ...res, platforms, rules, problems };
}

/** Rules strict enough for several platforms at once, used by the live preview. */
export function combinedRules(specs: SpecSet, platforms: PlatformId[], type: 'paperback' | 'hardcover'): InteriorRules {
  const list: InteriorRules[] = [];
  for (const p of platforms) {
    const spec = specs.platforms[p];
    if (spec?.print?.formats[type]) list.push(interiorRules(spec, type));
  }
  return strictestRules(list);
}

/* ------------------------------------------------------------------ */
/* EPUB                                                                */
/* ------------------------------------------------------------------ */

export interface EpubExport {
  ok: boolean;
  epubPath: string;
  result: EpubResult;
  check: EpubCheckResult;
  assembled: AssembledBook;
  warnings: BuildWarning[];
  sizeBytes: number;
}

export interface EpubExportOptions extends ExportCommon {
  outFile?: string;
  /** Skip validation (used while typing, for the live previewer). */
  skipCheck?: boolean;
  /** Put the cover inside the reading flow. Retailers add their own, so this is off for store uploads. */
  coverPage?: boolean;
  description?: string;
  subjects?: string[];
  modified?: string;
}

async function loadImages(ctx: BuildContext, paths: string[], warnings: BuildWarning[]): Promise<Map<string, EpubImage>> {
  const out = new Map<string, EpubImage>();
  for (const src of paths) {
    const abs = /^([A-Za-z]:)?\//.test(src) ? src : ctx.project.path(src);
    const mediaType = mediaTypeForImage(src);
    if (!mediaType) {
      warnings.push({ severity: 'fail', code: 'image-type', message: `The picture "${src}" is not a JPEG, PNG, GIF or SVG file, which is what ebooks accept.` });
      continue;
    }
    if (!(await ctx.host.exists(abs))) continue; // buildEpub reports the missing file
    out.set(src, { data: await ctx.host.readBinary(abs), mediaType });
  }
  return out;
}

/** Locate the ebook cover image produced by the cover builder, or a front cover placed in cover/art. */
export async function findEbookCover(ctx: BuildContext): Promise<EpubImage | undefined> {
  const candidates = ['cover/ebook-cover.jpg', 'cover/art/front.jpg', 'cover/art/front.jpeg', 'cover/art/front.png'];
  for (const rel of candidates) {
    const p = ctx.project.path(rel);
    if (await ctx.host.exists(p)) return { data: await ctx.host.readBinary(p), mediaType: mediaTypeForImage(rel) ?? 'image/jpeg' };
  }
  return undefined;
}

async function loadFonts(ctx: BuildContext, family: string): Promise<EpubFont[]> {
  const info = FONT_CATALOG.find((f) => f.family === family);
  if (!info) return [];
  const out: EpubFont[] = [];
  const add = async (file: string | undefined, style: 'normal' | 'italic', weight: 400 | 700) => {
    if (!file) return;
    const p = joinPath(ctx.resourcesDir, 'fonts', info.dir, file);
    if (await ctx.host.exists(p)) out.push({ family, fileName: file, data: await ctx.host.readBinary(p), style, weight });
  };
  await add(info.files.regular, 'normal', 400);
  await add(info.files.italic, 'italic', 400);
  await add(info.files.bold, 'normal', 700);
  await add(info.files.boldItalic, 'italic', 700);
  return out;
}

/** Build the EPUB for an ebook format, write it to exports/, and validate it with EPUBCheck. */
export async function exportEpub(ctx: BuildContext, opts: EpubExportOptions): Promise<EpubExport> {
  const { project, host } = ctx;
  const format = getFormat(project.book, opts.formatId);
  if (format.type !== 'ebook') throw new Error('Choose the ebook format to build an EPUB.');
  const assembled = await assembleProject(ctx, opts);
  const warnings: BuildWarning[] = [...assembled.warnings];
  const images = await loadImages(ctx, assembled.stats.images, warnings);
  const cover = await findEbookCover(ctx);
  const fonts = format.ebook.embedFonts ? await loadFonts(ctx, assembled.design.bodyFont) : [];
  const result = buildEpub(assembled, {
    images, cover, coverPage: opts.coverPage ?? false, fonts,
    description: opts.description, subjects: opts.subjects, modified: opts.modified,
    fallbackUuid: `urn:uuid:${uuidFromId(project.book.id)}`,
  });
  for (const w of result.warnings) warnings.push({ severity: w.severity, code: w.code, message: w.message });
  if (!cover) {
    warnings.push({ severity: 'warn', code: 'no-cover', message: 'No ebook cover image was found. Create one in the Cover builder (it is saved as cover/ebook-cover.jpg).' });
  }
  const outFile = opts.outFile ?? project.path(LAYOUT.exportsDir, `${exportBaseName(ctx, opts)}.epub`);
  await host.mkdirp(outFile.slice(0, outFile.lastIndexOf('/')));
  await host.writeBinary(outFile, result.bytes);
  const check: EpubCheckResult = opts.skipCheck
    ? { ran: false, passed: false, errors: 0, warnings: 0, issues: [], checker: '', problem: 'Validation was skipped.' }
    : await runEpubCheck(host, outFile, result.map);
  if (!opts.skipCheck && !check.ran) {
    warnings.push({ severity: 'warn', code: 'epubcheck-missing', message: check.problem ?? 'EPUBCheck could not be run.' });
  }
  const ok = !warnings.some((w) => w.severity === 'fail') && (opts.skipCheck || !check.ran || check.passed);
  return { ok, epubPath: outFile, result, check, assembled, warnings, sizeBytes: result.bytes.length };
}

/** A stable UUID shaped string derived from the book id (so rebuilding never changes the identifier). */
function uuidFromId(id: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < id.length; i++) {
      h1 = Math.imul(h1 ^ id.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + id.charCodeAt(i) + round, 0x85ebca6b) >>> 0;
    }
    hex.push((h1 >>> 0).toString(16).padStart(8, '0'), (h2 >>> 0).toString(16).padStart(8, '0'));
  }
  const s = hex.join('').slice(0, 32).split('');
  s[12] = '4';
  s[16] = ['8', '9', 'a', 'b'][parseInt(s[16], 16) % 4];
  const j = s.join('');
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20, 32)}`;
}

/* ------------------------------------------------------------------ */
/* Preflight                                                           */
/* ------------------------------------------------------------------ */

async function manuscriptDocs(ctx: BuildContext): Promise<ManuscriptDoc[]> {
  const docs = await ctx.project.readAllDocs();
  return textNodes(ctx.project.binder)
    .filter((n) => n.include !== false)
    .map((n) => ({ nodeId: n.id, title: n.title, text: docs.get(n.id) ?? '' }));
}

/**
 * Open a finished interior PDF and check it against the platform's rules.
 * The report is also written next to the PDF as a text file.
 */
export async function preflightInteriorFile(ctx: BuildContext, res: InteriorExport, platform: PlatformId): Promise<PreflightReport> {
  const spec = ctx.specs.platforms[platform];
  if (!spec?.print) throw new Error(`There is no print spec file for ${platform}.`);
  const format = res.assembled.format;
  let report: PreflightReport;
  if (!res.pdfPath) {
    report = summarise(`${format.label || format.type} interior for ${spec.displayName}`, 'interior', platform, format.id,
      res.warnings.filter((w) => w.severity !== 'info').map((w) => ({ id: `build-${w.code}`, group: 'book' as const, title: 'Reported while building', status: w.severity === 'fail' ? 'fail' as const : 'warn' as const, detail: w.message, nodeId: w.nodeId })));
  } else {
    const bytes = await ctx.host.readBinary(res.pdfPath);
    const pdf = await inspectPdf(bytes);
    report = preflightInterior({
      report: pdf, spec, rules: res.rules, book: ctx.project.book, format,
      trim: { widthIn: res.page.trimWidthIn, heightIn: res.page.trimHeightIn },
      pageLimits: trimAvailability(spec, format).pages ?? null,
      fileSizeBytes: bytes.length, buildWarnings: res.warnings, images: res.images, isbnRegister: ctx.isbnRegister,
    });
    const extra = manuscriptChecks(await manuscriptDocs(ctx), ctx.project.book);
    report = summarise(report.target, report.kind, platform, format.id, [...report.checks, ...extra]);
    await ctx.host.writeText(res.pdfPath.replace(/_interior\.pdf$|\.pdf$/, '_preflight.txt'), formatPreflight(report));
  }
  return report;
}

/** Check a finished EPUB against one platform's ebook rules. */
export async function preflightEpubFile(ctx: BuildContext, res: EpubExport, platform: PlatformId): Promise<PreflightReport> {
  const spec = ctx.specs.platforms[platform];
  if (!spec) throw new Error(`There is no spec file for ${platform}.`);
  // The cover made for this store, when there is one; otherwise the one inside the EPUB.
  const own = ctx.project.path(LAYOUT.exportsDir, `${slugify(ctx.project.book.title, 40)}_ebook-cover_${platform}.jpg`);
  const cover = (await ctx.host.exists(own)) ? { data: await ctx.host.readBinary(own), mediaType: 'image/jpeg' } : await findEbookCover(ctx);
  const report = preflightEpub({
    spec, book: ctx.project.book, format: res.assembled.format, check: res.check, fileSizeBytes: res.sizeBytes,
    cover: cover ? { info: imageInfo(cover.data), sizeBytes: cover.data.length } : null,
    buildWarnings: res.warnings, isbnRegister: ctx.isbnRegister,
  });
  const extra = manuscriptChecks(await manuscriptDocs(ctx), ctx.project.book);
  const full = summarise(report.target, report.kind, platform, res.assembled.format.id, [...report.checks, ...extra]);
  if (res.epubPath) await ctx.host.writeText(res.epubPath.replace(/\.epub$/, `_${platform}_preflight.txt`), formatPreflight(full));
  return full;
}

/* ------------------------------------------------------------------ */
/* Covers                                                              */
/* ------------------------------------------------------------------ */

/** The cover design of the book (cover/cover.json), or the default design when none was saved yet. */
export async function loadCoverDesign(project: Project): Promise<CoverDesign> {
  return CoverDesignSchema.parse(await project.readData<unknown>(LAYOUT.cover, {}));
}

export async function saveCoverDesign(project: Project, design: CoverDesign): Promise<void> {
  await project.writeData(LAYOUT.cover, CoverDesignSchema.parse(design));
}

/** Page count of the last interior built for an edition and platform, or null when none was built yet. */
export async function lastPageCount(ctx: BuildContext, formatId: string, platform: PlatformId): Promise<number | null> {
  const last = await ctx.project.readData<{ pageCount?: number } | null>(`${LAYOUT.buildDir}/${formatId}-${platform}/last.json`, null);
  return last?.pageCount && last.pageCount > 0 ? last.pageCount : null;
}

export interface CoverTarget {
  formatId: string;
  platform: PlatformId;
  kind?: CoverKind;
  /** Page count to use for the spine. Defaults to the last interior build, building the interior first when there is none. */
  pages?: number;
}

export interface CoverPlan extends CoverGeometryResult {
  pages: number;
  kind: CoverKind;
  design: CoverDesign;
}

/** Work out the cover layout for an edition on a platform. */
export async function planCover(ctx: BuildContext, target: CoverTarget): Promise<CoverPlan> {
  const format = getFormat(ctx.project.book, target.formatId);
  const spec = ctx.specs.platforms[target.platform];
  if (!spec?.print) throw new Error(`There is no print spec file for ${target.platform}.`);
  if (format.type === 'ebook') throw new Error('Choose a paperback or hardcover edition for a print cover.');
  let pages = target.pages ?? (await lastPageCount(ctx, target.formatId, target.platform));
  if (!pages) {
    const interior = await exportInterior(ctx, { formatId: target.formatId, platform: target.platform });
    pages = interior.pageCount;
  }
  const kind = target.kind ?? coverKindsFor(spec, format)[0];
  const po = format.platformOptions[target.platform] ?? {};
  const design = await loadCoverDesign(ctx.project);
  const res = coverGeometry(spec, format, pages, {
    kind, templateSpineIn: po.spineWidthIn ?? null, templateWidthIn: po.templateWidthIn ?? null, templateHeightIn: po.templateHeightIn ?? null,
  });
  if (pages <= 0) res.problems.unshift('The interior could not be built, so the page count for the spine is unknown.');
  return { ...res, pages, kind, design };
}

function coverEnv(ctx: BuildContext, target: CoverTarget, kind: CoverKind): CoverEnv {
  return {
    host: ctx.host, projectDir: ctx.project.dir,
    buildDir: ctx.project.path(LAYOUT.buildDir, `cover-${target.formatId}-${target.platform}-${kind}`),
    typstLibDir: joinPath(ctx.resourcesDir, 'typst', 'lib'), fontDirs: fontDirs(ctx),
  };
}

function coverInput(ctx: BuildContext, plan: CoverPlan, format: ReturnType<typeof getFormat>): CoverBuildInput {
  const book = ctx.project.book;
  return {
    book, format, design: plan.design, geometry: plan.geometry!,
    isbnDisplay: format.isbn ? displayIsbn(ctx.isbnRegister ?? null, format.isbn) : undefined,
    imprint: book.imprint, website: book.publisherWebsite,
    // IngramSpark names its rich black; other platforms get the converter's own dark mix.
    richBlack: plan.geometry!.platform === 'ingramspark' ? [60, 40, 40, 100] : null,
  };
}

export interface CoverExport extends CoverPdfResult {
  plan: CoverPlan;
  kind: CoverKind;
}

/** Build the print cover PDF for an edition and platform and write it to exports/. */
export async function exportCover(ctx: BuildContext, target: CoverTarget & { outFile?: string }): Promise<CoverExport> {
  const plan = await planCover(ctx, target);
  const format = getFormat(ctx.project.book, target.formatId);
  const failed = (problems: string[]): CoverExport => ({
    ok: false, pdfPath: '', widthIn: 0, heightIn: 0, pdfStandard: null, barcodeBox: null, barcodeMagnification: null, log: '', plan, kind: plan.kind,
    warnings: problems.map((message) => ({ severity: 'fail' as const, code: 'cover-layout', message })),
  });
  if (!plan.geometry || plan.problems.length) return failed(plan.problems.length ? plan.problems : ['The cover could not be laid out.']);
  const g = plan.geometry;
  const spec = ctx.specs.platforms[target.platform]!;
  const coverRules = spec.print!.formats[format.type as 'paperback' | 'hardcover']!.cover;
  // PDF/X and CMYK conversion where the platform's cover rules ask for them.
  const wantsX = coverRules.pdfStandards.some((s) => /^PDF\/X-1a/i.test(s));
  let toCmyk: ((r: number, gg: number, b: number) => [number, number, number, number]) | undefined;
  let pdfx: PdfxOptions | null = null;
  const profilePath = joinPath(ctx.resourcesDir, PRINT_PROFILE);
  if ((wantsX || coverRules.colorSpace === 'cmyk') && (await ctx.host.exists(profilePath))) {
    const conv = rgbToCmykConverter(await ctx.host.readBinary(profilePath), { inkLimit: (coverRules.maxInkPercent ?? 240) / 100 });
    toCmyk = (r, gg, b) => conv.color(r, gg, b);
    if (wantsX) pdfx = { rgbToCmyk: (rgb) => conv.pixels(rgb, 3) };
  } else if (await ctx.host.exists(profilePath)) {
    // Platforms that take RGB or CMYK still get CMYK text and flat colours, for predictable print.
    const conv = rgbToCmykConverter(await ctx.host.readBinary(profilePath), { inkLimit: 2.4 });
    toCmyk = (r, gg, b) => conv.color(r, gg, b);
  }
  const suffix = plan.kind === 'paperback' ? 'cover' : plan.kind === 'case-laminate' ? 'case-cover' : 'dust-jacket';
  const outFile = target.outFile ?? ctx.project.path(LAYOUT.exportsDir, `${exportBaseName(ctx, { formatId: target.formatId }, target.platform)}_${suffix}.pdf`);
  const res = await buildCoverPdf(coverEnv(ctx, target, plan.kind), coverInput(ctx, plan, format), outFile, { toCmyk, pdfx });
  for (const c of plan.cautions) res.warnings.push({ severity: 'info', code: 'cover-note', message: c });
  if (res.ok) {
    await ctx.project.writeData(`${LAYOUT.buildDir}/cover-${target.formatId}-${target.platform}-${plan.kind}/last.json`, {
      pages: plan.pages, spineWidthIn: g.spineWidthIn, widthIn: g.widthIn, heightIn: g.heightIn, builtAt: new Date().toISOString(),
    });
  }
  return { ...res, plan, kind: plan.kind };
}

/** Render the cover as a picture with trim, fold and safe zone guides, for the cover builder screen. */
export async function previewCover(ctx: BuildContext, target: CoverTarget & { guides?: boolean; ppi?: number; design?: CoverDesign }): Promise<{ ok: boolean; pngPath: string; plan: CoverPlan; warnings: BuildWarning[] }> {
  const plan = await planCover(ctx, target);
  if (target.design) plan.design = target.design;
  if (!plan.geometry) {
    return { ok: false, pngPath: '', plan, warnings: plan.problems.map((message) => ({ severity: 'fail' as const, code: 'cover-layout', message })) };
  }
  const format = getFormat(ctx.project.book, target.formatId);
  const env = coverEnv(ctx, target, plan.kind);
  const out = joinPath(env.buildDir, `preview${target.guides === false ? '-clean' : ''}.png`);
  const res = await renderCoverPreview(env, coverInput(ctx, plan, format), out, { guides: target.guides, ppi: target.ppi });
  return { ...res, plan };
}

/**
 * Build the ebook cover in the pixel size a store asks for. The file for the
 * first platform is also saved as cover/ebook-cover.jpg, which is the picture
 * the EPUB export embeds.
 */
export async function exportEbookCover(ctx: BuildContext, opts: { formatId?: string; platform?: PlatformId; design?: CoverDesign } = {}): Promise<EbookCoverResult & { platform: PlatformId }> {
  const book = ctx.project.book;
  const format = opts.formatId ? getFormat(book, opts.formatId) : book.formats.find((f) => f.type === 'ebook' && f.enabled) ?? book.formats.find((f) => f.type === 'ebook');
  if (!format) throw new Error('This book has no ebook edition.');
  const platform = opts.platform ?? format.platforms.find((p) => ctx.specs.platforms[p]?.ebook) ?? 'kdp';
  const rules = ctx.specs.platforms[platform]?.ebook;
  if (!rules) throw new Error(`The ${platform} spec file has no ebook section.`);
  const design = opts.design ?? (await loadCoverDesign(ctx.project));
  const env: CoverEnv = {
    host: ctx.host, projectDir: ctx.project.dir, buildDir: ctx.project.path(LAYOUT.buildDir, `cover-ebook-${platform}`),
    typstLibDir: joinPath(ctx.resourcesDir, 'typst', 'lib'), fontDirs: fontDirs(ctx),
  };
  // The front layout needs no print geometry; a neutral one keeps the types simple.
  const blank = { x: 0, y: 0, w: 0, h: 0 };
  const input: CoverBuildInput = {
    book, format, design, imprint: book.imprint, website: book.publisherWebsite,
    geometry: {
      platform, platformName: ctx.specs.platforms[platform]!.displayName, kind: 'paperback', pages: 0, trimWidthIn: 5, trimHeightIn: 8,
      widthIn: 5, heightIn: 8, art: { x: 0, y: 0, w: 5, h: 8 }, onSheet: false, bleedIn: 0, trim: blank, back: blank, spine: blank, front: blank, backFlap: null, frontFlap: null, hinges: [],
      safe: { back: blank, front: blank, spine: null, backFlap: null, frontFlap: null }, barcode: blank, barcodeRequired: false, platformAddsBarcode: false,
      spineWidthIn: 0, spineBasis: '', spineTextAllowed: false, maxInkPercent: null, colorSpace: 'rgb-or-cmyk', minImageDpi: 300, notes: [],
    },
  };
  const out = ctx.project.path(LAYOUT.exportsDir, `${slugify(book.title, 40)}_ebook-cover_${platform}.jpg`);
  const res = await buildEbookCover(env, input, out, { widthPx: rules.cover.idealWidthPx, heightPx: rules.cover.idealHeightPx });
  // The EPUB embeds cover/ebook-cover.jpg; keep it in step with the first store of the edition.
  if (res.ok && platform === (format.platforms.find((p) => ctx.specs.platforms[p]?.ebook) ?? platform)) {
    await ctx.host.copy(out, ctx.project.path(LAYOUT.coverDir, 'ebook-cover.jpg'));
  }
  return { ...res, platform };
}

/** Open a finished cover PDF and check it against the platform's cover rules. */
export async function preflightCoverFile(ctx: BuildContext, res: CoverExport, target: CoverTarget): Promise<PreflightReport> {
  const spec = ctx.specs.platforms[target.platform];
  if (!spec?.print) throw new Error(`There is no print spec file for ${target.platform}.`);
  const format = getFormat(ctx.project.book, target.formatId);
  const g = res.plan.geometry;
  if (!res.pdfPath || !g) {
    return summarise(`${format.label || format.type} cover for ${spec.displayName}`, 'cover', target.platform, format.id,
      res.warnings.filter((w) => w.severity !== 'info').map((w) => ({ id: `build-${w.code}`, group: 'cover' as const, title: 'Reported while building', status: w.severity === 'fail' ? 'fail' as const : 'warn' as const, detail: w.message })));
  }
  const bytes = await ctx.host.readBinary(res.pdfPath);
  const report = preflightCover({
    report: await inspectPdf(bytes), spec, book: ctx.project.book, format, geometry: g, fileSizeBytes: bytes.length,
    interiorPages: await lastPageCount(ctx, target.formatId, target.platform),
    barcodeBox: res.barcodeBox, barcodeMagnification: res.barcodeMagnification, maxInkConverted: res.pdfx?.maxInkConverted ?? null,
    buildWarnings: res.warnings, isbnRegister: ctx.isbnRegister,
  });
  await ctx.host.writeText(res.pdfPath.replace(/\.pdf$/, '_preflight.txt'), formatPreflight(report));
  return report;
}

/**
 * Make a three dimensional mock-up picture of an edition (front cover and
 * spine at an angle). Written to exports/ as a PNG with a transparent
 * background, and as a second PNG on white for places that need one.
 */
export async function exportMockup(ctx: BuildContext, target: CoverTarget & { size?: number; angle?: number }): Promise<{ ok: boolean; pngPath: string; whitePath: string; warnings: BuildWarning[] }> {
  const ppi = 150;
  const flat = await previewCover(ctx, { ...target, guides: false, ppi });
  if (!flat.ok || !flat.plan.geometry) return { ok: false, pngPath: '', whitePath: '', warnings: flat.warnings };
  const picture = decodePng(await ctx.host.readBinary(flat.pngPath));
  const base = ctx.project.path(LAYOUT.exportsDir, `${exportBaseName(ctx, { formatId: target.formatId })}_mockup`);
  const clear = bookMockup(picture, flat.plan.geometry, ppi, { size: target.size, angle: target.angle, background: null });
  await ctx.host.mkdirp(ctx.project.path(LAYOUT.exportsDir));
  await ctx.host.writeBinary(`${base}.png`, encodePng(clear));
  // The same picture on white, without drawing it twice.
  await ctx.host.writeBinary(`${base}_white.png`, encodePng(flattenAlpha(clear, [255, 255, 255])));
  return { ok: true, pngPath: `${base}.png`, whitePath: `${base}_white.png`, warnings: flat.warnings };
}

/* ------------------------------------------------------------------ */
/* Word files                                                          */
/* ------------------------------------------------------------------ */

export interface DocxExport {
  ok: boolean;
  docxPath: string;
  sizeBytes: number;
  footnotes: number;
  warnings: BuildWarning[];
}

/**
 * Write the book as a Word file: "manuscript" is the standard submission
 * format, "retail" is a clean file for stores that convert Word files
 * themselves (Draft2Digital).
 */
export async function exportDocx(ctx: BuildContext, opts: ExportCommon & { layout: DocxLayout; contact?: string[]; outFile?: string }): Promise<DocxExport> {
  const assembled = await assembleProject(ctx, opts);
  const images = new Map<string, Uint8Array>();
  for (const src of assembled.stats.images) {
    const abs = /^([A-Za-z]:)?\//.test(src) ? src : ctx.project.path(src);
    if (await ctx.host.exists(abs)) images.set(src, await ctx.host.readBinary(abs));
  }
  const res = buildDocx(assembled, { layout: opts.layout, images, contact: opts.contact });
  const warnings: BuildWarning[] = assembled.warnings.filter((w) => w.severity === 'fail');
  for (const m of res.missingImages) warnings.push({ severity: 'warn', code: 'docx-image', message: `The picture "${m}" was not found and is replaced by a note in the Word file.` });
  const suffix = opts.layout === 'manuscript' ? 'manuscript' : 'retail';
  const outFile = opts.outFile ?? ctx.project.path(LAYOUT.exportsDir, `${slugify(ctx.project.book.title, 40)}_${suffix}.docx`);
  await ctx.host.mkdirp(outFile.slice(0, outFile.lastIndexOf('/')));
  await ctx.host.writeBinary(outFile, res.bytes);
  return { ok: !warnings.some((w) => w.severity === 'fail'), docxPath: outFile, sizeBytes: res.bytes.length, footnotes: res.footnotes, warnings };
}
