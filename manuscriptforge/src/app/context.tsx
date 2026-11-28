import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Book } from '../core/model/book';
import { Library } from '../data/library';
import type { Platform } from '../platform';
import { describeError } from '../ui/format';

export type ViewName = 'library' | 'analysis' | 'edit' | 'review' | 'export' | 'settings';
export type ThemeName = 'light' | 'dark' | 'sepia';
export type FontName = 'literata' | 'georgia' | 'system' | 'mono';

export interface Appearance {
  theme: ThemeName;
  font: FontName;
  /** Manuscript text size in pixels. */
  fontSize: number;
  /** Manuscript column width in characters. */
  lineWidth: number;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'light', font: 'literata', fontSize: 18, lineWidth: 68 };

export const FONT_STACKS: Record<FontName, string> = {
  literata: "'Literata Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
  georgia: "Georgia, 'Times New Roman', serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'Cascadia Mono', 'SF Mono', Consolas, 'Courier New', monospace",
};

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

interface AppState {
  platform: Platform;
  library: Library;
  books: Book[];
  refreshBooks(): Promise<Book[]>;
  view: ViewName;
  setView(view: ViewName): void;
  currentBook: Book | null;
  openBook(id: string, chapterId?: string): Promise<void>;
  closeBook(): void;
  /** A chapter to show when the editor opens, set by search results. */
  pendingChapterId: string | null;
  clearPendingChapter(): void;
  appearance: Appearance;
  setAppearance(patch: Partial<Appearance>): void;
  focusMode: boolean;
  setFocusMode(on: boolean): void;
  toasts: Toast[];
  notify(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
  /** Shows a friendly message and records the technical detail in the log. */
  reportError(scope: string, error: unknown, friendly?: string): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

const APPEARANCE_CACHE = 'mf.appearance';

export function readCachedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_CACHE);
    if (raw) return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) };
  } catch {
    // Fall through to defaults.
  }
  return DEFAULT_APPEARANCE;
}

export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  root.style.setProperty('--manuscript-font', FONT_STACKS[a.font]);
  root.style.setProperty('--manuscript-size', `${a.fontSize}px`);
  root.style.setProperty('--manuscript-width', `${a.lineWidth}ch`);
}

interface ProviderProps {
  platform: Platform;
  library: Library;
  initialBooks: Book[];
  initialAppearance: Appearance;
  children: ReactNode;
}

export function AppProvider({ platform, library, initialBooks, initialAppearance, children }: ProviderProps) {
  const [books, setBooks] = useState(initialBooks);
  const [view, setView] = useState<ViewName>('library');
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [pendingChapterId, setPendingChapterId] = useState<string | null>(null);
  const [appearance, setAppearanceState] = useState(initialAppearance);
  const [focusMode, setFocusMode] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);

  useEffect(() => applyAppearance(appearance), [appearance]);

  const refreshBooks = useCallback(async () => {
    const list = await library.listBooks();
    setBooks(list);
    return list;
  }, [library]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback(
    (kind: Toast['kind'], message: string) => {
      const id = nextToast.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      window.setTimeout(() => dismissToast(id), kind === 'error' ? 8000 : 4000);
    },
    [dismissToast],
  );

  const reportError = useCallback(
    (scope: string, error: unknown, friendly?: string) => {
      const detail = describeError(error);
      notify('error', friendly ? `${friendly} ${detail}` : detail);
      void library.addLog('error', scope, friendly ?? detail, error instanceof Error ? (error.stack ?? detail) : detail).catch(() => undefined);
    },
    [library, notify],
  );

  const setAppearance = useCallback(
    (patch: Partial<Appearance>) => {
      setAppearanceState((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(APPEARANCE_CACHE, JSON.stringify(next));
        } catch {
          // The setting is still saved in the library database below.
        }
        void library.setSetting('appearance', next).catch(() => undefined);
        return next;
      });
    },
    [library],
  );

  const openBook = useCallback(
    async (id: string, chapterId?: string) => {
      await library.markOpened(id);
      await refreshBooks();
      setPendingChapterId(chapterId ?? null);
      setCurrentBookId(id);
      setView('edit');
    },
    [library, refreshBooks],
  );

  const closeBook = useCallback(() => {
    setCurrentBookId(null);
    setFocusMode(false);
    setView('library');
  }, []);

  const currentBook = useMemo(() => books.find((b) => b.id === currentBookId) ?? null, [books, currentBookId]);

  const value: AppState = {
    platform, library, books, refreshBooks, view, setView, currentBook, openBook, closeBook,
    pendingChapterId, clearPendingChapter: () => setPendingChapterId(null),
    appearance, setAppearance, focusMode, setFocusMode, toasts, notify, dismissToast, reportError,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
