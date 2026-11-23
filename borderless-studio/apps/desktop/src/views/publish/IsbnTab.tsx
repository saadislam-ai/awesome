/**
 * ISBN manager. The register belongs to the library, not to one book: it
 * lists every ISBN you own and which book and edition each one went to, so
 * that a number is never used twice.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Plus } from 'lucide-react';
import {
  addIsbns, assignIsbn, checkBookIsbns, displayIsbn, expandBlock, freeIsbns, isoDate, releaseIsbn, validateIsbn,
  type IsbnRegister,
} from '@borderless/core';
import { useStore } from '../../state/store';
import { useBookEditor } from '../../ui/useBook';
import { Field } from '../../ui/kit';

export function IsbnTab() {
  const library = useStore((s) => s.library);
  const toast = useStore((s) => s.toast);
  const { book, update } = useBookEditor();
  const [reg, setReg] = useState<IsbnRegister | null>(null);
  const [lines, setLines] = useState('');
  const [block, setBlock] = useState('');
  const [first, setFirst] = useState('');
  const [count, setCount] = useState(10);
  const [prefix, setPrefix] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void library?.isbnRegister().then(setReg);
  }, [library]);

  const save = async (next: IsbnRegister) => {
    setReg(structuredClone(next));
    try {
      await library?.saveIsbnRegister(next);
    } catch (e) {
      toast('fail', `The ISBN register could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (!reg) return <div className="dim">Opening the ISBN register...</div>;

  const add = (text: string, label: string) => {
    const next = structuredClone(reg);
    const res = addIsbns(next, text, label || `Added ${isoDate(new Date())}`);
    void save(next);
    if (res.added.length) toast('ok', `${res.added.length} ISBN${res.added.length === 1 ? '' : 's'} added to the register.`);
    for (const r of res.rejected.slice(0, 4)) toast('warn', `${r.input}: ${r.problem}`);
    return res.added.length > 0;
  };
  const assign = (formatId: string, isbn: string) => {
    const f = book.formats.find((x) => x.id === formatId)!;
    const next = structuredClone(reg);
    try {
      if (f.isbn && f.isbn !== isbn) releaseIsbn(next, f.isbn);
      if (isbn) assignIsbn(next, isbn, { bookId: book.id, bookTitle: book.title, formatId, formatLabel: f.label || f.id }, isoDate(new Date()));
      update((b) => { b.formats.find((x) => x.id === formatId)!.isbn = isbn; });
      void save(next);
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };
  const free = freeIsbns(reg);
  const problems = checkBookIsbns(reg, { id: book.id, title: book.title, formats: book.formats.map((f) => ({ id: f.id, label: f.label, isbn: f.isbn, enabled: f.enabled })) });
  const shown = showAll ? reg.records : reg.records.slice(0, 30);

  return (
    <div className="page-narrow">
      <div className="card">
        <h2>ISBNs of this book</h2>
        <p className="dim small">Each edition needs its own ISBN. A new price, a new cover or a corrected reprint keeps its number; a new format or a substantially revised edition needs a new one.</p>
        <table className="table">
          <thead><tr><th>Edition</th><th>ISBN</th><th>Choose from your register</th><th /></tr></thead>
          <tbody>
            {book.formats.map((f) => {
              const v = f.isbn ? validateIsbn(f.isbn) : null;
              const rec = reg.records.find((r) => r.isbn === f.isbn);
              return (
                <tr key={f.id} style={{ opacity: f.enabled ? 1 : 0.6 }}>
                  <td><b>{f.label || f.id}</b> <span className="faint">{f.type}</span></td>
                  <td className="selectable">
                    {f.isbn ? displayIsbn(reg, f.isbn) : <span className="faint">none</span>}{' '}
                    {v && (v.valid ? <CheckCircle2 size={13} color="var(--ok)" style={{ verticalAlign: -2 }} /> : <CircleAlert size={13} color="var(--fail)" style={{ verticalAlign: -2 }} />)}
                    {f.isbn && !rec && <div className="small faint">Not in your register yet.</div>}
                  </td>
                  <td>
                    <select className="select" value="" onChange={(e) => e.target.value && assign(f.id, e.target.value)}>
                      <option value="">{free.length ? `${free.length} free ISBN${free.length === 1 ? '' : 's'}...` : 'No free ISBN in the register'}</option>
                      {free.slice(0, 50).map((r) => <option key={r.isbn} value={r.isbn}>{displayIsbn(reg, r.isbn)}  ({r.block})</option>)}
                    </select>
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {f.isbn && !rec && v?.valid && <button className="btn small" onClick={() => assign(f.id, f.isbn)}>Record in the register</button>}
                    {f.isbn && <button className="btn small ghost" title="Take the ISBN off this edition and mark it as free again" onClick={() => { if (window.confirm('Take this ISBN off the edition? Only do this if the number has never been published.')) assign(f.id, ''); }}>Release</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {problems.map((p, i) => <div key={i} className={`notice ${p.severity === 'fail' ? 'fail' : 'warn'} small`} style={{ marginTop: 8 }}><CircleAlert size={14} /> {p.message}</div>)}
      </div>

      <div className="card">
        <h2>Add ISBNs to your register</h2>
        <div className="grid2">
          <div>
            <Field label="Paste ISBNs" hint="One on each line, with or without hyphens. Hyphens you type are kept for display.">
              <textarea className="textarea" rows={5} value={lines} placeholder={'978-0-6480000-0-7\n978-0-6480000-1-4'} onChange={(e) => setLines(e.target.value)} />
            </Field>
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input" placeholder="Label, for example: Block of 10 bought in 2026" value={block} onChange={(e) => setBlock(e.target.value)} />
              <button className="btn primary" disabled={!lines.trim()} onClick={() => { if (add(lines, block)) setLines(''); }}><Plus size={14} /> Add</button>
            </div>
          </div>
          <div>
            <Field label="Or add a whole block from its first number" hint="Blocks of 10, 100 or 1000 run in sequence; the check digits are worked out for you.">
              <div className="row">
                <input className="input" placeholder="First ISBN of the block" value={first} onChange={(e) => setFirst(e.target.value)} />
                <select className="select" style={{ width: 90 }} value={count} onChange={(e) => setCount(Number(e.target.value))}><option value={1}>1</option><option value={10}>10</option><option value={100}>100</option><option value={1000}>1000</option></select>
                <button className="btn" disabled={!first.trim()} onClick={() => { try { if (add(expandBlock(first, count).join('\n'), block || `Block of ${count}`)) setFirst(''); } catch (e) { toast('fail', e instanceof Error ? e.message : String(e)); } }}>Add block</button>
              </div>
            </Field>
            <div style={{ height: 12 }} />
            <Field label="Publisher prefix, for hyphens" hint="For example 978-0-6480000. Numbers that start with it are shown with the right hyphens. The app never guesses where hyphens go.">
              <div className="row">
                <input className="input" placeholder="978-0-6480000" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
                <button className="btn" disabled={!/^97[89]-\d+-\d+$/.test(prefix.trim())} onClick={() => { const next = structuredClone(reg); if (!next.prefixes.includes(prefix.trim())) next.prefixes.push(prefix.trim()); void save(next); setPrefix(''); }}>Add prefix</button>
              </div>
            </Field>
            {reg.prefixes.length > 0 && <div className="small dim" style={{ marginTop: 6 }}>Known prefixes: {reg.prefixes.join(', ')}</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>Register</h2>
          <span className="badge">{reg.records.length} ISBNs, {free.length} free</span>
        </div>
        {reg.records.length === 0 ? <p className="dim small">No ISBNs yet. Add the numbers you bought from Thorpe-Bowker (MyIdentifiers).</p> : (
          <table className="table">
            <thead><tr><th>ISBN</th><th>Used for</th><th>Block</th><th title="Title details lodged with the ISBN agency">Registered</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.isbn}>
                  <td className="selectable">{displayIsbn(reg, r.isbn)}</td>
                  <td>{r.assigned ? <>{r.assigned.bookTitle} <span className="faint">({r.assigned.formatLabel}, {r.assigned.date})</span></> : <span className="badge ok">free</span>}</td>
                  <td className="dim">{r.block}</td>
                  <td><input type="checkbox" checked={r.registered} onChange={(e) => { const next = structuredClone(reg); next.records.find((x) => x.isbn === r.isbn)!.registered = e.target.checked; void save(next); }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {reg.records.length > shown.length && <button className="btn small" style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>Show all {reg.records.length}</button>}
      </div>
    </div>
  );
}
