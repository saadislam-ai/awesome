/**
 * Running EPUBCheck (the official W3C validator, a Java program) and turning
 * its report into plain English messages that point back into the manuscript.
 */
import type { Host } from '../host';
import { dirname, joinPath } from '../util/paths';
import type { EpubFileMapEntry } from './build';

export interface EpubIssue {
  /** EPUBCheck message id, for example RSC-005. */
  id: string;
  severity: 'fatal' | 'error' | 'warning' | 'usage' | 'info';
  /** EPUBCheck's own wording. */
  message: string;
  /** What it means and what to do, in plain English. */
  explanation: string;
  /** File inside the EPUB and line. */
  path?: string;
  line?: number;
  /** The document in the manuscript this traces back to, when known. */
  nodeId?: string;
  nodeTitle?: string;
  srcLine?: number;
}

export interface EpubCheckResult {
  /** False when EPUBCheck could not be run at all (for example no Java). */
  ran: boolean;
  /** True when EPUBCheck reported no errors and no fatal errors. */
  passed: boolean;
  errors: number;
  warnings: number;
  issues: EpubIssue[];
  /** EPUBCheck version string. */
  checker: string;
  /** Explanation when it could not run. */
  problem?: string;
}

/** Plain English for the messages authors are most likely to meet. */
const EXPLANATIONS: Record<string, string> = {
  'RSC-001': 'A file listed in the ebook package is missing from the EPUB.',
  'RSC-005': 'The page markup breaks an EPUB rule (often an attribute or tag used in a place where it is not allowed).',
  'RSC-006': 'The ebook refers to a file outside itself. Every picture and font must be inside the EPUB.',
  'RSC-007': 'A link or picture points to a file that is not in the ebook. Check the picture path or the link target.',
  'RSC-008': 'A file is used but not listed in the package manifest.',
  'RSC-011': 'A link points to a page that is not part of the reading order.',
  'RSC-012': 'A link points to a place (an anchor) that does not exist. A heading or note it referred to was probably removed.',
  'RSC-016': 'The file is not well formed XML. A tag is probably not closed.',
  'RSC-017': 'EPUBCheck noticed markup that works but is discouraged.',
  'RSC-020': 'A web address is not written correctly. Check for spaces or missing "https://".',
  'RSC-032': 'A picture is in a format that needs a fallback. Use JPEG or PNG.',
  'OPF-003': 'A file is in the EPUB but not declared in the package document.',
  'OPF-014': 'A page uses a feature (such as scripting or SVG) that must be declared in the package document.',
  'OPF-027': 'A metadata property is not recognised.',
  'OPF-030': 'The unique identifier of the book is missing.',
  'OPF-031': 'A reference in the guide points to a missing file.',
  'OPF-054': 'The modification date is not in the required format.',
  'OPF-085': 'The book identifier looks like a UUID but is not a valid one.',
  'OPF-096': 'A page is not reachable: it is marked as not part of the main reading order and nothing links to it.',
  'NAV-001': 'The navigation document (table of contents) is not valid.',
  'NAV-010': 'The table of contents does not match the order of the book.',
  'NAV-011': 'The table of contents lists entries in a different order from the reading order.',
  'HTM-003': 'An external entity is declared; this is not allowed in ebooks.',
  'HTM-004': 'The document type declaration is wrong for EPUB 3.',
  'HTM-009': 'The document type declaration is obsolete.',
  'HTM-025': 'A link uses a scheme that is not registered. Use https:// or mailto: links.',
  'CSS-001': 'The stylesheet uses a property that EPUB does not allow.',
  'CSS-007': 'A font file referenced by the stylesheet is missing or of an unsupported type.',
  'CSS-008': 'The stylesheet has a syntax error.',
  'CSS-028': 'A font is loaded from the internet. Fonts must be inside the EPUB.',
  'PKG-003': 'The EPUB container could not be read.',
  'PKG-005': 'The mimetype file has extra data. It must contain only "application/epub+zip".',
  'PKG-006': 'The mimetype file is missing or is not the first file in the EPUB.',
  'PKG-007': 'The mimetype file contains the wrong text.',
  'PKG-009': 'A file name contains characters that are not allowed in EPUBs.',
  'PKG-010': 'A file name contains spaces. Rename the picture without spaces.',
  'PKG-012': 'A file name contains characters outside plain ASCII. Rename the picture using plain letters and digits.',
  'MED-001': 'A video poster image is in an unsupported format.',
  'MED-003': 'A picture is in a format that is not a core EPUB type. Use JPEG, PNG, GIF or SVG.',
  'MED-004': 'A picture file is damaged and could not be read.',
  'ACC-009': 'A mathematical formula has no text alternative.',
};

function explain(id: string, message: string): string {
  const known = EXPLANATIONS[id];
  if (known) return known;
  const group = id.split('-')[0];
  const area: Record<string, string> = {
    RSC: 'a file inside the ebook', OPF: 'the package (metadata and file list)', NAV: 'the table of contents',
    HTM: 'the page markup', CSS: 'the stylesheet', PKG: 'the EPUB container', MED: 'a picture or media file', ACC: 'accessibility', NCX: 'the legacy table of contents',
  };
  return `EPUBCheck found a problem with ${area[group] ?? 'the ebook'}: ${message}`;
}

interface RawMessage {
  ID: string;
  severity: string;
  message: string;
  locations?: { path?: string; line?: number; column?: number }[];
}

/** Find the manuscript location for a line in an XHTML file of the EPUB. */
export function traceLocation(
  map: EpubFileMapEntry[],
  path: string | undefined,
  line: number | undefined,
): { nodeId?: string; nodeTitle?: string; srcLine?: number } {
  if (!path) return {};
  const entry = map.find((m) => m.path === path || path.endsWith(m.path) || m.path.endsWith(path));
  if (!entry) return {};
  if (line === undefined || line < 0 || entry.lines.length === 0) {
    const first = entry.lines[0];
    return first ? { nodeId: first.nodeId, nodeTitle: first.nodeTitle } : {};
  }
  // The closest mapped line at or before the reported one.
  let best = entry.lines[0];
  for (const l of entry.lines) if (l.line <= line) best = l;
  return { nodeId: best.nodeId, nodeTitle: best.nodeTitle, srcLine: best.line === line ? best.srcLine : (best.srcLine ?? undefined) };
}

export function parseEpubCheckJson(json: string, map: EpubFileMapEntry[]): EpubCheckResult {
  const data = JSON.parse(json) as {
    checker?: { checkerVersion?: string; nFatal?: number; nError?: number; nWarning?: number };
    messages?: RawMessage[];
  };
  const issues: EpubIssue[] = [];
  for (const m of data.messages ?? []) {
    const sev = m.severity.toLowerCase();
    const severity: EpubIssue['severity'] =
      sev === 'fatal' ? 'fatal' : sev === 'error' ? 'error' : sev === 'warning' ? 'warning' : sev === 'usage' ? 'usage' : 'info';
    const locs = m.locations && m.locations.length ? m.locations : [{}];
    for (const loc of locs.slice(0, 20)) {
      const line = typeof loc.line === 'number' && loc.line >= 0 ? loc.line : undefined;
      issues.push({
        id: m.ID,
        severity,
        message: m.message,
        explanation: explain(m.ID, m.message),
        path: loc.path,
        line,
        ...traceLocation(map, loc.path, line),
      });
    }
  }
  const errors = (data.checker?.nError ?? 0) + (data.checker?.nFatal ?? 0);
  return {
    ran: true,
    passed: errors === 0,
    errors,
    warnings: data.checker?.nWarning ?? 0,
    issues: issues.filter((i) => i.severity !== 'usage' && i.severity !== 'info'),
    checker: `EPUBCheck ${data.checker?.checkerVersion ?? ''}`.trim(),
  };
}

/** Validate an EPUB file on disk. Never throws: a missing Java runtime is reported in the result. */
export async function runEpubCheck(host: Host, epubPath: string, map: EpubFileMapEntry[] = []): Promise<EpubCheckResult> {
  const info = await host.toolInfo('epubcheck');
  if (!info.found) {
    return {
      ran: false, passed: false, errors: 0, warnings: 0, issues: [], checker: '',
      problem: info.hint ?? 'EPUBCheck needs Java, which was not found on this computer. Install a Java runtime (for example Eclipse Temurin) or set its location in Settings, Tools.',
    };
  }
  const report = joinPath(dirname(epubPath), '.epubcheck-report.json');
  if (await host.exists(report)) await host.remove(report);
  const res = await host.runTool('epubcheck', [epubPath, '--json', report], { timeoutMs: 180_000 });
  if (!(await host.exists(report))) {
    return {
      ran: false, passed: false, errors: 0, warnings: 0, issues: [], checker: '',
      problem: `EPUBCheck did not produce a report. ${res.stderr.split('\n').filter((l) => l.trim() && !/^Picked up/.test(l)).slice(0, 3).join(' ')}`.trim(),
    };
  }
  try {
    const result = parseEpubCheckJson(await host.readText(report), map);
    await host.remove(report);
    return result;
  } catch (e) {
    return { ran: false, passed: false, errors: 0, warnings: 0, issues: [], checker: '', problem: `The EPUBCheck report could not be read: ${(e as Error).message}` };
  }
}
