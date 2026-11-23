/**
 * EPUB 3 builder. Produces a reflowable EPUB straight from the assembled book
 * (no intermediate Word or HTML export), with:
 *
 *   - a navigation document with nested contents and landmarks,
 *   - an NCX file as well, for older reading systems,
 *   - complete Dublin Core metadata, series data and accessibility metadata,
 *   - clean semantic XHTML (see xhtml.ts) and a restrained stylesheet that
 *     respects the reader's own font and size settings,
 *   - optional embedded fonts and a drop capital that degrades to a normal
 *     letter on old Kindles.
 *
 * The result is checked by EPUBCheck in epubcheck.ts.
 */
import { zipSync, type Zippable } from 'fflate';
import type { AssembledBook, AssembledSection } from '../build/assemble';
import { seriesLine } from '../build/assemble';
import { baseLanguage, primaryAuthor } from '../model/book';
import type { SectionKind } from '../model/book';
import { cleanIsbn, validateIsbn } from '../isbn';
import { escapeXml, escapeXmlText, utf8 } from '../util/text';
import { extname } from '../util/paths';
import { renderBlocks, renderInlines, type XhtmlContext } from './xhtml';
import { EPUB_CSS, fontFaceCss } from './css';

export interface EpubImage {
  data: Uint8Array;
  /** image/jpeg, image/png, image/gif or image/svg+xml */
  mediaType: string;
}

export interface EpubFont {
  family: string;
  fileName: string;
  data: Uint8Array;
  style: 'normal' | 'italic';
  weight: 400 | 700;
}

export interface EpubOptions {
  /** Pictures used in the text, keyed by the path written in the manuscript. */
  images?: Map<string, EpubImage>;
  cover?: EpubImage;
  /** Add the cover as the first page inside the book. Off for retailers (they add their own). */
  coverPage?: boolean;
  fonts?: EpubFont[];
  /** dcterms:modified, an ISO timestamp. Passed in so that builds are reproducible in tests. */
  modified?: string;
  /** Stable identifier used when the format has no ISBN yet. */
  fallbackUuid?: string;
  description?: string;
  subjects?: string[];
  /** Generator name written into the metadata. */
  generator?: string;
}

export interface EpubFileMapEntry {
  /** Path inside the EPUB, for example OEBPS/text/s005-chapter.xhtml */
  path: string;
  sectionId: string;
  title: string;
  /** For each line of the XHTML file: where it came from in the manuscript. */
  lines: { line: number; nodeId?: string; nodeTitle?: string; srcLine?: number }[];
}

export interface EpubResult {
  bytes: Uint8Array;
  /** Text files inside the EPUB, for the previewer. */
  files: { path: string; content: string }[];
  map: EpubFileMapEntry[];
  spine: { path: string; title: string }[];
  warnings: { severity: 'info' | 'warn' | 'fail'; code: string; message: string }[];
  identifier: string;
}

const EPUB_TYPE: Partial<Record<SectionKind, { type: string; role?: string }>> = {
  'title-page': { type: 'titlepage' },
  copyright: { type: 'copyright-page' },
  dedication: { type: 'dedication', role: 'doc-dedication' },
  epigraph: { type: 'epigraph', role: 'doc-epigraph' },
  foreword: { type: 'foreword', role: 'doc-foreword' },
  preface: { type: 'preface', role: 'doc-preface' },
  introduction: { type: 'introduction', role: 'doc-introduction' },
  prologue: { type: 'prologue', role: 'doc-prologue' },
  chapter: { type: 'chapter', role: 'doc-chapter' },
  part: { type: 'part', role: 'doc-part' },
  epilogue: { type: 'epilogue', role: 'doc-epilogue' },
  afterword: { type: 'afterword', role: 'doc-afterword' },
  acknowledgements: { type: 'acknowledgments', role: 'doc-acknowledgments' },
  appendix: { type: 'appendix', role: 'doc-appendix' },
  glossary: { type: 'glossary', role: 'doc-glossary' },
  bibliography: { type: 'bibliography', role: 'doc-bibliography' },
  index: { type: 'index', role: 'doc-index' },
  endnotes: { type: 'endnotes', role: 'doc-endnotes' },
};

const ZONE_TYPE = { front: 'frontmatter', body: 'bodymatter', back: 'backmatter' } as const;

const MEDIA_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

export function mediaTypeForImage(path: string): string | null {
  return MEDIA_BY_EXT[extname(path)] ?? null;
}

function xhtmlDoc(lang: string, title: string, bodyAttrs: string, bodyLines: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">`,
    '<head>',
    '<meta charset="utf-8"/>',
    `<title>${escapeXmlText(title)}</title>`,
    '<link rel="stylesheet" type="text/css" href="../css/book.css"/>',
    '</head>',
    `<body${bodyAttrs}>`,
    ...bodyLines,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

interface BuiltSection {
  section: AssembledSection;
  file: string; // relative to OEBPS
  id: string;
  title: string;
  navTitle: string;
  headings: { level: number; id: string; text: string }[];
  inNav: boolean;
  level: 0 | 1;
}

export function buildEpub(assembled: AssembledBook, opts: EpubOptions = {}): EpubResult {
  const { book, format, design, strings } = assembled;
  const lang = book.language || 'en';
  const warnings: EpubResult['warnings'] = [];
  const images = opts.images ?? new Map<string, EpubImage>();
  const imageFiles = new Map<string, { href: string; id: string; img: EpubImage }>();
  const usedImage = (src: string): string | null => {
    const img = images.get(src);
    if (!img) {
      warnings.push({ severity: 'fail', code: 'missing-image', message: `The picture "${src}" was not found, so it is missing from the ebook.` });
      return null;
    }
    let entry = imageFiles.get(src);
    if (!entry) {
      const n = imageFiles.size + 1;
      const ext = Object.entries(MEDIA_BY_EXT).find(([, m]) => m === img.mediaType)?.[0] ?? '.jpg';
      entry = { href: `images/img${String(n).padStart(3, '0')}${ext === '.jpeg' ? '.jpg' : ext}`, id: `img${n}`, img };
      imageFiles.set(src, entry);
    }
    return '../' + entry.href;
  };

  const built: BuiltSection[] = [];
  const files: { path: string; content: string }[] = [];
  const map: EpubFileMapEntry[] = [];
  const indexAnchors: { term: string; sub?: string; file: string; id: string; label: string }[] = [];
  let anyImages = false;
  const missingAlt: string[] = [];
  let noteCount = 0;

  const sections = assembled.sections.filter((s) => !['half-title', 'toc'].includes(s.kind));
  let seq = 0;
  let indexSection: { sec: AssembledSection; file: string; seq: number } | null = null;

  for (const sec of sections) {
    seq++;
    const slug = `s${String(seq).padStart(3, '0')}-${sec.kind}`;
    const file = `text/${slug}.xhtml`;
    const idPrefix = `s${seq}`;
    if (sec.kind === 'index') {
      indexSection = { sec, file, seq };
      built.push({ section: sec, file, id: slug, title: sec.title, navTitle: sec.title, headings: [], inNav: true, level: 1 });
      continue;
    }
    const ctx: XhtmlContext = {
      idPrefix, imageHref: usedImage, notes: [], indexAnchors: [], headings: [], missingAlt: [], hasImages: false,
      spaced: design.paragraphStyle === 'spaced',
    };
    const t: { type?: string; role?: string } = EPUB_TYPE[sec.kind] ?? {};
    const lines: string[] = [];
    const lineSrc: { nodeId?: string; nodeTitle?: string; srcLine?: number }[] = [];
    const add = (html: string, src: { nodeId?: string; nodeTitle?: string; srcLine?: number } = {}) => {
      lines.push(html);
      lineSrc.push(src);
    };
    const hid = `${idPrefix}-h`;
    const sectionAttrs = `${t.type ? ` epub:type="${t.type}"` : ''}${t.role ? ` role="${t.role}"` : ''}`;
    const navTitle = [sec.label, sec.title].filter(Boolean).join(': ') || strings.kinds[sec.kind] || sec.kind;
    let hasHeading = true;

    if (sec.kind === 'title-page') {
      const d = sec.data as { title: string; subtitle: string; author: string; contributors: string[]; imprint: string; imprintPlace: string; series: string };
      add(`<section class="titlepage"${sectionAttrs} aria-labelledby="${hid}">`);
      add(`<h1 id="${hid}" class="book-title">${escapeXmlText(d.title)}</h1>`);
      if (d.subtitle) add(`<p class="book-subtitle">${escapeXmlText(d.subtitle)}</p>`);
      if (d.series) add(`<p class="book-series">${escapeXmlText(d.series)}</p>`);
      add(`<p class="book-author">${escapeXmlText(d.author)}</p>`);
      for (const c of d.contributors ?? []) add(`<p class="book-contributor">${escapeXmlText(c)}</p>`);
      add(`<p class="book-imprint">${escapeXmlText(d.imprint)}</p>`);
      add('</section>');
    } else {
      const display = sec.kind === 'copyright' || sec.kind === 'dedication' || sec.kind === 'epigraph' || sec.kind === 'also-by';
      hasHeading = !display || sec.kind === 'also-by';
      const labelled = hasHeading ? ` aria-labelledby="${hid}"` : ` aria-label="${escapeXml(navTitle)}"`;
      add(`<section class="${sec.kind}${sec.zone === 'body' ? ' body' : ''}"${sectionAttrs}${labelled}>`);
      if (hasHeading) {
        const label = sec.label ? `<span class="label">${escapeXmlText(sec.label)}</span> ` : '';
        const title = sec.title ? `<span class="title">${escapeXmlText(sec.title)}</span>` : '';
        add(`<h1 id="${hid}">${label}${title}</h1>`);
        if (sec.subtitle) add(`<p class="subtitle">${escapeXmlText(sec.subtitle)}</p>`);
      }
      if (sec.kind === 'also-by') {
        const groups = (sec.data.groups ?? []) as { label: string; titles: string[] }[];
        for (const g of groups) {
          if (g.label) add(`<p class="alsoby-group">${escapeXmlText(g.label)}</p>`);
          add(`<ul class="alsoby">${g.titles.map((x) => `<li><em>${escapeXmlText(x)}</em></li>`).join('')}</ul>`);
        }
      } else {
        const opening =
          sec.zone === 'body' && sec.kind !== 'part'
            ? {
                dropCap: design.chapterOpener.dropCap.enabled && format.ebook.dropCaps,
                leadInWords: design.chapterOpener.leadIn === 'none' ? 0 : design.chapterOpener.leadInWords,
              }
            : undefined;
        const rendered = renderBlocks(sec.blocks, ctx, opening);
        for (const l of rendered.lines) {
          const origin = sec.origins.find((o) => l.blockIndex >= o.from && l.blockIndex < o.to);
          add(l.html, { nodeId: origin?.nodeId, nodeTitle: origin?.title, srcLine: l.srcLine });
        }
        if (sec.kind === 'epigraph' && typeof sec.data.source === 'string' && sec.data.source) {
          add(`<p class="epigraph-source">${escapeXmlText(sec.data.source)}</p>`);
        }
        if (ctx.notes.length) {
          noteCount += ctx.notes.length;
          add(`<section class="notes" epub:type="footnotes" role="doc-endnotes" aria-label="${escapeXml(strings.notes)}">`);
          add('<hr class="notes-rule"/>');
          for (const n of ctx.notes) add(n.html);
          add('</section>');
        }
      }
      add('</section>');
    }
    if (ctx.hasImages) anyImages = true;
    missingAlt.push(...ctx.missingAlt);
    for (const a of ctx.indexAnchors) indexAnchors.push({ ...a, file, label: sec.tocLabel || sec.title || navTitle });

    const bodyAttrs = ` epub:type="${ZONE_TYPE[sec.zone]}"`;
    const content = xhtmlDoc(lang, navTitle || book.title, bodyAttrs, lines);
    const path = `OEBPS/${file}`;
    files.push({ path, content });
    // The document preamble occupies nine lines before the first body line.
    const offset = 9;
    map.push({
      path,
      sectionId: sec.id,
      title: navTitle,
      lines: lineSrc.map((src, i) => ({ line: offset + i + 1, ...src })).filter((l) => l.nodeId),
    });
    built.push({
      section: sec, file, id: slug, title: sec.title, navTitle, headings: ctx.headings,
      inNav: sec.toc || sec.kind === 'title-page',
      level: sec.kind === 'part' ? 0 : 1,
    });
  }

  // Ebook index: each term links to the places it was tagged.
  if (indexSection) {
    const { sec, file, seq: n } = indexSection;
    const hid = `s${n}-h`;
    type Anchors = typeof indexAnchors;
    const byTerm = new Map<string, { main: Anchors; subs: Map<string, Anchors> }>();
    for (const a of indexAnchors) {
      const e = byTerm.get(a.term) ?? { main: [] as Anchors, subs: new Map<string, Anchors>() };
      if (a.sub) e.subs.set(a.sub, [...(e.subs.get(a.sub) ?? []), a]);
      else e.main.push(a);
      byTerm.set(a.term, e);
    }
    const links = (list: Anchors) =>
      list.map((a, i) => `<a href="../${a.file}#${a.id}">${escapeXmlText(a.label || String(i + 1))}</a>`).join(', ');
    const lines: string[] = [];
    lines.push(`<section class="index" epub:type="index" role="doc-index" aria-labelledby="${hid}">`);
    lines.push(`<h1 id="${hid}"><span class="title">${escapeXmlText(sec.title)}</span></h1>`);
    lines.push('<ul class="index-list">');
    for (const term of [...byTerm.keys()].sort((a, b) => a.localeCompare(b, lang, { sensitivity: 'base' }))) {
      const e = byTerm.get(term)!;
      let li = `<li>${escapeXmlText(term)}${e.main.length ? ', ' + links(e.main) : ''}`;
      if (e.subs.size) {
        li += '<ul>';
        for (const sub of [...e.subs.keys()].sort((a, b) => a.localeCompare(b, lang, { sensitivity: 'base' }))) {
          li += `<li>${escapeXmlText(sub)}, ${links(e.subs.get(sub)!)}</li>`;
        }
        li += '</ul>';
      }
      lines.push(li + '</li>');
    }
    lines.push('</ul>');
    lines.push('</section>');
    files.push({ path: `OEBPS/${file}`, content: xhtmlDoc(lang, sec.title, ' epub:type="backmatter"', lines) });
  }

  /* ---------------------------------------------------------------- */
  /* Navigation                                                        */
  /* ---------------------------------------------------------------- */

  const tocDepth = design.toc.depth;
  const navItems = built.filter((b) => b.inNav && b.section.kind !== 'title-page');
  const navLines: string[] = [];
  const hid = 'nav-h';
  // The navigation document has a strict content model: no ARIA attributes on the nav element itself.
  navLines.push('<nav epub:type="toc" id="toc">');
  navLines.push(`<h1 id="${hid}">${escapeXmlText(strings.contents)}</h1>`);
  navLines.push('<ol>');
  let openPart = false;
  for (const b of navItems) {
    const href = `${b.file}`;
    const sub =
      tocDepth > 1 && b.headings.some((h) => h.level < tocDepth)
        ? `<ol>${b.headings
            .filter((h) => h.level < tocDepth)
            .map((h) => `<li><a href="${href}#${escapeXml(h.id)}">${escapeXmlText(h.text)}</a></li>`)
            .join('')}</ol>`
        : '';
    if (b.level === 0) {
      if (openPart) navLines.push('</ol></li>');
      navLines.push(`<li><a href="${href}">${escapeXmlText(b.navTitle)}</a><ol>`);
      openPart = true;
    } else if (b.section.zone !== 'body' && openPart) {
      navLines.push('</ol></li>');
      openPart = false;
      navLines.push(`<li><a href="${href}">${escapeXmlText(b.navTitle)}</a>${sub}</li>`);
    } else {
      navLines.push(`<li><a href="${href}">${escapeXmlText(b.navTitle)}</a>${sub}</li>`);
    }
  }
  if (openPart) navLines.push('</ol></li>');
  navLines.push('</ol>');
  navLines.push('</nav>');
  const firstBody = built.find((b) => b.section.zone === 'body');
  const titlePage = built.find((b) => b.section.kind === 'title-page');
  const copyrightPage = built.find((b) => b.section.kind === 'copyright');
  navLines.push('<nav epub:type="landmarks" id="landmarks" hidden="hidden">');
  navLines.push('<h2>Guide</h2>');
  navLines.push('<ol>');
  if (opts.cover && opts.coverPage) navLines.push('<li><a epub:type="cover" href="text/cover.xhtml">Cover</a></li>');
  if (titlePage) navLines.push(`<li><a epub:type="titlepage" href="${titlePage.file}">Title page</a></li>`);
  navLines.push(`<li><a epub:type="toc" href="nav.xhtml#toc">${escapeXmlText(strings.contents)}</a></li>`);
  if (copyrightPage) navLines.push(`<li><a epub:type="copyright-page" href="${copyrightPage.file}">Copyright</a></li>`);
  if (firstBody) navLines.push(`<li><a epub:type="bodymatter" href="${firstBody.file}">Start of the book</a></li>`);
  navLines.push('</ol>');
  navLines.push('</nav>');
  const navDoc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">`,
    '<head>',
    '<meta charset="utf-8"/>',
    `<title>${escapeXmlText(strings.contents)}</title>`,
    '<link rel="stylesheet" type="text/css" href="css/book.css"/>',
    '</head>',
    '<body epub:type="frontmatter">',
    ...navLines,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  files.push({ path: 'OEBPS/nav.xhtml', content: navDoc });

  /* ---------------------------------------------------------------- */
  /* Package document                                                  */
  /* ---------------------------------------------------------------- */

  const isbn = validateIsbn(format.isbn);
  const uuid = opts.fallbackUuid ?? 'urn:uuid:' + book.id;
  const identifier = isbn.valid ? `urn:isbn:${cleanIsbn(isbn.isbn13!)}` : uuid.startsWith('urn:') ? uuid : `urn:uuid:${uuid}`;
  if (!isbn.valid) {
    warnings.push({ severity: 'warn', code: 'no-isbn', message: 'This ebook has no ISBN yet, so a random identifier was used. Assign an ISBN before publishing.' });
  }
  const modified = (opts.modified ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z');
  const authors = book.contributors.filter((c) => c.role === 'author');
  const others = book.contributors.filter((c) => c.role !== 'author');
  const MARC: Record<string, string> = { editor: 'edt', illustrator: 'ill', translator: 'trl', foreword: 'aui', photographer: 'pht', narrator: 'nrt' };

  const meta: string[] = [];
  meta.push(`<dc:identifier id="pub-id">${escapeXmlText(identifier)}</dc:identifier>`);
  meta.push(`<dc:title id="title">${escapeXmlText(book.title)}</dc:title>`);
  meta.push('<meta refines="#title" property="title-type">main</meta>');
  if (book.subtitle) {
    meta.push(`<dc:title id="subtitle">${escapeXmlText(book.subtitle)}</dc:title>`);
    meta.push('<meta refines="#subtitle" property="title-type">subtitle</meta>');
  }
  authors.forEach((a, i) => {
    meta.push(`<dc:creator id="creator${i + 1}">${escapeXmlText(a.name)}</dc:creator>`);
    meta.push(`<meta refines="#creator${i + 1}" property="role" scheme="marc:relators">aut</meta>`);
    if (a.sortName) meta.push(`<meta refines="#creator${i + 1}" property="file-as">${escapeXmlText(a.sortName)}</meta>`);
  });
  others.forEach((c, i) => {
    meta.push(`<dc:contributor id="contrib${i + 1}">${escapeXmlText(c.name)}</dc:contributor>`);
    if (MARC[c.role]) meta.push(`<meta refines="#contrib${i + 1}" property="role" scheme="marc:relators">${MARC[c.role]}</meta>`);
  });
  meta.push(`<dc:language>${escapeXmlText(lang)}</dc:language>`);
  meta.push(`<dc:publisher>${escapeXmlText(book.imprint)}</dc:publisher>`);
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(book.publicationDate)) meta.push(`<dc:date>${book.publicationDate}</dc:date>`);
  const holder = book.copyright.holder || primaryAuthor(book);
  meta.push(`<dc:rights>${escapeXmlText(`Copyright © ${book.copyright.year} ${holder}. All rights reserved.`)}</dc:rights>`);
  if (opts.description) meta.push(`<dc:description>${escapeXmlText(opts.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}</dc:description>`);
  for (const s of opts.subjects ?? []) meta.push(`<dc:subject>${escapeXmlText(s)}</dc:subject>`);
  if (book.series) {
    meta.push(`<meta property="belongs-to-collection" id="series">${escapeXmlText(book.series.name)}</meta>`);
    meta.push('<meta refines="#series" property="collection-type">series</meta>');
    if (book.series.number !== null) meta.push(`<meta refines="#series" property="group-position">${book.series.number}</meta>`);
  }
  meta.push(`<meta property="dcterms:modified">${modified}</meta>`);
  // Accessibility metadata (schema.org vocabulary, as recommended by EPUB Accessibility 1.1).
  meta.push('<meta property="schema:accessMode">textual</meta>');
  if (anyImages || opts.cover) meta.push('<meta property="schema:accessMode">visual</meta>');
  if (!anyImages || missingAlt.length === 0) meta.push('<meta property="schema:accessModeSufficient">textual</meta>');
  for (const f of ['structuralNavigation', 'tableOfContents', 'readingOrder', 'displayTransformability']) {
    meta.push(`<meta property="schema:accessibilityFeature">${f}</meta>`);
  }
  if (anyImages && missingAlt.length === 0) meta.push('<meta property="schema:accessibilityFeature">alternativeText</meta>');
  meta.push('<meta property="schema:accessibilityHazard">none</meta>');
  const summary =
    `This publication has a navigable table of contents, a logical reading order and text that can be resized and restyled by the reader.` +
    (anyImages ? (missingAlt.length === 0 ? ' All images have text descriptions.' : ' Some images do not have text descriptions.') : ' It contains no images apart from the cover.');
  meta.push(`<meta property="schema:accessibilitySummary">${escapeXmlText(summary)}</meta>`);
  if (opts.cover) meta.push('<meta name="cover" content="cover-image"/>');
  meta.push(`<meta name="generator" content="${escapeXml(opts.generator ?? 'Borderless Studio')}"/>`);
  if (missingAlt.length) {
    warnings.push({
      severity: 'warn', code: 'alt-text',
      message: `${missingAlt.length} picture${missingAlt.length === 1 ? ' has' : 's have'} no description (alt text). Add one in the image brackets, for example ![A map of the river](images/map.png), so screen reader users know what it shows.`,
    });
  }

  const manifest: string[] = [];
  const spine: string[] = [];
  const spineOut: { path: string; title: string }[] = [];
  manifest.push('<item id="css" href="css/book.css" media-type="text/css"/>');
  manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  const zip: Zippable = {};
  // The mimetype entry must be first and stored without compression.
  zip['mimetype'] = [utf8('application/epub+zip'), { level: 0 }];
  zip['META-INF/container.xml'] = utf8(
    '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n<rootfiles>\n<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n</rootfiles>\n</container>\n',
  );

  if (opts.cover) {
    const ext = opts.cover.mediaType === 'image/png' ? 'png' : 'jpg';
    manifest.push(`<item id="cover-image" href="images/cover.${ext}" media-type="${opts.cover.mediaType}" properties="cover-image"/>`);
    zip[`OEBPS/images/cover.${ext}`] = [opts.cover.data, { level: 0 }];
    if (opts.coverPage) {
      const coverDoc = xhtmlDoc(lang, 'Cover', ' epub:type="frontmatter"', [
        '<section class="cover" epub:type="cover" aria-label="Cover">',
        `<img src="../images/cover.${ext}" alt="${escapeXml(`Cover of ${book.title}`)}"/>`,
        '</section>',
      ]);
      files.unshift({ path: 'OEBPS/text/cover.xhtml', content: coverDoc });
      manifest.push('<item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="cover-page"/>');
      spineOut.push({ path: 'OEBPS/text/cover.xhtml', title: 'Cover' });
    }
  }

  let navPlaced = false;
  const placeNav = () => {
    if (navPlaced) return;
    navPlaced = true;
    spine.push(format.ebook.inlineToc ? '<itemref idref="nav"/>' : '<itemref idref="nav" linear="no"/>');
    spineOut.push({ path: 'OEBPS/nav.xhtml', title: strings.contents });
  };
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  for (const b of built) {
    // The contents page sits after the front matter display pages, before the first real text.
    if (!navPlaced && !['title-page', 'copyright', 'dedication', 'epigraph', 'also-by'].includes(b.section.kind)) placeNav();
    manifest.push(`<item id="${b.id}" href="${b.file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${b.id}"/>`);
    spineOut.push({ path: `OEBPS/${b.file}`, title: b.navTitle });
  }
  placeNav();
  for (const [, e] of imageFiles) {
    const svg = e.img.mediaType === 'image/svg+xml';
    manifest.push(`<item id="${e.id}" href="${e.href}" media-type="${e.img.mediaType}"/>`);
    zip[`OEBPS/${e.href}`] = svg ? e.img.data : [e.img.data, { level: 0 }];
  }
  const fonts = opts.fonts ?? [];
  fonts.forEach((f, i) => {
    const type = f.fileName.toLowerCase().endsWith('.otf') ? 'font/otf' : f.fileName.toLowerCase().endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
    manifest.push(`<item id="font${i + 1}" href="fonts/${escapeXml(f.fileName)}" media-type="${type}"/>`);
    zip[`OEBPS/fonts/${f.fileName}`] = f.data;
  });

  const opf = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(lang)}" prefix="schema: http://schema.org/">`,
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    ...meta,
    '</metadata>',
    '<manifest>',
    ...manifest,
    '</manifest>',
    '<spine toc="ncx">',
    ...spine,
    '</spine>',
    '</package>',
    '',
  ].join('\n');
  files.push({ path: 'OEBPS/content.opf', content: opf });

  // NCX for older reading systems (flat list is enough there).
  const ncxPoints = navItems
    .map(
      (b, i) =>
        `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXmlText(b.navTitle)}</text></navLabel><content src="${b.file}"/></navPoint>`,
    )
    .join('\n');
  const ncx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(lang)}">`,
    '<head>',
    `<meta name="dtb:uid" content="${escapeXml(identifier)}"/>`,
    '<meta name="dtb:depth" content="1"/>',
    '<meta name="dtb:totalPageCount" content="0"/>',
    '<meta name="dtb:maxPageNumber" content="0"/>',
    '</head>',
    `<docTitle><text>${escapeXmlText(book.title)}</text></docTitle>`,
    '<navMap>',
    ncxPoints,
    '</navMap>',
    '</ncx>',
    '',
  ].join('\n');
  files.push({ path: 'OEBPS/toc.ncx', content: ncx });

  const css = fontFaceCss(fonts) + EPUB_CSS({ design, lang: baseLanguage(lang), embedded: fonts.length > 0 ? fonts[0].family : null });
  files.push({ path: 'OEBPS/css/book.css', content: css });

  for (const f of files) zip[f.path] = utf8(f.content);
  const bytes = zipSync(zip, { level: 9 });
  void noteCount;
  void seriesLine;
  return { bytes, files, map, spine: spineOut, warnings, identifier };
}
