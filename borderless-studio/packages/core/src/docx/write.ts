/**
 * Writing Word files (.docx) from the assembled book, without Word or
 * Pandoc. A .docx file is a zip of XML parts; this writes the handful of
 * parts a manuscript needs.
 *
 * Two layouts:
 *
 *   manuscript  the standard submission format agents and editors expect:
 *               12 pt Times New Roman, double spaced, one inch margins, a
 *               header with surname, title and page number, a title page
 *               with the word count, each chapter starting on a new page.
 *   retail      a clean file for stores that convert Word files themselves
 *               (Draft2Digital): chapter titles as "Heading 1", single
 *               spaced text, no header.
 */
import { strToU8, zipSync } from 'fflate';
import type { AssembledBook, AssembledSection } from '../build/assemble';
import { imageInfo } from '../image/info';
import type { Block, Inline } from '../markdown/ir';
import { inlineText } from '../markdown/ir';
import { authorsLine } from '../model/book';

export type DocxLayout = 'manuscript' | 'retail';

export interface DocxOptions {
  layout: DocxLayout;
  /** Pictures by their path in the manuscript. Missing ones become a bracketed note. */
  images?: Map<string, Uint8Array>;
  /** Contact lines for the manuscript title page (name, address, email). */
  contact?: string[];
  /** Fixed time for reproducible output. */
  date?: Date;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Ctx {
  layout: DocxLayout;
  footnotes: string[];
  images: { rid: string; name: string; data: Uint8Array }[];
  source: Map<string, Uint8Array>;
  links: { rid: string; href: string }[];
  nextRid: number;
}

interface RunFormat { i?: boolean; b?: boolean; sc?: boolean; sup?: boolean; sub?: boolean; code?: boolean }

function rPr(f: RunFormat): string {
  const parts = [f.b ? '<w:b/>' : '', f.i ? '<w:i/>' : '', f.sc ? '<w:smallCaps/>' : '', f.sup ? '<w:vertAlign w:val="superscript"/>' : '', f.sub ? '<w:vertAlign w:val="subscript"/>' : '', f.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ''].join('');
  return parts ? `<w:rPr>${parts}</w:rPr>` : '';
}

const textRun = (text: string, f: RunFormat = {}): string => (text ? `<w:r>${rPr(f)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : '');

function runs(inlines: Inline[], ctx: Ctx, f: RunFormat = {}): string {
  let out = '';
  for (const n of inlines) {
    switch (n.t) {
      case 'text': out += textRun(n.v, f); break;
      case 'em': out += runs(n.c, ctx, { ...f, i: !f.i }); break;
      case 'strong': out += runs(n.c, ctx, { ...f, b: true }); break;
      case 'sc': out += runs(n.c, ctx, { ...f, sc: true }); break;
      case 'sup': out += runs(n.c, ctx, { ...f, sup: true }); break;
      case 'sub': out += runs(n.c, ctx, { ...f, sub: true }); break;
      case 'mark': out += runs(n.c, ctx, f); break;
      case 'code': out += textRun(n.v, { ...f, code: true }); break;
      case 'br': out += '<w:r><w:br/></w:r>'; break;
      case 'link': {
        const rid = `rId${ctx.nextRid++}`;
        ctx.links.push({ rid, href: n.href });
        out += `<w:hyperlink r:id="${rid}">${runs(n.c, ctx, f)}</w:hyperlink>`;
        break;
      }
      case 'fn': {
        const id = ctx.footnotes.length + 1;
        const body = n.c.map((b) => (b.t === 'p' ? `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${b === n.c[0] ? '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' : ''}${runs(b.c, ctx)}</w:p>` : '')).join('');
        ctx.footnotes.push(`<w:footnote w:id="${id}">${body || '<w:p/>'}</w:footnote>`);
        out += `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
        break;
      }
      case 'img': out += textRun(`[${n.alt || 'picture'}]`, f); break;
      default: break;
    }
  }
  return out;
}

const para = (style: string, inner: string, extra = ''): string => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function picture(src: string, alt: string, ctx: Ctx): string | null {
  const data = ctx.source.get(src);
  if (!data) return null;
  const info = imageInfo(data);
  if ((info.format !== 'png' && info.format !== 'jpeg') || !info.width) return null;
  const rid = `rId${ctx.nextRid++}`;
  const name = `image${ctx.images.length + 1}.${info.format === 'png' ? 'png' : 'jpg'}`;
  ctx.images.push({ rid, name, data });
  // Fit inside the text width (6 in), keeping the proportions. Word measures in EMU: 914,400 to the inch.
  const widthIn = Math.min(6, info.width / 150);
  const cx = Math.round(widthIn * 914400);
  const cy = Math.round((cx * info.height) / info.width);
  const id = ctx.images.length;
  return (
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}" descr="${esc(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

function blocks(list: Block[], ctx: Ctx, style = 'Body'): string {
  let out = '';
  let first = true;
  for (const b of list) {
    switch (b.t) {
      case 'p':
        // The first paragraph after a heading or a break is set flush left, as in a printed book.
        out += para(first && style === 'Body' ? 'BodyFirst' : style, runs(b.c, ctx));
        first = false;
        continue;
      case 'h': out += para(`Heading${Math.min(3, b.level + 1)}`, runs(b.c, ctx)); break;
      case 'scenebreak': out += para('SceneBreak', textRun(ctx.layout === 'manuscript' ? '#' : '* * *')); break;
      case 'quote': out += blocks(b.c, ctx, 'Quote'); break;
      case 'callout': out += (b.title ? para('Quote', runs(b.title, ctx, { b: true })) : '') + blocks(b.c, ctx, 'Quote'); break;
      case 'align': out += blocks(b.c, ctx, b.align === 'center' ? 'Centered' : 'RightAligned'); break;
      case 'list':
        b.items.forEach((item, i) => {
          const label = b.ordered ? `${b.start + i}.\t` : '•\t';
          item.forEach((x, k) => {
            if (x.t === 'p') out += para('ListItem', (k === 0 ? textRun(label) : '') + runs(x.c, ctx));
            else out += blocks([x], ctx, 'ListItem');
          });
        });
        break;
      case 'verse':
        for (const stanza of b.stanzas) out += para('Verse', stanza.map((line) => runs(line, ctx)).join('<w:r><w:br/></w:r>'));
        break;
      case 'figure': {
        const pic = picture(b.src, b.alt, ctx);
        out += pic ?? para('Centered', textRun(`[Picture: ${b.alt || b.src}]`, { i: true }));
        if (b.caption) out += para('Caption', runs(b.caption, ctx));
        break;
      }
      case 'table': {
        const cell = (c: Inline[], head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para('TableCell', runs(c, ctx, head ? { b: true } : {}))}</w:tc>`;
        const row = (cells: Inline[][], head: boolean) => `<w:tr>${cells.map((c) => cell(c, head)).join('')}</w:tr>`;
        out += `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>${row(b.head, true)}${b.rows.map((r) => row(r, false)).join('')}</w:tbl>`;
        if (b.caption) out += para('Caption', runs(b.caption, ctx));
        break;
      }
      case 'code': out += para('Quote', textRun(b.v, { code: true })); break;
      case 'pagebreak': out += pageBreak; break;
      default: break;
    }
    first = true;
  }
  return out;
}

function sectionXml(sec: AssembledSection, ctx: Ctx, isFirst: boolean): string {
  let out = isFirst ? '' : pageBreak;
  const heading = [sec.label, sec.title].filter(Boolean);
  if (sec.kind === 'part') {
    return out + para('PartTitle', textRun(heading.join(': ')));
  }
  if (['half-title', 'title-page', 'toc', 'index'].includes(sec.kind)) return '';
  if (heading.length && !['dedication', 'epigraph', 'copyright'].includes(sec.kind)) {
    // Stores that convert Word files find chapters by the "Heading 1" style.
    out += para('Heading1', sec.label && sec.title ? `${textRun(sec.label)}<w:r><w:br/></w:r>${textRun(sec.title)}` : textRun(heading[0]));
    if (sec.subtitle) out += para('Centered', textRun(sec.subtitle, { i: true }));
  }
  out += blocks(sec.blocks, ctx, ['dedication', 'epigraph'].includes(sec.kind) ? 'Centered' : sec.kind === 'copyright' ? 'Small' : 'Body');
  // Where an epigraph comes from, on a line of its own under the quotation.
  if (sec.kind === 'epigraph' && typeof sec.data.source === 'string' && sec.data.source) out += para('RightAligned', textRun(sec.data.source));
  return out;
}

function stylesXml(layout: DocxLayout): string {
  const ms = layout === 'manuscript';
  const font = 'Times New Roman';
  const line = ms ? 480 : 300; // 240 is single spacing
  const style = (id: string, name: string, pPr: string, rPrXml = '', based = 'Normal') =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:qFormat/><w:pPr>${pPr}</w:pPr>${rPrXml ? `<w:rPr>${rPrXml}</w:rPr>` : ''}</w:style>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    style('Body', 'Body Text', '<w:ind w:firstLine="720"/>') +
    style('BodyFirst', 'Body Text First', '<w:ind w:firstLine="0"/>', '', 'Body') +
    style('Heading1', 'heading 1', `<w:keepNext/><w:spacing w:before="${ms ? 2400 : 480}" w:after="${ms ? 480 : 360}"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>`, ms ? '' : '<w:b/><w:sz w:val="32"/>') +
    style('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="1"/>', '<w:b/>') +
    style('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/>', '<w:i/>') +
    style('PartTitle', 'Part Title', '<w:spacing w:before="3600" w:after="480"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>', '<w:caps/>') +
    style('SceneBreak', 'Scene Break', `<w:spacing w:before="${ms ? 0 : 240}" w:after="${ms ? 0 : 240}"/><w:jc w:val="center"/>`) +
    style('Quote', 'Quote', '<w:ind w:left="720" w:right="720"/>') +
    style('Centered', 'Centered', '<w:jc w:val="center"/>') +
    style('RightAligned', 'Right Aligned', '<w:jc w:val="right"/>') +
    style('ListItem', 'List Item', '<w:ind w:left="720" w:hanging="360"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>') +
    style('Verse', 'Verse', '<w:ind w:left="720"/><w:spacing w:after="240"/>') +
    style('Caption', 'caption', '<w:jc w:val="center"/><w:spacing w:after="240"/>', '<w:i/><w:sz w:val="20"/>') +
    style('Small', 'Small Text', '<w:spacing w:after="120" w:line="276" w:lineRule="auto"/>', '<w:sz w:val="20"/>') +
    style('TableCell', 'Table Cell', '<w:spacing w:line="276" w:lineRule="auto"/>') +
    style('FootnoteText', 'footnote text', '<w:spacing w:line="240" w:lineRule="auto"/>', '<w:sz w:val="20"/>') +
    style('Header', 'header', '<w:jc w:val="right"/><w:spacing w:line="240" w:lineRule="auto"/>') +
    style('TitleLine', 'Title Line', '<w:jc w:val="center"/>') +
    '</w:styles>'
  );
}

export interface DocxResult {
  bytes: Uint8Array;
  /** Pictures that could not be embedded (a note stands in their place). */
  missingImages: string[];
  footnotes: number;
}

/** Round a word count the way manuscripts state it: to the nearest hundred below 10,000, nearest thousand above. */
export function roundedWordCount(words: number): number {
  return words < 10000 ? Math.round(words / 100) * 100 : Math.round(words / 1000) * 1000;
}

export function buildDocx(book: AssembledBook, opts: DocxOptions): DocxResult {
  const ctx: Ctx = { layout: opts.layout, footnotes: [], images: [], source: opts.images ?? new Map(), links: [], nextRid: 10 };
  const b = book.book;
  const ms = opts.layout === 'manuscript';
  const author = authorsLine(b);
  const first = b.contributors.find((c) => c.role === 'author') ?? b.contributors[0];
  const surname = (first?.sortName.split(',')[0] || author.split(' ').pop() || '').trim();
  const title = b.subtitle ? `${b.title}: ${b.subtitle}` : b.title;
  let body = '';

  // Title page
  if (ms) {
    const contact = opts.contact?.length ? opts.contact : [author];
    body += contact.map((l, i) => `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>${textRun(l)}${i === 0 ? `<w:r><w:tab/></w:r>${textRun(`about ${roundedWordCount(book.stats.words).toLocaleString('en-AU')} words`)}` : ''}</w:p>`).join('');
    body += para('TitleLine', textRun(b.title.toUpperCase()), '<w:spacing w:before="4800"/>');
    if (b.subtitle) body += para('TitleLine', textRun(b.subtitle));
    body += para('TitleLine', textRun(`by ${author}`), '<w:spacing w:before="480"/>');
  } else {
    body += para('TitleLine', textRun(b.title, { b: true }), '<w:spacing w:before="2400"/>');
    if (b.subtitle) body += para('TitleLine', textRun(b.subtitle, { i: true }));
    body += para('TitleLine', textRun(author), '<w:spacing w:before="480"/>');
  }
  const missing: string[] = [];
  for (const src of book.stats.images) if (!ctx.source.has(src)) missing.push(src);
  // The manuscript format carries the text only: front matter that is generated for print is left out.
  const skip = ms ? new Set(['half-title', 'title-page', 'copyright', 'toc', 'also-by', 'index']) : new Set(['half-title', 'title-page', 'toc', 'index']);
  // "THE END" closes the story, so it goes after the last chapter and before any back matter.
  const included = book.sections.filter((sec) => !skip.has(sec.kind));
  const lastOfStory = included.reduce((last, sec, i) => (sec.zone === 'body' ? i : last), -1);
  const theEnd = para('Centered', textRun('THE END'), '<w:spacing w:before="480"/>');
  included.forEach((sec, i) => {
    body += sectionXml(sec, ctx, false);
    if (ms && i === lastOfStory) body += theEnd;
  });
  if (ms && lastOfStory < 0) body += theEnd;

  const sectPr =
    `<w:sectPr>${ms ? '<w:headerReference w:type="default" r:id="rId3"/><w:titlePg/>' : ''}<w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr>` +
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sectPr}</w:body></w:document>`;
  const footnotes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}>` +
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
    `${ctx.footnotes.join('')}</w:footnotes>`;
  const header =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${textRun(`${surname} / ${b.title.toUpperCase()} / `)}` +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' +
    (ms ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : '') +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    ctx.images.map((i) => `<Relationship Id="${i.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${i.name}"/>`).join('') +
    ctx.links.map((l) => `<Relationship Id="${l.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.href)}" TargetMode="External"/>`).join('') +
    '</Relationships>';
  const when = (opts.date ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        (ms ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    ),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${esc(b.language)}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified></cp:coreProperties>`,
    ),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(stylesXml(opts.layout)),
    'word/footnotes.xml': strToU8(footnotes),
    'word/settings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:themeFontLang w:val="${esc(b.language)}"/></w:settings>`),
    'word/_rels/document.xml.rels': strToU8(rels),
  };
  if (ms) files['word/header1.xml'] = strToU8(header);
  for (const img of ctx.images) files[`word/media/${img.name}`] = img.data;
  void inlineText;
  return { bytes: zipSync(files, { level: 6 }), missingImages: missing, footnotes: ctx.footnotes.length };
}
