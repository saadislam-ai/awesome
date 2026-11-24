/** The language picker and the notes that go with a language: which stores refuse it, and what the author must add. */
import { AlertTriangle, Info } from 'lucide-react';
import { languageChoices, languageInfo, languageRefusals, languageRefusalText, type PlatformId } from '@borderless/core';
import { useStore } from '../state/store';

const CHOICES = languageChoices();

export function LanguageSelect({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {!CHOICES.some(([tag]) => tag === value) && <option value={value}>{value}</option>}
      {CHOICES.map(([tag, label]) => <option key={tag} value={tag}>{label}</option>)}
    </select>
  );
}

/** Warnings for a language: stores that refuse it (only for the given platforms, when given) and fonts to add. */
export function languageNotes(platformsSpecs: Parameters<typeof languageRefusals>[0] | undefined, language: string, platforms?: PlatformId[]): { text: string; warn: boolean }[] {
  const lang = languageInfo(language);
  const out: { text: string; warn: boolean }[] = [];
  const refusals = languageRefusals(platformsSpecs ?? {}, language).filter((r) => !platforms || platforms.includes(r.platform));
  if (refusals.length) out.push({ text: `${languageRefusalText(refusals, lang.name)} Preflight checks this for every edition.`, warn: true });
  if (lang.script === 'cjk') {
    out.push({ text: `Fonts for ${lang.name} are too large to ship with the app. Put an OpenType font for ${lang.name} (for example a Noto Serif CJK font) in the book's fonts folder before exporting; the typesetter finds it there.`, warn: true });
  }
  if (lang.dir === 'rtl') out.push({ text: `${lang.name} books are set right to left and bound on the right: page 1 is a left hand page and ebooks turn pages to the left.`, warn: false });
  return out;
}

export function LanguageNotes({ language, platforms }: { language: string; platforms?: PlatformId[] }) {
  const specs = useStore((s) => s.specs);
  const notes = languageNotes(specs?.platforms, language, platforms);
  return (
    <>
      {notes.map((n) => <div className={`notice small${n.warn ? ' warn' : ''}`} key={n.text} style={{ marginTop: 10 }}>{n.warn ? <AlertTriangle size={15} /> : <Info size={15} />}{n.text}</div>)}
    </>
  );
}
