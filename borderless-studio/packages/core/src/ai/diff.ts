/**
 * Turns "the text as it was" and "the text the assistant proposes" into
 * tracked changes (CriticMarkup), so that every difference can be accepted
 * or rejected by the author. Nothing is replaced silently.
 *
 * Differences are found word by word, one paragraph at a time, so a change
 * never crosses a paragraph break. Each change is signed with {>>@ai<<}.
 */
import { parseCritic } from '../markdown/critic';

/** Words (in any script), footnote references, runs of white space, and single punctuation marks. */
const TOKEN = /\[\^[^\]\s]+\]|[\p{L}\p{M}\p{N}]+(?:['\u2019][\p{L}\p{M}]+)*|\s+|[^\s\p{L}\p{M}\p{N}]/gu;

export function tokenise(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

export interface DiffPiece {
  op: 'eq' | 'del' | 'ins';
  text: string;
}

/** Spaces compare as equal whatever their number; line breaks inside a paragraph do not (they matter in verse). */
const keyOf = (token: string): string => (/^\s+$/.test(token) && !token.includes('\n') ? ' ' : token);

/**
 * The shortest list of deletions and insertions that turns a into b (Myers'
 * algorithm). When the two are too different to compare within the limit,
 * the result is simply "delete everything, insert everything".
 */
export function diffTokens(a: string[], b: string[], maxDifferences = 2000): DiffPiece[] {
  const ka = a.map(keyOf);
  const kb = b.map(keyOf);
  let start = 0;
  while (start < a.length && start < b.length && ka[start] === kb[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffPiece[] = a.slice(0, start).map((text) => ({ op: 'eq', text }));
  out.push(...middle(a.slice(start, endA), b.slice(start, endB), ka.slice(start, endA), kb.slice(start, endB), maxDifferences));
  out.push(...a.slice(endA).map((text): DiffPiece => ({ op: 'eq', text })));
  return out;
}

function middle(a: string[], b: string[], ka: string[], kb: string[], maxDifferences: number): DiffPiece[] {
  const n = a.length;
  const m = b.length;
  const everything = (): DiffPiece[] => [...a.map((text): DiffPiece => ({ op: 'del', text })), ...b.map((text): DiffPiece => ({ op: 'ins', text }))];
  if (n === 0 || m === 0) return everything();
  const max = Math.min(n + m, maxDifferences);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] is the furthest reach on each diagonal before round d, for diagonals -d-1 .. d+1.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && ka[x] === kb[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return everything();

  // Walk back from the end to the start along the recorded rounds.
  const reversed: DiffPiece[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const before = trace[d];
    const at = (k: number) => before[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      reversed.push({ op: 'eq', text: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) {
      reversed.push({ op: 'ins', text: b[y - 1] });
      y--;
    } else {
      reversed.push({ op: 'del', text: a[x - 1] });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    reversed.push({ op: 'eq', text: a[x - 1] });
    x--;
    y--;
  }
  return reversed.reverse();
}

const SIGNATURE = '{>>@ai<<}';
/** Text that would be read as the start or end of a tracked change if it appeared inside one. */
const UNSAFE = /\{\+\+|\+\+\}|\{--|--\}|\{~~|~~\}|~>|\{>>|<<\}|\{==|==\}/;

function change(del: string, ins: string): string | null {
  if (UNSAFE.test(del) || UNSAFE.test(ins)) return null;
  if (del && ins) return `{~~${del}~>${ins}~~}${SIGNATURE}`;
  return del ? `{--${del}--}${SIGNATURE}` : `{++${ins}++}${SIGNATURE}`;
}

/** One paragraph: the original with every difference marked. Null when a change cannot be written safely. */
function paragraphMarkup(original: string, revised: string): { text: string; changes: number } | null {
  const pieces = diffTokens(tokenise(original), tokenise(revised));
  if (pieces.every((p) => p.op === 'eq')) return { text: original, changes: 0 };
  let out = '';
  let del = '';
  let ins = '';
  let changes = 0;
  let failed = false;
  const flush = () => {
    if (!del && !ins) return;
    const text = change(del, ins);
    if (text === null) failed = true;
    else out += text;
    changes++;
    del = '';
    ins = '';
  };
  pieces.forEach((piece, i) => {
    if (piece.op === 'del') del += piece.text;
    else if (piece.op === 'ins') ins += piece.text;
    else {
      // A space between two changes is drawn into them: "the old dog" to "a young cat" is one change, not three.
      const between = /^[ \t]+$/.test(piece.text) && i > 0 && i < pieces.length - 1 && pieces[i - 1].op !== 'eq' && pieces[i + 1].op !== 'eq';
      if (between) {
        del += piece.text;
        ins += piece.text;
      } else {
        flush();
        out += piece.text;
      }
    }
  });
  flush();
  return failed ? null : { text: out, changes };
}

export type SuggestResult =
  | { ok: true; markup: string; changes: number }
  | { ok: false; reason: 'pending-changes' | 'paragraphs' | 'markup'; message: string };

/**
 * The original passage with the assistant's proposal written into it as
 * tracked changes. The passage keeps its own paragraph breaks and its own
 * white space at both ends.
 */
export function suggestionMarkup(original: string, revised: string): SuggestResult {
  if (parseCritic(original).some((s) => s.kind !== 'highlight')) {
    return { ok: false, reason: 'pending-changes', message: 'The selected text already has tracked changes or comments. Accept or reject them first, then ask again.' };
  }
  const lead = /^\s*/.exec(original)![0];
  const core = original.slice(lead.length).replace(/\s+$/, '');
  const trail = original.slice(lead.length + core.length);
  // Paragraphs and the exact breaks between them: [p0, break0, p1, break1, ...].
  const parts = core.split(/(\n[ \t]*\n\s*)/);
  const proposed = revised.replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n\s*/);
  const paragraphs = Math.ceil(parts.length / 2);
  if (proposed.length !== paragraphs) {
    return { ok: false, reason: 'paragraphs', message: `The assistant returned ${proposed.length} paragraph${proposed.length === 1 ? '' : 's'} for ${paragraphs}, so its changes cannot be lined up with your text. Nothing was changed. Try a shorter selection.` };
  }
  let markup = lead;
  let changes = 0;
  for (let i = 0; i < paragraphs; i++) {
    const done = paragraphMarkup(parts[i * 2], proposed[i]);
    if (!done) return { ok: false, reason: 'markup', message: 'The proposal contains characters that are reserved for tracked changes, so it cannot be shown safely. Nothing was changed.' };
    markup += done.text + (parts[i * 2 + 1] ?? '');
    changes += done.changes;
  }
  return { ok: true, markup: markup + trail, changes };
}
