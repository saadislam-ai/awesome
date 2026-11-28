import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importManuscript, type ImportResult } from '../../src/core/import';
import { blockText, type Block } from '../../src/core/model/blocks';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, '..', 'fixtures', 'files');

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

/** pdf.js for Node, loaded only by the tests that need it. */
export async function loadPdfForTests() {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = join(here, '..', '..', 'node_modules', 'pdfjs-dist');
  return { lib, options: { cMapUrl: join(base, 'cmaps') + '/', standardFontDataUrl: join(base, 'standard_fonts') + '/' } };
}

export function importFixture(name: string): Promise<ImportResult> {
  return importManuscript(name, fixture(name), { loadPdf: loadPdfForTests });
}

/** A compact one-line-per-block outline, handy in assertions and failure output. */
export function outline(blocks: Block[]): string[] {
  return blocks.map((b) => {
    if (b.type === 'break') return '[break]';
    const tag = b.type === 'heading' ? `h${b.level}` : b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type === 'quote' ? 'quote' : 'p';
    const align = 'align' in b && b.align ? `.${b.align}` : '';
    const pb = (b as { pb?: boolean }).pb ? '^' : '';
    return `${pb}${tag}${align}: ${blockText(b)}`;
  });
}
