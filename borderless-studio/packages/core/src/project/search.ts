/**
 * Full text search across a whole book, with optional regular expressions,
 * and safe replace (every changed document is snapshotted first).
 */
import { textNodes, type Binder } from '../model/book';
import type { Project } from './store';

export interface SearchOptions {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** Stop after this many matches (the interface shows "and more"). */
  limit?: number;
}

export interface SearchMatch {
  nodeId: string;
  title: string;
  /** Offsets in the document text. */
  from: number;
  to: number;
  /** 1 based line number. */
  line: number;
  /** The line the match is on, shortened around the match. */
  excerpt: string;
  /** Where the match sits inside `excerpt`. */
  excerptFrom: number;
  excerptTo: number;
}

export interface SearchResult {
  matches: SearchMatch[];
  /** Total number found (may be more than matches.length when the limit was hit). */
  total: number;
  /** Set when the search pattern itself is not valid. */
  error?: string;
}

export function buildPattern(opts: SearchOptions): RegExp {
  let source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`;
  return new RegExp(source, `gu${opts.caseSensitive ? '' : 'i'}m`);
}

/** Search one piece of text. */
export function searchText(text: string, pattern: RegExp, nodeId: string, title: string, limit = Infinity): { matches: SearchMatch[]; total: number } {
  const matches: SearchMatch[] = [];
  let total = 0;
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  let line = 1;
  let lineScanFrom = 0;
  while ((m = pattern.exec(text))) {
    if (m[0].length === 0) {
      pattern.lastIndex++;
      continue;
    }
    total++;
    if (matches.length >= limit) continue;
    for (let i = lineScanFrom; i < m.index; i++) if (text.charCodeAt(i) === 10) line++;
    lineScanFrom = m.index;
    const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
    let lineEnd = text.indexOf('\n', m.index);
    if (lineEnd < 0) lineEnd = text.length;
    const from = Math.max(lineStart, m.index - 60);
    const to = Math.min(lineEnd, m.index + m[0].length + 80);
    const prefix = from > lineStart ? '...' : '';
    matches.push({
      nodeId, title, from: m.index, to: m.index + m[0].length, line,
      excerpt: prefix + text.slice(from, to) + (to < lineEnd ? '...' : ''),
      excerptFrom: prefix.length + (m.index - from),
      excerptTo: prefix.length + (m.index - from) + Math.min(m[0].length, to - m.index),
    });
  }
  return { matches, total };
}

/** Search every document of a book in reading order. */
export async function searchProject(project: Project, opts: SearchOptions): Promise<SearchResult> {
  if (!opts.query) return { matches: [], total: 0 };
  let pattern: RegExp;
  try {
    pattern = buildPattern(opts);
  } catch (e) {
    return { matches: [], total: 0, error: `This is not a valid search pattern: ${(e as Error).message}` };
  }
  const limit = opts.limit ?? 500;
  const out: SearchMatch[] = [];
  let total = 0;
  for (const node of textNodes(project.binder as Binder)) {
    const text = await project.readDoc(node.id);
    const r = searchText(text, pattern, node.id, node.title, Math.max(0, limit - out.length));
    out.push(...r.matches);
    total += r.total;
  }
  return { matches: out, total };
}

export interface ReplaceResult {
  documentsChanged: number;
  replacements: number;
}

/**
 * Replace across the whole book. `replacement` may use $1, $2 for groups when
 * the search is a regular expression. Each changed document gets a snapshot
 * named "before replace" first, so the operation can always be undone.
 */
export async function replaceInProject(project: Project, opts: SearchOptions, replacement: string, onlyNodeIds?: string[]): Promise<ReplaceResult> {
  const pattern = buildPattern(opts);
  let documentsChanged = 0;
  let replacements = 0;
  for (const node of textNodes(project.binder as Binder)) {
    if (onlyNodeIds && !onlyNodeIds.includes(node.id)) continue;
    const text = await project.readDoc(node.id);
    let count = 0;
    pattern.lastIndex = 0;
    const next = text.replace(pattern, (...args) => {
      count++;
      if (!opts.regex) return replacement;
      const groups = args.slice(1, -2) as (string | undefined)[];
      return replacement.replace(/\$(\d)/g, (_m, d: string) => groups[Number(d) - 1] ?? '');
    });
    if (count > 0 && next !== text) {
      await project.writeDoc(node.id, next, { snapshotLabel: 'before replace' });
      documentsChanged++;
      replacements += count;
    }
  }
  return { documentsChanged, replacements };
}
