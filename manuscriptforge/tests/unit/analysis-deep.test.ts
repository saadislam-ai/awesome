import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AiProvider, ChatRequest } from '../../src/core/ai/provider';
import { bibleBrief, bibleNames } from '../../src/core/analysis/bible';
import { buildSegmentRequest, parseJsonReply, segmentChapter } from '../../src/core/analysis/deep';
import { detectChapters } from '../../src/core/import';
import { paragraph } from '../../src/core/model/blocks';
import { AnalysisStore } from '../../src/data/analysis';
import { EditStore } from '../../src/data/edits';
import { Library } from '../../src/data/library';
import { JobRunner } from '../../src/data/runner';
import { MemoryFiles } from '../../src/platform/memory';
import { createSqlJsDb } from '../../src/platform/sqljs';
import type { Db } from '../../src/platform/types';
import { importFixture } from './helpers';

let db: Db;
let library: Library;
let analyses: AnalysisStore;
let bookId: string;

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = createSqlJsDb(new SQL.Database());
  library = new Library(db, new MemoryFiles());
  await library.init();
  analyses = new AnalysisStore(db, library);
  const result = await importFixture('novel.docx');
  const { chapters } = detectChapters(result.blocks, 'auto', result.meta);
  const book = await library.createBook({ category: 'mine', title: result.meta.title!, author: result.meta.author, language: 'en', chapters });
  bookId = book.id;
});

const NOTES: Record<number, object> = {
  1: {
    summary: 'A letter arrives at the dark lighthouse, addressed to a keeper who no longer exists.',
    characters: [{ name: 'Nobody', aliases: [], description: 'whoever carried the letter' }],
    relationships: [], settings: [{ name: 'Marrow Point', description: 'a village with a disused lighthouse' }],
    events: [{ when: 'eleven years after the lamp went dark', what: 'The first letter arrives.' }], terms: [],
    pov: 'third person, omniscient', tense: 'past', tension: 3, pace: 'slow',
    issues: [{ type: 'weak-opening', severity: 'high', quote: 'The lamp had not been lit for eleven years', problem: 'The opening withholds who is telling the story.', suggestion: 'Ground the reader sooner.' }],
  },
  2: {
    summary: 'Mara refuses to sell the lighthouse and finds a letter asking her to light the lamp on the ninth.',
    characters: [{ name: 'Mara', aliases: [], description: 'inherited the lighthouse key from her grandfather' }, { name: 'Tomas', aliases: [], description: "Mara's brother, who wants to sell" }],
    relationships: [{ a: 'Mara', b: 'Tomas', relation: 'sister and brother' }], settings: [], events: [{ when: '', what: 'Mara finds the letter with the drawing of a ship.' }],
    terms: [{ term: 'the Keeper', meaning: 'the title of whoever tends the lamp' }],
    pov: 'third person, Mara', tense: 'past', tension: 5, pace: 'steady',
    issues: [
      { type: 'weak-opening', severity: 'high', quote: 'She did not answer him.', problem: 'Reflex complaint about a line in the middle.', suggestion: 'x' },
      { type: 'show-tell', severity: 'high', quote: '“It is not for sale, Tomas.”', problem: 'The refusal is stated flatly.', suggestion: 'Let her action carry it.' },
      { type: 'continuity', severity: 'high', quote: 'words that are not in the book anywhere', problem: 'Made up.', suggestion: 'x' },
    ],
  },
  3: {
    summary: 'The harbour master says the ship in the drawing was lost in sixty-one. Mara buys lamp oil anyway.',
    characters: [{ name: 'Mara Ellison', aliases: ['Mara'], description: 'stubborn and quiet' }, { name: 'Agnes Thorne', aliases: ['Agnes'], description: 'the harbour master, never surprised' }],
    relationships: [], settings: [{ name: 'the harbour', description: 'where Agnes works' }], events: [{ when: 'winter of sixty-one', what: 'The Corriveau was lost with all hands.' }],
    terms: [{ term: 'Corriveau', meaning: "the grandfather's lost ship" }], pov: 'third person, Mara', tense: 'past', tension: 6, pace: 'steady', issues: [],
  },
  4: {
    summary: 'On the ninth the village gathers. Mara lights the lamp and a second light answers from the sea.',
    characters: [{ name: 'Mara', aliases: [], description: 'lights the lamp' }, { name: 'Tomas', aliases: [], description: 'brings tea and says nothing' }],
    relationships: [], settings: [], events: [{ when: 'the ninth', what: 'Mara lights the lamp. A second light answers.' }], terms: [],
    pov: 'third person, Mara', tense: 'past', tension: 9, pace: 'fast',
    issues: [{ type: 'weak-ending', severity: 'medium', quote: 'a second light answered', problem: 'The ending stops on the reveal.', suggestion: 'Consider one more beat.' }],
  },
};

const SYNTHESIS = {
  summary: 'A woman inherits a dark lighthouse and is asked by an unsigned letter to light it for a ship lost decades ago.',
  structure: { parts: [{ name: 'Setup', chapters: '1-2', summary: 'The letter and the refusal to sell.' }, { name: 'Answer', chapters: '3-4', summary: 'The lamp is lit.' }], assessment: 'A clean three-movement shape.' },
  themes: ['inheritance', 'faith'], tone: 'quiet, uncanny', audience: 'adult readers of literary mystery',
  arcs: [{ name: 'Mara', arc: 'From avoiding her inheritance to accepting it.', strength: 7 }],
  ratings: [
    { aspect: 'ending', score: 8, reason: 'Lands well.' }, { aspect: 'structure', score: 7, reason: 'Clear.' }, { aspect: 'characters', score: 6, reason: 'Tomas is thin.' },
    { aspect: 'pacing', score: 7, reason: 'Steady build.' }, { aspect: 'prose', score: 8, reason: 'Controlled.' }, { aspect: 'opening', score: 14, reason: 'Strong hook.' },
  ],
  strengths: ['Restraint'], priorities: [{ title: 'Deepen Tomas', detail: 'Give him a reason to want the sale.' }],
  voice: { description: 'Plain, measured sentences with one precise image per paragraph.', dialogueStyle: 'Short, dry exchanges.', devices: ['lists of three'] },
  bookIssues: [{ type: 'character', severity: 'medium', chapter: 2, problem: 'Tomas has no motive.', suggestion: 'Add one.' }, { type: 'plot-hole', severity: 'high', chapter: 0, problem: 'Who sent the letter is never hinted.', suggestion: 'Plant a clue.' }],
};

function analyst(overrides: { failSynthesis?: boolean; onCall?: (kind: 'segment' | 'synthesis' | 'other') => void | Promise<void> } = {}): AiProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    kind: 'custom', label: 'analyst', requests,
    async chat(request, options) {
      requests.push(request);
      const user = request.messages[request.messages.length - 1].content;
      const chapter = /\nChapter (\d+): [^\n]*\nPassage:/.exec(user);
      const kind = user.includes('Chapter notes (with') ? 'synthesis' : chapter ? 'segment' : 'other';
      await overrides.onCall?.(kind);
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (kind === 'synthesis') return { text: overrides.failSynthesis ? 'I would rather not.' : '```json\n' + JSON.stringify(SYNTHESIS) + '\n```', completionTokens: 300 };
      if (kind === 'segment') return { text: JSON.stringify(NOTES[Number(chapter![1])]), completionTokens: 120 };
      // An editing request: return the text unchanged.
      return { text: [...user.matchAll(/<p id="(\d+)">([\s\S]*?)<\/p>/g)].map(([, id, t]) => `<p id="${id}">${t}</p>`).join('\n'), completionTokens: 50 };
    },
  };
}

async function runDeep(provider: AiProvider) {
  await analyses.start(bookId, { deep: true, model: provider.label });
  const runner = new JobRunner(analyses, () => provider);
  runner.kick();
  await runner.idle();
  return (await analyses.latest(bookId))!;
}

describe('the quick check', () => {
  it('finishes at once without any AI and records the voice in numbers', async () => {
    const analysis = await analyses.start(bookId, { deep: false });
    expect(analysis).toMatchObject({ status: 'done', deep: false, tasks: 0, result: null });
    expect(analysis.stats.words).toBe(560);
    expect((await library.getBook(bookId))!.status).toBe('analyzed');
    const bible = (await analyses.getBible(bookId))!;
    expect(bible.voice.numbers!.avgSentenceWords).toBe(analysis.stats.voice.avgSentenceWords);
    expect(bible).toMatchObject({ pov: 'third person', tense: 'past', characters: [] });
    expect(await analyses.isStale(analysis)).toBe(false);
  });

  it('knows when the text has changed since', async () => {
    const analysis = await analyses.start(bookId, { deep: false });
    const [, prologue] = await library.listChapters(bookId);
    await library.saveChapter(prologue.id, [paragraph('A new prologue.')]);
    expect(await analyses.isStale(analysis)).toBe(true);
  });
});

describe('the full analysis', () => {
  it('reads every chapter, builds the Book Bible and assesses the book', async () => {
    const provider = analyst();
    const analysis = await runDeep(provider);
    expect(analysis).toMatchObject({ status: 'done', deep: true, tasks: 5, tasksDone: 5, tasksFailed: 0, model: 'analyst' });
    expect(analysis.result!.chapters.map((c) => [c.number, c.title, c.tension, c.pace])).toEqual([[1, 'Prologue', 3, 'slow'], [2, 'Chapter One', 5, 'steady'], [3, 'Chapter Two', 6, 'steady'], [4, 'Chapter Three', 9, 'fast']]);

    const bible = (await analyses.getBible(bookId))!;
    // "Mara" and "Mara Ellison" are one person, "Nobody" is nobody.
    expect(bible.characters.map((c) => [c.name, c.role, c.mentions, c.aliases])).toEqual([
      ['Mara Ellison', 'main', 3, ['Mara']], ['Tomas', 'main', 2, []], ['Agnes Thorne', 'minor', 1, ['Agnes']],
    ]);
    expect(bible.characters[0].description).toContain('inherited the lighthouse key');
    expect(bible.characters[0].arc).toBe('From avoiding her inheritance to accepting it.');
    expect(bible.relationships).toEqual([{ a: 'Mara', b: 'Tomas', relation: 'sister and brother' }]);
    expect(bible.settings.map((s) => s.name)).toEqual(['Marrow Point', 'the harbour']);
    expect(bible.timeline.map((e) => [e.chapter, e.what])).toContainEqual([3, 'The Corriveau was lost with all hands.']);
    expect(bible.glossary.map((t) => t.term)).toEqual(['the Keeper', 'Corriveau']);
    expect(bible).toMatchObject({ pov: 'third person, Mara', tense: 'past', tone: 'quiet, uncanny', themes: ['inheritance', 'faith'] });
    expect(bible.voice).toMatchObject({ description: 'Plain, measured sentences with one precise image per paragraph.', devices: ['lists of three'] });
    expect(bible.voice.numbers!.avgSentenceWords).toBeGreaterThan(10);
    expect(bible.chapterSummaries).toHaveLength(4);

    const synthesis = analysis.result!.synthesis!;
    // Ratings come back in a fixed order, clamped to 1-10.
    expect(synthesis.ratings.map((r) => [r.key, r.score])).toEqual([['structure', 7], ['characters', 6], ['pacing', 7], ['prose', 8], ['opening', 10], ['ending', 8]]);
    expect(synthesis.priorities[0].title).toBe('Deepen Tomas');
  });

  it('gives the model the story so far and the characters already met', async () => {
    const provider = analyst();
    await runDeep(provider);
    const third = provider.requests[2];
    const user = third.messages[1].content;
    expect(user).toContain('The book so far:');
    expect(user).toContain('Chapter 2: Mara refuses to sell the lighthouse');
    expect(user).toContain('Characters already met:');
    expect(user).toContain('Tomas: Mara\'s brother, who wants to sell');
    expect(user).toContain('The harbour master was a broad, slow-moving woman');
    expect(third.jsonSchema).toBeDefined();
    expect(third.messages[0].content).toContain('developmental editor of fiction');
    const synthesis = provider.requests[4].messages[1].content;
    expect(synthesis).toContain('4. Chapter Three (125 words, 9/10)');
    expect(synthesis).toContain('Mara Ellison (main)');
    expect(synthesis).toContain('Excerpts, to hear the voice:');
  });

  it('keeps only issues that are grounded in the text, and pins them to their paragraph', async () => {
    await runDeep(analyst());
    const ai = (await analyses.listIssues(bookId)).filter((i) => i.source === 'ai');
    expect(ai.map((i) => [i.category, i.severity, i.blockIndex, i.title])).toEqual([
      // A complaint about the opening that points at the opening is kept, capped at "worth fixing".
      ['weak-opening', 'medium', 0, 'Weak opening'],
      // The same complaint about a line in mid-chapter is dropped, and so is the made-up quotation.
      ['show-tell', 'medium', 2, 'Telling instead of showing'],
      ['weak-ending', 'medium', 3, 'Weak ending'],
      ['character', 'medium', null, 'Character in Chapter One'],
      ['plot-hole', 'high', null, 'Plot hole across the book'],
    ]);
    const chapters = await library.listChapters(bookId);
    expect(ai[1].chapterId).toBe(chapters[2].id);
    expect(ai[1].quote).toBe('“It is not for sale, Tomas.”');
    await analyses.setIssueStatus(ai[0].id, 'dismissed');
    expect((await analyses.listIssues(bookId)).find((i) => i.id === ai[0].id)!.status).toBe('dismissed');
  });

  it('still keeps the chapter notes and the Bible when the final assessment fails', async () => {
    const analysis = await runDeep(analyst({ failSynthesis: true }));
    expect(analysis).toMatchObject({ status: 'done', tasksDone: 4, tasksFailed: 1 });
    expect(analysis.result).toMatchObject({ synthesis: null });
    expect(analysis.result!.chapters).toHaveLength(4);
    expect((await analyses.getBible(bookId))!.characters.map((c) => c.name)).toEqual(['Mara Ellison', 'Tomas', 'Agnes Thorne']);
  });

  it('never overwrites Bible entries the publisher corrected by hand', async () => {
    await runDeep(analyst());
    const bible = (await analyses.getBible(bookId))!;
    bible.characters[1] = { ...bible.characters[1], description: 'Younger brother. Owes money in the city.', locked: true };
    bible.glossary[0] = { term: 'the Keeper', meaning: 'A hereditary office in Marrow Point.', locked: true };
    await analyses.saveBible(bookId, bible);
    await runDeep(analyst());
    const again = (await analyses.getBible(bookId))!;
    expect(again.characters.find((c) => c.name === 'Tomas')).toMatchObject({ description: 'Younger brother. Owes money in the city.', locked: true });
    expect(again.glossary.find((t) => t.term === 'the Keeper')!.meaning).toBe('A hereditary office in Marrow Point.');
    expect(again.characters.filter((c) => c.name === 'Tomas')).toHaveLength(1);
  });

  it('can be stopped part-way and keeps what it learned', async () => {
    let runner: JobRunner;
    let calls = 0;
    const provider = analyst({
      onCall: () => {
        if (++calls === 3) void runner.cancel(job.id);
      },
    });
    const job = await analyses.start(bookId, { deep: true });
    runner = new JobRunner(analyses, () => provider);
    runner.kick();
    await runner.idle();
    const after = (await analyses.latest(bookId))!;
    expect(after.status).toBe('cancelled');
    expect(after.result!.chapters.length).toBeGreaterThanOrEqual(2);
    expect((await analyses.getBible(bookId))!.characters.map((c) => c.name)).toContain('Tomas');
  });

  it('is put on hold if the app closes, and continues afterwards', async () => {
    const job = await analyses.start(bookId, { deep: true });
    await db.execute("UPDATE analyses SET status = 'running' WHERE id = ?", [job.id]);
    await db.execute("UPDATE analysis_tasks SET status = 'running' WHERE analysis_id = ? AND position = 0", [job.id]);
    expect(await analyses.recoverInterrupted()).toBe(1);
    expect((await analyses.latest(bookId))!.status).toBe('paused');
    const runner = new JobRunner(analyses, () => analyst());
    await runner.resume(job.id);
    await runner.idle();
    expect(await analyses.latest(bookId)).toMatchObject({ status: 'done', tasksDone: 5 });
  });
});

describe('the Book Bible in later editing', () => {
  it('is sent with every editing request and protects names', async () => {
    const provider = analyst();
    await runDeep(provider);
    const bible = (await analyses.getBible(bookId))!;
    expect(bibleNames(bible)).toEqual(expect.arrayContaining(['Mara Ellison', 'Mara', 'Tomas', 'Marrow Point']));
    const brief = bibleBrief(bible);
    expect(brief).toContain('Narration: third person, Mara, past tense.');
    expect(brief).toContain('Mara Ellison (inherited the lighthouse key from her grandfather)');
    expect(brief).toContain("Author's voice: Plain, measured sentences");

    const edits = new EditStore(db, library);
    const chapters = await library.listChapters(bookId);
    const job = await edits.createJob({ bookId, level: 'line', strength: 'medium', scope: { chapterIds: [chapters[2].id] }, model: 'x' });
    expect(job.options.names).toContain('Tomas');
    provider.requests.length = 0;
    const runner = new JobRunner([edits, analyses], () => provider);
    runner.kick();
    await runner.idle();
    expect(provider.requests[0].messages[0].content).toContain('Facts about this book. Keep every edit consistent with them:');
    expect(provider.requests[0].messages[0].content).toContain('Corriveau');
  });

  it('shares one queue with editing jobs: only one request runs at a time', async () => {
    let active = 0;
    let peak = 0;
    const provider = analyst({
      onCall: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      },
    });
    const edits = new EditStore(db, library);
    const chapters = await library.listChapters(bookId);
    await analyses.start(bookId, { deep: true });
    const edit = await edits.createJob({ bookId, level: 'proofread', strength: 'light', scope: { chapterIds: chapters.map((c) => c.id) }, model: 'x' });
    const runner = new JobRunner([edits, analyses], () => provider);
    runner.kick();
    await runner.idle();
    expect(peak).toBe(1);
    expect((await analyses.latest(bookId))!.status).toBe('done');
    expect((await edits.getJob(edit.id))!.status).toBe('done');
  });
});

describe('reading model output', () => {
  it('repairs a reply that was cut off before the end', () => {
    const cut = '{"summary": "A letter arrives.", "characters": [{"name": "Mara", "aliases": [], "description": "the heir"}, {"name": "Tom", "ali';
    expect(parseJsonReply(cut)).toEqual({ summary: 'A letter arrives.', characters: [{ name: 'Mara', aliases: [], description: 'the heir' }] });
    expect(parseJsonReply('Here you go:\n```json\n{"a": 1}\n```\nHope that helps')).toEqual({ a: 1 });
    expect(parseJsonReply('<think>{"x": 2}</think>{"a": "b } c"}')).toEqual({ a: 'b } c' });
    expect(parseJsonReply('{"summary": "x", "characters": [{"name": "A"}], "tension": 5, "pace": "st')).toEqual({ summary: 'x', characters: [{ name: 'A' }], tension: 5 });
    expect(parseJsonReply('no json here')).toBeNull();
    expect(parseJsonReply('[1, 2]')).toBeNull();
  });

  it('cuts long chapters into passages and adapts the questions to the kind of book', async () => {
    const long = { id: 'c', title: 'Long', blocks: Array.from({ length: 40 }, (_, i) => paragraph(Array.from({ length: 100 }, (_, w) => `w${i}x${w}`).join(' ') + '.')) };
    const segments = segmentChapter(long, 1, 1200);
    expect(segments.map((s) => [s.part, s.parts, s.words])).toEqual([[1, 4, 1200], [2, 4, 1200], [3, 4, 1200], [4, 4, 400]]);
    expect(segments.flatMap((s) => s.paragraphs.map((p) => p.index))).toEqual(Array.from({ length: 40 }, (_, i) => i));
    const context = { language: 'es', bookTitle: 'T', storySoFar: [], knownCharacters: [] };
    const fiction = buildSegmentRequest(segments[0], { ...context, kind: 'fiction' });
    const nonfiction = buildSegmentRequest(segments[0], { ...context, kind: 'nonfiction' });
    const children = buildSegmentRequest(segments[0], { ...context, kind: 'children' });
    expect(fiction.messages[0].content).toContain('The manuscript is in Spanish');
    expect(fiction.messages[1].content).toContain('plot-hole');
    expect(nonfiction.messages[1].content).toContain('needs-evidence');
    expect(nonfiction.messages[1].content).not.toContain('"settings"');
    expect(children.messages[1].content).toContain('read-aloud');
    expect(Object.keys((nonfiction.schema as { properties: object }).properties)).not.toContain('pov');
  });
});
