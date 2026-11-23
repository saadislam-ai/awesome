/**
 * The writing screen: binder on the left, the manuscript editor in the
 * middle, the inspector on the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Columns2, Focus, Highlighter, Italic, Maximize2, MessageSquarePlus, Minimize2, Minus, Moon, PanelRight, Pilcrow, SquarePen, Sun, Superscript, Coffee, Flame,
} from 'lucide-react';
import { KIND_TITLES, bibleWords, findNode, joinPath, textNodes, walkBinder, writingStreak, isoDate, type BinderNode, type WritingLog } from '@borderless/core';
import { useStore } from '../state/store';
import { BookTitle } from '../App';
import { Binder } from './Binder';
import { Inspector, type InspectorTab } from './Inspector';
import { CorkboardView, OutlineView } from './plan/PlanViews';
import { BibleView } from './plan/BibleView';
import { ReferencePane } from './ReferencePane';
import { MarkdownEditor, type EditorHandle, type EditorStats } from '../editor/MarkdownEditor';
import { editorFontStack } from '../editor/fonts';
import type { ProseOptions } from '../editor/extensions';
import { Menu, Seg, fmtNumber, type MenuItem } from '../ui/kit';
import { addPersonalWord, readPersonalWords, spellService, wordsOf, type SpellStatus } from '../editor/spell';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
/** What the middle of the Write screen shows: the text, or one of the planning views. */
type WriterMode = 'text' | 'outline' | 'cards' | 'bible';

export function WriterView() {
  const project = useStore((s) => s.project)!;
  const settings = useStore((s) => s.settings);
  const activeId = useStore((s) => s.activeDocId);
  const jump = useStore((s) => s.jump);
  const clearJump = useStore((s) => s.clearJump);
  const zen = useStore((s) => s.zen);
  const setZen = useStore((s) => s.setZen);
  const updateSettings = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const closeBook = useStore((s) => s.closeBook);
  const rev = useStore((s) => s.rev);

  const editor = useRef<EditorHandle | null>(null);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [stats, setStats] = useState<EditorStats>({ words: 0, characters: 0, selectionWords: 0 });
  const [saveState, setSaveState] = useState<{ state: SaveState; message?: string }>({ state: 'saved' });
  const [suggesting, setSuggesting] = useState(false);
  const [tab, setTab] = useState<InspectorTab>('details');
  const host = useStore((s) => s.host);
  const library = useStore((s) => s.library);
  const [misspelled, setMisspelled] = useState<Set<string>>(new Set());
  const [spellStatus, setSpellStatus] = useState<SpellStatus>({ language: '', ready: false });
  const [spellMenu, setSpellMenu] = useState<{ word: string; from: number; to: number; x: number; y: number; suggestions: string[] | null } | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [text, setText] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [log, setLog] = useState<WritingLog | null>(null);
  const textTimer = useRef<number | null>(null);
  const [mode, setModeState] = useState<WriterMode>('text');
  // Split screen: undefined means closed, null means open with no document chosen yet.
  const [splitId, setSplitId] = useState<string | null | undefined>(undefined);
  const [splitRefresh, setSplitRefresh] = useState(0);
  // Bumped when the story bible changes, so the spellchecker learns new names.
  const [bibleRev, setBibleRev] = useState(0);
  const selectDocInStore = useStore((s) => s.selectDoc);
  const session = useRef({ startTotal: -1, lastLogged: -1, lastTick: Date.now(), activeMs: 0, lastTyped: 0, started: false });

  const node: BinderNode | null = useMemo(() => (activeId ? findNode(project.binder, activeId) : null), [project, activeId, rev]);

  // Word counts for every document, loaded once per book and kept up to date from the editor.
  useEffect(() => {
    let alive = true;
    void project.wordCounts().then((c) => alive && setCounts(c));
    void project.readWritingLog().then((l) => alive && setLog(l));
    return () => {
      alive = false;
    };
  }, [project, reloadKey]);

  const manuscriptTotal = useMemo(() => {
    let total = 0;
    const body = project.binder.roots.find((r) => r.role === 'body');
    if (body) {
      walkBinder([body], (n) => {
        if (n.include === false) return false;
        if (n.file) total += counts.get(n.id) ?? 0;
      });
    }
    return total;
  }, [project, counts, rev]);

  const onStats = useCallback(
    (s: EditorStats) => {
      setStats(s);
      session.current.lastTyped = Date.now();
      if (activeId) {
        setCounts((prev) => {
          if (prev.get(activeId) === s.words) return prev;
          const next = new Map(prev);
          next.set(activeId, s.words);
          return next;
        });
      }
    },
    [activeId],
  );

  // Writing log: every 20 seconds, record today's progress if the total changed.
  const totalRef = useRef(manuscriptTotal);
  totalRef.current = manuscriptTotal;
  useEffect(() => {
    const tick = window.setInterval(() => {
      const s = session.current;
      const now = Date.now();
      // Time counts as writing time while keys were pressed in the last minute.
      if (now - s.lastTyped < 60_000) s.activeMs += now - s.lastTick;
      s.lastTick = now;
      const total = totalRef.current;
      if (s.startTotal < 0) {
        if (counts.size === 0) return;
        s.startTotal = total;
        s.lastLogged = total;
        return;
      }
      if (total !== s.lastLogged) {
        const minutes = s.activeMs / 60000;
        s.activeMs = 0;
        const first = !s.started;
        s.started = true;
        s.lastLogged = total;
        void project.logWriting(total, minutes, first).then(setLog).catch(() => undefined);
      }
    }, 20_000);
    return () => window.clearInterval(tick);
  }, [project, counts.size]);

  // Jump to a search hit or a validation message once the right document is open.
  useEffect(() => {
    if (!jump || !ready || jump.nodeId !== activeId) return;
    const view = editor.current?.view();
    if (!view) return;
    if (jump.line && jump.from === 0 && jump.to === 0) {
      const line = view.state.doc.line(Math.min(Math.max(1, jump.line), view.state.doc.lines));
      editor.current?.reveal(line.from, line.to);
    } else {
      editor.current?.reveal(jump.from, jump.to);
    }
    clearJump();
  }, [jump, ready, activeId, clearJump]);

  useEffect(() => {
    setReady(false);
    setText('');
  }, [activeId, reloadKey]);

  // Keyboard: Escape leaves distraction free mode, F11 or Ctrl/Cmd+Shift+F toggles it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zen) setZen(false);
      if ((e.key === 'F11' || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f'))) {
        e.preventDefault();
        setZen(!zen);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setShowInspector(true);
        setTab('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zen, setZen]);

  // Spelling: load the dictionary of the book's language, then check the open document after each pause in typing.
  const spelling = project.book.style.spelling;
  useEffect(() => {
    if (!settings.spellcheck) {
      setMisspelled(new Set());
      return;
    }
    let alive = true;
    void (async () => {
      const { resources } = await host.paths();
      const personal = await readPersonalWords(host, [...(library ? [joinPath(library.dir, 'dictionary.txt')] : []), project.path('metadata/dictionary.txt')]);
      // Names on the title page are never spelling mistakes.
      for (const c of project.book.contributors) personal.push(...c.name.split(/\s+/).filter((w) => w.length > 1));
      // Nor are the names in the story bible.
      personal.push(...bibleWords(project.bible));
      const status = await spellService.load(host, resources, library?.dir ?? null, spelling, personal);
      if (alive) setSpellStatus({ ...status });
    })();
    return () => {
      alive = false;
    };
  }, [host, library, project, spelling, settings.spellcheck, bibleRev]);
  useEffect(() => {
    if (!settings.spellcheck || !spellStatus.ready) return;
    let alive = true;
    void spellService.check(wordsOf(text)).then((wrong) => alive && setMisspelled(new Set(wrong)));
    return () => {
      alive = false;
    };
  }, [text, spellStatus, settings.spellcheck]);

  const options: ProseOptions = useMemo(
    () => ({ flagDashes: project.book.style.dashPolicy.mode !== 'allow', focusMode: settings.focusMode, entityNames: [], misspelled }),
    [project, settings.focusMode, rev, misspelled],
  );

  const openSpellMenu = (info: { word: string; from: number; to: number; x: number; y: number }) => {
    setSpellMenu({ ...info, suggestions: null });
    void spellService.suggest(info.word).then((list) => setSpellMenu((m) => (m && m.word === info.word ? { ...m, suggestions: list } : m)));
  };
  const acceptWord = async (word: string, scope: 'book' | 'library' | 'session') => {
    await spellService.add(word);
    setMisspelled((prev) => {
      const next = new Set(prev);
      next.delete(word);
      return next;
    });
    try {
      if (scope === 'book') await addPersonalWord(host, project.path('metadata/dictionary.txt'), word);
      if (scope === 'library' && library) await addPersonalWord(host, joinPath(library.dir, 'dictionary.txt'), word);
    } catch (e) {
      toast('fail', `The word could not be saved to the dictionary: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const spellItems = (): MenuItem[] => {
    if (!spellMenu) return [];
    const m = spellMenu;
    const items: MenuItem[] = [{ heading: m.suggestions === null ? 'Looking for suggestions...' : m.suggestions.length ? 'Did you mean' : 'No suggestions' }];
    for (const sug of m.suggestions ?? []) {
      items.push({ label: sug, onClick: () => editor.current?.view()?.dispatch({ changes: { from: m.from, to: m.to, insert: sug }, userEvent: 'input.spell' }) });
    }
    items.push({ separator: true });
    items.push({ label: `Add "${m.word}" to this book's dictionary`, onClick: () => void acceptWord(m.word, 'book') });
    items.push({ label: 'Add to my dictionary for all books', onClick: () => void acceptWord(m.word, 'library') });
    items.push({ label: 'Ignore until the app is closed', onClick: () => void acceptWord(m.word, 'session') });
    return items;
  };

  const insertFootnote = () => {
    const view = editor.current?.view();
    if (!view) return;
    const doc = view.state.doc.toString();
    let max = 0;
    for (const m of doc.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, Number(m[1]));
    const id = max + 1;
    const pos = view.state.selection.main.to;
    const tail = `${doc.endsWith('\n') ? '' : '\n'}\n[^${id}]: `;
    view.dispatch({
      changes: [{ from: pos, insert: `[^${id}]` }, { from: doc.length, insert: tail }],
      selection: { anchor: doc.length + `[^${id}]`.length + tail.length },
      scrollIntoView: true,
      userEvent: 'input.footnote',
    });
    view.focus();
  };

  const today = isoDate();
  const todayWords = log?.days.find((d) => d.date === today)?.words ?? 0;
  const goal = project.book.targets.dailyWords;
  const streak = log ? writingStreak(log, goal, today) : 0;
  const themeNext = settings.theme === 'light' ? 'sepia' : settings.theme === 'sepia' ? 'dark' : 'light';
  const ThemeIcon = settings.theme === 'light' ? Sun : settings.theme === 'sepia' ? Coffee : Moon;
  // Choosing a document anywhere (the binder, a search result, a check) brings the text back.
  const lastActive = useRef(activeId);
  useEffect(() => {
    if (lastActive.current !== activeId || jump) setModeState('text');
    lastActive.current = activeId;
  }, [activeId, jump]);

  /** Leave the text only after it is safely saved. */
  const setMode = async (next: WriterMode) => {
    if (next === mode) return;
    if (mode === 'text') await editor.current?.flush();
    if (next !== 'text') void project.wordCounts().then(setCounts);
    setModeState(next);
  };
  /** Open a document from a planning view: a chapter opens at its first document. */
  const openFromPlan = (id: string, at?: number) => {
    const target = findNode(project.binder, id);
    if (!target) return;
    const doc = target.file ? target : textNodes({ ...project.binder, roots: [target] })[0];
    if (!doc) {
      toast('info', 'There is no text in this part of the book yet. Add a document in the binder.');
      return;
    }
    selectDocInStore(doc.id, at !== undefined ? { nodeId: doc.id, from: at, to: at } : undefined);
    setModeState('text');
  };
  const swapSplit = async () => {
    if (!splitId || !node) return;
    await editor.current?.flush();
    const previous = node.id;
    selectDocInStore(splitId);
    setSplitId(previous);
    setSplitRefresh((n) => n + 1);
  };

  const editorStyle = {
    '--editor-font': editorFontStack(settings.editorFont),
    '--editor-size': `${settings.editorFontSizePx}px`,
    '--editor-width': `${settings.editorWidthEm}em`,
  } as React.CSSProperties;

  return (
    <>
      <div className="topbar">
        <BookTitle />
        <div className="grow" />
        <Seg<WriterMode> value={mode} onChange={(m) => void setMode(m)} options={[
          { value: 'text', label: 'Text', title: 'Write and edit' },
          { value: 'outline', label: 'Outline', title: 'Every chapter and scene in a table, with synopsis, status and targets' },
          { value: 'cards', label: 'Cards', title: 'Index cards you can drag into a new order' },
          { value: 'bible', label: 'Story bible', title: 'Characters, places, things and events' },
        ]} />
        <span className="sub">{fmtNumber(manuscriptTotal)} words in the manuscript</span>
        <button className="btn ghost small" onClick={async () => { await editor.current?.flush(); await closeBook(); }}>Close book</button>
      </div>
      <div className="content">
        <div className="writer">
          <Binder counts={counts} />
          {mode === 'outline' && <OutlineView counts={counts} onOpen={openFromPlan} />}
          {mode === 'cards' && <CorkboardView counts={counts} onOpen={openFromPlan} />}
          {mode === 'bible' && <BibleView onOpen={openFromPlan} onChanged={() => setBibleRev((n) => n + 1)} />}
          {mode === 'text' && <div className="pane editor-pane" style={editorStyle}>
            <div className="editor-toolbar">
              <span className="doc-title">{node ? node.title || KIND_TITLES[node.kind] : 'No document selected'}</span>
              <div className="grow" />
              {node?.file && (
                <>
                  <button className="btn ghost icon" title="Italic (Ctrl or Cmd + I)" onClick={() => editor.current?.wrapSelection('*', '*')}><Italic size={15} /></button>
                  <button className="btn ghost icon" title="Bold (Ctrl or Cmd + B)" onClick={() => editor.current?.wrapSelection('**', '**')}><Bold size={15} /></button>
                  <button className="btn ghost icon" title="Footnote" onClick={insertFootnote}><Superscript size={15} /></button>
                  <button className="btn ghost icon" title="Scene break" onClick={() => editor.current?.insert('\n\n***\n\n')}><Minus size={15} /></button>
                  <button className="btn ghost icon" title="Comment on the selection" onClick={() => editor.current?.wrapSelection('', '{>><<}')}><MessageSquarePlus size={15} /></button>
                  <button className="btn ghost icon" title="Highlight (for quote cards)" onClick={() => editor.current?.wrapSelection('{==', '==}')}><Highlighter size={15} /></button>
                  <span style={{ width: 8 }} />
                  <button className={`btn small${suggesting ? ' on' : ''}`} title="Record your edits as tracked changes" onClick={() => setSuggesting(!suggesting)}>
                    <SquarePen size={14} /> Suggest
                  </button>
                </>
              )}
              <button className={`btn ghost icon${settings.focusMode ? ' on' : ''}`} title="Focus: dim everything except the paragraph you are writing" onClick={() => void updateSettings({ focusMode: !settings.focusMode })}><Focus size={15} /></button>
              <button className={`btn ghost icon${settings.typewriterScrolling ? ' on' : ''}`} title="Typewriter scrolling: keep the line you are typing in the middle" onClick={() => void updateSettings({ typewriterScrolling: !settings.typewriterScrolling })}><Pilcrow size={15} /></button>
              <button className="btn ghost icon" title={`Theme: ${settings.theme}. Click for ${themeNext}.`} onClick={() => void updateSettings({ theme: themeNext })}><ThemeIcon size={15} /></button>
              <button className="btn ghost icon" title="Distraction free writing (F11, Escape to leave)" onClick={() => setZen(!zen)}>{zen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
              <button className={`btn ghost icon${splitId !== undefined ? ' on' : ''}`} title="Split screen: keep a second document in view while you write" onClick={() => setSplitId(splitId === undefined ? null : undefined)}><Columns2 size={15} /></button>
              <button className={`btn ghost icon${showInspector ? ' on' : ''}`} title="Show or hide the inspector" onClick={() => setShowInspector(!showInspector)}><PanelRight size={15} /></button>
            </div>
            {node?.file ? (
              <MarkdownEditor
                key={`${node.id}:${reloadKey}`}
                ref={editor}
                project={project}
                nodeId={node.id}
                autosaveMs={Math.max(500, settings.autosaveSeconds * 1000)}
                typewriter={settings.typewriterScrolling}
                suggesting={suggesting}
                options={options}
                onStats={onStats}
                onSaveState={(state, message) => {
                  setSaveState({ state, message });
                  if (state === 'error') toast('fail', `This document could not be saved: ${message}. Your text is still in the editor; check the disk and try again with Ctrl or Cmd + S.`);
                }}
                onTextChanged={(t) => {
                  if (textTimer.current) window.clearTimeout(textTimer.current);
                  textTimer.current = window.setTimeout(() => setText(t), 350);
                }}
                onReady={() => {
                  setReady(true);
                  setText(editor.current?.getText() ?? '');
                }}
                onMisspelledMenu={openSpellMenu}
              />
            ) : (
              <NodeInfo node={node} />
            )}
            <div className="statusbar">
              {node?.file && (
                <>
                  <span>{fmtNumber(stats.words)} words{stats.selectionWords > 0 ? ` (${fmtNumber(stats.selectionWords)} selected)` : ''}</span>
                  {node.target ? <span>target {fmtNumber(node.target)}</span> : null}
                </>
              )}
              <span className="grow" />
              <span title="Words written today in this book">
                Today {todayWords >= 0 ? '+' : ''}{fmtNumber(todayWords)}{goal > 0 ? ` of ${fmtNumber(goal)}` : ''}
              </span>
              {goal > 0 && <div className="progress" title="Daily goal"><div style={{ width: `${Math.max(0, Math.min(100, (todayWords / goal) * 100))}%` }} /></div>}
              {streak > 0 && <span title="Days in a row on which you met your goal"><Flame size={12} style={{ verticalAlign: -2 }} /> {streak} day{streak === 1 ? '' : 's'}</span>}
              {node?.file && (
                <span className={saveState.state === 'saved' ? 'saved' : saveState.state === 'error' ? '' : 'saving'} style={saveState.state === 'error' ? { color: 'var(--fail)' } : undefined}>
                  {saveState.state === 'saved' ? 'Saved' : saveState.state === 'saving' ? 'Saving...' : saveState.state === 'unsaved' ? 'Editing' : 'Not saved'}
                </span>
              )}
            </div>
          </div>}
          {mode === 'text' && splitId !== undefined && !zen && (
            <ReferencePane docId={splitId} activeId={node?.id ?? null} fontFamily={editorFontStack(settings.editorFont)} fontSizePx={settings.editorFontSizePx}
              onPick={(id) => setSplitId(id || null)} onSwap={() => void swapSplit()} onClose={() => setSplitId(undefined)} refreshKey={splitRefresh} />
          )}
          {mode === 'text' && showInspector && (
            <Inspector node={node} tab={tab} onTab={setTab} editor={editor} text={text} words={stats.words} onReload={() => setReloadKey((k) => k + 1)} misspelled={misspelled} spellStatus={spellStatus} />
          )}
          {spellMenu && <Menu x={spellMenu.x} y={spellMenu.y} items={spellItems()} onClose={() => setSpellMenu(null)} />}
        </div>
      </div>
    </>
  );
}

/** Shown in place of the editor for items that have no text of their own. */
function NodeInfo({ node }: { node: BinderNode | null }) {
  const project = useStore((s) => s.project)!;
  const selectDoc = useStore((s) => s.selectDoc);
  const touch = useStore((s) => s.touch);
  if (!node) {
    return (
      <div className="editor-host">
        <div className="empty grow"><h2>Choose a document</h2><p>Pick a chapter or scene in the binder to start writing.</p></div>
      </div>
    );
  }
  const firstChild = node.children?.find((c) => c.file);
  return (
    <div className="editor-host">
      <div className="empty grow" style={{ maxWidth: 520, margin: '0 auto' }}>
        <h2>{node.title || KIND_TITLES[node.kind]}</h2>
        {node.generated && !node.file ? (
          <>
            <p>This page is generated from your book details (title, author, imprint, ISBN, edition). It updates itself for every format you export.</p>
            {node.kind !== 'toc' && node.kind !== 'index' && (
              <button className="btn" onClick={async () => { await project.setGenerated(node.id, false); touch(); selectDoc(node.id); }}>Write this page by hand instead</button>
            )}
          </>
        ) : node.type === 'part' ? (
          <p>A part groups chapters and gets its own title page. Drag chapters onto it in the binder, or right click it to add one.</p>
        ) : node.type === 'chapter' ? (
          <>
            <p>This chapter is made of scenes. Each scene is its own document; scene breaks are added between them automatically.</p>
            {firstChild && <button className="btn primary" onClick={() => selectDoc(firstChild.id)}>Open the first scene</button>}
          </>
        ) : (
          <p>This item has no text.</p>
        )}
      </div>
    </div>
  );
}
