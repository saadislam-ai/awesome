/**
 * Settings: appearance, editor, publisher details, the optional assistant,
 * the external tools the app found, and the platform spec files.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, FolderOpen } from 'lucide-react';
import { FONT_CATALOG, type PublisherProfile, type ToolId, type ToolInfo } from '@borderless/core';
import { useStore } from '../state/store';
import { Field, Seg } from '../ui/kit';
import { AssistantSettings } from './AssistantSettings';
import { SpecFilesCard } from './SpecFiles';

const TOOLS: { id: ToolId; name: string; purpose: string; needed: boolean }[] = [
  { id: 'typst', name: 'Typst', purpose: 'Typesets print interiors, covers and graphics', needed: true },
  { id: 'epubcheck', name: 'EPUBCheck', purpose: 'Validates ebooks before upload', needed: true },
  { id: 'java', name: 'Java', purpose: 'Runs EPUBCheck', needed: true },
  { id: 'kindle-previewer', name: 'Kindle Previewer', purpose: 'Optional: preview exactly as Kindle shows the book', needed: false },
  { id: 'git', name: 'Git', purpose: 'Optional: version history of a book folder', needed: false },
];

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const host = useStore((s) => s.host);
  const library = useStore((s) => s.library);
  const [tools, setTools] = useState<Record<string, ToolInfo>>({});
  const [publisher, setPublisher] = useState<PublisherProfile | null>(useStore.getState().publisher);

  useEffect(() => {
    void Promise.all(TOOLS.map((t) => host.toolInfo(t.id))).then((list) => setTools(Object.fromEntries(list.map((i) => [i.id, i]))));
  }, [host]);

  const savePublisher = async (patch: Partial<PublisherProfile>) => {
    if (!publisher || !library) return;
    const next = { ...publisher, ...patch };
    setPublisher(next);
    await library.savePublisher(next);
    useStore.setState({ publisher: next });
  };

  return (
    <>
      <div className="topbar"><span className="title">Settings</span></div>
      <div className="page">
        <div className="page-narrow">
          <div className="card">
            <h2>Appearance and editor</h2>
            <div className="grid3">
              <Field label="Theme">
                <Seg value={settings.theme} onChange={(theme) => void update({ theme })} options={[{ value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' }]} />
              </Field>
              <Field label="Editor typeface">
                <select className="select" value={settings.editorFont} onChange={(e) => void update({ editorFont: e.target.value })}>
                  {FONT_CATALOG.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
                </select>
              </Field>
              <Field label="Editor type size">
                <input className="input" type="number" min={13} max={30} value={settings.editorFontSizePx} onChange={(e) => void update({ editorFontSizePx: Number(e.target.value) || 19 })} />
              </Field>
              <Field label="Line width (characters, about)">
                <input className="input" type="number" min={24} max={60} value={settings.editorWidthEm} onChange={(e) => void update({ editorWidthEm: Number(e.target.value) || 34 })} />
              </Field>
              <Field label="Save after a pause of (seconds)">
                <input className="input" type="number" min={0.5} max={10} step={0.5} value={settings.autosaveSeconds} onChange={(e) => void update({ autosaveSeconds: Number(e.target.value) || 1.5 })} />
              </Field>
              <div className="col" style={{ justifyContent: 'flex-end' }}>
                <label className="check"><input type="checkbox" checked={settings.typewriterScrolling} onChange={(e) => void update({ typewriterScrolling: e.target.checked })} /> Typewriter scrolling</label>
                <label className="check"><input type="checkbox" checked={settings.focusMode} onChange={(e) => void update({ focusMode: e.target.checked })} /> Focus on the current paragraph</label>
              </div>
            </div>
          </div>

          {publisher && (
            <div className="card">
              <h2>Publisher</h2>
              <div className="grid3">
                <Field label="Imprint"><input className="input" defaultValue={publisher.imprint} onBlur={(e) => void savePublisher({ imprint: e.target.value })} /></Field>
                <Field label="City"><input className="input" defaultValue={publisher.city} onBlur={(e) => void savePublisher({ city: e.target.value })} /></Field>
                <Field label="Country"><input className="input" defaultValue={publisher.country} onBlur={(e) => void savePublisher({ country: e.target.value })} /></Field>
                <Field label="Default author name"><input className="input" defaultValue={publisher.defaultAuthor} onBlur={(e) => void savePublisher({ defaultAuthor: e.target.value })} /></Field>
                <Field label="Website"><input className="input" defaultValue={publisher.website} onBlur={(e) => void savePublisher({ website: e.target.value })} /></Field>
                <Field label="Base currency"><input className="input" defaultValue={publisher.baseCurrency} onBlur={(e) => void savePublisher({ baseCurrency: e.target.value.toUpperCase().slice(0, 3) })} /></Field>
              </div>
              <div className="small faint" style={{ marginTop: 10 }}>
                <FolderOpen size={12} style={{ verticalAlign: -2 }} /> Library folder: <span className="selectable">{library?.dir}</span>{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); void host.ui?.openPath(library!.dir); }}>Open</a>
              </div>
            </div>
          )}

          <AssistantSettings />

          <div className="card">
            <h2>Tools</h2>
            <p className="dim small">Everything here runs on this computer. The app never needs the internet to write or export.</p>
            <table className="table">
              <thead><tr><th>Tool</th><th>Status</th><th>Used for</th></tr></thead>
              <tbody>
                {TOOLS.map((t) => {
                  const info = tools[t.id];
                  return (
                    <tr key={t.id}>
                      <td><b>{t.name}</b></td>
                      <td>
                        {!info ? <span className="faint">checking...</span> : info.found ? (
                          <>
                            <span className="badge ok"><CheckCircle2 size={12} /> {info.source === 'bundled' ? 'Bundled' : 'Found'}</span>
                            <div className="small dim selectable" style={{ marginTop: 2 }}>{info.version}</div>
                          </>
                        ) : (
                          <>
                            <span className={`badge ${t.needed ? 'fail' : ''}`}>{t.needed ? <CircleAlert size={12} /> : null} Not found</span>
                            <div className="small dim" style={{ marginTop: 2 }}>{info.hint}</div>
                          </>
                        )}
                      </td>
                      <td className="dim">{t.purpose}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <SpecFilesCard />
        </div>
      </div>
    </>
  );
}
