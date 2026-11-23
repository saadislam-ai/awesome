/**
 * Ebook pricing.
 *
 *   KDP 35% plan   royalty = 35% x list price without tax
 *   KDP 70% plan   royalty = 70% x (list price without tax - delivery cost),
 *                  delivery cost = file size in MB x a rate per marketplace
 *   Draft2Digital  about 60% of the list price; a price of 0.00 is allowed
 *
 * KDP's minimum price depends on the file size and the plan; the limits are
 * in the spec file for each marketplace.
 */
import type { EbookMarket } from '../specs/schema';
import { roundMoney } from './money';

export type KdpPlan = '35' | '70';

export interface KdpEbookResult {
  plan: KdpPlan;
  /** False when the price is outside the plan's limits or the plan is not open to this book. */
  allowed: boolean;
  reason?: string;
  royalty: number;
  /** List price with tax taken out, the amount the royalty is based on. */
  netPrice: number;
  deliveryCost: number;
  min: number;
  max: number;
}

/** The lowest list price a plan accepts for a file of this size. */
export function kdpMinimumPrice(market: EbookMarket, plan: KdpPlan, fileSizeMB: number): number | null {
  const p = market.plans[plan];
  if (!p) return null;
  for (const tier of p.min) if (tier.maxMB === undefined || fileSizeMB <= tier.maxMB) return tier.price;
  return p.min[p.min.length - 1]?.price ?? null;
}

export function kdpEbookRoyalty(market: EbookMarket, plan: KdpPlan, listPrice: number, fileSizeMB: number, exclusive = false): KdpEbookResult {
  const p = market.plans[plan];
  const empty: KdpEbookResult = { plan, allowed: false, royalty: 0, netPrice: 0, deliveryCost: 0, min: 0, max: 0 };
  if (!p) return { ...empty, reason: `${market.label} has no ${plan}% plan in the spec file.` };
  const min = kdpMinimumPrice(market, plan, fileSizeMB) ?? 0;
  const net = market.listPriceIncludesTax && market.taxPercent ? listPrice / (1 + market.taxPercent / 100) : listPrice;
  const delivery = roundMoney(p.deliveryPerMB * fileSizeMB, market.decimals);
  const royalty = roundMoney(p.rate * Math.max(0, net - delivery), market.decimals);
  let reason: string | undefined;
  if (p.requiresExclusive && !exclusive) reason = `The ${plan}% plan in ${market.label} is only paid to books enrolled in KDP Select.`;
  else if (listPrice < min - 1e-9) reason = `The lowest price for this plan and file size in ${market.label} is ${min.toFixed(market.decimals)}.`;
  else if (listPrice > p.max + 1e-9) reason = `The highest price for this plan in ${market.label} is ${p.max.toFixed(market.decimals)}.`;
  return { plan, allowed: !reason, reason, royalty, netPrice: roundMoney(net, market.decimals), deliveryCost: delivery, min, max: p.max };
}

/** The plan that pays more at a price, among the plans the price and the book qualify for. */
export function bestKdpPlan(market: EbookMarket, listPrice: number, fileSizeMB: number, exclusive = false): KdpEbookResult | null {
  const results = (['35', '70'] as KdpPlan[]).map((plan) => kdpEbookRoyalty(market, plan, listPrice, fileSizeMB, exclusive)).filter((r) => r.allowed);
  if (results.length === 0) return null;
  return results.sort((a, b) => b.royalty - a.royalty)[0];
}

/** The lowest price KDP accepts at all in a marketplace for this file size. */
export function kdpLowestPrice(market: EbookMarket, fileSizeMB: number, exclusive = false): { price: number; plan: KdpPlan } | null {
  let best: { price: number; plan: KdpPlan } | null = null;
  for (const plan of ['35', '70'] as KdpPlan[]) {
    const p = market.plans[plan];
    if (!p || (p.requiresExclusive && !exclusive)) continue;
    const min = kdpMinimumPrice(market, plan, fileSizeMB);
    if (min !== null && (!best || min < best.price)) best = { price: min, plan };
  }
  return best;
}
