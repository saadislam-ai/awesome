import { looksLikeSceneBreak, type DraftBlock, type HeadingLevel, type Run } from '../model/blocks';
import { finalizeBlocks, ImportError, type ImportMeta, type ImportResult } from './common';

/** The part of pdf.js this importer needs. Injected so it also runs in tests. */
export interface PdfLib {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDocument(src: any): { promise: Promise<any> };
}

export interface PdfOptions {
  /** Where pdf.js can load character maps for Chinese, Japanese and Korean PDFs. */
  cMapUrl?: string;
  standardFontDataUrl?: string;
  onProgress?: (page: number, pages: number) => void;
}

interface Line {
  page: number;
  x0: number;
  x1: number;
  y: number;
  size: number;
  text: string;
  runs: Run[];
  pageWidth: number;
  pageHeight: number;
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
  font: string;
}

const PAGE_NUMBER = /^(?:page\s*)?(?:\d+|[ivxlcdm]+)(?:\s*(?:of|\/)\s*\d+)?$|^[-–—~]\s*\d+\s*[-–—~]$/i;
const SENTENCE_END = /[.!?…:;"”’»)\]]$/;

function mode(values: number[], weights?: number[]): number {
  const counts = new Map<number, number>();
  values.forEach((v, i) => counts.set(v, (counts.get(v) ?? 0) + (weights ? weights[i] : 1)));
  let best = 0;
  let bestCount = -1;
  for (const [v, n] of counts) if (n > bestCount) [best, bestCount] = [v, n];
  return best;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function buildLines(items: Item[], fontMarks: Map<string, { b: boolean; i: boolean }>, page: number, pageWidth: number, pageHeight: number): Line[] {
  const sorted = items.filter((it) => it.str.length).sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Item[][] = [];
  for (const item of sorted) {
    const group = groups[groups.length - 1];
    if (group && Math.abs(group[0].y - item.y) <= Math.max(group[0].size, item.size) * 0.45) group.push(item);
    else groups.push([item]);
  }
  const lines: Line[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    const runs: Run[] = [];
    let text = '';
    let prevEnd = group[0].x;
    for (const item of group) {
      let str = item.str;
      const gap = item.x - prevEnd;
      if (text && gap > item.size * 0.2 && !text.endsWith(' ') && !str.startsWith(' ')) str = ' ' + str;
      const marks = fontMarks.get(item.font);
      const run: Run = { text: str };
      if (marks?.b) run.b = true;
      if (marks?.i) run.i = true;
      runs.push(run);
      text += str;
      prevEnd = item.x + item.w;
    }
    if (!text.trim()) continue;
    const sizes = group.map((g) => Math.round(g.size * 2) / 2);
    lines.push({
      page,
      x0: group[0].x,
      x1: prevEnd,
      y: group[0].y,
      size: mode(sizes, group.map((g) => g.str.length || 1)),
      text: text.trim(),
      runs,
      pageWidth,
      pageHeight,
    });
  }
  return lines;
}

/** Removes page numbers and running headers or footers. */
function dropHeadersAndFooters(pages: Line[][]): Line[][] {
  const key = (line: Line) => line.text.replace(/\d+/g, '#').toLowerCase().trim();
  const inMargin = (line: Line) => line.y > line.pageHeight * 0.9 || line.y < line.pageHeight * 0.09;
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const seen = new Set<string>();
    for (const line of lines) {
      if (!inMargin(line)) continue;
      const k = key(line);
      if (!seen.has(k)) {
        seen.add(k);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  const repeated = Math.max(3, Math.ceil(pages.length * 0.2));
  return pages.map((lines) =>
    lines.filter((line) => {
      if (!inMargin(line)) return true;
      if (PAGE_NUMBER.test(line.text)) return false;
      return (counts.get(key(line)) ?? 0) < repeated;
    }),
  );
}

function trimLineRuns(runs: Run[]): Run[] {
  return runs.map((r) => ({ ...r }));
}

/** Imports a PDF that has a text layer by rebuilding paragraphs from its layout. */
export async function importPdf(bytes: Uint8Array, pdfjs: PdfLib, options: PdfOptions = {}): Promise<ImportResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = await pdfjs.getDocument({
      // pdf.js takes ownership of the buffer, so hand it a copy.
      data: bytes.slice(),
      cMapUrl: options.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: options.standardFontDataUrl,
      useSystemFonts: false,
      disableFontFace: true,
      // Exposes real font names, which is how bold and italic are recognised.
      fontExtraProperties: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'PasswordException') {
      throw new ImportError('This PDF is password-protected. Remove the password and try again.');
    }
    throw new ImportError('This PDF could not be opened. It may be damaged.');
  }

  const pages: Line[][] = [];
  let totalChars = 0;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const fontMarks = new Map<string, { b: boolean; i: boolean }>();
      try {
        // Real font names (needed to spot bold and italic) are only known after the page is parsed.
        await page.getOperatorList();
        for (const item of content.items) {
          const font = item.fontName as string | undefined;
          if (!font || fontMarks.has(font)) continue;
          const name: string = page.commonObjs.has(font) ? (page.commonObjs.get(font)?.name ?? '') : '';
          fontMarks.set(font, { b: /bold|black|heavy|semibold|demi/i.test(name), i: /ital|obli/i.test(name) });
        }
      } catch {
        // Styling is optional; the text itself is still imported.
      }
      const items: Item[] = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const t = item.transform as number[];
        // Skip rotated text such as watermarks.
        if (Math.abs(t[1]) > Math.abs(t[0]) * 0.2) continue;
        const size = Math.hypot(t[0], t[1]) || item.height || 10;
        items.push({ str: item.str.replace(/­/g, ''), x: t[4], y: t[5], w: item.width ?? 0, size, font: item.fontName ?? '' });
        totalChars += item.str.trim().length;
      }
      pages.push(buildLines(items, fontMarks, n, viewport.width, viewport.height));
      page.cleanup?.();
      options.onProgress?.(n, doc.numPages);
    }
  } finally {
    // Metadata is read below, so the document is destroyed at the very end.
  }

  if (totalChars < Math.max(40, doc.numPages * 5)) {
    await doc.destroy?.();
    throw new ImportError(
      'This PDF has no text layer. It looks like a scan, and text recognition (OCR) is not supported yet. Ask for a Word or text version of the manuscript.',
    );
  }

  const meta: ImportMeta = {};
  try {
    const info = (await doc.getMetadata())?.info ?? {};
    if (typeof info.Title === 'string' && info.Title.trim()) meta.title = info.Title.trim();
    if (typeof info.Author === 'string' && info.Author.trim()) meta.author = info.Author.trim();
  } catch {
    // No metadata is fine.
  }
  await doc.destroy?.();

  const cleanPages = dropHeadersAndFooters(pages);
  const all = cleanPages.flat();
  const bodySize = mode(all.map((l) => l.size), all.map((l) => l.text.length));
  const bodyLines = all.filter((l) => Math.abs(l.size - bodySize) < 0.6);

  const pitches: number[] = [];
  for (const lines of cleanPages) {
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y;
      if (gap > 0 && gap < bodySize * 3 && Math.abs(lines[i].size - bodySize) < 0.6) pitches.push(Math.round(gap * 2) / 2);
    }
  }
  const pitch = pitches.length ? mode(pitches) : bodySize * 1.3;
  const globalMargin = bodyLines.length ? mode(bodyLines.map((l) => Math.round(l.x0))) : 0;
  const globalRight = bodyLines.length ? median(bodyLines.map((l) => l.x1).sort((a, b) => a - b).slice(-Math.ceil(bodyLines.length / 3))) : 0;

  const blocks: DraftBlock[] = [];
  let current: { runs: Run[]; text: string; block: DraftBlock } | null = null;
  let prev: Line | null = null;
  let prevKind: 'body' | 'heading' | 'centered' | null = null;

  const startBlock = (block: DraftBlock, line: Line) => {
    blocks.push(block);
    current = block.type === 'break' ? null : { runs: block.runs, text: line.text, block };
  };

  const append = (line: Line) => {
    if (!current) return;
    const lastRun: Run | undefined = current.runs[current.runs.length - 1];
    const startsLower = /^\p{Ll}/u.test(line.text);
    if (lastRun && /[\p{L}]-$/u.test(current.text) && startsLower) {
      // A word split across lines: remove the line-end hyphen.
      lastRun.text = lastRun.text.replace(/-\s*$/, '');
    } else if (lastRun && !lastRun.text.endsWith(' ')) {
      lastRun.text += ' ';
    }
    current.runs.push(...trimLineRuns(line.runs));
    current.text = line.text;
  };

  for (const lines of cleanPages) {
    const pageBody = lines.filter((l) => Math.abs(l.size - bodySize) < 0.6);
    const margin = pageBody.length >= 3 ? mode(pageBody.map((l) => Math.round(l.x0))) : globalMargin;
    const right = pageBody.length >= 3 ? Math.max(...pageBody.map((l) => l.x1)) : globalRight;
    const width = Math.max(right - margin, 1);
    let firstOnPage = true;

    for (const line of lines) {
      const isHeading = line.size >= bodySize * 1.15 && line.text.length < 140;
      const centre = (line.x0 + line.x1) / 2;
      const pageCentre = margin + width / 2;
      const isCentered =
        !isHeading &&
        Math.abs(centre - pageCentre) < width * 0.04 &&
        line.x0 > margin + line.size * 1.5 &&
        line.x1 < right - line.size * 1.5;
      const kind = isHeading ? 'heading' : isCentered ? 'centered' : 'body';
      const samePage: boolean = !!prev && prev.page === line.page;
      const gap = samePage && prev ? prev.y - line.y : 0;

      if (isHeading) {
        const ratio = line.size / bodySize;
        const level: HeadingLevel = ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : 3;
        const last: DraftBlock | undefined = blocks[blocks.length - 1];
        if (prevKind === 'heading' && prev && samePage && Math.abs(prev.size - line.size) < 0.6 && gap < line.size * 1.8 && last?.type === 'heading') {
          append(line);
        } else {
          const block: DraftBlock = { type: 'heading', level, runs: trimLineRuns(line.runs) };
          if (firstOnPage) block.pb = true;
          startBlock(block, line);
        }
      } else if (isCentered) {
        if (looksLikeSceneBreak(line.text)) {
          blocks.push({ type: 'break' });
          current = null;
        } else if (
          prevKind === 'centered' && samePage && gap < pitch * 1.45 && current && prev &&
          // Only a centred line that fills most of the width is a wrapped paragraph. Short centred lines stand alone.
          prev.x1 - prev.x0 > width * 0.6
        ) {
          append(line);
        } else {
          startBlock({ type: 'paragraph', align: 'center', runs: trimLineRuns(line.runs) }, line);
        }
      } else {
        const indented = line.x0 > margin + line.size * 0.6;
        const prevShort = !!prev && prev.x1 < right - width * 0.15 && SENTENCE_END.test(prev.text);
        const bigGap = samePage && gap > pitch * 1.45;
        const newParagraph = !current || prevKind !== 'body' || indented || bigGap || prevShort;
        if (newParagraph) {
          // A clearly larger vertical gap between body paragraphs marks a scene change.
          if (samePage && prevKind === 'body' && gap > pitch * 2.3) blocks.push({ type: 'paragraph', runs: [] });
          startBlock({ type: 'paragraph', runs: trimLineRuns(line.runs) }, line);
        } else {
          append(line);
        }
      }
      prev = line;
      prevKind = kind;
      firstOnPage = false;
    }
  }

  return {
    format: 'pdf',
    blocks: finalizeBlocks(blocks),
    meta,
    warnings: [
      'PDF files do not store paragraphs, so they were rebuilt from the page layout. Check paragraphs and chapter breaks before editing.',
    ],
  };
}
