/** Listing tools: description for each store, limits, listing sheets, Thema lookup and ONIX 3.0. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BookSchema, ListingSchema, buildOnix, checkListing, descriptionHtml, descriptionPlain, listingSheet, parsePlatformSpec, parseThema, searchThema,
  sheetText, themaPath,
} from '../src/index';

const root = path.resolve(__dirname, '..', '..', '..');
const spec = (name: string) => parsePlatformSpec(fs.readFileSync(path.join(root, 'specs', `${name}.json`), 'utf8')).value!;
const kdp = spec('kdp');
const ingram = spec('ingramspark');

const book = BookSchema.parse({
  id: 'bk_meta', title: 'The Salt Road', subtitle: 'A Sample Book', series: { name: 'Delta Stories', number: 2 },
  contributors: [{ name: 'Dr Saad Islam', sortName: 'Islam, Saad', role: 'author' }, { name: 'A. Painter', sortName: 'Painter, A.', role: 'illustrator' }],
  language: 'en-AU', publicationDate: '2026-11-23', copyright: { year: 2026, holder: 'Saad Islam' },
  formats: [
    { id: 'paperback', type: 'paperback', label: 'Paperback', trim: '5.5x8.5', isbn: '9781234567897', platforms: ['kdp', 'ingramspark'] },
    { id: 'ebook', type: 'ebook', label: 'Ebook', isbn: '9781234567910', platforms: ['kdp', 'draft2digital'] },
  ],
});
const listing = ListingSchema.parse({
  description: '## A river story\n\nWhen the last ferry fails to arrive, **three people** are left on the "wrong" bank.\n\nA novel of *rivers* & ledgers.\n\n- one long season\n- one ledger',
  shortDescription: 'A novel of rivers and ledgers.',
  keywords: ['river delta fiction', 'historical saga', 'bangladesh novel'],
  kdpCategories: ['Fiction > Literary', 'Fiction > Historical'],
  bisac: [{ code: 'FIC019000', heading: 'FICTION / Literary' }],
  thema: ['FBA'],
  authorBio: 'Dr Saad Islam writes in Sydney.',
});

describe('description', () => {
  it('becomes HTML with only the tags KDP accepts', () => {
    const d = descriptionHtml(listing.description, book, kdp);
    // h2 is not accepted by KDP: the largest allowed heading is used
    expect(d.text).toContain('<h4>A river story</h4>');
    expect(d.text).toContain('<b>three people</b>');
    expect(d.text).toContain('<em>rivers</em> &amp; ledgers');
    expect(d.text).toContain('<ul><li>one long season</li><li>one ledger</li></ul>');
    // typographic quotes from the house style
    expect(d.text).toContain('\u201Cwrong\u201D');
    expect(d.text).not.toMatch(/<(h[123]|div|span|strong)\b/);
    expect(d.limit).toBe(4000);
    expect(d.length).toBe(d.text.length);
    expect(d.tooLong).toBe(false);
  });

  it('is counted with its tags against the 4,000 character limit', () => {
    const long = Array.from({ length: 60 }, () => 'A sentence of the description that is repeated to make it long.').join('\n\n');
    const d = descriptionHtml(long, book, kdp);
    expect(d.tooLong).toBe(true);
    expect(checkListing(ListingSchema.parse({ description: long }), book, kdp).find((i) => i.field === 'description')!.message).toMatch(/including formatting tags; Amazon KDP allows 4000/);
  });

  it('becomes plain text for stores that take no formatting', () => {
    const d = descriptionPlain(listing.description, book);
    expect(d.text).not.toMatch(/[<>*#]/);
    expect(d.text).toContain('A river story\n\nWhen the last ferry');
    expect(d.text).toContain('- one long season\n- one ledger');
  });
});

describe('listing checks', () => {
  it('counts keyword fields and finds weak keywords', () => {
    const bad = ListingSchema.parse({
      description: listing.description,
      keywords: ['salt road', 'river', 'river', '"historical fiction"', 'free ebook', 'a', 'b', 'c'],
    });
    const issues = checkListing(bad, book, kdp).filter((i) => i.field === 'keywords').map((i) => i.message).join(' | ');
    expect(issues).toMatch(/8 keywords; Amazon KDP has 7 keyword fields/);
    expect(issues).toMatch(/"river" is entered twice/);
    expect(issues).toMatch(/Remove the quotation marks/);
    expect(issues).toMatch(/"free ebook" contains a claim/);
    expect(issues).toMatch(/"salt road" only repeats words from the title/);
    const fine = checkListing(listing, book, kdp).filter((i) => i.severity === 'fail');
    expect(fine).toEqual([]);
    expect(checkListing(listing, book, kdp).find((i) => i.field === 'keywords')!.message).toMatch(/3 of 7 keyword fields are used/);
  });

  it('checks the title length, categories and BISAC codes', () => {
    const longTitle = BookSchema.parse({ ...book, title: 'T'.repeat(150), subtitle: 'S'.repeat(80) });
    expect(checkListing(listing, longTitle, kdp).find((i) => i.field === 'title')!.severity).toBe('fail');
    const four = ListingSchema.parse({ ...listing, kdpCategories: ['a', 'b', 'c', 'd'] });
    expect(checkListing(four, book, kdp).find((i) => i.field === 'categories')!.message).toMatch(/allows 3 categories/);
    const badCode = ListingSchema.parse({ ...listing, bisac: [{ code: 'FICTION', heading: '' }] });
    expect(checkListing(badCode, book, ingram).find((i) => i.field === 'categories')!.message).toMatch(/does not look like a BISAC code/);
    expect(checkListing(ListingSchema.parse({ description: 'x' }), book, ingram).some((i) => /asks for BISAC subject codes/.test(i.message))).toBe(true);
  });
});

describe('listing sheets', () => {
  it('fills the KDP paperback form in order, with seven keyword fields', () => {
    const sheet = listingSheet({ book, format: book.formats[0], listing, spec: kdp, pages: 204, files: { interior: 'exports/x_interior.pdf', cover: 'exports/x_cover.pdf' }, coverHasBarcode: true });
    const labels = sheet.fields.map((f) => f.label);
    expect(labels.indexOf('Title')).toBeLessThan(labels.indexOf('Author: last name'));
    expect(sheet.fields.find((f) => f.label === 'Author: first name')!.value).toBe('Dr Saad');
    expect(sheet.fields.find((f) => f.label === 'Author: last name')!.value).toBe('Islam');
    expect(sheet.fields.find((f) => f.label === 'Keyword 1')!.value).toBe('river delta fiction');
    expect(sheet.fields.find((f) => f.label === 'Series')!.value).toBe('Delta Stories, book 2');
    expect(sheet.fields.find((f) => f.label === 'Ink and paper')!.value).toBe('Black and white interior with cream paper');
    expect(sheet.fields.find((f) => f.label === 'Cover file')!.note).toMatch(/Tick "The cover includes a barcode"/);
    expect(sheet.fields.find((f) => f.label === 'Expanded Distribution')!.value).toBe('Off');
    expect(sheet.fields.find((f) => f.label.startsWith('Description'))!.value).toContain('<h4>');
    const text = sheetText(sheet, book);
    expect(text).toContain('TITLE: The Salt Road');
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });

  it('tells the Kindle form not to enrol in KDP Select and gives IngramSpark plain text', () => {
    const kindle = listingSheet({ book, format: book.formats[1], listing, spec: kdp });
    expect(kindle.fields.find((f) => f.label === 'KDP Select')!.value).toBe('Do not enrol');
    expect(kindle.fields.find((f) => f.label === 'Digital Rights Management')!.value).toBe('No');
    const is = listingSheet({ book, format: book.formats[0], listing, spec: ingram, pages: 206, ingramDiscountPercent: 30 });
    expect(is.fields.find((f) => f.label === 'Full description')!.value).not.toContain('<');
    expect(is.fields.find((f) => f.label === 'Subject 1 (BISAC)')!.value).toBe('FIC019000 FICTION / Literary');
    expect(is.fields.find((f) => f.label === 'Wholesale discount')!.value).toBe('30%');
    expect(is.fields.find((f) => f.label === 'Returns')!.value).toBe('No');
    expect(is.fields.find((f) => f.label === 'Page count')!.value).toBe('206');
  });
});

describe('Thema lookup', () => {
  const entries = parseThema(JSON.parse(fs.readFileSync(path.join(root, 'resources', 'lookups', 'thema-v1.7-en.json'), 'utf8')));

  it('reads the official list', () => {
    expect(entries.length).toBeGreaterThan(9000);
    expect(entries.find((e) => e.code === 'A')!.heading).toBe('The Arts');
  });

  it('finds categories by code and by words', () => {
    expect(searchThema(entries, 'FB')[0].code).toBe('FB');
    const hits = searchThema(entries, 'historical fiction');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => /historical/i.test(h.heading) && /fiction/i.test(h.heading))).toBe(true);
    expect(searchThema(entries, '')).toEqual([]);
    expect(themaPath(entries, 'RGBU')).toMatch(/ > Glaciers and ice caps$/);
  });
});

describe('ONIX 3.0', () => {
  const xml = buildOnix({
    book, listing, sent: new Date(Date.UTC(2026, 10, 23, 5, 30)),
    editions: [
      { format: book.formats[0], pages: 204, trim: { widthIn: 5.5, heightIn: 8.5 }, prices: [{ marketId: 'AU', currency: 'AUD', amount: 13.99, includesTax: false }, { marketId: 'EU', currency: 'EUR', amount: 7.99, includesTax: false }] },
      { format: book.formats[1], prices: [{ marketId: 'ALL', currency: 'USD', amount: 0, includesTax: false }] },
    ],
  });

  it('is well formed and has one record for each edition', () => {
    // A small well-formedness check: every opening tag is closed in the right order.
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/)?([A-Za-z0-9]+)[^>]*?(\/)?>/g)) {
      if (m[3]) continue;
      if (m[1]) expect(stack.pop()).toBe(m[2]);
      else stack.push(m[2]);
    }
    expect(stack).toEqual([]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<ONIXMessage release="3.0" xmlns="http://ns.editeur.org/onix/3.0/reference">');
    expect((xml.match(/<Product>/g) ?? []).length).toBe(2);
    expect(xml).toContain('<SentDateTime>20261123T0530Z</SentDateTime>');
  });

  it('carries the identifiers, forms, subjects and prices in ONIX codes', () => {
    expect(xml).toContain('<ProductIDType>15</ProductIDType>');
    expect(xml).toContain('<IDValue>9781234567897</IDValue>');
    expect(xml).toContain('<ProductForm>BC</ProductForm>');
    expect(xml).toContain('<ProductForm>ED</ProductForm>');
    expect(xml).toContain('<ProductFormDetail>E101</ProductFormDetail>');
    expect(xml).toContain('<ContributorRole>A01</ContributorRole>');
    expect(xml).toContain('<ContributorRole>A12</ContributorRole>');
    expect(xml).toContain('<PersonNameInverted>Islam, Saad</PersonNameInverted>');
    expect(xml).toContain('<LanguageCode>eng</LanguageCode>');
    expect(xml).toContain('<ExtentValue>204</ExtentValue>');
    expect(xml).toContain('<SubjectSchemeIdentifier>10</SubjectSchemeIdentifier>');
    expect(xml).toContain('<SubjectCode>FIC019000</SubjectCode>');
    expect(xml).toContain('<SubjectSchemeIdentifier>93</SubjectSchemeIdentifier>');
    expect(xml).toContain('<SubjectHeadingText>river delta fiction; historical saga; bangladesh novel</SubjectHeadingText>');
    expect(xml).toContain('<CountryOfPublication>AU</CountryOfPublication>');
    expect(xml).toContain('<PriceAmount>13.99</PriceAmount>');
    expect(xml).toContain('<CountriesIncluded>AU</CountriesIncluded>');
    expect(xml).toContain('<RegionsIncluded>ECZ</RegionsIncluded>');
    // A free ebook has no price element; it is marked as free of charge.
    expect(xml).toContain('<UnpricedItemType>01</UnpricedItemType>');
    // Each record points to the other edition.
    expect(xml).toContain('<ProductRelationCode>06</ProductRelationCode>');
    // The description is real XHTML; a heading becomes a bold paragraph, which every recipient displays.
    expect(xml).toContain('<Text textformat="05"><p><b>A river story</b></p><p>');
  });

  it('validates against the official ONIX 3.0 schema when it is available (set ONIX_XSD to the reference .xsd)', () => {
    const xsd = process.env.ONIX_XSD;
    if (!xsd || !fs.existsSync(xsd)) return;
    const file = path.join(os.tmpdir(), `onix-test-${process.pid}.xml`);
    fs.writeFileSync(file, xml);
    try {
      execFileSync('xmllint', ['--noout', '--schema', xsd, file], { stdio: 'pipe' });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
