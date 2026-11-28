import { blockText, type Block } from '../model/blocks';
import { CHILDRENS_FORMATS, CONTRACTION, FILLERS, NOT_ADVERBS, NOT_PASSIVE, PASSIVE, PAST_MARKERS, PRESENT_MARKERS } from './wordlists';
import { countSyllables, dialogueShare, readability, round, splitDialogue, splitSentences, wordsOf } from './text';
import type { BookStats, ChapterStats, ChildrensFit, Frequency, VoiceNumbers } from './types';

export interface AnalysisChapter {
  id: string;
  title: string;
  blocks: Block[];
}

export interface AnalysisInput {
  language: string;
  bookType: 'fiction' | 'nonfiction' | 'children';
  chapters: AnalysisChapter[];
}

const APP_TITLES = /^(?:title page|front matter)$/i;

/** Chapters that hold the book's own text. A title page says nothing about the writing. */
export function contentChapters(chapters: AnalysisChapter[]): AnalysisChapter[] {
  const content = chapters.filter((c) => !APP_TITLES.test(c.title.trim()));
  return content.length ? content : chapters;
}

/** The paragraphs of a chapter as plain text, with the index of the block each came from. */
export function chapterParagraphs(chapter: AnalysisChapter): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  chapter.blocks.forEach((block, index) => {
    if (block.type === 'break' || block.type === 'heading') return;
    const text = blockText(block).trim();
    if (text) out.push({ index, text });
  });
  return out;
}

function count(pattern: RegExp, text: string): number {
  return text.match(pattern)?.length ?? 0;
}

export function countAdverbs(text: string): number {
  return (text.toLowerCase().match(/\b[a-z]{3,}ly\b/g) ?? []).filter((w) => !NOT_ADVERBS.has(w)).length;
}

export function findPassives(text: string): string[] {
  return (text.match(PASSIVE) ?? []).filter((m) => !NOT_PASSIVE.has(m.toLowerCase().split(/\s+/).pop()!));
}

const FILLER_PATTERN = new RegExp(`\\b(?:${FILLERS.map((f) => f.replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');

export function findFillers(text: string): string[] {
  return text.match(FILLER_PATTERN) ?? [];
}

/** The most common words of the book itself: its function words and the names it is about. */
export function commonWords(allWords: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const w of allWords) {
    const key = w.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // "Common" means common in this book: at least five uses and at least two in every thousand words.
  const threshold = Math.max(5, allWords.length * 0.002);
  return new Set([...counts.entries()].filter(([, n]) => n >= threshold).sort((a, b) => b[1] - a[1]).slice(0, 90).map(([w]) => w));
}

function paceOf(avgSentence: number, avgParagraph: number, dialogue: number): number {
  // Short sentences, short paragraphs and dialogue all make a passage read faster.
  const sentence = Math.max(0, Math.min(1, (26 - avgSentence) / 18));
  const paragraph = Math.max(0, Math.min(1, (130 - avgParagraph) / 110));
  return Math.round((sentence * 0.45 + paragraph * 0.25 + Math.min(1, dialogue / 0.6) * 0.3) * 100);
}

function vocabularyRange(words: string[]): number {
  // Distinct words in each stretch of 1,000 words, averaged. Unlike a plain
  // ratio, this does not shrink just because a book is long.
  const window = 1000;
  if (words.length < window) return words.length ? Math.round((new Set(words.map((w) => w.toLowerCase())).size / words.length) * 1000) : 0;
  let total = 0;
  let windows = 0;
  for (let start = 0; start + window <= words.length; start += window) {
    total += new Set(words.slice(start, start + window).map((w) => w.toLowerCase())).size;
    windows++;
  }
  return Math.round(total / windows);
}

function repeatedPhrases(sentences: string[], common: Set<string>): Frequency[] {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const words = wordsOf(sentence.toLowerCase());
    for (let n = 4; n <= 5; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        // A phrase made mostly of the commonest words ("it was one of the") is not a habit worth reporting.
        if (gram.filter((w) => !common.has(w) && w.length > 3).length < 2) continue;
        const key = gram.join(' ');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const frequent = [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  // Drop a shorter phrase that is only ever part of a longer one already listed.
  const kept: Frequency[] = [];
  for (const [text, n] of frequent) {
    if (kept.some((k) => k.text.includes(text) && k.count >= n)) continue;
    kept.push({ text, count: n });
    if (kept.length >= 15) break;
  }
  return kept;
}

function rhymeShare(lines: string[]): number | null {
  const endings = lines
    .map((line) => wordsOf(line.toLowerCase()).pop() ?? '')
    .filter((w) => w.length >= 2)
    .map((w) => {
      const m = /[aeiouy]+[^aeiouy]*e?$/.exec(w);
      return m ? m[0] : w.slice(-2);
    });
  if (endings.length < 6) return null;
  let rhymed = 0;
  for (let i = 0; i < endings.length; i++) {
    const near = [endings[i - 1], endings[i + 1], endings[i - 2], endings[i + 2]];
    if (near.includes(endings[i])) rhymed++;
  }
  return round(rhymed / endings.length, 2);
}

function childrensFit(words: number, grade: number | null, sentences: string[], english: boolean): ChildrensFit {
  const centre = (r: [number, number]) => Math.sqrt(Math.max(r[0], 50) * r[1]);
  const format = CHILDRENS_FORMATS.find((f) => words >= f.range[0] && words <= f.range[1]) ?? [...CHILDRENS_FORMATS].sort((a, b) => Math.abs(Math.log(words / centre(a.range))) - Math.abs(Math.log(words / centre(b.range))))[0];
  const lines = new Map<string, number>();
  for (const s of sentences) {
    const key = s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
    if (key.split(' ').length >= 2) lines.set(key, (lines.get(key) ?? 0) + 1);
  }
  const refrains = [...lines.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([text, n]) => ({ text, count: n }));
  return {
    readingAge: grade === null ? null : round(Math.max(4, grade + 5), 0),
    format: format.name,
    range: format.range,
    fits: words >= format.range[0] && words <= format.range[1],
    rhymeShare: english ? rhymeShare(sentences) : null,
    refrains,
  };
}

/**
 * Measures a book: length, sentence shape, dialogue, readability and habits
 * of language. Everything here is computed on this computer without any AI,
 * in well under a second even for a long novel.
 */
export function computeStats(input: AnalysisInput): BookStats {
  const english = input.language === 'en';
  const chapters = contentChapters(input.chapters);
  const allWords: string[] = [];
  const allSentences: string[] = [];
  const allParagraphs: string[] = [];
  let narration = '';
  const perChapter: ChapterStats[] = [];

  for (const chapter of chapters) {
    const paragraphs = chapterParagraphs(chapter).map((p) => p.text);
    const sentences = paragraphs.flatMap(splitSentences);
    const words = paragraphs.flatMap(wordsOf);
    const share = dialogueShare(paragraphs);
    const r = readability(words, sentences.length, english);
    const avgSentence = sentences.length ? words.length / sentences.length : 0;
    perChapter.push({
      chapterId: chapter.id,
      title: chapter.title,
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      avgSentenceWords: round(avgSentence),
      dialogueShare: round(share, 3),
      readingEase: r.readingEase,
      grade: r.grade,
      lix: r.lix,
      pace: paceOf(avgSentence, paragraphs.length ? words.length / paragraphs.length : 0, share),
    });
    allWords.push(...words);
    allSentences.push(...sentences);
    allParagraphs.push(...paragraphs);
    for (const p of paragraphs) narration += splitDialogue(p).narration + '\n';
  }

  const n = allWords.length;
  const per1000 = (value: number) => (n ? round((value / n) * 1000) : 0);
  const overall = readability(allWords, allSentences.length, english);
  const common = commonWords(allWords);
  const text = allParagraphs.join('\n');

  // Words the author leans on: frequent content words, relative to the length of the book.
  const contentCounts = new Map<string, number>();
  for (const w of allWords) {
    const key = w.toLowerCase();
    if (key.length < 5 || /^\p{Lu}/u.test(w)) continue;
    contentCounts.set(key, (contentCounts.get(key) ?? 0) + 1);
  }
  const topWords = [...contentCounts.entries()]
    .filter(([w, c]) => c >= 4 && !common.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, c]) => ({ text: word, count: c }));

  const sentenceLengths = allSentences.map((s) => wordsOf(s).length);
  const voice: VoiceNumbers = {
    avgSentenceWords: allSentences.length ? round(n / allSentences.length) : 0,
    shortShare: sentenceLengths.length ? round(sentenceLengths.filter((l) => l <= 8).length / sentenceLengths.length, 2) : 0,
    longShare: sentenceLengths.length ? round(sentenceLengths.filter((l) => l > 25).length / sentenceLengths.length, 2) : 0,
    avgWordLength: n ? round(allWords.reduce((sum, w) => sum + w.length, 0) / n, 2) : 0,
    vocabularyRange: vocabularyRange(allWords),
    dialogueShare: round(dialogueShare(allParagraphs), 3),
    contractions: english ? per1000(count(CONTRACTION, text)) : null,
    avgParagraphWords: allParagraphs.length ? round(n / allParagraphs.length) : 0,
    favouriteWords: topWords.slice(0, 10).map((w) => w.text),
  };

  let narrationInfo: BookStats['narration'] = null;
  if (english && n >= 150) {
    const narrationWords = wordsOf(narration).length || 1;
    const first = count(/\b(?:I|my|me|myself|we|our)\b/g, narration) / narrationWords;
    const past = count(PAST_MARKERS, narration);
    const present = count(PRESENT_MARKERS, narration);
    narrationInfo = {
      person: first > 0.02 ? 'first' : first < 0.006 ? 'third' : 'unclear',
      tense: past > present * 2 ? 'past' : present > past * 2 ? 'present' : 'unclear',
    };
  }

  return {
    language: input.language,
    words: n,
    sentences: allSentences.length,
    paragraphs: allParagraphs.length,
    avgSentenceWords: voice.avgSentenceWords,
    dialogueShare: voice.dialogueShare,
    readingEase: overall.readingEase,
    grade: overall.grade,
    lix: overall.lix,
    englishChecks: english,
    narration: narrationInfo,
    perThousand: {
      adverbs: english ? per1000(countAdverbs(text)) : null,
      passive: english ? per1000(findPassives(text).length) : null,
      fillers: english ? per1000(findFillers(text).length) : null,
      exclamations: per1000(count(/!/g, text)),
    },
    topWords,
    repeatedPhrases: repeatedPhrases(allSentences, common),
    voice,
    childrens: input.bookType === 'children' ? childrensFit(n, overall.grade, allSentences, english) : null,
    chapters: perChapter,
  };
}

export { countSyllables };
