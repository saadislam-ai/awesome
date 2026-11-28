import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { AiError, type AiProvider, type ChatRequest } from '../../src/core/ai/provider';
import { blockText, paragraph, type Block } from '../../src/core/model/blocks';
import { EditStore, JobRunner, type EditJob } from '../../src/data/edits';
import { Library } from '../../src/data/library';
import { migrate } from '../../src/data/schema';
import { MemoryFiles } from '../../src/platform/memory';
import { createSqlJsDb } from '../../src/platform/sqljs';
import type { Db } from '../../src/platform/types';

let db: Db;
let library: Library;
let store: EditStore;
let bookId: string;
let chapterIds: string[];

const TYPOS: [RegExp, string][] = [[/\bTeh\b/g, 'The'], [/\bteh\b/g, 'the'], [/\bclimed\b/g, 'climbed'], [/\bforgoten\b/g, 'forgotten'], [/\bwich\b/g, 'which'], [/\s+,/g, ',']];

/** A stand-in model that really fixes a few known typos, the way a proofreader would. */
function proofreader(hooks: { before?: (request: ChatRequest, call: number) => void | Promise<void> } = {}): AiProvider & { calls: number } {
  const model = {
    kind: 'custom' as const,
    label: 'test-model',
    calls: 0,
    async chat(request: ChatRequest, options?: { signal?: AbortSignal; onToken?: (t: string) => void }) {
      model.calls++;
      await hooks.before?.(request, model.calls);
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const user = request.messages[request.messages.length - 1].content;
      const reply = [...user.matchAll(/<p id="(\d+)">([\s\S]*?)<\/p>/g)]
        .map(([, id, text]) => {
          let fixed = text;
          for (const [pattern, replacement] of TYPOS) fixed = fixed.replace(pattern, replacement);
          return `<p id="${id}">${fixed}</p>\n<note id="${id}">${fixed === text ? 'no change' : 'fixed typos'}</note>`;
        })
        .join('\n');
      options?.onToken?.(reply);
      return { text: reply, completionTokens: 50 };
    },
  };
  return model;
}

const CHAPTER_ONE: Block[] = [
  paragraph('Teh keeper climed the stairs, wich were steep.'),
  { type: 'paragraph', runs: [{ text: 'It was ' }, { text: 'very', i: true }, { text: ' dark , and he had forgoten teh lamp.' }] },
  paragraph('Nothing is wrong with this paragraph.'),
  { type: 'break' },
  paragraph('At teh top he stopped.'),
];
const CHAPTER_TWO: Block[] = [paragraph('Teh sea was calm.'), paragraph('A gull cried once.')];

beforeEach(async () => {
  const SQL = await initSqlJs();
  db = createSqlJsDb(new SQL.Database());
  library = new Library(db, new MemoryFiles());
  await library.init();
  store = new EditStore(db, library);
  const book = await library.createBook({
    category: 'mine', title: 'The Keeper', language: 'en',
    chapters: [{ title: 'One', blocks: CHAPTER_ONE }, { title: 'Two', blocks: CHAPTER_TWO }],
  });
  await library.updateBook(book.id, { instructions: 'British spelling' });
  bookId = book.id;
  chapterIds = (await library.listChapters(bookId)).map((h) => h.id);
});

const texts = async (chapterId: string) => (await library.getChapter(chapterId))!.blocks.map(blockText);

async function runJob(provider: AiProvider, overrides: Partial<Parameters<EditStore['createJob']>[0]> = {}): Promise<EditJob> {
  const job = await store.createJob({ bookId, level: 'proofread', strength: 'medium', scope: { chapterIds }, model: provider.label, ...overrides });
  const runner = new JobRunner(store, () => provider);
  runner.kick();
  await runner.idle();
  return (await store.getJob(job.id))!;
}

describe('an editing job', () => {
  it('produces suggestions and leaves the book untouched', async () => {
    const before = await texts(chapterIds[0]);
    const job = await runJob(proofreader());
    expect(job).toMatchObject({ status: 'done', tasks: 2, tasksDone: 2, tasksFailed: 0, suggestions: 4, model: 'test-model' });
    expect(job.options).toMatchObject({ language: 'en', bookType: 'fiction', instructions: 'British spelling' });
    expect(job.wordsDone).toBe(job.words);
    expect(await texts(chapterIds[0])).toEqual(before);

    const suggestions = await store.listSuggestions(bookId, chapterIds[0]);
    expect(suggestions.map((s) => [s.blockIndex, s.status, s.note])).toEqual([[0, 'pending', 'Fixed typos'], [1, 'pending', 'Fixed typos'], [4, 'pending', 'Fixed typos']]);
    expect(suggestions[0].hunks.map((h) => [h.before, h.after])).toEqual([['Teh', 'The'], ['climed', 'climbed'], ['wich', 'which']]);
    expect(suggestions[1].revised).toBe('It was *very* dark, and he had forgotten the lamp.');
    expect(await store.pendingByChapter(bookId)).toEqual({ [chapterIds[0]]: 3, [chapterIds[1]]: 1 });
  });

  it('can be limited to one chapter or to selected paragraphs', async () => {
    await runJob(proofreader(), { scope: { chapterIds: [chapterIds[1]] } });
    expect(Object.keys(await store.pendingByChapter(bookId))).toEqual([chapterIds[1]]);
    await runJob(proofreader(), { scope: { chapterIds: [chapterIds[0]], range: { from: 4, to: 4 } } });
    expect((await store.listSuggestions(bookId, chapterIds[0])).map((s) => s.blockIndex)).toEqual([4]);
    await expect(store.createJob({ bookId, level: 'line', strength: 'light', scope: { chapterIds: [] }, model: 'x' })).rejects.toThrow(/no text to edit/);
  });

  it('skips paragraphs that were edited by hand after the job was planned', async () => {
    const job = await store.createJob({ bookId, level: 'proofread', strength: 'medium', scope: { chapterIds: [chapterIds[1]] }, model: 'x' });
    await library.saveChapter(chapterIds[1], [paragraph('Teh sea was rough now.'), CHAPTER_TWO[1]]);
    const runner = new JobRunner(store, () => proofreader());
    runner.kick();
    await runner.idle();
    expect(await store.getJob(job.id)).toMatchObject({ status: 'done', suggestions: 0, skipped: 1 });
  });

  it('replaces an older untouched suggestion when the same paragraph is edited again', async () => {
    await runJob(proofreader(), { scope: { chapterIds: [chapterIds[1]] } });
    await runJob(proofreader(), { scope: { chapterIds: [chapterIds[1]] }, level: 'line' });
    const suggestions = await store.listSuggestions(bookId, chapterIds[1]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].level).toBe('line');
  });
});

describe('accepting and rejecting changes', () => {
  beforeEach(async () => {
    await runJob(proofreader());
  });

  it('applies each decision to the text straight away, and decisions can be changed', async () => {
    const [first] = await store.listSuggestions(bookId, chapterIds[0]);
    await store.decide([{ suggestionId: first.id, changes: { 0: 'accept', 1: 'reject' } }]);
    expect((await texts(chapterIds[0]))[0]).toBe('The keeper climed the stairs, wich were steep.');
    let now = (await store.listSuggestions(bookId, chapterIds[0]))[0];
    expect(now).toMatchObject({ status: 'pending', decisions: { 0: 'accept', 1: 'reject' } });

    await store.decide([{ suggestionId: first.id, changes: { 2: 'accept' } }]);
    expect((await texts(chapterIds[0]))[0]).toBe('The keeper climed the stairs, which were steep.');
    now = (await store.listSuggestions(bookId, chapterIds[0]))[0];
    expect(now.status).toBe('resolved');

    // Changing one's mind afterwards.
    await store.decide([{ suggestionId: first.id, changes: { 1: 'accept', 0: null } }]);
    expect((await texts(chapterIds[0]))[0]).toBe('Teh keeper climbed the stairs, which were steep.');
    expect((await store.listSuggestions(bookId, chapterIds[0]))[0].status).toBe('pending');
  });

  it('keeps formatting when changes are applied', async () => {
    const second = (await store.listSuggestions(bookId, chapterIds[0]))[1];
    await store.decide([{ suggestionId: second.id, changes: Object.fromEntries(second.hunks.map((h) => [h.index, 'accept' as const])) }]);
    const block = (await library.getChapter(chapterIds[0]))!.blocks[1] as Extract<Block, { type: 'paragraph' }>;
    expect(block.runs).toEqual([{ text: 'It was ' }, { text: 'very', i: true }, { text: ' dark, and he had forgotten the lamp.' }]);
  });

  it('accepts everything in a chapter at once, optionally only some kinds of change', async () => {
    const onlyPunctuation = await store.decideAll(bookId, chapterIds[0], 'accept', { kinds: ['spacing', 'punctuation'] });
    expect(onlyPunctuation.changed).toBe(1);
    expect((await texts(chapterIds[0]))[1]).toBe('It was very dark, and he had forgoten teh lamp.');

    const rest = await store.decideAll(bookId, chapterIds[0], 'accept');
    expect(rest.changed).toBe(6);
    expect(await texts(chapterIds[0])).toEqual([
      'The keeper climbed the stairs, which were steep.',
      'It was very dark, and he had forgotten the lamp.',
      'Nothing is wrong with this paragraph.',
      '* * *',
      'At the top he stopped.',
    ]);
    expect(await store.pendingByChapter(bookId)).toEqual({ [chapterIds[1]]: 1 });
    // The other chapter was not touched.
    expect((await texts(chapterIds[1]))[0]).toBe('Teh sea was calm.');
  });

  it('rejecting everything leaves the text exactly as the author wrote it', async () => {
    const before = (await library.getChapter(chapterIds[0]))!.blocks;
    await store.decideAll(bookId, chapterIds[0], 'reject');
    expect((await library.getChapter(chapterIds[0]))!.blocks).toEqual(before);
    expect((await store.listSuggestions(bookId, chapterIds[0])).every((s) => s.status === 'resolved')).toBe(true);
    await store.clearResolved(bookId);
    expect(await store.listSuggestions(bookId, chapterIds[0])).toEqual([]);
  });

  it('saves a snapshot before the first change, so a whole review can be undone', async () => {
    const original = (await library.getAllChapters(bookId)).map((c) => c.blocks);
    await store.decideAll(bookId, chapterIds[0], 'accept');
    await store.decideAll(bookId, chapterIds[1], 'accept');
    const versions = await library.listVersions(bookId);
    // The text before the review equals the import, which is already kept as the original version.
    expect(versions.map((v) => v.kind)).toEqual(['original']);
    await library.restoreVersion(bookId, versions[0].id);
    expect((await library.getAllChapters(bookId)).map((c) => c.blocks)).toEqual(original);
  });

  it('still finds its paragraph after paragraphs were added above it', async () => {
    const chapter = (await library.getChapter(chapterIds[0]))!;
    await library.saveChapter(chapterIds[0], [paragraph('A new opening line.'), paragraph('And another.'), ...chapter.blocks]);
    const last = (await store.listSuggestions(bookId, chapterIds[0]))[2];
    const result = await store.decide([{ suggestionId: last.id, changes: { 0: 'accept' } }]);
    expect(result.stale).toEqual([]);
    expect((await texts(chapterIds[0]))[6]).toBe('At the top he stopped.');
  });

  it('marks a suggestion as out of date when its paragraph was rewritten by hand', async () => {
    const chapter = (await library.getChapter(chapterIds[0]))!;
    const blocks = chapter.blocks.slice();
    blocks[0] = paragraph('The keeper went up.');
    await library.saveChapter(chapterIds[0], blocks);
    const [first] = await store.listSuggestions(bookId, chapterIds[0]);
    const result = await store.decide([{ suggestionId: first.id, changes: { 0: 'accept' } }]);
    expect(result.stale).toEqual([first.id]);
    expect((await texts(chapterIds[0]))[0]).toBe('The keeper went up.');
    expect((await store.listSuggestions(bookId, chapterIds[0]))[0].status).toBe('stale');
  });

  it('lets a proposal be edited by hand or redone by the model with a note', async () => {
    const [first] = await store.listSuggestions(bookId, chapterIds[0]);
    await store.decide([{ suggestionId: first.id, changes: { 0: 'accept' } }]);
    await store.revise(first.id, 'The keeper climbed the steep stairs.');
    let now = (await store.listSuggestions(bookId, chapterIds[0]))[0];
    expect(now).toMatchObject({ revised: 'The keeper climbed the steep stairs.', decisions: {}, status: 'pending' });
    // Editing a proposal first puts the author's text back.
    expect((await texts(chapterIds[0]))[0]).toBe('Teh keeper climed the stairs, wich were steep.');

    const redo: AiProvider = { kind: 'custom', label: 'redo', chat: async () => ({ text: '<p id="1">The keeper climbed the stairs. They were steep.</p><note id="1">split the sentence</note>' }) };
    await store.regenerate(first.id, redo, 'two short sentences', { level: 'line', strength: 'medium', language: 'en', bookType: 'fiction' });
    now = (await store.listSuggestions(bookId, chapterIds[0]))[0];
    expect(now).toMatchObject({ revised: 'The keeper climbed the stairs. They were steep.', note: 'Split the sentence' });
  });
});

describe('the job queue', () => {
  it('can be paused mid-passage and resumed without losing or repeating work', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let paused = false;
    const provider = proofreader({
      before: async (_request, call) => {
        if (call === 2 && !paused) await gate;
      },
    });
    const job = await store.createJob({ bookId, level: 'proofread', strength: 'medium', scope: { chapterIds }, model: 'x' });
    const runner = new JobRunner(store, () => provider);
    runner.kick();
    while (provider.calls < 2) await new Promise((r) => setTimeout(r, 5));
    paused = true;
    const pausing = runner.pause(job.id);
    release();
    await pausing;
    await runner.idle();
    expect(await store.getJob(job.id)).toMatchObject({ status: 'paused', tasksDone: 1, suggestions: 3 });

    await runner.resume(job.id);
    await runner.idle();
    expect(await store.getJob(job.id)).toMatchObject({ status: 'done', tasksDone: 2, suggestions: 4 });
    expect(await store.listSuggestions(bookId)).toHaveLength(4);
  });

  it('continues after the app was closed in the middle of a job', async () => {
    const job = await store.createJob({ bookId, level: 'proofread', strength: 'medium', scope: { chapterIds }, model: 'x' });
    // Simulate a crash: the job and one passage are left marked as running.
    await db.execute("UPDATE edit_jobs SET status = 'running' WHERE id = ?", [job.id]);
    await db.execute("UPDATE edit_tasks SET status = 'running' WHERE job_id = ? AND position = 0", [job.id]);

    await migrate(db);
    const afterRestart = new EditStore(db, library);
    expect(await afterRestart.recoverInterrupted()).toBe(1);
    expect(await afterRestart.getJob(job.id)).toMatchObject({ status: 'paused', tasksDone: 0 });
    const runner = new JobRunner(afterRestart, () => proofreader());
    runner.kick();
    await runner.idle();
    expect((await afterRestart.getJob(job.id))!.status).toBe('paused');
    await runner.resume(job.id);
    await runner.idle();
    expect(await afterRestart.getJob(job.id)).toMatchObject({ status: 'done', tasksDone: 2, suggestions: 4 });
  });

  it('cancels a job but keeps the suggestions it already made', async () => {
    const provider = proofreader();
    const job = await store.createJob({ bookId, level: 'proofread', strength: 'medium', scope: { chapterIds }, model: 'x' });
    const runner = new JobRunner(store, () => provider);
    let cancelled = false;
    const cancelling = new JobRunner(store, () => ({
      ...provider,
      chat: async (request, options) => {
        const result = await provider.chat(request, options);
        if (!cancelled) {
          cancelled = true;
          void runner.cancel(job.id);
          void cancellingRunner.cancel(job.id);
        }
        return result;
      },
    }));
    const cancellingRunner = cancelling;
    cancellingRunner.kick();
    await cancellingRunner.idle();
    const after = (await store.getJob(job.id))!;
    expect(after.status).toBe('cancelled');
    expect(after.tasksDone).toBe(1);
    expect((await store.listSuggestions(bookId)).length).toBe(3);
  });

  it('puts the job on hold when the engine stops answering, instead of failing every passage', async () => {
    const down: AiProvider = { kind: 'local', label: 'down', chat: async () => { throw new AiError('The AI engine could not be reached.', true, true); } };
    const job = await runJob(down);
    expect(job).toMatchObject({ status: 'paused', tasksDone: 0, tasksFailed: 0, error: 'The AI engine could not be reached.' });
  });

  it('records a passage the model could not handle, moves on, and can retry it later', async () => {
    let call = 0;
    const good = proofreader();
    const fussy: AiProvider = { kind: 'custom', label: 'fussy', chat: (request, options) => (++call <= 2 ? Promise.resolve({ text: 'I cannot do that.' }) : good.chat(request, options)) };
    const job = await runJob(fussy);
    expect(job).toMatchObject({ status: 'done', tasksDone: 1, tasksFailed: 1, suggestions: 1 });
    await store.retryFailed(job.id);
    const runner = new JobRunner(store, () => good);
    runner.kick();
    await runner.idle();
    expect(await store.getJob(job.id)).toMatchObject({ status: 'done', tasksDone: 2, tasksFailed: 0, suggestions: 4 });
  });

  it('waits when no model is loaded', async () => {
    const job = await store.createJob({ bookId, level: 'proofread', strength: 'medium', scope: { chapterIds }, model: 'x' });
    const runner = new JobRunner(store, () => null);
    runner.kick();
    await runner.idle();
    expect(await store.getJob(job.id)).toMatchObject({ status: 'paused', tasksDone: 0 });
    expect(runner.state.problem).toMatch(/No AI model is loaded/);
  });
});
