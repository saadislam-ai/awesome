import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DesignSchema, LargePrintSpecSchema, largePrintChecks } from '../src';

const spec = LargePrintSpecSchema.parse(JSON.parse(fs.readFileSync(path.join(__dirname, '../../../specs/large-print.json'), 'utf8')));
const design = (patch: Record<string, unknown>) => DesignSchema.parse({ ...patch });
const byId = (checks: ReturnType<typeof largePrintChecks>) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

describe('large print checks', () => {
  it('the shipped guidance file names its source and the sizes it found there', () => {
    expect(spec.rules).toMatchObject({ minBodySizePt: 16, idealBodySizePt: 18, allowJustified: false, allowHyphenation: false });
    expect(spec.sources[0].url).toMatch(/^https:\/\/www\.ukaaf\.org\//);
    expect(spec.notes.join(' ')).toMatch(/not a quoted figure/);
  });

  it('fails an edition whose type is too small and warns about justified, hyphenated, tight text', () => {
    const checks = largePrintChecks({ spec, design: design({ fontSizePt: 12, lineHeight: 1.1, justify: true, hyphenate: true }), format: { coverFinish: 'gloss', label: 'Large print' }, italicPassages: 12 });
    expect(byId(checks)).toEqual({ 'lp-size': 'fail', 'lp-leading': 'warn', 'lp-align': 'warn', 'lp-hyphens': 'warn', 'lp-typeface': 'info', 'lp-italics': 'info', 'lp-cover': 'info' });
    expect(checks.find((c) => c.id === 'lp-size')!.detail).toContain('Large print starts at 16 pt; 18 pt is the size to aim for');
    expect(checks.every((c) => c.status === 'pass' || c.detail.length > 30)).toBe(true);
  });

  it('passes the edition the app creates, and remarks only on what is a matter of choice', () => {
    const made = design({ fontSizePt: 16, lineHeight: 1.4, justify: false, hyphenate: false });
    expect(byId(largePrintChecks({ spec, design: made, format: { coverFinish: 'matte', label: 'Large print' }, italicPassages: 0 }))).toEqual({
      'lp-size': 'info', 'lp-leading': 'pass', 'lp-align': 'pass', 'lp-hyphens': 'pass', 'lp-typeface': 'info', 'lp-italics': 'pass',
    });
    const ideal = design({ fontSizePt: 18, lineHeight: 1.4, justify: false, hyphenate: false, bodyFont: 'Source Sans 3' });
    expect(Object.values(byId(largePrintChecks({ spec, design: ideal, format: { coverFinish: 'matte', label: '' } }))).every((s) => s === 'pass')).toBe(true);
  });

  it('follows the numbers in the file, not numbers in the code', () => {
    const strict = { ...spec, rules: { ...spec.rules, minBodySizePt: 20, idealBodySizePt: 22 } };
    const checks = largePrintChecks({ spec: strict, design: design({ fontSizePt: 18, lineHeight: 1.4, justify: false, hyphenate: false }), format: { coverFinish: 'matte', label: '' } });
    expect(byId(checks)['lp-size']).toBe('fail');
    expect(checks[0].detail).toContain('20 pt');
  });
});
