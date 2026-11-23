/**
 * Path helpers. The core always works with forward slash paths, on every
 * operating system. Windows accepts forward slashes, and Typst 0.15 rejects
 * backslashes in paths, so normalising once here removes a whole class of bugs.
 */

/** Convert backslashes to forward slashes and collapse duplicate separators. */
export function normPath(p: string): string {
  let out = p.replace(/\\/g, '/');
  // Keep a leading double slash (UNC path) but collapse every other run.
  const unc = out.startsWith('//');
  out = out.replace(/\/{2,}/g, '/');
  if (unc) out = '/' + out;
  // Resolve "." and ".." segments without touching the file system.
  const isAbs = out.startsWith('/');
  const drive = /^[A-Za-z]:/.test(out) ? out.slice(0, 2) : '';
  const rest = drive ? out.slice(2) : out;
  const parts: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!isAbs && !drive) parts.push('..');
      continue;
    }
    parts.push(seg);
  }
  const lead = drive ? drive + (rest.startsWith('/') ? '/' : '') : isAbs ? (unc ? '//' : '/') : '';
  return lead + parts.join('/') || (lead ? lead : '.');
}

export function joinPath(...parts: string[]): string {
  return normPath(parts.filter((p) => p !== '').join('/'));
}

export function dirname(p: string): string {
  const n = normPath(p);
  const i = n.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const n = normPath(p);
  let b = n.slice(n.lastIndexOf('/') + 1);
  if (ext && b.toLowerCase().endsWith(ext.toLowerCase())) b = b.slice(0, -ext.length);
  return b;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i).toLowerCase();
}

/** Path of `to` relative to directory `from`. Both must be absolute or both relative. */
export function relativePath(from: string, to: string): string {
  const a = normPath(from).split('/').filter(Boolean);
  const b = normPath(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}

/** True when `child` is inside `parent` (or equal to it). */
export function isInside(parent: string, child: string): boolean {
  const p = normPath(parent).replace(/\/$/, '');
  const c = normPath(child);
  return c === p || c.startsWith(p + '/');
}

/**
 * Turn any title into a short, safe file name stem that works on macOS,
 * Windows and Linux (no reserved characters, no trailing dots or spaces).
 * Non Latin scripts such as Bangla are kept as they are.
 */
export function slugify(input: string, maxLen = 48): string {
  let s = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['‘’“”"]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[\s._,;!()[\]{}+=&%$#@^~`]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/-+$/, '');
  // Windows reserved device names.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = s + '-file';
  return s || 'untitled';
}
