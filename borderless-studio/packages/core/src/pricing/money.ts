/** Money helpers: rounding to a currency's decimals, "charm" price endings and currency conversion. */
import type { CurrencyTable } from '../specs/schema';

/** Round half up to the given number of decimals, without binary floating point surprises. */
export function roundMoney(value: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  // 0.5 x 6.99 - 3.45 is 0.045 on paper but 0.04499999 in binary arithmetic; the nudge makes it round as on paper.
  return Math.round(value * f + Math.sign(value) * 1e-7) / f;
}

/** Round up to the next unit of the currency (a minimum price must never be rounded down). */
export function ceilMoney(value: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.ceil(value * f - 1e-7) / f;
}

export type PriceEnding = 'exact' | '.99' | '.95' | '.49-.99' | '.00';

export const PRICE_ENDING_LABEL: Record<PriceEnding, string> = {
  exact: 'Exactly the minimum',
  '.99': 'Next price ending in .99',
  '.95': 'Next price ending in .95',
  '.49-.99': 'Next price ending in .49 or .99',
  '.00': 'Next whole amount',
};

/**
 * The lowest price at or above `minimum` with the wanted ending. Currencies
 * without decimals (yen) are rounded up to the next 10 for the endings that
 * have no meaning there.
 */
export function applyEnding(minimum: number, ending: PriceEnding, decimals = 2): number {
  const base = ceilMoney(minimum, decimals);
  if (ending === 'exact') return base;
  if (decimals === 0) {
    if (ending === '.00') return base;
    return Math.ceil(base / 10 - 1e-9) * 10;
  }
  const whole = Math.floor(base + 1e-9);
  const candidates: number[] = [];
  const add = (cents: number) => candidates.push(whole + cents, whole + 1 + cents);
  if (ending === '.99') add(0.99);
  else if (ending === '.95') add(0.95);
  else if (ending === '.49-.99') { add(0.49); add(0.99); }
  else candidates.push(whole, whole + 1);
  const ok = candidates.map((c) => roundMoney(c, decimals)).filter((c) => c + 1e-9 >= base).sort((a, b) => a - b);
  return ok[0] ?? base;
}

/** Convert an amount between two currencies with the table (rates say how many units equal one unit of the base). */
export function convert(amount: number, from: string, to: string, table: CurrencyTable | null | undefined): number | null {
  if (from === to) return amount;
  if (!table) return null;
  const rf = from === table.base ? 1 : table.rates[from];
  const rt = to === table.base ? 1 : table.rates[to];
  if (!rf || !rt) return null;
  return (amount / rf) * rt;
}

export function formatMoney(amount: number, currency: string, decimals = 2): string {
  return `${currency} ${amount.toFixed(decimals)}`;
}
