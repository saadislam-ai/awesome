import { BookOpen, FileText, MoreHorizontal, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { ACCEPT_ATTRIBUTE } from '../../core/import';
import { BOOK_STATUSES, BOOK_TYPES, decisionLabel, statusLabel, typeLabel, type Book, type BookCategory, type SearchHit } from '../../core/model/book';
import { languageName } from '../../core/text/language';
import { formatCount } from '../../core/text/words';
import { Button, EmptyState, Menu, Pill } from '../../ui/components';
import { formatDate, MOD, relativeTime } from '../../ui/format';
import { BookDetailsDialog } from './BookDetailsDialog';

type SortKey = 'opened' | 'title' | 'author' | 'words' | 'added';

const STATUS_TONE: Record<Book['status'], 'neutral' | 'accent' | 'success' | 'warning'> = {
  imported: 'neutral', analyzed: 'accent', editing: 'warning', reviewed: 'accent', approved: 'success', exported: 'success',
};
const DECISION_TONE = { under_review: 'neutral', needs_work: 'warning', accept: 'success', decline: 'danger' } as const;

function BookCard({ book, onOpen, onDetails, onDelete }: { book: Book; onOpen(): void; onDetails(): void; onDelete(): void }) {
  const meta = [typeLabel(book.bookType), book.genre, languageName(book.language)].filter((part) => part && part !== 'Unknown');
  return (
    <article className="book-card" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen()} data-testid="book-card">
      <div className="book-card-top">
        <Pill tone={STATUS_TONE[book.status]}>{statusLabel(book.status)}</Pill>
        {book.category === 'submission' && <Pill tone={DECISION_TONE[book.decision ?? 'under_review']}>{decisionLabel(book.decision)}</Pill>}
        <span className="grow" />
        <Menu
          label={`Actions for ${book.title}`}
          trigger={<MoreHorizontal size={18} />}
          items={[
            { label: 'Open', icon: <BookOpen size={15} />, onSelect: onOpen },
            { label: 'Details', icon: <Pencil size={15} />, onSelect: onDetails },
            { label: 'Delete…', icon: <Trash2 size={15} />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
      <h3 className="book-title">{book.title}</h3>
      <p className="book-author">{book.author || 'Unknown author'}</p>
      <p className="book-meta">{meta.join(' · ')}</p>
      {book.tags.length > 0 && (
        <div className="tag-row">
          {book.tags.slice(0, 4).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
      )}
      <div className="book-card-foot">
        <span>{formatCount(book.wordCount)} words</span>
        <span>
          {book.category === 'submission' && book.receivedAt ? `Received ${formatDate(book.receivedAt)}` : book.lastOpenedAt ? `Opened ${relativeTime(book.lastOpenedAt)}` : 'Not opened yet'}
        </span>
      </div>
    </article>
  );
}

interface Props {
  category: BookCategory;
  onCategoryChange(category: BookCategory): void;
  onImportFile(file: File, category: BookCategory): void;
}

export function LibraryView({ category, onCategoryChange: setCategory, onImportFile }: Props) {
  const { books, openBook, library, reportError } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [language, setLanguage] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<SortKey>('opened');
  const [details, setDetails] = useState<Book | null>(null);
  const [deleting, setDeleting] = useState<Book | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const counts = useMemo(
    () => ({ mine: books.filter((b) => b.category === 'mine').length, submission: books.filter((b) => b.category === 'submission').length }),
    [books],
  );
  const shelf = useMemo(() => books.filter((b) => b.category === category), [books, category]);
  const languages = useMemo(() => [...new Set(shelf.map((b) => b.language))].sort(), [shelf]);
  const tags = useMemo(() => [...new Set(shelf.flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b)), [shelf]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = shelf.filter((b) => {
      if (status && b.status !== status) return false;
      if (type && b.bookType !== type) return false;
      if (language && b.language !== language) return false;
      if (tag && !b.tags.includes(tag)) return false;
      if (!q) return true;
      return [b.title, b.author, b.genre, ...b.tags].some((field) => field.toLowerCase().includes(q));
    });
    const by: Record<SortKey, (a: Book, b: Book) => number> = {
      opened: (a, b) => (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt),
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title),
      words: (a, b) => b.wordCount - a.wordCount,
      added: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return [...list].sort(by[sort]);
  }, [shelf, query, status, type, language, tag, sort]);

  // Search inside the text of every book, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      library
        .searchText(q)
        .then((found) => !cancelled && setHits(found))
        .catch((e) => reportError('search', e, 'Search failed.'));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, library, reportError, books]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        fileInput.current?.click();
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtersActive = !!(query || status || type || language || tag);
  const clearFilters = () => {
    setQuery('');
    setStatus('');
    setType('');
    setLanguage('');
    setTag('');
  };

  return (
    <div
      className={`view library-view ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onImportFile(file, category);
      }}
    >
      <header className="view-header">
        <div>
          <h1>Library</h1>
          <p className="view-sub">Every manuscript you publish or are considering, kept on this computer.</p>
        </div>
        <Button variant="primary" icon={<Upload size={16} />} onClick={() => fileInput.current?.click()} title={`Import a manuscript (${MOD}+O)`}>
          Import manuscript
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          hidden
          data-testid="import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImportFile(file, category);
          }}
        />
      </header>

      <div className="tabs" role="tablist">
        {([['mine', 'My Books'], ['submission', 'New Author Submissions']] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={category === value} className={`tab ${category === value ? 'is-active' : ''}`} onClick={() => setCategory(value)}>
            {label} <span className="tab-count">{counts[value]}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="search-box">
          <Search size={16} />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search titles, authors, tags and text (${MOD}+K)`}
            aria-label="Search the library"
          />
          {query && (
            <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {BOOK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by book type">
          <option value="">All types</option>
          {BOOK_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {languages.length > 1 && (
          <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Filter by language">
            <option value="">All languages</option>
            {languages.map((code) => (
              <option key={code} value={code}>{languageName(code)}</option>
            ))}
          </select>
        )}
        {tags.length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <span className="grow" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort books">
          <option value="opened">Recently opened</option>
          <option value="added">Recently added</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="words">Longest first</option>
        </select>
      </div>

      <div className="view-scroll">
        {shelf.length === 0 ? (
          <EmptyState
            icon={<FileText size={34} />}
            title={category === 'mine' ? 'No books here yet' : 'No submissions yet'}
            action={
              <Button variant="primary" icon={<Upload size={16} />} onClick={() => fileInput.current?.click()}>
                Import manuscript
              </Button>
            }
          >
            {category === 'mine'
              ? 'Import one of your books to start improving it. You can also drop a file anywhere on this screen.'
              : "Import a new author's manuscript to review it. You can also drop a file anywhere on this screen."}{' '}
            Supported formats: Word (.docx), text, Markdown, RTF, EPUB and PDF.
          </EmptyState>
        ) : visible.length === 0 && hits.length === 0 ? (
          <EmptyState title="No books match" action={<Button onClick={clearFilters}>Clear search and filters</Button>}>
            Nothing on this shelf matches the current search and filters.
          </EmptyState>
        ) : (
          <>
            {filtersActive && (
              <p className="result-count">
                {visible.length} of {shelf.length} book{shelf.length === 1 ? '' : 's'}
                <button className="link-btn" onClick={clearFilters}>Clear</button>
              </p>
            )}
            <div className="book-grid">
              {visible.map((book) => (
                <BookCard key={book.id} book={book} onOpen={() => void openBook(book.id)} onDetails={() => setDetails(book)} onDelete={() => setDeleting(book)} />
              ))}
            </div>
          </>
        )}

        {hits.length > 0 && (
          <section className="text-hits">
            <h2>Found inside books</h2>
            <ul>
              {hits.map((hit) => (
                <li key={hit.chapterId}>
                  <button className="hit" onClick={() => void openBook(hit.bookId, hit.chapterId)}>
                    <span className="hit-where">
                      {hit.bookTitle} <span className="muted">· {hit.chapterTitle}</span>
                    </span>
                    <span className="hit-snippet">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {dragging && <div className="drop-overlay">Drop the manuscript to import it</div>}
      {details && <BookDetailsDialog book={details} onClose={() => setDetails(null)} />}
      {deleting && <BookDetailsDialog book={deleting} confirmDeleteOnly onClose={() => setDeleting(null)} />}
    </div>
  );
}
