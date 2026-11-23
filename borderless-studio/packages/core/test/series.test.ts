import { describe, expect, it } from 'vitest';
import { alsoByFromLibrary, groupSeries, mergeSeriesBible, newBibleEntry, type Bible, type BookSummary } from '../src';

const book = (title: string, seriesName = '', seriesNumber: number | null = null, author = 'Dr Saad Islam', extra: Partial<BookSummary> = {}): BookSummary => ({
  path: `/lib/${title}`, id: `bk_${title.replace(/\W/g, '')}`, title, subtitle: '', author, genre: 'novel', language: 'en-AU',
  series: seriesName ? `${seriesName} ${seriesNumber ?? ''}`.trim() : '', seriesName, seriesNumber, formats: [], words: 0, updatedAt: '2026-01-01', ...extra,
});

const library = [
  book('Salt Road', 'The Delta Books', 1),
  book('Harbour Lights', 'The Delta Books', 3),
  book('Low Tide', 'the delta books', 2),
  book('A Short Guide to Ferries'),
  book('Zinc', 'Metals', 1),
  book('Someone Else', 'The Delta Books', 9, 'Another Writer'),
  book('Broken', 'The Delta Books', 4, 'Dr Saad Islam', { problem: 'The folder was not found.' }),
];

describe('series', () => {
  it('groups books by series name, whatever the capitals, in reading order', () => {
    const groups = groupSeries(library);
    expect(groups.map((g) => g.name)).toEqual(['Metals', 'The Delta Books']);
    const delta = groups[1];
    expect(delta.books.map((b) => b.title)).toEqual(['Salt Road', 'Low Tide', 'Harbour Lights', 'Someone Else']);
    expect(delta.problems.join(' ')).toMatch(/written in 2 ways/);
    expect(delta.problems.join(' ')).toMatch(/no book 4 in this library \(the numbers jump from 3 to 9\)/);
  });

  it('points out missing and double numbers', () => {
    const [g] = groupSeries([book('A', 'S', 1), book('B', 'S', 1), book('C', 'S')]);
    expect(g.problems).toEqual(['"C" has no number in the series.', '"A" and "B" are both number 1.']);
    expect(g.books.map((b) => b.title)).toEqual(['A', 'B', 'C']);
    expect(groupSeries([book('A', 'S', 1), book('B', 'S', 2)])[0].problems).toEqual([]);
  });

  it('fills the "Also by" page: the series first, then other series, then single books, never other authors', () => {
    const me = { id: 'bk_LowTide', series: { id: '', name: 'The Delta Books', number: 2 }, author: 'Dr Saad Islam' };
    expect(alsoByFromLibrary(me, library)).toEqual([
      { label: 'The Delta Books', titles: ['Salt Road', 'Harbour Lights'] },
      { label: 'Metals', titles: ['Zinc'] },
      { label: '', titles: ['A Short Guide to Ferries'] },
    ]);
    const single = { id: 'bk_AShortGuidetoFerries', series: null, author: 'Dr Saad Islam' };
    expect(alsoByFromLibrary(single, library).map((g) => g.label)).toEqual(['Metals', 'The Delta Books']);
    expect(alsoByFromLibrary({ id: 'x', series: null, author: 'Nobody' }, library)).toEqual([]);
  });

  it('shares story bible entries between books of a series without overwriting anything', () => {
    const target: Bible = { schema: 1, entries: [{ ...newBibleEntry('character', 'Farid'), summary: 'My own note' }] };
    const source: Bible = { schema: 1, entries: [{ ...newBibleEntry('character', 'farid'), summary: 'Their note' }, { ...newBibleEntry('place', 'Khulna'), pronunciation: 'KOOL-nah' }, newBibleEntry('note', '')] };
    expect(mergeSeriesBible(target, source)).toBe(1);
    expect(target.entries.map((e) => `${e.name}:${e.summary}:${e.shared}`)).toEqual(['Farid:My own note:false', 'Khulna::true']);
    expect(target.entries[1].pronunciation).toBe('KOOL-nah');
    expect(target.entries[1].id).not.toBe(source.entries[1].id);
    expect(mergeSeriesBible(target, source)).toBe(0);
  });
});
