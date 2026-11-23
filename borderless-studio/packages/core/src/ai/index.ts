/**
 * The optional writing assistant. Off unless the author switches it on in
 * Settings. Two back ends: Ollama (a model running on this computer) and
 * Claude (Anthropic's API, with the author's own key).
 *
 * The assistant never changes the manuscript by itself. A revision comes
 * back as tracked changes the author accepts or rejects one by one; an
 * answer to a question is shown beside the text.
 */
import type { Host } from '../host';
import { applyAllChanges } from '../markdown/critic';
import type { Book } from '../model/book';
import { askClaude } from './claude';
import { suggestionMarkup, type SuggestResult } from './diff';
import { askOllama } from './ollama';
import { askPrompt, cleanReply, enforceDashPolicy, rewritePrompt, type AssistantPrompt, type RewriteTask } from './prompts';
import { AssistantError, type AssistantReply } from './types';

export * from './types';
export * from './prompts';
export { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, claudeModel } from './claude';
export { listOllamaModels } from './ollama';

/** What is needed to reach the chosen back end. The API key comes from the system keychain, not from a settings file. */
export interface AssistantConfig {
  provider: 'ollama' | 'claude';
  ollamaUrl: string;
  ollamaModel: string;
  claudeModel: string;
  claudeApiKey: string;
}

/** A passage longer than this is refused up front: the answer would not fit in one reply. About eight book pages. */
export const MAX_PASSAGE_WORDS = 2500;

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

export async function askAssistant(host: Host, config: AssistantConfig, prompt: AssistantPrompt): Promise<AssistantReply> {
  const reply =
    config.provider === 'claude'
      ? await askClaude(host, { apiKey: config.claudeApiKey, model: config.claudeModel, ...prompt })
      : await askOllama(host, { url: config.ollamaUrl, model: config.ollamaModel, ...prompt });
  if (!reply.text.trim()) throw new AssistantError('empty', 'The assistant sent back an empty answer. Try again, or try another model.');
  return reply;
}

export interface RewriteOutcome {
  suggestion: SuggestResult;
  /** The assistant's text, shown when it could not be turned into tracked changes. */
  proposed: string;
  reply: AssistantReply;
}

/** Ask for a revision of a passage and turn the answer into tracked changes. */
export async function assistantRewrite(host: Host, config: AssistantConfig, book: Book, task: RewriteTask, instruction: string, passage: string): Promise<RewriteOutcome> {
  if (!passage.trim()) throw new AssistantError('request', 'Select the text you want help with first.');
  if (task === 'custom' && !instruction.trim()) throw new AssistantError('request', 'Type what you want done with the selected text.');
  const words = wordCount(passage);
  if (words > MAX_PASSAGE_WORDS) throw new AssistantError('too-long', `The selection has ${words.toLocaleString('en-AU')} words. Select at most ${MAX_PASSAGE_WORDS.toLocaleString('en-AU')} words at a time (about a scene).`);
  // Checked before anything is sent, so no request is paid for that cannot be used.
  const before = suggestionMarkup(passage, passage);
  if (!before.ok) throw new AssistantError('request', before.message);
  const reply = await askAssistant(host, config, rewritePrompt(book, task, instruction, passage));
  const proposed = enforceDashPolicy(passage, cleanReply(reply.text), book.style.dashPolicy);
  return { suggestion: suggestionMarkup(passage, proposed), proposed, reply };
}

/** Ask a question about a passage. The answer is plain text for the author to read. */
export async function assistantAnswer(host: Host, config: AssistantConfig, book: Book, question: string, passage: string): Promise<AssistantReply> {
  if (!question.trim()) throw new AssistantError('request', 'Type your question first.');
  if (!passage.trim()) throw new AssistantError('request', 'Select the text your question is about first.');
  const words = wordCount(passage);
  if (words > MAX_PASSAGE_WORDS * 4) throw new AssistantError('too-long', `The selection has ${words.toLocaleString('en-AU')} words. Select at most ${(MAX_PASSAGE_WORDS * 4).toLocaleString('en-AU')} words for a question.`);
  // The question is about the text as it reads now: suggestions that are still pending, and comments, are left out.
  const reading = applyAllChanges(passage, false, true);
  const reply = await askAssistant(host, config, askPrompt(book, question, reading));
  return { ...reply, text: cleanReply(reply.text) };
}
