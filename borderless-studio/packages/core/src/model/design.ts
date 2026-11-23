/**
 * Interior design settings. A "template" is nothing more than a named preset
 * of these values, so every template stays fully adjustable afterwards.
 * All lengths are inches unless the name says otherwise (points for type).
 */
import { z } from 'zod';

export const TEMPLATE_IDS = ['literary', 'modern', 'classic', 'nonfiction', 'childrens', 'poetry'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const MarginsSchema = z.object({
  top: z.number().min(0),
  bottom: z.number().min(0),
  /** Preferred inside (gutter) margin. The platform minimum always wins if it is larger. */
  inside: z.number().min(0),
  outside: z.number().min(0),
});
export type Margins = z.infer<typeof MarginsSchema>;

export const RunningHeadSchema = z.object({
  enabled: z.boolean().default(true),
  /** Left hand (even) pages. */
  verso: z.enum(['author', 'title', 'part', 'chapter', 'none']).default('author'),
  /** Right hand (odd) pages. */
  recto: z.enum(['title', 'chapter', 'part', 'none']).default('title'),
  style: z.enum(['smallcaps', 'italic', 'caps', 'plain']).default('smallcaps'),
  align: z.enum(['center', 'outside']).default('center'),
  rule: z.boolean().default(false),
  sizePt: z.number().default(9),
  /** Extra letter spacing for capitals and small capitals, in thousandths of an em. */
  trackingMilliEm: z.number().default(60),
});

export const FolioSchema = z.object({
  position: z.enum(['bottom-center', 'bottom-outside', 'top-outside', 'none']).default('bottom-center'),
  sizePt: z.number().default(9.5),
  /** Show the page number on chapter opening pages (bottom centre) even when headers are hidden. */
  showOnOpeners: z.boolean().default(true),
});

export const ChapterOpenerSchema = z.object({
  /** "recto" starts every chapter on a right hand page (adds blank pages where needed). */
  startOn: z.enum(['recto', 'any']).default('any'),
  /** How far down the page the chapter heading starts, as a fraction of the text block height. */
  sink: z.number().min(0).max(0.6).default(0.2),
  numberStyle: z
    .enum(['none', 'arabic', 'roman', 'words', 'chapter-arabic', 'chapter-words', 'chapter-roman'])
    .default('chapter-words'),
  numberCase: z.enum(['as-is', 'upper', 'smallcaps']).default('smallcaps'),
  numberSizePt: z.number().default(11),
  titleSizePt: z.number().default(20),
  titleStyle: z.enum(['regular', 'italic', 'bold', 'smallcaps', 'caps']).default('regular'),
  align: z.enum(['center', 'left', 'right']).default('center'),
  ornament: z.enum(['none', 'rule', 'short-rule', 'fleuron', 'diamond', 'three-stars', 'flourish']).default('none'),
  /** Space between heading block and first paragraph, in body lines. */
  spaceAfterLines: z.number().default(3),
  dropCap: z.object({ enabled: z.boolean().default(false), lines: z.number().int().min(2).max(5).default(3) }).default({}),
  /** Set the first words of a chapter in small capitals. */
  leadIn: z.enum(['none', 'words', 'line']).default('words'),
  leadInWords: z.number().int().min(1).max(8).default(4),
});

export const SceneBreakSchema = z.object({
  style: z.enum(['space', 'asterisks', 'asterism', 'fleuron', 'diamond', 'rule', 'flourish']).default('asterisks'),
  /** Vertical space taken by the break, in body lines. */
  lines: z.number().int().min(1).max(5).default(2),
});

export const DesignSchema = z.object({
  template: z.enum(TEMPLATE_IDS).default('literary'),
  bodyFont: z.string().default('EB Garamond'),
  headingFont: z.string().default('EB Garamond'),
  /** Used by sans serif elements such as call-out titles and table headers. */
  sansFont: z.string().default('Source Sans 3'),
  fontSizePt: z.number().min(6).max(30).default(11),
  /** Distance from baseline to baseline as a multiple of the font size. */
  lineHeight: z.number().min(1).max(2.2).default(1.32),
  paragraphStyle: z.enum(['indent', 'spaced']).default('indent'),
  paragraphIndentEm: z.number().min(0).max(4).default(1.4),
  justify: z.boolean().default(true),
  hyphenate: z.boolean().default(true),
  /** How hard the typesetter tries to avoid hyphens. Typst has no hard limit on stacked hyphens, so this is the lever. */
  hyphenAvoidance: z.enum(['low', 'normal', 'high']).default('normal'),
  widowOrphanControl: z.boolean().default(true),
  /** Keep all vertical spacing in whole lines so that facing pages line up. */
  baselineGrid: z.boolean().default(true),
  /** Old style (lowercase) figures in running text when the font has them. */
  oldstyleFigures: z.boolean().default(true),
  marginPreset: z.enum(['compact', 'comfortable', 'generous', 'custom']).default('comfortable'),
  customMargins: MarginsSchema.optional(),
  runningHeads: RunningHeadSchema.default({}),
  folio: FolioSchema.default({}),
  chapterOpener: ChapterOpenerSchema.default({}),
  sceneBreak: SceneBreakSchema.default({}),
  /** Where notes are printed. */
  notes: z.enum(['footnotes', 'endnotes-chapter', 'endnotes-book']).default('footnotes'),
  /** Heading sizes for sections inside chapters (nonfiction), in points. */
  headingSizesPt: z.tuple([z.number(), z.number(), z.number()]).default([14, 12, 11]),
  headingStyle: z.enum(['serif-bold', 'serif-italic', 'sans-bold', 'smallcaps']).default('serif-italic'),
  /** Part title pages. */
  partNumberStyle: z.enum(['none', 'roman', 'words', 'arabic']).default('words'),
  /** Table of contents. */
  toc: z
    .object({
      depth: z.number().int().min(1).max(3).default(1),
      leaders: z.boolean().default(false),
      includeFrontMatter: z.boolean().default(false),
    })
    .default({}),
  /** Black ink interiors: convert colour images to greyscale when exporting. */
  greyscaleImages: z.boolean().default(true),
});
export type Design = z.infer<typeof DesignSchema>;

/** Partial override of a design, used per format (for example large print). */
export type DesignOverride = Partial<Design>;

type Preset = { label: string; description: string; design: Record<string, unknown> };

/**
 * The six built in templates. Each is a preset; the schema defaults fill in
 * everything a preset does not mention.
 */
export const TEMPLATE_PRESETS: Record<TemplateId, Preset> = {
  literary: {
    label: 'Literary',
    description: 'Garamond, small capital running heads, quiet chapter openings. The Borderless house style.',
    design: {
      template: 'literary',
      bodyFont: 'EB Garamond',
      headingFont: 'EB Garamond',
      fontSizePt: 11,
      lineHeight: 1.32,
      chapterOpener: {
        startOn: 'any', sink: 0.2, numberStyle: 'chapter-words', numberCase: 'smallcaps',
        titleSizePt: 20, titleStyle: 'italic', align: 'center', ornament: 'none',
        dropCap: { enabled: false, lines: 3 }, leadIn: 'words', leadInWords: 4, spaceAfterLines: 3,
      },
      runningHeads: { enabled: true, verso: 'author', recto: 'title', style: 'smallcaps', align: 'center' },
      folio: { position: 'bottom-center' },
      sceneBreak: { style: 'asterisks', lines: 2 },
    },
  },
  modern: {
    label: 'Modern',
    description: 'Crimson Pro text with clean sans serif headings set left, folios at the outer edge.',
    design: {
      template: 'modern',
      bodyFont: 'Crimson Pro',
      headingFont: 'Source Sans 3',
      fontSizePt: 11,
      lineHeight: 1.34,
      chapterOpener: {
        startOn: 'any', sink: 0.12, numberStyle: 'arabic', numberCase: 'as-is', numberSizePt: 30,
        titleSizePt: 18, titleStyle: 'bold', align: 'left', ornament: 'short-rule',
        dropCap: { enabled: false, lines: 3 }, leadIn: 'none', spaceAfterLines: 2,
      },
      runningHeads: { enabled: true, verso: 'title', recto: 'chapter', style: 'caps', align: 'outside', sizePt: 7.5, trackingMilliEm: 90 },
      folio: { position: 'top-outside' },
      sceneBreak: { style: 'space', lines: 2 },
      headingStyle: 'sans-bold',
    },
  },
  classic: {
    label: 'Classic',
    description: 'Baskerville with drop capitals, ornaments and chapters that open on right hand pages.',
    design: {
      template: 'classic',
      bodyFont: 'Libre Baskerville',
      headingFont: 'Libre Baskerville',
      fontSizePt: 9.5,
      lineHeight: 1.45,
      oldstyleFigures: false,
      chapterOpener: {
        startOn: 'recto', sink: 0.25, numberStyle: 'chapter-roman', numberCase: 'upper',
        titleSizePt: 17, titleStyle: 'regular', align: 'center', ornament: 'fleuron',
        dropCap: { enabled: true, lines: 3 }, leadIn: 'line', spaceAfterLines: 3,
      },
      runningHeads: { enabled: true, verso: 'author', recto: 'chapter', style: 'italic', align: 'center' },
      folio: { position: 'bottom-center' },
      sceneBreak: { style: 'fleuron', lines: 2 },
    },
  },
  nonfiction: {
    label: 'Nonfiction',
    description: 'Clear heading hierarchy, call-out boxes, tables, numbered lists, notes and an index.',
    design: {
      template: 'nonfiction',
      bodyFont: 'Crimson Pro',
      headingFont: 'Source Sans 3',
      fontSizePt: 11,
      lineHeight: 1.36,
      chapterOpener: {
        startOn: 'recto', sink: 0.1, numberStyle: 'chapter-arabic', numberCase: 'upper', numberSizePt: 10,
        titleSizePt: 22, titleStyle: 'bold', align: 'left', ornament: 'rule',
        dropCap: { enabled: false, lines: 3 }, leadIn: 'none', spaceAfterLines: 2,
      },
      runningHeads: { enabled: true, verso: 'title', recto: 'chapter', style: 'caps', align: 'outside', sizePt: 7.5, trackingMilliEm: 90, rule: true },
      folio: { position: 'top-outside' },
      sceneBreak: { style: 'space', lines: 1 },
      headingStyle: 'sans-bold',
      headingSizesPt: [14, 12, 11],
      toc: { depth: 2, leaders: true, includeFrontMatter: false },
      notes: 'footnotes',
    },
  },
  childrens: {
    label: "Children's",
    description: 'Large type, generous spacing, full bleed pictures and no running heads.',
    design: {
      template: 'childrens',
      bodyFont: 'Source Sans 3',
      headingFont: 'Source Sans 3',
      fontSizePt: 16,
      lineHeight: 1.45,
      justify: false,
      hyphenate: false,
      paragraphStyle: 'spaced',
      oldstyleFigures: false,
      chapterOpener: {
        startOn: 'any', sink: 0.05, numberStyle: 'none', titleSizePt: 26, titleStyle: 'bold',
        align: 'center', ornament: 'none', dropCap: { enabled: false, lines: 2 }, leadIn: 'none', spaceAfterLines: 2,
      },
      runningHeads: { enabled: false },
      folio: { position: 'bottom-center', sizePt: 11 },
      sceneBreak: { style: 'space', lines: 1 },
      greyscaleImages: false,
    },
  },
  poetry: {
    label: 'Poetry',
    description: 'Ragged right lines, each poem on its own page, titles in small capitals.',
    design: {
      template: 'poetry',
      bodyFont: 'EB Garamond',
      headingFont: 'EB Garamond',
      fontSizePt: 11.5,
      lineHeight: 1.4,
      justify: false,
      hyphenate: false,
      paragraphStyle: 'spaced',
      chapterOpener: {
        startOn: 'any', sink: 0.08, numberStyle: 'none', titleSizePt: 14, titleStyle: 'smallcaps',
        align: 'left', ornament: 'none', dropCap: { enabled: false, lines: 2 }, leadIn: 'none', spaceAfterLines: 2,
      },
      runningHeads: { enabled: false },
      folio: { position: 'bottom-center' },
      sceneBreak: { style: 'asterism', lines: 2 },
    },
  },
};

/** Build a complete design from a template preset. */
export function designFromTemplate(template: TemplateId): Design {
  return DesignSchema.parse(TEMPLATE_PRESETS[template].design);
}

/** Merge a per format override (shallow at top level, deep one level down). */
export function applyDesignOverride(base: Design, override?: DesignOverride): Design {
  if (!override) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const cur = (base as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = { ...(cur as object), ...(v as object) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return DesignSchema.parse(out);
}

/**
 * Preferred margins for a trim size. These are aesthetic starting points; the
 * build always raises them to the platform minimum for the real page count.
 * Compact margins cut the page count, which lowers the printing cost and the
 * lowest possible list price.
 */
export function preferredMargins(design: Design, trimWidthIn: number, trimHeightIn: number): Margins {
  if (design.marginPreset === 'custom' && design.customMargins) return design.customMargins;
  const scale = { compact: 0.82, comfortable: 1, generous: 1.2, custom: 1 }[design.marginPreset];
  // Proportional to the page so that 5 x 8 and 8.5 x 11 both look balanced.
  const outside = Math.max(0.375, 0.108 * trimWidthIn * scale);
  const inside = Math.max(0.5, 0.14 * trimWidthIn * scale);
  const top = Math.max(0.45, 0.088 * trimHeightIn * scale);
  const bottom = Math.max(0.5, 0.1 * trimHeightIn * scale);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { top: r(top), bottom: r(bottom), inside: r(inside), outside: r(outside) };
}
