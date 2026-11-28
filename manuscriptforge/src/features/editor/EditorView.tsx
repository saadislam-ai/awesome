import { Check, CircleAlert, Maximize2, Minimize2, Pencil, Scissors } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { BOOK_STATUSES, type Book, type BookStatus, type Chapter, type ChapterHead } from '../../core/model/book';
import { languageName, RTL_LANGUAGES } from '../../core/text/language';
import { formatCount } from '../../core/text/words';
import { Button, ConfirmDialog, IconButton, Spinner } from '../../ui/components';
import { MOD } from '../../ui/format';
import { BookDetailsDialog } from '../library/BookDetailsDialog';
import { ChapterList } from './ChapterList';
import { RichEditor, type RichEditorHandle } from './RichEditor';
import { SidePanel } from './SidePanel';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 700;
const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

export function EditorView({ book }: { book: Book }) {
  const { library, platform, refreshBooks, reportError, notify, focusMode, setFocusMode, pendingChapterId, clearPendingChapter } = useApp();
  const [heads, setHeads] = useState<ChapterHead[]>([]);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loadCount, setLoadCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [liveWords, setLiveWords] = useState<number | null>(null);
  const [versionsKey, setVersionsKey] = useState(0);
  const [snapshotRequest, setSnapshotRequest] = useState(0);
  const [details, setDetails] = useState(false);
  const [deleting, setDeleting] = useState<ChapterHead | null>(null);

  const editorRef = useRef<RichEditorHandle>(null);
  const chapterRef = useRef<Chapter | null>(null);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  chapterRef.current = chapter;

  /**
   * Writes pending edits to the library. The text is read from the editor
   * right away (so this also works while the screen is being closed), and the
   * writes themselves run one after another, never in parallel.
   */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    const current = chapterRef.current;
    const editor = editorRef.current;
    if (dirty.current && current && editor) {
      dirty.current = false;
      const blocks = editor.getBlocks();
      setSaveState('saving');
      queue.current = queue.current.then(async () => {
        try {
          const saved = await library.saveChapter(current.id, blocks);
          setHeads((list) => list.map((h) => (h.id === current.id ? { ...h, wordCount: saved.wordCount } : h)));
          setSaveState(dirty.current ? 'dirty' : 'saved');
          void refreshBooks();
        } catch (e) {
          dirty.current = true;
          setSaveState('error');
          reportError('editor', e, 'Your latest changes could not be saved.');
        }
      });
    }
    return queue.current;
  }, [library, refreshBooks, reportError]);

  const onChange = useCallback(() => {
    dirty.current = true;
    setSaveState('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }, [flush]);

  const loadChapter = useCallback(
    async (id: string) => {
      await flush();
      const loaded = await library.getChapter(id);
      if (!loaded) return;
      setChapter(loaded);
      setLiveWords(null);
      setLoadCount((n) => n + 1);
    },
    [flush, library],
  );

  /**
   * Refreshes the chapter list after a structural change. The open chapter is
   * only reloaded when it has to be, so renaming or moving a chapter does not
   * disturb the cursor or the undo history.
   */
  const reloadHeads = useCallback(
    async (openId?: string | null, reloadText = false) => {
      const list = await library.listChapters(book.id);
      setHeads(list);
      const currentId = chapterRef.current?.id;
      const same = list.find((h) => h.id === currentId);
      const target = list.find((h) => h.id === openId) ?? same ?? list[0];
      if (target && (target.id !== currentId || reloadText || openId)) await loadChapter(target.id);
      else if (same) setChapter((c) => (c && c.id === same.id ? { ...c, title: same.title, position: same.position } : c));
      await refreshBooks();
    },
    [library, book.id, loadChapter, refreshBooks],
  );

  const autoSnapshot = useCallback(async () => {
    try {
      await flush();
      const made = await library.createSnapshot(book.id, 'Auto-save', 'auto');
      if (made) setVersionsKey((k) => k + 1);
    } catch (e) {
      reportError('versions', e, 'An automatic snapshot could not be saved.');
    }
  }, [flush, library, book.id, reportError]);

  // Open the book: load its chapters, and protect any work that was never put in a snapshot.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await library.listChapters(book.id);
        if (cancelled) return;
        setHeads(list);
        const first = list.find((h) => h.id === pendingChapterId) ?? list[0];
        clearPendingChapter();
        if (first) {
          const loaded = await library.getChapter(first.id);
          if (!cancelled && loaded) {
            setChapter(loaded);
            setLoadCount((n) => n + 1);
          }
        }
        const made = await library.createSnapshot(book.id, 'Auto-save', 'auto');
        if (made && !cancelled) setVersionsKey((k) => k + 1);
      } catch (e) {
        reportError('editor', e, 'This book could not be opened.');
      }
    })();
    const interval = window.setInterval(() => void autoSnapshot(), AUTO_SNAPSHOT_INTERVAL_MS);
    // Closing the window: save the last keystrokes and keep a snapshot of the session.
    const stopWatchingClose = platform.onBeforeClose(async () => {
      await flush();
      await library.createSnapshot(book.id, 'Auto-save', 'auto').catch(() => undefined);
    });
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      stopWatchingClose();
    };
    // The effect is tied to the book only; the helpers it uses are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Leaving the book: save, then keep a snapshot of this session's work. This
  // runs as a layout effect so the editor still exists when its text is read.
  useLayoutEffect(
    () => () => {
      void flush().then(() => library.createSnapshot(book.id, 'Auto-save', 'auto').catch(() => undefined));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.id],
  );

  const run = useCallback(
    async (action: () => Promise<string | null | void>, failure: string) => {
      try {
        await flush();
        const openId = await action();
        await reloadHeads(openId ?? undefined);
      } catch (e) {
        reportError('editor', e, failure);
      }
    },
    [flush, reloadHeads, reportError],
  );

  const splitHere = () => {
    const current = chapterRef.current;
    const editor = editorRef.current;
    if (!current || !editor) return;
    const index = editor.cursorBlockIndex();
    if (index <= 0) {
      notify('info', 'Place the cursor in the paragraph where the new chapter should start. It cannot be the first paragraph.');
      return;
    }
    void run(() => library.splitChapter(current.id, index), 'The chapter could not be split.');
  };

  const step = useCallback(
    (direction: -1 | 1) => {
      const index = heads.findIndex((h) => h.id === chapterRef.current?.id);
      const next = heads[index + direction];
      if (next) void loadChapter(next.id);
    },
    [heads, loadChapter],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && e.shiftKey && key === 's') {
        e.preventDefault();
        setFocusMode(false);
        setSnapshotRequest((n) => n + 1);
      } else if (mod && key === 's') {
        e.preventDefault();
        void flush().then(() => notify('success', 'All changes are saved.'));
      } else if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        setFocusMode(!focusMode);
      } else if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        step(1);
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush, notify, focusMode, setFocusMode, step]);

  const totalWords = heads.reduce((n, h) => n + (h.id === chapter?.id && liveWords !== null ? liveWords : h.wordCount), 0);
  const rtl = RTL_LANGUAGES.has(book.language);

  return (
    <div className={`view editor-view ${focusMode ? 'is-focus' : ''}`}>
      {!focusMode && (
        <header className="editor-header">
          <div className="editor-book">
            <h1 title={book.title}>{book.title}</h1>
            <span className="muted">
              {book.author || 'Unknown author'}
              {book.language !== 'und' && ` · ${languageName(book.language)}`}
            </span>
          </div>
          <span className="grow" />
          <span className={`save-state save-${saveState}`} role="status" data-testid="save-state">
            {saveState === 'saved' && <><Check size={14} /> Saved</>}
            {saveState === 'dirty' && 'Unsaved changes'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'error' && <><CircleAlert size={14} /> Not saved</>}
          </span>
          <span className="word-total" data-testid="word-total">{formatCount(totalWords)} words</span>
          <select
            value={book.status}
            aria-label="Book status"
            onChange={async (e) => {
              await library.updateBook(book.id, { status: e.target.value as BookStatus });
              await refreshBooks();
            }}
          >
            {BOOK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <Button size="sm" icon={<Pencil size={14} />} onClick={() => setDetails(true)}>Details</Button>
        </header>
      )}

      <div className="editor-body">
        {!focusMode && (
          <ChapterList
            heads={heads}
            activeId={chapter?.id ?? null}
            activeWords={liveWords}
            onOpen={(id) => void loadChapter(id).catch((e) => reportError('editor', e, 'The chapter could not be opened.'))}
            onRename={(id, title) => void run(async () => { await library.renameChapter(id, title); }, 'The chapter could not be renamed.')}
            onMove={(id, direction) => void run(async () => { await library.moveChapter(id, direction); }, 'The chapter could not be moved.')}
            onMerge={(id) => void run(() => library.mergeChapterWithPrevious(id), 'The chapters could not be joined.')}
            onDelete={setDeleting}
            onAdd={() => void run(async () => (await library.addChapter(book.id, chapterRef.current?.id ?? null)).id, 'A chapter could not be added.')}
          />
        )}

        <main className="editor-main">
          {!chapter ? (
            <div className="editor-loading"><Spinner label="Opening book…" /></div>
          ) : (
            <>
              {!focusMode && (
                <div className="chapter-heading">
                  <h2>{chapter.title}</h2>
                  <span className="muted">{formatCount(liveWords ?? chapter.wordCount)} words</span>
                </div>
              )}
              <RichEditor
                key={`${chapter.id}:${loadCount}`}
                ref={editorRef}
                initialBlocks={chapter.blocks}
                onChange={onChange}
                onWordCount={setLiveWords}
                showToolbar={!focusMode}
                lang={book.language !== 'und' ? book.language : undefined}
                dir={rtl ? 'rtl' : undefined}
                toolbarEnd={
                  <>
                    <Button size="sm" variant="ghost" icon={<Scissors size={15} />} onClick={splitHere} title="Start a new chapter at the paragraph that holds the cursor">
                      Split chapter here
                    </Button>
                    <IconButton label={`Distraction-free mode (${MOD}+Shift+F)`} onClick={() => setFocusMode(true)}>
                      <Maximize2 size={16} />
                    </IconButton>
                  </>
                }
              />
              {focusMode && (
                <div className="focus-bar">
                  <span>{chapter.title}</span>
                  <span>{formatCount(liveWords ?? chapter.wordCount)} words</span>
                  <span className={`save-state save-${saveState}`}>{saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Saving…'}</span>
                  <IconButton label="Leave distraction-free mode (Esc)" onClick={() => setFocusMode(false)}>
                    <Minimize2 size={16} />
                  </IconButton>
                </div>
              )}
            </>
          )}
        </main>

        {!focusMode && (
          <SidePanel
            book={book}
            versionsKey={versionsKey}
            flush={flush}
            snapshotRequest={snapshotRequest}
            onRestored={() => {
              setVersionsKey((k) => k + 1);
              void reloadHeads(null, true);
            }}
          />
        )}
      </div>

      {details && <BookDetailsDialog book={book} onClose={() => setDetails(false)} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this chapter?"
          danger
          confirmLabel="Delete chapter"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const target = deleting;
            setDeleting(null);
            // Keep a copy first so a deleted chapter can always be brought back.
            await run(async () => {
              await library.createSnapshot(book.id, `Before deleting "${target.title}"`, 'safety');
              await library.deleteChapter(target.id);
              setVersionsKey((k) => k + 1);
            }, 'The chapter could not be deleted.');
          }}
          message={
            <>
              <strong>{deleting.title}</strong> ({formatCount(deleting.wordCount)} words) will be removed from the book. A safety copy of the
              book is saved to the history first.
            </>
          }
        />
      )}
    </div>
  );
}
