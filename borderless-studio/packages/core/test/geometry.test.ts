import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkPageCount, minInsideMargin, paddedPageCount, pageSize, resolveMargins, strictestRules } from '../src/calc/geometry';
import { findTrim, interiorRules, parsePlatformSpec, spineWidth, trimAvailability, isStale, monthsSince } from '../src/specs';

const fixture = (name: string) => {
  const parsed = parsePlatformSpec(fs.readFileSync(path.join(__dirname, 'fixtures', 'specs', name), 'utf8'));
  if (!parsed.value) throw new Error(parsed.errors.join('\n'));
  return parsed.value;
};
const kdp = fixture('kdp.json');
const ingram = fixture('ingramspark.json');
const rules = interiorRules(kdp, 'paperback');
const noFurniture = { headPt: 0, footPt: 0 };

describe('KDP gutter margin by page count', () => {
  it.each([
    [24, 0.375], [150, 0.375], [151, 0.5], [300, 0.5], [301, 0.625], [500, 0.625], [501, 0.75], [700, 0.75], [701, 0.875], [828, 0.875],
  ])('%i pages need an inside margin of %f in', (pages, inside) => {
    expect(minInsideMargin(rules, pages)).toBe(inside);
  });

  it('raises a preferred margin that is too small and keeps one that is large enough', () => {
    const small = resolveMargins({ top: 0.5, bottom: 0.5, inside: 0.4, outside: 0.3 }, rules, 320, false, noFurniture);
    expect(small.margins.inside).toBeGreaterThanOrEqual(0.625);
    expect(small.raised.join(' ')).toMatch(/Inside margin raised/);
    const large = resolveMargins({ top: 0.75, bottom: 0.8, inside: 0.9, outside: 0.6 }, rules, 320, false, noFurniture);
    expect(large.margins.inside).toBe(0.9);
    expect(large.raised).toHaveLength(0);
  });

  it('uses 0.25 in outside margins without bleed and 0.375 in with bleed', () => {
    const tiny = { top: 0.1, bottom: 0.1, inside: 1, outside: 0.1 };
    const noBleed = resolveMargins(tiny, rules, 100, false, noFurniture).margins;
    const bleed = resolveMargins(tiny, rules, 100, true, noFurniture).margins;
    for (const side of ['top', 'bottom', 'outside'] as const) {
      expect(noBleed[side]).toBeGreaterThanOrEqual(0.25);
      expect(noBleed[side]).toBeLessThan(0.28);
      expect(bleed[side]).toBeGreaterThanOrEqual(0.375);
    }
  });

  it('keeps running heads and page numbers inside the safe area', () => {
    const m = resolveMargins({ top: 0.3, bottom: 0.3, inside: 0.8, outside: 0.6 }, rules, 200, false, { headPt: 12, footPt: 12 });
    // head (12 pt) + gap must fit between the 0.25 in limit and the text block
    expect(m.margins.top - m.headerGapIn - 12 / 72).toBeGreaterThanOrEqual(0.25);
    expect(m.margins.bottom - m.footerGapIn - 12 / 72).toBeGreaterThanOrEqual(0.25);
  });
});

describe('page size and page count', () => {
  it('adds bleed to the outside edge, top and bottom only', () => {
    expect(pageSize(6, 9, true, rules)).toMatchObject({ pdfWidthIn: 6.125, pdfHeightIn: 9.25, bleedIn: 0.125 });
    expect(pageSize(5.5, 8.5, false, rules)).toMatchObject({ pdfWidthIn: 5.5, pdfHeightIn: 8.5, bleedIn: 0 });
  });
  it('rounds page counts up to the press multiple', () => {
    expect(paddedPageCount(187, rules)).toBe(188);
    expect(paddedPageCount(188, rules)).toBe(188);
  });
  it('reports page counts outside the limits', () => {
    expect(checkPageCount(20, 24, 828, 'KDP').ok).toBe(false);
    expect(checkPageCount(900, 24, 828, 'KDP').message).toMatch(/at most 828/);
    expect(checkPageCount(200, 24, 828, 'KDP').ok).toBe(true);
  });
  it('combines platforms into the strictest rules', () => {
    const both = strictestRules([rules, interiorRules(ingram, 'paperback')]);
    expect(minInsideMargin(both, 100)).toBe(0.5); // Ingram 0.5 beats KDP 0.375
    expect(minInsideMargin(both, 600)).toBe(0.75); // KDP 0.75 beats Ingram 0.5
    expect(both.outsideMinNoBleedIn).toBe(0.5);
    expect(both.lastPageBlank).toBe(true);
  });
});

describe('spine width', () => {
  it.each([
    ['white', 200, 0.4504], ['cream', 200, 0.5], ['white', 100, 0.2252], ['cream', 320, 0.8],
  ] as const)('KDP paperback, %s paper, %i pages', (paper, pages, expected) => {
    const s = spineWidth(kdp, { type: 'paperback', ink: 'bw', paper }, pages);
    expect(s.widthIn).toBeCloseTo(expected, 4);
  });
  it('uses the premium colour thickness for premium colour interiors', () => {
    expect(spineWidth(kdp, { type: 'paperback', ink: 'premium-color', paper: 'white' }, 100).widthIn).toBeCloseTo(0.2347, 4);
  });
  it('allows spine text from 80 pages and leaves 0.0625 in each side', () => {
    expect(spineWidth(kdp, { type: 'paperback', ink: 'bw', paper: 'white' }, 78).textAllowed).toBe(false);
    const s = spineWidth(kdp, { type: 'paperback', ink: 'bw', paper: 'white' }, 80);
    expect(s.textAllowed).toBe(true);
    expect(s.textWidthIn).toBeCloseTo(80 * 0.002252 - 0.125, 4);
  });
  it('adds the board allowance for hardcovers', () => {
    expect(spineWidth(kdp, { type: 'hardcover', ink: 'bw', paper: 'white' }, 200).widthIn).toBeCloseTo(200 * 0.002252 + 0.189, 4);
  });
  it('never guesses an IngramSpark spine: it asks for the template value', () => {
    const none = spineWidth(ingram, { type: 'paperback', ink: 'bw', paper: 'white' }, 200);
    expect(none.widthIn).toBeNull();
    expect(none.problem).toMatch(/template/);
    const given = spineWidth(ingram, { type: 'paperback', ink: 'bw', paper: 'white' }, 200, 0.424);
    expect(given.widthIn).toBe(0.424);
    expect(given.textAllowed).toBe(true);
  });
});

describe('trim availability and spec age', () => {
  it('finds page limits for a trim, ink and paper', () => {
    expect(trimAvailability(kdp, { type: 'paperback', trim: '5.5x8.5', ink: 'bw', paper: 'cream' }).pages).toEqual({ min: 24, max: 776 });
    expect(findTrim(kdp, 'paperback', '6x9')?.widthIn).toBe(6);
  });
  it('explains combinations that are not offered', () => {
    expect(trimAvailability(kdp, { type: 'paperback', trim: '4x6', ink: 'bw', paper: 'cream' }).problem).toMatch(/does not list/);
    expect(trimAvailability(kdp, { type: 'paperback', trim: '8.5x11', ink: 'standard-color', paper: 'white' }).problem).toMatch(/does not offer/);
  });
  it('flags a spec as stale after six months', () => {
    expect(monthsSince('2026-05-23', new Date('2026-11-23T10:00:00'))).toBe(6);
    expect(isStale({ lastVerified: '2026-05-23' }, new Date('2026-11-23T10:00:00'))).toBe(true);
    expect(isStale({ lastVerified: '2026-05-24' }, new Date('2026-11-23T10:00:00'))).toBe(false);
  });
});
