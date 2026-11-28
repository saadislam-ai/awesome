import type { FileStore } from './types';

/** Keeps files in memory. Used by tests and by the in-browser preview. */
export class MemoryFiles implements FileStore {
  readonly entries = new Map<string, Uint8Array>();

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.entries.set(path, bytes.slice());
  }

  async read(path: string): Promise<Uint8Array> {
    const found = this.entries.get(path);
    if (!found) throw new Error(`Could not read file: ${path}`);
    return found.slice();
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(path);
  }

  async remove(path: string): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      if (key === path || key.startsWith(path.replace(/\/$/, '') + '/')) this.entries.delete(key);
    }
  }
}
