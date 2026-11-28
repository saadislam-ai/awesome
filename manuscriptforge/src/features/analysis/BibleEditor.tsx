import { Lock, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAi } from '../../app/ai';
import { useApp } from '../../app/context';
import { emptyBible, type BibleCharacter, type BookBible } from '../../core/analysis/bible';
import type { BookKind } from '../../core/analysis/deep';
import { Button, IconButton } from '../../ui/components';

/** A text box for a list ("grief, family, the sea"): the list is updated when the box loses focus. */
function ListInput({ value, onCommit, label, placeholder, separator = ',' }: { value: string[]; onCommit(next: string[]): void; label: string; placeholder?: string; separator?: ',' | '\n' }) {
  const joined = value.join(separator === ',' ? ', ' : '\n');
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const commit = () => {
    const next = text.split(separator === ',' ? /[,;\n]/ : /\n/).map((s) => s.trim()).filter(Boolean);
    if (next.join('|') !== value.join('|')) onCommit(next);
  };
  return separator === ','
    ? <input value={text} aria-label={label} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    : <textarea value={text} aria-label={label} placeholder={placeholder} rows={3} onChange={(e) => setText(e.target.value)} onBlur={commit} />;
}

function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card bible-section">
      <div className="bible-section-head">
        <div>
          <h3>{title}</h3>
          {hint && <p className="fine-print">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const LOCK_HINT = 'You edited this entry. A new analysis will keep it as it is.';

/**
 * The Book Bible, editable. What the analysis found can be corrected here,
 * and entries can be added by hand. Corrected entries are marked so that a
 * later analysis does not overwrite them. Changes save by themselves.
 */
export function BibleEditor({ bookId, kind, version }: { bookId: string; kind: BookKind; version: number }) {
  const { analyses } = useAi();
  const { reportError } = useApp();
  const [bible, setBible] = useState<BookBible | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const latest = useRef<BookBible | null>(null);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  // Load, and reload when an analysis has updated the Bible, unless there are unsaved edits.
  useEffect(() => {
    if (dirty.current) return;
    let cancelled = false;
    analyses
      .getBible(bookId)
      .then((stored) => {
        if (cancelled || dirty.current) return;
        const next = stored ?? emptyBible();
        latest.current = next;
        setBible(next);
      })
      .catch((e) => reportError('analysis', e, 'The Book Bible could not be loaded.'));
    return () => {
      cancelled = true;
    };
  }, [analyses, bookId, version, reportError]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      await analyses.saveBible(bookId, latest.current);
      if (!dirty.current) setSaveState('saved');
    } catch (e) {
      dirty.current = true;
      setSaveState('error');
      reportError('analysis', e, 'The Book Bible could not be saved.');
    }
  }, [analyses, bookId, reportError]);

  useEffect(() => () => void flush(), [flush]);

  const change = (mutate: (draft: BookBible) => void) => {
    if (!latest.current) return;
    const next = structuredClone(latest.current);
    mutate(next);
    latest.current = next;
    dirty.current = true;
    setBible(next);
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 600);
  };

  if (!bible) return null;
  const story = kind !== 'nonfiction';
  const empty = !bible.summary && !bible.characters.length && !bible.settings.length && !bible.glossary.length && !bible.timeline.length;
  const numbers = bible.voice.numbers;

  const setCharacter = (index: number, patch: Partial<BibleCharacter>) => change((d) => Object.assign(d.characters[index], patch, { locked: true }));

  return (
    <div className="bible" data-testid="bible-editor">
      <div className="bible-top">
        <p className="muted">
          The Book Bible is what the AI editor is told about this book before it touches a passage, so that names, facts and the author's voice stay consistent.
          Correct anything that is wrong. Changes save by themselves.
        </p>
        <span className={`save-state ${saveState === 'error' ? 'save-error' : 'save-saved'}`} data-testid="bible-save-state">
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Not saved'}
        </span>
      </div>
      {empty && (
        <p className="notice notice-info">
          Nothing here yet. Run the full analysis and the AI fills this in as it reads the book. You can also add entries yourself.
        </p>
      )}

      <Section title="About the book">
        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">Summary</span>
            <textarea rows={3} value={bible.summary} onChange={(e) => change((d) => void (d.summary = e.target.value))} placeholder="What the book is about, in a few sentences." />
          </label>
          <label className="field">
            <span className="field-label">{story ? 'Point of view' : 'Voice'}</span>
            <input value={bible.pov} onChange={(e) => change((d) => void (d.pov = e.target.value))} placeholder={story ? 'For example: third person, close on Mara' : 'For example: first person, addresses the reader as "you"'} />
          </label>
          <label className="field">
            <span className="field-label">Tense</span>
            <input value={bible.tense} onChange={(e) => change((d) => void (d.tense = e.target.value))} placeholder="past or present" />
          </label>
          <label className="field">
            <span className="field-label">Tone</span>
            <input value={bible.tone} onChange={(e) => change((d) => void (d.tone = e.target.value))} placeholder="For example: warm, dry humor" />
          </label>
          <label className="field">
            <span className="field-label">Themes</span>
            <ListInput label="Themes" value={bible.themes} onCommit={(next) => change((d) => void (d.themes = next))} placeholder="Separate with commas" />
          </label>
        </div>
      </Section>

      <Section
        title={story ? 'Characters' : 'People and organisations'}
        hint="Names are protected during editing: the AI is told to spell them exactly like this."
        action={
          <Button
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => change((d) => void d.characters.unshift({ name: '', aliases: [], role: 'supporting', description: '', arc: '', mentions: 0, firstChapter: 0, locked: true }))}
          >
            Add
          </Button>
        }
      >
        {bible.characters.length === 0 && <p className="muted">None recorded.</p>}
        <ul className="bible-list">
          {bible.characters.map((character, index) => (
            <li key={index} className="bible-entry" data-testid="bible-character">
              <div className="bible-entry-row">
                <input className="bible-name" value={character.name} aria-label="Name" placeholder="Name" onChange={(e) => setCharacter(index, { name: e.target.value })} />
                <select value={character.role} aria-label={`Role of ${character.name || 'this entry'}`} onChange={(e) => setCharacter(index, { role: e.target.value as BibleCharacter['role'] })}>
                  <option value="main">Main</option>
                  <option value="supporting">Supporting</option>
                  <option value="minor">Minor</option>
                </select>
                {character.firstChapter > 0 && <span className="muted">first seen in chapter {character.firstChapter}</span>}
                {character.locked && <span className="lock-mark" title={LOCK_HINT}><Lock size={12} /> kept</span>}
                <span className="grow" />
                <IconButton label={`Remove ${character.name || 'this entry'}`} onClick={() => change((d) => void d.characters.splice(index, 1))}><Trash2 size={14} /></IconButton>
              </div>
              <div className="bible-field">
                <span aria-hidden="true">Also called</span>
                <ListInput label={`Other names for ${character.name || 'this entry'}`} value={character.aliases} onCommit={(next) => setCharacter(index, { aliases: next })} placeholder="Other names or nicknames, separated with commas" />
              </div>
              <div className="bible-field">
                <span aria-hidden="true">Description</span>
                <textarea rows={2} value={character.description} aria-label={`Description of ${character.name || 'this entry'}`} placeholder="Who they are: age, looks, job, manner of speaking…" onChange={(e) => setCharacter(index, { description: e.target.value })} />
              </div>
              {story && (
                <div className="bible-field">
                  <span aria-hidden="true">How they change</span>
                  <textarea rows={2} value={character.arc} aria-label={`How ${character.name || 'this character'} changes`} placeholder="How they change over the book" onChange={(e) => setCharacter(index, { arc: e.target.value })} />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {(story || bible.relationships.length > 0) && (
        <Section
          title="Relationships"
          action={<Button size="sm" icon={<Plus size={14} />} onClick={() => change((d) => void d.relationships.unshift({ a: '', b: '', relation: '' }))}>Add</Button>}
        >
          {bible.relationships.length === 0 && <p className="muted">None recorded.</p>}
          <ul className="bible-list">
            {bible.relationships.map((r, index) => (
              <li key={index} className="bible-entry-row">
                <input value={r.a} aria-label="First person" placeholder="Name" onChange={(e) => change((d) => void (d.relationships[index].a = e.target.value))} />
                <input className="grow" value={r.relation} aria-label="Relationship" placeholder="is the sister of, works for, distrusts…" onChange={(e) => change((d) => void (d.relationships[index].relation = e.target.value))} />
                <input value={r.b} aria-label="Second person" placeholder="Name" onChange={(e) => change((d) => void (d.relationships[index].b = e.target.value))} />
                <IconButton label="Remove this relationship" onClick={() => change((d) => void d.relationships.splice(index, 1))}><Trash2 size={14} /></IconButton>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Places"
        action={<Button size="sm" icon={<Plus size={14} />} onClick={() => change((d) => void d.settings.unshift({ name: '', description: '', locked: true }))}>Add</Button>}
      >
        {bible.settings.length === 0 && <p className="muted">None recorded.</p>}
        <ul className="bible-list">
          {bible.settings.map((s, index) => (
            <li key={index} className="bible-entry-row">
              <input className="bible-name" value={s.name} aria-label="Place" placeholder="Place" onChange={(e) => change((d) => Object.assign(d.settings[index], { name: e.target.value, locked: true }))} />
              <input className="grow" value={s.description} aria-label={`Description of ${s.name || 'this place'}`} placeholder="What it is like" onChange={(e) => change((d) => Object.assign(d.settings[index], { description: e.target.value, locked: true }))} />
              {s.locked && <span className="lock-mark" title={LOCK_HINT}><Lock size={12} /> kept</span>}
              <IconButton label={`Remove ${s.name || 'this place'}`} onClick={() => change((d) => void d.settings.splice(index, 1))}><Trash2 size={14} /></IconButton>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Special words and terms"
        hint="Invented words, technical terms and anything that must always be written the same way."
        action={<Button size="sm" icon={<Plus size={14} />} onClick={() => change((d) => void d.glossary.unshift({ term: '', meaning: '', locked: true }))}>Add</Button>}
      >
        {bible.glossary.length === 0 && <p className="muted">None recorded.</p>}
        <ul className="bible-list">
          {bible.glossary.map((t, index) => (
            <li key={index} className="bible-entry-row">
              <input className="bible-name" value={t.term} aria-label="Term" placeholder="Term" onChange={(e) => change((d) => Object.assign(d.glossary[index], { term: e.target.value, locked: true }))} />
              <input className="grow" value={t.meaning} aria-label={`Meaning of ${t.term || 'this term'}`} placeholder="What it means" onChange={(e) => change((d) => Object.assign(d.glossary[index], { meaning: e.target.value, locked: true }))} />
              {t.locked && <span className="lock-mark" title={LOCK_HINT}><Lock size={12} /> kept</span>}
              <IconButton label={`Remove ${t.term || 'this term'}`} onClick={() => change((d) => void d.glossary.splice(index, 1))}><Trash2 size={14} /></IconButton>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Timeline"
        hint="What happens when. Useful for catching continuity errors."
        action={<Button size="sm" icon={<Plus size={14} />} onClick={() => change((d) => void d.timeline.push({ chapter: 0, when: '', what: '' }))}>Add</Button>}
      >
        {bible.timeline.length === 0 && <p className="muted">None recorded.</p>}
        <ul className="bible-list">
          {bible.timeline.map((event, index) => (
            <li key={index} className="bible-entry-row">
              <label className="bible-chapter-no">
                <span className="muted">Ch.</span>
                <input type="number" min={0} value={event.chapter || ''} aria-label="Chapter number" onChange={(e) => change((d) => void (d.timeline[index].chapter = Number(e.target.value) || 0))} />
              </label>
              <input value={event.when} aria-label="When" placeholder="When" onChange={(e) => change((d) => void (d.timeline[index].when = e.target.value))} />
              <input className="grow" value={event.what} aria-label="What happens" placeholder="What happens" onChange={(e) => change((d) => void (d.timeline[index].what = e.target.value))} />
              <IconButton label="Remove this event" onClick={() => change((d) => void d.timeline.splice(index, 1))}><Trash2 size={14} /></IconButton>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="The author's voice" hint="The AI editor is asked to match this, so that edits sound like the author and not like a machine.">
        <div className="form-grid">
          <label className="field span-2">
            <span className="field-label">How the author writes</span>
            <textarea rows={3} value={bible.voice.description} onChange={(e) => change((d) => void (d.voice.description = e.target.value))} placeholder="For example: short declarative sentences, concrete nouns, little description, dry asides." />
          </label>
          <label className="field">
            <span className="field-label">Dialogue</span>
            <textarea rows={3} value={bible.voice.dialogueStyle} onChange={(e) => change((d) => void (d.voice.dialogueStyle = e.target.value))} placeholder="How people speak in this book" />
          </label>
          <label className="field">
            <span className="field-label">Habits and devices (one per line)</span>
            <ListInput label="Habits and devices" separator={'\n'} value={bible.voice.devices} onCommit={(next) => change((d) => void (d.voice.devices = next))} placeholder="One-line paragraphs for emphasis" />
          </label>
        </div>
        {numbers && (
          <dl className="facts voice-facts">
            <div><dt>Average sentence</dt><dd>{numbers.avgSentenceWords} words</dd></div>
            <div><dt>Short sentences</dt><dd>{Math.round(numbers.shortShare * 100)}%</dd></div>
            <div><dt>Long sentences</dt><dd>{Math.round(numbers.longShare * 100)}%</dd></div>
            <div><dt>Average paragraph</dt><dd>{numbers.avgParagraphWords} words</dd></div>
            <div><dt>Dialogue</dt><dd>{Math.round(numbers.dialogueShare * 100)}% of the text</dd></div>
            <div><dt>Vocabulary range</dt><dd>{numbers.vocabularyRange} distinct words per 1,000</dd></div>
            {numbers.contractions !== null && <div><dt>Contractions</dt><dd>{numbers.contractions} per 1,000 words</dd></div>}
            {numbers.favouriteWords.length > 0 && <div><dt>Favourite words</dt><dd>{numbers.favouriteWords.slice(0, 12).join(', ')}</dd></div>}
          </dl>
        )}
      </Section>
    </div>
  );
}
