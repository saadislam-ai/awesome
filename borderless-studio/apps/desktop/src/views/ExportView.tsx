/**
 * Export screen: build the files to upload (interior, cover, ebook) for every
 * edition and platform, and run preflight on each finished file.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, FileText, FileType2, FolderOpen, Image as ImageIcon, Loader2, Play, Tablet } from 'lucide-react';
import {
  COVER_KIND_LABEL, coverKindsFor, exportCover, exportDocx, exportEbookCover, exportEpub, exportInterior, preflightCoverFile, preflightEpubFile, preflightInteriorFile,
  trimAvailability, validateIsbn,
  type BookFormat, type CoverExport, type CoverKind, type EpubExport, type InteriorExport, type PlatformId, type PreflightReport, type ToolInfo,
} from '@borderless/core';
import { useStore } from '../state/store';
import { BookTitle } from '../App';
import { fmtNumber } from '../ui/kit';
import { PreflightList, PreflightVerdict } from '../ui/PreflightList';
import { saveBookNow } from '../ui/useBook';

interface Result {
  busy: boolean;
  docxPath?: string;
  note?: string;
  error?: string;
  seconds?: number;
  interior?: InteriorExport;
  cover?: CoverExport;
  epub?: EpubExport;
  preflight?: PreflightReport[];
}

function Target(props: { icon: ReactNode; title: ReactNode; note?: ReactNode; result?: Result; path?: string; onBuild: () => void; children?: ReactNode; disabled?: boolean }) {
  const host = useStore((s) => s.host);
  const r = props.result;
  return (
    <div className="target-block">
      <div className="target">
        <div className="row" style={{ gap: 8 }}>{props.icon}<div>{props.title}{props.note && <span className="small faint"> {props.note}</span>}</div></div>
        <div className="row">
          {props.path && (
            <>
              <button className="btn small" onClick={() => void host.ui?.openPath(props.path!)}>Open</button>
              <button className="btn small" onClick={() => void host.ui?.revealPath(props.path!)}>Show in folder</button>
            </>
          )}
          <button className="btn small primary" disabled={r?.busy || props.disabled} onClick={props.onBuild}>
            {r?.busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {props.path ? 'Rebuild' : 'Build'}
          </button>
        </div>
      </div>
      {r?.error && <div className="notice fail small selectable" style={{ marginTop: 8 }}>{r.error}</div>}
      {props.children}
      {props.path && <div className="small faint selectable" style={{ marginTop: 4 }}>{props.path}</div>}
      {r?.preflight?.map((p) => (
        <div key={`${p.platform}-${p.kind}`} style={{ marginTop: 8 }}>
          <div className="row wrap small">
            <PreflightVerdict report={p} />
            {r.preflight!.length > 1 && <span className="dim">{p.target}</span>}
          </div>
          <PreflightList report={p} />
        </div>
      ))}
    </div>
  );
}

export function ExportView() {
  const project = useStore((s) => s.project)!;
  const host = useStore((s) => s.host);
  const specs = useStore((s) => s.specs);
  const buildContext = useStore((s) => s.buildContext);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [accept, setAccept] = useState(false);
  const [tools, setTools] = useState<Record<string, ToolInfo>>({});

  useEffect(() => {
    void Promise.all([host.toolInfo('typst'), host.toolInfo('epubcheck')]).then(([typst, epubcheck]) => setTools({ typst, epubcheck }));
  }, [host]);

  const set = (key: string, r: Result) => setResults((prev) => ({ ...prev, [key]: r }));
  const run = async (key: string, work: () => Promise<Omit<Result, 'busy'>>): Promise<Result | null> => {
    set(key, { ...results[key], busy: true, error: undefined });
    const t0 = performance.now();
    try {
      saveBookNow();
      const done: Result = { ...(await work()), busy: false, seconds: (performance.now() - t0) / 1000 };
      set(key, done);
      return done;
    } catch (e) {
      set(key, { busy: false, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  const criticView = accept ? 'accepted' as const : 'original' as const;

  const buildInterior = (f: BookFormat, platform: PlatformId) => run(`${f.id}/${platform}/interior`, async () => {
    const ctx = await buildContext();
    const interior = await exportInterior(ctx, { formatId: f.id, platform, criticView });
    return { interior, preflight: [await preflightInteriorFile(ctx, interior, platform)] };
  });
  const buildCover = (f: BookFormat, platform: PlatformId, kind: CoverKind) => run(`${f.id}/${platform}/${kind}`, async () => {
    const ctx = await buildContext();
    const cover = await exportCover(ctx, { formatId: f.id, platform, kind });
    return { cover, preflight: [await preflightCoverFile(ctx, cover, { formatId: f.id, platform, kind })] };
  });
  const buildEpub = (f: BookFormat) => run(`${f.id}/epub`, async () => {
    const ctx = await buildContext();
    const stores = f.platforms.filter((p) => specs?.platforms[p]?.ebook);
    // Covers first, so the EPUB carries the current one.
    for (const p of stores) await exportEbookCover(ctx, { formatId: f.id, platform: p });
    const epub = await exportEpub(ctx, { formatId: f.id, criticView });
    const preflight: PreflightReport[] = [];
    for (const p of stores) preflight.push(await preflightEpubFile(ctx, epub, p));
    return { epub, preflight };
  });

  const buildDocx = (layout: 'manuscript' | 'retail') => run(`docx/${layout}`, async () => {
    const ctx = await buildContext();
    const formatId = (project.book.formats.find((f) => f.type === 'ebook') ?? project.book.formats[0]).id;
    const res = await exportDocx(ctx, { formatId, layout, criticView });
    return { docxPath: res.docxPath, note: `${fmtNumber(Math.round(res.sizeBytes / 1024))} KB, ${res.footnotes} footnote${res.footnotes === 1 ? '' : 's'}${res.warnings.length ? `. ${res.warnings.map((w) => w.message).join(' ')}` : ''}` };
  });

  const formats = project.book.formats.filter((f) => f.enabled);
  const printTargets = useMemo(
    () => formats.filter((f) => f.type !== 'ebook').flatMap((f) => f.platforms.filter((p) => specs?.platforms[p]?.print?.formats[f.type as 'paperback' | 'hardcover']).map((p) => ({ f, p }))),
    [formats, specs],
  );
  const buildAll = async () => {
    for (const { f, p } of printTargets) {
      const done = await buildInterior(f, p);
      if (!done?.interior?.ok) continue;
      for (const kind of coverKindsFor(specs!.platforms[p]!, f)) await buildCover(f, p, kind);
    }
    for (const f of formats.filter((x) => x.type === 'ebook')) await buildEpub(f);
    toast('ok', 'All exports are finished.');
  };
  const anyBusy = Object.values(results).some((r) => r.busy);
  const reports = Object.values(results).flatMap((r) => r.preflight ?? []);
  const failing = reports.filter((p) => !p.ready).length;

  return (
    <>
      <div className="topbar">
        <BookTitle />
        {reports.length > 0 && (failing
          ? <span className="badge fail"><CircleAlert size={12} /> {failing} file{failing === 1 ? '' : 's'} not ready</span>
          : <span className="badge ok"><CheckCircle2 size={12} /> {reports.length} file check{reports.length === 1 ? '' : 's'} passed</span>)}
        <div className="grow" />
        <label className="check small" title="By default exports ignore pending suggestions and use the original text">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> Apply pending tracked changes
        </label>
        <button className="btn" onClick={() => void host.ui?.openPath(project.path('exports'))}><FolderOpen size={15} /> Exports folder</button>
        <button className="btn primary" disabled={anyBusy} onClick={() => void buildAll()}>{anyBusy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Build everything</button>
      </div>
      <div className="page">
        <div className="page-narrow">
          {tools.typst && !tools.typst.found && <div className="notice fail"><CircleAlert size={16} /> {tools.typst.hint}</div>}
          {tools.epubcheck && !tools.epubcheck.found && <div className="notice warn"><AlertTriangle size={16} /> {tools.epubcheck.hint}</div>}
          {formats.length === 0 && <div className="empty"><h2>No edition is switched on</h2><p>Switch on a paperback, hardcover or ebook edition on the Book screen.</p></div>}
          {formats.map((f) => {
            const isbn = f.isbn ? validateIsbn(f.isbn) : null;
            return (
              <div className="card" key={f.id}>
                <div className="row">
                  {f.type === 'ebook' ? <Tablet size={18} className="dim" /> : <FileText size={18} className="dim" />}
                  <h2 style={{ margin: 0 }}>{f.label || f.id}</h2>
                  {f.type !== 'ebook' && <span className="badge">{f.trim.replace('x', ' x ')} in, {f.paper} paper, {f.ink === 'bw' ? 'black ink' : f.ink.replace('-', ' ')}</span>}
                  {f.largePrint && <span className="badge accent">Large print</span>}
                  <div className="grow" />
                  {!f.isbn ? <span className="badge warn">No ISBN yet</span> : isbn?.valid ? <span className="badge ok">ISBN {f.isbn}</span> : <span className="badge fail" title={isbn?.problem}>ISBN not valid</span>}
                </div>
                {f.type === 'ebook' ? (
                  <EpubTarget format={f} result={results[`${f.id}/epub`]} onBuild={() => void buildEpub(f)} />
                ) : (
                  f.platforms.map((p) => {
                    const spec = specs?.platforms[p];
                    if (!spec?.print?.formats[f.type as 'paperback' | 'hardcover']) {
                      return <div key={p} className="small dim" style={{ marginTop: 10 }}>{spec?.displayName ?? p} has no {f.type} rules in its spec file, so nothing is built for it.</div>;
                    }
                    const avail = trimAvailability(spec, f);
                    const r = results[`${f.id}/${p}/interior`];
                    const i = r?.interior;
                    const m = i?.margins.margins;
                    return (
                      <div key={p}>
                        <Target
                          icon={<FileText size={15} className="dim" />}
                          title={<><b>{spec.displayName}</b> <span className="dim">interior</span></>}
                          note={avail.pages ? `(${avail.pages.min} to ${avail.pages.max} pages allowed)` : undefined}
                          result={r} path={i?.pdfPath || undefined} onBuild={() => void buildInterior(f, p)}
                        >
                          {avail.problem && !i && <div className="notice fail small" style={{ marginTop: 8 }}>{avail.problem}</div>}
                          {i && i.pageCount > 0 && m && (
                            <div className="row wrap small" style={{ marginTop: 8 }}>
                              <span className="badge">{fmtNumber(i.pageCount)} pages{i.blankPagesAdded ? ` (${i.blankPagesAdded} blank added)` : ''}</span>
                              <span className="badge">trim {i.page.trimWidthIn} x {i.page.trimHeightIn} in{i.page.bleedIn ? `, bleed ${i.page.bleedIn} in` : ''}</span>
                              <span className="badge" title="Inside (gutter), outside, top and bottom margins of the text block">margins: inside {m.inside}, outside {m.outside}, top {m.top}, bottom {m.bottom} in</span>
                              {i.pdfStandard && <span className="badge">{i.pdfStandard}</span>}
                              {r?.seconds !== undefined && <span className="faint">{r.seconds.toFixed(1)} s</span>}
                            </div>
                          )}
                        </Target>
                        {coverKindsFor(spec, f).map((kind) => {
                          const cr = results[`${f.id}/${p}/${kind}`];
                          const g = cr?.cover?.plan.geometry;
                          return (
                            <Target key={kind}
                              icon={<ImageIcon size={15} className="dim" />}
                              title={<><b>{spec.displayName}</b> <span className="dim">{COVER_KIND_LABEL[kind].toLowerCase()}</span></>}
                              result={cr} path={cr?.cover?.pdfPath || undefined} onBuild={() => void buildCover(f, p, kind)}
                            >
                              {cr?.cover && g && cr.cover.pdfPath && (
                                <div className="row wrap small" style={{ marginTop: 8 }}>
                                  <span className="badge">{g.widthIn} x {g.heightIn} in</span>
                                  <span className="badge" title={g.spineBasis}>spine {g.spineWidthIn} in for {g.pages} pages</span>
                                  {cr.cover.pdfStandard && <span className="badge">{cr.cover.pdfStandard}</span>}
                                  {cr.seconds !== undefined && <span className="faint">{cr.seconds.toFixed(1)} s</span>}
                                </div>
                              )}
                            </Target>
                          );
                        })}
                      </div>
                    );
                  })
                )}
                {f.platforms.length === 0 && <div className="small dim" style={{ marginTop: 8 }}>No platform is selected for this edition.</div>}
              </div>
            );
          })}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="row"><FileType2 size={18} className="dim" /><h2 style={{ margin: 0 }}>Word files</h2></div>
            <Target icon={<FileType2 size={15} className="dim" />} title={<><b>Manuscript format</b> <span className="dim">for agents, editors and beta readers</span></>}
              note="(12 pt, double spaced, header with name, title and page)" result={results['docx/manuscript']} path={results['docx/manuscript']?.docxPath} onBuild={() => void buildDocx('manuscript')}>
              {results['docx/manuscript']?.note && <div className="small dim" style={{ marginTop: 6 }}>{results['docx/manuscript']!.note}</div>}
            </Target>
            <Target icon={<FileType2 size={15} className="dim" />} title={<><b>Word file for stores</b> <span className="dim">that convert it themselves, such as Draft2Digital</span></>}
              note="(chapters as Heading 1)" result={results['docx/retail']} path={results['docx/retail']?.docxPath} onBuild={() => void buildDocx('retail')}>
              {results['docx/retail']?.note && <div className="small dim" style={{ marginTop: 6 }}>{results['docx/retail']!.note}</div>}
            </Target>
          </div>
        </div>
      </div>
    </>
  );
}

function EpubTarget(props: { format: BookFormat; result?: Result; onBuild(): void }) {
  const selectDoc = useStore((s) => s.selectDoc);
  const r = props.result;
  const e = r?.epub;
  return (
    <Target
      icon={<Tablet size={15} className="dim" />}
      title={<><b>EPUB 3</b> <span className="dim">with its cover, checked with EPUBCheck</span></>}
      result={r} path={e?.epubPath || undefined} onBuild={props.onBuild}
    >
      {e && (
        <>
          <div className="row wrap small" style={{ marginTop: 8 }}>
            {e.check.ran ? (
              e.check.passed
                ? <span className="badge ok"><CheckCircle2 size={12} /> {e.check.checker}: no errors{e.check.warnings ? `, ${e.check.warnings} warning${e.check.warnings === 1 ? '' : 's'}` : ''}</span>
                : <span className="badge fail"><CircleAlert size={12} /> {e.check.checker}: {e.check.errors} error{e.check.errors === 1 ? '' : 's'}</span>
            ) : <span className="badge warn">Not validated</span>}
            <span className="badge">{fmtNumber(Math.round(e.sizeBytes / 1024))} KB</span>
            <span className="badge">{e.result.spine.length} files in reading order</span>
            {r?.seconds !== undefined && <span className="faint">{r.seconds.toFixed(1)} s</span>}
          </div>
          {e.check.issues.length > 0 && (
            <div className="issues">
              {e.check.issues.map((i, k) => (
                <div key={k} className={`issue ${i.severity === 'warning' ? 'warn' : 'fail'}`}>
                  <CircleAlert size={15} color={i.severity === 'warning' ? 'var(--warn)' : 'var(--fail)'} />
                  <div className="selectable">
                    <div>{i.explanation}</div>
                    <div className="small dim">{i.id}: {i.message}{i.path ? ` (${i.path}${i.line ? ', line ' + i.line : ''})` : ''}</div>
                  </div>
                  {i.nodeId && <button className="btn ghost small where" onClick={() => selectDoc(i.nodeId!, { nodeId: i.nodeId!, from: 0, to: 0, line: i.srcLine })}>Show in "{i.nodeTitle}"</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Target>
  );
}
