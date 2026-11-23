/**
 * Backups and versions of the open book: zip backups (by hand and daily),
 * restoring a backup as a copy, and an optional Git history.
 */
import { useCallback, useEffect, useState } from 'react';
import { Archive, FolderOpen, GitBranch, History, Loader2, RotateCcw } from 'lucide-react';
import {
  backupSlug, createBackup, gitRecord, gitStart, gitState, hasGitFolder, listBackups, restoreBackup,
  type BackupInfo, type GitState,
} from '@borderless/core';
import { useStore } from '../../state/store';
import { saveBookNow } from '../../ui/useBook';
import { Field, fmtNumber, timeAgo } from '../../ui/kit';

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${fmtNumber(Math.max(1, Math.round(bytes / 1024)))} KB`);
const dateText = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function BackupTab() {
  const host = useStore((s) => s.host);
  const project = useStore((s) => s.project)!;
  const library = useStore((s) => s.library)!;
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const refreshBooks = useStore((s) => s.refreshBooks);
  const toast = useStore((s) => s.toast);
  const dir = settings.backup.dir || library.backupsDir;

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [label, setLabel] = useState('');
  const [withExports, setWithExports] = useState(false);
  const [busy, setBusy] = useState('');
  const [git, setGit] = useState<GitState | null>(null);
  const [foreignGit, setForeignGit] = useState(false);
  const [message, setMessage] = useState('');

  const gitOn = settings.gitBooks.includes(project.dir);
  const refresh = useCallback(async () => {
    setBackups(await listBackups(host, dir, backupSlug(project)));
    if (gitOn) setGit(await gitState(host, project.dir));
    else {
      // Git is not run in a folder until the user has switched it on for that folder.
      setGit(null);
      setForeignGit(await hasGitFolder(host, project.dir));
    }
  }, [host, dir, project, gitOn]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (what: string, job: () => Promise<void>) => {
    setBusy(what);
    try {
      await job();
    } catch (e) {
      toast('fail', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      void refresh();
    }
  };

  const backupNow = () => run('backup', async () => {
    await saveBookNow();
    const made = await createBackup(project, { destDir: dir, label, includeExports: withExports });
    setLabel('');
    toast('ok', `Backup made: ${made.name} (${sizeText(made.sizeBytes)}).`);
  });

  const restore = (b: BackupInfo) => run(`restore:${b.name}`, async () => {
    const folder = await restoreBackup(host, b.path, library.booksDir);
    await library.addBook(folder);
    await refreshBooks();
    toast('ok', `The backup was restored as a separate copy in "${folder.split('/').pop()}". It is now in the library; this book was not changed.`);
  });

  const restoreFromFile = () => run('restore-file', async () => {
    const file = await host.ui?.pickFile('Choose a backup (a .zip file made by Borderless Studio)', [{ name: 'Backups', extensions: ['zip'] }], dir);
    if (!file) return;
    const folder = await restoreBackup(host, file, library.booksDir);
    await library.addBook(folder);
    await refreshBooks();
    toast('ok', `Restored as a separate copy in "${folder.split('/').pop()}". It is now in the library.`);
  });

  const chooseFolder = async () => {
    const chosen = await host.ui?.pickFolder('Choose the folder for backups (an external drive or a synced folder is a good choice)', dir);
    if (chosen) await updateSettings({ backup: { ...settings.backup, dir: chosen } });
  };

  const startGit = () => run('git', async () => {
    await gitStart(host, project.dir);
    await updateSettings({ gitBooks: [...settings.gitBooks.filter((p) => p !== project.dir), project.dir] });
    toast('ok', 'Version history is on for this book.');
  });

  const record = () => run('record', async () => {
    await saveBookNow();
    const res = await gitRecord(host, project.dir, message, project.book.contributors[0]?.name ?? 'Author');
    if (res.recorded) setMessage('');
    toast(res.recorded ? 'ok' : 'info', res.recorded ? `Version recorded: ${res.message}` : res.message);
  });

  return (
    <div className="page-narrow">
      <div className="card">
        <div className="row"><Archive size={18} className="dim" /><h2 style={{ margin: 0 }}>Backups</h2></div>
        <p className="dim small">
          A backup is one zip file with the whole book: text, pictures, cover, settings and snapshots. Keep the backup folder on another drive or in a synced folder, so that a lost or broken computer does not take the book with it.
        </p>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div className="grow" style={{ minWidth: 240 }}>
            <Field label="Note for this backup (optional)"><input className="input" value={label} placeholder="Before the big edit" onChange={(e) => setLabel(e.target.value)} /></Field>
          </div>
          <button className="btn primary" disabled={busy !== ''} onClick={() => void backupNow()}>{busy === 'backup' ? <Loader2 size={14} className="spin" /> : <Archive size={15} />} Back up now</button>
        </div>
        <label className="check small" style={{ marginTop: 8 }}><input type="checkbox" checked={withExports} onChange={(e) => setWithExports(e.target.checked)} /> Include the exported files (PDF and EPUB); the backup gets larger</label>

        <div className="backup-settings">
          <div className="row small"><span className="dim">Backup folder:</span><span className="selectable grow">{dir}</span>
            <button className="btn small" onClick={() => void chooseFolder()}>Change</button>
            <button className="btn small" onClick={() => void host.ui?.openPath(dir)} title="Open the backup folder"><FolderOpen size={14} /></button>
          </div>
          <label className="check small"><input type="checkbox" checked={settings.backup.auto} onChange={(e) => void updateSettings({ backup: { ...settings.backup, auto: e.target.checked } })} /> Make a backup automatically once a day when the book has changed, and keep the newest
            <input className="input" type="number" min={1} max={99} value={settings.backup.keep} style={{ width: 64, margin: '0 6px' }} onChange={(e) => void updateSettings({ backup: { ...settings.backup, keep: Math.max(1, Math.min(99, Number(e.target.value) || 10)) } })} /> of them</label>
        </div>

        <table className="table" style={{ marginTop: 12 }}>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td>{dateText(b.createdAt)} <span className="faint small">({timeAgo(b.createdAt)})</span></td>
                <td>{b.automatic ? <span className="badge">daily</span> : b.label ? <span>{b.label}</span> : <span className="faint">by hand</span>}</td>
                <td className="num">{sizeText(b.sizeBytes)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn small" disabled={busy !== ''} onClick={() => void restore(b)} title="Unpack this backup into a new folder. The book you are working on is not changed.">{busy === `restore:${b.name}` ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />} Restore as a copy</button>{' '}
                  <button className="btn small" onClick={() => void host.ui?.revealPath(b.path)}>Show file</button>
                </td>
              </tr>
            ))}
            {backups.length === 0 && <tr><td className="faint">No backups of this book yet.</td></tr>}
          </tbody>
        </table>
        <div style={{ marginTop: 10 }}><button className="btn small" disabled={busy !== ''} onClick={() => void restoreFromFile()}>Restore from a backup file...</button></div>
      </div>

      <div className="card">
        <div className="row"><GitBranch size={18} className="dim" /><h2 style={{ margin: 0 }}>Version history with Git</h2><span className="badge">optional</span></div>
        <p className="dim small">
          Git keeps every recorded version of every file and shows exactly what changed between them. The history lives in the book folder and can be read with any Git program, or pushed to a private server of your choice. Nothing is sent anywhere by this app.
        </p>
        {!gitOn && (
          <>
            {foreignGit && <div className="notice warn small" style={{ marginBottom: 10 }}>This folder already has a Git history that was not started here. Settings stored in such a folder can start other programs, so only continue if the folder is your own.</div>}
            <button className="btn" disabled={busy !== ''} onClick={() => void startGit()}>{busy === 'git' ? <Loader2 size={14} className="spin" /> : <GitBranch size={15} />} {foreignGit ? 'Use the existing history' : 'Start a version history for this book'}</button>
          </>
        )}
        {gitOn && git && !git.available && <div className="notice warn small">{git.hint}</div>}
        {gitOn && git && git.available && (
          <>
            {git.insideLargerRepo && <div className="notice small" style={{ marginBottom: 10 }}>This book lies inside a larger Git folder (for example the whole library). Versions recorded here include only the files of this book.</div>}
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <div className="grow" style={{ minWidth: 240 }}>
                <Field label={git.changed ? `What changed? (${git.changed} file${git.changed === 1 ? '' : 's'} changed since the last version)` : 'Nothing has changed since the last version'}>
                  <input className="input" value={message} placeholder="Second draft of part one" onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && git.changed) void record(); }} />
                </Field>
              </div>
              <button className="btn primary" disabled={busy !== '' || git.changed === 0} onClick={() => void record()}>{busy === 'record' ? <Loader2 size={14} className="spin" /> : <History size={15} />} Record a version</button>
            </div>
            <table className="table" style={{ marginTop: 12 }}>
              <tbody>
                {git.versions.map((v) => (
                  <tr key={v.hash}><td style={{ whiteSpace: 'nowrap' }}>{dateText(v.date)}</td><td>{v.message}</td><td className="faint small selectable" style={{ textAlign: 'right' }}>{v.hash}</td></tr>
                ))}
                {git.versions.length === 0 && <tr><td className="faint">No versions recorded yet.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
