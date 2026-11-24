/**
 * Reach First prices: for every edition, platform and marketplace, the
 * lowest list price the platform accepts, what the reader pays and what is
 * left per copy. Every rate comes from the platform spec files.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CircleAlert, ExternalLink, Info, RotateCcw } from 'lucide-react';
import {
  PRICE_ENDINGS, PRICE_ENDING_LABEL, isStale, loadPricing, reachPlan, savePricing,
  type PlatformId, type PriceRow, type PricingSettings, type ReachPlan,
} from '@borderless/core';
import { useStore } from '../../state/store';
import { Field } from '../../ui/kit';
import { saveBookNow } from '../../ui/useBook';

type Plan = ReachPlan & { pages: Record<string, Partial<Record<PlatformId, number>>>; ebookFileSizeMB: number | null };

const money = (v: number | null, r: PriceRow): string => (v === null ? '' : `${r.currency} ${v.toFixed(r.decimals)}`);

export function PricingTab() {
  const project = useStore((s) => s.project)!;
  const specs = useStore((s) => s.specs);
  const publisher = useStore((s) => s.publisher);
  const host = useStore((s) => s.host);
  const buildContext = useStore((s) => s.buildContext);
  const toast = useStore((s) => s.toast);
  const rev = useStore((s) => s.rev);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const timer = useRef<number | null>(null);

  const compute = useCallback(async (s: PricingSettings) => {
    try {
      saveBookNow();
      setPlan(await reachPlan(await buildContext(), s));
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    }
  }, [buildContext, toast]);

  useEffect(() => {
    void loadPricing(project, { ingramDiscountPercent: publisher?.ingramDiscountPercent ?? 30, marginCurrency: publisher?.baseCurrency ?? 'AUD' }).then((s) => {
      setSettings(s);
      void compute(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, rev]);

  const change = (fn: (s: PricingSettings) => void) => {
    if (!settings) return;
    const next = structuredClone(settings);
    fn(next);
    setSettings(next);
    void compute(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void savePricing(project, next).catch((e) => toast('fail', String(e))), 500);
  };

  if (!settings) return <div className="dim">Opening the prices...</div>;
  const base = plan?.baseCurrency ?? 'AUD';
  const groups = new Map<string, PriceRow[]>();
  for (const r of plan?.rows ?? []) {
    const key = `${r.formatLabel}  ·  ${r.platformName}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const staleSpecs = Object.values(specs?.platforms ?? {}).filter((s) => s && isStale(s)).map((s) => s!.displayName);
  const printFormats = project.book.formats.filter((f) => f.enabled && f.type !== 'ebook');

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <div className="card">
        <h2>Reach first</h2>
        <p className="dim small" style={{ marginTop: 0 }}>
          Prices start at the lowest amount each platform accepts. Add an amount per copy if you want every sale to earn a margin.
        </p>
        <div className="grid3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Field label={`Kept per copy (${settings.marginCurrency})`} hint="0 means the lowest possible price.">
            <input className="input" type="number" min={0} step={0.1} value={settings.marginPerCopy} onChange={(e) => change((s) => { s.marginPerCopy = Math.max(0, Number(e.target.value) || 0); })} />
          </Field>
          <Field label="Round prices up to">
            <select className="select" value={settings.ending} onChange={(e) => change((s) => { s.ending = e.target.value as PricingSettings['ending']; })}>
              {PRICE_ENDINGS.map((x) => <option key={x} value={x}>{PRICE_ENDING_LABEL[x]}</option>)}
            </select>
          </Field>
          <Field label="IngramSpark wholesale discount (%)" hint="The lowest your account allows keeps prices lowest.">
            <input className="input" type="number" min={0} max={55} step={1} value={settings.ingramDiscountPercent} onChange={(e) => change((s) => { s.ingramDiscountPercent = Math.max(0, Math.min(80, Number(e.target.value) || 0)); })} />
          </Field>
          <Field label="Ebook file size (MB)" hint={plan?.ebookFileSizeMB ? `Last export: ${plan.ebookFileSizeMB.toFixed(2)} MB.` : 'Build the ebook to measure it.'}>
            <input className="input" type="number" min={0} step={0.1} value={settings.ebookFileSizeMB ?? ''} placeholder={plan?.ebookFileSizeMB ? plan.ebookFileSizeMB.toFixed(2) : '1'} onChange={(e) => change((s) => { s.ebookFileSizeMB = e.target.value ? Number(e.target.value) : null; })} />
          </Field>
        </div>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <label className="check" title="Enrolling makes the ebook exclusive to Amazon, which rules out Draft2Digital and other stores">
            <input type="checkbox" checked={settings.kdpSelect} onChange={(e) => change((s) => { s.kdpSelect = e.target.checked; })} /> The ebook is enrolled in KDP Select
          </label>
          {printFormats.filter((f) => !f.platforms.some((p) => plan?.pages[f.id]?.[p])).map((f) => (
            <label key={f.id} className="row small" style={{ gap: 6 }}>
              <span className="dim">Estimated pages for {f.label || f.id}:</span>
              <input className="input" style={{ width: 80 }} type="number" min={1} value={settings.pagesEstimate[f.id] ?? ''} onChange={(e) => change((s) => { if (e.target.value) s.pagesEstimate[f.id] = Number(e.target.value); else delete s.pagesEstimate[f.id]; })} />
            </label>
          ))}
        </div>
      </div>

      {plan?.warnings.map((w, i) => <div key={i} className="notice warn" style={{ marginTop: 10 }}><AlertTriangle size={16} /> <span className="selectable">{w}</span></div>)}
      {staleSpecs.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}><AlertTriangle size={16} /> The rules for {staleSpecs.join(' and ')} were last verified more than six months ago. Printing costs and royalty rates may have changed.</div>}

      {[...groups.entries()].map(([title, rows]) => {
        const first = rows[0];
        const spec = specs?.platforms[first.platform];
        const calc = first.kind === 'print' ? spec?.pricing.print?.calculatorUrl : undefined;
        return (
          <div className="card" key={title} style={{ marginTop: 12 }}>
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>{title}</h2>
              {first.pages !== null && <span className="badge">{first.pages} pages</span>}
              {calc && <button className="btn small" title="Compare one price with the platform's own calculator" onClick={() => void host.ui?.openExternal(calc)}><ExternalLink size={12} /> Official calculator</button>}
            </div>
            <table className="table prices">
              <thead>
                <tr>
                  <th>Marketplace</th>
                  {first.kind === 'print' && <th className="right">Printing</th>}
                  <th className="right">Lowest price</th>
                  <th className="right">Your price</th>
                  <th className="right">You receive</th>
                  <th className="right">Reader pays</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td><b>{r.marketLabel}</b> <span className="faint">{r.currency}</span></td>
                    {r.kind === 'print' && <td className="right" title={r.costBasis}>{r.cost === null ? '' : r.cost.toFixed(r.decimals)}</td>}
                    <td className="right">{r.minimum === null ? '' : r.minimum.toFixed(r.decimals)}</td>
                    <td className="right">
                      <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <input
                          className={`input price${r.problems.length ? ' invalid' : ''}`} type="number" min={0} step={r.decimals ? 0.01 : 1}
                          value={r.overridden ? settings.overrides[r.key] : ''} placeholder={r.price === null ? '' : r.price.toFixed(r.decimals)}
                          title="Type a price to fix it; clear the field to follow the lowest price again"
                          onChange={(e) => change((s) => { if (e.target.value === '') delete s.overrides[r.key]; else s.overrides[r.key] = Math.max(0, Number(e.target.value)); })}
                        />
                        {r.overridden && <button className="btn ghost icon small" title="Back to the suggested price" onClick={() => change((s) => { delete s.overrides[r.key]; })}><RotateCcw size={12} /></button>}
                      </span>
                    </td>
                    <td className="right">
                      {r.earnings === null ? '' : <span style={{ color: r.earnings < 0 ? 'var(--fail)' : undefined }}>{r.earnings.toFixed(r.decimals)}</span>}
                      {r.rate !== null && <span className="faint small"> at {Math.round(r.rate * 100)}%{r.plan ? ' plan' : ''}</span>}
                      {r.earningsBase !== null && r.currency !== base && <div className="faint small">{base} {r.earningsBase.toFixed(2)}</div>}
                    </td>
                    <td className="right">
                      {r.price === 0 ? <span className="badge ok">Free</span> : money(r.shelf, r)}
                      {r.shelfBase !== null && r.currency !== base && r.price !== 0 && <div className="faint small">{base} {r.shelfBase.toFixed(2)}</div>}
                      {r.taxNote && r.price !== 0 && <div className="faint small">{r.taxNote}</div>}
                    </td>
                    <td style={{ width: 26 }}>
                      {r.problems.length > 0
                        ? <span title={r.problems.join('\n')}><CircleAlert size={15} color="var(--fail)" /></span>
                        : r.notes.length > 0 ? <span title={r.notes.join('\n')}><Info size={15} className="dim" /></span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {[...new Set(rows.flatMap((r) => r.problems))].map((p, i) => <div key={i} className="notice fail small" style={{ marginTop: 6 }}><CircleAlert size={14} /> {p}</div>)}
            {[...new Set(rows.filter((r) => r.platform === 'ingramspark').flatMap((r) => r.notes))].slice(0, 4).map((n, i) => <div key={i} className="small dim" style={{ marginTop: 6 }}>{n}</div>)}
          </div>
        );
      })}

      {plan && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Good to know</h2>
          <ul className="selectable small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
            <li>Amounts in {base} use the exchange rates of {plan.ratesDate ?? 'an unknown date'} from the currency table (Settings, Platform spec files). Platforms pay in their own currencies and use their own rates.</li>
            <li>Printing costs and royalty rates are read from the spec files. Compare one price of each edition with the platform's own calculator before you publish.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
