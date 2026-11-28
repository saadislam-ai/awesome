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
  text: string;
  /** Marks toggled by this piece, when it is a marker. */
  toggles?: MarkKey[];
}

function scan(markup: string): Piece[] {
  const pieces: Piece[] = [];
  let literal = '';
  const flush = () => {
    if (literal) pieces.push({ text: literal });
    literal = '';
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
    const width = /^(\*{1,3}|__|~~)/.exec(markup.slice(i, i + 3))?.[0].length ?? 0;
    if (ch === '\\' && i + 1 < markup.length && /[\\*_~]/.test(markup[i + 1])) {
      literal += markup[i + 1];
      i += 2;
    } else if (width && standsAlone(i, width)) {
      literal += markup.slice(i, i + width);
      i += width;
    } else if (markup.startsWith('***', i)) {
      flush();
      pieces.push({ text: '***', toggles: ['b', 'i'] });
      i += 3;
    } else if (markup.startsWith('**', i)) {
      flush();
      pieces.push({ text: '**', toggles: ['b'] });
      i += 2;
    } else if (ch === '*') {
      flush();
      pieces.push({ text: '*', toggles: ['i'] });
      i += 1;
    } else if (markup.startsWith('__', i)) {
      flush();
      pieces.push({ text: '__', toggles: ['u'] });
      i += 2;
    } else if (markup.startsWith('~~', i)) {
      flush();
      pieces.push({ text: '~~', toggles: ['s'] });
      i += 2;
    } else {
      literal += ch;
      i += 1;
    }
  }
  flush();
  return pieces;
}

export function markupToRuns(markup: string): Run[] {
  const pieces = scan(markup);
  // A marker without a partner is ordinary text, not the start of formatting
  // that would run to the end of the paragraph.
  for (const key of ['b', 'i', 'u', 's'] as MarkKey[]) {
    const indexes = pieces.map((p, index) => (p.toggles?.includes(key) ? index : -1)).filter((index) => index >= 0);
    if (indexes.length % 2 === 1) {
      const last = pieces[indexes[indexes.length - 1]];
      last.toggles = last.toggles!.filter((k) => k !== key);
      if (!last.toggles.length) delete last.toggles;
      else last.text = '';
    }
  }
  const state: Record<MarkKey, boolean> = { b: false, i: false, u: false, s: false };
  const runs: Run[] = [];
  for (const piece of pieces) {
    if (piece.toggles) {
      for (const key of piece.toggles) state[key] = !state[key];
      continue;
    }
    if (!piece.text) continue;
    const run: Run = { text: piece.text };
    if (state.b) run.b = true;
    if (state.i) run.i = true;
    if (state.u) run.u = true;
    if (state.s) run.s = true;
    runs.push(run);
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
