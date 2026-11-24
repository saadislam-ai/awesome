/** Book details: title, people, publisher, copyright and the house style for text. */
import { Plus, Trash2 } from 'lucide-react';
import { LANGUAGES, changeBookLanguage, languageInfo } from '@borderless/core';
import { LanguageNotes, LanguageSelect } from '../../ui/language';
import { useBookEditor } from '../../ui/useBook';
import { Field, Seg } from '../../ui/kit';

/** Spelling dictionaries: the three English ones, the ones bundled for other languages, and Bangla (added to the library). */
const SPELLING: [string, string][] = [
  ['en-AU', 'Australian English'], ['en-GB', 'British English'], ['en-US', 'American English'],
  ...LANGUAGES.filter((l) => l.dictionary && l.code !== 'en').map((l) => [l.dictionary!, l.name] as [string, string]),
  ['bn', 'Bangla'],
];
const ROLES = ['author', 'editor', 'illustrator', 'translator', 'foreword', 'introduction', 'contributor'];

export function DetailsTab() {
  const { book, update } = useBookEditor();
  const lang = languageInfo(book.language);
  return (
    <div className="page-narrow">
      <div className="card">
        <h2>Title</h2>
        <div className="grid2">
          <Field label="Title"><input className="input" value={book.title} onChange={(e) => update((b) => { b.title = e.target.value; })} /></Field>
          <Field label="Subtitle"><input className="input" value={book.subtitle} onChange={(e) => update((b) => { b.subtitle = e.target.value; })} /></Field>
          <Field label="Series" hint="Leave empty for a standalone book.">
            <input className="input" value={book.series?.name ?? ''} onChange={(e) => update((b) => { b.series = e.target.value ? { id: b.series?.id ?? '', name: e.target.value, number: b.series?.number ?? null } : null; })} />
          </Field>
          <Field label="Number in the series">
            <input className="input" type="number" min={1} disabled={!book.series} value={book.series?.number ?? ''} onChange={(e) => update((b) => { if (b.series) b.series.number = e.target.value ? Number(e.target.value) : null; })} />
          </Field>
          <Field label="Language of the text">
            <LanguageSelect value={book.language} onChange={(tag) => update((b) => { changeBookLanguage(b, tag); })} />
          </Field>
          <Field label="Planned publication date"><input className="input" type="date" value={book.publicationDate} onChange={(e) => update((b) => { b.publicationDate = e.target.value; })} /></Field>
        </div>
        <LanguageNotes language={book.language} platforms={[...new Set(book.formats.filter((f) => f.enabled).flatMap((f) => f.platforms))]} />
      </div>

      <div className="card">
        <div className="row"><h2 className="grow" style={{ margin: 0 }}>People</h2>
          <button className="btn small" onClick={() => update((b) => { b.contributors.push({ role: 'author', name: '', sortName: '', bio: '', website: '' }); })}><Plus size={13} /> Add a person</button>
        </div>
        {book.contributors.map((c, i) => (
          <div className="row" key={i} style={{ marginTop: 8, alignItems: 'flex-end' }}>
            <div style={{ width: 150 }}>
              <Field label={i === 0 ? 'Role' : ''}>
                <select className="select" value={c.role} onChange={(e) => update((b) => { b.contributors[i].role = e.target.value as typeof c.role; })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <div className="grow"><Field label={i === 0 ? 'Name as printed' : ''}><input className="input" value={c.name} onChange={(e) => update((b) => { b.contributors[i].name = e.target.value; })} /></Field></div>
            <div className="grow"><Field label={i === 0 ? 'Name for sorting (Surname, Given)' : ''}><input className="input" value={c.sortName} onChange={(e) => update((b) => { b.contributors[i].sortName = e.target.value; })} /></Field></div>
            <button className="btn ghost icon" title="Remove" disabled={book.contributors.length <= 1} onClick={() => update((b) => { b.contributors.splice(i, 1); })}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Publisher and copyright</h2>
        <div className="grid3">
          <Field label="Imprint"><input className="input" value={book.imprint} onChange={(e) => update((b) => { b.imprint = e.target.value; })} /></Field>
          <Field label="City"><input className="input" value={book.publisherCity} onChange={(e) => update((b) => { b.publisherCity = e.target.value; })} /></Field>
          <Field label="Country"><input className="input" value={book.publisherCountry} onChange={(e) => update((b) => { b.publisherCountry = e.target.value; })} /></Field>
          <Field label="Website"><input className="input" value={book.publisherWebsite} onChange={(e) => update((b) => { b.publisherWebsite = e.target.value; })} /></Field>
          <Field label="Copyright year"><input className="input" type="number" value={book.copyright.year} onChange={(e) => update((b) => { b.copyright.year = Number(e.target.value) || b.copyright.year; })} /></Field>
          <Field label="Copyright holder"><input className="input" value={book.copyright.holder} onChange={(e) => update((b) => { b.copyright.holder = e.target.value; })} /></Field>
          <Field label="Edition number"><input className="input" type="number" min={1} value={book.editionNumber} onChange={(e) => update((b) => { b.editionNumber = Math.max(1, Number(e.target.value) || 1); })} /></Field>
          <Field label="Edition statement" hint='Printed on the copyright page, for example "First edition".'><input className="input" value={book.editionStatement} onChange={(e) => update((b) => { b.editionStatement = e.target.value; })} /></Field>
        </div>
      </div>

      <div className="card">
        <h2>House style for the text</h2>
        <p className="dim small">These rules are applied when the book is exported. Your manuscript files are not changed by them.</p>
        <div className="grid3">
          <Field label="Spelling">
            <select className="select" value={book.style.spelling} onChange={(e) => update((b) => { b.style.spelling = e.target.value; })}>
              {!SPELLING.some(([v]) => v === book.style.spelling) && <option value={book.style.spelling}>{languageInfo(book.style.spelling).name} (dictionary added to the library)</option>}
              {SPELLING.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Field>
          {lang.nativeDigits && (
            <Field label="Numbers" hint="Page numbers, chapter numbers and the year.">
              <select className="select" value={book.style.digits} onChange={(e) => update((b) => { b.style.digits = e.target.value as typeof b.style.digits; })}>
                <option value="auto">As usual in {lang.name}</option><option value="native">{lang.name} digits</option><option value="latin">0 to 9</option>
              </select>
            </Field>
          )}
          <Field label="Quotation marks">
            <Seg value={book.style.quoteStyle} onChange={(v) => update((b) => { b.style.quoteStyle = v; })} options={[{ value: 'double', label: '\u201CDouble\u201D' }, { value: 'single', label: '\u2018Single\u2019' }]} />
            {lang.code !== 'en' && <div className="small dim" style={{ marginTop: 4 }}>{lang.name} books print {lang.quotes.open}{lang.name}{lang.quotes.close} marks; type ordinary quotes and they are converted on export.</div>}
          </Field>
          <Field label="Ellipsis">
            <select className="select" value={book.style.ellipsis} onChange={(e) => update((b) => { b.style.ellipsis = e.target.value as typeof b.style.ellipsis; })}>
              <option value="character">One character</option><option value="spaced-dots">Three spaced dots</option><option value="leave">Leave as typed</option>
            </select>
          </Field>
        </div>
        <label className="check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={book.style.smartQuotes} onChange={(e) => update((b) => { b.style.smartQuotes = e.target.checked; })} /> Turn straight quotes into curly quotes
        </label>
        <h3 style={{ marginTop: 16 }}>Long dashes</h3>
        <Seg
          value={book.style.dashPolicy.mode}
          onChange={(v) => update((b) => { b.style.dashPolicy.mode = v; })}
          options={[
            { value: 'flag', label: 'Flag them', title: 'Every long dash is listed in the Review panel and in preflight, so you can rewrite the sentence' },
            { value: 'replace', label: 'Replace them', title: 'Long dashes are replaced automatically when the book is exported' },
            { value: 'allow', label: 'Allow them', title: 'Dashes are left alone' },
          ]}
        />
        {book.style.dashPolicy.mode === 'replace' && (
          <div className="grid2" style={{ marginTop: 10 }}>
            <Field label="A long dash in a sentence becomes">
              <select className="select" value={book.style.dashPolicy.emDashReplacement} onChange={(e) => update((b) => { b.style.dashPolicy.emDashReplacement = e.target.value as typeof b.style.dashPolicy.emDashReplacement; })}>
                <option value="comma">a comma</option><option value="spaced-hyphen">a hyphen with spaces</option><option value="colon">a colon</option><option value="ellipsis">an ellipsis</option>
              </select>
            </Field>
            <Field label="A dash between numbers (1990 to 1995) becomes">
              <select className="select" value={book.style.dashPolicy.enDashRangeReplacement} onChange={(e) => update((b) => { b.style.dashPolicy.enDashRangeReplacement = e.target.value as typeof b.style.dashPolicy.enDashRangeReplacement; })}>
                <option value="hyphen">a hyphen</option><option value="to">the word "to"</option>
              </select>
            </Field>
          </div>
        )}
        {book.style.dashPolicy.mode !== 'allow' && (
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={book.style.dashPolicy.includeTypedHyphens} onChange={(e) => update((b) => { b.style.dashPolicy.includeTypedHyphens = e.target.checked; })} /> Treat two or three hyphens typed in a row the same way
          </label>
        )}
      </div>
    </div>
  );
}
