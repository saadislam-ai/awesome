/**
 * Series manager: every series in the library with its books in reading
 * order. Renaming a series or changing the order writes to the details of
 * each book concerned, so stores, the "Also by" page and ONIX all agree.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Library as LibraryIcon } from 'lucide-react';
import { groupSeries, setSeries, type BookSummary } from '@borderless/core';
import { useStore } from '../state/store';
import { Modal } from '../ui/kit';

export function SeriesManager(props: { onClose: () => void }) {
  const library = useStore((s) => s.library)!;
  const books = useStore((s) => s.books);
  const refreshBooks = useStore((s) => s.refreshBooks);
  const toast = useStore((s) => s.toast);
  const touch = useStore((s) => s.touch);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState<Record<string, string>>({});
  const series = groupSeries(books);
  const standalone = books.filter((b) => !b.problem && !(b.seriesName ?? '').trim());

  /** Write series name and number into a book: the open book through its live copy, any other through its folder. */
  const write = async (changes: { book: BookSummary; name: string; number: number | null }[]) => {
    setBusy(true);
    try {
      for (const c of changes) {
        const open = useStore.getState().project;
        const project = open && open.dir === c.book.path ? open : await library.openBook(c.book.path);
        await setSeries(project, c.name, c.number);
      }
      touch();
      await refreshBooks();
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const move = (list: BookSummary[], index: number, by: number, name: string) => {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void write(next.map((book, i) => ({ book, name, number: i + 1 })));
  };

  return (
    <Modal title="Series" onClose={props.onClose} wide>
      <p className="dim small" style={{ marginTop: 0 }}>
        A series is made of the books whose details name the same series. Stores link the volumes only when the name is written exactly the same way in each book, so rename it here rather than book by book.
      </p>
      {series.length === 0 && <div className="notice small">No book in the library belongs to a series yet. Put a book into one below, or open a book and fill in "Series" under Book, Details.</div>}
      {series.map((s) => (
        <div className="card" key={s.name} style={{ marginBottom: 12 }}>
          <div className="row">
            <LibraryIcon size={16} className="dim" />
            <input className="input grow" style={{ fontWeight: 600 }} defaultValue={s.name} disabled={busy}
              onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== s.name) void write(s.books.map((book) => ({ book, name, number: book.seriesNumber }))); }} />
            <button className="btn small" disabled={busy} title="Number the books 1, 2, 3 in the order shown" onClick={() => void write(s.books.map((book, i) => ({ book, name: s.name, number: i + 1 })))}>Number 1, 2, 3</button>
          </div>
          {s.problems.map((p, i) => <div key={i} className="notice warn small" style={{ marginTop: 8 }}>{p}</div>)}
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              {s.books.map((b, i) => (
                <tr key={b.path}>
                  <td style={{ width: 76 }}>
                    <input className="input" type="number" min={1} style={{ width: 64 }} defaultValue={b.seriesNumber ?? ''} disabled={busy} key={`${b.path}:${b.seriesNumber}`}
                      onBlur={(e) => { const n = e.target.value === '' ? null : Math.max(1, Math.round(Number(e.target.value))); if (n !== b.seriesNumber) void write([{ book: b, name: s.name, number: n }]); }} />
                  </td>
                  <td><b>{b.title}</b>{b.subtitle ? <span className="dim"> {b.subtitle}</span> : null}<div className="small faint">{b.author}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost icon" disabled={busy || i === 0} title="Earlier in the series" onClick={() => move(s.books, i, -1, s.name)}><ArrowUp size={14} /></button>
                    <button className="btn ghost icon" disabled={busy || i === s.books.length - 1} title="Later in the series" onClick={() => move(s.books, i, 1, s.name)}><ArrowDown size={14} /></button>
                    <button className="btn ghost small" disabled={busy} title="Take this book out of the series" onClick={() => void write([{ book: b, name: '', number: null }])}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {standalone.length > 0 && (
        <div className="card">
          <h2>Books that stand alone</h2>
          <table className="table">
            <tbody>
              {standalone.map((b) => (
                <tr key={b.path}>
                  <td><b>{b.title}</b><div className="small faint">{b.author}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <input className="input" list="series-names" style={{ width: 220 }} placeholder="Series name" value={newName[b.path] ?? ''} onChange={(e) => setNewName({ ...newName, [b.path]: e.target.value })} />{' '}
                    <button className="btn small" disabled={busy || !(newName[b.path] ?? '').trim()}
                      onClick={() => { const name = newName[b.path].trim(); const existing = series.find((x) => x.name.toLowerCase() === name.toLowerCase()); void write([{ book: b, name: existing?.name ?? name, number: (existing?.books.length ?? 0) + 1 }]); }}>Put in this series</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="series-names">{series.map((s) => <option key={s.name} value={s.name} />)}</datalist>
        </div>
      )}
    </Modal>
  );
}
