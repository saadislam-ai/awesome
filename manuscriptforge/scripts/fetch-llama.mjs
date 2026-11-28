// Downloads the llama.cpp engine for this computer into
// src-tauri/resources/llama/, from where it is bundled into the installer.
//
//   npm run engine:fetch                 newest release, for this computer
//   npm run engine:fetch -- --arch x64   for another processor type (macOS)
//   LLAMA_TAG=b6123 npm run engine:fetch a specific release
//   GITHUB_TOKEN=...                     avoids GitHub's anonymous rate limit
//
// Windows and Linux get two builds: "vulkan" (uses the graphics card; works
// with AMD, NVIDIA and Intel) and "cpu" (a fallback that needs no graphics
// card). macOS gets one build, which uses Metal.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which release files are wanted for a platform: [variant, pattern]. */
export function wantedAssets(platform, arch) {
  if (platform === 'win32') {
    const cpu = arch === 'arm64' ? 'arm64' : 'x64';
    return [['vulkan', new RegExp(`bin-win-vulkan-${cpu}\\.zip$`)], ['cpu', new RegExp(`bin-win-cpu-${cpu}\\.zip$`)]];
  }
  if (platform === 'darwin') return [['metal', new RegExp(`bin-macos-${arch === 'arm64' ? 'arm64' : 'x64'}\\.(zip|tar\\.gz)$`)]];
  const cpu = arch === 'arm64' ? 'arm64' : 'x64';
  return [['vulkan', new RegExp(`bin-ubuntu-vulkan-${cpu}\\.(zip|tar\\.gz)$`)], ['cpu', new RegExp(`bin-ubuntu-${cpu}\\.(zip|tar\\.gz)$`)]];
}

/** Picks the download for each wanted variant from a release's list of files. */
export function pickAssets(platform, arch, assets) {
  const picked = [];
  const missing = [];
  for (const [variant, pattern] of wantedAssets(platform, arch)) {
    const asset = assets.find((a) => pattern.test(a.name));
    if (asset) picked.push({ variant, name: asset.name, url: asset.browser_download_url });
    else missing.push(variant);
  }
  return { picked, missing };
}

function findServer(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const found = findServer(path);
      if (found) return found;
    } else if (entry === 'llama-server' || entry === 'llama-server.exe') return dir;
  }
  return null;
}

function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  // "tar" on Windows and macOS also opens zip files. Linux needs "unzip" for those.
  if (archive.endsWith('.zip') && process.platform === 'linux') execFileSync('unzip', ['-q', '-o', archive, '-d', into]);
  else execFileSync('tar', ['-xf', archive, '-C', into]);
}

async function main() {
  const args = process.argv.slice(2);
  const arch = args.includes('--arch') ? args[args.indexOf('--arch') + 1] : process.arch;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const target = join(root, 'src-tauri', 'resources', 'llama');
  const headers = { 'User-Agent': 'manuscriptforge-build', Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const tag = process.env.LLAMA_TAG;
  const api = `https://api.github.com/repos/ggml-org/llama.cpp/releases/${tag ? `tags/${tag}` : 'latest'}`;

  const response = await fetch(api, { headers });
  if (!response.ok) throw new Error(`Could not read the llama.cpp release list (${response.status}). ${response.status === 403 ? 'GitHub may be rate-limiting: set GITHUB_TOKEN and try again.' : ''}`);
  const release = await response.json();
  const { picked, missing } = pickAssets(process.platform, arch, release.assets ?? []);
  if (!picked.length) {
    throw new Error(`Release ${release.tag_name} has no build for ${process.platform} ${arch}. Files in this release:\n  ${(release.assets ?? []).map((a) => a.name).join('\n  ')}`);
  }
  if (missing.length) console.warn(`Note: release ${release.tag_name} has no "${missing.join('", "')}" build for this platform. Continuing without it.`);

  const work = mkdtempSync(join(tmpdir(), 'mf-llama-'));
  for (const asset of picked) {
    console.log(`Downloading ${asset.name} (${release.tag_name})`);
    const download = await fetch(asset.url, { headers: { 'User-Agent': headers['User-Agent'] } });
    if (!download.ok) throw new Error(`Download of ${asset.name} failed (${download.status}).`);
    const archive = join(work, asset.name);
    writeFileSync(archive, Buffer.from(await download.arrayBuffer()));
    const unpacked = join(work, asset.variant);
    extract(archive, unpacked);
    const serverDir = findServer(unpacked);
    if (!serverDir) throw new Error(`${asset.name} does not contain llama-server.`);
    const destination = join(target, asset.variant);
    rmSync(destination, { recursive: true, force: true });
    cpSync(serverDir, destination, { recursive: true, verbatimSymlinks: true });
    const server = join(destination, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    if (process.platform !== 'win32') chmodSync(server, 0o755);
    writeFileSync(join(destination, 'VERSION.txt'), `llama.cpp ${release.tag_name}\n${asset.name}\n`);
    console.log(`  installed to ${destination}`);
  }
  rmSync(work, { recursive: true, force: true });
  if (!existsSync(target)) throw new Error('Nothing was installed.');
  console.log('The AI engine is ready. It will be included the next time the app is built.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
