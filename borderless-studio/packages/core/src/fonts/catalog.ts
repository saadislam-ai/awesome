/**
 * The fonts shipped with the app. All are under the SIL Open Font License,
 * which allows embedding in PDFs and EPUBs and redistribution with software.
 *
 * `smcp` (real small capitals) and `onum` (old style figures) were read from
 * each font's OpenType tables; when a font lacks small capitals the Typst
 * library falls back to scaled capitals.
 */
import type { Script } from '../i18n/languages';

export interface FontInfo {
  family: string;
  /** Folder under resources/fonts. */
  dir: string;
  kind: 'serif' | 'sans';
  scripts: Script[];
  smcp: boolean;
  onum: boolean;
  /** Height of a capital letter as a fraction of the font size (used to size drop capitals). */
  capHeightEm: number;
  hasItalic: boolean;
  hasBold: boolean;
  license: string;
  source: string;
  description: string;
  /** Regular, italic, bold and bold italic files, for embedding in ebooks. */
  files: { regular: string; italic?: string; bold?: string; boldItalic?: string };
}

export const FONT_CATALOG: FontInfo[] = [
  {
    family: 'EB Garamond', dir: 'EBGaramond', kind: 'serif', scripts: ['latin', 'cyrillic', 'greek'], smcp: true, onum: true, capHeightEm: 0.65,
    hasItalic: true, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/octaviopardo/EBGaramond12',
    description: 'A faithful revival of Claude Garamont\'s type. Elegant and economical; the Borderless house face.',
    files: { regular: 'EBGaramond-Regular.otf', italic: 'EBGaramond-Italic.otf', bold: 'EBGaramond-Bold.otf', boldItalic: 'EBGaramond-BoldItalic.otf' },
  },
  {
    family: 'Crimson Pro', dir: 'CrimsonPro', kind: 'serif', scripts: ['latin'], smcp: false, onum: true, capHeightEm: 0.573,
    hasItalic: true, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/Fonthausen/CrimsonPro',
    description: 'A contemporary old style serif with a slightly larger body than Garamond. Clear at small sizes.',
    files: { regular: 'CrimsonPro-Regular.ttf', italic: 'CrimsonPro-Italic.ttf', bold: 'CrimsonPro-Bold.ttf', boldItalic: 'CrimsonPro-BoldItalic.ttf' },
  },
  {
    family: 'Libre Baskerville', dir: 'LibreBaskerville', kind: 'serif', scripts: ['latin'], smcp: false, onum: false, capHeightEm: 0.77,
    hasItalic: true, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/impallari/Libre-Baskerville',
    description: 'A wide, sturdy Baskerville. Set it a point smaller than Garamond.',
    files: { regular: 'LibreBaskerville-Regular.ttf', italic: 'LibreBaskerville-Italic.ttf', bold: 'LibreBaskerville-Bold.ttf', boldItalic: 'LibreBaskerville-BoldItalic.ttf' },
  },
  {
    family: 'Source Sans 3', dir: 'SourceSans3', kind: 'sans', scripts: ['latin', 'cyrillic', 'greek'], smcp: true, onum: true, capHeightEm: 0.66,
    hasItalic: true, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/adobe-fonts/source-sans',
    description: 'A calm humanist sans serif for headings, call-outs, tables and children\'s books.',
    files: { regular: 'SourceSans3-Regular.otf', italic: 'SourceSans3-It.otf', bold: 'SourceSans3-Bold.otf', boldItalic: 'SourceSans3-BoldIt.otf' },
  },
  {
    family: 'Noto Serif Bengali', dir: 'NotoSerifBengali', kind: 'serif', scripts: ['bengali', 'latin'], smcp: false, onum: false, capHeightEm: 0.622,
    hasItalic: false, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/notofonts/bengali',
    description: 'Bangla text face with full conjunct support. The default for Bangla books.',
    files: { regular: 'NotoSerifBengali-Regular.ttf', bold: 'NotoSerifBengali-Bold.ttf' },
  },
  {
    family: 'Noto Sans Bengali', dir: 'NotoSansBengali', kind: 'sans', scripts: ['bengali', 'latin'], smcp: false, onum: false, capHeightEm: 0.622,
    hasItalic: false, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/notofonts/bengali',
    description: 'Bangla sans serif for headings and captions.',
    files: { regular: 'NotoSansBengali-Regular.ttf', bold: 'NotoSansBengali-Bold.ttf' },
  },
  {
    family: 'Tiro Bangla', dir: 'TiroBangla', kind: 'serif', scripts: ['bengali', 'latin'], smcp: true, onum: false, capHeightEm: 0.699,
    hasItalic: true, hasBold: false, license: 'SIL OFL 1.1', source: 'https://github.com/TiroTypeworks/Indigo',
    description: 'A literary Bangla face by Tiro Typeworks with a true italic. No bold weight.',
    files: { regular: 'TiroBangla-Regular.ttf', italic: 'TiroBangla-Italic.ttf' },
  },
  {
    family: 'Amiri', dir: 'Amiri', kind: 'serif', scripts: ['arabic', 'latin'], smcp: false, onum: false, capHeightEm: 0.646,
    hasItalic: true, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/aliftype/amiri',
    description: 'A classical Naskh in the tradition of the Bulaq press, made for books. The default for Arabic, Persian and Urdu.',
    files: { regular: 'Amiri-Regular.ttf', italic: 'Amiri-Italic.ttf', bold: 'Amiri-Bold.ttf', boldItalic: 'Amiri-BoldItalic.ttf' },
  },
  {
    family: 'Noto Naskh Arabic', dir: 'NotoNaskhArabic', kind: 'sans', scripts: ['arabic', 'latin'], smcp: false, onum: false, capHeightEm: 0.7,
    hasItalic: false, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/notofonts/arabic',
    description: 'A plain, open Naskh for headings, captions and screen reading.',
    files: { regular: 'NotoNaskhArabic-Regular.ttf', bold: 'NotoNaskhArabic-Bold.ttf' },
  },
  {
    family: 'Noto Serif Hebrew', dir: 'NotoSerifHebrew', kind: 'serif', scripts: ['hebrew', 'latin'], smcp: false, onum: false, capHeightEm: 0.714,
    hasItalic: false, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/notofonts/hebrew',
    description: 'Hebrew text face with vowel points. The default for Hebrew books.',
    files: { regular: 'NotoSerifHebrew-Regular.ttf', bold: 'NotoSerifHebrew-Bold.ttf' },
  },
  {
    family: 'Noto Serif Devanagari', dir: 'NotoSerifDevanagari', kind: 'serif', scripts: ['devanagari', 'latin'], smcp: false, onum: false, capHeightEm: 0.715,
    hasItalic: false, hasBold: true, license: 'SIL OFL 1.1', source: 'https://github.com/notofonts/devanagari',
    description: 'Devanagari text face with full conjunct support, for Hindi, Marathi and Nepali.',
    files: { regular: 'NotoSerifDevanagari-Regular.ttf', bold: 'NotoSerifDevanagari-Bold.ttf' },
  },
];

export function fontInfo(family: string): FontInfo | undefined {
  return FONT_CATALOG.find((f) => f.family.toLowerCase() === family.toLowerCase());
}

export function fontCaps(family: string): { smcp: boolean; onum: boolean } {
  const f = fontInfo(family);
  return { smcp: f?.smcp ?? false, onum: f?.onum ?? false };
}

export function supportsBengali(family: string): boolean {
  return fontInfo(family)?.scripts.includes('bengali') ?? false;
}

/** Whether a font prints a script. Fonts that are not in the catalogue (added by the author) are trusted. */
export function fontSupports(family: string, script: Script): boolean {
  const info = fontInfo(family);
  return info ? info.scripts.includes(script) : true;
}

/**
 * Font fallback chain for a primary family: Latin, Cyrillic and Greek glyphs
 * always resolve (EB Garamond), and so do Bangla, Arabic, Hebrew and
 * Devanagari, so a stray word in another script never prints as empty boxes.
 */
export function fontStack(primary: string, kind: 'serif' | 'sans' = 'serif'): string[] {
  const latin = kind === 'sans' ? 'Source Sans 3' : 'EB Garamond';
  const others = kind === 'sans'
    ? ['Noto Sans Bengali', 'Noto Naskh Arabic', 'Noto Serif Hebrew', 'Noto Serif Devanagari']
    : ['Noto Serif Bengali', 'Amiri', 'Noto Serif Hebrew', 'Noto Serif Devanagari'];
  const out = [primary];
  for (const f of [latin, ...others]) if (!out.includes(f)) out.push(f);
  return out;
}
