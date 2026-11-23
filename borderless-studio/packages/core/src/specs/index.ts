/**
 * Loading the platform spec files and answering questions from them:
 * which trim sizes exist, what the margins must be, how wide the spine is.
 *
 * Lookup order for each file: the user's own copy (in the library's specs
 * folder, editable in the Spec updater screen), then the copy bundled with
 * the app. A user file that fails validation is reported and the bundled
 * copy is used instead, so a typo can never stop exports from working.
 */
import type { Host } from '../host';
import type { InteriorRules } from '../calc/geometry';
import { roundIn } from '../calc/units';
import type { BookFormat, PlatformId } from '../model/book';
import { PLATFORM_IDS } from '../model/book';
import { joinPath } from '../util/paths';
import {
  CurrencyTableSchema, PlatformSpecSchema, TaxTableSchema,
  type CurrencyTable, type InkPaper, type PlatformSpec, type PrintFormatSpec, type TaxTable, type TrimSizeSpec,
} from './schema';

export * from './schema';

export interface SpecProblem {
  file: string;
  message: string;
}

export interface SpecSet {
  platforms: Partial<Record<PlatformId, PlatformSpec>>;
  currencies: CurrencyTable | null;
  tax: TaxTable | null;
  /** Where each file was loaded from. */
  origin: Record<string, 'user' | 'bundled'>;
  problems: SpecProblem[];
}

type Parser<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } };

/** Validate the text of a spec file. Returns the parsed value or readable problems. */
export function parseSpecText<T>(text: string, schema: Parser<T>): { value?: T; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const res = schema.safeParse(raw);
  if (res.success) return { value: res.data, errors: [] };
  return { errors: res.error.issues.slice(0, 25).map((i) => `${i.path.join('.') || '(top level)'}: ${i.message}`) };
}

export const parsePlatformSpec = (text: string) => parseSpecText(text, PlatformSpecSchema as unknown as Parser<PlatformSpec>);
export const parseCurrencyTable = (text: string) => parseSpecText(text, CurrencyTableSchema as unknown as Parser<CurrencyTable>);
export const parseTaxTable = (text: string) => parseSpecText(text, TaxTableSchema as unknown as Parser<TaxTable>);

/** Folder with the specs shipped inside the app, next to the resources folder. */
export function bundledSpecsDir(resourcesDir: string): string {
  return joinPath(resourcesDir, '..', 'specs');
}

export async function loadSpecs(host: Host, bundledDir: string, userDir?: string): Promise<SpecSet> {
  const set: SpecSet = { platforms: {}, currencies: null, tax: null, origin: {}, problems: [] };
  const load = async <T>(file: string, schema: Parser<T>): Promise<T | null> => {
    for (const [dir, origin] of [[userDir, 'user'], [bundledDir, 'bundled']] as const) {
      if (!dir) continue;
      const p = joinPath(dir, file);
      if (!(await host.exists(p))) continue;
      const parsed = parseSpecText(await host.readText(p), schema);
      if (parsed.value !== undefined) {
        set.origin[file] = origin;
        return parsed.value;
      }
      set.problems.push({
        file: p,
        message: `${origin === 'user' ? 'Your edited copy' : 'The bundled copy'} of ${file} has errors and was not used: ${parsed.errors.slice(0, 3).join('; ')}`,
      });
    }
    return null;
  };
  for (const id of PLATFORM_IDS) {
    const spec = await load(`${id}.json`, PlatformSpecSchema as unknown as Parser<PlatformSpec>);
    if (spec) set.platforms[id] = spec;
  }
  set.currencies = await load('currencies.json', CurrencyTableSchema as unknown as Parser<CurrencyTable>);
  set.tax = await load('tax.json', TaxTableSchema as unknown as Parser<TaxTable>);
  return set;
}

/* ------------------------------------------------------------------ */
/* Age of a spec                                                       */
/* ------------------------------------------------------------------ */

export const STALE_AFTER_MONTHS = 6;

/** Whole months between the "last verified" date and today. */
export function monthsSince(dateIso: string, today: Date = new Date()): number {
  const d = new Date(dateIso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return Infinity;
  let months = (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth());
  if (today.getDate() < d.getDate()) months -= 1;
  return Math.max(0, months);
}

export function isStale(spec: { lastVerified: string }, today: Date = new Date()): boolean {
  return monthsSince(spec.lastVerified, today) >= STALE_AFTER_MONTHS;
}

/** Sections of a spec that are not confirmed against an official source, for the Spec updater screen. */
export function unverifiedSections(spec: PlatformSpec): { path: string; note?: string }[] {
  const out: { path: string; note?: string }[] = [];
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      o.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    const rec = o as Record<string, unknown>;
    const m = rec._meta as { verified?: boolean; note?: string } | undefined;
    if (m && m.verified === false) out.push({ path, note: m.note });
    for (const [k, v] of Object.entries(rec)) if (k !== '_meta') walk(v, path ? `${path}.${k}` : k);
  };
  walk(spec, '');
  return out;
}

/* ------------------------------------------------------------------ */
/* Print lookups                                                       */
/* ------------------------------------------------------------------ */

export type PrintFormatType = 'paperback' | 'hardcover';

export function printFormat(spec: PlatformSpec, type: PrintFormatType): PrintFormatSpec | null {
  return spec.print?.formats[type] ?? null;
}

export function findTrim(spec: PlatformSpec, type: PrintFormatType, trimId: string): TrimSizeSpec | null {
  return printFormat(spec, type)?.trimSizes.find((t) => t.id === trimId) ?? null;
}

/** "5.5x8.5" from numbers, the id convention used in the spec files. */
export function trimId(widthIn: number, heightIn: number): string {
  const n = (v: number) => String(Number(v.toFixed(3)));
  return `${n(widthIn)}x${n(heightIn)}`;
}

/** The platform's ink and paper option matching a format's generic choice. */
export function inkPaperFor(spec: PlatformSpec, format: Pick<BookFormat, 'ink' | 'paper' | 'type'>): InkPaper | null {
  const options = spec.print?.inkPaper ?? [];
  const type = format.type === 'hardcover' ? 'hardcover' : 'paperback';
  const usable = options.filter((o) => o.formats.includes(type));
  // Colour interiors are printed on white paper on every platform.
  const paper = format.ink === 'bw' ? format.paper : 'white';
  return usable.find((o) => o.ink === format.ink && o.paper === paper) ?? usable.find((o) => o.ink === format.ink) ?? null;
}

export interface TrimAvailability {
  trim: TrimSizeSpec | null;
  option: InkPaper | null;
  pages: { min: number; max: number } | null;
  /** Plain English reason when the combination is not offered. */
  problem?: string;
}

/** Is this trim size, ink and paper combination offered, and with what page limits? */
export function trimAvailability(spec: PlatformSpec, format: Pick<BookFormat, 'ink' | 'paper' | 'type' | 'trim'>): TrimAvailability {
  if (format.type === 'ebook') return { trim: null, option: null, pages: null };
  const pf = printFormat(spec, format.type);
  if (!pf) return { trim: null, option: null, pages: null, problem: `${spec.displayName} does not offer ${format.type} books.` };
  const trim = pf.trimSizes.find((t) => t.id === format.trim) ?? null;
  if (!trim) {
    return { trim: null, option: null, pages: null, problem: `${spec.displayName} does not list the trim size ${format.trim.replace('x', ' x ')} in for ${format.type}.` };
  }
  const option = inkPaperFor(spec, format);
  if (!option) return { trim, option: null, pages: null, problem: `${spec.displayName} has no ${format.ink} interior on ${format.paper} paper for ${format.type}.` };
  const pages = trim.pages[option.id] ?? null;
  if (!pages) {
    return { trim, option, pages: null, problem: `${spec.displayName} does not offer "${option.label}" at ${trim.widthIn} x ${trim.heightIn} in.` };
  }
  return { trim, option, pages };
}

/** The interior rules of one platform for a print format, in the neutral form the page builder uses. */
export function interiorRules(spec: PlatformSpec, type: PrintFormatType): InteriorRules {
  const print = spec.print;
  if (!print) throw new Error(`${spec.displayName} has no print rules in its spec file.`);
  const pf = print.formats[type];
  const limits = pf ? pf.trimSizes.flatMap((t) => Object.values(t.pages)) : [];
  return {
    platform: spec.platform,
    platformName: spec.displayName,
    gutterBands: print.margins.gutter.map((g) => ({ minPages: g.minPages, maxPages: g.maxPages, insideIn: g.insideIn })),
    outsideMinNoBleedIn: print.margins.outsideMinNoBleedIn,
    outsideMinWithBleedIn: print.margins.outsideMinWithBleedIn,
    bleedIn: print.bleed.amountIn,
    minPages: limits.length ? Math.min(...limits.map((l) => l.min)) : 1,
    maxPages: limits.length ? Math.max(...limits.map((l) => l.max)) : 100000,
    pageMultiple: print.pageCount.multiple,
    lastPageBlank: print.pageCount.lastPageBlank,
  };
}

export interface SpineResult {
  /** Spine width in inches, or null when the platform's template value has not been entered. */
  widthIn: number | null;
  mode: 'formula' | 'template';
  /** How the number was obtained, for display ("212 pages x 0.0025 in"). */
  basis: string;
  textAllowed: boolean;
  minPagesForText: number | null;
  textMarginIn: number | null;
  /** Width left for spine text after the safety margins. */
  textWidthIn: number | null;
  problem?: string;
}

/**
 * Spine width. For formula platforms: pages x thickness per page (+ boards).
 * For template platforms the width must come from the platform's template
 * generator; `templateWidthIn` is what the user typed in, and without it the
 * result carries a problem instead of a guess.
 */
export function spineWidth(
  spec: PlatformSpec,
  format: Pick<BookFormat, 'ink' | 'paper' | 'type'>,
  pages: number,
  templateWidthIn?: number | null,
): SpineResult {
  if (format.type === 'ebook') throw new Error('An ebook has no spine.');
  const pf = printFormat(spec, format.type);
  if (!pf) {
    return { widthIn: null, mode: 'formula', basis: '', textAllowed: false, minPagesForText: null, textMarginIn: null, textWidthIn: null, problem: `${spec.displayName} does not offer ${format.type} books.` };
  }
  const s = pf.spine;
  const textMin = s.minPagesForText;
  const finish = (widthIn: number | null, basis: string, problem?: string): SpineResult => {
    const textAllowed = widthIn !== null && (textMin === null || pages >= textMin);
    const textWidthIn = widthIn !== null && s.textMarginIn !== null ? Math.max(0, roundIn(widthIn - 2 * s.textMarginIn, 4)) : null;
    return { widthIn, mode: s.mode, basis, textAllowed, minPagesForText: textMin, textMarginIn: s.textMarginIn, textWidthIn, problem };
  };
  if (s.mode === 'template') {
    if (templateWidthIn && templateWidthIn > 0) return finish(roundIn(templateWidthIn, 4), `from the ${spec.displayName} cover template`);
    return finish(null, '', `${spec.displayName} does not publish a spine formula. Generate a cover template on their site for ${pages} pages and enter the spine width it gives.`);
  }
  const option = inkPaperFor(spec, format);
  const perPage = option ? s.perPageIn[option.id] : undefined;
  if (!option || perPage === undefined) {
    return finish(null, '', `The ${spec.displayName} spec file has no paper thickness for this ink and paper choice.`);
  }
  const width = roundIn(pages * perPage + s.baseIn, 4);
  const basis = s.baseIn ? `${pages} pages x ${perPage} in + ${s.baseIn} in` : `${pages} pages x ${perPage} in`;
  return finish(width, basis);
}
