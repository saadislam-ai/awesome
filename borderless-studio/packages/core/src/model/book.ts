/**
 * The data model of a book project. Everything here is stored as plain JSON
 * (book.json, manuscript/binder.json and so on) next to plain Markdown files,
 * so a book can be read, backed up and versioned without this app.
 *
 * zod schemas are the single source of truth: they validate files on load,
 * fill in defaults for fields added by newer versions, and give us the
 * TypeScript types for free.
 */
import { z } from 'zod';
import { DesignSchema } from './design';

export const PLATFORM_IDS = ['kdp', 'ingramspark', 'draft2digital'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const GENRES = ['novel', 'nonfiction', 'memoir', 'childrens', 'poetry'] as const;
export type Genre = (typeof GENRES)[number];

export const FORMAT_TYPES = ['ebook', 'paperback', 'hardcover'] as const;
export type FormatType = (typeof FORMAT_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Contributors                                                        */
/* ------------------------------------------------------------------ */

export const ContributorSchema = z.object({
  /** ONIX style role: author, editor, illustrator, translator, foreword, narrator, photographer. */
  role: z.string().default('author'),
  name: z.string(),
  /** "Islam, Saad" form used by retailers for sorting. */
  sortName: z.string().default(''),
  bio: z.string().default(''),
  website: z.string().default(''),
});
export type Contributor = z.infer<typeof ContributorSchema>;

/* ------------------------------------------------------------------ */
/* Formats (one ISBN each)                                             */
/* ------------------------------------------------------------------ */

export const PlatformOptionsSchema = z
  .object({
    /**
     * IngramSpark only: values copied from Ingram's cover template generator.
     * The app never guesses these; export is blocked until they are entered.
     */
    spineWidthIn: z.number().positive().nullable().default(null),
    /** Full cover document size from Ingram's template (width, height in inches). */
    templateWidthIn: z.number().positive().nullable().default(null),
    templateHeightIn: z.number().positive().nullable().default(null),
    /** Path (inside the project) of the downloaded Ingram template PDF, shown as a guide layer. */
    templateFile: z.string().nullable().default(null),
    /** Unit print cost typed in from the platform's calculator, per currency code. */
    printCost: z.record(z.number().nonnegative()).default({}),
    /** KDP only: leave the barcode area empty so Amazon prints its own barcode. */
    platformBarcode: z.boolean().default(true),
    /** Opt in to KDP Expanded Distribution (normally off when the book is also on IngramSpark). */
    expandedDistribution: z.boolean().default(false),
  })
  .partial()
  .passthrough();
export type PlatformOptions = z.infer<typeof PlatformOptionsSchema>;

export const FormatSchema = z.object({
  /** Stable id inside the book, for example "paperback" or "large-print". */
  id: z.string(),
  type: z.enum(FORMAT_TYPES),
  label: z.string().default(''),
  enabled: z.boolean().default(true),
  /** ISBN-13 digits without hyphens. Empty until one is assigned from the register. */
  isbn: z.string().default(''),
  platforms: z.array(z.enum(PLATFORM_IDS)).default([]),
  /** Trim size id from the platform spec files, for example "5.5x8.5". Print formats only. */
  trim: z.string().default('6x9'),
  paper: z.enum(['white', 'cream']).default('cream'),
  ink: z.enum(['bw', 'standard-color', 'premium-color']).default('bw'),
  /** Interior prints to the edge of the page (needed for full bleed images). */
  bleed: z.boolean().default(false),
  coverFinish: z.enum(['matte', 'gloss']).default('matte'),
  /** Hardcover only. */
  binding: z.enum(['case-laminate', 'dust-jacket']).default('case-laminate'),
  /** Large print edition: body type of 16 pt or more and wider spacing. */
  largePrint: z.boolean().default(false),
  /** Design values that differ from the book wide design for this format only. */
  designOverride: DesignSchema.partial().optional(),
  /** Per platform extras, keyed by platform id. */
  platformOptions: z.record(PlatformOptionsSchema).default({}),
  /** Ebook only. */
  ebook: z
    .object({
      embedFonts: z.boolean().default(false),
      dropCaps: z.boolean().default(true),
      sceneBreakImage: z.boolean().default(false),
      /** Put the table of contents page inside the reading flow (as well as the device menu). */
      inlineToc: z.boolean().default(true),
    })
    .default({}),
});
export type BookFormat = z.infer<typeof FormatSchema>;

/* ------------------------------------------------------------------ */
/* House style for text                                                */
/* ------------------------------------------------------------------ */

export const DashPolicySchema = z.object({
  /**
   * allow: leave dashes alone.
   * flag: report every em and en dash so each can be reviewed by hand.
   * replace: swap them automatically using the replacements below.
   */
  mode: z.enum(['allow', 'flag', 'replace']).default('flag'),
  /** What an em dash becomes in "replace" mode. */
  emDashReplacement: z.enum(['comma', 'spaced-hyphen', 'colon', 'ellipsis']).default('comma'),
  /** What an en dash between numbers (a range) becomes. */
  enDashRangeReplacement: z.enum(['to', 'hyphen']).default('hyphen'),
  /** Also treat double and triple hyphens typed as dashes ("--") the same way. */
  includeTypedHyphens: z.boolean().default(true),
});
export type DashPolicy = z.infer<typeof DashPolicySchema>;

export const TextStyleSchema = z.object({
  /** Spelling dictionary and consistency checks: en-AU, en-GB, en-US, fr, es, pt, nl, ru, bn or any dictionary added to the library. */
  spelling: z.string().default('en-AU'),
  smartQuotes: z.boolean().default(true),
  /** Primary quotation marks. Australian and British fiction often uses single. */
  quoteStyle: z.enum(['double', 'single']).default('double'),
  dashPolicy: DashPolicySchema.default({}),
  /** Ellipsis as one character or three spaced dots. */
  ellipsis: z.enum(['character', 'spaced-dots', 'leave']).default('character'),
  /** Numbers below this are expected to be spelled out (consistency checker). */
  spellOutNumbersBelow: z.number().int().default(10),
  /**
   * Digits for page numbers, chapter numbers and the year. "auto" follows the
   * language (Arabic, Persian, Bangla and Nepali books use their own digits);
   * "latin" always prints 0 to 9; "native" uses the language's own digits.
   */
  digits: z.enum(['auto', 'latin', 'native']).default('auto'),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

/* ------------------------------------------------------------------ */
/* book.json                                                           */
/* ------------------------------------------------------------------ */

export const HistoryEntrySchema = z.object({
  date: z.string(),
  edition: z.number().int().default(1),
  /** Which format the change applies to; empty means the whole book. */
  formatId: z.string().default(''),
  change: z.string(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const BookSchema = z.object({
  schema: z.literal(1).default(1),
  id: z.string(),
  title: z.string().default('Untitled'),
  subtitle: z.string().default(''),
  series: z
    .object({ id: z.string().default(''), name: z.string(), number: z.number().nullable().default(null) })
    .nullable()
    .default(null),
  contributors: z.array(ContributorSchema).default([]),
  /** BCP 47 language tag of the main text, for example en-AU or bn. */
  language: z.string().default('en-AU'),
  genre: z.enum(GENRES).default('novel'),
  imprint: z.string().default('Borderless Publishing'),
  publisherCity: z.string().default('Sydney'),
  publisherCountry: z.string().default('Australia'),
  publisherWebsite: z.string().default(''),
  copyright: z
    .object({
      year: z.number().int().default(new Date().getFullYear()),
      holder: z.string().default(''),
      rightsStatement: z
        .string()
        .default(
          'All rights reserved. No part of this publication may be reproduced, stored in a retrieval system, or transmitted in any form or by any means, electronic, mechanical, photocopying, recording or otherwise, without the prior written permission of the publisher, except for brief quotations in reviews.',
        ),
      /** Extra lines for the copyright page: cover designer credit, disclaimers and so on. */
      extraLines: z.array(z.string()).default([]),
      /** Show the National Library of Australia catalogue line. */
      nlaCatalogueLine: z.boolean().default(true),
    })
    .default({}),
  editionNumber: z.number().int().min(1).default(1),
  editionStatement: z.string().default('First edition'),
  publicationDate: z.string().default(''),
  style: TextStyleSchema.default({}),
  design: DesignSchema.default({}),
  formats: z.array(FormatSchema).default([]),
  targets: z
    .object({
      dailyWords: z.number().int().nonnegative().default(1000),
      manuscriptWords: z.number().int().nonnegative().default(80000),
      deadline: z.string().default(''),
    })
    .default({}),
  history: z.array(HistoryEntrySchema).default([]),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type Book = z.infer<typeof BookSchema>;

/* ------------------------------------------------------------------ */
/* Binder (manuscript/binder.json)                                     */
/* ------------------------------------------------------------------ */

/** Sections the app can generate from metadata instead of from a Markdown file. */
export const SECTION_KINDS = [
  // front matter
  'half-title', 'title-page', 'copyright', 'dedication', 'epigraph', 'toc', 'foreword', 'preface', 'introduction', 'prologue',
  // body
  'chapter', 'part', 'scene', 'interlude',
  // back matter
  'epilogue', 'afterword', 'acknowledgements', 'about-author', 'also-by', 'note-to-readers', 'reading-group',
  'endnotes', 'bibliography', 'index', 'appendix', 'glossary',
  'generic',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const STATUSES = ['idea', 'draft', 'revised', 'edited', 'final'] as const;
export type DocStatus = (typeof STATUSES)[number];

export interface BinderNode {
  id: string;
  /** group = the three fixed roots; part and chapter contain children; doc is a leaf with text. */
  type: 'group' | 'part' | 'chapter' | 'doc';
  /** Only on the three root groups. */
  role?: 'front' | 'body' | 'back';
  kind: SectionKind;
  title: string;
  subtitle?: string;
  /** Markdown file inside manuscript/, relative to that folder. Chapters and docs can have one. */
  file?: string;
  /** True when the content is produced from metadata (title page, copyright page, contents). */
  generated?: boolean;
  /** Chapters only: take part in automatic chapter numbering. */
  numbered?: boolean;
  /** Leave this node (and its children) out of every export. */
  include: boolean;
  /** Formats this node is limited to. Empty or missing means all formats. */
  onlyFormats?: string[];
  synopsis?: string;
  pov?: string;
  status?: DocStatus;
  labels?: string[];
  /** Word target for this document. */
  target?: number;
  /** Corkboard card colour. */
  color?: string;
  /** Free settings for generated sections (for example epigraph text and source). */
  data?: Record<string, unknown>;
  children?: BinderNode[];
}

export const BinderNodeSchema: z.ZodType<BinderNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    type: z.enum(['group', 'part', 'chapter', 'doc']),
    role: z.enum(['front', 'body', 'back']).optional(),
    kind: z.enum(SECTION_KINDS).default('generic'),
    title: z.string().default(''),
    subtitle: z.string().optional(),
    file: z.string().optional(),
    generated: z.boolean().optional(),
    numbered: z.boolean().optional(),
    include: z.boolean().default(true),
    onlyFormats: z.array(z.string()).optional(),
    synopsis: z.string().optional(),
    pov: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    labels: z.array(z.string()).optional(),
    target: z.number().optional(),
    color: z.string().optional(),
    data: z.record(z.unknown()).optional(),
    children: z.array(BinderNodeSchema).optional(),
  }),
) as z.ZodType<BinderNode>;

export const BinderSchema = z.object({
  schema: z.literal(1).default(1),
  /** Always exactly three roots: front matter, body, back matter. */
  roots: z.array(BinderNodeSchema),
});
export type Binder = z.infer<typeof BinderSchema>;

/* ------------------------------------------------------------------ */
/* Story bible (bible/bible.json)                                      */
/* ------------------------------------------------------------------ */

export const BIBLE_TYPES = ['character', 'place', 'object', 'event', 'note'] as const;
export type BibleType = (typeof BIBLE_TYPES)[number];

export const BibleEntrySchema = z.object({
  id: z.string(),
  type: z.enum(BIBLE_TYPES),
  name: z.string(),
  /** Other names and spellings that should link to this entry (nicknames, titles). */
  aliases: z.array(z.string()).default([]),
  /** Spellings that are WRONG and should be flagged by the consistency checker. */
  misspellings: z.array(z.string()).default([]),
  summary: z.string().default(''),
  /** Longer notes in Markdown. */
  notes: z.string().default(''),
  /** Free form fields such as age, role, eye colour. */
  fields: z.record(z.string()).default({}),
  /** How to say the name aloud, for the audiobook pronunciation guide. */
  pronunciation: z.string().default(''),
  /** Timeline events: a sortable date or story day, plus a display label. */
  when: z.string().default(''),
  whenLabel: z.string().default(''),
  /** Ids of related entries. */
  links: z.array(z.string()).default([]),
  /** True when the entry comes from the shared series bible. */
  shared: z.boolean().default(false),
  image: z.string().default(''),
});
export type BibleEntry = z.infer<typeof BibleEntrySchema>;

export const BibleSchema = z.object({
  schema: z.literal(1).default(1),
  entries: z.array(BibleEntrySchema).default([]),
});
export type Bible = z.infer<typeof BibleSchema>;

/* ------------------------------------------------------------------ */
/* Writing log (stats/writing-log.json)                                */
/* ------------------------------------------------------------------ */

export const WritingDaySchema = z.object({
  date: z.string(),
  /** Net words added that day across the manuscript. */
  words: z.number().int(),
  /** Total manuscript words at the end of the day. */
  total: z.number().int().nonnegative(),
  /** Minutes with the editor in use. */
  minutes: z.number().nonnegative().default(0),
  sessions: z.number().int().nonnegative().default(0),
});
export type WritingDay = z.infer<typeof WritingDaySchema>;

export const WritingLogSchema = z.object({
  schema: z.literal(1).default(1),
  days: z.array(WritingDaySchema).default([]),
});
export type WritingLog = z.infer<typeof WritingLogSchema>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Depth first walk over binder nodes. Return false from the visitor to skip a subtree. */
export function walkBinder(
  nodes: BinderNode[],
  visit: (node: BinderNode, parent: BinderNode | null, depth: number) => boolean | void,
  parent: BinderNode | null = null,
  depth = 0,
): void {
  for (const n of nodes) {
    const go = visit(n, parent, depth);
    if (go !== false && n.children) walkBinder(n.children, visit, n, depth + 1);
  }
}

export function findNode(binder: Binder, id: string): BinderNode | null {
  let found: BinderNode | null = null;
  walkBinder(binder.roots, (n) => {
    if (n.id === id) found = n;
    return !found;
  });
  return found;
}

export function findParent(binder: Binder, id: string): BinderNode | null {
  let found: BinderNode | null = null;
  walkBinder(binder.roots, (n, parent) => {
    if (n.id === id) found = parent;
    return !found;
  });
  return found;
}

/**
 * A name for a document that also says where it is: "The River: Scene 2".
 * Scenes are often all called "Scene 1", "Scene 2", so lists of documents
 * need the chapter as well.
 */
export function docLabel(binder: Binder, node: BinderNode): string {
  const own = node.title || node.kind;
  const parent = findParent(binder, node.id);
  return parent && parent.type === 'chapter' && parent.title ? `${parent.title}: ${own}` : own;
}

/** Every node that owns a Markdown file, in reading order. */
export function textNodes(binder: Binder): BinderNode[] {
  const out: BinderNode[] = [];
  walkBinder(binder.roots, (n) => {
    if (n.file) out.push(n);
  });
  return out;
}

export function primaryAuthor(book: Book): string {
  return book.contributors.find((c) => c.role === 'author')?.name ?? book.contributors[0]?.name ?? '';
}

export function authorsLine(book: Book): string {
  const authors = book.contributors.filter((c) => c.role === 'author').map((c) => c.name);
  if (authors.length <= 1) return authors[0] ?? '';
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return `${authors.slice(0, -1).join(', ')} and ${authors[authors.length - 1]}`;
}

export function getFormat(book: Book, formatId: string): BookFormat {
  const f = book.formats.find((x) => x.id === formatId);
  if (!f) throw new Error(`This book has no format with the id "${formatId}".`);
  return f;
}

/** Language without region, lower case: "en-AU" gives "en". */
export function baseLanguage(tag: string): string {
  return tag.split(/[-_]/)[0].toLowerCase();
}

export function languageRegion(tag: string): string | null {
  const parts = tag.split(/[-_]/);
  return parts.length > 1 ? parts[1].toUpperCase() : null;
}
