/**
 * Front and back matter: which standard sections the book has. Pages such as
 * the title page, the copyright page, the contents and the index are built
 * from the book's details; the others are documents you write.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, PenLine, Sparkles, Trash2 } from 'lucide-react';
import { BACK_KINDS, FRONT_KINDS, GENERATED_KINDS, KIND_TITLES, alsoByFromLibrary, primaryAuthor, type BinderNode, type SectionKind } from '@borderless/core';
import { useStore } from '../../state/store';
import { useBookEditor } from '../../ui/useBook';
import { Field } from '../../ui/kit';

const HINTS: Partial<Record<SectionKind, string>> = {
  'half-title': 'The title alone on the first page.',
  'title-page': 'Title, subtitle, author and imprint.',
  copyright: 'Copyright notice, ISBN of the edition, publisher and edition statement.',
  dedication: 'A short dedication on its own page.',
  epigraph: 'A quotation before the text. Put the source on the last line, after a hyphen.',
  toc: 'Built from the parts and chapters, with the real page numbers.',
  'also-by': 'A list of your other books.',
  'about-author': 'A short biography.',
  index: 'Built from the index marks in the text, written as :index[Term].',
  endnotes: 'Collects the notes when they are set at the end of the book.',
  'reading-group': 'Questions for book clubs.',
};

interface AlsoByGroup { label: string; titles: string[] }

export function MatterTab() {
  const { project, book, update, rev } = useBookEditor();
  const libraryBooks = useStore((s) => s.books);
  const touch = useStore((s) => s.touch);
  const selectDoc = useStore((s) => s.selectDoc);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  void rev;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      touch();
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const section = (role: 'front' | 'back', kinds: SectionKind[], title: string) => {
    const root = project.binder.roots.find((r) => r.role === role);
    if (!root) return null;
    const present = root.children ?? [];
    const missing = kinds.filter((k) => !present.some((n) => n.kind === k));
    const move = (node: BinderNode, delta: number) => run(async () => {
      const index = present.indexOf(node);
      await project.moveNode(node.id, root.id, Math.max(0, Math.min(present.length - 1, index + delta)) + (delta > 0 ? 1 : 0));
    });
    return (
      <div className="card">
        <h2>{title}</h2>
        <table className="table">
          <tbody>
            {present.map((n, i) => (
              <tr key={n.id} style={{ opacity: n.include === false ? 0.55 : 1 }}>
                <td style={{ width: 28 }}>
                  <input type="checkbox" title="Include in exports" checked={n.include !== false} onChange={(e) => void run(() => project.updateNode(n.id, { include: e.target.checked }))} />
                </td>
                <td>
                  <b>{n.title}</b>{' '}
                  {n.generated ? <span className="badge accent"><Sparkles size={11} /> built automatically</span> : <span className="badge">your text</span>}
                  <div className="small dim">{HINTS[n.kind] ?? ''}</div>
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  {!n.generated && n.file && <button className="btn small" onClick={() => selectDoc(n.id)}><PenLine size={13} /> Write</button>}
                  {GENERATED_KINDS.has(n.kind) && !['toc', 'index', 'endnotes', 'also-by'].includes(n.kind) && (
                    <button className="btn small ghost" disabled={busy} title={n.generated ? 'Replace the automatic page by a document you write yourself' : 'Go back to the automatic page (your text is kept in the file)'}
                      onClick={() => void run(() => project.setGenerated(n.id, !n.generated))}>
                      {n.generated ? 'Write it myself' : 'Build automatically'}
                    </button>
                  )}
                  <button className="btn ghost icon" title="Move up" disabled={busy || i === 0} onClick={() => void move(n, -1)}><ArrowUp size={14} /></button>
                  <button className="btn ghost icon" title="Move down" disabled={busy || i === present.length - 1} onClick={() => void move(n, 1)}><ArrowDown size={14} /></button>
                  <button className="btn ghost icon" title="Remove (a document goes to the trash folder of the book)" disabled={busy}
                    onClick={() => { if (window.confirm(`Remove "${n.title}" from the book?${n.file ? ' Its text is moved to the trash folder inside the book, not deleted.' : ''}`)) void run(() => project.removeNode(n.id)); }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {missing.length > 0 && (
          <div className="row wrap" style={{ marginTop: 10 }}>
            <span className="small dim">Add:</span>
            {missing.map((k) => (
              <button key={k} className="btn small" disabled={busy} title={HINTS[k]}
                onClick={() => void run(() => project.addNode(root.id, { type: 'doc', kind: k, title: KIND_TITLES[k] ?? k, generated: GENERATED_KINDS.has(k), text: GENERATED_KINDS.has(k) ? undefined : '' }))}>
                <FilePlus2 size={13} /> {KIND_TITLES[k] ?? k}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const alsoBy = project.binder.roots.flatMap((r) => r.children ?? []).find((n) => n.kind === 'also-by');
  const groups: AlsoByGroup[] = (alsoBy?.data?.groups as AlsoByGroup[] | undefined) ?? [];
  const auto = Boolean(alsoBy?.data?.auto);
  const fromLibrary = alsoByFromLibrary({ id: book.id, series: book.series, author: primaryAuthor(book) }, libraryBooks);
  const setGroups = (next: AlsoByGroup[]) => alsoBy && void run(() => project.updateNode(alsoBy.id, { data: { ...(alsoBy.data ?? {}), groups: next } }));

  return (
    <div className="page-narrow">
      {section('front', FRONT_KINDS, 'Front matter')}
      {section('back', BACK_KINDS, 'Back matter')}

      <div className="card">
        <h2>Copyright page</h2>
        <p className="dim small">The page shows only the ISBN of the edition being built. Title, author, year, imprint and edition statement come from the Details tab.</p>
        <Field label="Rights statement">
          <textarea className="textarea" rows={4} value={book.copyright.rightsStatement} onChange={(e) => update((b) => { b.copyright.rightsStatement = e.target.value; })} />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Further lines" hint="One line each: cover design credit, editor, disclaimers.">
          <textarea className="textarea" rows={4} value={book.copyright.extraLines.join('\n')} onChange={(e) => update((b) => { b.copyright.extraLines = e.target.value.split('\n'); })} onBlur={() => update((b) => { b.copyright.extraLines = b.copyright.extraLines.map((l) => l.trim()).filter(Boolean); })} />
        </Field>
        <label className="check" style={{ marginTop: 10 }} title="A line saying that a catalogue record for the book is available from the National Library of Australia">
          <input type="checkbox" checked={book.copyright.nlaCatalogueLine} onChange={(e) => update((b) => { b.copyright.nlaCatalogueLine = e.target.checked; })} /> National Library of Australia catalogue line
        </label>
      </div>

      {alsoBy && (
        <div className="card">
          <div className="row"><h2 className="grow" style={{ margin: 0 }}>Also by the author</h2>
            <button className="btn small" onClick={() => setGroups([...groups, { label: '', titles: [] }])}><FilePlus2 size={13} /> Add a group</button>
          </div>
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={auto} onChange={(e) => alsoBy && void run(() => project.updateNode(alsoBy.id, { data: { ...(alsoBy.data ?? {}), auto: e.target.checked } }))} />
            Fill this page from my library: the other books of this series in reading order, then my other books
          </label>
          {auto && (
            <div className="notice small" style={{ marginTop: 8, display: 'block' }}>
              {fromLibrary.length === 0 ? 'The library holds no other book by this author yet, so the page is left out until there is one.' : fromLibrary.map((g, i) => (
                <div key={i}>{g.label ? <b>{g.label}: </b> : null}{g.titles.join(', ')}</div>
              ))}
            </div>
          )}
          {!auto && groups.length === 0 && <p className="dim small">Add a group such as "Fiction" and list the titles, one on each line.</p>}
          {!auto && groups.map((g, i) => (
            <div className="grid2" key={i} style={{ marginTop: 10, gridTemplateColumns: '200px 1fr auto' }}>
              <Field label="Group heading"><input className="input" defaultValue={g.label} placeholder="Fiction" onBlur={(e) => setGroups(groups.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label="Titles, one on each line"><textarea className="textarea" rows={3} defaultValue={g.titles.join('\n')} onBlur={(e) => setGroups(groups.map((x, k) => (k === i ? { ...x, titles: e.target.value.split('\n').map((t) => t.trim()).filter(Boolean) } : x)))} /></Field>
              <button className="btn ghost icon" style={{ alignSelf: 'flex-end' }} title="Remove this group" onClick={() => setGroups(groups.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
