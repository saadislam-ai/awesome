/**
 * The retail listing of a book: description, keywords, categories and
 * audience. Stored as metadata/listing.json in the book folder. The same
 * listing is turned into what each platform's form expects (HTML for KDP,
 * plain text elsewhere), and checked against the limits in the spec files.
 */
import { z } from 'zod';
import type { Inline } from '../markdown/ir';
import { parseMarkdown } from '../markdown/parse';
import { bookTextStyle, smartenBlocks } from '../markdown/typography';
import type { Book } from '../model/book';
import type { PlatformSpec } from '../specs/schema';

export const ListingSchema = z.object({
  schema: z.literal(1).default(1),
  /** The long description. Blank lines separate paragraphs; *italic*, **bold**, lists and small headings work. */
  description: z.string().default(''),
  /** One or two sentences for places that show little text. */
  shortDescription: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  /** Category names as you pick them in the KDP form, for your own reference. */
  kdpCategories: z.array(z.string()).default([]),
  /** BISAC subject codes with their headings, typed in (the full list is licensed and not bundled). */
  bisac: z.array(z.object({ code: z.string(), heading: z.string().default('') })).default([]),
  /** Thema subject codes. */
  thema: z.array(z.string()).default([]),
  audience: z
    .object({
      /** general: adults; children and young adult use the age range. */
      kind: z.enum(['general', 'young-adult', 'children']).default('general'),
      ageMin: z.number().int().nullable().default(null),
      ageMax: z.number().int().nullable().default(null),
      /** Contains explicit content unsuitable for readers under 18. */
      adult: z.boolean().default(false),
    })
    .default({}),
  /** What you declare to KDP about content made with AI tools. */
  aiContent: z.enum(['none', 'assisted', 'generated']).default('none'),
  /** You hold the rights (not a public domain work). */
  ownRights: z.boolean().default(true),
  /** Where the book may be sold. */
  territories: z.enum(['world', 'selected']).default('world'),
  authorBio: z.string().default(''),
});
export type Listing = z.infer<typeof ListingSchema>;

export const defaultListing = (): Listing => ListingSchema.parse({});

/* ------------------------------------------------------------------ */
/* Description                                                         */
/* ------------------------------------------------------------------ */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inlineHtml(items: Inline[], allow: Set<string>): string {
  let out = '';
  for (const n of items) {
    switch (n.t) {
      case 'text': out += esc(n.v); break;
      case 'em': out += allow.has('em') ? `<em>${inlineHtml(n.c, allow)}</em>` : allow.has('i') ? `<i>${inlineHtml(n.c, allow)}</i>` : inlineHtml(n.c, allow); break;
      case 'strong': out += allow.has('b') ? `<b>${inlineHtml(n.c, allow)}</b>` : inlineHtml(n.c, allow); break;
      case 'br': out += allow.has('br') ? '<br>' : ' '; break;
      case 'code': out += esc(n.v); break;
      default:
        if ('c' in n && Array.isArray(n.c)) out += inlineHtml(n.c as Inline[], allow);
    }
  }
  return out;
}

function inlineText(items: Inline[]): string {
  let out = '';
  for (const n of items) {
    if (n.t === 'text' || n.t === 'code') out += n.v;
    else if (n.t === 'br') out += '\n';
    else if ('c' in n && Array.isArray(n.c)) out += inlineText(n.c as Inline[]);
  }
  return out;
}

export interface DescriptionOutput {
  text: string;
  /** Length as the platform counts it (KDP counts the HTML tags too). */
  length: number;
  limit: number | null;
  tooLong: boolean;
}

/**
 * The description as HTML restricted to the tags a platform accepts (KDP:
 * p, br, b, em, i, u, h4 to h6, ol, ul, li). Anything else is flattened to
 * plain paragraphs, so the result can always be pasted into the form.
 */
export function descriptionHtml(source: string, book: Book, spec?: PlatformSpec | null): DescriptionOutput {
  const tags = spec?.listing?.descriptionTags?.length ? spec.listing.descriptionTags : ['p', 'br', 'b', 'i', 'em', 'ul', 'ol', 'li'];
  const allow = new Set(tags);
  const blocks = smartenBlocks(parseMarkdown(source).blocks, bookTextStyle(book));
  const parts: string[] = [];
  const para = (inner: string) => (allow.has('p') ? `<p>${inner}</p>` : inner + (allow.has('br') ? '<br><br>' : '\n\n'));
  for (const b of blocks) {
    if (b.t === 'p') parts.push(para(inlineHtml(b.c, allow)));
    else if (b.t === 'h') {
      // Headings h1 to h3 are not accepted: use the largest allowed one, or bold.
      const tag = ['h4', 'h5', 'h6'].find((t) => allow.has(t));
      parts.push(tag ? `<${tag}>${inlineHtml(b.c, allow)}</${tag}>` : para(allow.has('b') ? `<b>${inlineHtml(b.c, allow)}</b>` : inlineHtml(b.c, allow)));
    } else if (b.t === 'list') {
      const tag = b.ordered ? 'ol' : 'ul';
      const items = b.items.map((item) => item.map((x) => (x.t === 'p' ? inlineHtml(x.c, allow) : '')).filter(Boolean).join(' '));
      if (allow.has(tag) && allow.has('li')) parts.push(`<${tag}>${items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`);
      else for (const [i, item] of items.entries()) parts.push(para(`${b.ordered ? `${i + 1}. ` : '- '}${item}`));
    } else if (b.t === 'quote') {
      for (const x of b.c) if (x.t === 'p') parts.push(para(allow.has('i') ? `<i>${inlineHtml(x.c, allow)}</i>` : inlineHtml(x.c, allow)));
    }
  }
  const text = parts.join('').replace(/(<br>)+$/, '').trim();
  const limit = spec?.listing?.descriptionMaxChars ?? null;
  return { text, length: text.length, limit, tooLong: limit !== null && text.length > limit };
}

/** The description as plain text with blank lines between paragraphs. */
export function descriptionPlain(source: string, book: Book, limit: number | null = null): DescriptionOutput {
  const blocks = smartenBlocks(parseMarkdown(source).blocks, bookTextStyle(book));
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.t === 'p' || b.t === 'h') parts.push(inlineText(b.c));
    else if (b.t === 'list') parts.push(b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : '-'} ${item.map((x) => (x.t === 'p' ? inlineText(x.c) : '')).join(' ')}`).join('\n'));
    else if (b.t === 'quote') for (const x of b.c) if (x.t === 'p') parts.push(inlineText(x.c));
  }
  const text = parts.join('\n\n').trim();
  return { text, length: text.length, limit, tooLong: limit !== null && text.length > limit };
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export interface ListingIssue {
  severity: 'fail' | 'warn' | 'info';
  field: 'title' | 'description' | 'keywords' | 'categories' | 'audience' | 'general';
  message: string;
}

const BISAC_CODE = /^[A-Z]{3}\d{6}$/;

/** Check a listing against one platform's limits. */
export function checkListing(listing: Listing, book: Book, spec: PlatformSpec): ListingIssue[] {
  const out: ListingIssue[] = [];
  const rules = spec.listing;
  const name = spec.displayName;
  const titleLen = `${book.title}${book.subtitle ? ': ' + book.subtitle : ''}`.length;
  if (rules?.titleSubtitleMaxChars && titleLen > rules.titleSubtitleMaxChars) {
    out.push({ severity: 'fail', field: 'title', message: `Title and subtitle together are ${titleLen} characters; ${name} allows ${rules.titleSubtitleMaxChars}.` });
  }
  if (!listing.description.trim()) {
    out.push({ severity: 'warn', field: 'description', message: 'The description is empty. It is the most read text on a product page.' });
  } else {
    const d = spec.platform === 'kdp' ? descriptionHtml(listing.description, book, spec) : descriptionPlain(listing.description, book, rules?.descriptionMaxChars ?? null);
    if (d.tooLong) out.push({ severity: 'fail', field: 'description', message: `The description is ${d.length} characters${spec.platform === 'kdp' ? ' including formatting tags' : ''}; ${name} allows ${d.limit}.` });
    else if (d.length < 400) out.push({ severity: 'info', field: 'description', message: `The description is short (${d.length} characters). Most product pages do better with 150 to 300 words.` });
  }
  const keywords = listing.keywords.map((k) => k.trim()).filter(Boolean);
  if (rules?.keywordSlots) {
    if (keywords.length > rules.keywordSlots) out.push({ severity: 'fail', field: 'keywords', message: `${keywords.length} keywords; ${name} has ${rules.keywordSlots} keyword fields.` });
    else if (keywords.length < rules.keywordSlots) out.push({ severity: 'info', field: 'keywords', message: `${keywords.length} of ${rules.keywordSlots} keyword fields are used. Each empty one is a missed way to be found.` });
  }
  if (rules?.keywordMaxChars) {
    for (const k of keywords) if (k.length > rules.keywordMaxChars) out.push({ severity: 'fail', field: 'keywords', message: `The keyword "${k}" is ${k.length} characters; the limit is ${rules.keywordMaxChars}.` });
  }
  const seen = new Set<string>();
  const titleWords = new Set(`${book.title} ${book.subtitle}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));
  for (const k of keywords) {
    const low = k.toLowerCase();
    if (seen.has(low)) out.push({ severity: 'warn', field: 'keywords', message: `The keyword "${k}" is entered twice.` });
    seen.add(low);
    if (/["\u201C\u201D]/.test(k)) out.push({ severity: 'warn', field: 'keywords', message: `Remove the quotation marks from "${k.replace(/["\u201C\u201D]/g, '')}": they limit the searches it can match.` });
    if (/\b(free|bestsell\w*|best seller|new release|on sale|kindle unlimited)\b/i.test(k)) out.push({ severity: 'warn', field: 'keywords', message: `"${k}" contains a claim or programme name that stores do not allow in keywords.` });
    const words = low.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
    if (words.length > 0 && words.every((w) => titleWords.has(w))) out.push({ severity: 'info', field: 'keywords', message: `"${k}" only repeats words from the title, which is already searched. Use the field for something new.` });
  }
  if (rules?.categoriesMax && spec.platform === 'kdp' && listing.kdpCategories.filter((c) => c.trim()).length > rules.categoriesMax) {
    out.push({ severity: 'fail', field: 'categories', message: `${name} allows ${rules.categoriesMax} categories.` });
  }
  for (const b of listing.bisac) {
    if (!BISAC_CODE.test(b.code.trim().toUpperCase())) out.push({ severity: 'warn', field: 'categories', message: `"${b.code}" does not look like a BISAC code (three letters and six digits, for example FIC019000).` });
  }
  if (spec.platform !== 'kdp' && listing.bisac.length === 0) out.push({ severity: 'warn', field: 'categories', message: `${name} asks for BISAC subject codes; none are entered.` });
  if (listing.audience.kind !== 'general' && (listing.audience.ageMin === null || listing.audience.ageMax === null)) {
    out.push({ severity: 'warn', field: 'audience', message: 'Give the reading age range for a children\'s or young adult book.' });
  }
  if (listing.audience.ageMin !== null && listing.audience.ageMax !== null && listing.audience.ageMin > listing.audience.ageMax) {
    out.push({ severity: 'fail', field: 'audience', message: 'The lowest reading age is above the highest.' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Thema lookup                                                        */
/* ------------------------------------------------------------------ */

export interface ThemaEntry {
  code: string;
  heading: string;
  parent: string;
}

/** Read the official Thema code list (EDItEUR JSON) into a flat list. */
export function parseThema(json: unknown): ThemaEntry[] {
  const codes = (json as { CodeList?: { ThemaCodes?: { Code?: { CodeValue: string; CodeDescription: string; CodeParent?: string }[] } } })?.CodeList?.ThemaCodes?.Code ?? [];
  return codes.map((c) => ({ code: String(c.CodeValue), heading: String(c.CodeDescription), parent: String(c.CodeParent ?? '') }));
}

/** Find Thema categories by code prefix or by words in the heading. */
export function searchThema(entries: ThemaEntry[], query: string, limit = 40): ThemaEntry[] {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase();
  if (/^[A-Z0-9]{1,8}$/.test(upper) && entries.some((e) => e.code === upper || e.code.startsWith(upper))) {
    const hits = entries.filter((e) => e.code.startsWith(upper));
    if (hits.length) return hits.slice(0, limit);
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { e: ThemaEntry; score: number }[] = [];
  for (const e of entries) {
    const h = e.heading.toLowerCase();
    if (!words.every((w) => h.includes(w))) continue;
    // Shorter headings and headings starting with the query come first.
    scored.push({ e, score: (h.startsWith(words[0]) ? 0 : 50) + h.length / 4 + e.code.length });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.e);
}

/** The chain of headings above a Thema code: "Fiction > Historical fiction". */
export function themaPath(entries: ThemaEntry[], code: string): string {
  const byCode = new Map(entries.map((e) => [e.code, e]));
  const parts: string[] = [];
  let cur = byCode.get(code);
  let guard = 0;
  while (cur && guard++ < 12) {
    parts.unshift(cur.heading);
    cur = cur.parent ? byCode.get(cur.parent) : undefined;
  }
  return parts.join(' > ');
}
