/**
 * Editing the open book's settings. Changes are applied to the book in
 * memory at once (so every screen shows them) and written to book.json after
 * a short pause, and again when the screen is left.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Book, Project } from '@borderless/core';
import { useStore } from '../state/store';

let timer: number | null = null;
let pending: Project | null = null;

function flush(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  const project = pending;
  pending = null;
  if (project) {
    void project.saveBook().catch((e) => useStore.getState().toast('fail', `The book settings could not be saved: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export function useBookEditor(): { project: Project; book: Book; update: (change: (book: Book) => void) => void; rev: number } {
  const project = useStore((s) => s.project)!;
  const touch = useStore((s) => s.touch);
  const rev = useStore((s) => s.rev);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flush();
    };
  }, []);
  const update = useCallback((change: (book: Book) => void) => {
    change(project.book);
    touch();
    pending = project;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(flush, 500);
  }, [project, touch]);
  return { project, book: project.book, update, rev };
}

/** Save pending book settings now (before a build reads them from memory or disk). */
export function saveBookNow(): void {
  flush();
}
