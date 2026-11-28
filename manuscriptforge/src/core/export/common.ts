import type { Block } from '../model/blocks';

export interface ExportChapter {
  /** Used to match chapters between two versions of a book. */
  id?: string;
  title: string;
  blocks: Block[];
}

export interface ExportBook {
  title: string;
  author: string;
  /** Language as a short code, for example "en". */
  language: string;
  chapters: ExportChapter[];
}

export type ExportFormat = 'docx' | 'docx-tracked' | 'epub' | 'pdf' | 'md' | 'txt';

export const EXPORT_FORMATS: { value: ExportFormat; label: string; extension: string; description: string }[] = [
  { value: 'docx', label: 'Word document', extension: 'docx', description: 'A clean manuscript in standard manuscript format.' },
  {
    value: 'docx-tracked',
    label: 'Word document with tracked changes',
    extension: 'docx',
    description: 'Every difference from an earlier version shown as a tracked change that the author can accept or reject in Word.',
  },
  { value: 'epub', label: 'EPUB e-book', extension: 'epub', description: 'For e-readers and e-book stores.' },
  { value: 'pdf', label: 'PDF', extension: 'pdf', description: 'A reading copy for proofs and for sending to authors. Looks the same on every device.' },
  { value: 'md', label: 'Markdown', extension: 'md', description: 'Plain text with simple formatting marks.' },
  { value: 'txt', label: 'Plain text', extension: 'txt', description: 'Text only, without formatting.' },
];

const GENERIC_TITLES = /^(?:title page|front matter|full text)$/i;

/** Chapters named by the app rather than the author ("Title page") are exported without a heading. */
export function hasPrintableTitle(chapter: ExportChapter): boolean {
  return !!chapter.title.trim() && !GENERIC_TITLES.test(chapter.title.trim());
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters that are not allowed in XML at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
}

/** A file name made from the book title, safe on Windows and macOS. */
export function exportFileName(title: string, extension: string, suffix = ''): string {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Manuscript';
  return `${base}${suffix}.${extension}`;
}
