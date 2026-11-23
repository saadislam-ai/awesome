/**
 * Reading a cover template PDF from a platform (IngramSpark sends one for a
 * given ISBN, page count and paper). Only the document size is read here: it
 * is the size the finished cover file must have. The spine width is printed
 * on the template as text and is typed in by the user, so that no number is
 * ever guessed from a file layout that the platform may change.
 */
import { PDFDocument } from 'pdf-lib';

export interface TemplateInfo {
  widthIn: number;
  heightIn: number;
  pages: number;
}

export async function readCoverTemplate(bytes: Uint8Array): Promise<TemplateInfo> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    throw new Error('This file could not be read as a PDF. Choose the template PDF the platform sent you.');
  }
  if (doc.getPageCount() === 0) throw new Error('The template PDF has no pages.');
  const { width, height } = doc.getPage(0).getSize();
  const round = (pt: number) => Math.round((pt / 72) * 1000) / 1000;
  return { widthIn: round(width), heightIn: round(height), pages: doc.getPageCount() };
}
