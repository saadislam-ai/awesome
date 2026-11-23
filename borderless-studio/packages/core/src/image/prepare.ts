/**
 * Getting a picture ready for a print interior.
 *
 * The original file in the book folder is never changed. A prepared copy is
 * written to the build folder when the print file needs something different:
 *
 *   - black and white interiors get greyscale pictures (the press prints
 *     them in black ink only; converting here shows the real result in the
 *     preview and keeps colour data out of the file),
 *   - transparency is flattened onto white (print files may not contain
 *     transparency),
 *   - 16 bit pictures are reduced to 8 bit.
 */
import { decodeJpeg } from './jpeg';
import { imageInfo, type ImageInfo } from './info';
import { decodePng, encodePng, flattenAlpha, toGreyscale, type RasterImage } from './png';

export interface PrepareOptions {
  /** Convert colour pictures to greyscale (black and white interiors). */
  greyscale: boolean;
}

export interface PreparedImage {
  /** Bytes to hand to the typesetter. The same array as the input when nothing had to change. */
  bytes: Uint8Array;
  /** File extension matching `bytes`, with the dot. */
  ext: string;
  changed: boolean;
  info: ImageInfo;
  /** What was done, in plain words, for the build log. */
  actions: string[];
  /** A problem that stops this picture from being used in print. */
  problem?: string;
  /** Something the user should know but that does not stop the build. */
  caution?: string;
}

const EXT: Record<string, string> = { png: '.png', jpeg: '.jpg', gif: '.gif', svg: '.svg', webp: '.webp' };

/** Decode any picture this app can read into plain pixels. Returns null for formats it cannot decode. */
export function decodeImage(bytes: Uint8Array): RasterImage | null {
  const info = imageInfo(bytes);
  if (info.format === 'png') return decodePng(bytes);
  if (info.format === 'jpeg') return decodeJpeg(bytes);
  return null;
}

export function prepareImageForPrint(bytes: Uint8Array, opts: PrepareOptions): PreparedImage {
  const info = imageInfo(bytes);
  const base: PreparedImage = { bytes, ext: EXT[info.format] ?? '', changed: false, info, actions: [] };
  switch (info.format) {
    case 'png': {
      const needsGrey = opts.greyscale && info.color !== 'grey';
      const needs8bit = (info.bitsPerChannel ?? 8) > 8;
      if (!needsGrey && !info.hasAlpha && !needs8bit) return base;
      let img: RasterImage;
      try {
        img = decodePng(bytes);
      } catch (e) {
        return { ...base, problem: e instanceof Error ? e.message : String(e) };
      }
      const actions: string[] = [];
      if (img.channels === 2 || img.channels === 4) {
        img = flattenAlpha(img);
        actions.push('transparency flattened onto white');
      }
      if (opts.greyscale && img.channels >= 3) {
        img = toGreyscale(img);
        actions.push('converted to greyscale');
      }
      if (needs8bit) actions.push('reduced to 8 bit');
      return { ...base, bytes: encodePng(img, info.dpiX), ext: '.png', changed: true, actions };
    }
    case 'jpeg': {
      if (!opts.greyscale || info.color === 'grey') return base;
      let img: RasterImage;
      try {
        img = decodeJpeg(bytes);
      } catch (e) {
        return { ...base, problem: `This JPEG could not be read (${e instanceof Error ? e.message : String(e)}). Save it again as a standard JPEG or PNG.` };
      }
      return { ...base, bytes: encodePng(toGreyscale(img), info.dpiX), ext: '.png', changed: true, actions: ['converted to greyscale'] };
    }
    case 'gif':
    case 'webp':
      return {
        ...base,
        caution: opts.greyscale
          ? `This ${info.format.toUpperCase()} picture is used as it is. Save it as PNG or JPEG so the app can convert it to greyscale and check it for print.`
          : `This ${info.format.toUpperCase()} picture is used as it is. PNG or JPEG is safer for print.`,
      };
    case 'svg':
      return {
        ...base,
        caution: 'Drawings in SVG format are placed as they are. If the drawing uses colour, the printer converts it; for a strict PDF/X file export the drawing as a 600 dpi PNG instead.',
      };
    default:
      return { ...base, problem: 'This file type cannot be used in a print book. Use PNG or JPEG.' };
  }
}
