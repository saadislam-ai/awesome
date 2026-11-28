import { normalizeRuns, type Align, type Block, type HeadingLevel, type Run } from '../../core/model/blocks';

/** A ProseMirror node in its JSON form. */
export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string }[];
}

const MARKS: [keyof Omit<Run, 'text'>, string][] = [['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['s', 'strike']];

function inline(runs: Run[]): PmNode[] {
  const out: PmNode[] = [];
  for (const run of runs) {
    const marks = MARKS.filter(([key]) => run[key]).map(([, type]) => ({ type }));
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) out.push({ type: 'hardBreak' });
      if (part) out.push(marks.length ? { type: 'text', text: part, marks } : { type: 'text', text: part });
    });
  }
  return out;
}

function textBlock(type: string, runs: Run[], attrs?: Record<string, unknown>): PmNode {
  const content = inline(runs);
  const node: PmNode = { type };
  if (attrs) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

/** Converts stored blocks into the editor's document format. */
export function blocksToDoc(blocks: Block[]): PmNode {
  const content: PmNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === 'break') {
      content.push({ type: 'horizontalRule' });
      i++;
    } else if (block.type === 'heading') {
      content.push(textBlock('heading', block.runs, { level: block.level, textAlign: block.align ?? null }));
      i++;
    } else if (block.type === 'paragraph') {
      content.push(textBlock('paragraph', block.runs, { textAlign: block.align ?? null }));
      i++;
    } else if (block.type === 'quote') {
      const paragraphs: PmNode[] = [];
      while (i < blocks.length && blocks[i].type === 'quote') {
        paragraphs.push(textBlock('paragraph', (blocks[i] as Extract<Block, { type: 'quote' }>).runs));
        i++;
      }
      content.push({ type: 'blockquote', content: paragraphs });
    } else {
      const ordered = block.ordered;
      const items: PmNode[] = [];
      while (i < blocks.length) {
        const item = blocks[i];
        if (item.type !== 'list' || item.ordered !== ordered) break;
        items.push({ type: 'listItem', content: [textBlock('paragraph', item.runs)] });
        i++;
      }
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items });
    }
  }
  if (!content.length) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

function runsOf(node: PmNode): Run[] {
  const runs: Run[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      runs.push({ text: '\n' });
    } else if (child.type === 'text' && child.text) {
      const run: Run = { text: child.text };
      for (const mark of child.marks ?? []) {
        if (mark.type === 'bold') run.b = true;
        else if (mark.type === 'italic') run.i = true;
        else if (mark.type === 'underline') run.u = true;
        else if (mark.type === 'strike') run.s = true;
      }
      runs.push(run);
    } else if (child.content) {
      runs.push(...runsOf(child));
    }
  }
  // A line break carries no formatting of its own, so let it join its neighbours.
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (run.text === '\n' && last) last.text += '\n';
    else merged.push(run);
  }
  return normalizeRuns(merged);
}

function alignOf(node: PmNode): Align | undefined {
  const value = node.attrs?.textAlign;
  return value === 'center' || value === 'right' ? value : undefined;
}

/** How many stored blocks an editor node turns into. */
export function blockCount(node: PmNode): number {
  if (node.type === 'blockquote') return (node.content ?? []).reduce((n, c) => n + blockCount(c), 0);
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? []).reduce((n, item) => n + (item.content ?? []).reduce((m, c) => m + blockCount(c), 0), 0);
  }
  return 1;
}

function collect(node: PmNode, out: Block[], context: { quote?: boolean; ordered?: boolean | null }) {
  switch (node.type) {
    case 'horizontalRule':
      out.push({ type: 'break' });
      break;
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 4) as HeadingLevel;
      const align = alignOf(node);
      out.push(align ? { type: 'heading', level, runs: runsOf(node), align } : { type: 'heading', level, runs: runsOf(node) });
      break;
    }
    case 'paragraph': {
      const runs = runsOf(node);
      if (context.ordered !== undefined && context.ordered !== null) out.push({ type: 'list', ordered: context.ordered, runs });
      else if (context.quote) out.push({ type: 'quote', runs });
      else {
        const align = alignOf(node);
        out.push(align ? { type: 'paragraph', runs, align } : { type: 'paragraph', runs });
      }
      break;
    }
    case 'blockquote':
      for (const child of node.content ?? []) collect(child, out, { quote: true });
      break;
    case 'bulletList':
    case 'orderedList':
      for (const item of node.content ?? []) {
        for (const child of item.content ?? []) collect(child, out, { ordered: node.type === 'orderedList' });
      }
      break;
    default:
      // Unknown node types keep their text as a plain paragraph.
      if (node.content) out.push({ type: 'paragraph', runs: runsOf(node) });
  }
}

/** Converts the editor's document back into stored blocks. */
export function docToBlocks(doc: PmNode): Block[] {
  const out: Block[] = [];
  for (const node of doc.content ?? []) collect(node, out, {});
  // An empty last line is just where the cursor rests.
  while (out.length) {
    const last = out[out.length - 1];
    if (last.type !== 'break' && last.runs.length === 0) out.pop();
    else break;
  }
  return out;
}
