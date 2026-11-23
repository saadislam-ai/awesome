/**
 * The inspector beside the editor: details of the selected item, review of
 * tracked changes and typography, version history, and search across the book.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, History, ListChecks, MessageSquare, RotateCcw, Search, SlidersHorizontal, SpellCheck, X } from 'lucide-react';
import {
  KIND_TITLES, STATUSES, applyAllChanges, applyEdits, changeResult, findDashes, parseCritic, replaceInProject, searchProject, summariseEdits,
  typographyEdits, type BinderNode, type CriticSpan, type DocStatus, type SearchMatch, type SnapshotInfo,
} from '@borderless/core';
import { useStore } from '../state/store';
import { Field, Modal, fmtNumber } from '../ui/kit';
import type { EditorHandle } from '../editor/MarkdownEditor';
import type { SpellStatus } from '../editor/spell';
import { CheckPanel } from './CheckPanel';

export type InspectorTab = 'details' | 'review' | 'check' | 'history' | 'search';

interface Props {
  node: BinderNode | null;
  tab: InspectorTab;
  onTab(t: InspectorTab): void;
  editor: React.RefObject<EditorHandle | null>;
  /** Current text of the open document (updated shortly after typing stops). */
  text: string;
  words: number;
  /** Ask the writer view to reload the open document from disk. */
  onReload(): void;
  /** Words of the open document that the spell checker does not know. */
  misspelled: Set<string>;
  spellStatus: SpellStatus;
}

export function Inspector(props: Props) {
  const { node, tab } = props;
  const pending = useMemo(() => parseCritic(props.text).filter((s) => s.kind !== 'highlight').length, [props.text]);
  return (
    <div className="pane inspector">
      <div className="head">
        <div className="tabs">
          <button className={tab === 'details' ? 'on' : ''} onClick={() => props.onTab('details')} title="Details"><SlidersHorizontal size={14} /><span className="lbl">Details</span></button>
          <button className={tab === 'review' ? 'on' : ''} onClick={() => props.onTab('review')} title="Tracked changes, comments and typography">
            <ListChecks size={14} /><span className="lbl">Review</span>{pending > 0 && <span className="count neutral">{pending}</span>}
          </button>
          <button className={tab === 'check' ? 'on' : ''} onClick={() => props.onTab('check')} title="Spelling, style and consistency"><SpellCheck size={14} /><span className="lbl">Check</span>{props.misspelled.size > 0 && <span className="count">{props.misspelled.size}</span>}</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => props.onTab('history')} title="Earlier versions"><History size={14} /><span className="lbl">History</span></button>
          <button className={tab === 'search' ? 'on' : ''} onClick={() => props.onTab('search')} title="Search the whole book"><Search size={14} /><span className="lbl">Search</span></button>
        </div>
      </div>
      <div className="scroll">
        {tab === 'details' && (node ? <Details node={node} words={props.words} /> : <div className="dim">Select an item in the binder.</div>)}
        {tab === 'review' && <Review {...props} />}
        {tab === 'history' && (node?.file ? <Snapshots node={node} editor={props.editor} onReload={props.onReload} /> : <div className="dim">Open a document to see its earlier versions.</div>)}
        {tab === 'check' && <CheckPanel text={props.text} editor={props.editor} misspelled={props.misspelled} spellStatus={props.spellStatus} />}
        {tab === 'search' && <SearchPanel editor={props.editor} onReload={props.onReload} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Details({ node, words }: { node: BinderNode; words: number }) {
  const project = useStore((s) => s.project)!;
  const touch = useStore((s) => s.touch);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);
  const patch = (p: Partial<BinderNode>) =>
    void project.updateNode(node.id, p).then(touch, (e) => toast('fail', String(e)));
  const isDoc = Boolean(node.file);
  const target = node.target ?? 0;
  return (
    <>
      <Field label="Title">
        <input className="input" key={node.id + node.title} defaultValue={node.title} onBlur={(e) => e.target.value !== node.title && patch({ title: e.target.value })} />
      </Field>
      {(node.type === 'chapter' || node.type === 'part') && (
        <Field label="Subtitle (optional)">
          <input className="input" key={node.id + 'sub'} defaultValue={node.subtitle ?? ''} onBlur={(e) => patch({ subtitle: e.target.value })} />
        </Field>
      )}
      <div className="row wrap">
        <span className="badge">{KIND_TITLES[node.kind] ?? (node.type === 'doc' ? 'Scene' : node.type)}</span>
        {node.generated && !node.file && <span className="badge accent">Generated from book details</span>}
      </div>
      {node.type === 'chapter' && (
        <label className="check">
          <input type="checkbox" checked={node.numbered !== false} onChange={(e) => patch({ numbered: e.target.checked })} />
          Numbered chapter
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={node.include !== false} onChange={(e) => patch({ include: e.target.checked })} />
        Include in exports
      </label>
      {node.kind === 'epigraph' && (
        <Field label="Source of the quotation" hint="Shown under the epigraph, for example: Anne Morrow Lindbergh, Gift from the Sea">
          <input className="input" key={node.id + 'src'} defaultValue={String(node.data?.source ?? '')} onBlur={(e) => patch({ data: { ...(node.data ?? {}), source: e.target.value } })} />
        </Field>
      )}
      {isDoc && (
        <>
          <Field label="Status">
            <select className="select" value={node.status ?? 'draft'} onChange={(e) => patch({ status: e.target.value as DocStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Point of view">
            <input className="input" key={node.id + 'pov'} defaultValue={node.pov ?? ''} onBlur={(e) => patch({ pov: e.target.value })} placeholder="Whose eyes are we seeing through?" />
          </Field>
          <Field label="Synopsis" hint="Shown on the index card for this document.">
            <textarea className="textarea" rows={4} key={node.id + 'syn'} defaultValue={node.synopsis ?? ''} onBlur={(e) => patch({ synopsis: e.target.value })} />
          </Field>
          <Field label="Labels" hint="Separate with commas.">
            <input className="input" key={node.id + 'lab'} defaultValue={(node.labels ?? []).join(', ')} onBlur={(e) => patch({ labels: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Word target for this document">
            <input className="input" type="number" min={0} step={100} key={node.id + 'tgt'} defaultValue={target || ''} onBlur={(e) => patch({ target: Number(e.target.value) || 0 })} />
          </Field>
          {target > 0 && (
            <div>
              <div className="progress" style={{ width: '100%' }}><div style={{ width: `${Math.min(100, (words / target) * 100)}%` }} /></div>
              <div className="small dim" style={{ marginTop: 3 }}>{fmtNumber(words)} of {fmtNumber(target)} words</div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function spanPreview(s: CriticSpan) {
  const cut = (t: string) => (t.length > 140 ? t.slice(0, 140) + '...' : t);
  if (s.kind === 'insert') return <ins>{cut(s.text)}</ins>;
  if (s.kind === 'delete') return <del>{cut(s.text)}</del>;
  if (s.kind === 'substitute') return <><del>{cut(s.text)}</del> <ChevronRight size={11} /> <ins>{cut(s.newText ?? '')}</ins></>;
  return <span>{cut(s.note ?? s.text.replace(/^@\S+:?\s*/, ''))}</span>;
}

function Review(props: Props) {
  const project = useStore((s) => s.project)!;
  const toast = useStore((s) => s.toast);
  const { text, editor } = props;
  const style = project.book.style;
  const spans = useMemo(() => parseCritic(text).filter((s) => s.kind !== 'highlight'), [text]);
  const changes = spans.filter((s) => s.kind !== 'comment');
  const edits = useMemo(() => typographyEdits(text, style), [text, style]);
  const summary = summariseEdits(edits);
  const dashes = useMemo(() => (style.dashPolicy.mode === 'allow' ? [] : findDashes(text, style.dashPolicy.includeTypedHyphens)), [text, style]);
  const [dashIndex, setDashIndex] = useState(0);

  if (!props.node?.file) return <div className="dim">Open a document to review its changes.</div>;

  const resolve = (s: CriticSpan, accept: boolean) => {
    const view = editor.current?.view();
    if (!view) return;
    const insert = s.kind === 'comment' ? '' : changeResult(s, accept);
    view.dispatch({ changes: { from: s.start, to: s.kind === 'comment' ? s.end : s.endWithMeta, insert }, userEvent: 'input.review' });
  };
  const resolveAll = (accept: boolean) => editor.current?.setText(applyAllChanges(text, accept));
  const clean = (asSuggestions: boolean) => {
    if (edits.length === 0) return;
    editor.current?.setText(applyEdits(text, edits, asSuggestions));
    toast('ok', asSuggestions ? `${edits.length} typography suggestions added for review.` : `${edits.length} typography fixes applied. Undo brings the text back.`);
  };
  const nextDash = () => {
    if (dashes.length === 0) return;
    const d = dashes[dashIndex % dashes.length];
    editor.current?.reveal(d.from, d.to);
    setDashIndex(dashIndex + 1);
  };

  return (
    <>
      <div className="card" style={{ padding: 10 }}>
        <div className="row"><h3 className="grow">Typography</h3></div>
        {edits.length === 0 ? (
          <div className="small dim" style={{ marginTop: 4 }}>Quotes, apostrophes, ellipses and spacing are clean.</div>
        ) : (
          <>
            <div className="small" style={{ margin: '4px 0 8px' }}>
              {summary.quotes > 0 && <div>{summary.quotes} straight quotes or apostrophes</div>}
              {summary.ellipsis > 0 && <div>{summary.ellipsis} ellipses to normalise</div>}
              {summary.dash > 0 && <div>{summary.dash} dashes to replace</div>}
              {summary.spaces > 0 && <div>{summary.spaces} doubled spaces</div>}
            </div>
            <div className="row">
              <button className="btn small primary" onClick={() => clean(false)}>Fix all</button>
              <button className="btn small" onClick={() => clean(true)} title="Add each fix as a tracked change you can accept or reject">Suggest instead</button>
            </div>
          </>
        )}
        {style.dashPolicy.mode !== 'allow' && (
          <div className={`notice ${dashes.length ? 'warn' : 'ok'} small`} style={{ marginTop: 8 }}>
            <div className="grow">
              {dashes.length === 0 ? 'No em or en dashes in this document.' : `${dashes.length} dash${dashes.length === 1 ? '' : 'es'} found (your house style avoids them).`}
            </div>
            {dashes.length > 0 && <button className="btn small" onClick={nextDash}>Show next</button>}
          </div>
        )}
      </div>

      <div className="row">
        <h3 className="grow">Tracked changes</h3>
        {changes.length > 0 && (
          <>
            <button className="btn small" onClick={() => resolveAll(true)}>Accept all</button>
            <button className="btn small" onClick={() => resolveAll(false)}>Reject all</button>
          </>
        )}
      </div>
      {spans.length === 0 && <div className="small dim">No tracked changes or comments. Switch on "Suggest" in the toolbar to record your edits as suggestions.</div>}
      {spans.map((s, i) => (
        <div className="review-item" key={`${s.start}-${i}`}>
          <div className="row small dim">
            {s.kind === 'comment' ? <MessageSquare size={13} /> : null}
            <span className="grow">{s.kind === 'comment' ? 'Comment' : s.kind === 'insert' ? 'Insertion' : s.kind === 'delete' ? 'Deletion' : 'Replacement'}{s.author ? ` by ${s.author}` : ''}</span>
            <button className="btn ghost small" onClick={() => editor.current?.reveal(s.start, s.end)}>Show</button>
          </div>
          <div className="txt selectable">{spanPreview(s)}</div>
          {s.kind !== 'comment' && s.note && <div className="small dim" style={{ marginBottom: 6 }}>{s.note}</div>}
          <div className="row">
            {s.kind === 'comment' ? (
              <button className="btn small" onClick={() => resolve(s, true)}><X size={13} /> Remove comment</button>
            ) : (
              <>
                <button className="btn small" onClick={() => resolve(s, true)}><Check size={13} /> Accept</button>
                <button className="btn small" onClick={() => resolve(s, false)}><X size={13} /> Reject</button>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */

function stampLabel(stamp: string): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/.exec(stamp);
  if (!m) return stamp;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Snapshots({ node, editor, onReload }: { node: BinderNode; editor: Props['editor']; onReload(): void }) {
  const project = useStore((s) => s.project)!;
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<SnapshotInfo[]>([]);
  const [preview, setPreview] = useState<{ snap: SnapshotInfo; text: string } | null>(null);
  const [label, setLabel] = useState('');
  const refresh = () => void project.listSnapshots(node.id).then(setList);
  useEffect(refresh, [node.id, project]);

  const take = async () => {
    await editor.current?.flush();
    await project.snapshotDoc(node.id, label || 'manual');
    setLabel('');
    refresh();
    toast('ok', 'Snapshot saved.');
  };
  const restore = async (snap: SnapshotInfo) => {
    await editor.current?.flush();
    await project.restoreSnapshot(node.id, snap.name);
    setPreview(null);
    onReload();
    refresh();
    toast('ok', 'The earlier version was restored. The text you had before is kept as a snapshot too.');
  };

  return (
    <>
      <div className="small dim">
        Earlier versions of this document are saved automatically while you write, and before any large deletion. They are plain files in the book's snapshots folder.
      </div>
      <div className="row">
        <input className="input" placeholder="Name for a snapshot (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn" onClick={take}>Save now</button>
      </div>
      {list.length === 0 && <div className="small dim">No snapshots yet.</div>}
      <div>
        {list.map((s) => (
          <div className="snap" key={s.name}>
            <History size={13} className="faint" />
            <div className="grow">
              <div>{stampLabel(s.stamp)}</div>
              {s.label && <div className="small dim">{s.label}</div>}
            </div>
            <span className="small faint">{fmtNumber(Math.round(s.size / 6))} w</span>
            <button className="btn small" onClick={async () => setPreview({ snap: s, text: await project.readSnapshot(node.id, s.name) })}>View</button>
          </div>
        ))}
      </div>
      {preview && (
        <Modal
          title={`Version of ${stampLabel(preview.snap.stamp)}`}
          wide
          onClose={() => setPreview(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPreview(null)}>Close</button>
              <button className="btn primary" onClick={() => void restore(preview.snap)}><RotateCcw size={14} /> Restore this version</button>
            </>
          }
        >
          <pre className="selectable" style={{ whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.6, margin: 0 }}>{preview.text}</pre>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function SearchPanel({ editor, onReload }: { editor: Props['editor']; onReload(): void }) {
  const project = useStore((s) => s.project)!;
  const selectDoc = useStore((s) => s.selectDoc);
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);

  const run = async () => {
    await editor.current?.flush();
    const r = await searchProject(project, { query, regex, caseSensitive, wholeWord, limit: 400 });
    setMatches(r.matches);
    setTotal(r.total);
    setError(r.error);
  };
  useEffect(() => {
    const t = window.setTimeout(() => void run(), 260);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, regex, caseSensitive, wholeWord]);

  const replaceAll = async () => {
    setConfirm(false);
    await editor.current?.flush();
    try {
      const r = await replaceInProject(project, { query, regex, caseSensitive, wholeWord }, replacement);
      toast('ok', `${r.replacements} replacement${r.replacements === 1 ? '' : 's'} in ${r.documentsChanged} document${r.documentsChanged === 1 ? '' : 's'}. Each changed document has a "before replace" snapshot.`);
      onReload();
      await run();
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };

  const groups = useMemo(() => {
    const g: { nodeId: string; title: string; items: SearchMatch[] }[] = [];
    for (const m of matches) {
      const last = g[g.length - 1];
      if (last && last.nodeId === m.nodeId) last.items.push(m);
      else g.push({ nodeId: m.nodeId, title: m.title, items: [m] });
    }
    return g;
  }, [matches]);

  return (
    <>
      <input className={`input${error ? ' invalid' : ''}`} autoFocus placeholder="Search the whole book" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the whole book" />
      <div className="row wrap">
        <label className="check small"><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regular expression</label>
        <label className="check small"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case</label>
        <label className="check small"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word</label>
      </div>
      <div className="row">
        <input className="input" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replace with" />
        <button className="btn" disabled={!query || total === 0 || Boolean(error)} onClick={() => setConfirm(true)}>Replace all</button>
      </div>
      {error && <div className="notice fail small">{error}</div>}
      {query && !error && <div className="small dim">{total === 0 ? 'No matches.' : `${fmtNumber(total)} match${total === 1 ? '' : 'es'} in ${groups.length} document${groups.length === 1 ? '' : 's'}${total > matches.length ? ` (showing the first ${matches.length})` : ''}`}</div>}
      <div>
        {groups.map((g) => (
          <div key={g.nodeId}>
            <div className="search-doc">{g.title} <span className="faint">({g.items.length})</span></div>
            {g.items.map((m, i) => (
              <div className="search-hit selectable" key={i} onClick={() => selectDoc(m.nodeId, { nodeId: m.nodeId, from: m.from, to: m.to })}>
                {m.excerpt.slice(0, m.excerptFrom)}<mark>{m.excerpt.slice(m.excerptFrom, m.excerptTo)}</mark>{m.excerpt.slice(m.excerptTo)}
              </div>
            ))}
          </div>
        ))}
      </div>
      {confirm && (
        <Modal
          title="Replace in the whole book?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void replaceAll()}>Replace {fmtNumber(total)}</button>
            </>
          }
        >
          <p>This replaces {fmtNumber(total)} match{total === 1 ? '' : 'es'} of <b className="selectable">{query}</b> with <b className="selectable">{replacement || '(nothing)'}</b> in {groups.length} document{groups.length === 1 ? '' : 's'}.</p>
          <p className="dim">A snapshot of every changed document is saved first, so you can restore any of them from the History tab.</p>
        </Modal>
      )}
    </>
  );
}
