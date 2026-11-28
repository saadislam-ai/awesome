/**
 * The canonical manuscript format.
 *
 * Every importer produces blocks, the editor loads and saves blocks, and the
 * exporters and AI passes consume blocks. Keeping one small, stable format in
 * the middle means no part of the app depends on another part's file format.
 */

export interface Run {
  text: string;
  /** bold */
  b?: true;
  /** italic */
  i?: true;
  /** underline */
  u?: true;
  /** strikethrough */
  s?: true;
}

export type Align = 'center' | 'right';
export type HeadingLevel = 1 | 2 | 3 | 4;

export type Block =
  | { type: 'heading'; level: HeadingLevel; runs: Run[]; align?: Align }
  | { type: 'paragraph'; runs: Run[]; align?: Align }
  | { type: 'quote'; runs: Run[] }
  /** One list item. Consecutive items with the same `ordered` form a list. */
  | { type: 'list'; ordered: boolean; runs: Run[] }
  /** A scene break. */
  | { type: 'break' };

/** A block as produced by an importer, with hints used only for chapter detection. */
export type DraftBlock = Block & {
  /** The block starts on a new page in the source document. */
  pb?: true;
};

export interface ChapterDraft {
  title: string;
  blocks: Block[];
}

export type TextBlock = Exclude<Block, { type: 'break' }>;

export const SCENE_BREAK_TEXT = '* * *';

export function isTextBlock(block: Block): block is TextBlock {
  return block.type !== 'break';
}

export function runsText(runs: Run[]): string {
  let out = '';
  for (const r of runs) out += r.text;
  return out;
}

export function blockText(block: Block): string {
  return block.type === 'break' ? SCENE_BREAK_TEXT : runsText(block.runs);
}

/** Plain text of a chapter: one block per paragraph, blank line between. */
export function blocksPlainText(blocks: Block[]): string {
  return blocks.map(blockText).join('\n\n');
}

function sameMarks(a: Run, b: Run): boolean {
  return a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s;
}

/** Merges neighbouring runs with identical formatting and drops empty runs. */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

/** Trims whitespace at both ends of a run list without touching inner spacing. */
export function trimRuns(runs: Run[]): Run[] {
  const out = normalizeRuns(runs);
  while (out.length) {
    const first = out[0];
    first.text = first.text.replace(/^[\s ]+/, '');
    if (first.text) break;
    out.shift();
  }
  while (out.length) {
    const last = out[out.length - 1];
    last.text = last.text.replace(/[\s ]+$/, '');
    if (last.text) break;
    out.pop();
  }
  return out;
}

export function isBlank(block: Block): boolean {
  return block.type !== 'break' && runsText(block.runs).trim() === '';
}

export function plainRuns(text: string): Run[] {
  return text ? [{ text }] : [];
}

export function paragraph(text: string): Block {
  return { type: 'paragraph', runs: plainRuns(text) };
}

/** Removes importer-only hints so blocks can be stored. */
export function stripHints(blocks: DraftBlock[]): Block[] {
  return blocks.map((b) => {
    if ('pb' in b) {
      const { pb: _pb, ...rest } = b;
      return rest as Block;
    }
    return b;
  });
}

const SCENE_BREAK_PATTERN =
  /^(?:[*＊✱✽❖◆◇•·●○~\-–—_#⁂☙❧✦✧]\s*){1,9}$|^(?:\*\s*){3}$|^o\s*0\s*o$|^[-–—]\s*o\s*[-–—]$/i;

/** True when a paragraph's text is just an ornament such as "* * *" or "#". */
export function looksLikeSceneBreak(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // A ruled line of any length, such as "------" or "* * * * *" typed across the page.
  if (/^([-_*=~#–—])(?:\s*\1){2,}$/.test(t)) return true;
  if (t.length > 24) return false;
  if (/^[-–—]$/.test(t)) return false;
  return SCENE_BREAK_PATTERN.test(t);
}
