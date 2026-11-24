/** Pricing choices of a book, stored as metadata/pricing.json in the book folder. */
import { z } from 'zod';

export const PRICE_ENDINGS = ['exact', '.99', '.95', '.49-.99', '.00'] as const;

export const PricingSettingsSchema = z.object({
  schema: z.literal(1).default(1),
  /**
   * Amount to earn on every copy. 0 means "reach first":
   * the lowest price each platform accepts.
   */
  marginPerCopy: z.number().nonnegative().default(0),
  marginCurrency: z.string().length(3).default('AUD'),
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
export type PricingSettings = z.infer<typeof PricingSettingsSchema>;

export const defaultPricingSettings = (): PricingSettings => PricingSettingsSchema.parse({});
