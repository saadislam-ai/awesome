import { unzipSync } from 'fflate';
import { blockText } from '../model/blocks';
import { detectLanguage, normalizeLanguage } from '../text/language';
import { fileExtension, ImportError, titleFromFilename, type ImportResult, type SourceFormat } from './common';
import { importDocx } from './docx';
import { importEpub } from './epub';
import { importPdf, type PdfLib, type PdfOptions } from './pdf';
import { importRtf } from './rtf';
import { importMarkdown, importTxt } from './text';

export * from './common';
export * from './chapters';
export type { PdfLib, PdfOptions } from './pdf';

export const SUPPORTED_EXTENSIONS = ['docx', 'txt', 'md', 'markdown', 'rtf', 'epub', 'pdf'];
export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',');

export interface ImportDeps {
  /** Loads pdf.js on demand. Only needed for PDF files. */
  loadPdf?: () => Promise<{ lib: PdfLib; options?: PdfOptions }>;
  onProgress?: (done: number, total: number) => void;
}

const UNSUPPORTED: Record<string, string> = {
  doc: 'Old .doc files are not supported. Open the file in Word and save it as .docx.',
  odt: 'OpenDocument (.odt) files are not supported yet. Save the file as .docx and import that.',
  pages: 'Apple Pages files are not supported. In Pages, choose File, Export To, Word and import the .docx.',
  mobi: 'Kindle files (.mobi) are not supported. Ask for the manuscript as .docx or .epub.',
  azw3: 'Kindle files (.azw3) are not supported. Ask for the manuscript as .docx or .epub.',
  azw: 'Kindle files (.azw) are not supported. Ask for the manuscript as .docx or .epub.',
  html: 'HTML files are not supported yet. Save the text as .docx or .md and import that.',
};

function startsWith(bytes: Uint8Array, signature: string, offset = 0): boolean {
  for (let i = 0; i < signature.length; i++) if (bytes[offset + i] !== signature.charCodeAt(i)) return false;
  return true;
}

/** Works out the real format from the file's content, not just its name. */
export function sniffFormat(filename: string, bytes: Uint8Array): SourceFormat {
  const ext = fileExtension(filename);
  if (startsWith(bytes, '%PDF')) return 'pdf';
  let offset = 0;
  while (offset < bytes.length && offset < 16 && (bytes[offset] === 0x20 || bytes[offset] === 0x0a || bytes[offset] === 0x0d)) offset++;
  if (startsWith(bytes, '{\\rtf', offset)) return 'rtf';
  if (startsWith(bytes, 'PK')) {
    const names: string[] = [];
    try {
      unzipSync(bytes, {
        filter: (f) => {
          names.push(f.name);
          return false;
        },
      });
    } catch {
      throw new ImportError('This file is damaged and could not be opened.');
    }
    if (names.includes('word/document.xml')) return 'docx';
    if (names.includes('META-INF/container.xml')) return 'epub';
    if (names.includes('content.xml')) throw new ImportError(UNSUPPORTED.odt);
    if (names.some((n) => n.startsWith('Index/') || n === 'index.apxl')) throw new ImportError(UNSUPPORTED.pages);
    throw new ImportError('This file type is not supported. Use DOCX, TXT, Markdown, RTF, EPUB or PDF.');
  }
  if (ext === 'docx') {
    // Has the right name but is not a zip: let the Word importer explain why.
    return 'docx';
  }
  if (UNSUPPORTED[ext]) throw new ImportError(UNSUPPORTED[ext]);
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || ext === 'text' || ext === '') return 'txt';
  if (ext === 'rtf' || ext === 'epub' || ext === 'pdf') {
    throw new ImportError(`This file is named .${ext} but its content is not a valid ${ext.toUpperCase()} file.`);
  }
  throw new ImportError(`".${ext}" files are not supported. Use DOCX, TXT, Markdown, RTF, EPUB or PDF.`);
}

/**
 * Reads a manuscript file and returns its text as blocks plus any metadata
 * found in the file. Chapter detection is a separate step (`detectChapters`).
 */
export async function importManuscript(filename: string, bytes: Uint8Array, deps: ImportDeps = {}): Promise<ImportResult> {
  if (!bytes.length) throw new ImportError('This file is empty.');
  const format = sniffFormat(filename, bytes);
  let result: ImportResult;
  switch (format) {
    case 'docx':
      result = importDocx(bytes);
      break;
    case 'epub':
      result = importEpub(bytes);
      break;
    case 'rtf':
      result = importRtf(bytes);
      break;
    case 'md':
      result = importMarkdown(bytes);
      break;
    case 'pdf': {
      if (!deps.loadPdf) throw new ImportError('PDF import is not available here.');
      const { lib, options } = await deps.loadPdf();
      result = await importPdf(bytes, lib, { ...options, onProgress: deps.onProgress });
      break;
    }
    default:
      result = importTxt(bytes);
  }

  if (!result.blocks.some((b) => b.type !== 'break')) {
    throw new ImportError('No text was found in this file.');
  }

  if (!result.meta.title) result.meta.title = undefined;
  const declared = normalizeLanguage(result.meta.language);
  let sample = '';
  for (const block of result.blocks) {
    if (block.type === 'paragraph') sample += blockText(block) + ' ';
    if (sample.length > 40000) break;
  }
  const detected = detectLanguage(sample);
  // Trust the text over file metadata, which is often left at the template's default.
  result.meta.language = detected !== 'und' ? detected : (declared ?? 'und');
  return result;
}

export { titleFromFilename };
