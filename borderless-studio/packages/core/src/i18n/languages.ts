/**
 * The languages a book can be written in, and what each one needs from the
 * typesetter: its script and direction, its quotation marks, its digits, its
 * ONIX code, whether lines may be hyphenated, which dictionary checks its
 * spelling and which bundled fonts can print it.
 *
 * Quotation marks follow each language's usual book typography. They are
 * only a default: an author can still type any mark by hand.
 */
import { baseLanguage, languageRegion } from '../model/book';

export type Script = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'bengali' | 'devanagari' | 'cjk';
export type DigitSet = 'latin' | 'arabic-indic' | 'persian' | 'bengali' | 'devanagari';

export interface QuoteMarks {
  open: string;
  close: string;
  innerOpen: string;
  innerClose: string;
  /** French style: a narrow no-break space inside guillemets and before ; : ! ? */
  spaced?: boolean;
}

export interface LanguageInfo {
  /** ISO 639-1 code. */
  code: string;
  /** Name in English. */
  name: string;
  /** Name in the language itself. */
  native: string;
  script: Script;
  dir: 'ltr' | 'rtl';
  quotes: QuoteMarks;
  /** The language's own digits, when it has them. */
  nativeDigits?: DigitSet;
  /** Whether books in this language print native digits unless the author chooses otherwise. */
  nativeByDefault?: boolean;
  /** ISO 639-2/B code for ONIX feeds. */
  onix: string;
  /** Lines may be broken inside words. Off for scripts where hyphenation is not used. */
  hyphenate: boolean;
  /** Spelling dictionary bundled with the app, by folder name under resources/dictionaries. */
  dictionary?: string;
  /** Joined letters that must not be letter spaced (small capitals, tracked headings). */
  cursive?: boolean;
  /** Regional variants offered in the language list, as [tag, label]. */
  variants?: [string, string][];
}

const EN_Q: QuoteMarks = { open: '\u201C', close: '\u201D', innerOpen: '\u2018', innerClose: '\u2019' };
const GUILLEMETS: QuoteMarks = { open: '\u00AB', close: '\u00BB', innerOpen: '\u201C', innerClose: '\u201D' };
const GERMAN_Q: QuoteMarks = { open: '„', close: '\u201C', innerOpen: '‚', innerClose: '\u2018' };
const LOW_HIGH: QuoteMarks = { open: '„', close: '\u201D', innerOpen: '\u00AB', innerClose: '\u00BB' };
const NORDIC: QuoteMarks = { open: '\u201D', close: '\u201D', innerOpen: '\u2019', innerClose: '\u2019' };
const CORNER: QuoteMarks = { open: '「', close: '」', innerOpen: '『', innerClose: '』' };

const L = (
  code: string, name: string, native: string, onix: string, script: Script, quotes: QuoteMarks,
  extra: Partial<LanguageInfo> = {},
): LanguageInfo => ({
  code, name, native, onix, script, quotes,
  dir: script === 'arabic' || script === 'hebrew' ? 'rtl' : 'ltr',
  hyphenate: script === 'latin' || script === 'cyrillic' || script === 'greek',
  cursive: script === 'arabic' || script === 'bengali' || script === 'devanagari',
  ...extra,
});

/** Every language the app knows, roughly by how many books are published in it. */
export const LANGUAGES: LanguageInfo[] = [
  L('en', 'English', 'English', 'eng', 'latin', EN_Q, {
    dictionary: 'en-AU',
    variants: [['en-AU', 'English (Australia)'], ['en-GB', 'English (United Kingdom)'], ['en-US', 'English (United States)'], ['en-CA', 'English (Canada)'], ['en-NZ', 'English (New Zealand)'], ['en-IE', 'English (Ireland)'], ['en-IN', 'English (India)']],
  }),
  L('fr', 'French', 'Français', 'fre', 'latin', { ...GUILLEMETS, spaced: true }, {
    dictionary: 'fr', variants: [['fr', 'French'], ['fr-FR', 'French (France)'], ['fr-CA', 'French (Canada)'], ['fr-BE', 'French (Belgium)'], ['fr-CH', 'French (Switzerland)']],
  }),
  L('es', 'Spanish', 'Español', 'spa', 'latin', GUILLEMETS, {
    dictionary: 'es', variants: [['es', 'Spanish'], ['es-ES', 'Spanish (Spain)'], ['es-MX', 'Spanish (Mexico)'], ['es-AR', 'Spanish (Argentina)'], ['es-US', 'Spanish (United States)']],
  }),
  L('ar', 'Arabic', 'العربية', 'ara', 'arabic', GUILLEMETS, { nativeDigits: 'arabic-indic', nativeByDefault: true }),
  L('de', 'German', 'Deutsch', 'ger', 'latin', GERMAN_Q, { variants: [['de', 'German'], ['de-DE', 'German (Germany)'], ['de-AT', 'German (Austria)'], ['de-CH', 'German (Switzerland)']] }),
  L('pt', 'Portuguese', 'Português', 'por', 'latin', EN_Q, { dictionary: 'pt', variants: [['pt-BR', 'Portuguese (Brazil)'], ['pt-PT', 'Portuguese (Portugal)']] }),
  L('it', 'Italian', 'Italiano', 'ita', 'latin', GUILLEMETS),
  L('nl', 'Dutch', 'Nederlands', 'dut', 'latin', EN_Q, { dictionary: 'nl' }),
  L('ru', 'Russian', 'Русский', 'rus', 'cyrillic', { open: '\u00AB', close: '\u00BB', innerOpen: '„', innerClose: '\u201C' }, { dictionary: 'ru' }),
  L('uk', 'Ukrainian', 'Українська', 'ukr', 'cyrillic', { open: '\u00AB', close: '\u00BB', innerOpen: '„', innerClose: '\u201C' }),
  L('pl', 'Polish', 'Polski', 'pol', 'latin', LOW_HIGH),
  L('tr', 'Turkish', 'Türkçe', 'tur', 'latin', EN_Q),
  L('sv', 'Swedish', 'Svenska', 'swe', 'latin', NORDIC),
  L('da', 'Danish', 'Dansk', 'dan', 'latin', { open: '\u00BB', close: '\u00AB', innerOpen: '\u203A', innerClose: '\u2039' }),
  L('nb', 'Norwegian (Bokmål)', 'Norsk bokmål', 'nob', 'latin', { open: '\u00AB', close: '\u00BB', innerOpen: '\u2018', innerClose: '\u2019' }),
  L('fi', 'Finnish', 'Suomi', 'fin', 'latin', NORDIC),
  L('cs', 'Czech', 'Čeština', 'cze', 'latin', GERMAN_Q),
  L('ro', 'Romanian', 'Română', 'rum', 'latin', LOW_HIGH),
  L('hu', 'Hungarian', 'Magyar', 'hun', 'latin', { open: '„', close: '\u201D', innerOpen: '\u00BB', innerClose: '\u00AB' }),
  L('el', 'Greek', 'Ελληνικά', 'gre', 'greek', GUILLEMETS),
  L('bg', 'Bulgarian', 'Български', 'bul', 'cyrillic', { open: '„', close: '\u201C', innerOpen: '\u2018', innerClose: '\u2019' }),
  L('sr', 'Serbian', 'Српски', 'srp', 'cyrillic', { open: '„', close: '\u201D', innerOpen: '\u2019', innerClose: '\u2019' }),
  L('id', 'Indonesian', 'Bahasa Indonesia', 'ind', 'latin', EN_Q),
  L('ms', 'Malay', 'Bahasa Melayu', 'may', 'latin', EN_Q),
  L('tl', 'Filipino', 'Filipino', 'fil', 'latin', EN_Q),
  L('vi', 'Vietnamese', 'Tiếng Việt', 'vie', 'latin', EN_Q, { hyphenate: false }),
  L('sw', 'Swahili', 'Kiswahili', 'swa', 'latin', EN_Q),
  L('ga', 'Irish', 'Gaeilge', 'gle', 'latin', EN_Q),
  L('cy', 'Welsh', 'Cymraeg', 'wel', 'latin', EN_Q),
  L('fa', 'Persian', 'فارسی', 'per', 'arabic', GUILLEMETS, { nativeDigits: 'persian', nativeByDefault: true }),
  L('ur', 'Urdu', 'اردو', 'urd', 'arabic', EN_Q, { nativeDigits: 'persian' }),
  L('he', 'Hebrew', 'עברית', 'heb', 'hebrew', { open: '\u201D', close: '\u201D', innerOpen: '\u2019', innerClose: '\u2019' }),
  L('bn', 'Bangla', 'বাংলা', 'ben', 'bengali', EN_Q, {
    nativeDigits: 'bengali', nativeByDefault: true, variants: [['bn', 'Bangla'], ['bn-BD', 'Bangla (Bangladesh)'], ['bn-IN', 'Bangla (India)']],
  }),
  L('hi', 'Hindi', 'हिन्दी', 'hin', 'devanagari', EN_Q, { nativeDigits: 'devanagari' }),
  L('mr', 'Marathi', 'मराठी', 'mar', 'devanagari', EN_Q, { nativeDigits: 'devanagari' }),
  L('ne', 'Nepali', 'नेपाली', 'nep', 'devanagari', EN_Q, { nativeDigits: 'devanagari', nativeByDefault: true }),
  L('zh', 'Chinese', '中文', 'chi', 'cjk', EN_Q, { variants: [['zh-Hans', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)']] }),
  L('ja', 'Japanese', '日本語', 'jpn', 'cjk', CORNER),
  L('ko', 'Korean', '한국어', 'kor', 'cjk', EN_Q),
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** What the app knows about a language tag ("fr-CA", "ar"). Unknown languages are treated like English text. */
export function languageInfo(tag: string): LanguageInfo {
  const base = baseLanguage(tag || 'en');
  const known = BY_CODE.get(base === 'no' || base === 'nn' ? 'nb' : base === 'iw' ? 'he' : base === 'fil' ? 'tl' : base);
  if (!known) return { ...BY_CODE.get('en')!, code: base, name: tag, native: tag, onix: 'und', dictionary: undefined, variants: undefined };
  const region = languageRegion(tag);
  const script = tag.split(/[-_]/).find((p) => p.length === 4)?.toLowerCase();
  // Regional and script differences in quotation marks.
  if (known.code === 'pt' && region === 'PT') return { ...known, quotes: GUILLEMETS };
  if (known.code === 'de' && region === 'CH') return { ...known, quotes: { open: '\u00AB', close: '\u00BB', innerOpen: '\u2039', innerClose: '\u203A' } };
  if (known.code === 'fr' && region === 'CH') return { ...known, quotes: { ...GUILLEMETS, spaced: false } };
  if (known.code === 'zh' && (script === 'hant' || region === 'TW' || region === 'HK')) return { ...known, quotes: CORNER };
  return known;
}

export const isRightToLeft = (tag: string): boolean => languageInfo(tag).dir === 'rtl';

/** All language tags for a picker: each variant, or the plain language when it has none. */
export function languageChoices(): [string, string][] {
  const out: [string, string][] = [];
  for (const l of LANGUAGES) {
    const label = l.native === l.name ? l.name : `${l.name}: ${l.native}`;
    if (l.variants) for (const [tag, name] of l.variants) out.push([tag, l.native === l.name ? name : `${name}: ${l.native}`]);
    else out.push([l.code, label]);
  }
  return out;
}

/** The digits a book prints in page numbers, chapter numbers and the year. */
export function digitSetFor(tag: string, choice: 'auto' | 'latin' | 'native' = 'auto'): DigitSet {
  const l = languageInfo(tag);
  if (!l.nativeDigits || choice === 'latin') return 'latin';
  if (choice === 'native' || l.nativeByDefault) return l.nativeDigits;
  return 'latin';
}

const ZERO: Record<DigitSet, number> = { latin: 0x30, 'arabic-indic': 0x0660, persian: 0x06f0, bengali: 0x09e6, devanagari: 0x0966 };

/** The ten digits of a set, zero first. */
export function digitChars(set: DigitSet): string[] {
  return Array.from({ length: 10 }, (_v, i) => String.fromCharCode(ZERO[set] + i));
}

/** Write the digits of a number or string in a digit set. */
export function toDigits(n: number | string, set: DigitSet): string {
  if (set === 'latin') return String(n);
  return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(ZERO[set] + Number(d)));
}

/**
 * The bundled fonts that print a script well, body face first. Chinese,
 * Japanese and Korean fonts are too large to ship; the author adds one to the
 * book's fonts folder.
 */
export function fontsForScript(script: Script): { body: string; heading: string; sans: string } | null {
  switch (script) {
    case 'arabic': return { body: 'Amiri', heading: 'Amiri', sans: 'Noto Naskh Arabic' };
    case 'hebrew': return { body: 'Noto Serif Hebrew', heading: 'Noto Serif Hebrew', sans: 'Noto Serif Hebrew' };
    case 'devanagari': return { body: 'Noto Serif Devanagari', heading: 'Noto Serif Devanagari', sans: 'Noto Serif Devanagari' };
    case 'bengali': return { body: 'Noto Serif Bengali', heading: 'Noto Serif Bengali', sans: 'Noto Sans Bengali' };
    case 'cjk': return null;
    default: return { body: 'EB Garamond', heading: 'EB Garamond', sans: 'Source Sans 3' };
  }
}
