import type { BookBible } from './bible';
import type { ChartSpec } from './charts';
import type { BookKind, Synthesis } from './deep';
import { CATEGORY_INFO, lixLabel, readingEaseLabel, SEVERITY_LABELS, type BookStats, type Issue, type Severity } from './types';
import { languageName } from '../text/language';

export type ReportBlock =
  | { kind: 'p'; text: string; muted?: boolean }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'facts'; rows: [string, string][] }
  | { kind: 'table'; head: string[]; rows: string[][]; /** Relative column widths. */ widths?: number[] }
  | { kind: 'chart'; chart: ChartSpec };

export interface ReportSection {
  heading: string;
  blocks: ReportBlock[];
}

export interface Report {
  title: string;
  subtitle: string;
  sections: ReportSection[];
}

export interface ReportInput {
  book: { title: string; author: string; language: string; bookType: BookKind };
  stats: BookStats;
  chapters: { chapterId: string; number: number; title: string; summary: string; tension: number; pace: string }[];
  synthesis: Synthesis | null;
  issues: (Issue & { status?: string })[];
  bible: BookBible | null;
  /** Name of the model that did the reading, or empty for a quick check. */
  model: string;
  date: Date;
}

const num = (n: number) => n.toLocaleString('en-US');
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The charts shown for a book: the same ones on screen and in the report. */
export function buildCharts(stats: BookStats, chapters: ReportInput['chapters'], kind: BookKind): ChartSpec[] {
  const labels = stats.chapters.map((_, i) => String(i + 1));
  const byId = new Map(chapters.map((c) => [c.chapterId, c]));
  const charts: ChartSpec[] = [];
  if (chapters.length >= 2) {
    charts.push({
      type: 'line', title: kind === 'fiction' ? 'Tension by chapter (AI reading, out of 10)' : 'Engagement by chapter (AI reading, out of 10)', labels,
      values: stats.chapters.map((c) => byId.get(c.chapterId)?.tension ?? null), max: 10, unit: ' / 10',
    });
  }
  if (stats.chapters.length >= 2) {
    charts.push({ type: 'columns', title: 'Words per chapter', labels, values: stats.chapters.map((c) => c.words), unit: ' words' });
    charts.push({ type: 'line', title: 'Pace estimate by chapter (from sentence length and dialogue, 0 slow to 100 fast)', labels, values: stats.chapters.map((c) => c.pace), max: 100 });
    if (stats.chapters.some((c) => c.grade !== null)) {
      charts.push({ type: 'line', title: 'Reading level by chapter (school grade)', labels, values: stats.chapters.map((c) => c.grade), unit: '' });
    } else {
      charts.push({ type: 'line', title: 'Reading difficulty by chapter (LIX: higher is harder)', labels, values: stats.chapters.map((c) => c.lix) });
    }
    charts.push({ type: 'columns', title: 'Dialogue share by chapter (%)', labels, values: stats.chapters.map((c) => Math.round(c.dialogueShare * 100)), max: 100, unit: '%' });
  }
  return charts;
}

export function readingLevelText(stats: BookStats): string {
  if (stats.readingEase !== null && stats.grade !== null) return `${readingEaseLabel(stats.readingEase)} (school grade ${stats.grade}, reading ease ${stats.readingEase})`;
  return `${lixLabel(stats.lix)} (LIX ${stats.lix})`;
}

/** Puts everything an analysis found into a report that can be printed or sent to an author. */
export function buildReport(input: ReportInput): Report {
  const { book, stats, synthesis, bible } = input;
  const kind = book.bookType;
  const open = input.issues.filter((i) => i.status !== 'dismissed');
  const sections: ReportSection[] = [];

  const facts: [string, string][] = [
    ['Length', `${num(stats.words)} words in ${stats.chapters.length} chapter${stats.chapters.length === 1 ? '' : 's'}`],
    ['Language', languageName(book.language)],
    ['Reading level', readingLevelText(stats)],
    ['Average sentence', `${stats.avgSentenceWords} words`],
    ['Dialogue', `${pct(stats.dialogueShare)} of the text`],
  ];
  if (stats.narration) facts.push(['Narration', [stats.narration.person !== 'unclear' ? `${stats.narration.person} person` : '', stats.narration.tense !== 'unclear' ? `${stats.narration.tense} tense` : ''].filter(Boolean).join(', ') || 'mixed']);
  if (synthesis?.audience) facts.push(['Readership', synthesis.audience]);
  const counts = (['high', 'medium', 'low'] as Severity[]).map((s) => `${open.filter((i) => i.severity === s).length} ${SEVERITY_LABELS[s].toLowerCase()}`);
  facts.push(['Findings', counts.join(', ')]);
  sections.push({ heading: 'At a glance', blocks: [{ kind: 'facts', rows: facts }] });

  if (synthesis) {
    const blocks: ReportBlock[] = [];
    if (synthesis.summary) blocks.push({ kind: 'p', text: synthesis.summary });
    if (synthesis.ratings.length) blocks.push({ kind: 'table', head: ['Aspect', 'Score', 'Why'], rows: synthesis.ratings.map((r) => [r.label, `${r.score} / 10`, r.reason]), widths: [3, 1, 6] });
    if (synthesis.strengths.length) blocks.push({ kind: 'p', text: 'What works well:' }, { kind: 'bullets', items: synthesis.strengths });
    if (synthesis.priorities.length) blocks.push({ kind: 'p', text: 'What to fix first:' }, { kind: 'numbered', items: synthesis.priorities.map((p) => `${p.title}. ${p.detail}`) });
    sections.push({ heading: 'Assessment', blocks });

    const structure: ReportBlock[] = [];
    if (synthesis.structure.parts.length) structure.push({ kind: 'table', head: [kind === 'nonfiction' ? 'Part' : 'Movement', 'Chapters', 'What happens'], rows: synthesis.structure.parts.map((p) => [p.name, p.chapters, p.summary]), widths: [2, 1, 6] });
    if (synthesis.structure.assessment) structure.push({ kind: 'p', text: synthesis.structure.assessment });
    if (synthesis.themes.length) structure.push({ kind: 'facts', rows: [['Themes', synthesis.themes.join(', ')], ...(synthesis.tone ? [['Tone', synthesis.tone] as [string, string]] : [])] });
    if (synthesis.arcs.length) structure.push({ kind: 'table', head: ['Character', 'Arc', 'Strength'], rows: synthesis.arcs.map((a) => [a.name, a.arc, `${a.strength} / 10`]), widths: [2, 6, 1] });
    if (synthesis.takeaways.length) structure.push({ kind: 'p', text: 'What a reader takes away:' }, { kind: 'bullets', items: synthesis.takeaways });
    if (structure.length) sections.push({ heading: kind === 'nonfiction' ? 'Argument and structure' : 'Story and structure', blocks: structure });
  }

  const byId = new Map(input.chapters.map((c) => [c.chapterId, c]));
  const chapterBlocks: ReportBlock[] = buildCharts(stats, input.chapters, kind).map((chart) => ({ kind: 'chart', chart }));
  const hasNotes = input.chapters.length > 0;
  chapterBlocks.push({
    kind: 'table',
    head: ['#', 'Chapter', 'Words', ...(hasNotes ? [kind === 'fiction' ? 'Tension' : 'Engagement'] : []), 'Pace', 'Dialogue', stats.englishChecks ? 'Grade' : 'LIX'],
    rows: stats.chapters.map((c, i) => [
      String(i + 1), c.title, num(c.words), ...(hasNotes ? [byId.get(c.chapterId) ? `${byId.get(c.chapterId)!.tension}` : ''] : []),
      byId.get(c.chapterId)?.pace ?? (c.pace >= 60 ? 'fast' : c.pace >= 35 ? 'steady' : 'slow'), pct(c.dialogueShare), String(stats.englishChecks ? (c.grade ?? '') : c.lix),
    ]),
    widths: [1, 6, 2, ...(hasNotes ? [2] : []), 2, 2, 2],
  });
  if (hasNotes) chapterBlocks.push({ kind: 'p', text: 'Chapter summaries:' }, { kind: 'numbered', items: input.chapters.map((c) => `${c.title}. ${c.summary}`) });
  sections.push({ heading: 'Chapter by chapter', blocks: chapterBlocks });

  const language: ReportBlock[] = [];
  const habits: [string, string][] = [];
  if (stats.perThousand.adverbs !== null) habits.push(['"-ly" adverbs', `${stats.perThousand.adverbs} per 1,000 words`]);
  if (stats.perThousand.passive !== null) habits.push(['Passive constructions', `${stats.perThousand.passive} per 1,000 words`]);
  if (stats.perThousand.fillers !== null) habits.push(['Filler words', `${stats.perThousand.fillers} per 1,000 words`]);
  habits.push(['Exclamation marks', `${stats.perThousand.exclamations} per 1,000 words`]);
  habits.push(['Sentence length', `${pct(stats.voice.shortShare)} short (up to 8 words), ${pct(stats.voice.longShare)} long (over 25 words)`]);
  habits.push(['Vocabulary range', `${stats.voice.vocabularyRange} different words per 1,000`]);
  language.push({ kind: 'facts', rows: habits });
  if (stats.topWords.length) language.push({ kind: 'p', text: `Words used often: ${stats.topWords.slice(0, 12).map((w) => `${w.text} (${w.count})`).join(', ')}.` });
  if (stats.repeatedPhrases.length) language.push({ kind: 'p', text: `Phrases that recur: ${stats.repeatedPhrases.slice(0, 8).map((p) => `"${p.text}" (${p.count})`).join(', ')}.` });
  if (!stats.englishChecks) language.push({ kind: 'p', muted: true, text: `Word-list checks (clichés, fillers, adverbs, passive voice) are available for English only. This book is in ${languageName(book.language)}, so those were skipped.` });
  sections.push({ heading: 'Language', blocks: language });

  if (stats.childrens) {
    const c = stats.childrens;
    const rows: [string, string][] = [['Closest format', `${c.format} (usually ${num(c.range[0])} to ${num(c.range[1])} words)${c.fits ? '' : ': this book is outside that range'}`]];
    if (c.readingAge !== null) rows.push(['Reading age', `about ${c.readingAge} years`]);
    if (c.rhymeShare !== null && c.rhymeShare >= 0.3) rows.push(['Rhyme', `${pct(c.rhymeShare)} of line endings rhyme with a neighbour`]);
    if (c.refrains.length) rows.push(['Refrains', c.refrains.map((r) => `"${r.text}" (${r.count} times)`).join(', ')]);
    sections.push({ heading: 'Fit for young readers', blocks: [{ kind: 'facts', rows }] });
  }

  if (open.length) {
    const chapterTitle = new Map(stats.chapters.map((c) => [c.chapterId, c.title]));
    const blocks: ReportBlock[] = [];
    const LIMIT = 120;
    let shown = 0;
    for (const severity of ['high', 'medium', 'low'] as Severity[]) {
      const list = open.filter((i) => i.severity === severity);
      if (!list.length || shown >= LIMIT) continue;
      const take = list.slice(0, LIMIT - shown);
      shown += take.length;
      blocks.push({ kind: 'p', text: `${SEVERITY_LABELS[severity]} (${list.length})` });
      blocks.push({
        kind: 'table', head: ['Where', 'Finding', 'Suggestion'], widths: [2, 5, 3],
        rows: take.map((i) => [
          i.chapterId ? (chapterTitle.get(i.chapterId) ?? '') : 'Whole book',
          `${i.title}${i.title === CATEGORY_INFO[i.category].label ? '' : ` (${CATEGORY_INFO[i.category].label})`}. ${i.detail}${i.quote ? ` “${i.quote}”` : ''}`,
          i.suggestion,
        ]),
      });
    }
    if (open.length > shown) blocks.push({ kind: 'p', muted: true, text: `${open.length - shown} more minor findings are listed in the app.` });
    sections.push({ heading: 'Findings', blocks });
  }

  if (bible && (bible.characters.length || bible.settings.length || bible.glossary.length || bible.voice.description)) {
    const blocks: ReportBlock[] = [];
    if (bible.characters.length) {
      blocks.push({
        kind: 'table', head: [kind === 'nonfiction' ? 'Person' : 'Character', 'Role', 'Notes'], widths: [2, 1, 6],
        rows: bible.characters.filter((c) => c.role !== 'minor' || c.locked).slice(0, 30).map((c) => [c.aliases.length ? `${c.name} (${c.aliases.join(', ')})` : c.name, c.role, [c.description, c.arc].filter(Boolean).join(' ')]),
      });
    }
    if (bible.relationships.length) blocks.push({ kind: 'p', text: 'Relationships:' }, { kind: 'bullets', items: bible.relationships.slice(0, 20).map((r) => `${r.a} and ${r.b}: ${r.relation}`) });
    if (bible.settings.length) blocks.push({ kind: 'p', text: 'Places:' }, { kind: 'bullets', items: bible.settings.slice(0, 20).map((s) => (s.description ? `${s.name}: ${s.description}` : s.name)) });
    if (bible.timeline.length) blocks.push({ kind: 'p', text: 'Timeline:' }, { kind: 'bullets', items: bible.timeline.slice(0, 40).map((e) => `Chapter ${e.chapter}${e.when ? ` (${e.when})` : ''}: ${e.what}`) });
    if (bible.glossary.length) blocks.push({ kind: 'p', text: 'Terms:' }, { kind: 'bullets', items: bible.glossary.slice(0, 30).map((t) => `${t.term}: ${t.meaning}`) });
    const voice: [string, string][] = [];
    if (bible.voice.description) voice.push(['Voice', bible.voice.description]);
    if (bible.voice.dialogueStyle) voice.push(['Dialogue', bible.voice.dialogueStyle]);
    if (bible.voice.devices.length) voice.push(['Favoured devices', bible.voice.devices.join('; ')]);
    if (voice.length) blocks.push({ kind: 'p', text: 'Voice profile:' }, { kind: 'facts', rows: voice });
    sections.push({ heading: 'Book Bible', blocks });
  }

  sections.push({
    heading: 'About this report',
    blocks: [
      {
        kind: 'p', muted: true,
        text: input.model
          ? `The figures and language checks were computed directly from the text. The assessment, chapter notes and Book Bible were produced by an AI model (${input.model}) running on the publisher's own computer. Treat its ratings and findings as an informed second opinion to check, not as a verdict.`
          : 'This is a quick check: the figures and language checks were computed directly from the text, without AI. Run a full analysis for an assessment of structure, characters and continuity.',
      },
    ],
  });

  return {
    title: `Manuscript analysis: ${book.title}`,
    subtitle: [book.author && `by ${book.author}`, input.date.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })].filter(Boolean).join(' · '),
    sections,
  };
}
