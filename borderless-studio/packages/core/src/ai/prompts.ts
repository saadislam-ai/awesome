/**
 * What the optional assistant is asked to do, and in which house style.
 *
 * The assistant only ever sees the passage the author selected and one
 * instruction. Its answer is compared with the original and shown as tracked
 * changes (see diff.ts); it never edits the manuscript by itself.
 */
import type { Book, DashPolicy } from '../model/book';

export type RewriteTask = 'proofread' | 'tighten' | 'smooth' | 'custom';

export const REWRITE_TASKS: Record<Exclude<RewriteTask, 'custom'>, { label: string; hint: string; instruction: string }> = {
  proofread: {
    label: 'Proofread',
    hint: 'Spelling, grammar and punctuation only',
    instruction: 'Correct mistakes in spelling, grammar and punctuation. Leave everything that is already correct exactly as it is, including sentences you would have written differently.',
  },
  tighten: {
    label: 'Tighten',
    hint: 'Cut words that do no work',
    instruction: 'Tighten the passage: take out words, phrases and repetitions that carry no meaning. What it says, and how it sounds, should stay the same.',
  },
  smooth: {
    label: 'Smooth',
    hint: 'Help sentences that stumble',
    instruction: 'Where a sentence stumbles or is hard to follow, rework it so it reads easily. Sentences that already read well stay as they are.',
  },
};

const LANGUAGE: Record<string, string> = { 'en-AU': 'Australian English', 'en-GB': 'British English', 'en-US': 'American English', 'en-NZ': 'New Zealand English', 'en-CA': 'Canadian English', bn: 'Bangla', 'bn-BD': 'Bangla', 'bn-IN': 'Bangla' };
const EM_DASH: Record<DashPolicy['emDashReplacement'], { words: string; text: string }> = {
  comma: { words: 'a comma', text: ', ' },
  'spaced-hyphen': { words: 'a hyphen with a space on each side', text: ' - ' },
  colon: { words: 'a colon', text: ': ' },
  ellipsis: { words: 'an ellipsis', text: '... ' },
};

/** The book's house style in a few plain sentences. */
export function houseStyle(book: Book): string {
  const style = book.style;
  const english = /^en/i.test(book.language);
  const lines: string[] = [];
  const language = LANGUAGE[english ? style.spelling : book.language] ?? LANGUAGE[book.language.split('-')[0]] ?? book.language;
  lines.push(english ? `The book is written in ${language}; use its spellings.` : `The book is written in ${language}; answer in the same language and script.`);
  if (english) lines.push(`Quotations use ${style.quoteStyle} quotation marks. Keep the kind of quotation marks and apostrophes (straight or curly) that the passage already uses.`);
  if (style.dashPolicy.mode !== 'allow') {
    lines.push(`The author does not use em dashes or en dashes anywhere. Never add one. Where you would reach for a dash, use ${EM_DASH[style.dashPolicy.emDashReplacement].words}, or recast the sentence.`);
  }
  return lines.join(' ');
}

export interface AssistantPrompt {
  system: string;
  user: string;
}

/** A request to revise a passage. The answer must be the passage only, so that it can be compared word by word. */
export function rewritePrompt(book: Book, task: RewriteTask, customInstruction: string, passage: string): AssistantPrompt {
  const instruction = task === 'custom' ? customInstruction.trim() : REWRITE_TASKS[task].instruction;
  const system = [
    'You are helping an author revise a passage of their own book inside a writing app. You receive the passage and one instruction.',
    'Reply with the revised passage and nothing else. The app compares your reply with the original word by word and shows the author each difference as a tracked change to accept or reject, so anything else you write (a greeting, an explanation, quotation marks or a code fence around the passage) would appear as text you want to add to the book.',
    'Change only what the instruction calls for. The voice, the word choices and the rhythm belong to the author. If nothing needs to change, reply with the passage exactly as it is.',
    'Keep the structure: the same paragraphs in the same order, separated by blank lines as in the original. The passage is Markdown, so keep markers such as *italics*, **bold**, footnote references like [^n3] and scene breaks (***) where they are.',
    houseStyle(book),
  ].join('\n\n');
  return { system, user: `Instruction: ${instruction}\n\n<passage>\n${passage.trim()}\n</passage>` };
}

/** A question about a passage. The answer is shown beside the text and can be kept as a comment. */
export function askPrompt(book: Book, question: string, passage: string): AssistantPrompt {
  const system = [
    'You are a careful, kind editor. An author shows you a passage from their own book and asks a question about it.',
    'Answer in plain words and briefly: a short paragraph, or a few short points when there are several things to say. When you refer to the text, quote a few of its words so the author can find the place. Do not rewrite the passage unless the author asks for that.',
    houseStyle(book),
  ].join('\n\n');
  return { system, user: `${question.trim()}\n\n<passage>\n${passage.trim()}\n</passage>` };
}

/**
 * The passage out of a reply: models sometimes wrap their answer in the
 * tags of the request, in a code fence, or put their reasoning in front of
 * it inside <think> tags (some local models do).
 */
export function cleanReply(reply: string): string {
  let text = reply.replace(/\r\n?/g, '\n').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const tagged = /<passage>\n?([\s\S]*?)\n?<\/passage>/i.exec(text);
  if (tagged) text = tagged[1].trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  return text;
}

/**
 * A safety net for the dash rule: a model may still slip a dash in. In a
 * paragraph that had no dash before, any dash in the proposal is replaced by
 * what the book's settings name. Paragraphs that already had dashes are left
 * to the author's own review.
 */
export function enforceDashPolicy(original: string, revised: string, policy: DashPolicy): string {
  if (policy.mode === 'allow') return revised;
  const before = original.trim().split(/\n[ \t]*\n\s*/);
  const after = revised.trim().split(/\n[ \t]*\n\s*/);
  if (before.length !== after.length) return revised;
  const em = EM_DASH[policy.emDashReplacement].text;
  const fixed = after.map((paragraph, i) => {
    if (/[\u2012-\u2015]/.test(before[i]) || !/[\u2012-\u2015]/.test(paragraph)) return paragraph;
    return paragraph
      .replace(/(\d)\s*[\u2012\u2013]\s*(\d)/g, policy.enDashRangeReplacement === 'to' ? '$1 to $2' : '$1-$2')
      .replace(/\s*[\u2012-\u2015]\s*/g, em)
      .replace(/ {2,}/g, ' ');
  });
  return fixed.join('\n\n');
}
