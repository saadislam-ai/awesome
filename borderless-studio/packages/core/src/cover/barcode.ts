/**
 * ISBN barcodes: EAN-13, with the optional five digit price add-on (EAN-5).
 *
 * The barcode is drawn as plain rectangles in pure black, which is what
 * printers ask for (a barcode made of four colour black can misregister and
 * fail to scan). Sizes follow the GS1 General Specifications: at 100 % one
 * module (the narrowest bar) is 0.33 mm wide and the symbol may be printed
 * between 80 % and 200 %.
 */
import { validateIsbn } from '../isbn';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map((p) => p.replace(/[01]/g, (b) => (b === '0' ? '1' : '0')));
const G = R.map((p) => p.split('').reverse().join(''));
/** Which of the L and G patterns the six left hand digits use, chosen by the first digit. */
const PARITY_13 = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const PARITY_5 = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];

/** The 95 modules of an EAN-13 symbol as a string of 1 (bar) and 0 (space). */
export function ean13Modules(digits: string): string {
  if (!/^\d{13}$/.test(digits)) throw new Error('An EAN-13 barcode needs exactly 13 digits.');
  const parity = PARITY_13[Number(digits[0])];
  let out = '101';
  for (let i = 0; i < 6; i++) out += (parity[i] === 'L' ? L : G)[Number(digits[1 + i])];
  out += '01010';
  for (let i = 0; i < 6; i++) out += R[Number(digits[7 + i])];
  return out + '101';
}

/** The 47 modules of a five digit add-on. */
export function ean5Modules(digits: string): string {
  if (!/^\d{5}$/.test(digits)) throw new Error('A price add-on needs exactly 5 digits.');
  const d = digits.split('').map(Number);
  const check = (3 * (d[0] + d[2] + d[4]) + 9 * (d[1] + d[3])) % 10;
  const parity = PARITY_5[check];
  let out = '1011';
  for (let i = 0; i < 5; i++) {
    if (i > 0) out += '01';
    out += (parity[i] === 'L' ? L : G)[d[i]];
  }
  return out;
}

/**
 * The add-on digits for a printed price. The first digit names the currency:
 * 5 for US dollars and 6 for Canadian dollars are the only codes in current
 * use for new books; there is no code for Australian dollars. "90000" means
 * "no price in the barcode" and is what most self published books use.
 */
export function priceAddon(currency: 'USD' | 'CAD' | 'none', price?: number): string {
  if (currency === 'none' || price === undefined || !(price > 0)) return '90000';
  const lead = currency === 'USD' ? '5' : '6';
  const cents = Math.round(price * 100);
  // Prices of 100.00 or more cannot be shown: the convention is 9999.
  return lead + String(Math.min(cents, 9999)).padStart(4, '0');
}

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BarcodeText {
  /** Left edge (or centre, see anchor) and baseline of the text, inches. */
  x: number;
  y: number;
  text: string;
  /** Type size in points. */
  sizePt: number;
  anchor: 'start' | 'middle';
}

export interface BarcodeLayout {
  /** Size of the white box including quiet zones, inches. */
  widthIn: number;
  heightIn: number;
  /** Print scale relative to the nominal size (1 = 100 %). */
  magnification: number;
  /** Width of the narrowest bar, inches. */
  moduleIn: number;
  bars: BarRect[];
  texts: BarcodeText[];
  isbn13: string;
  addon: string | null;
}

export interface BarcodeOptions {
  /** Five digits, or null for no add-on. */
  addon?: string | null;
  /** Hyphenated ISBN for the line above the bars; defaults to the plain digits. */
  isbnDisplay?: string;
  /** Print scale, 0.8 to 2. When a box is given the largest scale that fits (up to 1) is used. */
  magnification?: number;
  /** Fit the symbol into a box of this size (inches). */
  fitWidthIn?: number;
  fitHeightIn?: number;
}

const MM = 1 / 25.4;
const X_NOMINAL_MM = 0.33;

/** Nominal size in modules and millimetres of the pieces of the symbol at 100 %. */
const NOMINAL = {
  leftQuiet: 11,
  rightQuiet: 7,
  addonGap: 7, // GS1 allows 7 to 12 modules between the symbol and its add-on
  // GS1 asks for at least 5 modules after the add-on; 7 reads more reliably on a dark cover.
  addonRightQuiet: 7,
  barHeightMm: 22.85,
  guardExtraMm: 1.65,
  digitSizePt: 8.2,
  digitGapMm: 0.35,
  isbnLineMm: 3.4,
  padMm: 1.0,
};

function nominalSize(hasAddon: boolean, withIsbnLine: boolean): { widthMm: number; heightMm: number } {
  const modules = NOMINAL.leftQuiet + 95 + (hasAddon ? NOMINAL.addonGap + 47 + NOMINAL.addonRightQuiet : NOMINAL.rightQuiet);
  const digitMm = (NOMINAL.digitSizePt / 72) * 25.4 * 0.75;
  const heightMm = NOMINAL.padMm + (withIsbnLine ? NOMINAL.isbnLineMm : 0) + NOMINAL.barHeightMm + NOMINAL.digitGapMm + digitMm + NOMINAL.padMm;
  return { widthMm: modules * X_NOMINAL_MM, heightMm };
}

/**
 * Lay out an ISBN barcode. Coordinates are inches from the top left corner
 * of the white box. Throws when the ISBN is invalid; returns null when the
 * symbol cannot fit the requested box at the smallest allowed scale.
 */
export function layoutBarcode(isbn: string, opts: BarcodeOptions = {}): BarcodeLayout | null {
  const v = validateIsbn(isbn);
  if (!v.valid || !v.isbn13) throw new Error(`The barcode needs a valid ISBN: ${v.problem ?? 'check the number'}`);
  const digits = v.isbn13;
  const addon = opts.addon ?? null;
  const isbnLine = true;
  const nominal = nominalSize(Boolean(addon), isbnLine);
  let mag = opts.magnification ?? 1;
  if (opts.fitWidthIn || opts.fitHeightIn) {
    const byW = opts.fitWidthIn ? (opts.fitWidthIn / MM) / nominal.widthMm : Infinity;
    const byH = opts.fitHeightIn ? (opts.fitHeightIn / MM) / nominal.heightMm : Infinity;
    mag = Math.min(opts.magnification ?? 1, byW, byH);
    // Keep a hair of tolerance so a box of exactly the nominal size still passes.
    if (mag < 0.8 - 1e-6) return null;
  }
  mag = Math.min(2, Math.max(0.8, mag));
  const x = X_NOMINAL_MM * mag * MM;
  const mm = (v2: number) => v2 * mag * MM;
  const bars: BarRect[] = [];
  const texts: BarcodeText[] = [];
  const digitPt = NOMINAL.digitSizePt * mag;
  const digitH = (digitPt / 72) * 0.75;
  const top = mm(NOMINAL.padMm) + (isbnLine ? mm(NOMINAL.isbnLineMm) : 0);
  const barH = mm(NOMINAL.barHeightMm);
  const guardH = barH + mm(NOMINAL.guardExtraMm);
  const left = NOMINAL.leftQuiet * x;

  const modules = ean13Modules(digits);
  const isGuard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;
  // Merge neighbouring modules of the same height into one rectangle (cleaner PDF, sharper edges).
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== '1') { i++; continue; }
    let j = i;
    while (j < modules.length && modules[j] === '1' && isGuard(j) === isGuard(i)) j++;
    bars.push({ x: left + i * x, y: top, w: (j - i) * x, h: isGuard(i) ? guardH : barH });
    i = j;
  }
  const baseline = top + barH + mm(NOMINAL.digitGapMm) + digitH;
  // The first digit stands in the quiet zone, clear of the guard bars.
  texts.push({ x: left - 5 * x, y: baseline, text: digits[0], sizePt: digitPt, anchor: 'middle' });
  // Each digit sits under its own seven modules.
  for (let i = 0; i < 6; i++) texts.push({ x: left + (3 + i * 7 + 3.5) * x, y: baseline, text: digits[1 + i], sizePt: digitPt, anchor: 'middle' });
  for (let i = 0; i < 6; i++) texts.push({ x: left + (50 + i * 7 + 3.5) * x, y: baseline, text: digits[7 + i], sizePt: digitPt, anchor: 'middle' });

  let widthModules = NOMINAL.leftQuiet + 95 + NOMINAL.rightQuiet;
  if (addon) {
    const am = ean5Modules(addon);
    const ax = left + (95 + NOMINAL.addonGap) * x;
    // The add-on digits stand above its bars, so the bars start lower and end level with the guard bars.
    const aTop = top + digitH + mm(NOMINAL.digitGapMm) + mm(0.6);
    for (let i = 0; i < am.length; ) {
      if (am[i] !== '1') { i++; continue; }
      let j = i;
      while (j < am.length && am[j] === '1') j++;
      bars.push({ x: ax + i * x, y: aTop, w: (j - i) * x, h: top + guardH - aTop });
      i = j;
    }
    for (let i = 0; i < 5; i++) texts.push({ x: ax + (4 + i * 9 + 3.5) * x, y: top + digitH, text: addon[i], sizePt: digitPt, anchor: 'middle' });
    widthModules = NOMINAL.leftQuiet + 95 + NOMINAL.addonGap + 47 + NOMINAL.addonRightQuiet;
  }
  const widthIn = widthModules * x;
  const heightIn = baseline + mm(NOMINAL.padMm);
  if (isbnLine) {
    texts.push({ x: left, y: mm(NOMINAL.padMm) + mm(NOMINAL.isbnLineMm) * 0.72, text: `ISBN ${opts.isbnDisplay ?? digits}`, sizePt: 7.6 * mag, anchor: 'start' });
  }
  return { widthIn, heightIn, magnification: Math.round(mag * 1000) / 1000, moduleIn: x, bars, texts, isbn13: digits, addon };
}
