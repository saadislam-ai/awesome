import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { compareBooks, type Comparison } from '../../core/edit/compare';
import type { Book, Version } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import { Button, Modal, Pill, Spinner } from '../../ui/components';
import { formatDateTime } from '../../ui/format';
import { DiffParagraph, WholeParagraph } from '../review/DiffParagraph';

interface Props {
  book: Book;
  /** The older side of the comparison. */
  version: Version;
  /** All versions, so another one can be chosen as the newer side. */
  versions: Version[];
  flush(): Promise<void>;
  onClose(): void;
}

/** Shows what changed between a saved version and the current text (or another version). */
export function CompareDialog({ book, version, versions, flush, onClose }: Props) {
  const { library, reportError } = useApp();
  const [otherId, setOtherId] = useState('current');
  const [result, setResult] = useState<Comparison | null>(null);
  const [selected, setSelected] = useState(0);
  const [onlyChanges, setOnlyChanges] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    (async () => {
      await flush();
      const side = async (id: string) =>
        id === 'current'
          ? (await library.getAllChapters(book.id)).map((c) => ({ id: c.id, title: c.title, blocks: c.blocks }))
          : (await library.getVersionChapters(id)).map((c) => ({ id: c.chapterId, title: c.title, blocks: c.blocks }));
      const [a, b] = await Promise.all([side(version.id), side(otherId)]);
      // Always show the older text as "before".
      const other = versions.find((v) => v.id === otherId);
      const swap = other !== undefined && other.createdAt < version.createdAt;
      const comparison = swap ? compareBooks(b, a) : compareBooks(a, b);
      if (cancelled) return;
      setResult(comparison);
      setSelected(Math.max(0, comparison.chapters.findIndex((c) => c.status !== 'same')));
    })().catch((e) => reportError('versions', e, 'The versions could not be compared.'));
    return () => {
      cancelled = true;
    };
  }, [library, book.id, version, otherId, versions, flush, reportError]);

  const chapter = result?.chapters[selected];
  const rows = useMemo(() => (chapter ? chapter.rows.filter((r) => !onlyChanges || r.type !== 'same') : []), [chapter, onlyChanges]);

  return (
    <Modal
      title="Compare versions"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="push-left muted" data-testid="compare-totals">
            {result
              ? result.changes === 0
                ? 'These two versions are identical.'
                : `+${formatCount(result.wordsAdded)} / −${formatCount(result.wordsRemoved)} words · ${result.paragraphsChanged} paragraphs edited, ${result.paragraphsAdded} added, ${result.paragraphsRemoved} removed`
              : ''}
          </span>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="compare-head">
        <span>
          <strong>{version.name}</strong> <span className="muted">({formatDateTime(version.createdAt)})</span> compared with
        </span>
        <select value={otherId} onChange={(e) => setOtherId(e.target.value)} aria-label="Compare with">
          <option value="current">the current text</option>
          {versions.filter((v) => v.id !== version.id).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({formatDateTime(v.createdAt)})
            </option>
          ))}
        </select>
        <label className="check-inline">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Only show changed paragraphs
        </label>
      </div>
      {!result ? (
        <Spinner label="Comparing…" />
      ) : (
        <div className="version-preview">
          <ol className="version-chapters">
            {result.chapters.map((c, i) => (
              <li key={i}>
                <button className={i === selected ? 'is-active' : ''} onClick={() => setSelected(i)}>
                  <span>{c.title}</span>
                  <span className="muted">{c.status === 'same' ? '' : c.status === 'added' ? 'new' : c.status === 'removed' ? 'removed' : c.changes}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="version-text manuscript">
            {chapter && (
              <>
                <h3>
                  {chapter.title} {chapter.status === 'added' && <Pill tone="success">New chapter</Pill>}
                  {chapter.status === 'removed' && <Pill tone="danger">Removed chapter</Pill>}
                </h3>
                {chapter.titleBefore && <p className="muted">Title was: {chapter.titleBefore}</p>}
                {rows.length === 0 && <p className="muted">No changes in this chapter.</p>}
                {rows.map((row, i) =>
                  row.type === 'changed' ? (
                    <DiffParagraph key={i} original={row.before!} revised={row.after!} hunks={row.hunks!} />
                  ) : (
                    <WholeParagraph key={i} markup={(row.after ?? row.before)!} type={row.type} />
                  ),
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
