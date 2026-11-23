/**
 * Turns a finished print PDF into a PDF/X-1a:2001 file, the exchange format
 * printers such as IngramSpark ask for.
 *
 * PDF/X-1a is an ordinary PDF that keeps a few promises:
 *
 *   - every colour is plain greyscale or CMYK ink percentages (no RGB, and no
 *     colour profiles attached to pictures),
 *   - no transparency, no links or other annotations inside the page,
 *   - every font is embedded (Typst already does this),
 *   - every page states where it will be trimmed (TrimBox),
 *   - the file says which printing condition it was prepared for (the
 *     "output intent") and identifies itself as PDF/X-1a.
 *
 * Text and line work are never touched here: the typesetter already writes
 * them as pure black or CMYK. Only pictures are converted.
 */
import { unzlibSync, zlibSync } from 'fflate';
import {
  PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString,
  type PDFObject,
} from 'pdf-lib';
import { decodeJpeg } from '../image/jpeg';

export interface OutputCondition {
  /** Registered name of the printing condition, for example "CGATS TR 001". */
  identifier: string;
  /** Plain description of the condition. */
  condition: string;
  registry: string;
  info: string;
}

/** SWOP on coated paper: the condition IngramSpark's own export settings name. */
export const CGATS_TR_001: OutputCondition = {
  identifier: 'CGATS TR 001',
  condition: 'SWOP (Publication) printing in USA (Printing process definition: ANSI CGATS.6).',
  registry: 'http://www.color.org',
  info: 'U.S. Web Coated (SWOP) v2',
};

export interface PdfxOptions {
  /** Converts 8 bit RGB pixels to 8 bit CMYK pixels (0 = no ink). Needed only when the file has colour pictures. */
  rgbToCmyk?: (rgb: Uint8Array) => Uint8Array;
  outputCondition?: OutputCondition;
  /**
   * ICC profile to store inside the output intent. Left out by default: the
   * condition is a registered one, so the name is enough, and IngramSpark
   * asks for files without embedded profiles.
   */
  embedProfile?: Uint8Array;
}

export interface PdfxSummary {
  standard: 'PDF/X-1a:2001';
  /** Pictures whose colour space was relabelled as plain greyscale or CMYK (pixels unchanged). */
  relabelled: number;
  /** Pictures converted from RGB to CMYK. */
  convertedToCmyk: number;
  /** Highest total ink (2.4 = 240 %) found in converted pictures. */
  maxInkConverted: number;
  /** Things that keep the file from being a valid PDF/X-1a file. */
  problems: string[];
}

const N = (s: string) => PDFName.of(s);

type Kind = 'gray' | 'cmyk' | 'rgb' | 'icc-gray' | 'icc-rgb' | 'icc-cmyk' | 'cal-gray' | 'cal-rgb' | 'indexed' | 'other';

function classify(doc: PDFDocument, cs: PDFObject | undefined): Kind {
  const o = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (o instanceof PDFName) {
    if (o === N('DeviceGray') || o === N('G')) return 'gray';
    if (o === N('DeviceRGB') || o === N('RGB')) return 'rgb';
    if (o === N('DeviceCMYK') || o === N('CMYK')) return 'cmyk';
    return 'other';
  }
  if (o instanceof PDFArray && o.size() > 0) {
    const head = o.lookup(0);
    if (head === N('ICCBased')) {
      const stream = o.lookup(1);
      const n = stream instanceof PDFStream ? stream.dict.lookup(N('N')) : undefined;
      const count = n instanceof PDFNumber ? n.asNumber() : 0;
      return count === 1 ? 'icc-gray' : count === 3 ? 'icc-rgb' : count === 4 ? 'icc-cmyk' : 'other';
    }
    if (head === N('CalGray')) return 'cal-gray';
    if (head === N('CalRGB')) return 'cal-rgb';
    if (head === N('Indexed') || head === N('I')) return 'indexed';
  }
  return 'other';
}

/** Undo the PNG or TIFF row prediction some PDF writers apply before compressing image data. */
function unpredict(data: Uint8Array, predictor: number, colors: number, bpc: number, columns: number): Uint8Array {
  if (predictor <= 1) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  if (predictor === 2) {
    if (bpc !== 8) throw new Error('TIFF prediction is only supported for 8 bit images.');
    const out = data.slice();
    for (let row = 0; row + rowLen <= out.length; row += rowLen) {
      for (let i = bpp; i < rowLen; i++) out[row + i] = (out[row + i] + out[row + i - bpp]) & 255;
    }
    return out;
  }
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const left = i >= bpp ? out[dst + i - bpp] : 0;
      const up = r > 0 ? out[dst - rowLen + i] : 0;
      const upLeft = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v: number;
      switch (type) {
        case 0: v = raw; break;
        case 1: v = raw + left; break;
        case 2: v = raw + up; break;
        case 3: v = raw + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: throw new Error(`Unknown PNG row filter ${type} in image data.`);
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

const numberOf = (o: PDFObject | undefined, fallback: number): number => (o instanceof PDFNumber ? o.asNumber() : fallback);

/** Decode the pixel data of an RGB image XObject into 8 bit RGB. */
function decodeRgbImage(stream: PDFRawStream): Uint8Array {
  const dict = stream.dict;
  const width = numberOf(dict.lookup(N('Width')), 0);
  const height = numberOf(dict.lookup(N('Height')), 0);
  const bpc = numberOf(dict.lookup(N('BitsPerComponent')), 8);
  if (bpc !== 8) throw new Error(`a picture with ${bpc} bits per colour cannot be converted (8 bits are needed)`);
  let filter = dict.lookup(N('Filter'));
  let parms = dict.lookup(N('DecodeParms'));
  if (filter instanceof PDFArray) {
    if (filter.size() > 1) throw new Error('a picture with several compression layers cannot be converted');
    filter = filter.size() === 1 ? filter.lookup(0) : undefined;
    if (parms instanceof PDFArray) parms = parms.size() > 0 ? parms.lookup(0) : undefined;
  }
  let rgb: Uint8Array;
  if (filter === undefined) {
    rgb = stream.contents;
  } else if (filter === N('FlateDecode') || filter === N('Fl')) {
    rgb = unzlibSync(stream.contents);
    if (parms instanceof PDFDict) {
      const predictor = numberOf(parms.lookup(N('Predictor')), 1);
      rgb = unpredict(rgb, predictor, numberOf(parms.lookup(N('Colors')), 1), numberOf(parms.lookup(N('BitsPerComponent')), 8), numberOf(parms.lookup(N('Columns')), 1));
    }
  } else if (filter === N('DCTDecode') || filter === N('DCT')) {
    const img = decodeJpeg(stream.contents);
    rgb = img.data;
  } else {
    throw new Error(`a picture compressed with ${String(filter)} cannot be converted`);
  }
  if (rgb.length < width * height * 3) throw new Error('a picture has less pixel data than its size needs');
  if (rgb.length > width * height * 3) rgb = rgb.subarray(0, width * height * 3);
  // An inverting Decode array ([1 0 1 0 1 0]) flips the samples.
  const decode = dict.lookup(N('Decode'));
  if (decode instanceof PDFArray && decode.size() >= 2 && numberOf(decode.lookup(0), 0) > numberOf(decode.lookup(1), 1)) {
    rgb = rgb.map((v) => 255 - v);
  }
  return rgb;
}

function convertImages(doc: PDFDocument, opts: PdfxOptions, summary: PdfxSummary): void {
  const context = doc.context;
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.lookup(N('Subtype')) !== N('Image')) continue;
    if (dict.has(N('SMask'))) {
      summary.problems.push('A picture uses transparency (a soft mask). Flatten it onto a white background.');
    }
    const mask = dict.lookup(N('ImageMask'));
    if (mask === PDFBool.True) continue; // a 1 bit stencil has no colour space of its own
    const cs = dict.get(N('ColorSpace'));
    const kind = classify(doc, cs);
    switch (kind) {
      case 'gray':
      case 'cmyk':
        break;
      case 'icc-gray':
      case 'cal-gray':
        dict.set(N('ColorSpace'), N('DeviceGray'));
        summary.relabelled++;
        break;
      case 'icc-cmyk':
        dict.set(N('ColorSpace'), N('DeviceCMYK'));
        summary.relabelled++;
        break;
      case 'rgb':
      case 'icc-rgb':
      case 'cal-rgb': {
        if (!opts.rgbToCmyk) {
          summary.problems.push('The file contains a colour (RGB) picture and no colour converter was supplied.');
          break;
        }
        try {
          const cmyk = opts.rgbToCmyk(decodeRgbImage(obj));
          let max = 0;
          for (let i = 0; i + 3 < cmyk.length; i += 4) {
            const t = cmyk[i] + cmyk[i + 1] + cmyk[i + 2] + cmyk[i + 3];
            if (t > max) max = t;
          }
          summary.maxInkConverted = Math.max(summary.maxInkConverted, max / 255);
          const next = context.obj({}) as PDFDict;
          for (const [key, value] of dict.entries()) {
            if (key === N('Filter') || key === N('DecodeParms') || key === N('ColorSpace') || key === N('Length') || key === N('Decode')) continue;
            next.set(key, value);
          }
          next.set(N('ColorSpace'), N('DeviceCMYK'));
          next.set(N('BitsPerComponent'), PDFNumber.of(8));
          next.set(N('Filter'), N('FlateDecode'));
          context.assign(ref, PDFRawStream.of(next, zlibSync(cmyk, { level: 6 })));
          summary.convertedToCmyk++;
        } catch (e) {
          summary.problems.push(`A colour picture could not be converted to CMYK: ${e instanceof Error ? e.message : String(e)}.`);
        }
        break;
      }
      case 'indexed': {
        const arr = (cs instanceof PDFRef ? context.lookup(cs) : cs) as PDFArray;
        const base = classify(doc, arr.get(1));
        if (base === 'gray' || base === 'cmyk') break;
        const copy = context.obj([]) as PDFArray;
        for (let i = 0; i < arr.size(); i++) copy.push(arr.get(i));
        if (base === 'icc-gray' || base === 'cal-gray') {
          copy.set(1, N('DeviceGray'));
          summary.relabelled++;
        } else if (base === 'icc-cmyk') {
          copy.set(1, N('DeviceCMYK'));
          summary.relabelled++;
        } else if ((base === 'rgb' || base === 'icc-rgb' || base === 'cal-rgb') && opts.rgbToCmyk) {
          const table = arr.lookup(3);
          let bytes: Uint8Array | null = null;
          if (table instanceof PDFHexString || table instanceof PDFString) bytes = table.asBytes();
          else if (table instanceof PDFRawStream) {
            const f = table.dict.lookup(N('Filter'));
            bytes = f === undefined ? table.contents : f === N('FlateDecode') ? unzlibSync(table.contents) : null;
          }
          if (!bytes) {
            summary.problems.push('The colour table of a palette picture could not be read.');
            break;
          }
          const cmyk = opts.rgbToCmyk(bytes.subarray(0, Math.floor(bytes.length / 3) * 3));
          copy.set(1, N('DeviceCMYK'));
          copy.set(3, PDFHexString.of(Array.from(cmyk, (b) => b.toString(16).padStart(2, '0')).join('')));
          summary.convertedToCmyk++;
        } else {
          summary.problems.push('A palette picture uses a colour space that cannot be converted.');
          break;
        }
        dict.set(N('ColorSpace'), copy);
        break;
      }
      default:
        summary.problems.push('A picture uses a colour space PDF/X-1a does not allow (for example Lab or a spot colour).');
    }
  }
}

/** Delete objects nothing refers to any more (for example colour profiles of relabelled pictures). */
export function pruneUnreachable(doc: PDFDocument): number {
  const context = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const push = (o: PDFObject | undefined) => { if (o) stack.push(o); };
  push(context.trailerInfo.Root);
  push(context.trailerInfo.Info);
  push(context.trailerInfo.Encrypt);
  push(context.trailerInfo.ID);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      const key = o.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      push(context.lookup(o));
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) push(o.get(i));
    } else if (o instanceof PDFStream) {
      push(o.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

/**
 * Apply the PDF/X-1a:2001 rules to an open document. The caller saves it
 * without object streams and with the header version 1.3.
 */
export function applyPdfx1a(doc: PDFDocument, opts: PdfxOptions = {}): PdfxSummary {
  const summary: PdfxSummary = { standard: 'PDF/X-1a:2001', relabelled: 0, convertedToCmyk: 0, maxInkConverted: 0, problems: [] };
  const context = doc.context;
  convertImages(doc, opts, summary);

  // Every page states its trim size; a second, conflicting box (ArtBox) is not allowed.
  for (const page of doc.getPages()) {
    if (!page.node.has(N('TrimBox'))) {
      const m = page.getMediaBox();
      page.setTrimBox(m.x, m.y, m.width, m.height);
    }
    page.node.delete(N('ArtBox'));
    if (page.node.has(N('Group'))) {
      summary.problems.push('A page uses a transparency group.');
      break;
    }
  }

  // The XMP packet written by the typesetter would contradict the document information below.
  doc.catalog.delete(N('Metadata'));

  const oc = opts.outputCondition ?? CGATS_TR_001;
  const intent = context.obj({}) as PDFDict;
  intent.set(N('Type'), N('OutputIntent'));
  intent.set(N('S'), N('GTS_PDFX'));
  intent.set(N('OutputConditionIdentifier'), PDFString.of(oc.identifier));
  intent.set(N('OutputCondition'), PDFString.of(oc.condition.replace(/[()\\]/g, '')));
  intent.set(N('RegistryName'), PDFString.of(oc.registry));
  intent.set(N('Info'), PDFString.of(oc.info.replace(/[()\\]/g, '')));
  if (opts.embedProfile) {
    const profile = context.flateStream(opts.embedProfile, { N: 4 });
    intent.set(N('DestOutputProfile'), context.register(profile));
  }
  doc.catalog.set(N('OutputIntents'), context.obj([context.register(intent)]));

  const infoRef = context.trailerInfo.Info;
  const info = infoRef ? context.lookup(infoRef) : undefined;
  if (info instanceof PDFDict) {
    info.set(N('GTS_PDFXVersion'), PDFString.of('PDF/X-1:2001'));
    info.set(N('GTS_PDFXConformance'), PDFString.of('PDF/X-1a:2001'));
    info.set(N('Trapped'), N('False'));
  } else {
    summary.problems.push('The file has no document information.');
  }

  // PDF/X needs a file identifier in the trailer.
  if (!context.trailerInfo.ID) {
    const seed = `${doc.getTitle() ?? ''}|${doc.getPageCount()}|${Date.now()}`;
    let h = 0x811c9dc5;
    let hex = '';
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
      hex += h.toString(16).padStart(8, '0');
    }
    context.trailerInfo.ID = context.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);
  }
  pruneUnreachable(doc);
  return summary;
}
