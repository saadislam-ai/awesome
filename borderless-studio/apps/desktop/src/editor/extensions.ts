/**
 * CodeMirror extensions for manuscript editing. The document in the editor is
 * the Markdown file itself, so nothing is ever converted back and forth: what
 * is on screen is exactly what is saved.
 */
import { Compartment, EditorState, Facet, type Extension, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { tags as t } from '@lezer/highlight';
import { parseCritic } from '@borderless/core';

/* ------------------------------------------------------------------ */
/* Markdown look                                                       */
/* ------------------------------------------------------------------ */

const markdownStyle = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-md-heading cm-md-h1' },
  { tag: t.heading2, class: 'cm-md-heading cm-md-h2' },
  { tag: t.heading3, class: 'cm-md-heading cm-md-h3' },
  { tag: [t.heading4, t.heading5, t.heading6], class: 'cm-md-heading' },
  { tag: t.emphasis, class: 'cm-md-em' },
  { tag: t.strong, class: 'cm-md-strong' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: [t.link, t.url], class: 'cm-md-link' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: 'cm-md-mark' },
]);

export const markdownSupport: Extension = [markdown({ base: markdownLanguage, addKeymap: true }), syntaxHighlighting(markdownStyle)];

/* ------------------------------------------------------------------ */
/* Settings that can change while the editor is open                   */
/* ------------------------------------------------------------------ */

export interface ProseOptions {
  /** Highlight em and en dashes (and typed "--") when the house style avoids them. */
  flagDashes: boolean;
  /** Dim everything except the paragraph being written. */
  focusMode: boolean;
  /** Names from the story bible to underline in the text. */
  entityNames: string[];
  /** Misspelled words found by the spell checker (lower case). */
  misspelled: Set<string>;
}

export const proseOptions = Facet.define<ProseOptions, ProseOptions>({
  combine: (values) => values[values.length - 1] ?? { flagDashes: false, focusMode: false, entityNames: [], misspelled: new Set() },
});

export const proseOptionsCompartment = new Compartment();
export const suggestingCompartment = new Compartment();
export const typewriterCompartment = new Compartment();

/* ------------------------------------------------------------------ */
/* Decorations                                                         */
/* ------------------------------------------------------------------ */

const SCENE_BREAK = /^\s{0,3}([*\-_])(\s*\1){2,}\s*$/;
const DIRECTIVE = /^:{2,3}[\w-]*/;
const FOOTNOTE_DEF = /^\[\^[^\]]+\]:/;
const WORD = /[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*/gu;

const lineDeco = (cls: string) => Decoration.line({ class: cls });
const markDeco = (cls: string, attrs?: Record<string, string>) => Decoration.mark({ class: cls, attributes: attrs });
const delim = markDeco('cm-critic-delim');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDecorations(view: EditorView): DecorationSet {
  const opts = view.state.facet(proseOptions);
  const doc = view.state.doc;
  const decos: ReturnType<Decoration['range']>[] = [];
  const entityRe = opts.entityNames.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...opts.entityNames].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
    : null;

  // Paragraph that holds the cursor (for focus mode).
  let paraFrom = -1;
  let paraTo = -1;
  if (opts.focusMode) {
    const head = view.state.selection.main.head;
    let line = doc.lineAt(head);
    paraFrom = line.from;
    paraTo = line.to;
    while (line.number > 1 && line.text.trim() !== '') {
      const prev = doc.line(line.number - 1);
      if (prev.text.trim() === '') break;
      line = prev;
      paraFrom = line.from;
    }
    line = doc.lineAt(head);
    while (line.number < doc.lines && line.text.trim() !== '') {
      const next = doc.line(line.number + 1);
      if (next.text.trim() === '') break;
      line = next;
      paraTo = line.to;
    }
  }

  for (const { from, to } of view.visibleRanges) {
    // Extend to whole lines, and a little beyond so tokens that start off screen are still found.
    const start = doc.lineAt(Math.max(0, from - 2000)).from;
    const end = doc.lineAt(Math.min(doc.length, to + 2000)).to;
    const text = doc.sliceString(start, end);

    for (let pos = start; pos <= end; ) {
      const line = doc.lineAt(pos);
      if (SCENE_BREAK.test(line.text)) decos.push(lineDeco('cm-scene-break').range(line.from));
      else if (DIRECTIVE.test(line.text)) decos.push(lineDeco('cm-directive').range(line.from));
      else if (FOOTNOTE_DEF.test(line.text)) decos.push(lineDeco('cm-fndef').range(line.from));
      if (opts.focusMode && line.from >= paraFrom && line.to <= paraTo) decos.push(lineDeco('cm-active-para').range(line.from));
      pos = line.to + 1;
    }

    // Tracked changes, comments and highlights.
    const covered: [number, number][] = [];
    for (const s of parseCritic(text)) {
      const a = start + s.start;
      const b = start + s.end;
      covered.push([a, b]);
      if (b - a < 6) continue;
      decos.push(delim.range(a, a + 3), delim.range(b - 3, b));
      if (s.kind === 'insert') decos.push(markDeco('cm-critic-ins').range(a + 3, b - 3));
      else if (s.kind === 'delete') decos.push(markDeco('cm-critic-del').range(a + 3, b - 3));
      else if (s.kind === 'highlight') decos.push(markDeco('cm-critic-highlight').range(a + 3, b - 3));
      else if (s.kind === 'comment') decos.push(markDeco('cm-critic-comment').range(a + 3, b - 3));
      else if (s.kind === 'substitute') {
        const mid = a + 3 + s.text.length;
        if (mid > a + 3) decos.push(markDeco('cm-critic-del').range(a + 3, mid));
        decos.push(delim.range(mid, mid + 2));
        if (b - 3 > mid + 2) decos.push(markDeco('cm-critic-ins').range(mid + 2, b - 3));
      }
      if (s.endWithMeta > s.end) {
        const m0 = start + s.end;
        const m1 = start + s.endWithMeta;
        decos.push(markDeco('cm-critic-comment').range(m0, m1));
        covered.push([m0, m1]);
      }
    }

    for (const m of text.matchAll(/\[\^[^\]\n]+\](?!:)/g)) decos.push(markDeco('cm-fnref').range(start + m.index, start + m.index + m[0].length));
    for (const m of text.matchAll(/:(?:index|idx)\[[^\]\n]*\]/g)) decos.push(markDeco('cm-indexmark').range(start + m.index, start + m.index + m[0].length));
    if (opts.flagDashes) {
      for (const m of text.matchAll(/[\u2013\u2014]|(?<![-{~>+<=])-{2,3}(?![-}~>+<=])/g)) {
        const a = start + m.index;
        // "--" inside CriticMarkup braces is markup, not a dash.
        if (covered.some(([x, y]) => (a >= x && a < x + 3) || (a >= y - 3 && a < y))) continue;
        if (SCENE_BREAK.test(doc.lineAt(a).text)) continue;
        decos.push(markDeco('cm-dash-flag', { title: 'Dash (your house style avoids these)' }).range(a, a + m[0].length));
      }
    }
    if (entityRe) {
      for (const m of text.matchAll(entityRe)) decos.push(markDeco('cm-entity', { 'data-entity': m[0] }).range(start + m.index, start + m.index + m[0].length));
    }
    if (opts.misspelled.size) {
      for (const m of text.matchAll(WORD)) {
        if (opts.misspelled.has(m[0].toLowerCase().replace(/\u2019/g, "'"))) {
          decos.push(markDeco('cm-misspelled').range(start + m.index, start + m.index + m[0].length));
        }
      }
    }
  }
  return Decoration.set(decos, true);
}

export const proseDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      const optsChanged = u.startState.facet(proseOptions) !== u.state.facet(proseOptions);
      if (u.docChanged || u.viewportChanged || optsChanged || (u.selectionSet && u.state.facet(proseOptions).focusMode)) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Adds a class to the editor while focus mode is on, so CSS can dim other paragraphs. */
export const focusClass = EditorView.editorAttributes.compute([proseOptions], (state) => ({
  class: state.facet(proseOptions).focusMode ? 'cm-focus-mode' : '',
}));

/* ------------------------------------------------------------------ */
/* Typewriter scrolling                                                */
/* ------------------------------------------------------------------ */

/** Keeps the line being typed at the same height in the window, like paper in a typewriter. */
export const typewriterScrolling: Extension = ViewPlugin.fromClass(
  class {
    private pending = false;
    update(u: ViewUpdate) {
      const typing = u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move') || tr.isUserEvent('select'));
      if (!typing || (!u.docChanged && !u.selectionSet) || this.pending) return;
      this.pending = true;
      const view = u.view;
      requestAnimationFrame(() => {
        this.pending = false;
        if (!view.dom.isConnected) return;
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
      });
    }
  },
);

/* ------------------------------------------------------------------ */
/* Suggesting mode (tracked changes)                                    */
/* ------------------------------------------------------------------ */

/**
 * While suggesting is on, typing and deleting are recorded as CriticMarkup
 * instead of changing the text: new text goes inside {++ ++}, removed text is
 * kept inside {-- --}. Undo, redo, paste from the app itself and text input
 * that is still being composed (as with Bangla keyboards) pass through
 * untouched until the composition is finished.
 */
export const suggestingFilter: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (!(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return tr;
  if (tr.isUserEvent('input.type.compose')) return tr;
  let count = 0;
  tr.changes.iterChanges(() => count++);
  if (count !== 1) return tr;

  const doc = tr.startState.doc;
  const text = doc.toString();
  const spans = parseCritic(text);
  let spec: TransactionSpec | null = null;

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const ins = inserted.toString();
    const del = doc.sliceString(fromA, toA);
    const within = (kind: string) => spans.find((s) => s.kind === kind && fromA >= s.start + 3 && toA <= s.end - 3);

    // Editing inside one of the suggested insertions: it is still only a suggestion, so edit it directly.
    if (within('insert')) return;
    // Deleting text that is already marked as deleted: nothing to record, just move over it.
    if (!ins && del && within('delete')) {
      spec = { selection: { anchor: tr.isUserEvent('delete.backward') ? fromA : toA } };
      return;
    }
    if (ins && !del) {
      // Typing right after an insertion token continues that token.
      const prev = spans.find((s) => s.kind === 'insert' && s.end === fromA && s.endWithMeta === s.end);
      if (prev) {
        spec = { changes: { from: fromA - 3, to: fromA, insert: ins + '++}' }, selection: { anchor: fromA - 3 + ins.length } };
      } else {
        spec = { changes: { from: fromA, to: toA, insert: `{++${ins}++}` }, selection: { anchor: fromA + 3 + ins.length } };
      }
      return;
    }
    if (del && !ins) {
      const after = spans.find((s) => s.kind === 'delete' && s.start === toA);
      const before = spans.find((s) => s.kind === 'delete' && s.end === fromA && s.endWithMeta === s.end);
      if (after) {
        // Backspacing into text that sits just before a deletion: grow that deletion to the left.
        spec = { changes: { from: fromA, to: toA + 3, insert: '{--' + del }, selection: { anchor: fromA } };
      } else if (before) {
        // Forward delete just after a deletion: grow it to the right.
        spec = { changes: { from: fromA - 3, to: toA, insert: del + '--}' }, selection: { anchor: fromA + del.length } };
      } else {
        const token = `{--${del}--}`;
        spec = { changes: { from: fromA, to: toA, insert: token }, selection: { anchor: tr.isUserEvent('delete.backward') ? fromA : fromA + token.length } };
      }
      return;
    }
    if (del && ins) {
      const token = `{--${del}--}{++${ins}++}`;
      spec = { changes: { from: fromA, to: toA, insert: token }, selection: { anchor: fromA + token.length - 3 } };
    }
  });
  if (!spec) return tr;
  return [{ ...(spec as TransactionSpec), userEvent: 'input.suggest', scrollIntoView: true }];
});

/* ------------------------------------------------------------------ */
/* Base look                                                           */
/* ------------------------------------------------------------------ */

export const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-content': { fontVariantLigatures: 'common-ligatures' },
});
