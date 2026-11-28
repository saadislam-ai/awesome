import { exportFileName, type ExportBook, type ExportChapter, type ExportFormat } from './common';
import { exportDocx } from './docx';
import { exportEpub } from './epub';
import { exportMarkdown, exportText } from './text';

export * from './common';
export { compareSummary, exportDocx } from './docx';
export { exportEpub } from './epub';
export { exportMarkdown, exportText } from './text';

export interface ExportResult {
  fileName: string;
  bytes: Uint8Array;
  extension: string;
}

/** Produces the file for the chosen format. `compareTo` is needed for tracked changes. */
export function exportBook(book: ExportBook, format: ExportFormat, compareTo?: ExportChapter[]): ExportResult {
  const encoder = new TextEncoder();
  switch (format) {
    case 'docx':
      return { fileName: exportFileName(book.title, 'docx'), bytes: exportDocx(book), extension: 'docx' };
    case 'docx-tracked':
      if (!compareTo) throw new Error('Choose the version to compare with.');
      return { fileName: exportFileName(book.title, 'docx', ' (tracked changes)'), bytes: exportDocx(book, { compareTo }), extension: 'docx' };
    case 'epub':
      return { fileName: exportFileName(book.title, 'epub'), bytes: exportEpub(book), extension: 'epub' };
    case 'md':
      return { fileName: exportFileName(book.title, 'md'), bytes: encoder.encode(exportMarkdown(book)), extension: 'md' };
    default:
      return { fileName: exportFileName(book.title, 'txt'), bytes: encoder.encode(exportText(book)), extension: 'txt' };
  }
}
