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
  /** Size of the cover file. Normally the cover with its bleed; the platform's template sheet when one was entered. */
  widthIn: number;
  heightIn: number;
  /** The cover itself inside the file, including bleed or wrap. Equal to the whole file unless a template sheet is used. */
  art: Rect;
  /** True when the cover sits in the centre of a larger template sheet. */
  onSheet: boolean;
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
  /**
   * Document size of the platform's template (IngramSpark prints it at the
   * bottom left of the template). When it is larger than the cover, the file
   * is made in that size with the cover in the centre.
   */
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
      widthIn: r4(2 * b + 2 * tw + s), heightIn: r4(2 * b + th), bleedIn: b, art: rect(0, 0, 2 * b + 2 * tw + s, 2 * b + th), onSheet: false,
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
      widthIn: r4(2 * wrap + 2 * bw + 2 * gap + s), heightIn: r4(2 * wrap + bh), bleedIn: wrap, art: rect(0, 0, 2 * wrap + 2 * bw + 2 * gap + s, 2 * wrap + bh), onSheet: false,
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
      widthIn: r4(2 * b + 2 * dj.flapIn + 2 * dj.flapWrapIn + 2 * pw + s), heightIn: r4(2 * b + ph), bleedIn: b, art: rect(0, 0, 2 * b + 2 * dj.flapIn + 2 * dj.flapWrapIn + 2 * pw + s, 2 * b + ph), onSheet: false,
      trim: rect(b, b, 2 * dj.flapIn + 2 * dj.flapWrapIn + 2 * pw + s, ph), back, spine, front, backFlap, frontFlap, hinges: [],
      safe: { back: inset(back, jm), front: inset(front, jm), spine: spineTextAllowed ? inset(spine, spineMargin, jm) : null, backFlap: inset(backFlap, jm), frontFlap: inset(frontFlap, jm) },
      barcode: barcodeBox(back, 0, 0),
    };
    if ((dj.maxTrimWidthIn && tw > dj.maxTrimWidthIn + 1e-6) || (dj.maxTrimHeightIn && th > dj.maxTrimHeightIn + 1e-6)) {
      problems.push(`${name} makes dust jackets up to ${dj.maxTrimWidthIn} x ${dj.maxTrimHeightIn} in; this book is ${tw} x ${th} in.`);
    }
  }

  // The platform's own template sheet, when its document size was entered.
  if (opts.templateWidthIn && opts.templateHeightIn) {
    const dw = opts.templateWidthIn - g.widthIn;
    const dh = opts.templateHeightIn - g.heightIn;
    if (dw < -0.02 || dh < -0.02) {
      problems.push(`The template size you entered (${opts.templateWidthIn} x ${opts.templateHeightIn} in) is smaller than the cover worked out from the spine width (${g.widthIn} x ${g.heightIn} in). Check the template size, the spine width, the page count and the trim size.`);
    } else if (dw > 0.02 || dh > 0.02) {
      g = placeOnSheet(g, opts.templateWidthIn, opts.templateHeightIn);
      cautions.push(`The cover (${g.art.w} x ${g.art.h} in with bleed) is placed in the centre of the ${name} template sheet of ${g.widthIn} x ${g.heightIn} in. Lay the result over your template once to confirm that the trim marks line up.`);
    }
  } else if (spineRes.mode === 'template') {
    cautions.push(`${name} asks for the cover in the document size of its template (printed at the bottom left of the template). Enter that size for the edition to export on the template sheet; without it the file has the size of the cover with bleed.`);
  }
  if (spineRes.mode === 'template') cautions.push(`The spine width (${s} in) comes from the ${name} template you entered. Generate a new template whenever the page count or paper changes.`);
  if (g.barcode.x < g.back.x + m - 1e-6 || g.barcode.y < g.back.y + m - 1e-6) problems.push('The back cover is too small for the barcode box.');
  return { geometry: g, problems, cautions };
}

/** Move a finished layout onto a larger sheet, centred. Every rectangle shifts by the same amount. */
export function placeOnSheet(g: CoverGeometry, sheetWidthIn: number, sheetHeightIn: number): CoverGeometry {
  const dx = (sheetWidthIn - g.widthIn) / 2;
  const dy = (sheetHeightIn - g.heightIn) / 2;
  const mv = (r: Rect): Rect => rect(r.x + dx, r.y + dy, r.w, r.h);
  const opt = (r: Rect | null): Rect | null => (r ? mv(r) : null);
  return {
    ...g,
    widthIn: r4(sheetWidthIn), heightIn: r4(sheetHeightIn), onSheet: true,
    art: mv(g.art), trim: mv(g.trim), back: mv(g.back), spine: mv(g.spine), front: mv(g.front),
    backFlap: opt(g.backFlap), frontFlap: opt(g.frontFlap), hinges: g.hinges.map(mv), barcode: mv(g.barcode),
    safe: { back: mv(g.safe.back), front: mv(g.safe.front), spine: opt(g.safe.spine), backFlap: opt(g.safe.backFlap), frontFlap: opt(g.safe.frontFlap) },
  };
}

/** Is rectangle `a` fully inside rectangle `b` (with a small tolerance)? */
export function rectInside(a: Rect, b: Rect, tol = 0.001): boolean {
  return a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
