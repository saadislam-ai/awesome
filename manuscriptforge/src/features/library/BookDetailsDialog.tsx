import { useState } from 'react';
import { useApp } from '../../app/context';
import { BOOK_STATUSES, BOOK_TYPES, DECISIONS, type Book, type BookCategory, type BookStatus, type BookType, type Decision } from '../../core/model/book';
import { LANGUAGE_NAMES } from '../../core/text/language';
import { formatCount } from '../../core/text/words';
import { Button, ConfirmDialog, Field, Modal } from '../../ui/components';

export const GENRE_SUGGESTIONS = [
  'Literary fiction', 'Mystery', 'Thriller', 'Romance', 'Fantasy', 'Science fiction', 'Historical fiction', 'Horror',
  'Young adult', 'Memoir', 'Biography', 'Self-help', 'Business', 'History', 'How-to', 'Popular science', 'Picture book',
  'Early reader', 'Middle grade', 'Poetry',
];

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_NAMES)
  .filter(([code]) => code !== 'und')
  .sort((a, b) => a[1].localeCompare(b[1]));

interface Props {
  book: Book;
  onClose(): void;
  /** Go straight to the delete confirmation. */
  confirmDeleteOnly?: boolean;
}

export function BookDetailsDialog({ book, onClose, confirmDeleteOnly = false }: Props) {
  const { library, refreshBooks, notify, reportError, closeBook, currentBook } = useApp();
  const [form, setForm] = useState({
    title: book.title, author: book.author, category: book.category, bookType: book.bookType, genre: book.genre,
    language: book.language, status: book.status, tags: book.tags.join(', '), authorContact: book.authorContact,
    receivedAt: book.receivedAt ?? '', decision: book.decision ?? 'under_review', notes: book.notes,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    try {
      await library.updateBook(book.id, {
        title: form.title, author: form.author.trim(), category: form.category, bookType: form.bookType, genre: form.genre.trim(),
        language: form.language, status: form.status, tags: form.tags.split(','), notes: form.notes,
        ...(form.category === 'submission'
          ? { authorContact: form.authorContact.trim(), receivedAt: form.receivedAt || null, decision: form.decision as Decision }
          : {}),
      });
      await refreshBooks();
      notify('success', 'Book details saved.');
      onClose();
    } catch (e) {
      reportError('library', e, 'Could not save the book details.');
    }
  };

  const remove = async () => {
    try {
      if (currentBook?.id === book.id) closeBook();
      await library.deleteBook(book.id);
      await refreshBooks();
      notify('success', `"${book.title}" was deleted.`);
      onClose();
    } catch (e) {
      reportError('library', e, 'Could not delete the book.');
    }
  };

  const deleteDialog = (
    <ConfirmDialog
      title="Delete this book?"
      danger
      confirmLabel="Delete book"
      onCancel={() => (confirmDeleteOnly ? onClose() : setConfirmDelete(false))}
      onConfirm={remove}
      message={
        <>
          <strong>{book.title}</strong> will be removed from the library together with its chapters, its whole version history and the
          stored original file. This cannot be undone from inside the app.
        </>
      }
    />
  );
  if (confirmDeleteOnly) return deleteDialog;

  return (
    <>
      <Modal
        title="Book details"
        size="md"
        onClose={onClose}
        footer={
          <>
            <Button variant="danger" className="push-left" onClick={() => setConfirmDelete(true)}>
              Delete book
            </Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!form.title.trim()}>
              Save details
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Title" className="span-2">
            <input value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Author">
            <input value={form.author} onChange={(e) => set('author', e.target.value)} />
          </Field>
          <Field label="Shelf">
            <select value={form.category} onChange={(e) => set('category', e.target.value as BookCategory)}>
              <option value="mine">My Books</option>
              <option value="submission">New Author Submissions</option>
            </select>
          </Field>
          <Field label="Book type">
            <select value={form.bookType} onChange={(e) => set('bookType', e.target.value as BookType)}>
              {BOOK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Genre">
            <input value={form.genre} list="genre-suggestions" onChange={(e) => set('genre', e.target.value)} />
          </Field>
          <Field label="Language">
            <select value={form.language} onChange={(e) => set('language', e.target.value)}>
              <option value="und">Unknown</option>
              {LANGUAGE_OPTIONS.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set('status', e.target.value as BookStatus)}>
              {BOOK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Tags" hint="Separate tags with commas." className="span-2">
            <input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="series one, needs cover" />
          </Field>
          {form.category === 'submission' && (
            <>
              <Field label="Author contact">
                <input value={form.authorContact} onChange={(e) => set('authorContact', e.target.value)} placeholder="Email or phone" />
              </Field>
              <Field label="Date received">
                <input type="date" value={form.receivedAt} onChange={(e) => set('receivedAt', e.target.value)} />
              </Field>
              <Field label="Decision" className="span-2">
                <select value={form.decision} onChange={(e) => set('decision', e.target.value as Decision)}>
                  {DECISIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="Notes" className="span-2">
            <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <datalist id="genre-suggestions">
          {GENRE_SUGGESTIONS.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <p className="fine-print">
          {formatCount(book.wordCount)} words.{' '}
          {book.sourceName
            ? `Imported from ${book.sourceName}. The original file is kept untouched in the library folder.`
            : 'Created in ManuscriptForge.'}
        </p>
      </Modal>
      {confirmDelete && deleteDialog}
    </>
  );
}
