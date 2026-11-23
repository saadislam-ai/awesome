import { useEffect } from 'react';
import { BookOpen, BookType, FileOutput, Image as ImageIcon, Library as LibraryIcon, PenLine, Settings as SettingsIcon } from 'lucide-react';
import { useStore, type View } from './state/store';
import { LibraryView } from './views/LibraryView';
import { WriterView } from './views/WriterView';
import { ExportView } from './views/ExportView';
import { BookView } from './views/book/BookView';
import { CoverView } from './views/CoverView';
import { SettingsView } from './views/SettingsView';

const NAV: { id: View; label: string; icon: typeof PenLine; needsBook: boolean }[] = [
  { id: 'library', label: 'Library', icon: LibraryIcon, needsBook: false },
  { id: 'write', label: 'Write', icon: PenLine, needsBook: true },
  { id: 'book', label: 'Book', icon: BookType, needsBook: true },
  { id: 'cover', label: 'Cover', icon: ImageIcon, needsBook: true },
  { id: 'export', label: 'Export', icon: FileOutput, needsBook: true },
];

export function App() {
  const booting = useStore((s) => s.booting);
  const bootError = useStore((s) => s.bootError);
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);
  const zen = useStore((s) => s.zen);
  const toasts = useStore((s) => s.toasts);
  const setView = useStore((s) => s.setView);
  const boot = useStore((s) => s.boot);
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (booting) {
    return (
      <div className="empty" style={{ paddingTop: '30vh' }}>
        <h2>Borderless Studio</h2>
        <div>Opening your library...</div>
      </div>
    );
  }
  if (bootError) {
    return (
      <div className="empty" style={{ paddingTop: '22vh', maxWidth: 640, margin: '0 auto' }}>
        <h2>The library could not be opened</h2>
        <div className="notice fail selectable" style={{ textAlign: 'left', marginTop: 12 }}>{bootError}</div>
        <p style={{ marginTop: 12 }}>Your book folders are not affected. Check that the library folder exists and can be written to, then start the app again.</p>
      </div>
    );
  }

  const current: View = !project && view !== 'library' && view !== 'settings' ? 'library' : view;
  return (
    <div className={`app${zen ? ' zen' : ''}`}>
      <nav className="rail" aria-label="Main">
        <div className="brand" title="Borderless Studio">B</div>
        {NAV.map((n) => (
          <button key={n.id} className={current === n.id ? 'active' : ''} disabled={n.needsBook && !project} onClick={() => setView(n.id)} title={n.label}>
            <n.icon size={19} />
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <button className={current === 'settings' ? 'active' : ''} onClick={() => setView('settings')} title="Settings">
          <SettingsIcon size={19} />
          Settings
        </button>
      </nav>
      <div className="main">
        {current === 'library' && <LibraryView />}
        {current === 'write' && project && <WriterView />}
        {current === 'book' && project && <BookView />}
        {current === 'cover' && project && <CoverView />}
        {current === 'export' && project && <ExportView />}
        {current === 'settings' && <SettingsView />}
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BookTitle() {
  const project = useStore((s) => s.project);
  useStore((s) => s.rev);
  if (!project) return null;
  return (
    <>
      <BookOpen size={16} className="dim" />
      <span className="title">{project.book.title}</span>
      {project.book.subtitle && <span className="sub">{project.book.subtitle}</span>}
    </>
  );
}
