/**
 * Interior design: the six templates and every setting behind them, next to a
 * live preview of the real pages.
 */
import { useState, type ReactNode } from 'react';
import {
  FONT_CATALOG, TEMPLATE_IDS, TEMPLATE_PRESETS, designFromTemplate, type Book, type Design,
} from '@borderless/core';
import { useBookEditor } from '../../ui/useBook';
import { Field, Seg } from '../../ui/kit';
import { PagePreview } from './PagePreview';

type D = Design;

function Group(props: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="group" open={props.open}>
      <summary>{props.title}</summary>
      <div className="group-body">{props.children}</div>
    </details>
  );
}

function Num(props: { label: string; value: number; min?: number; max?: number; step?: number; hint?: string; onChange: (v: number) => void }) {
  return (
    <Field label={props.label} hint={props.hint}>
      <input className="input" type="number" min={props.min} max={props.max} step={props.step ?? 1} value={props.value}
        onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v)) props.onChange(v); }} />
    </Field>
  );
}

function Sel<T extends string>(props: { label: string; value: T; options: [T, string][]; hint?: string; onChange: (v: T) => void }) {
  return (
    <Field label={props.label} hint={props.hint}>
      <select className="select" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

function Check(props: { label: string; checked: boolean; title?: string; onChange: (v: boolean) => void }) {
  return <label className="check" title={props.title}><input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} /> {props.label}</label>;
}

export function DesignTab() {
  const { book, update, rev } = useBookEditor();
  const d = book.design;
  const set = (change: (d: D) => void) => update((b: Book) => change(b.design));
  const printFormats = book.formats.filter((f) => f.type !== 'ebook');
  const [formatId, setFormatId] = useState(printFormats.find((f) => f.enabled)?.id ?? printFormats[0]?.id ?? '');
  const fonts = FONT_CATALOG.map((f) => [f.family, f.family] as [string, string]);
  const custom = d.customMargins ?? { top: 0.8, bottom: 0.9, inside: 0.85, outside: 0.65 };

  return (
    <div className="design">
      <div className="design-controls">
        <Group title="Template" open>
          <div className="templates">
            {TEMPLATE_IDS.map((id) => (
              <button key={id} className={`template${d.template === id ? ' on' : ''}`} title={TEMPLATE_PRESETS[id].description}
                onClick={() => { if (d.template === id || window.confirm(`Switch to the "${TEMPLATE_PRESETS[id].label}" template? The design settings below are replaced by the template's.`)) update((b) => { b.design = designFromTemplate(id); }); }}>
                <b>{TEMPLATE_PRESETS[id].label}</b>
                <span>{TEMPLATE_PRESETS[id].description}</span>
              </button>
            ))}
          </div>
        </Group>

        <Group title="Type" open>
          <div className="grid2">
            <Sel label="Body typeface" value={d.bodyFont} options={fonts} onChange={(v) => set((x) => { x.bodyFont = v; })} />
            <Sel label="Heading typeface" value={d.headingFont} options={fonts} onChange={(v) => set((x) => { x.headingFont = v; })} />
            <Num label="Type size (pt)" value={d.fontSizePt} min={6} max={30} step={0.25} onChange={(v) => set((x) => { x.fontSizePt = v; })} />
            <Num label="Line height" value={d.lineHeight} min={1} max={2.2} step={0.01} hint="Distance between lines, as a multiple of the type size." onChange={(v) => set((x) => { x.lineHeight = v; })} />
            <Sel label="Paragraphs" value={d.paragraphStyle} options={[['indent', 'First line indented'], ['spaced', 'Space between, no indent']]} onChange={(v) => set((x) => { x.paragraphStyle = v; })} />
            <Num label="Indent (em)" value={d.paragraphIndentEm} min={0} max={4} step={0.1} onChange={(v) => set((x) => { x.paragraphIndentEm = v; })} />
            <Sel label="Avoid hyphens" value={d.hyphenAvoidance} options={[['low', 'A little'], ['normal', 'Normally'], ['high', 'As much as possible']]} onChange={(v) => set((x) => { x.hyphenAvoidance = v; })} />
          </div>
          <div className="checks">
            <Check label="Justify the text" checked={d.justify} onChange={(v) => set((x) => { x.justify = v; })} />
            <Check label="Hyphenate" checked={d.hyphenate} onChange={(v) => set((x) => { x.hyphenate = v; })} />
            <Check label="Avoid widows and orphans" title="No single line of a paragraph alone at the top or bottom of a page" checked={d.widowOrphanControl} onChange={(v) => set((x) => { x.widowOrphanControl = v; })} />
            <Check label="Keep lines on a baseline grid" title="Lines on facing pages line up" checked={d.baselineGrid} onChange={(v) => set((x) => { x.baselineGrid = v; })} />
            <Check label="Old style figures in the text" checked={d.oldstyleFigures} onChange={(v) => set((x) => { x.oldstyleFigures = v; })} />
          </div>
        </Group>

        <Group title="Margins">
          <Sel label="Margins" value={d.marginPreset} hint="The inside margin is always raised to the platform minimum for the page count."
            options={[['compact', 'Compact (fewer pages)'], ['comfortable', 'Comfortable'], ['generous', 'Generous'], ['custom', 'My own values']]}
            onChange={(v) => set((x) => { x.marginPreset = v; if (v === 'custom' && !x.customMargins) x.customMargins = { ...custom }; })} />
          {d.marginPreset === 'custom' && (
            <div className="grid2" style={{ marginTop: 8 }}>
              {(['inside', 'outside', 'top', 'bottom'] as const).map((side) => (
                <Num key={side} label={`${side.charAt(0).toUpperCase() + side.slice(1)} (in)`} value={custom[side]} min={0.25} max={2} step={0.01} onChange={(v) => set((x) => { x.customMargins = { ...custom, [side]: v }; })} />
              ))}
            </div>
          )}
        </Group>

        <Group title="Running heads and page numbers">
          <div className="checks"><Check label="Running heads" checked={d.runningHeads.enabled} onChange={(v) => set((x) => { x.runningHeads.enabled = v; })} /></div>
          <div className="grid2">
            <Sel label="Left hand pages show" value={d.runningHeads.verso} options={[['author', 'Author'], ['title', 'Book title'], ['part', 'Part title'], ['chapter', 'Chapter title'], ['none', 'Nothing']]} onChange={(v) => set((x) => { x.runningHeads.verso = v; })} />
            <Sel label="Right hand pages show" value={d.runningHeads.recto} options={[['title', 'Book title'], ['chapter', 'Chapter title'], ['part', 'Part title'], ['none', 'Nothing']]} onChange={(v) => set((x) => { x.runningHeads.recto = v; })} />
            <Sel label="Style" value={d.runningHeads.style} options={[['smallcaps', 'Small capitals'], ['italic', 'Italic'], ['caps', 'Capitals'], ['plain', 'Plain']]} onChange={(v) => set((x) => { x.runningHeads.style = v; })} />
            <Sel label="Position" value={d.runningHeads.align} options={[['center', 'Centred'], ['outside', 'Outside edge']]} onChange={(v) => set((x) => { x.runningHeads.align = v; })} />
            <Num label="Size (pt)" value={d.runningHeads.sizePt} min={6} max={14} step={0.25} onChange={(v) => set((x) => { x.runningHeads.sizePt = v; })} />
            <Sel label="Page numbers" value={d.folio.position} options={[['bottom-center', 'Bottom, centred'], ['bottom-outside', 'Bottom, outside'], ['top-outside', 'Top, outside'], ['none', 'None']]} onChange={(v) => set((x) => { x.folio.position = v; })} />
          </div>
          <div className="checks">
            <Check label="A thin rule under the running head" checked={d.runningHeads.rule} onChange={(v) => set((x) => { x.runningHeads.rule = v; })} />
            <Check label="Page number on chapter opening pages" checked={d.folio.showOnOpeners} onChange={(v) => set((x) => { x.folio.showOnOpeners = v; })} />
          </div>
        </Group>

        <Group title="Chapter openings">
          <div className="grid2">
            <Sel label="Chapters start" value={d.chapterOpener.startOn} options={[['any', 'On the next page'], ['recto', 'On a right hand page']]} onChange={(v) => set((x) => { x.chapterOpener.startOn = v; })} />
            <Num label="Drop from the top" value={d.chapterOpener.sink} min={0} max={0.6} step={0.02} hint="Share of the page height left empty above the heading." onChange={(v) => set((x) => { x.chapterOpener.sink = v; })} />
            <Sel label="Chapter number" value={d.chapterOpener.numberStyle} options={[['none', 'None'], ['arabic', '1'], ['roman', 'I'], ['words', 'One'], ['chapter-arabic', 'Chapter 1'], ['chapter-words', 'Chapter One'], ['chapter-roman', 'Chapter I']]} onChange={(v) => set((x) => { x.chapterOpener.numberStyle = v; })} />
            <Sel label="Number set in" value={d.chapterOpener.numberCase} options={[['smallcaps', 'Small capitals'], ['upper', 'Capitals'], ['as-is', 'As written']]} onChange={(v) => set((x) => { x.chapterOpener.numberCase = v; })} />
            <Num label="Title size (pt)" value={d.chapterOpener.titleSizePt} min={10} max={48} step={0.5} onChange={(v) => set((x) => { x.chapterOpener.titleSizePt = v; })} />
            <Sel label="Title style" value={d.chapterOpener.titleStyle} options={[['regular', 'Regular'], ['italic', 'Italic'], ['bold', 'Bold'], ['smallcaps', 'Small capitals'], ['caps', 'Capitals']]} onChange={(v) => set((x) => { x.chapterOpener.titleStyle = v; })} />
            <Sel label="Heading position" value={d.chapterOpener.align} options={[['center', 'Centred'], ['left', 'Left'], ['right', 'Right']]} onChange={(v) => set((x) => { x.chapterOpener.align = v; })} />
            <Sel label="Ornament" value={d.chapterOpener.ornament} options={[['none', 'None'], ['short-rule', 'Short rule'], ['rule', 'Rule'], ['fleuron', 'Fleuron'], ['diamond', 'Diamond'], ['three-stars', 'Three stars'], ['flourish', 'Flourish']]} onChange={(v) => set((x) => { x.chapterOpener.ornament = v; })} />
            <Sel label="First words" value={d.chapterOpener.leadIn} options={[['none', 'Normal'], ['words', 'First words in small capitals'], ['line', 'First line in small capitals']]} onChange={(v) => set((x) => { x.chapterOpener.leadIn = v; })} />
            <Num label="Lines of space after the heading" value={d.chapterOpener.spaceAfterLines} min={0} max={8} onChange={(v) => set((x) => { x.chapterOpener.spaceAfterLines = v; })} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Check label="Drop capital" checked={d.chapterOpener.dropCap.enabled} onChange={(v) => set((x) => { x.chapterOpener.dropCap.enabled = v; })} />
            {d.chapterOpener.dropCap.enabled && (
              <Seg value={String(d.chapterOpener.dropCap.lines)} onChange={(v) => set((x) => { x.chapterOpener.dropCap.lines = Number(v); })} options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} lines` }))} />
            )}
          </div>
        </Group>

        <Group title="Scene breaks, notes and headings">
          <div className="grid2">
            <Sel label="Scene break" value={d.sceneBreak.style} options={[['space', 'Blank space'], ['asterisks', 'Three asterisks'], ['asterism', 'Asterism'], ['fleuron', 'Fleuron'], ['diamond', 'Diamond'], ['rule', 'Short rule'], ['flourish', 'Flourish']]} onChange={(v) => set((x) => { x.sceneBreak.style = v; })} />
            <Num label="Lines taken by a scene break" value={d.sceneBreak.lines} min={1} max={5} onChange={(v) => set((x) => { x.sceneBreak.lines = v; })} />
            <Sel label="Notes" value={d.notes} options={[['footnotes', 'At the foot of the page'], ['endnotes-chapter', 'At the end of each chapter'], ['endnotes-book', 'At the end of the book']]} onChange={(v) => set((x) => { x.notes = v; })} />
            <Sel label="Headings inside chapters" value={d.headingStyle} options={[['serif-italic', 'Italic'], ['serif-bold', 'Bold'], ['sans-bold', 'Sans serif bold'], ['smallcaps', 'Small capitals']]} onChange={(v) => set((x) => { x.headingStyle = v; })} />
            <Sel label="Part numbers" value={d.partNumberStyle} options={[['words', 'Part One'], ['roman', 'Part I'], ['arabic', 'Part 1'], ['none', 'None']]} onChange={(v) => set((x) => { x.partNumberStyle = v; })} />
          </div>
        </Group>

        <Group title="Contents page and pictures">
          <div className="grid2">
            <Sel label="Contents lists" value={String(d.toc.depth) as '1' | '2' | '3'} options={[['1', 'Parts and chapters'], ['2', 'And first level headings'], ['3', 'And second level headings']]} onChange={(v) => set((x) => { x.toc.depth = Number(v); })} />
          </div>
          <div className="checks">
            <Check label="Dotted lines to the page numbers" checked={d.toc.leaders} onChange={(v) => set((x) => { x.toc.leaders = v; })} />
            <Check label="List front matter in the contents" checked={d.toc.includeFrontMatter} onChange={(v) => set((x) => { x.toc.includeFrontMatter = v; })} />
            <Check label="Convert pictures to greyscale in black and white editions" title="Shows the real printed result and keeps colour data out of the print file. Your original pictures are not changed." checked={d.greyscaleImages} onChange={(v) => set((x) => { x.greyscaleImages = v; })} />
          </div>
        </Group>
      </div>

      <div className="design-preview">
        {printFormats.length === 0
          ? <div className="empty"><h2>No print edition</h2><p>Add a paperback or hardcover edition to see its pages.</p></div>
          : <PagePreview formats={printFormats} formatId={formatId} onFormat={setFormatId} refreshKey={rev} />}
      </div>
    </div>
  );
}
