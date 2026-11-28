import { countWords } from '../text/words';
import { alignBlocks, changeStats, diffText, type Hunk } from './diff';
import { markupToPlain, runsToMarkup } from './markup';
import type { Block } from '../model/blocks';

export interface CompareChapterInput {
  id?: string;
  title: string;
  blocks: Block[];
}

export interface CompareRow {
  type: 'same' | 'changed' | 'added' | 'removed';
  /** The paragraph before, as markup. Absent for added paragraphs. */
  before?: string;
  /** The paragraph after, as markup. Absent for removed paragraphs. */
  after?: string;
  hunks?: Hunk[];
}

export interface CompareChapter {
  title: string;
  titleBefore?: string;
  status: 'same' | 'changed' | 'added' | 'removed';
  rows: CompareRow[];
  wordsAdded: number;
  wordsRemoved: number;
  changes: number;
}

export interface Comparison {
  chapters: CompareChapter[];
  wordsAdded: number;
  wordsRemoved: number;
  changes: number;
  paragraphsChanged: number;
  paragraphsAdded: number;
  paragraphsRemoved: number;
}

function text(block: Block): string {
  return block.type === 'break' ? '* * *' : runsToMarkup(block.runs);
}

function whole(chapter: CompareChapterInput, type: 'added' | 'removed'): CompareChapter {
  const rows: CompareRow[] = chapter.blocks.map((b) => (type === 'added' ? { type, after: text(b) } : { type, before: text(b) }));
  const words = chapter.blocks.reduce((n, b) => n + countWords(markupToPlain(text(b))), 0);
  return { title: chapter.title, status: type, rows, wordsAdded: type === 'added' ? words : 0, wordsRemoved: type === 'removed' ? words : 0, changes: rows.length };
}

/**
 * Compares two versions of a book, chapter by chapter and paragraph by
 * paragraph, down to the changed words. `before` is the older version.
 */
export function compareBooks(before: CompareChapterInput[], after: CompareChapterInput[]): Comparison {
  const chapters: CompareChapter[] = [];
  const oldIndex = new Map(before.map((c, i) => [c.id, i]));
  const emitted = new Set<number>();
  for (const chapter of after) {
    const match = chapter.id !== undefined ? oldIndex.get(chapter.id) : undefined;
    if (match === undefined) {
      chapters.push(whole(chapter, 'added'));
      continue;
    }
    for (let i = 0; i < match; i++) {
      if (!emitted.has(i) && !after.some((c) => c.id === before[i].id)) {
        chapters.push(whole(before[i], 'removed'));
        emitted.add(i);
      }
    }
    emitted.add(match);
    const old = before[match];
    const a = old.blocks.map(text);
    const b = chapter.blocks.map(text);
    const rows: CompareRow[] = [];
    let wordsAdded = 0;
    let wordsRemoved = 0;
    let changes = 0;
    for (const pair of alignBlocks(a, b)) {
      if (pair.a !== undefined && pair.b !== undefined) {
        if (a[pair.a] === b[pair.b]) rows.push({ type: 'same', before: a[pair.a], after: b[pair.b] });
        else {
          const hunks = diffText(a[pair.a], b[pair.b]);
          const stats = changeStats(hunks);
          wordsAdded += stats.wordsAdded;
          wordsRemoved += stats.wordsRemoved;
          changes += hunks.length;
          rows.push({ type: 'changed', before: a[pair.a], after: b[pair.b], hunks });
        }
      } else if (pair.b !== undefined) {
        wordsAdded += countWords(markupToPlain(b[pair.b]));
        changes++;
        rows.push({ type: 'added', after: b[pair.b] });
      } else {
        wordsRemoved += countWords(markupToPlain(a[pair.a!]));
        changes++;
        rows.push({ type: 'removed', before: a[pair.a!] });
      }
    }
    const retitled = old.title !== chapter.title;
    chapters.push({
      title: chapter.title,
      ...(retitled ? { titleBefore: old.title } : {}),
      status: changes || retitled ? 'changed' : 'same',
      rows,
      wordsAdded,
      wordsRemoved,
      changes: changes + (retitled ? 1 : 0),
    });
  }
  before.forEach((chapter, i) => {
    if (!emitted.has(i) && !after.some((c) => c.id === chapter.id)) chapters.push(whole(chapter, 'removed'));
  });
  const count = (type: CompareRow['type']) => chapters.reduce((n, c) => n + c.rows.filter((r) => r.type === type).length, 0);
  return {
    chapters,
    wordsAdded: chapters.reduce((n, c) => n + c.wordsAdded, 0),
    wordsRemoved: chapters.reduce((n, c) => n + c.wordsRemoved, 0),
    changes: chapters.reduce((n, c) => n + c.changes, 0),
    paragraphsChanged: count('changed'),
    paragraphsAdded: count('added'),
    paragraphsRemoved: count('removed'),
  };
}
