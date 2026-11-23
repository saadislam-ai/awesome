/**
 * The marketing kit: what a self publisher needs to tell people about a
 * book, made from the book's own details and the author's own words.
 *
 *   - a text file with the descriptions, the facts of the book, the
 *     highlighted quotations and drafts of announcements to edit,
 *   - a one page sell sheet (PDF) for bookshops, libraries and reviewers,
 *   - quote cards (pictures) in the sizes social media sites use.
 *
 * Nothing is invented: no praise, no claims, no numbers that are not in the
 * book's details. Quotations are the passages the author highlighted in the
 * manuscript with {==these marks==}.
 */
import type { AssembledBook } from '../build/assemble';
import { fontDirs, assembleProject, loadCoverDesign, type BuildContext } from '../build/pipeline';
import { knownPageCounts, loadListing, loadPricing, reachPlan } from '../build/publish';
import { fontStack } from '../fonts/catalog';
import { displayIsbn } from '../isbn';
import type { PublisherProfile } from '../library/library';
import { parseCritic } from '../markdown/critic';
import { blocksText } from '../markdown/ir';
import { descriptionPlain, type Listing } from '../metadata/listing';
import { docLabel, findParent, primaryAuthor, textNodes, type Book } from '../model/book';
import { LAYOUT } from '../project/layout';
import { joinPath, slugify } from '../util/paths';

export interface Quote {
  text: string;
  /** The chapter it comes from, for the author's own reference. */
  from: string;
}

/**
 * The passages highlighted in the manuscript with {==these marks==}, in
 * reading order and without repeats. Highlights are an editing aid and are
 * not part of the exported book, so they are read from the manuscript files.
 */
export function collectQuotes(docs: { title: string; text: string }[]): Quote[] {
  const out: Quote[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const span of parseCritic(doc.text)) {
      if (span.kind !== 'highlight') continue;
      // Plain words only: emphasis marks, note references and escapes are taken out.
      const text = span.text
        .replace(/\[\^[^\]]*\]/g, '')
        .replace(/(\*{1,3}|_{1,3})(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/\\([*_`[\]{}\\#>+\-])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length < 12 || seen.has(text)) continue;
      seen.add(text);
      out.push({ text, from: doc.title });
    }
  }
  return out;
}

export const CARD_SIZES = [
  { id: 'square', label: 'Square (1080 x 1080)', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait (1080 x 1350)', width: 1080, height: 1350 },
  { id: 'story', label: 'Story (1080 x 1920)', width: 1080, height: 1920 },
  { id: 'wide', label: 'Wide (1200 x 675)', width: 1200, height: 675 },
] as const;
export type CardSizeId = (typeof CARD_SIZES)[number]['id'];
/** A quotation longer than this does not fit a card at a readable size. */
export const MAX_CARD_QUOTE = 320;

export interface EditionFact {
  name: string;
  isbn: string;
  size: string;
  pages: string;
  price: string;
}

export interface MarketingFacts {
  title: string;
  subtitle: string;
  author: string;
  series: string;
  imprint: string;
  place: string;
  website: string;
  publicationDate: string;
  language: string;
  short: string;
  /** The long description as plain paragraphs. */
  description: string[];
  bio: string;
  categories: string[];
  keywords: string[];
  editions: EditionFact[];
  /** Where the book can be ordered, one plain sentence for each channel in use. */
  order: string[];
  donation: string;
  quotes: Quote[];
}

const LANGUAGE_NAME: Record<string, string> = { en: 'English', bn: 'Bangla' };
const firstSentence = (text: string): string => (/^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text).trim();

/** The documents of the book that are part of the exported text, each named after its chapter. */
async function quoteSources(ctx: BuildContext): Promise<{ title: string; text: string }[]> {
  const docs = await ctx.project.readAllDocs();
  const binder = ctx.project.binder;
  return textNodes(binder)
    .filter((n) => n.include !== false)
    .map((n) => {
      const parent = findParent(binder, n.id);
      return { title: parent && parent.type === 'chapter' && parent.title ? parent.title : docLabel(binder, n), text: docs.get(n.id) ?? '' };
    });
}

/** Everything known about the book that marketing material may state. */
export async function marketingFacts(ctx: BuildContext, assembled: AssembledBook, publisher?: PublisherProfile | null): Promise<MarketingFacts> {
  const book = ctx.project.book;
  const listing: Listing = await loadListing(ctx.project);
  const description = listing.description.trim() ? descriptionPlain(listing.description, book).text.split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const about = assembled.sections.find((s) => s.kind === 'about-author');
  const bio = (publisher?.authorBio ?? '').trim() || (about ? blocksText(about.blocks).split('\n')[0].trim() : '');

  // Prices and page counts are stated only when the app knows them: prices from the plan under Publish, pages from the last builds.
  const pages = await knownPageCounts(ctx);
  let rows: Awaited<ReturnType<typeof reachPlan>>['rows'] = [];
  let base = publisher?.baseCurrency ?? '';
  try {
    const plan = await reachPlan(ctx, await loadPricing(ctx.project, { ingramDiscountPercent: publisher?.ingramDiscountPercent }));
    rows = plan.rows;
    base = base || plan.baseCurrency;
  } catch {
    /* without a price plan the sheet simply has no prices */
  }
  const editions: EditionFact[] = book.formats.filter((f) => f.enabled).map((f) => {
    const count = Object.values(pages[f.id] ?? {})[0];
    const row = rows.find((r) => r.formatId === f.id && r.currency === base && r.price !== null);
    return {
      name: f.label || f.type,
      isbn: f.isbn ? displayIsbn(ctx.isbnRegister ?? null, f.isbn) : '',
      size: f.type === 'ebook' ? 'EPUB' : `${f.trim.replace('x', ' x ')} in`,
      pages: f.type === 'ebook' || !count ? '' : String(count),
      price: row && row.price !== null ? `${row.currency} ${row.price.toFixed(row.decimals)}` : '',
    };
  });

  const used = new Set(book.formats.filter((f) => f.enabled).flatMap((f) => f.platforms.map((p) => `${f.type === 'ebook' ? 'ebook' : 'print'}:${p}`)));
  const order: string[] = [];
  if (used.has('print:ingramspark')) order.push('Bookshops and libraries can order the printed editions from Ingram, quoting the ISBN.');
  if (used.has('print:kdp') || used.has('ebook:kdp')) order.push(`Available from Amazon${used.has('ebook:kdp') ? ', in print and for Kindle' : ''}.`);
  if (used.has('ebook:draft2digital')) order.push('The ebook is also sold by other ebook stores and library services through Draft2Digital.');

  const d = publisher?.donation;
  return {
    title: book.title,
    subtitle: book.subtitle,
    author: primaryAuthor(book),
    series: book.series ? `${book.series.name}${book.series.number !== null ? `, book ${book.series.number}` : ''}` : '',
    imprint: book.imprint,
    place: [book.publisherCity, book.publisherCountry].filter(Boolean).join(', '),
    website: book.publisherWebsite || publisher?.website || '',
    publicationDate: book.publicationDate,
    language: LANGUAGE_NAME[book.language.split('-')[0]] ?? book.language,
    short: listing.shortDescription.trim() || (description[0] ? firstSentence(description[0]) : ''),
    description,
    bio,
    categories: [...listing.bisac.map((b) => (b.heading ? `${b.heading} (${b.code})` : b.code)), ...listing.thema.map((t) => `Thema ${t}`)],
    keywords: listing.keywords.filter(Boolean),
    editions,
    order,
    donation: d?.enabled && d.charity ? (d.note.trim() ? `${d.note.trim().replace(/\.$/, '')}: ${d.charity}.` : `Any margin above cost is donated to ${d.charity}.`) : '',
    quotes: collectQuotes(await quoteSources(ctx)),
  };
}

/** The text file of the kit: descriptions, facts, quotations and drafts to edit. Plain Markdown. */
export function marketingCopy(f: MarketingFacts): string {
  const out: string[] = [`# Marketing copy for "${f.title}"`, '', 'Everything below comes from the details and the text of your book. Edit freely; nothing here is sent anywhere.', ''];
  const section = (title: string, body: string | string[]) => {
    const text = Array.isArray(body) ? body.filter(Boolean).join('\n\n') : body;
    out.push(`## ${title}`, '', text.trim() || '(Nothing yet. Fill this in under Publish, Listing.)', '');
  };
  section('In one line', f.short);
  section('Description', f.description);
  section('About the author', f.bio);

  const facts = [
    `Title: ${f.title}${f.subtitle ? `: ${f.subtitle}` : ''}`,
    `Author: ${f.author}`,
    f.series ? `Series: ${f.series}` : '',
    f.imprint ? `Publisher: ${f.imprint}${f.place ? `, ${f.place}` : ''}` : '',
    f.publicationDate ? `Publication date: ${f.publicationDate}` : '',
    `Language: ${f.language}`,
    f.categories.length ? `Categories: ${f.categories.join('; ')}` : '',
    f.keywords.length ? `Keywords: ${f.keywords.join(', ')}` : '',
    f.website ? `Website: ${f.website}` : '',
  ].filter(Boolean);
  for (const e of f.editions) facts.push(`${e.name}: ${[e.isbn ? `ISBN ${e.isbn}` : 'no ISBN yet', e.size, e.pages ? `${e.pages} pages` : '', e.price].filter(Boolean).join(', ')}`);
  section('The facts', facts.map((x) => `- ${x}`).join('\n'));
  section('Where to get it', f.order.length ? f.order.map((x) => `- ${x}`).join('\n') : '(No sales channel is switched on for this book yet.)');
  section('Quotations', f.quotes.length ? f.quotes.map((q) => `> ${q.text}\n>\n> (${q.from || 'from the book'})`).join('\n\n') : '(None yet. In the Writer, select a sentence and press the highlighter button; highlighted passages appear here and can be made into quote cards.)');

  const name = f.subtitle ? `${f.title}: ${f.subtitle}` : f.title;
  const where = f.website ? ` More at ${f.website}.` : '';
  const drafts = [
    `**Announcement, short.** ${name} by ${f.author} is out${f.publicationDate ? ` on ${f.publicationDate}` : ' now'}. ${f.short}${where}`.trim(),
    `**Announcement, longer.** ${name} is ${f.publicationDate ? `published on ${f.publicationDate}` : 'now published'}${f.imprint ? ` by ${f.imprint}` : ''}. ${f.description[0] ?? f.short} ${f.order.join(' ')}`.trim(),
    f.quotes[0] ? `**A quotation to share.** "${f.quotes[0].text}" From ${f.title} by ${f.author}.` : '',
    f.donation ? `**About the price.** This book is priced as close to cost as the printers allow. ${f.donation}` : '',
  ].filter(Boolean);
  section('Drafts to edit', drafts);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export interface MarketingOptions {
  publisher?: PublisherProfile | null;
  /** Quotations to make cards of (default: the first six that fit). */
  quotes?: string[];
  /** Card sizes to make (default: all four). */
  sizes?: CardSizeId[];
  /** Paper of the sell sheet. A4 unless the book is aimed at North America. */
  paper?: 'a4' | 'us-letter';
}

export interface MarketingKit {
  dir: string;
  copyPath: string;
  sheetPath: string | null;
  cards: { path: string; quote: string; size: CardSizeId }[];
  facts: MarketingFacts;
  warnings: string[];
}

const SHEET_MAIN = '#import "lib/marketing.typ": render-sheet\n#render-sheet(json("sheet.json"))\n';
const CARD_MAIN = '#import "lib/marketing.typ": render-card\n#render-card(json(sys.inputs.data))\n';

/** Write the marketing kit into exports/marketing. */
export async function exportMarketingKit(ctx: BuildContext, opts: MarketingOptions = {}): Promise<MarketingKit> {
  const { host, project } = ctx;
  const book: Book = project.book;
  const ebook = book.formats.find((f) => f.type === 'ebook') ?? book.formats[0];
  const assembled = await assembleProject(ctx, { formatId: ebook.id, criticView: 'original' });
  const facts = await marketingFacts(ctx, assembled, opts.publisher);
  const warnings: string[] = [];
  const dir = project.path(LAYOUT.exportsDir, 'marketing');
  await host.mkdirp(dir);
  const slug = slugify(book.title, 40);
  const copyPath = joinPath(dir, `${slug}_marketing-copy.md`);
  await host.writeText(copyPath, marketingCopy(facts));

  // The build folder for Typst: the layout library, the data, and a copy of the ebook cover when there is one.
  const buildDir = project.path(LAYOUT.buildDir, 'marketing');
  await host.mkdirp(joinPath(buildDir, 'lib'));
  const libDir = joinPath(ctx.resourcesDir, 'typst', 'lib');
  await host.writeText(joinPath(buildDir, 'lib', 'marketing.typ'), await host.readText(joinPath(libDir, 'marketing.typ')));
  let cover: string | null = null;
  const coverFile = project.path('cover', 'ebook-cover.jpg');
  if (await host.exists(coverFile)) {
    await host.writeBinary(joinPath(buildDir, 'cover.jpg'), await host.readBinary(coverFile));
    cover = 'cover.jpg';
  } else {
    warnings.push('No ebook cover was found, so the sheet and the cards have no cover picture. Make it under Cover, "Ebook cover", then build the kit again.');
  }
  const design = await loadCoverDesign(project);
  const fonts = fontStack(assembled.design.bodyFont);
  const typst = async (main: string, out: string, extra: string[]): Promise<boolean> => {
    const args = ['compile', '--root', buildDir, '--ignore-system-fonts'];
    for (const d of fontDirs(ctx)) args.push('--font-path', d);
    args.push(...extra, joinPath(buildDir, main), out);
    const res = await host.runTool('typst', args, { cwd: buildDir, timeoutMs: 120_000 });
    if (res.code !== 0) warnings.push(`A marketing file could not be made: ${(res.stderr || res.stdout).trim().split('\n').slice(0, 2).join(' ')}`);
    return res.code === 0;
  };

  // Sell sheet.
  const shown: string[] = [];
  let words = 0;
  for (const p of facts.description.length ? facts.description : [facts.short].filter(Boolean)) {
    const n = p.split(/\s+/).length;
    if (shown.length && words + n > 150) break;
    shown.push(p);
    words += n;
  }
  const details: [string, string][] = [
    ['Author', facts.author],
    ...(facts.series ? [['Series', facts.series] as [string, string]] : []),
    ...(facts.imprint ? [['Publisher', facts.imprint + (facts.place ? `, ${facts.place}` : '')] as [string, string]] : []),
    ...(facts.publicationDate ? [['Published', facts.publicationDate] as [string, string]] : []),
    ['Language', facts.language],
    ...(facts.categories.length ? [['Subjects', facts.categories.slice(0, 3).join('; ')] as [string, string]] : []),
  ];
  const sheet = {
    paper: opts.paper ?? 'a4',
    fonts,
    lang: book.language.split('-')[0],
    accent: design.colors.background,
    kicker: facts.imprint || 'New book',
    title: facts.title,
    subtitle: facts.subtitle,
    author: facts.author,
    description: shown,
    cover,
    details,
    quote: facts.quotes.find((q) => q.text.length <= 240)?.text ?? '',
    bio: facts.bio,
    order: facts.order,
    editions: facts.editions,
    'edition-head': ['Edition', 'ISBN', 'Size', 'Pages', 'Price'],
    labels: { details: 'About the book', author: 'About the author', order: 'How to order', editions: 'Editions' },
    footer: [facts.imprint, facts.place, facts.website].filter(Boolean).join('   |   '),
  };
  await host.writeText(joinPath(buildDir, 'sheet.json'), JSON.stringify(sheet));
  await host.writeText(joinPath(buildDir, 'sheet-main.typ'), SHEET_MAIN);
  const sheetPath = joinPath(dir, `${slug}_sell-sheet.pdf`);
  const sheetOk = await typst('sheet-main.typ', sheetPath, []);

  // Quote cards: the picked quotations (or the first six that fit) in each size.
  const cards: MarketingKit['cards'] = [];
  const picked = (opts.quotes ?? facts.quotes.map((q) => q.text)).filter((q) => q.trim());
  const fitting = picked.filter((q) => q.length <= MAX_CARD_QUOTE).slice(0, opts.quotes ? 24 : 6);
  if (picked.length > fitting.length && picked.some((q) => q.length > MAX_CARD_QUOTE)) warnings.push(`A quotation longer than ${MAX_CARD_QUOTE} characters was left out: it would be too small to read on a card.`);
  const sizes = CARD_SIZES.filter((s) => (opts.sizes ?? CARD_SIZES.map((x) => x.id)).includes(s.id));
  if (fitting.length) {
    await host.mkdirp(joinPath(dir, 'cards'));
    await host.writeText(joinPath(buildDir, 'card-main.typ'), CARD_MAIN);
    const latin = /^[\s\p{Script=Latin}\p{P}\p{N}\p{S}]*$/u;
    for (const [i, quote] of fitting.entries()) {
      for (const size of sizes) {
        const data = {
          width: size.width, height: size.height, fonts, lang: book.language.split('-')[0],
          background: design.colors.background, text: design.colors.text, accent: design.colors.accent,
          quote, chars: [...quote].length, italic: latin.test(quote), mark: '\u201C',
          title: facts.title, author: facts.author, cover,
        };
        const dataName = `card-${i + 1}-${size.id}.json`;
        await host.writeText(joinPath(buildDir, dataName), JSON.stringify(data));
        const out = joinPath(dir, 'cards', `quote-${String(i + 1).padStart(2, '0')}_${size.id}.png`);
        // 72 points to the inch at 72 pixels to the inch: one point of the page is one pixel of the picture.
        if (await typst('card-main.typ', out, ['--format', 'png', '--ppi', '72', '--input', `data=${dataName}`])) cards.push({ path: out, quote, size: size.id });
      }
    }
  }
  return { dir, copyPath, sheetPath: sheetOk ? sheetPath : null, cards, facts, warnings };
}
