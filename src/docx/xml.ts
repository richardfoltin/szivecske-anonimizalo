/**
 * Minimális XML-pásztázó a DOCX-hez — szándékosan NEM elemzőfa.
 *
 * Miért nem kész XML-könyvtárral: a formátumhű visszaírás azon áll vagy bukik,
 * hogy amihez nem nyúlunk, az bájtazonos maradjon. Minden általános elemző
 * megeszi és újra kiköpi az egész dokumentumot: átrendezi az attribútumokat,
 * eldönti helyettünk, hogy `<w:t/>` vagy `<w:t></w:t>` legyen, normalizálja a
 * névtereket, máshogy kódolja az entitásokat. Ezek külön-külön ártalmatlanok,
 * együtt viszont pont azt a bizalmat rombolják le, amiért az ügyvéd fizet:
 * hogy a leadott irat ugyanaz az irat maradjon.
 *
 * Ezért itt csak POZÍCIÓKAT állítunk elő, és minden módosítás karakterlánc-
 * beszúrás az eredeti forrásba. Amit nem érintünk, azt nem is írjuk újra.
 */

export type XmlNodeKind = 'open' | 'close' | 'self' | 'text' | 'comment' | 'pi' | 'cdata' | 'doctype';

export interface XmlNode {
  kind: XmlNodeKind;
  /** Az elem neve prefixszel együtt ("w:t"); nem elemeknél üres. */
  name: string;
  /** A teljes csomópont tartománya a forrásban. */
  start: number;
  end: number;
  /** Nyitó- és üres elemnél a név utáni pozíció — innen kezdődnek az attribútumok. */
  nameEnd: number;
}

/** Végigmegy a forráson, és minden csomópontot átad a látogatónak. */
export function scanXml(xml: string, visit: (node: XmlNode) => void): void {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      if (i < n) visit({ kind: 'text', name: '', start: i, end: n, nameEnd: i });
      return;
    }
    if (lt > i) visit({ kind: 'text', name: '', start: i, end: lt, nameEnd: i });

    if (xml.startsWith('<!--', lt)) {
      const close = xml.indexOf('-->', lt + 4);
      const end = close < 0 ? n : close + 3;
      visit({ kind: 'comment', name: '', start: lt, end, nameEnd: lt });
      i = end;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const close = xml.indexOf(']]>', lt + 9);
      const end = close < 0 ? n : close + 3;
      visit({ kind: 'cdata', name: '', start: lt, end, nameEnd: lt });
      i = end;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const close = xml.indexOf('?>', lt + 2);
      const end = close < 0 ? n : close + 2;
      visit({ kind: 'pi', name: '', start: lt, end, nameEnd: lt });
      i = end;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      const end = scanToTagEnd(xml, lt + 2);
      visit({ kind: 'doctype', name: '', start: lt, end, nameEnd: lt });
      i = end;
      continue;
    }

    const isClose = xml.charCodeAt(lt + 1) === 0x2f; // '/'
    const nameStart = lt + (isClose ? 2 : 1);
    let p = nameStart;
    while (p < n && !isNameBreak(xml.charCodeAt(p))) p++;
    const name = xml.slice(nameStart, p);
    const end = scanToTagEnd(xml, p);
    const selfClosing = !isClose && xml.charCodeAt(end - 2) === 0x2f; // '/>'
    visit({
      kind: isClose ? 'close' : selfClosing ? 'self' : 'open',
      name,
      start: lt,
      end,
      nameEnd: p,
    });
    i = end;
  }
}

/** A tag záró `>` jele utáni pozíció, az idézőjeleken belüli `>` átugrásával. */
function scanToTagEnd(xml: string, from: number): number {
  let i = from;
  let quote = 0;
  const n = xml.length;
  while (i < n) {
    const c = xml.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 0x22 || c === 0x27) {
      quote = c;
    } else if (c === 0x3e) {
      return i + 1;
    }
    i++;
  }
  return n;
}

function isNameBreak(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x2f || c === 0x3e;
}

export interface XmlAttr {
  name: string;
  value: string;
  nameStart: number;
  nameEnd: number;
  /** Az érték tartománya az idézőjeleken BELÜL. */
  valueStart: number;
  valueEnd: number;
}

/** Egy nyitó vagy üres elem attribútumai, forrásbeli pozícióval. */
export function attributesOf(xml: string, node: XmlNode): XmlAttr[] {
  const out: XmlAttr[] = [];
  const limit = node.end;
  let i = node.nameEnd;
  while (i < limit) {
    while (i < limit && /\s/.test(xml[i] ?? '')) i++;
    const c = xml[i];
    if (c === undefined || c === '>' || c === '/') break;
    const nameStart = i;
    while (i < limit && !/[\s=/>]/.test(xml[i] ?? '')) i++;
    const nameEnd = i;
    while (i < limit && /\s/.test(xml[i] ?? '')) i++;
    if (xml[i] !== '=') {
      // Érték nélküli attribútum: XML-ben nem szabályos, de nem akadunk el rajta.
      out.push({ name: xml.slice(nameStart, nameEnd), value: '', nameStart, nameEnd, valueStart: i, valueEnd: i });
      continue;
    }
    i++;
    while (i < limit && /\s/.test(xml[i] ?? '')) i++;
    const q = xml[i];
    if (q !== '"' && q !== "'") break;
    const valueStart = i + 1;
    const valueEnd = xml.indexOf(q, valueStart);
    if (valueEnd < 0) break;
    out.push({
      name: xml.slice(nameStart, nameEnd),
      value: unescapeXml(xml.slice(valueStart, valueEnd)),
      nameStart,
      nameEnd,
      valueStart,
      valueEnd,
    });
    i = valueEnd + 1;
  }
  return out;
}

export function getAttr(xml: string, node: XmlNode, name: string): string | null {
  for (const a of attributesOf(xml, node)) if (a.name === name) return a.value;
  return null;
}

export interface ElementRange {
  name: string;
  /** A nyitó tag kezdete. */
  start: number;
  /** A záró tag vége (üres elemnél a tag vége). */
  end: number;
  /** A nyitó tag vége — ide szúrjuk be az attribútumokat. */
  openEnd: number;
  contentStart: number;
  contentEnd: number;
  selfClosing: boolean;
}

export interface FindOptions {
  /** Csak a legkülső előfordulások (egymásba ágyazott azonos nevűeknél). */
  outermost?: boolean;
}

/**
 * A megadott nevű elemek tartományai, dokumentumsorrendben.
 *
 * A veremkezelés fontos: a `<w:ins>` és a `<w:del>` egymásba ágyazódik, és a
 * hibás záró tagon nem szabad elakadni — a valós fájlokban ritkán, de előfordul.
 */
export function findElements(xml: string, names: Set<string>, opts: FindOptions = {}): ElementRange[] {
  const stack: { name: string; start: number; openEnd: number }[] = [];
  const out: ElementRange[] = [];

  scanXml(xml, (node) => {
    if (node.kind === 'open') {
      stack.push({ name: node.name, start: node.start, openEnd: node.end });
      return;
    }
    if (node.kind === 'self') {
      if (names.has(node.name)) {
        out.push({
          name: node.name,
          start: node.start,
          end: node.end,
          openEnd: node.end,
          contentStart: node.end,
          contentEnd: node.end,
          selfClosing: true,
        });
      }
      return;
    }
    if (node.kind !== 'close') return;

    let i = stack.length - 1;
    while (i >= 0 && stack[i]!.name !== node.name) i--;
    if (i < 0) return; // párja vesztett zárótag: átlépjük
    const open = stack[i]!;
    stack.length = i;
    if (names.has(node.name)) {
      out.push({
        name: node.name,
        start: open.start,
        end: node.end,
        openEnd: open.openEnd,
        contentStart: open.openEnd,
        contentEnd: node.start,
        selfClosing: false,
      });
    }
  });

  out.sort((a, b) => a.start - b.start || b.end - a.end);
  if (!opts.outermost) return out;

  const kept: ElementRange[] = [];
  let coveredTo = -1;
  for (const r of out) {
    if (r.start < coveredTo) continue;
    kept.push(r);
    coveredTo = r.end;
  }
  return kept;
}

export interface Splice {
  start: number;
  end: number;
  text: string;
}

/**
 * Beszúrások alkalmazása egy menetben, hátulról előre.
 *
 * Hátulról, hogy a még alkalmazatlan beszúrások pozíciói ne csússzanak el.
 * Az átfedést nem javítjuk, hanem hibaként dobjuk: a csendben összefolyt
 * szerkesztés nem észlelhető hibát okozna a kimeneten.
 */
export function applySplices(xml: string, splices: Splice[]): string {
  if (splices.length === 0) return xml;
  const sorted = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      throw new Error(
        `Átfedő XML-szerkesztés a(z) ${sorted[i]!.start}. pozíciónál — ezt nem hajtjuk végre.`,
      );
    }
  }
  let out = xml;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i]!;
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return out;
}

/** Elemek teljes törlése, a tartalmukkal együtt. */
export function removeElements(xml: string, names: Set<string>): string {
  const ranges = findElements(xml, names, { outermost: true });
  return applySplices(
    xml,
    ranges.map((r) => ({ start: r.start, end: r.end, text: '' })),
  );
}

/** Elemek burkának eltávolítása, a tartalom meghagyásával. */
export function unwrapElements(xml: string, names: Set<string>): string {
  const ranges = findElements(xml, names, { outermost: true });
  const splices: Splice[] = [];
  for (const r of ranges) {
    if (r.selfClosing) {
      splices.push({ start: r.start, end: r.end, text: '' });
      continue;
    }
    splices.push({ start: r.start, end: r.contentStart, text: '' });
    splices.push({ start: r.contentEnd, end: r.end, text: '' });
  }
  return applySplices(xml, splices);
}

/** Elem átnevezése a nyitó és a záró tagban is (`w:delText` → `w:t`). */
export function renameElements(xml: string, from: string, to: string): string {
  const splices: Splice[] = [];
  scanXml(xml, (node) => {
    if (node.name !== from) return;
    if (node.kind === 'open' || node.kind === 'self') {
      splices.push({ start: node.start + 1, end: node.nameEnd, text: to });
    } else if (node.kind === 'close') {
      splices.push({ start: node.start + 2, end: node.nameEnd, text: to });
    }
  });
  return applySplices(xml, splices);
}

/**
 * Attribútumok törlése név alapján, KIZÁRÓLAG tagokon belül.
 *
 * A tagon belüliségre azért van szükség, mert a keresett minta a szöveg
 * törzsében is előfordulhat (egy OOXML-ről szóló iratban simán). Reguláris
 * kifejezéssel az egész forráson ezt nem lehetne szétválasztani.
 */
export function stripAttributes(xml: string, matches: (name: string) => boolean): string {
  const splices: Splice[] = [];
  scanXml(xml, (node) => {
    if (node.kind !== 'open' && node.kind !== 'self') return;
    for (const a of attributesOf(xml, node)) {
      if (!matches(a.name)) continue;
      // A név előtti szóközt is visszük, hogy ne maradjon dupla elválasztás.
      let from = a.nameStart;
      while (from > node.nameEnd && /\s/.test(xml[from - 1] ?? '')) from--;
      splices.push({ start: from, end: a.valueEnd + 1, text: '' });
    }
  });
  return applySplices(xml, splices);
}

/** Egy elem szöveges tartalmának cseréje (üres elemre is működik). */
export function setElementText(xml: string, name: string, text: string): string {
  const ranges = findElements(xml, new Set([name]), { outermost: true });
  const splices: Splice[] = ranges.map((r) =>
    r.selfClosing
      ? { start: r.start, end: r.end, text: `<${name}>${escapeXmlText(text)}</${name}>` }
      : { start: r.contentStart, end: r.contentEnd, text: escapeXmlText(text) },
  );
  return applySplices(xml, splices);
}

const TEXT_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/** Szövegtartalom kódolása `<w:t>`-be és társaiba. */
export function escapeXmlText(s: string): string {
  return stripControlChars(s).replace(/[&<>]/g, (c) => TEXT_ESCAPES[c] ?? c);
}

/**
 * Vezérlőkarakterek szóközre cserélése.
 *
 * Az XML 1.0 nem engedi meg őket, és egyetlen bennmaradt darab az egész részt
 * olvashatatlanná teszi a Word számára. A tabulátor és a sortörés WML-ben külön
 * elem (`<w:tab/>`, `<w:br/>`), nem karakter — ezért ezek is szóközzé válnak.
 */
function stripControlChars(s: string): string {
  let out = '';
  for (const ch of s) out += (ch.codePointAt(0) ?? 32) < 0x20 ? ' ' : ch;
  return out;
}

export function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function unescapeXml(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/**
 * Jólformáltság-ellenőrzés a kimeneten.
 *
 * Nem sémavalidálás — azt a Word végzi el. Ez azt a hibaosztályt fogja meg,
 * amit mi tudunk okozni: elrontott tagpárosítás a beszúrások után.
 */
export function checkWellFormed(xml: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  scanXml(xml, (node) => {
    if (node.kind === 'open') stack.push(node.name);
    else if (node.kind === 'close') {
      const top = stack.pop();
      if (top !== node.name) {
        problems.push(`Nem illeszkedő zárótag: </${node.name}> a(z) ${node.start}. pozíciónál (nyitva: ${top ?? 'semmi'}).`);
      }
    }
  });
  if (stack.length > 0) problems.push(`Lezáratlan elem(ek): ${stack.join(', ')}.`);
  return problems;
}
