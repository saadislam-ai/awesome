/**
 * A three dimensional mock-up of the printed book: the front cover and the
 * spine seen at an angle, with a soft shadow. Made from the flat cover
 * picture, for web pages, social posts and retailer A+ content.
 */
import { blurAlpha, crop, drawQuad, type Pt } from '../image/warp';
import type { RasterImage } from '../image/png';
import type { CoverGeometry } from './geometry';

export interface MockupOptions {
  /** Width and height of the picture in pixels. */
  size?: number;
  /** How far the book is turned, in degrees. 0 is flat on. */
  angle?: number;
  /** Background colour, or null for a transparent background. */
  background?: [number, number, number] | null;
}

/**
 * `flat` is the cover drawn without guides; `pxPerIn` is its resolution.
 * Returns an RGBA picture.
 */
export function bookMockup(flat: RasterImage, g: CoverGeometry, pxPerIn: number, opts: MockupOptions = {}): RasterImage {
  const size = opts.size ?? 1600;
  const angle = ((opts.angle ?? 28) * Math.PI) / 180;
  const front = crop(flat, g.front.x * pxPerIn, g.front.y * pxPerIn, g.front.w * pxPerIn, g.front.h * pxPerIn);
  const spine = crop(flat, g.spine.x * pxPerIn, g.spine.y * pxPerIn, Math.max(1, g.spine.w * pxPerIn), g.spine.h * pxPerIn);
  const w = g.front.w;
  const h = g.front.h;
  const s = Math.max(g.spine.w, 0.02);

  // The book stands upright. Its spine edge is the vertical line x = 0, z = 0;
  // the front cover runs to the right and the spine runs back from that edge.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const distance = h * 3.4;
  const eyeY = h * 0.46;
  const project = (x: number, y: number, z: number): Pt => {
    const xr = x * cos - z * sin;
    const zr = x * sin + z * cos;
    const k = distance / (distance + zr);
    return [xr * k, (y - eyeY) * k];
  };
  const frontQuad = [project(0, 0, 0), project(w, 0, 0), project(w, h, 0), project(0, h, 0)];
  const spineQuad = [project(0, 0, s), project(0, 0, 0), project(0, h, 0), project(0, h, s)];
  const all = [...frontQuad, ...spineQuad];
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const scale = Math.min((size * 0.74) / (maxX - minX), (size * 0.8) / (maxY - minY));
  const ox = (size - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (size - (maxY - minY) * scale) / 2 - minY * scale - size * 0.01;
  const place = (q: Pt[]): Pt[] => q.map(([x, y]) => [x * scale + ox, y * scale + oy] as Pt);
  const fq = place(frontQuad);
  const sq = place(spineQuad);

  const out: RasterImage = { width: size, height: size, channels: 4, data: new Uint8Array(size * size * 4) };

  // Shadow: the outline of the book, pushed down and to the right, blurred.
  const shadow: RasterImage = { width: size, height: size, channels: 4, data: new Uint8Array(size * size * 4) };
  const black: RasterImage = { width: 2, height: 2, channels: 3, data: new Uint8Array(12) };
  const dx = size * 0.018;
  const dy = size * 0.022;
  const outline: Pt[] = [sq[0], fq[1], fq[2], sq[3]].map(([x, y]) => [x + dx, y + dy] as Pt);
  drawQuad(shadow, black, outline, () => 1, 1);
  blurAlpha(shadow, size * 0.016);
  for (let i = 0; i < size * size; i++) {
    out.data[i * 4 + 3] = Math.round(shadow.data[i * 4 + 3] * 0.42);
  }

  // The spine is turned away from the light; the front darkens slightly towards the far edge.
  drawQuad(out, spine, sq, (u) => 0.62 + 0.14 * u);
  drawQuad(out, front, fq, (u) => {
    const crease = u < 0.012 ? 0.84 + (u / 0.012) * 0.16 : 1;
    return (1.0 - 0.07 * u) * crease;
  });

  if (opts.background) {
    const [br, bg, bb] = opts.background;
    for (let i = 0; i < size * size; i++) {
      const a = out.data[i * 4 + 3] / 255;
      out.data[i * 4] = Math.round(out.data[i * 4] * a + br * (1 - a));
      out.data[i * 4 + 1] = Math.round(out.data[i * 4 + 1] * a + bg * (1 - a));
      out.data[i * 4 + 2] = Math.round(out.data[i * 4 + 2] * a + bb * (1 - a));
      out.data[i * 4 + 3] = 255;
    }
  }
  return out;
}
