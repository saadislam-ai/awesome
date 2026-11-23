/**
 * Masking: return a copy of a Markdown document in which every character that
 * is markup (not prose) has been replaced by a space, WITHOUT changing the
 * length of the text. Because offsets stay identical, word counts, spell
 * checking, style analysis and search can all work on the masked text and
 * report positions that are valid in the real document.
 *
 * What counts as prose: paragraph text, headings, list items, quotes, table
 * cells, footnote text and the text of pending tracked changes. What is
 * masked: Markdown punctuation, CriticMarkup braces, comments, image and link
 * targets, directive names and attributes, code and index markers.
 */

function blank(chars: string[], from: number, to: number): void {
  for (let i = Math.max(0, from); i < to && i < chars.length; i++) {
    if (chars[i] !== '\n') chars[i] = ' ';
  }
}

export interface MaskOptions {
  /** Hide text inside pending deletions ({--...--} and the old side of substitutions). Default false. */
  hideDeletions?: boolean;
  /** Hide text inside pending insertions. Default false. */
  hideInsertions?: boolean;
}

export function maskMarkdown(src: string, opts: MaskOptions = {}): string {
  const chars = src.split('');
  const n = src.length;

  // 1. Fenced code blocks and comment tokens: gone entirely.
  for (const m of src.matchAll(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm)) blank(chars, m.index, m.index + m[0].length);
  for (const m of src.matchAll(/\{>>[\s\S]*?<<\}/g)) blank(chars, m.index, m.index + m[0].length);

  // 2. CriticMarkup: remove the braces, keep (or hide) the text.
  for (const m of src.matchAll(/\{\+\+([\s\S]*?)\+\+\}/g)) {
    if (opts.hideInsertions) blank(chars, m.index, m.index + m[0].length);
    else {
      blank(chars, m.index, m.index + 3);
      blank(chars, m.index + m[0].length - 3, m.index + m[0].length);
    }
  }
  for (const m of src.matchAll(/\{--([\s\S]*?)--\}/g)) {
    if (opts.hideDeletions) blank(chars, m.index, m.index + m[0].length);
    else {
      blank(chars, m.index, m.index + 3);
      blank(chars, m.index + m[0].length - 3, m.index + m[0].length);
    }
  }
  for (const m of src.matchAll(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g)) {
    const start = m.index;
    const oldEnd = start + 3 + m[1].length;
    blank(chars, start, start + 3);
    blank(chars, oldEnd, oldEnd + 2);
    blank(chars, start + m[0].length - 3, start + m[0].length);
    if (opts.hideDeletions) blank(chars, start + 3, oldEnd);
    if (opts.hideInsertions) blank(chars, oldEnd + 2, start + m[0].length - 3);
  }
  for (const m of src.matchAll(/\{==([\s\S]*?)==\}/g)) {
    blank(chars, m.index, m.index + 3);
    blank(chars, m.index + m[0].length - 3, m.index + m[0].length);
  }

  // 3. Line level markup.
  let lineStart = 0;
  while (lineStart <= n) {
    let lineEnd = src.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = n;
    const line = src.slice(lineStart, lineEnd);
    let m: RegExpExecArray | null;
    if (/^\s{0,3}([*\-_])(\s*\1){2,}\s*$/.test(line)) {
      blank(chars, lineStart, lineEnd); // scene break
    } else if ((m = /^:{3,}\s*[\w-]*/.exec(line))) {
      // container directive fence: keep a [label], drop the name and {attributes}
      blank(chars, lineStart, lineStart + m[0].length);
      const attrs = /\{[^}]*\}\s*$/.exec(line);
      if (attrs) blank(chars, lineStart + attrs.index, lineEnd);
    } else if ((m = /^::[\w-]+/.exec(line))) {
      blank(chars, lineStart, lineStart + m[0].length);
      const attrs = /\{[^}]*\}\s*$/.exec(line);
      if (attrs) blank(chars, lineStart + attrs.index, lineEnd);
    } else if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && line.includes('|')) {
      blank(chars, lineStart, lineEnd); // table delimiter row
    } else {
      if ((m = /^\s{0,3}#{1,6}\s+/.exec(line))) blank(chars, lineStart, lineStart + m[0].length);
      else if ((m = /^(\s*>\s?)+/.exec(line))) blank(chars, lineStart, lineStart + m[0].length);
      if ((m = /^\s*(?:[-*+]|\d{1,4}[.)])\s+/.exec(line))) blank(chars, lineStart, lineStart + m[0].length);
      if ((m = /^\[\^[^\]]+\]:\s*/.exec(line))) blank(chars, lineStart, lineStart + m[0].length);
      if (line.endsWith('\\')) blank(chars, lineEnd - 1, lineEnd);
    }
    lineStart = lineEnd + 1;
  }

  // 4. Inline markup (work on the partly masked text so earlier removals are respected).
  const cur = chars.join('');
  for (const m of cur.matchAll(/!\[[^\]\n]*\]\([^)\n]*\)/g)) blank(chars, m.index, m.index + m[0].length); // images
  for (const m of cur.matchAll(/\[\^[^\]\n]+\]/g)) blank(chars, m.index, m.index + m[0].length); // footnote refs
  for (const m of cur.matchAll(/:(?:index|idx)\[[^\]\n]*\]/g)) blank(chars, m.index, m.index + m[0].length); // index markers
  for (const m of cur.matchAll(/:(?:sc|sup|sub)\[([^\]\n]*)\]/g)) {
    blank(chars, m.index, m.index + m[0].indexOf('[') + 1);
    blank(chars, m.index + m[0].length - 1, m.index + m[0].length);
  }
  for (const m of cur.matchAll(/\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    if (m.index > 0 && cur[m.index - 1] === '!') continue;
    blank(chars, m.index, m.index + 1);
    blank(chars, m.index + 1 + m[1].length, m.index + m[0].length);
  }
  for (const m of cur.matchAll(/`[^`\n]*`/g)) blank(chars, m.index, m.index + m[0].length); // inline code
  for (const m of cur.matchAll(/<\/?[a-zA-Z][^>\n]*>/g)) blank(chars, m.index, m.index + m[0].length); // html tags
  // Emphasis markers: asterisks always, underscores only at word edges.
  for (let i = 0; i < n; i++) {
    const c = chars[i];
    if (c === '*') chars[i] = ' ';
    else if (c === '_') {
      const prev = i > 0 ? chars[i - 1] : ' ';
      const next = i + 1 < n ? chars[i + 1] : ' ';
      const wordBefore = /[\p{L}\p{N}]/u.test(prev);
      const wordAfter = /[\p{L}\p{N}]/u.test(next);
      if (!(wordBefore && wordAfter)) chars[i] = ' ';
    } else if (c === '|') chars[i] = ' ';
    else if (c === '\\' && i + 1 < n && /[\\`*_{}[\]()#+\-.!|>~]/.test(chars[i + 1])) chars[i] = ' ';
  }
  return chars.join('');
}

/** Words in a Markdown document, ignoring markup and comments. */
export function proseText(src: string): string {
  return maskMarkdown(src);
}
