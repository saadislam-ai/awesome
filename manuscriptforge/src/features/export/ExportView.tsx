import { Download, FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import { compareSummary, EXPORT_FORMATS, exportBook, exportFileName, type ExportChapter, type ExportFormat } from '../../core/export';
import { manuscriptPdfDefinition, renderPdf, unsupportedScript } from '../../core/export/pdf';
import { blockText } from '../../core/model/blocks';
import type { Book, Version } from '../../core/model/book';
import { formatCount } from '../../core/text/words';
import { Button, Field } from '../../ui/components';
import { formatDateTime } from '../../ui/format';
import { loadPdfFonts } from './pdf-fonts';

export function ExportView({ book }: { book: Book }) {
  const { library, platform, notify, reportError, refreshBooks } = useApp();
  const { edits, suggestionsVersion } = useAi();
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState('');
  const [chapters, setChapters] = useState<ExportChapter[] | null>(null);
  const [older, setOlder] = useState<ExportChapter[] | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [all, list, counts] = await Promise.all([library.getAllChapters(book.id), library.listVersions(book.id), edits.pendingByChapter(book.id)]);
      if (cancelled) return;
      setChapters(all.map((c) => ({ id: c.id, title: c.title, blocks: c.blocks })));
      setVersions(list);
      setVersionId((current) => current || (list.find((v) => v.kind === 'original')?.id ?? list[0]?.id ?? ''));
      setPending(Object.values(counts).reduce((a, b) => a + b, 0));
    })().catch((e) => reportError('export', e, 'The book could not be prepared for export.'));
    return () => {
      cancelled = true;
    };
  }, [library, edits, book.id, book.updatedAt, suggestionsVersion, reportError]);

  useEffect(() => {
    if (format !== 'docx-tracked' || !versionId) return;
    let cancelled = false;
    library
      .getVersionChapters(versionId)
      .then((list) => !cancelled && setOlder(list.map((c) => ({ id: c.chapterId, title: c.title, blocks: c.blocks }))))
      .catch((e) => reportError('export', e));
    return () => {
      cancelled = true;
    };
  }, [format, versionId, library, reportError]);

  const summary = useMemo(() => (format === 'docx-tracked' && chapters && older ? compareSummary(older, chapters) : null), [format, chapters, older]);
  const chosen = EXPORT_FORMATS.find((f) => f.value === format)!;
  // The PDF font covers Latin, Greek and Cyrillic: say so before a file with empty boxes is made.
  const pdfProblem = useMemo(
    () => (format === 'pdf' && chapters ? unsupportedScript(`${book.title} ${chapters.map((c) => c.blocks.slice(0, 40).map(blockText).join(' ')).join(' ')}`) : null),
    [format, chapters, book.title],
  );

  const run = async () => {
    if (!chapters) return;
    setBusy(true);
    setSaved(null);
    try {
      const content = { title: book.title, author: book.author, language: book.language, chapters };
      const result =
        format === 'pdf'
          ? { fileName: exportFileName(book.title, 'pdf'), extension: 'pdf', bytes: await renderPdf(manuscriptPdfDefinition(content), await loadPdfFonts()) }
          : exportBook(content, format, format === 'docx-tracked' ? (older ?? undefined) : undefined);
      const path = await platform.saveFile(result.fileName, result.extension, result.bytes);
      if (path) {
        setSaved(path);
        notify('success', `Saved ${result.fileName}.`);
        await library.addLog('info', 'export', `Exported "${book.title}" as ${chosen.label}`, path);
        if (book.status === 'approved') {
          await library.updateBook(book.id, { status: 'exported' });
          await refreshBooks();
        }
      }
    } catch (e) {
      reportError('export', e, 'The export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view export-view">
      <header className="view-header">
        <div>
          <h1>Export</h1>
          <p className="view-sub">
            {book.title} · {formatCount(book.wordCount)} words. The file is written from the text as it stands now.
          </p>
        </div>
      </header>
      <div className="view-scroll export-body">
        <div className="format-list" role="radiogroup" aria-label="File format">
          {EXPORT_FORMATS.map((f) => (
            <label key={f.value} className={`format-card ${format === f.value ? 'is-active' : ''}`}>
              <input type="radio" name="format" checked={format === f.value} onChange={() => setFormat(f.value)} />
              <FileText size={20} />
              <span>
                <strong>{f.label}</strong> <span className="muted">.{f.extension}</span>
                <br />
                <span className="muted">{f.description}</span>
              </span>
            </label>
          ))}
        </div>

        {format === 'docx-tracked' && (
          <div className="card">
            <Field label="Show changes since" hint="Every difference between that version and the current text becomes a tracked change in Word.">
              <select value={versionId} onChange={(e) => setVersionId(e.target.value)} aria-label="Version to compare with">
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({formatDateTime(v.createdAt)})
                  </option>
                ))}
              </select>
            </Field>
            {summary && (
              <p data-testid="compare-summary">
                {summary.changed + summary.added + summary.removed === 0
                  ? 'The current text is identical to that version, so the file will contain no tracked changes.'
                  : `${summary.changed} paragraph${summary.changed === 1 ? '' : 's'} edited, ${summary.added} added, ${summary.removed} removed.`}
              </p>
            )}
          </div>
        )}

        {pending > 0 && (
          <p className="notice notice-warning">
            {pending} AI suggestion{pending === 1 ? ' is' : 's are'} still waiting in Review. Undecided suggestions are not part of the export: the author's wording is used for those.
          </p>
        )}
        {pdfProblem && (
          <p className="notice notice-warning" data-testid="pdf-warning">
            This book contains {pdfProblem}, which the PDF font cannot print. Those characters would come out as empty boxes. Use Word or EPUB for this book.
          </p>
        )}

        <div className="row-start">
          <Button variant="primary" icon={<Download size={16} />} disabled={busy || !chapters || (format === 'docx-tracked' && !older)} onClick={() => void run()} data-testid="export-run">
            {busy ? 'Exporting…' : `Export as ${chosen.label}`}
          </Button>
        </div>
        {saved && <p className="muted" data-testid="export-saved">Saved to <code>{saved}</code></p>}
      </div>
    </div>
  );
}
