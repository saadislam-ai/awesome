/**
 * Importing a Word file (.docx): chapters from "Heading 1" paragraphs (or
 * from lines such as "Chapter Seven"), italics and bold, footnotes, lists,
 * pictures, and Word's tracked changes and comments, which become
 * CriticMarkup so an editor's corrections arrive as suggestions.
 */
import { strFromU8, unzipSync } from 'fflate';
import { cleanTitle, emptyImport, escapeMarkdown, kindFromTitle, tidyMarkdown, unescapeMarkdown, type ImportedBook, type ImportedItem } from './model';
import { child, children, descendants, parseXml, textOf, type XmlNode } from './xml';

interface Ctx {
  footnotes: Map<string, string>;
  comments: Map<string, { author: string; text: string }>;
  images: Map<string, string>;
  links: Map<string, string>;
  usedNotes: string[];
  headingLevel: Map<string, number>;
  listKind: Map<string, boolean>;
  nextNote: number;
}

const val = (n: XmlNode | undefined): string => n?.attrs['w:val'] ?? '';
const on = (n: XmlNode | undefined): boolean => Boolean(n) && val(n) !== 'false' && val(n) !== '0' && val(n) !== 'none';

/** Wrap text in Markdown emphasis, keeping any leading and trailing spaces outside the markers. */
function wrap(text: string, marker: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m || !m[2]) return text;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

/** The text of one run and the emphasis it carries ("", "*", "**" or "***"). */
function runParts(r: XmlNode, ctx: Ctx, deleted = false): { text: string; marker: string } {
  const pr = child(r, 'w:rPr');
  let out = '';
  for (const c of r.children) {
    if (c.name === 'w:t' || (deleted && c.name === 'w:delText')) out += escapeMarkdown(textOf(c));
    else if (c.name === 'w:tab') out += ' ';
    else if (c.name === 'w:br') out += c.attrs['w:type'] === 'page' ? '' : '\\\n';
    else if (c.name === 'w:noBreakHyphen') out += '-';
    else if (c.name === 'w:commentReference') {
      const note = ctx.comments.get(c.attrs['w:id'] ?? '');
      if (note) return { text: `${out}{>>${note.author ? '@' + note.author + ': ' : ''}${note.text}<<}`, marker: '' };
    } else if (c.name === 'w:footnoteReference' || c.name === 'w:endnoteReference') {
      const key = `${c.name === 'w:endnoteReference' ? 'e' : 'f'}${c.attrs['w:id']}`;
      if (ctx.footnotes.has(key)) {
        const label = `n${ctx.nextNote++}`;
        ctx.usedNotes.push(`[^${label}]: ${ctx.footnotes.get(key)}`);
        return { text: `${out}[^${label}]`, marker: '' };
      }
    } else if (c.name === 'w:drawing' || c.name === 'w:pict') {
      const blip = descendants(c, 'a:blip')[0] ?? descendants(c, 'v:imagedata')[0];
      const rid = blip?.attrs['r:embed'] ?? blip?.attrs['r:id'];
      const name = rid ? ctx.images.get(rid) : undefined;
      const alt = descendants(c, 'wp:docPr')[0]?.attrs.descr ?? '';
      if (name) return { text: `${out}\n\n![${alt}](images/${name})\n\n`, marker: '' };
    }
  }
  if (!out.trim()) return { text: out, marker: '' };
  const vert = val(child(pr, 'w:vertAlign'));
  if (vert === 'superscript') out = `:sup[${out}]`;
  if (vert === 'subscript') out = `:sub[${out}]`;
  if (on(child(pr, 'w:smallCaps'))) out = `:sc[${out}]`;
  const bold = on(child(pr, 'w:b'));
  const italic = on(child(pr, 'w:i'));
  return { text: out, marker: bold && italic ? '***' : bold ? '**' : italic ? '*' : '' };
}

function inlineOf(nodes: XmlNode[], ctx: Ctx, deleted = false): string {
  let out = '';
  // Word splits a sentence into many runs; neighbours with the same emphasis are joined before the markers are added.
  let pending: { text: string; marker: string } | null = null;
  const flush = () => {
    if (pending) out += pending.marker ? wrap(pending.text, pending.marker) : pending.text;
    pending = null;
  };
  for (const n of nodes) {
    if (n.name === 'w:r') {
      const part = runParts(n, ctx, deleted);
      if (!part.text) continue;
      // Spaces between two emphasised runs stay inside the emphasis.
      if (pending && (pending.marker === part.marker || (!part.text.trim() && pending.marker))) pending.text += part.text;
      else {
        flush();
        pending = part;
      }
      continue;
    }
    flush();
    if (n.name === 'w:hyperlink') {
      const href = ctx.links.get(n.attrs['r:id'] ?? '');
      const text = inlineOf(n.children, ctx);
      out += href ? `[${text}](${href})` : text;
    } else if (n.name === 'w:ins') {
      const text = inlineOf(n.children, ctx);
      if (text) out += `{++${text}++}`;
    } else if (n.name === 'w:del') {
      const text = inlineOf(n.children, ctx, true);
      if (text) out += `{--${text}--}`;
    } else if (n.name === 'w:commentReference') {
      const c = ctx.comments.get(n.attrs['w:id'] ?? '');
      if (c) out += `{>>${c.author ? '@' + c.author + ': ' : ''}${c.text}<<}`;
    } else if (n.name === 'w:smartTag' || n.name === 'w:sdt' || n.name === 'w:sdtContent' || n.name === 'w:fldSimple') out += inlineOf(n.children, ctx, deleted);
  }
  flush();
  return out;
}

interface Para {
  text: string;
  heading: number;
  list: 'ul' | 'ol' | null;
  /** The number typed in front of a hand numbered list item. */
  start: number | null;
  /** A page break before the text of this paragraph, or after it. */
  breakBefore: boolean;
  breakAfter: boolean;
  centered: boolean;
  quote: boolean;
}

/** Where a manual page break sits in a paragraph: before its text or after it. A section break ends the page as well. */
function pageBreaks(p: XmlNode, pr: XmlNode | undefined): { before: boolean; after: boolean } {
  let seenText = false;
  let before = on(child(pr, 'w:pageBreakBefore'));
  let after = Boolean(child(pr, 'w:sectPr'));
  const walk = (n: XmlNode): void => {
    if (n.name === 'w:t' && textOf(n).trim()) seenText = true;
    else if (n.name === 'w:br' && n.attrs['w:type'] === 'page') {
      if (seenText) after = true;
      else before = true;
    }
    for (const c of n.children) walk(c);
  };
  walk(p);
  return { before, after };
}

function paragraph(p: XmlNode, ctx: Ctx): Para {
  const pr = child(p, 'w:pPr');
  const style = val(child(pr, 'w:pStyle'));
  let heading = ctx.headingLevel.get(style) ?? 0;
  const outline = child(pr, 'w:outlineLvl');
  if (!heading && outline) heading = Number(val(outline)) + 1;
  const num = child(pr, 'w:numPr');
  const numId = val(child(num, 'w:numId'));
  let list: Para['list'] = num && numId !== '0' ? (ctx.listKind.get(numId) ? 'ol' : 'ul') : /^List(Bullet|Paragraph)?/.test(style) && /Bullet/.test(style) ? 'ul' : /^ListNumber/.test(style) ? 'ol' : null;
  let text = inlineOf(p.children, ctx).replace(/\s+$/g, '');
  let start: number | null = null;
  if (!list && !heading) {
    // Numbers and bullets typed by hand ("1." or a bullet, then a tab or a space) are lists too.
    const typedNumber = /^\\(\d{1,3})[.)][ \t]+(?=\S)/.exec(text);
    const typedBullet = /^[•◦▪‣·][ \t]+(?=\S)/.exec(text);
    if (typedNumber) {
      list = 'ol';
      start = Number(typedNumber[1]);
      text = text.slice(typedNumber[0].length);
    } else if (typedBullet) {
      list = 'ul';
      text = text.slice(typedBullet[0].length);
    }
  }
  const breaks = pageBreaks(p, pr);
  return { text, heading, list, start, breakBefore: breaks.before, breakAfter: breaks.after, centered: val(child(pr, 'w:jc')) === 'center', quote: /quote/i.test(style) };
}

function tableMarkdown(tbl: XmlNode, ctx: Ctx): string {
  const rows = children(tbl, 'w:tr').map((tr) => children(tr, 'w:tc').map((tc) => children(tc, 'w:p').map((p) => inlineOf(p.children, ctx)).join(' ').replace(/\|/g, '\\|').trim()));
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

const CHAPTER_LINE = /^(chapter|part|book)\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty[\w-]*|thirty[\w-]*|forty[\w-]*|fifty[\w-]*)\b.{0,80}$|^(prologue|epilogue|foreword|preface|introduction|acknowledge?ments|afterword|dedication|about the author)$/i;
const SCENE_LINE = /^(\*\s*\*\s*\*|\*{3,}|#|# # #|~+|\u2042|\u2022\s*\u2022\s*\u2022|-{3,}|_{3,})$/;

/** Titles that Word writes by itself and that are not the title of a book. */
const TITLE_JUNK = /\.(docx?|rtf|odt)$|^microsoft word|^document\s*\d*$|^untitled|^normal$/i;
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'on', 'at', 'to', 'from', 'by', 'of', 'in', 'with']);

/** "THE SALT ROAD" as "The Salt Road". Text that is not all capitals is left alone. */
function fromCapitals(line: string): string {
  if (!/[A-Z]/.test(line) || line !== line.toUpperCase()) return line;
  return line
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** The lines of some Markdown paragraphs as plain text, for recognising what a page is. */
function plainLines(paragraphs: string[]): string[] {
  return paragraphs
    .flatMap((l) => l.split('\n'))
    .map((l) => unescapeMarkdown(l.replace(/\\$/, '').replace(/(?<!\\)[*_]/g, '')).replace(/^>\s?/, '').trim())
    .filter(Boolean);
}
const countWords = (lines: string[]): number => lines.join(' ').split(/\s+/).filter(Boolean).length;

/**
 * "THE END", and a scene break with nothing after it, are manuscript
 * conventions and not part of the text. Returns the text without them.
 */
function stripEnding(text: string): { text: string; removedEnd: boolean } {
  const paras = text.replace(/\s+$/, '').split(/\n{2,}/);
  let removedEnd = false;
  for (;;) {
    const last = (paras[paras.length - 1] ?? '').trim();
    if (paras.length > 1 && /^[*_]{0,3}(?:[Tt][Hh][Ee] [Ee][Nn][Dd]|END)\.?[*_]{0,3}$/.test(last)) removedEnd = true;
    else if (!(paras.length > 1 && last === '***')) break;
    paras.pop();
  }
  return { text: paras.join('\n\n'), removedEnd };
}

/**
 * The pages before the first chapter heading, one entry for each page.
 * A manuscript usually opens with a title page (left out, because the app
 * makes its own, but the author's name and the title are read from it), and
 * often a dedication and an epigraph on pages of their own.
 *
 * When the file has no chapter headings at all, the page breaks are the best
 * guide to where chapters start.
 */
function openingItems(pages: string[][], out: ImportedBook, hasChapters: boolean): ImportedItem[] {
  const items: ImportedItem[] = [];
  const loose: string[][] = [];
  const filled = pages.filter((lines) => countWords(plainLines(lines)) > 0);
  filled.forEach((lines, index) => {
    const plain = plainLines(lines);
    const words = countWords(plain);
    const more = hasChapters || index < filled.length - 1;
    const text = tidyMarkdown(lines.join('\n\n'));

    // Title page: short, and it names the author ("by ..."), a word count, or the title itself.
    if (index === 0 && more && words <= 80) {
      const by = plain.findIndex((l) => /^by\s+\S/i.test(l));
      const title = out.title.toLowerCase();
      const namesBook = plain.some((l) => l.length >= 4 && (title === l.toLowerCase() || title.startsWith(l.toLowerCase() + ':'))) || (out.author !== '' && plain.some((l) => l.toLowerCase() === out.author.toLowerCase()));
      if (by >= 0 || namesBook || plain.some((l) => /\b[\d,.]+\s+words\b/i.test(l))) {
        if (by >= 0 && !out.author) out.author = plain[by].replace(/^by\s+/i, '').trim();
        if (!out.title && by > 0) {
          // The title is usually the line in capitals; failing that, the line above "by".
          const capitals = plain.slice(0, by).filter((l) => /[A-Z]/.test(l) && l === l.toUpperCase() && !/\d{3}/.test(l));
          out.title = fromCapitals(capitals[capitals.length - 1] ?? plain[by - 1]);
        }
        return;
      }
    }

    // A page that names itself in its first line: "Acknowledgements", "Preface", "Contents" ...
    const head = plain[0];
    const named = lines.length > 1 && !lines[0].includes('\n') && head.length <= 40 ? kindFromTitle(head, false) : 'chapter';
    if (/^(contents|table of contents)\b/i.test(head) && head.length <= 40) {
      out.notes.push('The contents page of the file was left out: the app builds its own from the chapters.');
      return;
    }
    // Copyright page: kept for reference, but not printed next to the one the app writes.
    if (more && words <= 300 && /\u00A9|\(c\)\s*\d{4}|copyright\s+(?:\(c\)|\d{4}|by\b)|all rights reserved|\bISBN\b/i.test(plain.join(' '))) {
      items.push({ title: 'Copyright page from the imported file', kind: 'front', text, excluded: true });
      out.notes.push('The copyright page of the file was kept for reference but is not printed, because the app writes its own from the book details. Copy what you need from it, then delete it.');
      return;
    }
    if (named === 'front' || named === 'back') {
      items.push({ title: head, kind: 'front', text: tidyMarkdown(lines.slice(1).join('\n\n')) });
      return;
    }
    if (more && loose.length === 0 && words <= 40 && /^(for|to|in memory of|in loving memory of|dedicated to)\b/i.test(head) && !items.some((i) => i.title === 'Dedication')) {
      items.push({ title: 'Dedication', kind: 'front', text });
      return;
    }
    // Epigraph: a short quotation with a line under it that says where it comes from.
    if (more && loose.length === 0 && words <= 120 && lines.length >= 2 && !items.some((i) => i.title === 'Epigraph')) {
      const last = lines[lines.length - 1];
      const lastPlain = plainLines([last]).join(' ');
      const dashed = /^(?:-{1,3}|~|\u2014|\u2013|\u2015)\s*\S/.test(lastPlain);
      const quoteEnds = /[.!?\u2026'"\u2019\u201D]$/.test(plainLines(lines.slice(0, -1)).join(' '));
      if (dashed || (quoteEnds && countWords([lastPlain]) <= 12 && !/[.!?]$/.test(lastPlain))) {
        const source = last.replace(/^\\?(?:-{1,3}|~|\u2014|\u2013|\u2015)\s*/, '').trim();
        items.push({ title: 'Epigraph', kind: 'front', text: tidyMarkdown([...lines.slice(0, -1), `- ${source}`].join('\n\n')) });
        return;
      }
    }
    loose.push(lines);
  });

  if (hasChapters) {
    loose.forEach((lines, i) => items.push({ title: i === 0 ? 'Opening pages' : `Opening pages ${i + 1}`, kind: 'front', text: tidyMarkdown(lines.join('\n\n')) }));
    return items;
  }
  if (loose.length > 1) {
    // No chapter headings: one chapter for each page break. A short first line is taken as the chapter's title.
    for (const lines of loose) {
      const first = plainLines([lines[0]]);
      const titled = lines.length > 1 && first.length === 1 && first[0].length <= 60 && !/[.!?,;:\u2019\u201D"]$/.test(first[0]);
      items.push({ title: titled ? first[0] : '', kind: 'chapter', text: tidyMarkdown((titled ? lines.slice(1) : lines).join('\n\n')) });
    }
    out.notes.push('No chapter headings were found, so a new chapter was started at every page break. If that is not right, give chapter titles the style "Heading 1" in Word and import again.');
  } else if (loose.length === 1) {
    items.push({ title: '', kind: 'chapter', text: tidyMarkdown(loose[0].join('\n\n')) });
    out.notes.push('No chapter headings were found, so the whole text was imported as one chapter. In Word, give chapter titles the style "Heading 1" and import again, or split the text in the binder.');
  }
  return items;
}

export function importDocx(bytes: Uint8Array, fileName = ''): ImportedBook {
  const out = emptyImport();
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new Error('This file could not be opened as a Word document (.docx). Older .doc files must first be saved as .docx.');
  }
  const part = (name: string): XmlNode | null => (zip[name] ? parseXml(strFromU8(zip[name])) : null);
  const doc = part('word/document.xml');
  if (!doc) throw new Error('This file is not a Word document: it has no word/document.xml inside.');
  const ctx: Ctx = { footnotes: new Map(), comments: new Map(), images: new Map(), links: new Map(), usedNotes: [], headingLevel: new Map(), listKind: new Map(), nextNote: 1 };

  // Styles: which style ids are headings (by name, so localised and custom templates work).
  const styles = part('word/styles.xml');
  if (styles) {
    for (const s of descendants(styles, 'w:style')) {
      const name = val(child(s, 'w:name')).toLowerCase();
      const m = /^heading\s*(\d)/.exec(name);
      const lvl = child(child(s, 'w:pPr'), 'w:outlineLvl');
      if (m) ctx.headingLevel.set(s.attrs['w:styleId'], Number(m[1]));
      else if (name === 'title') ctx.headingLevel.set(s.attrs['w:styleId'], 1);
      else if (lvl) ctx.headingLevel.set(s.attrs['w:styleId'], Number(val(lvl)) + 1);
    }
  }
  for (const id of ['Heading1', 'Heading2', 'Heading3', 'Heading4']) if (!ctx.headingLevel.has(id)) ctx.headingLevel.set(id, Number(id.slice(-1)));
  // Numbering: whether a list is numbered or bulleted.
  const numbering = part('word/numbering.xml');
  if (numbering) {
    const abstractKind = new Map<string, boolean>();
    for (const a of descendants(numbering, 'w:abstractNum')) {
      const fmt = val(child(children(a, 'w:lvl')[0], 'w:numFmt'));
      abstractKind.set(a.attrs['w:abstractNumId'], fmt !== 'bullet' && fmt !== 'none' && fmt !== '');
    }
    for (const n of descendants(numbering, 'w:num')) ctx.listKind.set(n.attrs['w:numId'], abstractKind.get(val(child(n, 'w:abstractNumId'))) ?? false);
  }
  // Relationships: pictures and links.
  const rels = part('word/_rels/document.xml.rels');
  if (rels) {
    for (const r of descendants(rels, 'Relationship')) {
      const type = r.attrs.Type ?? '';
      if (/\/image$/.test(type)) {
        const target = r.attrs.Target.replace(/^\//, '').replace(/^(?!word\/)/, 'word/');
        const data = zip[target];
        if (data) {
          const name = target.split('/').pop()!;
          ctx.images.set(r.attrs.Id, name);
          if (!out.images.some((i) => i.name === name)) out.images.push({ name, data });
        }
      } else if (/\/hyperlink$/.test(type)) ctx.links.set(r.attrs.Id, r.attrs.Target);
    }
  }
  const comments = part('word/comments.xml');
  if (comments) for (const c of descendants(comments, 'w:comment')) ctx.comments.set(c.attrs['w:id'], { author: c.attrs['w:author'] ?? '', text: descendants(c, 'w:t').map(textOf).join('').trim() });
  for (const [file, prefix, tag] of [['word/footnotes.xml', 'f', 'w:footnote'], ['word/endnotes.xml', 'e', 'w:endnote']] as const) {
    const notes = part(file);
    if (!notes) continue;
    for (const n of descendants(notes, tag)) {
      if (n.attrs['w:type']) continue; // separators
      const text = children(n, 'w:p').map((p) => inlineOf(p.children, ctx).trim()).filter(Boolean).join(' ');
      ctx.footnotes.set(`${prefix}${n.attrs['w:id']}`, text);
    }
  }
  const core = part('docProps/core.xml');
  if (core) {
    out.title = descendants(core, 'dc:title').map(textOf).join('').trim();
    out.author = descendants(core, 'dc:creator').map(textOf).join('').trim();
    out.language = descendants(core, 'dc:language').map(textOf).join('').trim();
  }

  // Walk the body, starting a new document at every chapter heading.
  const body = descendants(doc, 'w:body')[0];
  const items: ImportedItem[] = [];
  // The pages before the first chapter heading, kept apart at each page break
  // so that a title page, a dedication and an epigraph can be told apart.
  const opening: string[][] = [];
  let current: { title: string; lines: string[] } = { title: '', lines: [] };
  let seenHeading = false;
  let seenChapter = false;
  let removedEnd = false;
  // The kind of list the last paragraph belongs to, so that neighbouring items share one list.
  let listOpen: Para['list'] = null;
  let orderedIndex = 0;
  // True right after a bare "Chapter One" heading: the next line may be the title of the chapter.
  let titleMayFollow = false;
  const takeNotes = (): string => {
    const notes = ctx.usedNotes.join('\n\n');
    ctx.usedNotes = [];
    return notes;
  };
  const splitOpening = () => {
    if (seenHeading) return;
    if (current.lines.length) opening.push(current.lines);
    current.lines = [];
    listOpen = null;
  };
  const flush = () => {
    if (!seenHeading) {
      const notes = takeNotes();
      if (notes) current.lines.push(notes);
      splitOpening();
      return;
    }
    const ended = stripEnding(current.lines.join('\n\n'));
    removedEnd = removedEnd || ended.removedEnd;
    const notes = takeNotes();
    const kind = kindFromTitle(current.title, seenChapter);
    if (kind === 'chapter') seenChapter = true;
    items.push({ title: current.title, kind: kind === 'part' && ended.text.trim() ? 'chapter' : kind, text: tidyMarkdown(ended.text + (notes ? '\n\n' + notes : '')) });
  };
  const usesHeadings = descendants(body ?? doc, 'w:p').some((p) => (ctx.headingLevel.get(val(child(child(p, 'w:pPr'), 'w:pStyle'))) ?? 0) === 1);
  const addParagraph = (p: Para): void => {
    // The text as typed (escapes undone), and the same without emphasis markers for recognising headings.
    const typed = unescapeMarkdown(p.text).trim();
    if (SCENE_LINE.test(typed)) {
      current.lines.push('***');
      listOpen = null;
      titleMayFollow = false;
      return;
    }
    const plain = unescapeMarkdown(p.text.replace(/(?<!\\)[*_]/g, '')).trim();
    const isChapter = usesHeadings ? p.heading === 1 : p.heading === 1 || (plain.length < 90 && CHAPTER_LINE.test(plain));
    if (isChapter && plain) {
      flush();
      seenHeading = true;
      // A heading in two lines ("Chapter One", then "The River") is read as "Chapter One: The River".
      const title = plain.split(/\\?\n/).map((l) => l.trim()).filter(Boolean).join(': ').replace(/\s+/g, ' ');
      current = { title, lines: [] };
      titleMayFollow = cleanTitle(title) === '';
      listOpen = null;
      return;
    }
    if (!plain && !/!\[/.test(p.text)) {
      listOpen = null;
      return;
    }
    if (titleMayFollow) {
      // "Chapter One" as the heading and the title in the next paragraph, set as a smaller heading or centred in bold or capitals.
      titleMayFollow = false;
      const display = p.heading >= 2 || (p.centered && (/^\*\*[^*]+\*\*$/.test(p.text.trim()) || (/[A-Z]/.test(plain) && plain === plain.toUpperCase())));
      if (display && plain.length < 80 && !plain.includes('\n') && current.lines.length === 0) {
        current.title = `${current.title}: ${plain}`;
        return;
      }
    }
    if (p.heading >= 2) current.lines.push(`${'#'.repeat(Math.min(4, p.heading))} ${plain}`);
    else if (p.list) {
      orderedIndex = p.start ?? (listOpen === 'ol' ? orderedIndex + 1 : 1);
      const item = p.list === 'ol' ? `${orderedIndex}. ${p.text}` : `- ${p.text}`;
      if (listOpen === p.list) current.lines[current.lines.length - 1] += `\n${item}`;
      else current.lines.push(item);
      listOpen = p.list;
      return;
    } else if (p.quote) current.lines.push(p.text.split('\n').map((l) => `> ${l}`).join('\n'));
    else current.lines.push(p.text);
    listOpen = null;
  };
  for (const node of body?.children ?? []) {
    if (node.name === 'w:tbl') {
      current.lines.push(tableMarkdown(node, ctx));
      listOpen = null;
      continue;
    }
    if (node.name !== 'w:p') continue;
    const p = paragraph(node, ctx);
    if (p.breakBefore) splitOpening();
    addParagraph(p);
    if (p.breakAfter) splitOpening();
  }
  flush();
  if (TITLE_JUNK.test(out.title)) out.title = '';
  out.items = [...openingItems(opening, out, seenHeading), ...items];
  if (removedEnd) out.notes.push('The closing line "THE END" was left out. Type it at the end of the last chapter if you want it printed.');
  if (!out.title) out.title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  if (ctx.comments.size) out.notes.push(`${ctx.comments.size} comment${ctx.comments.size === 1 ? '' : 's'} from Word were kept as comments.`);
  return out;
}
