/**
 * The binder: the structure of the book as a tree. Front matter, the
 * manuscript (parts, chapters, scenes) and back matter. Items can be dragged
 * to reorder them, renamed in place, left out of exports, or moved to the
 * trash (nothing is ever deleted for good).
 */
import { useState, type DragEvent, type MouseEvent } from 'react';
import { BookMarked, ChevronDown, ChevronRight, EyeOff, FileText, Layers, Plus, Wand2 } from 'lucide-react';
import {
  BACK_KINDS, FRONT_KINDS, GENERATED_KINDS, KIND_TITLES, findParent,
  type BinderNode, type NewNodeSpec, type SectionKind,
} from '@borderless/core';
import { useStore } from '../state/store';
import { Menu, fmtNumber, type MenuItem } from '../ui/kit';

type DropPos = 'before' | 'after' | 'inside';

function sumWords(node: BinderNode, counts: Map<string, number>): number {
  let n = node.file ? (counts.get(node.id) ?? 0) : 0;
  for (const c of node.children ?? []) n += sumWords(c, counts);
  return n;
}

const UNIQUE_KINDS = new Set<SectionKind>(['half-title', 'title-page', 'copyright', 'toc', 'also-by', 'index', 'endnotes']);

function specForKind(kind: SectionKind): NewNodeSpec {
  const generated = GENERATED_KINDS.has(kind);
  return { type: 'doc', kind, title: KIND_TITLES[kind] ?? kind, generated, text: generated ? undefined : '' };
}

export function Binder(props: { counts: Map<string, number> }) {
  const project = useStore((s) => s.project)!;
  const activeId = useStore((s) => s.activeDocId);
  const selectDoc = useStore((s) => s.selectDoc);
  const touch = useStore((s) => s.touch);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      touch();
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };

  const add = (parentId: string, spec: NewNodeSpec, index?: number) =>
    run(async () => {
      const node = await project.addNode(parentId, spec, index);
      const target = node.file ? node : (node.children?.find((c) => c.file) ?? node);
      selectDoc(target.id);
      if (!GENERATED_KINDS.has(node.kind)) setRenaming(node.id);
    });

  const kindsMenu = (root: BinderNode, kinds: SectionKind[]): MenuItem[] => {
    const present = new Set((root.children ?? []).map((c) => c.kind));
    return kinds
      .filter((k) => !(UNIQUE_KINDS.has(k) && present.has(k)))
      .map((k) => ({ label: KIND_TITLES[k] ?? k, icon: GENERATED_KINDS.has(k) ? <Wand2 size={14} /> : <FileText size={14} />, onClick: () => void add(root.id, specForKind(k)) }));
  };

  const groupMenu = (root: BinderNode): MenuItem[] => {
    if (root.role === 'front') return [{ heading: 'Add to front matter' }, ...kindsMenu(root, FRONT_KINDS)];
    if (root.role === 'back') return [{ heading: 'Add to back matter' }, ...kindsMenu(root, BACK_KINDS)];
    return [
      { label: 'New chapter', icon: <BookMarked size={14} />, onClick: () => void add(root.id, { type: 'chapter', kind: 'chapter', title: 'New chapter', numbered: true, text: '' }) },
      { label: 'New chapter with scenes', icon: <BookMarked size={14} />, onClick: () => void add(root.id, { type: 'chapter', kind: 'chapter', title: 'New chapter', numbered: true, children: [{ type: 'doc', kind: 'scene', title: 'Scene 1', text: '' }] }) },
      { label: 'New part', icon: <Layers size={14} />, onClick: () => void add(root.id, { type: 'part', kind: 'part', title: 'New part' }) },
    ];
  };

  const nodeMenu = (node: BinderNode): MenuItem[] => {
    const parent = findParent(project.binder, node.id);
    const index = parent?.children?.indexOf(node) ?? 0;
    const items: MenuItem[] = [];
    if (node.type === 'part') {
      items.push({ label: 'New chapter in this part', icon: <BookMarked size={14} />, onClick: () => void add(node.id, { type: 'chapter', kind: 'chapter', title: 'New chapter', numbered: true, text: '' }) });
    }
    if (node.type === 'chapter') {
      items.push({ label: 'New scene in this chapter', icon: <FileText size={14} />, onClick: () => void add(node.id, { type: 'doc', kind: 'scene', title: `Scene ${(node.children?.length ?? 0) + 1}`, text: '' }) });
      if (parent) items.push({ label: 'New chapter after this one', icon: <BookMarked size={14} />, onClick: () => void add(parent.id, { type: 'chapter', kind: 'chapter', title: 'New chapter', numbered: true, text: '' }, index + 1) });
    }
    if (node.type === 'doc' && node.kind === 'scene' && parent) {
      items.push({ label: 'New scene after this one', icon: <FileText size={14} />, onClick: () => void add(parent.id, { type: 'doc', kind: 'scene', title: 'New scene', text: '' }, index + 1) });
    }
    if (items.length) items.push({ separator: true });
    items.push({ label: 'Rename', onClick: () => setRenaming(node.id) });
    items.push({
      label: node.include === false ? 'Include in exports' : 'Leave out of exports',
      icon: <EyeOff size={14} />,
      onClick: () => void run(() => project.updateNode(node.id, { include: node.include === false })),
    });
    if (GENERATED_KINDS.has(node.kind) && node.kind !== 'toc' && node.kind !== 'index') {
      items.push(
        node.generated
          ? { label: 'Write this page by hand instead', onClick: () => void run(async () => { await project.setGenerated(node.id, false); selectDoc(node.id); }) }
          : { label: 'Generate this page automatically again', onClick: () => void run(() => project.setGenerated(node.id, true)) },
      );
    }
    items.push({ separator: true });
    items.push({
      label: 'Move to trash',
      danger: true,
      onClick: () =>
        void run(async () => {
          await project.removeNode(node.id);
          if (activeId === node.id) selectDoc(null);
          toast('info', `"${node.title}" was moved to the trash folder of this book (manuscript/.trash). Nothing was deleted.`);
        }),
    });
    return items;
  };

  const onDragOver = (e: DragEvent, node: BinderNode) => {
    if (!dragId || dragId === node.id) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const container = node.type !== 'doc';
    const pos: DropPos = container ? (y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside') : y < 0.5 ? 'before' : 'after';
    if (!drop || drop.id !== node.id || drop.pos !== pos) setDrop({ id: node.id, pos });
  };

  const onDrop = (e: DragEvent, node: BinderNode) => {
    e.preventDefault();
    const d = drop;
    const id = dragId;
    setDrop(null);
    setDragId(null);
    if (!d || !id) return;
    void run(async () => {
      let ok: boolean;
      if (d.pos === 'inside') {
        ok = await project.moveNode(id, node.id, node.children?.length ?? 0);
        setCollapsed((c) => { const n = new Set(c); n.delete(node.id); return n; });
      } else {
        const parent = findParent(project.binder, node.id);
        if (!parent) return;
        const idx = parent.children!.indexOf(node) + (d.pos === 'after' ? 1 : 0);
        ok = await project.moveNode(id, parent.id, idx);
      }
      if (!ok) toast('warn', 'That item cannot be moved there.');
    });
  };

  const renderNode = (node: BinderNode, depth: number) => {
    const hasKids = (node.children?.length ?? 0) > 0;
    const open = !collapsed.has(node.id);
    const words = sumWords(node, props.counts);
    const Icon = node.type === 'part' ? Layers : node.type === 'chapter' ? BookMarked : node.generated && !node.file ? Wand2 : FileText;
    const cls = ['node', node.type, activeId === node.id ? 'active' : '', node.include === false ? 'excluded' : '', drop?.id === node.id ? `drop-${drop.pos}` : ''].join(' ');
    return (
      <div key={node.id}>
        <div
          className={cls}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={renaming !== node.id}
          onDragStart={(e) => { setDragId(node.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); }}
          onDragEnd={() => { setDragId(null); setDrop(null); }}
          onDragOver={(e) => onDragOver(e, node)}
          onDragLeave={() => drop?.id === node.id && setDrop(null)}
          onDrop={(e) => onDrop(e, node)}
          onClick={() => selectDoc(node.id)}
          onDoubleClick={() => setRenaming(node.id)}
          onContextMenu={(e: MouseEvent) => { e.preventDefault(); selectDoc(node.id); setMenu({ x: e.clientX, y: e.clientY, items: nodeMenu(node) }); }}
          title={node.include === false ? 'Left out of exports' : undefined}
          data-node-id={node.id}
        >
          <span
            className="twisty"
            onClick={(e) => {
              if (!hasKids) return;
              e.stopPropagation();
              setCollapsed((c) => { const n = new Set(c); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; });
            }}
          >
            {hasKids ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
          </span>
          <Icon size={14} className="kind-icon" />
          {renaming === node.id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={node.title}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { const v = e.currentTarget.value.trim(); setRenaming(null); if (v && v !== node.title) void run(() => project.updateNode(node.id, { title: v })); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }}
            />
          ) : (
            <span className="name">{node.title || KIND_TITLES[node.kind] || 'Untitled'}</span>
          )}
          {node.type === 'doc' && node.file && node.status && <span className={`status-dot ${node.status}`} title={`Status: ${node.status}`} />}
          {words > 0 && <span className="count">{fmtNumber(words)}</span>}
        </div>
        {hasKids && open && node.children!.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="pane binder">
      <div className="head">
        <h3 className="grow">Binder</h3>
      </div>
      <div className="tree">
        {project.binder.roots.map((root) => (
          <div key={root.id}>
            <div
              className={`tree-group${drop?.id === root.id ? ' drop-inside' : ''}`}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setDrop({ id: root.id, pos: 'inside' }); } }}
              onDrop={(e) => onDrop(e, root)}
            >
              {root.title}
              <span className="count" style={{ fontWeight: 400, letterSpacing: 0 }}>{sumWords(root, props.counts) > 0 ? fmtNumber(sumWords(root, props.counts)) : ''}</span>
              <button
                className="btn ghost icon small"
                title={`Add to ${root.title.toLowerCase()}`}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: groupMenu(root) }); }}
              >
                <Plus size={14} />
              </button>
            </div>
            {(root.children ?? []).map((c) => renderNode(c, 0))}
            {(root.children ?? []).length === 0 && <div className="small faint" style={{ padding: '2px 10px 6px' }}>Nothing here yet.</div>}
          </div>
        ))}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
