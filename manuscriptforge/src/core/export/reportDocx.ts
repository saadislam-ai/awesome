import { strToU8, zipSync } from 'fflate';
import type { Report, ReportBlock } from '../analysis/report';
import { escapeXml } from './common';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const run = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const para = (inner: string, style = '', extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${inner}</w:p>`;

function table(head: string[] | null, rows: string[][], widths: number[]): string {
  const total = widths.reduce((a, b) => a + b, 0);
  const twips = widths.map((w) => Math.round((w / total) * 9000));
  const cell = (text: string, width: number, bold: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${para(run(text, bold ? '<w:b/>' : ''), 'TableText')}</w:tc>`;
  const row = (cells: string[], bold: boolean) => `<w:tr>${cells.map((c, i) => cell(c ?? '', twips[i] ?? twips[twips.length - 1], bold)).join('')}</w:tr>`;
  const borders = head
    ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="BBBBBB"/><w:bottom w:val="single" w:sz="4" w:color="BBBBBB"/><w:insideH w:val="single" w:sz="4" w:color="DDDDDD"/></w:tblBorders>'
    : '';
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${twips.map((t) => `<w:gridCol w:w="${t}"/>`).join('')}</w:tblGrid>${head ? row(head, true) : ''}${rows.map((r) => row(r, false)).join('')}</w:tbl>${para('')}`;
}

function block(b: ReportBlock, lists: { id: number; ordered: boolean }[]): string {
  switch (b.kind) {
    case 'p':
      return para(run(b.text, b.muted ? '<w:color w:val="666666"/><w:sz w:val="18"/>' : ''));
    case 'bullets':
    case 'numbered': {
      const id = lists.length + 1;
      lists.push({ id, ordered: b.kind === 'numbered' });
      return b.items.map((item) => para(run(item), 'ListParagraph', `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)).join('');
    }
    case 'facts':
      return table(null, b.rows, [3, 7]);
    case 'table':
      return table(b.head, b.rows, b.widths ?? b.head.map(() => 1));
    case 'chart': {
      // Word reports carry the chart's numbers as a table rather than a picture.
      const pairs = b.chart.labels.map((label, i) => [label, b.chart.values[i] === null ? '' : `${b.chart.values[i]}${b.chart.unit ?? ''}`]);
      return para(run(b.chart.title, '<w:b/>')) + table(['Chapter', 'Value'], pairs, [2, 8]);
    }
  }
}

/** The analysis report as a Word document, so it can be edited and sent to an author. */
export function exportReportDocx(report: Report): Uint8Array {
  const lists: { id: number; ordered: boolean }[] = [];
  let body = para(run(report.title), 'Title') + para(run(report.subtitle, '<w:color w:val="666666"/>'));
  for (const section of report.sections) {
    body += para(run(section.heading), 'Heading1');
    // Several charts in a row would repeat the chapter list each time: keep the first two.
    let charts = 0;
    for (const b of section.blocks) {
      if (b.kind === 'chart' && ++charts > 2) continue;
      body += block(b, lists);
    }
  }
  const level = (format: string, text: string) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="540" w:hanging="300"/></w:pPr></w:lvl>`;
  const files: Record<string, string> = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
    'word/document.xml': `${XML}<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="700" w:footer="700" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
</w:styles>`,
    'word/numbering.xml': `${XML}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level('bullet', '•')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level('decimal', '%1.')}</w:abstractNum>${lists
      .map((l) => `<w:num w:numId="${l.id}"><w:abstractNumId w:val="${l.ordered ? 1 : 0}"/>${l.ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`)
      .join('')}</w:numbering>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}
