/**
 * Reading the facts about an image file that matter for print: pixel size,
 * colour type, stated resolution, and whether it has transparency or an
 * embedded colour profile. Only headers are parsed, so this is fast even for
 * very large cover art.
 */
import { isPng, readPngHeader } from './png';

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' | 'tiff' | 'pdf' | 'unknown';

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  /** grey, rgb or cmyk. */
  color: 'grey' | 'rgb' | 'cmyk' | 'unknown';
  hasAlpha: boolean;
  hasIccProfile: boolean;
  /** Resolution written in the file, if any. Print quality depends on pixels per printed inch, not on this number. */
  dpiX?: number;
  dpiY?: number;
  bitsPerChannel?: number;
  /** JPEG only: progressive encoding. */
  progressive?: boolean;
}

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function readJpeg(b: Uint8Array): ImageInfo {
  const info: ImageInfo = { format: 'jpeg', width: 0, height: 0, color: 'unknown', hasAlpha: false, hasIccProfile: false };
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker === 0xff) {
      off++;
      continue;
    }
    const len = (b[off + 2] << 8) | b[off + 3];
    const body = off + 4;
    if (marker === 0xe0 && len >= 14 && b[body] === 0x4a && b[body + 1] === 0x46 && b[body + 2] === 0x49 && b[body + 3] === 0x46) {
      // JFIF density: units 1 = dots per inch, 2 = dots per cm
      const units = b[body + 7];
      const dx = (b[body + 8] << 8) | b[body + 9];
      const dy = (b[body + 10] << 8) | b[body + 11];
      if (units === 1 && dx > 1) {
        info.dpiX = dx;
        info.dpiY = dy;
      } else if (units === 2 && dx > 1) {
        info.dpiX = Math.round(dx * 2.54 * 100) / 100;
        info.dpiY = Math.round(dy * 2.54 * 100) / 100;
      }
    } else if (marker === 0xe2 && len > 14) {
      const tag = String.fromCharCode(...b.subarray(body, body + 11));
      if (tag === 'ICC_PROFILE') info.hasIccProfile = true;
    } else if (marker === 0xe1 && len > 8 && info.dpiX === undefined) {
      const dpi = exifResolution(b.subarray(body, body + len - 2));
      if (dpi) {
        info.dpiX = dpi.x;
        info.dpiY = dpi.y;
      }
    } else if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      info.bitsPerChannel = b[body];
      info.height = (b[body + 1] << 8) | b[body + 2];
      info.width = (b[body + 3] << 8) | b[body + 4];
      const comps = b[body + 5];
      info.color = comps === 1 ? 'grey' : comps === 3 ? 'rgb' : comps === 4 ? 'cmyk' : 'unknown';
      info.progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
      break;
    } else if (marker === 0xda) {
      break;
    }
    off = body + len - 2;
  }
  return info;
}

/** Resolution from an EXIF block (tags 0x011A, 0x011B, 0x0128). */
function exifResolution(b: Uint8Array): { x: number; y: number } | null {
  if (b.length < 14 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'Exif') return null;
  const t = b.subarray(6);
  if (t.length < 8) return null;
  const little = t[0] === 0x49;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o: number) => v.getUint16(o, little);
  const u32 = (o: number) => v.getUint32(o, little);
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    let x = 0;
    let y = 0;
    let unit = 2;
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      if (tag === 0x011a || tag === 0x011b) {
        const p = u32(e + 8);
        const val = u32(p) / (u32(p + 4) || 1);
        if (tag === 0x011a) x = val;
        else y = val;
      } else if (tag === 0x0128) unit = u16(e + 8);
    }
    if (x > 1) {
      const f = unit === 3 ? 2.54 : 1;
      return { x: Math.round(x * f * 100) / 100, y: Math.round((y || x) * f * 100) / 100 };
    }
  } catch {
    /* damaged EXIF: ignore */
  }
  return null;
}

function readGif(b: Uint8Array): ImageInfo {
  return {
    format: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), color: 'rgb', hasAlpha: true, hasIccProfile: false,
  };
}

function readWebp(b: Uint8Array): ImageInfo {
  const info: ImageInfo = { format: 'webp', width: 0, height: 0, color: 'rgb', hasAlpha: false, hasIccProfile: false };
  const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (kind === 'VP8X') {
    info.hasAlpha = (b[20] & 0x10) !== 0;
    info.hasIccProfile = (b[20] & 0x20) !== 0;
    info.width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    info.height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
  } else if (kind === 'VP8 ') {
    info.width = (b[26] | (b[27] << 8)) & 0x3fff;
    info.height = (b[28] | (b[29] << 8)) & 0x3fff;
  } else if (kind === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    info.width = (bits & 0x3fff) + 1;
    info.height = ((bits >> 14) & 0x3fff) + 1;
    info.hasAlpha = ((bits >> 28) & 1) === 1;
  }
  return info;
}

function readSvg(b: Uint8Array): ImageInfo | null {
  const head = new TextDecoder('utf-8').decode(b.subarray(0, Math.min(b.length, 4096)));
  if (!/<svg[\s>]/i.test(head)) return null;
  const num = (re: RegExp) => {
    const m = re.exec(head);
    return m ? parseFloat(m[1]) : 0;
  };
  let width = num(/<svg[^>]*\swidth=["']([\d.]+)/i);
  let height = num(/<svg[^>]*\sheight=["']([\d.]+)/i);
  const vb = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
  if ((!width || !height) && vb) {
    width = parseFloat(vb[1]);
    height = parseFloat(vb[2]);
  }
  return { format: 'svg', width, height, color: 'rgb', hasAlpha: true, hasIccProfile: false };
}

/** Inspect an image file. Unknown formats come back with format "unknown" and zero size. */
export function imageInfo(bytes: Uint8Array): ImageInfo {
  if (isPng(bytes)) {
    const h = readPngHeader(bytes);
    return {
      format: 'png', width: h.width, height: h.height, color: h.isGrey ? 'grey' : 'rgb', hasAlpha: h.hasAlpha,
      hasIccProfile: h.hasIccProfile, dpiX: h.dpiX, dpiY: h.dpiY, bitsPerChannel: h.bitDepth,
    };
  }
  if (isJpeg(bytes)) return readJpeg(bytes);
  if (bytes.length > 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return readGif(bytes);
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return readWebp(bytes);
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { format: 'pdf', width: 0, height: 0, color: 'unknown', hasAlpha: false, hasIccProfile: false };
  }
  if ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[3] === 0x2a)) {
    return { format: 'tiff', width: 0, height: 0, color: 'unknown', hasAlpha: false, hasIccProfile: false };
  }
  return readSvg(bytes) ?? { format: 'unknown', width: 0, height: 0, color: 'unknown', hasAlpha: false, hasIccProfile: false };
}

export interface DpiCheck {
  /** Pixels per printed inch at the size the image is placed. */
  effectiveDpi: number;
  ok: boolean;
  message?: string;
}

/**
 * Print resolution of an image placed at a given width. What matters is how
 * many pixels end up in each printed inch, not the DPI number stored in the
 * file.
 */
export function effectiveDpi(info: Pick<ImageInfo, 'width' | 'height' | 'format'>, placedWidthIn: number, minDpi = 300, name = 'This picture'): DpiCheck {
  if (info.format === 'svg' || info.format === 'pdf') return { effectiveDpi: Infinity, ok: true };
  if (!info.width || placedWidthIn <= 0) return { effectiveDpi: 0, ok: false, message: `${name} could not be measured.` };
  const dpi = info.width / placedWidthIn;
  if (dpi + 0.5 >= minDpi) return { effectiveDpi: Math.round(dpi), ok: true };
  const maxWidth = Math.floor((info.width / minDpi) * 100) / 100;
  return {
    effectiveDpi: Math.round(dpi),
    ok: false,
    message: `${name} is ${info.width} pixels wide and is printed ${Math.round(placedWidthIn * 100) / 100} in wide, which is only ${Math.round(dpi)} dpi (the minimum is ${minDpi}). Use a larger file, or print it no wider than ${maxWidth} in.`,
  };
}
