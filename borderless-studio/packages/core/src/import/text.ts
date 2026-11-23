/** Importing plain text and Markdown files, and turning HTML (from EPUBs) and RTF (from Scrivener) into Markdown. */
import { emptyImport, escapeMarkdown, kindFromTitle, tidyMarkdown, type ImportedBook, type ImportedItem } from './model';
import { parseXml, textOf, type XmlNode } from './xml';

const CHAPTER_LINE = /^(chapter|part|book)\s+([ivxlcdm]+|\d+|[a-z-]+)\b.{0,80}$|^(prologue|epilogue|foreword|preface|introduction|acknowledge?ments|afterword|dedication|about the author)$/i;

function titleOf(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

/** Markdown: every level 1 heading starts a new document (level 2 when the file has no level 1 headings). */
export function importMarkdown(source: string, fileName = ''): ImportedBook {
  const out = emptyImport();
  const text = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  // A front matter block gives title and author.
  let body = text;
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    out.title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] ?? '';
    out.author = /^author:\s*["']?(.+?)["']?\s*$/m.exec(fm[1])?.[1] ?? '';
  }
  const level = /^# \S/m.test(body) ? 1 : /^## \S/m.test(body) ? 2 : 0;
  const items: ImportedItem[] = [];
  let seenChapter = false;
  if (level === 0) {
    items.push({ title: titleOf(fileName) || 'Imported text', kind: 'chapter', text: tidyMarkdown(body) });
  } else {
    const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm');
    const marks = [...body.matchAll(re)];
    const before = body.slice(0, marks[0]?.index ?? 0).trim();
    if (before) items.push({ title: 'Opening pages', kind: 'front', text: tidyMarkdown(before) });
    marks.forEach((m, i) => {
      const title = m[1].replace(/\s+#+\s*$/, '').trim();
      const chunk = body.slice(m.index + m[0].length, marks[i + 1]?.index ?? body.length);
      const kind = kindFromTitle(title, seenChapter);
      if (kind === 'chapter') seenChapter = true;
      // Deeper headings move up so that chapter sections start at level 2.
      const shifted = level === 2 ? chunk.replace(/^###(#*) /gm, '##$1 ') : chunk;
      items.push({ title, kind: kind === 'part' && shifted.trim() ? 'chapter' : kind, text: tidyMarkdown(shifted) });
    });
  }
  out.items = items;
  if (!out.title) out.title = titleOf(fileName);
  return out;
}

/**
 * Plain text. Paragraphs are separated by blank lines, or by single line
 * breaks when the file has no blank lines; lines such as "Chapter 3" start a
 * new document; a line of asterisks is a scene break.
 */
export function importPlainText(source: string, fileName = ''): ImportedBook {
  const out = emptyImport();
  const text = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').replace(/[ \t]+$/gm, '');
  const blankSeparated = /\n\s*\n/.test(text.trim());
  const lines = text.split('\n');
  // In a file with blank lines between paragraphs, a single line break inside a paragraph is only where the
  // typist's line ended: long lines are joined again. Short lines (verse, an address) keep their breaks.
  const rejoin = (p: string): string => {
    const parts = p.split('\n').map((l) => l.trim()).filter(Boolean);
    if (parts.length < 2) return parts.join('');
    const wrapped = parts.slice(0, -1).some((l) => l.length >= 55);
    return wrapped ? parts.join(' ') : parts.join('\n');
  };
  const paragraphs = blankSeparated ? text.split(/\n\s*\n/).map(rejoin) : lines.map((l) => l.trim());
  const items: ImportedItem[] = [];
  let current: { title: string; lines: string[] } = { title: '', lines: [] };
  let seenChapter = false;
  const flush = () => {
    if (!current.title && current.lines.length === 0) return;
    const kind = current.title ? kindFromTitle(current.title, seenChapter) : 'chapter';
    if (kind === 'chapter') seenChapter = true;
    items.push({ title: current.title || titleOf(fileName) || 'Imported text', kind: kind === 'part' && current.lines.length ? 'chapter' : kind, text: tidyMarkdown(current.lines.join('\n\n')) });
  };
  for (const p of paragraphs) {
    if (!p) continue;
    const oneLine = !p.includes('\n');
    if (oneLine && p.length < 90 && CHAPTER_LINE.test(p)) {
      flush();
      current = { title: p, lines: [] };
    } else if (oneLine && /^(\*\s*){3,}$|^#$|^-{3,}$|^~{3,}$/.test(p)) current.lines.push('***');
    else current.lines.push(escapeMarkdown(p).replace(/^\s+/gm, '').replace(/\n/g, '\\\n'));
  }
  flush();
  out.items = items;
  out.title = titleOf(fileName);
  return out;
}

/* ------------------------------------------------------------------ */
/* HTML to Markdown (EPUB chapters)                                    */
/* ------------------------------------------------------------------ */

const BLOCK = new Set(['p', 'div', 'section', 'article', 'body', 'html', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'hr', 'figure', 'figcaption', 'table', 'tr', 'pre', 'aside', 'header', 'footer', 'nav', 'main']);

function inlineHtml(n: XmlNode, images: (src: string) => string | null): string {
  if (n.name === '#text') return escapeMarkdown(n.text.replace(/\s+/g, ' '));
  const inner = () => n.children.map((c) => inlineHtml(c, images)).join('');
  const wrapIn = (marker: string) => {
    const text = inner();
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    return m && m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : text;
  };
  switch (n.name.toLowerCase()) {
    case 'em': case 'i': case 'cite': return wrapIn('*');
    case 'strong': case 'b': return wrapIn('**');
    case 'br': return '\\\n';
    case 'sup': return `:sup[${inner()}]`;
    case 'sub': return `:sub[${inner()}]`;
    case 'a': {
      const href = n.attrs.href ?? '';
      const text = inner();
      return /^https?:/.test(href) ? `[${text}](${href})` : text;
    }
    case 'img': case 'image': {
      const name = images(n.attrs.src ?? n.attrs['xlink:href'] ?? '');
      return name ? `![${n.attrs.alt ?? ''}](images/${name})` : '';
    }
    case 'script': case 'style': case 'head': case 'title': return '';
    default: return inner();
  }
}

/** Convert a chapter of (X)HTML to Markdown. `images` maps a picture source to its name in the book's images folder. */
export function htmlToMarkdown(html: string, images: (src: string) => string | null = () => null): { title: string; markdown: string } {
  const root = parseXml(html.replace(/&nbsp;/g, '\u00A0'));
  const out: string[] = [];
  let title = '';
  const walk = (n: XmlNode, quote = false) => {
    const name = n.name.toLowerCase();
    if (name === '#text') {
      if (n.text.trim()) out.push((quote ? '> ' : '') + escapeMarkdown(n.text.replace(/\s+/g, ' ').trim()));
      return;
    }
    if (['head', 'script', 'style', 'nav'].includes(name)) return;
    if (/^h[1-6]$/.test(name)) {
      const text = n.children.map((c) => inlineHtml(c, images)).join('').replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return;
      if (!title && (name === 'h1' || name === 'h2')) title = text.replace(/[*\\]/g, '');
      else out.push(`${'#'.repeat(Math.max(2, Number(name[1])))} ${text}`);
      return;
    }
    if (name === 'hr') { out.push('***'); return; }
    if (name === 'p' || name === 'figcaption' || name === 'pre') {
      const text = n.children.map((c) => inlineHtml(c, images)).join('').trim();
      if (!text) return;
      if (/^(\\\*\s*){3,}$|^\*\s\*\s\*$|^#$/.test(text.replace(/\\/g, ''))) out.push('***');
      else out.push((quote ? '> ' : '') + text);
      return;
    }
    if (name === 'ul' || name === 'ol') {
      const items = n.children.filter((c) => c.name.toLowerCase() === 'li').map((li, i) => `${name === 'ol' ? `${i + 1}.` : '-'} ${li.children.map((c) => (BLOCK.has(c.name.toLowerCase()) ? textOf(c).replace(/\s+/g, ' ').trim() : inlineHtml(c, images))).join('').trim()}`);
      if (items.length) out.push(items.join('\n'));
      return;
    }
    if (name === 'img' || name === 'image') {
      const md = inlineHtml(n, images);
      if (md) out.push(md);
      return;
    }
    if (name === 'blockquote') { for (const c of n.children) walk(c, true); return; }
    if (name === 'table') {
      const rows = [] as string[][];
      const collect = (x: XmlNode) => { for (const c of x.children) { if (c.name.toLowerCase() === 'tr') rows.push(c.children.filter((d) => /^t[dh]$/i.test(d.name)).map((d) => textOf(d).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim())); else collect(c); } };
      collect(n);
      if (rows.length) {
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
        out.push([line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n'));
      }
      return;
    }
    // A container with only inline content is one paragraph.
    if (n.children.length && !n.children.some((c) => BLOCK.has(c.name.toLowerCase()) || c.name.toLowerCase() === 'img') && name !== 'body' && name !== 'html' && name !== '#root') {
      const text = n.children.map((c) => inlineHtml(c, images)).join('').trim();
      if (text) out.push((quote ? '> ' : '') + text);
      return;
    }
    for (const c of n.children) walk(c, quote);
  };
  walk(root);
  return { title, markdown: tidyMarkdown(out.join('\n\n')) };
}

/* ------------------------------------------------------------------ */
/* RTF to Markdown (Scrivener documents)                               */
/* ------------------------------------------------------------------ */

const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'footnote', 'themedata', 'datastore', 'listtable', 'listoverridetable', 'generator', 'xmlnstbl', 'latentstyles', 'filetbl', 'revtbl', 'rsidtbl', 'mmathPr', 'fldinst', 'expandedcolortbl', 'pgdsctbl']);

/** Convert RTF to Markdown: paragraphs, italics and bold. Enough for the text of a Scrivener document. */
export function rtfToMarkdown(rtf: string): string {
  let out = '';
  let i = 0;
  interface State { italic: boolean; bold: boolean; skip: boolean; uc: number }
  const stack: State[] = [];
  let st: State = { italic: false, bold: false, skip: false, uc: 1 };
  let run = '';
  let runStyle = '';
  let skipChars = 0;
  const styleOf = () => (st.bold && st.italic ? '***' : st.bold ? '**' : st.italic ? '*' : '');
  const flushRun = () => {
    if (run) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(run)!;
      out += runStyle && m[2] ? `${m[1]}${runStyle}${m[2]}${runStyle}${m[3]}` : run;
    }
    run = '';
  };
  const emit = (text: string) => {
    if (st.skip) return;
    if (skipChars > 0) { const n = Math.min(skipChars, text.length); skipChars -= n; text = text.slice(n); if (!text) return; }
    const style = styleOf();
    if (style !== runStyle) { flushRun(); runStyle = style; }
    run += escapeMarkdown(text);
  };
  const paragraphBreak = () => { flushRun(); out += '\n\n'; };
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      stack.push({ ...st });
      i++;
      // {\*\destination ...} is an optional destination: skip it unless it is known text.
      if (rtf.startsWith('\\*', i)) st = { ...st, skip: true };
    } else if (ch === '}') {
      const before = styleOf();
      st = stack.pop() ?? st;
      if (styleOf() !== before) flushRun();
      i++;
    } else if (ch === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') { emit(next); i += 2; continue; }
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        // Windows-1252 covers the typographic quotes and dashes Word and Scrivener write this way.
        const cp1252: Record<number, string> = { 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x96: '\u2013', 0x97: '\u2014', 0x85: '\u2026', 0xa0: '\u00A0' };
        emit(cp1252[code] ?? String.fromCharCode(code));
        i += 4;
        continue;
      }
      if (next === '~') { emit('\u00A0'); i += 2; continue; }
      if (next === '-' || next === '_') { if (next === '_') emit('-'); i += 2; continue; }
      if (next === '\n' || next === '\r') { paragraphBreak(); i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (!m) { i += 2; continue; }
      i += m[0].length;
      const word = m[1];
      const num = m[2] !== undefined ? Number(m[2]) : null;
      if (RTF_SKIP.has(word)) st = { ...st, skip: true };
      else if (word === 'par' || word === 'sect' || word === 'page') paragraphBreak();
      else if (word === 'line') emit('\n');
      else if (word === 'tab') emit(' ');
      else if (word === 'i') { const b = styleOf(); st = { ...st, italic: num !== 0 }; if (styleOf() !== b) flushRun(); }
      else if (word === 'b') { const b = styleOf(); st = { ...st, bold: num !== 0 }; if (styleOf() !== b) flushRun(); }
      else if (word === 'plain') { flushRun(); st = { ...st, italic: false, bold: false }; }
      else if (word === 'uc' && num !== null) st = { ...st, uc: num };
      else if (word === 'u' && num !== null) { emit(String.fromCodePoint(num < 0 ? num + 65536 : num)); skipChars = st.uc; }
      else if (word === 'emdash') emit('\u2014');
      else if (word === 'endash') emit('\u2013');
      else if (word === 'lquote') emit('\u2018');
      else if (word === 'rquote') emit('\u2019');
      else if (word === 'ldblquote') emit('\u201C');
      else if (word === 'rdblquote') emit('\u201D');
      else if (word === 'bullet') emit('\u2022');
    } else if (ch === '\n' || ch === '\r') {
      i++;
    } else {
      // A run of ordinary characters.
      let j = i;
      while (j < rtf.length && !'\\{}\n\r'.includes(rtf[j])) j++;
      emit(rtf.slice(i, j));
      i = j;
    }
  }
  flushRun();
  return tidyMarkdown(out.replace(/^(\\\*\s*){3,}$|^#$/gm, '***'));
}
