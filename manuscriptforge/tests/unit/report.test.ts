import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyBible } from '../../src/core/analysis/bible';
import { chartSvg, layoutChart, niceTicks } from '../../src/core/analysis/charts';
import { normaliseSynthesis } from '../../src/core/analysis/deep';
import { buildCharts, buildReport, type ReportInput } from '../../src/core/analysis/report';
import { findIssues } from '../../src/core/analysis/rules';
import { computeStats } from '../../src/core/analysis/stats';
import { manuscriptPdfDefinition, renderPdf, reportPdfDefinition, unsupportedScript, type PdfFonts } from '../../src/core/export/pdf';
import { exportReportDocx } from '../../src/core/export/reportDocx';
import { detectChapters, importManuscript } from '../../src/core/import';
import { blockText, paragraph } from '../../src/core/model/blocks';
import { importFixture, loadPdfForTests } from './helpers';

const font = (name: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'node_modules', 'dejavu-fonts-ttf', 'ttf', name)));
const FONTS: PdfFonts = { normal: font('DejaVuSerif.ttf'), bold: font('DejaVuSerif-Bold.ttf'), italics: font('DejaVuSerif-Italic.ttf'), bolditalics: font('DejaVuSerif-BoldItalic.ttf') };

function hasTool(tool: string): boolean {
  try {
    execFileSync(tool, ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_PDFTOTEXT = hasTool('pdftotext');

async function novel() {
  const result = await importFixture('novel.docx');
  const chapters = detectChapters(result.blocks, 'auto', result.meta).chapters.map((c, i) => ({ id: `c${i}`, title: c.title, blocks: c.blocks }));
  return { title: result.meta.title!, author: result.meta.author!, language: 'en', chapters };
}

async function reportInput(deep: boolean): Promise<ReportInput> {
  const book = await novel();
  const input = { language: 'en', bookType: 'fiction' as const, chapters: book.chapters };
  const stats = computeStats(input);
  const issues = [
    ...findIssues(input, stats),
    { category: 'plot-hole' as const, severity: 'high' as const, chapterId: null, blockIndex: null, quote: '', title: 'Plot hole across the book', detail: 'Who sent the letter is never hinted.', suggestion: 'Plant a clue.', source: 'ai' as const },
    { category: 'show-tell' as const, severity: 'medium' as const, chapterId: 'c2', blockIndex: 2, quote: 'It is not for sale', title: 'Telling instead of showing', detail: 'Stated flatly.', suggestion: 'Show it.', source: 'ai' as const, status: 'dismissed' },
  ];
  const bible = emptyBible();
  bible.characters = [{ name: 'Mara Ellison', aliases: ['Mara'], role: 'main', description: 'Heir to the lighthouse.', arc: 'Accepts her inheritance.', mentions: 3, firstChapter: 2 }];
  bible.settings = [{ name: 'Marrow Point', description: 'A village with a dark lighthouse.' }];
  bible.glossary = [{ term: 'Corriveau', meaning: "the grandfather's lost ship" }];
  bible.voice = { numbers: stats.voice, description: 'Plain, measured sentences.', dialogueStyle: 'Dry.', devices: ['lists of three'] };
  const synthesis = normaliseSynthesis(
    {
      summary: 'A woman lights a lamp for a ship lost long ago.', structure: { parts: [{ name: 'Setup', chapters: '1-2', summary: 'The letter.' }], assessment: 'Clean shape.' },
      themes: ['inheritance'], tone: 'quiet', audience: 'adults', arcs: [{ name: 'Mara', arc: 'Accepts.', strength: 7 }],
      ratings: [{ aspect: 'structure', score: 7, reason: 'Clear.' }, { aspect: 'prose', score: 8, reason: 'Controlled.' }],
      strengths: ['Restraint'], priorities: [{ title: 'Deepen Tomas', detail: 'Give him a motive.' }], voice: {}, bookIssues: [],
    },
    'fiction',
  );
  return {
    book: { title: book.title, author: book.author, language: 'en', bookType: 'fiction' }, stats,
    chapters: deep ? stats.chapters.map((c, i) => ({ chapterId: c.chapterId, number: i + 1, title: c.title, summary: `Summary of ${c.title}.`, tension: 3 + i * 2, pace: 'steady' })) : [],
    synthesis: deep ? synthesis : null, issues, bible: deep ? bible : null, model: deep ? 'Test Model 27B' : '', date: new Date('2026-11-28T10:00:00Z'),
  };
}

describe('charts', () => {
  it('uses round numbers on the axis', () => {
    expect(niceTicks(873)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(4200)).toEqual([0, 2000, 4000, 6000]);
    expect(niceTicks(10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('lays out columns no wider than 24 pixels and thins the labels when chapters are many', () => {
    const few = layoutChart({ type: 'columns', title: 't', labels: ['1', '2', '3'], values: [100, 300, 200] }, 480, 170);
    expect(few.barWidth).toBe(24);
    expect(few.shownLabels).toEqual([0, 1, 2]);
    expect(few.slots[1].y!).toBeLessThan(few.slots[0].y!);
    expect(few.ticks.map((t) => t.label)).toEqual(['0', '100', '200', '300']);
    const many = layoutChart({ type: 'columns', title: 't', labels: Array.from({ length: 100 }, (_, i) => String(i + 1)), values: Array.from({ length: 100 }, (_, i) => i) }, 480, 170);
    expect(many.barWidth).toBeLessThan(5);
    expect(many.shownLabels.length).toBeLessThanOrEqual(20);
    expect(many.slots.every((s) => s.x > many.plot.left && s.x < many.plot.right)).toBe(true);
  });

  it('draws a line with gaps where a chapter has no value, on a fixed scale', () => {
    const spec = { type: 'line' as const, title: 'Tension', labels: ['1', '2', '3', '4'], values: [3, null, 6, 9], max: 10 };
    const layout = layoutChart(spec, 480, 170);
    expect(layout.ticks.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10]);
    const svg = chartSvg(spec);
    expect(svg.match(/<circle /g)).toHaveLength(3);
    expect(/d="M[\d.]+,[\d.]+ M[\d.]+,[\d.]+ L/.test(svg)).toBe(true);
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('offers a tension chart only when the AI has read the book', async () => {
    const quick = await reportInput(false);
    const deep = await reportInput(true);
    expect(buildCharts(quick.stats, quick.chapters, 'fiction').map((c) => c.title.split(' (')[0])).toEqual(['Words per chapter', 'Pace estimate by chapter', 'Reading level by chapter', 'Dialogue share by chapter']);
    expect(buildCharts(deep.stats, deep.chapters, 'fiction')[0]).toMatchObject({ type: 'line', max: 10, values: [3, 5, 7, 9] });
  });
});

describe('the analysis report', () => {
  it('covers the assessment, chapters, language, findings and Book Bible', async () => {
    const report = buildReport(await reportInput(true));
    expect(report.title).toBe('Manuscript analysis: The Lighthouse at Marrow Point');
    expect(report.subtitle).toBe('by Eleanor Vance · 28 November 2026');
    expect(report.sections.map((s) => s.heading)).toEqual(['At a glance', 'Assessment', 'Story and structure', 'Chapter by chapter', 'Language', 'Findings', 'Book Bible', 'About this report']);
    const text = JSON.stringify(report);
    expect(text).toContain('560 words in 4 chapters');
    expect(text).toContain('Deepen Tomas. Give him a motive.');
    expect(text).toContain('Who sent the letter is never hinted.');
    // A finding the publisher dismissed is left out.
    expect(text).not.toContain('Stated flatly.');
    expect(text).toContain('Mara Ellison (Mara)');
    expect(text).toContain('Test Model 27B');
  });

  it('says plainly when it is a quick check without AI', async () => {
    const report = buildReport(await reportInput(false));
    expect(report.sections.map((s) => s.heading)).toEqual(['At a glance', 'Chapter by chapter', 'Language', 'Findings', 'About this report']);
    expect(JSON.stringify(report)).toContain('This is a quick check');
  });

  it('exports to Word and reads back', async () => {
    const docx = exportReportDocx(buildReport(await reportInput(true)));
    const back = await importManuscript('report.docx', docx);
    const lines = back.blocks.map(blockText);
    expect(lines).toContain('Assessment');
    expect(lines).toContain('Deepen Tomas. Give him a motive.');
    expect(lines.join('\n')).toContain('Plot and structure');
    expect(lines.join('\n')).toContain('7 / 10');
  });

  it.runIf(HAS_PDFTOTEXT)('exports to PDF with charts, and the text can be read back', async () => {
    const pdf = await renderPdf(reportPdfDefinition(buildReport(await reportInput(true))), FONTS);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    const dir = mkdtempSync(join(tmpdir(), 'mf-report-'));
    writeFileSync(join(dir, 'report.pdf'), pdf);
    const text = execFileSync('pdftotext', ['-layout', join(dir, 'report.pdf'), '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
    if (process.env.MF_KEEP_PDF) writeFileSync(process.env.MF_KEEP_PDF, pdf);
    expect(text).toContain('Manuscript analysis: The Lighthouse at Marrow Point');
    expect(text).toContain('Tension by chapter');
    expect(text).toContain('Words per chapter');
    expect(text).toContain('Deepen Tomas');
    expect(text).toContain('Mara Ellison (Mara)');
    expect(pdf.length).toBeLessThan(400_000);
  });
});

describe('PDF export of a manuscript', () => {
  it.runIf(HAS_PDFTOTEXT)('produces a reading copy whose text matches the book', async () => {
    const book = await novel();
    const pdf = await renderPdf(manuscriptPdfDefinition(book), FONTS);
    const dir = mkdtempSync(join(tmpdir(), 'mf-pdf-'));
    writeFileSync(join(dir, 'book.pdf'), pdf);
    const text = execFileSync('pdftotext', [join(dir, 'book.pdf'), '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
    expect(text).toContain('The Lighthouse at Marrow Point Eleanor Vance');
    for (const chapter of book.chapters.slice(1)) {
      expect(text).toContain(chapter.title);
      const first = blockText(chapter.blocks[0]).slice(0, 60);
      expect(text).toContain(first);
    }
    expect(text).toContain('a second light answered.');
    // Each chapter starts on a new page, after the title page.
    const pages = execFileSync('pdftotext', [join(dir, 'book.pdf'), '-'], { encoding: 'utf8' }).split('\f').filter((p) => p.trim());
    expect(pages.length).toBe(5);
  });

  it('reads back through the app itself with the same chapters', async () => {
    const book = await novel();
    const pdf = await renderPdf(manuscriptPdfDefinition(book), FONTS);
    const result = await importManuscript('book.pdf', pdf, { loadPdf: loadPdfForTests });
    const chapters = detectChapters(result.blocks, 'auto', { title: book.title, author: book.author }).chapters;
    expect(chapters.map((c) => c.title)).toEqual(['Title page', 'Prologue', 'Chapter One', 'Chapter Two', 'Chapter Three']);
    expect(blockText(chapters[4].blocks[chapters[4].blocks.length - 1])).toMatch(/a second light answered\.$/);
  });

  it('prints Cyrillic and Greek, and refuses scripts its font cannot print', async () => {
    const book = { title: 'Привет', author: 'Автор', language: 'ru', chapters: [{ title: 'Глава 1', blocks: [paragraph('Привет, мир. Ελληνικά. Żółć.')] }] };
    const pdf = await renderPdf(manuscriptPdfDefinition(book), FONTS);
    expect(pdf.length).toBeGreaterThan(5000);
    expect(unsupportedScript('Привет, мир. Ελληνικά. Żółć.')).toBeNull();
    expect(unsupportedScript('这是一本书')).toBe('Chinese or Japanese');
    expect(unsupportedScript('مرحبا')).toBe('Arabic script');
  });
});
