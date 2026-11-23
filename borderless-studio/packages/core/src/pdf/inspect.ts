/**
 * PDF inspector. Opens a finished PDF and reports what is really inside it:
 * page sizes and boxes, every font and whether it is embedded, every image
 * with its colour space and printed resolution, the colour spaces used by
 * text and line work, transparency, annotations, and the rectangle that
 * contains all the ink on each page.
 *
 * The preflight checker and the automated tests are built on this, so they
 * judge the file a printer will receive, not what the app meant to produce.
 */
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, PDFHexString,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  IDENTITY, apply, emptyBox, growBox, isEmptyBox, multiply, num, operations, unionBox,
  type BBox, type Matrix, type Operand,
} from './content';

export type ColorFamily = 'gray' | 'rgb' | 'cmyk' | 'icc-gray' | 'icc-rgb' | 'icc-cmyk' | 'cal-gray' | 'cal-rgb' | 'lab' | 'spot' | 'indexed' | 'pattern' | 'unknown';

export interface PdfFontInfo {
  /** BaseFont name, including the subset prefix (ABCDEF+Name). */
  name: string;
  /** Type0, Type1, TrueType, Type3 ... */
  type: string;
  embedded: boolean;
  subset: boolean;
  pages: number[];
}

export interface PdfImageInfo {
  page: number;
  /** Resource name on the page. */
  name: string;
  widthPx: number;
  heightPx: number;
  color: ColorFamily;
  bitsPerComponent: number;
  filter: string;
  hasSoftMask: boolean;
  /** Printed size on the page, points. */
  widthPt: number;
  heightPt: number;
  /** Pixels per inch at the printed size (the lower of the two directions). */
  dpi: number;
  /** Rectangle the image covers on the page (PDF coordinates, origin bottom left). */
  box: BBox;
}

export interface PdfPageInfo {
  /** 1 based page number. */
  number: number;
  width: number;
  height: number;
  media: BBox;
  trim: BBox;
  bleed: BBox;
  /** True when the page defines its own TrimBox. */
  hasTrimBox: boolean;
  /** Rectangle containing every mark on the page; null for an empty page. */
  ink: BBox | null;
  /** Rectangle containing only the text. */
  text: BBox | null;
  /** Colour spaces used by text and line work (not images). */
  colors: ColorFamily[];
  annotations: number;
  usesTransparency: boolean;
  /** Smallest type size on the page in points; null when there is no text or the page was not analysed. */
  minFontPt: number | null;
}

export interface PdfReport {
  version: string;
  pageCount: number;
  pages: PdfPageInfo[];
  fonts: PdfFontInfo[];
  images: PdfImageInfo[];
  info: Record<string, string>;
  /** The PDF/X conformance the file declares ("PDF/X-1a:2001"), or null. */
  pdfx: string | null;
  /** True when the file carries an XMP metadata packet. */
  hasXmp: boolean;
  /** Output intents (PDF/X): subtype and condition identifier. */
  outputIntents: { subtype: string; condition: string; hasProfile: boolean }[];
  encrypted: boolean;
  hasOutline: boolean;
  tagged: boolean;
  usesObjectStreams: boolean;
  /** Problems met while reading (unsupported constructs); empty for files made by this app. */
  notes: string[];
}

export interface InspectOptions {
  /** Skip the per page content analysis (ink boxes, colours). Much faster for a quick page count. */
  shallow?: boolean;
  /** Only analyse these pages (1 based). */
  pages?: number[];
}

/* ------------------------------------------------------------------ */
/* Small helpers over pdf-lib objects                                  */
/* ------------------------------------------------------------------ */

class Reader {
  constructor(readonly doc: PDFDocument) {}

  get<T = unknown>(o: unknown): T | undefined {
    if (o instanceof PDFRef) return this.doc.context.lookup(o) as T | undefined;
    return o as T | undefined;
  }

  dict(o: unknown): PDFDict | undefined {
    const v = this.get(o);
    if (v instanceof PDFDict) return v;
    if (v instanceof PDFStream) return v.dict;
    return undefined;
  }

  name(o: unknown): string | undefined {
    const v = this.get(o);
    return v instanceof PDFName ? v.decodeText() : undefined;
  }

  number(o: unknown, fallback = 0): number {
    const v = this.get(o);
    return v instanceof PDFNumber ? v.asNumber() : fallback;
  }

  array(o: unknown): unknown[] {
    const v = this.get(o);
    return v instanceof PDFArray ? v.asArray() : [];
  }

  text(o: unknown): string | undefined {
    const v = this.get(o);
    if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
    if (v instanceof PDFName) return v.decodeText();
    return undefined;
  }

  /** Decoded bytes of a stream (Flate and the other simple filters). */
  bytes(o: unknown): Uint8Array {
    const v = this.get(o);
    if (v instanceof PDFRawStream) {
      try {
        return decodePDFRawStream(v).decode();
      } catch {
        return v.contents;
      }
    }
    if (v instanceof PDFStream) return v.getContents();
    return new Uint8Array(0);
  }

  /** Page contents: one stream or an array of streams, joined. */
  contents(o: unknown): Uint8Array {
    const v = this.get(o);
    if (v instanceof PDFArray) {
      const parts = v.asArray().map((x) => this.bytes(x));
      const total = parts.reduce((n, p) => n + p.length + 1, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
        out[off++] = 10;
      }
      return out;
    }
    return this.bytes(v);
  }

  colorFamily(cs: unknown): ColorFamily {
    const v = this.get(cs);
    if (v instanceof PDFName) {
      const n = v.decodeText();
      if (n === 'DeviceGray' || n === 'G') return 'gray';
      if (n === 'DeviceRGB' || n === 'RGB') return 'rgb';
      if (n === 'DeviceCMYK' || n === 'CMYK') return 'cmyk';
      if (n === 'Pattern') return 'pattern';
      return 'unknown';
    }
    if (v instanceof PDFArray) {
      const kind = this.name(v.get(0));
      if (kind === 'ICCBased') {
        const n = this.number(this.dict(v.get(1))?.get(PDFName.of('N')), 0);
        return n === 1 ? 'icc-gray' : n === 3 ? 'icc-rgb' : n === 4 ? 'icc-cmyk' : 'unknown';
      }
      if (kind === 'CalGray') return 'cal-gray';
      if (kind === 'CalRGB') return 'cal-rgb';
      if (kind === 'Lab') return 'lab';
      if (kind === 'Separation' || kind === 'DeviceN') return 'spot';
      if (kind === 'Indexed' || kind === 'I') return 'indexed';
      if (kind === 'Pattern') return 'pattern';
      if (kind === 'DeviceGray') return 'gray';
      if (kind === 'DeviceRGB') return 'rgb';
      if (kind === 'DeviceCMYK') return 'cmyk';
    }
    return 'unknown';
  }
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

interface FontMetrics {
  /** Bytes per character code (2 for Identity-H composite fonts). */
  codeBytes: 1 | 2;
  /** Width of a glyph in thousandths of the font size. */
  width(code: number): number;
  ascent: number;
  descent: number;
}

function fontMetrics(r: Reader, font: PDFDict): FontMetrics {
  const subtype = r.name(font.get(PDFName.of('Subtype')));
  if (subtype === 'Type0') {
    const desc = r.dict(r.array(font.get(PDFName.of('DescendantFonts')))[0]);
    const dw = desc ? r.number(desc.get(PDFName.of('DW')), 1000) : 1000;
    const widths = new Map<number, number>();
    const w = desc ? r.array(desc.get(PDFName.of('W'))) : [];
    for (let i = 0; i < w.length; ) {
      const first = r.number(w[i]);
      const next = r.get(w[i + 1]);
      if (next instanceof PDFArray) {
        next.asArray().forEach((x, k) => widths.set(first + k, r.number(x)));
        i += 2;
      } else {
        const last = r.number(w[i + 1]);
        const val = r.number(w[i + 2]);
        for (let c = first; c <= last && c - first < 70000; c++) widths.set(c, val);
        i += 3;
      }
    }
    const fd = desc ? r.dict(desc.get(PDFName.of('FontDescriptor'))) : undefined;
    return {
      codeBytes: 2,
      width: (code) => widths.get(code) ?? dw,
      ascent: fd ? r.number(fd.get(PDFName.of('Ascent')), 800) : 800,
      descent: fd ? r.number(fd.get(PDFName.of('Descent')), -200) : -200,
    };
  }
  const first = r.number(font.get(PDFName.of('FirstChar')), 0);
  const widths = r.array(font.get(PDFName.of('Widths'))).map((x) => r.number(x));
  const fd = r.dict(font.get(PDFName.of('FontDescriptor')));
  const missing = fd ? r.number(fd.get(PDFName.of('MissingWidth')), 500) : 500;
  return {
    codeBytes: 1,
    width: (code) => widths[code - first] ?? missing,
    ascent: fd ? r.number(fd.get(PDFName.of('Ascent')), 800) : 800,
    descent: fd ? r.number(fd.get(PDFName.of('Descent')), -200) : -200,
  };
}

function fontEmbedded(r: Reader, font: PDFDict): boolean {
  const subtype = r.name(font.get(PDFName.of('Subtype')));
  if (subtype === 'Type3') return true; // glyphs are drawn by content streams inside the file
  let fd: PDFDict | undefined;
  if (subtype === 'Type0') {
    const desc = r.dict(r.array(font.get(PDFName.of('DescendantFonts')))[0]);
    fd = desc ? r.dict(desc.get(PDFName.of('FontDescriptor'))) : undefined;
  } else {
    fd = r.dict(font.get(PDFName.of('FontDescriptor')));
  }
  if (!fd) return false;
  return ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd!.get(PDFName.of(k)) !== undefined);
}

/* ------------------------------------------------------------------ */
/* Content analysis                                                    */
/* ------------------------------------------------------------------ */

interface GState {
  ctm: Matrix;
  font: FontMetrics | null;
  fontSize: number;
  charSpace: number;
  wordSpace: number;
  hScale: number;
  leading: number;
  rise: number;
}

interface PageAnalysis {
  ink: BBox;
  text: BBox;
  colors: Set<ColorFamily>;
  images: Omit<PdfImageInfo, 'page'>[];
  transparency: boolean;
  /** Smallest type size drawn, points. Infinity when the page has no text. */
  minFont: number;
}

const cloneState = (s: GState): GState => ({ ...s, ctm: [...s.ctm] as Matrix });

function analyse(r: Reader, content: Uint8Array, resources: PDFDict | undefined, base: Matrix, out: PageAnalysis, notes: string[], depth = 0): void {
  if (depth > 8) return;
  const res = (kind: string): PDFDict | undefined => (resources ? r.dict(resources.get(PDFName.of(kind))) : undefined);
  const fonts = res('Font');
  const xobjects = res('XObject');
  const colorSpaces = res('ColorSpace');
  const extG = res('ExtGState');
  const metricsCache = new Map<string, FontMetrics>();

  let st: GState = { ctm: base, font: null, fontSize: 0, charSpace: 0, wordSpace: 0, hScale: 1, leading: 0, rise: 0 };
  const stack: GState[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let path = emptyBox();
  let cur: [number, number] = [0, 0];

  const addPoint = (box: BBox, x: number, y: number) => {
    const [px, py] = apply(st.ctm, x, y);
    growBox(box, px, py);
  };
  const csFamily = (o: Operand | undefined): ColorFamily => {
    if (!o || o.k !== 'name') return 'unknown';
    const direct = { DeviceGray: 'gray', DeviceRGB: 'rgb', DeviceCMYK: 'cmyk', Pattern: 'pattern' }[o.v] as ColorFamily | undefined;
    if (direct) return direct;
    return colorSpaces ? r.colorFamily(colorSpaces.get(PDFName.of(o.v))) : 'unknown';
  };

  const showText = (bytes: Uint8Array) => {
    const f = st.font;
    if (!f || st.fontSize === 0) return;
    let advance = 0;
    const step = f.codeBytes;
    for (let i = 0; i + step <= bytes.length; i += step) {
      const code = step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
      let w = (f.width(code) / 1000) * st.fontSize + st.charSpace;
      if (step === 1 && code === 32) w += st.wordSpace;
      advance += w * st.hScale;
    }
    if (advance !== 0) {
      const m = multiply(tm, st.ctm);
      const size = Math.abs(st.fontSize) * Math.hypot(m[2], m[3]);
      if (size > 0 && size < out.minFont) out.minFont = size;
      const y0 = (f.descent / 1000) * st.fontSize + st.rise;
      const y1 = (f.ascent / 1000) * st.fontSize + st.rise;
      for (const [x, y] of [[0, y0], [advance, y0], [0, y1], [advance, y1]] as const) {
        const [px, py] = apply(m, x, y);
        growBox(out.text, px, py);
        growBox(out.ink, px, py);
      }
    }
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };

  for (const { op, args } of operations(content)) {
    switch (op) {
      case 'q':
        stack.push(cloneState(st));
        break;
      case 'Q':
        if (stack.length) st = stack.pop()!;
        break;
      case 'cm':
        st.ctm = multiply([num(args[0]), num(args[1]), num(args[2]), num(args[3]), num(args[4]), num(args[5])], st.ctm);
        break;
      // ---- text
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case 'Tf': {
        const a = args[0];
        st.fontSize = num(args[1]);
        if (a && a.k === 'name' && fonts) {
          let m = metricsCache.get(a.v);
          if (!m) {
            const fd = r.dict(fonts.get(PDFName.of(a.v)));
            if (fd) {
              m = fontMetrics(r, fd);
              metricsCache.set(a.v, m);
            }
          }
          st.font = m ?? null;
        }
        break;
      }
      case 'Tc':
        st.charSpace = num(args[0]);
        break;
      case 'Tw':
        st.wordSpace = num(args[0]);
        break;
      case 'Tz':
        st.hScale = num(args[0]) / 100;
        break;
      case 'TL':
        st.leading = num(args[0]);
        break;
      case 'Ts':
        st.rise = num(args[0]);
        break;
      case 'Td':
        tlm = multiply([1, 0, 0, 1, num(args[0]), num(args[1])], tlm);
        tm = tlm;
        break;
      case 'TD':
        st.leading = -num(args[1]);
        tlm = multiply([1, 0, 0, 1, num(args[0]), num(args[1])], tlm);
        tm = tlm;
        break;
      case 'Tm':
        tlm = [num(args[0]), num(args[1]), num(args[2]), num(args[3]), num(args[4]), num(args[5])];
        tm = tlm;
        break;
      case 'T*':
        tlm = multiply([1, 0, 0, 1, 0, -st.leading], tlm);
        tm = tlm;
        break;
      case 'Tj':
        if (args[0]?.k === 'str') showText(args[0].v);
        break;
      case "'":
        tlm = multiply([1, 0, 0, 1, 0, -st.leading], tlm);
        tm = tlm;
        if (args[0]?.k === 'str') showText(args[0].v);
        break;
      case '"':
        st.wordSpace = num(args[0]);
        st.charSpace = num(args[1]);
        tlm = multiply([1, 0, 0, 1, 0, -st.leading], tlm);
        tm = tlm;
        if (args[2]?.k === 'str') showText(args[2].v);
        break;
      case 'TJ':
        if (args[0]?.k === 'arr') {
          for (const item of args[0].v) {
            if (item.k === 'str') showText(item.v);
            else if (item.k === 'num') tm = multiply([1, 0, 0, 1, (-item.v / 1000) * st.fontSize * st.hScale, 0], tm);
          }
        }
        break;
      // ---- paths
      case 'm':
      case 'l':
        cur = [num(args[0]), num(args[1])];
        addPoint(path, cur[0], cur[1]);
        break;
      case 'c':
        addPoint(path, num(args[0]), num(args[1]));
        addPoint(path, num(args[2]), num(args[3]));
        addPoint(path, num(args[4]), num(args[5]));
        break;
      case 'v':
      case 'y':
        addPoint(path, num(args[0]), num(args[1]));
        addPoint(path, num(args[2]), num(args[3]));
        break;
      case 're': {
        const [x, y, w, h] = [num(args[0]), num(args[1]), num(args[2]), num(args[3])];
        addPoint(path, x, y);
        addPoint(path, x + w, y);
        addPoint(path, x, y + h);
        addPoint(path, x + w, y + h);
        break;
      }
      case 'S':
      case 's':
      case 'f':
      case 'F':
      case 'f*':
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
        unionBox(out.ink, path);
        path = emptyBox();
        break;
      case 'n':
        path = emptyBox(); // clipping path only: no ink
        break;
      // ---- colour
      case 'g':
      case 'G':
        out.colors.add('gray');
        break;
      case 'rg':
      case 'RG':
        out.colors.add('rgb');
        break;
      case 'k':
      case 'K':
        out.colors.add('cmyk');
        break;
      case 'cs':
      case 'CS':
        out.colors.add(csFamily(args[0]));
        break;
      case 'sh':
        out.colors.add('pattern');
        break;
      case 'gs': {
        const a = args[0];
        const g = a && a.k === 'name' && extG ? r.dict(extG.get(PDFName.of(a.v))) : undefined;
        if (g) {
          const ca = g.get(PDFName.of('ca'));
          const CA = g.get(PDFName.of('CA'));
          const smask = r.get(g.get(PDFName.of('SMask')));
          const bm = r.name(g.get(PDFName.of('BM')));
          if ((ca && r.number(ca, 1) < 1) || (CA && r.number(CA, 1) < 1)) out.transparency = true;
          if (smask && !(smask instanceof PDFName && smask.decodeText() === 'None')) out.transparency = true;
          if (bm && bm !== 'Normal' && bm !== 'Compatible') out.transparency = true;
        }
        break;
      }
      // ---- images and forms
      case 'Do': {
        const a = args[0];
        if (!a || a.k !== 'name' || !xobjects) break;
        const ref = xobjects.get(PDFName.of(a.v));
        const xo = r.get(ref);
        const d = r.dict(xo);
        if (!d) break;
        const subtype = r.name(d.get(PDFName.of('Subtype')));
        if (subtype === 'Image') {
          const box = emptyBox();
          for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            const [px, py] = apply(st.ctm, x, y);
            growBox(box, px, py);
          }
          unionBox(out.ink, box);
          const wPx = r.number(d.get(PDFName.of('Width')));
          const hPx = r.number(d.get(PDFName.of('Height')));
          // Printed size: lengths of the transformed unit vectors (handles rotation).
          const wPt = Math.hypot(st.ctm[0], st.ctm[1]);
          const hPt = Math.hypot(st.ctm[2], st.ctm[3]);
          const filter = r.get(d.get(PDFName.of('Filter')));
          const filterName = filter instanceof PDFArray ? filter.asArray().map((f) => r.name(f)).join('+') : (r.name(filter) ?? 'none');
          const isMask = r.get(d.get(PDFName.of('ImageMask')))?.toString() === 'true';
          const smask = d.get(PDFName.of('SMask'));
          if (smask) out.transparency = true;
          out.images.push({
            name: a.v,
            widthPx: wPx,
            heightPx: hPx,
            color: isMask ? 'gray' : r.colorFamily(d.get(PDFName.of('ColorSpace'))),
            bitsPerComponent: r.number(d.get(PDFName.of('BitsPerComponent')), isMask ? 1 : 8),
            filter: filterName,
            hasSoftMask: Boolean(smask),
            widthPt: wPt,
            heightPt: hPt,
            dpi: wPt > 0 && hPt > 0 ? Math.round(Math.min(wPx / (wPt / 72), hPx / (hPt / 72))) : 0,
            box,
          });
        } else if (subtype === 'Form') {
          const m = r.array(d.get(PDFName.of('Matrix'))).map((x) => r.number(x));
          const fm: Matrix = m.length === 6 ? (m as Matrix) : IDENTITY;
          const group = r.dict(d.get(PDFName.of('Group')));
          if (group && r.name(group.get(PDFName.of('S'))) === 'Transparency' && depth >= 0) {
            // A transparency group on its own is harmless; real transparency is reported by ca/CA/SMask.
          }
          analyse(r, r.bytes(xo), r.dict(d.get(PDFName.of('Resources'))) ?? resources, multiply(fm, st.ctm), out, notes, depth + 1);
        }
        break;
      }
      case 'BI':
        // Inline image: occupies the unit square under the current matrix.
        for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
          const [px, py] = apply(st.ctm, x, y);
          growBox(out.ink, px, py);
        }
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

function boxOf(b: { x: number; y: number; width: number; height: number }): BBox {
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}

export async function inspectPdf(bytes: Uint8Array, opts: InspectOptions = {}): Promise<PdfReport> {
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  const version = /%PDF-(\d\.\d)/.exec(head)?.[1] ?? '';
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const r = new Reader(doc);
  const notes: string[] = [];
  const fonts = new Map<string, PdfFontInfo>();
  const images: PdfImageInfo[] = [];
  const pages: PdfPageInfo[] = [];
  const seenFontDicts = new Map<PDFDict, PdfFontInfo>();

  const pdfPages = doc.getPages();
  pdfPages.forEach((page, index) => {
    const number = index + 1;
    const media = boxOf(page.getMediaBox());
    const node = page.node;
    const hasTrimBox = node.get(PDFName.of('TrimBox')) !== undefined;
    const info: PdfPageInfo = {
      number,
      width: media.x1 - media.x0,
      height: media.y1 - media.y0,
      media,
      trim: boxOf(page.getTrimBox()),
      bleed: boxOf(page.getBleedBox()),
      hasTrimBox,
      ink: null,
      text: null,
      colors: [],
      annotations: r.array(node.get(PDFName.of('Annots'))).length,
      usesTransparency: false,
      minFontPt: null,
    };
    const resources = node.Resources();
    // Fonts on this page (including those only used inside form XObjects one level down).
    const collectFonts = (res: PDFDict | undefined, depth: number) => {
      if (!res || depth > 4) return;
      const fd = r.dict(res.get(PDFName.of('Font')));
      if (fd) {
        for (const [, ref] of fd.entries()) {
          const f = r.dict(ref);
          if (!f) continue;
          let entry = seenFontDicts.get(f);
          if (!entry) {
            const name = r.name(f.get(PDFName.of('BaseFont'))) ?? '(unnamed)';
            entry = {
              name,
              type: r.name(f.get(PDFName.of('Subtype'))) ?? 'unknown',
              embedded: fontEmbedded(r, f),
              subset: /^[A-Z]{6}\+/.test(name),
              pages: [],
            };
            seenFontDicts.set(f, entry);
            fonts.set(name + '|' + entry.type + '|' + fonts.size, entry);
          }
          if (!entry.pages.includes(number)) entry.pages.push(number);
        }
      }
      const xo = r.dict(res.get(PDFName.of('XObject')));
      if (xo) {
        for (const [, ref] of xo.entries()) {
          const d = r.dict(ref);
          if (d && r.name(d.get(PDFName.of('Subtype'))) === 'Form') collectFonts(r.dict(d.get(PDFName.of('Resources'))), depth + 1);
        }
      }
    };
    collectFonts(resources, 0);

    if (!opts.shallow && (!opts.pages || opts.pages.includes(number))) {
      const analysis: PageAnalysis = { ink: emptyBox(), text: emptyBox(), colors: new Set(), images: [], transparency: false, minFont: Infinity };
      try {
        analyse(r, r.contents(node.Contents()), resources, IDENTITY, analysis, notes);
      } catch (e) {
        notes.push(`Page ${number} could not be analysed completely: ${(e as Error).message}`);
      }
      info.ink = isEmptyBox(analysis.ink) ? null : analysis.ink;
      info.text = isEmptyBox(analysis.text) ? null : analysis.text;
      info.minFontPt = Number.isFinite(analysis.minFont) ? Math.round(analysis.minFont * 100) / 100 : null;
      info.colors = [...analysis.colors].filter((c) => c !== 'pattern' || analysis.colors.size === 1);
      info.usesTransparency = analysis.transparency;
      for (const img of analysis.images) images.push({ page: number, ...img });
    }
    pages.push(info);
  });

  const catalog = doc.catalog;
  const infoDict = r.dict(doc.context.trailerInfo.Info);
  const info: Record<string, string> = {};
  if (infoDict) {
    for (const [k, v] of infoDict.entries()) {
      // Text entries and name entries (Trapped is a name).
      const t = r.text(v) ?? r.name(v);
      if (t !== undefined) info[k.decodeText()] = t;
    }
  }
  const outputIntents = r.array(catalog.get(PDFName.of('OutputIntents'))).map((o) => {
    const d = r.dict(o);
    return {
      subtype: d ? (r.name(d.get(PDFName.of('S'))) ?? '') : '',
      condition: d ? (r.text(d.get(PDFName.of('OutputConditionIdentifier'))) ?? '') : '',
      hasProfile: Boolean(d?.get(PDFName.of('DestOutputProfile'))),
    };
  });
  const markInfo = r.dict(catalog.get(PDFName.of('MarkInfo')));
  // Object streams are a PDF 1.5 feature; older standards do not allow them.
  const raw = bytes.length < 40_000_000 ? bytes : bytes.subarray(0, 40_000_000);
  let usesObjectStreams = false;
  const needle = [47, 79, 98, 106, 83, 116, 109]; // "/ObjStm"
  outer: for (let i = 0; i + needle.length < raw.length; i++) {
    if (raw[i] !== 47) continue;
    for (let k = 1; k < needle.length; k++) if (raw[i + k] !== needle[k]) continue outer;
    usesObjectStreams = true;
    break;
  }
  return {
    version,
    pageCount: pdfPages.length,
    pages,
    fonts: [...fonts.values()],
    images,
    info,
    pdfx: info.GTS_PDFXConformance ?? info.GTS_PDFXVersion ?? null,
    hasXmp: catalog.get(PDFName.of('Metadata')) !== undefined,
    outputIntents,
    encrypted: doc.isEncrypted,
    hasOutline: catalog.get(PDFName.of('Outlines')) !== undefined,
    tagged: Boolean(markInfo && r.get(markInfo.get(PDFName.of('Marked')))?.toString() === 'true'),
    usesObjectStreams,
    notes,
  };
}

export interface MarginMeasurement {
  page: number;
  /** Right hand (odd) page: the binding edge is on the left. */
  recto: boolean;
  /** Distances from the trim edge to the nearest ink, inches. Infinity for an empty page. */
  inside: number;
  outside: number;
  top: number;
  bottom: number;
  empty: boolean;
}

/**
 * Real margins of every page, measured from the trim box to the ink that was
 * actually drawn. `what` chooses between all marks and text only.
 */
export function measureMargins(report: PdfReport, what: 'ink' | 'text' = 'ink'): MarginMeasurement[] {
  return report.pages.map((p) => {
    const box = what === 'ink' ? p.ink : p.text;
    const recto = p.number % 2 === 1;
    if (!box) return { page: p.number, recto, inside: Infinity, outside: Infinity, top: Infinity, bottom: Infinity, empty: true };
    const left = (box.x0 - p.trim.x0) / 72;
    const right = (p.trim.x1 - box.x1) / 72;
    return {
      page: p.number,
      recto,
      inside: recto ? left : right,
      outside: recto ? right : left,
      top: (p.trim.y1 - box.y1) / 72,
      bottom: (box.y0 - p.trim.y0) / 72,
      empty: false,
    };
  });
}
