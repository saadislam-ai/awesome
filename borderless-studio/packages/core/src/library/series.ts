/**
 * Series: books that belong together, in reading order. A series is not a
 * file of its own; it is simply the books whose details name the same
 * series. This file finds them, points out numbering slips, renumbers and
 * renames across books, and fills the "Also by" page from the library.
 */
import type { AlsoByGroup } from '../build/assemble';
import { newBibleEntry } from '../bible/index';
import type { Bible, Book } from '../model/book';
import type { Project } from '../project/store';
import type { BookSummary } from './library';

export interface SeriesInfo {
  name: string;
  /** The books of the series in reading order (books without a number come last). */
  books: BookSummary[];
  /** Things that look wrong, in plain words. */
  problems: string[];
}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const byNumber = (a: BookSummary, b: BookSummary): number => (a.seriesNumber ?? 1e9) - (b.seriesNumber ?? 1e9) || a.title.localeCompare(b.title);

/** Every series in the library, with its books in order. */
export function groupSeries(books: BookSummary[]): SeriesInfo[] {
  const groups = new Map<string, SeriesInfo>();
  for (const book of books) {
    const name = (book.seriesName ?? '').trim();
    if (!name || book.problem) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, books: [], problems: [] });
    groups.get(key)!.books.push(book);
  }
  for (const group of groups.values()) {
    group.books.sort(byNumber);
    const numbers = group.books.map((b) => b.seriesNumber);
    const unnumbered = group.books.filter((b) => b.seriesNumber === null);
    if (unnumbered.length) group.problems.push(`${unnumbered.map((b) => `"${b.title}"`).join(' and ')} ${unnumbered.length === 1 ? 'has' : 'have'} no number in the series.`);
    const seen = new Map<number, string>();
    for (const b of group.books) {
      if (b.seriesNumber === null) continue;
      if (seen.has(b.seriesNumber)) group.problems.push(`"${seen.get(b.seriesNumber)}" and "${b.title}" are both number ${b.seriesNumber}.`);
      else seen.set(b.seriesNumber, b.title);
    }
    const given = numbers.filter((n): n is number => n !== null).sort((a, b) => a - b);
    for (let i = 1; i < given.length; i++) {
      if (given[i] - given[i - 1] > 1) group.problems.push(`There is no book ${given[i - 1] + 1} in this library (the numbers jump from ${given[i - 1]} to ${given[i]}). That is fine if it is not written yet.`);
    }
    const spellings = new Set(group.books.map((b) => b.seriesName.trim()));
    if (spellings.size > 1) group.problems.push(`The series name is written in ${spellings.size} ways: ${[...spellings].map((x) => `"${x}"`).join(', ')}. Stores treat different spellings as different series.`);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The "Also by" page of a book, from the library: first the other books of
 * its series in reading order, then the author's other books. The book
 * itself is left out, and so are books by other authors.
 */
export function alsoByFromLibrary(book: Pick<Book, 'id' | 'series'> & { author: string }, books: BookSummary[]): AlsoByGroup[] {
  const mine = books.filter((b) => !b.problem && b.id !== book.id && sameName(b.author, book.author));
  const groups: AlsoByGroup[] = [];
  const seriesName = book.series?.name.trim() ?? '';
  const inSeries = seriesName ? mine.filter((b) => sameName(b.seriesName ?? '', seriesName)).sort(byNumber) : [];
  if (inSeries.length) groups.push({ label: seriesName, titles: inSeries.map((b) => b.title) });
  const others = mine.filter((b) => !inSeries.includes(b));
  // Other series keep their books together; standalone books follow under no heading.
  for (const other of groupSeries(others)) groups.push({ label: other.name, titles: other.books.map((b) => b.title) });
  const standalone = others.filter((b) => !(b.seriesName ?? '').trim()).sort((a, b) => a.title.localeCompare(b.title));
  if (standalone.length) groups.push({ label: '', titles: standalone.map((b) => b.title) });
  return groups;
}

/** Set name and number of the series in one book's details. A number of null removes the number; an empty name takes the book out of the series. */
export async function setSeries(project: Project, name: string, number: number | null): Promise<void> {
  const clean = name.trim();
  project.book.series = clean ? { id: project.book.series?.id ?? '', name: clean, number } : null;
  await project.saveBook();
}

/**
 * Copy story bible entries from another book of the same series: entries
 * this book does not have yet (same kind and name) are added and marked as
 * shared. Entries that exist here are never overwritten. Returns how many
 * were added.
 */
export function mergeSeriesBible(target: Bible, source: Bible): number {
  const key = (type: string, name: string) => `${type}:${name.trim().toLowerCase()}`;
  const have = new Set(target.entries.map((e) => key(e.type, e.name)));
  let added = 0;
  for (const entry of source.entries) {
    if (!entry.name.trim() || have.has(key(entry.type, entry.name))) continue;
    target.entries.push({ ...newBibleEntry(entry.type, entry.name), ...structuredClone(entry), id: newBibleEntry(entry.type, entry.name).id, links: [], shared: true });
    have.add(key(entry.type, entry.name));
    added++;
  }
  return added;
}
