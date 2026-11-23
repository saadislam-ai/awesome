/**
 * A tokenizer for PDF content streams (the little program that draws each
 * page). The inspector uses it to measure where ink lands; the PDF/X
 * finaliser uses it to rewrite colour operators.
 *
 * Only what content streams can contain is handled: numbers, names, strings,
 * arrays, dictionaries, operators and inline images.
 */

export type Operand =
  | { k: 'num'; v: number }
  | { k: 'name'; v: string }
  /** Raw bytes of a string, after unescaping. */
  | { k: 'str'; v: Uint8Array; hex: boolean }
  | { k: 'arr'; v: Operand[] }
  /** Dictionaries are kept as their source text; the inspector never needs their contents. */
  | { k: 'dict'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' };

export interface Operation {
  op: string;
  args: Operand[];
  /** Byte offsets of the operation (first operand to end of operator) in the stream. */
  start: number;
  end: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %

const isWs = (c: number) => WS.has(c);
const isDelim = (c: number) => DELIM.has(c);
const hexVal = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

export class ContentTokenizer {
  pos = 0;
  constructor(readonly data: Uint8Array) {}

  private skipWs(): void {
    const d = this.data;
    while (this.pos < d.length) {
      const c = d[this.pos];
      if (isWs(c)) this.pos++;
      else if (c === 37) {
        // comment to end of line
        while (this.pos < d.length && d[this.pos] !== 10 && d[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  private literalString(): Operand {
    const d = this.data;
    const out: number[] = [];
    let depth = 1;
    this.pos++; // (
    while (this.pos < d.length && depth > 0) {
      let c = d[this.pos++];
      if (c === 92) {
        c = d[this.pos++];
        if (c === 110) out.push(10);
        else if (c === 114) out.push(13);
        else if (c === 116) out.push(9);
        else if (c === 98) out.push(8);
        else if (c === 102) out.push(12);
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let i = 0; i < 2 && d[this.pos] >= 48 && d[this.pos] <= 55; i++) v = v * 8 + (d[this.pos++] - 48);
          out.push(v & 0xff);
        } else if (c === 13) {
          if (d[this.pos] === 10) this.pos++;
        } else if (c !== 10) out.push(c);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        depth--;
        if (depth > 0) out.push(c);
      } else out.push(c);
    }
    return { k: 'str', v: Uint8Array.from(out), hex: false };
  }

  private hexString(): Operand {
    const d = this.data;
    const out: number[] = [];
    this.pos++; // <
    let hi = -1;
    while (this.pos < d.length && d[this.pos] !== 62) {
      const h = hexVal(d[this.pos++]);
      if (h < 0) continue;
      if (hi < 0) hi = h;
      else {
        out.push(hi * 16 + h);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi * 16);
    this.pos++; // >
    return { k: 'str', v: Uint8Array.from(out), hex: true };
  }

  private dict(): Operand {
    const d = this.data;
    const start = this.pos;
    let depth = 0;
    while (this.pos < d.length) {
      if (d[this.pos] === 60 && d[this.pos + 1] === 60) {
        depth++;
        this.pos += 2;
      } else if (d[this.pos] === 62 && d[this.pos + 1] === 62) {
        depth--;
        this.pos += 2;
        if (depth === 0) break;
      } else if (d[this.pos] === 40) {
        this.literalString();
      } else this.pos++;
    }
    return { k: 'dict', v: String.fromCharCode(...d.subarray(start, this.pos)) };
  }

  /** Next operand, or a bare word (operator). Returns null at the end of the stream. */
  next(): Operand | { k: 'op'; v: string } | null {
    this.skipWs();
    const d = this.data;
    if (this.pos >= d.length) return null;
    const c = d[this.pos];
    if (c === 40) return this.literalString();
    if (c === 60) return d[this.pos + 1] === 60 ? this.dict() : this.hexString();
    if (c === 91) {
      this.pos++;
      const items: Operand[] = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= d.length) break;
        if (d[this.pos] === 93) {
          this.pos++;
          break;
        }
        const t = this.next();
        if (!t) break;
        if (t.k !== 'op') items.push(t);
      }
      return { k: 'arr', v: items };
    }
    if (c === 47) {
      this.pos++;
      const start = this.pos;
      while (this.pos < d.length && !isWs(d[this.pos]) && !isDelim(d[this.pos])) this.pos++;
      let name = String.fromCharCode(...d.subarray(start, this.pos));
      if (name.includes('#')) name = name.replace(/#([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
      return { k: 'name', v: name };
    }
    if (c === 93 || c === 41 || c === 62 || c === 123 || c === 125) {
      this.pos++; // stray delimiter: skip
      return this.next();
    }
    const start = this.pos;
    while (this.pos < d.length && !isWs(d[this.pos]) && !isDelim(d[this.pos])) this.pos++;
    const word = String.fromCharCode(...d.subarray(start, this.pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { k: 'num', v: parseFloat(word) };
    if (word === 'true') return { k: 'bool', v: true };
    if (word === 'false') return { k: 'bool', v: false };
    if (word === 'null') return { k: 'null' };
    return { k: 'op', v: word };
  }

  /** Skip the binary data of an inline image (after the ID operator) up to and including EI. */
  skipInlineImage(): void {
    const d = this.data;
    // The data starts after one whitespace byte; EI must be surrounded by whitespace.
    let i = this.pos + 1;
    for (; i + 2 < d.length; i++) {
      if (isWs(d[i]) && d[i + 1] === 69 && d[i + 2] === 73 && (i + 3 >= d.length || isWs(d[i + 3]) || d[i + 3] === 81)) {
        this.pos = i + 3;
        return;
      }
    }
    this.pos = d.length;
  }
}

/** Iterate over the operations of a content stream. */
export function* operations(data: Uint8Array): Generator<Operation> {
  const tk = new ContentTokenizer(data);
  let args: Operand[] = [];
  let start = -1;
  for (;;) {
    const before = tk.pos;
    const t = tk.next();
    if (!t) return;
    if (t.k !== 'op') {
      if (args.length === 0) {
        // Find where this operand really starts (skip the whitespace consumed before it).
        let s = before;
        while (s < data.length && isWs(data[s])) s++;
        start = s;
      }
      args.push(t);
      continue;
    }
    if (t.v === 'ID') {
      tk.skipInlineImage();
      yield { op: 'BI', args, start: start < 0 ? before : start, end: tk.pos };
    } else if (t.v === 'BI') {
      // operands of the inline image dictionary follow as name/value pairs until ID
      if (start < 0) {
        let s = before;
        while (s < data.length && isWs(data[s])) s++;
        start = s;
      }
      continue;
    } else {
      let s = start;
      if (s < 0) {
        s = before;
        while (s < data.length && isWs(data[s])) s++;
      }
      yield { op: t.v, args, start: s, end: tk.pos };
    }
    args = [];
    start = -1;
  }
}

export const num = (o: Operand | undefined): number => (o && o.k === 'num' ? o.v : 0);

/* ------------------------------------------------------------------ */
/* Matrices: [a b c d e f] as in PDF                                    */
/* ------------------------------------------------------------------ */

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 applied first, then m2 (PDF's "m1 x m2"). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const emptyBox = (): BBox => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export const isEmptyBox = (b: BBox): boolean => b.x0 > b.x1 || b.y0 > b.y1;

export function growBox(b: BBox, x: number, y: number): void {
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
}

export function unionBox(a: BBox, b: BBox): void {
  if (isEmptyBox(b)) return;
  growBox(a, b.x0, b.y0);
  growBox(a, b.x1, b.y1);
}

export function intersectBox(a: BBox, b: BBox): BBox {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}
