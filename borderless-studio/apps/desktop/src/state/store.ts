/**
 * Application state. The opened book (a `Project` from the engine) is a
 * mutable object owned by this store; `rev` is bumped whenever it changes so
 * that React components re-render.
 */
import { create } from 'zustand';
import {
  DEFAULT_SETTINGS, Library, defaultLibraryDir, loadSettings, saveSettings,
  type AppSettings, type BookSummary, type BuildContext, type Host, type Project, type PublisherProfile, type SpecSet,
} from '@borderless/core';
import { createHost, isTauri } from '../host';
import { pushToolPaths } from '../host/tauriHost';
import { loadEditorFonts } from '../editor/fonts';

export type View = 'library' | 'write' | 'book' | 'cover' | 'export' | 'publish' | 'settings';
export type ToastKind = 'info' | 'ok' | 'warn' | 'fail';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface Jump {
  nodeId: string;
  from: number;
  to: number;
  /** 1 based line to go to when offsets are not known. */
  line?: number;
}

interface State {
  host: Host;
  booting: boolean;
  bootError: string | null;
  settings: AppSettings;
  library: Library | null;
  publisher: PublisherProfile | null;
  books: BookSummary[];
  specs: SpecSet | null;
  project: Project | null;
  rev: number;
  view: View;
  activeDocId: string | null;
  zen: boolean;
  jump: Jump | null;
  toasts: Toast[];

  boot(): Promise<void>;
  refreshBooks(): Promise<void>;
  openBook(path: string): Promise<void>;
  closeBook(): Promise<void>;
  setView(v: View): void;
  selectDoc(id: string | null, jump?: Jump): void;
  clearJump(): void;
  touch(): void;
  setZen(z: boolean): void;
  toast(kind: ToastKind, text: string): void;
  dismissToast(id: number): void;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  reloadSpecs(): Promise<void>;
  /** Everything the engine needs to build files for the open book. */
  buildContext(): Promise<BuildContext>;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  host: createHost(),
  booting: true,
  bootError: null,
  settings: structuredClone(DEFAULT_SETTINGS),
  library: null,
  publisher: null,
  books: [],
  specs: null,
  project: null,
  rev: 0,
  view: 'library',
  activeDocId: null,
  zen: false,
  jump: null,
  toasts: [],

  async boot() {
    const { host } = get();
    try {
      const settings = await loadSettings(host);
      // Tests and development can point the app at a throwaway library with ?library=/some/folder
      const override = new URLSearchParams(window.location.search).get('library');
      if (override) settings.libraryDir = override;
      if (!settings.libraryDir) settings.libraryDir = await defaultLibraryDir(host);
      document.documentElement.dataset.theme = settings.theme;
      if (isTauri()) await pushToolPaths(settings.toolPaths).catch(() => undefined);
      const library = await Library.open(host, settings.libraryDir);
      if (!override) await saveSettings(host, settings);
      const [publisher, specs, books] = await Promise.all([library.publisher(), library.specs(), library.listBooks()]);
      set({ settings, library, publisher, specs, books, booting: false });
      void loadEditorFonts(host, settings.editorFont);
      for (const p of specs.problems) get().toast('warn', p.message);
    } catch (e) {
      set({ booting: false, bootError: e instanceof Error ? e.message : String(e) });
    }
  },

  async refreshBooks() {
    const { library } = get();
    if (library) set({ books: await library.listBooks() });
  },

  async openBook(path) {
    const { library, settings, host } = get();
    if (!library) return;
    try {
      const project = await library.openBook(path);
      const firstDoc = findFirstDoc(project);
      set({ project, view: 'write', activeDocId: firstDoc, rev: get().rev + 1, jump: null });
      const next = { ...settings, lastBook: project.dir };
      set({ settings: next });
      void saveSettings(host, next);
    } catch (e) {
      get().toast('fail', e instanceof Error ? e.message : String(e));
    }
  },

  async closeBook() {
    const { project, library } = get();
    if (project && library) void library.reindexBook(project).then(() => get().refreshBooks());
    set({ project: null, view: 'library', activeDocId: null, zen: false });
  },

  setView(view) {
    set({ view });
  },

  selectDoc(id, jump) {
    set({ activeDocId: id, jump: jump ?? null, view: 'write' });
  },

  clearJump() {
    set({ jump: null });
  },

  touch() {
    set({ rev: get().rev + 1 });
  },

  setZen(zen) {
    set({ zen });
  },

  toast(kind, text) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    window.setTimeout(() => get().dismissToast(id), kind === 'fail' ? 12000 : 5000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  async updateSettings(patch) {
    const { host, settings } = get();
    const next = { ...settings, ...patch };
    set({ settings: next });
    document.documentElement.dataset.theme = next.theme;
    if (patch.editorFont) void loadEditorFonts(host, next.editorFont);
    if (patch.toolPaths && isTauri()) await pushToolPaths(next.toolPaths).catch(() => undefined);
    await saveSettings(host, next);
  },

  async reloadSpecs() {
    const { library } = get();
    if (library) set({ specs: await library.specs() });
  },

  async buildContext() {
    const { host, project, specs, library } = get();
    if (!project || !specs) throw new Error('No book is open.');
    const { resources } = await host.paths();
    return { host, project, specs, resourcesDir: resources, isbnRegister: library ? await library.isbnRegister() : null };
  },
}));

/** The first document with text in the body (or anywhere), to open when a book is opened. */
function findFirstDoc(project: Project): string | null {
  let first: string | null = null;
  const visit = (nodes: Project['binder']['roots']) => {
    for (const n of nodes) {
      if (first) return;
      if (n.file) {
        first = n.id;
        return;
      }
      if (n.children) visit(n.children);
    }
  };
  const body = project.binder.roots.find((r) => r.role === 'body');
  if (body?.children) visit(body.children);
  if (!first) visit(project.binder.roots);
  return first;
}
