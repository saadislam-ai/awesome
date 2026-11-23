/**
 * Style analysis of one document and a consistency check across the whole
 * manuscript. Both work on the text with the markup blanked out (so offsets
 * match the Markdown source and can be shown in the editor), and neither
 * changes anything: they only point at places worth a second look.
 */
import { maskMarkdown } from '../markdown/mask';
import type { TextStyle } from '../model/book';

export interface Finding {
  kind: string;
  from: number;
  to: number;
  text: string;
  message: string;
}

export interface StyleReport {
  words: number;
  sentences: number;
  paragraphs: number;
  averageSentenceWords: number;
  /** Flesch reading ease (higher is easier; 60 to 70 is plain English). English only. */
  readingEase: number | null;
  /** Share of the words that stand inside quotation marks. */
  dialogueShare: number;
  counts: { adverbs: number; passive: number; fillers: number; longSentences: number; repeats: number; cliches: number };
  /** The most used words that are not everyday words, with their counts. */
  frequent: { word: string; count: number }[];
  findings: Finding[];
}

const WORD_RE = /[\p{L}\p{M}][\p{L}\p{M}'\u2019-]*/gu;
const STOP = new Set(
  ('the of and a to in is was it that he she i you his her they we for on with as at by had not be this have from or but were are said one all would there their what so up out if about who them then into no just him do could when my than its me over like only your did now back more been will an very down after before little other still know thought how off some time looked through here again too our way where'
  ).split(' '),
);
const FILLERS = ['just', 'really', 'very', 'quite', 'rather', 'somewhat', 'suddenly', 'actually', 'basically', 'literally', 'simply', 'totally', 'definitely', 'probably', 'perhaps', 'almost', 'nearly', 'seemed to', 'began to', 'started to', 'a bit', 'sort of', 'kind of'];
const CLICHES = [
  'at the end of the day', 'in the nick of time', 'avoid like the plague', 'dead as a doornail', 'heart skipped a beat', 'let out a breath', 'breath she did not know', 'breath he did not know',
  'only time will tell', 'crystal clear', 'easier said than done', 'needless to say', 'few and far between', 'calm before the storm', 'every fibre of', 'every fiber of', 'cold as ice', 'white as a sheet',
  'it was a dark and stormy night', 'think outside the box', 'tip of the iceberg', 'time stood still', 'sent shivers down', 'blood ran cold',
];
const IRREGULAR = 'been|done|gone|seen|known|taken|given|written|made|said|told|found|left|kept|held|brought|built|bought|caught|chosen|driven|eaten|forgotten|hidden|sold|sent|shown|spoken|stolen|thrown|torn|worn|won|paid|put|read|run|set|shot|shut|struck|taught|thought|understood|lost|led|laid|heard|drawn|broken|begun|born|beaten';
const PASSIVE_RE = new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(?:\\w{3,}ed|${IRREGULAR})\\b`, 'gi');
const NOT_ADVERBS = new Set(['only', 'early', 'family', 'likely', 'lonely', 'lovely', 'ugly', 'holy', 'silly', 'belly', 'jelly', 'reply', 'supply', 'apply', 'fly', 'july', 'italy', 'ally', 'bully', 'rely', 'daily', 'friendly', 'elderly', 'lily', 'emily', 'sally', 'billy', 'molly', 'kelly', 'holly', 'folly', 'jolly', 'wholly', 'butterfly', 'assembly', 'anomaly', 'monopoly']);

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

interface Sentence { from: number; to: number; words: number }

function sentencesOf(masked: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\u2026\n]+(?:[.!?\u2026]+["'\u201D\u2019)]*|\n\n|$)/g;
  for (const m of masked.matchAll(re)) {
    const text = m[0];
    const words = (text.match(WORD_RE) ?? []).length;
    if (words === 0) continue;
    const lead = text.length - text.trimStart().length;
    out.push({ from: m.index + lead, to: m.index + text.trimEnd().length, words });
  }
  return out;
}

export interface StyleOptions {
  /** Sentences longer than this are listed. */
  longSentenceWords?: number;
  /** A notable word used again within this many words is listed. */
  repeatWindow?: number;
  language?: string;
}

export function analyseStyle(source: string, opts: StyleOptions = {}): StyleReport {
  const masked = maskMarkdown(source, { hideDeletions: true });
  const english = !opts.language || /^en/i.test(opts.language);
  const findings: Finding[] = [];
  const tokens = [...masked.matchAll(WORD_RE)].map((m) => ({ word: m[0], from: m.index, to: m.index + m[0].length }));
  const sentences = sentencesOf(masked);
  const paragraphs = masked.split(/\n\s*\n/).filter((p) => /[\p{L}]/u.test(p)).length;
  const longLimit = opts.longSentenceWords ?? 40;
  const counts = { adverbs: 0, passive: 0, fillers: 0, longSentences: 0, repeats: 0, cliches: 0 };

  for (const s of sentences) {
    if (s.words > longLimit) {
      counts.longSentences++;
      findings.push({ kind: 'long-sentence', from: s.from, to: s.to, text: masked.slice(s.from, Math.min(s.to, s.from + 80)), message: `A sentence of ${s.words} words. Long sentences are fine when they are meant; check that this one is.` });
    }
  }
  if (english) {
    for (const t of tokens) {
      const low = t.word.toLowerCase();
      if (low.length > 4 && low.endsWith('ly') && !NOT_ADVERBS.has(low)) {
        counts.adverbs++;
        findings.push({ kind: 'adverb', from: t.from, to: t.to, text: t.word, message: `"${t.word}": an adverb. A stronger verb often does the work better.` });
      }
    }
    for (const m of masked.matchAll(PASSIVE_RE)) {
      counts.passive++;
      findings.push({ kind: 'passive', from: m.index, to: m.index + m[0].length, text: m[0], message: `"${m[0]}" may be passive voice. Say who did it if that reads better.` });
    }
    const fillerRe = new RegExp(`\\b(?:${FILLERS.join('|')})\\b`, 'gi');
    for (const m of masked.matchAll(fillerRe)) {
      counts.fillers++;
      findings.push({ kind: 'filler', from: m.index, to: m.index + m[0].length, text: m[0], message: `"${m[0]}" often adds nothing. Try the sentence without it.` });
    }
    const lower = masked.toLowerCase();
    for (const c of CLICHES) {
      for (let i = lower.indexOf(c); i !== -1; i = lower.indexOf(c, i + c.length)) {
        counts.cliches++;
        findings.push({ kind: 'cliche', from: i, to: i + c.length, text: masked.slice(i, i + c.length), message: `"${masked.slice(i, i + c.length)}" is a worn phrase.` });
      }
    }
  }
  // The same notable word twice close together.
  const window = opts.repeatWindow ?? 30;
  const lastSeen = new Map<string, number>();
  tokens.forEach((t, i) => {
    const low = t.word.toLowerCase().replace(/\u2019/g, "'");
    if (low.length < 5 || STOP.has(low)) return;
    const prev = lastSeen.get(low);
    if (prev !== undefined && i - prev <= window) {
      counts.repeats++;
      findings.push({ kind: 'repeat', from: t.from, to: t.to, text: t.word, message: `"${t.word}" was used ${i - prev} words earlier.` });
    }
    lastSeen.set(low, i);
  });

  const freq = new Map<string, number>();
  for (const t of tokens) {
    const low = t.word.toLowerCase().replace(/\u2019/g, "'");
    if (low.length < 4 || STOP.has(low)) continue;
    freq.set(low, (freq.get(low) ?? 0) + 1);
  }
  const frequent = [...freq.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count }));

  // Words inside quotation marks, as a share of all words.
  let quoted = 0;
  for (const m of masked.matchAll(/[\u201C"][^\u201C\u201D"\n]{1,600}[\u201D"]/g)) quoted += (m[0].match(WORD_RE) ?? []).length;
  const words = tokens.length;
  const totalSyllables = english ? tokens.reduce((n, t) => n + syllables(t.word), 0) : 0;
  const readingEase = english && words > 0 && sentences.length > 0
    ? Math.round((206.835 - 1.015 * (words / sentences.length) - 84.6 * (totalSyllables / words)) * 10) / 10
    : null;
  findings.sort((a, b) => a.from - b.from);
  return {
    words, sentences: sentences.length, paragraphs,
    averageSentenceWords: sentences.length ? Math.round((words / sentences.length) * 10) / 10 : 0,
    readingEase, dialogueShare: words ? Math.round((quoted / words) * 100) / 100 : 0,
    counts, frequent, findings,
  };
}

/* ------------------------------------------------------------------ */
/* Consistency across the manuscript                                    */
/* ------------------------------------------------------------------ */

export interface ConsistencyDoc {
  nodeId: string;
  title: string;
  text: string;
}

export interface Occurrence {
  nodeId: string;
  title: string;
  from: number;
  to: number;
  text: string;
}

export interface ConsistencyIssue {
  id: string;
  title: string;
  detail: string;
  /** The competing forms with how often each appears. */
  forms: { form: string; count: number }[];
  /** Where the less common form appears (the likely slips), at most 50. */
  occurrences: Occurrence[];
}

/** Pairs of forms that mean the same and should not be mixed in one book. */
const VARIANT_PAIRS: [string, string][] = [
  ['towards', 'toward'], ['amongst', 'among'], ['whilst', 'while'], ['alright', 'all right'], ['okay', 'OK'], ['grey', 'gray'], ['learnt', 'learned'], ['dreamt', 'dreamed'], ['spelt', 'spelled'],
  ['burnt', 'burned'], ['leant', 'leaned'], ['judgement', 'judgment'], ['acknowledgement', 'acknowledgment'], ['ageing', 'aging'], ['focussed', 'focused'], ['cosy', 'cozy'], ['storey', 'story'],
  ['programme', 'program'], ['per cent', 'percent'], ['no-one', 'no one'], ['any more', 'anymore'], ['backwards', 'backward'], ['forwards', 'forward'], ['afterwards', 'afterward'],
];

/** British and Australian endings with their American forms, as [pattern, replacement] on the word stem. */
const US_RULES: [RegExp, string][] = [
  [/^(.{3,})ise(d|s|r|rs)?$/, '$1ize$2'], [/^(.{3,})ising$/, '$1izing'], [/^(.{3,})isation(s)?$/, '$1ization$2'],
  [/^(.{2,})our(s|ed|ing|ful|less|able|ite|ites)?$/, '$1or$2'], [/^(.{2,}[^aeiou])re(s|d)?$/, '$1er$2'], [/^(.{3,})lled$/, '$1led'], [/^(.{3,})lling$/, '$1ling'], [/^(.{3,})ller(s)?$/, '$1ler$2'],
  [/^(.{2,})ogue(s)?$/, '$1og$2'], [/^(.{2,})ence$/, '$1ense'],
];
const UK_EXCEPTIONS = new Set(['wise', 'rise', 'arise', 'raise', 'praise', 'noise', 'promise', 'exercise', 'surprise', 'advise', 'devise', 'revise', 'supervise', 'disguise', 'otherwise', 'likewise', 'precise', 'concise', 'premise', 'compromise', 'despise', 'enterprise', 'franchise', 'paradise', 'merchandise', 'expertise', 'treatise', 'four', 'your', 'hour', 'tour', 'pour', 'sour', 'flour', 'contour', 'detour', 'our', 'ours', 'yours', 'hours', 'tours', 'pours', 'devour', 'velour', 'glamour', 'here', 'there', 'where', 'were', 'more', 'before', 'store', 'fire', 'wire', 'care', 'share', 'sure', 'pure', 'cure', 'figure', 'future', 'nature', 'picture', 'culture', 'measure', 'pleasure', 'pressure', 'treasure', 'structure', 'adventure', 'entire', 'desire', 'require', 'acquire', 'inspire', 'admire', 'retire', 'compare', 'prepare', 'declare', 'aware', 'square', 'ignore', 'explore', 'restore', 'score', 'shore', 'bore', 'core', 'wore', 'tore', 'whore', 'chore', 'spare', 'stare', 'rare', 'bare', 'dare', 'fare', 'mare', 'hare', 'scare', 'flare', 'glare', 'snare', 'hire', 'tire', 'dire', 'mire', 'sire', 'spire', 'empire', 'umpire', 'vampire', 'satire', 'attire', 'expire', 'conspire', 'perspire', 'aspire', 'transpire', 'lure', 'manure', 'mature', 'obscure', 'secure', 'endure', 'ensure', 'insure', 'assure', 'allure', 'demure', 'procedure', 'pasture', 'posture', 'gesture', 'texture', 'mixture', 'fixture', 'lecture', 'fracture', 'capture', 'rapture', 'rupture', 'sculpture', 'scripture', 'venture', 'torture', 'nurture', 'feature', 'creature', 'literature', 'temperature', 'signature', 'furniture', 'agriculture', 'architecture', 'departure', 'exposure', 'closure', 'leisure', 'seizure', 'failure', 'injure', 'conjure', 'ogre', 'acre', 'massacre', 'mediocre', 'lucre', 'genre', 'macabre', 'cadre', 'timbre', 'hence', 'fence', 'whence', 'thence', 'sentence', 'silence', 'science', 'absence', 'presence', 'evidence', 'difference', 'experience', 'audience', 'influence', 'violence', 'patience', 'conscience', 'confidence', 'reference', 'preference', 'conference', 'sequence', 'consequence', 'existence', 'intelligence', 'independence', 'residence', 'essence', 'innocence', 'excellence', 'occurrence', 'coincidence', 'correspondence', 'convenience', 'commence', 'pence', 'called', 'filled', 'killed', 'pulled', 'rolled', 'smelled', 'spelled', 'spilled', 'swelled', 'thrilled', 'walled', 'welled', 'yelled', 'stalled', 'skilled', 'drilled', 'grilled', 'chilled', 'billed', 'willed', 'milled', 'tilled', 'dolled', 'polled', 'tolled', 'lolled', 'culled', 'dulled', 'gulled', 'hulled', 'lulled', 'mulled', 'nulled', 'belled', 'celled', 'felled', 'gelled', 'jelled', 'quelled', 'shelled', 'dwelled', 'knelled', 'calling', 'filling', 'killing', 'pulling', 'rolling', 'selling', 'telling', 'falling', 'willing', 'spelling', 'smelling', 'swelling', 'dwelling', 'yelling', 'thrilling', 'chilling', 'drilling', 'billing', 'ceiling', 'stalling', 'installing', 'appalling', 'shilling', 'darling', 'sterling', 'sibling', 'duckling', 'seller', 'teller', 'caller', 'killer', 'filler', 'miller', 'roller', 'smaller', 'taller', 'stroller', 'dweller', 'speller', 'thriller', 'propeller', 'cellar', 'stellar', 'pillar', 'dollar', 'collar', 'rogue', 'vogue', 'tongue', 'league', 'plague', 'vague', 'fatigue', 'intrigue', 'colleague']);

const occ = (doc: ConsistencyDoc, from: number, to: number): Occurrence => ({ nodeId: doc.nodeId, title: doc.title, from, to, text: doc.text.slice(from, to) });

/**
 * extra: issues found elsewhere that belong in the same list (the story
 * bible's wrong spellings). They are shown first.
 */
export function checkConsistency(docs: ConsistencyDoc[], style: TextStyle, extra: ConsistencyIssue[] = []): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [...extra];
  const masked = docs.map((d) => ({ doc: d, text: maskMarkdown(d.text, { hideDeletions: true }) }));
  const american = style.spelling === 'en-US';
  const english = /^en/i.test(style.spelling);

  /** Every place a pattern matches, per document. */
  const findAll = (re: RegExp): Occurrence[] => {
    const out: Occurrence[] = [];
    for (const { doc, text } of masked) for (const m of text.matchAll(re)) out.push(occ(doc, m.index, m.index + m[0].length));
    return out;
  };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}-])${esc(w)}(?![\\p{L}\\p{N}-])`, 'giu');

  if (english) {
    // 1. Pairs of interchangeable forms.
    for (const [a, b] of VARIANT_PAIRS) {
      const fa = findAll(wordRe(a));
      // "story" is far more often the tale than a floor, and "program" can be a computer program: only compare when both are plausible.
      const fb = b === 'story' || b === 'OK' ? findAll(new RegExp(`(?<![\\p{L}\\p{N}-])${esc(b)}(?![\\p{L}\\p{N}-])`, b === 'OK' ? 'gu' : 'giu')) : findAll(wordRe(b));
      if (b === 'story' || fa.length === 0 || fb.length === 0) continue;
      const [minor, major, minorForm] = fa.length <= fb.length ? [fa, fb, a] : [fb, fa, b];
      issues.push({
        id: `variant-${a}`, title: `"${a}" and "${b}"`,
        detail: `Both forms are used. Pick one; "${minorForm}" is the rarer one here.`,
        forms: [{ form: a, count: fa.length }, { form: b, count: fb.length }],
        occurrences: minor.slice(0, 50),
      });
      void major;
    }

    // 2. Spelling variety: words in the other variety's spelling, or both spellings of one word.
    const counts = new Map<string, { count: number; places: Occurrence[] }>();
    for (const { doc, text } of masked) {
      for (const m of text.matchAll(/[\p{L}]{5,}/gu)) {
        const low = m[0].toLowerCase();
        const e = counts.get(low) ?? { count: 0, places: [] };
        e.count++;
        if (e.places.length < 50) e.places.push(occ(doc, m.index, m.index + m[0].length));
        counts.set(low, e);
      }
    }
    const pairs: { uk: string; us: string }[] = [];
    for (const word of counts.keys()) {
      if (UK_EXCEPTIONS.has(word)) continue;
      for (const [re, rep] of US_RULES) {
        if (!re.test(word)) continue;
        const us = word.replace(re, rep);
        if (us !== word && counts.has(us) && !UK_EXCEPTIONS.has(us)) pairs.push({ uk: word, us });
        break;
      }
    }
    for (const { uk, us } of pairs) {
      const a = counts.get(uk)!;
      const b = counts.get(us)!;
      const wrong = american ? a : b;
      issues.push({
        id: `spelling-${uk}`, title: `"${uk}" and "${us}"`,
        detail: `Both spellings appear. Your book uses ${american ? 'American' : style.spelling === 'en-GB' ? 'British' : 'Australian'} spelling, so "${american ? us : uk}" is the one to keep.`,
        forms: [{ form: uk, count: a.count }, { form: us, count: b.count }],
        occurrences: wrong.places,
      });
    }

    // 3. Hyphenated and closed forms of the same compound (e-mail, email).
    const hyphenated = new Map<string, Occurrence[]>();
    for (const { doc, text } of masked) {
      for (const m of text.matchAll(/(?<![\p{L}-])[\p{L}]{1,}-[\p{L}]{2,}(?![\p{L}-])/gu)) {
        const key = m[0].toLowerCase();
        hyphenated.set(key, [...(hyphenated.get(key) ?? []), occ(doc, m.index, m.index + m[0].length)]);
      }
    }
    for (const [form, places] of hyphenated) {
      const closed = counts.get(form.replace('-', ''));
      if (!closed) continue;
      const minor = places.length <= closed.count ? places : closed.places;
      issues.push({
        id: `hyphen-${form}`, title: `"${form}" and "${form.replace('-', '')}"`,
        detail: 'The same word is written with and without a hyphen.',
        forms: [{ form, count: places.length }, { form: form.replace('-', ''), count: closed.count }],
        occurrences: minor.slice(0, 50),
      });
    }

    // 4. Titles with and without a full stop (Dr and Dr.).
    for (const title of ['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'St']) {
      const withDot = findAll(new RegExp(`(?<![\\p{L}])${title}\\.(?=\\s+\\p{Lu})`, 'gu'));
      const without = findAll(new RegExp(`(?<![\\p{L}])${title}(?=\\s+\\p{Lu})`, 'gu'));
      if (withDot.length === 0 || without.length === 0) continue;
      const minor = withDot.length <= without.length ? withDot : without;
      issues.push({
        id: `title-${title}`, title: `"${title}" and "${title}."`,
        detail: `Australian and British style writes ${title} without a full stop, American style with one. Both are used here.`,
        forms: [{ form: title, count: without.length }, { form: `${title}.`, count: withDot.length }],
        occurrences: minor.slice(0, 50),
      });
    }
  }

  // 5. Small numbers as digits in running text, when the house style spells them out.
  if (style.spellOutNumbersBelow > 0) {
    const digits: Occurrence[] = [];
    for (const { doc, text } of masked) {
      for (const m of text.matchAll(/(?<![\p{L}\p{N}.,:/$£€#-])\d{1,3}(?![\p{L}\p{N}.,:/%-]|\s?(?:am|pm|a\.m|p\.m|percent|per cent|kg|km|cm|mm|ml|mg)\b)/giu)) {
        if (Number(m[0]) < style.spellOutNumbersBelow) digits.push(occ(doc, m.index, m.index + m[0].length));
      }
    }
    if (digits.length) {
      issues.push({
        id: 'numbers', title: 'Small numbers written as digits',
        detail: `Your house style spells out numbers below ${style.spellOutNumbersBelow}. These are written as digits.`,
        forms: [{ form: 'digits', count: digits.length }], occurrences: digits.slice(0, 50),
      });
    }
  }

  // 6. Quotation marks: both kinds used to open speech.
  const doubles = findAll(/(?<=^|[\s(\u2014\u2013-])[\u201C"](?=\p{L})/gmu);
  const singles = findAll(/(?<=^|[\s(\u2014\u2013-])[\u2018'](?=\p{Lu})/gmu);
  if (doubles.length > 5 && singles.length > 5) {
    const minor = doubles.length <= singles.length ? doubles : singles;
    if (minor.length / (doubles.length + singles.length) > 0.03) {
      issues.push({
        id: 'quotes', title: 'Double and single quotation marks',
        detail: `Speech opens with double marks ${doubles.length} times and with single marks ${singles.length} times. Your house style is ${style.quoteStyle}.`,
        forms: [{ form: 'double', count: doubles.length }, { form: 'single', count: singles.length }],
        occurrences: (style.quoteStyle === 'double' ? singles : doubles).slice(0, 50),
      });
    }
  }

  // 7. Names that differ by one letter (Farid and Fareed): a likely slip in a long manuscript.
  const names = new Map<string, { count: number; places: Occurrence[] }>();
  for (const { doc, text } of masked) {
    for (const m of text.matchAll(/(?<=[\p{Ll},;]\s)\p{Lu}[\p{Ll}]{3,}/gu)) {
      const e = names.get(m[0]) ?? { count: 0, places: [] };
      e.count++;
      if (e.places.length < 50) e.places.push(occ(doc, m.index, m.index + m[0].length));
      names.set(m[0], e);
    }
  }
  const list = [...names.entries()].filter(([, v]) => v.count >= 1).sort((a, b) => b[1].count - a[1].count).slice(0, 400);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, va] = list[i];
      const [b, vb] = list[j];
      if (Math.abs(a.length - b.length) > 2 || a[0] !== b[0]) continue;
      if (va.count < 3 || vb.count > Math.max(2, va.count / 5)) continue; // one common form, one rare form
      if (editDistanceOne(a, b) || nameKey(a) === nameKey(b)) {
        issues.push({
          id: `name-${a}-${b}`, title: `"${a}" and "${b}"`,
          detail: `These names are almost the same. "${b}" appears only ${vb.count === 1 ? 'once' : `${vb.count} times`}: is it a slip for "${a}"?`,
          forms: [{ form: a, count: va.count }, { form: b, count: vb.count }],
          occurrences: vb.places,
        });
      }
    }
  }
  return issues;
}

/**
 * A name reduced to how it sounds, so that different ways of writing the same
 * name in Latin letters compare equal (Farid and Fareed, Nur and Noor,
 * Rahman and Rahmaan).
 */
export function nameKey(name: string): string {
  return name.toLowerCase()
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'u').replace(/aa/g, 'a').replace(/y/g, 'i').replace(/ph/g, 'f')
    .replace(/([a-z])\1+/g, '$1').replace(/h$/, '');
}

/** True when two different words are one insertion, deletion or substitution apart. */
export function editDistanceOne(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}
