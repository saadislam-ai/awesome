/**
 * The story bible: the people, places, things and events of a book, kept in
 * bible/bible.json. This file holds the logic around it:
 *
 *   - which words the spellchecker should accept (names and their variants),
 *   - where each entry is mentioned in the manuscript,
 *   - which spellings are marked as wrong, for the consistency checker,
 *   - the timeline of dated events,
 *   - the pronunciation guide for an audiobook narrator.
 */
import { maskMarkdown } from '../markdown/mask';
import type { Bible, BibleEntry, BibleType } from '../model/book';
import { shortId } from '../util/ids';
import type { ConsistencyDoc, ConsistencyIssue, Occurrence } from '../editor/analysis';

export const BIBLE_TYPE_LABEL: Record<BibleType, { one: string; many: string }> = {
  character: { one: 'Character', many: 'Characters' },
  place: { one: 'Place', many: 'Places' },
  object: { one: 'Thing', many: 'Things' },
  event: { one: 'Event', many: 'Events' },
  note: { one: 'Note', many: 'Notes' },
};

export function newBibleEntry(type: BibleType, name: string): BibleEntry {
  return { id: `bb_${shortId(8)}`, type, name, aliases: [], misspellings: [], summary: '', notes: '', fields: {}, pronunciation: '', when: '', whenLabel: '', links: [], shared: false, image: '' };
}

/** Every name a reader may meet an entry under: its name and the other names listed for it. */
export function entryNames(entry: BibleEntry): string[] {
  return [entry.name, ...entry.aliases].map((n) => n.trim()).filter(Boolean);
}

/**
 * Words the spellchecker should accept because the story bible lists them:
 * each word of every name and alias ("Dr Rahman" gives "Dr" and "Rahman").
 * Wrong spellings are of course not included.
 */
export function bibleWords(bible: Bible): string[] {
  const out = new Set<string>();
  for (const entry of bible.entries) {
    if (entry.type === 'note' || entry.type === 'event') continue;
    for (const name of entryNames(entry)) {
      for (const word of name.split(/[^\p{L}\p{M}'\u2019]+/u)) {
        const w = word.replace(/^['\u2019]+|['\u2019]+$/g, '');
        if (w.length >= 2) out.add(w);
      }
    }
  }
  return [...out];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A pattern that finds a name as a whole word, in any script. Spaces in the name match any white space. */
function wholeWord(name: string, flags: string): RegExp {
  const body = name.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${body}(?![\\p{L}\\p{M}\\p{N}])`, flags);
}

export interface EntryMentions {
  total: number;
  /** Documents that mention the entry, in manuscript order, with the first place in each. */
  docs: { nodeId: string; title: string; count: number; first: number }[];
}

/** How often, and where, each entry is mentioned by its name or one of its other names. */
export function bibleMentions(bible: Bible, docs: ConsistencyDoc[]): Map<string, EntryMentions> {
  const masked = docs.map((d) => ({ doc: d, text: maskMarkdown(d.text, { hideDeletions: true }) }));
  const out = new Map<string, EntryMentions>();
  for (const entry of bible.entries) {
    const names = entryNames(entry).sort((a, b) => b.length - a.length);
    const result: EntryMentions = { total: 0, docs: [] };
    if (names.length) {
      const pattern = new RegExp(names.map((n) => wholeWord(n, 'u').source).join('|'), 'gu');
      for (const { doc, text } of masked) {
        let count = 0;
        let first = -1;
        for (const m of text.matchAll(pattern)) {
          if (first < 0) first = m.index ?? 0;
          count++;
        }
        if (count) {
          result.total += count;
          result.docs.push({ nodeId: doc.nodeId, title: doc.title, count, first });
        }
      }
    }
    out.set(entry.id, result);
  }
  return out;
}

/**
 * Spellings the story bible marks as wrong ("Fareed" for "Farid"), wherever
 * they appear in the manuscript. Shown by the consistency checker.
 */
export function bibleSpellingIssues(bible: Bible, docs: ConsistencyDoc[]): ConsistencyIssue[] {
  const masked = docs.map((d) => ({ doc: d, text: maskMarkdown(d.text, { hideDeletions: true }) }));
  const issues: ConsistencyIssue[] = [];
  for (const entry of bible.entries) {
    const wrong = entry.misspellings.map((m) => m.trim()).filter(Boolean);
    if (!wrong.length || !entry.name.trim()) continue;
    const occurrences: Occurrence[] = [];
    const counts = new Map<string, number>();
    for (const form of wrong) {
      const pattern = wholeWord(form, 'giu');
      for (const { doc, text } of masked) {
        for (const m of text.matchAll(pattern)) {
          counts.set(form, (counts.get(form) ?? 0) + 1);
          if (occurrences.length < 50) occurrences.push({ nodeId: doc.nodeId, title: doc.title, from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, text: m[0] });
        }
      }
    }
    if (occurrences.length === 0) continue;
    const right = bibleMentions({ schema: 1, entries: [entry] }, docs).get(entry.id)?.total ?? 0;
    issues.push({
      id: `bible:${entry.id}`,
      title: `"${entry.name}" is spelled differently in places`,
      detail: `The story bible lists ${wrong.map((w) => `"${w}"`).join(', ')} as wrong for "${entry.name}".`,
      forms: [{ form: entry.name, count: right }, ...wrong.filter((w) => counts.has(w)).map((w) => ({ form: w, count: counts.get(w)! }))],
      occurrences,
    });
  }
  return issues;
}

/** Dated entries in story order. Entries without a date come last, in the order they were written. */
export function bibleTimeline(bible: Bible): BibleEntry[] {
  const dated = bible.entries.filter((e) => e.when.trim());
  // "Day 2" sorts before "Day 10": numbers inside the text are compared as numbers.
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return dated.sort((a, b) => collator.compare(a.when, b.when));
}

/** Names with a note on how to say them, for the narrator of an audiobook. */
export function pronunciationGuide(bible: Bible): { name: string; say: string; type: BibleType; summary: string }[] {
  return bible.entries
    .filter((e) => e.pronunciation.trim() && e.name.trim())
    .map((e) => ({ name: e.name, say: e.pronunciation.trim(), type: e.type, summary: e.summary }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
