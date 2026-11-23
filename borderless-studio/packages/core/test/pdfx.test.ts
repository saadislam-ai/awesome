/**
 * The PDF/X-1a step on small hand made PDFs (the sample book tests cover the
 * real interior files).
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, cmyk } from 'pdf-lib';
import { encodePng, finalizePrint, inspectPdf, naiveRgbToCmyk, type RasterImage } from '../src/index';

function rgbPng(width = 60, height = 40, alpha = false): Uint8Array {
  const channels = alpha ? 4 : 3;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      data[i] = Math.round((x / (width - 1)) * 255);
      data[i + 1] = Math.round((y / (height - 1)) * 255);
      data[i + 2] = 128;
      if (alpha) data[i + 3] = x < width / 2 ? 255 : 100;
    }
  }
  return encodePng({ width, height, channels, data } as RasterImage);
}

async function samplePdf(png: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([396, 612]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('A page with a colour picture', { x: 60, y: 540, size: 12, font, color: cmyk(0, 0, 0, 1) });
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 60, y: 300, width: 200, height: 133 });
  return doc.save({ useObjectStreams: false });
}

const convert = (rgb: Uint8Array): Uint8Array => {
  const out = new Uint8Array((rgb.length / 3) * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    const c = naiveRgbToCmyk(rgb[i], rgb[i + 1], rgb[i + 2]);
    for (let k = 0; k < 4; k++) out[o + k] = Math.round(c[k] * 255);
  }
  return out;
};

describe('PDF/X-1a step', () => {
  it('converts an RGB picture to CMYK and marks the file as PDF/X-1a:2001', async () => {
    const { bytes, pdfx } = await finalizePrint(await samplePdf(rgbPng()), { title: 'Test', author: 'A. Writer', pdfx: { rgbToCmyk: convert } });
    expect(pdfx?.problems).toEqual([]);
    expect(pdfx?.convertedToCmyk).toBe(1);
    expect(pdfx?.maxInkConverted).toBeLessThanOrEqual(2.4 + 0.01);
    const report = await inspectPdf(bytes);
    expect(report.version).toBe('1.3');
    expect(report.pdfx).toBe('PDF/X-1a:2001');
    expect(report.outputIntents[0]).toEqual({ subtype: 'GTS_PDFX', condition: 'CGATS TR 001', hasProfile: false });
    expect(report.images).toHaveLength(1);
    expect(report.images[0].color).toBe('cmyk');
    expect(report.images[0].widthPx).toBe(60);
    expect(report.pages[0].hasTrimBox).toBe(true);
    expect(report.info.Trapped).toBe('False');
    expect(report.info.Title).toBe('Test');
  });

  it('reports a colour picture when no converter is available instead of writing a wrong file silently', async () => {
    const { pdfx } = await finalizePrint(await samplePdf(rgbPng()), { title: 'Test', pdfx: {} });
    expect(pdfx?.convertedToCmyk).toBe(0);
    expect(pdfx?.problems.join(' ')).toMatch(/colour \(RGB\) picture/);
  });

  it('reports transparency', async () => {
    const { pdfx } = await finalizePrint(await samplePdf(rgbPng(60, 40, true)), { title: 'Test', pdfx: { rgbToCmyk: convert } });
    expect(pdfx?.problems.join(' ')).toMatch(/transparency/);
  });

  it('can store the press profile in the output intent when a printer wants it', async () => {
    const profile = new Uint8Array(200).fill(7);
    const { bytes } = await finalizePrint(await samplePdf(rgbPng()), { title: 'Test', pdfx: { rgbToCmyk: convert, embedProfile: profile } });
    expect((await inspectPdf(bytes, { shallow: true })).outputIntents[0].hasProfile).toBe(true);
  });

  it('leaves an ordinary PDF alone when PDF/X is not asked for', async () => {
    const { bytes, pdfx } = await finalizePrint(await samplePdf(rgbPng()), { title: 'Test', version: [1, 4] });
    expect(pdfx).toBeUndefined();
    const report = await inspectPdf(bytes);
    expect(report.version).toBe('1.4');
    expect(report.pdfx).toBeNull();
    expect(report.images[0].color).toBe('rgb');
  });
});
