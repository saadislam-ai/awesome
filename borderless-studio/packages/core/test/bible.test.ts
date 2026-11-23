import { describe, expect, it } from 'vitest';
import { bibleMentions, bibleSpellingIssues, bibleTimeline, bibleWords, checkConsistency, newBibleEntry, pronunciationGuide, type Bible } from '../src';

const entry = (type: Parameters<typeof newBibleEntry>[0], name: string, patch: Partial<ReturnType<typeof newBibleEntry>> = {}) => ({ ...newBibleEntry(type, name), ...patch });
const bible: Bible = {
  schema: 1,
  entries: [
    entry('character', 'Farid Rahman', { aliases: ['Farid', 'Dr Rahman'], misspellings: ['Fareed', 'Fahrid'], pronunciation: 'fah-REED rah-MAHN' }),
    entry('place', 'Khulna', { pronunciation: 'KOOL-nah' }),
    entry('character', 'রফিক', { aliases: [] }),
    entry('event', 'The flood', { when: 'Day 10' }),
    entry('event', 'The ferry leaves', { when: 'Day 2' }),
    entry('note', 'Themes'),
  ],
};
const docs = [
  { nodeId: 'a', title: 'One', text: 'Farid walked to Khulna. "Dr  Rahman!" she called. Faridpur is another town. {--Farid--} was cut.' },
  { nodeId: 'b', title: 'Two', text: 'Fareed came back to Khulna, and fareed slept. রফিক এলো। Farid Rahman smiled.' },
];

describe('story bible', () => {
  it('gives the spellchecker the names, word by word', () => {
    const words = bibleWords(bible);
    expect(words).toEqual(expect.arrayContaining(['Farid', 'Rahman', 'Khulna', 'Dr', 'রফিক']));
    expect(words).not.toContain('Fareed');
    expect(words).not.toContain('Themes');
  });

  it('counts mentions as whole words, in any script, and ignores deleted text', () => {
    const m = bibleMentions(bible, docs);
    const farid = m.get(bible.entries[0].id)!;
    // One: "Farid", "Dr  Rahman" (two spaces). Not "Faridpur", not the deleted "Farid". Two: "Farid Rahman" counts once.
    expect(farid.docs.map((d) => [d.nodeId, d.count])).toEqual([['a', 2], ['b', 1]]);
    expect(farid.total).toBe(3);
    expect(m.get(bible.entries[1].id)!.total).toBe(2);
    expect(m.get(bible.entries[2].id)!.total).toBe(1);
    expect(m.get(bible.entries[5].id)!.total).toBe(0);
  });

  it('reports the spellings marked as wrong, with their places', () => {
    const issues = bibleSpellingIssues(bible, docs);
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toContain('Farid Rahman');
    expect(issues[0].forms).toEqual([{ form: 'Farid Rahman', count: 3 }, { form: 'Fareed', count: 2 }]);
    expect(issues[0].occurrences.map((o) => o.text)).toEqual(['Fareed', 'fareed']);
    expect(docs[1].text.slice(issues[0].occurrences[0].from, issues[0].occurrences[0].to)).toBe('Fareed');
    // The consistency checker lists them before its own findings.
    const all = checkConsistency(docs, { spelling: 'en-AU' } as never, issues);
    expect(all[0].id).toBe(issues[0].id);
  });

  it('orders the timeline by story time, numbers as numbers', () => {
    expect(bibleTimeline(bible).map((e) => e.name)).toEqual(['The ferry leaves', 'The flood']);
  });

  it('lists how to say the names for a narrator', () => {
    expect(pronunciationGuide(bible).map((p) => `${p.name}: ${p.say}`)).toEqual(['Farid Rahman: fah-REED rah-MAHN', 'Khulna: KOOL-nah']);
  });
});
