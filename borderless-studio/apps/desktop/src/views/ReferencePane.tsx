/**
 * The second half of a split screen: another document of the book, shown
 * next to the one you are writing. It is for reading only, so there is one
 * place where text is edited and saved; "Edit this one" swaps the two.
 */
import { useEffect, useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { docLabel, textNodes } from '@borderless/core';
import { useStore } from '../state/store';
import { fmtNumber } from '../ui/kit';

export function ReferencePane(props: { docId: string | null; activeId: string | null; fontFamily: string; fontSizePx: number; onPick: (id: string) => void; onSwap: () => void; onClose: () => void; refreshKey: number }) {
  const project = useStore((s) => s.project)!;
  useStore((s) => s.rev);
  const [text, setText] = useState('');
  const docs = textNodes(project.binder);
  const node = docs.find((n) => n.id === props.docId) ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!node) setText('');
    else void project.readDoc(node.id).then((t) => { if (!cancelled) setText(t); }, () => { if (!cancelled) setText(''); });
    return () => { cancelled = true; };
    // refreshKey changes when the document on the other side was saved or swapped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, props.docId, props.refreshKey]);

  const words = text.split(/\s+/).filter(Boolean).length;
  return (
    <div className="pane reference-pane">
      <div className="editor-toolbar">
        <select className="select small" style={{ maxWidth: 260 }} value={props.docId ?? ''} onChange={(e) => props.onPick(e.target.value)}>
          <option value="">Choose a document to keep in view</option>
          {docs.map((n) => <option key={n.id} value={n.id} disabled={n.id === props.activeId}>{docLabel(project.binder, n)}</option>)}
        </select>
        <div className="grow" />
        {node && <button className="btn small" title="Edit this document and keep the other one in view" onClick={props.onSwap}><ArrowLeftRight size={13} /> Edit this one</button>}
        <button className="btn ghost icon" title="Close the split screen" onClick={props.onClose}><X size={15} /></button>
      </div>
      <div className="reference-text selectable" style={{ fontFamily: props.fontFamily, fontSize: props.fontSizePx }}>
        {node ? text || <span className="faint">This document is empty.</span> : <span className="faint">Pick a document above: an earlier chapter, your notes, or the scene you are rewriting.</span>}
      </div>
      <div className="statusbar"><span>{node ? `${fmtNumber(words)} words, for reading only` : ''}</span></div>
    </div>
  );
}
