/** The result of a preflight: a verdict and the list of checks, problems first. */
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react';
import type { Check, PreflightReport } from '@borderless/core';
import { useStore } from '../state/store';

function Icon({ status }: { status: Check['status'] }) {
  if (status === 'fail') return <CircleAlert size={15} color="var(--fail)" />;
  if (status === 'warn') return <AlertTriangle size={15} color="var(--warn)" />;
  if (status === 'info') return <Info size={15} className="dim" />;
  return <CheckCircle2 size={15} color="var(--ok)" />;
}

export function PreflightVerdict({ report }: { report: PreflightReport }) {
  const { pass, warn, fail } = report.counts;
  if (!report.ready) return <span className="badge fail"><CircleAlert size={12} /> Not ready: {fail} problem{fail === 1 ? '' : 's'} to fix</span>;
  if (warn) return <span className="badge warn"><AlertTriangle size={12} /> Ready, with {warn} thing{warn === 1 ? '' : 's'} to look at</span>;
  return <span className="badge ok"><CheckCircle2 size={12} /> Ready to upload: all {pass} checks passed</span>;
}

export function PreflightList({ report, collapsed = true }: { report: PreflightReport; collapsed?: boolean }) {
  const selectDoc = useStore((s) => s.selectDoc);
  const open = report.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const rest = report.checks.filter((c) => c.status !== 'fail' && c.status !== 'warn');
  const row = (c: Check, i: number) => (
    <div key={`${c.id}-${i}`} className={`issue ${c.status === 'pass' ? 'ok' : c.status}`}>
      <Icon status={c.status} />
      <div className="selectable">
        <div><b>{c.title}.</b> {c.detail}</div>
        {c.fix && c.status !== 'pass' && c.status !== 'info' && <div className="small dim">What to do: {c.fix}</div>}
      </div>
      {c.nodeId && <button className="btn ghost small where" onClick={() => selectDoc(c.nodeId!)}>Show in manuscript</button>}
    </div>
  );
  return (
    <div className="issues">
      {open.map(row)}
      {rest.length > 0 && (collapsed && open.length > 0 ? (
        <details>
          <summary className="small dim" style={{ cursor: 'pointer', padding: '6px 2px' }}>{rest.length} checks passed</summary>
          {rest.map(row)}
        </details>
      ) : collapsed ? (
        <details>
          <summary className="small dim" style={{ cursor: 'pointer', padding: '6px 2px' }}>Show the {rest.length} checks</summary>
          {rest.map(row)}
        </details>
      ) : rest.map(row))}
    </div>
  );
}
