/**
 * Grammar checking, the part that needs no particular checker: which
 * dialect to ask for, what text to hand over, and which of the reported
 * problems are worth showing to an author.
 *
 * The checker itself (Harper, a program that runs inside the app with no
 * connection to anything) lives in the desktop app, in a background worker.
 * It reports problems as plain data in the shape of RawLint below.
 */
import { maskMarkdown } from '../markdown/mask';
import type { DashPolicy } from '../model/book';

export type GrammarDialect = 'American' | 'British' | 'Australian' | 'Canadian' | 'Indian';

/** The dialect to check against, from the spelling variety of the book. Null for books that are not in English. */
export function grammarDialect(spelling: string): GrammarDialect | null {
  const tag = spelling.toLowerCase();
  if (!tag.startsWith('en')) return null;
  if (tag === 'en-us') return 'American';
  if (tag === 'en-ca') return 'Canadian';
  if (tag === 'en-in') return 'Indian';
  if (tag === 'en-gb' || tag === 'en-ie' || tag === 'en-za') return 'British';
  // Australian and New Zealand books, and plain "en" in this publisher's library.
  return 'Australian';
}

/**
 * Rules of the checker that are switched off, by the checker's own names:
 *   - spelling, sentence length and spelled out numbers, which this app
 *     checks itself with the book's own settings,
 *   - the serial ("Oxford") comma outside American English, where leaving
 *     it out is the normal style and not a mistake,
 *   - every rule that asks for a dash, unless the book allows dashes.
 */
export function grammarRulesOff(dialect: GrammarDialect, dashPolicy: DashPolicy['mode']): string[] {
  const off = ['SpellCheck', 'LongSentences', 'SpelledNumbers', 'NoOxfordComma'];
  if (dialect !== 'American') off.push('OxfordComma');
  if (dashPolicy !== 'allow') off.push('Dashes', 'NumericRangeEnDash');
  return off;
}

/**
 * The text as the checker should see it: Markdown marks, comments, note
 * references and suggested deletions are blanked out with spaces, so every
 * position in the result is the same position in the manuscript.
 */
export function prepareGrammarText(source: string): string {
  return maskMarkdown(source, { hideDeletions: true });
}

/** One problem as the checker reports it. Positions count the same way JavaScript strings do. */
export interface RawLint {
  start: number;
  end: number;
  /** The checker's own name for the kind of problem ("Grammar", "Repetition", "WordChoice" ...). */
  kind: string;
  kindLabel: string;
  message: string;
  /** kind: 0 replace, 1 remove, 2 insert after. */
  suggestions: { kind: number; text: string }[];
}

export interface GrammarSuggestion {
  action: 'replace' | 'remove' | 'insert-after';
  text: string;
  /** What the button says. */
  label: string;
}

export interface GrammarFinding {
  from: number;
  to: number;
  kind: string;
  kindLabel: string;
  /** The words concerned, as they stand in the manuscript. */
  problem: string;
  message: string;
  suggestions: GrammarSuggestion[];
}

/**
 * Kinds that are left out: spelling has its own checker here (with the
 * book's dictionary, the personal word list and the names in the story
 * bible), and sentence length is part of the style analysis.
 */
const LEFT_OUT = new Set(['Spelling', 'Readability']);
const DASH = /[\u2012-\u2015]/;

export interface GrammarOptions {
  /** The book's rule about dashes: unless it is "allow", no suggestion that would add a dash is shown. */
  dashPolicy: DashPolicy['mode'];
  max?: number;
}

/** The problems worth showing, in reading order. */
export function grammarFindings(raw: RawLint[], source: string, opts: GrammarOptions): GrammarFinding[] {
  const out: GrammarFinding[] = [];
  const checked = prepareGrammarText(source);
  for (const lint of raw) {
    if (LEFT_OUT.has(lint.kind) || lint.end <= lint.start || lint.end > source.length) continue;
    const problem = source.slice(lint.start, lint.end);
    if (!problem.trim()) continue;
    // A remark that reaches into something the checker could not see (a mark, a comment, struck out text) is
    // dropped: acting on it would change text the author never showed to the checker.
    if (checked.slice(lint.start, lint.end) !== problem) continue;
    const offered = lint.suggestions.filter((s) => opts.dashPolicy === 'allow' || !DASH.test(s.text));
    // A remark whose only advice was to put in a dash has nothing left to say to an author who does not use them.
    if (lint.suggestions.length > 0 && offered.length === 0) continue;
    const seen = new Set<string>();
    const suggestions: GrammarSuggestion[] = [];
    for (const s of offered) {
      const action = s.kind === 1 ? 'remove' : s.kind === 2 ? 'insert-after' : 'replace';
      const key = `${action}:${s.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ action, text: s.text, label: action === 'remove' ? 'Remove' : action === 'insert-after' ? `Add "${s.text}"` : s.text.trim() ? s.text : 'Remove' });
    }
    out.push({
      from: lint.start,
      to: lint.end,
      kind: lint.kind,
      kindLabel: lint.kindLabel || lint.kind,
      problem,
      message: lint.message.replace(/`([^`]*)`/g, '"$1"'),
      suggestions: suggestions.slice(0, 4),
    });
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out.slice(0, opts.max ?? 300);
}

/** The edit a suggestion stands for: which stretch of the manuscript is replaced by what. */
export function grammarEdit(finding: GrammarFinding, suggestion: GrammarSuggestion): { from: number; to: number; insert: string } {
  if (suggestion.action === 'remove') return { from: finding.from, to: finding.to, insert: '' };
  if (suggestion.action === 'insert-after') return { from: finding.to, to: finding.to, insert: suggestion.text };
  return { from: finding.from, to: finding.to, insert: suggestion.text };
}
