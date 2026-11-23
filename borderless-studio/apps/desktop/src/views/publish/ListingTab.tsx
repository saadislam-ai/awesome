/**
 * Retail listing: description, keywords and categories, checked against each
 * platform's limits, with a sheet of every form field ready to copy.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CircleAlert, ClipboardCopy, FileDown, Info, Plus, Search, Trash2 } from 'lucide-react';
import {
  checkListing, descriptionHtml, exportListingFiles, joinPath, loadListing, loadPricing, parseThema, reachPlan, saveListing, searchThema, sheetFor, themaPath,
  type Listing, type ListingIssue, type ListingSheet, type PlatformId, type ThemaEntry,
} from '@borderless/core';
import { useStore } from '../../state/store';
import { Field, Seg } from '../../ui/kit';

function copy(text: string, toast: (kind: 'ok' | 'fail', text: string) => void, what: string): void {
  void navigator.clipboard.writeText(text).then(() => toast('ok', `${what} copied.`), () => toast('fail', 'The text could not be copied. Select it and copy it by hand.'));
}

export function ListingTab() {
  const project = useStore((s) => s.project)!;
  const specs = useStore((s) => s.specs);
  const host = useStore((s) => s.host);
  const publisher = useStore((s) => s.publisher);
  const buildContext = useStore((s) => s.buildContext);
  const toast = useStore((s) => s.toast);
  const [listing, setListing] = useState<Listing | null>(null);
  const [thema, setThema] = useState<ThemaEntry[]>([]);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<ListingSheet | null>(null);
  const [target, setTarget] = useState<{ formatId: string; platform: PlatformId } | null>(null);
  const timer = useRef<number | null>(null);
  const book = project.book;

  useEffect(() => {
    void loadListing(project).then(setListing);
  }, [project]);
  useEffect(() => {
    void host.paths().then(async (p) => {
      try {
        setThema(parseThema(JSON.parse(await host.readText(joinPath(p.resources, 'lookups', 'thema-v1.7-en.json')))));
      } catch {
        setThema([]);
      }
    });
  }, [host]);

  const change = (fn: (l: Listing) => void) => {
    if (!listing) return;
    const next = structuredClone(listing);
    fn(next);
    setListing(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveListing(project, next).catch((e) => toast('fail', String(e))), 500);
  };

  const targets = useMemo(() => book.formats.filter((f) => f.enabled).flatMap((f) => f.platforms.filter((p) => specs?.platforms[p]).map((p) => ({ formatId: f.id, platform: p, label: `${specs!.platforms[p]!.displayName}: ${f.label || f.id}` }))), [book.formats, specs]);
  const current = target ?? targets[0] ?? null;

  const showSheet = async (t: { formatId: string; platform: PlatformId }) => {
    if (!listing) return;
    try {
      setTarget(t);
      const ctx = await buildContext();
      const settings = await loadPricing(project, { ingramDiscountPercent: publisher?.ingramDiscountPercent ?? 30 });
      setSheet(await sheetFor(ctx, t.formatId, t.platform, listing, await reachPlan(ctx, settings), settings));
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };

  const exportAll = async () => {
    if (!listing) return;
    try {
      await saveListing(project, listing);
      const settings = await loadPricing(project, { ingramDiscountPercent: publisher?.ingramDiscountPercent ?? 30 });
      const res = await exportListingFiles(await buildContext(), listing, settings);
      toast('ok', `${res.files.length} files written to the exports folder: a listing sheet for each edition and platform, and one ONIX file.`);
      void host.ui?.revealPath(res.onixPath);
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  };

  if (!listing) return <div className="dim">Opening the listing...</div>;
  const kdp = specs?.platforms.kdp ?? null;
  const html = descriptionHtml(listing.description, book, kdp);
  const slots = kdp?.listing?.keywordSlots ?? 7;
  const hits = searchThema(thema, query, 12);
  // The same remark from several platforms is shown once, with the platforms it concerns.
  const issues: { platform: string; issue: ListingIssue }[] = [];
  for (const p of new Set(book.formats.filter((f) => f.enabled).flatMap((f) => f.platforms))) {
    const spec = specs?.platforms[p];
    if (!spec) continue;
    for (const issue of checkListing(listing, book, spec)) {
      const same = issues.find((x) => x.issue.message === issue.message);
      if (same) same.platform += `, ${spec.displayName}`;
      else issues.push({ platform: spec.displayName, issue });
    }
  }
  const order = { fail: 0, warn: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.issue.severity] - order[b.issue.severity]);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>Description</h2>
              <span className={`badge ${html.tooLong ? 'fail' : ''}`}>{html.length} of {html.limit ?? 4000} characters for KDP</span>
            </div>
            <p className="dim small">A blank line starts a new paragraph. *Italic*, **bold**, lists with a hyphen and headings with ## work. The app turns this into what each store accepts.</p>
            <textarea className="textarea" rows={14} value={listing.description} onChange={(e) => change((l) => { l.description = e.target.value; })} />
            <div style={{ height: 10 }} />
            <Field label="Short description" hint="One or two sentences, for IngramSpark and places that show little text.">
              <textarea className="textarea" rows={2} value={listing.shortDescription} onChange={(e) => change((l) => { l.shortDescription = e.target.value; })} />
            </Field>
            <div style={{ height: 10 }} />
            <Field label="About the author" hint="For IngramSpark's contributor biography and for ONIX.">
              <textarea className="textarea" rows={3} value={listing.authorBio} onChange={(e) => change((l) => { l.authorBio = e.target.value; })} />
            </Field>
          </div>

          <div className="card">
            <h2>Keywords</h2>
            <p className="dim small">KDP has {slots} keyword fields. Use phrases readers type, and do not repeat words from the title.</p>
            <div className="grid2">
              {Array.from({ length: Math.max(slots, listing.keywords.length) }, (_, i) => (
                <input key={i} className="input" placeholder={`Keyword ${i + 1}`} value={listing.keywords[i] ?? ''} onChange={(e) => change((l) => { const k = [...l.keywords]; while (k.length <= i) k.push(''); k[i] = e.target.value; l.keywords = k; })} onBlur={() => change((l) => { while (l.keywords.length && !l.keywords[l.keywords.length - 1].trim()) l.keywords.pop(); })} />
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Categories</h2>
            <Field label="KDP categories" hint="As you pick them in the KDP form, up to three, for your own record.">
              <div className="col">
                {[0, 1, 2].map((i) => <input key={i} className="input" placeholder={`Category ${i + 1}, for example Fiction > Literary`} value={listing.kdpCategories[i] ?? ''} onChange={(e) => change((l) => { const c = [...l.kdpCategories]; while (c.length <= i) c.push(''); c[i] = e.target.value; l.kdpCategories = c; })} />)}
              </div>
            </Field>
            <div style={{ height: 12 }} />
            <div className="row"><span className="label grow">BISAC subjects (IngramSpark, Draft2Digital)</span><button className="btn small" onClick={() => change((l) => { l.bisac.push({ code: '', heading: '' }); })}><Plus size={13} /> Add</button></div>
            <div className="small faint" style={{ margin: '2px 0 6px' }}>The full BISAC list is licensed and cannot be bundled. Look the code up at bisg.org and type it here.</div>
            {listing.bisac.map((b, i) => (
              <div className="row" key={i} style={{ marginTop: 6 }}>
                <input className="input" style={{ width: 130 }} placeholder="FIC019000" value={b.code} onChange={(e) => change((l) => { l.bisac[i].code = e.target.value.toUpperCase(); })} />
                <input className="input" placeholder="FICTION / Literary" value={b.heading} onChange={(e) => change((l) => { l.bisac[i].heading = e.target.value; })} />
                <button className="btn ghost icon" title="Remove" onClick={() => change((l) => { l.bisac.splice(i, 1); })}><Trash2 size={14} /></button>
              </div>
            ))}
            <div style={{ height: 12 }} />
            <span className="label">Thema subjects (used worldwide, and in ONIX)</span>
            {listing.thema.map((code) => (
              <div className="row small" key={code} style={{ marginTop: 4 }}>
                <span className="badge accent">{code}</span><span className="grow">{themaPath(thema, code) || 'Unknown code'}</span>
                <button className="btn ghost icon small" title="Remove" onClick={() => change((l) => { l.thema = l.thema.filter((c) => c !== code); })}><Trash2 size={13} /></button>
              </div>
            ))}
            <div className="row" style={{ marginTop: 8 }}>
              <Search size={14} className="dim" />
              <input className="input" placeholder="Search Thema: historical fiction, memoir, FB..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {hits.map((h) => (
              <button key={h.code} className="thema-hit" disabled={listing.thema.includes(h.code)} onClick={() => change((l) => { l.thema.push(h.code); })}>
                <span className="badge">{h.code}</span> {themaPath(thema, h.code)}
              </button>
            ))}
          </div>

          <div className="card">
            <h2>Audience and declarations</h2>
            <div className="grid3">
              <Field label="Written for">
                <select className="select" value={listing.audience.kind} onChange={(e) => change((l) => { l.audience.kind = e.target.value as Listing['audience']['kind']; })}>
                  <option value="general">Adults (general)</option><option value="young-adult">Young adults</option><option value="children">Children</option>
                </select>
              </Field>
              <Field label="Reading age from"><input className="input" type="number" min={0} max={18} value={listing.audience.ageMin ?? ''} onChange={(e) => change((l) => { l.audience.ageMin = e.target.value ? Number(e.target.value) : null; })} /></Field>
              <Field label="Reading age to"><input className="input" type="number" min={0} max={18} value={listing.audience.ageMax ?? ''} onChange={(e) => change((l) => { l.audience.ageMax = e.target.value ? Number(e.target.value) : null; })} /></Field>
            </div>
            <div className="checks" style={{ marginTop: 10 }}>
              <label className="check"><input type="checkbox" checked={listing.audience.adult} onChange={(e) => change((l) => { l.audience.adult = e.target.checked; })} /> Contains explicit content unsuitable for readers under 18</label>
              <label className="check"><input type="checkbox" checked={listing.ownRights} onChange={(e) => change((l) => { l.ownRights = e.target.checked; })} /> I hold the publishing rights (not a public domain work)</label>
            </div>
            <div style={{ marginTop: 10 }}>
              <Field label="Content made with AI tools (KDP asks at upload)">
                <Seg value={listing.aiContent} onChange={(v) => change((l) => { l.aiContent = v; })} options={[
                  { value: 'none', label: 'None' },
                  { value: 'assisted', label: 'AI assisted', title: 'You wrote it; tools helped to edit, check or brainstorm. KDP does not ask you to declare this.' },
                  { value: 'generated', label: 'AI generated', title: 'Text, pictures or translation created by an AI tool, even if you edited it afterwards. KDP asks you to declare this.' },
                ]} />
              </Field>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>Checks</h2>
            {issues.length === 0 && <div className="small dim">Nothing to fix.</div>}
            <div className="issues" style={{ marginTop: 0 }}>
              {issues.map(({ platform, issue }, i) => (
                <div key={i} className={`issue ${issue.severity}`}>
                  {issue.severity === 'fail' ? <CircleAlert size={15} color="var(--fail)" /> : issue.severity === 'warn' ? <AlertTriangle size={15} color="var(--warn)" /> : <Info size={15} className="dim" />}
                  <div className="selectable">{issue.message} <span className="faint small">({platform})</span></div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>Description as KDP will show it</h2>
              <button className="btn small" onClick={() => copy(html.text, toast, 'The KDP description')}><ClipboardCopy size={13} /> Copy HTML</button>
            </div>
            <div className="kdp-preview selectable" dangerouslySetInnerHTML={{ __html: html.text || '<p><i>The description is empty.</i></p>' }} />
          </div>

          <div className="card">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>Listing sheet</h2>
              <button className="btn small primary" onClick={() => void exportAll()}><FileDown size={13} /> Write all sheets and ONIX</button>
            </div>
            <p className="dim small">Every field of the platform's form, in order, filled in from this book. Copy field by field while you set up the title.</p>
            <select className="select" value={current ? `${current.formatId}|${current.platform}` : ''} onChange={(e) => { const [formatId, platform] = e.target.value.split('|'); void showSheet({ formatId, platform: platform as PlatformId }); }}>
              {targets.map((t) => <option key={`${t.formatId}|${t.platform}`} value={`${t.formatId}|${t.platform}`}>{t.label}</option>)}
            </select>
            {!sheet && current && <button className="btn small" style={{ marginTop: 8 }} onClick={() => void showSheet(current)}>Show the sheet</button>}
            {sheet && (
              <div className="sheet">
                {sheet.fields.map((f, i) => (
                  <div key={i} className="sheet-row">
                    <div className="sheet-label">{f.label}{f.value && <button className="btn ghost icon small" title="Copy" onClick={() => copy(f.value, toast, f.label)}><ClipboardCopy size={12} /></button>}</div>
                    <div className={`sheet-value selectable${f.long ? ' long' : ''}`}>{f.value || <span className="faint">(empty)</span>}</div>
                    {f.note && <div className="small faint">{f.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
