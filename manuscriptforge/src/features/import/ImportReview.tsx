import { AlertTriangle, ArrowUpToLine, Scissors } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import {
  detectChapters,
  mergeChapterIntoPrevious,
  splitChapterAt,
  titleFromFilename,
  type ImportResult,
  type SplitStrategy,
} from '../../core/import';
import type { ChapterDraft } from '../../core/model/blocks';
import { BOOK_TYPES, type BookCategory, type BookType } from '../../core/model/book';
import { countBlockWords, formatCount } from '../../core/text/words';
import { Button, Field, Modal } from '../../ui/components';
import { BlockView } from '../editor/BlocksView';
import { GENRE_SUGGESTIONS, LANGUAGE_OPTIONS } from '../library/BookDetailsDialog';

export interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  result: ImportResult;
  category: BookCategory;
}

const STRATEGY_LABELS: Record<Exclude<SplitStrategy, 'auto'>, string> = {
  headings: 'At headings',
  patterns: 'At "Chapter 1" style lines',
  pagebreaks: 'At page breaks',
  none: 'Do not split',
};

const AUTO_LABELS: Record<Exclude<SplitStrategy, 'auto'>, string> = {
  headings: 'at headings',
  patterns: 'at "Chapter 1" lines',
  pagebreaks: 'at page breaks',
  none: 'no chapters found',
};

export function ImportReview({ pending, onDone, onCancel }: { pending: PendingImport; onDone(bookId: string): void; onCancel(): void }) {
  const { library, refreshBooks, notify, reportError } = useApp();
  const { startAnalysis, canRunAi } = useAi();
  const [fullAnalysis, setFullAnalysis] = useState(false);
  const { result } = pending;
  const hints = useMemo(() => ({ title: result.meta.title, author: result.meta.author }), [result]);
  const initial = useMemo(() => detectChapters(result.blocks, 'auto', hints), [result, hints]);

  const [strategy, setStrategy] = useState<SplitStrategy>('auto');
  const [chapters, setChapters] = useState<ChapterDraft[]>(initial.chapters);
  const [selected, setSelected] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: result.meta.title || initial.bookTitle || titleFromFilename(pending.fileName),
    author: result.meta.author ?? '',
    category: pending.category,
    bookType: 'fiction' as BookType,
    genre: '',
    language: result.meta.language ?? 'und',
    tags: '',
    authorContact: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const words = useMemo(() => chapters.map((c) => countBlockWords(c.blocks)), [chapters]);
  const totalWords = words.reduce((a, b) => a + b, 0);
  const current = chapters[Math.min(selected, chapters.length - 1)];

  const changeStrategy = (next: SplitStrategy) => {
    setStrategy(next);
    setChapters(detectChapters(result.blocks, next, hints).chapters);
    setSelected(0);
  };

  const save = async () => {
    setSaving(true);
    try {
      const book = await library.createBook({
        category: form.category,
        title: form.title,
        author: form.author,
        bookType: form.bookType,
        genre: form.genre,
        language: form.language,
        tags: form.tags.split(','),
        chapters,
        authorContact: form.authorContact,
        source: { name: pending.fileName, format: result.format, bytes: pending.bytes },
      });
      await library.addLog('info', 'import', `Imported "${book.title}" from ${pending.fileName}`, `${chapters.length} chapters, ${totalWords} words`);
      await refreshBooks();
      notify('success', `"${book.title}" was added to the library.`);
      onDone(book.id);
      // Every new book gets the quick check at once, so the Analysis screen is never empty.
      // A failure here is reported by startAnalysis and does not undo the import.
      void startAnalysis(book.id, fullAnalysis && canRunAi, true);
    } catch (e) {
      reportError('import', e, 'The book could not be saved.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Review import"
      size="full"
      dismissable={false}
      onClose={onCancel}
      footer={
        <>
          <span className="push-left muted">
            {formatCount(totalWords)} words in {chapters.length} chapter{chapters.length === 1 ? '' : 's'}. The original file is kept untouched.
          </span>
          <label className="check-inline" title={canRunAi ? 'The AI reads the whole book in the background and builds the Book Bible. You can pause it at any time.' : 'Set up an AI model under Settings to use this.'}>
            <input type="checkbox" checked={fullAnalysis && canRunAi} disabled={!canRunAi} onChange={(e) => setFullAnalysis(e.target.checked)} data-testid="import-full-analysis" />
            Start the full AI analysis after import
          </label>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !form.title.trim()} data-testid="import-confirm">
            {saving ? 'Adding…' : 'Add to library'}
          </Button>
        </>
      }
    >
      <div className="import-layout">
        <section className="import-details">
          <h3>Book details</h3>
          <Field label="Title">
            <input value={form.title} onChange={(e) => set('title', e.target.value)} data-autofocus />
          </Field>
          <Field label="Author">
            <input value={form.author} onChange={(e) => set('author', e.target.value)} />
          </Field>
          <Field label="Shelf">
            <select value={form.category} onChange={(e) => set('category', e.target.value as BookCategory)}>
              <option value="mine">My Books</option>
              <option value="submission">New Author Submissions</option>
            </select>
          </Field>
          {form.category === 'submission' && (
            <Field label="Author contact">
              <input value={form.authorContact} onChange={(e) => set('authorContact', e.target.value)} placeholder="Email or phone" />
            </Field>
          )}
          <div className="field-row">
            <Field label="Book type">
              <select value={form.bookType} onChange={(e) => set('bookType', e.target.value as BookType)}>
                {BOOK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Language">
              <select value={form.language} onChange={(e) => set('language', e.target.value)}>
                <option value="und">Unknown</option>
                {LANGUAGE_OPTIONS.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Genre">
            <input value={form.genre} list="import-genres" onChange={(e) => set('genre', e.target.value)} />
          </Field>
          <datalist id="import-genres">
            {GENRE_SUGGESTIONS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <Field label="Tags" hint="Separate tags with commas.">
            <input value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </Field>
          {result.warnings.length > 0 && (
            <div className="notice notice-warning">
              <AlertTriangle size={16} />
              <ul>
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="import-chapters">
          <div className="import-chapters-head">
            <h3>Chapters</h3>
            <select value={strategy} onChange={(e) => changeStrategy(e.target.value as SplitStrategy)} aria-label="How to split chapters">
              <option value="auto">Auto: {AUTO_LABELS[initial.strategy]}</option>
              {(Object.keys(STRATEGY_LABELS) as Exclude<SplitStrategy, 'auto'>[]).map((key) => (
                <option key={key} value={key}>{STRATEGY_LABELS[key]}</option>
              ))}
            </select>
          </div>
          <ol className="import-chapter-list">
            {chapters.map((chapter, index) => (
              <li key={index} className={index === selected ? 'is-active' : ''} onClick={() => setSelected(index)}>
                <span className="chapter-index">{index + 1}</span>
                <input
                  value={chapter.title}
                  aria-label={`Title of chapter ${index + 1}`}
                  onFocus={() => setSelected(index)}
                  onChange={(e) => setChapters((list) => list.map((c, i) => (i === index ? { ...c, title: e.target.value } : c)))}
                />
                <span className="chapter-words">{formatCount(words[index])}</span>
                <button
                  className="icon-btn"
                  title="Join this chapter onto the one above"
                  aria-label={`Join chapter ${index + 1} onto the one above`}
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChapters((list) => mergeChapterIntoPrevious(list, index));
                    setSelected(Math.max(0, index - 1));
                  }}
                >
                  <ArrowUpToLine size={15} />
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="import-preview">
          <div className="import-preview-head">
            <h3>{current?.title || 'Preview'}</h3>
            <span className="muted">Hover between paragraphs to start a new chapter there.</span>
          </div>
          <div className="import-preview-body manuscript manuscript-readonly">
            {current?.blocks.length === 0 && <p className="muted">This chapter has no text.</p>}
            {current?.blocks.map((block, index) => (
              <div className="ms-block" key={index}>
                {index > 0 && (
                  <button
                    className="split-here"
                    onClick={() => {
                      setChapters((list) => splitChapterAt(list, selected, index));
                      setSelected(selected + 1);
                    }}
                  >
                    <Scissors size={13} /> Start a new chapter here
                  </button>
                )}
                <div className="ms-content">
                  <BlockView block={block} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
