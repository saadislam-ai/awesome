import { AiError, type AiProvider, type ChatMessage, type ChatOptions } from '../ai/provider';
import { blockText, type Block } from '../model/blocks';
import { languageName } from '../text/language';
import { countWords } from '../text/words';
import type { BibleCharacter, SegmentNotes } from './bible';
import type { BookStats, IssueCategory, Severity } from './types';

export type BookKind = 'fiction' | 'nonfiction' | 'children';

/** One stretch of a chapter that is read by the model in a single request. */
export interface Segment {
  chapterId: string;
  chapterTitle: string;
  /** 1-based number of the chapter among the chapters analysed. */
  chapterNumber: number;
  part: number;
  parts: number;
  /** Paragraphs with the index of the block each came from. */
  paragraphs: { index: number; text: string }[];
  words: number;
}

export const DEFAULT_SEGMENT_WORDS = 1200;

/** Cuts a chapter into stretches of whole paragraphs that fit comfortably in the model's memory. */
export function segmentChapter(chapter: { id: string; title: string; blocks: Block[] }, chapterNumber: number, maxWords = DEFAULT_SEGMENT_WORDS): Segment[] {
  const groups: { index: number; text: string }[][] = [[]];
  let words = 0;
  chapter.blocks.forEach((block, index) => {
    if (block.type === 'break') return;
    const text = blockText(block).trim();
    if (!text) return;
    const count = countWords(text);
    if (words && words + count > maxWords) {
      groups.push([]);
      words = 0;
    }
    groups[groups.length - 1].push({ index, text: block.type === 'heading' ? `[Heading] ${text}` : text });
    words += count;
  });
  const filled = groups.filter((g) => g.length);
  return filled.map((paragraphs, i) => ({
    chapterId: chapter.id, chapterTitle: chapter.title, chapterNumber, part: i + 1, parts: filled.length, paragraphs,
    words: paragraphs.reduce((n, p) => n + countWords(p.text), 0),
  }));
}

const ISSUE_TYPES: Record<BookKind, IssueCategory[]> = {
  fiction: ['continuity', 'plot-hole', 'pov-slip', 'show-tell', 'weak-opening', 'weak-ending', 'pacing', 'character', 'clarity'],
  nonfiction: ['clarity', 'needs-evidence', 'missing-example', 'chapter-repetition', 'structure', 'gap', 'weak-opening', 'weak-ending'],
  children: ['age-fit', 'read-aloud', 'hard-word', 'clarity', 'pacing', 'weak-opening', 'weak-ending'],
};

const ISSUE_GUIDE: Record<BookKind, string> = {
  fiction:
    'continuity (contradicts something established earlier), plot-hole (events that do not follow), pov-slip (the narration knows what the viewpoint character cannot), show-tell (emotion or character stated flatly where a scene would serve better), weak-opening or weak-ending (only for the very start or end of a chapter), pacing (drags or rushes), character (acts out of character without reason), clarity (hard to follow)',
  nonfiction:
    'clarity (a claim or passage that is hard to follow), needs-evidence (a claim stated without support), missing-example (an abstract point that needs an example or story), chapter-repetition (repeats a point already made earlier), structure (material in the wrong place or order), gap (a step in the argument is missing), weak-opening or weak-ending (only for the very start or end of a chapter)',
  children:
    'age-fit (content or ideas wrong for the age group), read-aloud (awkward to read aloud), hard-word (a word too hard for the age group), clarity (confusing for a child), pacing (drags or rushes), weak-opening or weak-ending (only for the very start or end)',
};

const text = (max: number) => ({ type: 'string', maxLength: max });

function segmentSchema(kind: BookKind): Record<string, unknown> {
  const named = (fields: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: fields, required, additionalProperties: false });
  const properties: Record<string, unknown> = {
    summary: text(400),
    characters: { type: 'array', maxItems: 8, items: named({ name: text(60), aliases: { type: 'array', maxItems: 3, items: text(40) }, description: text(160) }, ['name', 'aliases', 'description']) },
    terms: { type: 'array', maxItems: 5, items: named({ term: text(50), meaning: text(140) }, ['term', 'meaning']) },
    tension: { type: 'integer', minimum: 1, maximum: 10 },
    pace: { type: 'string', enum: ['slow', 'steady', 'fast'] },
    issues: {
      type: 'array', maxItems: 5,
      items: named({ type: { type: 'string', enum: ISSUE_TYPES[kind] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, quote: text(140), problem: text(240), suggestion: text(200) }, ['type', 'severity', 'quote', 'problem', 'suggestion']),
    },
  };
  if (kind !== 'nonfiction') {
    properties.relationships = { type: 'array', maxItems: 5, items: named({ a: text(60), b: text(60), relation: text(80) }, ['a', 'b', 'relation']) };
    properties.settings = { type: 'array', maxItems: 4, items: named({ name: text(60), description: text(140) }, ['name', 'description']) };
    properties.events = { type: 'array', maxItems: 5, items: named({ when: text(50), what: text(160) }, ['when', 'what']) };
    properties.pov = text(80);
    properties.tense = { type: 'string', enum: ['past', 'present', 'mixed'] };
  }
  return named(properties, Object.keys(properties));
}

export interface SegmentContext {
  kind: BookKind;
  language: string;
  bookTitle: string;
  /** Short summaries of what came before, oldest first. */
  storySoFar: string[];
  knownCharacters: BibleCharacter[];
  instructions?: string;
}

const EDITOR: Record<BookKind, string> = {
  fiction: 'an experienced developmental editor of fiction',
  nonfiction: 'an experienced developmental editor of non-fiction',
  children: "an experienced editor of children's books",
};

function fitWords(parts: string[], maxWords: number): string[] {
  // Keep the most recent material when everything does not fit.
  const out: string[] = [];
  let words = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const count = parts[i].split(/\s+/).length;
    if (words + count > maxWords && out.length) break;
    out.unshift(parts[i]);
    words += count;
  }
  return out;
}

export function buildSegmentRequest(segment: Segment, context: SegmentContext): { messages: ChatMessage[]; schema: Record<string, unknown> } {
  const language = context.language !== 'und' ? languageName(context.language) : 'its original language';
  const fiction = context.kind !== 'nonfiction';
  const system = [
    `You are ${EDITOR[context.kind]}, reading a manuscript for a publisher and taking notes. The manuscript is in ${language}.`,
    'Be specific and honest. Do not flatter and do not invent problems: report an issue only when you can point to the words that show it.',
    'Most passages have no issues or one. An empty list of issues is a good answer for sound writing. Never report a problem just to have something to report.',
    'Write your notes in English. Quote the manuscript exactly, in its own language, using at most twelve consecutive words copied from the passage.',
    'Reply with one JSON object and nothing else.',
  ].join('\n');

  const soFar = fitWords(context.storySoFar, 320);
  const known = context.knownCharacters.slice(0, 16).map((c) => (c.description ? `${c.name}: ${c.description.split('.')[0].slice(0, 90)}` : c.name));
  const fields = [
    '"summary": what happens or is argued in this passage, in two or three sentences.',
    fiction ? '"characters": every named character who appears, with any other names used for them and one line of description. Use the same name for a character already known.' : '"characters": people or organisations that matter to the argument, with one line on who they are.',
    ...(fiction
      ? [
          '"relationships": how characters are related, where the passage shows it.',
          '"settings": named places where the passage happens.',
          '"events": things that happen that later chapters must stay consistent with, each with when it happens if the text says.',
          '"pov": whose viewpoint the narration follows and in which person, for example "third person, Mara". "tense": the tense of the narration.',
        ]
      : []),
    '"terms": special terms, invented words or defined concepts a reader must remember.',
    fiction ? '"tension": how tense or gripping the passage is, from 1 (calm) to 10 (peak). "pace": slow, steady or fast.' : '"tension": how engaging the passage is for its reader, from 1 to 10. "pace": slow, steady or fast.',
    `"issues": real problems an editor would raise with the author, or an empty list. Types: ${ISSUE_GUIDE[context.kind]}. Use "high" only for something that breaks the book for a reader. Do not report spelling or grammar.`,
  ];

  const user = [
    `Book: "${context.bookTitle}" (${context.kind === 'children' ? "children's book" : context.kind}).`,
    ...(context.instructions?.trim() ? [`The publisher's notes about this book: ${context.instructions.trim().slice(0, 400)}`] : []),
    ...(soFar.length ? ['', 'The book so far:', ...soFar] : []),
    ...(known.length ? ['', 'Characters already met:', ...known] : []),
    '',
    `Chapter ${segment.chapterNumber}: ${segment.chapterTitle}${segment.parts > 1 ? ` (part ${segment.part} of ${segment.parts})` : ''}`,
    'Passage:',
    ...segment.paragraphs.map((p) => p.text),
    '',
    'Give a JSON object with these fields:',
    ...fields.map((f) => `- ${f}`),
  ].join('\n');

  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], schema: segmentSchema(context.kind) };
}

/** Reads JSON from a reply, tolerating code fences, stray text and a reply cut off before the end. */
export function parseJsonReply(reply: string): Record<string, unknown> | null {
  let body = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = body.indexOf('{');
  if (start < 0) return null;
  body = body.slice(start);
  const attempt = (candidate: string) => {
    try {
      const value = JSON.parse(candidate);
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const end = body.lastIndexOf('}');
  const whole = end > 0 ? attempt(body.slice(0, end + 1)) : null;
  if (whole) return whole;

  // The reply was cut off. Keep everything up to the last point where the data
  // was complete: the end of a finished item, or a comma between top-level
  // fields. Then close whatever was still open.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastSafe = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      lastSafe = i + 1;
    } else if (ch === ',' && depth === 1) lastSafe = i;
  }
  const cut = body.slice(0, lastSafe).replace(/,\s*$/, '');
  const open: string[] = [];
  inString = false;
  escaped = false;
  for (const ch of cut) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') open.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') open.pop();
  }
  return attempt(cut + open.reverse().join(''));
}

const str = (value: unknown, max = 400): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (value: unknown, max: number): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v) => v && typeof v === 'object').slice(0, max) : []) as Record<string, unknown>[];
const strings = (value: unknown, max: number, each = 200): string[] => (Array.isArray(value) ? value.map((v) => str(v, each)).filter(Boolean).slice(0, max) : []);

export function normaliseSegment(raw: Record<string, unknown>): SegmentNotes {
  const tension = Math.round(Number(raw.tension));
  return {
    summary: str(raw.summary, 500),
    characters: list(raw.characters, 10).map((c) => ({ name: str(c.name, 60), aliases: strings(c.aliases, 4, 40), description: str(c.description, 200) })).filter((c) => c.name),
    relationships: list(raw.relationships, 6).map((r) => ({ a: str(r.a, 60), b: str(r.b, 60), relation: str(r.relation, 100) })).filter((r) => r.a && r.b),
    settings: list(raw.settings, 5).map((s) => ({ name: str(s.name, 60), description: str(s.description, 180) })).filter((s) => s.name),
    events: list(raw.events, 6).map((e) => ({ when: str(e.when, 60), what: str(e.what, 200) })).filter((e) => e.what),
    terms: list(raw.terms, 6).map((t) => ({ term: str(t.term, 60), meaning: str(t.meaning, 180) })).filter((t) => t.term),
    pov: str(raw.pov, 100),
    tense: ['past', 'present', 'mixed'].includes(str(raw.tense)) ? str(raw.tense) : '',
    tension: Number.isFinite(tension) ? Math.min(10, Math.max(1, tension)) : 5,
    pace: (['slow', 'steady', 'fast'].includes(str(raw.pace)) ? str(raw.pace) : 'steady') as SegmentNotes['pace'],
    issues: list(raw.issues, 6)
      .map((i) => ({ type: str(i.type, 30), severity: str(i.severity, 10), quote: str(i.quote, 200), problem: str(i.problem, 300), suggestion: str(i.suggestion, 260) }))
      .filter((i) => i.problem),
  };
}

export function issueCategory(kind: BookKind, type: string): IssueCategory {
  return ISSUE_TYPES[kind].includes(type as IssueCategory) ? (type as IssueCategory) : 'clarity';
}

export function issueSeverity(value: string): Severity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

/** Only contradictions and holes in the story can be "important"; matters of taste are capped lower. */
const MAY_BE_HIGH: IssueCategory[] = ['continuity', 'plot-hole', 'gap', 'structure', 'age-fit'];

export interface PlacedIssue {
  category: IssueCategory;
  severity: Severity;
  /** Index of the block the quotation was found in, or null when it could not be found. */
  blockIndex: number | null;
  quote: string;
  problem: string;
  suggestion: string;
}

/**
 * Checks the issues a model raised for a passage against the passage itself.
 * A complaint about the opening must point at the opening, one about the
 * ending at the ending, and every quotation should really be in the text.
 * Small models raise such complaints by reflex; this keeps only the grounded ones.
 */
export function placeIssues(segment: Segment, notes: SegmentNotes, kind: BookKind, locate: (paragraphs: string[], quote: string) => { index: number; text: string } | null): PlacedIssue[] {
  const texts = segment.paragraphs.map((p) => p.text);
  const placed: PlacedIssue[] = [];
  const seen = new Set<string>();
  for (const raw of notes.issues) {
    const category = issueCategory(kind, raw.type);
    const found = raw.quote ? locate(texts, raw.quote) : null;
    if (category === 'weak-opening' && !(segment.part === 1 && found && found.index <= 2)) continue;
    if (category === 'weak-ending' && !(segment.part === segment.parts && found && found.index >= texts.length - 3)) continue;
    // An issue the model cannot anchor in the text is kept only for kinds that concern the passage as a whole.
    if (!found && !['pacing', 'structure', 'gap', 'chapter-repetition', 'age-fit'].includes(category)) continue;
    if (seen.has(category)) continue;
    seen.add(category);
    let severity = issueSeverity(raw.severity);
    if (severity === 'high' && !MAY_BE_HIGH.includes(category)) severity = 'medium';
    placed.push({ category, severity, blockIndex: found ? segment.paragraphs[found.index].index : null, quote: found ? found.text : '', problem: raw.problem, suggestion: raw.suggestion });
  }
  return placed;
}

/** Reads one passage with the model and returns its notes. */
export async function analyseSegment(provider: AiProvider, segment: Segment, context: SegmentContext, chat: ChatOptions = {}): Promise<{ notes: SegmentNotes; tokens: number }> {
  const { messages, schema } = buildSegmentRequest(segment, context);
  const reply = await provider.chat({ messages, temperature: 0.2, maxTokens: 1100, jsonSchema: schema }, chat);
  const parsed = parseJsonReply(reply.text);
  if (!parsed) throw new AiError('The model did not return notes in the expected form.', true);
  return { notes: normaliseSegment(parsed), tokens: reply.completionTokens ?? 0 };
}

// ----- The whole-book assessment --------------------------------------

export interface Rating {
  key: string;
  label: string;
  /** 1 to 10. */
  score: number;
  reason: string;
}

export interface Synthesis {
  summary: string;
  /** How the book is built: acts for a story, parts of the argument for non-fiction. */
  structure: { parts: { name: string; chapters: string; summary: string }[]; assessment: string };
  themes: string[];
  tone: string;
  /** Who the book is for. */
  audience: string;
  arcs: { name: string; arc: string; strength: number }[];
  ratings: Rating[];
  strengths: string[];
  /** The most valuable things to fix, most important first. */
  priorities: { title: string; detail: string }[];
  /** What a reader can take away and use (non-fiction). */
  takeaways: string[];
  voice: { description: string; dialogueStyle: string; devices: string[] };
  bookIssues: { type: string; severity: string; chapter: number | null; problem: string; suggestion: string }[];
}

export const RATING_LABELS: Record<BookKind, Record<string, string>> = {
  fiction: { structure: 'Plot and structure', characters: 'Characters', pacing: 'Pacing', prose: 'Prose', opening: 'Opening', ending: 'Ending' },
  nonfiction: { structure: 'Structure', clarity: 'Clarity', evidence: 'Evidence and examples', usefulness: 'Usefulness to the reader', opening: 'Opening', ending: 'Ending' },
  children: { ageFit: 'Fit for the age group', language: 'Language', rhythm: 'Rhythm and read-aloud', story: 'Story', ending: 'Ending' },
};

const BOOK_ISSUE_TYPES: Record<BookKind, IssueCategory[]> = {
  fiction: ['plot-hole', 'continuity', 'structure', 'pacing', 'character', 'weak-opening', 'weak-ending'],
  nonfiction: ['structure', 'gap', 'chapter-repetition', 'needs-evidence', 'clarity', 'weak-opening', 'weak-ending'],
  children: ['age-fit', 'structure', 'pacing', 'read-aloud', 'weak-opening', 'weak-ending'],
};

function synthesisSchema(kind: BookKind): Record<string, unknown> {
  const named = (fields: Record<string, unknown>, required = Object.keys(fields)) => ({ type: 'object', properties: fields, required, additionalProperties: false });
  const score = { type: 'integer', minimum: 1, maximum: 10 };
  const properties: Record<string, unknown> = {
    summary: text(500),
    structure: named({ parts: { type: 'array', maxItems: 5, items: named({ name: text(60), chapters: text(30), summary: text(220) }) }, assessment: text(400) }),
    themes: { type: 'array', maxItems: 5, items: text(60) },
    tone: text(100),
    audience: text(140),
    ratings: { type: 'array', minItems: Object.keys(RATING_LABELS[kind]).length, maxItems: Object.keys(RATING_LABELS[kind]).length, items: named({ aspect: { type: 'string', enum: Object.keys(RATING_LABELS[kind]) }, score, reason: text(200) }) },
    strengths: { type: 'array', maxItems: 4, items: text(200) },
    priorities: { type: 'array', maxItems: 5, items: named({ title: text(80), detail: text(300) }) },
    voice: named({ description: text(300), dialogueStyle: text(200), devices: { type: 'array', maxItems: 4, items: text(100) } }),
    bookIssues: {
      type: 'array', maxItems: 6,
      items: named({ type: { type: 'string', enum: BOOK_ISSUE_TYPES[kind] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, chapter: { type: 'integer', minimum: 0, maximum: 999 }, problem: text(300), suggestion: text(240) }),
    },
  };
  if (kind !== 'nonfiction') properties.arcs = { type: 'array', maxItems: 5, items: named({ name: text(60), arc: text(220), strength: score }) };
  else properties.takeaways = { type: 'array', maxItems: 5, items: text(180) };
  return named(properties);
}

export interface SynthesisInput {
  kind: BookKind;
  language: string;
  bookTitle: string;
  stats: BookStats;
  chapters: { number: number; title: string; summary: string; tension: number; words: number }[];
  characters: BibleCharacter[];
  /** Short excerpts from the start, middle and end, so the voice can be described. */
  samples: string[];
  instructions?: string;
}

function trimSummaries(chapters: SynthesisInput['chapters'], maxWords: number): string[] {
  const per = Math.max(18, Math.floor(maxWords / Math.max(chapters.length, 1)));
  return chapters.map((c) => {
    const words = c.summary.split(/\s+/);
    const summary = words.length > per ? words.slice(0, per).join(' ') + '…' : c.summary;
    return `${c.number}. ${c.title} (${c.words.toLocaleString('en-US')} words, ${c.tension}/10): ${summary}`;
  });
}

export function buildSynthesisRequest(input: SynthesisInput): { messages: ChatMessage[]; schema: Record<string, unknown> } {
  const fiction = input.kind !== 'nonfiction';
  const labels = RATING_LABELS[input.kind];
  const system = [
    `You are ${EDITOR[input.kind]} writing an assessment of a whole manuscript for a publisher, from your chapter-by-chapter notes.`,
    'Be specific, fair and useful. Name chapters. Do not flatter: a publisher needs to know what must be fixed. Rate honestly on a scale where 5 is publishable with work and 8 is strong.',
    'Write in English. Reply with one JSON object and nothing else.',
  ].join('\n');
  const s = input.stats;
  const user = [
    `Book: "${input.bookTitle}" (${input.kind === 'children' ? "children's book" : input.kind}), in ${input.language !== 'und' ? languageName(input.language) : 'an unidentified language'}.`,
    `Length: ${s.words.toLocaleString('en-US')} words in ${input.chapters.length} chapters. Average sentence: ${s.avgSentenceWords} words. Dialogue: ${Math.round(s.dialogueShare * 100)}% of the text.${s.grade !== null ? ` Reading level: school grade ${s.grade}.` : ''}`,
    ...(input.instructions?.trim() ? [`The publisher's notes about this book: ${input.instructions.trim().slice(0, 400)}`] : []),
    '',
    `Chapter notes (with ${fiction ? 'tension' : 'engagement'} out of 10):`,
    ...trimSummaries(input.chapters, 1500),
    ...(input.characters.length ? ['', fiction ? 'Characters:' : 'People:', ...input.characters.slice(0, 12).map((c) => `${c.name} (${c.role}): ${c.description.slice(0, 140)}`)] : []),
    ...(input.samples.length ? ['', 'Excerpts, to hear the voice:', ...input.samples.map((sample, i) => `[${i + 1}] ${sample}`)] : []),
    '',
    'Give a JSON object with these fields:',
    '- "summary": the book in three or four sentences.',
    fiction ? '- "structure": the acts or movements of the story ("parts", each with its chapter range), and an "assessment" of whether the structure works.' : '- "structure": the parts of the argument ("parts", each with its chapter range), and an "assessment" of whether the order and flow work.',
    '- "themes", "tone", and "audience" (who the book is for' + (input.kind === 'children' ? ', with an age range' : '') + ').',
    fiction ? '- "arcs": how each main character changes, with "strength" from 1 to 10 for how convincing the arc is.' : '- "takeaways": what a reader can take away and use.',
    `- "ratings": one for each of: ${Object.entries(labels).map(([k, v]) => `${k} (${v})`).join(', ')}, each with a score from 1 to 10 and a one-sentence reason.`,
    '- "strengths": what the book does well.',
    '- "priorities": the most valuable things to fix, most important first, each with a short title and what to do.',
    '- "voice": a description of how the author writes, the style of the dialogue, and devices the author favours.',
    `- "bookIssues": problems that span the book (${BOOK_ISSUE_TYPES[input.kind].join(', ')}), each with the chapter number it mostly concerns, or 0 for the whole book.`,
  ].join('\n');
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], schema: synthesisSchema(input.kind) };
}

export function normaliseSynthesis(raw: Record<string, unknown>, kind: BookKind): Synthesis {
  const structure = (raw.structure && typeof raw.structure === 'object' ? raw.structure : {}) as Record<string, unknown>;
  const voice = (raw.voice && typeof raw.voice === 'object' ? raw.voice : {}) as Record<string, unknown>;
  const labels = RATING_LABELS[kind];
  const clamp = (value: unknown) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 5;
  };
  const seen = new Set<string>();
  const ratings: Rating[] = [];
  for (const r of list(raw.ratings, 12)) {
    const k = str(r.aspect, 30);
    if (!labels[k] || seen.has(k)) continue;
    seen.add(k);
    ratings.push({ key: k, label: labels[k], score: clamp(r.score), reason: str(r.reason, 260) });
  }
  ratings.sort((a, b) => Object.keys(labels).indexOf(a.key) - Object.keys(labels).indexOf(b.key));
  return {
    summary: str(raw.summary, 700),
    structure: { parts: list(structure.parts, 6).map((p) => ({ name: str(p.name, 80), chapters: str(p.chapters, 40), summary: str(p.summary, 300) })).filter((p) => p.name), assessment: str(structure.assessment, 600) },
    themes: strings(raw.themes, 6, 80),
    tone: str(raw.tone, 140),
    audience: str(raw.audience, 200),
    arcs: list(raw.arcs, 6).map((a) => ({ name: str(a.name, 60), arc: str(a.arc, 300), strength: clamp(a.strength) })).filter((a) => a.name),
    ratings,
    strengths: strings(raw.strengths, 5, 260),
    priorities: list(raw.priorities, 6).map((p) => ({ title: str(p.title, 100), detail: str(p.detail, 400) })).filter((p) => p.title),
    takeaways: strings(raw.takeaways, 6, 240),
    voice: { description: str(voice.description, 400), dialogueStyle: str(voice.dialogueStyle, 260), devices: strings(voice.devices, 5, 140) },
    bookIssues: list(raw.bookIssues, 8)
      .map((i) => {
        const chapter = Math.round(Number(i.chapter));
        return { type: str(i.type, 30), severity: str(i.severity, 10), chapter: Number.isFinite(chapter) && chapter > 0 ? chapter : null, problem: str(i.problem, 400), suggestion: str(i.suggestion, 300) };
      })
      .filter((i) => i.problem),
  };
}

export function bookIssueCategory(kind: BookKind, type: string): IssueCategory {
  return BOOK_ISSUE_TYPES[kind].includes(type as IssueCategory) ? (type as IssueCategory) : 'structure';
}

export async function synthesise(provider: AiProvider, input: SynthesisInput, chat: ChatOptions = {}): Promise<{ synthesis: Synthesis; tokens: number }> {
  const { messages, schema } = buildSynthesisRequest(input);
  const reply = await provider.chat({ messages, temperature: 0.3, maxTokens: 1800, jsonSchema: schema }, chat);
  const parsed = parseJsonReply(reply.text);
  if (!parsed) throw new AiError('The model did not return an assessment in the expected form.', true);
  return { synthesis: normaliseSynthesis(parsed, input.kind), tokens: reply.completionTokens ?? 0 };
}
