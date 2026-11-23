/**
 * The spec files: where every platform number lives. This card lists them
 * with their age and sources; the editor checks a file before saving it as
 * your own copy in the library, and can go back to the file that came with
 * the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Pencil } from 'lucide-react';
import {
  SPEC_FILES, bundledSpecsDir, inspectSpecFile, joinPath, markVerified, readSpecFile, resetSpecFile, saveSpecFile, type SpecFileInfo,
} from '@borderless/core';
import { useStore } from '../state/store';
import { Modal } from '../ui/kit';

interface Row {
  file: string;
  label: string;
  about: string;
  origin: 'user' | 'bundled';
  info: SpecFileInfo;
}

function Age(props: { info: SpecFileInfo }) {
  const { info } = props;
  if (!info.verifiedOn) return <span className="faint">no date</span>;
  return (
    <>
      {info.verifiedOn}{' '}
      {info.stale
        ? <span className="badge warn"><AlertTriangle size={12} /> {info.monthsOld} months ago: please check again</span>
        : <span className="badge ok">current</span>}
    </>
  );
}

export function SpecFilesCard() {
  const host = useStore((s) => s.host);
  const library = useStore((s) => s.library);
  const specs = useStore((s) => s.specs);
  const toast = useStore((s) => s.toast);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!library) return;
    const bundled = bundledSpecsDir((await host.paths()).resources);
    const next: Row[] = [];
    for (const f of SPEC_FILES) {
      try {
        const { text, origin } = await readSpecFile(host, bundled, library.specsDir, f.file);
        next.push({ ...f, origin, info: inspectSpecFile(f.file, text) });
      } catch {
        /* a file that is missing altogether is reported by the app at start */
      }
    }
    setRows(next);
  }, [host, library]);
  useEffect(() => { void load(); }, [load]);

  const reload = async () => {
    await useStore.getState().reloadSpecs();
    await load();
  };
  const stale = rows.filter((r) => r.info.stale);

  return (
    <div className="card">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>Platform rules (spec files)</h2>
        <button className="btn small" onClick={() => void reload().then(() => toast('ok', 'Spec files reloaded.'))}>Reload</button>
        <button className="btn small" onClick={() => library && void host.mkdirp(library.specsDir).then(() => host.ui?.openPath(library.specsDir))}>Open my copies</button>
      </div>
      <p className="dim small" style={{ marginTop: 6 }}>
        Trim sizes, margins, spine formulas, printing costs, royalty rates, file rules and listing limits all come from these files; nothing is fixed inside the app. When a platform changes a rule, change the number here. Your change is saved as your own copy in the library, and the file that came with the app stays as a fallback.
      </p>
      {stale.length > 0 && (
        <div className="notice warn small">
          <AlertTriangle size={15} />
          <div>{stale.map((r) => r.label).join(', ')}: last checked more than six months ago. Platforms change costs and rules without notice. Open each file, compare it with its sources, correct what changed and press "I checked the sources today".</div>
        </div>
      )}
      {specs?.problems.map((p) => <div className="notice fail small" key={p.file}>{p.message}</div>)}
      <table className="table" style={{ marginTop: 8 }}>
        <thead><tr><th>File</th><th>Last checked</th><th>Sources</th><th>In use</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.file}>
              <td><b>{r.label}</b><div className="small dim">{r.about}</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <Age info={r.info} />
                {r.info.unverified.length > 0 && <div className="small dim" style={{ marginTop: 2, whiteSpace: 'normal' }}>{r.info.unverified.length} part{r.info.unverified.length === 1 ? '' : 's'} not confirmed against an official page yet</div>}
                {!r.info.valid && <div className="small" style={{ color: 'var(--fail)' }}>has errors</div>}
              </td>
              <td>{r.info.sources.length}</td>
              <td>{r.origin === 'user' ? <span className="badge accent">your copy</span> : <span className="badge">as shipped</span>}</td>
              <td className="right"><button className="btn small" onClick={() => setEditing(r.file)}><Pencil size={13} /> Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {specs && Object.values(specs.platforms).some((s) => s && s.notes.length) && (
        <details style={{ marginTop: 10 }}>
          <summary className="dim" style={{ cursor: 'pointer' }}>Things to know about these rules</summary>
          {Object.values(specs.platforms).map((s) => s && (
            <div key={s.platform} style={{ marginTop: 8 }}>
              <b>{s.displayName}</b>
              <ul className="selectable" style={{ margin: '4px 0 0 18px', padding: 0 }}>{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          ))}
        </details>
      )}
      {editing && <SpecEditor file={editing} onClose={() => setEditing(null)} onSaved={() => void reload()} />}
    </div>
  );
}

function SpecEditor(props: { file: string; onClose: () => void; onSaved: () => void }) {
  const host = useStore((s) => s.host);
  const library = useStore((s) => s.library)!;
  const toast = useStore((s) => s.toast);
  const meta = SPEC_FILES.find((f) => f.file === props.file)!;
  // The files are large (over 100 KB), so the text box keeps its own text and is read after a short pause in typing.
  const box = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);
  const [text, setTextState] = useState('');
  const [saved, setSaved] = useState('');
  const setText = (next: string) => {
    if (box.current && box.current.value !== next) box.current.value = next;
    setTextState(next);
  };
  const typed = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTextState(box.current?.value ?? ''), 250);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const [origin, setOrigin] = useState<'user' | 'bundled'>('bundled');
  const [bundled, setBundled] = useState('');

  useEffect(() => {
    void (async () => {
      const dir = bundledSpecsDir((await host.paths()).resources);
      setBundled(dir);
      const res = await readSpecFile(host, dir, library.specsDir, props.file);
      setText(res.text);
      setSaved(res.text);
      setOrigin(res.origin);
    })().catch((e) => toast('fail', e instanceof Error ? e.message : String(e)));
  }, [host, library, props.file, toast]);

  const info = inspectSpecFile(props.file, text || '{}');
  const changed = text !== saved;
  const save = async () => {
    try {
      const current = box.current?.value ?? text;
      await saveSpecFile(host, library.specsDir, props.file, current);
      setTextState(current);
      setSaved(current);
      setOrigin('user');
      props.onSaved();
      toast('ok', `${meta.label}: saved as your copy and in use now.`);
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };
  const reset = async () => {
    if (!window.confirm(`Go back to the ${meta.label} file that came with the app? Your own copy is deleted.`)) return;
    await resetSpecFile(host, library.specsDir, props.file);
    const res = await readSpecFile(host, bundled, library.specsDir, props.file);
    setText(res.text);
    setSaved(res.text);
    setOrigin(res.origin);
    props.onSaved();
  };
  const tryClose = () => {
    if (!changed || window.confirm('Close without saving your changes to this file?')) props.onClose();
  };

  return (
    <Modal
      title={`${meta.label} (${props.file})`} onClose={tryClose} wide
      footer={<>
        {origin === 'user' && <button className="btn" onClick={() => void reset()}>Go back to the shipped file</button>}
        <button className="btn" title="Open your copy in the program your computer uses for .json files" onClick={async () => {
          const target = joinPath(library.specsDir, props.file);
          if (!(await host.exists(target))) await saveSpecFile(host, library.specsDir, props.file, saved);
          await host.ui?.openPath(target);
        }}><ExternalLink size={13} /> Open in another program</button>
        <span className="grow" />
        <button className="btn" onClick={tryClose}>Close</button>
        <button className="btn primary" disabled={!changed || !info.valid} onClick={() => void save()}>Save as my copy</button>
      </>}
    >
      <div className="spec-editor">
        <div className="spec-side">
          <div className="small dim">Last checked against the sources</div>
          <div style={{ margin: '2px 0 8px' }}><Age info={info} /></div>
          <button className="btn small" title="Sets the date in the file to today. Do this after you have compared the file with every source below." onClick={() => setText(markVerified(props.file, box.current?.value ?? text))}><CheckCircle2 size={13} /> I checked the sources today</button>
          <div className="small dim" style={{ marginTop: 14 }}>Sources ({info.sources.length})</div>
          <div className="spec-sources">
            {info.sources.map((s, i) => <button key={i} className="btn ghost small" title={s.url} onClick={() => void host.ui?.openExternal(s.url)}><ExternalLink size={12} /> {s.title}</button>)}
          </div>
          {info.unverified.length > 0 && (
            <>
              <div className="small dim" style={{ marginTop: 14 }}>Not confirmed yet ({info.unverified.length})</div>
              <ul className="small selectable" style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {info.unverified.map((u) => <li key={u.path} title={u.note}><code>{u.path}</code>{u.note ? `: ${u.note}` : ''}</li>)}
              </ul>
            </>
          )}
        </div>
        <div className="spec-main">
          <textarea ref={box} className="textarea spec-text" spellCheck={false} defaultValue="" onInput={typed} />
          {info.valid
            ? <div className="small" style={{ color: 'var(--ok)', marginTop: 6 }}><CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> The file is valid{changed ? '. Not saved yet.' : origin === 'user' ? ' and in use (your copy).' : ' (as shipped).'}</div>
            : (
              <div className="notice fail small selectable" style={{ marginTop: 6, display: 'block' }}>
                <b>{info.errors.length === 1 ? 'One thing' : `${info.errors.length} things`} must be fixed before this can be saved:</b>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{info.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
        </div>
      </div>
    </Modal>
  );
}
