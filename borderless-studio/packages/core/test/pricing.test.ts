/**
 * Pricing formulas. Expected values are worked out by hand from the rates
 * and cost tables in the bundled spec files (verified 23 November 2026).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BookSchema, PricingSettingsSchema, applyEnding, bestKdpPlan, buildReachPlan, ceilMoney, convert, kdpEbookRoyalty, kdpLowestPrice,
  kdpMinimumPrice, minimumListPrice, parseCurrencyTable, parsePlatformSpec, printCost, printEarnings, rateAt, roundMoney, shelfPrice,
  type PlatformSpec, type PrintTerms, type SpecSet,
} from '../src/index';

const specsDir = path.resolve(__dirname, '..', '..', '..', 'specs');
const spec = (name: string): PlatformSpec => parsePlatformSpec(fs.readFileSync(path.join(specsDir, `${name}.json`), 'utf8')).value!;
const kdp = spec('kdp');
const ingram = spec('ingramspark');
const d2d = spec('draft2digital');
const currencies = parseCurrencyTable(fs.readFileSync(path.join(specsDir, 'currencies.json'), 'utf8')).value!;
const specs: SpecSet = { platforms: { kdp, ingramspark: ingram, draft2digital: d2d }, currencies, tax: null, problems: [], origin: {} } as unknown as SpecSet;
const kdpPrint = (id: string) => kdp.pricing.print!.marketplaces.find((m) => m.id === id)!;
const kdpEbook = (id: string) => kdp.pricing.ebook!.marketplaces.find((m) => m.id === id)!;
const ingramPrint = (id: string) => ingram.pricing.print!.marketplaces.find((m) => m.id === id)!;

describe('money', () => {
  it('rounds the way it is done on paper', () => {
    expect(roundMoney(3.448)).toBe(3.45);
    expect(roundMoney(0.5 * 6.99 - 3.45)).toBe(0.05); // 0.045 exactly, despite binary arithmetic
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(1234.5, 0)).toBe(1235);
    expect(ceilMoney(10.8333)).toBe(10.84);
    expect(ceilMoney(6.9)).toBe(6.9);
    expect(ceilMoney(13.82)).toBe(13.82);
  });

  it('finds the next price with the wanted ending', () => {
    expect(applyEnding(6.9, '.99')).toBe(6.99);
    expect(applyEnding(6.99, '.99')).toBe(6.99);
    expect(applyEnding(7.0, '.99')).toBe(7.99);
    expect(applyEnding(13.82, '.99')).toBe(13.99);
    expect(applyEnding(6.3, '.49-.99')).toBe(6.49);
    expect(applyEnding(6.5, '.49-.99')).toBe(6.99);
    expect(applyEnding(6.01, '.00')).toBe(7);
    expect(applyEnding(7, '.00')).toBe(7);
    expect(applyEnding(6.96, '.95')).toBe(7.95);
    expect(applyEnding(6.9, 'exact')).toBe(6.9);
    expect(applyEnding(1234, '.99', 0)).toBe(1240); // yen has no cents
  });

  it('converts through the base currency of the table', () => {
    expect(convert(10, 'AUD', 'AUD', currencies)).toBe(10);
    expect(convert(1, 'AUD', 'USD', currencies)).toBeCloseTo(currencies.rates.USD, 6);
    expect(convert(currencies.rates.USD, 'USD', 'AUD', currencies)).toBeCloseTo(1, 6);
    expect(convert(1, 'USD', 'GBP', currencies)).toBeCloseTo(currencies.rates.GBP / currencies.rates.USD, 6);
    expect(convert(1, 'USD', 'XXX', currencies)).toBeNull();
  });
});

describe('KDP print', () => {
  it('works out the printing cost from the cost bands', () => {
    // Amazon.com, black ink, regular size: 2.30 flat to 108 pages, then 1.00 + 0.012 per page
    expect(printCost(kdpPrint('US'), 'paperback', 'bw', 'regular', 100).cost).toBe(2.3);
    expect(printCost(kdpPrint('US'), 'paperback', 'bw', 'regular', 108).cost).toBe(2.3);
    expect(printCost(kdpPrint('US'), 'paperback', 'bw', 'regular', 204).cost).toBe(3.45); // 1 + 204 x 0.012 = 3.448
    expect(printCost(kdpPrint('US'), 'paperback', 'bw', 'regular', 109).cost).toBe(2.32); // charged as 110 pages
    expect(printCost(kdpPrint('US'), 'paperback', 'bw', 'large', 204).cost).toBe(4.47); // 1 + 204 x 0.017
    // Amazon.com.au: 4.74 flat to 106 pages, then 2.42 + 0.022 per page
    expect(printCost(kdpPrint('AU'), 'paperback', 'bw', 'regular', 204).cost).toBe(6.91); // 2.42 + 204 x 0.022 = 6.908
    expect(printCost(kdpPrint('AU'), 'paperback', 'bw', 'regular', 100).cost).toBe(4.74);
    expect(printCost(kdpPrint('US'), 'hardcover', 'bw', 'regular', 182).cost).toBe(7.83); // 5.65 + 182 x 0.012 = 7.834
    expect(printCost(kdpPrint('US'), 'paperback', 'bw', 'regular', 5000).problem).toMatch(/outside the range/);
    expect(printCost(kdpPrint('AU'), 'hardcover', 'bw', 'regular', 200).problem).toMatch(/no printing cost/);
  });

  it('switches from 50% to 60% at the price threshold of each marketplace', () => {
    const us = kdpPrint('US').royaltyTiers!.paperback!;
    expect(rateAt(us, 9.98)).toBe(0.5);
    expect(rateAt(us, 9.99)).toBe(0.6);
    expect(rateAt(kdpPrint('AU').royaltyTiers!.paperback!, 13.98)).toBe(0.5);
    expect(rateAt(kdpPrint('AU').royaltyTiers!.paperback!, 13.99)).toBe(0.6);
    expect(rateAt(kdpPrint('GB').royaltyTiers!.paperback!, 7.99)).toBe(0.6);
    expect(rateAt(kdpPrint('JP').royaltyTiers!.paperback!, 999)).toBe(0.5);
  });

  it('finds the minimum list price with the threshold logic', () => {
    const terms: PrintTerms = { model: 'tiered', tiers: kdpPrint('US').royaltyTiers!.paperback! };
    // cost / 50% stays under the 9.99 threshold: that is the minimum
    expect(minimumListPrice(3.45, terms)).toBe(6.9);
    expect(minimumListPrice(4.99, terms)).toBe(9.98);
    // cost / 50% would be 11.00, which is over the threshold, where the rate is 60%: 5.50 / 0.6 = 9.17, but not below 9.99
    expect(minimumListPrice(5.5, terms)).toBe(9.99);
    // cost / 60% is above the threshold
    expect(minimumListPrice(6.5, terms)).toBe(10.84);
    // with 50 cents kept per copy
    expect(minimumListPrice(3.45, terms, 0.5)).toBe(7.9);
  });

  it('works out the royalty per copy', () => {
    const terms: PrintTerms = { model: 'tiered', tiers: kdpPrint('US').royaltyTiers!.paperback! };
    expect(printEarnings(6.9, 3.45, terms).earnings).toBe(0);
    expect(printEarnings(9.98, 3.45, terms)).toEqual({ earnings: 1.54, rate: 0.5 });
    expect(printEarnings(9.99, 3.45, terms)).toEqual({ earnings: 2.54, rate: 0.6 }); // one cent more earns a dollar more
    expect(printEarnings(5, 3.45, terms).earnings).toBe(-0.95);
  });

  it('adds GST for the shelf price where list prices exclude it', () => {
    expect(shelfPrice(13.82, kdpPrint('AU'))).toBe(15.2);
    expect(shelfPrice(6.9, kdpPrint('US'))).toBe(6.9);
  });
});

describe('IngramSpark and Draft2Digital print', () => {
  it('uses the Australian rate card and the distribution fee', () => {
    const au = ingramPrint('AU');
    const cost = printCost(au, 'paperback', 'bw-creme-50', 'regular', 206);
    expect(cost.cost).toBe(7.61); // 2.50 + 206 x 0.0248 = 7.6088
    const published: PrintTerms = { model: 'wholesale-discount', discount: 0.35, fee: au.feePercentOfList / 100 };
    // keeps 1 - 0.35 - 0.01875 = 63.125% of the list price
    expect(minimumListPrice(7.61, published)).toBe(12.06);
    expect(printEarnings(12.06, 7.61, published).earnings).toBe(0);
    expect(printEarnings(19.99, 7.61, published).earnings).toBe(5.01); // 19.99 x 0.63125 - 7.61 = 5.0087
    const thirty: PrintTerms = { ...published, discount: 0.3 };
    expect(minimumListPrice(7.61, thirty)).toBe(11.18); // 7.61 / 0.68125 = 11.1706
    expect(printCost(au, 'hardcover', 'bw-creme-50', 'regular', 184).cost).toBe(13.65); // 9.36 + 184 x 0.0233 = 13.6472
  });

  it('uses 45% of the list price for Draft2Digital print', () => {
    const us = d2d.pricing.print!.marketplaces.find((m) => m.id === 'US')!;
    const cost = printCost(us, 'paperback', 'bw', 'regular', 204).cost!;
    expect(cost).toBe(4.34); // 1.34 + 204 x 0.0147 = 4.3388
    const terms: PrintTerms = { model: 'fixed', fixedRate: us.fixedRate };
    expect(minimumListPrice(cost, terms)).toBe(9.65); // 4.34 / 0.45 = 9.644
    expect(printEarnings(9.99, cost, terms).earnings).toBe(0.16);
  });
});

describe('KDP ebook', () => {
  it('sets the lowest price by file size', () => {
    const us = kdpEbook('US');
    expect(kdpMinimumPrice(us, '35', 1)).toBe(0.99);
    expect(kdpMinimumPrice(us, '35', 5)).toBe(1.99);
    expect(kdpMinimumPrice(us, '35', 12)).toBe(2.99);
    expect(kdpMinimumPrice(us, '70', 1)).toBe(2.99);
    expect(kdpLowestPrice(us, 1)).toEqual({ price: 0.99, plan: '35' });
  });

  it('pays 35% of the price, or 70% after the delivery cost', () => {
    const us = kdpEbook('US');
    expect(kdpEbookRoyalty(us, '35', 0.99, 1).royalty).toBe(0.35);
    const seventy = kdpEbookRoyalty(us, '70', 2.99, 1);
    expect(seventy.deliveryCost).toBe(0.15);
    expect(seventy.royalty).toBe(1.99); // 0.7 x (2.99 - 0.15)
    expect(bestKdpPlan(us, 2.99, 1)!.plan).toBe('70');
    expect(bestKdpPlan(us, 0.99, 1)!.plan).toBe('35');
    expect(kdpEbookRoyalty(us, '70', 0.99, 1).allowed).toBe(false);
    expect(kdpEbookRoyalty(us, '70', 14.99, 1).reason).toMatch(/highest price/);
  });

  it('takes the tax out of prices that include it', () => {
    const au = kdpEbook('AU');
    const r = kdpEbookRoyalty(au, '70', 3.99, 1);
    expect(r.netPrice).toBe(3.63); // 3.99 / 1.10
    expect(r.royalty).toBe(2.43); // 0.7 x (3.627 - 0.15)
  });

  it('keeps the 70% plan for KDP Select books where the marketplace says so', () => {
    const india = kdpEbook('IN');
    expect(bestKdpPlan(india, 199, 1, false)!.plan).toBe('35');
    expect(bestKdpPlan(india, 199, 1, true)!.plan).toBe('70');
    expect(kdpEbookRoyalty(india, '70', 199, 1, false).reason).toMatch(/KDP Select/);
  });
});

describe('Reach First plan', () => {
  const book = BookSchema.parse({
    id: 'bk_price', title: 'Priced', contributors: [{ name: 'A. Writer' }],
    formats: [
      { id: 'paperback', type: 'paperback', label: 'Paperback', trim: '5.5x8.5', paper: 'cream', isbn: '9781234567897', platforms: ['kdp', 'ingramspark'] },
      { id: 'ebook', type: 'ebook', label: 'Ebook', platforms: ['kdp', 'draft2digital'] },
    ],
  });
  const pages = { paperback: { kdp: 204, ingramspark: 206 } };
  const settings = PricingSettingsSchema.parse({});
  const plan = buildReachPlan({ book, specs, settings, pages, ebookFileSizeMB: 0.3 });
  const row = (key: string) => {
    const r = plan.rows.find((x) => x.key === key);
    if (!r) throw new Error(`no row ${key}: ${plan.rows.map((x) => x.key).join(' ')}`);
    return r;
  };

  it('prices the KDP paperback at the lowest accepted price, rounded up to .99', () => {
    const us = row('paperback/kdp/US');
    expect(us.cost).toBe(3.45);
    expect(us.minimum).toBe(6.9);
    expect(us.price).toBe(6.99);
    expect(us.earnings).toBe(0.05);
    expect(us.rate).toBe(0.5);
    const au = row('paperback/kdp/AU');
    expect(au.cost).toBe(6.91);
    expect(au.minimum).toBe(13.82);
    // 13.99 is the 60% threshold: the rounded price lands exactly on it and earns more
    expect(au.price).toBe(13.99);
    expect(au.rate).toBe(0.6);
    expect(au.earnings).toBe(1.48); // 0.6 x 13.99 - 6.91
    expect(au.shelf).toBe(15.39); // plus 10% GST
    expect(au.taxNote).toMatch(/10% tax/);
  });

  it('warns that a 30% IngramSpark discount is below the published minimums and shows the fallback price', () => {
    const au = row('paperback/ingramspark/AU');
    expect(au.cost).toBe(7.61);
    expect(au.minimum).toBe(11.18);
    expect(au.price).toBe(11.99);
    expect(au.notes.join(' ')).toMatch(/below the published minimum of 35% for Australia.*lowest price becomes 12\.99/);
    expect(plan.warnings.join(' ')).toMatch(/below every minimum IngramSpark publishes/);
    expect(plan.notes.join(' ')).toMatch(/Expanded Distribution switched off/);
  });

  it('prices ebooks at the floor: 0.99 on Kindle, free on Draft2Digital', () => {
    const us = row('ebook/kdp/US');
    expect(us.price).toBe(0.99);
    expect(us.plan).toBe('35');
    expect(us.earnings).toBe(0.35);
    const d = row('ebook/draft2digital/ALL');
    expect(d.price).toBe(0);
    expect(d.earnings).toBe(0);
    expect(plan.notes.join(' ')).toMatch(/can't set your book's list price as free/);
  });

  it('adds a margin when asked, converted from Australian dollars', () => {
    const withMargin = buildReachPlan({ book, specs, settings: PricingSettingsSchema.parse({ marginPerCopy: 1, ending: 'exact' }), pages, ebookFileSizeMB: 0.3 });
    const us = withMargin.rows.find((r) => r.key === 'paperback/kdp/US')!;
    const marginUsd = currencies.rates.USD; // one Australian dollar in US dollars
    expect(us.price).toBe(ceilMoney((3.45 + marginUsd) / 0.5));
    expect(us.earnings!).toBeGreaterThanOrEqual(roundMoney(marginUsd) - 0.01);
    expect(us.earningsBase!).toBeGreaterThanOrEqual(0.99);
    const au = withMargin.rows.find((r) => r.key === 'paperback/kdp/AU')!;
    // (6.91 + 1.00) / 0.5 = 15.82 is over the 13.99 threshold, so the 60% rate applies: 7.91 / 0.6 = 13.19, but not below 13.99
    expect(au.price).toBe(13.99);
  });

  it('respects a price fixed by hand and reports one that is too low', () => {
    const fixed = buildReachPlan({ book, specs, settings: PricingSettingsSchema.parse({ overrides: { 'paperback/kdp/US': 5 } }), pages });
    const us = fixed.rows.find((r) => r.key === 'paperback/kdp/US')!;
    expect(us.overridden).toBe(true);
    expect(us.price).toBe(5);
    expect(us.problems.join(' ')).toMatch(/below the lowest price/);
  });

  it('asks for a page count when no interior has been built', () => {
    const none = buildReachPlan({ book, specs, settings });
    expect(none.rows.find((r) => r.key === 'paperback/kdp/US')!.problems.join(' ')).toMatch(/Build the interior/);
    const estimate = buildReachPlan({ book, specs, settings: PricingSettingsSchema.parse({ pagesEstimate: { paperback: 204 } }) });
    expect(estimate.rows.find((r) => r.key === 'paperback/kdp/US')!.cost).toBe(3.45);
  });
});
