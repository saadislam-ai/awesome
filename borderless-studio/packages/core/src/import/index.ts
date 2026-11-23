/**
 * Import: bring an existing manuscript into a book. Supported sources are
 * Word (.docx), Markdown, plain text, EPUB and Scrivener projects. Every
 * importer produces the same simple list of documents, which is then added
 * to the binder; the original file is only read, never changed.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { Host } from '../host';
import type { SectionKind } from '../model/book';
import type { Project } from '../project/store';
import type { NewNodeSpec } from '../project/templates';
import { basename, dirname, extname, joinPath } from '../util/paths';
import { importDocx } from './docx';
import { cleanTitle, emptyImport, kindFromTitle, tidyMarkdown, type ImportedBook, type ImportedItem } from './model';
import { htmlToMarkdown, importMarkdown, importPlainText, rtfToMarkdown } from './text';
import { child, children, descendants, parseXml, textOf, type XmlNode } from './xml';

export * from './model';
export { importDocx } from './docx';
export { htmlToMarkdown, importMarkdown, importPlainText, rtfToMarkdown } from './text';
export { parseXml } from './xml';

/* ------------------------------------------------------------------ */
/* EPUB                                                                */
/* ------------------------------------------------------------------ */

const resolve = (base: string, rel: string): string => {
  const parts = (base ? base.split('/') : []).concat(decodeURIComponent(rel.split('#')[0]).split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
};

export function importEpub(bytes: Uint8Array, fileName = ''): ImportedBook {
  const out = emptyImport();
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new Error('This file could not be opened as an EPUB.');
  }
  const container = zip['META-INF/container.xml'];
  if (!container) throw new Error('This file is not an EPUB: it has no META-INF/container.xml inside.');
  if (zip['META-INF/encryption.xml'] && /EncryptedData/.test(strFromU8(zip['META-INF/encryption.xml'])) && zip['META-INF/rights.xml']) {
    throw new Error('This EPUB is copy protected (DRM) and cannot be imported.');
  }
  const opfPath = descendants(parseXml(strFromU8(container)), 'rootfile')[0]?.attrs['full-path'] ?? '';
  const opfBytes = zip[opfPath];
  if (!opfBytes) throw new Error('The EPUB has no package file.');
  const opf = parseXml(strFromU8(opfBytes));
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const meta = (name: string) => descendants(opf, name).map(textOf).join(' ').trim();
  out.title = meta('dc:title');
  out.author = descendants(opf, 'dc:creator').map(textOf)[0]?.trim() ?? '';
  out.language = meta('dc:language');
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const item of descendants(opf, 'item')) manifest.set(item.attrs.id, { href: resolve(base, item.attrs.href ?? ''), type: item.attrs['media-type'] ?? '', props: item.attrs.properties ?? '' });
  const usedImages = new Map<string, string>();
  let seenChapter = false;
  for (const ref of descendants(opf, 'itemref')) {
    const item = manifest.get(ref.attrs.idref);
    if (!item || !/html/.test(item.type) || /\bnav\b/.test(item.props) || !zip[item.href]) continue;
    const dir = item.href.includes('/') ? item.href.slice(0, item.href.lastIndexOf('/')) : '';
    const { title, markdown } = htmlToMarkdown(strFromU8(zip[item.href]), (src) => {
      const path = resolve(dir, src);
      if (!zip[path]) return null;
      if (!usedImages.has(path)) {
        let name = path.split('/').pop()!;
        while ([...usedImages.values()].includes(name)) name = `x-${name}`;
        usedImages.set(path, name);
        out.images.push({ name, data: zip[path] });
      }
      return usedImages.get(path)!;
    });
    const words = markdown.split(/\s+/).filter(Boolean).length;
    // Cover and title pages have next to no text; contents pages are rebuilt by the app.
    if (words < 4 || /^(contents|table of contents)$/i.test(title)) continue;
    const kind = title ? kindFromTitle(title, seenChapter) : seenChapter ? 'chapter' : 'front';
    if (kind === 'chapter') seenChapter = true;
    out.items.push({ title: title || (seenChapter ? `Section ${out.items.length + 1}` : 'Opening pages'), kind: kind === 'part' && words > 12 ? 'chapter' : kind, text: markdown });
  }
  if (!out.title) out.title = basename(fileName).replace(/\.[^.]+$/, '');
  if (out.items.length === 0) out.notes.push('No readable chapters were found in this EPUB.');
  return out;
}

/* ------------------------------------------------------------------ */
/* Scrivener                                                           */
/* ------------------------------------------------------------------ */

/** Import the Draft (Manuscript) folder of a Scrivener project. `path` is the .scriv folder or the .scrivx file inside it. */
export async function importScrivener(host: Host, path: string): Promise<ImportedBook> {
  const out = emptyImport();
  let dir = path;
  let scrivx = '';
  if (/\.scrivx$/i.test(path)) {
    scrivx = path;
    dir = dirname(path);
  } else {
    const entry = (await host.list(dir)).find((e) => e.isFile && /\.scrivx$/i.test(e.name));
    if (!entry) throw new Error('This folder is not a Scrivener project: it contains no .scrivx file.');
    scrivx = joinPath(dir, entry.name);
  }
  const project = parseXml(await host.readText(scrivx));
  const binder = descendants(project, 'Binder')[0];
  const draft = binder?.children.find((c) => c.name === 'BinderItem' && c.attrs.Type === 'DraftFolder');
  if (!draft) throw new Error('The Scrivener project has no Draft (Manuscript) folder.');
  out.title = basename(dir).replace(/\.scriv$/i, '');

  const readText = async (item: XmlNode): Promise<string> => {
    const candidates = [
      item.attrs.UUID ? joinPath(dir, 'Files', 'Data', item.attrs.UUID, 'content.rtf') : '',
      item.attrs.ID ? joinPath(dir, 'Files', 'Docs', `${item.attrs.ID}.rtf`) : '',
      item.attrs.UUID ? joinPath(dir, 'Files', 'Data', item.attrs.UUID, 'content.txt') : '',
      item.attrs.ID ? joinPath(dir, 'Files', 'Docs', `${item.attrs.ID}.txt`) : '',
    ].filter(Boolean);
    for (const file of candidates) {
      if (!(await host.exists(file))) continue;
      const raw = await host.readText(file);
      return file.endsWith('.rtf') ? rtfToMarkdown(raw) : tidyMarkdown(raw);
    }
    return '';
  };
  const titleOf = (item: XmlNode) => textOf(child(item, 'Title') ?? { name: '', attrs: {}, children: [], text: '' }).trim() || 'Untitled';
  const included = (item: XmlNode) => !/^no$/i.test(textOf(child(child(item, 'MetaData'), 'IncludeInCompile') ?? { name: '', attrs: {}, children: [], text: 'Yes' }).trim());
  const kids = (item: XmlNode) => children(child(item, 'Children'), 'BinderItem').filter(included);
  /** All the text below an item, scenes separated by scene breaks. */
  const gather = async (item: XmlNode): Promise<string> => {
    const parts: string[] = [];
    const own = (await readText(item)).trim();
    if (own) parts.push(own);
    for (const k of kids(item)) {
      const t = (await gather(k)).trim();
      if (t) parts.push(t);
    }
    return parts.join('\n\n***\n\n');
  };
  let seenChapter = false;
  for (const item of kids(draft)) {
    const sub = kids(item);
    const title = titleOf(item);
    // A folder of folders is a part; its folders are the chapters.
    if (sub.length > 0 && sub.some((k) => kids(k).length > 0)) {
      out.items.push({ title, kind: 'part', text: '' });
      for (const ch of sub) {
        out.items.push({ title: titleOf(ch), kind: 'chapter', text: tidyMarkdown(await gather(ch)) });
        seenChapter = true;
      }
      continue;
    }
    const text = await gather(item);
    if (!text.trim()) continue;
    const kind = kindFromTitle(title, seenChapter);
    if (kind === 'chapter') seenChapter = true;
    out.items.push({ title, kind: kind === 'part' ? 'chapter' : kind, text: tidyMarkdown(text) });
  }
  if (out.items.length === 0) out.notes.push('The Draft folder of this Scrivener project has no text.');
  out.notes.push('Scrivener notes, synopses, labels and research files are not imported, only the text of the Draft folder.');
  return out;
}

/* ------------------------------------------------------------------ */
/* Choosing an importer, and adding the result to a book               */
/* ------------------------------------------------------------------ */

export const IMPORT_EXTENSIONS = ['docx', 'md', 'markdown', 'txt', 'epub', 'scrivx'];

/** Read a manuscript file (or Scrivener project) with the importer that fits its type. */
export async function importFile(host: Host, path: string): Promise<ImportedBook> {
  const ext = extname(path).toLowerCase();
  const name = basename(path);
  if (ext === '.scriv' || ext === '.scrivx') return importScrivener(host, path);
  const stat = await host.stat(path);
  if (stat?.isDir) return importScrivener(host, path);
  if (ext === '.docx') return importDocx(await host.readBinary(path), name);
  if (ext === '.epub') return importEpub(await host.readBinary(path), name);
  if (ext === '.md' || ext === '.markdown') return importMarkdown(await host.readText(path), name);
  if (ext === '.txt' || ext === '') return importPlainText(await host.readText(path), name);
  if (ext === '.doc') throw new Error('Old Word files (.doc) cannot be read. Open the file in Word or LibreOffice and save it as .docx.');
  if (ext === '.rtf') {
    const book = emptyImport();
    book.title = name.replace(/\.[^.]+$/, '');
    book.items = importPlainText(rtfToMarkdown(await host.readText(path)).replace(/\\([*_`[\]{}#-])/g, '$1'), name).items;
    return book;
  }
  throw new Error(`Files of the type "${ext}" cannot be imported. Supported: Word (.docx), Markdown, plain text, EPUB and Scrivener projects.`);
}

const KIND_BY_TITLE: [RegExp, SectionKind][] = [
  [/^dedication/i, 'dedication'], [/^epigraph/i, 'epigraph'], [/^foreword/i, 'foreword'], [/^preface/i, 'preface'], [/^introduction/i, 'introduction'],
  [/^prologue/i, 'prologue'], [/^epilogue/i, 'epilogue'], [/^afterword/i, 'afterword'], [/^acknowledge?ments/i, 'acknowledgements'], [/^about the author/i, 'about-author'],
  [/^(a )?note to readers|^author'?s note/i, 'note-to-readers'], [/^reading group/i, 'reading-group'], [/^bibliography/i, 'bibliography'], [/^glossary/i, 'glossary'], [/^appendix/i, 'appendix'],
];
const sectionKind = (title: string): SectionKind => KIND_BY_TITLE.find(([re]) => re.test(title.trim()))?.[1] ?? 'generic';

export interface ImportSummary {
  chapters: number;
  parts: number;
  frontAndBack: number;
  images: number;
  words: number;
}

/**
 * Add an imported manuscript to a book: parts and chapters go into the
 * manuscript, front and back matter into their groups, pictures into the
 * images folder. Nothing that is already in the book is changed or removed.
 */
export async function addImportToProject(project: Project, imported: ImportedBook): Promise<ImportSummary> {
  const roots = project.binder.roots;
  const front = roots.find((r) => r.role === 'front');
  const body = roots.find((r) => r.role === 'body') ?? roots[0];
  const back = roots.find((r) => r.role === 'back');
  const summary: ImportSummary = { chapters: 0, parts: 0, frontAndBack: 0, images: imported.images.length, words: 0 };
  if (imported.images.length) {
    await project.host.mkdirp(project.path('images'));
    for (const img of imported.images) await project.host.writeBinary(project.path('images', img.name), img.data);
  }
  let partId: string | null = null;
  for (const item of imported.items as ImportedItem[]) {
    summary.words += item.text.split(/\s+/).filter(Boolean).length;
    if (item.kind === 'part') {
      const part = await project.addNode(body.id, { type: 'part', kind: 'part', title: cleanTitle(item.title) });
      partId = part.id;
      summary.parts++;
    } else if (item.kind === 'chapter') {
      const spec: NewNodeSpec = { type: 'chapter', kind: 'chapter', title: cleanTitle(item.title), numbered: true, children: [{ type: 'doc', kind: 'scene', title: 'Text', text: item.text }] };
      await project.addNode(partId ?? body.id, spec);
      summary.chapters++;
    } else {
      const root = item.kind === 'front' ? front ?? body : back ?? body;
      const kind = sectionKind(item.title);
      // A dedication or similar page that the new book already has as an empty starter is filled in instead of duplicated.
      const existing = (root.children ?? []).find((n) => n.kind === kind && kind !== 'generic' && n.file);
      const starter = existing ? (await project.readDoc(existing.id)).trim() : '';
      if (existing && (starter === '' || starter === 'For ...')) await project.writeDoc(existing.id, item.text);
      else {
        const node = await project.addNode(root.id, { type: 'doc', kind, title: item.title, text: item.text });
        // Kept for reference only (a copyright page the app replaces with its own): not part of the exported book.
        if (item.excluded) await project.updateNode(node.id, { include: false });
      }
      summary.frontAndBack++;
    }
  }
  return summary;
}

/**
 * Put an imported manuscript into a book that was just created. A new book
 * starts with an empty example chapter; when the import brings chapters of
 * its own, that example is removed first so the book does not open with an
 * empty "Chapter 1" in front of the real one.
 */
export async function fillNewBookFromImport(project: Project, imported: ImportedBook): Promise<ImportSummary> {
  const body = project.binder.roots.find((r) => r.role === 'body');
  if (body && imported.items.some((i) => i.kind === 'chapter' || i.kind === 'part')) {
    for (const child of [...(body.children ?? [])]) await project.removeNode(child.id);
  }
  return addImportToProject(project, imported);
}
