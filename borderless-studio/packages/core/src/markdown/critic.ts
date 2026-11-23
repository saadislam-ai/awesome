/**
 * CriticMarkup: tracked changes and comments stored as plain text inside the
 * Markdown files, so they survive without this app and diff well in git.
 *
 *   {++inserted text++}          an insertion that is still a suggestion
 *   {--deleted text--}           a deletion that is still a suggestion
 *   {~~old text~>new text~~}     a replacement
 *   {>>a comment<<}              a comment (never exported)
 *   {==highlighted text==}       a highlight (used for quote cards)
 *
 * A comment that directly follows a change and starts with "@" carries who
 * suggested it, for example {++text++}{>>@ai: tightened the sentence<<}.
 */

export type CriticKind = 'insert' | 'delete' | 'substitute' | 'comment' | 'highlight';

export interface CriticSpan {
  kind: CriticKind;
  /** Offsets of the whole token in the source, including braces. */
  start: number;
  end: number;
  /** Inner text: inserted, deleted or highlighted text, or the comment body. For a substitution, the old text. */
  text: string;
  /** Only for substitutions: the replacement text. */
  newText?: string;
  /** End offset including an attached "@author" comment, if there is one. */
  endWithMeta: number;
  /** Who made the suggestion ("ai", "editor", a name), from an attached or own @tag. */
  author?: string;
  /** Free text after the author tag. */
  note?: string;
}

const OPENERS: Record<string, { kind: CriticKind; close: string }> = {
  '{++': { kind: 'insert', close: '++}' },
  '{--': { kind: 'delete', close: '--}' },
  '{~~': { kind: 'substitute', close: '~~}' },
  '{>>': { kind: 'comment', close: '<<}' },
  '{==': { kind: 'highlight', close: '==}' },
};

function parseMeta(body: string): { author?: string; note?: string } {
  const m = /^@([^\s:|]+)\s*[:|]?\s*([\s\S]*)$/.exec(body.trim());
  if (!m) return {};
  return { author: m[1], note: m[2] || undefined };
}

/** Find every CriticMarkup token in a piece of Markdown, in document order. */
export function parseCritic(src: string): CriticSpan[] {
  const spans: CriticSpan[] = [];
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('{', i);
    if (at < 0) break;
    const open = src.slice(at, at + 3);
    const def = OPENERS[open];
    if (!def) {
      i = at + 1;
      continue;
    }
    const closeAt = src.indexOf(def.close, at + 3);
    if (closeAt < 0) {
      i = at + 3;
      continue;
    }
    const inner = src.slice(at + 3, closeAt);
    const end = closeAt + 3;
    const span: CriticSpan = { kind: def.kind, start: at, end, text: inner, endWithMeta: end };
    if (def.kind === 'substitute') {
      const sep = inner.indexOf('~>');
      if (sep < 0) {
        // Not a valid substitution; treat the braces as ordinary text.
        i = at + 3;
        continue;
      }
      span.text = inner.slice(0, sep);
      span.newText = inner.slice(sep + 2);
    }
    if (def.kind === 'comment') {
      Object.assign(span, parseMeta(inner));
    } else if (src.startsWith('{>>', end)) {
      // A comment glued to a change annotates that change.
      const metaClose = src.indexOf('<<}', end + 3);
      if (metaClose >= 0) {
        const body = src.slice(end + 3, metaClose);
        const meta = parseMeta(body);
        if (meta.author || def.kind !== 'highlight') {
          span.author = meta.author;
          span.note = meta.author ? meta.note : body.trim() || undefined;
          span.endWithMeta = metaClose + 3;
        }
      }
    }
    spans.push(span);
    i = span.endWithMeta > span.end && def.kind !== 'highlight' ? span.endWithMeta : end;
  }
  return spans;
}

/** How pending suggestions are treated when text is read for export or analysis. */
export type CriticView =
  /** As if every suggestion were rejected: insertions dropped, deletions kept. */
  | 'original'
  /** As if every suggestion were accepted. */
  | 'accepted';

export interface ResolvedText {
  text: string;
  /**
   * Segments that map offsets in `text` back to offsets in the source.
   * Each entry says: resolved offset `out` corresponds to source offset `src`.
   */
  map: { out: number; src: number }[];
}

/** Map an offset in resolved text back to the matching offset in the source. */
export function toSourceOffset(resolved: ResolvedText, outOffset: number): number {
  const { map } = resolved;
  let lo = 0;
  let hi = map.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map[mid].out <= outOffset) lo = mid;
    else hi = mid - 1;
  }
  const seg = map[lo];
  return seg ? seg.src + (outOffset - seg.out) : outOffset;
}

/**
 * Remove CriticMarkup from Markdown, choosing either the original or the
 * accepted reading. Comments always disappear; highlights keep their text.
 */
export function resolveCritic(src: string, view: CriticView = 'original'): ResolvedText {
  const spans = parseCritic(src);
  if (spans.length === 0) return { text: src, map: [{ out: 0, src: 0 }] };
  let out = '';
  const map: { out: number; src: number }[] = [];
  let cursor = 0;
  const push = (text: string, srcStart: number) => {
    if (!text) return;
    map.push({ out: out.length, src: srcStart });
    out += text;
  };
  for (const s of spans) {
    if (s.start < cursor) continue; // nested or overlapping token: ignore the inner one
    push(src.slice(cursor, s.start), cursor);
    const innerStart = s.start + 3;
    switch (s.kind) {
      case 'insert':
        if (view === 'accepted') push(s.text, innerStart);
        break;
      case 'delete':
        if (view === 'original') push(s.text, innerStart);
        break;
      case 'substitute':
        if (view === 'original') push(s.text, innerStart);
        else push(s.newText ?? '', innerStart + s.text.length + 2);
        break;
      case 'highlight':
        push(s.text, innerStart);
        break;
      case 'comment':
        break;
    }
    cursor = s.kind === 'comment' ? s.end : s.endWithMeta;
  }
  push(src.slice(cursor), cursor);
  if (map.length === 0) map.push({ out: 0, src: 0 });
  return { text: out, map };
}

/** Text a single change turns into when it is accepted or rejected. */
function replacement(span: CriticSpan, accept: boolean): string {
  switch (span.kind) {
    case 'insert':
      return accept ? span.text : '';
    case 'delete':
      return accept ? '' : span.text;
    case 'substitute':
      return accept ? (span.newText ?? '') : span.text;
    case 'highlight':
      return span.text;
    case 'comment':
      return '';
  }
}

/** Accept or reject one change. Returns the new source text. */
export function applyChange(src: string, span: CriticSpan, accept: boolean): string {
  return src.slice(0, span.start) + replacement(span, accept) + src.slice(span.endWithMeta);
}

/**
 * Accept or reject every tracked change. Comments and highlights are left
 * alone unless `removeComments` is set.
 */
export function applyAllChanges(src: string, accept: boolean, removeComments = false): string {
  const spans = parseCritic(src);
  let out = '';
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    out += src.slice(cursor, s.start);
    if (s.kind === 'comment' || s.kind === 'highlight') {
      if (s.kind === 'comment' && removeComments) {
        // dropped
      } else {
        out += src.slice(s.start, s.endWithMeta);
      }
    } else {
      out += replacement(s, accept);
    }
    cursor = s.endWithMeta;
  }
  return out + src.slice(cursor);
}

export interface CriticCounts {
  changes: number;
  comments: number;
  highlights: number;
}

export function countCritic(src: string): CriticCounts {
  const c: CriticCounts = { changes: 0, comments: 0, highlights: 0 };
  for (const s of parseCritic(src)) {
    if (s.kind === 'comment') c.comments++;
    else if (s.kind === 'highlight') c.highlights++;
    else c.changes++;
  }
  return c;
}

/** Characters that would break a CriticMarkup token if they appeared inside one. */
function safeInner(text: string, close: string): string {
  return text.split(close).join(close.slice(0, 1) + '​' + close.slice(1));
}

/** Build tokens. Used by the editor's suggesting mode and by the AI assistant. */
export const critic = {
  insert(text: string, author?: string, note?: string): string {
    return `{++${safeInner(text, '++}')}++}` + critic.meta(author, note);
  },
  delete(text: string, author?: string, note?: string): string {
    return `{--${safeInner(text, '--}')}--}` + critic.meta(author, note);
  },
  substitute(oldText: string, newText: string, author?: string, note?: string): string {
    const o = safeInner(oldText, '~~}').split('~>').join('~​>');
    const n = safeInner(newText, '~~}').split('~>').join('~​>');
    return `{~~${o}~>${n}~~}` + critic.meta(author, note);
  },
  comment(text: string, author?: string): string {
    const body = author ? `@${author}: ${text}` : text;
    return `{>>${safeInner(body, '<<}')}<<}`;
  },
  highlight(text: string): string {
    return `{==${safeInner(text, '==}')}==}`;
  },
  meta(author?: string, note?: string): string {
    if (!author) return '';
    return `{>>@${author}${note ? ': ' + safeInner(note, '<<}') : ''}<<}`;
  },
};

/** Highlighted passages, used by the marketing kit to build quote cards. */
export function extractHighlights(src: string): { text: string; start: number }[] {
  return parseCritic(src)
    .filter((s) => s.kind === 'highlight')
    .map((s) => ({ text: s.text.trim(), start: s.start }))
    .filter((h) => h.text.length > 0);
}
