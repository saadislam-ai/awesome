import { AiError, isAbort, type AiProvider, type ChatOptions } from '../ai/provider';
import { applyDecisions, diffText, type ChangeKind, type Decisions, type Hunk } from './diff';
import { checkRevision, isUsableRevision } from './gates';
import { isNoChangeNote, parseEditReply } from './parse';
import { buildEditMessages, buildRegenerateMessages, replyTokenLimit } from './prompt';
import type { Chunk, ChunkResult, EditOptions, ParagraphEdit } from './types';

const TEMPERATURE: Record<EditOptions['level'], number> = { proofread: 0.1, line: 0.3 };

function tidyNote(note: string): string {
  const text = note.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!text || isNoChangeNote(text)) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const KIND_PHRASES: Record<ChangeKind, string> = {
  spelling: 'spelling',
  punctuation: 'punctuation',
  capitalization: 'capitalization',
  spacing: 'spacing',
  formatting: 'formatting',
  wording: 'grammar or wording',
  cut: 'removed words',
  addition: 'added words',
  rewrite: 'rephrased',
};

/** A plain description of a set of changes, used when the model gave no reason of its own. */
export function describeChanges(hunks: Hunk[]): string {
  const kinds = [...new Set(hunks.map((h) => h.kind))];
  if (!kinds.length) return '';
  const text = kinds.map((k) => KIND_PHRASES[k]).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * An editing model sometimes drops the author's italics or bold while fixing
 * something else. Formatting is not the model's to change, so those losses
 * are undone here and every other change is kept.
 */
export function keepAuthorFormatting(original: string, revised: string): string {
  const hunks = diffText(original, revised);
  if (!hunks.some((h) => h.kind === 'formatting')) return revised;
  const decisions: Decisions = {};
  for (const hunk of hunks) decisions[hunk.index] = hunk.kind === 'formatting' ? 'reject' : 'accept';
  return applyDecisions(original, hunks, decisions);
}

function toEdit(blockIndex: number, original: string, reply: string, note: string, options: EditOptions): ParagraphEdit | null {
  const revised = keepAuthorFormatting(original, reply);
  if (revised === original) return null;
  return {
    blockIndex,
    original,
    revised,
    note: tidyNote(note) || describeChanges(diffText(original, revised)),
    flags: checkRevision(original, revised, options.level, options.strength, options.names),
  };
}

/**
 * Sends one passage to the model and turns the reply into proposed edits.
 * Nothing here changes the book: the result is a list of suggestions.
 */
export async function editChunk(provider: AiProvider, chunk: Chunk, options: EditOptions, chat: ChatOptions = {}): Promise<ChunkResult> {
  const reply = await provider.chat(
    { messages: buildEditMessages(chunk, options), temperature: TEMPERATURE[options.level], maxTokens: replyTokenLimit(chunk) },
    chat,
  );
  const lineBreaks = new Set(chunk.items.filter((item) => item.markup.includes('\n')).map((item) => item.n));
  const parsed = parseEditReply(reply.text, lineBreaks);
  if (!parsed.size && chunk.items.length) {
    throw new AiError('The model did not reply in the expected format.', true);
  }

  const edits: ParagraphEdit[] = [];
  let discarded = 0;
  let missing = 0;
  // A reply cut off by the token limit ends mid-paragraph: its last paragraph cannot be trusted.
  const cutOffId = reply.finishReason === 'length' ? Math.max(...parsed.keys()) : -1;
  for (const item of chunk.items) {
    const entry = parsed.get(item.n);
    if (!entry || item.n === cutOffId) {
      missing++;
      continue;
    }
    if (entry.text === item.markup) continue;
    if (!isUsableRevision(item.markup, entry.text)) {
      discarded++;
      continue;
    }
    const edit = toEdit(item.blockIndex, item.markup, entry.text, entry.note, options);
    if (edit) edits.push(edit);
  }
  return { edits, discarded, missing, completionTokens: reply.completionTokens ?? 0, tokensPerSecond: reply.tokensPerSecond };
}

/** Asks the model to redo one paragraph, following a note from the publisher. */
export async function regenerateParagraph(
  provider: AiProvider,
  original: string,
  previous: string,
  note: string,
  options: EditOptions,
  chat: ChatOptions = {},
): Promise<{ revised: string; note: string; flags: ParagraphEdit['flags'] }> {
  const reply = await provider.chat(
    { messages: buildRegenerateMessages(original, previous, note, options), temperature: 0.5, maxTokens: Math.ceil(original.length / 2.2) + 300 },
    chat,
  );
  const entry = parseEditReply(reply.text, original.includes('\n') ? new Set([1]) : new Set()).get(1);
  if (!entry || !isUsableRevision(original, entry.text)) {
    throw new AiError('The model did not produce a usable new version. The previous suggestion was kept.');
  }
  const edit = toEdit(0, original, entry.text, entry.note, options);
  if (!edit) throw new AiError('The model returned the paragraph unchanged. The previous suggestion was kept.');
  return { revised: edit.revised, note: edit.note, flags: edit.flags };
}

/** Runs `action`, trying once more when the failure is the kind that may pass. */
export async function withRetry<T>(action: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await action();
    } catch (e) {
      if (isAbort(e)) throw e;
      last = e;
      if (!(e instanceof AiError) || !e.retryable) break;
    }
  }
  throw last;
}
