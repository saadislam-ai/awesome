import type { ChatMessage } from '../ai/provider';
import { languageName } from '../text/language';
import type { Chunk, EditOptions } from './types';

const BOOK_TYPE: Record<EditOptions['bookType'], string> = {
  fiction: 'a work of fiction',
  nonfiction: 'a non-fiction book',
  children: "a children's book",
};

const LEVEL_RULES: Record<EditOptions['level'], Record<EditOptions['strength'], string[]>> = {
  proofread: {
    light: [
      'Correct only definite errors: misspellings, typos, missing or doubled words, wrong punctuation, wrong capitalization.',
      'Do not change word choice, style, or sentence structure. Leave anything that is merely unusual as it is.',
    ],
    medium: [
      'Correct spelling, typos, grammar, punctuation, capitalization and missing or doubled words.',
      'Do not change word choice, style, or sentence structure unless a sentence is grammatically wrong.',
    ],
    heavy: [
      'Correct every spelling, grammar, punctuation, capitalization and agreement error, including subtle ones such as tense slips and dangling modifiers.',
      'Do not rephrase for style. Change wording only where grammar requires it.',
    ],
  },
  line: {
    light: [
      'Fix errors, and smooth only sentences that are clearly awkward, wordy or unclear.',
      'Most sentences should come back unchanged.',
    ],
    medium: [
      'Fix errors and improve clarity, flow and word choice: tighten wordy phrasing, remove needless repetition, replace weak or vague words, fix awkward rhythm.',
      'Leave sentences that already work exactly as they are.',
    ],
    heavy: [
      'Fix errors and polish every sentence that can be stronger: tighten, vary rhythm, sharpen word choice, remove repetition and filler.',
      'Keep every idea, event and detail. Do not summarise and do not add new content.',
    ],
  },
};

/** Builds the instructions and the passage for one request to the model. */
export function buildEditMessages(chunk: Chunk, options: EditOptions): ChatMessage[] {
  const language = options.language && options.language !== 'und' ? languageName(options.language) : '';
  const rules = [
    ...LEVEL_RULES[options.level][options.strength],
    "Preserve the author's voice, tone, meaning and point of view. This is the author's book, not yours.",
    'Never change names, numbers, dates, facts, or what happens. Never add new information.',
    language
      ? `The text is written in ${language}. Keep it in ${language} and follow ${language} spelling and punctuation conventions. Do not translate.`
      : 'Keep the text in its original language. Do not translate.',
    'Keep the formatting marks exactly as they are used: *italic*, **bold**. Keep dialogue punctuation style as the author uses it.',
    'Return every paragraph, in the same order, with the same id. Never merge, split, add or drop paragraphs.',
  ];
  if (options.bookType === 'children') rules.push('This is for young readers: keep words and sentences simple. Do not make the language more advanced.');
  if (options.bookType === 'nonfiction') rules.push('Do not alter claims, figures, quotations or citations.');

  const custom = [options.styleGuide?.trim(), options.instructions?.trim()].filter(Boolean).join('\n');

  const system = [
    `You are a professional ${options.level === 'proofread' ? 'proofreader' : 'line editor'} working on ${BOOK_TYPE[options.bookType]} for a publisher.`,
    '',
    'Rules:',
    ...rules.map((rule) => `- ${rule}`),
    ...(options.bible?.trim() ? ['', 'Facts about this book. Keep every edit consistent with them:', options.bible.trim()] : []),
    ...(custom ? ['', "The publisher's own rules for this book. Follow them even where they differ from your habits:", custom] : []),
    '',
    'Reply format. For each paragraph give the corrected text and then a note of at most 12 words saying what you changed. If a paragraph needs no change, repeat it exactly and write "no change". Output nothing else.',
    '',
    'Example input:',
    '<p id="1">She dont know were the keys was, so she looked every where.</p>',
    '<p id="2">The house was quiet.</p>',
    '',
    'Example output:',
    '<p id="1">She didn\'t know where the keys were, so she looked everywhere.</p>',
    '<note id="1">fixed grammar and spelling</note>',
    '<p id="2">The house was quiet.</p>',
    '<note id="2">no change</note>',
  ].join('\n');

  const user = [
    ...(chunk.contextBefore ? ['For context only, the text just before this passage (do not edit or repeat it):', chunk.contextBefore, ''] : []),
    `${options.level === 'proofread' ? 'Proofread' : 'Edit'} these ${chunk.items.length === 1 ? 'paragraph' : `${chunk.items.length} paragraphs`}:`,
    ...chunk.items.map((item) => `<p id="${item.n}">${item.markup}</p>`),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** A generous output limit for a passage: the reply repeats the text and adds notes. */
export function replyTokenLimit(chunk: Chunk): number {
  const characters = chunk.items.reduce((n, item) => n + item.markup.length, 0);
  // Roughly one token per three characters in the worst case, plus tags and notes.
  return Math.min(8192, Math.ceil(characters / 2.6) + chunk.items.length * 40 + 200);
}

/** Instructions for redoing one paragraph with a note from the publisher. */
export function buildRegenerateMessages(original: string, previous: string, note: string, options: EditOptions): ChatMessage[] {
  const base = buildEditMessages({ items: [{ n: 1, blockIndex: 0, markup: original }], contextBefore: '', words: 0 }, options);
  return [
    ...base,
    { role: 'assistant', content: `<p id="1">${previous}</p>\n<note id="1">edited</note>` },
    {
      role: 'user',
      content: `The publisher was not happy with that version and says: "${note.trim()}"\nEdit the original paragraph again, following this request, in the same reply format.`,
    },
  ];
}
