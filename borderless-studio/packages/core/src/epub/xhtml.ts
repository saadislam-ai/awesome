/**
 * IR to XHTML for EPUB 3. The markup is deliberately plain and semantic:
 * real headings, paragraphs, lists, figures and notes, with epub:type and
 * ARIA roles where they help reading systems and assistive technology.
 *
 * Every top level block is written on its own line, and the line number is
 * recorded, so that an EPUBCheck message ("line 37 of ch003.xhtml") can be
 * traced back to the exact place in the manuscript.
 */
import type { Block, Inline } from '../markdown/ir';
import { inlineText } from '../markdown/ir';
import { escapeXml, escapeXmlText } from '../util/text';

export interface XhtmlContext {
  /** Prefix that makes ids unique inside one file, for example "s12". */
  idPrefix: string;
  /** Maps manuscript image paths to paths relative to the XHTML file. */
  imageHref: (src: string) => string | null;
  /** Notes collected while rendering; printed at the end of the section. */
  notes: { n: number; html: string }[];
  /** Index markers found, for the ebook index. */
  indexAnchors: { term: string; sub?: string; id: string }[];
  /** Headings found inside the section (for the nested contents list). */
  headings: { level: number; id: string; text: string }[];
  /** Images with no description, for the accessibility report. */
  missingAlt: string[];
  hasImages: boolean;
  /** Paragraph style: indented paragraphs or blank line between paragraphs. */
  spaced: boolean;
}

export function renderInlines(inlines: Inline[], ctx: XhtmlContext): string {
  let out = '';
  for (const n of inlines) {
    switch (n.t) {
      case 'text':
        out += escapeXmlText(n.v);
        break;
      case 'em':
        out += `<em>${renderInlines(n.c, ctx)}</em>`;
        break;
      case 'strong':
        out += `<strong>${renderInlines(n.c, ctx)}</strong>`;
        break;
      case 'sc':
        out += `<span class="sc">${renderInlines(n.c, ctx)}</span>`;
        break;
      case 'sup':
        out += `<sup>${renderInlines(n.c, ctx)}</sup>`;
        break;
      case 'sub':
        out += `<sub>${renderInlines(n.c, ctx)}</sub>`;
        break;
      case 'mark':
        out += renderInlines(n.c, ctx);
        break;
      case 'code':
        out += `<code>${escapeXmlText(n.v)}</code>`;
        break;
      case 'br':
        out += '<br/>';
        break;
      case 'link': {
        const href = n.href.trim();
        const safe = /^(https?:|mailto:|#)/i.test(href);
        out += safe ? `<a href="${escapeXml(href)}">${renderInlines(n.c, ctx)}</a>` : renderInlines(n.c, ctx);
        break;
      }
      case 'fn': {
        const num = ctx.notes.length + 1;
        const id = `${ctx.idPrefix}-fn${num}`;
        const ref = `${ctx.idPrefix}-fnref${num}`;
        // Reserve the slot first so nested notes keep their order.
        const slot = { n: num, html: '' };
        ctx.notes.push(slot);
        const body = renderNoteBody(n.c, ctx, `<a href="#${ref}" role="doc-backlink" class="note-number">${num}.</a> `);
        slot.html = `<aside id="${id}" epub:type="footnote" role="doc-footnote" class="note">${body}</aside>`;
        out += `<a id="${ref}" href="#${id}" epub:type="noteref" role="doc-noteref" class="noteref">${num}</a>`;
        break;
      }
      case 'index': {
        const id = `${ctx.idPrefix}-ix${ctx.indexAnchors.length + 1}`;
        ctx.indexAnchors.push({ term: n.term, sub: n.sub, id });
        out += `<span id="${id}"></span>`;
        break;
      }
      case 'img': {
        const href = ctx.imageHref(n.src);
        if (href) {
          ctx.hasImages = true;
          if (!n.alt.trim()) ctx.missingAlt.push(n.src);
          out += `<img class="inline" src="${escapeXml(href)}" alt="${escapeXml(n.alt)}"/>`;
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** A note is one or more paragraphs; the backlink number goes inside the first. */
function renderNoteBody(blocks: Block[], ctx: XhtmlContext, lead: string): string {
  const parts: string[] = [];
  let first = true;
  for (const b of blocks) {
    if (b.t === 'p') {
      parts.push(`<p>${first ? lead : ''}${renderInlines(b.c, ctx)}</p>`);
      first = false;
    } else {
      if (first) {
        parts.push(`<p>${lead}</p>`);
        first = false;
      }
      parts.push(renderBlock(b, ctx, { prev: 'other', depth: 1 }));
    }
  }
  if (first) parts.push(`<p>${lead}</p>`);
  return parts.join('');
}

interface BlockState {
  /** What came immediately before, to decide paragraph indentation. */
  prev: 'p' | 'other' | 'start';
  depth: number;
}

export interface OpeningStyle {
  dropCap: boolean;
  leadInWords: number;
}

const OPENING_QUOTES = /^[“‘"'«(\[]+/;

/**
 * First paragraph of a chapter with an optional drop capital and small
 * capital lead-in. The markup stays readable when CSS is ignored: the letter
 * is still the first letter of the word.
 */
export function renderOpeningParagraph(inlines: Inline[], ctx: XhtmlContext, style: OpeningStyle): string {
  const first = inlines[0];
  if (!first || first.t !== 'text' || (!style.dropCap && style.leadInWords <= 0)) {
    return `<p class="first">${renderInlines(inlines, ctx)}</p>`;
  }
  let text = first.v;
  let capHtml = '';
  if (style.dropCap) {
    const quote = OPENING_QUOTES.exec(text)?.[0] ?? '';
    const afterQuote = text.slice(quote.length);
    const ch = [...afterQuote][0];
    if (ch && /\p{Lu}|\p{Ll}/u.test(ch)) {
      capHtml = `<span class="dropcap">${escapeXmlText(quote + ch)}</span>`;
      text = afterQuote.slice(ch.length);
    }
  }
  let leadHtml = '';
  if (style.leadInWords > 0) {
    // Take whole words from the first text run only; markup later in the paragraph is left alone.
    const parts = text.split(' ');
    const take = Math.min(style.leadInWords, parts.length);
    const lead = parts.slice(0, take).join(' ');
    const rest = parts.slice(take).join(' ');
    if (lead) leadHtml = `<span class="leadin">${escapeXmlText(lead)}</span>`;
    text = (rest ? ' ' : '') + rest;
    if (take === parts.length && inlines.length > 1 && !lead.endsWith(' ')) text = '';
  }
  const restInlines: Inline[] = [{ t: 'text', v: text }, ...inlines.slice(1)];
  return `<p class="first${capHtml ? ' has-dropcap' : ''}">${capHtml}${leadHtml}${renderInlines(restInlines, ctx)}</p>`;
}

function renderBlock(b: Block, ctx: XhtmlContext, st: BlockState): string {
  switch (b.t) {
    case 'p': {
      const cls = st.prev === 'p' || ctx.spaced ? '' : ' class="first"';
      return `<p${cls}>${renderInlines(b.c, ctx)}</p>`;
    }
    case 'h': {
      const level = Math.min(6, b.level + 1 + Math.min(st.depth, 1) * 0);
      const id = `${ctx.idPrefix}-${b.id}`;
      ctx.headings.push({ level: b.level, id, text: inlineText(b.c) });
      return `<h${level} id="${escapeXml(id)}">${renderInlines(b.c, ctx)}</h${level}>`;
    }
    case 'scenebreak':
      // An invisible rule for assistive technology plus visible ornament text.
      return '<hr class="scene"/><p class="scenebreak" aria-hidden="true">* * *</p>';
    case 'quote':
      return `<blockquote>${renderBlocksInner(b.c, ctx, st.depth + 1)}</blockquote>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const items = b.items.map((it) => `<li>${renderBlocksInner(it, ctx, st.depth + 1)}</li>`).join('');
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case 'table': {
      const cell = (tag: string, c: Inline[], i: number) => {
        const a = b.align[i];
        return `<${tag}${a ? ` class="a-${a}"` : ''}>${renderInlines(c, ctx)}</${tag}>`;
      };
      const head = b.head.length ? `<thead><tr>${b.head.map((c, i) => cell('th', c, i)).join('')}</tr></thead>` : '';
      const rows = b.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('');
      const cap = b.caption ? `<caption>${renderInlines(b.caption, ctx)}</caption>` : '';
      return `<table>${cap}${head}<tbody>${rows}</tbody></table>`;
    }
    case 'figure': {
      const href = ctx.imageHref(b.src);
      if (!href) return '';
      ctx.hasImages = true;
      if (!b.alt.trim()) ctx.missingAlt.push(b.src);
      const width = b.width && b.width < 1 ? ` style="width: ${Math.round(b.width * 100)}%"` : '';
      const cap = b.caption ? `<figcaption>${renderInlines(b.caption, ctx)}</figcaption>` : '';
      return `<figure${b.bleed === 'page' ? ' class="full"' : ''}><img src="${escapeXml(href)}" alt="${escapeXml(b.alt)}"${width}/>${cap}</figure>`;
    }
    case 'callout': {
      const title = b.title
        ? `<p class="callout-title">${renderInlines(b.title, ctx)}</p>`
        : b.kind !== 'callout'
          ? `<p class="callout-title">${escapeXmlText(b.kind[0].toUpperCase() + b.kind.slice(1))}</p>`
          : '';
      return `<aside class="callout" role="note">${title}${renderBlocksInner(b.c, ctx, st.depth + 1)}</aside>`;
    }
    case 'verse': {
      const stanzas = b.stanzas
        .map((s) => `<div class="stanza">${s.map((l) => `<p class="line">${renderInlines(l, ctx)}</p>`).join('')}</div>`)
        .join('');
      return `<div class="verse">${stanzas}</div>`;
    }
    case 'align':
      return `<div class="${b.align === 'right' ? 'right' : 'center'}">${renderBlocksInner(b.c, ctx, st.depth + 1)}</div>`;
    case 'code':
      return `<pre><code>${escapeXmlText(b.v)}</code></pre>`;
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
    default:
      return '';
  }
}

function renderBlocksInner(blocks: Block[], ctx: XhtmlContext, depth: number): string {
  let prev: BlockState['prev'] = 'start';
  let out = '';
  for (const b of blocks) {
    out += renderBlock(b, ctx, { prev, depth });
    prev = b.t === 'p' ? 'p' : 'other';
  }
  return out;
}

export interface RenderedBlocks {
  /** One entry per top level block: its XHTML (a single line) and source line in the manuscript. */
  lines: { html: string; blockIndex: number; srcLine?: number }[];
}

/** Render top level blocks, one per output line. */
export function renderBlocks(blocks: Block[], ctx: XhtmlContext, opening?: OpeningStyle): RenderedBlocks {
  const lines: RenderedBlocks['lines'] = [];
  let prev: BlockState['prev'] = 'start';
  blocks.forEach((b, i) => {
    let html: string;
    if (i === 0 && b.t === 'p' && opening) html = renderOpeningParagraph(b.c, ctx, opening);
    else html = renderBlock(b, ctx, { prev, depth: 0 });
    if (html) lines.push({ html: html.replace(/\n/g, ' '), blockIndex: i, srcLine: b.line });
    prev = b.t === 'p' ? 'p' : 'other';
  });
  return { lines };
}
