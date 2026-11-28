import { strFromU8, unzipSync } from 'fflate';
import { parseDocument } from 'htmlparser2';
import type { ChildNode, Element } from 'domhandler';
import type { DraftBlock } from '../model/blocks';
import { finalizeBlocks, ImportError, type ImportMeta, type ImportResult } from './common';
import { htmlToBlocks, parseStylesheet, type ClassStyles } from './html';
import { normalizeLanguage } from '../text/language';

function isEl(node: ChildNode): node is Element {
  return node.type === 'tag';
}

/** Local element name without any namespace prefix. */
function local(el: Element): string {
  const i = el.name.indexOf(':');
  return (i >= 0 ? el.name.slice(i + 1) : el.name).toLowerCase();
}

function findAll(nodes: ChildNode[], name: string, out: Element[] = []): Element[] {
  for (const node of nodes) {
    if (!isEl(node)) continue;
    if (local(node) === name) out.push(node);
    findAll(node.children, name, out);
  }
  return out;
}

function text(el: Element | undefined): string {
  if (!el) return '';
  let out = '';
  for (const c of el.children) {
    if (c.type === 'text') out += c.data;
    else if (isEl(c)) out += text(c);
  }
  return out.trim();
}

function resolvePath(baseDir: string, href: string): string {
  let clean = href.split('#')[0];
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  const parts = (baseDir ? baseDir.split('/') : []).concat(clean.split('/'));
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Imports an EPUB e-book. */
export function importEpub(bytes: Uint8Array): ImportResult {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes, {
      filter: (f) => f.name === 'mimetype' || f.name.startsWith('META-INF/') || /\.(opf|xml|x?html?|css|ncx)$/i.test(f.name),
    });
  } catch {
    throw new ImportError('This file could not be opened as an EPUB. It may be damaged.');
  }

  const encryption = zip['META-INF/encryption.xml'];
  if (zip['META-INF/rights.xml'] || (encryption && hasContentEncryption(strFromU8(encryption)))) {
    throw new ImportError('This EPUB is copy-protected (DRM), so its text cannot be read. Ask the author for the original manuscript.');
  }

  const container = zip['META-INF/container.xml'];
  if (!container) throw new ImportError('This file is not a valid EPUB: its table of files is missing.');
  const rootfile = findAll(parseDocument(strFromU8(container), { xmlMode: true }).children, 'rootfile')[0];
  const opfPath = rootfile?.attribs['full-path'];
  const opfBytes = opfPath ? zip[opfPath] : undefined;
  if (!opfPath || !opfBytes) throw new ImportError('This file is not a valid EPUB: its package file is missing.');

  const opf = parseDocument(strFromU8(opfBytes), { xmlMode: true }).children;
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  const meta: ImportMeta = {};
  const title = text(findAll(opf, 'title')[0]);
  const author = text(findAll(opf, 'creator')[0]);
  const language = text(findAll(opf, 'language')[0]);
  if (title) meta.title = title;
  if (author) meta.author = author;
  if (language) meta.language = normalizeLanguage(language);

  const manifest = new Map<string, { path: string; type: string; nav: boolean }>();
  for (const item of findAll(opf, 'item')) {
    const { id, href } = item.attribs;
    if (!id || !href) continue;
    manifest.set(id, {
      path: resolvePath(baseDir, href),
      type: (item.attribs['media-type'] ?? '').toLowerCase(),
      nav: /\bnav\b/.test(item.attribs.properties ?? ''),
    });
  }

  const classStyles: ClassStyles = new Map();
  for (const item of manifest.values()) {
    if (item.type === 'text/css' && zip[item.path]) parseStylesheet(strFromU8(zip[item.path]), classStyles);
  }

  const blocks: DraftBlock[] = [];
  let images = 0;
  let documents = 0;
  for (const ref of findAll(opf, 'itemref')) {
    const item = manifest.get(ref.attribs.idref);
    if (!item || item.nav) continue;
    const data = zip[item.path];
    if (!data) continue;
    const result = htmlToBlocks(strFromU8(data), { classStyles });
    images += result.images;
    const first = result.blocks.find((b) => b.type !== 'break');
    if (!first) continue;
    // Each file in an e-book starts on a new page.
    first.pb = true;
    blocks.push(...result.blocks);
    documents++;
  }
  if (!documents) throw new ImportError('No readable text was found in this EPUB.');

  const warnings: string[] = [];
  if (images) warnings.push(`${images} image${images === 1 ? ' was' : 's were'} not imported. ManuscriptForge works on the text of a book.`);
  return { format: 'epub', blocks: finalizeBlocks(blocks), meta, warnings };
}

/** Font obfuscation is harmless; anything else means the text itself is encrypted. */
function hasContentEncryption(xml: string): boolean {
  const algorithms = [...xml.matchAll(/Algorithm\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  return algorithms.some((a) => !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(a));
}
