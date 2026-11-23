/**
 * Marketing kit: the copy, a one page sell sheet and quote cards, all made
 * from the book's own details and the passages the author highlighted.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, FolderOpen, Loader2, Megaphone } from 'lucide-react';
import { CARD_SIZES, MAX_CARD_QUOTE, assembleProject, exportMarketingKit, marketingFacts, type CardSizeId, type MarketingFacts, type MarketingKit } from '@borderless/core';
import { useStore } from '../../state/store';
import { saveBookNow } from '../../ui/useBook';
import { FileImage } from '../../ui/FileImage';
import { Seg } from '../../ui/kit';

export function MarketingTab() {
  const host = useStore((s) => s.host);
  const publisher = useStore((s) => s.publisher);
  const buildContext = useStore((s) => s.buildContext);
  const toast = useStore((s) => s.toast);
  const [facts, setFacts] = useState<MarketingFacts | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sizes, setSizes] = useState<Set<CardSizeId>>(new Set(CARD_SIZES.map((s) => s.id)));
  const [paper, setPaper] = useState<'a4' | 'us-letter'>('a4');
  const [busy, setBusy] = useState(false);
  const [kit, setKit] = useState<MarketingKit | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      await saveBookNow();
      const ctx = await buildContext();
      const ebook = ctx.project.book.formats.find((f) => f.type === 'ebook') ?? ctx.project.book.formats[0];
      const found = await marketingFacts(ctx, await assembleProject(ctx, { formatId: ebook.id }), publisher);
      setFacts(found);
      setPicked(new Set(found.quotes.filter((q) => q.text.length <= MAX_CARD_QUOTE).slice(0, 6).map((q) => q.text)));
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [buildContext, publisher]);

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      await saveBookNow();
      const made = await exportMarketingKit(await buildContext(), { publisher, quotes: [...picked], sizes: [...sizes], paper });
      setKit(made);
      setFacts(made.facts);
      toast(made.warnings.length ? 'warn' : 'ok', `The marketing kit is in exports/marketing: the copy${made.sheetPath ? ', the sell sheet' : ''} and ${made.cards.length} quote card${made.cards.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="page-narrow">
      <div className="card">
        <div className="row"><Megaphone size={18} className="dim" /><h2 className="grow" style={{ margin: 0 }}>Marketing kit</h2>
          {kit && <button className="btn small" onClick={() => void host.ui?.openPath(kit.dir)}><FolderOpen size={14} /> Open the folder</button>}
          <button className="btn primary" disabled={busy || !facts} onClick={() => void make()}>{busy ? <Loader2 size={14} className="spin" /> : null} Make the kit</button>
        </div>
        <p className="dim small">
          Three things, made from your own words and the details of the book: a text file with descriptions, facts, quotations and drafts of announcements to edit; a one page sell sheet for bookshops, libraries and reviewers; and quote cards in the sizes social media sites use. Nothing is invented and nothing is posted anywhere.
        </p>
        {error && <div className="notice fail small selectable">{error}</div>}
        {facts && (
          <div className="row wrap small" style={{ gap: 8 }}>
            <span className={`badge ${facts.description.length ? 'ok' : 'warn'}`}>{facts.description.length ? 'Description: ready' : 'Description: missing (Publish, Listing)'}</span>
            <span className={`badge ${facts.bio ? 'ok' : 'warn'}`}>{facts.bio ? 'Author note: ready' : 'Author note: missing (About the Author page)'}</span>
            <span className={`badge ${facts.editions.some((e) => e.price) ? 'ok' : ''}`}>{facts.editions.some((e) => e.price) ? 'Prices: from your price plan' : 'Prices: none yet (Publish, Prices)'}</span>
            <span className={`badge ${facts.quotes.length ? 'ok' : ''}`}>{facts.quotes.length} quotation{facts.quotes.length === 1 ? '' : 's'}</span>
          </div>
        )}
        <div className="row wrap small" style={{ marginTop: 12, gap: 14 }}>
          <span className="dim">Sell sheet paper</span>
          <Seg value={paper} onChange={setPaper} options={[{ value: 'a4', label: 'A4' }, { value: 'us-letter', label: 'US Letter' }]} />
        </div>
      </div>

      <div className="card">
        <h2>Quote cards</h2>
        <p className="dim small">Quotations are the passages you highlight in the manuscript: in the Writer, select a sentence and press the highlighter button. Highlights are never printed in the book.</p>
        <div className="row wrap small" style={{ gap: 14, marginBottom: 8 }}>
          {CARD_SIZES.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={sizes.has(s.id)} onChange={() => setSizes(toggle(sizes, s.id))} /> {s.label}</label>)}
        </div>
        {facts?.quotes.length === 0 && <div className="notice small">No highlighted passages yet, so no cards will be made.</div>}
        {facts?.quotes.map((q) => {
          const long = q.text.length > MAX_CARD_QUOTE;
          return (
            <label key={q.text} className="quote-pick">
              <input type="checkbox" disabled={long} checked={picked.has(q.text)} onChange={() => setPicked(toggle(picked, q.text))} />
              <span>
                <span className="selectable">{q.text}</span>
                <span className="small faint"> {q.from}{long ? `. Too long for a card (${q.text.length} characters; the limit is ${MAX_CARD_QUOTE})` : ''}</span>
              </span>
            </label>
          );
        })}
      </div>

      {kit && (
        <div className="card">
          <h2>What was made</h2>
          {kit.warnings.map((w, i) => <div key={i} className="notice warn small"><AlertTriangle size={14} /> <div>{w}</div></div>)}
          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={() => void host.ui?.openPath(kit.copyPath)}><FileText size={14} /> Open the copy (text)</button>
            {kit.sheetPath && <button className="btn" onClick={() => void host.ui?.openPath(kit.sheetPath!)}><FileText size={14} /> Open the sell sheet (PDF)</button>}
          </div>
          {kit.cards.length > 0 && (
            <div className="card-grid">
              {kit.cards.map((c) => (
                <button key={c.path} className="card-thumb" title={`${c.quote}\n${c.path}`} onClick={() => void host.ui?.revealPath(c.path)}>
                  <FileImage path={c.path} alt={c.quote} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
