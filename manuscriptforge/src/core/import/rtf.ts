import type { Align, DraftBlock, HeadingLevel, Run } from '../model/blocks';
import { finalizeBlocks, ImportError, type ImportMeta, type ImportResult } from './common';

/** Groups whose content is not manuscript text. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'pict', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr',
  'footerf', 'object', 'objdata', 'themedata', 'colorschememapping', 'datastore', 'latentstyles',
  'generator', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'pgdsctbl', 'nonshppict', 'shp',
  'shpinst', 'listtext', 'pntext', 'bkmkstart', 'bkmkend', 'revtbl', 'filetbl', 'annotation', 'atnid',
  'atnauthor', 'template', 'operator', 'creatim', 'revtim', 'printim', 'buptim', 'company', 'doccomm',
  'keywords', 'subject', 'category', 'manager', 'comment', 'fldinst', 'xe', 'tc', 'private',
]);

const SPECIAL_CHARS: Record<string, string> = {
  emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“',
  rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ', qmspace: ' ',
  tab: '\t', line: '\n', zwj: '‍', zwnj: '‌',
};

const PARAGRAPH_WORDS = new Set(['par', 'row', 'sect', 'page', 'pagebb', 'cell', 'pard', 'qc', 'qr', 'ql', 'qj', 'outlinelevel']);

interface State {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  hidden: boolean;
  skip: boolean;
  uc: number;
  dest: 'body' | 'stylesheet' | 'style' | 'info' | 'title' | 'author' | 'footnote';
}

interface ParaProps {
  align?: Align;
  style?: number;
  outline?: number;
  pb: boolean;
}

function decoderFor(codepage: number): TextDecoder {
  const label = codepage === 10000 ? 'macintosh' : codepage === 65001 ? 'utf-8' : `windows-${codepage}`;
  try {
    return new TextDecoder(label);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

/** Imports a Rich Text Format (.rtf) file. */
export function importRtf(bytes: Uint8Array): ImportResult {
  let src = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) src += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  if (!src.trimStart().startsWith('{\\rtf')) throw new ImportError('This file is not a valid RTF document.');

  let decoder = decoderFor(1252);
  const stack: State[] = [];
  let state: State = { b: false, i: false, u: false, s: false, hidden: false, skip: false, uc: 1, dest: 'body' };
  let para: ParaProps = { pb: false };
  let runs: Run[] = [];
  let pendingBytes: number[] = [];
  let skipFallback = 0;
  let footnotes = 0;
  let images = 0;
  const blocks: DraftBlock[] = [];
  const styleNames = new Map<number, string>();
  let styleNumber = 0;
  let styleText = '';
  const meta: ImportMeta = {};
  let metaText = '';
  let styledTitle = '';

  const flushBytes = () => {
    if (!pendingBytes.length) return;
    const text = decoder.decode(new Uint8Array(pendingBytes));
    pendingBytes = [];
    emit(text);
  };

  const emit = (text: string) => {
    if (!text || state.skip) return;
    if (state.dest === 'style') {
      styleText += text;
      return;
    }
    if (state.dest === 'title' || state.dest === 'author') {
      metaText += text;
      return;
    }
    if (state.dest !== 'body' || state.hidden) return;
    const run: Run = { text };
    if (state.b) run.b = true;
    if (state.i) run.i = true;
    if (state.u) run.u = true;
    if (state.s) run.s = true;
    runs.push(run);
  };

  const endParagraph = () => {
    flushBytes();
    const name = para.style !== undefined ? (styleNames.get(para.style) ?? '').toLowerCase() : '';
    const named = /^heading\s*(\d)/.exec(name);
    let level: number | undefined;
    if (named) level = Number(named[1]);
    else if (name === 'title') level = 1;
    else if (para.outline !== undefined && para.outline < 9) level = para.outline + 1;
    const hasText = runs.some((r) => r.text.trim());
    if (name === 'title' && hasText && !styledTitle) styledTitle = runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
    let block: DraftBlock;
    if (level && hasText) {
      block = { type: 'heading', level: Math.min(Math.max(level, 1), 4) as HeadingLevel, runs };
    } else {
      block = { type: 'paragraph', runs };
      if (hasText && para.align) block.align = para.align;
    }
    if (para.pb) block.pb = true;
    blocks.push(block);
    runs = [];
    para = { ...para, pb: false };
  };

  const control = (word: string, param: number | undefined, starred: boolean) => {
    if (state.skip) return;
    if (starred && !['fldrslt'].includes(word)) {
      // "\*" marks a destination that readers may ignore when they do not know it.
      state.skip = true;
      return;
    }
    if (SKIP_DESTINATIONS.has(word)) {
      if (word === 'pict') images++;
      state.skip = true;
      return;
    }
    if (word in SPECIAL_CHARS) {
      flushBytes();
      emit(SPECIAL_CHARS[word]);
      return;
    }
    const on = param !== 0;
    // Paragraph properties inside the stylesheet describe styles, not the text.
    if (state.dest !== 'body' && PARAGRAPH_WORDS.has(word)) return;
    switch (word) {
      case 'par':
      case 'row':
        if (state.dest === 'body') endParagraph();
        break;
      case 'sect':
        if (state.dest === 'body') {
          endParagraph();
          para.pb = true;
        }
        break;
      case 'page':
        flushBytes();
        if (runs.some((r) => r.text.trim())) {
          endParagraph();
        }
        para.pb = true;
        break;
      case 'pagebb':
        para.pb = true;
        break;
      case 'cell':
        flushBytes();
        emit(' | ');
        break;
      case 'pard':
        para = { pb: para.pb };
        break;
      case 'plain':
        flushBytes();
        state.b = state.i = state.u = state.s = state.hidden = false;
        break;
      case 'b':
        flushBytes();
        state.b = on;
        break;
      case 'i':
        flushBytes();
        state.i = on;
        break;
      case 'ul':
      case 'uld':
      case 'uldb':
      case 'ulw':
        flushBytes();
        state.u = on;
        break;
      case 'ulnone':
        flushBytes();
        state.u = false;
        break;
      case 'strike':
      case 'striked':
        flushBytes();
        state.s = on;
        break;
      case 'v':
        flushBytes();
        state.hidden = on;
        break;
      case 'qc':
        para.align = 'center';
        break;
      case 'qr':
        para.align = 'right';
        break;
      case 'ql':
      case 'qj':
        para.align = undefined;
        break;
      case 's':
        if (state.dest === 'style') styleNumber = param ?? 0;
        else para.style = param;
        break;
      case 'outlinelevel':
        para.outline = param;
        break;
      case 'uc':
        state.uc = param ?? 1;
        break;
      case 'u': {
        flushBytes();
        let code = param ?? 0;
        if (code < 0) code += 65536;
        emit(String.fromCharCode(code));
        skipFallback = state.uc;
        break;
      }
      case 'ansicpg':
        if (param) decoder = decoderFor(param);
        break;
      case 'mac':
        decoder = decoderFor(10000);
        break;
      case 'stylesheet':
        state.dest = 'stylesheet';
        break;
      case 'info':
        state.dest = 'info';
        break;
      case 'title':
      case 'author':
        if (state.dest === 'info') {
          state.dest = word;
          metaText = '';
        }
        break;
      case 'footnote':
        footnotes++;
        state.skip = true;
        break;
      default:
        break;
    }
  };

  const length = src.length;
  let pos = 0;
  while (pos < length) {
    const ch = src[pos];
    if (ch === '{') {
      flushBytes();
      stack.push({ ...state });
      if (state.dest === 'stylesheet') {
        state.dest = 'style';
        styleNumber = 0;
        styleText = '';
      }
      pos++;
    } else if (ch === '}') {
      flushBytes();
      if (state.dest === 'style' && stack[stack.length - 1]?.dest === 'stylesheet') {
        styleNames.set(styleNumber, styleText.replace(/;\s*$/, '').trim());
      } else if ((state.dest === 'title' || state.dest === 'author') && stack[stack.length - 1]?.dest === 'info') {
        const value = metaText.trim();
        if (value) meta[state.dest] = value;
      }
      const previous = stack.pop();
      if (previous) state = previous;
      skipFallback = 0;
      pos++;
    } else if (ch === '\\') {
      const next = src[pos + 1];
      if (next === undefined) break;
      if (/[a-zA-Z]/.test(next)) {
        let end = pos + 1;
        while (end < length && /[a-zA-Z]/.test(src[end])) end++;
        const word = src.slice(pos + 1, end);
        let param: number | undefined;
        let numEnd = end;
        if (src[numEnd] === '-') numEnd++;
        while (numEnd < length && src[numEnd] >= '0' && src[numEnd] <= '9') numEnd++;
        if (numEnd > end && !(numEnd === end + 1 && src[end] === '-')) {
          param = Number(src.slice(end, numEnd));
          end = numEnd;
        }
        if (src[end] === ' ') end++;
        // "\bin" carries raw bytes that must not be parsed.
        if (word === 'bin' && param && param > 0) {
          pos = end + param;
          continue;
        }
        const starred = src[pos - 1] === '*' && src[pos - 2] === '\\';
        if (word !== 'u') flushBytes();
        control(word, param, starred);
        pos = end;
      } else if (next === "'") {
        const byte = parseInt(src.slice(pos + 2, pos + 4), 16);
        if (skipFallback > 0) skipFallback--;
        else if (!Number.isNaN(byte)) pendingBytes.push(byte);
        pos += 4;
      } else {
        if (next === '\\' || next === '{' || next === '}') {
          if (skipFallback > 0) skipFallback--;
          else {
            flushBytes();
            emit(next);
          }
        } else if (next === '~') {
          flushBytes();
          emit(' ');
        } else if (next === '_') {
          flushBytes();
          emit('‑');
        } else if (next === '\n' || next === '\r') {
          if (state.dest === 'body' && !state.skip) endParagraph();
        }
        // "\*" is handled when the control word that follows it is read; "\-" and others are ignored.
        pos += 2;
      }
    } else if (ch === '\r' || ch === '\n') {
      pos++;
    } else {
      if (skipFallback > 0) skipFallback--;
      else if (!state.skip) {
        const code = ch.charCodeAt(0);
        if (code < 0x80) {
          if (pendingBytes.length) flushBytes();
          let end = pos + 1;
          while (end < length) {
            const c = src[end];
            if (c === '{' || c === '}' || c === '\\' || c === '\r' || c === '\n' || c.charCodeAt(0) >= 0x80) break;
            end++;
          }
          emit(src.slice(pos, end));
          pos = end;
          continue;
        }
        pendingBytes.push(code);
      }
      pos++;
    }
  }
  flushBytes();
  if (runs.some((r) => r.text.trim())) endParagraph();

  if (!meta.title && styledTitle) meta.title = styledTitle;
  const warnings: string[] = [];
  if (footnotes) warnings.push(`${footnotes} footnote${footnotes === 1 ? ' was' : 's were'} not imported from this RTF file.`);
  if (images) warnings.push(`${images} image${images === 1 ? ' was' : 's were'} not imported.`);
  return { format: 'rtf', blocks: finalizeBlocks(blocks), meta, warnings };
}
