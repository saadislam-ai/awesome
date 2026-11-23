/**
 * Turns an EPUB file into self-contained pages for the in-app ebook preview.
 *
 * Each page of the reading order becomes one XHTML document with its style
 * sheets, pictures and fonts placed inside it, so it can be shown in a locked
 * down frame that has no access to files, scripts or the network. The text
 * and the styles are the ones in the EPUB; nothing is rebuilt.
 *
 * This is a quick look, not a device emulator: reading apps add their own
 * fonts, margins and themes. Kindle Previewer and a real phone remain the
 * final check.
 */
import { strFromU8, unzipSync } from 'fflate';
import { decodeEntities, descendants, parseXml, textOf } from '../import/xml';

export interface EpubPreviewDoc {
  /** Path of the document inside the EPUB. */
  path: string;
  title: string;
  /** The document, ready to show. Contains the marker PREVIEW_THEME_MARKER where the viewer puts its theme. */
  xhtml: string;
}

export interface EpubPreview {
  title: string;
  author: string;
  docs: EpubPreviewDoc[];
  /** Contents entries, each pointing at a document by its position in docs. */
  toc: { title: string; doc: number }[];
  /** Things that could not be shown. */
  notes: string[];
}

/** The viewer replaces this comment by its own style rules (colours, text size). */
export const PREVIEW_THEME_MARKER = '/*BORDERLESS-PREVIEW-THEME*/';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Resolve a relative reference against the folder of the file it appears in. */
function resolvePath(dir: string, ref: string): string {
  const clean = decodeURIComponent(ref.split('#')[0].split('?')[0]);
  const parts = (dir ? dir.split('/') : []).concat(clean.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const isExternal = (ref: string): boolean => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

export function epubPreview(bytes: Uint8Array, opts: { maxFontBytes?: number } = {}): EpubPreview {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new Error('This file could not be opened as an EPUB.');
  }
  const container = zip['META-INF/container.xml'];
  if (!container) throw new Error('This file is not an EPUB: it has no META-INF/container.xml inside.');
  const opfPath = descendants(parseXml(strFromU8(container)), 'rootfile')[0]?.attrs['full-path'] ?? '';
  if (!zip[opfPath]) throw new Error('The EPUB has no package file.');
  const opf = parseXml(strFromU8(zip[opfPath]));
  const base = dirOf(opfPath);
  const notes: string[] = [];
  const cache = new Map<string, string>();
  const maxFont = opts.maxFontBytes ?? 3_000_000;

  /** A file of the EPUB as a data URL, or null when it is missing or of an unknown kind. */
  const dataUrl = (path: string): string | null => {
    if (cache.has(path)) return cache.get(path)!;
    const data = zip[path];
    const mime = MIME[(path.split('.').pop() ?? '').toLowerCase()];
    if (!data || !mime) return null;
    if (mime.startsWith('font/') && data.length > maxFont) {
      if (!notes.some((n) => n.startsWith('A large font'))) notes.push('A large font file was left out of the preview; the text is shown in a font of this computer instead.');
      return null;
    }
    const url = `data:${mime};base64,${base64(data)}`;
    cache.set(path, url);
    return url;
  };

  /** A style sheet with the files it refers to (fonts, pictures) placed inside it. */
  const cssCache = new Map<string, string>();
  const inlineCss = (path: string): string => {
    if (cssCache.has(path)) return cssCache.get(path)!;
    const dir = dirOf(path);
    const css = strFromU8(zip[path] ?? new Uint8Array())
      .replace(/@import[^;]+;/g, '')
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _q: string, ref: string) => {
        if (ref.startsWith('data:')) return whole;
        const url = isExternal(ref) ? null : dataUrl(resolvePath(dir, ref));
        return url ? `url("${url}")` : 'url("")';
      })
      // "</style" inside a style sheet would end the style element early.
      .replace(/<\/style/gi, '<\\/style');
    cssCache.set(path, css);
    return css;
  };

  const manifest = new Map<string, { path: string; type: string; props: string }>();
  for (const item of descendants(opf, 'item')) {
    manifest.set(item.attrs.id ?? '', { path: resolvePath(base, item.attrs.href ?? ''), type: item.attrs['media-type'] ?? '', props: item.attrs.properties ?? '' });
  }

  const docs: EpubPreviewDoc[] = [];
  const indexOfPath = new Map<string, number>();
  for (const ref of descendants(opf, 'itemref')) {
    const item = manifest.get(ref.attrs.idref ?? '');
    if (!item || !/html/.test(item.type) || !zip[item.path]) continue;
    const dir = dirOf(item.path);
    let xhtml = strFromU8(zip[item.path]);
    const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(xhtml)?.[1] ?? '').replace(/<[^>]+>/g, '')).trim();
    xhtml = xhtml
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/>/gi, '')
      // Style sheets go inside the page.
      .replace(/<link\b[^>]*>/gi, (tag) => {
        const href = /\bhref\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
        if (!/\brel\s*=\s*"[^"]*stylesheet/i.test(tag) || !href || isExternal(href)) return '';
        return `<style>${inlineCss(resolvePath(dir, decodeEntities(href)))}</style>`;
      })
      // Pictures, in HTML and inside SVG.
      .replace(/(<(?:img|image|source)\b[^>]*?\s)((?:xlink:)?(?:src|href))\s*=\s*"([^"]*)"/gi, (whole, start: string, attr: string, ref: string) => {
        if (ref.startsWith('data:')) return whole;
        const url = isExternal(ref) ? null : dataUrl(resolvePath(dir, decodeEntities(ref)));
        return `${start}${attr}="${url ?? ''}"`;
      })
      // Links to other pages cannot be followed inside the frame; links inside the page (notes) still work.
      .replace(/(<a\b[^>]*?\s)href\s*=\s*"([^"#][^"]*)"/gi, (_whole, start: string, ref: string) => `${start}data-href="${ref}"`);
    const themed = `<style>${PREVIEW_THEME_MARKER}</style>`;
    xhtml = /<\/head>/i.test(xhtml) ? xhtml.replace(/<\/head>/i, `${themed}</head>`) : xhtml.replace(/<body/i, `<head>${themed}</head><body`);
    indexOfPath.set(item.path, docs.length);
    docs.push({ path: item.path, title, xhtml });
  }
  if (docs.length === 0) throw new Error('The EPUB has no pages in its reading order.');

  // Contents from the navigation document.
  const toc: { title: string; doc: number }[] = [];
  const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  if (nav && zip[nav.path]) {
    const text = strFromU8(zip[nav.path]);
    const block = /<nav\b[^>]*epub:type\s*=\s*"[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(text)?.[1] ?? text;
    const link = /<a\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (let m = link.exec(block); m; m = link.exec(block)) {
      const doc = indexOfPath.get(resolvePath(dirOf(nav.path), decodeEntities(m[1])));
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (doc !== undefined && title) toc.push({ title, doc });
    }
  }
  if (toc.length === 0) docs.forEach((d, i) => toc.push({ title: d.title || `Page ${i + 1}`, doc: i }));

  const meta = (name: string) => descendants(opf, name).map(textOf)[0]?.trim() ?? '';
  return { title: meta('dc:title'), author: meta('dc:creator'), docs, toc, notes };
}
