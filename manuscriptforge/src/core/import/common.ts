import {
  isBlank,
  looksLikeSceneBreak,
  runsText,
  trimRuns,
  type DraftBlock,
} from '../model/blocks';

export type SourceFormat = 'docx' | 'txt' | 'md' | 'rtf' | 'epub' | 'pdf';

export interface ImportMeta {
  title?: string;
  author?: string;
  language?: string;
}

export interface ImportResult {
  format: SourceFormat;
  blocks: DraftBlock[];
  meta: ImportMeta;
  /** Plain-language notes about anything that could not be carried over. */
  warnings: string[];
}

/** An import problem with a message that is safe to show to the user as is. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Decodes bytes as text, honouring byte-order marks and falling back from UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Older Windows text files.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function isBodyParagraph(b: DraftBlock | undefined): boolean {
  return !!b && b.type === 'paragraph' && !isBlank(b);
}

/**
 * Decides which runs of empty paragraphs are scene breaks.
 *
 * Authors use blank lines in two different ways: some put one between every
 * paragraph (spacing), others use one only to mark a scene change. We look at
 * the whole document to tell which convention it follows.
 */
function resolveBlankParagraphs(blocks: DraftBlock[]): DraftBlock[] {
  // Measure every gap between two body paragraphs.
  let gaps = 0;
  let gapsWithBlanks = 0;
  const lengths = new Map<number, number>();
  for (let i = 0; i < blocks.length; i++) {
    if (!isBodyParagraph(blocks[i])) continue;
    let j = i + 1;
    let pageBreak = false;
    while (j < blocks.length && isBlank(blocks[j])) {
      if (blocks[j].pb) pageBreak = true;
      j++;
    }
    // An empty paragraph that only holds a page break says nothing about spacing habits.
    if (!isBodyParagraph(blocks[j]) || pageBreak || blocks[j].pb) continue;
    gaps++;
    const run = j - i - 1;
    if (run > 0) {
      gapsWithBlanks++;
      lengths.set(run, (lengths.get(run) ?? 0) + 1);
    }
  }
  const share = gaps ? gapsWithBlanks / gaps : 0;
  let threshold: number;
  if (share > 0.5) {
    // Blank lines are spacing. Only a longer-than-usual gap is a break.
    let usual = 1;
    let best = 0;
    for (const [len, n] of lengths) if (n > best) [usual, best] = [len, n];
    threshold = usual + 1;
  } else if (share < 0.2) {
    threshold = 1;
  } else {
    threshold = 2;
  }

  const out: DraftBlock[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (!isBlank(block)) {
      out.push(block);
      i++;
      continue;
    }
    let j = i;
    let pageBreak = false;
    while (j < blocks.length && isBlank(blocks[j])) {
      if (blocks[j].pb) pageBreak = true;
      j++;
    }
    const before = out[out.length - 1];
    const after = blocks[j];
    if (pageBreak && after) after.pb = true;
    else if (j - i >= threshold && isBodyParagraph(before) && isBodyParagraph(after) && !after.pb) {
      out.push({ type: 'break' });
    }
    i = j;
  }
  return out;
}

/**
 * Shared clean-up applied to every importer's output: trims whitespace,
 * recognises ornament lines such as "* * *" as scene breaks, resolves blank
 * paragraphs and removes duplicate or dangling breaks.
 */
export function finalizeBlocks(input: DraftBlock[]): DraftBlock[] {
  const cleaned: DraftBlock[] = [];
  for (const block of input) {
    if (block.type === 'break') {
      cleaned.push(block);
      continue;
    }
    let runs = trimRuns(block.runs);
    if (block.type === 'heading') {
      // Headings are bold by nature, and never span lines.
      runs = trimRuns(runs.map((r) => {
        const { b: _b, ...rest } = r;
        return { ...rest, text: r.text.replace(/\s*\n\s*/g, ' ') };
      }));
      if (!runs.length) continue;
    }
    const next = { ...block, runs } as DraftBlock;
    if (next.type === 'paragraph' && looksLikeSceneBreak(runsText(runs))) {
      cleaned.push({ type: 'break' });
    } else {
      cleaned.push(next);
    }
  }

  const resolved = resolveBlankParagraphs(cleaned);

  const out: DraftBlock[] = [];
  for (const block of resolved) {
    if (block.type === 'break') {
      const prev = out[out.length - 1];
      if (!prev || prev.type === 'break') continue;
    }
    out.push(block);
  }
  while (out.length && out[out.length - 1].type === 'break') out.pop();
  return out;
}

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** A readable title guessed from a file name such as "my_book-final v2.docx". */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base || 'Untitled';
}
