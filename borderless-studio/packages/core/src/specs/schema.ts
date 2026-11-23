/**
 * The format of the platform spec files (specs/kdp.json and friends).
 *
 * Every rule the app applies for Amazon KDP, IngramSpark or Draft2Digital is
 * read from these files: trim sizes, page limits, margins, bleed, spine
 * formulas, cover geometry, file rules, printing costs, royalty rates, price
 * limits, supported languages and listing limits. Nothing is hard coded.
 *
 * Each section carries a `_meta` block saying whether the values were checked
 * against the platform's own pages, which sources they came from, and any
 * caveat. The Spec updater screen shows these and warns when a file has not
 * been verified for six months.
 *
 * Units: inches for print dimensions, megabytes for file sizes, fractions for
 * rates (0.6 means 60%), percent for tax (10 means 10%).
 */
import { z } from 'zod';

export const SPEC_SCHEMA_VERSION = 1;

export const MetaSchema = z
  .object({
    /** True when the values were read on an official page or tool of the platform. */
    verified: z.boolean().default(false),
    /** Ids from the file's `sources` list. */
    sources: z.array(z.string()).default([]),
    /** Caveats, contradictions between official pages, what to double check. */
    note: z.string().optional(),
  })
  .default({});
export type SpecMeta = z.infer<typeof MetaSchema>;

export const SourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});

const meta = { _meta: MetaSchema };

/* ------------------------------------------------------------------ */
/* Print                                                               */
/* ------------------------------------------------------------------ */

export const InkPaperSchema = z.object({
  /** Stable id used as a key elsewhere in the file, for example "bw-cream". */
  id: z.string(),
  ink: z.enum(['bw', 'standard-color', 'premium-color']),
  paper: z.enum(['white', 'cream', 'groundwood']),
  /** The platform's own name for this option. */
  label: z.string(),
  /** Key into the printing cost tables. */
  costGroup: z.string(),
  formats: z.array(z.enum(['paperback', 'hardcover'])).default(['paperback']),
});
export type InkPaper = z.infer<typeof InkPaperSchema>;

export const PageRangeSchema = z.object({ min: z.number().int(), max: z.number().int() });

export const TrimSizeSchema = z.object({
  /** "5.5x8.5": width x height in inches. */
  id: z.string(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  label: z.string().optional(),
  /** Printing cost class. */
  costClass: z.enum(['regular', 'large']).default('regular'),
  /** Allowed page range per ink and paper option id. An option that is missing is not offered at this size. */
  pages: z.record(PageRangeSchema),
  /** Ink and paper options eligible for wider distribution at this size (KDP Expanded Distribution). */
  expandedDistribution: z.record(z.boolean()).optional(),
  /** Limit to these marketplace ids when the size is not sold everywhere. */
  onlyMarketplaces: z.array(z.string()).optional(),
});
export type TrimSizeSpec = z.infer<typeof TrimSizeSchema>;

export const SpineSchema = z.object({
  /**
   * formula: width = pages x perPageIn + baseIn.
   * template: the platform's template generator gives the width; the app asks for it and never guesses.
   */
  mode: z.enum(['formula', 'template']),
  perPageIn: z.record(z.number().nonnegative()).default({}),
  /** Constant added to the spine (hardcover boards). */
  baseIn: z.number().default(0),
  /** Spine text is only allowed from this page count up. */
  minPagesForText: z.number().int().nullable().default(null),
  /** Clear space kept between spine text and each spine edge. */
  textMarginIn: z.number().nullable().default(null),
  /** Where the user gets the value in "template" mode. */
  templateUrl: z.string().optional(),
  ...meta,
});

export const BarcodeBoxSchema = z.object({
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  /** Distance of the box from the spine side edge of the back cover (trim), and from the bottom trim edge. */
  fromSpineIn: z.number().nullable().default(null),
  fromBottomIn: z.number().nullable().default(null),
  /** The platform prints its own barcode when the file has none. */
  platformAdds: z.boolean().default(false),
  /** The publisher must supply the barcode in the cover file. */
  required: z.boolean().default(false),
  note: z.string().optional(),
});

export const CoverSpecSchema = z.object({
  bleedIn: z.number().nonnegative(),
  /** Text and important art must stay this far inside the trim edges. */
  safeMarginIn: z.number().nonnegative(),
  /** Hardcover case: cover material that wraps around the board edges. */
  wrapIn: z.number().nonnegative().default(0),
  /** Hardcover case: hinge between spine and board. */
  hingeIn: z.number().nonnegative().default(0),
  /** Hardcover case: how much larger the board is than the trimmed pages. */
  boardExtraWidthIn: z.number().nonnegative().default(0),
  boardExtraHeightIn: z.number().nonnegative().default(0),
  /** Dust jacket flap width, when the platform makes jackets. */
  flapIn: z.number().nonnegative().nullable().default(null),
  barcode: BarcodeBoxSchema,
  colorSpace: z.enum(['cmyk', 'rgb-or-cmyk']).default('rgb-or-cmyk'),
  /** Maximum total ink (C+M+Y+K) in percent, when the platform sets one. */
  maxInkPercent: z.number().nullable().default(null),
  minImageDpi: z.number().default(300),
  maxFileMB: z.number().nullable().default(null),
  pdfStandards: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  ...meta,
});
export type CoverSpec = z.infer<typeof CoverSpecSchema>;

export const PrintFormatSchema = z.object({
  trimSizes: z.array(TrimSizeSchema),
  /** Bindings offered, for example ["case-laminate"]. */
  bindings: z.array(z.string()).default([]),
  spine: SpineSchema,
  cover: CoverSpecSchema,
  ...meta,
});
export type PrintFormatSpec = z.infer<typeof PrintFormatSchema>;

export const GutterBandSchema = z.object({ minPages: z.number().int(), maxPages: z.number().int(), insideIn: z.number().positive() });

export const PrintSpecSchema = z.object({
  inkPaper: z.array(InkPaperSchema),
  bleed: z.object({ amountIn: z.number().nonnegative(), edges: z.array(z.enum(['top', 'bottom', 'outside', 'inside'])).default(['top', 'bottom', 'outside']), ...meta }),
  margins: z.object({
    /** Minimum inside (gutter) margin by page count. */
    gutter: z.array(GutterBandSchema),
    /** Minimum top, bottom and outside margin without bleed, and with bleed. */
    outsideMinNoBleedIn: z.number().positive(),
    outsideMinWithBleedIn: z.number().positive(),
    /** The platform's recommended (not required) margin, if it states one. */
    recommendedIn: z.number().nullable().default(null),
    ...meta,
  }),
  pageCount: z.object({
    /** The finished book must have a multiple of this many pages. */
    multiple: z.number().int().positive().default(2),
    /** The last page must be left empty for the printer. */
    lastPageBlank: z.boolean().default(false),
    ...meta,
  }),
  interiorFile: z.object({
    pdfStandards: z.array(z.string()).default([]),
    /** True when the platform refuses files that are not in one of the standards. */
    pdfStandardRequired: z.boolean().default(false),
    minImageDpi: z.number().default(300),
    maxFileMB: z.number().nullable().default(null),
    fontsMustBeEmbedded: z.boolean().default(true),
    transparencyAllowed: z.boolean().default(false),
    cropMarksAllowed: z.boolean().default(false),
    bookmarksAllowed: z.boolean().default(false),
    spreadsAllowed: z.boolean().default(false),
    /** ICC profiles must be removed from the file. */
    iccProfilesAllowed: z.boolean().default(true),
    /** Highest total ink coverage for colour pictures, in percent (240 means 240 %). Null when the platform states none. */
    maxInkPercent: z.number().nullable().default(null),
    /** Smallest type size the platform prints reliably, in points. */
    minFontSizePt: z.number().nullable().default(null),
    notes: z.array(z.string()).default([]),
    ...meta,
  }),
  formats: z.object({ paperback: PrintFormatSchema.optional(), hardcover: PrintFormatSchema.optional() }),
});
export type PrintSpec = z.infer<typeof PrintSpecSchema>;

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

export const CostBandSchema = z.object({
  minPages: z.number().int(),
  maxPages: z.number().int(),
  fixed: z.number().nonnegative(),
  perPage: z.number().nonnegative(),
});
export type CostBand = z.infer<typeof CostBandSchema>;

export const RoyaltyTierSchema = z.object({
  /** The rate applies to list prices below this amount. Omit on the last (open ended) tier. */
  below: z.number().optional(),
  rate: z.number().min(0).max(1),
});
export type RoyaltyTier = z.infer<typeof RoyaltyTierSchema>;

const CostTableSchema = z.record(z.object({ regular: z.array(CostBandSchema).default([]), large: z.array(CostBandSchema).default([]) }));

export const PrintMarketSchema = z.object({
  /** Short id: US, GB, DE, AU ... */
  id: z.string(),
  label: z.string(),
  currency: z.string().length(3),
  /** Decimal places prices use in this currency (0 for JPY). */
  decimals: z.number().int().min(0).max(3).default(2),
  /** Whether the list price the publisher types already contains VAT or GST. */
  listPriceIncludesTax: z.boolean().default(false),
  /** VAT or GST on printed books in percent, when known (used to show the shelf price). */
  taxPercent: z.number().nullable().default(null),
  /** Tiered royalty rates per format (KDP style). */
  royaltyTiers: z.object({ paperback: z.array(RoyaltyTierSchema).optional(), hardcover: z.array(RoyaltyTierSchema).optional() }).optional(),
  /** One fixed royalty rate (Draft2Digital print style). */
  fixedRate: z.number().min(0).max(1).optional(),
  /** Wholesale discount the publisher chooses (IngramSpark style), in percent. */
  discount: z.object({ min: z.number(), max: z.number(), default: z.number() }).optional(),
  /** Fee charged as a percentage of list price per sale, when the platform has one. */
  feePercentOfList: z.number().default(0),
  maxListPrice: z.object({ paperback: z.number().optional(), hardcover: z.number().optional() }).default({}),
  /** Printing cost bands per format and cost group. Empty when the cost must be typed in from the platform's calculator. */
  costs: z.object({ paperback: CostTableSchema.optional(), hardcover: CostTableSchema.optional() }).default({}),
  note: z.string().optional(),
});
export type PrintMarket = z.infer<typeof PrintMarketSchema>;

export const PrintPricingSchema = z.object({
  /** How the publisher's share of the list price is found. */
  rateModel: z.enum(['tiered', 'fixed', 'wholesale-discount']),
  /** bands: the spec file holds cost formulas. user-entered: copy the unit cost from the platform's calculator. */
  costModel: z.enum(['bands', 'user-entered']),
  /** Page count where "large" cost class starts being used is decided per trim size in the print section. */
  marketplaces: z.array(PrintMarketSchema),
  /** Wider distribution programme with its own rate (KDP Expanded Distribution). */
  expandedDistribution: z.object({ rate: z.number(), formats: z.array(z.string()).default(['paperback']), note: z.string().optional(), ...meta }).optional(),
  calculatorUrl: z.string().optional(),
  ...meta,
});
export type PrintPricing = z.infer<typeof PrintPricingSchema>;

const SizeTierSchema = z.object({ maxMB: z.number().optional(), price: z.number() });

export const EbookMarketSchema = z.object({
  id: z.string(),
  label: z.string(),
  currency: z.string().length(3),
  decimals: z.number().int().min(0).max(3).default(2),
  listPriceIncludesTax: z.boolean().default(false),
  taxPercent: z.number().nullable().default(null),
  /** Royalty plans keyed by percentage ("35", "70"). */
  plans: z.record(
    z.object({
      rate: z.number().min(0).max(1),
      /** Minimum list price; may depend on the file size. */
      min: z.array(SizeTierSchema),
      max: z.number(),
      /** Delivery cost charged per megabyte (70% plan). */
      deliveryPerMB: z.number().default(0),
      /** Only available to books enrolled in the platform's exclusive programme. */
      requiresExclusive: z.boolean().default(false),
    }),
  ),
  note: z.string().optional(),
});
export type EbookMarket = z.infer<typeof EbookMarketSchema>;

export const FeeSchema = z.object({
  id: z.string(),
  label: z.string(),
  amount: z.number(),
  currency: z.string(),
  when: z.string(),
  ...meta,
});

export const EbookPricingSchema = z.object({
  /** kdp: plans per marketplace. retail-share: one price, the author receives a share of it. */
  model: z.enum(['kdp', 'retail-share']),
  marketplaces: z.array(EbookMarketSchema).default([]),
  /** Author's share of the list price for the retail-share model. */
  authorShare: z.number().min(0).max(1).optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  currency: z.string().optional(),
  /** Can the list price be set to 0.00 directly? */
  freeAllowed: z.boolean(),
  freeNote: z.string().default(''),
  priceMatchNote: z.string().default(''),
  ...meta,
});
export type EbookPricing = z.infer<typeof EbookPricingSchema>;

/* ------------------------------------------------------------------ */
/* Ebook files, languages, listing limits                              */
/* ------------------------------------------------------------------ */

export const EbookSpecSchema = z.object({
  acceptedFormats: z.array(z.string()),
  maxFileMB: z.number().nullable().default(null),
  epubCheckRequired: z.boolean().default(false),
  cover: z.object({
    idealWidthPx: z.number().int(),
    idealHeightPx: z.number().int(),
    minWidthPx: z.number().int().nullable().default(null),
    minHeightPx: z.number().int().nullable().default(null),
    maxSidePx: z.number().int().nullable().default(null),
    maxFileMB: z.number().nullable().default(null),
    formats: z.array(z.string()).default(['jpg']),
    ...meta,
  }),
  notes: z.array(z.string()).default([]),
  ...meta,
});

export const LanguageListSchema = z.object({
  /** "any" or a list of BCP 47 primary language codes (en, bn, hi ...). */
  supported: z.union([z.literal('any'), z.array(z.string())]),
  note: z.string().optional(),
});

export const LanguagesSchema = z.object({
  ebook: LanguageListSchema.optional(),
  paperback: LanguageListSchema.optional(),
  hardcover: LanguageListSchema.optional(),
  /** What the platform does with a book in an unsupported language. */
  consequence: z.string().optional(),
  ...meta,
});

export const ListingSpecSchema = z.object({
  keywordSlots: z.number().int().nullable().default(null),
  keywordMaxChars: z.number().int().nullable().default(null),
  categoriesMax: z.number().int().nullable().default(null),
  descriptionMaxChars: z.number().int().nullable().default(null),
  /** HTML tags the description field accepts. */
  descriptionTags: z.array(z.string()).default([]),
  titleSubtitleMaxChars: z.number().int().nullable().default(null),
  notes: z.array(z.string()).default([]),
  ...meta,
});

/* ------------------------------------------------------------------ */
/* The whole file                                                      */
/* ------------------------------------------------------------------ */

export const PlatformSpecSchema = z.object({
  schemaVersion: z.literal(SPEC_SCHEMA_VERSION),
  platform: z.enum(['kdp', 'ingramspark', 'draft2digital']),
  displayName: z.string(),
  /** Date (YYYY-MM-DD) on which the values were last compared with the official pages. */
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Bumped whenever the bundled file changes, so the app can offer updates to a user's copy. */
  revision: z.number().int().default(1),
  sources: z.array(SourceSchema),
  /** Things to know or re-check, shown at the top of the Spec updater screen. */
  notes: z.array(z.string()).default([]),
  print: PrintSpecSchema.optional(),
  ebook: EbookSpecSchema.optional(),
  pricing: z.object({ print: PrintPricingSchema.optional(), ebook: EbookPricingSchema.optional() }).default({}),
  fees: z.array(FeeSchema).default([]),
  languages: LanguagesSchema.optional(),
  listing: ListingSpecSchema.optional(),
});
export type PlatformSpec = z.infer<typeof PlatformSpecSchema>;

/* ---- currencies.json ---------------------------------------------- */

export const CurrencyTableSchema = z.object({
  schemaVersion: z.literal(1),
  /** All rates say how many units of the currency equal one unit of the base. */
  base: z.string().length(3),
  /** Date of the rates (YYYY-MM-DD). Rates are only ever changed by the user. */
  date: z.string(),
  source: z.string().default(''),
  sourceUrl: z.string().default(''),
  rates: z.record(z.number().positive()),
  note: z.string().default(''),
});
export type CurrencyTable = z.infer<typeof CurrencyTableSchema>;

/* ---- tax.json ------------------------------------------------------ */

export const TaxTableSchema = z.object({
  schemaVersion: z.literal(1),
  lastVerified: z.string(),
  sources: z.array(SourceSchema),
  /** VAT or GST on books by country code. */
  countries: z.record(
    z.object({
      name: z.string(),
      taxName: z.string(),
      /** Percent on printed books and on ebooks; null when not confirmed. */
      printPercent: z.number().nullable(),
      ebookPercent: z.number().nullable(),
      ...meta,
    }),
  ),
  notes: z.array(z.string()).default([]),
});
export type TaxTable = z.infer<typeof TaxTableSchema>;
