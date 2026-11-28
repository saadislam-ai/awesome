import { franc } from 'franc-min';

/** ISO 639-3 (what the detector returns) to the short code stored on a book. */
const ISO3_TO_CODE: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', nld: 'nl', rus: 'ru', ukr: 'uk',
  pol: 'pl', ces: 'cs', ron: 'ro', hun: 'hu', swe: 'sv', dan: 'da', nob: 'no', nno: 'no', fin: 'fi',
  ell: 'el', tur: 'tr', arb: 'ar', heb: 'he', pes: 'fa', urd: 'ur', hin: 'hi', ben: 'bn', pan: 'pa',
  tam: 'ta', tel: 'te', mar: 'mr', guj: 'gu', cmn: 'zh', jpn: 'ja', kor: 'ko', tha: 'th', vie: 'vi',
  ind: 'id', zlm: 'ms', tgl: 'tl', swh: 'sw', bul: 'bg', srp: 'sr', hrv: 'hr', bos: 'bs', slk: 'sk',
  cat: 'ca', afr: 'af',
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  ru: 'Russian', uk: 'Ukrainian', pl: 'Polish', cs: 'Czech', ro: 'Romanian', hu: 'Hungarian',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek', tr: 'Turkish', ar: 'Arabic',
  he: 'Hebrew', fa: 'Persian', ur: 'Urdu', hi: 'Hindi', bn: 'Bengali', pa: 'Punjabi', ta: 'Tamil',
  te: 'Telugu', mr: 'Marathi', gu: 'Gujarati', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', th: 'Thai',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tl: 'Filipino', sw: 'Swahili', bg: 'Bulgarian',
  sr: 'Serbian', hr: 'Croatian', bs: 'Bosnian', sk: 'Slovak', ca: 'Catalan', af: 'Afrikaans',
  und: 'Unknown',
};

export const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

/** Normalises tags such as "en-GB" or "eng" to the short codes used here. */
export function normalizeLanguage(tag: string | undefined | null): string | undefined {
  if (!tag) return undefined;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (LANGUAGE_NAMES[base] && base !== 'und') return base;
  return ISO3_TO_CODE[base];
}

/**
 * Detects the main language of a text. Works fully offline. Returns "und"
 * when the sample is too short or the language is not recognised.
 */
export function detectLanguage(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length < 40) return 'und';
  // Sample from the middle, away from title pages and boilerplate.
  const size = 6000;
  const start = clean.length > size * 2 ? Math.floor(clean.length / 2 - size / 2) : 0;
  const iso3 = franc(clean.slice(start, start + size), { minLength: 20 });
  return ISO3_TO_CODE[iso3] ?? 'und';
}
