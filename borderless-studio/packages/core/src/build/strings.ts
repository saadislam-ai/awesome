/**
 * Words the app prints into books ("Chapter", "Contents", "Notes") in each
 * supported language, and helpers for chapter labels.
 */
import { baseLanguage } from '../model/book';
import type { SectionKind } from '../model/book';
import { numberToWords, titleCase, toBengaliDigits, toRoman } from '../util/text';

export interface BookStrings {
  chapter: string;
  part: string;
  contents: string;
  notes: string;
  index: string;
  alsoBy: string;
  /** "ISBN 978... (paperback)" */
  formatNames: { paperback: string; hardcover: string; ebook: string; largePrint: string };
  kinds: Partial<Record<SectionKind, string>>;
  copyrightWord: string;
  publishedBy: string;
  firstPublished: string;
  nlaLine: string;
  moralRight: string;
  typesetIn: string;
  edition: string;
}

const EN: BookStrings = {
  chapter: 'Chapter',
  part: 'Part',
  contents: 'Contents',
  notes: 'Notes',
  index: 'Index',
  alsoBy: 'Also by',
  formatNames: { paperback: 'paperback', hardcover: 'hardcover', ebook: 'ebook', largePrint: 'large print' },
  kinds: {
    toc: 'Contents',
    foreword: 'Foreword',
    preface: 'Preface',
    introduction: 'Introduction',
    prologue: 'Prologue',
    epilogue: 'Epilogue',
    afterword: 'Afterword',
    acknowledgements: 'Acknowledgements',
    'about-author': 'About the Author',
    'also-by': 'Also by the Author',
    'note-to-readers': 'A Note to Readers',
    'reading-group': 'Reading Group Questions',
    endnotes: 'Notes',
    bibliography: 'Bibliography',
    index: 'Index',
    appendix: 'Appendix',
    glossary: 'Glossary',
    dedication: 'Dedication',
    epigraph: 'Epigraph',
  },
  copyrightWord: 'Copyright',
  publishedBy: 'Published by',
  firstPublished: 'First published',
  nlaLine: 'A catalogue record for this book is available from the National Library of Australia.',
  moralRight: 'The moral right of the author has been asserted.',
  typesetIn: 'Typeset in',
  edition: 'edition',
};

const BN: BookStrings = {
  chapter: 'অধ্যায়', // অধ্যায়
  part: 'পর্ব', // পর্ব
  contents: 'সূচিপত্র', // সূচিপত্র
  notes: 'টীকা', // টীকা
  index: 'নির্ঘণ্ট', // নির্ঘণ্ট
  alsoBy: 'একই লেখকের অন্যান্য বই', // একই লেখকের অন্যান্য বই
  formatNames: {
    paperback: 'পেপারব্যাক', // পেপারব্যাক
    hardcover: 'হার্ডকভার', // হার্ডকভার
    ebook: 'ই-বুক', // ই-বুক
    largePrint: 'বড় হরফ', // বড় হরফ
  },
  kinds: {
    toc: 'সূচিপত্র', // সূচিপত্র
    foreword: 'মুখবন্ধ', // মুখবন্ধ
    preface: 'ভূমিকা', // ভূমিকা
    introduction: 'সূচনা', // সূচনা
    prologue: 'পূর্বকথা', // পূর্বকথা
    epilogue: 'শেষকথা', // শেষকথা
    afterword: 'উত্তরকথন', // উত্তরকথন
    acknowledgements: 'কৃতজ্ঞতা স্বীকার', // কৃতজ্ঞতা স্বীকার
    'about-author': 'লেখক পরিচিতি', // লেখক পরিচিতি
    'also-by': 'একই লেখকের অন্যান্য বই',
    'note-to-readers': 'পাঠকের প্রতি', // পাঠকের প্রতি
    'reading-group': 'পাঠচক্রের প্রশ্ন', // পাঠচক্রের প্রশ্ন
    endnotes: 'টীকা',
    bibliography: 'গ্রন্থপঞ্জি', // গ্রন্থপঞ্জি
    index: 'নির্ঘণ্ট',
    appendix: 'পরিশিষ্ট', // পরিশিষ্ট
    glossary: 'শব্দকোষ', // শব্দকোষ
    dedication: 'উৎসর্গ', // উৎসর্গ
  },
  copyrightWord: 'কপিরাইট', // কপিরাইট
  publishedBy: 'প্রকাশক:', // প্রকাশক:
  firstPublished: 'প্রথম প্রকাশ', // প্রথম প্রকাশ
  nlaLine: 'A catalogue record for this book is available from the National Library of Australia.',
  moralRight: '',
  typesetIn: '',
  edition: 'সংস্করণ', // সংস্করণ
};

export function stringsFor(language: string): BookStrings {
  return baseLanguage(language) === 'bn' ? BN : EN;
}

export function usesBengaliDigits(language: string): boolean {
  return baseLanguage(language) === 'bn';
}

export type NumberStyle =
  | 'none' | 'arabic' | 'roman' | 'words' | 'chapter-arabic' | 'chapter-words' | 'chapter-roman';

/**
 * The label printed above a chapter title: "Chapter One", "1", "IV" and so on.
 * Bangla books use Bengali digits; number words are only spelled out in English.
 */
export function chapterLabel(n: number, style: NumberStyle, language: string, word?: string): string {
  if (style === 'none') return '';
  const s = stringsFor(language);
  const bn = usesBengaliDigits(language);
  const digits = bn ? toBengaliDigits(n) : String(n);
  const chapterWord = word ?? s.chapter;
  switch (style) {
    case 'arabic':
      return digits;
    case 'roman':
      return bn ? digits : toRoman(n, true);
    case 'words':
      return bn ? digits : titleCase(numberToWords(n));
    case 'chapter-arabic':
      return `${chapterWord} ${digits}`;
    case 'chapter-roman':
      return bn ? `${chapterWord} ${digits}` : `${chapterWord} ${toRoman(n, true)}`;
    case 'chapter-words':
      return bn ? `${chapterWord} ${digits}` : `${chapterWord} ${titleCase(numberToWords(n))}`;
  }
}

export function partLabel(n: number, style: 'none' | 'roman' | 'words' | 'arabic', language: string): string {
  if (style === 'none') return '';
  return chapterLabel(n, style === 'roman' ? 'chapter-roman' : style === 'words' ? 'chapter-words' : 'chapter-arabic', language, stringsFor(language).part);
}
