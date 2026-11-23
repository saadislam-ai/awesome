#!/usr/bin/env node
/**
 * Downloads the external tools Borderless Studio bundles, for the computer
 * this script runs on:
 *
 *   tools/typst/typst[.exe]        the typesetting engine (pinned version)
 *   tools/epubcheck/epubcheck.jar  the official EPUB validator
 *
 * and copies Typst to apps/desktop/src-tauri/binaries/typst-<target triple>,
 * which is where Tauri expects a "sidecar" program.
 *
 * Only this script needs the internet. The app itself never does.
 *
 *   node scripts/fetch-tools.mjs            download what is missing
 *   node scripts/fetch-tools.mjs --force    download again
 *   node scripts/fetch-tools.mjs --target aarch64-apple-darwin   (cross builds)
 *
 * If a download is blocked, Typst can be built from source instead:
 *   cargo install typst-cli --version <TYPST_VERSION> --locked --root tools/typst-src
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TYPST_VERSION = '0.15.1';
export const EPUBCHECK_VERSION = '5.4.0';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsDir = path.join(root, 'tools');
const args = process.argv.slice(2);
const force = args.includes('--force');
const targetArg = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;

function hostTriple() {
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (!arch) throw new Error(`Unsupported processor: ${process.arch}`);
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`;
  throw new Error(`Unsupported operating system: ${process.platform}`);
}

/** Typst publishes musl builds for Linux; every other name matches the Rust target triple. */
function typstAsset(triple) {
  const t = triple.replace('unknown-linux-gnu', 'unknown-linux-musl');
  const ext = t.includes('windows') ? 'zip' : 'tar.xz';
  return { name: `typst-${t}`, file: `typst-${t}.${ext}`, ext };
}

async function download(url, dest) {
  process.stdout.write(`  downloading ${url}\n`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return createHash('sha256').update(buf).digest('hex');
}

function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // bsdtar (macOS, Windows 10+) and GNU tar both read .tar.xz; bsdtar also reads .zip.
  if (archive.endsWith('.zip') && process.platform !== 'win32' && process.platform !== 'darwin') {
    execFileSync('unzip', ['-q', '-o', archive, '-d', destDir], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
  }
}

/**
 * Checksums of the official release files are kept in scripts/tools.lock.json
 * (committed to git). A download that does not match the recorded checksum is
 * refused, so a tampered or corrupted file can never end up inside an installer.
 */
function recordHash(name, hash) {
  const lockPath = path.join(root, 'scripts', 'tools.lock.json');
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : {};
  if (lock[name] && lock[name] !== hash) {
    throw new Error(`${name}: the downloaded file does not match the checksum recorded in scripts/tools.lock.json.\n  expected ${lock[name]}\n  got      ${hash}\nDo not use this file. If the tool version was changed on purpose, remove its line from the lock file and run again.`);
  }
  if (!lock[name]) {
    lock[name] = hash;
    const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(lockPath, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`  recorded checksum for ${name}`);
  } else {
    console.log(`  checksum verified for ${name}`);
  }
}

async function fetchTypst(triple) {
  const exe = triple.includes('windows') ? 'typst.exe' : 'typst';
  const isHost = triple === hostTriple();
  const outDir = isHost ? path.join(toolsDir, 'typst') : path.join(toolsDir, `typst-${triple}`);
  const outBin = path.join(outDir, exe);
  if (fs.existsSync(outBin) && !force) {
    console.log(`Typst ${TYPST_VERSION} already present for ${triple}`);
  } else {
    const asset = typstAsset(triple);
    const tmp = path.join(os.tmpdir(), asset.file);
    console.log(`Typst ${TYPST_VERSION} for ${triple}`);
    const hash = await download(`https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/${asset.file}`, tmp);
    recordHash(asset.file, hash);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typst-'));
    extract(tmp, tmpDir);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(path.join(tmpDir, asset.name, exe), outBin);
    for (const extra of ['LICENSE', 'NOTICE']) {
      const p = path.join(tmpDir, asset.name, extra);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(outDir, extra));
    }
    if (!triple.includes('windows')) fs.chmodSync(outBin, 0o755);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmp, { force: true });
  }
  // Tauri sidecar location: binaries/<name>-<target triple>[.exe]
  const sidecarDir = path.join(root, 'apps', 'desktop', 'src-tauri', 'binaries');
  fs.mkdirSync(sidecarDir, { recursive: true });
  const sidecar = path.join(sidecarDir, `typst-${triple}${triple.includes('windows') ? '.exe' : ''}`);
  fs.copyFileSync(outBin, sidecar);
  if (!triple.includes('windows')) fs.chmodSync(sidecar, 0o755);
  console.log(`  -> ${path.relative(root, outBin)}`);
  console.log(`  -> ${path.relative(root, sidecar)}`);
}

async function fetchEpubCheck() {
  const outDir = path.join(toolsDir, 'epubcheck');
  if (fs.existsSync(path.join(outDir, 'epubcheck.jar')) && !force) {
    console.log(`EPUBCheck ${EPUBCHECK_VERSION} already present`);
    return;
  }
  console.log(`EPUBCheck ${EPUBCHECK_VERSION}`);
  const file = `epubcheck-${EPUBCHECK_VERSION}.zip`;
  const tmp = path.join(os.tmpdir(), file);
  const hash = await download(`https://github.com/w3c/epubcheck/releases/download/v${EPUBCHECK_VERSION}/${file}`, tmp);
  recordHash(file, hash);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epubcheck-'));
  extract(tmp, tmpDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(tmpDir, `epubcheck-${EPUBCHECK_VERSION}`), outDir, { recursive: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tmp, { force: true });
  console.log(`  -> ${path.relative(root, outDir)}`);
}

const triple = targetArg ?? hostTriple();
try {
  await fetchTypst(triple);
  await fetchEpubCheck();
  console.log('\nAll tools are in place.');
} catch (e) {
  console.error(`\n${e.message}`);
  console.error('\nIf this computer cannot reach github.com, see the note at the top of scripts/fetch-tools.mjs.');
  process.exit(1);
}
