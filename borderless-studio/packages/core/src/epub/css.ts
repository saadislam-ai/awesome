/**
 * The ebook stylesheet. Principles:
 *   - Never fight the reader: no fixed font sizes on body text, no forced
 *     colours (dark mode must work), no forced line height.
 *   - Only CSS that Kindle, Apple Books, Kobo and Google Play all support.
 *   - Old Kindle formats get simpler rules through Amazon's media queries, so
 *     a drop capital becomes a plain large letter instead of breaking.
 */
import type { Design } from '../model/design';
import { languageInfo } from '../i18n/languages';
import type { EpubFont } from './build';

export function fontFaceCss(fonts: EpubFont[]): string {
  return fonts
    .map(
      (f) =>
        `@font-face {\n  font-family: "${f.family}";\n  font-style: ${f.style};\n  font-weight: ${f.weight};\n  src: url("../fonts/${f.fileName}");\n}\n`,
    )
    .join('');
}

export function EPUB_CSS(o: { design: Design; lang: string; embedded: string | null }): string {
  const d = o.design;
  const indent = d.paragraphStyle === 'spaced' ? '0' : '1.4em';
  const paraGap = d.paragraphStyle === 'spaced' ? '0.9em' : '0';
  const align = d.justify ? 'justify' : 'left';
  const center = d.chapterOpener.align === 'left' ? 'left' : 'center';
  const family = o.embedded ? `font-family: "${o.embedded}", serif;` : '';
  const lang = languageInfo(o.lang);
  const hyphens = d.hyphenate && lang.hyphenate ? 'auto' : 'manual';
  const css = `/* Borderless Studio ebook stylesheet */
@namespace epub "http://www.idpf.org/2007/ops";

html { -webkit-text-size-adjust: 100%; }
body { margin: 0 5%; ${family} }

p {
  margin: 0 0 ${paraGap} 0;
  text-indent: ${indent};
  text-align: ${align};
  widows: 2;
  orphans: 2;
  -webkit-hyphens: ${hyphens};
  -epub-hyphens: ${hyphens};
  hyphens: ${hyphens};
}
p.first, h1 + p, h2 + p, h3 + p, h4 + p, blockquote > p:first-child, li > p:first-child, aside p, figure + p, table + p { text-indent: 0; }

h1, h2, h3, h4 {
  -webkit-hyphens: none;
  -epub-hyphens: none;
  hyphens: none;
  text-align: ${center};
  page-break-after: avoid;
  break-after: avoid;
  line-height: 1.25;
}
h1 { font-size: 1.6em; font-weight: normal; margin: 2.5em 0 2em 0; }
h1 .label { display: block; font-size: 0.6em; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 0.9em; }
h1 .title { display: block; ${d.chapterOpener.titleStyle === 'italic' ? 'font-style: italic;' : ''}${d.chapterOpener.titleStyle === 'bold' ? 'font-weight: bold;' : ''} }
h2 { font-size: 1.25em; margin: 1.8em 0 0.6em 0; text-align: left; }
h3 { font-size: 1.1em; margin: 1.5em 0 0.5em 0; text-align: left; }
h4 { font-size: 1em; font-style: italic; font-weight: normal; margin: 1.2em 0 0.4em 0; text-align: left; }
p.subtitle { text-indent: 0; text-align: ${center}; font-style: italic; margin: -1.2em 0 2em 0; }

section { page-break-before: always; break-before: page; }
section.notes, section section { page-break-before: auto; break-before: auto; }

/* Scene breaks: the rule is for assistive technology, the stars are for the eye. */
hr.scene { border: 0; height: 0; margin: 0; padding: 0; }
p.scenebreak { text-indent: 0; text-align: center; margin: 1.2em 0; page-break-after: avoid; }
p.scenebreak + p { text-indent: 0; }

/* Opening paragraph */
span.leadin { font-size: 0.85em; letter-spacing: 0.06em; text-transform: uppercase; }
span.dropcap {
  float: left;
  font-size: 3.1em;
  line-height: 0.85;
  margin: 0.06em 0.08em 0 0;
  padding: 0;
}
@media amzn-mobi {
  span.dropcap { float: none; font-size: 2em; font-weight: bold; margin: 0; }
  span.leadin { font-size: 1em; letter-spacing: 0; }
}

span.sc { font-size: 0.85em; letter-spacing: 0.05em; text-transform: uppercase; }

blockquote { margin: 1em 1.5em; }
blockquote p { text-indent: ${indent}; }

ul, ol { margin: 0.8em 0 0.8em 1.6em; padding: 0; }
li { margin: 0.2em 0; }
li p { text-indent: 0; text-align: left; }

figure { margin: 1.2em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure img { max-width: 100%; height: auto; }
figure.full img { width: 100%; }
figcaption { font-size: 0.9em; font-style: italic; margin-top: 0.4em; text-align: center; }
img.inline { height: 1em; width: auto; vertical-align: baseline; }

table { border-collapse: collapse; margin: 1.2em auto; font-size: 0.92em; max-width: 100%; }
caption { font-style: italic; margin-bottom: 0.4em; }
th, td { padding: 0.3em 0.6em; text-align: left; vertical-align: top; border-bottom: 1px solid; }
thead th { border-bottom: 2px solid; border-top: 2px solid; }
.a-center { text-align: center; }
.a-right { text-align: right; }

aside.callout { margin: 1.2em 0; padding: 0.7em 1em; border-left: 0.25em solid; }
aside.callout p { text-indent: 0; margin-bottom: 0.5em; text-align: left; }
p.callout-title { font-weight: bold; font-size: 0.95em; letter-spacing: 0.02em; }

div.verse { margin: 1.2em 0 1.2em 1.5em; }
div.stanza { margin: 0 0 1em 0; page-break-inside: avoid; break-inside: avoid; }
p.line { text-indent: -2em; margin: 0 0 0 2em; text-align: left; -webkit-hyphens: none; hyphens: none; }

div.center p { text-align: center; text-indent: 0; }
div.right p { text-align: right; text-indent: 0; }
div.pagebreak { page-break-after: always; break-after: page; }
pre { white-space: pre-wrap; font-size: 0.85em; margin: 1em 0; }
code { font-family: monospace; font-size: 0.9em; }

/* Notes */
a.noteref { font-size: 0.75em; vertical-align: super; line-height: 0; text-decoration: none; }
section.notes { margin-top: 2.5em; font-size: 0.9em; }
hr.notes-rule { width: 25%; margin: 0 0 1em 0; border: 0; border-top: 1px solid; }
aside.note { margin: 0 0 0.6em 0; }
aside.note p { text-indent: 0; text-align: left; }
a.note-number { text-decoration: none; }

/* Display pages */
section.titlepage { text-align: center; }
h1.book-title { font-size: 2em; margin: 3em 0 0.4em 0; text-align: center; }
p.book-subtitle { text-indent: 0; text-align: center; font-style: italic; font-size: 1.15em; margin: 0 0 0.5em 0; }
p.book-series { text-indent: 0; text-align: center; font-size: 0.9em; letter-spacing: 0.08em; text-transform: uppercase; margin: 0.8em 0; }
p.book-author { text-indent: 0; text-align: center; font-size: 1.25em; margin: 2em 0 0.5em 0; }
p.book-contributor { text-indent: 0; text-align: center; font-style: italic; }
p.book-imprint { text-indent: 0; text-align: center; font-size: 0.9em; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 5em; }

section.copyright p { text-indent: 0; text-align: left; font-size: 0.85em; margin: 0 0 0.8em 0; -webkit-hyphens: none; hyphens: none; }
section.dedication, section.epigraph { margin: 20% 10% 0 10%; }
section.dedication p { text-indent: 0; text-align: center; font-style: italic; }
section.epigraph p { text-indent: 0; text-align: left; font-style: italic; }
section.epigraph p.epigraph-source { text-align: right; font-style: normal; font-size: 0.92em; margin-top: 0.7em; }
section.part h1 { margin-top: 30%; }

section.also-by { text-align: center; }
p.alsoby-group { text-indent: 0; text-align: center; font-size: 0.9em; letter-spacing: 0.06em; text-transform: uppercase; margin: 1.2em 0 0.3em 0; }
ul.alsoby { list-style: none; margin: 0; padding: 0; }
ul.alsoby li { text-align: center; }

/* Contents and index */
nav#toc ol { list-style: none; margin: 0 0 0 1.2em; padding: 0; }
nav#toc > ol { margin-left: 0; }
nav#toc li { margin: 0.45em 0; text-align: left; }
nav#toc a { text-decoration: none; }
ul.index-list, ul.index-list ul { list-style: none; margin: 0 0 0 1.2em; padding: 0; }
ul.index-list { margin-left: 0; font-size: 0.92em; }
ul.index-list li { margin: 0.15em 0; text-align: left; }

section.cover { text-align: center; page-break-after: always; }
section.cover img { max-width: 100%; max-height: 100%; }
`;
  return forLanguage(css, lang.dir === 'rtl', Boolean(lang.cursive));
}

/**
 * Right-to-left books mirror every left and right in the layout (text
 * alignment, floats, borders and side margins); joined scripts lose all letter
 * spacing, which would break the joins between letters.
 */
function forLanguage(css: string, rtl: boolean, cursive: boolean): string {
  let out = css;
  if (rtl) {
    out = out.replace(/\b(text-align|float|clear):(\s*)(left|right)\b/g, (_m, prop: string, sp: string, side: string) => `${prop}:${sp}${side === 'left' ? 'right' : 'left'}`);
    out = out.replace(/\b(border|margin|padding)-(left|right)\b/g, (_m, prop: string, side: string) => `${prop}-${side === 'left' ? 'right' : 'left'}`);
  }
  if (cursive) out = out.replace(/letter-spacing:\s*[^;]+;/g, 'letter-spacing: 0;');
  return out;
}
