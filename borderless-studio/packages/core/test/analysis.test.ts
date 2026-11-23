/** Style analysis and the manuscript consistency checker. */
import { describe, expect, it } from 'vitest';
import { TextStyleSchema, analyseStyle, checkConsistency, editDistanceOne, nameKey } from '../src/index';

describe('style analysis', () => {
  const text = [
    'She walked quickly to the ferry. The ferry was painted by her father, years ago.',
    '',
    'It was really very cold, and at the end of the day nobody came. "Is anyone there?" she asked. "Nobody," said the ferryman.',
    '',
    'The road ran on past the customs house and the salt pans and the school and the market and the mosque and the long sheds where the fishermen mended their nets in the evenings while the tide went out and the gulls came down to the mud and the children ran along the bank calling to one another until the light failed.',
  ].join('\n');
  const r = analyseStyle(text);

  it('counts words, sentences and paragraphs', () => {
    expect(r.paragraphs).toBe(3);
    expect(r.sentences).toBe(7);
    expect(r.words).toBeGreaterThan(90);
    expect(r.averageSentenceWords).toBeGreaterThan(10);
    expect(r.readingEase).toBeGreaterThan(40);
    expect(r.dialogueShare).toBeGreaterThan(0);
  });

  it('points at adverbs, passive voice, filler words, worn phrases and long sentences', () => {
    const kinds = (k: string) => r.findings.filter((f) => f.kind === k);
    expect(kinds('adverb').map((f) => f.text)).toContain('quickly');
    expect(kinds('passive')[0].text).toBe('was painted');
    expect(kinds('filler').map((f) => f.text.toLowerCase())).toEqual(expect.arrayContaining(['really', 'very']));
    expect(kinds('cliche')[0].text).toBe('at the end of the day');
    expect(kinds('long-sentence')).toHaveLength(1);
    expect(r.counts.longSentences).toBe(1);
  });

  it('gives offsets that match the source text', () => {
    for (const f of r.findings.filter((x) => x.kind !== 'long-sentence')) expect(text.slice(f.from, f.to)).toBe(f.text);
  });

  it('notices a word repeated close by, but not everyday words', () => {
    const rep = analyseStyle('The lantern swung. He lifted the lantern and the light of the lantern fell on the water.');
    expect(rep.findings.filter((f) => f.kind === 'repeat').map((f) => f.text)).toEqual(['lantern', 'lantern']);
    expect(rep.findings.some((f) => f.kind === 'repeat' && f.text === 'the')).toBe(false);
  });

  it('ignores markup, deleted text and comments', () => {
    const marked = analyseStyle('She left {--really quickly--} {>>too slowly?<<} at dawn.');
    expect(marked.findings.filter((f) => f.kind === 'adverb')).toEqual([]);
    expect(marked.words).toBe(4);
  });

  it('skips English only checks for other languages', () => {
    const bn = analyseStyle('আমার সোনার বাংলা।', { language: 'bn' });
    expect(bn.readingEase).toBeNull();
    expect(bn.words).toBe(3);
    expect(bn.counts.adverbs).toBe(0);
  });
});

describe('consistency checker', () => {
  const style = TextStyleSchema.parse({ spelling: 'en-AU' });
  const docs = [
    { nodeId: 'a', title: 'One', text: 'Farid walked towards the river. The colour of the water was grey. He sent an e-mail to Dr Rahman, and Farid waited. Farid organised the ledgers. Farid said nothing more, and Farid slept. Later, when Farid woke, the boat had gone, and Farid laughed.' },
    { nodeId: 'b', title: 'Two', text: 'He turned toward the road. The color had changed. An email came from Dr. Rahman, and Fareed read it. They organized the 3 boxes and counted 250 sacks. He walked towards home.' },
  ];
  const issues = checkConsistency(docs, style);
  const get = (id: string) => issues.find((i) => i.id === id);

  it('finds mixed forms of the same word and names the rarer one', () => {
    const t = get('variant-towards')!;
    expect(t.forms).toEqual([{ form: 'towards', count: 2 }, { form: 'toward', count: 1 }]);
    expect(t.occurrences).toHaveLength(1);
    expect(t.occurrences[0].nodeId).toBe('b');
    expect(docs[1].text.slice(t.occurrences[0].from, t.occurrences[0].to)).toBe('toward');
  });

  it('finds American spellings in an Australian book', () => {
    const c = get('spelling-colour')!;
    expect(c.detail).toMatch(/Australian spelling, so "colour"/);
    expect(c.occurrences.map((o) => o.text)).toEqual(['color']);
    expect(get('spelling-organised')!.occurrences[0].text).toBe('organized');
    // ...and the other way round for an American book
    const us = checkConsistency(docs, TextStyleSchema.parse({ spelling: 'en-US' }));
    expect(us.find((i) => i.id === 'spelling-colour')!.occurrences.map((o) => o.text)).toEqual(['colour']);
  });

  it('finds hyphen variants and titles with and without a full stop', () => {
    expect(get('hyphen-e-mail')!.forms.map((f) => f.form)).toEqual(['e-mail', 'email']);
    const dr = get('title-Dr')!;
    expect(dr.forms).toEqual([{ form: 'Dr', count: 1 }, { form: 'Dr.', count: 1 }]);
  });

  it('finds small numbers as digits but leaves large ones alone', () => {
    const n = get('numbers')!;
    expect(n.occurrences.map((o) => o.text)).toEqual(['3']);
  });

  it('suspects a name that differs by one letter from a common one', () => {
    const name = get('name-Farid-Fareed')!;
    expect(name.detail).toMatch(/"Fareed" appears only once/);
    expect(name.occurrences[0].nodeId).toBe('b');
  });

  it('does not treat ordinary words as spelling variants', () => {
    const clean = checkConsistency([{ nodeId: 'a', title: 'x', text: 'There were four stores before the fire. Here the future is sure, and the figure of the hour is where we were. The pure nature of the picture, and more of the same. The seller called the caller. ' }], style);
    expect(clean.filter((i) => i.id.startsWith('spelling-'))).toEqual([]);
  });

  it('knows when two words are one edit apart', () => {
    expect(editDistanceOne('Farid', 'Fareed')).toBe(false); // two edits, but the same name by sound
    expect(nameKey('Farid')).toBe(nameKey('Fareed'));
    expect(nameKey('Noor')).toBe(nameKey('Nur'));
    expect(editDistanceOne('Farid', 'Farod')).toBe(true);
    expect(editDistanceOne('Amina', 'Aminah')).toBe(true);
    expect(editDistanceOne('Noor', 'Noor')).toBe(false);
  });
});
