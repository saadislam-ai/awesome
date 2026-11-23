import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, flattenAlpha, isEffectivelyGrey, readPngHeader, resizeImage, toGreyscale } from '../src/image/png';
import { effectiveDpi, imageInfo } from '../src/image/info';

const rgb = (w: number, h: number) => {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = (i * 7) % 256;
    data[i * 3 + 1] = (i * 13) % 256;
    data[i * 3 + 2] = (i * 29) % 256;
  }
  return { width: w, height: h, channels: 3 as const, data };
};

describe('PNG codec', () => {
  it('round trips RGB, grey and RGBA images exactly', () => {
    const a = rgb(37, 21);
    expect(decodePng(encodePng(a)).data).toEqual(a.data);
    const grey = { width: 5, height: 4, channels: 1 as const, data: Uint8Array.from({ length: 20 }, (_, i) => i * 12) };
    expect(decodePng(encodePng(grey)).data).toEqual(grey.data);
    const rgba = { width: 3, height: 2, channels: 4 as const, data: Uint8Array.from({ length: 24 }, (_, i) => (i * 37) % 256) };
    const back = decodePng(encodePng(rgba));
    expect(back.channels).toBe(4);
    expect(back.data).toEqual(rgba.data);
  });

  it('stores and reads the resolution', () => {
    const png = encodePng(rgb(10, 10), 300);
    expect(readPngHeader(png).dpiX).toBeCloseTo(300, 0);
    expect(imageInfo(png)).toMatchObject({ format: 'png', width: 10, height: 10, color: 'rgb', hasAlpha: false });
  });

  it('converts to greyscale and flattens transparency onto white', () => {
    const red = { width: 1, height: 1, channels: 3 as const, data: Uint8Array.from([255, 0, 0]) };
    expect(toGreyscale(red).data[0]).toBe(54); // 0.2126 x 255
    const half = { width: 1, height: 1, channels: 4 as const, data: Uint8Array.from([0, 0, 0, 128]) };
    expect(flattenAlpha(half).data[0]).toBeCloseTo(127, 0);
    expect(isEffectivelyGrey({ width: 1, height: 1, channels: 3, data: Uint8Array.from([90, 91, 90]) })).toBe(true);
    expect(isEffectivelyGrey(red)).toBe(false);
  });

  it('resizes with averaging', () => {
    const img = { width: 2, height: 2, channels: 1 as const, data: Uint8Array.from([0, 100, 100, 200]) };
    expect(resizeImage(img, 1, 1).data[0]).toBe(100);
    expect(resizeImage(img, 4, 4).width).toBe(4);
  });
});

describe('print resolution', () => {
  it('passes at 300 dpi and explains a low resolution picture', () => {
    expect(effectiveDpi({ width: 1500, height: 1000, format: 'png' }, 5).ok).toBe(true);
    const low = effectiveDpi({ width: 600, height: 400, format: 'jpeg' }, 4, 300, 'map.jpg');
    expect(low.ok).toBe(false);
    expect(low.effectiveDpi).toBe(150);
    expect(low.message).toMatch(/no wider than 2 in/);
  });
});
