/**
 * ONIX 3.0 export: the book trade's standard format for sending a book's
 * details to distributors, retailers and libraries. One <Product> record is
 * written for each edition, in "reference names" and in the element order
 * the ONIX 3.0 schema requires.
 *
 * The record uses codes from the EDItEUR code lists (issue 75 is bundled in
 * resources/lookups). Honest limit: the file is built to the published
 * structure and checked for well formed XML and element order in the tests,
 * but it has not been run through a trading partner's own validator. Ask the
 * recipient to confirm the first file you send.
 */
import type { Book, BookFormat } from '../model/book';
import { baseLanguage } from '../model/book';
import type { Listing } from './listing';
import { descriptionHtml, descriptionPlain } from './listing';

export interface OnixPrice {
  /** Marketplace or country code as used in the spec files (AU, US, GB, EU, ALL ...). */
  marketId: string;
  currency: string;
  amount: number;
  /** True when the amount includes tax. */
  includesTax: boolean;
}

export interface OnixEdition {
  format: BookFormat;
  /** Page count of the built interior. */
  pages?: number | null;
  trim?: { widthIn: number; heightIn: number } | null;
  prices?: OnixPrice[];
}

export interface OnixInput {
  book: Book;
  listing: Listing;
  editions: OnixEdition[];
  sender?: { name: string; contact?: string; email?: string };
  /** Timestamp of the message; defaults to now. */
  sent?: Date;
}

const LANGUAGE: Record<string, string> = {
  en: 'eng', bn: 'ben', fr: 'fre', de: 'ger', es: 'spa', it: 'ita', hi: 'hin', ar: 'ara', zh: 'chi', ja: 'jpn', pt: 'por', nl: 'dut', ur: 'urd', ta: 'tam',
};
const ROLE: Record<string, string> = {
  author: 'A01', editor: 'B01', illustrator: 'A12', translator: 'B06', foreword: 'A23', introduction: 'A24', contributor: 'A32', photographer: 'A13', narrator: 'E07',
};
const COUNTRY: Record<string, string> = { australia: 'AU', 'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB', canada: 'CA', bangladesh: 'BD', india: 'IN', 'new zealand': 'NZ' };

const x = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const el = (name: string, value: string | number | null | undefined, attrs = ''): string =>
  value === null || value === undefined || value === '' ? '' : `<${name}${attrs}>${x(String(value))}</${name}>`;
const wrap = (name: string, inner: string): string => (inner ? `<${name}>${inner}</${name}>` : '');
const ymd = (d: Date): string => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

function territory(marketId: string): string {
  if (marketId === 'ALL' || marketId === 'WORLD') return '<Territory><RegionsIncluded>WORLD</RegionsIncluded></Territory>';
  // One euro price for the countries that use the euro.
  if (marketId === 'EU') return '<Territory><RegionsIncluded>ECZ</RegionsIncluded></Territory>';
  return `<Territory><CountriesIncluded>${x(marketId)}</CountriesIncluded></Territory>`;
}

function product(input: OnixInput, edition: OnixEdition, now: Date): string {
  const { book, listing } = input;
  const f = edition.format;
  const isEbook = f.type === 'ebook';
  const reference = `${(book.imprint || 'publisher').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${f.isbn || `${book.id}.${f.id}`}`;
  const published = book.publicationDate ? book.publicationDate.replace(/-/g, '') : '';
  const future = published && published > ymd(now);
  const parts: string[] = [];

  parts.push(el('RecordReference', reference));
  parts.push(el('NotificationType', future ? '02' : '03'));
  parts.push(el('RecordSourceType', '01'));
  if (f.isbn) parts.push(`<ProductIdentifier>${el('ProductIDType', '15')}${el('IDValue', f.isbn)}</ProductIdentifier>`);
  else parts.push(`<ProductIdentifier>${el('ProductIDType', '01')}${el('IDTypeName', 'Publisher product id')}${el('IDValue', `${book.id}-${f.id}`)}</ProductIdentifier>`);

  // --- DescriptiveDetail -------------------------------------------------
  const d: string[] = [];
  d.push(el('ProductComposition', '00'));
  d.push(el('ProductForm', isEbook ? 'ED' : f.type === 'hardcover' ? 'BB' : 'BC'));
  if (isEbook) {
    d.push(el('ProductFormDetail', 'E101'));
    d.push(el('PrimaryContentType', '10'));
  } else if (edition.trim) {
    d.push(`<Measure>${el('MeasureType', '01')}${el('Measurement', edition.trim.heightIn)}${el('MeasureUnitCode', 'in')}</Measure>`);
    d.push(`<Measure>${el('MeasureType', '02')}${el('Measurement', edition.trim.widthIn)}${el('MeasureUnitCode', 'in')}</Measure>`);
  }
  if (book.series?.name) {
    d.push(
      `<Collection>${el('CollectionType', '10')}` +
        (book.series.number ? `<CollectionSequence>${el('CollectionSequenceType', '02')}${el('CollectionSequenceNumber', book.series.number)}</CollectionSequence>` : '') +
        `<TitleDetail>${el('TitleType', '01')}<TitleElement>${el('TitleElementLevel', '02')}${el('TitleText', book.series.name)}</TitleElement></TitleDetail></Collection>`,
    );
  }
  d.push(`<TitleDetail>${el('TitleType', '01')}<TitleElement>${el('TitleElementLevel', '01')}${el('TitleText', book.title)}${el('Subtitle', book.subtitle)}</TitleElement></TitleDetail>`);
  book.contributors.filter((c) => c.name.trim()).forEach((c, i) => {
    d.push(
      `<Contributor>${el('SequenceNumber', i + 1)}${el('ContributorRole', ROLE[c.role] ?? 'A01')}${el('PersonName', c.name)}${el('PersonNameInverted', c.sortName)}` +
        el('BiographicalNote', c.bio || (i === 0 ? listing.authorBio : '')) + '</Contributor>',
    );
  });
  if (f.largePrint) d.push(el('EditionType', 'LTE'));
  if (book.editionNumber > 1) d.push(el('EditionNumber', book.editionNumber));
  d.push(el('EditionStatement', book.editionStatement));
  d.push(`<Language>${el('LanguageRole', '01')}${el('LanguageCode', LANGUAGE[baseLanguage(book.language)] ?? 'eng')}</Language>`);
  if (edition.pages && !isEbook) d.push(`<Extent>${el('ExtentType', '00')}${el('ExtentValue', edition.pages)}${el('ExtentUnit', '03')}</Extent>`);
  listing.bisac.filter((b) => b.code.trim()).forEach((b, i) => {
    d.push(`<Subject>${i === 0 ? '<MainSubject/>' : ''}${el('SubjectSchemeIdentifier', '10')}${el('SubjectCode', b.code.trim().toUpperCase())}${el('SubjectHeadingText', b.heading)}</Subject>`);
  });
  listing.thema.filter(Boolean).forEach((code, i) => {
    d.push(`<Subject>${i === 0 && listing.bisac.length === 0 ? '<MainSubject/>' : ''}${el('SubjectSchemeIdentifier', '93')}${el('SubjectCode', code)}</Subject>`);
  });
  const keywords = listing.keywords.map((k) => k.trim()).filter(Boolean);
  if (keywords.length) d.push(`<Subject>${el('SubjectSchemeIdentifier', '20')}${el('SubjectHeadingText', keywords.join('; '))}</Subject>`);
  const audienceCode = listing.audience.kind === 'children' ? '02' : listing.audience.kind === 'young-adult' ? '03' : '01';
  d.push(`<Audience>${el('AudienceCodeType', '01')}${el('AudienceCodeValue', audienceCode)}</Audience>`);
  if (listing.audience.ageMin !== null || listing.audience.ageMax !== null) {
    d.push(
      `<AudienceRange>${el('AudienceRangeQualifier', '17')}` +
        (listing.audience.ageMin !== null ? `${el('AudienceRangePrecision', '03')}${el('AudienceRangeValue', listing.audience.ageMin)}` : '') +
        (listing.audience.ageMax !== null ? `${el('AudienceRangePrecision', '04')}${el('AudienceRangeValue', listing.audience.ageMax)}` : '') +
        '</AudienceRange>',
    );
  }
  parts.push(wrap('DescriptiveDetail', d.join('')));

  // --- CollateralDetail ----------------------------------------------------
  const c: string[] = [];
  if (listing.shortDescription.trim()) c.push(`<TextContent>${el('TextType', '02')}${el('ContentAudience', '00')}${el('Text', descriptionPlain(listing.shortDescription, book).text)}</TextContent>`);
  if (listing.description.trim()) {
    // The description travels as real XHTML elements (text format 05), not as escaped text.
    const xhtml = descriptionHtml(listing.description, book).text.replace(/<br>/g, '<br/>');
    c.push(`<TextContent>${el('TextType', '03')}${el('ContentAudience', '00')}<Text textformat="05">${xhtml}</Text></TextContent>`);
  }
  parts.push(wrap('CollateralDetail', c.join('')));

  // --- PublishingDetail ------------------------------------------------------
  const p: string[] = [];
  p.push(wrap('Imprint', el('ImprintName', book.imprint)));
  p.push(`<Publisher>${el('PublishingRole', '01')}${el('PublisherName', book.imprint)}${book.publisherWebsite ? `<Website>${el('WebsiteRole', '01')}${el('WebsiteLink', /^https?:/.test(book.publisherWebsite) ? book.publisherWebsite : `https://${book.publisherWebsite}`)}</Website>` : ''}</Publisher>`);
  p.push(el('CityOfPublication', book.publisherCity));
  p.push(el('CountryOfPublication', COUNTRY[book.publisherCountry.trim().toLowerCase()] ?? (/^[A-Z]{2}$/.test(book.publisherCountry) ? book.publisherCountry : '')));
  p.push(el('PublishingStatus', future ? '02' : '04'));
  if (published) p.push(`<PublishingDate>${el('PublishingDateRole', '01')}${el('Date', published, ' dateformat="00"')}</PublishingDate>`);
  if (book.copyright.holder) p.push(`<CopyrightStatement>${el('CopyrightYear', book.copyright.year)}<CopyrightOwner>${el('PersonName', book.copyright.holder)}</CopyrightOwner></CopyrightStatement>`);
  if (listing.territories === 'world') p.push(`<SalesRights>${el('SalesRightsType', '01')}<Territory><RegionsIncluded>WORLD</RegionsIncluded></Territory></SalesRights>`);
  parts.push(wrap('PublishingDetail', p.join('')));

  // --- RelatedMaterial: the other editions of the same book -----------------------
  const others = input.editions.filter((e) => e.format.id !== f.id && e.format.isbn);
  if (others.length) {
    parts.push(wrap('RelatedMaterial', others.map((o) => `<RelatedProduct>${el('ProductRelationCode', '06')}<ProductIdentifier>${el('ProductIDType', '15')}${el('IDValue', o.format.isbn)}</ProductIdentifier></RelatedProduct>`).join('')));
  }

  // --- ProductSupply --------------------------------------------------------------
  const prices = (edition.prices ?? []).map((price) =>
    price.amount > 0
      ? `<Price>${el('PriceType', price.includesTax ? '02' : '01')}${el('PriceAmount', price.amount.toFixed(price.currency === 'JPY' ? 0 : 2))}${el('CurrencyCode', price.currency)}${territory(price.marketId)}</Price>`
      : '',
  ).join('');
  const free = (edition.prices ?? []).length > 0 && (edition.prices ?? []).every((price) => price.amount === 0);
  parts.push(
    `<ProductSupply><SupplyDetail><Supplier>${el('SupplierRole', '01')}${el('SupplierName', book.imprint)}</Supplier>${el('ProductAvailability', future ? '10' : '20')}` +
      (free ? el('UnpricedItemType', '01') : prices || el('UnpricedItemType', '02')) + '</SupplyDetail></ProductSupply>',
  );
  return `<Product>${parts.join('')}</Product>`;
}

/** Indent a compact XML string for reading; text content is left untouched. */
function pretty(xml: string): string {
  // Descriptions contain running text with markup; they are kept on one line exactly as written.
  const kept: string[] = [];
  const source = xml.replace(/<Text textformat="05">[\s\S]*?<\/Text>/g, (m) => {
    kept.push(m);
    return `<Text>@@${kept.length - 1}@@</Text>`;
  });
  const out: string[] = [];
  let depth = 0;
  for (const token of source.replace(/>\s*</g, '>\n<').split('\n')) {
    const closing = /^<\//.test(token);
    const selfContained = /^<[^!?/][^>]*>[^<]*<\/[^>]+>$/.test(token) || /\/>$/.test(token) || /^<\?/.test(token);
    if (closing) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + token);
    if (!closing && !selfContained) depth++;
  }
  return out.join('\n').replace(/<Text>@@(\d+)@@<\/Text>/g, (_m, i) => kept[Number(i)]) + '\n';
}

export function buildOnix(input: OnixInput): string {
  const now = input.sent ?? new Date();
  const stamp = `${ymd(now)}T${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}Z`;
  const sender = input.sender ?? { name: input.book.imprint };
  const header =
    `<Header><Sender>${el('SenderName', sender.name)}${el('ContactName', sender.contact)}${el('EmailAddress', sender.email)}</Sender>` +
    `${el('SentDateTime', stamp)}${el('DefaultLanguageOfText', LANGUAGE[baseLanguage(input.book.language)] ?? 'eng')}</Header>`;
  const products = input.editions.filter((e) => e.format.enabled).map((e) => product(input, e, now)).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + pretty(`<ONIXMessage release="3.0" xmlns="http://ns.editeur.org/onix/3.0/reference">${header}${products}</ONIXMessage>`);
}
