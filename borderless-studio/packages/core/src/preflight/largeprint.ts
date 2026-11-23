/**
 * Checks for a large print edition. The thresholds come from
 * specs/large-print.json (accessible format guidance, with its source and
 * the day it was read), not from this code.
 */
import { z } from 'zod';
import { fontInfo } from '../fonts/catalog';
import type { Host } from '../host';
import type { BookFormat } from '../model/book';
import type { Design } from '../model/design';
import type { PdfReport } from '../pdf/inspect';
import { joinPath } from '../util/paths';
import type { Check } from './index';

export const LargePrintSpecSchema = z.object({
  schemaVersion: z.literal(1),
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().url() })).min(1),
  rules: z.object({
    minBodySizePt: z.number().min(8).max(40),
    idealBodySizePt: z.number().min(8).max(40),
    giantPrintSizePt: z.number().min(8).max(60).optional(),
    /** Smallest line height, as a multiple of the type size. */
    minLineHeight: z.number().min(1).max(2.5),
    allowJustified: z.boolean(),
    allowHyphenation: z.boolean(),
    sansSerifPreferred: z.boolean(),
    avoidItalics: z.boolean(),
    glossyCoverAllowed: z.boolean(),
  }),
  notes: z.array(z.string()).default([]),
});
export type LargePrintSpec = z.infer<typeof LargePrintSpecSchema>;

/** The large print rules: the personal copy in the library when there is a valid one, otherwise the shipped file. */
export async function loadLargePrintSpec(host: Host, bundledSpecsDir: string, userSpecsDir?: string): Promise<LargePrintSpec | null> {
  for (const dir of [userSpecsDir, bundledSpecsDir]) {
    if (!dir) continue;
    const file = joinPath(dir, 'large-print.json');
    if (!(await host.exists(file))) continue;
    const parsed = LargePrintSpecSchema.safeParse(JSON.parse(await host.readText(file).catch(() => 'null')));
    if (parsed.success) return parsed.data;
  }
  return null;
}

export interface LargePrintInput {
  spec: LargePrintSpec;
  /** The design as built for this edition (book design with the edition's own settings applied). */
  design: Design;
  format: Pick<BookFormat, 'coverFinish' | 'label'>;
  /** Number of passages in italics in the text, when known. */
  italicPassages?: number;
  /** The finished PDF, when there is one: the smallest type in it is reported. */
  pdf?: PdfReport;
}

const pt = (n: number): string => `${Math.round(n * 10) / 10} pt`;

/** One check for each rule. A fault is a "fail" only for the type size; the rest are warnings and remarks. */
export function largePrintChecks(input: LargePrintInput): Check[] {
  const { spec, design, format } = input;
  const r = spec.rules;
  const where = 'Book, Editions: the large print edition has its own type settings.';
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'group'>) => checks.push({ group: 'text', ...c });

  const size = design.fontSizePt;
  if (size < r.minBodySizePt) {
    add({ id: 'lp-size', title: 'Large print: type size', status: 'fail', detail: `The body text is set in ${pt(size)}. Large print starts at ${pt(r.minBodySizePt)}; ${pt(r.idealBodySizePt)} is the size to aim for.`, fix: `Set the type size of this edition to at least ${r.minBodySizePt} pt. ${where}` });
  } else if (size < r.idealBodySizePt) {
    add({ id: 'lp-size', title: 'Large print: type size', status: 'info', detail: `The body text is set in ${pt(size)}, which meets the minimum of ${pt(r.minBodySizePt)}. ${pt(r.idealBodySizePt)} is the size the guidance prefers, at the price of more pages.` });
  } else {
    add({ id: 'lp-size', title: 'Large print: type size', status: 'pass', detail: `The body text is set in ${pt(size)} (the guidance prefers ${pt(r.idealBodySizePt)} or more).` });
  }

  add(design.lineHeight < r.minLineHeight
    ? { id: 'lp-leading', title: 'Large print: line spacing', status: 'warn', detail: `Lines are set ${design.lineHeight} times the type size apart. Lines closer than ${r.minLineHeight} are hard to tell apart for readers with low vision.`, fix: `Set the line height of this edition to ${r.minLineHeight} or more. ${where}` }
    : { id: 'lp-leading', title: 'Large print: line spacing', status: 'pass', detail: `Lines are set ${design.lineHeight} times the type size apart.` });

  add(design.justify && !r.allowJustified
    ? { id: 'lp-align', title: 'Large print: alignment', status: 'warn', detail: 'The text is justified (both edges straight). That makes the spaces between words uneven, which is tiring to follow in large type.', fix: `Switch justification off for this edition, so lines are even on the left only. ${where}` }
    : { id: 'lp-align', title: 'Large print: alignment', status: 'pass', detail: design.justify ? 'The text is justified.' : 'The text is aligned to the left, with even spaces between words.' });

  add(design.hyphenate && !r.allowHyphenation
    ? { id: 'lp-hyphens', title: 'Large print: words split at line ends', status: 'warn', detail: 'Hyphenation is on, so words are split across two lines. Readers who use magnification see only part of a line at a time and lose split words.', fix: `Switch hyphenation off for this edition. ${where}` }
    : { id: 'lp-hyphens', title: 'Large print: words split at line ends', status: 'pass', detail: design.hyphenate ? 'Words may be split at line ends.' : 'Words are not split at line ends.' });

  const face = fontInfo(design.bodyFont);
  if (r.sansSerifPreferred && face && face.kind === 'serif') {
    add({ id: 'lp-typeface', title: 'Large print: typeface', status: 'info', detail: `The body is set in ${design.bodyFont}, a serif typeface. The summary of the guidance names a sans serif typeface, while its detail says the evidence between the two is not definitive. A clear serif at this size is widely used for large print books; change it only if your readers ask.` });
  } else {
    add({ id: 'lp-typeface', title: 'Large print: typeface', status: 'pass', detail: `The body is set in ${design.bodyFont}.` });
  }

  if (r.avoidItalics && input.italicPassages !== undefined) {
    add(input.italicPassages > 0
      ? { id: 'lp-italics', title: 'Large print: italics', status: 'info', detail: `The text has ${input.italicPassages.toLocaleString('en-AU')} passage${input.italicPassages === 1 ? '' : 's'} in italics. Italic letters are harder to recognise in low vision; a few words are fine, long passages are better in bold or in quotation marks.` }
      : { id: 'lp-italics', title: 'Large print: italics', status: 'pass', detail: 'The text uses no italics.' });
  }

  if (format.coverFinish === 'gloss' && !r.glossyCoverAllowed) {
    add({ id: 'lp-cover', title: 'Large print: cover finish', status: 'info', detail: 'The cover has a gloss finish. Glare from glossy surfaces is a problem for many readers with low vision; a matte cover is kinder.', fix: 'Choose the matte finish for this edition under Book, Editions.' });
  }

  const smallest = input.pdf?.pages.reduce<number | null>((min, p) => (p.minFontPt !== null && (min === null || p.minFontPt < min) ? p.minFontPt : min), null) ?? null;
  if (smallest !== null && smallest < r.minBodySizePt - 0.5) {
    add({ id: 'lp-smallest', title: 'Large print: smallest type in the file', status: 'info', detail: `The smallest type in the finished file is ${pt(smallest)} (page numbers, running heads, notes or the copyright page). The guidance asks that such text is ideally as large as the body.` });
  }
  return checks;
}
