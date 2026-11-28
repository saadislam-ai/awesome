import { runsText, stripHints, type Block, type ChapterDraft, type DraftBlock } from '../model/blocks';
import { countWords } from '../text/words';

export type SplitStrategy = 'auto' | 'headings' | 'patterns' | 'pagebreaks' | 'none';

export interface DetectionResult {
  chapters: ChapterDraft[];
  /** The strategy that was actually used. */
  strategy: Exclude<SplitStrategy, 'auto'>;
  /** A book title found in the manuscript itself, if any. */
  bookTitle?: string;
}

export const FRONT_MATTER_TITLE = 'Front matter';
export const TITLE_PAGE_TITLE = 'Title page';

/** What is already known about the book, used to recognise its title page. */
export interface DetectHints {
  title?: string;
  author?: string;
}

const CHAPTER_WORDS =
  'chapter|chapitre|cap[ií]tulo|capitolo|kapitel|hoofdstuk|rozdzia[łl]|kapitola|глава|раздел|розділ|b[öo]l[üu]m|κεφάλαιο|فصل|الفصل|باب|अध्याय|פרק';
const CHAPTER_START = new RegExp(`^(?:${CHAPTER_WORDS})(?:[\\s.:\\-–—]+\\S.*|\\s*\\d.*)?$`, 'iu');
const PART_START = /^(?:part|book|teil|partie|parte|часть|deel)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|un|deux|trois|eins|zwei|drei|uno|dos|tres)\b.*$/iu;
const CJK_CHAPTER = /^第\s*[0-9０-９一二三四五六七八九十百千零〇两]+\s*[章回节節卷部篇话話]|^제\s*\d+\s*[장화부]/u;
const NAMED_SECTION =
  /^(?:prologue|epilogue|introduction|preface|foreword|afterword|acknowledge?ments?|dedication|interlude|appendix(?:\s+\S+)?|about the authors?|author'?s note|a note from the author|conclusion|glossary|bibliography|notes|pr[oó]logo|ep[ií]logo|introducci[oó]n|prologue|épilogue|avant-propos|einleitung|vorwort|nachwort|пролог|эпилог|введение|предисловие)\s*[:.]?$/iu;
const BARE_NUMBER = /^(?:\d{1,3}|[ivxlc]{1,7})\.?$/i;
const TERMINAL = /[.,;]$/;

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function romanToInt(s: string): number {
  let total = 0;
  const lower = s.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const cur = ROMAN[lower[i]] ?? 0;
    const next = ROMAN[lower[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

function textOf(block: DraftBlock): string {
  return block.type === 'break' ? '' : runsText(block.runs).replace(/\s+/g, ' ').trim();
}

function wordCount(text: string): number {
  return text ? text.split(/\s+/).length : 0;
}

function cleanTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 160 ? t.slice(0, 157).trimEnd() + '...' : t;
}

/** A short line that reads like a title: centred, bold, all caps or title case. */
function looksLikeTitleLine(block: DraftBlock): boolean {
  if (block.type !== 'paragraph') return false;
  const text = textOf(block);
  if (!text || wordCount(text) > 9 || TERMINAL.test(text) || /^["“'‘«—–-]/.test(text)) return false;
  if (block.align === 'center') return true;
  if (block.runs.length && block.runs.every((r) => r.b || !r.text.trim())) return true;
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return true;
  const words = text.split(' ').filter((w) => /\p{L}/u.test(w));
  const capitalised = words.filter((w) => /^[^\p{L}]*\p{Lu}/u.test(w)).length;
  return words.length >= 1 && words.length <= 7 && capitalised >= Math.ceil(words.length * 0.6) && /^[^\p{L}]*\p{Lu}/u.test(words[0]);
}

function isPatternStart(block: DraftBlock): boolean {
  if (block.type !== 'paragraph') return false;
  const text = textOf(block);
  if (!text || text.length > 90 || wordCount(text) > 12) return false;
  if (CJK_CHAPTER.test(text) && text.length <= 40) return true;
  if (NAMED_SECTION.test(text)) return true;
  if (CHAPTER_START.test(text) || PART_START.test(text)) {
    // "Chapter books are fun." is a sentence, not a chapter heading.
    const rest = text.replace(new RegExp(`^(?:${CHAPTER_WORDS}|part|book)\\s*`, 'iu'), '');
    if (TERMINAL.test(text) && !/^(?:\d+|[ivxlcdm]+)\.?$/i.test(rest)) return false;
    return true;
  }
  return false;
}

/** Bare "1", "2", "III" lines count as chapter starts only when they form a sequence. */
function bareNumberStarts(blocks: DraftBlock[]): Set<number> {
  const candidates: { index: number; value: number }[] = [];
  blocks.forEach((block, index) => {
    if (block.type !== 'paragraph') return;
    const text = textOf(block);
    if (!BARE_NUMBER.test(text)) return;
    const raw = text.replace(/\.$/, '');
    const value = /^\d+$/.test(raw) ? Number(raw) : romanToInt(raw);
    candidates.push({ index, value });
  });
  if (candidates.length < 3) return new Set();
  let inSequence = 0;
  for (let i = 1; i < candidates.length; i++) if (candidates[i].value === candidates[i - 1].value + 1) inSequence++;
  return inSequence >= (candidates.length - 1) * 0.7 ? new Set(candidates.map((c) => c.index)) : new Set();
}

function trimBreaks(blocks: Block[]): Block[] {
  let start = 0;
  let end = blocks.length;
  while (start < end && blocks[start].type === 'break') start++;
  while (end > start && blocks[end - 1].type === 'break') end--;
  return blocks.slice(start, end);
}

interface Start {
  index: number;
  title: string;
  /** Number of blocks consumed by the title (removed from the chapter body). */
  consumed: number;
}

function frontChapter(blocks: Block[]): ChapterDraft {
  const words = blocks.reduce((n, b) => n + (b.type === 'break' ? 0 : countWords(runsText(b.runs))), 0);
  return { title: words < 80 ? TITLE_PAGE_TITLE : FRONT_MATTER_TITLE, blocks };
}

function assemble(blocks: DraftBlock[], starts: Start[]): ChapterDraft[] {
  const chapters: ChapterDraft[] = [];
  const firstStart = starts.length ? starts[0].index : blocks.length;
  const front = trimBreaks(stripHints(blocks.slice(0, firstStart)));
  if (front.length) chapters.push(frontChapter(front));
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : blocks.length;
    const body = trimBreaks(stripHints(blocks.slice(start.index + start.consumed, end)));
    chapters.push({ title: cleanTitle(start.title) || `Chapter ${chapters.length + 1}`, blocks: body });
  });
  return chapters;
}

function normalise(text: string | undefined): string {
  return (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Finds the title page at the top of a manuscript (the title, an optional
 * subtitle and the author line) so it is not mistaken for a chapter.
 */
function prepare(input: DraftBlock[], hints: DetectHints): { blocks: DraftBlock[]; titlePageEnd: number; bookTitle?: string } {
  const title = normalise(hints.title);
  const author = normalise(hints.author);
  const first = input.findIndex((b) => b.type !== 'break');
  if (first < 0 || !title) return { blocks: input, titlePageEnd: 0 };
  const firstBlock = input[first];
  const firstText = textOf(firstBlock);
  if (normalise(firstText) !== title) return { blocks: input, titlePageEnd: 0 };

  const blocks = input.slice();
  if (firstBlock.type === 'heading') {
    blocks[first] = { type: 'paragraph', runs: firstBlock.runs, align: 'center', ...(firstBlock.pb ? { pb: true as const } : {}) };
  }
  let end = first + 1;
  while (end < blocks.length) {
    const block = blocks[end];
    if (block.type !== 'paragraph' || block.pb) break;
    const text = textOf(block);
    const n = normalise(text);
    const byline = /^(?:by|written by|par|por|von|di|de)\s+\S/i.test(text) && wordCount(text) <= 8;
    if (!(n === author || n === title || byline || (author && n.includes(author) && wordCount(text) <= 10))) break;
    end++;
  }
  return { blocks, titlePageEnd: end, bookTitle: firstText };
}

function headingStarts(blocks: DraftBlock[]): { starts: Start[]; bookTitle?: string } {
  const counts = new Map<number, number>();
  for (const b of blocks) if (b.type === 'heading') counts.set(b.level, (counts.get(b.level) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  if (!levels.length) return { starts: [] };

  let chapterLevel = levels[0];
  let bookTitle: string | undefined;
  let titleIndex = -1;
  if (counts.get(levels[0]) === 1) {
    // A single top-level heading is the book title when deeper headings exist.
    const index = blocks.findIndex((b) => b.type === 'heading' && b.level === levels[0]);
    const next = levels.find((l) => l > levels[0] && (counts.get(l) ?? 0) >= 2);
    if (next !== undefined) {
      chapterLevel = next;
      bookTitle = textOf(blocks[index]);
      titleIndex = index;
    }
  } else if (levels.length > 1) {
    // "Part One" above "Chapter 1": split at the level that carries the chapters.
    const next = levels[1];
    const topTexts = blocks.filter((b) => b.type === 'heading' && b.level === levels[0]).map(textOf);
    const nextTexts = blocks.filter((b) => b.type === 'heading' && b.level === next).map(textOf);
    const partLike = topTexts.filter((t) => PART_START.test(t)).length;
    const chapterLike = nextTexts.filter((t) => CHAPTER_START.test(t) || /^\d+[.:\s]/.test(t)).length;
    if (partLike >= topTexts.length * 0.6 && (chapterLike >= nextTexts.length * 0.5 || nextTexts.length >= topTexts.length * 2)) {
      chapterLevel = next;
    }
  }

  const starts: Start[] = [];
  blocks.forEach((b, index) => {
    if (b.type === 'heading' && b.level <= chapterLevel && index !== titleIndex) {
      starts.push({ index, title: textOf(b), consumed: 1 });
    }
  });
  return { starts, bookTitle };
}

function patternStarts(blocks: DraftBlock[]): Start[] {
  const bare = bareNumberStarts(blocks);
  const starts: Start[] = [];
  blocks.forEach((block, index) => {
    const isHeading = block.type === 'heading';
    if (!isHeading && !isPatternStart(block) && !bare.has(index)) return;
    let title = textOf(block);
    let consumed = 1;
    const next = blocks[index + 1];
    // "Chapter 3" followed by its own title line becomes "Chapter 3: The Storm".
    if (!isHeading && next && !NAMED_SECTION.test(title) && looksLikeTitleLine(next) && !isPatternStart(next)) {
      title = `${title.replace(/[:.\s]+$/, '')}: ${textOf(next)}`;
      consumed = 2;
    }
    starts.push({ index, title, consumed });
  });
  return starts;
}

function pageBreakStarts(blocks: DraftBlock[]): Start[] {
  const starts: Start[] = [];
  blocks.forEach((block, index) => {
    if (!block.pb || block.type === 'break') return;
    const text = textOf(block);
    if (block.type === 'heading' || looksLikeTitleLine(block) || isPatternStart(block)) {
      starts.push({ index, title: text, consumed: 1 });
    } else {
      starts.push({ index, title: '', consumed: 0 });
    }
  });
  return starts;
}

function single(blocks: DraftBlock[], titlePageEnd: number): ChapterDraft[] {
  const front = trimBreaks(stripHints(blocks.slice(0, titlePageEnd)));
  const rest = trimBreaks(stripHints(blocks.slice(titlePageEnd)));
  if (front.length && rest.length) return [frontChapter(front), { title: 'Full text', blocks: rest }];
  return [{ title: 'Full text', blocks: trimBreaks(stripHints(blocks)) }];
}

/**
 * Splits a manuscript into chapters.
 *
 * In "auto" mode it prefers real headings, then "Chapter N" style lines, then
 * page breaks, and finally keeps the text as one chapter. Nothing is ever
 * discarded: text before the first chapter becomes a "Title page" or
 * "Front matter" chapter.
 */
export function detectChapters(input: DraftBlock[], strategy: SplitStrategy = 'auto', hints: DetectHints = {}): DetectionResult {
  const { blocks, titlePageEnd, bookTitle: titlePageTitle } = prepare(input, hints);
  const byHeadings = headingStarts(blocks);
  const bookTitle = titlePageTitle ?? byHeadings.bookTitle;
  const usable = (starts: Start[]) => starts.filter((s) => s.index >= titlePageEnd);
  const none = (): DetectionResult => ({ chapters: single(blocks, titlePageEnd), strategy: 'none', bookTitle });
  const result = (starts: Start[], used: DetectionResult['strategy']): DetectionResult =>
    starts.length ? { chapters: assemble(blocks, starts), strategy: used, bookTitle } : none();

  const headings = usable(byHeadings.starts);
  if (strategy === 'none') return none();
  if (strategy === 'headings') return result(headings, 'headings');
  if (strategy === 'patterns') return result(usable(patternStarts(blocks)), 'patterns');
  if (strategy === 'pagebreaks') return result(usable(pageBreakStarts(blocks)), 'pagebreaks');

  const patterns = usable(patternStarts(blocks));
  const patternOnly = patterns.filter((s) => blocks[s.index].type !== 'heading').length;
  if (headings.length >= 2 && headings.length >= patternOnly / 2) return result(headings, 'headings');
  if (patterns.length >= 2) return result(patterns, 'patterns');
  const pages = usable(pageBreakStarts(blocks));
  if (pages.length >= 2) {
    const words = blocks.reduce((n, b) => n + countWords(textOf(b)), 0);
    // Page breaks only mean chapters when the pieces are chapter-sized.
    if (words / pages.length >= 250) return result(pages, 'pagebreaks');
  }
  if (headings.length === 1) return result(headings, 'headings');
  if (patterns.length === 1) return result(patterns, 'patterns');
  return none();
}

/** Starts a new chapter at `blockIndex` of chapter `chapterIndex`. */
export function splitChapterAt(chapters: ChapterDraft[], chapterIndex: number, blockIndex: number): ChapterDraft[] {
  const chapter = chapters[chapterIndex];
  if (!chapter || blockIndex <= 0 || blockIndex >= chapter.blocks.length) return chapters;
  const first = chapter.blocks[blockIndex];
  const usesFirstAsTitle = first.type === 'heading' || looksLikeTitleLine(first) || isPatternStart(first);
  const title = usesFirstAsTitle ? cleanTitle(textOf(first)) : 'New chapter';
  const before: ChapterDraft = { title: chapter.title, blocks: trimBreaks(chapter.blocks.slice(0, blockIndex)) };
  const after: ChapterDraft = { title, blocks: trimBreaks(chapter.blocks.slice(blockIndex + (usesFirstAsTitle ? 1 : 0))) };
  return [...chapters.slice(0, chapterIndex), before, after, ...chapters.slice(chapterIndex + 1)];
}

const GENERIC_TITLE = /^(?:new chapter|full text|front matter|title page|chapter \d+)$/i;

/** Joins a chapter onto the one before it. The joined chapter's title is kept as a heading so no text is lost. */
export function mergeChapterIntoPrevious(chapters: ChapterDraft[], index: number): ChapterDraft[] {
  if (index <= 0 || index >= chapters.length) return chapters;
  const prev = chapters[index - 1];
  const cur = chapters[index];
  const joined: Block[] = [...prev.blocks];
  if (cur.title && !GENERIC_TITLE.test(cur.title)) joined.push({ type: 'heading', level: 2, runs: [{ text: cur.title }] });
  joined.push(...cur.blocks);
  return [...chapters.slice(0, index - 1), { title: prev.title, blocks: joined }, ...chapters.slice(index + 1)];
}
