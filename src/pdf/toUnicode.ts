/**
 * ToUnicode CMap értelmezése.
 *
 * A modern PDF-ekben a betűkészlet részhalmazolt: a tartalomfolyamban nem
 * karakterek, hanem GLIFAZONOSÍTÓK állnak (<0036> Tj). Hogy tudjuk, melyik
 * glifa melyik magyar betű, a betűkészlethez tartozó ToUnicode táblát kell
 * elolvasni. Enélkül a szövegben semmit nem tudunk megtalálni.
 */

export interface CMap {
  /** glifakód → Unicode szöveg */
  map: Map<number, string>;
  /** Hány bájtos egy kód (Identity-H esetén 2). */
  codeBytes: number;
}

function hexToCode(hex: string): number {
  return parseInt(hex, 16);
}

function hexToString(hex: string): string {
  // A ToUnicode értékek UTF-16BE kódolásúak.
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const chunk = hex.slice(i, i + 4);
    if (chunk.length < 4) break;
    out += String.fromCharCode(parseInt(chunk, 16));
  }
  return out;
}

export function parseToUnicode(data: Uint8Array): CMap {
  const text = Buffer.from(data).toString('latin1');
  const map = new Map<number, string>();

  // codespacerange alapján derül ki, hány bájtos a kód.
  let codeBytes = 2;
  const csr = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (csr) {
    const first = /<([0-9A-Fa-f]+)>/.exec(csr[1] ?? '');
    if (first?.[1]) codeBytes = Math.max(1, Math.ceil(first[1].length / 2));
  }

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const body = block[1] ?? '';
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      map.set(hexToCode(m[1]!), hexToString(m[2] ?? ''));
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? '';
    // <lo> <hi> <dst>  — folytonos tartomány
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      const lo = hexToCode(m[1]!);
      const hi = hexToCode(m[2]!);
      const dstHex = m[3] ?? '';
      const dst = hexToString(dstHex);
      const base = dst.charCodeAt(dst.length - 1);
      for (let c = lo; c <= hi && c - lo < 65536; c++) {
        const tail = String.fromCharCode(base + (c - lo));
        map.set(c, dst.slice(0, -1) + tail);
      }
    }
    // <lo> <hi> [ <d1> <d2> ... ] — tételes felsorolás
    for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = hexToCode(m[1]!);
      const items = [...(m[3] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)];
      items.forEach((it, i) => map.set(lo + i, hexToString(it[1] ?? '')));
    }
  }

  return { map, codeBytes };
}

/** Bájtsorozat → (kód, szöveg) párok a CMap szerint. */
export function decodeWithCMap(bytes: number[], cmap: CMap): { code: number; text: string }[] {
  const out: { code: number; text: string }[] = [];
  const step = cmap.codeBytes;
  for (let i = 0; i + step <= bytes.length; i += step) {
    let code = 0;
    for (let k = 0; k < step; k++) code = (code << 8) | bytes[i + k]!;
    out.push({ code, text: cmap.map.get(code) ?? '' });
  }
  return out;
}
