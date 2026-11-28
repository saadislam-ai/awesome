import { BarChart3, Bot, Download, GitCompare, Keyboard, Library as LibraryIcon, PenLine, Settings, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ImportError, importManuscript } from '../core/import';
import type { BookCategory } from '../core/model/book';
import { AiSetup } from '../features/ai/AiSetup';
import { EditorView } from '../features/editor/EditorView';
import { ExportView } from '../features/export/ExportView';
import { ReviewView } from '../features/review/ReviewView';
import { ImportReview, type PendingImport } from '../features/import/ImportReview';
import { LibraryView } from '../features/library/LibraryView';
import { SettingsView } from '../features/settings/SettingsView';
import { Button, EmptyState, IconButton, Modal, Spinner } from '../ui/components';
import { MOD } from '../ui/format';
import { useAi } from './ai';
import { useApp, type ViewName } from './context';

const NAV: { view: ViewName; label: string; icon: ReactNode; milestone?: number }[] = [
  { view: 'library', label: 'Library', icon: <LibraryIcon size={18} /> },
  { view: 'analysis', label: 'Analysis', icon: <BarChart3 size={18} />, milestone: 3 },
  { view: 'edit', label: 'Edit', icon: <PenLine size={18} /> },
  { view: 'review', label: 'Review', icon: <GitCompare size={18} /> },
  { view: 'export', label: 'Export', icon: <Download size={18} /> },
  { view: 'settings', label: 'Settings', icon: <Settings size={18} /> },
];

const COMING: Partial<Record<ViewName, { title: string; text: string; milestone: number }>> = {
  analysis: {
    title: 'Analysis',
    milestone: 3,
    text: 'A full report on each book: structure, pacing, consistency, readability and a Book Bible of characters, places and voice. It runs on your own computer.',
  },
};

const SHORTCUTS: [string, string][] = [
  [`${MOD}+O`, 'Import a manuscript (in the Library)'],
  [`${MOD}+K`, 'Search the library'],
  [`${MOD}+1`, 'Go to the Library'],
  [`${MOD}+2`, 'Go to the editor'],
  [`${MOD}+3`, 'Go to Review'],
  [`${MOD}+,`, 'Open Settings'],
  [`${MOD}+S`, 'Save now (changes also save by themselves)'],
  [`${MOD}+Shift+S`, 'Save a named snapshot'],
  [`${MOD}+Shift+F`, 'Distraction-free mode (Esc to leave)'],
  ['Alt+↑ / Alt+↓', 'Previous or next chapter'],
  [`${MOD}+B / I / U`, 'Bold, italic, underline'],
  [`${MOD}+Z / ${MOD}+Shift+Z`, 'Undo and redo'],
  [`${MOD}+/`, 'Show this list'],
];

function ComingSoon({ view }: { view: ViewName }) {
  const info = COMING[view]!;
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{info.title}</h1>
          <p className="view-sub">Not built yet. This arrives in Milestone {info.milestone}.</p>
        </div>
      </header>
      <div className="view-scroll">
        <EmptyState title={`${info.title} is coming in Milestone ${info.milestone}`}>{info.text}</EmptyState>
      </div>
    </div>
  );
}

/** The sidebar's summary of the AI: which model is ready, and any editing in progress. */
function AiChip() {
  const { setView } = useApp();
  const { model, jobs } = useAi();
  const active = jobs.find((j) => j.status === 'running' || j.status === 'queued');
  const paused = jobs.find((j) => j.status === 'paused');
  return (
    <div className="ai-chip" data-testid="ai-chip" data-state={model.state}>
      <button className="ai-chip-main" onClick={() => setView('settings')} title="Open the AI settings">
        <Bot size={15} />
        <span>
          {model.state === 'none' && 'AI: no model loaded'}
          {model.state === 'loading' && `Loading ${model.name}…`}
          {model.state === 'ready' && `Local AI ready: ${model.name}`}
          {model.state === 'error' && 'AI: model failed to load'}
        </span>
      </button>
      {(active || paused) && (
        <button className="ai-chip-job" onClick={() => setView('review')}>
          {active ? `Editing: ${active.tasksDone} of ${active.tasks} passages` : 'An editing job is on hold'}
        </button>
      )}
    </div>
  );
}

export function Shell() {
  const { view, setView, currentBook, closeBook, focusMode, toasts, dismissToast, library, notify, platform } = useApp();
  const ai = useAi();
  const needsSetup = !ai.settings.setupDismissed && ai.model.state === 'none' && !ai.settings.lastModel && !ai.settings.serverUrl;
  const [setupOpen, setSetupOpen] = useState(needsSetup);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [shelf, setShelf] = useState<BookCategory>('mine');
  const [shortcuts, setShortcuts] = useState(false);

  const importFile = useCallback(
    async (file: File, category: BookCategory) => {
      setReading(`Reading ${file.name}…`);
      try {
        // Let the "reading" message appear before the heavy work starts.
        await new Promise((resolve) => setTimeout(resolve, 30));
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await importManuscript(file.name, bytes, {
          loadPdf: async () => (await import('../features/import/pdf-loader')).loadPdf(),
          onProgress: (done, total) => setReading(`Reading ${file.name}… page ${done} of ${total}`),
        });
        setPending({ fileName: file.name, bytes, result, category });
      } catch (e) {
        const friendly = e instanceof ImportError ? e.message : 'This file could not be read. It may be damaged or in a format that is not supported.';
        notify('error', friendly);
        void library.addLog('error', 'import', `Could not import ${file.name}: ${friendly}`, e instanceof Error ? e.stack : String(e)).catch(() => undefined);
      } finally {
        setReading(null);
      }
    },
    [library, notify],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === '1') {
        e.preventDefault();
        setView('library');
      } else if (e.key === '2') {
        e.preventDefault();
        setView('edit');
      } else if (e.key === '3') {
        e.preventDefault();
        setView('review');
      } else if (e.key === ',') {
        e.preventDefault();
        setView('settings');
      } else if (e.key === '/') {
        e.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);

  let content: ReactNode;
  if (view === 'library') content = <LibraryView category={shelf} onCategoryChange={setShelf} onImportFile={(file, category) => void importFile(file, category)} />;
  else if (view === 'settings') content = <SettingsView />;
  else if (view === 'edit' || view === 'review' || view === 'export') {
    content = currentBook ? (
      view === 'edit' ? <EditorView key={currentBook.id} book={currentBook} /> : view === 'review' ? <ReviewView key={currentBook.id} book={currentBook} /> : <ExportView key={currentBook.id} book={currentBook} />
    ) : (
      <div className="view">
        <div className="view-scroll">
          <EmptyState title="No book is open" action={<Button variant="primary" onClick={() => setView('library')}>Go to the Library</Button>}>
            Open a book from the Library first. Then you can edit it, review AI suggestions and export it.
          </EmptyState>
        </div>
      </div>
    );
  } else content = <ComingSoon view={view} />;

  return (
    <div className={`app ${focusMode && view === 'edit' ? 'is-focus' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>ManuscriptForge</span>
        </div>
        <nav aria-label="Main">
          {NAV.map((item) => (
            <button key={item.view} className={`nav-item ${view === item.view ? 'is-active' : ''}`} aria-current={view === item.view ? 'page' : undefined} onClick={() => setView(item.view)}>
              {item.icon}
              <span>{item.label}</span>
              {item.milestone && <span className="nav-soon">soon</span>}
            </button>
          ))}
        </nav>
        {currentBook && (
          <div className="open-book">
            <span className="open-book-label">Open book</span>
            <button className="open-book-title" onClick={() => setView('edit')} title={currentBook.title}>{currentBook.title}</button>
            <IconButton label="Close this book" onClick={closeBook}><X size={14} /></IconButton>
          </div>
        )}
        <span className="grow" />
        <div className="sidebar-foot">
          <AiChip />
          <span className="offline-chip" title="Manuscripts never leave this computer. The AI runs here too. The internet is used only if you choose to download a model.">
            <WifiOff size={14} /> Offline. Nothing leaves this computer.
          </span>
          {platform.info.kind === 'browser' && <span className="preview-chip">Browser preview</span>}
          <button className="link-btn" onClick={() => setShortcuts(true)}><Keyboard size={14} /> Keyboard shortcuts</button>
        </div>
      </aside>

      <div className="main">{content}</div>

      {reading && (
        <div className="busy-overlay" role="status">
          <div className="busy-card"><Spinner label={reading} /></div>
        </div>
      )}
      {pending && (
        <ImportReview
          pending={pending}
          onCancel={() => setPending(null)}
          onDone={() => {
            setShelf(pending.category);
            setPending(null);
            setView('library');
          }}
        />
      )}
      {setupOpen && (
        <Modal
          title="Set up the AI editor"
          size="lg"
          onClose={() => {
            ai.updateSettings({ setupDismissed: true });
            setSetupOpen(false);
          }}
          footer={
            <>
              <span className="push-left muted">You can come back to this at any time under Settings.</span>
              <Button
                variant={ai.model.state === 'ready' ? 'primary' : 'default'}
                data-testid="setup-close"
                onClick={() => {
                  ai.updateSettings({ setupDismissed: true });
                  setSetupOpen(false);
                }}
              >
                {ai.model.state === 'ready' ? 'Done' : 'Set up later'}
              </Button>
            </>
          }
        >
          <div className="setup-scroll">
            <div className="mode-choice" role="radiogroup" aria-label="Where the AI runs">
              <label className="format-card is-active">
                <input type="radio" name="ai-mode" checked readOnly />
                <span>
                  <strong>Local AI</strong>
                  <br />
                  <span className="muted">Runs on this computer. Private and fully offline once a model is installed.</span>
                </span>
              </label>
              <label className="format-card is-disabled">
                <input type="radio" name="ai-mode" disabled />
                <span>
                  <strong>Cloud AI</strong>
                  <br />
                  <span className="muted">Optional, with your own key. Arrives in Milestone 6.</span>
                </span>
              </label>
            </div>
            <AiSetup />
          </div>
        </Modal>
      )}
      {shortcuts && (
        <Modal title="Keyboard shortcuts" size="sm" onClose={() => setShortcuts(false)}>
          <table className="plain-table shortcuts-table">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys}><td><kbd>{keys}</kbd></td><td>{what}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            <span>{toast.message}</span>
            <button aria-label="Dismiss" onClick={() => dismissToast(toast.id)}><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
