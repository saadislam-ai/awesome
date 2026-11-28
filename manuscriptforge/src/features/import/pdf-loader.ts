import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PdfLib, PdfOptions } from '../../core/import';

/**
 * Loads pdf.js only when a PDF is actually imported. The "legacy" build is
 * used on purpose: it runs on the older system webviews found on some Macs.
 */
export async function loadPdf(): Promise<{ lib: PdfLib; options: PdfOptions }> {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).toString();
  return { lib, options: { cMapUrl: `${base}cmaps/`, standardFontDataUrl: `${base}standard_fonts/` } };
}
