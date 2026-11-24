/**
 * The "Reach First" price plan: for every edition, platform and marketplace,
 * the lowest list price the platform accepts, so that the book costs readers
 * as little as possible, optionally plus a fixed amount per copy. All rates, costs, thresholds and taxes are read from the spec
 * files; nothing here is a platform number.
 */
import type { Book, BookFormat, PlatformId } from '../model/book';
import { findTrim, inkPaperFor, type SpecSet } from '../specs';
import type { EbookMarket, PlatformSpec, PrintMarket } from '../specs/schema';
import { bestKdpPlan, kdpEbookRoyalty, kdpLowestPrice, type KdpPlan } from './ebook';
import { applyEnding, ceilMoney, convert, roundMoney } from './money';
import { authorShareOf, totalMargin, type PricingSettings } from './model';
import { minimumListPrice, printCost, printEarnings, shelfPrice, type PrintTerms } from './print';

export interface PriceRow {
  /** "edition/platform/marketplace": the key for overrides. */
  key: string;
  kind: 'print' | 'ebook';
  formatId: string;
  formatLabel: string;
  platform: PlatformId;
  platformName: string;
  marketId: string;
  marketLabel: string;
  currency: string;
  decimals: number;
  pages: number | null;
  /** Printing cost of one copy; null for ebooks or when unknown. */
  cost: number | null;
  costBasis: string;
  /** The lowest list price the platform accepts. */
  minimum: number | null;
  /** The list price to enter: the minimum plus the margin, rounded up to the chosen ending, or the price fixed by hand. */
  price: number | null;
  overridden: boolean;
  /** What the publisher receives per copy at that price, in the marketplace currency and in the base currency. */
  earnings: number | null;
  earningsBase: number | null;
  /** The author's and the publisher's parts of the earnings, in the marketplace currency. */
  authorEarnings: number | null;
  publisherEarnings: number | null;
  /** The same in the base currency. */
  authorEarningsBase: number | null;
  publisherEarningsBase: number | null;
  /** Share of the list price the publisher keeps before printing cost (0.6 = 60%). */
  rate: number | null;
  /** What the reader pays, tax included, in the marketplace currency and in the base currency. */
  shelf: number | null;
  shelfBase: number | null;
  taxNote: string;
  /** KDP ebooks: the royalty plan the price falls under. */
  plan?: KdpPlan;
  notes: string[];
  problems: string[];
}

export interface ReachPlan {
  rows: PriceRow[];
  /** Things to know, shown above the table. */
  notes: string[];
  warnings: string[];
  baseCurrency: string;
  ratesDate: string | null;
}

export interface ReachInput {
  book: Book;
  specs: SpecSet;
  settings: PricingSettings;
  /** Page counts from the latest interior builds: pages[editionId][platform]. */
  pages?: Record<string, Partial<Record<PlatformId, number>>>;
  /** Size of the latest EPUB in megabytes. */
  ebookFileSizeMB?: number | null;
  baseCurrency?: string;
}

const taxNote = (m: { listPriceIncludesTax: boolean; taxPercent: number | null }): string => {
  if (!m.taxPercent) return '';
  return m.listPriceIncludesTax ? `includes ${m.taxPercent}% tax` : `plus ${m.taxPercent}% tax at the checkout`;
};

function printRows(input: ReachInput, format: BookFormat, platform: PlatformId, spec: PlatformSpec, plan: ReachPlan): void {
  const pricing = spec.pricing.print;
  const type = format.type as 'paperback' | 'hardcover';
  if (!pricing || !spec.print?.formats[type]) return;
  const { settings, specs } = input;
  const base = plan.baseCurrency;
  const option = inkPaperFor(spec, format);
  const trim = findTrim(spec, type, format.trim);
  const pages = input.pages?.[format.id]?.[platform] ?? settings.pagesEstimate[format.id] ?? null;
  const pagesKnown = Boolean(input.pages?.[format.id]?.[platform]);
  let skipped = 0;
  for (const market of pricing.marketplaces) {
    const key = `${format.id}/${platform}/${market.id}`;
    if (settings.hidden.includes(`${platform}/${market.id}`)) continue;
    // Not every format is sold in every marketplace (KDP hardcovers are not sold on Amazon.com.au, for example).
    if (pricing.rateModel === 'tiered' && !market.royaltyTiers?.[type]) { skipped++; continue; }
    const row: PriceRow = {
      key, kind: 'print', formatId: format.id, formatLabel: format.label || format.id, platform, platformName: spec.displayName,
      marketId: market.id, marketLabel: market.label, currency: market.currency, decimals: market.decimals, pages,
      cost: null, costBasis: '', minimum: null, price: null, overridden: false, earnings: null, earningsBase: null, rate: null,
      authorEarnings: null, publisherEarnings: null, authorEarningsBase: null, publisherEarningsBase: null,
      shelf: null, shelfBase: null, taxNote: taxNote(market), notes: [], problems: [],
    };
    plan.rows.push(row);
    if (!option || !trim) {
      row.problems.push(`${spec.displayName} does not offer this trim size, paper and ink.`);
      continue;
    }
    if (pages === null) {
      row.problems.push('Build the interior once (or enter an estimated page count) to know the printing cost.');
      continue;
    }
    if (!pagesKnown) row.notes.push(`Uses your estimate of ${pages} pages; build the interior for the real number.`);
    // Printing cost: from the cost table, or typed in by hand where the platform publishes none.
    const typed = format.platformOptions[platform]?.printCost?.[market.currency];
    const group = type === 'hardcover' && format.binding === 'dust-jacket' && market.costs[type]?.[`${option.costGroup}@dust-jacket`] ? `${option.costGroup}@dust-jacket` : option.costGroup;
    const cost = typed !== undefined ? { cost: typed, basis: 'typed in from the platform calculator' } : printCost(market, type, group, trim.costClass ?? 'regular', pages);
    if (cost.cost === null) {
      row.problems.push(('problem' in cost && cost.problem) || 'The printing cost is not known.');
      continue;
    }
    row.cost = cost.cost;
    row.costBasis = cost.basis;

    const terms: PrintTerms = { model: pricing.rateModel };
    if (pricing.rateModel === 'tiered') terms.tiers = market.royaltyTiers![type]!;
    else if (pricing.rateModel === 'fixed') terms.fixedRate = market.fixedRate ?? 0;
    else {
      terms.discount = settings.ingramDiscountPercent / 100;
      terms.fee = market.feePercentOfList / 100;
      if (market.discount && settings.ingramDiscountPercent < market.discount.min) {
        const published: PrintTerms = { ...terms, discount: market.discount.min / 100 };
        const alt = applyEnding(minimumListPrice(cost.cost, published, 0, market.decimals), settings.ending, market.decimals);
        row.notes.push(`Your ${settings.ingramDiscountPercent}% discount is below the published minimum of ${market.discount.min}% for ${market.label}. If your account does not allow it, the lowest price becomes ${alt.toFixed(market.decimals)}.`);
      }
      if (market.discount && settings.ingramDiscountPercent > market.discount.max) row.problems.push(`The discount cannot be above ${market.discount.max}% in ${market.label}.`);
    }
    const margin = marginIn(settings, market.currency, specs);
    row.minimum = minimumListPrice(cost.cost, terms, 0, market.decimals);
    let price = applyEnding(minimumListPrice(cost.cost, terms, margin, market.decimals), settings.ending, market.decimals);
    const max = market.maxListPrice[type];
    if (max !== undefined && price > max) {
      row.problems.push(`The price would be above the highest list price ${spec.displayName} accepts here (${max}).`);
      price = max;
    }
    const fixed = settings.overrides[key];
    if (fixed !== undefined) {
      row.overridden = true;
      price = fixed;
      if (fixed < row.minimum - 1e-9) row.problems.push(`${fixed.toFixed(market.decimals)} is below the lowest price ${spec.displayName} accepts here (${row.minimum.toFixed(market.decimals)}).`);
    }
    row.price = price;
    const earned = printEarnings(price, cost.cost, terms, market.decimals);
    row.earnings = earned.earnings;
    row.rate = earned.rate;
    row.shelf = shelfPrice(price, market);
    const eb = convert(earned.earnings, market.currency, base, specs.currencies);
    const sb = convert(row.shelf, market.currency, base, specs.currencies);
    row.earningsBase = eb === null ? null : roundMoney(eb, 2);
    row.shelfBase = sb === null ? null : roundMoney(sb, 2);
    splitEarnings(row, settings);
    if (pricing.rateModel === 'tiered') {
      const tiers = terms.tiers!;
      const threshold = tiers.find((t) => t.below !== undefined)?.below;
      if (threshold !== undefined) row.notes.push(`${Math.round(earned.rate * 100)}% royalty rate: ${price < threshold ? 'below' : 'at or above'} the ${threshold.toFixed(market.decimals)} threshold.`);
    }
  }
  if (skipped > 0) {
    const names = pricing.marketplaces.filter((m) => pricing.rateModel === 'tiered' && !m.royaltyTiers?.[type]).map((m) => m.label);
    plan.notes.push(`${spec.displayName} does not sell ${type} books in: ${names.join(', ')}.`);
  }
}

/** The two margins together, in a marketplace currency. */
function marginIn(settings: PricingSettings, currency: string, specs: SpecSet): number {
  const total = totalMargin(settings);
  return total > 0 ? (convert(total, settings.marginCurrency, currency, specs.currencies) ?? 0) : 0;
}

/** Split what a copy earns between the author and the publisher, in the proportion of their margins. */
function splitEarnings(row: PriceRow, settings: PricingSettings): void {
  const share = authorShareOf(settings);
  const part = (v: number | null, decimals: number) => {
    if (v === null) return [null, null] as const;
    const author = roundMoney(v * share, decimals);
    return [author, roundMoney(v - author, decimals)] as const;
  };
  [row.authorEarnings, row.publisherEarnings] = part(row.earnings, row.decimals);
  [row.authorEarningsBase, row.publisherEarningsBase] = part(row.earningsBase, 2);
}

function kdpEbookPrice(market: EbookMarket, sizeMB: number, select: boolean, margin: number): { price: number; plan: KdpPlan } | null {
  const lowest = kdpLowestPrice(market, sizeMB, select);
  if (!lowest) return null;
  if (margin <= 0) return lowest;
  // The lowest price whose royalty reaches the margin, on whichever plan gets there first.
  const tax = market.listPriceIncludesTax && market.taxPercent ? 1 + market.taxPercent / 100 : 1;
  let best: { price: number; plan: KdpPlan } | null = null;
  for (const plan of ['35', '70'] as KdpPlan[]) {
    const p = market.plans[plan];
    if (!p || (p.requiresExclusive && !select)) continue;
    const floor = kdpEbookRoyalty(market, plan, 0, sizeMB, select).min;
    const needed = ceilMoney((margin / p.rate + p.deliveryPerMB * sizeMB) * tax, market.decimals);
    const price = Math.max(floor, needed);
    if (price > p.max) continue;
    if (!best || price < best.price) best = { price, plan };
  }
  return best ?? lowest;
}

function ebookRows(input: ReachInput, format: BookFormat, platform: PlatformId, spec: PlatformSpec, plan: ReachPlan): void {
  const pricing = spec.pricing.ebook;
  if (!pricing) return;
  const { settings, specs } = input;
  const base = plan.baseCurrency;
  const sizeMB = settings.ebookFileSizeMB ?? input.ebookFileSizeMB ?? 1;
  const blank = (marketId: string, label: string, currency: string, decimals: number): PriceRow => ({
    key: `${format.id}/${platform}/${marketId}`, kind: 'ebook', formatId: format.id, formatLabel: format.label || format.id, platform, platformName: spec.displayName,
    marketId, marketLabel: label, currency, decimals, pages: null, cost: null, costBasis: '', minimum: null, price: null, overridden: false,
    earnings: null, earningsBase: null, rate: null, shelf: null, shelfBase: null, taxNote: '', notes: [], problems: [],
    authorEarnings: null, publisherEarnings: null, authorEarningsBase: null, publisherEarningsBase: null,
  });
  const finish = (row: PriceRow) => {
    if (row.earnings !== null) {
      const eb = convert(row.earnings, row.currency, base, specs.currencies);
      row.earningsBase = eb === null ? null : roundMoney(eb, 2);
    }
    if (row.shelf !== null) {
      const sb = convert(row.shelf, row.currency, base, specs.currencies);
      row.shelfBase = sb === null ? null : roundMoney(sb, 2);
    }
    splitEarnings(row, settings);
    plan.rows.push(row);
  };

  if (pricing.model === 'kdp') {
    for (const market of pricing.marketplaces) {
      if (settings.hidden.includes(`${platform}/${market.id}`)) continue;
      const row = blank(market.id, market.label, market.currency, market.decimals);
      row.taxNote = taxNote(market);
      const margin = marginIn(settings, market.currency, specs);
      const lowest = kdpLowestPrice(market, sizeMB, settings.kdpSelect);
      const target = kdpEbookPrice(market, sizeMB, settings.kdpSelect, margin);
      if (!lowest || !target) {
        row.problems.push('The spec file has no price limits for this marketplace.');
        finish(row);
        continue;
      }
      row.minimum = lowest.price;
      // Ebook price lists move in familiar steps; the ending is only applied when a margin lifts the price off the floor.
      let price = margin > 0 ? Math.max(target.price, applyEnding(target.price, settings.ending, market.decimals)) : target.price;
      const fixed = settings.overrides[row.key];
      if (fixed !== undefined) { row.overridden = true; price = fixed; }
      const result = bestKdpPlan(market, price, sizeMB, settings.kdpSelect);
      if (!result) {
        const why = kdpEbookRoyalty(market, '35', price, sizeMB, settings.kdpSelect);
        row.problems.push(why.reason ?? 'This price is outside the limits of every royalty plan.');
        row.price = price;
        finish(row);
        continue;
      }
      row.price = price;
      row.plan = result.plan;
      row.rate = market.plans[result.plan].rate;
      row.earnings = result.royalty;
      row.shelf = price;
      if (result.deliveryCost > 0) row.notes.push(`Delivery cost of ${result.deliveryCost.toFixed(market.decimals)} for a ${sizeMB.toFixed(1)} MB file is taken off before the 70% is worked out.`);
      if (market.note) row.notes.push(market.note);
      finish(row);
    }
    if (!pricing.freeAllowed && pricing.freeNote) plan.notes.push(pricing.freeNote);
    if (pricing.priceMatchNote) plan.notes.push(pricing.priceMatchNote);
    return;
  }

  // One price, the author receives a share of it.
  const currency = pricing.currency ?? 'USD';
  const row = blank('ALL', 'All stores', currency, 2);
  const share = pricing.authorShare ?? null;
  const margin = marginIn(settings, currency, specs);
  const floor = pricing.minPrice ?? 0;
  let price: number;
  if (settings.freeEbook && pricing.freeAllowed) {
    price = 0;
    row.minimum = 0;
  } else {
    row.minimum = pricing.freeAllowed ? 0 : floor;
    price = share ? Math.max(floor, applyEnding(ceilMoney(margin / share, 2), settings.ending, 2)) : floor;
  }
  const fixed = settings.overrides[row.key];
  if (fixed !== undefined) {
    row.overridden = true;
    price = fixed;
    if (fixed > 0 && fixed < floor - 1e-9) row.problems.push(`Prices between 0.01 and ${(floor - 0.01).toFixed(2)} are not accepted.`);
  }
  if (pricing.maxPrice !== undefined && price > pricing.maxPrice) row.problems.push(`The highest price accepted is ${pricing.maxPrice}.`);
  row.price = price;
  row.shelf = price;
  row.rate = share;
  row.earnings = share !== null ? roundMoney(price * share, 2) : null;
  if (pricing.freeNote) row.notes.push(pricing.freeNote);
  if (pricing.priceMatchNote) row.notes.push(pricing.priceMatchNote);
  if (share !== null && spec.platform === 'ingramspark') row.notes.push('The share is of the net amount IngramSpark receives from each retailer, so the real figure is lower than shown.');
  finish(row);
}

export function buildReachPlan(input: ReachInput): ReachPlan {
  const { book, specs, settings } = input;
  const plan: ReachPlan = {
    rows: [], notes: [], warnings: [], baseCurrency: input.baseCurrency ?? specs.currencies?.base ?? 'AUD', ratesDate: specs.currencies?.date ?? null,
  };
  for (const format of book.formats) {
    if (!format.enabled) continue;
    for (const platform of format.platforms) {
      const spec = specs.platforms[platform];
      if (!spec) continue;
      if (format.type === 'ebook') ebookRows(input, format, platform, spec, plan);
      else printRows(input, format, platform, spec, plan);
    }
  }
  plan.notes = [...new Set(plan.notes)];
  // Things that undermine a low price or break a platform rule.
  const printOnKdp = book.formats.some((f) => f.enabled && f.type !== 'ebook' && f.platforms.includes('kdp'));
  const printOnIngram = book.formats.some((f) => f.enabled && f.type !== 'ebook' && f.platforms.includes('ingramspark'));
  if (printOnKdp && printOnIngram) plan.notes.push('The same book is on KDP and IngramSpark: keep KDP Expanded Distribution switched off, as both platforms require.');
  const ingram = specs.platforms.ingramspark?.pricing.print;
  if (printOnIngram && ingram) {
    const lowestMin = Math.min(...ingram.marketplaces.map((m) => m.discount?.min ?? 100));
    if (settings.ingramDiscountPercent < lowestMin) {
      plan.warnings.push(`A wholesale discount of ${settings.ingramDiscountPercent}% is below every minimum IngramSpark publishes (${[...new Set(ingram.marketplaces.map((m) => `${m.discount?.min}% in ${m.label}`))].join(', ')}). Check on the title setup page what your account allows before relying on these prices.`);
    }
  }
  if (!specs.currencies) plan.warnings.push('No currency table was found, so amounts cannot be shown in your own currency.');
  if (totalMargin(settings) === 0) {
    plan.notes.unshift('Reach first: neither the publisher nor the author takes a margin, so every price is the lowest the platform accepts. The few cents a copy may still earn go to the author.');
  } else if (settings.publisherMargin === 0) {
    plan.notes.unshift('The publisher takes nothing: everything a copy earns goes to the author.');
  } else if (settings.authorMargin === 0) {
    plan.notes.unshift('The author has chosen to take nothing: what a copy earns stays with the publisher to cover publishing costs.');
  }
  if (settings.freeEbook) plan.notes.push('Free ebook: the price is 0 wherever a store allows it. Amazon does not allow a free price; there the lowest price is used.');
  return plan;
}
