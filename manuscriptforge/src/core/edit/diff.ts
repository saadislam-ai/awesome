import { countWords } from '../text/words';

/** One tracked change: replace `before` (at `start`..`end` of the original) with `after`. */
export interface Hunk {
  index: number;
  start: number;
  end: number;
  before: string;
  after: string;
  kind: ChangeKind;
}

export type ChangeKind =
  | 'spelling' | 'punctuation' | 'capitalization' | 'spacing' | 'formatting' | 'wording' | 'cut' | 'addition' | 'rewrite';

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  spelling: 'Spelling',
  punctuation: 'Punctuation',
  capitalization: 'Capitalization',
  spacing: 'Spacing',
  formatting: 'Formatting',
  wording: 'Grammar or wording',
  cut: 'Cut',
  addition: 'Addition',
  rewrite: 'Rewrite',
};

const TOKEN =
  /\*{1,3}|__|~~|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

type Op = { type: 'equal' | 'delete' | 'insert'; a: number; b: number; count: number };

/** Longest-common-subsequence diff of two token lists. */
function diffTokens(a: string[], b: string[]): Op[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  const ops: Op[] = [];
  const push = (type: Op['type'], ai: number, bi: number) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.count++;
    else ops.push({ type, a: ai, b: bi, count: 1 });
  };
  if (prefix) ops.push({ type: 'equal', a: 0, b: 0, count: prefix });

  if (n * m > 9_000_000) {
    // Far too different (or too long) to compare word by word: treat as one replacement.
    if (n) ops.push({ type: 'delete', a: prefix, b: prefix, count: n });
    if (m) ops.push({ type: 'insert', a: prefix + n, b: prefix, count: m });
  } else if (n || m) {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[prefix + i] === b[prefix + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i] === b[prefix + j]) {
        push('equal', prefix + i, prefix + j);
        i++;
        j++;
      } else if (i >= n) {
        push('insert', prefix + i, prefix + j);
        j++;
      } else if (j >= m) {
        push('delete', prefix + i, prefix + j);
        i++;
      } else {
        const viaDelete = table[(i + 1) * width + j];
        const viaInsert = table[i * width + j + 1];
        // When both routes are equally good, take the one that lets the very
        // next token match. This keeps separate changes separate.
        const insertFirst = viaInsert > viaDelete || (viaInsert === viaDelete && j + 1 < m && a[prefix + i] === b[prefix + j + 1]);
        if (insertFirst) {
          push('insert', prefix + i, prefix + j);
          j++;
        } else {
          push('delete', prefix + i, prefix + j);
          i++;
        }
      }
    }
  }
  if (suffix) ops.push({ type: 'equal', a: a.length - suffix, b: b.length - suffix, count: suffix });
  return ops;
}

const WORD_CHARS = /[^\p{L}\p{N}]+/gu;
const MARKERS = /\*{1,3}|__|~~/g;

/** Edit distance in which swapping two neighbouring letters ("teh" for "the") counts as one slip. */
function editDistance(a: string, b: string): number {
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push(new Array<number>(b.length + 1).fill(0));
    rows[i][0] = i;
  }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2][j - 2] + 1);
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

/** Names the kind of change, so changes can be filtered and accepted by type. */
export function classifyChange(before: string, after: string): ChangeKind {
  const plainBefore = before.replace(MARKERS, '');
  const plainAfter = after.replace(MARKERS, '');
  if (plainBefore === plainAfter) return 'formatting';
  if (plainBefore.replace(/\s+/g, '') === plainAfter.replace(/\s+/g, '')) return 'spacing';
  const lettersBefore = plainBefore.replace(WORD_CHARS, '');
  const lettersAfter = plainAfter.replace(WORD_CHARS, '');
  if (lettersBefore === lettersAfter) return 'punctuation';
  if (lettersBefore.toLowerCase() === lettersAfter.toLowerCase()) return 'capitalization';
  const wordsBefore = countWords(plainBefore);
  const wordsAfter = countWords(plainAfter);
  if (wordsAfter === 0) return 'cut';
  if (wordsBefore === 0) return 'addition';
  if (wordsBefore <= 2 && wordsAfter <= 2) {
    const a = lettersBefore.toLowerCase();
    const b = lettersAfter.toLowerCase();
    const distance = editDistance(a, b);
    if (distance <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.34))) return 'spelling';
  }
  return wordsBefore <= 4 && wordsAfter <= 4 ? 'wording' : 'rewrite';
}

/**
 * Compares two versions of a paragraph and returns the changes between them
 * at word level. Changes separated only by a space are joined into one, so
 * "big red" to "large crimson" is a single change rather than two.
 */
export function diffText(original: string, revised: string): Hunk[] {
  if (original === revised) return [];
  const a = tokenize(original);
  const b = tokenize(revised);
  const ops = diffTokens(a, b);

  interface Raw { a0: number; a1: number; b0: number; b1: number }
  const separate: Raw[] = [];
  let ai = 0;
  let bi = 0;
  let current: Raw | null = null;
  for (const op of ops) {
    if (op.type === 'equal') {
      if (current) separate.push(current);
      current = null;
      ai += op.count;
      bi += op.count;
    } else {
      current ??= { a0: ai, a1: ai, b0: bi, b1: bi };
      if (op.type === 'delete') {
        ai += op.count;
        current.a1 = ai;
      } else {
        bi += op.count;
        current.b1 = bi;
      }
    }
  }
  if (current) separate.push(current);

  // Two replacements with only a space between them read as one change
  // ("big red" to "large crimson"). A replacement next to a pure cut or
  // addition stays separate, because those are different decisions.
  const isReplacement = (r: Raw) => r.a1 > r.a0 && r.b1 > r.b0;
  const SMALL_FIXES: ChangeKind[] = ['spelling', 'capitalization', 'punctuation'];
  const isSmallFix = (r: Raw) => SMALL_FIXES.includes(classifyChange(a.slice(r.a0, r.a1).join(''), b.slice(r.b0, r.b1).join('')));
  const raw: Raw[] = [];
  for (const next of separate) {
    const previous = raw[raw.length - 1];
    if (
      previous && isReplacement(previous) && isReplacement(next) &&
      // Two typo fixes side by side remain two decisions.
      !(isSmallFix(previous) && isSmallFix(next)) &&
      next.a0 - previous.a1 === 1 && next.b0 - previous.b1 === 1 && /^[ \t]+$/.test(a[previous.a1])
    ) {
      previous.a1 = next.a1;
      previous.b1 = next.b1;
    } else {
      raw.push({ ...next });
    }
  }

  const offsets = new Array<number>(a.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < a.length; i++) offsets[i + 1] = offsets[i] + a[i].length;

  return raw.map((r, index) => {
    const before = a.slice(r.a0, r.a1).join('');
    const after = b.slice(r.b0, r.b1).join('');
    return { index, start: offsets[r.a0], end: offsets[r.a1], before, after, kind: classifyChange(before, after) };
  });
}

export type Decision = 'accept' | 'reject';
export type Decisions = Record<number, Decision | undefined>;

/**
 * The paragraph text that results from the given decisions. Changes that are
 * still undecided keep the original wording unless `pendingAsNew` is set.
 */
export function applyDecisions(original: string, hunks: Hunk[], decisions: Decisions, pendingAsNew = false): string {
  let out = '';
  let position = 0;
  for (const hunk of hunks) {
    out += original.slice(position, hunk.start);
    const decision = decisions[hunk.index];
    out += decision === 'accept' || (decision === undefined && pendingAsNew) ? hunk.after : hunk.before;
    position = hunk.end;
  }
  return out + original.slice(position);
}

export type Granularity = 'word' | 'sentence' | 'paragraph';

/** One reviewable change at the chosen level of detail. It may cover several word-level changes. */
export interface ChangeGroup {
  hunks: number[];
  start: number;
  end: number;
  before: string;
  after: string;
  kind: ChangeKind;
}

let sentenceSegmenter: Intl.Segmenter | null | undefined;

/** Character ranges of the sentences in a text. */
export function sentenceRanges(text: string): [number, number][] {
  if (sentenceSegmenter === undefined) {
    sentenceSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null;
  }
  const ranges: [number, number][] = [];
  if (sentenceSegmenter) {
    for (const part of sentenceSegmenter.segment(text)) ranges.push([part.index, part.index + part.segment.length]);
  } else {
    const boundary = /[.!?…]+["”’)\]]*\s+/g;
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(text))) {
      ranges.push([start, m.index + m[0].length]);
      start = m.index + m[0].length;
    }
    if (start < text.length) ranges.push([start, text.length]);
  }
  return ranges.length ? ranges : [[0, text.length]];
}

function summariseKinds(kinds: ChangeKind[]): ChangeKind {
  const unique = [...new Set(kinds)];
  if (unique.length === 1) return unique[0];
  if (unique.some((k) => k === 'rewrite' || k === 'cut' || k === 'addition')) return 'rewrite';
  return unique.includes('wording') ? 'wording' : unique[0];
}

/** Groups word-level changes into sentence-level or paragraph-level ones. */
export function groupHunks(original: string, hunks: Hunk[], granularity: Granularity): ChangeGroup[] {
  if (!hunks.length) return [];
  if (granularity === 'word') {
    return hunks.map((h) => ({ hunks: [h.index], start: h.start, end: h.end, before: h.before, after: h.after, kind: h.kind }));
  }
  const ranges: [number, number][] = granularity === 'paragraph' ? [[0, original.length]] : sentenceRanges(original);
  const groups: ChangeGroup[] = [];
  const buckets: { start: number; end: number; hunks: Hunk[] }[] = [];
  for (const hunk of hunks) {
    let first = ranges.findIndex(([s, e]) => hunk.start >= s && hunk.start < e);
    if (first < 0) first = ranges.length - 1;
    let last = first;
    while (last + 1 < ranges.length && hunk.end > ranges[last][1]) last++;
    const start = ranges[first][0];
    const end = ranges[last][1];
    const previous = buckets[buckets.length - 1];
    if (previous && start < previous.end) {
      previous.end = Math.max(previous.end, end);
      previous.hunks.push(hunk);
    } else {
      buckets.push({ start, end, hunks: [hunk] });
    }
  }
  for (const bucket of buckets) {
    // Leave the space between sentences outside the change.
    const slice = original.slice(bucket.start, bucket.end);
    const trimmedEnd = bucket.start + slice.replace(/\s+$/, '').length;
    const end = Math.max(trimmedEnd, ...bucket.hunks.map((h) => h.end));
    let after = '';
    let position = bucket.start;
    for (const hunk of bucket.hunks) {
      after += original.slice(position, hunk.start) + hunk.after;
      position = hunk.end;
    }
    after += original.slice(position, end);
    groups.push({
      hunks: bucket.hunks.map((h) => h.index),
      start: bucket.start,
      end,
      before: original.slice(bucket.start, end),
      after,
      kind: summariseKinds(bucket.hunks.map((h) => h.kind)),
    });
  }
  return groups;
}

export interface ChangeStats {
  changes: number;
  wordsAdded: number;
  wordsRemoved: number;
}

export function changeStats(hunks: Hunk[]): ChangeStats {
  let wordsAdded = 0;
  let wordsRemoved = 0;
  for (const hunk of hunks) {
    wordsAdded += countWords(hunk.after.replace(MARKERS, ''));
    wordsRemoved += countWords(hunk.before.replace(MARKERS, ''));
  }
  return { changes: hunks.length, wordsAdded, wordsRemoved };
}

export interface BlockPair {
  /** Index in the old list, when the block existed before. */
  a?: number;
  /** Index in the new list, when the block exists now. */
  b?: number;
}

function similarity(a: string, b: string): number {
  const ta = a.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const tb = b.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!ta.length || !tb.length) return ta.length === tb.length ? 1 : 0;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of tb) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      common++;
      counts.set(t, n - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

/**
 * Lines up the paragraphs of two versions of a chapter: unchanged paragraphs
 * are matched exactly, edited paragraphs are paired by likeness, and the rest
 * are reported as removed or added.
 */
export function alignBlocks(a: string[], b: string[]): BlockPair[] {
  const pairs: BlockPair[] = [];
  const ops = diffTokens(a, b);
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.type === 'equal') {
      for (let n = 0; n < op.count; n++) pairs.push({ a: op.a + n, b: op.b + n });
      k++;
      continue;
    }
    // A stretch of removed and added paragraphs: pair up the ones that are alike.
    let a0 = op.a;
    let a1 = op.a;
    let b0 = op.b;
    let b1 = op.b;
    while (k < ops.length && ops[k].type !== 'equal') {
      if (ops[k].type === 'delete') a1 = ops[k].a + ops[k].count;
      else b1 = ops[k].b + ops[k].count;
      a0 = Math.min(a0, ops[k].a);
      b0 = Math.min(b0, ops[k].b);
      k++;
    }
    const n = a1 - a0;
    const m = b1 - b0;
    if (!n || !m || n * m > 250_000) {
      for (let i = a0; i < a1; i++) pairs.push({ a: i });
      for (let j = b0; j < b1; j++) pairs.push({ b: j });
      continue;
    }
    const width = m + 1;
    const score = new Float64Array((n + 1) * width);
    const sims = new Float64Array(n * m);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        const sim = similarity(a[a0 + i], b[b0 + j]);
        sims[i * m + j] = sim;
        const skip = Math.max(score[(i + 1) * width + j], score[i * width + j + 1]);
        score[i * width + j] = sim >= 0.45 ? Math.max(skip, sim + score[(i + 1) * width + j + 1]) : skip;
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && sims[i * m + j] >= 0.45 && score[i * width + j] === sims[i * m + j] + score[(i + 1) * width + j + 1]) {
        pairs.push({ a: a0 + i, b: b0 + j });
        i++;
        j++;
      } else if (i < n && (j >= m || score[(i + 1) * width + j] >= score[i * width + j + 1])) {
        pairs.push({ a: a0 + i });
        i++;
      } else {
        pairs.push({ b: b0 + j });
        j++;
      }
    }
  }
  return pairs;
}
