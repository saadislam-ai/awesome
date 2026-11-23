/**
 * RGB to CMYK conversion for print files.
 *
 * Printers such as IngramSpark want pictures in CMYK with a limited total
 * amount of ink (240 %). A screen colour has no single CMYK equivalent: the
 * right answer depends on the press and paper. The bundled ICC profile says
 * which colour each ink mix produces; this module searches, for a grid of
 * screen colours, the ink mix that comes closest while
 *
 *   - staying under the ink limit,
 *   - using black ink for dark and grey areas (cleaner, cheaper, more stable
 *     on press than building darkness from three colours),
 *   - keeping paper white free of ink.
 *
 * The result is a lookup table; pictures are then converted by interpolating
 * in that table, which is fast.
 *
 * Trade-off, stated plainly: this is a careful approximation, not a full
 * colour management system. Very saturated screen colours that no press can
 * print (pure RGB blue, neon green) are mapped to the nearest printable
 * colour. For colour critical covers, order a printed proof.
 */
import { CmykProfile, D50, lightnessToY, srgbToXyz, xyzToLab, type Lab } from './icc';

export interface CmykOptions {
  /** Highest total of the four inks: 2.4 means 240 %. */
  inkLimit?: number;
  /** Grid points per colour channel of the lookup table. */
  grid?: number;
}

export type Cmyk = [number, number, number, number];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Plain arithmetic conversion, used only when no profile is available. */
export function naiveRgbToCmyk(r: number, g: number, b: number, inkLimit = 2.4): Cmyk {
  const c0 = 1 - r / 255;
  const m0 = 1 - g / 255;
  const y0 = 1 - b / 255;
  const k = Math.min(c0, m0, y0);
  if (k >= 0.999) return limitInk([0.6, 0.4, 0.4, 1], inkLimit);
  // Replace only part of the grey component by black so mid tones stay smooth.
  const kk = k * k;
  return limitInk([(c0 - kk) / (1 - kk), (m0 - kk) / (1 - kk), (y0 - kk) / (1 - kk), kk], inkLimit);
}

/** Scale the three colours down (black is kept) until the total is within the limit. */
export function limitInk(cmyk: Cmyk, inkLimit: number): Cmyk {
  const total = cmyk[0] + cmyk[1] + cmyk[2] + cmyk[3];
  if (total <= inkLimit) return cmyk;
  const colours = cmyk[0] + cmyk[1] + cmyk[2];
  const room = Math.max(0, inkLimit - cmyk[3]);
  const f = colours > 0 ? room / colours : 0;
  return [cmyk[0] * f, cmyk[1] * f, cmyk[2] * f, cmyk[3]];
}

/** Largest ink total found in CMYK pixels (0 = no ink, 255 = full), as a fraction: 2.4 = 240 %. */
export function maxInk(cmykPixels: Uint8Array): number {
  let max = 0;
  for (let i = 0; i + 3 < cmykPixels.length; i += 4) {
    const t = cmykPixels[i] + cmykPixels[i + 1] + cmykPixels[i + 2] + cmykPixels[i + 3];
    if (t > max) max = t;
  }
  return max / 255;
}

export class RgbToCmyk {
  readonly grid: number;
  readonly inkLimit: number;
  /** Darkest colour the press can print within the ink limit. */
  readonly blackLab: Lab;
  /** grid^3 x 4 ink amounts; index ((r * grid) + g) * grid + b. */
  private readonly lut: Float32Array;
  private readonly pos = new Uint8Array(256);
  private readonly frac = new Float32Array(256);

  constructor(private readonly profile: CmykProfile, opts: CmykOptions = {}) {
    this.grid = opts.grid ?? 17;
    this.inkLimit = opts.inkLimit ?? 2.4;
    const s = Math.min(1, Math.max(0, (this.inkLimit - 1) / 1.4));
    this.blackLab = profile.toLab(0.6 * s, 0.4 * s, 0.4 * s, 1);
    for (let v = 0; v < 256; v++) {
      const p = (v / 255) * (this.grid - 1);
      const i = Math.min(this.grid - 2, Math.floor(p));
      this.pos[v] = i;
      this.frac[v] = p - i;
    }
    this.lut = this.build();
  }

  /** The colour a screen colour should have on paper, after fitting the screen's black to the press's black. */
  private target(r: number, g: number, b: number): Lab {
    const ybp = lightnessToY(this.blackLab[0]);
    const [x, y, z] = srgbToXyz(r, g, b);
    return xyzToLab(x * (1 - ybp) + ybp * D50[0], y * (1 - ybp) + ybp * D50[1], z * (1 - ybp) + ybp * D50[2]);
  }

  /** How much black ink a colour should preferably carry: none in light colours, a lot in dark greys. */
  private preferredBlack(t: Lab): number {
    const darkness = (100 - t[0]) / Math.max(1, 100 - this.blackLab[0]);
    const chroma = Math.hypot(t[1], t[2]);
    const neutral = Math.min(1, Math.max(0.3, 1 - chroma / 80));
    return Math.pow(clamp01((darkness - 0.3) / 0.7), 1.3) * neutral;
  }

  /**
   * Best ink mix for one screen colour. The amount of black is chosen first
   * (a smooth function of the colour, so neighbouring colours get similar
   * separations and gradients do not band); the three colours are then
   * fitted around it. Only when that black makes the colour unreachable is
   * the amount of black itself searched.
   */
  private solve(r: number, g: number, b: number): Cmyk {
    const t = this.target(r, g, b);
    const kPref = this.preferredBlack(t);
    const lab: Lab = [0, 0, 0];
    const limit = this.inkLimit;
    const profile = this.profile;
    const x = [0, 0, 0];
    /** Fit cyan, magenta and yellow for a fixed black; returns the remaining colour error (squared). */
    const fit = (k: number, firstStep: number): number => {
      const cost = (): number => {
        profile.toLab(x[0], x[1], x[2], k, lab);
        const dl = lab[0] - t[0];
        const da = lab[1] - t[1];
        const db = lab[2] - t[2];
        const over = x[0] + x[1] + x[2] + k - limit;
        return dl * dl + da * da + db * db + (over > 0 ? 6000 * over * over : 0);
      };
      let fx = cost();
      // Pattern search: try a step in each direction, keep what helps, halve the step when nothing does.
      for (let step = firstStep; step > 0.0015; step *= 0.5) {
        for (let guard = 0; guard < 60; guard++) {
          let improved = false;
          for (let i = 0; i < 3; i++) {
            for (let dir = -1; dir <= 1; dir += 2) {
              const old = x[i];
              const v = clamp01(old + dir * step);
              if (v === old) continue;
              x[i] = v;
              const f = cost();
              if (f < fx - 1e-9) { fx = f; improved = true; } else x[i] = old;
            }
          }
          if (!improved) break;
        }
      }
      return fx;
    };
    // Starting point: the arithmetic conversion around the preferred black.
    const c0 = 1 - r / 255;
    const m0 = 1 - g / 255;
    const y0 = 1 - b / 255;
    const k0 = Math.min(kPref, c0, m0, y0, 0.98);
    x[0] = clamp01((c0 - k0) / (1 - k0));
    x[1] = clamp01((m0 - k0) / (1 - k0));
    x[2] = clamp01((y0 - k0) / (1 - k0));
    let k = kPref;
    const err = fit(k, 0.2);
    if (err > 0.3) {
      // The colour cannot be reached with the preferred black: search the black amount too.
      const total = (kk: number): number => fit(kk, 0.1) + 3 * (kk - kPref) * (kk - kPref);
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 12; i++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (total(m1) < total(m2)) hi = m2; else lo = m1;
      }
      k = (lo + hi) / 2;
      fit(k, 0.1);
    }
    return limitInk([x[0], x[1], x[2], k], limit);
  }

  private build(): Float32Array {
    const n = this.grid;
    const lut = new Float32Array(n * n * n * 4);
    let at = 0;
    for (let ri = 0; ri < n; ri++) {
      const r = Math.round((ri / (n - 1)) * 255);
      for (let gi = 0; gi < n; gi++) {
        const g = Math.round((gi / (n - 1)) * 255);
        for (let bi = 0; bi < n; bi++, at += 4) {
          const b = Math.round((bi / (n - 1)) * 255);
          // Paper white carries no ink at all.
          if (r === 255 && g === 255 && b === 255) continue;
          const s = this.solve(r, g, b);
          lut[at] = s[0];
          lut[at + 1] = s[1];
          lut[at + 2] = s[2];
          lut[at + 3] = s[3];
        }
      }
    }
    return lut;
  }

  /** Ink amounts (0..1) for a screen colour (0..255 per channel). */
  color(r: number, g: number, b: number): Cmyk {
    const out: Cmyk = [0, 0, 0, 0];
    this.sample(r & 255, g & 255, b & 255, out);
    return out;
  }

  private sample(r: number, g: number, b: number, out: number[]): void {
    const n = this.grid;
    const lut = this.lut;
    const fr = this.frac[r];
    const fg = this.frac[g];
    const fb = this.frac[b];
    const base = ((this.pos[r] * n + this.pos[g]) * n + this.pos[b]) * 4;
    const dr = n * n * 4;
    const dg = n * 4;
    for (let ch = 0; ch < 4; ch++) {
      const i = base + ch;
      const c00 = lut[i] * (1 - fb) + lut[i + 4] * fb;
      const c01 = lut[i + dg] * (1 - fb) + lut[i + dg + 4] * fb;
      const c10 = lut[i + dr] * (1 - fb) + lut[i + dr + 4] * fb;
      const c11 = lut[i + dr + dg] * (1 - fb) + lut[i + dr + dg + 4] * fb;
      const c0 = c00 * (1 - fg) + c01 * fg;
      const c1 = c10 * (1 - fg) + c11 * fg;
      out[ch] = c0 * (1 - fr) + c1 * fr;
    }
  }

  /**
   * Convert 8 bit RGB (or RGBA, alpha ignored) pixels to 8 bit CMYK pixels,
   * in the form PDF expects: 0 is no ink, 255 is full ink.
   */
  pixels(data: Uint8Array, channels: 3 | 4 = 3): Uint8Array {
    const count = Math.floor(data.length / channels);
    const out = new Uint8Array(count * 4);
    const tmp = [0, 0, 0, 0];
    let pr = -1;
    let pg = -1;
    let pb = -1;
    for (let i = 0, s = 0, d = 0; i < count; i++, s += channels, d += 4) {
      const r = data[s];
      const g = data[s + 1];
      const b = data[s + 2];
      // Flat areas repeat the same colour: reuse the last answer.
      if (r !== pr || g !== pg || b !== pb) {
        this.sample(r, g, b, tmp);
        pr = r; pg = g; pb = b;
      }
      out[d] = Math.round(tmp[0] * 255);
      out[d + 1] = Math.round(tmp[1] * 255);
      out[d + 2] = Math.round(tmp[2] * 255);
      out[d + 3] = Math.round(tmp[3] * 255);
    }
    return out;
  }
}

const cache = new Map<string, RgbToCmyk>();

/** Build (once per session) the converter for a profile and ink limit. */
export function rgbToCmykConverter(iccBytes: Uint8Array, opts: CmykOptions = {}): RgbToCmyk {
  const key = `${iccBytes.length}:${iccBytes[100] ?? 0}:${iccBytes[iccBytes.length - 1] ?? 0}:${opts.inkLimit ?? 2.4}:${opts.grid ?? 17}`;
  let conv = cache.get(key);
  if (!conv) {
    conv = new RgbToCmyk(new CmykProfile(iccBytes), opts);
    cache.set(key, conv);
  }
  return conv;
}
