import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import { EDIT_LEVELS, EDIT_STRENGTHS, type EditLevel, type EditStrength } from '../../core/edit/types';
import type { Book, ChapterHead } from '../../core/model/book';
import { languageName } from '../../core/text/language';
import { formatCount } from '../../core/text/words';
import { Button, Modal } from '../../ui/components';

type Scope = 'chapter' | 'selection' | 'book' | 'choose';

interface Props {
  book: Book;
  chapters: ChapterHead[];
  currentChapterId: string | null;
  /** Paragraphs selected in the editor, when the dialog is opened from there with a selection. */
  selection?: { from: number; to: number; words: number } | null;
  onClose(): void;
  onStarted(): void;
}

function duration(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${(seconds / 3600).toFixed(1)} hours`;
}

export function ImproveDialog({ book, chapters, currentChapterId, selection, onClose, onStarted }: Props) {
  const { setView, notify } = useApp();
  const { model, settings, startJob, hasEngine } = useAi();
  const current = chapters.find((c) => c.id === currentChapterId) ?? null;
  const [scope, setScope] = useState<Scope>(selection ? 'selection' : current ? 'chapter' : 'book');
  const [chosen, setChosen] = useState<Set<string>>(new Set(current ? [current.id] : []));
  const [level, setLevel] = useState<EditLevel>('proofread');
  const [strength, setStrength] = useState<EditStrength>('medium');
  const [useStyleGuide, setUseStyleGuide] = useState(true);
  const [starting, setStarting] = useState(false);

  const chapterIds = useMemo(() => {
    if (scope === 'book') return chapters.map((c) => c.id);
    if (scope === 'choose') return chapters.filter((c) => chosen.has(c.id)).map((c) => c.id);
    return current ? [current.id] : [];
  }, [scope, chapters, chosen, current]);

  const words = scope === 'selection' ? (selection?.words ?? 0) : chapters.filter((c) => chapterIds.includes(c.id)).reduce((n, c) => n + c.wordCount, 0);
  const speed = model.state === 'ready' ? model.speed : undefined;
  // A reply repeats the text and adds notes: roughly 1.6 tokens per word of manuscript.
  const estimate = speed ? duration((words * 1.6) / speed) : null;
  const canLoad = hasEngine && !!settings.lastModel;
  const ready = model.state === 'ready' || canLoad;

  const start = async () => {
    setStarting(true);
    const job = await startJob({
      bookId: book.id, level, strength, useStyleGuide,
      scope: { chapterIds, ...(scope === 'selection' && selection ? { range: { from: selection.from, to: selection.to } } : {}) },
    });
    setStarting(false);
    if (job) {
      notify('success', 'Editing has started. Suggestions appear in Review as they are ready.');
      onStarted();
      setView('review');
    }
  };

  return (
    <Modal
      title="Improve with AI"
      size="md"
      onClose={onClose}
      footer={
        <>
          <span className="push-left muted">
            {formatCount(words)} words{estimate ? ` · ${estimate}` : ''}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Sparkles size={16} />} disabled={starting || !ready || !chapterIds.length || !words} onClick={() => void start()} data-testid="improve-start">
            {starting ? 'Starting…' : 'Start'}
          </Button>
        </>
      }
    >
      <div className="improve">
        <fieldset>
          <legend>What to edit</legend>
          {selection && (
            <label className="radio-row">
              <input type="radio" name="scope" checked={scope === 'selection'} onChange={() => setScope('selection')} />
              <span>The selected paragraphs <span className="muted">({formatCount(selection.words)} words)</span></span>
            </label>
          )}
          {current && (
            <label className="radio-row">
              <input type="radio" name="scope" checked={scope === 'chapter'} onChange={() => setScope('chapter')} />
              <span>This chapter: {current.title} <span className="muted">({formatCount(current.wordCount)} words)</span></span>
            </label>
          )}
          <label className="radio-row">
            <input type="radio" name="scope" checked={scope === 'book'} onChange={() => setScope('book')} />
            <span>The whole book <span className="muted">({formatCount(book.wordCount)} words)</span></span>
          </label>
          <label className="radio-row">
            <input type="radio" name="scope" checked={scope === 'choose'} onChange={() => setScope('choose')} />
            <span>Chosen chapters</span>
          </label>
          {scope === 'choose' && (
            <div className="chapter-picker">
              {chapters.map((c) => (
                <label key={c.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(c.id);
                      else next.delete(c.id);
                      setChosen(next);
                    }}
                  />
                  <span>{c.title} <span className="muted">({formatCount(c.wordCount)})</span></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Kind of edit</legend>
          {EDIT_LEVELS.map((l) => (
            <label key={l.value} className="radio-row">
              <input type="radio" name="level" checked={level === l.value} onChange={() => setLevel(l.value)} />
              <span><strong>{l.label}.</strong> {l.description}</span>
            </label>
          ))}
          <p className="fine-print">Developmental editing and "Expand and lengthen" arrive in Milestone 4.</p>
        </fieldset>

        <fieldset>
          <legend>Strength</legend>
          <div className="segmented" role="group" aria-label="Strength">
            {EDIT_STRENGTHS.map((s) => (
              <button key={s.value} type="button" className={strength === s.value ? 'is-active' : ''} onClick={() => setStrength(s.value)} title={s.description}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="fine-print">{EDIT_STRENGTHS.find((s) => s.value === strength)?.description}</p>
        </fieldset>

        <div className="improve-context">
          <p>
            The editor is told the book is {book.bookType === 'children' ? "a children's book" : book.bookType === 'nonfiction' ? 'non-fiction' : 'fiction'}
            {book.language !== 'und' ? ` in ${languageName(book.language)}` : ''}
            {book.instructions.trim() ? ', and follows your instructions for this book.' : '.'}
          </p>
          {settings.styleGuide.trim() && (
            <label className="check-row">
              <input type="checkbox" checked={useStyleGuide} onChange={(e) => setUseStyleGuide(e.target.checked)} />
              <span>Also follow my style guide</span>
            </label>
          )}
        </div>

        {model.state === 'ready' ? (
          <p className="notice notice-info">Using {model.name}{model.speed ? ` (${Math.round(model.speed)} tokens per second)` : ''}. The book is not changed: you review every suggestion first.</p>
        ) : canLoad ? (
          <p className="notice notice-info">The AI model will be loaded first, which can take up to a minute.</p>
        ) : (
          <p className="notice notice-warning">
            No AI model is set up yet.{' '}
            <button className="link-btn" onClick={() => { onClose(); setView('settings'); }}>Open Settings to set one up</button>
          </p>
        )}
      </div>
    </Modal>
  );
}
