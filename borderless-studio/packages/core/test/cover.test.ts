/**
 * Cover geometry and barcodes. The expected numbers are worked out by hand
 * from the formulas the platforms publish (see the spec files for sources).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  barcodePlan, coverGeometry, coverKindsFor, defaultCoverDesign, ean13Modules, ean5Modules, layoutBarcode, parsePlatformSpec, priceAddon,
  rectInside, rectsOverlap, contrastRatio, hexToRgb, bookMockup, drawQuad, homography, readCoverTemplate, type BookFormat, type RasterImage,
} from '../src/index';
import { PDFDocument } from 'pdf-lib';

const specsDir = path.resolve(__dirname, '..', '..', '..', 'specs');
const spec = (name: string) => parsePlatformSpec(fs.readFileSync(path.join(specsDir, `${name}.json`), 'utf8')).value!;
const kdp = spec('kdp');
const ingram = spec('ingramspark');
const fmt = (o: Partial<BookFormat>): BookFormat => ({ type: 'paperback', trim: '6x9', paper: 'white', ink: 'bw', binding: 'case-laminate', ...o } as BookFormat);

describe('KDP paperback cover', () => {
  const res = coverGeometry(kdp, fmt({ trim: '6x9', paper: 'white' }), 300);
  const g = res.geometry!;

  it('uses the published spine formula', () => {
    // 300 pages x 0.002252 in for white paper
    expect(g.spineWidthIn).toBeCloseTo(0.6756, 4);
    expect(g.spineBasis).toBe('300 pages x 0.002252 in');
    expect(coverGeometry(kdp, fmt({ paper: 'cream' }), 300).geometry!.spineWidthIn).toBeCloseTo(0.75, 4);
  });

  it('has the published size: two covers, the spine and 0.125 in bleed all round', () => {
    expect(g.widthIn).toBeCloseTo(0.125 + 6 + 0.6756 + 6 + 0.125, 4);
    expect(g.heightIn).toBeCloseTo(9.25, 4);
    expect(g.back).toEqual({ x: 0.125, y: 0.125, w: 6, h: 9 });
    expect(g.spine.x).toBeCloseTo(6.125, 4);
    expect(g.front.x).toBeCloseTo(6.8006, 4);
    expect(g.trim).toEqual({ x: 0.125, y: 0.125, w: 12.6756, h: 9 });
    expect(res.problems).toEqual([]);
  });

  it('keeps the safe zones inside the panels and the barcode at the lower right of the back cover', () => {
    expect(rectInside(g.safe.back, g.back)).toBe(true);
    expect(rectInside(g.safe.front, g.front)).toBe(true);
    expect(g.safe.back.x - g.back.x).toBeCloseTo(0.125, 4);
    // KDP: a 2 x 1.2 in box, 0.25 in from the spine fold and 0.25 in above the trim line
    expect(g.barcode.w).toBe(2);
    expect(g.barcode.h).toBe(1.2);
    expect(g.back.x + g.back.w - (g.barcode.x + g.barcode.w)).toBeCloseTo(0.25, 4);
    expect(g.back.y + g.back.h - (g.barcode.y + g.barcode.h)).toBeCloseTo(0.25, 4);
    expect(rectInside(g.barcode, g.safe.back)).toBe(true);
  });

  it('allows spine text only from 80 pages', () => {
    expect(g.spineTextAllowed).toBe(true);
    expect(g.safe.spine!.w).toBeCloseTo(0.6756 - 2 * 0.0625, 4);
    const thin = coverGeometry(kdp, fmt({}), 72).geometry!;
    expect(thin.spineTextAllowed).toBe(false);
    expect(thin.spineTextReason).toMatch(/from 80 pages/);
    expect(thin.safe.spine).toBeNull();
  });
});

describe('KDP hardcover case', () => {
  it('follows the official calculator: boards, 15 mm wrap and hinges inside the panels', () => {
    const g = coverGeometry(kdp, fmt({ type: 'hardcover', paper: 'cream' }), 182).geometry!;
    expect(g.kind).toBe('case-laminate');
    expect(g.spineWidthIn).toBeCloseTo(182 * 0.0025 + 0.189, 4);
    expect(g.widthIn).toBeCloseTo(2 * 0.5906 + 2 * (6 + 0.1969) + 0.644, 3);
    expect(g.heightIn).toBeCloseTo(9 + 0.2362 + 2 * 0.5906, 3);
    expect(g.hinges).toHaveLength(2);
    // The hinges lie inside the back and front panels, next to the spine.
    expect(rectInside(g.hinges[0], g.back)).toBe(true);
    expect(rectInside(g.hinges[1], g.front)).toBe(true);
    expect(rectsOverlap(g.safe.back, g.hinges[0])).toBe(false);
    expect(rectsOverlap(g.safe.front, g.hinges[1])).toBe(false);
    expect(rectsOverlap(g.barcode, g.hinges[0])).toBe(false);
  });
});

describe('IngramSpark covers', () => {
  it('refuses to guess a spine width', () => {
    const res = coverGeometry(ingram, fmt({ paper: 'cream' }), 206);
    expect(res.geometry).toBeNull();
    expect(res.problems[0]).toMatch(/does not publish a spine formula/);
  });

  it('lays out a paperback from the template spine width', () => {
    const res = coverGeometry(ingram, fmt({ trim: '5.5x8.5', paper: 'cream' }), 206, { templateSpineIn: 0.47 });
    const g = res.geometry!;
    expect(g.widthIn).toBeCloseTo(0.125 + 5.5 + 0.47 + 5.5 + 0.125, 4);
    expect(g.heightIn).toBeCloseTo(8.75, 4);
    expect(g.barcodeRequired).toBe(true);
    expect(g.maxInkPercent).toBe(240);
    expect(g.colorSpace).toBe('cmyk');
    expect(res.cautions.join(' ')).toMatch(/template/);
  });

  it('places the cover in the centre of the template sheet when its document size is entered', () => {
    const plain = coverGeometry(ingram, fmt({ trim: '5.5x8.5' }), 206, { templateSpineIn: 0.47 });
    expect(plain.geometry!.onSheet).toBe(false);
    expect(plain.cautions.join(' ')).toMatch(/document size of its template/);
    const res = coverGeometry(ingram, fmt({ trim: '5.5x8.5' }), 206, { templateSpineIn: 0.47, templateWidthIn: 15, templateHeightIn: 12 });
    const g = res.geometry!;
    expect(g.onSheet).toBe(true);
    expect([g.widthIn, g.heightIn]).toEqual([15, 12]);
    // The cover with bleed is 11.72 x 8.75 in: (15 - 11.72) / 2 = 1.64 and (12 - 8.75) / 2 = 1.625
    expect(g.art).toEqual({ x: 1.64, y: 1.625, w: 11.72, h: 8.75 });
    expect(g.trim).toEqual({ x: 1.765, y: 1.75, w: 11.47, h: 8.5 });
    expect(g.back.x).toBeCloseTo(1.765, 4);
    expect(g.spine.x - g.back.x).toBeCloseTo(5.5, 4);
    expect(rectInside(g.barcode, g.safe.back)).toBe(true);
    expect(rectInside(g.trim, g.art)).toBe(true);
    expect(res.problems).toEqual([]);
    expect(res.cautions.join(' ')).toMatch(/centre of the IngramSpark template sheet of 15 x 12 in/);
  });

  it('refuses a template size that is smaller than the cover', () => {
    const res = coverGeometry(ingram, fmt({ trim: '5.5x8.5' }), 206, { templateSpineIn: 0.47, templateWidthIn: 11, templateHeightIn: 8.75 });
    expect(res.problems.join(' ')).toMatch(/smaller than the cover/);
  });

  it('builds the case with a narrower board and hinges beside the spine', () => {
    const g = coverGeometry(ingram, fmt({ type: 'hardcover' }), 184, { templateSpineIn: 0.5625 }).geometry!;
    // 0.625 + (6 - 0.185) + 0.5 + spine + 0.5 + (6 - 0.185) + 0.625
    expect(g.widthIn).toBeCloseTo(14.4425, 4);
    expect(g.heightIn).toBeCloseTo(0.625 + 9.25 + 0.625, 4);
    expect(g.back.w).toBeCloseTo(5.815, 4);
    expect(g.spine.x - (g.back.x + g.back.w)).toBeCloseTo(0.5, 4);
    expect(rectsOverlap(g.hinges[0], g.back)).toBe(false);
  });

  it('builds a dust jacket with flaps, and needs both a case and a jacket file', () => {
    const format = fmt({ type: 'hardcover', binding: 'dust-jacket' });
    expect(coverKindsFor(ingram, format)).toEqual(['case-laminate', 'dust-jacket']);
    expect(coverKindsFor(kdp, format)).toEqual(['case-laminate']);
    const g = coverGeometry(ingram, format, 184, { kind: 'dust-jacket', templateSpineIn: 0.5625 }).geometry!;
    // 0.125 + 3.25 + 0.25 + (6 + 0.4375) + spine + (6 + 0.4375) + 0.25 + 3.25 + 0.125
    expect(g.widthIn).toBeCloseTo(20.6875, 4);
    expect(g.heightIn).toBeCloseTo(0.125 + 9.25 + 0.125, 4);
    expect(g.backFlap!.w).toBe(3.25);
    expect(g.frontFlap!.x).toBeCloseTo(g.front.x + g.front.w + 0.25, 4);
    const tooBig = coverGeometry(ingram, fmt({ type: 'hardcover', binding: 'dust-jacket', trim: '8.5x11' }), 184, { kind: 'dust-jacket', templateSpineIn: 0.5625 });
    expect(tooBig.problems.join(' ')).toMatch(/dust jackets up to 6.14 x 9.252/);
  });

  it('uses the smaller spine margin on narrow spines', () => {
    const narrow = coverGeometry(ingram, fmt({ trim: '5.5x8.5' }), 100, { templateSpineIn: 0.25 }).geometry!;
    expect(narrow.safe.spine!.w).toBeCloseTo(0.25 - 2 * 0.03125, 4);
  });
});

describe('ISBN barcode', () => {
  it('encodes EAN-13 with the right guard bars and digit patterns', () => {
    const m = ean13Modules('9781234567897');
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(92)).toBe('101');
    // First digit 9 selects the pattern LGGLGL; digit 7 in the L set is 0111011.
    expect(m.slice(3, 10)).toBe('0111011');
    // Second left digit 8 in the G set is 0001001.
    expect(m.slice(10, 17)).toBe('0001001');
    // Last digit 7 in the R set is 1000100.
    expect(m.slice(85, 92)).toBe('1000100');
    // Every digit of every set has four runs, so the total number of bars is fixed.
    expect(m.split('').filter((b) => b === '1').length % 2).toBe(1);
    expect(() => ean13Modules('123')).toThrow();
  });

  it('encodes the five digit add-on', () => {
    const m = ean5Modules('90000');
    expect(m).toHaveLength(47);
    expect(m.slice(0, 4)).toBe('1011');
    // 9+0+0 = 9, 9*3 = 27, checksum 7: pattern LGLGL. Digit 9 in the L set is 0001011.
    expect(m.slice(4, 11)).toBe('0001011');
    expect(m.slice(11, 13)).toBe('01');
  });

  it('builds the price add-on: 5 for US dollars, 6 for Canadian dollars, 90000 for no price', () => {
    expect(priceAddon('USD', 14.99)).toBe('51499');
    expect(priceAddon('CAD', 19.99)).toBe('61999');
    expect(priceAddon('USD', 125)).toBe('59999');
    expect(priceAddon('none')).toBe('90000');
    expect(priceAddon('USD')).toBe('90000');
  });

  it('has the standard size at 100 % and stays scannable when fitted to a platform box', () => {
    const plain = layoutBarcode('9781234567897')!;
    // 113 modules of 0.33 mm
    expect(plain.widthIn * 25.4).toBeCloseTo(37.29, 1);
    expect(plain.moduleIn * 25.4).toBeCloseTo(0.33, 3);
    const kdpBox = layoutBarcode('9781234567897', { addon: '90000', fitWidthIn: 2, fitHeightIn: 1.2 })!;
    expect(kdpBox.widthIn).toBeLessThanOrEqual(2.0001);
    expect(kdpBox.magnification).toBeGreaterThanOrEqual(0.8);
    const ingramBox = layoutBarcode('9781234567897', { addon: '90000', fitWidthIn: 1.75, fitHeightIn: 1 })!;
    expect(ingramBox.magnification).toBeGreaterThanOrEqual(0.8);
    expect(ingramBox.heightIn).toBeLessThanOrEqual(1.0001);
    // Too small a box: no barcode rather than an unreadable one.
    expect(layoutBarcode('9781234567897', { addon: '90000', fitWidthIn: 1.2, fitHeightIn: 1 })).toBeNull();
    expect(() => layoutBarcode('9781234567890')).toThrow(/valid ISBN/);
  });

  it('keeps every bar inside the white box with quiet zones on both sides', () => {
    const b = layoutBarcode('9781234567897', { addon: '51499' })!;
    const minX = Math.min(...b.bars.map((r) => r.x));
    const maxX = Math.max(...b.bars.map((r) => r.x + r.w));
    expect(minX / b.moduleIn).toBeGreaterThanOrEqual(11 - 1e-6);
    expect((b.widthIn - maxX) / b.moduleIn).toBeGreaterThanOrEqual(5 - 1e-6);
    for (const r of b.bars) expect(r.y + r.h).toBeLessThan(b.heightIn);
    expect(b.texts.map((t) => t.text).join('')).toContain('9781234567897'.slice(1, 7));
  });
});

describe('barcode plan and colours', () => {
  const g = coverGeometry(kdp, fmt({}), 300).geometry!;
  const gi = coverGeometry(ingram, fmt({}), 300, { templateSpineIn: 0.7 }).geometry!;
  const design = defaultCoverDesign();

  it('draws the barcode by default, leaves it to KDP on request, and always draws it for IngramSpark', () => {
    expect(barcodePlan(design, g, fmt({ isbn: '9781234567897' })).mode).toBe('own');
    const platform = { ...design, barcode: { ...design.barcode, mode: 'platform' as const } };
    expect(barcodePlan(platform, g, fmt({ isbn: '9781234567897' })).mode).toBe('placeholder');
    expect(barcodePlan(platform, gi, fmt({ isbn: '9781234567897' })).mode).toBe('own');
    // No ISBN: KDP can print its own, IngramSpark cannot go ahead.
    expect(barcodePlan(design, g, fmt({ isbn: '' })).mode).toBe('placeholder');
    const none = barcodePlan(design, gi, fmt({ isbn: '' }));
    expect(none.mode).toBe('none');
    expect(none.reason).toMatch(/needs a barcode/);
  });

  it('measures contrast between text and background', () => {
    expect(hexToRgb('#1f3a5f')).toEqual([31, 58, 95]);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#808080')).toBeLessThan(1.5);
  });
});

describe('3D mock-up and template reading', () => {
  it('maps the corners of a shape exactly', () => {
    const h = homography([[0, 0], [10, 0], [10, 20], [0, 20]], [[5, 5], [45, 9], [40, 70], [8, 60]]);
    const map = (x: number, y: number) => {
      const w = h[6] * x + h[7] * y + h[8];
      return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
    };
    expect(map(0, 0)[0]).toBeCloseTo(5, 6);
    expect(map(10, 0)).toEqual([expect.closeTo(45, 6), expect.closeTo(9, 6)]);
    expect(map(10, 20)).toEqual([expect.closeTo(40, 6), expect.closeTo(70, 6)]);
    expect(map(0, 20)).toEqual([expect.closeTo(8, 6), expect.closeTo(60, 6)]);
  });

  it('draws a picture into a four cornered shape and nowhere else', () => {
    const red: RasterImage = { width: 4, height: 4, channels: 3, data: new Uint8Array(48).map((_, i) => (i % 3 === 0 ? 200 : 10)) };
    const dest: RasterImage = { width: 40, height: 40, channels: 4, data: new Uint8Array(40 * 40 * 4) };
    drawQuad(dest, red, [[10, 10], [30, 12], [28, 30], [12, 28]]);
    const px = (x: number, y: number) => [...dest.data.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 4)];
    expect(px(20, 20)).toEqual([200, 10, 10, 255]);
    expect(px(2, 2)[3]).toBe(0);
    expect(px(38, 38)[3]).toBe(0);
  });

  it('makes a mock-up with the front cover, the spine and a shadow', () => {
    const g = coverGeometry(kdp, fmt({}), 300).geometry!;
    const ppi = 20;
    const flat: RasterImage = { width: Math.round(g.widthIn * ppi), height: Math.round(g.heightIn * ppi), channels: 3, data: new Uint8Array(Math.round(g.widthIn * ppi) * Math.round(g.heightIn * ppi) * 3).fill(180) };
    const out = bookMockup(flat, g, ppi, { size: 300 });
    expect([out.width, out.height, out.channels]).toEqual([300, 300, 4]);
    // The centre of the picture is the book (opaque); a corner is empty.
    expect(out.data[(150 * 300 + 150) * 4 + 3]).toBe(255);
    expect(out.data[3]).toBe(0);
    const partly = out.data.filter((_, i) => i % 4 === 3).filter((a) => a > 0 && a < 200).length;
    expect(partly).toBeGreaterThan(200); // the soft shadow
    const white = bookMockup(flat, g, ppi, { size: 300, background: [255, 255, 255] });
    expect([...white.data.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
  });

  it('reads the document size of a template PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([15 * 72, 12 * 72]);
    const info = await readCoverTemplate(await doc.save());
    expect(info).toEqual({ widthIn: 15, heightIn: 12, pages: 1 });
    await expect(readCoverTemplate(new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not be read as a PDF/);
  });
});
