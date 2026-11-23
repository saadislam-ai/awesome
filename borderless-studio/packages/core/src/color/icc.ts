/**
 * Just enough of the ICC profile format to read a CMYK printing condition:
 * the "A2B0" table (16 bit lookup table, type "mft2") that says which colour
 * (in CIE Lab) a given mix of the four inks produces on paper.
 *
 * The bundled profile describes CGATS TR 001 (SWOP), the condition
 * IngramSpark asks for. Only this direction is stored in it; the reverse
 * (which inks reproduce a wanted colour) is worked out in cmyk.ts.
 */

export type Lab = [number, number, number];

export interface Lut16 {
  inputChannels: number;
  outputChannels: number;
  grid: number;
  inputEntries: number;
  outputEntries: number;
  /** inputChannels x inputEntries values, 0..1. */
  inputTables: Float32Array;
  /** grid^inputChannels x outputChannels values, 0..1. The first channel varies slowest. */
  clut: Float32Array;
  /** outputChannels x outputEntries values, 0..1. */
  outputTables: Float32Array;
}

function tagData(bytes: Uint8Array, signature: string): { offset: number; size: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 132) return null;
  const count = view.getUint32(128);
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    if (at + 12 > bytes.length) break;
    const sig = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (sig === signature) return { offset: view.getUint32(at + 4), size: view.getUint32(at + 8) };
  }
  return null;
}

/** Colour space of the profile ("CMYK", "RGB ", "GRAY") and its connection space ("Lab " or "XYZ "). */
export function iccHeader(bytes: Uint8Array): { colorSpace: string; pcs: string; deviceClass: string } {
  const s = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  return { deviceClass: s(12), colorSpace: s(16), pcs: s(20) };
}

/** Read a 16 bit lookup table tag such as "A2B0". Throws when the tag is missing or has another type. */
export function parseLut16(bytes: Uint8Array, signature = 'A2B0'): Lut16 {
  const tag = tagData(bytes, signature);
  if (!tag) throw new Error(`The colour profile has no ${signature} table.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset + tag.offset, tag.size);
  const type = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (type !== 'mft2') throw new Error(`The ${signature} table of the colour profile has the type "${type}"; only "mft2" is supported.`);
  const inputChannels = view.getUint8(8);
  const outputChannels = view.getUint8(9);
  const grid = view.getUint8(10);
  const inputEntries = view.getUint16(48);
  const outputEntries = view.getUint16(50);
  let off = 52;
  const read = (n: number): Float32Array => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++, off += 2) out[i] = view.getUint16(off) / 65535;
    return out;
  };
  const inputTables = read(inputChannels * inputEntries);
  const clut = read(Math.pow(grid, inputChannels) * outputChannels);
  const outputTables = read(outputChannels * outputEntries);
  return { inputChannels, outputChannels, grid, inputEntries, outputEntries, inputTables, clut, outputTables };
}

function curve(table: Float32Array, start: number, entries: number, v: number): number {
  const x = Math.min(1, Math.max(0, v)) * (entries - 1);
  const i = Math.min(entries - 2, Math.floor(x));
  const t = x - i;
  return table[start + i] * (1 - t) + table[start + i + 1] * t;
}

/**
 * A CMYK printing condition: answers "what colour do these inks give?".
 * Ink amounts are 0..1.
 */
export class CmykProfile {
  private readonly lut: Lut16;
  private readonly strides: number[];

  constructor(iccBytes: Uint8Array) {
    const head = iccHeader(iccBytes);
    if (head.colorSpace !== 'CMYK' || head.pcs !== 'Lab ') {
      throw new Error('The print colour profile must be a CMYK profile with a Lab connection space.');
    }
    this.lut = parseLut16(iccBytes, 'A2B0');
    if (this.lut.inputChannels !== 4 || this.lut.outputChannels !== 3) throw new Error('Unexpected table shape in the print colour profile.');
    const g = this.lut.grid;
    this.strides = [g * g * g * 3, g * g * 3, g * 3, 3];
  }

  /** Colour on paper of an ink mix, as CIE Lab (D50). */
  toLab(c: number, m: number, y: number, k: number, out: Lab = [0, 0, 0]): Lab {
    const { lut, strides } = this;
    const g = lut.grid;
    const idx = [0, 0, 0, 0];
    const frac = [0, 0, 0, 0];
    const input = [c, m, y, k];
    for (let ch = 0; ch < 4; ch++) {
      const v = curve(lut.inputTables, ch * lut.inputEntries, lut.inputEntries, input[ch]) * (g - 1);
      const i = Math.min(g - 2, Math.max(0, Math.floor(v)));
      idx[ch] = i;
      frac[ch] = v - i;
    }
    let r0 = 0;
    let r1 = 0;
    let r2 = 0;
    // Linear interpolation between the 16 surrounding table entries.
    for (let corner = 0; corner < 16; corner++) {
      let w = 1;
      let at = 0;
      for (let ch = 0; ch < 4; ch++) {
        const hi = (corner >> ch) & 1;
        w *= hi ? frac[ch] : 1 - frac[ch];
        at += (idx[ch] + hi) * strides[ch];
      }
      if (w === 0) continue;
      r0 += w * lut.clut[at];
      r1 += w * lut.clut[at + 1];
      r2 += w * lut.clut[at + 2];
    }
    const e = lut.outputEntries;
    const l = curve(lut.outputTables, 0, e, r0);
    const a = curve(lut.outputTables, e, e, r1);
    const b = curve(lut.outputTables, 2 * e, e, r2);
    // 16 bit Lab encoding of version 2 profiles: 0xFF00 is L* 100, 0x8000 is a* or b* 0.
    out[0] = (l * 65535) / 652.8;
    out[1] = (a * 65535) / 256 - 128;
    out[2] = (b * 65535) / 256 - 128;
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* sRGB to Lab                                                         */
/* ------------------------------------------------------------------ */

/** D50 white point, the reference white of ICC profiles. */
export const D50: [number, number, number] = [0.9642, 1, 0.8249];

const SRGB_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB (0..255) to CIE XYZ adapted to D50, white = D50. */
export function srgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const R = SRGB_LINEAR[r];
  const G = SRGB_LINEAR[g];
  const B = SRGB_LINEAR[b];
  return [
    0.4360747 * R + 0.3850649 * G + 0.1430804 * B,
    0.2225045 * R + 0.7168786 * G + 0.0606169 * B,
    0.0139322 * R + 0.0971045 * G + 0.7141733 * B,
  ];
}

const labF = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);

export function xyzToLab(x: number, y: number, z: number): Lab {
  const fx = labF(x / D50[0]);
  const fy = labF(y / D50[1]);
  const fz = labF(z / D50[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Relative luminance (0..1) of a Lab lightness. */
export function lightnessToY(l: number): number {
  const fy = (l + 16) / 116;
  return fy > 6 / 29 ? fy * fy * fy : (116 * fy - 16) * 27 / 24389;
}
