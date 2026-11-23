#!/usr/bin/env node
/**
 * Gets everything ready that the installer needs to contain:
 *
 *   1. downloads Typst and EPUBCheck if they are not there yet (fetch-tools),
 *   2. copies EPUBCheck (and a bundled Java runtime, if one was built with
 *      scripts/build-jre.mjs) to apps/desktop/src-tauri/bundled-tools, which
 *      the Tauri configuration packs into the installer as "tools".
 *
 * Run automatically by "npm run build".
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, 'tools');
const out = path.join(root, 'apps', 'desktop', 'src-tauri', 'bundled-tools');
const target = process.argv.includes('--target') ? ['--target', process.argv[process.argv.indexOf('--target') + 1]] : [];

execFileSync(process.execPath, [path.join(root, 'scripts', 'fetch-tools.mjs'), ...target], { stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(tools, 'epubcheck'), path.join(out, 'epubcheck'), { recursive: true });
let jre = 'not bundled (the app will look for an installed Java)';
if (fs.existsSync(path.join(tools, 'jre', 'bin'))) {
  fs.cpSync(path.join(tools, 'jre'), path.join(out, 'jre'), { recursive: true });
  jre = 'bundled';
}
fs.writeFileSync(
  path.join(out, 'README.txt'),
  'Tools packed into the installer by scripts/prepare-bundle.mjs.\n' +
    'epubcheck/  the official EPUB validator (needs Java)\n' +
    `jre/        minimal Java runtime: ${jre}\n` +
    'Typst is packed separately as a sidecar program next to the app.\n',
);
console.log(`Bundle tools ready in ${path.relative(root, out)} (Java runtime: ${jre}).`);
