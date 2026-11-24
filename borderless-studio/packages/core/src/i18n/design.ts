/**
 * Adjusts a book design to the language of the book, so an author who picks
 * Arabic or Hindi gets a book that prints correctly without touching the
 * design: fonts that have the letters, no drop capital that would cut a
 * joined word in two, and no hyphenation where the language does not use it.
 */
import { fontSupports } from '../fonts/catalog';
import type { Book } from '../model/book';
import type { Design } from '../model/design';
import { fontsForScript, languageInfo } from './languages';
import { stringsFor } from '../build/strings';
import { BookSchema, baseLanguage } from '../model/book';

export interface LanguageDesign {
  design: Design;
  /** What was changed, to tell the author. */
  notes: string[];
}

/** Scripts without capital letters: drop capitals and small capital lead-ins do not apply. */
const UNCASED = new Set(['arabic', 'hebrew', 'bengali', 'devanagari', 'cjk']);

export function designForLanguage(design: Design, language: string): LanguageDesign {
  const lang = languageInfo(language);
  const notes: string[] = [];
  let out = design;
  const fonts = fontsForScript(lang.script);
  if (fonts) {
    const swap: Partial<Design> = {};
    if (!fontSupports(design.bodyFont, lang.script)) swap.bodyFont = fonts.body;
    if (!fontSupports(design.headingFont, lang.script)) swap.headingFont = fonts.heading;
    if (!fontSupports(design.sansFont, lang.script)) swap.sansFont = fonts.sans;
    if (Object.keys(swap).length) {
      out = { ...out, ...swap };
      const names = [...new Set(Object.values(swap))].join(' and ');
      notes.push(`The chosen fonts cannot print ${lang.name}, so ${names} is used instead. Choose another font in Design to change this.`);
    }
  }
  if (UNCASED.has(lang.script)) {
    const op = out.chapterOpener;
    if (op.dropCap.enabled || op.leadIn !== 'none') {
      out = { ...out, chapterOpener: { ...op, dropCap: { ...op.dropCap, enabled: false }, leadIn: 'none' } };
    }
  }
  if (!lang.hyphenate && out.hyphenate) out = { ...out, hyphenate: false };
  return { design: out, notes };
}

/**
 * Settings for a new book in a language: the spelling dictionary, fonts that
 * print the script, and a chapter opening style that suits it. The author can
 * change all of them afterwards.
 */
/** The English dictionary for a regional tag: American for the US and Canada, British for the UK, Ireland and India, Australian otherwise. */
function englishSpelling(tag: string): string {
  const t = tag.replace('_', '-');
  return /-(US|CA)$/i.test(t) ? 'en-US' : /-(GB|IE|IN)$/i.test(t) ? 'en-GB' : 'en-AU';
}

export function applyLanguageDefaults(book: Book): void {
  const lang = languageInfo(book.language);
  if (lang.code === 'en') {
    book.style.spelling = englishSpelling(book.language);
    return;
  }
  book.style.spelling = lang.dictionary ?? lang.code;
  // The copyright page defaults in the book's language, where the app has them.
  const words = stringsFor(book.language);
  const english = BookSchema.parse({ id: 'x', title: 'x' });
  if (words.rights && book.copyright.rightsStatement === english.copyright.rightsStatement) book.copyright.rightsStatement = words.rights;
  if (words.firstEdition && book.editionStatement === english.editionStatement) book.editionStatement = words.firstEdition;
  const d = book.design;
  const fonts = fontsForScript(lang.script);
  if (fonts) {
    if (!fontSupports(d.bodyFont, lang.script)) d.bodyFont = fonts.body;
    if (!fontSupports(d.headingFont, lang.script)) d.headingFont = fonts.heading;
    if (!fontSupports(d.sansFont, lang.script)) d.sansFont = fonts.sans;
  }
  d.hyphenate = lang.hyphenate;
  if (UNCASED.has(lang.script)) {
    d.oldstyleFigures = false;
    d.chapterOpener.numberStyle = 'chapter-arabic';
    d.chapterOpener.numberCase = 'as-is';
    d.chapterOpener.leadIn = 'none';
    d.chapterOpener.dropCap.enabled = false;
    d.chapterOpener.titleStyle = 'regular';
    d.runningHeads.style = 'plain';
  }
  // Scripts with tall marks above and below the letters need more space between lines.
  if (lang.script === 'arabic' || lang.script === 'bengali' || lang.script === 'devanagari') d.lineHeight = Math.max(d.lineHeight, 1.5);
  if (lang.script === 'hebrew') d.lineHeight = Math.max(d.lineHeight, 1.4);
}

/**
 * Change the language of an existing book. The spelling dictionary follows
 * unless the author picked one for the same language, and the copyright page
 * sentences follow while they are still the app's defaults.
 */
export function changeBookLanguage(book: Book, tag: string): void {
  const before = stringsFor(book.language);
  const after = stringsFor(tag);
  const english = BookSchema.parse({ id: 'x', title: 'x' });
  const defaultRights = (w: typeof before) => w.rights ?? english.copyright.rightsStatement;
  const defaultEdition = (w: typeof before) => w.firstEdition ?? english.editionStatement;
  if (book.copyright.rightsStatement === defaultRights(before)) book.copyright.rightsStatement = defaultRights(after);
  if (book.editionStatement === defaultEdition(before)) book.editionStatement = defaultEdition(after);
  const lang = languageInfo(tag);
  if (baseLanguage(book.style.spelling) !== baseLanguage(tag)) book.style.spelling = lang.code === 'en' ? englishSpelling(tag) : lang.dictionary ?? lang.code;
  book.language = tag;
}
