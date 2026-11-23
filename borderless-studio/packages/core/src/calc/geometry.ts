/**
 * Page geometry: margins from platform rules and page count, bleed, and the
 * position of running heads and page numbers inside the margins.
 *
 * Nothing here knows about a particular platform. The numbers arrive as
 * `InteriorRules`, which the specs module reads from the editable spec files.
 */
import type { Margins } from '../model/design';
import { ceilIn, roundIn } from './units';

export interface GutterBand {
  minPages: number;
  maxPages: number;
  /** Minimum inside (gutter) margin for books in this page range, inches. */
  insideIn: number;
}

export interface InteriorRules {
  /** Platform id the rules came from, for messages. */
  platform: string;
  platformName: string;
  gutterBands: GutterBand[];
  /** Minimum top, bottom and outside margin for anything printed, without bleed. */
  outsideMinNoBleedIn: number;
  /** The same minimum when the interior has bleed. */
  outsideMinWithBleedIn: number;
  bleedIn: number;
  minPages: number;
  maxPages: number;
  /** Final page count must be a multiple of this (2 for most presses). */
  pageMultiple: number;
  /** The press needs the last page to be empty (IngramSpark prints production data there). */
  lastPageBlank: boolean;
}

/** Neutral rules used for previews when no platform is chosen: generous enough for any press. */
export const GENERIC_RULES: InteriorRules = {
  platform: 'generic',
  platformName: 'Generic print',
  gutterBands: [
    { minPages: 1, maxPages: 150, insideIn: 0.375 },
    { minPages: 151, maxPages: 300, insideIn: 0.5 },
    { minPages: 301, maxPages: 500, insideIn: 0.625 },
    { minPages: 501, maxPages: 700, insideIn: 0.75 },
    { minPages: 701, maxPages: 100000, insideIn: 0.875 },
  ],
  outsideMinNoBleedIn: 0.25,
  outsideMinWithBleedIn: 0.375,
  bleedIn: 0.125,
  minPages: 1,
  maxPages: 100000,
  pageMultiple: 2,
  lastPageBlank: false,
};

/** Combine the rules of several platforms into the strictest set, so one PDF can satisfy all of them. */
export function strictestRules(rules: InteriorRules[]): InteriorRules {
  if (rules.length === 0) return GENERIC_RULES;
  if (rules.length === 1) return rules[0];
  const breakpoints = new Set<number>();
  for (const r of rules) for (const b of r.gutterBands) breakpoints.add(b.minPages);
  const starts = [...breakpoints].sort((a, b) => a - b);
  const maxPages = Math.min(...rules.map((r) => r.maxPages));
  const bands: GutterBand[] = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] - 1 : Math.max(...rules.map((r) => r.gutterBands[r.gutterBands.length - 1].maxPages));
    return { minPages: start, maxPages: end, insideIn: Math.max(...rules.map((r) => minInsideMargin(r, start))) };
  });
  return {
    platform: rules.map((r) => r.platform).join('+'),
    platformName: rules.map((r) => r.platformName).join(' + '),
    gutterBands: bands,
    outsideMinNoBleedIn: Math.max(...rules.map((r) => r.outsideMinNoBleedIn)),
    outsideMinWithBleedIn: Math.max(...rules.map((r) => r.outsideMinWithBleedIn)),
    bleedIn: Math.max(...rules.map((r) => r.bleedIn)),
    minPages: Math.max(...rules.map((r) => r.minPages)),
    maxPages,
    pageMultiple: rules.reduce((m, r) => lcm(m, r.pageMultiple), 1),
    lastPageBlank: rules.some((r) => r.lastPageBlank),
  };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

/** The platform's minimum inside margin for a page count. */
export function minInsideMargin(rules: InteriorRules, pageCount: number): number {
  const bands = rules.gutterBands;
  if (bands.length === 0) return 0;
  for (const b of bands) if (pageCount >= b.minPages && pageCount <= b.maxPages) return b.insideIn;
  // Below the first band use the first; above the last use the last (the page count check reports the real problem).
  return pageCount < bands[0].minPages ? bands[0].insideIn : bands[bands.length - 1].insideIn;
}

export function minOuterMargin(rules: InteriorRules, bleed: boolean): number {
  return bleed ? rules.outsideMinWithBleedIn : rules.outsideMinNoBleedIn;
}

export interface ResolvedMargins {
  /** Margins of the text block, inches, measured from the trim edge. */
  margins: Margins;
  /** Which sides had to be widened to satisfy the platform, with the reason. */
  raised: string[];
  /** Space between the bottom of the running head and the top of the text, inches. */
  headerGapIn: number;
  /** Space between the bottom of the text and the top of the page number, inches. */
  footerGapIn: number;
}

export interface FurnitureSizes {
  /** Height of the running head line in points (0 when there is none). */
  headPt: number;
  /** Height of the page number line in points (0 when there is none). */
  footPt: number;
}

/**
 * Final margins for a given page count. The author's preferred margins are
 * kept unless the platform requires more. Running heads and page numbers are
 * placed inside the top and bottom margins and must themselves stay clear of
 * the platform's minimum distance from the trim edge, so those margins are
 * widened when the head or folio would not fit.
 */
export function resolveMargins(
  preferred: Margins,
  rules: InteriorRules,
  pageCount: number,
  bleed: boolean,
  furniture: FurnitureSizes,
): ResolvedMargins {
  const raised: string[] = [];
  const insideMin = minInsideMargin(rules, pageCount);
  const outerMin = minOuterMargin(rules, bleed);
  const m: Margins = { ...preferred };
  // A small safety allowance so rounding in a PDF viewer can never report a violation.
  const eps = 0.01;

  if (m.inside < insideMin + eps) {
    m.inside = ceilIn(insideMin + eps, 3);
    raised.push(`Inside margin raised to ${m.inside} in: ${rules.platformName} needs at least ${insideMin} in for ${pageCount} pages.`);
  }
  if (m.outside < outerMin + eps) {
    m.outside = ceilIn(outerMin + eps, 3);
    raised.push(`Outside margin raised to ${m.outside} in (${rules.platformName} minimum ${outerMin} in).`);
  }

  // Running head: sits above the text block, inside the top margin.
  const headIn = furniture.headPt / 72;
  const footIn = furniture.footPt / 72;
  const minGap = 0.14;
  const needTop = outerMin + eps + (headIn > 0 ? headIn + minGap : 0);
  if (m.top < needTop) {
    m.top = ceilIn(needTop, 3);
    raised.push(`Top margin raised to ${m.top} in so the running head stays ${outerMin} in clear of the trim edge.`);
  }
  const needBottom = outerMin + eps + (footIn > 0 ? footIn + minGap : 0);
  if (m.bottom < needBottom) {
    m.bottom = ceilIn(needBottom, 3);
    raised.push(`Bottom margin raised to ${m.bottom} in so the page number stays ${outerMin} in clear of the trim edge.`);
  }
  // Place the head about 40% of the way up the free space, but never closer to the edge than allowed.
  const headerGapIn = headIn > 0 ? roundIn(Math.max(minGap, Math.min(0.3, (m.top - outerMin - eps - headIn) * 0.6)), 4) : 0.2;
  const footerGapIn = footIn > 0 ? roundIn(Math.max(minGap, Math.min(0.32, (m.bottom - outerMin - eps - footIn) * 0.6)), 4) : 0.2;
  return { margins: m, raised, headerGapIn, footerGapIn };
}

export interface PageSize {
  /** Trim size, inches. */
  trimWidthIn: number;
  trimHeightIn: number;
  bleedIn: number;
  /** Size of the PDF page including bleed (bleed is added to the top, bottom and outside edge only). */
  pdfWidthIn: number;
  pdfHeightIn: number;
}

export function pageSize(trimWidthIn: number, trimHeightIn: number, bleed: boolean, rules: InteriorRules): PageSize {
  const b = bleed ? rules.bleedIn : 0;
  return {
    trimWidthIn,
    trimHeightIn,
    bleedIn: b,
    pdfWidthIn: roundIn(trimWidthIn + b, 4),
    pdfHeightIn: roundIn(trimHeightIn + 2 * b, 4),
  };
}

/** Round a page count up to the press's multiple (normally to an even number). */
export function paddedPageCount(pages: number, rules: InteriorRules): number {
  const m = Math.max(1, rules.pageMultiple);
  return Math.ceil(pages / m) * m;
}

export interface PageCountCheck {
  ok: boolean;
  message?: string;
}

export function checkPageCount(pages: number, min: number, max: number, platformName: string): PageCountCheck {
  if (pages < min) {
    return { ok: false, message: `${platformName} needs at least ${min} pages for this trim size and paper; the book has ${pages}.` };
  }
  if (pages > max) {
    return { ok: false, message: `${platformName} allows at most ${max} pages for this trim size and paper; the book has ${pages}.` };
  }
  return { ok: true };
}
