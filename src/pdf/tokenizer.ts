/**
 * PDF tartalomfolyam-tokenizáló.
 *
 * A tartalomfolyam a PDF-oldal "utasításlistája": operandusok, majd egy operátor
 * (fordított lengyel jelöléssel). Nekünk azért kell, mert a valódi kitakarás
 * nem fekete téglalap rajzolása, hanem a betűket kirajzoló utasítások TÖRLÉSE.
 * Ahhoz pedig pontosan tudni kell, melyik bájttól melyikig tart egy-egy utasítás.
 */

export type TokenValue =
  | { kind: 'number'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'string'; bytes: number[] }
  | { kind: 'hexstring'; bytes: number[] }
  | { kind: 'array'; items: TokenValue[] }
  | { kind: 'dict' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' };

export interface Operation {
  operator: string;
  operands: TokenValue[];
  /** Bájtpozíció a tartalomfolyamban: az operandusok kezdete és az operátor vége. */
  start: number;
  end: number;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWs(b: number): boolean {
  return WHITESPACE.has(b);
}
function isDelim(b: number): boolean {
  return DELIMITERS.has(b);
}
function isRegular(b: number): boolean {
  return !isWs(b) && !isDelim(b);
}

export class ContentTokenizer {
  private pos = 0;

  constructor(private readonly data: Uint8Array) {}

  /** Az összes utasítás, pozícióval együtt. */
  parseOperations(): Operation[] {
    const ops: Operation[] = [];
    let operands: TokenValue[] = [];
    let operandStart = -1;

    for (;;) {
      this.skipWsAndComments();
      if (this.pos >= this.data.length) break;
      const tokenStart = this.pos;
      const b = this.data[this.pos]!;

      if (b === 0x2f || b === 0x28 || b === 0x3c || b === 0x5b || (b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e) {
        const v = this.readValue();
        if (v) {
          if (operandStart < 0) operandStart = tokenStart;
          operands.push(v);
          continue;
        }
      }

      const word = this.readKeyword();
      if (word === null) {
        this.pos++;
        continue;
      }

      if (word === 'true' || word === 'false') {
        if (operandStart < 0) operandStart = tokenStart;
        operands.push({ kind: 'bool', value: word === 'true' });
        continue;
      }
      if (word === 'null') {
        if (operandStart < 0) operandStart = tokenStart;
        operands.push({ kind: 'null' });
        continue;
      }

      // Beágyazott kép: a bináris adat nem tokenizálható, át kell ugrani.
      if (word === 'BI') {
        this.skipInlineImage();
        operands = [];
        operandStart = -1;
        continue;
      }

      ops.push({
        operator: word,
        operands,
        start: operandStart >= 0 ? operandStart : tokenStart,
        end: this.pos,
      });
      operands = [];
      operandStart = -1;
    }
    return ops;
  }

  private skipWsAndComments(): void {
    for (;;) {
      while (this.pos < this.data.length && isWs(this.data[this.pos]!)) this.pos++;
      if (this.pos < this.data.length && this.data[this.pos] === 0x25) {
        while (this.pos < this.data.length && this.data[this.pos] !== 0x0a && this.data[this.pos] !== 0x0d) this.pos++;
        continue;
      }
      return;
    }
  }

  private readValue(): TokenValue | null {
    const b = this.data[this.pos]!;
    if (b === 0x2f) return this.readName();
    if (b === 0x28) return this.readLiteralString();
    if (b === 0x3c) {
      if (this.data[this.pos + 1] === 0x3c) return this.readDict();
      return this.readHexString();
    }
    if (b === 0x5b) return this.readArray();
    return this.readNumber();
  }

  private readNumber(): TokenValue | null {
    const start = this.pos;
    while (this.pos < this.data.length && isRegular(this.data[this.pos]!)) this.pos++;
    const s = Buffer.from(this.data.subarray(start, this.pos)).toString('latin1');
    const n = Number.parseFloat(s);
    if (!Number.isFinite(n)) {
      this.pos = start;
      return null;
    }
    return { kind: 'number', value: n };
  }

  private readName(): TokenValue {
    this.pos++; // '/'
    const start = this.pos;
    while (this.pos < this.data.length && isRegular(this.data[this.pos]!)) this.pos++;
    let raw = Buffer.from(this.data.subarray(start, this.pos)).toString('latin1');
    // #XX menekülés a névben
    raw = raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return { kind: 'name', value: raw };
  }

  private readLiteralString(): TokenValue {
    this.pos++; // '('
    const bytes: number[] = [];
    let depth = 1;
    while (this.pos < this.data.length) {
      const b = this.data[this.pos++]!;
      if (b === 0x5c) {
        const n = this.data[this.pos++]!;
        switch (n) {
          case 0x6e: bytes.push(0x0a); break;
          case 0x72: bytes.push(0x0d); break;
          case 0x74: bytes.push(0x09); break;
          case 0x62: bytes.push(0x08); break;
          case 0x66: bytes.push(0x0c); break;
          case 0x0a: break;
          case 0x0d: if (this.data[this.pos] === 0x0a) this.pos++; break;
          default:
            if (n >= 0x30 && n <= 0x37) {
              let oct = n - 0x30;
              for (let i = 0; i < 2; i++) {
                const d = this.data[this.pos];
                if (d === undefined || d < 0x30 || d > 0x37) break;
                oct = oct * 8 + (d - 0x30);
                this.pos++;
              }
              bytes.push(oct & 0xff);
            } else bytes.push(n);
        }
        continue;
      }
      if (b === 0x28) { depth++; bytes.push(b); continue; }
      if (b === 0x29) { depth--; if (depth === 0) break; bytes.push(b); continue; }
      bytes.push(b);
    }
    return { kind: 'string', bytes };
  }

  private readHexString(): TokenValue {
    this.pos++; // '<'
    const digits: string[] = [];
    while (this.pos < this.data.length && this.data[this.pos] !== 0x3e) {
      const c = String.fromCharCode(this.data[this.pos]!);
      if (/[0-9A-Fa-f]/.test(c)) digits.push(c);
      this.pos++;
    }
    this.pos++; // '>'
    if (digits.length % 2 === 1) digits.push('0');
    const bytes: number[] = [];
    for (let i = 0; i < digits.length; i += 2) bytes.push(parseInt(digits[i]! + digits[i + 1]!, 16));
    return { kind: 'hexstring', bytes };
  }

  private readArray(): TokenValue {
    this.pos++; // '['
    const items: TokenValue[] = [];
    for (;;) {
      this.skipWsAndComments();
      if (this.pos >= this.data.length) break;
      if (this.data[this.pos] === 0x5d) { this.pos++; break; }
      const before = this.pos;
      const v = this.readValue();
      if (!v || this.pos === before) { this.pos++; continue; }
      items.push(v);
    }
    return { kind: 'array', items };
  }

  /** A szótárat nem elemezzük, csak biztonságosan átugorjuk (BDC operandusa). */
  private readDict(): TokenValue {
    this.pos += 2; // '<<'
    let depth = 1;
    while (this.pos < this.data.length && depth > 0) {
      if (this.data[this.pos] === 0x3c && this.data[this.pos + 1] === 0x3c) { depth++; this.pos += 2; continue; }
      if (this.data[this.pos] === 0x3e && this.data[this.pos + 1] === 0x3e) { depth--; this.pos += 2; continue; }
      if (this.data[this.pos] === 0x28) { this.readLiteralString(); continue; }
      this.pos++;
    }
    return { kind: 'dict' };
  }

  private readKeyword(): string | null {
    const start = this.pos;
    while (this.pos < this.data.length && isRegular(this.data[this.pos]!)) this.pos++;
    if (this.pos === start) return null;
    return Buffer.from(this.data.subarray(start, this.pos)).toString('latin1');
  }

  /** BI ... ID <bináris> EI */
  private skipInlineImage(): void {
    while (this.pos < this.data.length - 1) {
      if (this.data[this.pos] === 0x49 && this.data[this.pos + 1] === 0x44) {
        this.pos += 2;
        break;
      }
      this.pos++;
    }
    while (this.pos < this.data.length - 1) {
      if (
        this.data[this.pos] === 0x45 &&
        this.data[this.pos + 1] === 0x49 &&
        (this.pos + 2 >= this.data.length || isWs(this.data[this.pos + 2]!) || isDelim(this.data[this.pos + 2]!))
      ) {
        this.pos += 2;
        return;
      }
      this.pos++;
    }
  }
}
