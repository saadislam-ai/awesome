/**
 * Colour conversion for print: screen RGB to press CMYK with an ink limit.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CmykProfile, RgbToCmyk, limitInk, maxInk, naiveRgbToCmyk, srgbToXyz, xyzToLab } from '../src/index';

const icc = new Uint8Array(fs.readFileSync(path.join(__dirname, '../../../resources/icc/CGATS001Compat-v2-micro.icc')));
const profile = new CmykProfile(icc);
const conv = new RgbToCmyk(profile, { inkLimit: 2.4 });
const sum = (c: number[]) => c[0] + c[1] + c[2] + c[3];

describe('the press profile', () => {
  it('describes paper white, the four inks and black', () => {
    expect(profile.toLab(0, 0, 0, 0)[0]).toBeGreaterThan(99);
    expect(profile.toLab(0, 0, 0, 1)[0]).toBeLessThan(20);
    const cyan = profile.toLab(1, 0, 0, 0);
    const magenta = profile.toLab(0, 1, 0, 0);
    const yellow = profile.toLab(0, 0, 1, 0);
    expect(cyan[2]).toBeLessThan(-30); // cyan is blueish
    expect(magenta[1]).toBeGreaterThan(60); // magenta is strongly red
    expect(yellow[2]).toBeGreaterThan(80); // yellow is yellow
  });
});

describe('RGB to CMYK', () => {
  it('keeps paper white free of ink', () => {
    expect(conv.color(255, 255, 255)).toEqual([0, 0, 0, 0]);
  });

  it('prints black with full black ink and stays inside the ink limit', () => {
    const k = conv.color(0, 0, 0);
    expect(k[3]).toBeGreaterThan(0.95);
    expect(sum(k)).toBeLessThanOrEqual(2.4 + 1e-6);
  });

  it('never exceeds 240 % total ink anywhere', () => {
    let worst = 0;
    for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) worst = Math.max(worst, sum(conv.color(r, g, b)));
    expect(worst).toBeLessThanOrEqual(2.4 + 1e-3);
  });

  it('maps the primaries to the expected inks', () => {
    const red = conv.color(255, 0, 0);
    expect(red[0]).toBeLessThan(0.1);
    expect(red[1]).toBeGreaterThan(0.85);
    expect(red[2]).toBeGreaterThan(0.85);
    const blue = conv.color(0, 0, 255);
    expect(blue[0]).toBeGreaterThan(0.8);
    expect(blue[1]).toBeGreaterThan(0.7);
    expect(blue[2]).toBeLessThan(0.1);
    const green = conv.color(0, 255, 0);
    expect(green[1]).toBeLessThan(0.1);
    expect(green[2]).toBeGreaterThan(0.85);
  });

  it('reproduces printable colours closely (difference below 2 delta E)', () => {
    const samples: [number, number, number][] = [[224, 172, 150], [128, 128, 128], [200, 200, 200], [64, 64, 64], [0, 128, 128], [250, 244, 228], [240, 140, 30], [20, 40, 90], [150, 90, 60], [90, 120, 70]];
    for (const [r, g, b] of samples) {
      const c = conv.color(r, g, b);
      const printed = profile.toLab(c[0], c[1], c[2], c[3]);
      const [x, y, z] = srgbToXyz(r, g, b);
      const wanted = xyzToLab(x, y, z);
      const dE = Math.hypot(printed[0] - wanted[0], printed[1] - wanted[1], printed[2] - wanted[2]);
      expect(dE, `rgb(${r}, ${g}, ${b})`).toBeLessThan(2);
    }
  });

  it('adds black ink smoothly as greys get darker', () => {
    let previous = -1;
    for (let v = 255; v >= 0; v -= 5) {
      const k = conv.color(v, v, v)[3];
      expect(k, `grey ${v}`).toBeGreaterThanOrEqual(previous - 0.02);
      previous = k;
    }
    // Light greys carry no black ink at all, which keeps highlights clean.
    expect(conv.color(230, 230, 230)[3]).toBeLessThan(0.02);
  });

  it('converts pixel buffers the same way as single colours', () => {
    const px = conv.pixels(new Uint8Array([255, 255, 255, 0, 0, 0, 224, 172, 150]), 3);
    expect(px).toHaveLength(12);
    expect([...px.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const skin = conv.color(224, 172, 150).map((v) => Math.round(v * 255));
    expect([...px.subarray(8, 12)]).toEqual(skin);
    expect(maxInk(px)).toBeLessThanOrEqual(2.4 + 0.01);
    // RGBA input: alpha is ignored.
    expect([...conv.pixels(new Uint8Array([224, 172, 150, 255]), 4)]).toEqual(skin);
  });

  it('has a plain fallback that also respects the ink limit', () => {
    expect(naiveRgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]);
    expect(sum(naiveRgbToCmyk(0, 0, 0, 2.4))).toBeLessThanOrEqual(2.4 + 1e-9);
    const limited = limitInk([1, 1, 1, 1], 2.4);
    expect(sum(limited)).toBeCloseTo(2.4, 6);
    expect(limited[3]).toBe(1);
  });
});
