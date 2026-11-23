/**
 * Drawing a picture into an arbitrary four cornered shape (a perspective
 * view), used for the three dimensional book mock-up. Plain pixel work, no
 * graphics library.
 */
import type { RasterImage } from './png';

export type Pt = [number, number];

/** Solve the 8 unknowns of the projective map that sends four source points to four target points. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8 x 9 system.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    if (Math.abs(p) < 1e-12) throw new Error('The four points do not form a usable shape.');
    for (let c = col; c < 9; c++) a[col][c] /= p;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  return [a[0][8], a[1][8], a[2][8], a[3][8], a[4][8], a[5][8], a[6][8], a[7][8], 1];
}

export function crop(img: RasterImage, x: number, y: number, w: number, h: number): RasterImage {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const cw = Math.max(1, Math.min(img.width - x0, Math.round(w)));
  const ch = Math.max(1, Math.min(img.height - y0, Math.round(h)));
  const data = new Uint8Array(cw * ch * img.channels);
  for (let row = 0; row < ch; row++) {
    const start = ((y0 + row) * img.width + x0) * img.channels;
    data.set(img.data.subarray(start, start + cw * img.channels), row * cw * img.channels);
  }
  return { width: cw, height: ch, channels: img.channels, data };
}

/**
 * Draw `src` into `dest` (RGBA) so that its corners land on `quad`
 * (top left, top right, bottom right, bottom left). `shade(u, v)` returns a
 * brightness factor for the point at fraction u across and v down the source.
 */
export function drawQuad(dest: RasterImage, src: RasterImage, quad: Pt[], shade: (u: number, v: number) => number = () => 1, samples = 3): void {
  if (dest.channels !== 4) throw new Error('The target picture must be RGBA.');
  const sw = src.width;
  const sh = src.height;
  // Map target pixels back into the source.
  const h = homography(quad, [[0, 0], [sw, 0], [sw, sh], [0, sh]]);
  const minX = Math.max(0, Math.floor(Math.min(...quad.map((p) => p[0]))));
  const maxX = Math.min(dest.width - 1, Math.ceil(Math.max(...quad.map((p) => p[0]))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((p) => p[1]))));
  const maxY = Math.min(dest.height - 1, Math.ceil(Math.max(...quad.map((p) => p[1]))));
  const sc = src.channels;
  const n = samples * samples;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          const w = h[6] * px + h[7] * py + h[8];
          const u = (h[0] * px + h[1] * py + h[2]) / w;
          const v = (h[3] * px + h[4] * py + h[5]) / w;
          if (u < 0 || v < 0 || u >= sw || v >= sh) continue;
          // Bilinear sampling
          const x0 = Math.min(sw - 1, Math.floor(u));
          const y0 = Math.min(sh - 1, Math.floor(v));
          const x1 = Math.min(sw - 1, x0 + 1);
          const y1 = Math.min(sh - 1, y0 + 1);
          const fx = u - x0;
          const fy = v - y0;
          const k = shade(u / sw, v / sh);
          const at = (xx: number, yy: number, ch: number) => src.data[(yy * sw + xx) * sc + (sc >= 3 ? ch : 0)];
          for (let ch = 0; ch < 3; ch++) {
            const top = at(x0, y0, ch) * (1 - fx) + at(x1, y0, ch) * fx;
            const bottom = at(x0, y1, ch) * (1 - fx) + at(x1, y1, ch) * fx;
            const value = (top * (1 - fy) + bottom * fy) * k;
            if (ch === 0) r += value; else if (ch === 1) g += value; else b += value;
          }
          hits++;
        }
      }
      if (hits === 0) continue;
      const cover = hits / n;
      const i = (y * dest.width + x) * 4;
      const da = dest.data[i + 3] / 255;
      const outA = cover + da * (1 - cover);
      const mix = (srcV: number, dstV: number) => (srcV * cover + dstV * da * (1 - cover)) / (outA || 1);
      dest.data[i] = Math.max(0, Math.min(255, Math.round(mix(r / hits, dest.data[i]))));
      dest.data[i + 1] = Math.max(0, Math.min(255, Math.round(mix(g / hits, dest.data[i + 1]))));
      dest.data[i + 2] = Math.max(0, Math.min(255, Math.round(mix(b / hits, dest.data[i + 2]))));
      dest.data[i + 3] = Math.round(outA * 255);
    }
  }
}

/** Blur one channel of an RGBA picture with a repeated box filter (close to a Gaussian). */
export function blurAlpha(img: RasterImage, radius: number, passes = 3): void {
  const { width: w, height: h } = img;
  let a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = img.data[i * 4 + 3];
  let tmp = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[y * w + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * r + 1);
        sum += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / (2 * r + 1);
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
  for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = Math.round(a[i]);
  void tmp;
}
