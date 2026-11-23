import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCurrencyTable, parsePlatformSpec, parseTaxTable, interiorRules, spineWidth, unverifiedSections } from '../src/specs';
import { minInsideMargin } from '../src/calc/geometry';

const specsDir = path.resolve(__dirname, '..', '..', '..', 'specs');
const read = (f: string) => fs.readFileSync(path.join(specsDir, f), 'utf8');

describe('bundled spec files', () => {
  it.each(['kdp.json', 'ingramspark.json', 'draft2digital.json'])('%s is valid', (file) => {
    const parsed = parsePlatformSpec(read(file));
    expect(parsed.errors).toEqual([]);
    const spec = parsed.value!;
    expect(spec.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(spec.sources.length).toBeGreaterThan(0);
    for (const s of spec.sources) expect(s.url).toMatch(/^https:\/\//);
  });

  it('currencies.json and tax.json are valid', () => {
    expect(parseCurrencyTable(read('currencies.json')).errors).toEqual([]);
    expect(parseTaxTable(read('tax.json')).errors).toEqual([]);
  });

  it('contain no em or en dashes (house style)', () => {
    for (const f of fs.readdirSync(specsDir)) expect(read(f)).not.toMatch(/[–—]/);
  });

  it('KDP carries the verified margin, bleed and spine values', () => {
    const kdp = parsePlatformSpec(read('kdp.json')).value!;
    const rules = interiorRules(kdp, 'paperback');
    expect([24, 151, 301, 501, 701].map((p) => minInsideMargin(rules, p))).toEqual([0.375, 0.5, 0.625, 0.75, 0.875]);
    expect(rules.outsideMinNoBleedIn).toBe(0.25);
    expect(rules.outsideMinWithBleedIn).toBe(0.375);
    expect(rules.bleedIn).toBe(0.125);
    const per = kdp.print!.formats.paperback!.spine.perPageIn;
    expect(per['bw-white']).toBe(0.002252);
    expect(per['bw-cream']).toBe(0.0025);
    expect(per['premium-color-white']).toBe(0.002347);
    expect(kdp.print!.formats.paperback!.spine.minPagesForText).toBe(80);
    expect(kdp.print!.formats.paperback!.trimSizes.map((t) => t.id)).toEqual(expect.arrayContaining(['5x8', '5.25x8', '5.5x8.5', '6x9']));
  });

  it('KDP does not list Bengali for any format', () => {
    const kdp = parsePlatformSpec(read('kdp.json')).value!;
    for (const f of ['ebook', 'paperback', 'hardcover'] as const) {
      const list = kdp.languages![f]!.supported;
      expect(Array.isArray(list) && list.includes('en')).toBe(true);
      expect(Array.isArray(list) && list.includes('bn')).toBe(false);
    }
  });

  it('IngramSpark needs the template for the spine and a blank last page', () => {
    const ing = parsePlatformSpec(read('ingramspark.json')).value!;
    expect(ing.print!.formats.paperback!.spine.mode).toBe('template');
    expect(spineWidth(ing, { type: 'paperback', ink: 'bw', paper: 'cream' }, 200).widthIn).toBeNull();
    expect(ing.print!.pageCount.lastPageBlank).toBe(true);
    expect(ing.print!.interiorFile.pdfStandards).toEqual(['PDF/X-1a:2001', 'PDF/X-3:2002']);
    expect(ing.print!.formats.paperback!.cover.maxInkPercent).toBe(240);
  });

  it('every unverified section says why', () => {
    for (const f of ['kdp.json', 'ingramspark.json', 'draft2digital.json']) {
      const spec = parsePlatformSpec(read(f)).value!;
      for (const u of unverifiedSections(spec)) {
        if (f !== 'kdp.json') expect(u.note ?? '', `${f} ${u.path}`).not.toBe('');
      }
    }
  });
});
