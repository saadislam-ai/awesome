/**
 * Grammar checking in a background worker. The checker is Harper: a
 * program compiled to WebAssembly that runs inside the app and talks to
 * nothing. Starting it takes about a second; checking a chapter takes a
 * fraction of one.
 */
import { Dialect, LocalLinter } from 'harper.js';
import { binary } from 'harper.js/binary';

let linter: LocalLinter | null = null;
let loaded = '';
let rulesOff = '';

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { id: number; text: string; dialect: keyof typeof Dialect; off: string[] };
  try {
    if (!linter || loaded !== m.dialect) {
      linter = new LocalLinter({ binary, dialect: Dialect[m.dialect] });
      await linter.setup();
      loaded = m.dialect;
      rulesOff = '';
    }
    // Rules that do not fit this book are switched off by name (see grammarRulesOff in the engine).
    const off = m.off.join(',');
    if (off !== rulesOff) {
      const config = { ...(await binary.getDefaultLintConfig()) };
      for (const rule of m.off) config[rule] = false;
      await linter.setLintConfig(config);
      rulesOff = off;
    }
    // The text arrives already cleared of Markdown and comments, so it is checked as plain text
    // and every position is a position in the manuscript.
    const lints = await linter.lint(m.text, { language: 'plaintext' });
    postMessage({
      id: m.id,
      lints: lints.map((l) => ({
        start: l.span().start,
        end: l.span().end,
        kind: l.lint_kind(),
        kindLabel: l.lint_kind_pretty(),
        message: l.message(),
        suggestions: l.suggestions().map((s) => ({ kind: s.kind(), text: s.get_replacement_text() })),
      })),
    });
  } catch (err) {
    postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
