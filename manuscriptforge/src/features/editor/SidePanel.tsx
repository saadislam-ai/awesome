import { Camera, Eye, GitCompare, Lock, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import type { BookBible } from '../../core/analysis/bible';
import type { Book, Version, VersionChapter } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import { Button, ConfirmDialog, Field, Menu, Modal, Pill, Spinner } from '../../ui/components';
import { formatDateTime, MOD } from '../../ui/format';
import { BlocksView } from './BlocksView';
import { CompareDialog } from './CompareDialog';

type Tab = 'notes' | 'instructions' | 'bible' | 'history';

interface Props {
  book: Book;
  /** Changes whenever the version list may have changed. */
  versionsKey: number;
  /** Saves any pending edits. Called before reading or changing versions. */
  flush(): Promise<void>;
  /** Called after the book's text was replaced by a restored version. */
  onRestored(): void;
  snapshotRequest: number;
}

/** A text area that saves itself a moment after typing stops. */
function AutosaveText({ value, onSave, placeholder, label }: { value: string; onSave(text: string): Promise<void>; placeholder: string; label: string }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(text);
  const dirty = useRef(false);
  const save = useRef(onSave);
  save.current = onSave;
  const { platform } = useApp();

  useEffect(() => {
    const saveNow = async () => {
      window.clearTimeout(timer.current);
      if (!dirty.current) return;
      dirty.current = false;
      await save.current(latest.current);
    };
    const stopWatchingClose = platform.onBeforeClose(saveNow);
    return () => {
      stopWatchingClose();
      void saveNow();
    };
  }, [platform]);

  return (
    <textarea
      className="side-text"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        latest.current = e.target.value;
        dirty.current = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          dirty.current = false;
          void save.current(latest.current);
        }, 600);
      }}
    />
  );
}

const KIND_LABEL: Record<Version['kind'], string> = { original: 'Original', manual: 'Snapshot', auto: 'Auto-save', safety: 'Safety copy' };

function VersionPreview({ version, onClose, onRestore }: { version: Version; onClose(): void; onRestore(): void }) {
  const { library, reportError } = useApp();
  const [chapters, setChapters] = useState<VersionChapter[] | null>(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    library.getVersionChapters(version.id).then(setChapters).catch((e) => reportError('versions', e, 'Could not open this version.'));
  }, [library, version.id, reportError]);
  return (
    <Modal
      title={`${version.name} · ${formatDateTime(version.createdAt)}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="push-left muted">Read-only preview. {formatCount(version.wordCount)} words in {version.chapterCount} chapters.</span>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<RotateCcw size={15} />} onClick={onRestore}>Restore this version</Button>
        </>
      }
    >
      {!chapters ? (
        <Spinner label="Opening version…" />
      ) : (
        <div className="version-preview">
          <ol className="version-chapters">
            {chapters.map((c, i) => (
              <li key={i}>
                <button className={i === selected ? 'is-active' : ''} onClick={() => setSelected(i)}>
                  <span>{c.title}</span>
                  <span className="muted">{formatCount(c.wordCount)}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="version-text">
            <h3>{chapters[selected]?.title}</h3>
            <BlocksView blocks={chapters[selected]?.blocks ?? []} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function HistoryTab({ book, versionsKey, flush, onRestored, snapshotRequest }: Props) {
  const { library, notify, reportError } = useApp();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Version | null>(null);
  const [restoring, setRestoring] = useState<Version | null>(null);
  const [renaming, setRenaming] = useState<Version | null>(null);
  const [deleting, setDeleting] = useState<Version | null>(null);
  const [comparing, setComparing] = useState<Version | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    library
      .listVersions(book.id)
      .then((list) => !cancelled && setVersions(list))
      .catch((e) => reportError('versions', e, 'Could not load the version history.'));
    return () => {
      cancelled = true;
    };
  }, [library, book.id, versionsKey, reloadKey, reportError]);

  useEffect(() => {
    if (snapshotRequest > 0) setNaming(true);
  }, [snapshotRequest]);

  const saveSnapshot = async () => {
    try {
      await flush();
      await library.createSnapshot(book.id, name.trim() || 'Snapshot', 'manual');
      setNaming(false);
      setName('');
      reload();
      notify('success', 'Snapshot saved.');
    } catch (e) {
      reportError('versions', e, 'Could not save the snapshot.');
    }
  };

  const restore = async (version: Version) => {
    try {
      await flush();
      await library.restoreVersion(book.id, version.id);
      setRestoring(null);
      setPreview(null);
      reload();
      onRestored();
      notify('success', `Restored "${version.name}". The text from before the restore is kept in the history.`);
    } catch (e) {
      reportError('versions', e, 'Could not restore this version.');
    }
  };

  return (
    <div className="history-tab">
      {naming ? (
        <form
          className="snapshot-form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSnapshot();
          }}
        >
          <Field label="Name this snapshot">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Before the big rewrite" autoFocus />
          </Field>
          <div className="row-end">
            <Button size="sm" onClick={() => setNaming(false)}>Cancel</Button>
            <Button size="sm" variant="primary" type="submit">Save snapshot</Button>
          </div>
        </form>
      ) : (
        <Button icon={<Camera size={15} />} onClick={() => setNaming(true)} title={`Save a named snapshot (${MOD}+Shift+S)`} className="block-btn">
          Save snapshot
        </Button>
      )}
      <p className="fine-print">
        Snapshots are also saved automatically while you work. The original manuscript is always kept.
      </p>
      {!versions ? (
        <Spinner />
      ) : (
        <ol className="version-list">
          {versions.map((version) => {
            const delta = book.wordCount - version.wordCount;
            return (
              <li key={version.id} data-kind={version.kind}>
                <div className="version-main">
                  <span className="version-name">
                    {version.kind === 'original' && <Lock size={13} aria-label="Locked" />}
                    {version.name}
                  </span>
                  <span className="version-meta">
                    {formatDateTime(version.createdAt)} · {formatCount(version.wordCount)} words
                    {delta !== 0 && <span className="muted"> ({delta > 0 ? `${formatCount(delta)} fewer than now` : `${formatCount(-delta)} more than now`})</span>}
                  </span>
                  <Pill tone={version.kind === 'original' ? 'accent' : version.kind === 'manual' ? 'success' : 'neutral'}>{KIND_LABEL[version.kind]}</Pill>
                </div>
                <Menu
                  label={`Actions for ${version.name}`}
                  trigger={<MoreHorizontal size={16} />}
                  items={[
                    { label: 'Preview', icon: <Eye size={15} />, onSelect: () => setPreview(version) },
                    { label: 'Compare…', icon: <GitCompare size={15} />, onSelect: () => setComparing(version) },
                    { label: 'Restore…', icon: <RotateCcw size={15} />, onSelect: () => setRestoring(version) },
                    { label: 'Rename', icon: <Pencil size={15} />, disabled: version.kind === 'original', onSelect: () => { setName(version.name); setRenaming(version); } },
                    { label: 'Delete…', icon: <Trash2 size={15} />, danger: true, disabled: version.kind === 'original', onSelect: () => setDeleting(version) },
                  ]}
                />
              </li>
            );
          })}
        </ol>
      )}

      {comparing && versions && <CompareDialog book={book} version={comparing} versions={versions} flush={flush} onClose={() => setComparing(null)} />}
      {preview && <VersionPreview version={preview} onClose={() => setPreview(null)} onRestore={() => setRestoring(preview)} />}
      {restoring && (
        <ConfirmDialog
          title="Restore this version?"
          confirmLabel="Restore"
          onCancel={() => setRestoring(null)}
          onConfirm={() => restore(restoring)}
          message={
            <>
              The whole book will go back to <strong>{restoring.name}</strong> ({formatDateTime(restoring.createdAt)}). Your current text is
              saved to the history first, so you can undo this.
            </>
          }
        />
      )}
      {renaming && (
        <Modal
          title="Rename snapshot"
          size="sm"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button onClick={() => setRenaming(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await library.renameVersion(renaming.id, name);
                  setRenaming(null);
                  setName('');
                  reload();
                }}
              >
                Rename
              </Button>
            </>
          }
        >
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this snapshot?"
          danger
          confirmLabel="Delete snapshot"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await library.deleteVersion(deleting.id);
              reload();
            } catch (e) {
              reportError('versions', e);
            }
            setDeleting(null);
          }}
          message={<><strong>{deleting.name}</strong> will be removed from the history. Your current text is not affected.</>}
        />
      )}
    </div>
  );
}

/** The Book Bible at a glance while editing: who is who, and how things are spelled. */
function BibleTab({ book }: { book: Book }) {
  const { setView } = useApp();
  const { analyses, suggestionsVersion } = useAi();
  const [bible, setBible] = useState<BookBible | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    analyses.getBible(book.id).then((stored) => !cancelled && setBible(stored)).catch(() => !cancelled && setBible(null));
    return () => {
      cancelled = true;
    };
  }, [analyses, book.id, suggestionsVersion]);

  if (bible === undefined) return null;
  const people = bible?.characters.filter((c) => c.name) ?? [];
  const hasContent = !!bible && (people.length > 0 || bible.settings.length > 0 || bible.glossary.length > 0 || !!bible.summary);
  return (
    <div className="bible-tab" data-testid="side-bible">
      {!hasContent && (
        <p className="fine-print">
          The Book Bible lists the people, places and special words of this book, so that edits stay consistent. Run the full analysis to fill it in, or add entries yourself.
        </p>
      )}
      {bible?.summary && <p>{bible.summary}</p>}
      {(bible?.pov || bible?.tense) && <p className="muted">{[bible.pov, bible.tense && `${bible.tense} tense`].filter(Boolean).join(', ')}</p>}
      {people.length > 0 && (
        <>
          <h4>{book.bookType === 'nonfiction' ? 'People' : 'Characters'}</h4>
          <dl className="bible-brief">
            {people.slice(0, 40).map((c, i) => (
              <div key={i}>
                <dt>{c.name}{c.aliases.length > 0 && <span className="muted"> ({c.aliases.join(', ')})</span>}</dt>
                {c.description && <dd>{c.description}</dd>}
              </div>
            ))}
          </dl>
        </>
      )}
      {bible && bible.settings.length > 0 && (
        <>
          <h4>Places</h4>
          <dl className="bible-brief">
            {bible.settings.slice(0, 30).map((s, i) => <div key={i}><dt>{s.name}</dt>{s.description && <dd>{s.description}</dd>}</div>)}
          </dl>
        </>
      )}
      {bible && bible.glossary.length > 0 && (
        <>
          <h4>Special words</h4>
          <dl className="bible-brief">
            {bible.glossary.slice(0, 40).map((t, i) => <div key={i}><dt>{t.term}</dt>{t.meaning && <dd>{t.meaning}</dd>}</div>)}
          </dl>
        </>
      )}
      <Button size="sm" onClick={() => setView('analysis')}>{hasContent ? 'Edit in Analysis' : 'Open Analysis'}</Button>
    </div>
  );
}

export function SidePanel(props: Props) {
  const { book, snapshotRequest } = props;
  const { library, refreshBooks, reportError } = useApp();
  const [tab, setTab] = useState<Tab>('notes');

  useEffect(() => {
    if (snapshotRequest > 0) setTab('history');
  }, [snapshotRequest]);

  const saveField = (field: 'notes' | 'instructions') => async (text: string) => {
    try {
      await library.updateBook(book.id, { [field]: text });
      await refreshBooks();
    } catch (e) {
      reportError('library', e, 'Could not save.');
    }
  };

  return (
    <aside className="side-panel" aria-label="Book panel">
      <div className="side-tabs" role="tablist">
        {([['notes', 'Notes'], ['instructions', 'Rules'], ['bible', 'Bible'], ['history', 'History']] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>
      <div className="side-body">
        {tab === 'notes' && (
          <>
            <p className="fine-print">Private notes about this book. Only you see them.</p>
            <AutosaveText key={`notes-${book.id}`} label="Notes" value={book.notes} onSave={saveField('notes')} placeholder="Ideas, reminders, things to check…" />
          </>
        )}
        {tab === 'instructions' && (
          <>
            <p className="fine-print">
              Rules the AI must follow for this book, for example "British spelling" or "keep the humor". They are sent with every editing
              and analysis request.
            </p>
            <AutosaveText
              key={`instructions-${book.id}`}
              label="Instructions for this book"
              value={book.instructions}
              onSave={saveField('instructions')}
              placeholder={'British spelling\nKeep the author\'s dry humor\nTarget readers aged 9 to 12'}
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={book.neverCloud}
                onChange={async (e) => {
                  await library.updateBook(book.id, { neverCloud: e.target.checked });
                  await refreshBooks();
                }}
              />
              <span>Never send this book to a cloud AI</span>
            </label>
          </>
        )}
        {tab === 'bible' && <BibleTab book={book} />}
        {tab === 'history' && <HistoryTab {...props} />}
      </div>
    </aside>
  );
}
