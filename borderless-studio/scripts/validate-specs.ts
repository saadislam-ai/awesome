/**
 * Checks every spec file in specs/ with the same checks the app uses before
 * it accepts a file, and prints a readable report.
 *   npx tsx scripts/validate-specs.ts
 * Exit code 1 means at least one file would be rejected by the app, or a
 * file the app expects is missing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC_FILES, inspectSpecFile } from '../packages/core/src/specs/edit';

const dir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'specs');
let failed = false;

for (const { file, label } of SPEC_FILES) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) {
    failed = true;
    console.log(`x  ${file}: missing`);
    continue;
  }
  const info = inspectSpecFile(file, fs.readFileSync(p, 'utf8'));
  if (info.valid) {
    console.log(`ok ${file}  (${label}; last checked ${info.verifiedOn || 'no date'}, ${info.sources.length} source${info.sources.length === 1 ? '' : 's'}${info.unverified.length ? `, ${info.unverified.length} part(s) not confirmed` : ''})`);
  } else {
    failed = true;
    console.log(`x  ${file}:`);
    for (const e of info.errors) console.log(`     ${e}`);
  }
}

// A file in the folder that the app does not know would never be read: say so instead of leaving it there silently.
const known = new Set<string>(SPEC_FILES.map((f) => f.file));
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith('.json') && !known.has(name)) {
    failed = true;
    console.log(`x  ${name}: the app does not use a spec file with this name`);
  }
}
process.exit(failed ? 1 : 0);
