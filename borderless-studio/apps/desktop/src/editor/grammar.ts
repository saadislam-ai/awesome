/**
 * The app's side of the grammar check: one background worker, started the
 * first time a check is asked for.
 */
import { grammarDialect, grammarFindings, grammarRulesOff, prepareGrammarText, type DashPolicy, type GrammarFinding, type RawLint } from '@borderless/core';

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (lints: RawLint[]) => void; reject: (e: Error) => void }>();

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./grammarWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data as { id: number; lints?: RawLint[]; error?: string };
    const pending = waiting.get(data.id);
    if (!pending) return;
    waiting.delete(data.id);
    if (data.error) pending.reject(new Error(data.error));
    else pending.resolve(data.lints ?? []);
  };
  worker.onerror = (e) => {
    // The checker could not start at all: every waiting check is told, and the next check tries afresh.
    for (const pending of waiting.values()) pending.reject(new Error(e.message || 'The grammar checker could not be started.'));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export type GrammarResult = { ok: true; findings: GrammarFinding[] } | { ok: false; reason: string };

/** Check one document. The spelling variety of the book decides the dialect; books that are not in English are not checked. */
export async function checkGrammar(source: string, spelling: string, dashPolicy: DashPolicy['mode']): Promise<GrammarResult> {
  const dialect = grammarDialect(spelling);
  if (!dialect) return { ok: false, reason: 'The grammar check knows English only, so it is not available for this book.' };
  const id = nextId++;
  try {
    const lints = await new Promise<RawLint[]>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      start().postMessage({ id, text: prepareGrammarText(source), dialect, off: grammarRulesOff(dialect, dashPolicy) });
    });
    return { ok: true, findings: grammarFindings(lints, source, { dashPolicy }) };
  } catch (e) {
    return { ok: false, reason: `The grammar check did not run: ${e instanceof Error ? e.message : String(e)}` };
  }
}
