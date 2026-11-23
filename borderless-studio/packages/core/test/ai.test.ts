/**
 * The optional assistant, tested without any network: the host's http door
 * is replaced by a function that plays the part of the service.
 */
import { describe, expect, it } from 'vitest';
import {
  AssistantError, BookSchema, assistantAnswer, assistantRewrite, cleanReply, enforceDashPolicy, houseStyle, listOllamaModels, rewritePrompt,
  type AssistantConfig, type Host, type HttpRequest, type HttpResponse,
} from '../src';

const book = BookSchema.parse({ id: 'bk_test', title: 'Test', contributors: [{ name: 'A. Writer', role: 'author' }], language: 'en-AU' });
const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponse => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function fakeHost(answer: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>): { host: Host; calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  const host = {
    kind: 'node', os: 'linux',
    http: async (req: HttpRequest) => {
      calls.push(req);
      return answer(req);
    },
  } as unknown as Host;
  return { host, calls };
}

const claude: AssistantConfig = { provider: 'claude', ollamaUrl: '', ollamaModel: '', claudeModel: 'claude-opus-5-5', claudeApiKey: 'sk-ant-test-key' };
const ollama: AssistantConfig = { provider: 'ollama', ollamaUrl: 'http://localhost:11434/', ollamaModel: 'llama3.2', claudeModel: '', claudeApiKey: '' };
const message = (text: string, extra: Record<string, unknown> = {}) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
  stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 30 }, ...extra,
});

describe('prompts', () => {
  it('describe the house style of the book, including the dash rule', () => {
    const style = houseStyle(book);
    expect(style).toContain('Australian English');
    expect(style).toMatch(/does not use em dashes or en dashes/);
    const allowed = BookSchema.parse({ ...book, style: { ...book.style, dashPolicy: { mode: 'allow' } } });
    expect(houseStyle(allowed)).not.toMatch(/dashes/);
    const bangla = BookSchema.parse({ ...book, language: 'bn' });
    expect(houseStyle(bangla)).toContain('Bangla');
  });

  it('send the passage and one instruction', () => {
    const p = rewritePrompt(book, 'proofread', '', '  Some text.  ');
    expect(p.user).toBe(`Instruction: Correct mistakes in spelling, grammar and punctuation. Leave everything that is already correct exactly as it is, including sentences you would have written differently.\n\n<passage>\nSome text.\n</passage>`);
    expect(p.system).toMatch(/tracked change/);
    expect(rewritePrompt(book, 'custom', 'Make it formal.', 'x').user).toMatch(/^Instruction: Make it formal\./);
  });

  it('unwrap replies and enforce the dash rule where the author had no dash', () => {
    expect(cleanReply('<think>hmm</think>\n<passage>\nFixed text.\n</passage>')).toBe('Fixed text.');
    expect(cleanReply('```\nFixed text.\n```')).toBe('Fixed text.');
    const policy = book.style.dashPolicy;
    expect(enforceDashPolicy('He came late and left early.', 'He came late \u2014 and left early.', policy)).toBe('He came late, and left early.');
    expect(enforceDashPolicy('Pages 3 to 9.', 'Pages 3\u20139.', policy)).toBe('Pages 3-9.');
    // A paragraph that already had a dash is the author's to review.
    expect(enforceDashPolicy('He came \u2014 late.', 'He came \u2014 very late.', policy)).toBe('He came \u2014 very late.');
    expect(enforceDashPolicy('A.', 'A \u2014 b.', { ...policy, mode: 'allow' })).toBe('A \u2014 b.');
  });
});

describe('Claude', () => {
  it('sends one request through the host and turns the answer into tracked changes', async () => {
    const { host, calls } = fakeHost(() => json(200, message('This sentence has a wrong word.')));
    const out = await assistantRewrite(host, claude, book, 'proofread', '', 'Thiss sentense has a wrng word.');
    expect(out.suggestion).toEqual({ ok: true, changes: 2, markup: '{~~Thiss sentense~>This sentence~~}{>>@ai<<} has a {~~wrng~>wrong~~}{>>@ai<<} word.' });
    expect(out.reply).toMatchObject({ model: 'claude-opus-5-5', inputTokens: 120, outputTokens: 30 });
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(req.method).toBe('POST');
    // The SDK decides how the key travels (x-api-key or Authorization); it must be in one of them and nowhere else.
    expect(`${req.headers?.['x-api-key'] ?? ''} ${req.headers?.authorization ?? ''}`).toContain('sk-ant-test-key');
    expect(req.url + req.body).not.toContain('sk-ant-test-key');
    expect(req.headers?.['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
    const body = JSON.parse(req.body!);
    expect(body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, fallbacks: 'default' });
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining('<passage>\nThiss sentense has a wrng word.\n</passage>') }]);
    expect(body.system).toContain('Australian English');
    expect(body.temperature).toBeUndefined();
  });

  it('leaves the fallback out for a model that has none, and falls back to the default for an unknown model name', async () => {
    const { host, calls } = fakeHost(() => json(200, message('Fine.', { model: 'claude-haiku-5-5' })));
    await assistantRewrite(host, { ...claude, claudeModel: 'claude-haiku-5-5' }, book, 'tighten', '', 'Fine.');
    expect(JSON.parse(calls[0].body!).fallbacks).toBeUndefined();
    expect(calls[0].headers?.['anthropic-beta'] ?? '').not.toContain('server-side-fallback');
    await assistantRewrite(host, { ...claude, claudeModel: 'something-else' }, book, 'tighten', '', 'Fine.');
    expect(JSON.parse(calls[1].body!).model).toBe('claude-opus-5-5');
  });

  it('explains a wrong key, a busy service and a declined request in plain words', async () => {
    const error = (type: string, text: string) => ({ type: 'error', error: { type, message: text } });
    const wrongKey = fakeHost(() => json(401, error('authentication_error', 'invalid x-api-key'), { 'x-should-retry': 'false' }));
    await expect(assistantRewrite(wrongKey.host, claude, book, 'smooth', '', 'Text.')).rejects.toThrow(/API key was not accepted/);
    const busy = fakeHost(() => json(429, error('rate_limit_error', 'slow down'), { 'x-should-retry': 'false' }));
    await expect(assistantRewrite(busy.host, claude, book, 'smooth', '', 'Text.')).rejects.toMatchObject({ problem: 'busy' });
    const refused = fakeHost(() => json(200, message('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'Not something I can help with.' }, content: [] })));
    await expect(assistantRewrite(refused.host, claude, book, 'smooth', '', 'Text.')).rejects.toThrow(/declined this request\. Not something I can help with\. Your text was not changed/);
    const cut = fakeHost(() => json(200, message('Half an ans', { stop_reason: 'max_tokens' })));
    await expect(assistantRewrite(cut.host, claude, book, 'smooth', '', 'Text.')).rejects.toMatchObject({ problem: 'too-long' });
    const noKey = fakeHost(() => json(200, message('x')));
    await expect(assistantRewrite(noKey.host, { ...claude, claudeApiKey: '' }, book, 'smooth', '', 'Text.')).rejects.toMatchObject({ problem: 'no-key' });
    expect(noKey.calls).toHaveLength(0);
  });

  it('sends nothing when the request could not be used anyway', async () => {
    const { host, calls } = fakeHost(() => json(200, message('x')));
    await expect(assistantRewrite(host, claude, book, 'proofread', '', 'A {++pending++} change.')).rejects.toThrow(/already has tracked changes/);
    await expect(assistantRewrite(host, claude, book, 'custom', '  ', 'Text.')).rejects.toThrow(/Type what you want done/);
    await expect(assistantRewrite(host, claude, book, 'proofread', '', 'word '.repeat(2501))).rejects.toThrow(/at most 2,500 words/);
    await expect(assistantRewrite(host, claude, book, 'proofread', '', '   ')).rejects.toBeInstanceOf(AssistantError);
    expect(calls).toHaveLength(0);
  });

  it('reports a proposal whose paragraphs do not line up instead of applying it', async () => {
    const { host } = fakeHost(() => json(200, message('One. Two.')));
    const out = await assistantRewrite(host, claude, book, 'smooth', '', 'One.\n\nTwo.');
    expect(out.suggestion).toMatchObject({ ok: false, reason: 'paragraphs' });
    expect(out.proposed).toBe('One. Two.');
  });

  it('answers a question about a passage', async () => {
    const { host, calls } = fakeHost(() => json(200, message('The second sentence repeats "late".')));
    const reply = await assistantAnswer(host, claude, book, 'What is weak here?', 'It was late. It was very late.');
    expect(reply.text).toBe('The second sentence repeats "late".');
    expect(JSON.parse(calls[0].body!).messages[0].content).toMatch(/^What is weak here\?\n\n<passage>/);
    // Pending suggestions and comments are not part of what is asked about.
    await assistantAnswer(host, claude, book, 'And now?', 'It was {~~late~>early~~}{>>@ai<<}.{>>a note<<}');
    expect(JSON.parse(calls[1].body!).messages[0].content).toContain('<passage>\nIt was late.\n</passage>');
  });
});

describe('Ollama', () => {
  it('talks to the program on this computer only', async () => {
    const { host, calls } = fakeHost((req) =>
      req.url.endsWith('/api/tags')
        ? json(200, { models: [{ name: 'qwen3:8b' }, { name: 'llama3.2:latest' }] })
        : json(200, { model: 'llama3.2', message: { role: 'assistant', content: '<think>check</think>It was late.' }, done: true, prompt_eval_count: 50, eval_count: 9 }));
    expect(await listOllamaModels(host, ollama.ollamaUrl)).toEqual(['llama3.2:latest', 'qwen3:8b']);
    const out = await assistantRewrite(host, ollama, book, 'tighten', '', 'It was very late.');
    expect(out.suggestion).toMatchObject({ ok: true, changes: 1, markup: 'It was {--very --}{>>@ai<<}late.' });
    const chat = calls[1];
    expect(chat.url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(chat.body!)).toMatchObject({ model: 'llama3.2', stream: false, messages: [{ role: 'system' }, { role: 'user' }] });
  });

  it('says what to do when Ollama is not running or the model is not installed', async () => {
    const down = fakeHost(() => { throw new Error('connection refused'); });
    await expect(listOllamaModels(down.host, '')).rejects.toThrow(/Start the Ollama program/);
    await expect(assistantRewrite(down.host, ollama, book, 'tighten', '', 'Text.')).rejects.toThrow(/Start the Ollama program/);
    const missing = fakeHost(() => json(404, { error: "model 'llama3.2' not found, try pulling it first" }));
    await expect(assistantRewrite(missing.host, ollama, book, 'tighten', '', 'Text.')).rejects.toThrow(/ollama pull llama3\.2/);
  });
});
