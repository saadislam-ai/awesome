/**
 * Spell checking in a background worker, so that loading a dictionary
 * (about a second) and checking a long chapter never make typing stutter.
 * Uses nspell, a JavaScript reader of Hunspell dictionaries.
 */
import nspell from 'nspell';

let spell: ReturnType<typeof nspell> | null = null;

function correct(word: string): boolean {
  if (!spell) return true;
  if (word.length < 2 || /\d/.test(word)) return true;
  // Short words in capitals are treated as abbreviations (KDP, ISBN).
  if (word.length <= 5 && word === word.toUpperCase()) return true;
  const base = word.replace(/'s$/i, '').replace(/s'$/i, 's');
  if (spell.correct(base)) return true;
  // A capitalised word at the start of a sentence: the lower case form counts too.
  const lower = base.charAt(0).toLowerCase() + base.slice(1);
  return lower !== base && spell.correct(lower);
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string; id: number; aff?: string; dic?: string; personal?: string[]; words?: string[]; word?: string };
  try {
    if (m.type === 'load') {
      spell = nspell(m.aff ?? '', m.dic ?? '');
      for (const w of m.personal ?? []) spell.add(w);
      postMessage({ id: m.id, ok: true });
    } else if (m.type === 'check') {
      postMessage({ id: m.id, wrong: (m.words ?? []).filter((w) => !correct(w)) });
    } else if (m.type === 'suggest') {
      postMessage({ id: m.id, list: spell ? spell.suggest(m.word ?? '').slice(0, 7) : [] });
    } else if (m.type === 'add') {
      spell?.add(m.word ?? '');
      postMessage({ id: m.id, ok: true });
    }
  } catch (err) {
    postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
