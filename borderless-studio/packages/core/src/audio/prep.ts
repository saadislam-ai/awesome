/**
 * Preparing a book for audio: the narration script (one file for each
 * chapter, as audiobook stores want it), opening and closing credits, an
 * estimate of the finished length, and the pronunciation guide from the
 * story bible. The technical requirements shown beside it come from
 * specs/audiobook.json.
 *
 * The app does not record or measure sound.
 */
import { z } from 'zod';
import { pronunciationGuide } from '../bible/index';
import type { AssembledBook, AssembledSection } from '../build/assemble';
import type { Host } from '../host';
import type { Block, Inline } from '../markdown/ir';
import { primaryAuthor, type Bible, type Book } from '../model/book';
import { joinPath } from '../util/paths';

export const AudiobookSpecSchema = z.object({
  schemaVersion: z.literal(1),
  lastVerified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** False while the numbers have not been compared with the official page. */
  verified: z.boolean().default(false),
  verifyNote: z.string().default(''),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().url() })).min(1),
  narration: z.object({ wordsPerFinishedHour: z.number().min(3000).max(20000), retailSampleMaxMinutes: z.number().min(1).max(30) }),
  credits: z.object({ opening: z.string(), closing: z.string() }),
  requirements: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
  notes: z.array(z.string()).default([]),
});
export type AudiobookSpec = z.infer<typeof AudiobookSpecSchema>;

/** The audiobook requirements: the personal copy in the library when there is a valid one, otherwise the shipped file. */
export async function loadAudiobookSpec(host: Host, bundledSpecsDir: string, userSpecsDir?: string): Promise<AudiobookSpec | null> {
  for (const dir of [userSpecsDir, bundledSpecsDir]) {
    if (!dir) continue;
    const file = joinPath(dir, 'audiobook.json');
    if (!(await host.exists(file))) continue;
    try {
      const parsed = AudiobookSpecSchema.safeParse(JSON.parse(await host.readText(file)));
      if (parsed.success) return parsed.data;
    } catch {
      /* a broken personal copy falls back to the shipped file */
    }
  }
  return null;
}

export interface AudioOptions {
  narrator: string;
  /** Year the recording is finished, for the closing credits. */
  productionYear: number;
  /** Read these pages too. The story itself (the body of the book) is always included. */
  include: { dedication: boolean; epigraph: boolean; frontMatter: boolean; acknowledgements: boolean; aboutAuthor: boolean; otherBackMatter: boolean };
}

export const defaultAudioOptions = (): AudioOptions => ({
  narrator: '',
  productionYear: new Date().getFullYear(),
  include: { dedication: true, epigraph: true, frontMatter: true, acknowledgements: true, aboutAuthor: false, otherBackMatter: false },
});

export interface AudioFile {
  /** Position in the audiobook, starting at 1. The retail sample has 0. */
  number: number;
  /** File name without extension, as stores like it: "03_Chapter_02". */
  name: string;
  /** What the listener hears named: "Chapter Two: A House of Paper". */
  title: string;
  kind: 'opening-credits' | 'section' | 'closing-credits' | 'retail-sample';
  /** The text to read, paragraphs separated by blank lines. */
  script: string;
  words: number;
  minutes: number;
  /** Things the narrator and the author must decide (pictures, tables, notes). */
  decisions: string[];
}

export interface AudioPlan {
  files: AudioFile[];
  /** The sample is listed apart: it repeats text of the book. */
  sample: AudioFile | null;
  totalWords: number;
  totalMinutes: number;
  pronunciation: ReturnType<typeof pronunciationGuide>;
  /** Pages of the book that are not read, with the reason. */
  leftOut: string[];
  warnings: string[];
}

const NOTES_HEADING = '[Notes of this section, for the narrator. Not read unless agreed.]';
const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const spokenWords = (script: string): number => countWords(script.split(NOTES_HEADING)[0].replace(/\[pause\]/g, ''));

/** Text of inline content for reading aloud. Notes are taken out and collected. */
function speakInline(inlines: Inline[], notes: string[]): string {
  let out = '';
  for (const n of inlines) {
    switch (n.t) {
      case 'text':
      case 'code':
        out += n.v;
        break;
      case 'br':
        out += '\n';
        break;
      case 'fn':
        notes.push(speakBlocks(n.c, [], []).replace(/\n+/g, ' ').trim());
        break;
      case 'index':
        break;
      case 'img':
        out += n.alt ? `[Picture: ${n.alt}]` : '[Picture]';
        break;
      default:
        out += speakInline(n.c, notes);
    }
  }
  return out;
}

/** Blocks as paragraphs to read. Pictures and tables become bracketed remarks and are listed as decisions. */
function speakBlocks(blocks: Block[], notes: string[], decisions: string[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'p':
      case 'h':
        out.push(speakInline(b.c, notes));
        break;
      case 'scenebreak':
        out.push('[pause]');
        break;
      case 'quote':
      case 'align':
        out.push(speakBlocks(b.c, notes, decisions));
        break;
      case 'callout':
        out.push([b.title ? speakInline(b.title, notes) : '', speakBlocks(b.c, notes, decisions)].filter(Boolean).join('\n\n'));
        break;
      case 'list':
        b.items.forEach((item, i) => out.push(`${b.ordered ? `${b.start + i}. ` : ''}${speakBlocks(item, notes, decisions)}`));
        break;
      case 'verse':
        out.push(b.stanzas.map((stanza) => stanza.map((line) => speakInline(line, notes)).join('\n')).join('\n\n'));
        break;
      case 'figure':
        out.push(`[Picture: ${b.alt || 'no description'}${b.caption ? `. Caption: ${speakInline(b.caption, notes)}` : ''}]`);
        decisions.push(`A picture${b.alt ? ` ("${b.alt}")` : ''}: describe it in a sentence, or leave it out.`);
        break;
      case 'table':
        out.push('[Table]');
        decisions.push('A table: decide how it is read aloud (row by row, or summed up in a sentence).');
        break;
      case 'code':
        out.push(b.v);
        break;
      default:
        break;
    }
  }
  return out.filter((p) => p.trim()).join('\n\n');
}

/** Pages that are never read aloud, with what the listener gets instead. */
const NEVER_READ: Record<string, string> = {
  'half-title': '',
  'title-page': 'The title page is replaced by the opening credits.',
  copyright: 'The copyright page is not read; the closing credits carry the copyright line.',
  toc: 'The contents page is not read.',
  index: 'The index is not read.',
  'also-by': 'The list of other books is not read.',
};

function wanted(sec: AssembledSection, include: AudioOptions['include']): boolean {
  if (sec.zone === 'body') return true;
  if (sec.kind === 'dedication') return include.dedication;
  if (sec.kind === 'epigraph') return include.epigraph;
  if (sec.zone === 'front') return include.frontMatter;
  if (sec.kind === 'acknowledgements') return include.acknowledgements;
  if (sec.kind === 'about-author') return include.aboutAuthor;
  return include.otherBackMatter;
}

const fill = (template: string, values: Record<string, string>): string =>
  template
    .replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? '')
    .replace(/ {2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
const fileName = (n: number, label: string): string => `${String(n).padStart(2, '0')}_${label.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 48)}`;

/** The plan for recording: every file with its script, in order, and what still needs a decision. */
export function audioPlan(assembled: AssembledBook, bible: Bible, spec: AudiobookSpec, opts: AudioOptions): AudioPlan {
  const book: Book = assembled.book;
  const perMinute = spec.narration.wordsPerFinishedHour / 60;
  const warnings: string[] = [];
  const leftOut: string[] = [];
  const files: AudioFile[] = [];
  const add = (kind: AudioFile['kind'], label: string, title: string, script: string, decisions: string[] = []) => {
    const words = spokenWords(script);
    files.push({ number: files.length + 1, name: fileName(files.length + 1, label), title, kind, script, words, minutes: Math.round((words / perMinute) * 10) / 10, decisions });
  };

  const narrator = opts.narrator.trim() || '[name of the narrator]';
  if (!opts.narrator.trim()) warnings.push('No narrator is named yet: the credits say "[name of the narrator]".');
  const values = {
    title: book.title,
    subtitle: book.subtitle ? ` ${book.subtitle}.` : '',
    author: primaryAuthor(book),
    narrator,
    year: String(book.copyright.year),
    holder: book.copyright.holder || primaryAuthor(book),
    productionYear: String(opts.productionYear),
    publisher: book.imprint || primaryAuthor(book),
  };
  add('opening-credits', 'Opening_Credits', 'Opening credits', fill(spec.credits.opening, values));

  let chapter = 0;
  // A part title without text of its own is spoken at the start of the next file instead of getting a file to itself.
  let pendingPart = '';
  let firstOfStory = -1;
  for (const sec of assembled.sections) {
    if (sec.kind in NEVER_READ) {
      if (NEVER_READ[sec.kind] && !leftOut.includes(NEVER_READ[sec.kind])) leftOut.push(NEVER_READ[sec.kind]);
      continue;
    }
    if (!wanted(sec, opts.include)) {
      leftOut.push(`"${sec.title || sec.kind}" is not read (switched off in the choices).`);
      continue;
    }
    const heading = [sec.label, sec.title].filter(Boolean).join(': ');
    const notes: string[] = [];
    const decisions: string[] = [];
    let body = speakBlocks(sec.blocks, notes, decisions);
    if (sec.kind === 'epigraph' && typeof sec.data.source === 'string' && sec.data.source) body += `\n\n${sec.data.source}`;
    if (sec.kind === 'part' && !body.trim()) {
      pendingPart = heading;
      continue;
    }
    if (notes.length) {
      decisions.push(`${notes.length} note${notes.length === 1 ? '' : 's'} in the text: decide whether ${notes.length === 1 ? 'it is' : 'they are'} read where the mark stands, or left out. The text of the notes is at the end of this script.`);
      body += `\n\n${NOTES_HEADING}\n\n${notes.map((n, i) => `${i + 1}. ${n}`).join('\n\n')}`;
    }
    const spoken = [pendingPart, heading].filter(Boolean).join('.\n\n');
    pendingPart = '';
    if (!body.trim() && !spoken) continue;
    const label = sec.kind === 'chapter' ? `Chapter_${String(++chapter).padStart(2, '0')}` : sec.title || sec.kind;
    if (sec.zone === 'body' && firstOfStory < 0) firstOfStory = files.length;
    add('section', label, heading || sec.kind, [spoken ? `${spoken}.` : '', body].filter(Boolean).join('\n\n'), decisions);
  }
  add('closing-credits', 'Closing_Credits', 'Closing credits', fill(spec.credits.closing, values));

  // The retail sample: the opening of the story, up to the length the store allows.
  let sample: AudioFile | null = null;
  const first = firstOfStory >= 0 ? files[firstOfStory] : undefined;
  if (first) {
    const limit = Math.floor(spec.narration.retailSampleMaxMinutes * perMinute);
    const taken: string[] = [];
    let words = 0;
    for (const para of first.script.split(NOTES_HEADING)[0].split(/\n{2,}/)) {
      const n = countWords(para);
      if (words > 0 && words + n > limit) break;
      taken.push(para);
      words += n;
    }
    sample = { number: 0, name: 'Retail_Sample', title: `Retail sample: the opening of "${first.title}"`, kind: 'retail-sample', script: taken.join('\n\n').trim(), words, minutes: Math.round((words / perMinute) * 10) / 10, decisions: [] };
  }

  const totalWords = files.reduce((n, f) => n + f.words, 0);
  const pronunciation = pronunciationGuide(bible);
  if (pronunciation.length === 0) warnings.push('The story bible has no "how to say it" entries yet. Add them for names a narrator could get wrong.');
  return { files, sample, totalWords, totalMinutes: Math.round((totalWords / perMinute) * 10) / 10, pronunciation, leftOut, warnings };
}

/** "7 h 25 min" from a number of minutes. */
export function durationText(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** The pronunciation guide as a text file for the narrator. */
export function pronunciationText(plan: AudioPlan, book: Book): string {
  const lines = [`Pronunciation guide for "${book.title}"`, '', 'Name: how to say it (who or what it is)', ''];
  for (const p of plan.pronunciation) lines.push(`${p.name}: ${p.say}${p.summary ? `  (${p.summary})` : ''}`);
  if (plan.pronunciation.length === 0) lines.push('No entries yet. Add "How to say it" to the people and places in the story bible.');
  return lines.join('\n') + '\n';
}

/** The recording plan as a spreadsheet file (CSV): one row for each audio file. */
export function recordingPlanCsv(plan: AudioPlan): string {
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows: (string | number)[][] = [['File', 'Section', 'Words', 'Estimated minutes', 'To decide']];
  for (const f of [...plan.files, ...(plan.sample ? [plan.sample] : [])]) rows.push([f.name, f.title, f.words, f.minutes, f.decisions.join(' ')]);
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** The requirements as a text file to hand to whoever records and masters the audio. */
export function requirementsText(spec: AudiobookSpec): string {
  const lines = ['Audio file requirements', `Last checked: ${spec.lastVerified}${spec.verified ? '' : ' (not yet confirmed against the official page)'}`, ''];
  if (!spec.verified && spec.verifyNote) lines.push(spec.verifyNote, '');
  for (const r of spec.requirements) lines.push(`[ ] ${r.title}: ${r.text}`);
  lines.push('', 'Sources:');
  for (const s of spec.sources) lines.push(`${s.title}: ${s.url}`);
  return lines.join('\n') + '\n';
}
