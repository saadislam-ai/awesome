/**
 * Export screen: build the print interior PDF for each platform and the EPUB,
 * see the result, the warnings, and the EPUBCheck report with links back into
 * the manuscript.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, FileText, FolderOpen, Info, Loader2, Play, Tablet } from 'lucide-react';
import {
  exportEpub, exportInterior, trimAvailability, validateIsbn,
  type BookFormat, type BuildContext, type BuildWarning, type EpubExport, type InteriorExport, type PlatformId, type ToolInfo,
} from '@borderless/core';
import { useStore } from '../state/store';
import { BookTitle } from '../App';
import { fmtNumber } from '../ui/kit';

interface Result {
  busy: boolean;
  interior?: InteriorExport;
  epub?: EpubExport;
  error?: string;
  seconds?: number;
}

function Issues({ list }: { list: BuildWarning[] }) {
  const selectDoc = useStore((s) => s.selectDoc);
  if (list.length === 0) return null;
  const order = { fail: 0, warn: 1, info: 2 } as const;
  return (
    <div className="issues">
      {[...list].sort((a, b) => order[a.severity] - order[b.severity]).map((w, i) => (
        <div key={i} className={`issue ${w.severity}`}>
          {w.severity === 'fail' ? <CircleAlert size={15} color="var(--fail)" /> : w.severity === 'warn' ? <AlertTriangle size={15} color="var(--warn)" /> : <Info size={15} className="dim" />}
          <div className="selectable">{w.message}</div>
          {w.nodeId && (
            <button className="btn ghost small where" onClick={() => selectDoc(w.nodeId!, { nodeId: w.nodeId!, from: 0, to: 0, line: w.line })}>
              Show in manuscript
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function ExportView() {
  const project = useStore((s) => s.project)!;
  const host = useStore((s) => s.host);
  const specs = useStore((s) => s.specs);
  const library = useStore((s) => s.library);
  const selectDoc = useStore((s) => s.selectDoc);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [accept, setAccept] = useState(false);
  const [tools, setTools] = useState<Record<string, ToolInfo>>({});

  useEffect(() => {
    void Promise.all([host.toolInfo('typst'), host.toolInfo('epubcheck')]).then(([typst, epubcheck]) => setTools({ typst, epubcheck }));
  }, [host]);

  const ctx = async (): Promise<BuildContext> => {
    const { resources } = await host.paths();
    return { host, project, specs: specs!, resourcesDir: resources, isbnRegister: library ? await library.isbnRegister() : null };
  };
  const set = (key: string, r: Result) => setResults((prev) => ({ ...prev, [key]: r }));

  const buildInterior = async (f: BookFormat, platform: PlatformId) => {
    const key = `${f.id}/${platform}`;
    set(key, { busy: true });
    const t0 = performance.now();
    try {
      const interior = await exportInterior(await ctx(), { formatId: f.id, platform, criticView: accept ? 'accepted' : 'original', pageCountHint: results[key]?.interior?.pageCount || undefined });
      set(key, { busy: false, interior, seconds: (performance.now() - t0) / 1000 });
    } catch (e) {
      set(key, { busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const buildEpub = async (f: BookFormat) => {
    const key = `${f.id}/epub`;
    set(key, { busy: true });
    const t0 = performance.now();
    try {
      const epub = await exportEpub(await ctx(), { formatId: f.id, criticView: accept ? 'accepted' : 'original' });
      set(key, { busy: false, epub, seconds: (performance.now() - t0) / 1000 });
    } catch (e) {
      set(key, { busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const formats = project.book.formats.filter((f) => f.enabled);
  const printTargets = useMemo(
    () => formats.filter((f) => f.type !== 'ebook').flatMap((f) => f.platforms.filter((p) => specs?.platforms[p]?.print?.formats[f.type as 'paperback' | 'hardcover']).map((p) => ({ f, p }))),
    [formats, specs],
  );
  const buildAll = async () => {
    for (const { f, p } of printTargets) await buildInterior(f, p);
    for (const f of formats.filter((x) => x.type === 'ebook')) await buildEpub(f);
    toast('ok', 'All exports are finished.');
  };
  const anyBusy = Object.values(results).some((r) => r.busy);

  return (
    <>
      <div className="topbar">
        <BookTitle />
        <div className="grow" />
        <label className="check small" title="By default exports ignore pending suggestions and use the original text">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> Apply pending tracked changes
        </label>
        <button className="btn" onClick={() => void host.ui?.openPath(project.path('exports'))}><FolderOpen size={15} /> Exports folder</button>
        <button className="btn primary" disabled={anyBusy} onClick={() => void buildAll()}><Play size={14} /> Build everything</button>
      </div>
      <div className="page">
        <div className="page-narrow">
          {tools.typst && !tools.typst.found && <div className="notice fail"><CircleAlert size={16} /> {tools.typst.hint}</div>}
          {tools.epubcheck && !tools.epubcheck.found && <div className="notice warn"><AlertTriangle size={16} /> {tools.epubcheck.hint}</div>}
          {formats.length === 0 && <div className="empty"><h2>No formats are switched on</h2><p>Enable a paperback, hardcover or ebook format for this book.</p></div>}
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
                  <EpubRow format={f} result={results[`${f.id}/epub`]} onBuild={() => void buildEpub(f)} onJump={(nodeId, line) => selectDoc(nodeId, { nodeId, from: 0, to: 0, line })} />
                ) : (
                  f.platforms.map((p) => {
                    const spec = specs?.platforms[p];
                    if (!spec?.print?.formats[f.type as 'paperback' | 'hardcover']) {
                      return <div key={p} className="small dim" style={{ marginTop: 10 }}>{spec?.displayName ?? p} has no {f.type} rules in its spec file, so nothing is built for it.</div>;
                    }
                    const avail = trimAvailability(spec, f);
                    const r = results[`${f.id}/${p}`];
                    return (
                      <div key={p} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                        <div className="target">
                          <div>
                            <b>{spec.displayName}</b> <span className="dim">interior PDF</span>
                            {avail.pages && <span className="small faint"> ({avail.pages.min} to {avail.pages.max} pages allowed)</span>}
                          </div>
                          <div className="row">
                            {r?.interior?.pdfPath && (
                              <>
                                <button className="btn small" onClick={() => void host.ui?.openPath(r.interior!.pdfPath)}>Open</button>
                                <button className="btn small" onClick={() => void host.ui?.revealPath(r.interior!.pdfPath)}>Show in folder</button>
                              </>
                            )}
                            <button className="btn small primary" disabled={r?.busy} onClick={() => void buildInterior(f, p)}>
                              {r?.busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {r?.interior ? 'Rebuild' : 'Build'}
                            </button>
                          </div>
                        </div>
                        {avail.problem && !r?.interior && <div className="notice fail small" style={{ marginTop: 8 }}>{avail.problem}</div>}
                        {r?.error && <div className="notice fail small selectable" style={{ marginTop: 8 }}>{r.error}</div>}
                        {r?.interior && <InteriorSummary r={r.interior} seconds={r.seconds} />}
                      </div>
                    );
                  })
                )}
                {f.type !== 'ebook' && f.platforms.length === 0 && <div className="small dim" style={{ marginTop: 8 }}>No platform is selected for this format.</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function InteriorSummary({ r, seconds }: { r: InteriorExport; seconds?: number }) {
  const m = r.margins.margins;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row wrap small">
        {r.ok ? <span className="badge ok"><CheckCircle2 size={12} /> Built</span> : <span className="badge fail"><CircleAlert size={12} /> Needs attention</span>}
        {r.pageCount > 0 && (
          <>
            <span className="badge">{fmtNumber(r.pageCount)} pages{r.blankPagesAdded ? ` (${r.blankPagesAdded} blank added)` : ''}</span>
            <span className="badge">trim {r.page.trimWidthIn} x {r.page.trimHeightIn} in{r.page.bleedIn ? `, bleed ${r.page.bleedIn} in` : ''}</span>
            <span className="badge" title="Inside (gutter), outside, top and bottom margins of the text block">margins: inside {m.inside}, outside {m.outside}, top {m.top}, bottom {m.bottom} in</span>
            {seconds !== undefined && <span className="faint">{seconds.toFixed(1)} s, {r.passes} pass{r.passes === 1 ? '' : 'es'}</span>}
          </>
        )}
      </div>
      {r.pdfPath && <div className="small faint selectable" style={{ marginTop: 4 }}>{r.pdfPath}</div>}
      <Issues list={r.warnings} />
    </div>
  );
}

function EpubRow(props: { format: BookFormat; result?: Result; onBuild(): void; onJump(nodeId: string, line?: number): void }) {
  const host = useStore((s) => s.host);
  const r = props.result;
  const e = r?.epub;
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div className="target">
        <div><b>EPUB 3</b> <span className="dim">for {props.format.platforms.join(', ') || 'any retailer'}, checked with EPUBCheck</span></div>
        <div className="row">
          {e?.epubPath && (
            <>
              <button className="btn small" onClick={() => void host.ui?.openPath(e.epubPath)}>Open</button>
              <button className="btn small" onClick={() => void host.ui?.revealPath(e.epubPath)}>Show in folder</button>
            </>
          )}
          <button className="btn small primary" disabled={r?.busy} onClick={props.onBuild}>
            {r?.busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {e ? 'Rebuild' : 'Build'}
          </button>
        </div>
      </div>
      {r?.error && <div className="notice fail small selectable" style={{ marginTop: 8 }}>{r.error}</div>}
      {e && (
        <div style={{ marginTop: 8 }}>
          <div className="row wrap small">
            {e.check.ran ? (
              e.check.passed ? (
                <span className="badge ok"><CheckCircle2 size={12} /> {e.check.checker}: no errors{e.check.warnings ? `, ${e.check.warnings} warning${e.check.warnings === 1 ? '' : 's'}` : ''}</span>
              ) : (
                <span className="badge fail"><CircleAlert size={12} /> {e.check.checker}: {e.check.errors} error{e.check.errors === 1 ? '' : 's'}</span>
              )
            ) : (
              <span className="badge warn">Not validated</span>
            )}
            <span className="badge">{fmtNumber(Math.round(e.sizeBytes / 1024))} KB</span>
            <span className="badge">{e.result.spine.length} files in reading order</span>
            {r?.seconds !== undefined && <span className="faint">{r.seconds.toFixed(1)} s</span>}
          </div>
          <div className="small faint selectable" style={{ marginTop: 4 }}>{e.epubPath}</div>
          {e.check.issues.length > 0 && (
            <div className="issues">
              {e.check.issues.map((i, k) => (
                <div key={k} className={`issue ${i.severity === 'warning' ? 'warn' : 'fail'}`}>
                  <CircleAlert size={15} color={i.severity === 'warning' ? 'var(--warn)' : 'var(--fail)'} />
                  <div className="selectable">
                    <div>{i.explanation}</div>
                    <div className="small dim">{i.id}: {i.message}{i.path ? ` (${i.path}${i.line ? ', line ' + i.line : ''})` : ''}</div>
                  </div>
                  {i.nodeId && <button className="btn ghost small where" onClick={() => props.onJump(i.nodeId!, i.srcLine)}>Show in "{i.nodeTitle}"</button>}
                </div>
              ))}
            </div>
          )}
          <Issues list={e.warnings} />
        </div>
      )}
    </div>
  );
}
