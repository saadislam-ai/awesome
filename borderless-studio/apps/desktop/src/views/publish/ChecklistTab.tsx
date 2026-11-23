/** Publishing checklist: the steps for this book's editions and platforms, including Australian legal deposit. */
import { useEffect, useState } from 'react';
import { ExternalLink, Info } from 'lucide-react';
import {
  bundledSpecsDir, checklistFor, isoDate, loadChecklist, loadChecklistState, saveChecklistState,
  type ChecklistFile, type ChecklistState,
} from '@borderless/core';
import { useStore } from '../../state/store';

const GROUPS: Record<string, string> = {
  isbn: 'ISBN', general: 'Before you upload', kdp: 'Amazon KDP', ingramspark: 'IngramSpark', draft2digital: 'Draft2Digital', 'legal-deposit': 'Legal deposit in Australia',
};
const ORDER = ['isbn', 'general', 'kdp', 'ingramspark', 'draft2digital', 'legal-deposit'];

export function ChecklistTab() {
  const project = useStore((s) => s.project)!;
  const host = useStore((s) => s.host);
  const library = useStore((s) => s.library);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);
  const [file, setFile] = useState<ChecklistFile | null>(null);
  const [state, setState] = useState<ChecklistState | null>(null);

  useEffect(() => {
    void host.paths().then((p) => loadChecklist(host, bundledSpecsDir(p.resources), library?.specsDir)).then(setFile);
    void loadChecklistState(project).then(setState);
  }, [host, library, project]);

  if (!file || !state) return <div className="dim">{file === null && state ? 'The checklist file (publishing-checklist.json) was not found among the spec files.' : 'Opening the checklist...'}</div>;
  const items = checklistFor(file, project.book);
  const toggle = (id: string, done: boolean) => {
    const next = structuredClone(state);
    if (done) next.done[id] = isoDate(new Date());
    else delete next.done[id];
    setState(next);
    void saveChecklistState(project, next).catch((e) => toast('fail', String(e)));
  };
  const doneCount = items.filter((i) => state.done[i.id]).length;
  const groups = [...new Set([...ORDER, ...items.map((i) => i.group)])].filter((g) => items.some((i) => i.group === g));

  return (
    <div className="page-narrow">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="badge accent">{doneCount} of {items.length} steps done</span>
        <span className="small dim">Last checked against official pages on {file.lastVerified}. Steps that could not be confirmed are marked.</span>
      </div>
      {groups.map((g) => (
        <div className="card" key={g}>
          <h2>{GROUPS[g] ?? g}</h2>
          {items.filter((i) => i.group === g).map((item) => (
            <div key={item.id} className="check-item">
              <input type="checkbox" checked={Boolean(state.done[item.id])} onChange={(e) => toggle(item.id, e.target.checked)} aria-label={item.title} />
              <div className="grow">
                <div style={{ textDecoration: state.done[item.id] ? 'line-through' : undefined, opacity: state.done[item.id] ? 0.6 : 1 }}><b>{item.title}</b></div>
                <div className="small dim selectable">{item.detail}</div>
                {item._meta && !item._meta.verified && <div className="small" style={{ color: 'var(--warn)' }}><Info size={11} style={{ verticalAlign: -1 }} /> Not confirmed on an official page{item._meta.note ? `: ${item._meta.note}` : '.'}</div>}
                {state.done[item.id] && <div className="small faint">Done on {state.done[item.id]}</div>}
              </div>
              {item.url && <button className="btn small" onClick={() => void host.ui?.openExternal(item.url!)}><ExternalLink size={12} /> Open</button>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
