import { describe, expect, it } from 'vitest';
import { AiError, ChatStreamReader, type AiProvider, type ChatRequest } from '../../src/core/ai/provider';
import { chunkChapter } from '../../src/core/edit/chunk';
import { alignBlocks, applyDecisions, changeStats, classifyChange, diffText, groupHunks, tokenize } from '../../src/core/edit/diff';
import { checkRevision, isUsableRevision } from '../../src/core/edit/gates';
import { markupToPlain, markupToRuns, runsToMarkup } from '../../src/core/edit/markup';
import { parseEditReply } from '../../src/core/edit/parse';
import { editChunk, keepAuthorFormatting, regenerateParagraph, withRetry } from '../../src/core/edit/pipeline';
import { buildEditMessages } from '../../src/core/edit/prompt';
import type { EditOptions } from '../../src/core/edit/types';
import { detectChapters } from '../../src/core/import';
import { paragraph, type Block, type Run } from '../../src/core/model/blocks';
import { importFixture } from './helpers';

const OPTIONS: EditOptions = { level: 'proofread', strength: 'medium', language: 'en', bookType: 'fiction' };

/** A stand-in model that answers with whatever the test scripted. */
function scripted(reply: (request: ChatRequest) => string | Promise<string>, extra: Partial<{ finishReason: string }> = {}): AiProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    kind: 'custom',
    label: 'scripted',
    requests,
    async chat(request, options) {
      requests.push(request);
      const text = await reply(request);
      options?.onToken?.(text);
      return { text, completionTokens: 10, ...extra };
    },
  };
}

describe('formatting as light Markdown', () => {
  it('writes and reads back every kind of formatting', () => {
    const runs: Run[] = [
      { text: 'Plain ' }, { text: 'italic', i: true }, { text: ' and ' }, { text: 'bold', b: true }, { text: ' and ' },
      { text: 'both', b: true, i: true }, { text: ', ' }, { text: 'under', u: true }, { text: ' ' }, { text: 'gone', s: true }, { text: '.' },
    ];
    const markup = runsToMarkup(runs);
    expect(markup).toBe('Plain *italic* and **bold** and ***both***, __under__ ~~gone~~.');
    expect(markupToRuns(markup)).toEqual(runs);
    expect(markupToPlain(markup)).toBe('Plain italic and bold and both, under gone.');
  });

  it('keeps spaces outside the markers and handles neighbouring formats', () => {
    expect(runsToMarkup([{ text: 'He said ' }, { text: 'no way ', i: true }, { text: 'again.' }])).toBe('He said *no way* again.');
    const mixed: Run[] = [{ text: 'very ', i: true }, { text: 'loud', i: true, b: true }, { text: ' indeed', i: true }];
    expect(runsToMarkup(mixed)).toBe('*very* ***loud*** *indeed*');
    expect(markupToRuns(runsToMarkup(mixed)).filter((r) => r.i).map((r) => r.text)).toEqual(['very', 'loud', 'indeed']);
    expect(markupToPlain(runsToMarkup(mixed))).toBe('very loud indeed');
    expect(markupToRuns('*very **loud** indeed*').filter((r) => r.b).map((r) => r.text)).toEqual(['loud']);
  });

  it('escapes literal asterisks and treats an unpaired marker as text', () => {
    const runs: Run[] = [{ text: '5 * 3 = 15, see note* and snake__case' }];
    expect(markupToRuns(runsToMarkup(runs))).toEqual(runs);
    expect(markupToRuns('A stray * star and *real italic*.')).toEqual([{ text: 'A stray * star and ' }, { text: 'real italic', i: true }, { text: '.' }]);
    expect(markupToRuns('Unclosed **bold stays plain')).toEqual([{ text: 'Unclosed **bold stays plain' }]);
  });

  it('keeps line breaks inside a paragraph', () => {
    const runs: Run[] = [{ text: 'Roses are red,\n', i: true }, { text: 'violets are blue.', i: true }];
    const markup = runsToMarkup(runs);
    expect(markup).toBe('*Roses are red,*\n*violets are blue.*');
    expect(markupToPlain(markup)).toBe('Roses are red,\nviolets are blue.');
  });

  it('preserves the text and italics of real imported books', async () => {
    for (const name of ['novel.docx', 'nonfiction.docx', 'spanish.epub']) {
      const result = await importFixture(name);
      for (const block of result.blocks) {
        if (block.type === 'break') continue;
        const back = markupToRuns(runsToMarkup(block.runs));
        expect(back.map((r) => r.text).join(''), name).toBe(block.runs.map((r) => r.text).join(''));
        expect(back.filter((r) => r.i).map((r) => r.text.trim()), name).toEqual(block.runs.filter((r) => r.i && r.text.trim()).map((r) => r.text.trim()));
      }
    }
  });
});

describe('tracked changes', () => {
  it('finds word-level changes and names their kind', () => {
    const original = 'She dont know were the the keys was. it was "late"';
    const revised = 'She doesn\'t know where the keys were. It was "late."';
    const hunks = diffText(original, revised);
    expect(hunks.map((h) => [h.before, h.after, h.kind])).toEqual([
      ['dont', "doesn't", 'spelling'],
      ['were', 'where', 'spelling'],
      ['the ', '', 'cut'],
      ['was', 'were', 'wording'],
      ['it', 'It', 'capitalization'],
      ['', '.', 'punctuation'],
    ]);
    for (const h of hunks) expect(original.slice(h.start, h.end)).toBe(h.before);
    expect(changeStats(hunks)).toEqual({ changes: 6, wordsAdded: 4, wordsRemoved: 5 });
  });

  it('joins neighbouring changes into one', () => {
    const hunks = diffText('It was a big red barn.', 'It was a large crimson barn.');
    expect(hunks).toHaveLength(1);
    expect([hunks[0].before, hunks[0].after]).toEqual(['big red', 'large crimson']);
  });

  it('classifies changes', () => {
    expect(classifyChange('recieve', 'receive')).toBe('spelling');
    expect(classifyChange('Its', "It's")).toBe('punctuation');
    expect(classifyChange('*worth*', 'worth')).toBe('formatting');
    expect(classifyChange('every where', 'everywhere')).toBe('spacing');
    expect(classifyChange('paris', 'Paris')).toBe('capitalization');
    expect(classifyChange('in actual fact, ', '')).toBe('cut');
    expect(classifyChange('', ' quietly')).toBe('addition');
    expect(classifyChange('walked slowly', 'crept')).toBe('wording');
    expect(classifyChange('the thing about it that she liked the most', 'what she loved')).toBe('rewrite');
  });

  it('applies any mix of accepted and rejected changes', () => {
    const original = 'Teh cat sat on teh mat, and it purred loud.';
    const revised = 'The cat sat on the mat, and it purred loudly.';
    const hunks = diffText(original, revised);
    expect(hunks).toHaveLength(3);
    expect(applyDecisions(original, hunks, {})).toBe(original);
    expect(applyDecisions(original, hunks, {}, true)).toBe(revised);
    expect(applyDecisions(original, hunks, { 0: 'accept', 1: 'reject', 2: 'accept' })).toBe('The cat sat on teh mat, and it purred loudly.');
    expect(applyDecisions(original, hunks, { 0: 'reject', 1: 'accept' })).toBe('Teh cat sat on the mat, and it purred loud.');
    expect(applyDecisions(original, hunks, { 0: 'accept', 1: 'accept', 2: 'accept' })).toBe(revised);
  });

  it('groups changes by sentence and by paragraph', () => {
    const original = 'Teh cat sat. It purred loud and it was hapy. The end.';
    const revised = 'The cat sat. It purred loudly and it was happy. The end.';
    const hunks = diffText(original, revised);
    expect(groupHunks(original, hunks, 'word')).toHaveLength(3);
    const sentences = groupHunks(original, hunks, 'sentence');
    expect(sentences.map((g) => [g.before, g.after, g.hunks])).toEqual([
      ['Teh cat sat.', 'The cat sat.', [0]],
      ['It purred loud and it was hapy.', 'It purred loudly and it was happy.', [1, 2]],
    ]);
    const [whole] = groupHunks(original, hunks, 'paragraph');
    expect([whole.before, whole.after, whole.hunks]).toEqual([original, revised, [0, 1, 2]]);
  });

  it('handles text in scripts without spaces, and identical text', () => {
    expect(tokenize('你好，世界')).toEqual(['你', '好', '，', '世', '界']);
    expect(diffText('我喜欢这本书。', '我很喜欢这本书。').map((h) => [h.before, h.after])).toEqual([['', '很']]);
    expect(diffText('Same.', 'Same.')).toEqual([]);
  });

  it('lines up the paragraphs of two versions of a chapter', () => {
    const before = ['Intro paragraph here.', 'The cat sat on the mat all day.', 'This one will be removed entirely.', 'Final words.'];
    const after = ['Intro paragraph here.', 'A brand new paragraph about dogs.', 'The cat sat upon the mat all day long.', 'Final words.'];
    expect(alignBlocks(before, after)).toEqual([{ a: 0, b: 0 }, { b: 1 }, { a: 1, b: 2 }, { a: 2 }, { a: 3, b: 3 }]);
    expect(alignBlocks([], ['x'])).toEqual([{ b: 0 }]);
    expect(alignBlocks(['x'], [])).toEqual([{ a: 0 }]);
  });
});

describe('cutting a chapter into passages', () => {
  const para = (words: number, tag: string): Block => paragraph(Array.from({ length: words }, (_, i) => `${tag}${i}`).join(' ') + '.');

  it('keeps whole paragraphs together, respects the size limit and carries context forward', () => {
    const blocks: Block[] = [para(200, 'a'), para(200, 'b'), para(200, 'c'), { type: 'break' }, para(100, 'd')];
    const chunks = chunkChapter(blocks, { level: 'line', maxWords: 450 });
    expect(chunks.map((c) => c.items.map((i) => i.blockIndex))).toEqual([[0, 1], [2, 4]]);
    expect(chunks.map((c) => c.words)).toEqual([400, 300]);
    expect(chunks[0].contextBefore).toBe('');
    expect(chunks[1].contextBefore.endsWith('b199.')).toBe(true);
    expect(chunks[1].items.map((i) => i.n)).toEqual([1, 2]);
  });

  it('gives an over-long paragraph a passage of its own and skips empty ones', () => {
    const chunks = chunkChapter([para(50, 'a'), paragraph(''), para(900, 'b'), para(50, 'c')], { level: 'line', maxWords: 450 });
    expect(chunks.map((c) => c.items.map((i) => i.blockIndex))).toEqual([[0], [2], [3]]);
  });

  it('proofreads headings but never restyles them, and honours a selected range', () => {
    const blocks: Block[] = [{ type: 'heading', level: 2, runs: [{ text: 'A Sectoin Title' }] }, para(20, 'a'), para(20, 'b'), para(20, 'c')];
    expect(chunkChapter(blocks, { level: 'proofread' })[0].items.map((i) => i.blockIndex)).toEqual([0, 1, 2, 3]);
    expect(chunkChapter(blocks, { level: 'line' })[0].items.map((i) => i.blockIndex)).toEqual([1, 2, 3]);
    const ranged = chunkChapter(blocks, { level: 'line', range: { from: 2, to: 2 } });
    expect(ranged[0].items.map((i) => i.blockIndex)).toEqual([2]);
    expect(ranged[0].contextBefore).toContain('a19.');
  });
});

describe('reading the model reply', () => {
  it('reads well-formed replies', () => {
    const parsed = parseEditReply('<p id="1">Fixed text.</p>\n<note id="1">fixed typo</note>\n<p id="2">Same.</p>\n<note id="2">no change</note>');
    expect(parsed.get(1)).toEqual({ text: 'Fixed text.', note: 'fixed typo' });
    expect(parsed.get(2)).toEqual({ text: 'Same.', note: 'no change' });
  });

  it('copes with sloppy replies', () => {
    const reply = [
      '<think>Let me look at paragraph 1... <p id="9">not real</p></think>',
      'Here are the corrections:',
      '```xml',
      "<p id=1>Tom &amp; Jerry's\nwrapped line.</p>",
      '<note id=1>fixed spelling',
      '<p id="2">Second one without closing tag',
      "<p id='3'>Third.</p>",
      '```',
      'I hope this helps!',
    ].join('\n');
    const parsed = parseEditReply(reply);
    expect([...parsed.keys()]).toEqual([1, 2, 3]);
    expect(parsed.get(1)).toEqual({ text: "Tom & Jerry's wrapped line.", note: 'fixed spelling' });
    expect(parsed.get(2)!.text).toBe('Second one without closing tag');
    expect(parsed.get(3)!.text).toBe('Third.');
    expect(parseEditReply('Sorry, I cannot help with that.').size).toBe(0);
  });

  it('keeps line breaks only for paragraphs that had them', () => {
    const parsed = parseEditReply('<p id="1">Line one,\nline two.</p><p id="2">Wrapped\ntext.</p>', new Set([1]));
    expect(parsed.get(1)!.text).toBe('Line one,\nline two.');
    expect(parsed.get(2)!.text).toBe('Wrapped text.');
  });
});

describe('safety checks on proposed changes', () => {
  it('flags changed names and numbers', () => {
    const original = 'In 1961 Agnes Thorne met Tomas at the harbour with 41 crates.';
    expect(checkRevision(original, 'In 1961, Agnes Thorne met Tomas at the harbour with 41 crates.', 'proofread', 'medium')).toEqual([]);
    expect(checkRevision(original, 'In 1961 Agnes Thorn met Thomas at the harbour with 41 crates.', 'proofread', 'medium')).toContain('names');
    expect(checkRevision(original, 'In 1962 Agnes Thorne met Tomas at the harbour with 41 crates.', 'proofread', 'medium')).toContain('numbers');
    expect(checkRevision('The end came. Nobody spoke.', 'The end came. No one spoke.', 'line', 'medium')).toEqual([]);
  });

  it('flags lost formatting, changed quotation marks, big length changes and over-eager proofreading', () => {
    expect(checkRevision('She read *The Keeper* twice.', 'She read The Keeper twice.', 'proofread', 'medium')).toContain('formatting');
    expect(checkRevision('"Go," he said.', 'Go, he said.', 'proofread', 'medium')).toContain('dialogue');
    const long = 'The lighthouse stood at the very end of the long grey road where nobody ever walked any more at night.';
    expect(checkRevision(long, 'The lighthouse stood alone.', 'line', 'light')).toContain('length');
    expect(checkRevision(long, 'At the end of the road, where no one walked at night any longer, there stood the lighthouse.', 'proofread', 'medium')).toContain('beyond-proofread');
  });

  it('rejects replies that are not an edit at all', () => {
    const original = 'The lighthouse stood at the very end of the long grey road where nobody walked.';
    expect(isUsableRevision(original, 'The lighthouse stood at the very end of the long gray road where nobody walked.')).toBe(true);
    expect(isUsableRevision(original, '')).toBe(false);
    expect(isUsableRevision(original, 'A lighthouse.')).toBe(false);
    expect(isUsableRevision(original, 'Маяк стоял в самом конце длинной серой дороги, где никто не ходил.')).toBe(false);
    expect(isUsableRevision(original, 'Fixed. <note id="1">done</note>')).toBe(false);
  });
});

describe('editing a passage with a model', () => {
  const blocks: Block[] = [
    paragraph('Teh keeper climed the stairs.'),
    { type: 'paragraph', runs: [{ text: 'It was ' }, { text: 'very', i: true }, { text: ' dark, and he had forgoten the lamp.' }] },
    paragraph('Nothing wrong here.'),
  ];
  const [chunk] = chunkChapter(blocks, { level: 'proofread' });

  it('sends the passage with the rules and returns suggestions without touching the text', async () => {
    const model = scripted(() =>
      [
        '<p id="1">The keeper climbed the stairs.</p><note id="1">fixed two typos.</note>',
        '<p id="2">It was very dark, and he had forgotten the lamp.</p><note id="2">no change</note>',
        '<p id="3">Nothing wrong here.</p><note id="3">no change</note>',
      ].join('\n'),
    );
    const result = await editChunk(model, chunk, { ...OPTIONS, instructions: 'British spelling', styleGuide: 'Use the serial comma.' });
    expect(result.edits).toEqual([
      { blockIndex: 0, original: 'Teh keeper climed the stairs.', revised: 'The keeper climbed the stairs.', note: 'Fixed two typos', flags: [] },
      // The model dropped the italics while fixing a typo: the italics are put back, the typo fix is kept.
      { blockIndex: 1, original: 'It was *very* dark, and he had forgoten the lamp.', revised: 'It was *very* dark, and he had forgotten the lamp.', note: 'Spelling', flags: [] },
    ]);
    const [system, user] = model.requests[0].messages;
    expect(system.content).toContain('British spelling');
    expect(system.content).toContain('Use the serial comma.');
    expect(system.content).toContain('written in English');
    expect(user.content).toContain('<p id="2">It was *very* dark, and he had forgoten the lamp.</p>');
    expect(model.requests[0].temperature).toBeLessThanOrEqual(0.2);
  });

  it('keeps the original for missing, unusable or cut-off paragraphs', async () => {
    const garbage = scripted(() => '<p id="1">Stairs.</p>\n<p id="3">Nothing wrong here.</p>');
    const result = await editChunk(garbage, chunkChapter([paragraph('Teh keeper climed all of the many winding stairs slowly.'), blocks[1], blocks[2]], { level: 'proofread' })[0], OPTIONS);
    expect(result).toMatchObject({ edits: [], discarded: 1, missing: 1 });

    const cutOff = scripted(() => '<p id="1">The keeper climbed the stairs.</p>\n<p id="2">It was *very* dark, and he had forgotten the', { finishReason: 'length' });
    const partial = await editChunk(cutOff, chunk, OPTIONS);
    expect(partial.edits.map((e) => e.blockIndex)).toEqual([0]);
    // Paragraph 2 was cut off mid-sentence and paragraph 3 never arrived: both keep the author's text.
    expect(partial.missing).toBe(2);
  });

  it('reports a reply in the wrong format as a retryable problem, and retries once', async () => {
    let calls = 0;
    const flaky = scripted(() => (++calls === 1 ? 'I am not sure what you mean.' : '<p id="1">The keeper climbed the stairs.</p>'));
    await expect(editChunk(scripted(() => 'nonsense'), chunk, OPTIONS)).rejects.toBeInstanceOf(AiError);
    const result = await withRetry(() => editChunk(flaky, chunk, OPTIONS));
    expect(calls).toBe(2);
    expect(result.edits).toHaveLength(1);
  });

  it('redoes one paragraph following a note', async () => {
    const model = scripted(() => '<p id="1">The keeper went up the stairs.</p><note id="1">simpler verb</note>');
    const redo = await regenerateParagraph(model, 'Teh keeper climed the stairs.', 'The keeper climbed the stairs.', 'simpler words please', { ...OPTIONS, level: 'line' });
    expect(redo).toEqual({ revised: 'The keeper went up the stairs.', note: 'Simpler verb', flags: [] });
    expect(model.requests[0].messages.at(-1)!.content).toContain('simpler words please');
    await expect(regenerateParagraph(scripted(() => 'no'), 'A b c.', 'A b c.', 'x', OPTIONS)).rejects.toThrow(/usable/);
  });

  it('adapts the rules to the book', () => {
    const messages = (o: Partial<EditOptions>) => buildEditMessages(chunk, { ...OPTIONS, ...o })[0].content;
    expect(messages({ language: 'es' })).toContain('written in Spanish');
    expect(messages({ bookType: 'children' })).toContain('young readers');
    expect(messages({ bookType: 'nonfiction' })).toContain('Do not alter claims');
    expect(messages({ level: 'line', strength: 'heavy' })).toContain('polish every sentence');
    expect(messages({ level: 'proofread', strength: 'light' })).toContain('only definite errors');
  });

  it('puts back italics a model dropped, even on real text', async () => {
    const result = await importFixture('novel.docx');
    const chapter = detectChapters(result.blocks, 'auto', result.meta).chapters[2];
    const item = chunkChapter(chapter.blocks, { level: 'proofread' })[0].items.find((i) => i.markup.includes('*'))!;
    const stripped = item.markup.replace(/\*/g, '').replace('letter', 'leter');
    expect(keepAuthorFormatting(item.markup, stripped)).toBe(item.markup.replace('letter', 'leter'));
  });
});

describe('reading a streamed reply', () => {
  it('assembles tokens across arbitrary chunk boundaries and reads speed and usage', () => {
    const tokens: string[] = [];
    const reader = new ChatStreamReader((t) => tokens.push(t));
    const stream =
      'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo é"}}]}\n\n' +
      ': ping\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3},"timings":{"predicted_per_second":42.5}}\n\n' +
      'data: [DONE]\n\n';
    for (let i = 0; i < stream.length; i += 7) reader.push(stream.slice(i, i + 7));
    expect(tokens.join('')).toBe('Hello é');
    expect(reader.result()).toEqual({ text: 'Hello é', promptTokens: 12, completionTokens: 3, tokensPerSecond: 42.5, finishReason: 'stop' });
    expect(reader.done).toBe(true);
    expect(() => new ChatStreamReader().push('data: {"error":{"message":"out of memory"}}\n')).toThrow(/out of memory/);
  });
});
