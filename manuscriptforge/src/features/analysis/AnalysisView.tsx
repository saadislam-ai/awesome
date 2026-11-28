import { AlertTriangle, BookOpenText, Check, Download, Gauge, MapPin, Pause, Play, RotateCcw, Sparkles, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import type { BookBible } from '../../core/analysis/bible';
import { RATING_LABELS, type BookKind } from '../../core/analysis/deep';
import { buildCharts, buildReport, readingLevelText } from '../../core/analysis/report';
import { CATEGORY_INFO, lixLabel, readingEaseLabel, SEVERITY_LABELS, type IssueGroup, type Severity } from '../../core/analysis/types';
import { exportFileName } from '../../core/export';
import { reportPdfDefinition, renderPdf, unsupportedScript } from '../../core/export/pdf';
import { exportReportDocx } from '../../core/export/reportDocx';
import type { Book, ChapterHead } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import type { Analysis, StoredIssue } from '../../data/analysis';
import { Button, ConfirmDialog, EmptyState, Pill, Spinner } from '../../ui/components';
import { formatDateTime } from '../../ui/format';
import { loadPdfFonts } from '../export/pdf-fonts';
import { BibleEditor } from './BibleEditor';
import { Chart, Meter } from './Chart';

type Tab = 'overview' | 'findings' | 'chapters' | 'bible' | 'report';

const GROUP_LABELS: Record<IssueGroup, string> = { story: 'Story', argument: 'Argument and structure', children: 'Young readers', language: 'Language' };
const SEVERITY_TONE: Record<Severity, 'danger' | 'warning' | 'neutral'> = { high: 'danger', medium: 'warning', low: 'neutral' };
const PAGE = 100;
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The strip that shows an AI analysis at work, with pause, resume and stop. */
function ProgressStrip({ analysis }: { analysis: Analysis }) {
  const { runner } = useAi();
  const active = analysis.status === 'running' || analysis.status === 'queued';
  const percent = analysis.words ? Math.round((analysis.wordsDone / analysis.words) * 100) : 0;
  const stepsDone = analysis.tasksDone + analysis.tasksFailed;
  const remaining = analysis.ms > 0 && analysis.wordsDone > 0 ? ((analysis.words - analysis.wordsDone) / analysis.wordsDone) * (analysis.ms / 1000) : 0;
  return (
    <div className={`job-strip job-${analysis.status}`} data-testid="analysis-strip" data-status={analysis.status}>
      <div className="job-line">
        <strong>Full analysis</strong>
        <span className="muted">
          {analysis.status === 'running' && (stepsDone >= analysis.tasks - 1 ? 'Writing the assessment of the whole book' : `Reading passage ${stepsDone + 1} of ${analysis.tasks - 1}`)}
          {analysis.status === 'queued' && 'Waiting to start'}
          {analysis.status === 'paused' && `On hold after ${stepsDone} of ${analysis.tasks} steps`}
          {active && remaining > 20 && ` · about ${remaining > 90 ? `${Math.round(remaining / 60)} min` : `${Math.round(remaining)} s`} left`}
          {analysis.model && ` · ${analysis.model}`}
        </span>
        <span className="grow" />
        {active && <Button size="sm" icon={<Pause size={14} />} onClick={() => void runner.pause(analysis.id)}>Pause</Button>}
        {analysis.status === 'paused' && <Button size="sm" variant="primary" icon={<Play size={14} />} onClick={() => void runner.resume(analysis.id)}>Resume</Button>}
        <Button size="sm" icon={<Square size={13} />} onClick={() => void runner.cancel(analysis.id)}>Stop</Button>
      </div>
      <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress">
        <div style={{ width: `${percent}%` }} />
      </div>
      {analysis.error && analysis.status === 'paused' && <p className="job-problem"><AlertTriangle size={14} /> {analysis.error}</p>}
      {active && <p className="fine-print">Findings appear below as each passage is read. You can keep working in the meantime.</p>}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function AnalysisView({ book }: { book: Book }) {
  const { library, platform, notify, reportError, openBook } = useApp();
  const { analyses, startAnalysis, canRunAi, suggestionsVersion, model } = useAi();
  const [analysis, setAnalysis] = useState<Analysis | null | undefined>(undefined);
  const [issues, setIssues] = useState<StoredIssue[]>([]);
  const [heads, setHeads] = useState<ChapterHead[]>([]);
  const [bible, setBible] = useState<BookBible | null>(null);
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState<null | boolean>(null);
  const [group, setGroup] = useState<'all' | IssueGroup>('all');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [chapterFilter, setChapterFilter] = useState('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [exporting, setExporting] = useState<null | 'pdf' | 'docx'>(null);
  const kind = book.bookType as BookKind;

  const load = useCallback(async () => {
    const [current, list, chapterHeads, stored] = await Promise.all([analyses.latest(book.id), analyses.listIssues(book.id), library.listChapters(book.id), analyses.getBible(book.id)]);
    setAnalysis(current);
    setIssues(list);
    setHeads(chapterHeads);
    setBible(stored);
    setStale(current ? await analyses.isStale(current) : false);
  }, [analyses, library, book.id]);

  useEffect(() => {
    let cancelled = false;
    load().catch((e) => !cancelled && reportError('analysis', e, 'The analysis could not be loaded.'));
    return () => {
      cancelled = true;
    };
  }, [load, suggestionsVersion, book.updatedAt, reportError]);

  const busy = !!analysis && (analysis.status === 'running' || analysis.status === 'queued' || analysis.status === 'paused');

  const run = async (deep: boolean) => {
    setConfirm(null);
    setStarting(true);
    try {
      const started = await startAnalysis(book.id, deep);
      if (started) {
        if (!deep) notify('success', 'Quick check finished.');
        setShown(PAGE);
        await load();
      }
    } finally {
      setStarting(false);
    }
  };
  /** Asks first when running again would throw away what the AI found. */
  const request = (deep: boolean) => (analysis?.result ? setConfirm(deep) : void run(deep));

  const titles = useMemo(() => new Map(heads.map((h) => [h.id, h.title])), [heads]);
  const stats = analysis?.stats;
  const result = analysis?.result ?? null;
  const synthesis = result?.synthesis ?? null;
  const notes = useMemo(() => new Map((result?.chapters ?? []).map((c) => [c.chapterId, c])), [result]);
  const charts = useMemo(() => (stats ? buildCharts(stats, result?.chapters ?? [], kind) : []), [stats, result, kind]);
  const chapterNames = useMemo(() => stats?.chapters.map((c) => c.title) ?? [], [stats]);

  const open = useMemo(() => issues.filter((i) => i.status === 'open'), [issues]);
  const groupsPresent = useMemo(() => [...new Set(issues.map((i) => CATEGORY_INFO[i.category].group))], [issues]);
  const categoriesPresent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of open) if (group === 'all' || CATEGORY_INFO[issue.category].group === group) counts.set(issue.category, (counts.get(issue.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [open, group]);
  const filtered = useMemo(
    () =>
      issues.filter(
        (i) =>
          (showDismissed || i.status === 'open') &&
          (group === 'all' || CATEGORY_INFO[i.category].group === group) &&
          (category === 'all' || i.category === category) &&
          (severity === 'all' || i.severity === severity) &&
          (chapterFilter === 'all' || (chapterFilter === 'book' ? !i.chapterId : i.chapterId === chapterFilter)),
      ),
    [issues, showDismissed, group, category, severity, chapterFilter],
  );
  useEffect(() => setShown(PAGE), [group, category, severity, chapterFilter, showDismissed]);
  // A type that no longer has any findings (after a new analysis, or once its last one is dismissed) cannot stay selected.
  useEffect(() => {
    if (category !== 'all' && !categoriesPresent.some(([value]) => value === category)) setCategory('all');
  }, [category, categoriesPresent]);

  const setIssue = async (issue: StoredIssue, status: StoredIssue['status']) => {
    setIssues((list) => list.map((i) => (i.id === issue.id ? { ...i, status } : i)));
    try {
      await analyses.setIssueStatus(issue.id, status);
    } catch (e) {
      reportError('analysis', e, 'The change could not be saved.');
    }
  };

  const download = async (format: 'pdf' | 'docx') => {
    if (!analysis || !stats) return;
    setExporting(format);
    try {
      const report = buildReport({
        book: { title: book.title, author: book.author, language: book.language, bookType: kind },
        stats, chapters: result?.chapters ?? [], synthesis, issues, bible: await analyses.getBible(book.id), model: analysis.deep ? analysis.model : '', date: new Date(analysis.finishedAt ?? analysis.createdAt),
      });
      const bytes = format === 'pdf' ? await renderPdf(reportPdfDefinition(report), await loadPdfFonts()) : exportReportDocx(report);
      const name = exportFileName(book.title, format, ' (analysis report)');
      const path = await platform.saveFile(name, format, bytes);
      if (path) {
        notify('success', `Saved ${name}.`);
        await library.addLog('info', 'analysis', `Saved the analysis report for "${book.title}"`, path);
      }
    } catch (e) {
      reportError('analysis', e, 'The report could not be created.');
    } finally {
      setExporting(null);
    }
  };

  if (analysis === undefined) {
    return (
      <div className="view">
        <div className="view-scroll"><Spinner label="Loading the analysis…" /></div>
      </div>
    );
  }

  const aiHint = canRunAi
    ? model.state === 'ready' ? `The AI (${model.name}) reads the whole book passage by passage. This can take a while for a long book and can be paused.` : 'The AI model is loaded first, then it reads the whole book passage by passage.'
    : 'Needs an AI model. Set one up under Settings first.';

  if (!analysis || !stats) {
    return (
      <div className="view analysis-view">
        <header className="view-header">
          <div>
            <h1>Analysis</h1>
            <p className="view-sub">{book.title} · {formatCount(book.wordCount)} words</p>
          </div>
        </header>
        <div className="view-scroll">
          <EmptyState icon={<Gauge size={28} />} title="This book has not been analysed yet">
            <div className="analysis-choices">
              <div className="card">
                <h3>Quick check</h3>
                <p className="muted">Counts, readability, pacing estimates and language checks such as repeated words, filler and overlong sentences. Takes seconds and needs no AI.</p>
                <Button icon={<Gauge size={16} />} disabled={starting} onClick={() => void run(false)} data-testid="run-quick">Run the quick check</Button>
              </div>
              <div className="card">
                <h3>Full analysis</h3>
                <p className="muted">Everything in the quick check, plus structure, plot, characters, consistency and pacing as read by the AI, and a Book Bible. {aiHint}</p>
                <Button variant="primary" icon={<Sparkles size={16} />} disabled={starting || !canRunAi} onClick={() => void run(true)} data-testid="run-full">Run the full analysis</Button>
              </div>
            </div>
          </EmptyState>
        </div>
      </div>
    );
  }

  const highCount = open.filter((i) => i.severity === 'high').length;
  const scriptProblem = unsupportedScript(`${book.title} ${stats.topWords.map((w) => w.text).join(' ')}`);
  const tabs: [Tab, string, number?][] = [['overview', 'Overview'], ['findings', 'Findings', open.length], ['chapters', 'Chapters'], ['bible', 'Book Bible'], ['report', 'Report']];

  return (
    <div className="view analysis-view">
      <header className="view-header">
        <div>
          <h1>Analysis</h1>
          <p className="view-sub">
            {book.title} · {busy ? 'Full analysis in progress' : `${analysis.deep ? 'Full analysis' : 'Quick check'} from ${formatDateTime(analysis.finishedAt ?? analysis.createdAt)}`}
          </p>
        </div>
        <div className="row-end">
          <Button icon={<RotateCcw size={15} />} disabled={starting || busy} onClick={() => request(false)} data-testid="run-quick">Quick check</Button>
          <Button variant="primary" icon={<Sparkles size={15} />} disabled={starting || busy || !canRunAi} title={canRunAi ? undefined : aiHint} onClick={() => request(true)} data-testid="run-full">
            {analysis.deep && !busy ? 'Run the full analysis again' : 'Run the full analysis'}
          </Button>
        </div>
      </header>

      {busy && <div className="job-strips"><ProgressStrip analysis={analysis} /></div>}

      <div className="tabs" role="tablist">
        {tabs.map(([value, label, count]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'is-active' : ''}`} onClick={() => setTab(value)} data-testid={`tab-${value}`}>
            {label}
            {count !== undefined && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>

      <div className="view-scroll analysis-body">
        {stale && !busy && (
          <p className="notice notice-warning" data-testid="stale-notice">
            The text has changed since this analysis was made, so some findings may no longer apply. Run it again to bring it up to date.
          </p>
        )}
        {analysis.status === 'cancelled' && (
          <p className="notice notice-info">The full analysis was stopped early. What it found up to that point is shown here.</p>
        )}
        {analysis.tasksFailed > 0 && !busy && (
          <p className="notice notice-warning">
            {analysis.tasksFailed} step{analysis.tasksFailed === 1 ? '' : 's'} of the analysis could not be completed because the model's answer was unusable. The rest of the results are unaffected.
          </p>
        )}

        {tab === 'overview' && (
          <>
            <div className="stat-row">
              <Tile label="Words" value={formatCount(stats.words)} sub={`${formatCount(stats.sentences)} sentences`} />
              <Tile label="Chapters" value={String(stats.chapters.length)} sub={stats.chapters.length ? `about ${formatCount(Math.round(stats.words / stats.chapters.length))} words each` : undefined} />
              <Tile
                label="Reading level"
                value={stats.grade !== null ? `Grade ${stats.grade}` : `LIX ${stats.lix}`}
                sub={stats.readingEase !== null ? `${readingEaseLabel(stats.readingEase)} · ease ${stats.readingEase}` : lixLabel(stats.lix)}
              />
              <Tile label="Average sentence" value={`${stats.avgSentenceWords} words`} sub={`${pct(stats.voice.longShare)} are long`} />
              <Tile label="Dialogue" value={pct(stats.dialogueShare)} sub="of the text" />
              <Tile label="Open findings" value={String(open.length)} sub={highCount ? `${highCount} important` : 'none marked important'} />
            </div>

            {!analysis.deep && (
              <div className="notice notice-info analysis-upsell">
                <span>
                  This is the quick check: numbers and language checks only. The full analysis adds structure, plot, characters, consistency and a Book Bible.
                </span>
                <Button size="sm" variant="primary" icon={<Sparkles size={14} />} disabled={starting || busy || !canRunAi} onClick={() => request(true)}>Run the full analysis</Button>
              </div>
            )}

            {synthesis && (
              <section className="card" data-testid="assessment">
                <h2>Assessment</h2>
                {synthesis.summary && <p>{synthesis.summary}</p>}
                <dl className="facts">
                  {synthesis.audience && <div><dt>Readers</dt><dd>{synthesis.audience}</dd></div>}
                  {synthesis.tone && <div><dt>Tone</dt><dd>{synthesis.tone}</dd></div>}
                  {synthesis.themes.length > 0 && <div><dt>Themes</dt><dd>{synthesis.themes.join(', ')}</dd></div>}
                  {(bible?.pov || bible?.tense) && <div><dt>Narration</dt><dd>{[bible.pov, bible.tense && `${bible.tense} tense`].filter(Boolean).join(', ')}</dd></div>}
                </dl>
                {synthesis.ratings.length > 0 && (
                  <>
                    <h3>Ratings</h3>
                    <ul className="meters" data-testid="ratings">
                      {synthesis.ratings.map((r) => <Meter key={r.key} label={r.label || RATING_LABELS[kind][r.key] || r.key} score={r.score} reason={r.reason} />)}
                    </ul>
                    <p className="fine-print">Ratings are one reader's opinion: the AI model's. Treat them as a starting point for your own judgement.</p>
                  </>
                )}
                <div className="two-col">
                  {synthesis.strengths.length > 0 && (
                    <div>
                      <h3>What works</h3>
                      <ul className="plain-list">{synthesis.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {synthesis.priorities.length > 0 && (
                    <div>
                      <h3>What to fix first</h3>
                      <ol className="plain-list">{synthesis.priorities.map((p, i) => <li key={i}><strong>{p.title}.</strong> {p.detail}</li>)}</ol>
                    </div>
                  )}
                </div>
              </section>
            )}

            {synthesis && (synthesis.structure.parts.length > 0 || synthesis.structure.assessment) && (
              <section className="card">
                <h2>{kind === 'nonfiction' ? 'Argument and structure' : 'Story and structure'}</h2>
                {synthesis.structure.assessment && <p>{synthesis.structure.assessment}</p>}
                {synthesis.structure.parts.length > 0 && (
                  <table className="plain-table">
                    <thead><tr><th>Part</th><th>Chapters</th><th>What happens</th></tr></thead>
                    <tbody>{synthesis.structure.parts.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.chapters}</td><td>{p.summary}</td></tr>)}</tbody>
                  </table>
                )}
                {synthesis.arcs.length > 0 && (
                  <>
                    <h3>Character arcs</h3>
                    <ul className="meters">{synthesis.arcs.map((a, i) => <Meter key={i} label={a.name} score={a.strength} reason={a.arc} />)}</ul>
                  </>
                )}
                {synthesis.takeaways.length > 0 && (
                  <>
                    <h3>What a reader takes away</h3>
                    <ul className="plain-list">{synthesis.takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </>
                )}
              </section>
            )}

            {charts.length > 0 && (
              <section className="card">
                <h2>Chapter by chapter</h2>
                <div className="chart-grid">{charts.map((spec) => <Chart key={spec.title} spec={spec} names={chapterNames} />)}</div>
                <p className="fine-print">
                  Point at a chart for exact values, or open the <button className="link-btn inline" onClick={() => setTab('chapters')}>Chapters tab</button> for all of them in a table.
                </p>
              </section>
            )}

            <section className="card">
              <h2>Language</h2>
              <dl className="facts wide-facts">
                <div><dt>Reading level</dt><dd>{readingLevelText(stats)}</dd></div>
                {stats.narration && (stats.narration.person !== 'unclear' || stats.narration.tense !== 'unclear') && (
                  <div><dt>Narration (estimate)</dt><dd>{[stats.narration.person !== 'unclear' && `${stats.narration.person} person`, stats.narration.tense !== 'unclear' && `${stats.narration.tense} tense`].filter(Boolean).join(', ')}</dd></div>
                )}
                {stats.perThousand.adverbs !== null && <div><dt>Adverbs ending in -ly</dt><dd>{stats.perThousand.adverbs} per 1,000 words</dd></div>}
                {stats.perThousand.passive !== null && <div><dt>Passive constructions</dt><dd>{stats.perThousand.passive} per 1,000 words</dd></div>}
                {stats.perThousand.fillers !== null && <div><dt>Filler words</dt><dd>{stats.perThousand.fillers} per 1,000 words</dd></div>}
                <div><dt>Exclamation marks</dt><dd>{stats.perThousand.exclamations} per 1,000 words</dd></div>
                {stats.topWords.length > 0 && (
                  <div><dt>Most used words</dt><dd className="chips">{stats.topWords.slice(0, 18).map((w) => <span key={w.text} className="tag">{w.text} <span className="muted">{w.count}</span></span>)}</dd></div>
                )}
                {stats.repeatedPhrases.length > 0 && (
                  <div><dt>Repeated phrases</dt><dd className="chips">{stats.repeatedPhrases.slice(0, 12).map((w) => <span key={w.text} className="tag">{w.text} <span className="muted">{w.count}</span></span>)}</dd></div>
                )}
              </dl>
              {!stats.englishChecks && <p className="fine-print">Word-list checks (adverbs, passive voice, filler, clichés) are available for English text only. Counts, readability (LIX) and repetition work in every language.</p>}
            </section>

            {stats.childrens && (
              <section className="card">
                <h2>Fit for young readers</h2>
                <dl className="facts wide-facts">
                  {stats.childrens.readingAge !== null && <div><dt>Reading age</dt><dd>about {stats.childrens.readingAge} years</dd></div>}
                  <div><dt>Closest format</dt><dd>{stats.childrens.format} (usually {formatCount(stats.childrens.range[0])} to {formatCount(stats.childrens.range[1])} words)</dd></div>
                  <div><dt>Length</dt><dd>{stats.childrens.fits ? 'Within the usual range for that format' : 'Outside the usual range for that format'}</dd></div>
                  {stats.childrens.rhymeShare !== null && <div><dt>Rhyme</dt><dd>{pct(stats.childrens.rhymeShare)} of line endings rhyme with a neighbour</dd></div>}
                  {stats.childrens.refrains.length > 0 && <div><dt>Refrains</dt><dd>{stats.childrens.refrains.slice(0, 5).map((r) => `"${r.text}" (${r.count} times)`).join(', ')}</dd></div>}
                </dl>
              </section>
            )}
          </>
        )}

        {tab === 'findings' && (
          <>
            <div className="filter-bar findings-filters">
              <select value={group} aria-label="Kind of finding" onChange={(e) => { setGroup(e.target.value as typeof group); setCategory('all'); }}>
                <option value="all">All kinds</option>
                {groupsPresent.map((g) => <option key={g} value={g}>{GROUP_LABELS[g]}</option>)}
              </select>
              <select value={category} aria-label="Type of finding" onChange={(e) => setCategory(e.target.value)} data-testid="filter-category">
                <option value="all">All types</option>
                {categoriesPresent.map(([value, count]) => <option key={value} value={value}>{CATEGORY_INFO[value as keyof typeof CATEGORY_INFO].label} ({count})</option>)}
              </select>
              <select value={severity} aria-label="Importance" onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="all">Any importance</option>
                {(['high', 'medium', 'low'] as const).map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
              </select>
              <select value={chapterFilter} aria-label="Chapter" onChange={(e) => setChapterFilter(e.target.value)}>
                <option value="all">All chapters</option>
                <option value="book">The book as a whole</option>
                {heads.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}
              </select>
              <label className="check-inline"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Show dismissed</label>
              <span className="grow" />
              <span className="result-count" data-testid="findings-count">{filtered.length} finding{filtered.length === 1 ? '' : 's'}</span>
            </div>
            {filtered.length === 0 && (
              <EmptyState icon={<Check size={26} />} title={issues.length ? 'Nothing matches these filters' : 'No findings'}>
                {issues.length ? 'Change the filters above to see more.' : 'The checks found nothing to flag.'}
              </EmptyState>
            )}
            <ul className="findings" data-testid="findings">
              {filtered.slice(0, shown).map((issue) => (
                <li key={issue.id} className={`finding ${issue.status === 'dismissed' ? 'is-dismissed' : ''}`} data-testid="finding" data-category={issue.category}>
                  <div className="finding-head">
                    <Pill tone={SEVERITY_TONE[issue.severity]}>{SEVERITY_LABELS[issue.severity]}</Pill>
                    <strong>{issue.title}</strong>
                    <span className="muted">{issue.chapterId ? titles.get(issue.chapterId) ?? '' : 'Whole book'}</span>
                    {issue.source === 'ai' && <span className="muted source-mark" title="Found by the AI model reading the text. Check it before acting on it."><Sparkles size={12} /> AI</span>}
                  </div>
                  {issue.quote && <blockquote className="finding-quote">{issue.quote}</blockquote>}
                  {issue.detail && <p>{issue.detail}</p>}
                  {issue.suggestion && <p className="finding-suggestion"><strong>Suggestion:</strong> {issue.suggestion}</p>}
                  <div className="finding-actions">
                    {issue.chapterId && titles.has(issue.chapterId) && (
                      <Button size="sm" icon={<MapPin size={14} />} onClick={() => void openBook(book.id, issue.chapterId!, { blockIndex: issue.blockIndex, quote: issue.quote })} data-testid="show-in-text">
                        Show in text
                      </Button>
                    )}
                    {issue.status === 'open'
                      ? <Button size="sm" variant="ghost" onClick={() => void setIssue(issue, 'dismissed')} data-testid="dismiss-finding">Dismiss</Button>
                      : <Button size="sm" variant="ghost" onClick={() => void setIssue(issue, 'open')}>Bring back</Button>}
                  </div>
                </li>
              ))}
            </ul>
            {filtered.length > shown && (
              <div className="row-start"><Button onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</Button></div>
            )}
          </>
        )}

        {tab === 'chapters' && (
          <div className="table-scroll">
            <table className="plain-table chapter-table" data-testid="chapter-table">
              <thead>
                <tr>
                  <th className="num">#</th><th>Chapter</th><th className="num">Words</th><th className="num">Avg. sentence</th><th className="num">Dialogue</th>
                  <th className="num">{stats.chapters.some((c) => c.grade !== null) ? 'Grade' : 'LIX'}</th><th className="num">Pace (0 to 100)</th>
                  {result && result.chapters.length > 0 && <><th className="num">{kind === 'fiction' ? 'Tension' : 'Engagement'}</th><th>What happens</th></>}
                  <th className="num">Findings</th>
                </tr>
              </thead>
              <tbody>
                {stats.chapters.map((c, i) => {
                  const note = notes.get(c.chapterId);
                  const count = open.filter((issue) => issue.chapterId === c.chapterId).length;
                  return (
                    <tr key={c.chapterId}>
                      <td className="num">{i + 1}</td>
                      <td>{c.title}</td>
                      <td className="num">{formatCount(c.words)}</td>
                      <td className="num">{c.avgSentenceWords}</td>
                      <td className="num">{pct(c.dialogueShare)}</td>
                      <td className="num">{c.grade ?? c.lix}</td>
                      <td className="num">{c.pace}</td>
                      {result && result.chapters.length > 0 && <><td className="num">{note ? `${note.tension} / 10` : ''}</td><td className="chapter-summary">{note?.summary ?? ''}</td></>}
                      <td className="num">
                        {count > 0 ? <button className="link-btn inline" onClick={() => { setChapterFilter(c.chapterId); setGroup('all'); setCategory('all'); setSeverity('all'); setTab('findings'); }}>{count}</button> : '0'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="fine-print">Pace is an estimate from sentence length, paragraph length and the share of dialogue. {result ? 'Tension and the summaries come from the AI reading each chapter.' : ''}</p>
          </div>
        )}

        {tab === 'bible' && <BibleEditor bookId={book.id} kind={kind} version={suggestionsVersion} />}

        {tab === 'report' && (
          <section className="card report-card">
            <h2><BookOpenText size={18} /> Analysis report</h2>
            <p>
              Everything on these tabs in one document that you can print, file or send to the author: the numbers, the charts, the assessment, the open findings with their locations, and the Book Bible.
              Dismissed findings are left out.
            </p>
            {busy && <p className="notice notice-info">The analysis is still running. A report saved now contains what has been found so far.</p>}
            {scriptProblem && <p className="notice notice-warning">The PDF font cannot print {scriptProblem}. Use the Word report for this book.</p>}
            <div className="row-start">
              <Button variant="primary" icon={<Download size={16} />} disabled={!!exporting} onClick={() => void download('pdf')} data-testid="report-pdf">{exporting === 'pdf' ? 'Creating the PDF…' : 'Save as PDF'}</Button>
              <Button icon={<Download size={16} />} disabled={!!exporting} onClick={() => void download('docx')} data-testid="report-docx">{exporting === 'docx' ? 'Creating the document…' : 'Save as Word document'}</Button>
            </div>
          </section>
        )}
      </div>

      {confirm !== null && (
        <ConfirmDialog
          title={confirm ? 'Run the full analysis again?' : 'Replace this analysis with a quick check?'}
          message={
            confirm
              ? 'The current findings and assessment are replaced by the new ones. Entries you edited in the Book Bible are kept.'
              : 'The quick check replaces the current analysis, including what the AI found. The Book Bible is kept.'
          }
          confirmLabel={confirm ? 'Run again' : 'Run the quick check'}
          onConfirm={() => void run(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
