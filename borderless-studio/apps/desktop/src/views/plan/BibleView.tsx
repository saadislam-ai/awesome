/**
 * The story bible: characters, places, things, events and notes of a book.
 * Names listed here are accepted by the spellchecker, wrong spellings are
 * reported by the consistency check, and "how to say it" feeds the
 * pronunciation guide for an audiobook.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BIBLE_TYPES, BIBLE_TYPE_LABEL, bibleMentions, bibleTimeline, docLabel, newBibleEntry, textNodes, type BibleEntry, type BibleType, type EntryMentions } from '@borderless/core';
import { useStore } from '../../state/store';
import { Field, fmtNumber } from '../../ui/kit';

const list = (text: string) => text.split(',').map((x) => x.trim()).filter(Boolean);

export function BibleView(props: { onOpen: (id: string, at?: number) => void; onChanged: () => void }) {
  const project = useStore((s) => s.project)!;
  const toast = useStore((s) => s.toast);
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(project.bible.entries[0]?.id ?? null);
  const [filter, setFilter] = useState('');
  const [mentions, setMentions] = useState<Map<string, EntryMentions>>(new Map());
  const [showTimeline, setShowTimeline] = useState(false);
  const entries = project.bible.entries;
  const entry = entries.find((e) => e.id === selected) ?? null;

  const save = () => {
    setTick((t) => t + 1);
    props.onChanged();
    void project.saveBible().catch((e) => toast('fail', `The story bible could not be saved: ${e instanceof Error ? e.message : String(e)}`));
  };
  const change = (fn: (e: BibleEntry) => void) => {
    if (!entry) return;
    fn(entry);
    save();
  };
  const add = (type: BibleType) => {
    const created = newBibleEntry(type, '');
    entries.push(created);
    setSelected(created.id);
    save();
  };
  const remove = () => {
    if (!entry || !window.confirm(`Delete "${entry.name || 'this entry'}" from the story bible? The manuscript is not changed.`)) return;
    project.bible.entries = entries.filter((e) => e.id !== entry.id);
    for (const e of project.bible.entries) e.links = e.links.filter((id) => id !== entry.id);
    setSelected(project.bible.entries[0]?.id ?? null);
    save();
  };

  // Count mentions when the view opens; "Count again" refreshes after edits.
  const count = async () => {
    const docs = await project.readAllDocs();
    const texts = textNodes(project.binder).filter((n) => n.include !== false).map((n) => ({ nodeId: n.id, title: docLabel(project.binder, n), text: docs.get(n.id) ?? '' }));
    setMentions(bibleMentions(project.bible, texts));
  };
  useEffect(() => { void count(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [project]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => !q || [e.name, ...e.aliases, e.summary].join(' ').toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, entries.length, filter, entry?.name, entry?.type]);
  const timeline = bibleTimeline(project.bible);
  const found = entry ? mentions.get(entry.id) : undefined;

  return (
    <div className="plan bible">
      <div className="bible-list">
        <input className="input" placeholder="Find in the story bible" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="row wrap" style={{ gap: 4, margin: '8px 0' }}>
          {BIBLE_TYPES.map((t) => <button key={t} className="btn small" onClick={() => add(t)} title={`Add a ${BIBLE_TYPE_LABEL[t].one.toLowerCase()}`}><Plus size={12} /> {BIBLE_TYPE_LABEL[t].one}</button>)}
        </div>
        {BIBLE_TYPES.map((type) => {
          const group = shown.filter((e) => e.type === type);
          if (group.length === 0) return null;
          return (
            <div key={type}>
              <div className="bible-group">{BIBLE_TYPE_LABEL[type].many}</div>
              {group.map((e) => (
                <button key={e.id} className={`bible-item${e.id === selected ? ' on' : ''}`} onClick={() => { setSelected(e.id); setShowTimeline(false); }}>
                  <span className="grow">{e.name || <span className="faint">No name yet</span>}</span>
                  {mentions.get(e.id)?.total ? <span className="faint small">{fmtNumber(mentions.get(e.id)!.total)}</span> : null}
                </button>
              ))}
            </div>
          );
        })}
        {entries.length === 0 && <p className="dim small">Keep the facts of your book in one place: who people are, how names are spelled, what happened when. Start by adding a character.</p>}
        {timeline.length > 0 && <button className={`bible-item${showTimeline ? ' on' : ''}`} style={{ marginTop: 10 }} onClick={() => setShowTimeline(true)}>Timeline ({timeline.length})</button>}
      </div>

      <div className="bible-entry">
        {showTimeline && (
          <div className="card">
            <h2>Timeline</h2>
            <p className="dim small">Entries that have a date or story day, in order. Numbers sort as numbers, so "Day 2" comes before "Day 10". Dates sort best when written as year, month, day (1971-03-26).</p>
            <table className="table"><tbody>
              {timeline.map((e) => <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{e.whenLabel || e.when}</td><td><button className="btn ghost small" onClick={() => { setSelected(e.id); setShowTimeline(false); }}>{e.name || 'No name yet'}</button></td><td className="dim">{e.summary}</td></tr>)}
            </tbody></table>
          </div>
        )}
        {!showTimeline && entry && (
          <div className="card" key={entry.id}>
            <div className="row">
              <select className="select" style={{ width: 150 }} value={entry.type} onChange={(e) => change((x) => { x.type = e.target.value as BibleType; })}>
                {BIBLE_TYPES.map((t) => <option key={t} value={t}>{BIBLE_TYPE_LABEL[t].one}</option>)}
              </select>
              <input className="input grow" style={{ fontWeight: 600 }} placeholder="Name" autoFocus={!entry.name} defaultValue={entry.name} onBlur={(e) => change((x) => { x.name = e.target.value.trim(); })} />
              <button className="btn ghost icon" title="Delete this entry" onClick={remove}><Trash2 size={15} /></button>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <Field label="Other names" hint="Nicknames, titles, short forms. Separate with commas. The spellchecker accepts them.">
                <input className="input" defaultValue={entry.aliases.join(', ')} onBlur={(e) => change((x) => { x.aliases = list(e.target.value); })} />
              </Field>
              <Field label="Wrong spellings to catch" hint="Separate with commas. The consistency check reports every place they appear.">
                <input className="input" defaultValue={entry.misspellings.join(', ')} onBlur={(e) => change((x) => { x.misspellings = list(e.target.value); })} />
              </Field>
              <Field label="How to say it" hint="For the audiobook pronunciation guide, for example: fah-REED.">
                <input className="input" defaultValue={entry.pronunciation} onBlur={(e) => change((x) => { x.pronunciation = e.target.value.trim(); })} />
              </Field>
              <Field label="When" hint="A date or story day for the timeline: 1971-03-26, or Day 3. Leave empty if it does not apply.">
                <div className="row">
                  <input className="input" placeholder="1971-03-26" defaultValue={entry.when} onBlur={(e) => change((x) => { x.when = e.target.value.trim(); })} />
                  <input className="input" placeholder="Shown as (optional)" defaultValue={entry.whenLabel} onBlur={(e) => change((x) => { x.whenLabel = e.target.value.trim(); })} />
                </div>
              </Field>
            </div>
            <Field label="In one line"><input className="input" defaultValue={entry.summary} onBlur={(e) => change((x) => { x.summary = e.target.value; })} /></Field>
            <Field label="Notes"><textarea className="textarea" rows={8} defaultValue={entry.notes} onBlur={(e) => change((x) => { x.notes = e.target.value; })} /></Field>

            <div className="bible-fields">
              <div className="small dim" style={{ marginBottom: 4 }}>Facts (age, eye colour, role, anything you need to keep straight)</div>
              {Object.entries(entry.fields).map(([key, value]) => (
                <div className="row" key={key} style={{ marginBottom: 4 }}>
                  <input className="input" style={{ width: 170 }} defaultValue={key} onBlur={(e) => { const k = e.target.value.trim(); if (k && k !== key) change((x) => { const next: Record<string, string> = {}; for (const [a, b] of Object.entries(x.fields)) next[a === key ? k : a] = b; x.fields = next; }); }} />
                  <input className="input grow" defaultValue={value} onBlur={(e) => change((x) => { x.fields[key] = e.target.value; })} />
                  <button className="btn ghost icon" title="Remove this fact" onClick={() => change((x) => { delete x.fields[key]; })}><Trash2 size={13} /></button>
                </div>
              ))}
              <button className="btn small" onClick={() => change((x) => { let n = 1; while (x.fields[`Fact ${n}`] !== undefined) n++; x.fields[`Fact ${n}`] = ''; })}><Plus size={12} /> Add a fact</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="row"><span className="small dim grow">{found ? `Mentioned ${fmtNumber(found.total)} time${found.total === 1 ? '' : 's'} in ${found.docs.length} document${found.docs.length === 1 ? '' : 's'}` : 'Not counted yet'}</span><button className="btn small" onClick={() => void count()}>Count again</button></div>
              <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                {found?.docs.slice(0, 40).map((d) => <button key={d.nodeId} className="btn ghost small" title="Open at the first mention" onClick={() => props.onOpen(d.nodeId, d.first)}>{d.title || 'Untitled'} <span className="faint">{d.count}</span></button>)}
              </div>
            </div>
          </div>
        )}
        {!showTimeline && !entry && <div className="empty"><h2>The story bible is empty</h2><p>Add a character, a place, a thing, an event or a note on the left.</p></div>}
      </div>
    </div>
  );
}
