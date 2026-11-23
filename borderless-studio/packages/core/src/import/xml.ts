/**
 * A small XML reader, enough for the well formed XML inside Word files,
 * EPUBs and Scrivener projects. It builds a plain tree; namespaces are kept
 * as part of the names ("w:p"), which is how those formats are documented.
 */
export interface XmlNode {
  /** Element name, or "#text" for text. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Parse XML (or tidy XHTML) into a tree. Malformed input is read as far as it makes sense rather than rejected. */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s>/]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of source.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.children.push({ name: '#text', attrs: {}, children: [], text: m[1] });
    } else if (m[2] !== undefined) {
      // Close the nearest open element of that name (tolerates a missing end tag in between).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) { stack.length = i; break; }
      }
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
      const node: XmlNode = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) {
      top.children.push({ name: '#text', attrs: {}, children: [], text: decodeEntities(m[6]) });
    }
  }
  return root;
}

export const child = (n: XmlNode | undefined, name: string): XmlNode | undefined => n?.children.find((c) => c.name === name);
export const children = (n: XmlNode | undefined, name: string): XmlNode[] => (n ? n.children.filter((c) => c.name === name) : []);

/** Every descendant element with the given name, in document order. */
export function descendants(n: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (c.name === name) out.push(c);
    if (c.children.length) descendants(c, name, out);
  }
  return out;
}

/** All text below a node. */
export function textOf(n: XmlNode): string {
  if (n.name === '#text') return n.text;
  let out = '';
  for (const c of n.children) out += textOf(c);
  return out;
}
