/**
 * Editing the spec files from inside the app.
 *
 * The files shipped with the app are never changed. An edit is saved as a
 * copy in the "specs" folder of the library, and that copy is used from then
 * on; deleting the copy brings the shipped file back. A file is checked
 * before it is saved, so a typing slip cannot leave the app without rules.
 */
import { ChecklistFileSchema } from '../build/publish';
import type { Host } from '../host';
import { LargePrintSpecSchema } from '../preflight/largeprint';
import { joinPath } from '../util/paths';
import { isStale, monthsSince, parseCurrencyTable, parsePlatformSpec, parseSpecText, parseTaxTable, unverifiedSections } from './index';

export const SPEC_FILES = [
  { file: 'kdp.json', label: 'Amazon KDP', about: 'Trim sizes, margins, spine formula, printing costs, royalties, file rules and listing limits' },
  { file: 'ingramspark.json', label: 'IngramSpark', about: 'Trim sizes, margins, cover rules, printing costs, wholesale terms and file rules' },
  { file: 'draft2digital.json', label: 'Draft2Digital', about: 'Ebook and print rules, royalties and listing limits' },
  { file: 'currencies.json', label: 'Currency rates', about: 'Rates used to show prices in other currencies; update them whenever you price a book' },
  { file: 'tax.json', label: 'Sales tax on ebooks', about: 'Tax included in ebook list prices, by country' },
  { file: 'publishing-checklist.json', label: 'Publishing checklist', about: 'The steps shown under Publish, Checklist' },
  { file: 'large-print.json', label: 'Large print guidance', about: 'Type size, line spacing and alignment that a large print edition is checked against' },
] as const;
export type SpecFileName = (typeof SPEC_FILES)[number]['file'];

export interface SpecFileInfo {
  file: string;
  valid: boolean;
  /** What is wrong, one plain line for each problem (at most 25). */
  errors: string[];
  /** The day the content was last checked against its sources (YYYY-MM-DD); empty when the file does not say. */
  verifiedOn: string;
  monthsOld: number | null;
  /** Older than six months: the platform may have changed its rules since. */
  stale: boolean;
  sources: { title: string; url: string }[];
  /** Parts of the file that are marked as not yet confirmed against an official page. */
  unverified: { path: string; note?: string }[];
}

/** Which field of a file holds the day it was last checked. */
const dateField = (file: string): 'date' | 'lastVerified' => (file === 'currencies.json' ? 'date' : 'lastVerified');

function validate(file: string, text: string): { errors: string[]; platform?: ReturnType<typeof parsePlatformSpec>['value'] } {
  if (file === 'currencies.json') return { errors: parseCurrencyTable(text).errors };
  if (file === 'tax.json') return { errors: parseTaxTable(text).errors };
  if (file === 'publishing-checklist.json') return { errors: parseSpecText(text, ChecklistFileSchema as never).errors };
  if (file === 'large-print.json') return { errors: parseSpecText(text, LargePrintSpecSchema as never).errors };
  const parsed = parsePlatformSpec(text);
  const expected = file.replace(/\.json$/, '');
  const errors = [...parsed.errors];
  if (parsed.value && parsed.value.platform !== expected) errors.push(`platform: this file is ${file}, so "platform" must be "${expected}" (it says "${parsed.value.platform}").`);
  return { errors, platform: parsed.value };
}

/** Everything the editor shows about a spec file: whether it is valid, how old it is, and where its numbers come from. */
export function inspectSpecFile(file: string, text: string, today: Date = new Date()): SpecFileInfo {
  const { errors, platform } = validate(file, text);
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* reported in errors */
  }
  const verifiedOn = typeof raw[dateField(file)] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw[dateField(file)] as string) ? (raw[dateField(file)] as string) : '';
  const sources: { title: string; url: string }[] = [];
  if (Array.isArray(raw.sources)) {
    for (const s of raw.sources as Record<string, unknown>[]) {
      if (s && typeof s.url === 'string') sources.push({ title: typeof s.title === 'string' && s.title ? s.title : s.url, url: s.url });
    }
  }
  if (typeof raw.sourceUrl === 'string') sources.push({ title: typeof raw.source === 'string' ? raw.source : raw.sourceUrl, url: raw.sourceUrl });
  return {
    file,
    valid: errors.length === 0,
    errors,
    verifiedOn,
    monthsOld: verifiedOn ? monthsSince(verifiedOn, today) : null,
    stale: verifiedOn ? isStale({ lastVerified: verifiedOn }, today) : false,
    sources,
    unverified: platform ? unverifiedSections(platform) : [],
  };
}

/** Stamp the text with today's date as the day it was checked. The rest of the text, and its layout, stays as it is. */
export function markVerified(file: string, text: string, today: Date = new Date()): string {
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const field = dateField(file);
  const pattern = new RegExp(`("${field}"\\s*:\\s*")[^"]*(")`);
  if (pattern.test(text)) return text.replace(pattern, `$1${day}$2`);
  // No such field yet: add it as the first entry.
  return text.replace(/^\s*\{/, (open) => `${open}\n  "${field}": "${day}",`);
}

/** The text of a spec file: the personal copy when there is one, otherwise the file shipped with the app. */
export async function readSpecFile(host: Host, bundledDir: string, userDir: string, file: string): Promise<{ text: string; origin: 'user' | 'bundled' }> {
  const own = joinPath(userDir, file);
  if (await host.exists(own)) return { text: await host.readText(own), origin: 'user' };
  return { text: await host.readText(joinPath(bundledDir, file)), origin: 'bundled' };
}

/** Save an edited spec file as the personal copy. A file with errors is refused, with the list of what is wrong. */
export async function saveSpecFile(host: Host, userDir: string, file: string, text: string): Promise<void> {
  if (!SPEC_FILES.some((f) => f.file === file)) throw new Error(`"${file}" is not a spec file of this app.`);
  const { errors } = validate(file, text);
  if (errors.length) throw new Error(`The file was not saved because it has ${errors.length === 1 ? 'an error' : 'errors'}: ${errors.slice(0, 5).join('; ')}`);
  await host.mkdirp(userDir);
  await host.writeText(joinPath(userDir, file), text.endsWith('\n') ? text : text + '\n');
}

/** Remove the personal copy, so that the file shipped with the app is used again. */
export async function resetSpecFile(host: Host, userDir: string, file: string): Promise<boolean> {
  if (!SPEC_FILES.some((f) => f.file === file)) throw new Error(`"${file}" is not a spec file of this app.`);
  const own = joinPath(userDir, file);
  if (!(await host.exists(own))) return false;
  await host.remove(own);
  return true;
}
