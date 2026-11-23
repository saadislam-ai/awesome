/**
 * Planning views of the manuscript: the outline (a table of every chapter
 * and scene with synopsis, status and word targets) and the corkboard (index
 * cards that can be dragged into a new order). Both edit the same binder
 * data as the Writer.
 */
import { useMemo, useState } from 'react';
import { ChevronRight, FileText, Layers } from 'lucide-react';
import { KIND_TITLES, STATUSES, findNode, findParent, walkBinder, type BinderNode } from '@borderless/core';
import { useStore } from '../../state/store';
import { fmtNumber } from '../../ui/kit';

const STATUS_LABEL: Record<string, string> = { idea: 'Idea', draft: 'Draft', revised: 'Revised', edited: 'Edited', final: 'Final' };
const titleOf = (n: BinderNode) => n.title || KIND_TITLES[n.kind] || 'Untitled';

interface PlanProps {
  /** Words in each document. */
  counts: Map<string, number>;
  /** Open a document (or the first document of a chapter) in the editor. */
  onOpen: (id: string) => void;
}

function useNodeEditing() {
  const project = useStore((s) => s.project)!;
  const touch = useStore((s) => s.touch);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);
  const patch = (id: string, p: Partial<BinderNode>) => void project.updateNode(id, p).then(touch, (e) => toast('fail', e instanceof Error ? e.message : String(e)));
  return { project, patch, touch, toast };
}

const wordsIn = (n: BinderNode, counts: Map<string, number>): number => (counts.get(n.id) ?? 0) + (n.children ?? []).reduce((sum, c) => sum + wordsIn(c, counts), 0);

function StatusSelect(props: { node: BinderNode; onChange: (s: BinderNode['status']) => void }) {
  return (
    <select className={`select small status-${props.node.status ?? 'none'}`} value={props.node.status ?? ''} onChange={(e) => props.onChange((e.target.value || undefined) as BinderNode['status'])}>
      <option value="">No status</option>
      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
    </select>
  );
}

export function OutlineView(props: PlanProps) {
  const { project, patch } = useNodeEditing();
  const rev = useStore((s) => s.rev);
  const rows = useMemo(() => {
    const out: { node: BinderNode; depth: number }[] = [];
    walkBinder(project.binder.roots, (node, _parent, depth) => { out.push({ node, depth }); });
    return out;
    // The binder object is changed in place; rev says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, rev]);
  const total = rows.filter((r) => r.depth === 0).reduce((sum, r) => sum + wordsIn(r.node, props.counts), 0);
  return (
    <div className="plan">
      <table className="table outline">
        <thead><tr><th>Title</th><th>What happens (synopsis)</th><th>Status</th><th className="num">Words</th><th className="num">Target</th></tr></thead>
        <tbody>
          {rows.map(({ node, depth }) => {
            if (depth === 0) return <tr key={node.id} className="outline-root"><td colSpan={3}>{titleOf(node)}</td><td className="num">{fmtNumber(wordsIn(node, props.counts))}</td><td /></tr>;
            const words = wordsIn(node, props.counts);
            const off = node.include === false;
            return (
              <tr key={node.id} className={off ? 'off' : ''}>
                <td style={{ paddingLeft: 8 + (depth - 1) * 18 }}>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost icon" title="Open in the editor" onClick={() => props.onOpen(node.id)}>{node.type === 'doc' ? <FileText size={13} /> : <Layers size={13} />}</button>
                    <input className="cell" defaultValue={node.title} placeholder={KIND_TITLES[node.kind] ?? 'Title'} style={{ fontWeight: node.type === 'doc' ? 400 : 600 }}
                      onBlur={(e) => { if (e.target.value.trim() !== node.title) patch(node.id, { title: e.target.value.trim() }); }} />
                  </div>
                </td>
                <td>{node.generated && !node.file ? <span className="faint small">Made by the app from the book details</span> : (
                  <textarea className="cell" rows={Math.max(1, Math.ceil((node.synopsis ?? '').length / 34))} defaultValue={node.synopsis ?? ''} placeholder="One or two sentences"
                    onBlur={(e) => { if (e.target.value !== (node.synopsis ?? '')) patch(node.id, { synopsis: e.target.value }); }} />
                )}</td>
                <td>{node.generated && !node.file ? null : <StatusSelect node={node} onChange={(status) => patch(node.id, { status })} />}</td>
                <td className="num">{words ? fmtNumber(words) : ''}</td>
                <td className="num">
                  {node.generated && !node.file ? null : (
                    <>
                      <input className="cell num" type="number" min={0} step={100} defaultValue={node.target ?? ''} placeholder="none" style={{ width: 76 }}
                        onBlur={(e) => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); if (v !== (node.target ?? 0)) patch(node.id, { target: v || undefined }); }} />
                      {node.target ? <div className="progress" title={`${Math.round((words / node.target) * 100)}% of the target`}><div style={{ width: `${Math.min(100, (words / node.target) * 100)}%` }} /></div> : null}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="small faint" style={{ marginTop: 10 }}>{fmtNumber(total)} words in the whole book, front and back matter included. Greyed rows are left out of exports.</div>
    </div>
  );
}

export function CorkboardView(props: PlanProps) {
  const { project, patch, touch, toast } = useNodeEditing();
  const body = project.binder.roots.find((r) => r.role === 'body') ?? project.binder.roots[0];
  const [containerId, setContainerId] = useState(body.id);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const container = findNode(project.binder, containerId) ?? body;
  const cards = container.children ?? [];

  // The way back up: Manuscript, then the part, then the chapter.
  const trail: BinderNode[] = [];
  for (let n: BinderNode | null = container; n; n = findParent(project.binder, n.id)) trail.unshift(n);

  const drop = (targetId: string | null) => {
    const moving = dragId;
    setDragId(null);
    setOverId(null);
    if (!moving || moving === targetId) return;
    const index = targetId ? cards.findIndex((c) => c.id === targetId) : cards.length;
    void project.moveNode(moving, container.id, index).then((moved) => {
      if (!moved) toast('info', 'That card cannot be placed there.');
      touch();
    }, (e) => toast('fail', e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="plan">
      <div className="row wrap" style={{ gap: 4, marginBottom: 12 }}>
        {trail.map((n, i) => (
          <span key={n.id} className="row" style={{ gap: 4 }}>
            {i > 0 && <ChevronRight size={13} className="faint" />}
            <button className={`btn ghost small${i === trail.length - 1 ? ' on' : ''}`} onClick={() => setContainerId(n.id)}>{titleOf(n)}</button>
          </span>
        ))}
        <span className="grow" />
        {project.binder.roots.filter((r) => r.id !== trail[0]?.id).map((r) => <button key={r.id} className="btn ghost small" onClick={() => setContainerId(r.id)}>{titleOf(r)}</button>)}
      </div>
      <div className="cork" onDragOver={(e) => e.preventDefault()} onDrop={() => drop(null)}>
        {cards.map((node, i) => {
          const words = wordsIn(node, props.counts);
          const inside = (node.children ?? []).length;
          return (
            <div key={node.id} className={`cork-card${overId === node.id && dragId !== node.id ? ' over' : ''}${dragId === node.id ? ' dragging' : ''}${node.include === false ? ' off' : ''}`}
              draggable onDragStart={(e) => { setDragId(node.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { e.preventDefault(); if (overId !== node.id) setOverId(node.id); }}
              onDrop={(e) => { e.stopPropagation(); drop(node.id); }}>
              <div className="cork-head">
                <span className="faint small">{i + 1}</span>
                <input className="cell" defaultValue={node.title} placeholder={KIND_TITLES[node.kind] ?? 'Title'} onBlur={(e) => { if (e.target.value.trim() !== node.title) patch(node.id, { title: e.target.value.trim() }); }} />
              </div>
              <textarea className="cell" defaultValue={node.synopsis ?? ''} placeholder="What happens here?" onBlur={(e) => { if (e.target.value !== (node.synopsis ?? '')) patch(node.id, { synopsis: e.target.value }); }} />
              <div className="cork-foot">
                <StatusSelect node={node} onChange={(status) => patch(node.id, { status })} />
                <span className="small faint" style={{ whiteSpace: 'nowrap' }}>{words ? fmtNumber(words) : ''}</span>
                <span className="grow" />
                {inside > 0 && <button className="btn ghost small" title="Show the cards inside" onClick={() => setContainerId(node.id)}>{inside} inside</button>}
                <button className="btn ghost small" onClick={() => props.onOpen(node.id)}>Open</button>
              </div>
            </div>
          );
        })}
        {cards.length === 0 && <div className="faint">Nothing here yet. Add chapters and scenes in the binder on the left.</div>}
      </div>
      <div className="small faint" style={{ marginTop: 12 }}>Drag a card to change the order. The binder and the exported book follow at once.</div>
    </div>
  );
}
