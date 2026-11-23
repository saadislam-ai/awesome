/** What every importer produces: a list of documents in reading order, ready to become binder items. */
export interface ImportedItem {
  title: string;
  /** part: a part title with no text of its own. chapter: text of a chapter. front and back: matter before and after the body. */
  kind: 'part' | 'chapter' | 'front' | 'back';
  /** Markdown in the app's dialect (footnotes, tracked changes as CriticMarkup). */
  text: string;
  /** Kept in the book for reference but left out of exports (a copyright page the app replaces with its own). */
  excluded?: boolean;
}

export interface ImportedBook {
  title: string;
  author: string;
  language: string;
  items: ImportedItem[];
  /** Pictures found in the source, to be written to the book's images folder. */
  images: { name: string; data: Uint8Array }[];
  /** Things the user should know (what could not be carried over). */
  notes: string[];
}

export const emptyImport = (): ImportedBook => ({ title: '', author: '', language: '', items: [], images: [], notes: [] });

const FRONT = /^(dedication|epigraph|foreword|preface|introduction|prologue|contents|table of contents|copyright|title page|half title|also by)\b/i;
const BACK = /^(epilogue|afterword|acknowledge?ments|about the author|notes|endnotes|bibliography|glossary|appendix|index|reading group|a note to readers|author'?s note)\b/i;

/** Guess from a heading whether a document is front matter, back matter or a chapter. */
export function kindFromTitle(title: string, seenChapter: boolean): ImportedItem['kind'] {
  const t = title.trim();
  if (/^part\s+([ivxlc\d]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(t)) return 'part';
  if (BACK.test(t)) return 'back';
  if (FRONT.test(t) && !/^prologue|^introduction/i.test(t)) return seenChapter ? 'back' : 'front';
  return 'chapter';
}

/** Tidy Markdown produced by an importer: no trailing spaces, at most one blank line in a row, one newline at the end. */
export function tidyMarkdown(md: string): string {
  return md.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Characters that mean something in Markdown are escaped so imported prose reads as it was written. */
export function escapeMarkdown(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([*_`\[\]{}])/g, '\\$1').replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/gm, '$1\\$2');
}

/**
 * A chapter heading without its number: "Chapter One: The River" becomes
 * "The River", because the app numbers chapters itself. A heading that is
 * only a number ("Chapter 7") becomes empty.
 */
const NUMBER_WORD = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)';
const NUMBERED_HEADING = new RegExp(`^(?:chapter|part|book)\\s+(?:[ivxlcdm]+|\\d+|${NUMBER_WORD})\\b\\s*[:.\\u2014\\u2013-]?\\s*(.*)$`, 'i');
const BARE_NUMBER = new RegExp(`^(?:\\d{1,3}\\.?|${NUMBER_WORD})$`, 'i');

export function cleanTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const numbered = NUMBERED_HEADING.exec(t);
  if (numbered) return numbered[1].trim();
  // A heading that is only a number ("12", "Seven"), or a number in front of the title ("12. The River").
  if (BARE_NUMBER.test(t)) return '';
  const led = /^\d{1,3}[.):]\s+(.+)$/.exec(t);
  return led ? led[1].trim() : t;
}

/** Undo escapeMarkdown: the text as it was typed. */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([*_`[\]{}\\#>+\-\d])/g, '$1');
}
