import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';
import type { Align, DraftBlock, HeadingLevel, Run } from '../model/blocks';

/** Formatting implied by a CSS rule or a style attribute. */
export interface StyleHints {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  align?: Align | 'left';
  pb?: boolean;
}

export type ClassStyles = Map<string, StyleHints>;

export interface HtmlOptions {
  classStyles?: ClassStyles;
}

export interface HtmlResult {
  blocks: DraftBlock[];
  images: number;
}

const SKIP = new Set(['script', 'style', 'head', 'title', 'nav', 'svg', 'math', 'iframe', 'object', 'noscript', 'template', 'audio', 'video', 'canvas', 'button', 'select', 'form']);
const CONTAINERS = new Set(['html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure', 'figcaption', 'center', 'dl', 'dt', 'dd', 'address', 'table', 'tbody', 'thead', 'tfoot', 'details', 'summary']);
const MARK_TAGS: Record<string, keyof Marks> = {
  b: 'b', strong: 'b', i: 'i', em: 'i', cite: 'i', dfn: 'i', var: 'i', u: 'u', ins: 'u', s: 's', strike: 's', del: 's',
};

interface Marks {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
}

interface Ctx {
  marks: Marks;
  quote: boolean;
  list: { ordered: boolean } | null;
  align?: Align;
  pre: boolean;
}

export function parseDeclarations(css: string): StyleHints {
  const hints: StyleHints = {};
  for (const decl of css.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const value = decl.slice(idx + 1).trim().toLowerCase();
    if (prop === 'font-style') hints.i = /italic|oblique/.test(value);
    else if (prop === 'font-weight') hints.b = /^(bold|bolder|[6-9]00)/.test(value);
    else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      if (value.includes('underline')) hints.u = true;
      if (value.includes('line-through')) hints.s = true;
      if (value === 'none') {
        hints.u = false;
        hints.s = false;
      }
    } else if (prop === 'text-align') {
      if (value.startsWith('center')) hints.align = 'center';
      else if (value.startsWith('right') || value === 'end') hints.align = 'right';
      else hints.align = 'left';
    } else if (prop === 'page-break-before' || prop === 'break-before') {
      if (/always|page|left|right/.test(value)) hints.pb = true;
    }
  }
  return hints;
}

/**
 * Reads simple class rules (".x" and "p.x") from a stylesheet. E-books made
 * with conversion tools often express italics and centring only through
 * classes, so ignoring CSS would silently lose that formatting.
 */
export function parseStylesheet(css: string, into: ClassStyles = new Map()): ClassStyles {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(clean))) {
    const hints = parseDeclarations(m[2]);
    if (!Object.keys(hints).length) continue;
    for (const selector of m[1].split(',')) {
      const s = /^\s*([a-z0-9]*)\.([\w-]+)\s*$/i.exec(selector);
      if (!s) continue;
      const key = `${s[1].toLowerCase()}.${s[2]}`;
      into.set(key, { ...into.get(key), ...hints });
    }
  }
  return into;
}

function elementHints(el: Element, classStyles?: ClassStyles): StyleHints {
  let hints: StyleHints = {};
  const cls = el.attribs.class;
  if (cls && classStyles?.size) {
    for (const name of cls.split(/\s+/)) {
      if (!name) continue;
      const general = classStyles.get(`.${name}`);
      if (general) hints = { ...hints, ...general };
      const specific = classStyles.get(`${el.name}.${name}`);
      if (specific) hints = { ...hints, ...specific };
    }
  }
  if (el.attribs.style) hints = { ...hints, ...parseDeclarations(el.attribs.style) };
  const align = el.attribs.align?.toLowerCase();
  if (align === 'center') hints.align = 'center';
  else if (align === 'right') hints.align = 'right';
  if (el.name === 'center') hints.align = 'center';
  return hints;
}

function applyHints(ctx: Ctx, hints: StyleHints): Ctx {
  const marks = { ...ctx.marks };
  if (hints.b !== undefined) marks.b = hints.b;
  if (hints.i !== undefined) marks.i = hints.i;
  if (hints.u !== undefined) marks.u = hints.u;
  if (hints.s !== undefined) marks.s = hints.s;
  let align = ctx.align;
  if (hints.align === 'left') align = undefined;
  else if (hints.align) align = hints.align;
  return { ...ctx, marks, align };
}

/** Converts HTML or XHTML into draft blocks. Works without a browser DOM. */
export function htmlToBlocks(html: string, options: HtmlOptions = {}): HtmlResult {
  const doc = parseDocument(html, { decodeEntities: true });
  const blocks: DraftBlock[] = [];
  let images = 0;
  let buffer: Run[] = [];
  let bufferCtx: Ctx | null = null;
  let pendingPb = false;

  const push = (block: DraftBlock) => {
    if (pendingPb && block.type !== 'break') {
      block.pb = true;
      pendingPb = false;
    }
    blocks.push(block);
  };

  const lastChar = (): string => {
    const last = buffer[buffer.length - 1];
    return last ? last.text[last.text.length - 1] : '';
  };

  const addText = (raw: string, ctx: Ctx) => {
    let text = ctx.pre ? raw : raw.replace(/[ \t\r\n\f]+/g, ' ');
    if (!ctx.pre && text.startsWith(' ')) {
      const prev = lastChar();
      if (prev === '' || prev === ' ' || prev === '\n') text = text.slice(1);
    }
    if (!text) return;
    if (!bufferCtx) bufferCtx = ctx;
    const run: Run = { text };
    if (ctx.marks.b) run.b = true;
    if (ctx.marks.i) run.i = true;
    if (ctx.marks.u) run.u = true;
    if (ctx.marks.s) run.s = true;
    buffer.push(run);
  };

  const flush = (emitEmpty = false, ctxForEmpty?: Ctx) => {
    const runs = buffer;
    const ctx = bufferCtx ?? ctxForEmpty;
    buffer = [];
    bufferCtx = null;
    const hasText = runs.some((r) => r.text.trim() !== '');
    if (!hasText && !emitEmpty) return;
    if (!ctx) return;
    if (!hasText) {
      push({ type: 'paragraph', runs: [] });
      return;
    }
    for (const r of runs) r.text = r.text.replace(/ *\n */g, '\n');
    if (ctx.list) push({ type: 'list', ordered: ctx.list.ordered, runs });
    else if (ctx.quote) push({ type: 'quote', runs });
    else if (ctx.align) push({ type: 'paragraph', runs, align: ctx.align });
    else push({ type: 'paragraph', runs });
  };

  const inline = (nodes: ChildNode[], ctx: Ctx) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        addText(node.data, ctx);
      } else if (node.type === 'tag') {
        if (SKIP.has(node.name)) continue;
        if (node.name === 'img' || node.name === 'image') {
          images++;
          continue;
        }
        if (node.name === 'br') {
          if (buffer.length) addText('\n', { ...ctx, pre: true });
          continue;
        }
        let next = applyHints(ctx, elementHints(node, options.classStyles));
        const mark = MARK_TAGS[node.name];
        if (mark) next = { ...next, marks: { ...next.marks, [mark]: true } };
        inline(node.children, next);
      }
    }
  };

  const walk = (nodes: ChildNode[], ctx: Ctx) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        addText(node.data, ctx);
        continue;
      }
      if (node.type !== 'tag') {
        if ('children' in node && node.type === 'root') walk((node as unknown as Element).children, ctx);
        continue;
      }
      const name = node.name;
      if (SKIP.has(name)) continue;
      if (name === 'img' || name === 'image') {
        images++;
        continue;
      }
      const hints = elementHints(node, options.classStyles);
      const heading = /^h([1-6])$/.exec(name);
      if (heading) {
        flush();
        if (hints.pb) pendingPb = true;
        const inner = applyHints({ ...ctx, quote: false, list: null }, hints);
        inline(node.children, inner);
        const runs = buffer;
        buffer = [];
        bufferCtx = null;
        if (runs.some((r) => r.text.trim())) {
          const level = Math.min(Number(heading[1]), 4) as HeadingLevel;
          push(inner.align ? { type: 'heading', level, runs, align: inner.align } : { type: 'heading', level, runs });
        }
        continue;
      }
      if (name === 'hr') {
        flush();
        blocks.push({ type: 'break' });
        continue;
      }
      if (name === 'br') {
        if (buffer.length) addText('\n', { ...ctx, pre: true });
        continue;
      }
      if (name === 'p') {
        flush();
        if (hints.pb) pendingPb = true;
        const inner = applyHints(ctx, hints);
        inline(node.children, inner);
        flush(true, inner);
        continue;
      }
      if (name === 'blockquote') {
        flush();
        walk(node.children, applyHints({ ...ctx, quote: true }, hints));
        flush();
        continue;
      }
      if (name === 'ul' || name === 'ol') {
        flush();
        walk(node.children, { ...ctx, list: { ordered: name === 'ol' } });
        flush();
        continue;
      }
      if (name === 'li') {
        flush();
        walk(node.children, applyHints(ctx.list ? ctx : { ...ctx, list: { ordered: false } }, hints));
        flush();
        continue;
      }
      if (name === 'pre') {
        flush();
        inline(node.children, { ...ctx, pre: true });
        const text = buffer.map((r) => r.text).join('');
        buffer = [];
        bufferCtx = null;
        for (const line of text.split(/\r?\n/)) push({ type: 'paragraph', runs: line.trim() ? [{ text: line }] : [] });
        continue;
      }
      if (name === 'tr') {
        flush();
        const cells = node.children.filter((c): c is Element => c.type === 'tag' && (c.name === 'td' || c.name === 'th'));
        cells.forEach((cell, index) => {
          if (index > 0 && buffer.length) addText(' | ', { ...ctx, pre: true });
          inline(cell.children, ctx);
        });
        flush();
        continue;
      }
      if (CONTAINERS.has(name)) {
        flush();
        if (hints.pb) pendingPb = true;
        walk(node.children, applyHints(ctx, hints));
        flush();
        continue;
      }
      // Anything else is treated as inline.
      let next = applyHints(ctx, hints);
      const mark = MARK_TAGS[name];
      if (mark) next = { ...next, marks: { ...next.marks, [mark]: true } };
      walk(node.children, next);
    }
  };

  const root: Ctx = { marks: { b: false, i: false, u: false, s: false }, quote: false, list: null, pre: false };
  walk(doc.children, root);
  flush();
  return { blocks, images };
}
