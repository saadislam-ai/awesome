/** Unit conversions. Print specs are stated in inches; PDF and Typst work in points. */

export const PT_PER_IN = 72;
export const MM_PER_IN = 25.4;

export const inToPt = (inches: number): number => inches * PT_PER_IN;
export const ptToIn = (pt: number): number => pt / PT_PER_IN;
export const inToMm = (inches: number): number => inches * MM_PER_IN;
export const mmToIn = (mm: number): number => mm / MM_PER_IN;
export const mmToPt = (mm: number): number => (mm / MM_PER_IN) * PT_PER_IN;

/** Round a length in inches to the precision printers quote (three decimals by default). */
export function roundIn(inches: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round((inches + Number.EPSILON) * f) / f;
}

/** Round up, never down: used for minimum margins so a rounded value can never undercut a rule. */
export function ceilIn(inches: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.ceil(inches * f - 1e-9) / f;
}

/** "5.5 x 8.5 in (139.7 x 215.9 mm)" */
export function describeSize(widthIn: number, heightIn: number): string {
  const mm = (n: number) => (Math.round(inToMm(n) * 10) / 10).toString();
  return `${widthIn} x ${heightIn} in (${mm(widthIn)} x ${mm(heightIn)} mm)`;
}
