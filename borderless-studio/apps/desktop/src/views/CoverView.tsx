/**
 * Cover builder: design the cover once and lay it out for every edition and
 * platform. The preview is drawn by the same code as the print file and shows
 * the trim, the folds of the spine, the safe zones and the barcode area.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CircleAlert, FileDown, ImagePlus, Info, Loader2, Play, Tablet, Trash2 } from 'lucide-react';
import {
  COVER_KIND_LABEL, COVER_LAYOUTS, COVER_LAYOUT_INFO, FONT_CATALOG, basename, coverKindsFor, exportCover, exportEbookCover, extname, joinPath,
  loadCoverDesign, preflightCoverFile, previewCover, saveCoverDesign, slugify,
  type CoverDesign, type CoverExport, type CoverKind, type CoverPlan, type EbookCoverResult, type PlatformId, type PreflightReport,
} from '@borderless/core';
import { useStore } from '../state/store';
import { BookTitle } from '../App';
import { Field, Seg } from '../ui/kit';
import { FileImage } from '../ui/FileImage';
import { PreflightList, PreflightVerdict } from '../ui/PreflightList';
import { saveBookNow } from '../ui/useBook';

function Colour(props: { label: string; value: string | null; fallback?: string; optional?: boolean; onChange: (v: string | null) => void }) {
  const value = props.value ?? props.fallback ?? '#000000';
  return (
    <Field label={props.label}>
      <div className="row" style={{ gap: 6 }}>
        <input type="color" value={value} onChange={(e) => props.onChange(e.target.value)} style={{ width: 34, height: 28, padding: 0, border: '1px solid var(--border-strong)', borderRadius: 6, background: 'none' }} aria-label={props.label} />
        <input className="input" value={props.value ?? ''} placeholder={props.optional ? 'as front' : ''} onChange={(e) => { const v = e.target.value.trim(); if (v === '' && props.optional) props.onChange(null); else if (/^#[0-9a-fA-F]{6}$/.test(v)) props.onChange(v); }} style={{ width: 96 }} />
        {props.optional && props.value && <button className="btn ghost small" onClick={() => props.onChange(null)}>Reset</button>}
      </div>
    </Field>
  );
}

export function CoverView() {
  const project = useStore((s) => s.project)!;
  const specs = useStore((s) => s.specs);
  const host = useStore((s) => s.host);
  const buildContext = useStore((s) => s.buildContext);
  const toast = useStore((s) => s.toast);
  useStore((s) => s.rev);

  const printFormats = project.book.formats.filter((f) => f.type !== 'ebook');
  const [formatId, setFormatId] = useState(printFormats.find((f) => f.enabled)?.id ?? printFormats[0]?.id ?? '');
  const format = printFormats.find((f) => f.id === formatId) ?? printFormats[0];
  const platforms = (format?.platforms ?? []).filter((p) => specs?.platforms[p]?.print?.formats[format!.type as 'paperback' | 'hardcover']);
  const [platformChoice, setPlatform] = useState<PlatformId | null>(null);
  const platform = platformChoice && platforms.includes(platformChoice) ? platformChoice : platforms[0];
  const kinds = useMemo(() => (format && platform && specs?.platforms[platform] ? coverKindsFor(specs.platforms[platform]!, format) : []), [format, platform, specs]);
  const [kindChoice, setKind] = useState<CoverKind | null>(null);
  const kind = kindChoice && kinds.includes(kindChoice) ? kindChoice : kinds[0];

  const [design, setDesign] = useState<CoverDesign | null>(null);
  const [guides, setGuides] = useState(true);
  const [preview, setPreview] = useState<{ path: string; stamp: number } | null>(null);
  const [plan, setPlan] = useState<CoverPlan | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<{ cover: CoverExport; preflight: PreflightReport } | null>(null);
  const [ebook, setEbook] = useState<(EbookCoverResult & { platform: PlatformId })[]>([]);
  const request = useRef(0);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    void loadCoverDesign(project).then(setDesign, (e) => toast('fail', `The cover design could not be read: ${e instanceof Error ? e.message : String(e)}`));
  }, [project, toast]);

  const draw = useCallback(async (d: CoverDesign) => {
    if (!format || !platform || !kind) return;
    const id = ++request.current;
    setBusy(true);
    try {
      saveBookNow();
      const res = await previewCover(await buildContext(), { formatId: format.id, platform, kind, guides, design: d, ppi: 110 });
      if (id !== request.current) return;
      setPlan(res.plan);
      setProblems([...res.plan.problems, ...res.warnings.filter((w) => w.severity === 'fail').map((w) => w.message)]);
      setPreview(res.ok ? { path: res.pngPath, stamp: Date.now() } : null);
    } catch (e) {
      if (id === request.current) setProblems([e instanceof Error ? e.message : String(e)]);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [buildContext, format, platform, kind, guides]);

  // Redraw when the target or the guides change.
  useEffect(() => {
    if (design) void draw(design);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatId, platform, kind, guides, design === null]);

  const change = (fn: (d: CoverDesign) => void) => {
    if (!design) return;
    const next = structuredClone(design);
    fn(next);
    setDesign(next);
    setResult(null);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveCoverDesign(project, next).then(() => draw(next), (e) => toast('fail', `The cover design could not be saved: ${e instanceof Error ? e.message : String(e)}`));
    }, 600);
  };

  const pickArt = async (slot: 'front' | 'wrap') => {
    const file = await host.ui?.pickFile('Choose a picture (PNG or JPEG)', [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg'] }]);
    if (!file) return;
    try {
      // The picture is copied into the book folder, so the book stays complete when it is moved or backed up.
      const name = `${slugify(basename(file).replace(/\.[^.]+$/, ''), 40) || slot}${extname(file).toLowerCase()}`;
      const rel = `cover/art/${name}`;
      await host.mkdirp(joinPath(project.dir, 'cover/art'));
      await host.copy(file, joinPath(project.dir, rel));
      change((d) => { d.art[slot] = rel; });
    } catch (e) {
      toast('fail', `The picture could not be copied into the book folder: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const build = async () => {
    if (!format || !platform || !kind || !design) return;
    setBuilding(true);
    try {
      await saveCoverDesign(project, design);
      const ctx = await buildContext();
      const cover = await exportCover(ctx, { formatId: format.id, platform, kind });
      const preflight = await preflightCoverFile(ctx, cover, { formatId: format.id, platform, kind });
      setResult({ cover, preflight });
      toast(cover.ok && preflight.ready ? 'ok' : 'warn', cover.ok && preflight.ready ? 'The cover file is ready.' : 'The cover was built, but preflight found something to fix.');
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  const buildEbook = async () => {
    if (!design) return;
    setBuilding(true);
    try {
      await saveCoverDesign(project, design);
      const ctx = await buildContext();
      const ebookFormat = project.book.formats.find((f) => f.type === 'ebook');
      const targets = (ebookFormat?.platforms ?? ['kdp']).filter((p) => specs?.platforms[p]?.ebook);
      const out: (EbookCoverResult & { platform: PlatformId })[] = [];
      for (const p of targets.length ? targets : (['kdp'] as PlatformId[])) out.push(await exportEbookCover(ctx, { platform: p, design }));
      setEbook(out);
      const failed = out.find((r) => !r.ok);
      toast(failed ? 'warn' : 'ok', failed ? (failed.warnings[0]?.message ?? 'An ebook cover could not be made.') : 'The ebook covers are in the exports folder.');
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  if (!format) {
    return (
      <>
        <div className="topbar"><BookTitle /></div>
        <div className="page"><div className="empty"><h2>No print edition</h2><p>Add a paperback or hardcover edition on the Book screen. The ebook cover is made from the same design.</p></div></div>
      </>
    );
  }
  if (!design) return <div className="page"><div className="dim">Opening the cover design...</div></div>;

  const g = plan?.geometry ?? null;
  const fonts = FONT_CATALOG.map((f) => f.family);
  const jacket = kinds.includes('dust-jacket');
  const spec = platform ? specs?.platforms[platform] : null;

  return (
    <>
      <div className="topbar">
        <BookTitle />
        <div className="grow" />
        <select className="select" style={{ width: 'auto' }} value={format.id} onChange={(e) => setFormatId(e.target.value)} aria-label="Edition">
          {printFormats.map((f) => <option key={f.id} value={f.id}>{f.label || f.id} ({f.trim.replace('x', ' x ')} in)</option>)}
        </select>
        {platforms.length > 0 && (
          <Seg value={platform ?? platforms[0]} onChange={(v) => setPlatform(v)} options={platforms.map((p) => ({ value: p, label: specs?.platforms[p]?.displayName ?? p }))} />
        )}
        {kinds.length > 1 && <Seg value={kind ?? kinds[0]} onChange={(v) => setKind(v)} options={kinds.map((k) => ({ value: k, label: COVER_KIND_LABEL[k] }))} />}
        <button className="btn" disabled={building} onClick={() => void buildEbook()}><Tablet size={14} /> Ebook cover</button>
        <button className="btn primary" disabled={building || !platform} onClick={() => void build()}>{building ? <Loader2 size={14} className="spin" /> : <Play size={14} />} Build cover file</button>
      </div>
      <div className="design">
        <div className="design-controls">
          <details className="group" open>
            <summary>Layout and colours</summary>
            <div className="group-body">
              <div className="templates">
                {COVER_LAYOUTS.map((l) => (
                  <button key={l} className={`template${design.layout === l ? ' on' : ''}`} onClick={() => change((d) => { d.layout = l; })}>
                    <b>{COVER_LAYOUT_INFO[l].label}</b><span>{COVER_LAYOUT_INFO[l].hint}</span>
                  </button>
                ))}
              </div>
              <div className="grid2" style={{ marginTop: 10 }}>
                <Colour label="Background" value={design.colors.background} onChange={(v) => v && change((d) => { d.colors.background = v; })} />
                <Colour label="Text" value={design.colors.text} onChange={(v) => v && change((d) => { d.colors.text = v; })} />
                <Colour label="Accent (rules, small headings)" value={design.colors.accent} onChange={(v) => v && change((d) => { d.colors.accent = v; })} />
                {design.layout === 'band' && <Colour label="Band behind the title" optional value={design.colors.band} fallback={design.colors.background} onChange={(v) => change((d) => { d.colors.band = v; })} />}
                <Colour label="Back cover and spine" optional value={design.colors.backBackground} fallback={design.colors.background} onChange={(v) => change((d) => { d.colors.backBackground = v; })} />
                <Colour label="Back cover text" optional value={design.colors.backText} fallback={design.colors.text} onChange={(v) => change((d) => { d.colors.backText = v; })} />
              </div>
              <div className="grid2" style={{ marginTop: 10 }}>
                <Field label="Title typeface"><select className="select" value={design.fonts.title} onChange={(e) => change((d) => { d.fonts.title = e.target.value; })}>{fonts.map((f) => <option key={f}>{f}</option>)}</select></Field>
                <Field label="Text typeface"><select className="select" value={design.fonts.body} onChange={(e) => change((d) => { d.fonts.body = e.target.value; })}>{fonts.map((f) => <option key={f}>{f}</option>)}</select></Field>
                <Field label="Title letters"><select className="select" value={design.fonts.titleCase} onChange={(e) => change((d) => { d.fonts.titleCase = e.target.value as CoverDesign['fonts']['titleCase']; })}><option value="as-typed">As typed</option><option value="upper">Capitals</option><option value="small-caps">Small capitals</option></select></Field>
                <Field label="Title weight"><select className="select" value={design.fonts.titleWeight} onChange={(e) => change((d) => { d.fonts.titleWeight = e.target.value as CoverDesign['fonts']['titleWeight']; })}><option value="regular">Regular</option><option value="bold">Bold</option></select></Field>
              </div>
            </div>
          </details>

          <details className="group" open>
            <summary>Pictures</summary>
            <div className="group-body">
              <Field label="Front cover picture" hint="At least 300 pixels for each printed inch, including the part that runs off the edge.">
                <div className="row">
                  <button className="btn small" onClick={() => void pickArt('front')}><ImagePlus size={13} /> Choose a picture</button>
                  {design.art.front && <><span className="small dim selectable">{basename(design.art.front)}</span><button className="btn ghost icon small" title="Remove the picture" onClick={() => change((d) => { d.art.front = null; })}><Trash2 size={13} /></button></>}
                </div>
              </Field>
              {design.art.front && design.layout === 'classic' && (
                <div style={{ marginTop: 8 }}>
                  <Seg value={design.art.frontMode} onChange={(v) => change((d) => { d.art.frontMode = v; })} options={[{ value: 'full', label: 'Behind the whole front' }, { value: 'top', label: 'Upper part only' }]} />
                </div>
              )}
              <div style={{ height: 10 }} />
              <Field label="Finished wrap picture" hint="A complete cover from a designer: back, spine and front in one picture, made for this exact size.">
                <div className="row">
                  <button className="btn small" onClick={() => void pickArt('wrap')}><ImagePlus size={13} /> Choose a picture</button>
                  {design.art.wrap && <><span className="small dim selectable">{basename(design.art.wrap)}</span><button className="btn ghost icon small" title="Remove the picture" onClick={() => change((d) => { d.art.wrap = null; })}><Trash2 size={13} /></button></>}
                </div>
              </Field>
              {design.art.wrap && (
                <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={design.art.wrapHasText} onChange={(e) => change((d) => { d.art.wrapHasText = e.target.checked; })} /> The picture already contains all the text (only the barcode is added)</label>
              )}
            </div>
          </details>

          <details className="group">
            <summary>Front cover text</summary>
            <div className="group-body">
              <Field label="Title" hint="Empty: the title of the book."><input className="input" value={design.front.title} placeholder={project.book.title} onChange={(e) => change((d) => { d.front.title = e.target.value; })} /></Field>
              <Field label="Subtitle"><input className="input" value={design.front.subtitle} placeholder={project.book.subtitle} onChange={(e) => change((d) => { d.front.subtitle = e.target.value; })} /></Field>
              <Field label="Author"><input className="input" value={design.front.author} placeholder="As in the book details" onChange={(e) => change((d) => { d.front.author = e.target.value; })} /></Field>
              <Field label="Line at the top" hint='For example "A novel" or a short quote.'><input className="input" value={design.front.tagline} onChange={(e) => change((d) => { d.front.tagline = e.target.value; })} /></Field>
              <label className="check"><input type="checkbox" checked={design.front.showSubtitle} onChange={(e) => change((d) => { d.front.showSubtitle = e.target.checked; })} /> Show the subtitle</label>
            </div>
          </details>

          <details className="group">
            <summary>Back cover and spine</summary>
            <div className="group-body">
              <Field label="Headline"><input className="input" value={design.back.headline} onChange={(e) => change((d) => { d.back.headline = e.target.value; })} /></Field>
              <Field label="Back cover text" hint="A blank line starts a new paragraph. *Italic* and **bold** work."><textarea className="textarea" rows={8} value={design.back.blurb} onChange={(e) => change((d) => { d.back.blurb = e.target.value; })} /></Field>
              <Field label="About the author"><textarea className="textarea" rows={3} value={design.back.bio} onChange={(e) => change((d) => { d.back.bio = e.target.value; })} /></Field>
              <div className="checks">
                <label className="check"><input type="checkbox" checked={design.back.align === 'justify'} onChange={(e) => change((d) => { d.back.align = e.target.checked ? 'justify' : 'left'; })} /> Justify the back cover text</label>
                <label className="check"><input type="checkbox" checked={design.back.showImprint} onChange={(e) => change((d) => { d.back.showImprint = e.target.checked; })} /> Imprint name on the back</label>
                <label className="check"><input type="checkbox" checked={design.back.showWebsite} onChange={(e) => change((d) => { d.back.showWebsite = e.target.checked; })} /> Website on the back</label>
                <label className="check"><input type="checkbox" checked={design.spine.showAuthor} onChange={(e) => change((d) => { d.spine.showAuthor = e.target.checked; })} /> Author on the spine</label>
                <label className="check"><input type="checkbox" checked={design.spine.showTitle} onChange={(e) => change((d) => { d.spine.showTitle = e.target.checked; })} /> Title on the spine</label>
                <label className="check"><input type="checkbox" checked={design.spine.showImprint} onChange={(e) => change((d) => { d.spine.showImprint = e.target.checked; })} /> Imprint on the spine</label>
              </div>
            </div>
          </details>

          {jacket && (
            <details className="group">
              <summary>Dust jacket flaps</summary>
              <div className="group-body">
                <Field label="Front flap" hint="Usually the description of the book."><textarea className="textarea" rows={5} value={design.flaps.front} onChange={(e) => change((d) => { d.flaps.front = e.target.value; })} /></Field>
                <Field label="Back flap" hint="Usually about the author."><textarea className="textarea" rows={4} value={design.flaps.back} onChange={(e) => change((d) => { d.flaps.back = e.target.value; })} /></Field>
              </div>
            </details>
          )}

          <details className="group">
            <summary>Barcode</summary>
            <div className="group-body">
              <Seg value={design.barcode.mode} onChange={(v) => change((d) => { d.barcode.mode = v; })} options={[
                { value: 'own', label: 'Draw the barcode', title: 'The ISBN barcode is drawn on the back cover in pure black' },
                { value: 'platform', label: 'Leave it to the platform', title: 'KDP prints its own barcode in the reserved area. Where a barcode is required (IngramSpark) it is still drawn.' },
                { value: 'none', label: 'None' },
              ]} />
              {design.barcode.mode !== 'none' && (
                <div className="grid2" style={{ marginTop: 10 }}>
                  <Field label="Price in the barcode">
                    <select className="select" value={design.barcode.addon} onChange={(e) => change((d) => { d.barcode.addon = e.target.value as CoverDesign['barcode']['addon']; })}>
                      <option value="no-price">No price (90000)</option><option value="price">A printed price</option><option value="none">No add-on at all</option>
                    </select>
                  </Field>
                  {design.barcode.addon === 'price' && (
                    <Field label="Price" hint="Only US and Canadian dollars have a code. An Australian dollar price cannot be put in a barcode.">
                      <div className="row">
                        <select className="select" style={{ width: 90 }} value={design.barcode.currency} onChange={(e) => change((d) => { d.barcode.currency = e.target.value as 'USD' | 'CAD'; })}><option>USD</option><option>CAD</option></select>
                        <input className="input" type="number" min={0} step={0.01} value={design.barcode.price ?? ''} onChange={(e) => change((d) => { d.barcode.price = e.target.value ? Number(e.target.value) : null; })} />
                      </div>
                    </Field>
                  )}
                </div>
              )}
              {spec && g && <div className="small dim" style={{ marginTop: 8 }}>{g.barcodeRequired ? `${spec.displayName} needs a barcode in the file.` : g.platformAddsBarcode ? `${spec.displayName} prints its own barcode when the file has none. If the file has one, tick "the cover has a barcode" when you upload.` : ''}</div>}
            </div>
          </details>
        </div>

        <div className="design-preview">
          <div className="preview">
            <div className="preview-bar">
              <span className="small dim">
                {g ? `${g.widthIn} x ${g.heightIn} in, spine ${g.spineWidthIn} in (${g.spineBasis})` : 'The cover cannot be laid out yet'}
              </span>
              <div className="grow" />
              {busy && <Loader2 size={15} className="spin" />}
              <label className="check small"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Guides</label>
            </div>
            {problems.map((p, i) => <div key={i} className="notice fail small selectable" style={{ margin: '8px 10px 0' }}><CircleAlert size={14} /> {p}</div>)}
            {plan?.cautions.map((c, i) => <div key={i} className="notice small" style={{ margin: '8px 10px 0' }}><Info size={14} /> {c}</div>)}
            <div className={`cover-stage${busy ? ' stale' : ''}`}>
              {preview && <FileImage path={preview.path} version={preview.stamp} alt="Cover preview" className="cover-img" />}
            </div>
            {guides && g && (
              <div className="preview-foot small dim">
                <span style={{ color: '#dc283c' }}>Red line</span>: trim or outer fold; everything outside it is {g.kind === 'case-laminate' ? 'wrapped around the board' : 'cut off'}.{' '}
                <span style={{ color: '#00965a' }}>Green dashes</span>: keep text inside. <span style={{ color: '#0078dc' }}>Blue lines</span>: folds of the spine.{' '}
                {g.hinges.length > 0 && <><span style={{ color: '#c87800' }}>Orange strips</span>: hinges, where the cover bends. </>}
                {!g.spineTextAllowed && g.spineTextReason ? `No spine text: ${g.spineTextReason}` : ''}
              </div>
            )}
            {result && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                <div className="row wrap">
                  <PreflightVerdict report={result.preflight} />
                  {result.cover.pdfStandard && <span className="badge">{result.cover.pdfStandard}</span>}
                  <div className="grow" />
                  {result.cover.pdfPath && (
                    <>
                      <button className="btn small" onClick={() => void host.ui?.openPath(result.cover.pdfPath)}><FileDown size={13} /> Open</button>
                      <button className="btn small" onClick={() => void host.ui?.revealPath(result.cover.pdfPath)}>Show in folder</button>
                    </>
                  )}
                </div>
                {result.cover.pdfPath && <div className="small faint selectable" style={{ marginTop: 4 }}>{result.cover.pdfPath}</div>}
                <PreflightList report={result.preflight} />
              </div>
            )}
            {ebook.length > 0 && (
              <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                {ebook.map((e) => (
                  <div key={e.platform} className="row small" style={{ marginTop: 4 }}>
                    {e.ok ? <span className="badge ok">Ebook cover for {specs?.platforms[e.platform]?.displayName ?? e.platform}</span> : <span className="badge fail"><AlertTriangle size={12} /> {specs?.platforms[e.platform]?.displayName ?? e.platform}</span>}
                    {e.ok ? <span className="dim">{e.widthPx} x {e.heightPx} pixels, {Math.round(e.sizeBytes / 1024)} KB</span> : <span className="dim">{e.warnings[0]?.message}</span>}
                    <div className="grow" />
                    {e.ok && <button className="btn small" onClick={() => void host.ui?.revealPath(e.jpgPath)}>Show in folder</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
