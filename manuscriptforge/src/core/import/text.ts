import { marked } from 'marked';
import type { DraftBlock, HeadingLevel } from '../model/blocks';
import { decodeText, finalizeBlocks, type ImportMeta, type ImportResult } from './common';
import { htmlToBlocks } from './html';

/**
 * Plain text comes in two shapes: one paragraph per line, or paragraphs
 * hard-wrapped at about 70 characters with blank lines between them (the
 * Project Gutenberg style). This decides which shape a file has.
 */
function isHardWrapped(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length < 8) return false;
  const lengths = nonEmpty.map((l) => l.trimEnd().length);
  const max = Math.max(...lengths);
  if (max > 100) return false;
  const nearFull = lengths.filter((n) => n >= max - 22 && n <= max).length;
  const blankLines = lines.length - nonEmpty.length;
  return max >= 45 && nearFull / nonEmpty.length > 0.45 && blankLines > 0;
}

/** Imports a plain text file. */
export function importTxt(bytes: Uint8Array): ImportResult {
  const text = decodeText(bytes).replace(/\r\n?/g, '\n').replace(/\u000c/g, '\n\n\n');
  const lines = text.split('\n');
  const blocks: DraftBlock[] = [];

  const pushLine = (raw: string) => {
    const line = raw.trim();
    const heading = /^(#{1,4})\s+(\S.*?)\s*#*$/.exec(line);
    if (heading) blocks.push({ type: 'heading', level: heading[1].length as HeadingLevel, runs: [{ text: heading[2] }] });
    else blocks.push({ type: 'paragraph', runs: line ? [{ text: line }] : [] });
  };

  if (isHardWrapped(lines)) {
    let current: string[] = [];
    let blanks = 0;
    const flush = () => {
      if (current.length) pushLine(current.join(' '));
      current = [];
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flush();
        blanks++;
        continue;
      }
      // Two or more blank lines are deliberate, one is just paragraph spacing.
      if (blanks >= 2 && blocks.length) blocks.push({ type: 'paragraph', runs: [] });
      blanks = 0;
      // Short all-caps or "Chapter N" lines stand alone even when wrapped text follows directly.
      if (current.length === 0 && /^(#{1,4}\s|chapter\b|part\b|prologue\b|epilogue\b)/i.test(line)) {
        pushLine(line);
        continue;
      }
      current.push(line);
    }
    flush();
  } else {
    for (const raw of lines) pushLine(raw);
  }
  return { format: 'txt', blocks: finalizeBlocks(blocks), meta: {}, warnings: [] };
}

function readFrontMatter(source: string): { body: string; meta: ImportMeta } {
  const meta: ImportMeta = {};
  const m = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\n/.exec(source);
  if (!m) return { body: source, meta };
  let recognised = false;
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2].trim().replace(/^["']|["']$/g, '');
    const key = kv[1].toLowerCase();
    if (!value) continue;
    if (key === 'title') [meta.title, recognised] = [value, true];
    else if (key === 'author') [meta.author, recognised] = [value, true];
    else if (key === 'lang' || key === 'language') [meta.language, recognised] = [value, true];
  }
  // Only treat the block as front matter when it carried metadata we understand.
  return recognised ? { body: source.slice(m[0].length), meta } : { body: source, meta };
}

/** Imports a Markdown file. */
export function importMarkdown(bytes: Uint8Array): ImportResult {
  const source = decodeText(bytes).replace(/\r\n?/g, '\n');
  const { body, meta } = readFrontMatter(source);
  const html = marked.parse(body, { async: false, gfm: true, breaks: false }) as string;
  const { blocks, images } = htmlToBlocks(html);
  const warnings = images ? [`${images} image${images === 1 ? ' was' : 's were'} not imported.`] : [];
  return { format: 'md', blocks: finalizeBlocks(blocks), meta, warnings };
}
