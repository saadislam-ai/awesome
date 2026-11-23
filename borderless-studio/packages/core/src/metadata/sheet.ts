/**
 * Listing sheets: every field of a platform's title setup form, in the
 * order of the form, filled in from the book, ready to copy and paste.
 */
import type { Book, BookFormat } from '../model/book';
import { authorsLine } from '../model/book';
import type { PlatformSpec } from '../specs/schema';
import type { PriceRow } from '../pricing/reach';
import { descriptionHtml, descriptionPlain, type Listing } from './listing';

export interface SheetField {
  label: string;
  value: string;
  /** Advice shown next to the field. */
  note?: string;
  /** Long values (descriptions) are shown in a box of their own. */
  long?: boolean;
}

export interface ListingSheet {
  title: string;
  platform: string;
  formatId: string;
  fields: SheetField[];
}

export interface SheetInput {
  book: Book;
  format: BookFormat;
  listing: Listing;
  spec: PlatformSpec;
  /** Price rows of this edition on this platform (from the Reach First plan). */
  prices?: PriceRow[];
  pages?: number | null;
  /** Names of the files to upload, relative to the book folder. */
  files?: { interior?: string; cover?: string; ebook?: string; ebookCover?: string };
  /** Whether the cover file carries its own barcode. */
  coverHasBarcode?: boolean;
  isbnDisplay?: string;
  ingramDiscountPercent?: number;
}

const LANGUAGE_NAME: Record<string, string> = { en: 'English', bn: 'Bengali (Bangla)', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', hi: 'Hindi', ar: 'Arabic', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese' };
const INK: Record<string, string> = { bw: 'Black and white', 'standard-color': 'Standard colour', 'premium-color': 'Premium colour' };

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: name.trim() };
  // A title such as "Dr" stays with the first name, as retail forms have no field for it.
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function listingSheet(input: SheetInput): ListingSheet {
  const { book, format, listing, spec } = input;
  const f: SheetField[] = [];
  const add = (label: string, value: string | number | null | undefined, note?: string, long = false) => {
    f.push({ label, value: value === null || value === undefined ? '' : String(value), note, long });
  };
  const isEbook = format.type === 'ebook';
  const author = book.contributors.find((c) => c.role === 'author') ?? book.contributors[0];
  const name = author ? splitName(author.name) : { first: '', last: '' };
  const keywords = listing.keywords.map((k) => k.trim()).filter(Boolean);
  const prices = input.prices ?? [];
  const priceLines = prices.filter((p) => p.price !== null).map((p) => `${p.marketLabel}: ${p.currency} ${p.price!.toFixed(p.decimals)}${p.taxNote ? ` (${p.taxNote})` : ''}${p.plan ? `, ${p.plan}% royalty plan` : ''}`).join('\n');

  add('Language', LANGUAGE_NAME[book.language.split(/[-_]/)[0].toLowerCase()] ?? book.language);
  add('Title', book.title);
  add('Subtitle', book.subtitle);
  if (book.series) add('Series', `${book.series.name}${book.series.number ? `, book ${book.series.number}` : ''}`);
  add('Edition number', book.editionNumber > 1 ? book.editionNumber : '', book.editionNumber > 1 ? undefined : 'Leave empty for a first edition.');

  if (spec.platform === 'kdp') {
    add('Author: first name', name.first);
    add('Author: last name', name.last);
    add('Contributors', book.contributors.filter((c) => c !== author).map((c) => `${c.name} (${c.role})`).join('; '));
    const d = descriptionHtml(listing.description, book, spec);
    add(`Description (${d.length} of ${d.limit ?? 4000} characters)`, d.text, 'Paste into the description box. The formatting tags are the ones KDP accepts.', true);
    add('Publishing rights', listing.ownRights ? 'I own the copyright and I hold the necessary publishing rights.' : 'This is a public domain work.');
    add('Sexually explicit images or title', listing.audience.adult ? 'Yes' : 'No');
    add('Reading age', listing.audience.ageMin !== null ? `${listing.audience.ageMin} to ${listing.audience.ageMax ?? ''}` : '', listing.audience.kind === 'general' ? 'Leave empty for a book for adults.' : undefined);
    add('Primary marketplace', 'Amazon.com.au', 'The marketplace where you expect most sales.');
    listing.kdpCategories.filter((c) => c.trim()).slice(0, spec.listing?.categoriesMax ?? 3).forEach((c, i) => add(`Category ${i + 1}`, c));
    for (let i = 0; i < (spec.listing?.keywordSlots ?? 7); i++) add(`Keyword ${i + 1}`, keywords[i] ?? '');
    if (isEbook) {
      add('Pre-order', book.publicationDate && book.publicationDate > new Date().toISOString().slice(0, 10) ? `Yes, release on ${book.publicationDate}` : 'No, publish when ready');
      add('Digital Rights Management', 'No', 'Readers can keep and move a book without DRM. This choice cannot be changed after publishing.');
      add('Manuscript file', input.files?.ebook ?? '');
      add('Cover file', input.files?.ebookCover ?? '');
      add('AI generated content', listing.aiContent === 'none' ? 'No' : listing.aiContent === 'assisted' ? 'No (AI assisted only: tools used to edit or refine your own work need not be declared)' : 'Yes: declare texts, images or translations generated by AI');
      add('ISBN', input.isbnDisplay ?? format.isbn, 'Optional for Kindle ebooks. Never reuse the ISBN of a print edition.');
      add('KDP Select', 'Do not enrol', 'Enrolling makes the ebook exclusive to Amazon for 90 days and rules out Draft2Digital and other stores.');
      add('Territories', listing.territories === 'world' ? 'All territories (worldwide rights)' : 'Individual territories');
      add('List prices', priceLines, 'Enter each marketplace price by hand; do not let them follow the US price.', true);
    } else {
      add('ISBN', input.isbnDisplay ?? format.isbn, format.isbn ? 'Choose "Use my own ISBN".' : 'No ISBN is set: KDP can assign a free one, usable at KDP only.');
      add('Imprint', book.imprint, 'Must match the imprint registered with the ISBN.');
      add('Publication date', book.publicationDate, 'Leave empty if the book has not been published before.');
      add('Ink and paper', `${INK[format.ink]} interior with ${format.paper} paper`);
      add('Trim size', `${format.trim.replace('x', ' x ')} in`);
      add('Bleed', format.bleed ? 'Bleed (PDF only)' : 'No bleed');
      add('Cover finish', format.coverFinish === 'gloss' ? 'Glossy' : 'Matte');
      add('Manuscript file', input.files?.interior ?? '', input.pages ? `${input.pages} pages` : undefined);
      add('Cover file', input.files?.cover ?? '', input.coverHasBarcode ? 'Tick "The cover includes a barcode".' : 'Leave "The cover includes a barcode" unticked: KDP adds one.');
      add('AI generated content', listing.aiContent === 'generated' ? 'Yes' : 'No');
      add('Territories', listing.territories === 'world' ? 'All territories (worldwide rights)' : 'Individual territories');
      add('Expanded Distribution', 'Off', 'Keep it off when the same ISBN is also at IngramSpark.');
      add('List prices', priceLines, 'Prices are entered without tax. Enter each marketplace by hand.', true);
    }
  } else if (spec.platform === 'ingramspark') {
    add('Author', author?.name ?? authorsLine(book));
    add('Contributor biography', listing.authorBio, undefined, true);
    add('Contributors', book.contributors.filter((c) => c !== author).map((c) => `${c.name} (${c.role})`).join('; '));
    add('Imprint', book.imprint);
    add('ISBN', input.isbnDisplay ?? format.isbn, format.isbn ? undefined : 'IngramSpark needs your own ISBN.');
    add('Short description', listing.shortDescription, undefined, true);
    add('Full description', descriptionPlain(listing.description, book).text, undefined, true);
    add('Keywords', keywords.join('; '), 'Separate with semicolons.');
    listing.bisac.slice(0, 3).forEach((b, i) => add(`Subject ${i + 1} (BISAC)`, `${b.code} ${b.heading}`.trim()));
    listing.thema.slice(0, 3).forEach((code, i) => add(`Thema subject ${i + 1}`, code));
    add('Audience', listing.audience.kind === 'general' ? 'Trade / General (Adult)' : listing.audience.kind === 'young-adult' ? 'Young Adult' : 'Juvenile', listing.audience.ageMin !== null ? `Ages ${listing.audience.ageMin} to ${listing.audience.ageMax ?? ''}` : undefined);
    if (isEbook) {
      add('Ebook file', input.files?.ebook ?? '');
      add('Cover file', input.files?.ebookCover ?? '');
    } else {
      add('Trim size', `${format.trim.replace('x', ' x ')} in`);
      add('Interior colour and paper', `${INK[format.ink]}, ${format.paper === 'cream' ? 'creme' : 'white'} paper`);
      add('Binding', format.type === 'hardcover' ? (format.binding === 'dust-jacket' ? 'Hardback: case laminate with dust jacket' : 'Hardback: case laminate') : 'Paperback: perfect bound');
      add('Laminate', format.coverFinish === 'gloss' ? 'Gloss' : 'Matte');
      add('Page count', input.pages ?? '', 'The even number of pages in the interior file.');
      add('Interior file', input.files?.interior ?? '');
      add('Cover file', input.files?.cover ?? '');
    }
    add('Publication date', book.publicationDate);
    add('On sale date', book.publicationDate, 'Usually the same as the publication date.');
    add('List prices', priceLines, 'Prices are entered without tax.', true);
    if (!isEbook) {
      add('Wholesale discount', input.ingramDiscountPercent !== undefined ? `${input.ingramDiscountPercent}%` : '', 'Use the lowest your account allows in each market to keep the price low.');
      add('Returns', 'No', 'Accepting returns can cost you the printing of every returned copy.');
    }
  } else {
    add('Author', author?.name ?? authorsLine(book));
    add('Publisher', book.imprint);
    add('ISBN', input.isbnDisplay ?? format.isbn, format.isbn ? undefined : 'Draft2Digital can assign a free one.');
    add('Description', descriptionPlain(listing.description, book).text, undefined, true);
    add('Short description', listing.shortDescription, undefined, true);
    add('Search terms', keywords.join(', '));
    listing.bisac.forEach((b, i) => add(`Subject ${i + 1} (BISAC)`, `${b.code} ${b.heading}`.trim()));
    add('Release date', book.publicationDate);
    add(isEbook ? 'Ebook file' : 'Interior file', isEbook ? input.files?.ebook ?? '' : input.files?.interior ?? '');
    add('Cover file', isEbook ? input.files?.ebookCover ?? '' : input.files?.cover ?? '');
    add('Price', priceLines, isEbook && prices.some((p) => p.price === 0) ? 'A price of 0.00 makes the ebook free where stores allow it.' : undefined, true);
  }
  return {
    title: `${spec.displayName}: ${format.label || format.type}`,
    platform: spec.platform, formatId: format.id,
    fields: f.filter((x) => x.value !== '' || x.note),
  };
}

/** The sheet as plain text, for the exports folder. */
export function sheetText(sheet: ListingSheet, book: Book): string {
  const lines: string[] = [`${book.title}: listing sheet for ${sheet.title}`, 'Copy each field into the title setup form.', ''];
  for (const field of sheet.fields) {
    if (field.long || field.value.includes('\n')) {
      lines.push(`${field.label.toUpperCase()}`);
      if (field.note) lines.push(`(${field.note})`);
      lines.push(field.value, '');
    } else {
      lines.push(`${field.label.toUpperCase()}: ${field.value}${field.note ? `   (${field.note})` : ''}`);
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}
