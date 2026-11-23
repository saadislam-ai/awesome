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
import { buildInterior, type InteriorResult } from '../typeset/interior';
import { buildEpub, mediaTypeForImage, type EpubFont, type EpubImage, type EpubResult } from '../epub/build';
import { runEpubCheck, type EpubCheckResult } from '../epub/epubcheck';
import { joinPath, slugify } from '../util/paths';
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
      passes: 0, warnings: [...assembled.warnings, ...pre], log: '', platforms: [opts.platform], rules, assembled,
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
  });
  result.warnings.unshift(...pre);
  if (pre.some((w) => w.severity === 'fail')) result.ok = false;
  return { ...result, platforms: [opts.platform], rules, assembled };
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
