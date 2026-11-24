/** Pricing choices of a book, stored as metadata/pricing.json in the book folder. */
import { z } from 'zod';

export const PRICE_ENDINGS = ['exact', '.99', '.95', '.49-.99', '.00'] as const;

export const PricingSettingsObject = z.object({
  schema: z.literal(1).default(1),
  /**
   * What the publisher keeps from every copy, on top of the lowest price.
   * 0 means the publisher earns nothing.
   */
  publisherMargin: z.number().nonnegative().default(0),
  /**
   * What the author receives from every copy, on top of the lowest price.
   * 0 means the author earns nothing. When both are 0 every price is the
   * lowest the platform accepts ("reach first").
   */
  authorMargin: z.number().nonnegative().default(0),
  marginCurrency: z.string().length(3).default('AUD'),
  /** Give the ebook away free in the stores that allow a free price; the others get their lowest price. */
  freeEbook: z.boolean().default(false),
  /** How suggested prices are rounded up. */
  ending: z.enum(PRICE_ENDINGS).default('.99'),
  /** Wholesale discount set at IngramSpark, in percent. */
  ingramDiscountPercent: z.number().min(0).max(80).default(30),
  /** The ebook is enrolled in KDP Select (exclusive to Amazon). */
  kdpSelect: z.boolean().default(false),
  /** Size of the ebook file in megabytes, used for KDP price limits and delivery cost. Empty: taken from the last export. */
  ebookFileSizeMB: z.number().positive().nullable().default(null),
  /** Page counts to use while no interior has been built, by edition id. */
  pagesEstimate: z.record(z.number().int().positive()).default({}),
  /** Prices fixed by hand, by "edition/platform/marketplace". */
  overrides: z.record(z.number().nonnegative()).default({}),
  /** Marketplaces to leave out of the table, by "platform/marketplace". */
  hidden: z.array(z.string()).default([]),
});

/**
 * Older files had one "marginPerCopy" for the publisher to share with the
 * author. It becomes an even split between the two (the shared model of the
 * author agreement), and a book that was priced at zero keeps its free ebook.
 */
function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !('marginPerCopy' in raw)) return raw;
  const { marginPerCopy, ...rest } = raw as Record<string, unknown>;
  const m = typeof marginPerCopy === 'number' && marginPerCopy > 0 ? marginPerCopy : 0;
  return {
    publisherMargin: Math.round((m / 2) * 100) / 100,
    authorMargin: Math.round((m - Math.round((m / 2) * 100) / 100) * 100) / 100,
    freeEbook: m === 0,
    ...rest,
  };
}

export const PricingSettingsSchema = z.preprocess(migrate, PricingSettingsObject);
export type PricingSettings = z.infer<typeof PricingSettingsObject>;

/** Everything added to the lowest price per copy: the publisher's and the author's margins together. */
export const totalMargin = (s: Pick<PricingSettings, 'publisherMargin' | 'authorMargin'>): number => s.publisherMargin + s.authorMargin;

/**
 * The author's part of what a copy earns. The earnings are split in the
 * proportion of the two margins; when neither takes a margin, whatever a
 * copy still earns goes to the author.
 */
export function authorShareOf(s: Pick<PricingSettings, 'publisherMargin' | 'authorMargin'>): number {
  const total = totalMargin(s);
  return total > 0 ? s.authorMargin / total : 1;
}

/** Ready-made amounts offered for each margin, in the margin currency. */
export const MARGIN_PRESETS = [0, 0.5, 1, 2, 3, 5] as const;

export const defaultPricingSettings = (): PricingSettings => PricingSettingsSchema.parse({});
