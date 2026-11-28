import { countWords } from '../text/words';
import { chapterParagraphs, commonWords, contentChapters, countAdverbs, findFillers, findPassives, type AnalysisInput } from './stats';
import { countSyllables, splitDialogue, splitSentences, wordsOf } from './text';
import type { BookStats, Issue, IssueCategory, Severity } from './types';
import { CLICHES, PAST_MARKERS, PRESENT_MARKERS } from './wordlists';

/** No single kind of finding may bury the others: each is capped, keeping the strongest. */
const CAP_PER_CATEGORY = 150;

const CLICHE_PATTERN = new RegExp(`\\b(?:${CLICHES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')})\\b`, 'gi');
const LEGIT_DOUBLES = new Set(['had', 'that', 'is', 'very', 'no', 'so', 'bye', 'ha', 'ho', 'now', 'there', 'her', 'tut', 'night', 'knock', 'well', 'yes', 'please', 'never', 'far', 'long']);

function snippet(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trimEnd() + '…';
}

/**
 * The language checks that need no AI: habits a careful copy editor looks
 * for. Each finding points at the exact paragraph and words. Findings are
 * prompts for a human to look, not verdicts, and the wording says so.
 */
export function findIssues(input: AnalysisInput, stats: BookStats): Issue[] {
  const english = input.language === 'en';
  const children = input.bookType === 'children';
  const chapters = contentChapters(input.chapters);
  const common = commonWords(chapters.flatMap((c) => chapterParagraphs(c).flatMap((p) => wordsOf(p.text))));
  const found: (Issue & { weight: number })[] = [];
  const add = (category: IssueCategory, severity: Severity, chapterId: string, blockIndex: number | null, quote: string, title: string, detail: string, suggestion: string, weight = 1) =>
    found.push({ category, severity, chapterId, blockIndex, quote: snippet(quote, 200), title, detail, suggestion, source: 'check', weight });

  const longLimit = children ? (stats.words <= 1200 ? 18 : 25) : 45;
  const dominantTense = stats.narration?.tense;

  for (const chapter of chapters) {
    const paragraphs = chapterParagraphs(chapter);
    let doubleSpaces = 0;
    let firstSpacing: { index: number; quote: string } | null = null;
    let exclamations = 0;
    let chapterWords = 0;

    for (const { index, text } of paragraphs) {
      const words = wordsOf(text);
      chapterWords += words.length;
      const sentences = splitSentences(text);

      // Sentences too long to follow comfortably.
      for (const sentence of sentences) {
        const length = wordsOf(sentence).length;
        if (length > longLimit) {
          add('long-sentence', length > longLimit * 1.5 ? 'medium' : 'low', chapter.id, index, sentence, `A ${length}-word sentence`,
            children ? `For young readers this sentence is long (${length} words).` : `This sentence runs to ${length} words, which is hard to follow in one breath.`,
            'Consider splitting it in two.', length);
        }
      }

      // The same word again and again within a short stretch.
      const lower = words.map((w) => w.toLowerCase());
      const seen = new Map<string, number[]>();
      lower.forEach((w, position) => {
        if (w.length < 5 || common.has(w) || /^\p{Lu}/u.test(words[position])) return;
        const list = seen.get(w) ?? [];
        list.push(position);
        seen.set(w, list);
      });
      for (const [word, positions] of seen) {
        for (let i = 0; i + 2 < positions.length; i++) {
          if (positions[i + 2] - positions[i] <= 60) {
            add('repetition', 'low', chapter.id, index, word, `"${word}" used ${positions.length} times close together`,
              `The word "${word}" appears ${positions.length} times in this paragraph.`, 'Vary the wording, or cut a use, unless the repetition is deliberate.', positions.length);
            break;
          }
        }
      }

      // Three or more sentences in a row that start the same way.
      const starts = sentences.map((s) => (wordsOf(s)[0] ?? '').toLowerCase());
      for (let i = 0; i + 2 < starts.length; i++) {
        if (starts[i] && starts[i] === starts[i + 1] && starts[i] === starts[i + 2]) {
          let run = 3;
          while (starts[i + run] === starts[i]) run++;
          add('sentence-starts', 'low', chapter.id, index, sentences[i], `${run} sentences in a row start with "${wordsOf(sentences[i])[0]}"`,
            'Several sentences in a row open with the same word, which can read as monotonous.', 'Vary how some of these sentences begin, unless the rhythm is intended.', run);
          break;
        }
      }

      // A word typed twice.
      for (const m of text.matchAll(/\b([\p{L}]{2,})\s+\1\b/giu)) {
        if (!LEGIT_DOUBLES.has(m[1].toLowerCase())) {
          add('doubled-word', 'medium', chapter.id, index, m[0], `"${m[1]}" is typed twice`, 'The same word appears twice in a row.', 'Delete one of them.', 5);
        }
      }

      // Spacing slips are counted here and reported once per chapter.
      const spacing = text.match(/ {2,}| [,.;:!?](?!\.)/g);
      if (spacing) {
        doubleSpaces += spacing.length;
        const at = text.search(/ {2,}| [,.;:!?](?!\.)/);
        firstSpacing ??= { index, quote: text.slice(Math.max(0, at - 20), at + 20) };
      }

      // Quotation marks that open and never close.
      const straight = (text.match(/"/g) ?? []).length;
      const open = (text.match(/“/g) ?? []).length;
      const close = (text.match(/”/g) ?? []).length;
      if (straight % 2 === 1 || open > close + 1 || close > open) {
        add('punctuation', 'low', chapter.id, index, text, 'Quotation marks do not pair up',
          'This paragraph has an opening or closing quotation mark without its partner. (Speech that continues into the next paragraph legitimately has no closing mark.)',
          'Check the quotation marks.', 2);
      }
      if (/[!?]{3,}|!!/.test(text)) {
        add('punctuation', 'low', chapter.id, index, /\S*(?:[!?]{3,}|!!)/.exec(text)![0], 'Stacked punctuation', 'Several exclamation or question marks in a row.', 'One is usually enough.', 1);
      }
      exclamations += (splitDialogue(text).narration.match(/!/g) ?? []).length;

      if (english) {
        for (const m of text.matchAll(CLICHE_PATTERN)) {
          add('cliche', 'low', chapter.id, index, m[0], `Cliché: "${m[0].toLowerCase()}"`, 'A stock phrase readers have met many times.', 'Consider a fresher way to say it.', 3);
        }
        const fillers = findFillers(text);
        if (fillers.length >= 4 && fillers.length / Math.max(words.length, 1) > 0.04) {
          add('filler', 'low', chapter.id, index, fillers[0], `${fillers.length} filler words in one paragraph`,
            `Words that add little: ${[...new Set(fillers.map((f) => f.toLowerCase()))].slice(0, 6).join(', ')}.`, 'Cut the ones that are not doing any work.', fillers.length);
        }
        for (const sentence of sentences) {
          const adverbs = countAdverbs(sentence);
          if (adverbs >= 3) {
            add('adverbs', 'low', chapter.id, index, sentence, `${adverbs} "-ly" adverbs in one sentence`, 'A cluster of adverbs often props up weak verbs.', 'Try stronger verbs and drop some adverbs.', adverbs);
          }
        }
        const passives = findPassives(text);
        if (passives.length >= 3 && passives.length / Math.max(sentences.length, 1) >= 0.5) {
          add('passive', 'low', chapter.id, index, passives[0], `${passives.length} passive constructions in one paragraph`,
            `For example: ${passives.slice(0, 3).join('; ')}.`, 'Consider saying who does what, where that is clearer.', passives.length);
        }
        if (dominantTense && dominantTense !== 'unclear') {
          const narration = splitDialogue(text).narration;
          if (countWords(narration) >= 25) {
            const past = (narration.match(PAST_MARKERS) ?? []).length;
            const present = (narration.match(PRESENT_MARKERS) ?? []).length;
            const off = dominantTense === 'past' ? present >= 4 && past === 0 : past >= 4 && present === 0;
            if (off) {
              add('tense-slip', 'low', chapter.id, index, narration, `Narration in the ${dominantTense === 'past' ? 'present' : 'past'} tense`,
                `The book is narrated mainly in the ${dominantTense} tense, but this paragraph reads as ${dominantTense === 'past' ? 'present' : 'past'} tense. This may be deliberate (a letter, a flashback, a general truth).`,
                'Check that the change of tense is intended.', 2);
            }
          }
        }
        if (children) {
          const hard = [...new Set(words.filter((w) => w.length >= 9 && countSyllables(w) >= 4 && !/^\p{Lu}/u.test(w)).map((w) => w.toLowerCase()))];
          if (hard.length && stats.words <= 3500) {
            add('hard-word', 'low', chapter.id, index, hard[0], `Long word${hard.length > 1 ? 's' : ''}: ${hard.slice(0, 4).join(', ')}`,
              'Words of four or more syllables can stop a young reader.', 'Keep it if it is the fun kind of big word. Otherwise choose a simpler one.', hard.length);
          }
        }
      }
    }

    if (firstSpacing && doubleSpaces) {
      add('spacing', 'low', chapter.id, firstSpacing.index, firstSpacing.quote.trim(), `${doubleSpaces} spacing slip${doubleSpaces === 1 ? '' : 's'} in this chapter`,
        'Double spaces, or a space before a comma or full stop.', 'A proofread will tidy these up.', doubleSpaces);
    }
    if (!children && chapterWords >= 300 && (exclamations / chapterWords) * 1000 > 6) {
      add('exclamation', 'low', chapter.id, null, '', `${exclamations} exclamation marks in the narration`,
        'Exclamation marks outside dialogue lose their force when there are many.', 'Keep the few that matter.', exclamations);
    }
  }

  if (children && stats.childrens) {
    const c = stats.childrens;
    const first = chapters[0];
    if (!c.fits && first) {
      add('length-fit', 'medium', first.id, null, '', `${stats.words.toLocaleString('en-US')} words is unusual for any children's format`,
        `The closest format is a ${c.format.toLowerCase()}, which usually runs from ${c.range[0].toLocaleString('en-US')} to ${c.range[1].toLocaleString('en-US')} words.`,
        'Decide which format the book is, then trim or extend it to suit.', 10);
    }
    if (c.readingAge !== null && stats.words <= 1200 && c.readingAge > 9 && first) {
      add('age-fit', 'medium', first.id, null, '', `The language reads at about age ${c.readingAge}`,
        'For a book of picture-book length, the sentences and words are advanced. Picture books are read aloud by adults, so this can be fine, but it is worth a look.',
        'Shorten the longest sentences and replace the hardest words.', 8);
    }
  }

  // Keep the strongest findings of each kind.
  const byCategory = new Map<IssueCategory, typeof found>();
  for (const issue of found) {
    const list = byCategory.get(issue.category) ?? [];
    list.push(issue);
    byCategory.set(issue.category, list);
  }
  const kept: Issue[] = [];
  for (const list of byCategory.values()) {
    const top = list.length > CAP_PER_CATEGORY ? [...list].sort((a, b) => b.weight - a.weight).slice(0, CAP_PER_CATEGORY) : list;
    for (const { weight: _weight, ...issue } of top) kept.push(issue);
  }
  // Present them in reading order.
  const chapterOrder = new Map(chapters.map((c, i) => [c.id, i]));
  return kept.sort((a, b) => (chapterOrder.get(a.chapterId ?? '') ?? 0) - (chapterOrder.get(b.chapterId ?? '') ?? 0) || (a.blockIndex ?? -1) - (b.blockIndex ?? -1));
}
