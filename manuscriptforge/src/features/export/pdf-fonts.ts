import normalUrl from 'dejavu-fonts-ttf/ttf/DejaVuSerif.ttf?url';
import boldUrl from 'dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf?url';
import italicUrl from 'dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf?url';
import boldItalicUrl from 'dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf?url';
import type { PdfFonts } from '../../core/export/pdf';

let cached: Promise<PdfFonts> | null = null;

async function read(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('A font needed for the PDF could not be loaded.');
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The fonts PDFs are set in. They ship inside the app (nothing is downloaded)
 * and are read only when the first PDF is made.
 */
export function loadPdfFonts(): Promise<PdfFonts> {
  cached ??= Promise.all([read(normalUrl), read(boldUrl), read(italicUrl), read(boldItalicUrl)])
    .then(([normal, bold, italics, bolditalics]) => ({ normal, bold, italics, bolditalics }))
    .catch((e) => {
      cached = null;
      throw e;
    });
  return cached;
}
