export type Severity = 'high' | 'medium' | 'low';

export type IssueCategory =
  // Language-level checks (no AI needed).
  | 'repetition' | 'long-sentence' | 'filler' | 'adverbs' | 'passive' | 'cliche' | 'doubled-word' | 'spacing' | 'punctuation'
  | 'sentence-starts' | 'exclamation' | 'tense-slip'
  // Children's books.
  | 'hard-word' | 'length-fit' | 'read-aloud' | 'age-fit'
  // Found by the AI reading the text.
  | 'continuity' | 'plot-hole' | 'pov-slip' | 'show-tell' | 'weak-opening' | 'weak-ending' | 'pacing' | 'character' | 'clarity'
  | 'needs-evidence' | 'missing-example' | 'chapter-repetition' | 'structure' | 'gap';

export type IssueGroup = 'language' | 'story' | 'argument' | 'children';

export const CATEGORY_INFO: Record<IssueCategory, { label: string; group: IssueGroup }> = {
  repetition: { label: 'Repeated word', group: 'language' },
  'long-sentence': { label: 'Long sentence', group: 'language' },
  filler: { label: 'Filler words', group: 'language' },
  adverbs: { label: 'Adverb overuse', group: 'language' },
  passive: { label: 'Passive voice', group: 'language' },
  cliche: { label: 'Cliché', group: 'language' },
  'doubled-word': { label: 'Doubled word', group: 'language' },
  spacing: { label: 'Spacing', group: 'language' },
  punctuation: { label: 'Punctuation', group: 'language' },
  'sentence-starts': { label: 'Repeated sentence opening', group: 'language' },
  exclamation: { label: 'Exclamation marks', group: 'language' },
  'tense-slip': { label: 'Possible tense slip', group: 'language' },
  'hard-word': { label: 'Hard word for the age group', group: 'children' },
  'length-fit': { label: 'Length for the format', group: 'children' },
  'read-aloud': { label: 'Read-aloud flow', group: 'children' },
  'age-fit': { label: 'Fit for the age group', group: 'children' },
  continuity: { label: 'Continuity error', group: 'story' },
  'plot-hole': { label: 'Plot hole', group: 'story' },
  'pov-slip': { label: 'Point-of-view slip', group: 'story' },
  'show-tell': { label: 'Telling instead of showing', group: 'story' },
  'weak-opening': { label: 'Weak opening', group: 'story' },
  'weak-ending': { label: 'Weak ending', group: 'story' },
  pacing: { label: 'Pacing', group: 'story' },
  character: { label: 'Character', group: 'story' },
  clarity: { label: 'Unclear passage', group: 'story' },
  'needs-evidence': { label: 'Claim needs support', group: 'argument' },
  'missing-example': { label: 'Missing example', group: 'argument' },
  'chapter-repetition': { label: 'Repeats an earlier chapter', group: 'argument' },
  structure: { label: 'Structure', group: 'argument' },
  gap: { label: 'Gap', group: 'argument' },
};

export const SEVERITY_LABELS: Record<Severity, string> = { high: 'Important', medium: 'Worth fixing', low: 'Minor' };

export interface Issue {
  category: IssueCategory;
  severity: Severity;
  chapterId: string | null;
  /** Paragraph the issue is in, when it can be pinned to one. */
  blockIndex: number | null;
  /** The exact words concerned, used to jump to and highlight the passage. */
  quote: string;
  title: string;
  detail: string;
  suggestion: string;
  /** "check" is a rule that needs no AI, "ai" came from the model reading the text. */
  source: 'check' | 'ai';
}

export interface ChapterStats {
  chapterId: string;
  title: string;
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceWords: number;
  /** Share of words that are inside dialogue, 0 to 1. */
  dialogueShare: number;
  /** Flesch reading ease, English only. Higher is easier. */
  readingEase: number | null;
  /** Flesch-Kincaid school grade, English only. */
  grade: number | null;
  /** LIX readability, meaningful in any language. Lower is easier. */
  lix: number;
  /** An estimate of pace from sentence length, paragraph length and dialogue. 0 slow, 100 fast. */
  pace: number;
}

export interface Frequency {
  text: string;
  count: number;
}

export interface VoiceNumbers {
  avgSentenceWords: number;
  /** Shares of short (up to 8 words), medium and long (over 25 words) sentences. */
  shortShare: number;
  longShare: number;
  avgWordLength: number;
  /** Distinct words per 1,000 running words (moving average), a measure of vocabulary range. */
  vocabularyRange: number;
  dialogueShare: number;
  /** Contractions per 1,000 words (English). */
  contractions: number | null;
  avgParagraphWords: number;
  /** Words the author uses notably often. */
  favouriteWords: string[];
}

export interface ChildrensFit {
  /** Estimated reading age in years, from the school grade. English only. */
  readingAge: number | null;
  /** The format whose usual length is closest. */
  format: string;
  /** Usual word range of that format. */
  range: [number, number];
  fits: boolean;
  /** Share of sentence or line endings that rhyme with a neighbour, 0 to 1. English only. */
  rhymeShare: number | null;
  /** Lines that come back three or more times: refrains, which young listeners enjoy. */
  refrains: Frequency[];
}

export interface BookStats {
  language: string;
  words: number;
  sentences: number;
  paragraphs: number;
  avgSentenceWords: number;
  dialogueShare: number;
  readingEase: number | null;
  grade: number | null;
  lix: number;
  /** Which checks ran. Word-list checks are English only. */
  englishChecks: boolean;
  narration: { person: 'first' | 'third' | 'unclear'; tense: 'past' | 'present' | 'unclear' } | null;
  perThousand: { adverbs: number | null; passive: number | null; fillers: number | null; exclamations: number };
  topWords: Frequency[];
  repeatedPhrases: Frequency[];
  voice: VoiceNumbers;
  childrens: ChildrensFit | null;
  chapters: ChapterStats[];
}

export function readingEaseLabel(score: number): string {
  if (score >= 90) return 'Very easy';
  if (score >= 80) return 'Easy';
  if (score >= 70) return 'Fairly easy';
  if (score >= 60) return 'Plain';
  if (score >= 50) return 'Fairly difficult';
  if (score >= 30) return 'Difficult';
  return 'Very difficult';
}

export function lixLabel(lix: number): string {
  if (lix < 25) return 'Very easy';
  if (lix < 35) return 'Easy';
  if (lix < 45) return 'Medium';
  if (lix < 55) return 'Difficult';
  return 'Very difficult';
}
