/**
 * Grammar checking with the real checker (Harper), the way the app uses it:
 * the manuscript is masked, checked as plain text, and the findings are
 * filtered for an author.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Dialect, LocalLinter, type Lint } from 'harper.js';
import { binary } from 'harper.js/binary';
import { grammarDialect, grammarEdit, grammarFindings, grammarRulesOff, prepareGrammarText, type RawLint } from '@borderless/core';

let linter: LocalLinter;
const raw = (lints: Lint[]): RawLint[] =>
  lints.map((l) => ({
    start: l.span().start,
    end: l.span().end,
    kind: l.lint_kind(),
    kindLabel: l.lint_kind_pretty(),
    message: l.message(),
    suggestions: l.suggestions().map((s) => ({ kind: s.kind(), text: s.get_replacement_text() })),
  }));
/** The same steps the app's background worker takes. */
const check = async (source: string, dashPolicy: 'allow' | 'flag' | 'replace' = 'flag') => {
  const config = { ...(await binary.getDefaultLintConfig()) };
  for (const rule of grammarRulesOff('Australian', dashPolicy)) {
    // Every rule the app switches off must be a rule the checker really has.
    expect(rule in config, rule).toBe(true);
    config[rule] = false;
  }
  await linter.setLintConfig(config);
  return grammarFindings(raw(await linter.lint(prepareGrammarText(source), { language: 'plaintext' })), source, { dashPolicy });
};

beforeAll(async () => {
  linter = new LocalLinter({ binary, dialect: Dialect[grammarDialect('en-AU')!] });
  await linter.setup();
});

describe('grammar check', () => {
  it('chooses the dialect from the spelling variety of the book', () => {
    expect(grammarDialect('en-AU')).toBe('Australian');
    expect(grammarDialect('en-GB')).toBe('British');
    expect(grammarDialect('en-US')).toBe('American');
    expect(grammarDialect('bn')).toBeNull();
  });

  it('finds real mistakes at their exact place in the manuscript, past Markdown, notes and non-English letters', async () => {
    const source = '\u201CCafé time,\u201D she *said*.[^n1] Their going to the the market. He could of stayed. An apple fell from a old tree.';
    const found = await check(source);
    const byProblem = Object.fromEntries(found.map((f) => [f.problem, f]));
    expect(Object.keys(byProblem)).toEqual(expect.arrayContaining(['Their', 'the the', 'could of']));
    for (const f of found) expect(source.slice(f.from, f.to)).toBe(f.problem);
    expect(byProblem['could of'].suggestions[0]).toMatchObject({ action: 'replace', text: 'could have' });
    expect(byProblem['could of'].message).not.toContain('`');
    // Applying a suggestion gives the corrected sentence.
    const edit = grammarEdit(byProblem['could of'], byProblem['could of'].suggestions[0]);
    expect(source.slice(0, edit.from) + edit.insert + source.slice(edit.to)).toContain('He could have stayed.');
  });

  it('accepts Australian spelling and leaves spelling to the spellchecker', async () => {
    const found = await check('The colour of the harbour was grey, and she realised the organisation had travelled. Zzyzxq is not a word.');
    expect(found.filter((f) => f.kind === 'Spelling')).toEqual([]);
    expect(found.map((f) => f.problem)).not.toContain('colour');
  });

  it('does not ask an Australian author for the serial comma, or to respell numbers', async () => {
    const found = await check('It was grey, quiet and ordinary. She had 3 sons, 2 daughters and a dog.');
    expect(found.map((f) => f.message).join(' ')).not.toMatch(/Oxford comma/i);
    expect(found).toEqual([]);
    expect(grammarRulesOff('American', 'allow')).not.toContain('OxfordComma');
  });

  it('never proposes a dash to an author who does not use them', async () => {
    const source = 'He waited -- it was late. Pages 3-9 are missing.';
    const strict = await check(source, 'flag');
    expect(strict.flatMap((f) => f.suggestions.map((s) => s.text)).some((t) => /[\u2012-\u2015]/.test(t))).toBe(false);
    const free = await check(source, 'allow');
    expect(free.length).toBeGreaterThanOrEqual(strict.length);
  });

  it('does not check text that is struck out or commented', async () => {
    const found = await check('A fine line. {--Their going to the the market.--} {>>could of been better<<} Another fine line.');
    expect(found).toEqual([]);
  });
});
