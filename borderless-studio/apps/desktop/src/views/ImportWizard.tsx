/**
 * Import a manuscript as a new book: choose a Word, Markdown, text, EPUB or
 * Scrivener file, look at what was found, and create the book. The original
 * file is only read.
 */
import { useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { IMPORT_EXTENSIONS, cleanTitle, fillNewBookFromImport, importFile, type ImportedBook } from '@borderless/core';
import { useStore } from '../state/store';
import { Field, Modal, fmtNumber } from '../ui/kit';

const KIND_LABEL: Record<string, string> = { part: 'Part', chapter: 'Chapter', front: 'Front matter', back: 'Back matter' };

export function ImportWizard(props: { onClose: () => void }) {
  const host = useStore((s) => s.host);
  const library = useStore((s) => s.library);
  const publisher = useStore((s) => s.publisher);
  const refreshBooks = useStore((s) => s.refreshBooks);
  const openBook = useStore((s) => s.openBook);
  const toast = useStore((s) => s.toast);
  const [source, setSource] = useState('');
  const [found, setFound] = useState<ImportedBook | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [author, setAuthor] = useState(publisher?.defaultAuthor ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    const file = await host.ui?.pickFile('Choose a manuscript: Word (.docx), Markdown, text, EPUB, or the .scrivx file inside a Scrivener project', [{ name: 'Manuscripts', extensions: IMPORT_EXTENSIONS }]);
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const book = await importFile(host, file);
      setSource(file);
      setFound(book);
      // "Title: Subtitle" is offered as two fields; both can be changed before the book is made.
      const cut = book.title.indexOf(': ');
      setTitle(cut > 0 ? book.title.slice(0, cut) : book.title);
      setSubtitle(cut > 0 ? book.title.slice(cut + 2) : '');
      if (book.author) setAuthor(book.author);
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!library || !found) return;
    setBusy(true);
    try {
      const language = /^(en|bn)/i.test(found.language) ? found.language : publisher?.defaultLanguage ?? 'en-AU';
      const project = await library.createBook({ title: title.trim() || 'Imported book', subtitle: subtitle.trim(), author: author.trim(), genre: 'novel', language, imprint: publisher?.imprint });
      const summary = await fillNewBookFromImport(project, found);
      await refreshBooks();
      toast('ok', `Imported ${summary.chapters} chapter${summary.chapters === 1 ? '' : 's'} and ${fmtNumber(summary.words)} words${summary.images ? `, with ${summary.images} picture${summary.images === 1 ? '' : 's'}` : ''}.`);
      props.onClose();
      await openBook(project.dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const words = found ? found.items.reduce((n, i) => n + i.text.split(/\s+/).filter(Boolean).length, 0) : 0;
  return (
    <Modal
      title="Import a manuscript" onClose={props.onClose} wide
      footer={<>
        <button className="btn" onClick={props.onClose}>Cancel</button>
        <button className="btn primary" disabled={!found || busy || found.items.length === 0} onClick={() => void create()}>{busy ? <Loader2 size={14} className="spin" /> : null} Create the book</button>
      </>}
    >
      <p className="dim" style={{ marginTop: 0 }}>
        Word files keep their chapters (from the "Heading 1" style or lines such as "Chapter Seven"), italics, footnotes, pictures, and tracked changes and comments, which arrive as suggestions. Your original file is not changed.
      </p>
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void choose()}><FileUp size={15} /> Choose a file</button>
        {source && <span className="small dim selectable">{source}</span>}
        {busy && !found && <Loader2 size={15} className="spin" />}
      </div>
      {error && <div className="notice fail selectable" style={{ marginTop: 10 }}>{error}</div>}
      {found && (
        <>
          <div className="grid2" style={{ marginTop: 14 }}>
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Author"><input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
          </div>
          <Field label="Subtitle (optional)"><input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></Field>
          <div className="row wrap small" style={{ marginTop: 12 }}>
            <span className="badge accent">{found.items.filter((i) => i.kind === 'chapter').length} chapters</span>
            {found.items.some((i) => i.kind === 'part') && <span className="badge">{found.items.filter((i) => i.kind === 'part').length} parts</span>}
            <span className="badge">{fmtNumber(words)} words</span>
            {found.images.length > 0 && <span className="badge">{found.images.length} pictures</span>}
          </div>
          {found.notes.map((n, i) => <div key={i} className="notice small" style={{ marginTop: 8 }}>{n}</div>)}
          <div className="import-list">
            {found.items.map((item, i) => (
              <div key={i} className="row small" style={{ padding: '3px 0' }}>
                <span className="badge" style={{ minWidth: 86, justifyContent: 'center' }}>{KIND_LABEL[item.kind]}</span>
                <span className="grow">{cleanTitle(item.title) || item.title || 'Chapter without a title'}{item.excluded ? <span className="faint"> (kept for reference, not printed)</span> : null}</span>
                <span className="faint">{item.kind === 'part' ? '' : `${fmtNumber(item.text.split(/\s+/).filter(Boolean).length)} words`}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
