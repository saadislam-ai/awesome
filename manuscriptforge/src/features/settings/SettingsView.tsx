import { Bot, BookMarked, CheckCircle2, Copy, HardDrive, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAi } from '../../app/ai';
import { DEFAULT_APPEARANCE, useApp, type FontName, type ThemeName } from '../../app/context';
import { AiSetup } from '../ai/AiSetup';
import { runSelfCheck, type CheckReport } from '../../app/selfcheck';
import type { BackupInfo } from '../../platform';
import { Button, Field, Spinner } from '../../ui/components';
import { formatBytes, formatDateTime } from '../../ui/format';

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
];
const FONTS: { value: FontName; label: string }[] = [
  { value: 'literata', label: 'Literata (book serif)' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'system', label: 'System sans-serif' },
  { value: 'mono', label: 'Typewriter' },
];

interface LogRow {
  id: number;
  ts: string;
  level: string;
  scope: string;
  message: string;
  detail: string | null;
}

export function SettingsView() {
  const { appearance, setAppearance, platform, library, notify, reportError, refreshBooks } = useApp();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const desktop = platform.info.kind === 'desktop';
  const ai = useAi();
  const [styleGuide, setStyleGuide] = useState(ai.settings.styleGuide);

  const loadBackups = () => platform.listBackups().then(setBackups).catch(() => setBackups([]));
  const loadLogs = () => library.listLogs(200).then(setLogs).catch(() => setLogs([]));
  useEffect(() => {
    void loadBackups();
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', `${what} copied.`);
    } catch {
      notify('info', text);
    }
  };

  return (
    <div className="view settings-view">
      <header className="view-header">
        <div>
          <h1>Settings</h1>
          <p className="view-sub">The AI editor, your style guide, appearance, and where your library lives.</p>
        </div>
      </header>
      <div className="view-scroll settings-sections">
        <section className="card">
          <h2><Bot size={18} /> AI editor</h2>
          <AiSetup />
        </section>

        <section className="card">
          <h2><BookMarked size={18} /> Style guide</h2>
          <p>House rules that apply to every book, for example spelling variety, number style, or how dialogue is punctuated. The AI editor follows them in every job, together with each book's own instructions.</p>
          <textarea
            rows={6}
            value={styleGuide}
            aria-label="Style guide"
            placeholder={'British spelling\nSpell out numbers under 100\nUse single quotation marks for dialogue\nNo exclamation marks in narration'}
            onChange={(e) => setStyleGuide(e.target.value)}
            onBlur={() => styleGuide !== ai.settings.styleGuide && ai.updateSettings({ styleGuide })}
          />
          <p className="fine-print">Saved when you click outside the box.</p>
        </section>

        <section className="card">
          <h2>Appearance</h2>
          <div className="theme-row" role="radiogroup" aria-label="Theme">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                role="radio"
                aria-checked={appearance.theme === theme.value}
                className={`theme-swatch theme-${theme.value} ${appearance.theme === theme.value ? 'is-active' : ''}`}
                onClick={() => setAppearance({ theme: theme.value })}
              >
                <span className="swatch-page">Aa</span>
                <span>{theme.label}</span>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <Field label="Manuscript font">
              <select value={appearance.font} onChange={(e) => setAppearance({ font: e.target.value as FontName })}>
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </Field>
            <Field label={`Text size: ${appearance.fontSize}px`}>
              <input type="range" min={14} max={28} step={1} value={appearance.fontSize} onChange={(e) => setAppearance({ fontSize: Number(e.target.value) })} />
            </Field>
            <Field label={`Line width: ${appearance.lineWidth} characters`}>
              <input type="range" min={50} max={100} step={2} value={appearance.lineWidth} onChange={(e) => setAppearance({ lineWidth: Number(e.target.value) })} />
            </Field>
            <div className="field">
              <span className="field-label">&nbsp;</span>
              <Button onClick={() => setAppearance(DEFAULT_APPEARANCE)}>Reset appearance</Button>
            </div>
          </div>
          <div className="manuscript manuscript-readonly sample-text">
            <p>The lamp had not been lit for eleven years when the first letter arrived. It came in a plain brown envelope, addressed in a careful hand to <em>The Keeper</em>.</p>
          </div>
        </section>

        <section className="card">
          <h2><HardDrive size={18} /> Library and backups</h2>
          <p>Everything is stored in one folder on this computer. Copy that folder to move or back up your whole library.</p>
          <div className="path-row">
            <code>{platform.info.dataDir}</code>
            {desktop && <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy(platform.info.dataDir, 'Folder path')}>Copy path</Button>}
          </div>
          {desktop ? (
            <>
              <p className="fine-print">A backup of the library database is made automatically once a day. The newest 14 are kept in the "backups" folder.</p>
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const made = await platform.backupNow();
                    if (made) notify('success', `Backup saved: ${made.name}`);
                    await loadBackups();
                  } catch (e) {
                    reportError('backup', e, 'The backup failed.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Backing up…' : 'Back up now'}
              </Button>
              {backups.length > 0 && (
                <table className="plain-table">
                  <thead><tr><th>Backup</th><th>Made</th><th>Size</th></tr></thead>
                  <tbody>
                    {backups.slice(0, 6).map((b) => (
                      <tr key={b.name}><td>{b.name}</td><td>{formatDateTime(b.modifiedMs)}</td><td>{formatBytes(b.sizeBytes)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="notice notice-warning">You are viewing ManuscriptForge in a browser preview. Books are kept in this browser only, and backups are made by the installed desktop app.</p>
          )}
        </section>

        <section className="card">
          <h2><ShieldCheck size={18} /> Privacy</h2>
          <p>ManuscriptForge works fully offline. There is no telemetry, no analytics and no background updates. The AI runs on this computer, so your manuscripts never leave it. The only time the app uses the internet is when you choose to download a model.</p>
        </section>

        <section className="card">
          <h2>Self-check</h2>
          <p>Tests that importing, saving, version history, search and backups work on this computer, using a small sample book that is removed afterwards.</p>
          <Button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                setReport(await runSelfCheck(platform, library));
                await refreshBooks();
                await loadBackups();
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? 'Checking…' : 'Run self-check'}
          </Button>
          {checking && <Spinner />}
          {report && (
            <ul className="check-list" data-testid="selfcheck-result" data-passed={report.passed}>
              {report.steps.map((s) => (
                <li key={s.name} className={s.ok ? 'is-ok' : 'is-fail'}>
                  {s.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  <span><strong>{s.name}.</strong> {s.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Activity log</h2>
          <p>A record of imports and of any problems, to help with troubleshooting. It stays on this computer.</p>
          <div className="row-start">
            <Button size="sm" onClick={() => void loadLogs()}>Refresh</Button>
            <Button size="sm" disabled={!logs.length} onClick={() => void copy(logs.map((l) => `${l.ts} [${l.level}] ${l.scope}: ${l.message}${l.detail ? `\n  ${l.detail}` : ''}`).join('\n'), 'Log')}>Copy log</Button>
            <Button size="sm" disabled={!logs.length} onClick={async () => { await library.clearLogs(); await loadLogs(); }}>Clear log</Button>
          </div>
          {logs.length === 0 ? (
            <p className="muted">Nothing logged yet.</p>
          ) : (
            <table className="plain-table log-table">
              <thead><tr><th>When</th><th>Level</th><th>Area</th><th>Message</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className={`log-${l.level}`} title={l.detail ?? undefined}>
                    <td>{formatDateTime(l.ts)}</td><td>{l.level}</td><td>{l.scope}</td><td>{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2>About</h2>
          <p>ManuscriptForge {platform.info.version} on {platform.info.os}. Milestone 2 of 6: local AI proofreading and line editing with tracked changes, and export.</p>
          <p className="fine-print">Coming next: analysis and Book Bible (3), developmental editing and expansion (4), submissions workflow (5), cloud mode and signed installers (6).</p>
        </section>
      </div>
    </div>
  );
}
