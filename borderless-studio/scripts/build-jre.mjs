#!/usr/bin/env node
/**
 * Builds a minimal Java runtime (about 45 MB) with jlink so that EPUBCheck
 * works on computers that have no Java installed. Needs a JDK 17 or newer on
 * the computer that builds the installer. The result goes to tools/jre and is
 * picked up by prepare-bundle.mjs.
 *
 *   node scripts/build-jre.mjs
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tools', 'jre');
const exe = (n) => (process.platform === 'win32' ? `${n}.exe` : n);
const home = process.env.JAVA_HOME;
const jlink = home && fs.existsSync(path.join(home, 'bin', exe('jlink'))) ? path.join(home, 'bin', exe('jlink')) : exe('jlink');
// Modules EPUBCheck needs: XML parsing, logging, image reading (java.desktop) and naming.
const modules = 'java.base,java.xml,java.logging,java.desktop,java.naming,java.sql,jdk.crypto.ec,jdk.unsupported';
fs.rmSync(out, { recursive: true, force: true });
try {
  execFileSync(jlink, ['--add-modules', modules, '--strip-debug', '--no-header-files', '--no-man-pages', '--compress', 'zip-6', '--output', out], { stdio: 'inherit' });
} catch (e) {
  console.error('\njlink could not be run. Install a JDK (17 or newer) and set JAVA_HOME, or skip this step:');
  console.error('without a bundled runtime the app simply uses a Java that is installed on the computer.');
  process.exit(1);
}
const jar = path.join(root, 'tools', 'epubcheck', 'epubcheck.jar');
if (fs.existsSync(jar)) {
  const v = execFileSync(path.join(out, 'bin', exe('java')), ['-jar', jar, '--version'], { encoding: 'utf8' });
  console.log(v.trim().split('\n').find((l) => /EPUBCheck/.test(l)) ?? v.trim());
}
console.log(`Minimal Java runtime written to ${path.relative(root, out)}`);
