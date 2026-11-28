import { describe, expect, it } from 'vitest';
import { findIssues } from '../../src/core/analysis/rules';
import { computeStats, type AnalysisInput } from '../../src/core/analysis/stats';
import { countSyllables, locateQuote, readability, splitDialogue, wordsOf } from '../../src/core/analysis/text';
import { detectChapters } from '../../src/core/import';
import { paragraph, type Block } from '../../src/core/model/blocks';
import { importFixture } from './helpers';

async function fixtureInput(name: string, bookType: AnalysisInput['bookType'] = 'fiction'): Promise<AnalysisInput> {
  const result = await importFixture(name);
  const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
  return { language: result.meta.language ?? 'en', bookType, chapters: chapters.map((c, i) => ({ id: `c${i}`, title: c.title, blocks: c.blocks })) };
}

const book = (blocks: Block[], extra: Partial<AnalysisInput> = {}): AnalysisInput => ({ language: 'en', bookType: 'fiction', chapters: [{ id: 'c1', title: 'One', blocks }], ...extra });

describe('text helpers', () => {
  it('counts English syllables closely enough for readability scores', () => {
    const expected: Record<string, number> = { cat: 1, table: 2, beautiful: 3, the: 1, lighthouse: 2, grandfather: 3, demolished: 3, quiet: 2, telescope: 3, breathe: 1, idea: 3 };
    let off = 0;
    for (const [word, n] of Object.entries(expected)) off += Math.abs(countSyllables(word) - n);
    expect(off).toBeLessThanOrEqual(2);
  });

  it('separates dialogue from narration in English and in dash-style languages', () => {
    expect(splitDialogue('“You could sell it,” her brother said. “The land is worth something.”')).toEqual({
      dialogue: '“You could sell it,” “The land is worth something.”', narration: ' her brother said. ',
    });
    const spanish = splitDialogue('—No toques las rosas amarillas —me decía ella cada mañana—. Esas no son nuestras.');
    expect(spanish.dialogue).toContain('No toques las rosas amarillas');
    expect(spanish.dialogue).toContain('Esas no son nuestras.');
    expect(spanish.dialogue).not.toContain('decía');
    expect(spanish.narration).toBe('me decía ella cada mañana');
    expect(splitDialogue('Plain narration only.').dialogue).toBe('');
  });

  it('scores readability, with Flesch scores for English only', () => {
    const easy = readability(wordsOf('The cat sat on the mat. The dog ran to the cat. It was fun.'), 3, true);
    const hard = readability(wordsOf('Notwithstanding considerable institutional opposition, the administration implemented comprehensive organisational restructuring.'), 1, true);
    expect(easy.readingEase!).toBeGreaterThan(95);
    expect(easy.grade!).toBeLessThan(2);
    expect(hard.readingEase!).toBeLessThan(10);
    expect(hard.lix).toBeGreaterThan(easy.lix + 40);
    expect(readability(wordsOf('La casa era grande y tenía un jardín.'), 1, false)).toMatchObject({ readingEase: null, grade: null });
  });

  it('finds a quotation in the text despite different quote marks, and falls back to its opening words', () => {
    const paragraphs = ['First paragraph here.', 'She said, “It is not for sale, Tomas,” and looked away for a long moment.'];
    expect(locateQuote(paragraphs, '"It is not for sale, Tomas,"')?.index).toBe(1);
    expect(locateQuote(paragraphs, 'She said, “It is not for sale, Tomas,” and then something the model made up')?.index).toBe(1);
    expect(locateQuote(paragraphs, 'Nothing like this is in the book at all')).toBeNull();
  });
});

describe('book statistics', () => {
  it('measures a novel', async () => {
    const stats = computeStats(await fixtureInput('novel.docx'));
    // The title page is not counted as part of the writing.
    expect(stats.chapters.map((c) => c.title)).toEqual(['Prologue', 'Chapter One', 'Chapter Two', 'Chapter Three']);
    expect(stats.words).toBe(560);
    expect(stats.chapters.reduce((n, c) => n + c.words, 0)).toBe(stats.words);
    expect(stats.narration).toEqual({ person: 'third', tense: 'past' });
    expect(stats.readingEase!).toBeGreaterThan(60);
    expect(stats.grade!).toBeGreaterThan(4);
    expect(stats.grade!).toBeLessThan(11);
    // Chapter Two is mostly a conversation, the prologue has none.
    const share = Object.fromEntries(stats.chapters.map((c) => [c.title, c.dialogueShare]));
    expect(share['Prologue']).toBe(0);
    expect(share['Chapter Two']).toBeGreaterThan(0.3);
    expect(stats.chapters.find((c) => c.title === 'Chapter Two')!.pace).toBeGreaterThan(stats.chapters[0].pace);
    expect(stats.voice.avgSentenceWords).toBeGreaterThan(10);
    expect(stats.voice.vocabularyRange).toBeGreaterThan(300);
    expect(stats.childrens).toBeNull();
  });

  it('measures a book in another language without the English-only checks', async () => {
    const stats = computeStats(await fixtureInput('spanish.docx'));
    expect(stats).toMatchObject({ language: 'es', englishChecks: false, readingEase: null, grade: null, narration: null });
    expect(stats.perThousand).toMatchObject({ adverbs: null, passive: null, fillers: null });
    expect(stats.lix).toBeGreaterThan(20);
    expect(stats.dialogueShare).toBeGreaterThan(0.04);
    expect(stats.words).toBeGreaterThan(150);
  });

  it("assesses a picture book's length, reading age and refrains", async () => {
    const stats = computeStats(await fixtureInput('picturebook.docx', 'children'));
    expect(stats.childrens).toMatchObject({ format: 'Board book', fits: true });
    expect(stats.childrens!.readingAge!).toBeLessThanOrEqual(8);
    expect(stats.grade!).toBeLessThan(3);
    const refrain = computeStats(book(Array.from({ length: 4 }, () => [paragraph('Up went the cloud.'), paragraph('Pip took the cloud to the pond and the barn.')]).flat(), { bookType: 'children' }));
    expect(refrain.childrens!.refrains[0]).toEqual({ text: 'up went the cloud', count: 4 });
    const tooLong = computeStats(book([paragraph(Array.from({ length: 1800 }, (_, i) => `word${i % 50}`).join(' ') + '.')], { bookType: 'children' }));
    expect(tooLong.childrens).toMatchObject({ format: 'Early reader', fits: true });
  });

  it('reports habits of language', () => {
    const text = [
      'She really walked very slowly and quietly and carefully to the door, which was opened by the butler.',
      'At the end of the day the garden was watered by the gardener and the roses were cut by her mother.',
      ...Array.from({ length: 4 }, (_, i) => `On day ${i + 1} the tide came in again as it always did before the storm broke.`),
      'Gulls wheeled over the harbour wall while fishermen mended nets beside upturned boats.',
      'Lanterns flickered behind salt-crusted windows along the narrow cobbled street.',
      'Nobody remembered who first carved initials into the old stone bollard near the quay.',
    ];
    const stats = computeStats(book(text.map(paragraph)));
    expect(stats.perThousand.adverbs!).toBeGreaterThan(10);
    expect(stats.perThousand.passive!).toBeGreaterThan(10);
    expect(stats.perThousand.fillers!).toBeGreaterThan(5);
    expect(stats.repeatedPhrases.some((p) => p.text.includes('tide came in again'))).toBe(true);
  });
});

describe('language checks', () => {
  const issuesFor = (blocks: Block[], extra: Partial<AnalysisInput> = {}) => {
    const input = book(blocks, extra);
    return findIssues(input, computeStats(input));
  };

  it('finds no problems worth reporting in clean, well-edited prose', async () => {
    const input = await fixtureInput('novel.docx');
    const issues = findIssues(input, computeStats(input));
    expect(issues.filter((i) => i.severity !== 'low')).toEqual([]);
    expect(issues.length).toBeLessThanOrEqual(3);
  });

  it('pins each finding to its paragraph and words', () => {
    const filler = Array.from({ length: 30 }, (_, i) => paragraph(`The harbour was calm on morning number ${i} and nobody spoke about the letter.`));
    const issues = issuesFor([
      ...filler,
      paragraph('He looked at the the map and frowned.'),
      paragraph('The morning was grey. The gulls were loud. The boats were late. The men were silent.'),
      paragraph('It was crystal clear that time stood still.'),
      paragraph(`She ran ${Array.from({ length: 50 }, () => 'and ran').join(' ')} until the road ended at the sea.`),
      paragraph('The lantern swung, and the lantern creaked, and by the lantern she read the note once more beside the old lantern.'),
      paragraph('He said , "wait" and then  nothing.'),
      paragraph('"Come here!!" she cried. "Now'),
    ]);
    const by = (category: string) => issues.filter((i) => i.category === category);
    expect(by('doubled-word')[0]).toMatchObject({ blockIndex: 30, quote: 'the the', severity: 'medium' });
    expect(by('sentence-starts')[0]).toMatchObject({ blockIndex: 31, title: '4 sentences in a row start with "The"' });
    expect(by('cliche').map((i) => i.quote)).toEqual(['crystal clear', 'time stood still']);
    expect(by('long-sentence')[0]).toMatchObject({ blockIndex: 33, severity: 'medium' });
    expect(by('repetition').some((i) => i.quote === 'lantern' && i.blockIndex === 34)).toBe(true);
    expect(by('spacing')[0]).toMatchObject({ blockIndex: 35, title: '2 spacing slips in this chapter' });
    expect(by('punctuation').map((i) => i.title).sort()).toEqual(['Quotation marks do not pair up', 'Stacked punctuation']);
    expect(issues.every((i) => i.source === 'check' && i.chapterId === 'c1')).toBe(true);
    // Reported in reading order.
    expect(issues.map((i) => i.blockIndex ?? -1)).toEqual([...issues.map((i) => i.blockIndex ?? -1)].sort((a, b) => a - b));
  });

  it('flags a paragraph that leaves the tense of the narration', () => {
    const past = Array.from({ length: 12 }, (_, i) => paragraph(`She walked to the harbour on day ${i} and looked at the grey water while the men said nothing and the boats were still.`));
    const slip = paragraph('She walks to the edge and looks down at the water. The tide is high and the wind is cold, and she thinks about the letter as she stands there and feels the spray.');
    const issues = issuesFor([...past, slip, ...past.slice(0, 3)]);
    expect(issues.filter((i) => i.category === 'tense-slip').map((i) => i.blockIndex)).toEqual([12]);
  });

  it('does not run English word lists on other languages', async () => {
    const input = await fixtureInput('spanish.docx');
    const issues = findIssues(input, computeStats(input));
    expect(issues.filter((i) => ['cliche', 'filler', 'adverbs', 'passive', 'tense-slip'].includes(i.category))).toEqual([]);
  });

  it("holds children's books to shorter sentences and simpler words, and checks the length", () => {
    const issues = issuesFor(
      [
        paragraph('Pip the rabbit went to the pond and then to the barn and then to the top of the hill where the wind blew the little cloud away.'),
        paragraph('It was an extraordinarily unbelievable day.'),
      ],
      { bookType: 'children' },
    );
    expect(issues.find((i) => i.category === 'long-sentence')).toBeDefined();
    expect(issues.find((i) => i.category === 'hard-word')!.title).toContain('extraordinarily');
    const odd = issuesFor([paragraph(Array.from({ length: 17000 }, (_, i) => `w${i % 80}`).join(' ') + '.')], { bookType: 'children' });
    expect(odd.find((i) => i.category === 'length-fit')!.title).toContain('17,000 words');
  });

  it('keeps the number of findings manageable on a very repetitive text', () => {
    const blocks = Array.from({ length: 400 }, (_, i) => paragraph(`It was crystal clear on day ${i}.`));
    const issues = issuesFor(blocks);
    expect(issues.filter((i) => i.category === 'cliche')).toHaveLength(150);
  });
});
