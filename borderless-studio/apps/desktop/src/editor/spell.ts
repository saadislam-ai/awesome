/**
 * The spell checker as the rest of the app sees it: load a dictionary for a
 * language, ask which words of a text are not in it, get suggestions, and
 * remember words the author adds.
 *
 * Dictionaries are Hunspell files. English (Australian, British, American)
 * is bundled; any other language works when its two files are placed in the
 * library folder under dictionaries/<language>/index.aff and index.dic.
 */
import { joinPath, maskMarkdown, type Host } from '@borderless/core';

const WORD = /[\p{L}\p{M}]+(?:['\u2019][\p{L}\p{M}]+)*/gu;

/** The distinct words of a Markdown text, markup ignored, apostrophes made plain. */
export function wordsOf(source: string): string[] {
  const set = new Set<string>();
  for (const m of maskMarkdown(source, { hideDeletions: true }).matchAll(WORD)) set.add(m[0].replace(/\u2019/g, "'"));
  return [...set];
}

export interface SpellStatus {
  language: string;
  ready: boolean;
  /** Why checking is not available, in plain words. */
  problem?: string;
}

class SpellService {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (data: Record<string, unknown>) => void>();
  /** Words already judged: true means correct. */
  private known = new Map<string, boolean>();
  status: SpellStatus = { language: '', ready: false };
  private key = '';

  private call(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ ...message, id });
    });
  }

  /**
   * Load the dictionary for a language. `personal` are words to accept as
   * well (the author's own dictionary, names from the story bible).
   */
  async load(host: Host, resourcesDir: string, libraryDir: string | null, language: string, personal: string[]): Promise<SpellStatus> {
    const key = `${language}|${libraryDir}|${personal.length}`;
    if (key === this.key && this.status.ready) return this.status;
    this.key = key;
    this.known.clear();
    const candidates = [
      ...(libraryDir ? [joinPath(libraryDir, 'dictionaries', language)] : []),
      joinPath(resourcesDir, 'dictionaries', language),
    ];
    let dir: string | null = null;
    for (const c of candidates) {
      if ((await host.exists(joinPath(c, 'index.aff'))) && (await host.exists(joinPath(c, 'index.dic')))) { dir = c; break; }
    }
    if (!dir) {
      this.status = {
        language, ready: false,
        problem: `No spelling dictionary for "${language}" was found. Put a Hunspell dictionary (index.aff and index.dic) in the folder dictionaries/${language} inside your library folder.`,
      };
      return this.status;
    }
    try {
      const [aff, dic] = await Promise.all([host.readText(joinPath(dir, 'index.aff')), host.readText(joinPath(dir, 'index.dic'))]);
      this.worker?.terminate();
      this.worker = new Worker(new URL('./spellWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data as Record<string, unknown>;
        const done = this.waiting.get(data.id as number);
        if (done) {
          this.waiting.delete(data.id as number);
          done(data);
        }
      };
      const res = await this.call({ type: 'load', aff, dic, personal });
      this.status = res.error ? { language, ready: false, problem: `The dictionary could not be loaded: ${String(res.error)}` } : { language, ready: true };
    } catch (e) {
      this.status = { language, ready: false, problem: `The dictionary could not be loaded: ${e instanceof Error ? e.message : String(e)}` };
    }
    return this.status;
  }

  /** The words of the list that are not in the dictionary. */
  async check(words: string[]): Promise<string[]> {
    if (!this.status.ready || !this.worker) return [];
    const fresh = words.filter((w) => !this.known.has(w));
    if (fresh.length) {
      const res = await this.call({ type: 'check', words: fresh });
      const wrong = new Set((res.wrong as string[] | undefined) ?? []);
      for (const w of fresh) this.known.set(w, !wrong.has(w));
    }
    return words.filter((w) => this.known.get(w) === false);
  }

  async suggest(word: string): Promise<string[]> {
    if (!this.status.ready || !this.worker) return [];
    const res = await this.call({ type: 'suggest', word });
    return (res.list as string[] | undefined) ?? [];
  }

  /** Accept a word from now on. */
  async add(word: string): Promise<void> {
    this.known.set(word, true);
    if (this.status.ready && this.worker) await this.call({ type: 'add', word });
  }
}

export const spellService = new SpellService();

/** The author's own word lists: one for the whole library and one for the book. One word on each line. */
export async function readPersonalWords(host: Host, files: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (const f of files) {
    if (!(await host.exists(f))) continue;
    for (const line of (await host.readText(f)).split(/\r?\n/)) {
      const w = line.trim();
      if (w && !w.startsWith('#')) out.add(w);
    }
  }
  return [...out];
}

export async function addPersonalWord(host: Host, file: string, word: string): Promise<void> {
  const existing = (await host.exists(file)) ? await host.readText(file) : '# Words the spell checker accepts for this book. One word on each line.\n';
  if (existing.split(/\r?\n/).includes(word)) return;
  await host.mkdirp(file.slice(0, file.lastIndexOf('/')));
  await host.writeText(file, `${existing.replace(/\n*$/, '\n')}${word}\n`);
}
