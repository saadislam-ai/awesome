import type { VoiceNumbers } from './types';

export interface BibleCharacter {
  name: string;
  aliases: string[];
  role: 'main' | 'supporting' | 'minor';
  description: string;
  /** How the character changes over the book, when the analysis could tell. */
  arc: string;
  /** In how many passages the character appears. */
  mentions: number;
  /** Number of the chapter where the character first appears (1-based). */
  firstChapter: number;
  /** Set when the publisher edited this entry: a new analysis will not overwrite it. */
  locked?: boolean;
}

export interface BibleRelationship {
  a: string;
  b: string;
  relation: string;
}

export interface BibleSetting {
  name: string;
  description: string;
  locked?: boolean;
}

export interface BibleEvent {
  chapter: number;
  when: string;
  what: string;
}

export interface BibleTerm {
  term: string;
  meaning: string;
  locked?: boolean;
}

export interface VoiceProfile {
  numbers: VoiceNumbers | null;
  /** A short description of how the author writes. */
  description: string;
  dialogueStyle: string;
  /** Devices the author favours, for example "short one-line paragraphs for emphasis". */
  devices: string[];
}

/**
 * Everything worth remembering about a book while editing it: who is in it,
 * where and when it happens, its terms, and how its author writes. Later AI
 * passes are given a digest of this so that edits stay consistent.
 */
export interface BookBible {
  summary: string;
  characters: BibleCharacter[];
  relationships: BibleRelationship[];
  settings: BibleSetting[];
  timeline: BibleEvent[];
  glossary: BibleTerm[];
  themes: string[];
  pov: string;
  tense: string;
  tone: string;
  voice: VoiceProfile;
  chapterSummaries: { chapterId: string; title: string; summary: string }[];
  updatedAt: string;
}

export function emptyBible(): BookBible {
  return {
    summary: '', characters: [], relationships: [], settings: [], timeline: [], glossary: [], themes: [], pov: '', tense: '', tone: '',
    voice: { numbers: null, description: '', dialogueStyle: '', devices: [] }, chapterSummaries: [], updatedAt: '',
  };
}

/** What the model noted about one passage, after clean-up. */
export interface SegmentNotes {
  summary: string;
  characters: { name: string; aliases: string[]; description: string }[];
  relationships: BibleRelationship[];
  settings: { name: string; description: string }[];
  events: { when: string; what: string }[];
  terms: { term: string; meaning: string }[];
  pov: string;
  tense: string;
  /** Tension (fiction) or engagement (other books), 1 to 10. */
  tension: number;
  pace: 'slow' | 'steady' | 'fast';
  issues: { type: string; severity: string; quote: string; problem: string; suggestion: string }[];
}

/** Words a model sometimes lists as a "character" that are not names. */
const NOT_A_NAME = /^(?:nobody|no one|someone|somebody|everyone|everybody|anyone|the narrator|narrator|unknown|unnamed|the author|author|the reader|reader|he|she|they|i|we|you|it|a man|a woman|the man|the woman|people|the villagers|villagers|the village|the council)$/i;

const key = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const TITLES = /^(?:mr|mrs|ms|miss|dr|sir|lady|lord|captain|professor|aunt|uncle|father|mother|brother|sister)\.?\s+/i;

/** True when two names plainly refer to the same person ("Mara" and "Mara Ellison"). */
function sameCharacter(a: BibleCharacter, name: string, aliases: string[]): boolean {
  const known = [a.name, ...a.aliases].map(key);
  const incoming = [name, ...aliases].map(key).filter(Boolean);
  for (const n of incoming) {
    if (known.includes(n)) return true;
    const bare = key(n.replace(TITLES, ''));
    for (const k of known) {
      const kBare = key(k.replace(TITLES, ''));
      if (!bare || !kBare) continue;
      // A first name on its own matches a full name that starts with it.
      if (kBare.split(' ')[0] === bare || bare.split(' ')[0] === kBare) {
        if (bare.split(' ').length === 1 || kBare.split(' ').length === 1) return true;
      }
    }
  }
  return false;
}

function addDescription(existing: string, extra: string, max = 320): string {
  const clean = extra.trim();
  if (!clean) return existing;
  if (!existing) return clean.slice(0, max);
  // Skip a note that mostly repeats what is already recorded.
  const have = new Set(existing.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
  const incoming = clean.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  if (incoming.length && incoming.filter((w) => have.has(w)).length / incoming.length >= 0.6) return existing;
  const joined = `${existing.replace(/[.;\s]+$/, '')}. ${clean}`;
  return joined.length <= max ? joined : existing;
}

/** Folds the notes from one passage into the Bible being built. */
export function mergeSegment(bible: BookBible, notes: SegmentNotes, chapterNumber: number): void {
  for (const incoming of notes.characters) {
    const name = incoming.name.trim();
    if (!name || name.length > 60 || NOT_A_NAME.test(name)) continue;
    const found = bible.characters.find((c) => sameCharacter(c, name, incoming.aliases));
    if (found) {
      found.mentions++;
      // Keep the fullest form of the name; shorter forms become aliases.
      const names = [found.name, name, ...found.aliases, ...incoming.aliases].map((n) => n.trim()).filter(Boolean);
      const fullest = names.reduce((best, n) => (n.replace(TITLES, '').split(' ').length > best.replace(TITLES, '').split(' ').length ? n : best), found.name);
      found.aliases = [...new Set(names.filter((n) => key(n) !== key(fullest)))].slice(0, 6);
      found.name = fullest;
      found.description = addDescription(found.description, incoming.description);
    } else {
      bible.characters.push({
        name, aliases: [...new Set(incoming.aliases.map((a) => a.trim()).filter((a) => a && key(a) !== key(name)))].slice(0, 6), role: 'minor',
        description: incoming.description.trim().slice(0, 320), arc: '', mentions: 1, firstChapter: chapterNumber,
      });
    }
  }
  for (const r of notes.relationships) {
    const pair = [key(r.a), key(r.b)].sort().join('|');
    if (!r.a.trim() || !r.b.trim() || !r.relation.trim()) continue;
    if (!bible.relationships.some((x) => [key(x.a), key(x.b)].sort().join('|') === pair)) bible.relationships.push({ a: r.a.trim(), b: r.b.trim(), relation: r.relation.trim().slice(0, 120) });
  }
  for (const s of notes.settings) {
    if (!s.name.trim()) continue;
    const found = bible.settings.find((x) => key(x.name) === key(s.name));
    if (found) found.description = addDescription(found.description, s.description, 240);
    else bible.settings.push({ name: s.name.trim(), description: s.description.trim().slice(0, 240) });
  }
  for (const e of notes.events) {
    if (e.what.trim()) bible.timeline.push({ chapter: chapterNumber, when: e.when.trim().slice(0, 60), what: e.what.trim().slice(0, 200) });
  }
  for (const t of notes.terms) {
    if (t.term.trim() && !bible.glossary.some((x) => key(x.term) === key(t.term))) bible.glossary.push({ term: t.term.trim(), meaning: t.meaning.trim().slice(0, 200) });
  }
}

/** Ranks characters by how much of the book they appear in. */
export function assignRoles(bible: BookBible, passages: number): void {
  const sorted = [...bible.characters].sort((a, b) => b.mentions - a.mentions);
  const top = sorted[0]?.mentions ?? 0;
  for (const c of bible.characters) {
    if (c.locked) continue;
    const share = passages ? c.mentions / passages : 0;
    c.role = c.mentions >= Math.max(2, top * 0.6) || share >= 0.5 ? 'main' : c.mentions >= 2 && share >= 0.12 ? 'supporting' : 'minor';
  }
  if (sorted[0] && !sorted[0].locked) sorted[0].role = 'main';
  bible.characters.sort((a, b) => b.mentions - a.mentions);
}

/** Carries entries the publisher edited by hand over into a freshly built Bible. */
export function keepLockedEntries(fresh: BookBible, previous: BookBible | null): BookBible {
  if (!previous) return fresh;
  const merge = <T extends { locked?: boolean }>(next: T[], old: T[], id: (x: T) => string): T[] => {
    const locked = old.filter((x) => x.locked);
    const lockedKeys = new Set(locked.map((x) => key(id(x))));
    return [...locked, ...next.filter((x) => !lockedKeys.has(key(id(x))))];
  };
  return {
    ...fresh,
    characters: merge(fresh.characters, previous.characters, (c) => c.name),
    settings: merge(fresh.settings, previous.settings, (s) => s.name),
    glossary: merge(fresh.glossary, previous.glossary, (t) => t.term),
  };
}

/** Every name by which the people and places of the book are known. */
export function bibleNames(bible: BookBible): string[] {
  const names = new Set<string>();
  for (const c of bible.characters) {
    if (c.role === 'minor' && c.mentions < 2 && !c.locked) continue;
    names.add(c.name);
    for (const alias of c.aliases) names.add(alias);
  }
  for (const s of bible.settings) names.add(s.name);
  return [...names].filter((n) => /^\p{Lu}/u.test(n) && n.length >= 3);
}

/**
 * A digest of the Bible for an editing prompt: short enough to send with
 * every passage, with the facts an editor must not get wrong.
 */
export function bibleBrief(bible: BookBible, maxWords = 200): string {
  const lines: string[] = [];
  const narration = [bible.pov, bible.tense && `${bible.tense} tense`].filter(Boolean).join(', ');
  if (narration) lines.push(`Narration: ${narration}.`);
  if (bible.tone) lines.push(`Tone: ${bible.tone}.`);
  if (bible.voice.description) lines.push(`Author's voice: ${bible.voice.description}`);
  const people = bible.characters.filter((c) => c.role !== 'minor' || c.locked).slice(0, 14);
  if (people.length) {
    lines.push(`Names (spell exactly so): ${people.map((c) => (c.description ? `${c.name} (${c.description.split(/[.;]/)[0].slice(0, 60).trim()})` : c.name)).join('; ')}.`);
  }
  if (bible.settings.length) lines.push(`Places: ${bible.settings.slice(0, 10).map((s) => s.name).join(', ')}.`);
  if (bible.glossary.length) lines.push(`Terms: ${bible.glossary.slice(0, 12).map((t) => `${t.term} (${t.meaning.slice(0, 50)})`).join('; ')}.`);
  const words: string[] = [];
  const out: string[] = [];
  for (const line of lines) {
    const count = line.split(/\s+/).length;
    if (words.length + count > maxWords) break;
    words.push(...line.split(/\s+/));
    out.push(line);
  }
  return out.join('\n');
}
