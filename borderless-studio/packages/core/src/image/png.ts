/**
 * A small PNG reader and writer in plain TypeScript (compression by fflate).
 * Used for image checks, greyscale conversion and generated graphics, so the
 * app needs no native image library and behaves the same on every platform.
 *
 * Reads: 8 and 16 bit greyscale, RGB, palette, with or without alpha,
 * non interlaced. Writes: 8 bit greyscale, greyscale+alpha, RGB, RGBA.
 */
import { unzlibSync, zlibSync } from 'fflate';

export interface RasterImage {
  width: number;
  height: number;
  /** 1 = grey, 2 = grey + alpha, 3 = RGB, 4 = RGBA. 8 bits per channel. */
  channels: 1 | 2 | 3 | 4;
  data: Uint8Array;
  /** Pixels per inch, when the file states it. */
  dpiX?: number;
  dpiY?: number;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Encode an 8 bit image as PNG. `dpi` is stored in the file so layout programs know its print size. */
export function encodePng(img: RasterImage, dpi?: number): Uint8Array {
  const { width, height, channels, data } = img;
  if (data.length !== width * height * channels) throw new Error('PNG encoder: the pixel data does not match the image size.');
  const colorType = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOut = y * (stride + 1);
    const rowIn = y * stride;
    // Filter type 1 (Sub) compresses smooth pictures well and is cheap to compute.
    raw[rowOut] = 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[rowIn + x - channels] : 0;
      raw[rowOut + 1 + x] = (data[rowIn + x] - left) & 0xff;
    }
  }
  const parts: Uint8Array[] = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr)];
  const res = dpi ?? img.dpiX;
  if (res) {
    const phys = new Uint8Array(9);
    const pv = new DataView(phys.buffer);
    const ppm = Math.round(res / 0.0254);
    pv.setUint32(0, ppm);
    pv.setUint32(4, Math.round((dpi ?? img.dpiY ?? res) / 0.0254));
    phys[8] = 1;
    parts.push(chunk('pHYs', phys));
  }
  parts.push(chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaced: boolean;
  channels: number;
  hasAlpha: boolean;
  /** Palette images count as colour. */
  isGrey: boolean;
  dpiX?: number;
  dpiY?: number;
  hasIccProfile: boolean;
}

/** Read only the header chunks of a PNG (fast: no pixel data is decompressed). */
export function readPngHeader(bytes: Uint8Array): PngHeader {
  if (!isPng(bytes)) throw new Error('Not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let header: PngHeader | null = null;
  let hasTrns = false;
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const body = off + 8;
    if (type === 'IHDR') {
      const colorType = bytes[body + 9];
      header = {
        width: view.getUint32(body),
        height: view.getUint32(body + 4),
        bitDepth: bytes[body + 8],
        colorType,
        interlaced: bytes[body + 12] === 1,
        channels: { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] ?? 1,
        hasAlpha: colorType === 4 || colorType === 6,
        isGrey: colorType === 0 || colorType === 4,
        hasIccProfile: false,
      };
    } else if (type === 'pHYs' && header && bytes[body + 8] === 1) {
      header.dpiX = Math.round(view.getUint32(body) * 0.0254 * 100) / 100;
      header.dpiY = Math.round(view.getUint32(body + 4) * 0.0254 * 100) / 100;
    } else if (type === 'iCCP' && header) {
      header.hasIccProfile = true;
    } else if (type === 'tRNS') {
      hasTrns = true;
    } else if (type === 'IDAT' || type === 'IEND') {
      break;
    }
    off = body + len + 4;
  }
  if (!header) throw new Error('This PNG file has no header and cannot be read.');
  if (hasTrns) header.hasAlpha = true;
  return header;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode a PNG into 8 bit pixels. Interlaced files are not supported. */
export function decodePng(bytes: Uint8Array): RasterImage {
  const h = readPngHeader(bytes);
  if (h.interlaced) throw new Error('Interlaced PNG files are not supported. Save the picture again without interlacing.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const body = bytes.subarray(off + 8, off + 8 + len);
    if (type === 'IDAT') idat.push(body);
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of idat) {
    joined.set(p, o);
    o += p.length;
  }
  const raw = unzlibSync(joined);
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[h.colorType] ?? 1;
  const bytesPerSample = h.bitDepth === 16 ? 2 : 1;
  const bpp = Math.max(1, Math.ceil((samples * h.bitDepth) / 8));
  const stride = Math.ceil((h.width * samples * h.bitDepth) / 8);
  const pixels = new Uint8Array(stride * h.height);
  for (let y = 0; y < h.height; y++) {
    const filter = raw[y * (stride + 1)];
    const inRow = y * (stride + 1) + 1;
    const outRow = y * stride;
    const prevRow = outRow - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[outRow + x - bpp] : 0;
      const b = y > 0 ? pixels[prevRow + x] : 0;
      const c = y > 0 && x >= bpp ? pixels[prevRow + x - bpp] : 0;
      let v = raw[inRow + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      pixels[outRow + x] = v & 0xff;
    }
  }
  const n = h.width * h.height;
  // Normalise everything to 8 bit grey, grey+alpha, RGB or RGBA.
  const sampleAt = (row: number, index: number): number => {
    if (h.bitDepth === 8) return pixels[row + index];
    if (h.bitDepth === 16) return pixels[row + index * 2];
    const bitPos = index * h.bitDepth;
    const byte = pixels[row + (bitPos >> 3)];
    const shift = 8 - h.bitDepth - (bitPos & 7);
    const value = (byte >> shift) & ((1 << h.bitDepth) - 1);
    return h.colorType === 3 ? value : Math.round((value * 255) / ((1 << h.bitDepth) - 1));
  };
  void bytesPerSample;
  let channels: 1 | 2 | 3 | 4;
  let data: Uint8Array;
  if (h.colorType === 3) {
    if (!palette) throw new Error('This PNG has no colour palette and cannot be read.');
    const alpha = Boolean(trns);
    channels = alpha ? 4 : 3;
    data = new Uint8Array(n * channels);
    for (let y = 0; y < h.height; y++) {
      for (let x = 0; x < h.width; x++) {
        const idx = sampleAt(y * stride, x);
        const d = (y * h.width + x) * channels;
        data[d] = palette[idx * 3];
        data[d + 1] = palette[idx * 3 + 1];
        data[d + 2] = palette[idx * 3 + 2];
        if (alpha) data[d + 3] = idx < trns!.length ? trns![idx] : 255;
      }
    }
  } else {
    channels = samples as 1 | 2 | 3 | 4;
    data = new Uint8Array(n * channels);
    for (let y = 0; y < h.height; y++) {
      for (let x = 0; x < h.width * samples; x++) data[y * h.width * samples + x] = sampleAt(y * stride, x);
    }
  }
  return { width: h.width, height: h.height, channels, data, dpiX: h.dpiX, dpiY: h.dpiY };
}

/* ------------------------------------------------------------------ */
/* Pixel operations                                                    */
/* ------------------------------------------------------------------ */

/** Composite any alpha channel onto a white (or other) background. */
export function flattenAlpha(img: RasterImage, background: [number, number, number] = [255, 255, 255]): RasterImage {
  if (img.channels === 1 || img.channels === 3) return img;
  const n = img.width * img.height;
  if (img.channels === 2) {
    const out = new Uint8Array(n);
    const bg = Math.round(0.2126 * background[0] + 0.7152 * background[1] + 0.0722 * background[2]);
    for (let i = 0; i < n; i++) {
      const a = img.data[i * 2 + 1] / 255;
      out[i] = Math.round(img.data[i * 2] * a + bg * (1 - a));
    }
    return { ...img, channels: 1, data: out };
  }
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(img.data[i * 4 + c] * a + background[c] * (1 - a));
  }
  return { ...img, channels: 3, data: out };
}

/**
 * Convert to greyscale using Rec. 709 luma weights, working on the gamma
 * encoded values (the usual "desaturate" used for black ink printing).
 */
export function toGreyscale(img: RasterImage): RasterImage {
  const flat = flattenAlpha(img);
  if (flat.channels === 1) return flat;
  const n = flat.width * flat.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(0.2126 * flat.data[i * 3] + 0.7152 * flat.data[i * 3 + 1] + 0.0722 * flat.data[i * 3 + 2]);
  }
  return { ...flat, channels: 1, data: out };
}

/** True when every pixel of a colour image is neutral grey (so it can be stored as greyscale without loss). */
export function isEffectivelyGrey(img: RasterImage, tolerance = 2): boolean {
  if (img.channels < 3) return true;
  const step = img.channels;
  for (let i = 0; i < img.data.length; i += step) {
    const r = img.data[i];
    if (Math.abs(r - img.data[i + 1]) > tolerance || Math.abs(r - img.data[i + 2]) > tolerance) return false;
  }
  return true;
}

/** Resize with area averaging when shrinking and bilinear sampling when enlarging. */
export function resizeImage(img: RasterImage, width: number, height: number): RasterImage {
  const { channels: ch } = img;
  const out = new Uint8Array(width * height * ch);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      for (let c = 0; c < ch; c++) {
        let sum = 0;
        let weight = 0;
        if (sx >= 1 || sy >= 1) {
          // Box filter over the source area covered by this destination pixel.
          for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
            const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
            for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
              const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
              sum += img.data[(yy * img.width + xx) * ch + c] * wx * wy;
              weight += wx * wy;
            }
          }
        } else {
          const fx = Math.max(0, Math.min(img.width - 1, (x + 0.5) * sx - 0.5));
          const fy = Math.max(0, Math.min(img.height - 1, (y + 0.5) * sy - 0.5));
          const xa = Math.floor(fx);
          const ya = Math.floor(fy);
          const xb = Math.min(img.width - 1, xa + 1);
          const yb = Math.min(img.height - 1, ya + 1);
          const tx = fx - xa;
          const ty = fy - ya;
          const p = (xx: number, yy: number) => img.data[(yy * img.width + xx) * ch + c];
          sum = p(xa, ya) * (1 - tx) * (1 - ty) + p(xb, ya) * tx * (1 - ty) + p(xa, yb) * (1 - tx) * ty + p(xb, yb) * tx * ty;
          weight = 1;
        }
        out[(y * width + x) * ch + c] = Math.round(sum / (weight || 1));
      }
    }
  }
  return { width, height, channels: ch, data: out, dpiX: img.dpiX ? img.dpiX / sx : undefined, dpiY: img.dpiY ? img.dpiY / sy : undefined };
}
