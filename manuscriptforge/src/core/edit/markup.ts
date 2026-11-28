import { normalizeRuns, type Run } from '../model/blocks';

/**
 * Paragraph text with its formatting written as light Markdown:
 * *italic*, **bold**, __underline__, ~~strikethrough~~, and a line break
 * inside a paragraph as a newline.
 *
 * This is the form in which text is shown to an AI model and in which
 * tracked changes are computed, so that formatting survives an edit.
 */

type MarkKey = 'b' | 'i' | 'u' | 's';

// Outermost first.
const ORDER: [MarkKey, string][] = [['s', '~~'], ['u', '__'], ['b', '**'], ['i', '*']];
const MARKER: Record<MarkKey, string> = { s: '~~', u: '__', b: '**', i: '*' };

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/__/g, '\\_\\_').replace(/~~/g, '\\~\\~');
}

export function runsToMarkup(runs: Run[]): string {
  let out = '';
  const open: MarkKey[] = [];

  const closeTo = (depth: number) => {
    if (open.length <= depth) return;
    // Markers hug the text: trailing spaces go outside them.
    const trailing = /[ \t]*$/.exec(out)![0];
    if (trailing) out = out.slice(0, out.length - trailing.length);
    while (open.length > depth) out += MARKER[open.pop()!];
    out += trailing;
  };

  for (const run of normalizeRuns(runs)) {
    const lines = run.text.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) {
        closeTo(0);
        out += '\n';
      }
      if (!line) return;
      if (!line.trim()) {
        out += line;
        return;
      }
      const target = ORDER.filter(([key]) => run[key]).map(([key]) => key);
      let keep = 0;
      while (keep < open.length && keep < target.length && open[keep] === target[keep]) keep++;
      closeTo(keep);
      const lead = /^[ \t]*/.exec(line)![0];
      out += lead;
      for (const key of target.slice(keep)) {
        open.push(key);
        out += MARKER[key];
      }
      out += escapeText(line.slice(lead.length));
    });
  }
  closeTo(0);
  return out;
}

interface Piece {
  /** Position of this piece in the markup string. */
  start: number;
  end: number;
  /** The text it stands for. Empty for a marker. */
  text: string;
  /** Marks toggled by this piece, when it is a marker. */
  toggles?: MarkKey[];
}

function scan(markup: string): Piece[] {
  const pieces: Piece[] = [];
  let literalStart = -1;
  const flush = (at: number) => {
    if (literalStart >= 0) pieces.push({ start: literalStart, end: at, text: markup.slice(literalStart, at) });
    literalStart = -1;
  };
  // A marker standing alone between spaces ("5 * 3") is ordinary text.
  const standsAlone = (at: number, length: number) => {
    const before = at === 0 ? ' ' : markup[at - 1];
    const after = at + length >= markup.length ? ' ' : markup[at + length];
    return /\s/.test(before) && /\s/.test(after);
  };
  let i = 0;
  while (i < markup.length) {
    const ch = markup[i];
    const marker = /^(\*{1,3}|__|~~)/.exec(markup.slice(i, i + 3))?.[0] ?? '';
    if (ch === '\\' && i + 1 < markup.length && /[\\*_~]/.test(markup[i + 1])) {
      flush(i);
      pieces.push({ start: i, end: i + 2, text: markup[i + 1] });
      i += 2;
    } else if (marker && !standsAlone(i, marker.length)) {
      flush(i);
      const toggles: MarkKey[] = marker === '***' ? ['b', 'i'] : marker === '**' ? ['b'] : marker === '*' ? ['i'] : marker === '__' ? ['u'] : ['s'];
      pieces.push({ start: i, end: i + marker.length, text: '', toggles });
      i += marker.length;
    } else {
      if (literalStart < 0) literalStart = i;
      i += marker && standsAlone(i, marker.length) ? marker.length : 1;
    }
  }
  flush(markup.length);
  // A marker without a partner is ordinary text, not the start of formatting
  // that would run to the end of the paragraph.
  for (const key of ['b', 'i', 'u', 's'] as MarkKey[]) {
    const indexes = pieces.map((p, index) => (p.toggles?.includes(key) ? index : -1)).filter((index) => index >= 0);
    if (indexes.length % 2 === 1) {
      const last = pieces[indexes[indexes.length - 1]];
      last.toggles = last.toggles!.filter((k) => k !== key);
      if (!last.toggles.length) {
        delete last.toggles;
        last.text = markup.slice(last.start, last.end);
      }
    }
  }
  return pieces;
}

/** A stretch of text with its formatting and its position in the markup string. */
export interface MarkupSpan extends Run {
  start: number;
  end: number;
}

/** The text of a paragraph in pieces, each with its formatting and where it sits in the markup. */
export function markupSpans(markup: string): MarkupSpan[] {
  const state: Record<MarkKey, boolean> = { b: false, i: false, u: false, s: false };
  const spans: MarkupSpan[] = [];
  for (const piece of scan(markup)) {
    if (piece.toggles) {
      for (const key of piece.toggles) state[key] = !state[key];
      continue;
    }
    if (!piece.text) continue;
    const span: MarkupSpan = { text: piece.text, start: piece.start, end: piece.end };
    if (state.b) span.b = true;
    if (state.i) span.i = true;
    if (state.u) span.u = true;
    if (state.s) span.s = true;
    spans.push(span);
  }
  return spans;
}

export function markupToRuns(markup: string): Run[] {
  return normalizeRuns(markupSpans(markup).map(({ start: _start, end: _end, ...run }) => run));
}

/**
 * The formatted text of one stretch of a markup string, for display. The
 * stretch may begin or end in the middle of formatted text.
 */
export function sliceMarkup(spans: MarkupSpan[], from: number, to: number): Run[] {
  const runs: Run[] = [];
  for (const span of spans) {
    if (span.end <= from || span.start >= to) continue;
    const { start, end, text, ...marks } = span;
    // An escaped character ("\*") is two characters of markup for one of text: take it whole.
    const exact = text.length === end - start;
    const slice = exact ? text.slice(Math.max(from, start) - start, Math.min(to, end) - start) : text;
    if (slice) runs.push({ ...marks, text: slice });
  }
  return normalizeRuns(runs);
}

/** The text without any formatting markers. */
export function markupToPlain(markup: string): string {
  return markupToRuns(markup).map((r) => r.text).join('');
}

/** How many formatted spans (italic, bold and so on) a paragraph has. */
export function countFormattedSpans(markup: string): number {
  return markupToRuns(markup).filter((r) => r.b || r.i || r.u || r.s).length;
}
