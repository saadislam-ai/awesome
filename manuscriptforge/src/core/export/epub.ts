import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Block, Run } from '../model/blocks';
import { sha256 } from '../util/hash';
import { escapeXml, hasPrintableTitle, type ExportBook } from './common';

function inline(runs: Run[]): string {
  return runs
    .map((run) => {
      let html = escapeXml(run.text).replace(/\n/g, '<br/>');
      if (run.b) html = `<strong>${html}</strong>`;
      if (run.i) html = `<em>${html}</em>`;
      if (run.u) html = `<span class="u">${html}</span>`;
      if (run.s) html = `<del>${html}</del>`;
      return html;
    })
    .join('');
}

function blocksToXhtml(blocks: Block[]): string {
  let out = '';
  let list: 'ol' | 'ul' | null = null;
  let quote = false;
  const closeList = () => {
    if (list) out += `</${list}>\n`;
    list = null;
  };
  const closeQuote = () => {
    if (quote) out += '</blockquote>\n';
    quote = false;
  };
  let afterBreak = true;
  for (const block of blocks) {
    if (block.type !== 'list') closeList();
    if (block.type !== 'quote') closeQuote();
    if (block.type === 'break') {
      out += '<p class="scene-break">* * *</p>\n';
      afterBreak = true;
      continue;
    }
    if (block.type === 'heading') {
      const level = Math.min(block.level + 1, 6);
      out += `<h${level}${block.align ? ` class="${block.align}"` : ''}>${inline(block.runs)}</h${level}>\n`;
      afterBreak = true;
    } else if (block.type === 'quote') {
      if (!quote) out += '<blockquote>\n';
      quote = true;
      out += `<p>${inline(block.runs)}</p>\n`;
    } else if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      if (list !== tag) {
        closeList();
        out += `<${tag}>\n`;
        list = tag;
      }
      out += `<li>${inline(block.runs)}</li>\n`;
    } else {
      // The first paragraph of a chapter or scene is not indented, as in a printed book.
      const classes = [block.align, afterBreak && !block.align ? 'first' : ''].filter(Boolean).join(' ');
      out += `<p${classes ? ` class="${classes}"` : ''}>${inline(block.runs)}</p>\n`;
      afterBreak = false;
    }
  }
  closeList();
  closeQuote();
  return out;
}

const CSS = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1 { text-align: center; margin: 3em 0 2em; font-size: 1.5em; page-break-before: always; }
h2 { margin: 1.6em 0 0.6em; font-size: 1.25em; }
h3, h4, h5, h6 { margin: 1.3em 0 0.5em; font-size: 1.05em; }
p { margin: 0; text-indent: 1.4em; }
p.first, p.center, p.right, blockquote p, li p { text-indent: 0; }
.center { text-align: center; }
.right { text-align: right; }
p.scene-break { text-align: center; text-indent: 0; margin: 1.2em 0; }
blockquote { margin: 1em 1.5em; }
blockquote p + p { margin-top: 0.6em; }
.u { text-decoration: underline; }
`;

/** Writes the book as an EPUB 3 e-book (with an EPUB 2 table of contents for older readers). */
export function exportEpub(book: ExportBook, modified: Date = new Date()): Uint8Array {
  const language = book.language && book.language !== 'und' ? book.language : 'en';
  const digest = sha256(`${book.title}\u0000${book.author}\u0000${book.chapters.map((c) => c.title).join('\u0000')}`);
  const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const chapters = book.chapters.map((chapter, index) => ({
    file: `chapter-${String(index + 1).padStart(3, '0')}.xhtml`,
    id: `ch${index + 1}`,
    label: chapter.title.trim() || `Chapter ${index + 1}`,
    chapter,
  }));

  const page = (title: string, bodyHtml: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${language}" lang="${language}">\n<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n<body>\n${bodyHtml}</body>\n</html>\n`;

  const files: Zippable = {
    // The mimetype entry must come first and must not be compressed.
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
    ),
    'OEBPS/style.css': strToU8(CSS),
  };
  for (const item of chapters) {
    const heading = hasPrintableTitle(item.chapter) ? `<h1>${escapeXml(item.chapter.title)}</h1>\n` : '';
    files[`OEBPS/${item.file}`] = strToU8(page(item.label, heading + blocksToXhtml(item.chapter.blocks)));
  }
  files['OEBPS/nav.xhtml'] = strToU8(
    page(
      'Contents',
      `<nav epub:type="toc" id="toc"><h1>Contents</h1>\n<ol>\n${chapters.map((c) => `<li><a href="${c.file}">${escapeXml(c.label)}</a></li>`).join('\n')}\n</ol></nav>\n`,
    ),
  );
  files['OEBPS/toc.ncx'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${uuid}"/></head><docTitle><text>${escapeXml(book.title)}</text></docTitle><navMap>\n${chapters
      .map((c, i) => `<navPoint id="${c.id}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.label)}</text></navLabel><content src="${c.file}"/></navPoint>`)
      .join('\n')}\n</navMap></ncx>\n`,
  );
  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="book-id">urn:uuid:${uuid}</dc:identifier>\n<dc:title>${escapeXml(book.title)}</dc:title>\n${book.author ? `<dc:creator>${escapeXml(book.author)}</dc:creator>\n` : ''}<dc:language>${language}</dc:language>\n<meta property="dcterms:modified">${modified.toISOString().replace(/\.\d+Z$/, 'Z')}</meta>\n</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="css" href="style.css" media-type="text/css"/>\n${chapters
      .map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`)
      .join('\n')}\n</manifest>\n<spine toc="ncx">\n${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n')}\n</spine>\n</package>\n`,
  );
  return zipSync(files);
}
