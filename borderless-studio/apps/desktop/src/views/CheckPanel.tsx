/**
 * The Check tab of the inspector: spelling of the open document, a style
 * report on it, and a consistency check across the whole manuscript. Nothing
 * here changes the text; every entry jumps to the place it is about.
 */
import { useMemo, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { analyseStyle, bibleSpellingIssues, checkConsistency, docLabel, maskMarkdown, textNodes, type ConsistencyIssue, type Finding } from '@borderless/core';
import { useStore } from '../state/store';
import type { EditorHandle } from '../editor/MarkdownEditor';
import type { SpellStatus } from '../editor/spell';
import { fmtNumber } from '../ui/kit';

const KINDS: { id: string; label: string; hint: string }[] = [
  { id: 'adverb', label: 'Adverbs', hint: 'Words ending in -ly. A few are fine; many make prose soft.' },
  { id: 'passive', label: 'Passive voice', hint: 'Possible passive constructions. Often better turned around.' },
  { id: 'filler', label: 'Filler words', hint: 'Words such as just, really and very that can usually go.' },
  { id: 'repeat', label: 'Repeated words', hint: 'The same notable word used again within a few lines.' },
  { id: 'long-sentence', label: 'Long sentences', hint: 'Sentences of more than 40 words.' },
  { id: 'cliche', label: 'Worn phrases', hint: 'Phrases readers have met too often.' },
];

function ease(score: number): string {
  if (score >= 80) return 'very easy to read';
  if (score >= 65) return 'plain English';
  if (score >= 50) return 'fairly demanding';
  return 'demanding';
}

export function CheckPanel(props: { text: string; editor: React.RefObject<EditorHandle | null>; misspelled: Set<string>; spellStatus: SpellStatus }) {
  const project = useStore((s) => s.project)!;
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const selectDoc = useStore((s) => s.selectDoc);
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConsistencyIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const report = useMemo(() => analyseStyle(props.text, { language: project.book.language }), [props.text, project.book.language]);
  const shown: Finding[] = kind ? report.findings.filter((f) => f.kind === kind).slice(0, 200) : [];

  // Where each misspelled word first appears, to jump to it.
  const misspelledList = useMemo(() => {
    if (props.misspelled.size === 0) return [];
    const masked = maskMarkdown(props.text, { hideDeletions: true }).replace(/\u2019/g, "'");
    return [...props.misspelled].map((word) => {
      const m = new RegExp(`(?<![\\p{L}\\p{M}'])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}'])`, 'u').exec(masked);
      return { word, from: m ? m.index : -1 };
    }).filter((x) => x.from >= 0).sort((a, b) => a.from - b.from);
  }, [props.misspelled, props.text]);

  const runConsistency = async () => {
    setBusy(true);
    try {
      await props.editor.current?.flush();
      const docs = await project.readAllDocs();
      const list = textNodes(project.binder).filter((n) => n.include !== false).map((n) => ({ nodeId: n.id, title: docLabel(project.binder, n), text: docs.get(n.id) ?? '' }));
      setIssues(checkConsistency(list, project.book.style, bibleSpellingIssues(project.bible, list)));
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="check-panel">
      <div className="section-title" style={{ marginTop: 0 }}>Spelling</div>
      <label className="check"><input type="checkbox" checked={settings.spellcheck} onChange={(e) => void updateSettings({ spellcheck: e.target.checked })} /> Check spelling ({project.book.style.spelling})</label>
      {settings.spellcheck && props.spellStatus.problem && <div className="notice warn small" style={{ marginTop: 6 }}>{props.spellStatus.problem}</div>}
      {settings.spellcheck && props.spellStatus.ready && (
        misspelledList.length === 0
          ? <div className="small dim" style={{ marginTop: 6 }}>No unknown words in this document.</div>
          : (
            <>
              <div className="small dim" style={{ margin: '6px 0 4px' }}>{misspelledList.length} unknown word{misspelledList.length === 1 ? '' : 's'}. Right click a marked word in the text for suggestions.</div>
              <div className="chips">
                {misspelledList.slice(0, 80).map((m) => <button key={m.word} className="chip" onClick={() => props.editor.current?.reveal(m.from, m.from + m.word.length)}>{m.word}</button>)}
              </div>
            </>
          )
      )}

      <div className="section-title">Style of this document</div>
      <div className="stat-grid">
        <div><b>{fmtNumber(report.words)}</b><span>words</span></div>
        <div><b>{fmtNumber(report.sentences)}</b><span>sentences</span></div>
        <div><b>{report.averageSentenceWords}</b><span>words a sentence</span></div>
        <div><b>{Math.round(report.dialogueShare * 100)}%</b><span>dialogue</span></div>
      </div>
      {report.readingEase !== null && report.words > 50 && <div className="small dim" style={{ marginTop: 6 }}>Reading ease {report.readingEase} (Flesch): {ease(report.readingEase)}.</div>}
      <div className="col" style={{ gap: 2, marginTop: 8 }}>
        {KINDS.map((k) => {
          const n = report.findings.filter((f) => f.kind === k.id).length;
          return (
            <button key={k.id} className={`kind-row${kind === k.id ? ' on' : ''}`} title={k.hint} disabled={n === 0} onClick={() => setKind(kind === k.id ? null : k.id)}>
              <span className="grow">{k.label}</span><span className="badge">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length > 0 && (
        <div className="finding-list">
          {shown.map((f, i) => (
            <button key={i} className="finding" onClick={() => props.editor.current?.reveal(f.from, f.to)} title={f.message}>
              {f.text.length > 70 ? f.text.slice(0, 70) + '...' : f.text}
            </button>
          ))}
        </div>
      )}
      {report.frequent.length > 0 && (
        <div className="small dim" style={{ marginTop: 8 }}>
          Most used words: {report.frequent.slice(0, 8).map((w) => `${w.word} (${w.count})`).join(', ')}
        </div>
      )}

      <div className="section-title">Consistency of the whole book</div>
      <button className="btn small" disabled={busy} onClick={() => void runConsistency()}>{busy ? <Loader2 size={13} className="spin" /> : <Play size={13} />} Check the manuscript</button>
      {issues && issues.length === 0 && <div className="small dim" style={{ marginTop: 6 }}>No inconsistencies found: spelling variants, hyphens, titles, numbers, quotation marks and names all agree.</div>}
      {issues && issues.map((issue) => (
        <div key={issue.id} className="consistency">
          <button className="kind-row" onClick={() => setOpen(open === issue.id ? null : issue.id)}>
            <span className="grow"><b>{issue.title}</b></span>
            <span className="badge">{issue.forms.map((f) => f.count).join(' / ')}</span>
          </button>
          {open === issue.id && (
            <div style={{ padding: '2px 6px 6px' }}>
              <div className="small dim">{issue.detail}</div>
              {issue.occurrences.map((o, i) => (
                <button key={i} className="finding" onClick={() => selectDoc(o.nodeId, { nodeId: o.nodeId, from: o.from, to: o.to })}>
                  <span className="faint">{o.title}:</span> {o.text}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
