/**
 * Cover geometry: the size of the cover file and where each panel, fold and
 * safe zone lies, worked out from the platform's spec file.
 *
 * All measurements are inches. The origin is the top left corner of the
 * cover file; x runs to the right and y runs down. A cover is laid out as
 * a reader sees the outside of an open book lying face down:
 *
 *   [back flap] back cover | spine | front cover [front flap]
 */
import type { BookFormat, PlatformId } from '../model/book';
import { findTrim, printFormat, spineWidth } from '../specs';
import type { PlatformSpec } from '../specs/schema';
import { roundIn } from '../calc/units';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CoverKind = 'paperback' | 'case-laminate' | 'dust-jacket';

export const COVER_KIND_LABEL: Record<CoverKind, string> = {
  paperback: 'Paperback cover',
  'case-laminate': 'Hardcover case',
  'dust-jacket': 'Dust jacket',
};

export interface CoverGeometry {
  platform: PlatformId;
  platformName: string;
  kind: CoverKind;
  pages: number;
  trimWidthIn: number;
  trimHeightIn: number;
  /** Size of the cover file. */
  widthIn: number;
  heightIn: number;
  /** Paper beyond the fold or trim lines on the outer edges: bleed, or the wrap of a hardcover case. */
  bleedIn: number;
  /** What stays visible: inside the trim lines (paperback, jacket) or the outer fold lines (case). */
  trim: Rect;
  back: Rect;
  spine: Rect;
  front: Rect;
  backFlap: Rect | null;
  frontFlap: Rect | null;
  /** Strips next to the spine of a hardcover where the cover bends; nothing important goes here. */
  hinges: Rect[];
  /** Where text and important art are safe. */
  safe: { back: Rect; front: Rect; spine: Rect | null; backFlap: Rect | null; frontFlap: Rect | null };
  /** The barcode box in its default position on the back cover. */
  barcode: Rect;
  barcodeRequired: boolean;
  platformAddsBarcode: boolean;
  spineWidthIn: number;
  /** How the spine width was obtained ("204 pages x 0.0025 in"). */
  spineBasis: string;
  spineTextAllowed: boolean;
  /** Why spine text is not allowed, when it is not. */
  spineTextReason?: string;
  maxInkPercent: number | null;
  colorSpace: 'cmyk' | 'rgb-or-cmyk';
  minImageDpi: number;
  notes: string[];
}

export interface CoverGeometryResult {
  geometry: CoverGeometry | null;
  /** Reasons the cover cannot be laid out or exported yet. */
  problems: string[];
  /** Things to double check. */
  cautions: string[];
}

const r4 = (v: number): number => roundIn(v, 4);
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x: r4(x), y: r4(y), w: r4(w), h: r4(h) });
export const inset = (r: Rect, left: number, top = left, right = left, bottom = top): Rect =>
  rect(r.x + left, r.y + top, Math.max(0, r.w - left - right), Math.max(0, r.h - top - bottom));

/** Which cover files an edition needs on a platform. A jacketed hardcover needs the case and the jacket. */
export function coverKindsFor(spec: PlatformSpec, format: Pick<BookFormat, 'type' | 'binding'>): CoverKind[] {
  if (format.type === 'ebook') return [];
  if (format.type === 'paperback') return ['paperback'];
  const offered = printFormat(spec, 'hardcover')?.bindings ?? [];
  if (format.binding === 'dust-jacket' && offered.includes('dust-jacket')) return ['case-laminate', 'dust-jacket'];
  return ['case-laminate'];
}

export interface CoverGeometryOptions {
  kind?: CoverKind;
  /** Spine width from the platform's template, for platforms that publish no formula. */
  templateSpineIn?: number | null;
  /** Full size of the platform's template, to compare with the calculated size. */
  templateWidthIn?: number | null;
  templateHeightIn?: number | null;
}

export function coverGeometry(
  spec: PlatformSpec,
  format: Pick<BookFormat, 'type' | 'trim' | 'paper' | 'ink' | 'binding'>,
  pages: number,
  opts: CoverGeometryOptions = {},
): CoverGeometryResult {
  const problems: string[] = [];
  const cautions: string[] = [];
  const name = spec.displayName;
  if (format.type === 'ebook') return { geometry: null, problems: ['An ebook has no print cover. Use the ebook cover export.'], cautions };
  const pf = printFormat(spec, format.type);
  const trim = pf ? findTrim(spec, format.type, format.trim) : null;
  if (!pf || !trim) {
    return { geometry: null, problems: [`${name} does not offer ${format.type} books in the trim size ${format.trim}.`], cautions };
  }
  const kind: CoverKind = opts.kind ?? (format.type === 'paperback' ? 'paperback' : 'case-laminate');
  const c = pf.cover;
  const tw = trim.widthIn;
  const th = trim.heightIn;
  if (kind === 'dust-jacket' && !c.dustJacket) {
    return { geometry: null, problems: [`${name} does not make dust jackets (its spec file has no dust jacket section).`], cautions };
  }

  const spineRes = spineWidth(spec, format, pages, opts.templateSpineIn ?? null);
  if (spineRes.widthIn === null) {
    return { geometry: null, problems: [spineRes.problem ?? 'The spine width is not known.'], cautions };
  }
  const s = spineRes.widthIn;
  const sp = pf.spine;
  // Narrow spines get a smaller text margin on some platforms.
  const spineMargin = sp.narrowBelowIn !== null && sp.narrowTextMarginIn !== null && s < sp.narrowBelowIn ? sp.narrowTextMarginIn : (sp.textMarginIn ?? 0.0625);
  let spineTextAllowed = spineRes.textAllowed;
  let spineTextReason: string | undefined;
  if (!spineTextAllowed && spineRes.minPagesForText !== null) {
    spineTextReason = `${name} allows spine text from ${spineRes.minPagesForText} pages; this book has ${pages}.`;
  }
  if (spineTextAllowed && s - 2 * spineMargin < 0.08) {
    spineTextAllowed = false;
    spineTextReason = `The spine is only ${s} in wide, too narrow for readable text.`;
  }

  let g: CoverGeometry;
  const base = {
    platform: spec.platform, platformName: name, kind, pages, trimWidthIn: tw, trimHeightIn: th,
    spineWidthIn: s, spineBasis: spineRes.basis, spineTextAllowed, spineTextReason,
    barcodeRequired: c.barcode.required, platformAddsBarcode: c.barcode.platformAdds,
    maxInkPercent: c.maxInkPercent, colorSpace: c.colorSpace, minImageDpi: c.minImageDpi, notes: [...c.notes],
  };
  const m = c.safeMarginIn;
  const barcodeBox = (back: Rect, spineSideClear: number, bottomClear: number): Rect => {
    const fromSpine = c.barcode.fromSpineIn ?? Math.max(0.375, m + 0.125);
    const fromBottom = c.barcode.fromBottomIn ?? Math.max(0.375, m + 0.125);
    return rect(back.x + back.w - spineSideClear - fromSpine - c.barcode.widthIn, back.y + back.h - bottomClear - fromBottom - c.barcode.heightIn, c.barcode.widthIn, c.barcode.heightIn);
  };

  if (kind === 'paperback') {
    const b = c.bleedIn;
    const back = rect(b, b, tw, th);
    const spine = rect(b + tw, b, s, th);
    const front = rect(b + tw + s, b, tw, th);
    g = {
      ...base,
      widthIn: r4(2 * b + 2 * tw + s), heightIn: r4(2 * b + th), bleedIn: b,
      trim: rect(b, b, 2 * tw + s, th), back, spine, front, backFlap: null, frontFlap: null, hinges: [],
      safe: { back: inset(back, m), front: inset(front, m), spine: spineTextAllowed ? inset(spine, spineMargin, m) : null, backFlap: null, frontFlap: null },
      barcode: barcodeBox(back, 0, 0),
    };
  } else if (kind === 'case-laminate') {
    const wrap = c.wrapIn;
    const hinge = c.hingeIn;
    const bw = tw + c.boardExtraWidthIn;
    const bh = th + c.boardExtraHeightIn;
    const gap = c.hingeInsidePanel ? 0 : hinge;
    const back = rect(wrap, wrap, bw, bh);
    const spine = rect(wrap + bw + gap, wrap, s, bh);
    const front = rect(wrap + bw + gap + s + gap, wrap, bw, bh);
    const hinges = hinge > 0 ? [rect(spine.x - hinge, wrap, hinge, bh), rect(spine.x + s, wrap, hinge, bh)] : [];
    // When the hinge lies inside the panel, the safe zone stops at the hinge.
    const inner = c.hingeInsidePanel ? hinge + m : m;
    g = {
      ...base,
      widthIn: r4(2 * wrap + 2 * bw + 2 * gap + s), heightIn: r4(2 * wrap + bh), bleedIn: wrap,
      trim: rect(wrap, wrap, 2 * bw + 2 * gap + s, bh), back, spine, front, backFlap: null, frontFlap: null, hinges,
      safe: { back: inset(back, m, m, inner, m), front: inset(front, inner, m, m, m), spine: spineTextAllowed ? inset(spine, spineMargin, m) : null, backFlap: null, frontFlap: null },
      barcode: barcodeBox(back, c.hingeInsidePanel ? hinge : 0, 0),
    };
    if (c.boardExtraWidthIn < 0) cautions.push(`${name} boards are ${Math.abs(c.boardExtraWidthIn)} in narrower than the page; the art is laid out for the board, not the page.`);
  } else {
    const dj = c.dustJacket!;
    const b = dj.bleedIn;
    const pw = tw + dj.panelExtraWidthIn;
    const ph = th + dj.panelExtraHeightIn;
    const backFlap = rect(b, b, dj.flapIn, ph);
    const back = rect(b + dj.flapIn + dj.flapWrapIn, b, pw, ph);
    const spine = rect(back.x + pw, b, s, ph);
    const front = rect(spine.x + s, b, pw, ph);
    const frontFlap = rect(front.x + pw + dj.flapWrapIn, b, dj.flapIn, ph);
    const jm = dj.safeMarginIn;
    g = {
      ...base,
      widthIn: r4(2 * b + 2 * dj.flapIn + 2 * dj.flapWrapIn + 2 * pw + s), heightIn: r4(2 * b + ph), bleedIn: b,
      trim: rect(b, b, 2 * dj.flapIn + 2 * dj.flapWrapIn + 2 * pw + s, ph), back, spine, front, backFlap, frontFlap, hinges: [],
      safe: { back: inset(back, jm), front: inset(front, jm), spine: spineTextAllowed ? inset(spine, spineMargin, jm) : null, backFlap: inset(backFlap, jm), frontFlap: inset(frontFlap, jm) },
      barcode: barcodeBox(back, 0, 0),
    };
    if ((dj.maxTrimWidthIn && tw > dj.maxTrimWidthIn + 1e-6) || (dj.maxTrimHeightIn && th > dj.maxTrimHeightIn + 1e-6)) {
      problems.push(`${name} makes dust jackets up to ${dj.maxTrimWidthIn} x ${dj.maxTrimHeightIn} in; this book is ${tw} x ${th} in.`);
    }
  }

  // Compare with the platform's own template when its size was entered.
  if (opts.templateWidthIn && opts.templateHeightIn) {
    const dw = Math.abs(opts.templateWidthIn - g.widthIn);
    const dh = Math.abs(opts.templateHeightIn - g.heightIn);
    if (dw > 0.02 || dh > 0.02) {
      cautions.push(`The calculated cover is ${g.widthIn} x ${g.heightIn} in, but the template you entered is ${opts.templateWidthIn} x ${opts.templateHeightIn} in. Check the page count, paper and trim size used for the template.`);
    }
  }
  if (spineRes.mode === 'template') cautions.push(`The spine width (${s} in) comes from the ${name} template you entered. Generate a new template whenever the page count or paper changes.`);
  if (g.barcode.x < g.back.x + m - 1e-6 || g.barcode.y < g.back.y + m - 1e-6) problems.push('The back cover is too small for the barcode box.');
  return { geometry: g, problems, cautions };
}

/** Is rectangle `a` fully inside rectangle `b` (with a small tolerance)? */
export function rectInside(a: Rect, b: Rect, tol = 0.001): boolean {
  return a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
