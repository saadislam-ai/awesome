import { strToU8, zipSync } from 'fflate';
import initSqlJs from 'sql.js';
import { expect, it } from 'vitest';
import { detectChapters, importManuscript } from '../../src/core/import';
import { paragraph } from '../../src/core/model/blocks';
import { Library } from '../../src/data/library';
import { MemoryFiles } from '../../src/platform/memory';
import { createSqlJsDb } from '../../src/platform/sqljs';

const WORDS = ['the', 'lighthouse', 'keeper', 'walked', 'slowly', 'along', 'a', 'narrow', 'path', 'toward', 'harbour', 'while', 'gulls', 'circled', 'above', 'grey', 'water', 'and', 'thought', 'about', 'letters'];

/** Builds a Word file with 100 chapters and a little over 300,000 words. */
function bigDocx(): Uint8Array {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  const parts: string[] = [];
  for (let c = 1; c <= 100; c++) {
    parts.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter ${c}</w:t></w:r></w:p>`);
    for (let p = 0; p < 30; p++) {
      const words: string[] = [];
      for (let w = 0; w < 101; w++) words.push(WORDS[next() % WORDS.length]);
      const text = words.join(' ');
      const half = text.length >> 1;
      parts.push(`<w:p><w:r><w:t xml:space="preserve">${text.slice(0, half)}</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${text.slice(half)}.</w:t></w:r></w:p>`);
    }
  }
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${ns}><w:body>${parts.join('')}</w:body></w:document>`),
    'word/styles.xml': strToU8(`<?xml version="1.0"?><w:styles ${ns}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`),
  });
}

it('handles a 300,000-word book: import, save, edit, snapshot and restore', async () => {
  const timings: Record<string, number> = {};
  const time = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = performance.now();
    const value = await fn();
    timings[name] = Math.round(performance.now() - start);
    return value;
  };

  const bytes = bigDocx();
  const result = await time('read file', () => importManuscript('big.docx', bytes));
  const { chapters } = await time('detect chapters', () => detectChapters(result.blocks));
  expect(chapters).toHaveLength(100);

  const SQL = await initSqlJs();
  const library = new Library(createSqlJsDb(new SQL.Database()), new MemoryFiles());
  await library.init();
  const book = await time('save to library', () =>
    library.createBook({ category: 'mine', title: 'Big Book', chapters, source: { name: 'big.docx', format: 'docx', bytes } }),
  );
  expect(book.wordCount).toBeGreaterThanOrEqual(300_000);

  const heads = await time('list chapters', () => library.listChapters(book.id));
  const chapter = (await time('open one chapter', () => library.getChapter(heads[50].id)))!;
  await time('save one chapter', () => library.saveChapter(chapter.id, [...chapter.blocks, paragraph('One more line.')]));
  await time('snapshot', () => library.createSnapshot(book.id, 'After edit', 'manual'));
  await time('search', async () => expect((await library.searchText('one more line')).length).toBe(1));
  const original = (await library.listVersions(book.id)).find((v) => v.kind === 'original')!;
  await time('restore original', () => library.restoreVersion(book.id, original.id));
  expect((await library.getBook(book.id))!.wordCount).toBe(book.wordCount);

  console.log('300,000-word book timings (ms):', JSON.stringify(timings));
  // Generous limits: these guard against accidental slow paths, not exact speed.
  expect(timings['read file']).toBeLessThan(8000);
  expect(timings['save to library']).toBeLessThan(8000);
  expect(timings['save one chapter']).toBeLessThan(500);
  expect(timings['open one chapter']).toBeLessThan(300);
});
