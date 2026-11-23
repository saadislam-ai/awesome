/**
 * The cover design of a book, stored as cover/cover.json in the book folder.
 * One design serves every edition: the panels are laid out again for each
 * trim size, page count and platform.
 */
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour such as #1f3a5f');

export const COVER_LAYOUTS = ['classic', 'band', 'minimal'] as const;
export type CoverLayout = (typeof COVER_LAYOUTS)[number];

export const COVER_LAYOUT_INFO: Record<CoverLayout, { label: string; hint: string }> = {
  classic: { label: 'Classic', hint: 'Centred title and author, with an optional picture in the upper part.' },
  band: { label: 'Band', hint: 'A full picture with the title on a solid band across it.' },
  minimal: { label: 'Minimal', hint: 'Large title set to the left on a plain colour.' },
};

export const CoverDesignSchema = z.object({
  schema: z.literal(1).default(1),
  layout: z.enum(COVER_LAYOUTS).default('classic'),
  colors: z
    .object({
      background: hex.default('#1f3a5f'),
      text: hex.default('#ffffff'),
      accent: hex.default('#c8a45c'),
      /** Back cover and spine; empty means the same as the front. */
      backBackground: hex.nullable().default(null),
      backText: hex.nullable().default(null),
      /** Band behind the title in the "band" layout; empty means the background colour. */
      band: hex.nullable().default(null),
    })
    .default({}),
  fonts: z
    .object({
      title: z.string().default('EB Garamond'),
      body: z.string().default('EB Garamond'),
      titleCase: z.enum(['as-typed', 'upper', 'small-caps']).default('as-typed'),
      titleWeight: z.enum(['regular', 'bold']).default('regular'),
    })
    .default({}),
  art: z
    .object({
      /** Picture for the front cover, a file in cover/art. */
      front: z.string().nullable().default(null),
      /** full: behind the whole front cover. top: the upper part only. */
      frontMode: z.enum(['full', 'top']).default('full'),
      /** One finished picture across back, spine and front (from a designer). */
      wrap: z.string().nullable().default(null),
      /** The wrap picture already contains title, author and back text: add nothing but the barcode. */
      wrapHasText: z.boolean().default(true),
      authorPhoto: z.string().nullable().default(null),
      logo: z.string().nullable().default(null),
    })
    .default({}),
  front: z
    .object({
      /** Empty fields use the book's own title, subtitle and author. */
      title: z.string().default(''),
      subtitle: z.string().default(''),
      author: z.string().default(''),
      tagline: z.string().default(''),
      showSubtitle: z.boolean().default(true),
    })
    .default({}),
  spine: z
    .object({
      showTitle: z.boolean().default(true),
      showAuthor: z.boolean().default(true),
      showImprint: z.boolean().default(true),
    })
    .default({}),
  back: z
    .object({
      headline: z.string().default(''),
      /** Back cover text. Blank lines separate paragraphs; *italic* and **bold** work. */
      blurb: z.string().default(''),
      bio: z.string().default(''),
      showImprint: z.boolean().default(true),
      showWebsite: z.boolean().default(true),
      align: z.enum(['left', 'justify']).default('left'),
    })
    .default({}),
  /** Dust jacket flaps. */
  flaps: z.object({ front: z.string().default(''), back: z.string().default('') }).default({}),
  barcode: z
    .object({
      /**
       * own: draw the ISBN barcode.
       * platform: leave the area free; the platform prints its barcode (KDP). Where a barcode is required it is still drawn.
       * none: no barcode and no reserved area.
       */
      mode: z.enum(['own', 'platform', 'none']).default('own'),
      /** Five digit price add-on. */
      addon: z.enum(['none', 'no-price', 'price']).default('no-price'),
      currency: z.enum(['USD', 'CAD']).default('USD'),
      price: z.number().nonnegative().nullable().default(null),
    })
    .default({}),
});
export type CoverDesign = z.infer<typeof CoverDesignSchema>;

export const defaultCoverDesign = (): CoverDesign => CoverDesignSchema.parse({});

/** "#1f3a5f" to [31, 58, 95]. */
export function hexToRgb(value: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Rough lightness of a colour (0 dark to 1 light), to choose readable text colours and warn about weak contrast. */
export function luminance(value: string): number {
  const [r, g, b] = hexToRgb(value).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
