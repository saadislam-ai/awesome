/**
 * Short random identifiers for binder nodes, comments and so on.
 * Uses the Web Crypto API, which exists in the webview and in Node 22.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no easily confused characters

export function shortId(len = 6): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
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
