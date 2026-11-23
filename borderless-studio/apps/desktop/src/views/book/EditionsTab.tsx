/**
 * Editions: one entry for each format the book is published in (ebook,
 * paperback, hardcover, large print). Each has its own ISBN, size, paper and
 * the platforms it goes to. The choices on offer come from the platform spec
 * files.
 */
import { useMemo } from 'react';
import { AlertTriangle, BookCopy, CheckCircle2, CircleAlert, ExternalLink, Plus, Tablet, Trash2 } from 'lucide-react';
import {
  PLATFORM_IDS, joinPath, languageProblem, readCoverTemplate, trimAvailability, validateIsbn,
  type Book, type BookFormat, type PlatformId, type SpecSet,
} from '@borderless/core';
import { useStore } from '../../state/store';
import { useBookEditor } from '../../ui/useBook';
import { Field } from '../../ui/kit';

interface TrimOption {
  id: string;
  widthIn: number;
  heightIn: number;
  platforms: PlatformId[];
}

function trimOptions(specs: SpecSet | null, type: 'paperback' | 'hardcover'): TrimOption[] {
  const map = new Map<string, TrimOption>();
  for (const p of PLATFORM_IDS) {
    for (const t of specs?.platforms[p]?.print?.formats[type]?.trimSizes ?? []) {
      const o = map.get(t.id) ?? { id: t.id, widthIn: t.widthIn, heightIn: t.heightIn, platforms: [] };
      o.platforms.push(p);
      map.set(t.id, o);
    }
  }
  return [...map.values()].sort((a, b) => a.widthIn - b.widthIn || a.heightIn - b.heightIn);
}

const SHORT: Record<PlatformId, string> = { kdp: 'KDP', ingramspark: 'IngramSpark', draft2digital: 'D2D' };

function uniqueId(book: Book, base: string): string {
  let id = base;
  let n = 2;
  while (book.formats.some((f) => f.id === id)) id = `${base}-${n++}`;
  return id;
}

export function EditionsTab() {
  const { book, update } = useBookEditor();
  const specs = useStore((s) => s.specs);
  const host = useStore((s) => s.host);
  const paperbackTrims = useMemo(() => trimOptions(specs, 'paperback'), [specs]);
  const hardcoverTrims = useMemo(() => trimOptions(specs, 'hardcover'), [specs]);

  const add = (type: BookFormat['type'], largePrint = false) => update((b) => {
    const model = b.formats.find((f) => f.type === (type === 'ebook' ? 'ebook' : 'paperback')) ?? b.formats[0];
    b.formats.push({
      id: uniqueId(b, largePrint ? 'large-print' : type), type, label: largePrint ? 'Large print' : type.charAt(0).toUpperCase() + type.slice(1),
      enabled: true, isbn: '', platforms: type === 'ebook' ? ['kdp', 'draft2digital'] : ['kdp', 'ingramspark'],
      trim: model?.trim ?? '6x9', paper: largePrint ? 'white' : (model?.paper ?? 'cream'), ink: 'bw', bleed: false, coverFinish: 'matte', binding: 'case-laminate',
      largePrint, designOverride: largePrint ? { fontSizePt: 16, lineHeight: 1.4, hyphenate: false, justify: false } : undefined,
      platformOptions: {}, ebook: { embedFonts: false, dropCaps: true, sceneBreakImage: false, inlineToc: true },
    });
  });

  return (
    <div className="page-narrow">
      <p className="dim small" style={{ marginTop: 0 }}>
        Each edition needs its own ISBN. One manuscript and one design serve all of them: the pages are laid out again for every size.
      </p>
      {book.formats.map((f, i) => (
        <Edition key={f.id} format={f} index={i} trims={f.type === 'hardcover' ? hardcoverTrims : paperbackTrims} specs={specs} language={book.language} onOpen={(url) => void host.ui?.openExternal(url)} />
      ))}
      <div className="row wrap" style={{ marginTop: 6 }}>
        <span className="dim small">Add an edition:</span>
        <button className="btn small" onClick={() => add('paperback')}><Plus size={13} /> Paperback</button>
        <button className="btn small" onClick={() => add('hardcover')}><Plus size={13} /> Hardcover</button>
        <button className="btn small" onClick={() => add('ebook')}><Plus size={13} /> Ebook</button>
        <button className="btn small" onClick={() => add('paperback', true)}><Plus size={13} /> Large print</button>
      </div>
    </div>
  );
}

function Edition(props: { format: BookFormat; index: number; trims: TrimOption[]; specs: SpecSet | null; language: string; onOpen: (url: string) => void }) {
  const { update, project } = useBookEditor();
  const host = useStore((s) => s.host);
  const toast = useStore((s) => s.toast);
  /** Read the document size from the template PDF and keep a copy of the template in the book folder. */
  const importTemplate = async () => {
    const file = await host.ui?.pickFile('Choose the cover template PDF from IngramSpark', [{ name: 'PDF', extensions: ['pdf'] }]);
    if (!file) return;
    try {
      const info = await readCoverTemplate(await host.readBinary(file));
      const rel = `cover/templates/ingramspark-${props.format.id}.pdf`;
      await host.mkdirp(joinPath(project.dir, 'cover/templates'));
      await host.copy(file, joinPath(project.dir, rel));
      update((b) => {
        const x = b.formats[props.index];
        x.platformOptions = { ...x.platformOptions, ingramspark: { ...(x.platformOptions.ingramspark ?? {}), templateWidthIn: info.widthIn, templateHeightIn: info.heightIn, templateFile: rel } };
      });
      toast('ok', `Template size ${info.widthIn} x ${info.heightIn} in read. Now type the spine width printed on the template.`);
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };
  const { format: f, index: i, specs } = props;
  const edit = (change: (f: BookFormat) => void) => update((b) => change(b.formats[i]));
  const isbn = f.isbn ? validateIsbn(f.isbn) : null;
  const print = f.type !== 'ebook';
  const type = f.type as 'paperback' | 'hardcover';
  const offered = (p: PlatformId): boolean => (print ? Boolean(specs?.platforms[p]?.print?.formats[type]) : Boolean(specs?.platforms[p]?.ebook));
  const ingram = f.platformOptions.ingramspark ?? {};
  const setIngram = (patch: Record<string, number | null>) => edit((x) => { x.platformOptions = { ...x.platformOptions, ingramspark: { ...(x.platformOptions.ingramspark ?? {}), ...patch } }; });
  const num = (v: string): number | null => (v.trim() && Number(v) > 0 ? Number(v) : null);
  const override = f.designOverride ?? {};
  const setOverride = (patch: Record<string, unknown>) => edit((x) => {
    const next: Record<string, unknown> = { ...(x.designOverride ?? {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null || next[k] === '') delete next[k];
    x.designOverride = Object.keys(next).length ? next : undefined;
  });

  return (
    <div className="card" style={{ opacity: f.enabled ? 1 : 0.65 }}>
      <div className="row">
        {print ? <BookCopy size={18} className="dim" /> : <Tablet size={18} className="dim" />}
        <input className="input" style={{ maxWidth: 240, fontWeight: 600 }} value={f.label} placeholder={f.type} onChange={(e) => edit((x) => { x.label = e.target.value; })} aria-label="Name of the edition" />
        <span className="badge">{f.type}</span>
        <div className="grow" />
        <label className="check small"><input type="checkbox" checked={f.enabled} onChange={(e) => edit((x) => { x.enabled = e.target.checked; })} /> Publish this edition</label>
        <button className="btn ghost icon" title="Remove this edition" onClick={() => { if (window.confirm(`Remove the edition "${f.label || f.id}"? Its ISBN is not deleted from your register.`)) update((b) => { b.formats.splice(i, 1); }); }}><Trash2 size={15} /></button>
      </div>

      <div className="grid3" style={{ marginTop: 12 }}>
        <Field label="ISBN" hint={isbn && !isbn.valid ? undefined : 'Digits only, or with hyphens.'}>
          <input className="input" value={f.isbn} placeholder="978..." onChange={(e) => edit((x) => { x.isbn = e.target.value.replace(/[^0-9Xx-]/g, ''); })} onBlur={() => edit((x) => { const v = validateIsbn(x.isbn); if (v.valid && v.isbn13) x.isbn = v.isbn13; })} />
          {isbn && (isbn.valid
            ? <div className="hint" style={{ color: 'var(--ok)' }}><CheckCircle2 size={11} style={{ verticalAlign: -1 }} /> The check digit is correct.</div>
            : <div className="hint" style={{ color: 'var(--fail)' }}><CircleAlert size={11} style={{ verticalAlign: -1 }} /> {isbn.problem}</div>)}
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Platforms">
            <div className="row wrap">
              {PLATFORM_IDS.map((p) => (
                <label key={p} className="check" title={offered(p) ? '' : `The ${specs?.platforms[p]?.displayName ?? p} spec file has no rules for this kind of book`}>
                  <input type="checkbox" disabled={!offered(p)} checked={f.platforms.includes(p)} onChange={(e) => edit((x) => { x.platforms = e.target.checked ? [...new Set([...x.platforms, p])] : x.platforms.filter((y) => y !== p); })} />
                  {specs?.platforms[p]?.displayName ?? p}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </div>

      {print && (
        <>
          <div className="grid3" style={{ marginTop: 12 }}>
            <Field label="Trim size">
              <select className="select" value={f.trim} onChange={(e) => edit((x) => { x.trim = e.target.value; })}>
                {!props.trims.some((t) => t.id === f.trim) && <option value={f.trim}>{f.trim.replace('x', ' x ')} in (not in any spec file)</option>}
                {props.trims.map((t) => <option key={t.id} value={t.id}>{t.widthIn} x {t.heightIn} in ({t.platforms.map((p) => SHORT[p]).join(', ')})</option>)}
              </select>
            </Field>
            <Field label="Paper">
              <select className="select" value={f.paper} onChange={(e) => edit((x) => { x.paper = e.target.value as BookFormat['paper']; })}>
                <option value="cream">Cream</option><option value="white">White</option>
              </select>
            </Field>
            <Field label="Ink">
              <select className="select" value={f.ink} onChange={(e) => edit((x) => { x.ink = e.target.value as BookFormat['ink']; })}>
                <option value="bw">Black and white</option><option value="standard-color">Standard colour</option><option value="premium-color">Premium colour</option>
              </select>
            </Field>
            <Field label="Cover finish">
              <select className="select" value={f.coverFinish} onChange={(e) => edit((x) => { x.coverFinish = e.target.value as BookFormat['coverFinish']; })}>
                <option value="matte">Matte</option><option value="gloss">Gloss</option>
              </select>
            </Field>
            {f.type === 'hardcover' && (
              <Field label="Binding">
                <select className="select" value={f.binding} onChange={(e) => edit((x) => { x.binding = e.target.value as BookFormat['binding']; })}>
                  <option value="case-laminate">Printed case (case laminate)</option><option value="dust-jacket">Case with dust jacket</option>
                </select>
              </Field>
            )}
            <div className="col" style={{ justifyContent: 'flex-end' }}>
              <label className="check" title="Needed when pictures run to the edge of the page. The file is then slightly larger than the trim size.">
                <input type="checkbox" checked={f.bleed} onChange={(e) => edit((x) => { x.bleed = e.target.checked; })} /> Pictures run to the page edge (bleed)
              </label>
              <label className="check"><input type="checkbox" checked={f.largePrint} onChange={(e) => edit((x) => { x.largePrint = e.target.checked; })} /> Large print edition</label>
            </div>
          </div>

          <div className="grid3" style={{ marginTop: 12 }}>
            <Field label="Type size for this edition (pt)" hint="Empty: the size of the book design.">
              <input className="input" type="number" min={6} max={30} step={0.5} value={override.fontSizePt ?? ''} onChange={(e) => setOverride({ fontSizePt: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
            <Field label="Line height for this edition" hint="Empty: as in the book design.">
              <input className="input" type="number" min={1} max={2.2} step={0.02} value={override.lineHeight ?? ''} onChange={(e) => setOverride({ lineHeight: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
          </div>

          {f.platforms.map((p) => {
            const spec = specs?.platforms[p];
            if (!spec?.print?.formats[type]) return null;
            const avail = trimAvailability(spec, f);
            const lang = languageProblem(spec, f.type, props.language);
            return (
              <div key={p} className="small" style={{ marginTop: 8 }}>
                {avail.problem
                  ? <div className="notice fail small"><CircleAlert size={14} /> {avail.problem}</div>
                  : <span className="dim"><CheckCircle2 size={12} color="var(--ok)" style={{ verticalAlign: -2 }} /> {spec.displayName} prints this size, paper and ink{avail.pages ? ` from ${avail.pages.min} to ${avail.pages.max} pages` : ''}.</span>}
                {lang && <div className="notice fail small" style={{ marginTop: 6 }}><CircleAlert size={14} /> {lang}</div>}
              </div>
            );
          })}

          {f.platforms.includes('ingramspark') && specs?.platforms.ingramspark?.print?.formats[type]?.spine.mode === 'template' && (
            <div className="notice small" style={{ marginTop: 12, display: 'block' }}>
              <div className="row">
                <AlertTriangle size={14} color="var(--warn)" />
                <b>IngramSpark spine width</b>
                <div className="grow" />
                {specs.platforms.ingramspark.print.formats[type]!.spine.templateUrl && (
                  <button className="btn small" onClick={() => props.onOpen(specs.platforms.ingramspark!.print!.formats[type]!.spine.templateUrl!)}><ExternalLink size={12} /> Cover template generator</button>
                )}
              </div>
              <div className="dim" style={{ margin: '6px 0 8px' }}>
                IngramSpark publishes no spine formula. Build the interior first, generate a cover template on their site for the exact page count and paper, and copy the numbers here. The app never guesses them. The document size is printed at the bottom left of the template; with it, the cover file is made in exactly that size.
              </div>
              <div className="grid3">
                <Field label="Spine width (in)"><input className="input" type="number" step={0.001} min={0} value={ingram.spineWidthIn ?? ''} onChange={(e) => setIngram({ spineWidthIn: num(e.target.value) })} /></Field>
                <Field label="Template document width (in)"><input className="input" type="number" step={0.001} min={0} value={ingram.templateWidthIn ?? ''} onChange={(e) => setIngram({ templateWidthIn: num(e.target.value) })} /></Field>
                <Field label="Template document height (in)"><input className="input" type="number" step={0.001} min={0} value={ingram.templateHeightIn ?? ''} onChange={(e) => setIngram({ templateHeightIn: num(e.target.value) })} /></Field>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => void importTemplate()}>Read the size from the template PDF</button>
                {typeof ingram.templateFile === 'string' && ingram.templateFile && <span className="small dim selectable">{ingram.templateFile}</span>}
              </div>
            </div>
          )}
        </>
      )}

      {!print && (
        <>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <label className="check"><input type="checkbox" checked={f.ebook.inlineToc} onChange={(e) => edit((x) => { x.ebook.inlineToc = e.target.checked; })} /> Contents page inside the book</label>
            <label className="check"><input type="checkbox" checked={f.ebook.dropCaps} onChange={(e) => edit((x) => { x.ebook.dropCaps = e.target.checked; })} /> Drop capitals</label>
            <label className="check" title="Reading apps normally use the reader's own font choice. Embedding makes the file larger."><input type="checkbox" checked={f.ebook.embedFonts} onChange={(e) => edit((x) => { x.ebook.embedFonts = e.target.checked; })} /> Embed the book's typeface</label>
          </div>
          {f.platforms.map((p) => {
            const spec = specs?.platforms[p];
            const lang = spec ? languageProblem(spec, 'ebook', props.language) : null;
            return lang ? <div key={p} className="notice fail small" style={{ marginTop: 8 }}><CircleAlert size={14} /> {lang}</div> : null;
          })}
        </>
      )}
    </div>
  );
}
