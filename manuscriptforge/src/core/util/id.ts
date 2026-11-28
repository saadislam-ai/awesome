const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A random, URL-safe identifier. Works in every webview and in Node. */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return prefix ? `${prefix}_${out}` : out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Makes a file name safe to store on Windows and macOS. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (cleaned || 'manuscript').slice(0, 120);
}
