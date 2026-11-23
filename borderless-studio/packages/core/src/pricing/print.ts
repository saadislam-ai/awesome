/**
 * Print pricing: printing cost, what the publisher receives at a list price,
 * and the lowest list price a platform accepts. Every number comes from the
 * platform spec file; this file only holds the arithmetic.
 *
 *   KDP            royalty = rate x list price - printing cost
 *                  (the rate depends on the list price: 50% below a
 *                  threshold, 60% at or above it; 40% for Expanded Distribution)
 *   IngramSpark    compensation = list price x (1 - wholesale discount)
 *                  - printing cost - distribution fee (a percentage of list)
 *   Draft2Digital  royalty = 45% of list price - printing cost
 */
import type { CostBand, PrintMarket, PrintPricing, RoyaltyTier } from '../specs/schema';
import { ceilMoney, roundMoney } from './money';

export interface PrintCost {
  cost: number | null;
  /** How the cost was found, for display: "1.00 + 204 x 0.012". */
  basis: string;
  problem?: string;
}

/** Printing cost of one copy from the cost bands of a marketplace. */
export function printCost(
  market: PrintMarket, type: 'paperback' | 'hardcover', costGroup: string, costClass: 'regular' | 'large', pages: number,
): PrintCost {
  const table = market.costs[type]?.[costGroup];
  if (!table) return { cost: null, basis: '', problem: `The spec file has no printing cost for this ink and paper in ${market.label}.` };
  const bands: CostBand[] = table[costClass].length ? table[costClass] : table.regular;
  if (bands.length === 0) return { cost: null, basis: '', problem: `The spec file has no printing cost for this size in ${market.label}.` };
  // Presses print whole sheets: an odd page count is charged as the next even one.
  const billed = pages % 2 === 0 ? pages : pages + 1;
  const sorted = [...bands].sort((a, b) => a.minPages - b.minPages);
  let band = sorted.find((b) => billed >= b.minPages && billed <= b.maxPages);
  // Band tables list even page counts, so 109 sits between "to 108" and "from 110": use the next band.
  if (!band) band = sorted.find((b) => billed < b.minPages && billed >= b.minPages - 2);
  if (!band) {
    const lo = sorted[0].minPages;
    const hi = sorted[sorted.length - 1].maxPages;
    return { cost: null, basis: '', problem: `${pages} pages is outside the range the cost table covers in ${market.label} (${lo} to ${hi}).` };
  }
  const cost = roundMoney(band.fixed + band.perPage * billed, market.decimals);
  const basis = band.perPage ? `${band.fixed} + ${billed} pages x ${band.perPage}` : `flat ${band.fixed} up to ${band.maxPages} pages`;
  return { cost, basis };
}

/** The royalty rate that applies at a list price. Tiers are ordered from low prices to high. */
export function rateAt(tiers: RoyaltyTier[], listPrice: number): number {
  for (const t of tiers) if (t.below === undefined || listPrice < t.below - 1e-9) return t.rate;
  return tiers[tiers.length - 1]?.rate ?? 0;
}

export interface PrintTerms {
  /** How the publisher's share is worked out. */
  model: PrintPricing['rateModel'];
  tiers?: RoyaltyTier[];
  fixedRate?: number;
  /** Wholesale discount as a fraction (0.4 = 40%). */
  discount?: number;
  /** Fee as a fraction of the list price (0.01875 = 1.875%). */
  fee?: number;
}

/** What the publisher receives for one copy sold at `listPrice` (before tax on that income). Can be negative. */
export function printEarnings(listPrice: number, cost: number, terms: PrintTerms, decimals = 2): { earnings: number; rate: number } {
  if (terms.model === 'tiered') {
    const rate = rateAt(terms.tiers ?? [], listPrice);
    return { earnings: roundMoney(rate * listPrice - cost, decimals), rate };
  }
  if (terms.model === 'fixed') {
    const rate = terms.fixedRate ?? 0;
    return { earnings: roundMoney(rate * listPrice - cost, decimals), rate };
  }
  const rate = 1 - (terms.discount ?? 0) - (terms.fee ?? 0);
  return { earnings: roundMoney(listPrice * rate - cost, decimals), rate };
}

/**
 * The lowest list price at which the publisher earns at least `margin` per
 * copy (margin 0 gives the platform's minimum list price).
 *
 * With tiered rates a price just under a threshold can earn less than a
 * price just over it, so each tier is tried from the cheapest up: the first
 * tier whose answer lies inside its own price range wins.
 */
export function minimumListPrice(cost: number, terms: PrintTerms, margin = 0, decimals = 2): number {
  const need = cost + margin;
  if (terms.model === 'tiered') {
    const tiers = terms.tiers ?? [];
    let lower = 0;
    for (const t of tiers) {
      const candidate = Math.max(lower, ceilMoney(need / t.rate, decimals));
      if (t.below === undefined || candidate < t.below - 1e-9) return candidate;
      lower = t.below;
    }
    const last = tiers[tiers.length - 1];
    return last ? Math.max(lower, ceilMoney(need / last.rate, decimals)) : need;
  }
  if (terms.model === 'fixed') return ceilMoney(need / (terms.fixedRate || 1), decimals);
  const rate = 1 - (terms.discount ?? 0) - (terms.fee ?? 0);
  if (rate <= 0) return Infinity;
  return ceilMoney(need / rate, decimals);
}

/** What the buyer pays: the list price plus tax where the list price is entered without it. */
export function shelfPrice(listPrice: number, market: Pick<PrintMarket, 'listPriceIncludesTax' | 'taxPercent' | 'decimals'>): number {
  if (market.listPriceIncludesTax || !market.taxPercent) return listPrice;
  return roundMoney(listPrice * (1 + market.taxPercent / 100), market.decimals);
}
