import { Camera, Eye, History, Lock, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import type { Book, Version, VersionChapter } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import { Button, ConfirmDialog, Field, Menu, Modal, Pill, Spinner } from '../../ui/components';
import { formatDateTime, MOD } from '../../ui/format';
import { BlocksView } from './BlocksView';

type Tab = 'notes' | 'instructions' | 'history';

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
        {([['notes', 'Notes'], ['instructions', 'Instructions'], ['history', 'History']] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>
            {value === 'history' && <History size={14} />}
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
              Rules the AI editor must follow for this book, for example "British spelling" or "keep the humor". AI editing arrives in the
              next milestone, and it will read these.
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
        {tab === 'history' && <HistoryTab {...props} />}
      </div>
    </aside>
  );
}
