/**
 * JPEG reading and writing through the small pure JavaScript library
 * "jpeg-js", so the app needs no native image code and gives the same result
 * on every computer.
 */
import { decode, encode } from 'jpeg-js';
import type { RasterImage } from './png';

/** Decode a JPEG (grey, colour or CMYK) into 8 bit RGB pixels. */
export function decodeJpeg(bytes: Uint8Array): RasterImage {
  const d = decode(bytes, { useTArray: true, formatAsRGBA: false, tolerantDecoding: true, maxResolutionInMP: 400, maxMemoryUsageInMB: 2048 });
  return { width: d.width, height: d.height, channels: 3, data: d.data };
}

/** Encode pixels as a JPEG. Quality is 1 to 100; 90 is a good value for covers. */
export function encodeJpeg(img: RasterImage, quality = 90): Uint8Array {
  const { width, height, channels, data } = img;
  // The encoder wants RGBA.
  let rgba: Uint8Array;
  if (channels === 4) {
    rgba = data;
  } else {
    rgba = new Uint8Array(width * height * 4);
    for (let i = 0, s = 0, d = 0; i < width * height; i++, s += channels, d += 4) {
      if (channels >= 3) {
        rgba[d] = data[s]; rgba[d + 1] = data[s + 1]; rgba[d + 2] = data[s + 2];
      } else {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = data[s];
      }
      rgba[d + 3] = 255;
    }
  }
  // The library returns a Node "Buffer". Inside the app window there is no
  // Buffer, so a stand-in is provided for the length of this one call.
  const g = globalThis as { Buffer?: unknown };
  const hadBuffer = g.Buffer !== undefined;
  if (!hadBuffer) g.Buffer = { from: (a: ArrayLike<number>) => Uint8Array.from(a) };
  try {
    const out = encode({ data: rgba, width, height }, Math.min(100, Math.max(1, Math.round(quality))));
    return new Uint8Array(out.data);
  } finally {
    if (!hadBuffer) delete g.Buffer;
  }
}
