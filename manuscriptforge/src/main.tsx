import '@fontsource-variable/literata';
import '@fontsource-variable/literata/wght-italic.css';
import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './app/App';
import { AppProvider, applyAppearance, DEFAULT_APPEARANCE, readCachedAppearance, type Appearance } from './app/context';
import { runSelfCheck } from './app/selfcheck';
import type { Book } from './core/model/book';
import { Library } from './data/library';
import { createPlatform, type Platform } from './platform';
import { Spinner } from './ui/components';
import { describeError } from './ui/format';
import './ui/styles.css';

applyAppearance(readCachedAppearance());

interface Ready {
  platform: Platform;
  library: Library;
  books: Book[];
  appearance: Appearance;
}

function StartupProblem({ message }: { message: string }) {
  return (
    <div className="startup-problem">
      <h1>ManuscriptForge could not open your library</h1>
      <p>{message}</p>
      <p className="muted">
        Your books have not been changed. Close the app and open it again. If this keeps happening, restore the newest file from the
        "backups" folder inside your ManuscriptForge library folder.
      </p>
    </div>
  );
}

/** Keeps a crash in one screen from taking the whole window down without explanation. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: describeError(error) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="startup-problem">
        <h1>Something went wrong</h1>
        <p>{this.state.error}</p>
        <p className="muted">Your work is saved automatically. Reload to continue.</p>
        <button className="btn btn-primary btn-md" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

function Boot() {
  const [ready, setReady] = useState<Ready | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const platform = await createPlatform();
      const library = new Library(platform.db, platform.files);
      await library.init();
      const appearance = { ...DEFAULT_APPEARANCE, ...(await library.getSetting<Partial<Appearance>>('appearance', readCachedAppearance())) };
      const books = await library.listBooks();
      if (cancelled) return;
      setReady({ platform, library, books, appearance });
      void platform.backupIfDue().catch((e) => library.addLog('warn', 'backup', 'The automatic backup failed.', describeError(e)));
      if (platform.info.selftest) {
        const report = await runSelfCheck(platform, library);
        // Proves that work registered for "before close" really runs when the window closes.
        platform.onBeforeClose(() => platform.files.write('selftest-closed.txt', new TextEncoder().encode(new Date().toISOString())));
        await platform.finishSelftest(JSON.stringify(report, null, 2), report.passed);
      }
    })().catch((e) => !cancelled && setProblem(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (problem) return <StartupProblem message={problem} />;
  if (!ready) return <div className="startup"><Spinner label="Opening your library…" /></div>;
  return (
    <AppProvider platform={ready.platform} library={ready.library} initialBooks={ready.books} initialAppearance={ready.appearance}>
      <Shell />
    </AppProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Boot />
    </ErrorBoundary>
  </StrictMode>,
);
