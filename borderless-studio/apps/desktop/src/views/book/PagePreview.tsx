/**
 * Live preview of the print pages as spreads. The pictures come from the same
 * typesetting run as the real export, so line breaks, page breaks and margins
 * are the real ones. An overlay shows the platform's safe zone: anything in
 * the shaded border would be too close to the trim edge or the spine.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, RefreshCw } from 'lucide-react';
import { previewInterior, type BookFormat, type InteriorPreviewExport } from '@borderless/core';
import { useStore } from '../../state/store';
import { saveBookNow } from '../../ui/useBook';
import { FileImage } from '../../ui/FileImage';

interface Loaded {
  info: InteriorPreviewExport;
  /** Page number to picture path. */
  pages: Map<number, string>;
  stamp: number;
}

const WINDOW = 8;

export function PagePreview(props: { formats: BookFormat[]; formatId: string; onFormat: (id: string) => void; refreshKey: unknown }) {
  const buildContext = useStore((s) => s.buildContext);
  const [left, setLeft] = useState(0); // even page number on the left of the spread; 0 is the empty side before page 1
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(true);
  const request = useRef(0);

  const load = useCallback(async (fromLeft: number, keep: Loaded | null) => {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      saveBookNow();
      const from = Math.max(1, fromLeft);
      const info = await previewInterior(await buildContext(), { formatId: props.formatId, from, to: from + WINDOW - 1, ppi: Math.round(72 * Math.min(2, window.devicePixelRatio || 1) * 1.1) });
      if (id !== request.current) return;
      const pages = new Map<number, string>(keep && keep.info.pageCount === info.pageCount ? keep.pages : []);
      for (const p of info.pages) pages.set(p.number, p.path);
      setLoaded({ info, pages, stamp: Date.now() });
      const fail = info.warnings.find((w) => w.severity === 'fail');
      if (!info.ok) setError(fail?.message ?? 'The preview could not be drawn.');
      // The book may have become shorter than the page being shown.
      if (info.pageCount > 0 && fromLeft > info.pageCount) setLeft(info.pageCount - (info.pageCount % 2));
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [buildContext, props.formatId]);

  // Design or edition changed: everything shown is out of date. Wait for a pause in the changes first.
  useEffect(() => {
    const t = window.setTimeout(() => void load(left, null), 650);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refreshKey, props.formatId]);

  const go = (target: number) => {
    const total = loaded?.info.pageCount ?? 0;
    const max = total > 0 ? total - (total % 2) : 0;
    const next = Math.min(Math.max(0, target - (target % 2)), max);
    setLeft(next);
    const need = [next, next + 1].filter((n) => n >= 1 && n <= total);
    if (loaded && need.some((n) => !loaded.pages.has(n))) void load(next, loaded);
  };

  const info = loaded?.info;
  const total = info?.pageCount ?? 0;
  const shown = [left, left + 1];

  return (
    <div className="preview">
      <div className="preview-bar">
        <select className="select" style={{ width: 'auto' }} value={props.formatId} onChange={(e) => { setLeft(0); props.onFormat(e.target.value); }} aria-label="Edition to preview">
          {props.formats.map((f) => <option key={f.id} value={f.id}>{f.label || f.id} ({f.trim.replace('x', ' x ')} in)</option>)}
        </select>
        <button className="btn ghost icon" title="First page" onClick={() => go(0)}><ChevronsLeft size={16} /></button>
        <button className="btn ghost icon" title="Previous pages" onClick={() => go(left - 2)}><ChevronLeft size={16} /></button>
        <span className="small dim" style={{ minWidth: 118, textAlign: 'center' }}>
          {total ? `Pages ${Math.max(1, left)}${left >= 1 && left + 1 <= total ? ' and ' + (left + 1) : ''} of ${total}` : 'No pages yet'}
        </span>
        <button className="btn ghost icon" title="Next pages" onClick={() => go(left + 2)}><ChevronRight size={16} /></button>
        <button className="btn ghost icon" title="Last page" onClick={() => go(total)}><ChevronsRight size={16} /></button>
        <input className="input" style={{ width: 70 }} type="number" min={1} max={total || 1} placeholder="Go to" aria-label="Go to page" onKeyDown={(e) => { if (e.key === 'Enter') go(Number((e.target as HTMLInputElement).value) || 1); }} />
        <div className="grow" />
        <label className="check small" title="Shades the border where the platform allows no text or pictures"><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Safe zone</label>
        <button className="btn ghost icon" title="Draw the pages again" onClick={() => void load(left, null)}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}</button>
      </div>
      {error && <div className="notice fail small selectable" style={{ margin: 10 }}>{error}</div>}
      {info?.problems.map((p, i) => <div key={i} className="notice warn small" style={{ margin: '8px 10px 0' }}>{p}</div>)}
      <div className={`spread${busy ? ' stale' : ''}`}>
        {info && shown.map((n) => {
          const path = n >= 1 && n <= total ? loaded!.pages.get(n) : undefined;
          const aspect = `${info.page.pdfWidthIn} / ${info.page.pdfHeightIn}`;
          if (n < 1 || n > total) return <div key={n} className="pv-page blank" style={{ aspectRatio: aspect }} />;
          return (
            <div key={n} className="pv-page" style={{ aspectRatio: aspect }}>
              {path ? <FileImage path={path} version={loaded!.stamp} alt={`Page ${n}`} /> : <div className="pv-wait"><Loader2 size={18} className="spin" /></div>}
              {overlay && <Overlay info={info} page={n} />}
            </div>
          );
        })}
        {!info && !error && <div className="dim" style={{ padding: 40 }}><Loader2 size={18} className="spin" /> Drawing the pages...</div>}
      </div>
      {info && info.ok && (
        <div className="preview-foot small dim">
          Text margins: inside {info.margins.margins.inside} in, outside {info.margins.margins.outside} in, top {info.margins.margins.top} in, bottom {info.margins.margins.bottom} in.
          {' '}Platform minimum ({info.platforms.map((p) => p).join(' and ') || 'general rules'}): inside {info.safe.insideIn} in, other edges {info.safe.outerIn} in.
          {info.margins.raised.map((r, i) => <div key={i}>{r}</div>)}
        </div>
      )}
    </div>
  );
}

/** Shaded border (not safe) and a dashed line around the text block, positioned in percent of the page picture. */
function Overlay({ info, page }: { info: InteriorPreviewExport; page: number }) {
  const recto = page % 2 === 1;
  const W = info.page.pdfWidthIn;
  const H = info.page.pdfHeightIn;
  const bleed = info.page.bleedIn;
  // With bleed the picture is wider on the outside edge and taller at top and bottom.
  const trimLeft = recto ? 0 : bleed;
  const trimTop = bleed;
  const tw = info.page.trimWidthIn;
  const th = info.page.trimHeightIn;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const safeLeft = trimLeft + (recto ? info.safe.insideIn : info.safe.outerIn);
  const safeRight = trimLeft + tw - (recto ? info.safe.outerIn : info.safe.insideIn);
  const safeTop = trimTop + info.safe.outerIn;
  const safeBottom = trimTop + th - info.safe.outerIn;
  const m = info.margins.margins;
  const textLeft = trimLeft + (recto ? m.inside : m.outside);
  const textRight = trimLeft + tw - (recto ? m.outside : m.inside);
  return (
    <>
      <div className="pv-unsafe" style={{ left: pct(trimLeft, W), top: pct(trimTop, H), width: pct(tw, W), height: pct(safeTop - trimTop, H) }} />
      <div className="pv-unsafe" style={{ left: pct(trimLeft, W), top: pct(safeBottom, H), width: pct(tw, W), height: pct(trimTop + th - safeBottom, H) }} />
      <div className="pv-unsafe" style={{ left: pct(trimLeft, W), top: pct(safeTop, H), width: pct(safeLeft - trimLeft, W), height: pct(safeBottom - safeTop, H) }} />
      <div className="pv-unsafe" style={{ left: pct(safeRight, W), top: pct(safeTop, H), width: pct(trimLeft + tw - safeRight, W), height: pct(safeBottom - safeTop, H) }} />
      <div className="pv-text" style={{ left: pct(textLeft, W), top: pct(trimTop + m.top, H), width: pct(textRight - textLeft, W), height: pct(th - m.top - m.bottom, H) }} />
      {bleed > 0 && <div className="pv-trim" style={{ left: pct(trimLeft, W), top: pct(trimTop, H), width: pct(tw, W), height: pct(th, H) }} />}
    </>
  );
}
