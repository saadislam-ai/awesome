/**
 * The manuscript editor: CodeMirror showing one Markdown document of the book.
 * Saving is automatic (a short pause after typing, when the window loses
 * focus, and before another document is opened). The save itself is crash
 * safe and snapshots are taken by the engine's project store.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { countWords, maskMarkdown, type Project } from '@borderless/core';
import {
  baseTheme, focusClass, markdownSupport, proseDecorations, proseOptions, proseOptionsCompartment, suggestingCompartment,
  suggestingFilter, typewriterCompartment, typewriterScrolling, type ProseOptions,
} from './extensions';

export interface EditorStats {
  words: number;
  characters: number;
  selectionWords: number;
}

export interface EditorHandle {
  /** Write any unsaved text to disk now. */
  flush(): Promise<void>;
  view(): EditorView | null;
  /** Replace the whole document (used by accept/reject and the typography cleaner). One undo step. */
  setText(text: string): void;
  getText(): string;
  wrapSelection(before: string, after: string): void;
  insert(text: string): void;
  reveal(from: number, to: number): void;
  focus(): void;
}

interface Props {
  project: Project;
  nodeId: string;
  autosaveMs: number;
  typewriter: boolean;
  suggesting: boolean;
  options: ProseOptions;
  onStats(stats: EditorStats): void;
  onSaveState(state: 'saved' | 'saving' | 'unsaved' | 'error', message?: string): void;
  onTextChanged?(text: string): void;
  /** Called once the document is loaded and shown. */
  onReady?(): void;
  /** Right click on a word the spell checker marked. Position is in window coordinates. */
  onMisspelledMenu?(info: { word: string; from: number; to: number; x: number; y: number }): void;
}

const wrapWith = (before: string, after: string) => (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  // Pressing the shortcut again on wrapped text removes the wrapping.
  const outerFrom = from - before.length;
  const outerTo = to + after.length;
  if (outerFrom >= 0 && view.state.sliceDoc(outerFrom, from) === before && view.state.sliceDoc(to, outerTo) === after) {
    view.dispatch({ changes: [{ from: outerFrom, to: from }, { from: to, to: outerTo }], userEvent: 'input.format' });
    return true;
  }
  view.dispatch({
    changes: { from, to, insert: before + sel + after },
    selection: { anchor: from + before.length, head: from + before.length + sel.length },
    userEvent: 'input.format',
  });
  return true;
};

export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const statsTimer = useRef<number | null>(null);
  const loadedFor = useRef<string | null>(null);

  const save = async () => {
    const view = viewRef.current;
    const nodeId = loadedFor.current;
    if (!view || !nodeId || !dirty.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const text = view.state.doc.toString();
    dirty.current = false;
    propsRef.current.onSaveState('saving');
    try {
      await propsRef.current.project.writeDoc(nodeId, text);
      if (!dirty.current) propsRef.current.onSaveState('saved');
    } catch (e) {
      dirty.current = true;
      propsRef.current.onSaveState('error', e instanceof Error ? e.message : String(e));
    }
  };

  const reportStats = (state: EditorState) => {
    const text = state.doc.toString();
    const { from, to } = state.selection.main;
    propsRef.current.onStats({
      words: countWords(maskMarkdown(text)),
      characters: text.length,
      selectionWords: from === to ? 0 : countWords(maskMarkdown(state.sliceDoc(from, to))),
    });
  };

  useImperativeHandle(ref, () => ({
    flush: save,
    view: () => viewRef.current,
    getText: () => viewRef.current?.state.doc.toString() ?? '',
    setText: (text) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.replace' });
    },
    wrapSelection: (before, after) => {
      if (viewRef.current) wrapWith(before, after)(viewRef.current);
      viewRef.current?.focus();
    },
    insert: (text) => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.insert', scrollIntoView: true });
      view.focus();
    },
    reveal: (from, to) => {
      const view = viewRef.current;
      if (!view) return;
      const max = view.state.doc.length;
      const a = Math.min(from, max);
      const b = Math.min(to, max);
      view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
      view.focus();
    },
    focus: () => viewRef.current?.focus(),
  }));

  // Create the editor for a document; tear it down (after saving) when another document is chosen.
  useEffect(() => {
    let alive = true;
    const parent = hostRef.current!;
    const { project, nodeId } = props;

    void project.readDoc(nodeId).then((text) => {
      if (!alive) return;
      const state = EditorState.create({
        doc: text,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          EditorState.allowMultipleSelections.of(false),
          search({ top: true }),
          highlightSelectionMatches({ minSelectionLength: 3 }),
          markdownSupport,
          baseTheme,
          proseOptionsCompartment.of(proseOptions.of(propsRef.current.options)),
          proseDecorations,
          focusClass,
          typewriterCompartment.of(propsRef.current.typewriter ? typewriterScrolling : []),
          suggestingCompartment.of(propsRef.current.suggesting ? suggestingFilter : []),
          keymap.of([
            { key: 'Mod-i', run: wrapWith('*', '*') },
            { key: 'Mod-b', run: wrapWith('**', '**') },
            { key: 'Mod-s', run: () => (void save(), true) },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.domEventHandlers({
            contextmenu: (event, view) => {
              const handler = propsRef.current.onMisspelledMenu;
              if (!handler) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) return false;
              const line = view.state.doc.lineAt(pos);
              for (const m of line.text.matchAll(/[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*/gu)) {
                const from = line.from + m.index;
                const to = from + m[0].length;
                if (pos < from || pos > to) continue;
                const word = m[0].replace(/\u2019/g, "'");
                if (!propsRef.current.options.misspelled.has(word)) return false;
                event.preventDefault();
                handler({ word, from, to, x: event.clientX, y: event.clientY });
                return true;
              }
              return false;
            },
          }),
          EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'sentences', 'aria-label': 'Manuscript text' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              dirty.current = true;
              propsRef.current.onSaveState('unsaved');
              if (saveTimer.current) window.clearTimeout(saveTimer.current);
              saveTimer.current = window.setTimeout(() => void save(), propsRef.current.autosaveMs);
              propsRef.current.onTextChanged?.(u.state.doc.toString());
            }
            if (u.docChanged || u.selectionSet) {
              if (statsTimer.current) window.clearTimeout(statsTimer.current);
              statsTimer.current = window.setTimeout(() => reportStats(u.state), 220);
            }
          }),
          EditorView.domEventHandlers({ blur: () => void save() }),
        ],
      });
      const view = new EditorView({ state, parent });
      viewRef.current = view;
      loadedFor.current = nodeId;
      dirty.current = false;
      propsRef.current.onSaveState('saved');
      reportStats(state);
      propsRef.current.onReady?.();
    });

    const beforeUnload = () => void save();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      alive = false;
      window.removeEventListener('beforeunload', beforeUnload);
      // Save what is in the editor before it goes away. The text is captured
      // now, so the save completes even though the view is destroyed below.
      const view = viewRef.current;
      const id = loadedFor.current;
      if (view && id && dirty.current) {
        const text = view.state.doc.toString();
        dirty.current = false;
        void project.writeDoc(id, text).catch((e) => propsRef.current.onSaveState('error', String(e)));
      }
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (statsTimer.current) window.clearTimeout(statsTimer.current);
      view?.destroy();
      viewRef.current = null;
      loadedFor.current = null;
    };
    // The editor is rebuilt only when the document (or the book) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.project, props.nodeId]);

  // Live settings: applied without rebuilding the editor (cursor and undo history stay).
  useEffect(() => {
    viewRef.current?.dispatch({ effects: proseOptionsCompartment.reconfigure(proseOptions.of(props.options)) });
  }, [props.options]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: typewriterCompartment.reconfigure(props.typewriter ? typewriterScrolling : []) });
  }, [props.typewriter]);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: suggestingCompartment.reconfigure(props.suggesting ? suggestingFilter : []) });
  }, [props.suggesting]);

  return <div className="editor-host" ref={hostRef} />;
});
