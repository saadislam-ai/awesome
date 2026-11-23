import { useMemo, useState } from 'react';
import { AlertTriangle, FileUp, FolderOpen, FolderPlus, Library as LibraryIcon, Plus, Search } from 'lucide-react';
import { GENRES, GENRE_TEMPLATES, isStale, type BookSummary, type Genre, type PlatformId } from '@borderless/core';
import { useStore } from '../state/store';
import { Field, Menu, Modal, fmtNumber, timeAgo, type MenuItem } from '../ui/kit';
import { ImportWizard } from './ImportWizard';
import { SeriesManager } from './SeriesManager';

const FORMAT_SHORT: Record<string, string> = { paperback: 'Paperback', hardcover: 'Hardcover', ebook: 'Ebook' };
const LANGUAGES = [
  { id: 'en-AU', label: 'English (Australia)' },
  { id: 'en-GB', label: 'English (United Kingdom)' },
  { id: 'en-US', label: 'English (United States)' },
  { id: 'bn', label: 'Bangla (Bengali)' },
];

/** The name of an edition with its page size, unless the name already says the size ("Paperback 6 x 9"). */
function editionChip(label: string, type: string, trim: string): string {
  if (type === 'ebook') return label;
  const size = trim.replace('x', ' x ');
  const plain = (t: string) => t.toLowerCase().replace(/[\s\u00D7x]/g, '');
  return plain(label).includes(plain(trim)) ? label : `${label} ${size}`;
}

export function LibraryView() {
  const books = useStore((s) => s.books);
  const specs = useStore((s) => s.specs);
  const library = useStore((s) => s.library);
  const host = useStore((s) => s.host);
  const openBook = useStore((s) => s.openBook);
  const refreshBooks = useStore((s) => s.refreshBooks);
  const toast = useStore((s) => s.toast);
  const setView = useStore((s) => s.setView);
  const [wizard, setWizard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; book: BookSummary } | null>(null);

  const stale = useMemo(() => Object.values(specs?.platforms ?? {}).filter((s) => s && isStale(s)), [specs]);
  const shown = books.filter((b) => !filter || `${b.title} ${b.subtitle} ${b.author} ${b.series}`.toLowerCase().includes(filter.toLowerCase()));

  const addExisting = async () => {
    const dir = await host.ui?.pickFolder('Choose a book folder (the folder that contains book.json)', library?.booksDir);
    if (!dir || !library) return;
    try {
      await library.addBook(dir);
      await refreshBooks();
      toast('ok', 'Book added to the library.');
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };

  const bookMenu = (b: BookSummary): MenuItem[] => [
    { label: 'Open', onClick: () => void openBook(b.path) },
    { label: 'Show the folder', onClick: () => void host.ui?.revealPath(b.path) },
    { separator: true },
    {
      label: 'Remove from library (keeps the folder)',
      onClick: async () => {
        await library?.forgetBook(b.path);
        await refreshBooks();
        toast('info', `"${b.title}" was removed from the list. Its folder is untouched.`);
      },
    },
  ];

  return (
    <>
      <div className="topbar">
        <span className="title">Library</span>
        <span className="sub">{books.length} {books.length === 1 ? 'book' : 'books'}</span>
        <div className="grow" />
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 8, top: 8 }} className="faint" />
          <input className="input" style={{ paddingLeft: 27, width: 220 }} placeholder="Filter books" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn" onClick={() => setSeriesOpen(true)} title="Series: reading order, numbering and names across books"><LibraryIcon size={15} /> Series</button>
        <button className="btn" onClick={() => setImporting(true)} title="Start a book from a Word, Markdown, text, EPUB or Scrivener file"><FileUp size={15} /> Import a manuscript</button>
        <button className="btn" onClick={addExisting}><FolderPlus size={15} /> Add existing folder</button>
        <button className="btn primary" onClick={() => setWizard(true)}><Plus size={15} /> New book</button>
      </div>
      <div className="page">
        {stale.length > 0 && (
          <div className="notice warn" style={{ marginBottom: 14 }}>
            <AlertTriangle size={16} />
            <div>
              The platform rules for {stale.map((s) => s!.displayName).join(', ')} were last checked more than six months ago.
              Printing costs and file rules change, so please review them. <a href="#" onClick={(e) => { e.preventDefault(); setView('settings'); }}>Open the spec list</a>
            </div>
          </div>
        )}
        {books.length === 0 ? (
          <div className="empty">
            <h2>Your library is empty</h2>
            <p>Create your first book, or add a book folder you already have.</p>
            <button className="btn primary" onClick={() => setWizard(true)}><Plus size={15} /> New book</button>
            <p className="small faint" style={{ marginTop: 18 }}>Library folder: <span className="selectable">{library?.dir}</span></p>
          </div>
        ) : (
          <div className="books">
            {shown.map((b) => (
              <div
                key={b.path}
                className="book-card"
                onClick={() => !b.problem && void openBook(b.path)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, book: b }); }}
                title={b.path}
              >
                <div className="book-cover"><div className="t">{b.title}</div><div className="a">{b.author}</div></div>
                <div className="grow">
                  <h3>{b.title}</h3>
                  {b.subtitle && <div className="meta">{b.subtitle}</div>}
                  <div className="meta">{b.author}{b.series ? `, ${b.series}` : ''}</div>
                  {b.problem ? (
                    <div className="notice fail small" style={{ marginTop: 8 }}>{b.problem}</div>
                  ) : (
                    <>
                      <div className="meta" style={{ marginTop: 4 }}>{fmtNumber(b.words)} words{b.updatedAt ? `, edited ${timeAgo(b.updatedAt)}` : ''}</div>
                      <div className="formats">
                        {b.formats.filter((f) => f.enabled).map((f) => (
                          <span key={f.id} className={`badge ${f.isbn ? 'accent' : ''}`} title={f.isbn ? `ISBN ${f.isbn}` : 'No ISBN assigned yet'}>
                            {editionChip(f.label || FORMAT_SHORT[f.type], f.type, f.trim)}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {books.length > 0 && (
          <p className="small faint" style={{ marginTop: 18 }}>
            <FolderOpen size={12} style={{ verticalAlign: -2 }} /> Library folder: <span className="selectable">{library?.dir}</span>
          </p>
        )}
      </div>
      {wizard && <NewBookWizard onClose={() => setWizard(false)} />}
      {importing && <ImportWizard onClose={() => setImporting(false)} />}
      {seriesOpen && <SeriesManager onClose={() => setSeriesOpen(false)} />}
      {menu && <Menu x={menu.x} y={menu.y} items={bookMenu(menu.book)} onClose={() => setMenu(null)} />}
    </>
  );
}

function NewBookWizard(props: { onClose: () => void }) {
  const library = useStore((s) => s.library);
  const publisher = useStore((s) => s.publisher);
  const specs = useStore((s) => s.specs);
  const openBook = useStore((s) => s.openBook);
  const refreshBooks = useStore((s) => s.refreshBooks);
  const toast = useStore((s) => s.toast);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [author, setAuthor] = useState(publisher?.defaultAuthor ?? '');
  const [genre, setGenre] = useState<Genre>('novel');
  const [language, setLanguage] = useState(publisher?.defaultLanguage ?? 'en-AU');
  const [trim, setTrim] = useState(GENRE_TEMPLATES.novel.trim);
  const [paper, setPaper] = useState<'white' | 'cream'>(GENRE_TEMPLATES.novel.paper);
  const [platforms, setPlatforms] = useState<PlatformId[]>(['kdp', 'ingramspark', 'draft2digital']);
  const [busy, setBusy] = useState(false);

  // Trim sizes offered by the chosen print platforms, with the platforms that support each one.
  const trims = useMemo(() => {
    const map = new Map<string, { id: string; w: number; h: number; on: string[] }>();
    for (const p of ['kdp', 'ingramspark'] as const) {
      for (const t of specs?.platforms[p]?.print?.formats.paperback?.trimSizes ?? []) {
        const e = map.get(t.id) ?? { id: t.id, w: t.widthIn, h: t.heightIn, on: [] };
        e.on.push(specs!.platforms[p]!.displayName);
        map.set(t.id, e);
      }
    }
    return [...map.values()].sort((a, b) => a.w - b.w || a.h - b.h);
  }, [specs]);

  const pickGenre = (g: Genre) => {
    setGenre(g);
    setTrim(GENRE_TEMPLATES[g].trim);
    setPaper(GENRE_TEMPLATES[g].paper);
  };
  const toggle = (p: PlatformId) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const bangla = language.startsWith('bn');
  const langWarnings = bangla
    ? (['kdp', 'ingramspark', 'draft2digital'] as const).filter((p) => platforms.includes(p)).flatMap((p) => {
        const spec = specs?.platforms[p];
        const langs = spec?.languages;
        const out: string[] = [];
        for (const f of ['ebook', 'paperback'] as const) {
          const list = langs?.[f]?.supported;
          if (Array.isArray(list) && !list.includes('bn')) out.push(`${spec!.displayName} does not list Bangla for ${f === 'ebook' ? 'ebooks' : 'print'}.`);
        }
        return out;
      })
    : [];

  const create = async () => {
    if (!library || !title.trim() || !author.trim()) return;
    setBusy(true);
    try {
      const project = await library.createBook({ title: title.trim(), subtitle: subtitle.trim(), author: author.trim(), genre, language, trim, paper, platforms, imprint: publisher?.imprint });
      await refreshBooks();
      props.onClose();
      await openBook(project.dir);
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New book"
      wide
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !title.trim() || !author.trim()} onClick={create}>Create book</button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="grid2">
          <Field label="Title"><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The title of the book" /></Field>
          <Field label="Subtitle (optional)"><input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></Field>
          <Field label="Author"><input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
          <Field label="Language">
            <select className="select" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Kind of book</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {GENRES.map((g) => (
              <button key={g} className={`card${genre === g ? ' on' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', padding: 10, borderColor: genre === g ? 'var(--accent)' : undefined, background: genre === g ? 'var(--accent-soft)' : undefined, margin: 0 }} onClick={() => pickGenre(g)}>
                <div style={{ fontWeight: 600 }}>{GENRE_TEMPLATES[g].label}</div>
                <div className="small dim" style={{ marginTop: 3 }}>{GENRE_TEMPLATES[g].description}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid3">
          <Field label="Trim size (paperback)" hint="You can add other sizes and formats later.">
            <select className="select" value={trim} onChange={(e) => setTrim(e.target.value)}>
              {trims.map((t) => <option key={t.id} value={t.id}>{t.w} x {t.h} in ({t.on.join(' + ')})</option>)}
            </select>
          </Field>
          <Field label="Paper">
            <select className="select" value={paper} onChange={(e) => setPaper(e.target.value as 'white' | 'cream')}>
              <option value="cream">Cream (fiction, memoir)</option>
              <option value="white">White (nonfiction, pictures)</option>
            </select>
          </Field>
          <Field label="Publish through">
            <div className="col" style={{ gap: 3 }}>
              {(['kdp', 'ingramspark', 'draft2digital'] as const).map((p) => (
                <label className="check" key={p}>
                  <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} />
                  {specs?.platforms[p]?.displayName ?? p}
                </label>
              ))}
            </div>
          </Field>
        </div>
        {langWarnings.map((w) => <div className="notice warn" key={w}><AlertTriangle size={15} />{w}</div>)}
        <div className="small faint">
          The book is created as a plain folder in <span className="selectable">{library?.booksDir}</span>. Each format (paperback, hardcover, ebook) will need its own ISBN.
        </div>
      </div>
    </Modal>
  );
}
