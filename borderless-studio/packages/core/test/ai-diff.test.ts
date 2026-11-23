import { describe, expect, it } from 'vitest';
import { applyAllChanges, diffTokens, suggestionMarkup, tokenise } from '../src';

const accept = (markup: string) => applyAllChanges(markup, true);
const reject = (markup: string) => applyAllChanges(markup, false);

describe('word differences', () => {
  it('splits text into words, spaces, punctuation and footnote references, in any script', () => {
    expect(tokenise("Don't stop[^n3], she said.")).toEqual(["Don't", ' ', 'stop', '[^n3]', ',', ' ', 'she', ' ', 'said', '.']);
    expect(tokenise('রফিক এলো।')).toEqual(['রফিক', ' ', 'এলো', '।']);
  });

  it('finds the shortest set of changes', () => {
    const d = diffTokens(tokenise('the quick brown fox'), tokenise('the slow brown fox jumps'));
    expect(d.filter((p) => p.op !== 'eq')).toEqual([{ op: 'del', text: 'quick' }, { op: 'ins', text: 'slow' }, { op: 'ins', text: ' ' }, { op: 'ins', text: 'jumps' }]);
    expect(d.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe('the quick brown fox');
    expect(d.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe('the slow brown fox jumps');
  });

  it('gives up gracefully on texts that have nothing in common', () => {
    const a = Array.from({ length: 300 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 300 }, (_, i) => `b${i}`);
    const d = diffTokens(a, b, 50);
    expect(d.filter((p) => p.op === 'del')).toHaveLength(300);
    expect(d.filter((p) => p.op === 'ins')).toHaveLength(300);
  });
});

describe('proposals as tracked changes', () => {
  it('marks replacements, insertions and deletions, each signed by the assistant', () => {
    const res = suggestionMarkup('Thiss sentense has a wrng word, realy.', 'This sentence has a wrong word, really.');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.markup).toBe('{~~Thiss sentense~>This sentence~~}{>>@ai<<} has a {~~wrng~>wrong~~}{>>@ai<<} word, {~~realy~>really~~}{>>@ai<<}.');
    expect(res.changes).toBe(3);
    expect(accept(res.markup)).toBe('This sentence has a wrong word, really.');
    expect(reject(res.markup)).toBe('Thiss sentense has a wrng word, realy.');
  });

  it('keeps paragraph breaks, outer white space and untouched paragraphs exactly', () => {
    const original = '\n\nIt was very, very late.\n\n\nNobody had come.  Nobody would.\n';
    const res = suggestionMarkup(original, 'It was late.\n\nNobody had come. Nobody would.');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.markup).toBe('\n\nIt was {--very, very --}{>>@ai<<}late.\n\n\nNobody had come.  Nobody would.\n');
    expect(res.changes).toBe(1);
    expect(reject(res.markup)).toBe(original);
  });

  it('reports no changes when the proposal is the same text', () => {
    const res = suggestionMarkup('All good here.\n\nAnd here.', 'All good here.\n\nAnd here.');
    expect(res).toEqual({ ok: true, markup: 'All good here.\n\nAnd here.', changes: 0 });
  });

  it('keeps Markdown markers and footnote references in place', () => {
    const res = suggestionMarkup('He said *enough*[^n4] and and left.', 'He said *enough*[^n4] and left.');
    expect(res.ok && accept(res.markup)).toBe('He said *enough*[^n4] and left.');
    expect(res.ok && res.changes).toBe(1);
  });

  it('refuses when paragraphs do not line up, when changes are pending, or when the text would break the markup', () => {
    expect(suggestionMarkup('One.\n\nTwo.', 'One. Two.')).toMatchObject({ ok: false, reason: 'paragraphs' });
    expect(suggestionMarkup('One {++new++} two.', 'One new two.')).toMatchObject({ ok: false, reason: 'pending-changes' });
    expect(suggestionMarkup('A plain line.', 'A line with ~> inside.')).toMatchObject({ ok: false, reason: 'markup' });
    // A highlight is not a pending change.
    expect(suggestionMarkup('A {==fine==} line.', 'A {==fine==} line indeed.').ok).toBe(true);
  });
});
