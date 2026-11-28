// Launches the real desktop app in self-check mode and verifies the result.
//
// The app imports a sample book through the Rust storage layer, edits it,
// snapshots and restores it, searches it, makes a backup, and then closes its
// own window the way a user would. This script checks the report, that the
// save-before-close step ran, and that the database was left as one complete
// file. Works on Windows, macOS and Linux (Linux without a display uses xvfb).
//
// Usage: npx tauri build --debug --no-bundle && npm run test:desktop
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = process.platform === 'win32' ? 'manuscriptforge.exe' : 'manuscriptforge';
const candidates = [process.env.MF_BINARY, join(root, 'src-tauri', 'target', 'debug', exe), join(root, 'src-tauri', 'target', 'release', exe)].filter(Boolean);
const binary = candidates.find((p) => existsSync(p));
if (!binary) {
  console.error(`No built app found. Looked in:\n  ${candidates.join('\n  ')}\nBuild it first: npx tauri build --debug --no-bundle`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'mf-smoke-'));
const dataDir = join(work, 'library');
const reportPath = join(work, 'report.json');
const env = { ...process.env, MANUSCRIPTFORGE_DATA_DIR: dataDir, MF_SELFTEST_OUT: reportPath };

let command = binary;
let args = [];
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  command = 'xvfb-run';
  args = ['-a', 'dbus-run-session', '--', binary];
  env.WEBKIT_DISABLE_COMPOSITING_MODE = '1';
}

console.log(`Launching ${binary}`);
const run = spawnSync(command, args, { env, timeout: 120_000, encoding: 'utf8' });

const failures = [];
const check = (ok, message) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

check(run.error === undefined, run.error ? `app could not be run: ${run.error.message}` : 'app started and exited on its own');
check(run.status === 0, `exit code is 0 (was ${run.status})`);
let report = null;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  // Reported below.
}
check(!!report, 'self-check report was written');
for (const step of report?.steps ?? []) check(step.ok, `${step.name}: ${step.detail}`);
check(report?.passed === true, 'self-check passed');
check(report?.platform?.kind === 'desktop', `ran as the desktop app on ${report?.platform?.os}`);
check(existsSync(join(dataDir, 'selftest-closed.txt')), 'work registered for "before close" ran when the window closed');
check(existsSync(join(dataDir, 'library.db')) && statSync(join(dataDir, 'library.db')).size > 4096, 'library.db holds the data');
const wal = join(dataDir, 'library.db-wal');
check(!existsSync(wal) || statSync(wal).size === 0, 'no unfinished database log was left behind');
check(existsSync(join(dataDir, 'backups')), 'a backup was written');

if (failures.length && (run.stdout || run.stderr)) console.log(`\nApp output:\n${(run.stdout + run.stderr).slice(-3000)}`);
rmSync(work, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nDesktop smoke test passed');
process.exit(failures.length ? 1 : 0);
