// Shared set-up for the browser tests: serves the built app, opens a real
// browser engine (Chromium), and collects results.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..');
export const fixtures = join(root, 'tests', 'fixtures', 'files');
export const out = join(here, 'output');
mkdirSync(out, { recursive: true });

function loadPlaywright() {
  for (const base of [join(root, 'package.json'), '/opt/node-tools/node_modules/x.js']) {
    try {
      return createRequire(base)('playwright');
    } catch {
      // Try the next location.
    }
  }
  throw new Error('Playwright is not installed. Run: npm i -D playwright');
}

/**
 * Starts the app and a browser. `allowed` lists extra origins the page may
 * contact (for example a stand-in AI server); anything else counts as a leak.
 */
export async function start({ port, allowed = [] }) {
  const { chromium } = loadPlaywright();
  const url = `http://127.0.0.1:${port}/`;
  // Vite is started directly (not through npx) so that stopping it really stops it.
  const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try {
      up = (await fetch(url)).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!up) {
    server.kill();
    throw new Error(`Preview server did not start:\n${serverLog}`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.E2E_SCALE ?? 1), acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  const external = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));
  page.on('request', (r) => {
    const target = r.url();
    if ([url, 'data:', 'blob:', ...allowed].some((prefix) => target.startsWith(prefix))) return;
    external.push(target);
  });

  let failures = 0;
  let stepNumber = 0;
  const check = (condition, message) => {
    console.log(`    ${condition ? 'ok  ' : 'FAIL'}  ${message}`);
    if (!condition) failures++;
  };
  const step = async (name, fn) => {
    stepNumber++;
    console.log(`\n${String(stepNumber).padStart(2, '0')}. ${name}`);
    try {
      await fn();
    } catch (e) {
      failures++;
      console.log(`    FAIL  ${e.message.split('\n')[0]}`);
    }
  };
  const finish = async () => {
    await browser.close();
    server.kill();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
  };
  return { page, url, check, step, finish, problems, external, shot: (name) => page.screenshot({ path: join(out, `${name}.png`) }) };
}
