/**
 * Preflight: the checks a platform runs on an uploaded file, run here first.
 *
 * Every check reads its limits from the platform's spec file and looks at the
 * real, finished file (page sizes, margins measured from the ink on each
 * page, fonts, pictures), not at the settings that produced it. A check
 * returns a status and a sentence a non specialist can act on.
 */
import { minInsideMargin, minOuterMargin, type InteriorRules } from '../calc/geometry';
import { findDashes } from '../editor/cleaner';
import type { EpubCheckResult } from '../epub/epubcheck';
import type { ImageInfo } from '../image/info';
import { checkBookIsbns, validateIsbn, type IsbnRegister } from '../isbn';
import { countCritic } from '../markdown/critic';
import { maskMarkdown } from '../markdown/mask';
import { baseLanguage, type Book, type BookFormat, type PlatformId } from '../model/book';
import type { PdfReport } from '../pdf/inspect';
import type { PlatformSpec } from '../specs/schema';
import type { BuildWarning } from '../build/assemble';
import type { StagedImage } from '../typeset/interior';

export type CheckStatus = 'pass' | 'info' | 'warn' | 'fail';
export type CheckGroup = 'file' | 'pages' | 'margins' | 'fonts' | 'pictures' | 'colour' | 'book' | 'text' | 'cover' | 'ebook';

export interface Check {
  id: string;
  group: CheckGroup;
  /** Short name of what was checked ("Inside margin"). */
  title: string;
  status: CheckStatus;
  /** What was found, in plain words. */
  detail: string;
  /** What to do about it, when something is wrong. */
  fix?: string;
  /** Pages concerned (the first few). */
  pages?: number[];
  /** Manuscript document to open, when the problem is in the text. */
  nodeId?: string;
}

export interface PreflightReport {
  /** "Paperback interior for IngramSpark". */
  target: string;
  kind: 'interior' | 'cover' | 'ebook';
  platform: PlatformId;
  formatId: string;
  checks: Check[];
  counts: Record<CheckStatus, number>;
  /** True when nothing failed. Warnings do not block an upload but deserve a look. */
  ready: boolean;
  createdAt: string;
}

export function summarise(
  target: string, kind: PreflightReport['kind'], platform: PlatformId, formatId: string, checks: Check[], now: Date = new Date(),
): PreflightReport {
  const counts: Record<CheckStatus, number> = { pass: 0, info: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  const order: Record<CheckStatus, number> = { fail: 0, warn: 1, info: 2, pass: 3 };
  const sorted = [...checks].sort((a, b) => order[a.status] - order[b.status]);
  return { target, kind, platform, formatId, checks: sorted, counts, ready: counts.fail === 0, createdAt: now.toISOString() };
}

const fmtIn = (v: number): string => `${Math.round(v * 1000) / 1000} in`;
const first = (pages: number[], n = 8): number[] => pages.slice(0, n);
const pageList = (pages: number[]): string =>
  pages.length <= 8 ? pages.join(', ') : `${pages.slice(0, 8).join(', ')} and ${pages.length - 8} more`;

/** Does the platform accept this language for this kind of book? Returns a problem sentence, or null. */
export function languageProblem(spec: PlatformSpec, type: BookFormat['type'], language: string): string | null {
  const list = spec.languages?.[type];
  if (!list || list.supported === 'any') return null;
  const base = baseLanguage(language).toLowerCase();
  if (list.supported.map((l) => l.toLowerCase()).includes(base)) return null;
  return `${spec.displayName} does not list "${base}" among the languages it supports for ${type} books.${list.note ? ' ' + list.note : ''}`;
}

/* ------------------------------------------------------------------ */
/* Print interior                                                      */
/* ------------------------------------------------------------------ */

export interface InteriorPreflightInput {
  report: PdfReport;
  spec: PlatformSpec;
  rules: InteriorRules;
  book: Book;
  format: BookFormat;
  /** Expected trim size in inches. */
  trim: { widthIn: number; heightIn: number };
  /** Allowed page range for this trim, paper and ink. */
  pageLimits?: { min: number; max: number } | null;
  fileSizeBytes: number;
  /** Messages produced while building. */
  buildWarnings?: BuildWarning[];
  images?: StagedImage[];
  isbnRegister?: IsbnRegister | null;
  now?: Date;
}

export function preflightInterior(input: InteriorPreflightInput): PreflightReport {
  const { report, spec, rules, book, format, trim } = input;
  const fileRules = spec.print!.interiorFile;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const tol = 0.006; // inches: half a point of measuring tolerance
  const bleed = format.bleed ? rules.bleedIn : 0;
  const name = spec.displayName;

  // --- Page size -----------------------------------------------------
  const wantW = (trim.widthIn + bleed) * 72;
  const wantH = (trim.heightIn + 2 * bleed) * 72;
  const wrongSize = report.pages.filter((p) => Math.abs(p.width - wantW) > 0.6 || Math.abs(p.height - wantH) > 0.6).map((p) => p.number);
  add(wrongSize.length === 0
    ? { id: 'page-size', group: 'pages', title: 'Page size', status: 'pass', detail: `Every page is ${fmtIn(wantW / 72)} x ${fmtIn(wantH / 72)}${format.bleed ? ` (trim ${trim.widthIn} x ${trim.heightIn} in plus bleed)` : ''}.` }
    : { id: 'page-size', group: 'pages', title: 'Page size', status: 'fail', detail: `Pages ${pageList(wrongSize)} do not have the expected size of ${fmtIn(wantW / 72)} x ${fmtIn(wantH / 72)}.`, pages: first(wrongSize), fix: 'Build the interior again. If it persists, check the trim size of this edition.' });
  if (format.bleed) {
    const noTrim = report.pages.filter((p) => !p.hasTrimBox).map((p) => p.number);
    add(noTrim.length === 0
      ? { id: 'trim-box', group: 'pages', title: 'Trim marks in the file', status: 'pass', detail: 'Every page states where it will be trimmed.' }
      : { id: 'trim-box', group: 'pages', title: 'Trim marks in the file', status: 'warn', detail: `Pages ${pageList(noTrim)} do not state their trim size.`, pages: first(noTrim) });
  }

  // --- Page count ----------------------------------------------------
  const limits = input.pageLimits ?? { min: rules.minPages, max: rules.maxPages };
  const count = report.pageCount;
  if (count < limits.min || count > limits.max) {
    add({ id: 'page-count', group: 'pages', title: 'Page count', status: 'fail', detail: `The book has ${count} pages. ${name} prints this size, paper and ink from ${limits.min} to ${limits.max} pages.`, fix: count < limits.min ? 'Add pages, choose a smaller trim size or a larger type size.' : 'Choose a larger trim size, a smaller type size or tighter margins, or split the book.' });
  } else if (count % rules.pageMultiple !== 0) {
    add({ id: 'page-count', group: 'pages', title: 'Page count', status: 'fail', detail: `The book has ${count} pages; ${name} needs a multiple of ${rules.pageMultiple}.`, fix: 'Build the interior again: blank pages are added automatically.' });
  } else {
    add({ id: 'page-count', group: 'pages', title: 'Page count', status: 'pass', detail: `${count} pages (allowed: ${limits.min} to ${limits.max}).` });
  }
  if (rules.lastPageBlank) {
    const last = report.pages[report.pages.length - 1];
    add(last && last.ink === null
      ? { id: 'last-page', group: 'pages', title: 'Last page', status: 'pass', detail: `The last page is blank, as ${name} requires (the printer uses it).` }
      : { id: 'last-page', group: 'pages', title: 'Last page', status: 'fail', detail: `${name} needs a completely blank last page.`, fix: 'Build the interior again for this platform.' });
  }

  // --- Margins, measured -----------------------------------------------
  const needInside = minInsideMargin(rules, count);
  const needOuter = minOuterMargin(rules, format.bleed);
  const analysed = report.pages.filter((p) => p.ink !== null);
  const insideBad: number[] = [];
  const outerBad: number[] = [];
  const bleedShort: number[] = [];
  let worstInside = Infinity;
  let worstOuter = Infinity;
  for (const p of analysed) {
    const recto = p.number % 2 === 1;
    const images = report.images.filter((i) => i.page === p.number);
    // Pictures that reach past the trim edge are meant to bleed; they are judged separately.
    const bleeding = images.filter((i) => i.box.x0 < p.trim.x0 - 0.5 || i.box.x1 > p.trim.x1 + 0.5 || i.box.y0 < p.trim.y0 - 0.5 || i.box.y1 > p.trim.y1 + 0.5);
    const box = bleeding.length ? p.text : p.ink;
    if (box) {
      const left = (box.x0 - p.trim.x0) / 72;
      const right = (p.trim.x1 - box.x1) / 72;
      const inside = recto ? left : right;
      const outside = recto ? right : left;
      const top = (p.trim.y1 - box.y1) / 72;
      const bottom = (box.y0 - p.trim.y0) / 72;
      worstInside = Math.min(worstInside, inside);
      const outer = Math.min(outside, top, bottom);
      worstOuter = Math.min(worstOuter, outer);
      if (inside + tol < needInside) insideBad.push(p.number);
      if (outer + tol < needOuter) outerBad.push(p.number);
    }
    for (const img of bleeding) {
      // A bleeding picture must run all the way to the edge of the file on the sides where it leaves the page.
      const sides: [boolean, number][] = [
        [img.box.y1 > p.trim.y1 + 0.5, p.media.y1 - img.box.y1],
        [img.box.y0 < p.trim.y0 - 0.5, img.box.y0 - p.media.y0],
        [recto ? img.box.x1 > p.trim.x1 + 0.5 : img.box.x0 < p.trim.x0 - 0.5, recto ? p.media.x1 - img.box.x1 : img.box.x0 - p.media.x0],
      ];
      if (sides.some(([leaves, gap]) => leaves && gap > 1) && !bleedShort.includes(p.number)) bleedShort.push(p.number);
    }
  }
  add(insideBad.length === 0
    ? { id: 'margin-inside', group: 'margins', title: 'Inside (gutter) margin', status: 'pass', detail: `Smallest measured inside margin: ${fmtIn(worstInside)}. ${name} needs ${fmtIn(needInside)} for ${count} pages.` }
    : { id: 'margin-inside', group: 'margins', title: 'Inside (gutter) margin', status: 'fail', detail: `On pages ${pageList(insideBad)} content comes closer to the spine than the ${fmtIn(needInside)} that ${name} needs for ${count} pages (smallest: ${fmtIn(worstInside)}).`, pages: first(insideBad), fix: 'Increase the inside margin in the design settings, or make the item on that page narrower.' });
  add(outerBad.length === 0
    ? { id: 'margin-outer', group: 'margins', title: 'Top, bottom and outside margins', status: 'pass', detail: `Smallest measured margin: ${fmtIn(worstOuter)}. ${name} needs ${fmtIn(needOuter)}.` }
    : { id: 'margin-outer', group: 'margins', title: 'Top, bottom and outside margins', status: 'fail', detail: `On pages ${pageList(outerBad)} content comes closer to the page edge than ${fmtIn(needOuter)} (smallest: ${fmtIn(worstOuter)}).`, pages: first(outerBad), fix: 'Increase the margin, or reduce the picture or table on that page.' });
  if (format.bleed) {
    add(bleedShort.length === 0
      ? { id: 'bleed', group: 'margins', title: 'Bleed', status: 'pass', detail: `Pictures that run off the page extend ${fmtIn(rules.bleedIn)} past the trim.` }
      : { id: 'bleed', group: 'margins', title: 'Bleed', status: 'fail', detail: `On pages ${pageList(bleedShort)} a picture leaves the page but stops short of the bleed edge, which can leave a white sliver after trimming.`, pages: first(bleedShort), fix: 'Mark the picture as a bleed picture so it is extended to the edge.' });
  } else {
    const touching = report.pages.filter((p) => p.ink && (p.ink.x0 < p.trim.x0 + 1 || p.ink.x1 > p.trim.x1 - 1 || p.ink.y0 < p.trim.y0 + 1 || p.ink.y1 > p.trim.y1 - 1)).map((p) => p.number);
    if (touching.length) {
      add({ id: 'bleed', group: 'margins', title: 'Bleed', status: 'fail', detail: `Content reaches the page edge on pages ${pageList(touching)} but this edition is set up without bleed.`, pages: first(touching), fix: 'Switch bleed on for this edition, or keep pictures inside the margins.' });
    }
  }

  // --- Fonts -----------------------------------------------------------
  const notEmbedded = report.fonts.filter((f) => !f.embedded);
  add(notEmbedded.length === 0
    ? { id: 'fonts-embedded', group: 'fonts', title: 'Fonts embedded', status: 'pass', detail: `All ${report.fonts.length} fonts are embedded in the file.` }
    : { id: 'fonts-embedded', group: 'fonts', title: 'Fonts embedded', status: 'fail', detail: `Not embedded: ${notEmbedded.map((f) => f.name).join(', ')}.`, fix: 'Use one of the bundled typefaces, or a font file that allows embedding.' });
  if (fileRules.minFontSizePt) {
    const small = report.pages.filter((p) => p.minFontPt !== null && p.minFontPt + 0.05 < fileRules.minFontSizePt!);
    const smallest = Math.min(...report.pages.map((p) => p.minFontPt ?? Infinity));
    add(small.length === 0
      ? { id: 'font-size', group: 'fonts', title: 'Smallest type', status: 'pass', detail: `The smallest type is ${Number.isFinite(smallest) ? smallest + ' pt' : 'not measurable'}; ${name} asks for at least ${fileRules.minFontSizePt} pt.` }
      : { id: 'font-size', group: 'fonts', title: 'Smallest type', status: 'warn', detail: `Type as small as ${smallest} pt appears on pages ${pageList(small.map((p) => p.number))}; ${name} asks for at least ${fileRules.minFontSizePt} pt.`, pages: first(small.map((p) => p.number)), fix: 'Increase the type size (footnotes and captions follow the body size).' });
  }

  // --- Pictures ----------------------------------------------------------
  const minDpi = fileRules.minImageDpi;
  const sourceOf = (w: number, h: number): string => {
    const hit = (input.images ?? []).find((i) => i.widthPx === w && i.heightPx === h);
    return hit ? ` (${hit.src})` : '';
  };
  const low = report.images.filter((i) => i.dpi + 1 < minDpi);
  if (report.images.length === 0) {
    add({ id: 'picture-dpi', group: 'pictures', title: 'Picture resolution', status: 'info', detail: 'The interior has no pictures.' });
  } else if (low.length === 0) {
    add({ id: 'picture-dpi', group: 'pictures', title: 'Picture resolution', status: 'pass', detail: `All ${report.images.length} pictures print at ${minDpi} dpi or more (lowest: ${Math.min(...report.images.map((i) => Math.round(i.dpi)))} dpi).` });
  } else {
    // Clearly too coarse to print well: fail. Slightly under: warn.
    const bad = low.filter((i) => i.dpi < minDpi * 0.67);
    add({
      id: 'picture-dpi', group: 'pictures', title: 'Picture resolution', status: bad.length ? 'fail' : 'warn',
      detail: low.map((i) => `Page ${i.page}: ${i.widthPx} x ${i.heightPx} pixels${sourceOf(i.widthPx, i.heightPx)} prints at ${Math.round(i.dpi)} dpi`).join('; ') + `. ${name} asks for ${minDpi} dpi.`,
      pages: first(low.map((i) => i.page)),
      fix: 'Use a larger original, or print the picture smaller.',
    });
  }
  if (report.images.length) {
    const colourful = report.images.filter((i) => !['gray', 'icc-gray', 'cal-gray'].includes(i.color));
    if (format.ink === 'bw') {
      add(colourful.length === 0
        ? { id: 'picture-colour', group: 'pictures', title: 'Pictures in a black and white book', status: 'pass', detail: 'All pictures are greyscale.' }
        : { id: 'picture-colour', group: 'pictures', title: 'Pictures in a black and white book', status: 'warn', detail: `Colour pictures on pages ${pageList(colourful.map((i) => i.page))} will be printed in grey by the press.`, pages: first(colourful.map((i) => i.page)), fix: 'Switch on "Convert pictures to greyscale" in the design settings to see the real result.' });
    }
    const profiled = report.images.filter((i) => i.color.startsWith('icc-') || i.color === 'rgb' || i.color === 'cal-rgb' || i.color === 'lab');
    if (!fileRules.iccProfilesAllowed || report.pdfx) {
      add(profiled.length === 0
        ? { id: 'picture-space', group: 'colour', title: 'Picture colour format', status: 'pass', detail: 'Pictures are plain greyscale or CMYK without attached colour profiles.' }
        : { id: 'picture-space', group: 'colour', title: 'Picture colour format', status: 'fail', detail: `Pictures on pages ${pageList(profiled.map((i) => i.page))} are RGB or carry a colour profile, which ${name} does not accept.`, pages: first(profiled.map((i) => i.page)), fix: 'Build the file as PDF/X-1a (the default for this platform).' });
    }
  }
  const softMasks = report.images.filter((i) => i.hasSoftMask).map((i) => i.page);
  const transparentPages = [...new Set([...report.pages.filter((p) => p.usesTransparency).map((p) => p.number), ...softMasks])];
  if (!fileRules.transparencyAllowed) {
    add(transparentPages.length === 0
      ? { id: 'transparency', group: 'colour', title: 'Transparency', status: 'pass', detail: 'The file contains no transparency.' }
      : { id: 'transparency', group: 'colour', title: 'Transparency', status: 'fail', detail: `Transparency is used on pages ${pageList(transparentPages)}.`, pages: first(transparentPages), fix: 'Save the picture without a transparent background.' });
  }

  // --- Colour of text and line work --------------------------------------
  const families = new Set(report.pages.flatMap((p) => p.colors));
  const offending: string[] = [...families].filter((f) => f !== 'cmyk' && f !== 'gray' && f !== 'pattern' && f !== 'unknown');
  const strict = Boolean(report.pdfx) || !fileRules.iccProfilesAllowed;
  if (offending.length === 0) {
    add({ id: 'text-colour', group: 'colour', title: 'Text colour', status: 'pass', detail: 'Text and line work use black or CMYK ink values only.' });
  } else {
    const pages = report.pages.filter((p) => p.colors.some((c) => offending.includes(c))).map((p) => p.number);
    add({ id: 'text-colour', group: 'colour', title: 'Text colour', status: strict ? 'fail' : 'warn', detail: `Text or line work on pages ${pageList(pages)} uses ${offending.join(', ')} colour.`, pages: first(pages), fix: 'This usually comes from an SVG drawing. Export the drawing as a PNG picture instead.' });
  }

  // --- File --------------------------------------------------------------
  const wantsX = fileRules.pdfStandards.length > 0;
  if (wantsX) {
    if (report.pdfx) {
      const intent = report.outputIntents[0];
      add({ id: 'pdf-standard', group: 'file', title: 'PDF standard', status: 'pass', detail: `The file is ${report.pdfx}${intent ? `, prepared for ${intent.condition}` : ''}. ${name} lists: ${fileRules.pdfStandards.join(', ')}.` });
    } else {
      add({ id: 'pdf-standard', group: 'file', title: 'PDF standard', status: fileRules.pdfStandardRequired ? 'fail' : 'info', detail: `The file is an ordinary PDF. ${name} prefers ${fileRules.pdfStandards.join(' or ')}${fileRules.pdfStandardRequired ? ' and refuses other files' : ' but accepts an ordinary PDF with embedded fonts'}.`, fix: 'Build with the PDF standard set to automatic.' });
    }
  }
  const mb = input.fileSizeBytes / (1024 * 1024);
  if (fileRules.maxFileMB) {
    add(mb <= fileRules.maxFileMB
      ? { id: 'file-size', group: 'file', title: 'File size', status: 'pass', detail: `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB (limit ${fileRules.maxFileMB} MB).` }
      : { id: 'file-size', group: 'file', title: 'File size', status: 'fail', detail: `The file is ${Math.round(mb)} MB; ${name} accepts up to ${fileRules.maxFileMB} MB.`, fix: 'Reduce very large pictures to 300 dpi at their printed size.' });
  }
  if (report.encrypted) add({ id: 'encrypted', group: 'file', title: 'Password protection', status: 'fail', detail: 'The file is password protected. Printers cannot process protected files.' });
  const annotations = report.pages.reduce((n, p) => n + p.annotations, 0);
  if (!fileRules.bookmarksAllowed) {
    add(annotations === 0 && !report.hasOutline
      ? { id: 'links', group: 'file', title: 'Links, comments and bookmarks', status: 'pass', detail: 'The file contains none.' }
      : { id: 'links', group: 'file', title: 'Links, comments and bookmarks', status: 'fail', detail: `The file contains ${annotations} link or comment annotations${report.hasOutline ? ' and bookmarks' : ''}, which ${name} asks to be removed.`, fix: 'Build the print file (not the reading copy).' });
  }
  for (const note of report.notes) add({ id: 'reader-note', group: 'file', title: 'File structure', status: 'warn', detail: note });

  // --- Book level ----------------------------------------------------------
  checks.push(...bookChecks(spec, book, format, input.isbnRegister ?? null));
  for (const w of input.buildWarnings ?? []) {
    if (w.severity === 'info') continue;
    add({ id: `build-${w.code}`, group: 'book', title: 'Reported while building', status: w.severity === 'fail' ? 'fail' : 'warn', detail: w.message, nodeId: w.nodeId });
  }

  const label = `${format.label || format.type} interior for ${name}`;
  return summarise(label.charAt(0).toUpperCase() + label.slice(1), 'interior', spec.platform, format.id, checks, input.now);
}

/** Checks that concern the book rather than the file: ISBN and language. */
export function bookChecks(spec: PlatformSpec, book: Book, format: BookFormat, register: IsbnRegister | null): Check[] {
  const out: Check[] = [];
  const name = spec.displayName;
  if (!format.isbn) {
    out.push({
      id: 'isbn', group: 'book', title: 'ISBN', status: 'warn',
      detail: `This edition has no ISBN yet. ${spec.platform === 'ingramspark' ? 'IngramSpark needs your own ISBN.' : spec.platform === 'kdp' ? (format.type === 'ebook' ? 'A Kindle ebook does not need one.' : 'KDP can assign a free ISBN, which can then only be used at KDP.') : 'Draft2Digital can assign a free one.'}`,
      fix: 'Assign an ISBN from your register in the ISBN manager.',
    });
  } else {
    const v = validateIsbn(format.isbn);
    out.push(v.valid
      ? { id: 'isbn', group: 'book', title: 'ISBN', status: 'pass', detail: `${v.isbn13} has a correct check digit.` }
      : { id: 'isbn', group: 'book', title: 'ISBN', status: 'fail', detail: `The ISBN "${format.isbn}" is not valid: ${v.problem}`, fix: 'Correct it in the edition settings.' });
  }
  const problems = checkBookIsbns(register ?? { schema: 1, prefixes: [], records: [] }, {
    id: book.id, title: book.title,
    formats: book.formats.map((f) => ({ id: f.id, label: f.label, isbn: f.isbn, enabled: f.enabled })),
  }).filter((p) => /same ISBN|belongs|assigned/i.test(p.message));
  for (const p of problems) out.push({ id: 'isbn-reuse', group: 'book', title: 'ISBN used twice', status: p.severity === 'fail' ? 'fail' : 'warn', detail: p.message, fix: 'Each format (ebook, paperback, hardcover) needs its own ISBN.' });
  const lang = languageProblem(spec, format.type, book.language);
  out.push(lang
    ? { id: 'language', group: 'book', title: 'Language', status: 'fail', detail: lang, fix: spec.languages?.consequence || `Publish this edition through a platform that accepts the language, or check ${name}'s current language list.` }
    : { id: 'language', group: 'book', title: 'Language', status: 'pass', detail: `${name} accepts books in this language (${book.language}).` });
  if (!book.title.trim()) out.push({ id: 'title', group: 'book', title: 'Title', status: 'fail', detail: 'The book has no title.' });
  if (!book.contributors.some((c) => c.name.trim())) out.push({ id: 'author', group: 'book', title: 'Author', status: 'fail', detail: 'The book has no author name.' });
  return out;
}

/* ------------------------------------------------------------------ */
/* Manuscript                                                          */
/* ------------------------------------------------------------------ */

export interface ManuscriptDoc {
  nodeId: string;
  title: string;
  text: string;
}

/** Editorial loose ends that should be settled before any file is uploaded. */
export function manuscriptChecks(docs: ManuscriptDoc[], book: Book): Check[] {
  const out: Check[] = [];
  let changes = 0;
  let comments = 0;
  let firstChangeDoc: ManuscriptDoc | undefined;
  const placeholders: { doc: ManuscriptDoc; word: string }[] = [];
  let dashes = 0;
  let firstDashDoc: ManuscriptDoc | undefined;
  for (const doc of docs) {
    const c = countCritic(doc.text);
    if ((c.changes || c.comments) && !firstChangeDoc) firstChangeDoc = doc;
    changes += c.changes;
    comments += c.comments;
    const masked = maskMarkdown(doc.text, { hideDeletions: true });
    const m = /\b(TK|TKTK|TODO|FIXME|XXX)\b|lorem ipsum|\[citation needed\]/.exec(masked);
    if (m) placeholders.push({ doc, word: m[0] });
    if (book.style.dashPolicy.mode !== 'allow') {
      const found = findDashes(doc.text, book.style.dashPolicy.includeTypedHyphens).length;
      if (found && !firstDashDoc) firstDashDoc = doc;
      dashes += found;
    }
  }
  out.push(changes + comments === 0
    ? { id: 'tracked-changes', group: 'text', title: 'Tracked changes and comments', status: 'pass', detail: 'None left open.' }
    : { id: 'tracked-changes', group: 'text', title: 'Tracked changes and comments', status: 'warn', detail: `${changes} tracked change${changes === 1 ? '' : 's'} and ${comments} comment${comments === 1 ? '' : 's'} are still open. Exports use the text as it was before the open changes unless you choose otherwise.`, nodeId: firstChangeDoc?.nodeId, fix: 'Accept or reject them in the Review panel.' });
  if (placeholders.length) {
    out.push({ id: 'placeholders', group: 'text', title: 'Placeholders', status: 'warn', detail: `Placeholder text such as "${placeholders[0].word}" was found in ${placeholders.length === 1 ? `"${placeholders[0].doc.title}"` : `${placeholders.length} documents, first in "${placeholders[0].doc.title}"`}.`, nodeId: placeholders[0].doc.nodeId, fix: 'Search for it and replace it with the final text.' });
  }
  if (book.style.dashPolicy.mode !== 'allow') {
    out.push(dashes === 0
      ? { id: 'dashes', group: 'text', title: 'Dash policy', status: 'pass', detail: 'No long dashes in the manuscript, as your style rules ask.' }
      : { id: 'dashes', group: 'text', title: 'Dash policy', status: book.style.dashPolicy.mode === 'replace' ? 'info' : 'warn', detail: book.style.dashPolicy.mode === 'replace' ? `${dashes} long dash${dashes === 1 ? '' : 'es'} in the manuscript will be replaced on export, following your style rules.` : `${dashes} long dash${dashes === 1 ? '' : 'es'} found; your style rules flag them.`, nodeId: firstDashDoc?.nodeId, fix: 'Use "Find dashes" in the Review panel to rewrite or replace them.' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ebook                                                               */
/* ------------------------------------------------------------------ */

export interface EpubPreflightInput {
  spec: PlatformSpec;
  book: Book;
  format: BookFormat;
  check: EpubCheckResult;
  fileSizeBytes: number;
  cover?: { info: ImageInfo; sizeBytes: number } | null;
  buildWarnings?: BuildWarning[];
  isbnRegister?: IsbnRegister | null;
  now?: Date;
}

export function preflightEpub(input: EpubPreflightInput): PreflightReport {
  const { spec, book, format, check } = input;
  const rules = spec.ebook;
  const name = spec.displayName;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  if (!rules) {
    add({ id: 'no-ebook', group: 'ebook', title: 'Ebooks', status: 'fail', detail: `The ${name} spec file has no ebook section.` });
    return summarise(`Ebook for ${name}`, 'ebook', spec.platform, format.id, checks, input.now);
  }
  if (!check.ran) {
    add({ id: 'epubcheck', group: 'ebook', title: 'EPUBCheck', status: rules.epubCheckRequired ? 'fail' : 'warn', detail: check.problem ?? 'EPUBCheck could not be run.', fix: 'See Settings, Tools: EPUBCheck needs Java.' });
  } else if (check.passed) {
    add({ id: 'epubcheck', group: 'ebook', title: 'EPUBCheck', status: check.warnings ? 'warn' : 'pass', detail: `${check.checker || 'EPUBCheck'}: no errors${check.warnings ? `, ${check.warnings} warning${check.warnings === 1 ? '' : 's'}` : ' and no warnings'}.` });
  } else {
    add({ id: 'epubcheck', group: 'ebook', title: 'EPUBCheck', status: 'fail', detail: `${check.errors} error${check.errors === 1 ? '' : 's'} found. ${name} ${rules.epubCheckRequired ? 'refuses' : 'may refuse'} files that do not pass.`, fix: 'Open the list of issues below; each one links to the place in the manuscript.' });
  }
  if (!rules.acceptedFormats.includes('epub')) {
    add({ id: 'format', group: 'ebook', title: 'File type', status: 'fail', detail: `${name} does not list EPUB among its accepted files (${rules.acceptedFormats.join(', ')}).` });
  }
  const mb = input.fileSizeBytes / (1024 * 1024);
  if (rules.maxFileMB) {
    add(mb <= rules.maxFileMB
      ? { id: 'file-size', group: 'file', title: 'File size', status: 'pass', detail: `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB (limit ${rules.maxFileMB} MB).` }
      : { id: 'file-size', group: 'file', title: 'File size', status: 'fail', detail: `The EPUB is ${Math.round(mb)} MB; ${name} accepts up to ${rules.maxFileMB} MB.`, fix: 'Reduce the size of the pictures.' });
  }
  const cover = input.cover;
  const c = rules.cover;
  if (!cover) {
    add({ id: 'cover', group: 'cover', title: 'Cover picture', status: 'warn', detail: `No ebook cover was found. ${name} asks for a separate cover of ${c.idealWidthPx} x ${c.idealHeightPx} pixels.`, fix: 'Create it in the Cover builder.' });
  } else {
    const { width, height, format: type, color } = cover.info;
    const problems: string[] = [];
    let status: CheckStatus = 'pass';
    if (c.minWidthPx && c.minHeightPx && (width < c.minWidthPx || height < c.minHeightPx)) {
      problems.push(`it is smaller than the minimum of ${c.minWidthPx} x ${c.minHeightPx} pixels`);
      status = 'fail';
    }
    if (c.maxSidePx && Math.max(width, height) > c.maxSidePx) {
      problems.push(`its longest side exceeds ${c.maxSidePx} pixels`);
      status = 'fail';
    }
    const ext = type === 'jpeg' ? 'jpg' : type;
    if (!c.formats.includes(ext)) {
      problems.push(`it is a ${ext.toUpperCase()} file; accepted: ${c.formats.join(', ').toUpperCase()}`);
      status = 'fail';
    }
    if (color === 'cmyk') {
      problems.push('it is a CMYK picture; ebook covers must be RGB');
      status = 'fail';
    }
    if (c.maxFileMB && cover.sizeBytes / (1024 * 1024) > c.maxFileMB) {
      problems.push(`it is larger than ${c.maxFileMB} MB`);
      status = 'fail';
    }
    const wantRatio = c.idealHeightPx / c.idealWidthPx;
    if (status === 'pass' && (Math.abs(height / width - wantRatio) > 0.02 || width < c.idealWidthPx)) {
      problems.push(`the recommended size is ${c.idealWidthPx} x ${c.idealHeightPx} pixels`);
      status = 'warn';
    }
    add({ id: 'cover', group: 'cover', title: 'Cover picture', status, detail: problems.length ? `The cover is ${width} x ${height} pixels: ${problems.join('; ')}.` : `${width} x ${height} pixels, as ${name} recommends.`, fix: problems.length ? 'Export the ebook cover again from the Cover builder.' : undefined });
  }
  checks.push(...bookChecks(spec, book, format, input.isbnRegister ?? null));
  for (const w of input.buildWarnings ?? []) {
    if (w.severity === 'info' || w.code === 'no-cover' || w.code === 'epubcheck-missing') continue;
    add({ id: `build-${w.code}`, group: 'book', title: 'Reported while building', status: w.severity === 'fail' ? 'fail' : 'warn', detail: w.message, nodeId: w.nodeId });
  }
  return summarise(`Ebook for ${name}`, 'ebook', spec.platform, format.id, checks, input.now);
}

/* ------------------------------------------------------------------ */
/* Text report                                                         */
/* ------------------------------------------------------------------ */

const STATUS_WORD: Record<CheckStatus, string> = { pass: 'OK  ', info: 'NOTE', warn: 'WARN', fail: 'FAIL' };

/** The report as plain text, for the exports folder and the command line. */
export function formatPreflight(report: PreflightReport): string {
  const lines: string[] = [];
  lines.push(`Preflight: ${report.target}`);
  lines.push(`Checked ${report.createdAt.slice(0, 16).replace('T', ' ')} UTC`);
  lines.push(report.ready
    ? (report.counts.warn ? `Ready to upload, with ${report.counts.warn} thing${report.counts.warn === 1 ? '' : 's'} to look at.` : 'Ready to upload.')
    : `Not ready: ${report.counts.fail} problem${report.counts.fail === 1 ? '' : 's'} to fix.`);
  lines.push('');
  for (const c of report.checks) {
    lines.push(`[${STATUS_WORD[c.status]}] ${c.title}: ${c.detail}`);
    if (c.fix && (c.status === 'fail' || c.status === 'warn')) lines.push(`       What to do: ${c.fix}`);
  }
  return lines.join('\n') + '\n';
}
