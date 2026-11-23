/**
 * Markdown to IR. Parsing is done by micromark/mdast (a well tested CommonMark
 * implementation) with three extensions: footnotes, tables and "directives"
 * for the few things plain Markdown cannot say:
 *
 *   :::callout[Title]        a call-out box (also: note, tip, warning)
 *   :::verse                 poetry, line breaks kept
 *   :::center  /  :::right   alignment
 *   ::image[Caption]{src="images/map.png" width="80%" bleed="page" alt="..."}
 *   ::pagebreak
 *   :index[Term]             invisible index marker (sub entries: Term!Sub)
 *   :sc[small capitals]
 *   :sup[2] and :sub[2]
 *
 * Unknown directives are kept as literal text, so a stray colon in prose can
 * never make words disappear.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { resolveCritic, toSourceOffset, type CriticView } from './critic';
import type { Block, Inline, ParsedDoc, ParseWarning } from './ir';
import { slugify } from '../util/paths';

/* mdast node shapes we use (kept loose: the tree comes from a library). */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { line: number; offset?: number }; end: { line: number; offset?: number } };
  [k: string]: unknown;
}

const CALLOUT_KINDS = new Set(['callout', 'note', 'tip', 'warning', 'box', 'key', 'exercise', 'summary']);

export interface ParseOptions {
  /** How pending tracked changes are read. Default: as if none were accepted. */
  criticView?: CriticView;
}

export function parseMarkdown(source: string, opts: ParseOptions = {}): ParsedDoc {
  const resolved = resolveCritic(source.replace(/\r\n?/g, '\n'), opts.criticView ?? 'original');
  const warnings: ParseWarning[] = [];

  // Line lookup in the ORIGINAL source, so messages point at what the author sees.
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const lineOfSourceOffset = (off: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const lineOf = (n: MdNode): number | undefined => {
    const off = n.position?.start.offset;
    return off === undefined ? n.position?.start.line : lineOfSourceOffset(toSourceOffset(resolved, off));
  };

  const tree = fromMarkdown(resolved.text, {
    extensions: [gfmFootnote(), gfmTable(), directive()],
    mdastExtensions: [gfmFootnoteFromMarkdown(), gfmTableFromMarkdown(), directiveFromMarkdown()],
  }) as unknown as MdNode;

  // Collect footnote definitions first; references pull their text in.
  const footnotes = new Map<string, MdNode>();
  const collectDefs = (n: MdNode) => {
    if (n.type === 'footnoteDefinition') footnotes.set(String(n.identifier), n);
    n.children?.forEach(collectDefs);
  };
  collectDefs(tree);
  const usedFootnotes = new Set<string>();
  const headingIds = new Map<string, number>();

  const literalDirective = (n: MdNode): string => {
    const colons = n.type === 'textDirective' ? ':' : n.type === 'leafDirective' ? '::' : ':::';
    const label = n.children?.length ? `[${mdText(n.children)}]` : '';
    return `${colons}${String(n.name ?? '')}${label}`;
  };

  function mdText(nodes: MdNode[]): string {
    let out = '';
    for (const n of nodes) {
      if (typeof n.value === 'string') out += n.value;
      else if (n.children) out += mdText(n.children);
    }
    return out;
  }

  function inlines(nodes: MdNode[]): Inline[] {
    const out: Inline[] = [];
    const pushText = (v: string) => {
      if (!v) return;
      const last = out[out.length - 1];
      if (last && last.t === 'text') last.v += v;
      else out.push({ t: 'text', v });
    };
    for (const n of nodes) {
      switch (n.type) {
        case 'text':
          // A single newline inside a paragraph is just a space.
          pushText(String(n.value ?? '').replace(/\n/g, ' '));
          break;
        case 'emphasis':
          out.push({ t: 'em', c: inlines(n.children ?? []) });
          break;
        case 'strong':
          out.push({ t: 'strong', c: inlines(n.children ?? []) });
          break;
        case 'inlineCode':
          out.push({ t: 'code', v: String(n.value ?? '') });
          break;
        case 'break':
          out.push({ t: 'br' });
          break;
        case 'link':
          out.push({ t: 'link', href: String(n.url ?? ''), c: inlines(n.children ?? []) });
          break;
        case 'image':
          out.push({ t: 'img', src: String(n.url ?? ''), alt: String(n.alt ?? '') });
          break;
        case 'footnoteReference': {
          const id = String(n.identifier);
          const def = footnotes.get(id);
          if (!def) {
            warnings.push({ message: `Footnote [^${id}] has no matching note text.`, line: lineOf(n) });
            pushText(`[^${id}]`);
          } else {
            usedFootnotes.add(id);
            out.push({ t: 'fn', id, c: blocks(def.children ?? []) });
          }
          break;
        }
        case 'textDirective': {
          const name = String(n.name ?? '');
          const kids = n.children ?? [];
          if (name === 'index' || name === 'idx') {
            const raw = mdText(kids).trim();
            if (raw) {
              const [term, sub] = raw.split('!').map((s) => s.trim());
              out.push(sub ? { t: 'index', term, sub } : { t: 'index', term });
            }
          } else if (name === 'sc') out.push({ t: 'sc', c: inlines(kids) });
          else if (name === 'sup') out.push({ t: 'sup', c: inlines(kids) });
          else if (name === 'sub') out.push({ t: 'sub', c: inlines(kids) });
          else pushText(literalDirective(n));
          break;
        }
        case 'html':
          warnings.push({ message: 'Raw HTML is not supported in manuscripts and was left out.', line: lineOf(n) });
          break;
        case 'delete':
          out.push(...inlines(n.children ?? []));
          break;
        default:
          if (n.children) out.push(...inlines(n.children));
          else if (typeof n.value === 'string') pushText(n.value);
      }
    }
    return out;
  }

  /** A paragraph that holds nothing but one image becomes a figure. */
  function loneImage(n: MdNode): MdNode | null {
    const kids = (n.children ?? []).filter((k) => !(k.type === 'text' && !String(k.value).trim()));
    return kids.length === 1 && kids[0].type === 'image' ? kids[0] : null;
  }

  function parseWidth(v: unknown): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v).trim();
    const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
    const num = pct ? Number(pct[1]) / 100 : Number(s);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return Math.min(1, num > 1 ? num / 100 : num);
  }

  function verse(nodes: MdNode[]): Inline[][][] {
    // Each paragraph is a stanza; each source line is a line of verse.
    const stanzas: Inline[][][] = [];
    for (const n of nodes) {
      if (n.type !== 'paragraph') continue;
      const lines: Inline[][] = [[]];
      const flat = inlinesKeepNewlines(n.children ?? []);
      for (const item of flat) {
        if (item === '\n') lines.push([]);
        else lines[lines.length - 1].push(item);
      }
      stanzas.push(lines.filter((l) => l.length > 0));
    }
    return stanzas;
  }

  /** Like inlines(), but newlines and hard breaks come back as "\n" markers. */
  function inlinesKeepNewlines(nodes: MdNode[]): (Inline | '\n')[] {
    const out: (Inline | '\n')[] = [];
    for (const n of nodes) {
      if (n.type === 'text') {
        const parts = String(n.value ?? '').split('\n');
        parts.forEach((p, i) => {
          if (i > 0) out.push('\n');
          if (p) out.push({ t: 'text', v: p });
        });
      } else if (n.type === 'break') {
        out.push('\n');
      } else {
        out.push(...inlines([n]));
      }
    }
    return out;
  }

  function blocks(nodes: MdNode[]): Block[] {
    const out: Block[] = [];
    for (const n of nodes) {
      const line = lineOf(n);
      switch (n.type) {
        case 'paragraph': {
          const img = loneImage(n);
          if (img) {
            const title = String(img.title ?? '');
            out.push({
              t: 'figure',
              src: String(img.url ?? ''),
              alt: String(img.alt ?? ''),
              caption: title ? [{ t: 'text', v: title }] : undefined,
              line,
            });
          } else {
            const c = inlines(n.children ?? []);
            if (c.length) out.push({ t: 'p', c, line });
          }
          break;
        }
        case 'heading': {
          const c = inlines(n.children ?? []);
          const level = Math.min(3, Math.max(1, Number(n.depth ?? 1))) as 1 | 2 | 3;
          const base = slugify(mdText(n.children ?? []), 40) || 'section';
          const seen = headingIds.get(base) ?? 0;
          headingIds.set(base, seen + 1);
          out.push({ t: 'h', level, c, id: seen ? `${base}-${seen + 1}` : base, line });
          break;
        }
        case 'thematicBreak':
          out.push({ t: 'scenebreak', line });
          break;
        case 'blockquote':
          out.push({ t: 'quote', c: blocks(n.children ?? []), line });
          break;
        case 'list':
          out.push({
            t: 'list',
            ordered: Boolean(n.ordered),
            start: typeof n.start === 'number' ? n.start : 1,
            items: (n.children ?? []).map((li) => blocks(li.children ?? [])),
            line,
          });
          break;
        case 'table': {
          const rows = (n.children ?? []).map((row) => (row.children ?? []).map((cell) => inlines(cell.children ?? [])));
          out.push({
            t: 'table',
            align: ((n.align as (string | null)[]) ?? []).map((a) => (a === 'left' || a === 'center' || a === 'right' ? a : null)),
            head: rows[0] ?? [],
            rows: rows.slice(1),
            line,
          });
          break;
        }
        case 'code':
          out.push({ t: 'code', v: String(n.value ?? ''), line });
          break;
        case 'footnoteDefinition':
          break; // pulled in at the reference
        case 'html':
          warnings.push({ message: 'Raw HTML is not supported in manuscripts and was left out.', line });
          break;
        case 'leafDirective': {
          const name = String(n.name ?? '');
          const attrs = (n.attributes ?? {}) as Record<string, string | null | undefined>;
          if (name === 'pagebreak') {
            out.push({ t: 'pagebreak', line });
          } else if (name === 'image' || name === 'figure') {
            const src = String(attrs.src ?? '');
            if (!src) {
              warnings.push({ message: 'An ::image directive needs a src, for example {src="images/map.png"}.', line });
              break;
            }
            const cap = inlines(n.children ?? []);
            out.push({
              t: 'figure',
              src,
              alt: String(attrs.alt ?? mdText(n.children ?? [])),
              caption: cap.length ? cap : undefined,
              width: parseWidth(attrs.width),
              bleed: attrs.bleed === 'page' || attrs.bleed === 'full' ? 'page' : undefined,
              line,
            });
          } else {
            out.push({ t: 'p', c: [{ t: 'text', v: literalDirective(n) }], line });
          }
          break;
        }
        case 'containerDirective': {
          const name = String(n.name ?? '');
          const kids = n.children ?? [];
          const labelNode = kids.find((k) => (k.data as { directiveLabel?: boolean } | undefined)?.directiveLabel);
          const body = kids.filter((k) => k !== labelNode);
          const title = labelNode ? inlines(labelNode.children ?? []) : undefined;
          if (CALLOUT_KINDS.has(name)) {
            out.push({ t: 'callout', kind: name === 'box' ? 'callout' : name, title, c: blocks(body), line });
          } else if (name === 'verse' || name === 'poem') {
            out.push({ t: 'verse', stanzas: verse(body), line });
          } else if (name === 'center' || name === 'centre') {
            out.push({ t: 'align', align: 'center', c: blocks(body), line });
          } else if (name === 'right') {
            out.push({ t: 'align', align: 'right', c: blocks(body), line });
          } else {
            warnings.push({ message: `Unknown block ":::${name}" was treated as ordinary text.`, line });
            out.push(...blocks(body));
          }
          break;
        }
        default:
          if (n.children) out.push(...blocks(n.children));
      }
    }
    return out;
  }

  const result = blocks(tree.children ?? []);
  for (const [id, def] of footnotes) {
    if (!usedFootnotes.has(id)) warnings.push({ message: `Note text [^${id}] is never referenced.`, line: lineOf(def) });
  }
  return { blocks: result, warnings };
}
