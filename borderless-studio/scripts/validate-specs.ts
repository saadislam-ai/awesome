/**
 * Checks every file in specs/ against the spec schema and prints a readable
 * report. Run with:  npx tsx scripts/validate-specs.ts
 * Exit code 1 means at least one file would be rejected by the app.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CurrencyTableSchema, PlatformSpecSchema, TaxTableSchema } from '../packages/core/src/specs/schema';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'specs');
let failed = false;

function check(file: string, schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } }) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) {
    console.log(`- ${file}: not present`);
    return;
  }
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    failed = true;
    console.log(`x ${file}: not valid JSON (${(e as Error).message})`);
    return;
  }
  const res = schema.safeParse(data);
  if (res.success) {
    console.log(`ok ${file}`);
  } else {
    failed = true;
    console.log(`x ${file}:`);
    for (const issue of res.error!.issues.slice(0, 40)) console.log(`    ${issue.path.join('.')}: ${issue.message}`);
  }
}

for (const f of ['kdp.json', 'ingramspark.json', 'draft2digital.json']) check(f, PlatformSpecSchema);
check('currencies.json', CurrencyTableSchema);
check('tax.json', TaxTableSchema);
process.exit(failed ? 1 : 0);
