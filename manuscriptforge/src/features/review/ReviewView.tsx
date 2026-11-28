import { AlertTriangle, Check, Pause, Pencil, Play, RefreshCw, Sparkles, Square, Wand2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import { CHANGE_KIND_LABELS, changeStats, type ChangeKind, type Decision, type Granularity } from '../../core/edit/diff';
import { EDIT_LEVELS, FLAG_LABELS } from '../../core/edit/types';
import type { Book, ChapterHead } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import type { EditJob, Suggestion } from '../../data/edits';
import { Button, EmptyState, Field, Modal, Pill, Spinner } from '../../ui/components';
import { ImproveDialog } from '../ai/ImproveDialog';
import { DiffParagraph } from './DiffParagraph';

const KIND_ORDER: ChangeKind[] = ['spelling', 'punctuation', 'capitalization', 'spacing', 'wording', 'cut', 'addition', 'rewrite', 'formatting'];

function JobStrip({ job }: { job: EditJob }) {
  const { runner, runnerState, edits, refreshJobs } = useAi();
  const active = job.status === 'running' || job.status === 'queued';
  const percent = job.words ? Math.round((job.wordsDone / job.words) * 100) : 0;
  const level = EDIT_LEVELS.find((l) => l.value === job.level)?.label ?? job.level;
  const speed = job.ms > 0 && job.tokens > 0 ? job.tokens / (job.ms / 1000) : 0;
  const remaining = speed > 0 && job.wordsDone > 0 ? ((job.words - job.wordsDone) / job.wordsDone) * (job.ms / 1000) : 0;
  return (
    <div className={`job-strip job-${job.status}`} data-testid="job-strip" data-status={job.status}>
      <div className="job-line">
        <strong>
          {level} · {job.strength}
        </strong>
        <span className="muted">
          {job.status === 'running' && `Working: passage ${Math.min(job.tasksDone + job.tasksFailed + 1, job.tasks)} of ${job.tasks}`}
          {job.status === 'queued' && 'Waiting to start'}
          {job.status === 'paused' && `On hold after ${job.tasksDone} of ${job.tasks} passages`}
          {job.status === 'done' && `Finished: ${job.suggestions} suggestion${job.suggestions === 1 ? '' : 's'} from ${formatCount(job.words)} words`}
          {job.status === 'cancelled' && `Stopped after ${job.tasksDone} of ${job.tasks} passages`}
          {active && remaining > 20 && ` · about ${remaining > 90 ? `${Math.round(remaining / 60)} min` : `${Math.round(remaining)} s`} left`}
          {job.model && ` · ${job.model}`}
        </span>
        <span className="grow" />
        {active && <Button size="sm" icon={<Pause size={14} />} onClick={() => void runner.pause(job.id)}>Pause</Button>}
        {job.status === 'paused' && <Button size="sm" variant="primary" icon={<Play size={14} />} onClick={() => void runner.resume(job.id)}>Resume</Button>}
        {(active || job.status === 'paused') && <Button size="sm" icon={<Square size={13} />} onClick={() => void runner.cancel(job.id)}>Stop</Button>}
        {job.status === 'done' && job.tasksFailed > 0 && (
          <Button
            size="sm"
            icon={<RefreshCw size={14} />}
            onClick={async () => {
              await edits.retryFailed(job.id);
              await refreshJobs();
              runner.kick();
            }}
          >
            Try {job.tasksFailed} failed passage{job.tasksFailed === 1 ? '' : 's'} again
          </Button>
        )}
      </div>
      {(active || job.status === 'paused') && (
        <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Editing progress">
          <div style={{ width: `${percent}%` }} />
        </div>
      )}
      {job.error && job.status === 'paused' && <p className="job-problem"><AlertTriangle size={14} /> {job.error}</p>}
      {job.skipped > 0 && job.status === 'done' && (
        <p className="fine-print">{job.skipped} paragraph{job.skipped === 1 ? ' was' : 's were'} left as written because the model's reply for them could not be trusted.</p>
      )}
      {job.status === 'running' && runnerState.jobId === job.id && runnerState.preview && <p className="job-preview">{runnerState.preview.replace(/<[^>]*>?/g, ' ').slice(-220)}</p>}
    </div>
  );
}

function SuggestionCard({
  suggestion, granularity, mode, kinds, onDecide, onEdit, onRedo, onDismiss,
}: {
  suggestion: Suggestion;
  granularity: Granularity;
  mode: 'inline' | 'side';
  kinds: ChangeKind[] | null;
  onDecide(hunks: number[], decision: Decision | null): void;
  onEdit(): void;
  onRedo(): void;
  onDismiss(): void;
}) {
  if (suggestion.status === 'stale') {
    return (
      <article className="suggestion is-stale">
        <p className="muted">This paragraph was changed by hand after the suggestion was made, so the suggestion no longer applies.</p>
        <Button size="sm" onClick={onDismiss}>Dismiss</Button>
      </article>
    );
  }
  const pending = suggestion.hunks.filter((h) => suggestion.decisions[h.index] === undefined).map((h) => h.index);
  const all = suggestion.hunks.map((h) => h.index);
  const common = { original: suggestion.original, revised: suggestion.revised, hunks: suggestion.hunks, decisions: suggestion.decisions, granularity, kinds };
  return (
    <article className={`suggestion ${suggestion.status === 'resolved' ? 'is-resolved' : ''}`} data-testid="suggestion">
      {mode === 'inline' ? (
        <DiffParagraph {...common} mode="inline" onDecide={onDecide} />
      ) : (
        <div className="side-by-side">
          <DiffParagraph {...common} mode="old" />
          <DiffParagraph {...common} mode="new" onDecide={onDecide} />
        </div>
      )}
      <footer className="suggestion-foot">
        <span className="why">
          <strong>Why:</strong> {suggestion.note || 'Edited'}
        </span>
        {suggestion.flags.map((flag) => (
          <span className="flag" key={flag}>
            <AlertTriangle size={13} /> {FLAG_LABELS[flag]}
          </span>
        ))}
        <span className="grow" />
        {pending.length > 0 ? (
          <>
            <Button size="sm" icon={<Check size={14} />} onClick={() => onDecide(pending, 'accept')}>Accept paragraph</Button>
            <Button size="sm" icon={<X size={14} />} onClick={() => onDecide(pending, 'reject')}>Reject</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => onDecide(all, null)}>Reopen</Button>
        )}
        <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="ghost" icon={<Wand2 size={14} />} onClick={onRedo}>Redo with a note</Button>
      </footer>
    </article>
  );
}

export function ReviewView({ book }: { book: Book }) {
  const { library, reportError, notify, refreshBooks } = useApp();
  const { edits, jobs, suggestionsVersion, touchSuggestions, provider } = useAi();
  const [heads, setHeads] = useState<ChapterHead[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('word');
  const [mode, setMode] = useState<'inline' | 'side'>('inline');
  const [kind, setKind] = useState<ChangeKind | ''>('');
  const [showDecided, setShowDecided] = useState(false);
  const [skipFlagged, setSkipFlagged] = useState(true);
  const [improve, setImprove] = useState(false);
  const [editing, setEditing] = useState<Suggestion | null>(null);
  const [redoing, setRedoing] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const bookJobs = useMemo(() => jobs.filter((j) => j.bookId === book.id), [jobs, book.id]);
  const shownJobs = bookJobs.filter((j, index) => j.status !== 'done' && j.status !== 'cancelled' ? true : index === 0);

  const load = useCallback(async () => {
    try {
      const [chapterHeads, counts] = await Promise.all([library.listChapters(book.id), edits.pendingByChapter(book.id)]);
      setHeads(chapterHeads);
      setPending(counts);
      const target = chapterId && chapterHeads.some((h) => h.id === chapterId) ? chapterId : (chapterHeads.find((h) => counts[h.id])?.id ?? chapterHeads[0]?.id ?? null);
      setChapterId(target);
      setSuggestions(target ? await edits.listSuggestions(book.id, target) : []);
    } catch (e) {
      reportError('review', e, 'The suggestions could not be loaded.');
    }
  }, [library, edits, book.id, chapterId, reportError]);

  useEffect(() => {
    void load();
    // Reload when the chapter changes or when suggestions change anywhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, chapterId, suggestionsVersion]);

  const kinds = kind ? [kind] : null;
  const visible = useMemo(
    () =>
      (suggestions ?? []).filter((s) => {
        if (s.status === 'stale') return true;
        if (!showDecided && s.status === 'resolved') return false;
        return !kind || s.hunks.some((h) => h.kind === kind);
      }),
    [suggestions, showDecided, kind],
  );

  const totals = useMemo(() => {
    const all = (suggestions ?? []).filter((s) => s.status !== 'stale');
    const hunks = all.flatMap((s) => s.hunks.map((h) => ({ hunk: h, decision: s.decisions[h.index] })));
    const stats = changeStats(hunks.filter((h) => h.decision !== 'reject').map((h) => h.hunk));
    const byKind = new Map<ChangeKind, number>();
    for (const { hunk, decision } of hunks) if (decision === undefined) byKind.set(hunk.kind, (byKind.get(hunk.kind) ?? 0) + 1);
    return {
      pending: hunks.filter((h) => h.decision === undefined).length,
      accepted: hunks.filter((h) => h.decision === 'accept').length,
      rejected: hunks.filter((h) => h.decision === 'reject').length,
      ...stats,
      byKind,
    };
  }, [suggestions]);

  const after = async (work: Promise<{ stale: string[] } | void>) => {
    try {
      const result = await work;
      if (result && result.stale.length) notify('info', 'A paragraph was changed by hand since the suggestion was made, so that suggestion was set aside.');
      touchSuggestions();
      void refreshBooks();
    } catch (e) {
      reportError('review', e, 'The change could not be applied.');
    }
  };

  const decide = (suggestion: Suggestion, hunks: number[], decision: Decision | null) =>
    void after(edits.decide([{ suggestionId: suggestion.id, changes: Object.fromEntries(hunks.map((h) => [h, decision])) }]));

  const decideAll = async (decision: Decision) => {
    if (!chapterId) return;
    setBusy(true);
    try {
      const result = await edits.decideAll(book.id, chapterId, decision, { kinds: kinds ?? undefined, skipFlagged: decision === 'accept' && skipFlagged });
      notify('success', `${result.changed} change${result.changed === 1 ? '' : 's'} ${decision === 'accept' ? 'accepted' : 'rejected'}.`);
      touchSuggestions();
      void refreshBooks();
    } catch (e) {
      reportError('review', e, 'The changes could not be applied.');
    } finally {
      setBusy(false);
    }
  };

  const totalPending = Object.values(pending).reduce((a, b) => a + b, 0);
  const chapter = heads.find((h) => h.id === chapterId);

  return (
    <div className="view review-view">
      <header className="view-header">
        <div>
          <h1>Review</h1>
          <p className="view-sub">
            {book.title}. Nothing changes in the book until you accept it, and every decision can be undone.
          </p>
        </div>
        <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => setImprove(true)}>Improve with AI</Button>
      </header>

      {shownJobs.length > 0 && <div className="job-strips">{shownJobs.slice(0, 3).map((job) => <JobStrip key={job.id} job={job} />)}</div>}

      <div className="review-body">
        <nav className="review-chapters" aria-label="Chapters">
          <div className="panel-head">
            <span>Chapters</span>
            <span className="muted">{totalPending} to review</span>
          </div>
          <ol>
            {heads.map((head) => (
              <li key={head.id}>
                <button className={head.id === chapterId ? 'is-active' : ''} onClick={() => setChapterId(head.id)}>
                  <span className="chapter-title">{head.title}</span>
                  {pending[head.id] ? <span className="count-badge">{pending[head.id]}</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className="review-main">
          <div className="review-toolbar">
            <div className="segmented" role="group" aria-label="View">
              <button className={mode === 'inline' ? 'is-active' : ''} onClick={() => setMode('inline')}>Inline</button>
              <button className={mode === 'side' ? 'is-active' : ''} onClick={() => setMode('side')}>Side by side</button>
            </div>
            <div className="segmented" role="group" aria-label="Level of detail">
              {(['word', 'sentence', 'paragraph'] as Granularity[]).map((g) => (
                <button key={g} className={granularity === g ? 'is-active' : ''} onClick={() => setGranularity(g)}>
                  {g === 'word' ? 'Words' : g === 'sentence' ? 'Sentences' : 'Paragraphs'}
                </button>
              ))}
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value as ChangeKind | '')} aria-label="Filter by type of change">
              <option value="">All types of change</option>
              {KIND_ORDER.filter((k) => totals.byKind.get(k) || k === kind).map((k) => (
                <option key={k} value={k}>
                  {CHANGE_KIND_LABELS[k]} ({totals.byKind.get(k) ?? 0})
                </option>
              ))}
            </select>
            <label className="check-inline">
              <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} /> Show decided
            </label>
            <span className="grow" />
            <label className="check-inline" title="Changes with a warning are left for you to check one by one.">
              <input type="checkbox" checked={skipFlagged} onChange={(e) => setSkipFlagged(e.target.checked)} /> Keep warnings for me
            </label>
            <Button size="sm" disabled={busy || !totals.pending} icon={<Check size={14} />} onClick={() => void decideAll('accept')}>
              Accept all{kind ? ` ${CHANGE_KIND_LABELS[kind].toLowerCase()}` : ''}
            </Button>
            <Button size="sm" disabled={busy || !totals.pending} icon={<X size={14} />} onClick={() => void decideAll('reject')}>
              Reject all{kind ? ` ${CHANGE_KIND_LABELS[kind].toLowerCase()}` : ''}
            </Button>
          </div>

          <div className="review-scroll">
            {chapter && (
              <div className="review-chapter-head">
                <h2>{chapter.title}</h2>
                <span className="muted" data-testid="review-stats">
                  {totals.pending} to review · {totals.accepted} accepted · {totals.rejected} rejected
                  {totals.changes > 0 && ` · +${formatCount(totals.wordsAdded)} / −${formatCount(totals.wordsRemoved)} words`}
                </span>
              </div>
            )}
            {suggestions === null ? (
              <Spinner label="Loading suggestions…" />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={30} />}
                title={suggestions.length ? 'Everything here is decided' : 'Nothing to review in this chapter'}
                action={suggestions.length ? <Button onClick={() => setShowDecided(true)}>Show decided changes</Button> : <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => setImprove(true)}>Improve with AI</Button>}
              >
                {suggestions.length
                  ? 'You have accepted or rejected every suggestion in this chapter.'
                  : 'Start a proofread or a line edit. The suggestions appear here as tracked changes for you to accept or reject.'}
              </EmptyState>
            ) : (
              <div className="suggestions manuscript">
                {visible.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    granularity={granularity}
                    mode={mode}
                    kinds={kinds}
                    onDecide={(hunks, decision) => decide(s, hunks, decision)}
                    onEdit={() => {
                      setDraft(s.revised);
                      setEditing(s);
                    }}
                    onRedo={() => {
                      setDraft('');
                      setRedoing(s);
                    }}
                    onDismiss={() => void after(edits.dismiss(s.id))}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {improve && <ImproveDialog book={book} chapters={heads} currentChapterId={chapterId} onClose={() => setImprove(false)} onStarted={() => setImprove(false)} />}

      {editing && (
        <Modal
          title="Edit the proposed text"
          size="md"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" disabled={!draft.trim()} onClick={() => { const target = editing; setEditing(null); void after(edits.revise(target.id, draft.trim(), 'Edited by hand', [])); }}>
                Use this text
              </Button>
            </>
          }
        >
          <Field label="Proposed paragraph" hint="Formatting: *italic*, **bold**. Your version replaces the AI's proposal, and you still accept or reject it afterwards.">
            <textarea rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} className="manuscript-input" />
          </Field>
        </Modal>
      )}

      {redoing && (
        <Modal
          title="Redo this paragraph"
          size="sm"
          onClose={() => !busy && setRedoing(null)}
          footer={
            <>
              <Button disabled={busy} onClick={() => setRedoing(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={busy || !draft.trim() || !provider}
                onClick={async () => {
                  const target = redoing;
                  const job = bookJobs.find((j) => j.id === target.jobId);
                  setBusy(true);
                  try {
                    await edits.regenerate(target.id, provider!, draft, job?.options ?? { level: target.level, strength: 'medium', language: book.language, bookType: book.bookType, instructions: book.instructions });
                    touchSuggestions();
                    setRedoing(null);
                  } catch (e) {
                    reportError('review', e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Working…' : 'Redo'}
              </Button>
            </>
          }
        >
          <Field label="What should be different?" hint={provider ? 'For example: "less formal", "keep my original wording for the first sentence", "shorter".' : 'Load an AI model in Settings first.'}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="less formal" />
          </Field>
          {busy && <Spinner label="The model is rewriting this paragraph…" />}
        </Modal>
      )}
    </div>
  );
}

/** Small badge used elsewhere to show how many suggestions wait for a decision. */
export function PendingPill({ count }: { count: number }) {
  return count ? <Pill tone="accent">{count} to review</Pill> : null;
}
