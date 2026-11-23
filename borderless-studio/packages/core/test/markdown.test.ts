import { describe, expect, it } from 'vitest';
import { applyAllChanges, applyChange, countCritic, critic, extractHighlights, parseCritic, resolveCritic, toSourceOffset } from '../src/markdown/critic';
import { parseMarkdown } from '../src/markdown/parse';
import { maskMarkdown } from '../src/markdown/mask';
import { blocksText, inlineText } from '../src/markdown/ir';
import { CH, countDashes, fixEllipses, nonBreakingSpaces, smartQuotes } from '../src/markdown/typography';
import { countWords } from '../src/util/text';

describe('CriticMarkup (tracked changes)', () => {
  const src = 'The {++quick ++}fox {--slowly --}jumped {~~over~>across~~} the dog.{>>check this<<} {==A fine line.==}';

  it('finds every kind of token', () => {
    expect(parseCritic(src).map((s) => s.kind)).toEqual(['insert', 'delete', 'substitute', 'comment', 'highlight']);
    expect(countCritic(src)).toEqual({ changes: 3, comments: 1, highlights: 1 });
  });

  it('reads the original and the accepted text', () => {
    expect(resolveCritic(src, 'original').text).toBe('The fox slowly jumped over the dog. A fine line.');
    expect(resolveCritic(src, 'accepted').text).toBe('The quick fox jumped across the dog. A fine line.');
  });

  it('maps positions in resolved text back to the source', () => {
    const r = resolveCritic(src, 'original');
    const at = r.text.indexOf('jumped');
    expect(src.slice(toSourceOffset(r, at), toSourceOffset(r, at) + 6)).toBe('jumped');
  });

  it('accepts and rejects single changes and all changes', () => {
    const [ins] = parseCritic(src);
    expect(applyChange(src, ins, true).startsWith('The quick fox')).toBe(true);
    expect(applyChange(src, ins, false).startsWith('The fox')).toBe(true);
    expect(applyAllChanges(src, true)).toBe('The quick fox jumped across the dog.{>>check this<<} {==A fine line.==}');
    expect(applyAllChanges(src, false, true)).toBe('The fox slowly jumped over the dog. {==A fine line.==}');
  });

  it('carries the author of a suggestion', () => {
    const s = critic.substitute('very big', 'vast', 'ai', 'tighter');
    const [span] = parseCritic(`It was ${s}.`);
    expect(span).toMatchObject({ kind: 'substitute', text: 'very big', newText: 'vast', author: 'ai', note: 'tighter' });
    // Accepting removes the attached note as well.
    expect(applyChange(`It was ${s}.`, span, true)).toBe('It was vast.');
  });

  it('never loses text when nothing is marked', () => {
    const plain = 'Nothing {to} see {here.';
    expect(resolveCritic(plain).text).toBe(plain);
    expect(applyAllChanges(plain, true)).toBe(plain);
  });

  it('extracts highlighted passages for quote cards', () => {
    expect(extractHighlights(src).map((h) => h.text)).toEqual(['A fine line.']);
  });
});

describe('Markdown to IR', () => {
  it('parses paragraphs, emphasis and scene breaks', () => {
    const { blocks } = parseMarkdown('One *two* **three**.\n\n***\n\nFour.');
    expect(blocks.map((b) => b.t)).toEqual(['p', 'scenebreak', 'p']);
    expect(blocksText(blocks)).toBe('One two three.\nFour.');
  });

  it('pulls footnote text to the place of reference', () => {
    const { blocks, warnings } = parseMarkdown('Salt[^1] matters.\n\n[^1]: A note with *italics*.');
    const p = blocks[0];
    expect(p.t).toBe('p');
    const fn = p.t === 'p' ? p.c.find((n) => n.t === 'fn') : undefined;
    expect(fn && fn.t === 'fn' && blocksText(fn.c)).toBe('A note with italics.');
    expect(warnings).toHaveLength(0);
  });

  it('warns about a missing or unused note', () => {
    expect(parseMarkdown('Text[^9].').warnings[0].message).toMatch(/no matching note/);
    expect(parseMarkdown('Text.\n\n[^2]: orphan').warnings[0].message).toMatch(/never referenced/);
  });

  it('understands call-outs, verse, images, index terms and small capitals', () => {
    const md = [
      ':::note[Read this]', 'Inside the box.', ':::', '',
      ':::verse', 'Line one', 'Line two', '', 'Second stanza', ':::', '',
      '::image[A caption]{src="images/map.png" width="80%" alt="A map"}', '',
      'Rivers :index[Rivers!Ganges] and :sc[nasa].', '',
      '![Alt text](images/a.png "Title caption")',
    ].join('\n');
    const { blocks } = parseMarkdown(md);
    expect(blocks.map((b) => b.t)).toEqual(['callout', 'verse', 'figure', 'p', 'figure']);
    const [callout, verse, fig, para, fig2] = blocks;
    expect(callout.t === 'callout' && callout.kind).toBe('note');
    expect(callout.t === 'callout' && inlineText(callout.title ?? [])).toBe('Read this');
    expect(verse.t === 'verse' && verse.stanzas.map((s) => s.length)).toEqual([2, 1]);
    expect(fig).toMatchObject({ t: 'figure', src: 'images/map.png', width: 0.8, alt: 'A map' });
    expect(para.t === 'p' && para.c.some((n) => n.t === 'index' && n.term === 'Rivers' && n.sub === 'Ganges')).toBe(true);
    expect(para.t === 'p' && para.c.some((n) => n.t === 'sc')).toBe(true);
    expect(fig2).toMatchObject({ t: 'figure', src: 'images/a.png', alt: 'Alt text' });
  });

  it('keeps a stray colon in prose as ordinary text', () => {
    const { blocks } = parseMarkdown('The ratio was a:b and the time 10:30.');
    expect(blocksText(blocks)).toBe('The ratio was a:b and the time 10:30.');
  });

  it('reads the original text when changes are pending, and the new text on request', () => {
    const md = 'She {~~walked~>ran~~} home.';
    expect(blocksText(parseMarkdown(md).blocks)).toBe('She walked home.');
    expect(blocksText(parseMarkdown(md, { criticView: 'accepted' }).blocks)).toBe('She ran home.');
  });

  it('reports source line numbers of blocks', () => {
    const { blocks } = parseMarkdown('First.\n\nSecond.\n\n# Heading\n\nThird.');
    expect(blocks.map((b) => b.line)).toEqual([1, 3, 5, 7]);
  });
});

describe('masking and word counts', () => {
  it('keeps the length of the text and removes markup', () => {
    const md = '# Title\n\nSome *bold* text[^1] with a [link](https://example.com) and {>>a comment<<} done.\n\n[^1]: Note text.';
    const masked = maskMarkdown(md);
    expect(masked.length).toBe(md.length);
    expect(masked).not.toMatch(/[#*\[\]]/);
    expect(masked).not.toContain('comment');
    expect(masked).not.toContain('example.com');
    expect(countWords(masked)).toBe(11); // Title Some bold text with a link and done Note text
  });

  it('positions in masked text match the source', () => {
    const md = 'A {++new ++}word *here*.';
    const masked = maskMarkdown(md);
    const at = masked.indexOf('here');
    expect(md.slice(at, at + 4)).toBe('here');
  });
});

describe('typography', () => {
  it('curls double and single quotes and apostrophes', () => {
    expect(smartQuotes('"Hello," she said. "It\'s late."')).toBe(`${CH.ldquo}Hello,${CH.rdquo} she said. ${CH.ldquo}It${CH.rsquo}s late.${CH.rdquo}`);
    expect(smartQuotes("'Round here,' he said, 'we wait.'", '', true)).toBe(`${CH.lsquo}Round here,${CH.rsquo} he said, ${CH.lsquo}we wait.${CH.rsquo}`);
    expect(smartQuotes("the '90s and 'tis")).toBe(`the ${CH.rsquo}90s and ${CH.rsquo}tis`);
    expect(smartQuotes(`"'Nested,' she said."`)).toBe(`${CH.ldquo}${CH.lsquo}Nested,${CH.rsquo} she said.${CH.rdquo}`);
  });

  it('uses the character before an inline boundary', () => {
    expect(smartQuotes('" he said.', 'd')).toBe(`${CH.rdquo} he said.`);
  });

  it('normalises ellipses', () => {
    expect(fixEllipses('Wait... what. . . now', 'character')).toBe(`Wait${CH.ellipsis} what${CH.ellipsis} now`);
    expect(fixEllipses('Wait...', 'leave')).toBe('Wait...');
  });

  it('adds non breaking spaces after honorifics and before units', () => {
    expect(nonBreakingSpaces('Dr Saad Islam walked 10 km.')).toBe(`Dr${CH.nbsp}Saad Islam walked 10${CH.nbsp}km.`);
  });

  it('counts em and en dashes and typed double hyphens', () => {
    expect(countDashes(`a ${CH.emDash} b ${CH.enDash} c -- d --- e`)).toEqual({ em: 1, en: 1, typed: 2 });
  });
});
