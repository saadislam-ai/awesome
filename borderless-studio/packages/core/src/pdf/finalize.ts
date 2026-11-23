/**
 * Last steps applied to every print PDF after typesetting:
 *
 *   - blank pages appended to reach the press's page multiple,
 *   - link annotations removed (printers reject or ignore them, and PDF/X
 *     forbids them inside the page),
 *   - document information set (title, author, producer),
 *   - the file written in a classic layout (no object streams) with the
 *     PDF version the target needs.
 *
 * Page content is never re-encoded: text stays text, fonts stay embedded.
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { applyPdfx1a, type PdfxOptions, type PdfxSummary } from './pdfx';

export interface FinalizeOptions {
  /** Blank pages to append. */
  addBlankPages?: number;
  removeAnnotations?: boolean;
  /** Remove the outline (bookmarks). */
  removeOutline?: boolean;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  /** PDF header version, for example [1, 4]. */
  version?: [number, number];
  /** Fixed timestamp for reproducible output (tests). */
  date?: Date;
  /** Remove the XMP metadata packet. The document information (title, author) is kept. */
  removeXmp?: boolean;
  /** Make the file a PDF/X-1a:2001 file (see pdfx.ts). Sets the header version to 1.3. */
  pdfx?: PdfxOptions;
}

export interface FinalizeResult {
  bytes: Uint8Array;
  /** What the PDF/X step did, when it ran. */
  pdfx?: PdfxSummary;
}

export const PRODUCER = 'Borderless Studio (Typst, pdf-lib)';

/** The finishing step, returning the bytes only. */
export async function finalizePrintPdf(bytes: Uint8Array, opts: FinalizeOptions = {}): Promise<Uint8Array> {
  return (await finalizePrint(bytes, opts)).bytes;
}

export async function finalizePrint(bytes: Uint8Array, opts: FinalizeOptions = {}): Promise<FinalizeResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });

  if (opts.addBlankPages && opts.addBlankPages > 0) {
    const last = doc.getPage(doc.getPageCount() - 1);
    const { width, height } = last.getSize();
    const trim = last.getTrimBox();
    const sideBleed = Math.max(0, width - trim.width);
    const hasTrim = sideBleed > 0.01 || trim.height < height - 0.01;
    for (let i = 0; i < opts.addBlankPages; i++) {
      const p = doc.addPage([width, height]);
      if (hasTrim) {
        // Bleed is on the outside edge only, so the trim box is mirrored on left and right hand pages.
        const pageNumber = doc.getPageCount();
        const x = pageNumber % 2 === 1 ? 0 : sideBleed;
        p.setTrimBox(x, trim.y, trim.width, trim.height);
        p.setBleedBox(0, 0, width, height);
      }
    }
  }

  if (opts.removeAnnotations) {
    for (const page of doc.getPages()) page.node.delete(PDFName.of('Annots'));
  }
  if (opts.removeOutline) {
    doc.catalog.delete(PDFName.of('Outlines'));
    doc.catalog.delete(PDFName.of('PageMode'));
  }
  if (opts.removeAnnotations) {
    // Named destinations only exist to serve links; drop them with the links.
    doc.catalog.delete(PDFName.of('Dests'));
    doc.catalog.delete(PDFName.of('Names'));
  }

  const when = opts.date ?? new Date();
  if (opts.title !== undefined) doc.setTitle(opts.title);
  if (opts.author !== undefined) doc.setAuthor(opts.author);
  if (opts.subject !== undefined) doc.setSubject(opts.subject);
  if (opts.keywords) doc.setKeywords(opts.keywords);
  doc.setProducer(PRODUCER);
  doc.setCreator('Borderless Studio');
  doc.setCreationDate(when);
  doc.setModificationDate(when);

  if (opts.removeXmp) doc.catalog.delete(PDFName.of('Metadata'));
  const pdfx = opts.pdfx ? applyPdfx1a(doc, opts.pdfx) : undefined;

  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
  // PDF/X-1a:2001 is defined on PDF 1.3.
  const version = pdfx ? ([1, 3] as [number, number]) : opts.version;
  if (version) setPdfVersion(out, version[0], version[1]);
  return { bytes: out, pdfx };
}

/**
 * Write the PDF version into the file header. pdf-lib always writes "1.7";
 * the header has a fixed width, so the digits can be replaced in place
 * without moving any object.
 */
export function setPdfVersion(bytes: Uint8Array, major: number, minor: number): void {
  // "%PDF-1.7": the version starts at byte 5.
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d && bytes[6] === 0x2e) {
    bytes[5] = 0x30 + major;
    bytes[7] = 0x30 + minor;
  }
}
