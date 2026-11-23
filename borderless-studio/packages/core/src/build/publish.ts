/**
 * Publishing side of a book: prices, the retail listing, listing sheets,
 * ONIX and the publishing checklist. These functions join the pure
 * calculators (pricing/, metadata/) to the files of a book project.
 */
import { z } from 'zod';
import type { Host } from '../host';
import { getFormat, type PlatformId } from '../model/book';
import { displayIsbn } from '../isbn';
import { buildOnix, type OnixEdition } from '../metadata/onix';
import { ListingSchema, type Listing } from '../metadata/listing';
import { listingSheet, sheetText, type ListingSheet } from '../metadata/sheet';
import { PricingSettingsSchema, type PricingSettings } from '../pricing/model';
import { buildReachPlan, type ReachPlan } from '../pricing/reach';
import { LAYOUT } from '../project/layout';
import type { Project } from '../project/store';
import { findTrim } from '../specs';
import { MetaSchema } from '../specs/schema';
import { joinPath, slugify } from '../util/paths';
import { barcodePlan } from '../cover/build';
import { coverGeometry } from '../cover/geometry';
import { exportBaseName, lastPageCount, loadCoverDesign, type BuildContext } from './pipeline';

/* ------------------------------------------------------------------ */
/* Pricing and listing files                                           */
/* ------------------------------------------------------------------ */

/** Pricing choices of the book; `defaults` fills in a first time file (for example the publisher's usual IngramSpark discount). */
export async function loadPricing(project: Project, defaults: Partial<PricingSettings> = {}): Promise<PricingSettings> {
  const raw = await project.readData<Record<string, unknown> | null>(LAYOUT.pricing, null);
  return PricingSettingsSchema.parse(raw ?? defaults);
}

export async function savePricing(project: Project, settings: PricingSettings): Promise<void> {
  await project.writeData(LAYOUT.pricing, PricingSettingsSchema.parse(settings));
}

export async function loadListing(project: Project): Promise<Listing> {
  return ListingSchema.parse(await project.readData<unknown>(LAYOUT.listing, {}));
}

export async function saveListing(project: Project, listing: Listing): Promise<void> {
  await project.writeData(LAYOUT.listing, ListingSchema.parse(listing));
}

/** Page counts of the latest interior builds, by edition and platform. */
export async function knownPageCounts(ctx: BuildContext): Promise<Record<string, Partial<Record<PlatformId, number>>>> {
  const out: Record<string, Partial<Record<PlatformId, number>>> = {};
  for (const f of ctx.project.book.formats) {
    if (f.type === 'ebook') continue;
    for (const p of f.platforms) {
      const pages = await lastPageCount(ctx, f.id, p);
      if (pages) (out[f.id] ??= {})[p] = pages;
    }
  }
  return out;
}

/** Size of the latest EPUB export in megabytes, or null when none was built. */
export async function ebookSizeMB(ctx: BuildContext): Promise<number | null> {
  const ebook = ctx.project.book.formats.find((f) => f.type === 'ebook');
  if (!ebook) return null;
  const stat = await ctx.host.stat(ctx.project.path(LAYOUT.exportsDir, `${exportBaseName(ctx, { formatId: ebook.id })}.epub`));
  return stat?.isFile ? Math.max(0.01, stat.size / (1024 * 1024)) : null;
}

/** The Reach First price plan for the open book. */
export async function reachPlan(ctx: BuildContext, settings: PricingSettings): Promise<ReachPlan & { pages: Record<string, Partial<Record<PlatformId, number>>>; ebookFileSizeMB: number | null }> {
  const pages = await knownPageCounts(ctx);
  const size = await ebookSizeMB(ctx);
  const plan = buildReachPlan({ book: ctx.project.book, specs: ctx.specs, settings, pages, ebookFileSizeMB: size });
  return { ...plan, pages, ebookFileSizeMB: size };
}

/* ------------------------------------------------------------------ */
/* Listing sheets and ONIX                                             */
/* ------------------------------------------------------------------ */

/** The listing sheet of one edition on one platform, with prices and file names filled in. */
export async function sheetFor(ctx: BuildContext, formatId: string, platform: PlatformId, listing: Listing, plan: ReachPlan, settings: PricingSettings): Promise<ListingSheet> {
  const book = ctx.project.book;
  const format = getFormat(book, formatId);
  const spec = ctx.specs.platforms[platform];
  if (!spec) throw new Error(`There is no spec file for ${platform}.`);
  const base = exportBaseName(ctx, { formatId }, platform);
  const exists = async (rel: string) => ((await ctx.host.exists(ctx.project.path(rel))) ? rel : '');
  const pages = format.type === 'ebook' ? null : await lastPageCount(ctx, formatId, platform);
  let coverHasBarcode = false;
  if (format.type !== 'ebook' && pages && spec.print) {
    const g = coverGeometry(spec, format, pages, { templateSpineIn: format.platformOptions[platform]?.spineWidthIn ?? null }).geometry;
    if (g) coverHasBarcode = barcodePlan(await loadCoverDesign(ctx.project), g, format).mode === 'own';
  }
  const title = slugify(book.title, 40);
  return listingSheet({
    book, format, listing, spec, pages, coverHasBarcode,
    prices: plan.rows.filter((r) => r.formatId === formatId && r.platform === platform),
    isbnDisplay: format.isbn ? displayIsbn(ctx.isbnRegister ?? null, format.isbn) : undefined,
    ingramDiscountPercent: settings.ingramDiscountPercent,
    files: {
      interior: await exists(`${LAYOUT.exportsDir}/${base}_interior.pdf`),
      cover: (await exists(`${LAYOUT.exportsDir}/${base}_cover.pdf`)) || (await exists(`${LAYOUT.exportsDir}/${base}_case-cover.pdf`)),
      ebook: await exists(`${LAYOUT.exportsDir}/${exportBaseName(ctx, { formatId })}.epub`),
      ebookCover: await exists(`${LAYOUT.exportsDir}/${title}_ebook-cover_${platform}.jpg`),
    },
  });
}

/** Write a listing sheet for every edition and platform, and one ONIX file, to the exports folder. */
export async function exportListingFiles(ctx: BuildContext, listing: Listing, settings: PricingSettings): Promise<{ files: string[]; onixPath: string }> {
  const book = ctx.project.book;
  const plan = await reachPlan(ctx, settings);
  const files: string[] = [];
  await ctx.host.mkdirp(ctx.project.path(LAYOUT.exportsDir));
  for (const f of book.formats) {
    if (!f.enabled) continue;
    for (const p of f.platforms) {
      if (!ctx.specs.platforms[p]) continue;
      const sheet = await sheetFor(ctx, f.id, p, listing, plan, settings);
      const file = ctx.project.path(LAYOUT.exportsDir, `${exportBaseName(ctx, { formatId: f.id }, p)}_listing.txt`);
      await ctx.host.writeText(file, sheetText(sheet, book));
      files.push(file);
    }
  }
  // ONIX: one record for each edition, with the trim size and the prices of its first platform.
  const editions: OnixEdition[] = [];
  for (const f of book.formats) {
    if (!f.enabled) continue;
    const platform = f.platforms.find((p) => ctx.specs.platforms[p]);
    const spec = platform ? ctx.specs.platforms[platform] : null;
    const trim = f.type !== 'ebook' && spec ? findTrim(spec, f.type, f.trim) : null;
    const rows = plan.rows.filter((r) => r.formatId === f.id && r.platform === platform && r.price !== null);
    editions.push({
      format: f,
      pages: platform && f.type !== 'ebook' ? plan.pages[f.id]?.[platform] ?? null : null,
      trim: trim ? { widthIn: trim.widthIn, heightIn: trim.heightIn } : null,
      prices: rows.map((r) => ({ marketId: r.marketId, currency: r.currency, amount: r.price!, includesTax: /includes/.test(r.taxNote) })),
    });
  }
  const onixPath = ctx.project.path(LAYOUT.exportsDir, `${slugify(book.title, 40)}_onix.xml`);
  await ctx.host.writeText(onixPath, buildOnix({ book, listing, editions }));
  files.push(onixPath);
  return { files, onixPath };
}

/* ------------------------------------------------------------------ */
/* Publishing checklist                                                */
/* ------------------------------------------------------------------ */

export const ChecklistItemSchema = z.object({
  id: z.string(),
  /** isbn, legal-deposit, general, kdp, ingramspark, draft2digital */
  group: z.string(),
  /** Formats the step applies to. */
  formats: z.array(z.string()).default(['paperback', 'hardcover', 'ebook']),
  title: z.string(),
  detail: z.string().default(''),
  url: z.string().optional(),
  _meta: MetaSchema.optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistFileSchema = z.object({
  schemaVersion: z.literal(1),
  lastVerified: z.string(),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })).default([]),
  items: z.array(ChecklistItemSchema),
});
export type ChecklistFile = z.infer<typeof ChecklistFileSchema>;

/** The publishing checklist: the user's edited copy in the library when there is one, otherwise the bundled file. */
export async function loadChecklist(host: Host, bundledSpecsDir: string, userSpecsDir?: string): Promise<ChecklistFile | null> {
  for (const dir of [userSpecsDir, bundledSpecsDir]) {
    if (!dir) continue;
    const file = joinPath(dir, 'publishing-checklist.json');
    if (!(await host.exists(file))) continue;
    try {
      return ChecklistFileSchema.parse(JSON.parse(await host.readText(file)));
    } catch {
      // A broken user copy falls back to the bundled file.
    }
  }
  return null;
}

export const ChecklistStateSchema = z.object({
  schema: z.literal(1).default(1),
  /** When each step was ticked off: "itemId" or "itemId/editionId" to an ISO date. */
  done: z.record(z.string()).default({}),
  notes: z.record(z.string()).default({}),
});
export type ChecklistState = z.infer<typeof ChecklistStateSchema>;

export async function loadChecklistState(project: Project): Promise<ChecklistState> {
  return ChecklistStateSchema.parse(await project.readData<unknown>(LAYOUT.checklist, {}));
}

export async function saveChecklistState(project: Project, state: ChecklistState): Promise<void> {
  await project.writeData(LAYOUT.checklist, ChecklistStateSchema.parse(state));
}

/** The steps that apply to this book: those for its formats and for the platforms it uses. */
export function checklistFor(file: ChecklistFile, book: { formats: { type: string; enabled: boolean; platforms: string[] }[] }): ChecklistItem[] {
  const formats = new Set(book.formats.filter((f) => f.enabled).map((f) => f.type));
  const platformGroups = new Set(['kdp', 'ingramspark', 'draft2digital']);
  return file.items.filter((item) => {
    if (!item.formats.some((t) => formats.has(t))) return false;
    if (platformGroups.has(item.group)) {
      // A platform step applies when an edition of a matching format goes to that platform.
      return book.formats.some((f) => f.enabled && f.platforms.includes(item.group) && item.formats.includes(f.type));
    }
    return true;
  });
}
