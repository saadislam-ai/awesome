/**
 * Audiobook preparation: the narration script cut into one file for each
 * chapter, credits, an estimate of the finished length, the pronunciation
 * guide and the technical requirements for the audio files.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FolderOpen, Headphones, Loader2 } from 'lucide-react';
import { defaultAudioOptions, durationText, exportAudiobookKit, planAudiobook, type AudioFile, type AudioOptions, type AudioPlan, type AudiobookSpec } from '@borderless/core';
import { useStore } from '../../state/store';
import { saveBookNow } from '../../ui/useBook';
import { Field, Modal, fmtNumber } from '../../ui/kit';

const SETTINGS_FILE = 'metadata/audiobook.json';
const INCLUDE: { key: keyof AudioOptions['include']; label: string }[] = [
  { key: 'dedication', label: 'Dedication' },
  { key: 'epigraph', label: 'Epigraph' },
  { key: 'frontMatter', label: 'Other front matter (foreword, preface, introduction)' },
  { key: 'acknowledgements', label: 'Acknowledgements' },
  { key: 'aboutAuthor', label: 'About the author' },
  { key: 'otherBackMatter', label: 'Other back matter' },
];

export function AudiobookTab() {
  const host = useStore((s) => s.host);
  const project = useStore((s) => s.project)!;
  const buildContext = useStore((s) => s.buildContext);
  const toast = useStore((s) => s.toast);
  const [opts, setOpts] = useState<AudioOptions | null>(null);
  const [plan, setPlan] = useState<AudioPlan | null>(null);
  const [spec, setSpec] = useState<AudiobookSpec | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState('');
  const [reading, setReading] = useState<AudioFile | null>(null);

  useEffect(() => {
    void project.readData<Partial<AudioOptions>>(SETTINGS_FILE, {}).then((saved) => {
      const base = defaultAudioOptions();
      setOpts({ ...base, ...saved, include: { ...base.include, ...(saved.include ?? {}) } });
    });
  }, [project]);

  const refresh = useCallback(async (o: AudioOptions) => {
    try {
      await saveBookNow();
      const res = await planAudiobook(await buildContext(), o);
      setPlan(res.plan);
      setSpec(res.spec);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [buildContext]);
  useEffect(() => { if (opts) void refresh(opts); }, [opts, refresh]);

  const change = (patch: Partial<AudioOptions>) => {
    if (!opts) return;
    const next = { ...opts, ...patch };
    setOpts(next);
    void project.writeData(SETTINGS_FILE, next).catch((e) => toast('fail', String(e)));
  };
  const write = async () => {
    if (!opts) return;
    setBusy(true);
    try {
      const kit = await exportAudiobookKit(await buildContext(), opts);
      setFolder(kit.dir);
      toast('ok', `${kit.files.length} files written to exports/audiobook: a script for each audio file, the recording plan, the pronunciation guide and the requirements.`);
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!opts) return null;
  return (
    <div className="page-narrow">
      <div className="card">
        <div className="row"><Headphones size={18} className="dim" /><h2 className="grow" style={{ margin: 0 }}>Audiobook preparation</h2>
          {folder && <button className="btn small" onClick={() => void host.ui?.openPath(folder)}><FolderOpen size={14} /> Open the folder</button>}
          <button className="btn primary" disabled={busy || !plan} onClick={() => void write()}>{busy ? <Loader2 size={14} className="spin" /> : null} Write the audiobook kit</button>
        </div>
        <p className="dim small">
          The text of the book is cut into one script for each audio file, the way audiobook stores want the recordings delivered. Hand the folder to your narrator. The app prepares the words; it does not record or measure sound.
        </p>
        {error && <div className="notice fail small selectable">{error}</div>}
        <div className="grid2">
          <Field label="Narrator" hint="Named in the opening and closing credits."><input className="input" value={opts.narrator} onChange={(e) => change({ narrator: e.target.value })} /></Field>
          <Field label="Year the recording is finished" hint="For the production copyright line in the closing credits.">
            <input className="input" type="number" min={2000} max={2100} value={opts.productionYear} onChange={(e) => change({ productionYear: Math.round(Number(e.target.value)) || new Date().getFullYear() })} />
          </Field>
        </div>
        <div className="small dim" style={{ margin: '12px 0 4px' }}>Read aloud as well as the story itself:</div>
        <div className="row wrap" style={{ gap: 14 }}>
          {INCLUDE.map((i) => (
            <label key={i.key} className="check small"><input type="checkbox" checked={opts.include[i.key]} onChange={(e) => change({ include: { ...opts.include, [i.key]: e.target.checked } })} /> {i.label}</label>
          ))}
        </div>
      </div>

      {plan && spec && (
        <>
          <div className="card">
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge accent">{plan.files.length} audio files</span>
              <span className="badge">{fmtNumber(plan.totalWords)} words read aloud</span>
              <span className="badge">about {durationText(plan.totalMinutes)} finished</span>
              {plan.sample && <span className="badge">sample {plan.sample.minutes} min</span>}
            </div>
            <p className="small faint" style={{ margin: '6px 0 0' }}>The length is an estimate at {fmtNumber(spec.narration.wordsPerFinishedHour)} words for each finished hour (changeable under Settings, Platform rules, Audiobook requirements). Narrators differ.</p>
            {plan.warnings.map((w, i) => <div key={i} className="notice warn small" style={{ marginTop: 8 }}><AlertTriangle size={14} /> <div>{w}</div></div>)}
            <table className="table" style={{ marginTop: 10 }}>
              <thead><tr><th>File</th><th>What is read</th><th className="num">Words</th><th className="num">Minutes</th><th /></tr></thead>
              <tbody>
                {[...plan.files, ...(plan.sample ? [plan.sample] : [])].map((f) => (
                  <tr key={f.name}>
                    <td className="selectable" style={{ whiteSpace: 'nowrap' }}><code>{f.name}</code></td>
                    <td>{f.title}{f.decisions.map((d, i) => <div key={i} className="small" style={{ color: 'var(--warn)' }}>{d}</div>)}</td>
                    <td className="num">{fmtNumber(f.words)}</td>
                    <td className="num">{f.minutes}</td>
                    <td className="right"><button className="btn ghost small" onClick={() => setReading(f)}>Read</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.leftOut.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary className="dim small" style={{ cursor: 'pointer' }}>Pages that are not read ({plan.leftOut.length})</summary>
                <ul className="small dim" style={{ margin: '4px 0 0 18px', padding: 0 }}>{plan.leftOut.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </details>
            )}
          </div>

          <div className="card">
            <h2>Pronunciation guide</h2>
            {plan.pronunciation.length === 0
              ? <p className="dim small">Names a narrator could get wrong belong here. Open Write, Story bible, and fill in "How to say it" for people and places; they appear in this list and in the kit.</p>
              : <table className="table"><tbody>{plan.pronunciation.map((p) => <tr key={p.name}><td><b>{p.name}</b></td><td className="selectable">{p.say}</td><td className="dim">{p.summary}</td></tr>)}</tbody></table>}
          </div>

          <div className="card">
            <h2>Requirements for the audio files</h2>
            {!spec.verified && <div className="notice warn small"><AlertTriangle size={14} /> <div>{spec.verifyNote || 'These requirements have not been confirmed against the official page yet.'}</div></div>}
            <ul className="selectable" style={{ margin: '10px 0 0 18px', padding: 0 }}>
              {spec.requirements.map((r) => <li key={r.id} style={{ marginBottom: 4 }}><b>{r.title}.</b> {r.text}</li>)}
            </ul>
            <div className="row wrap small" style={{ marginTop: 10 }}>
              <span className="dim">Last checked {spec.lastVerified}. Source:</span>
              {spec.sources.map((s) => <button key={s.id} className="btn ghost small" title={s.url} onClick={() => void host.ui?.openExternal(s.url)}><ExternalLink size={12} /> {s.title}</button>)}
            </div>
            {spec.notes.map((n, i) => <p key={i} className="small faint" style={{ margin: '6px 0 0' }}>{n}</p>)}
          </div>
        </>
      )}
      {reading && (
        <Modal title={`${reading.name}: ${reading.title}`} onClose={() => setReading(null)} wide>
          <div className="selectable" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{reading.script}</div>
        </Modal>
      )}
    </div>
  );
}
