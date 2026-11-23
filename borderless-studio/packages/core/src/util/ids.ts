/**
 * Short random identifiers for binder nodes, comments and so on.
 * Uses the Web Crypto API, which exists in the webview and in Node 22.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no easily confused characters

let source: (() => number) | null = null;

/**
 * Replace the random source by a repeatable one (a function returning
 * numbers from 0 up to, but not including, 1), or pass null to go back to
 * real randomness. Only the sample book generator and tests use this, so
 * that generating the same book twice gives the same file names.
 */
export function setIdSource(fn: (() => number) | null): void {
  source = fn;
}

export function shortId(len = 6): string {
  const bytes = new Uint8Array(len);
  if (source) for (let i = 0; i < len; i++) bytes[i] = Math.floor(source() * 256);
  else globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function prefixedId(prefix: string, len = 6): string {
  return `${prefix}_${shortId(len)}`;
}

/** RFC 4122 version 4 UUID, used for EPUB identifiers when a format has no ISBN. */
export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
