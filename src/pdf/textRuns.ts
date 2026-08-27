/**
 * Szövegszakaszok kinyerése a PDF tartalomfolyamából, pozícióval együtt.
 *
 * Egy "szakasz" egy összefüggő sor: onnantól, hogy a szövegmátrix beáll
 * (BT vagy Tm), addig, amíg új sor nem kezdődik. Minden szakaszról tudjuk
 *  - a kiolvasott magyar szöveget,
 *  - az alapvonal kezdőpontját az oldal koordinátarendszerében,
 *  - a tényleges betűméretet,
 *  - és a betűket kirajzoló utasítások BÁJTTARTOMÁNYÁT.
 *
 * Az utolsó a lényeg: ez teszi lehetővé, hogy a betűket ténylegesen TÖRÖLJÜK a
 * fájlból, ne csak ráfessünk egy fekete téglalapot.
 *
 * A lap szövege nem csak a /Contents folyamban van. A Do operátor egy külön
 * objektum (Form XObject) tartalmát rajzolja be: fejléc, lábléc, bélyegző,
 * aláírásblokk, iratsablon — sok PDF-készítőnél a törzs egy része is. Ezért a
 * bejárás rekurzív, és minden szakasz megjegyzi, MELYIK folyamból való: a
 * törléskor a bájttartomány csak a saját folyamában értelmes.
 */

import { ContentTokenizer, type Operation, type TokenValue } from './tokenizer.js';
import { type CMap, decodeWithCMap } from './toUnicode.js';
import {
  type ExtractionWarnings,
  type FontWarning,
  emptyWarnings,
} from './warnings.js';

/** [a b c d e f] — PDF-mátrix. */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A lap saját /Contents folyamának azonosítója. */
export const ROOT_STREAM_ID = 'page';

/**
 * Beágyazási korlát. Egy XObject közvetve hivatkozhat önmagára; ilyenkor a
 * bejárás soha nem állna meg. A valódi iratok 2-3 szintnél mélyebbre nem
 * mennek, a nyolc bőven elég.
 */
const DEFAULT_MAX_DEPTH = 8;

/**
 * Hány Form XObject bejárását engedjük egy lapon. Nem a mélység ellen véd,
 * hanem a szélesség ellen: A kétszer hívja B-t, B kétszer C-t, és a
 * mélységkorláton belül is kétszázötvenhat bejárás lenne. Az anonimizáló
 * BIZALMATLAN fájlt nyit meg, ezért ilyenkor is véges munkát kell végeznie.
 */
const DEFAULT_MAX_FORMS = 512;

/** m1 × m2 */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function applyPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export interface ByteRange {
  start: number;
  end: number;
  /**
   * Melyik tartalomfolyamban érvényes a tartomány. Enélkül egy Form XObjectből
   * származó tartomány a lap folyamára íródna rá: ott más bájtok vannak, a
   * törlés eltalálna egy tetszőleges utasítást, és a név a helyén maradna.
   */
  streamId: string;
}

export interface TextSegment {
  /** A szakasz kiolvasott szövege. */
  text: string;
  /** Az alapvonal kezdőpontja az oldal koordinátáiban (pont). */
  x: number;
  y: number;
  /** Tényleges betűméret pontban (a mátrixok skálázását is beleértve). */
  fontSize: number;
  /** A betűkészlet erőforrás-neve, pl. "F4". */
  fontKey: string;
  /** Melyik tartalomfolyamból való — a lapé vagy egy Form XObjecté. */
  streamId: string;
  /** A szöveget kirajzoló utasítások bájttartományai — ezeket töröljük. */
  opRanges: ByteRange[];
  /** A szakasz teljes szélessége pontban (a rajzolt utolsó glifa végéig). */
  width: number;
  /**
   * A szakaszon belüli rajzolási lépések: melyik szövegrész hol kezdődik az
   * oldalon. Ebből számoljuk a kiemelő téglalapokat a felületen — enélkül csak
   * egész sorokat tudnánk megjelölni, és a felhasználó nem látná, pontosan
   * melyik szót cseréljük.
   */
  runs: TextRun[];
}

export interface TextRun {
  /** Az oldal koordinátái pontban. */
  x: number;
  y: number;
  /** A szakasz szövegén belüli karakterhatárok. */
  textStart: number;
  textEnd: number;
}

export interface FontInfo {
  cmap: CMap | null;
  /**
   * Hány bájt egy karakterkód, ha ToUnicode tábla nincs. A Type0 készletek
   * kódjai kétbájtosak — enélkül a kihagyott karaktereket kétszer annyinak
   * mérnénk, mint amennyi. Ha a hívó nem tudja, egy bájttal számolunk.
   */
  codeBytes?: number;
  /** A /BaseFont a PDF-ből, csak a figyelmeztetés érthetőségéhez. */
  baseFont?: string;
}

/** Egy bejárható tartalomfolyam: a lap gyökere vagy egy Form XObject. */
export interface ContentStream {
  /** Azonosító a visszaíráshoz; a lapé ROOT_STREAM_ID, az XObjecté a hivatkozása. */
  id: string;
  content: Uint8Array;
  fonts: Map<string, FontInfo>;
  /**
   * A Do operátor feloldása a folyam SAJÁT erőforrás-szótárából. Azért
   * visszahívás, mert a PDF-objektumok feloldása a hívó dolga: ez a modul
   * pusztán bájtokat és mátrixokat ismer, PDF-könyvtárat nem.
   */
  resolveXObject?: (name: string) => XObjectLookup;
}

export interface FormXObject extends ContentStream {
  /** A form saját /Matrix-a; a Do helyén érvényes CTM elé szorozzuk. */
  matrix?: Matrix;
}

/**
 * A Do feloldásának eredménye.
 *
 * A kép azért külön eset, mert nem hiba: minden szkennelt lapon van, és ha
 * hiányzó tartalomként jelentenénk, a figyelmeztetés zajjá válna, és a
 * felhasználó megszokná, hogy átlapozza.
 */
export type XObjectLookup =
  | { kind: 'form'; stream: FormXObject }
  | { kind: 'image' }
  | { kind: 'missing' };

export interface ExtractOptions {
  baseCtm?: Matrix;
  maxDepth?: number;
  maxForms?: number;
}

export interface ExtractionResult {
  segments: TextSegment[];
  /** Amit NEM láttunk. Üres szerkezet is beszédes: akkor tényleg mindent láttunk. */
  warnings: ExtractionWarnings;
}

const SHOW_OPS = new Set(['Tj', 'TJ', "'", '"']);

/**
 * Felvétel a figyelmeztetéslistára, ismétlés nélkül.
 *
 * Egy rosszindulatú irat ugyanazt a feloldhatatlan nevet ezerszer is
 * meghívhatja; a darabszám ilyenkor hazudna arról, mennyi tartalmat hagytunk ki.
 */
function note(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/** A bejárás közös állapota — a rekurzió minden szintje ugyanezt írja. */
interface WalkState {
  warnings: ExtractionWarnings;
  /** Készletenkénti gyűjtő; a kulcs folyamonként külön, mert az „F1" folyamonként MÁS készlet. */
  fontWarnings: Map<string, FontWarning>;
  maxDepth: number;
  /** Hány Form XObject bejárása van még hátra. */
  formsLeft: number;
}

/**
 * Szövegszakaszok kinyerése — a lap folyamából és a benne rajzolt Form
 * XObjectekből is.
 */
export function extractContent(stream: ContentStream, options: ExtractOptions = {}): ExtractionResult {
  const state: WalkState = {
    warnings: emptyWarnings(),
    fontWarnings: new Map(),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    formsLeft: options.maxForms ?? DEFAULT_MAX_FORMS,
  };
  const segments = walkStream(stream, options.baseCtm ?? IDENTITY, 0, new Set([stream.id]), state);

  for (const fw of state.fontWarnings.values()) {
    if (fw.unresolved > 0 || fw.missingToUnicode || fw.unknownFont) state.warnings.fonts.push(fw);
  }
  state.warnings.unresolvedCodes = state.warnings.fonts.reduce((a, f) => a + f.unresolved, 0);
  return { segments, warnings: state.warnings };
}

/**
 * Régi belépési pont: egyetlen folyam, XObject-bejárás nélkül.
 *
 * Szándékosan nem lép be a Form XObjectekbe: aki így hívja, a lap folyamára
 * fogja alkalmazni a kapott bájttartományokat, és egy XObjectből származó
 * tartomány ott rossz helyre írna. Aki a beágyazott részeket is akarja,
 * az extractContent-et hívja, és folyamonként törli a tartományokat.
 */
export function extractTextSegments(
  content: Uint8Array,
  fonts: Map<string, FontInfo>,
  baseCtm: Matrix = IDENTITY,
): TextSegment[] {
  return extractContent({ id: ROOT_STREAM_ID, content, fonts }, { baseCtm }).segments;
}

function walkStream(
  stream: ContentStream,
  baseCtm: Matrix,
  depth: number,
  path: Set<string>,
  state: WalkState,
): TextSegment[] {
  const ops = new ContentTokenizer(stream.content).parseOperations();

  const ctmStack: Matrix[] = [];
  let ctm: Matrix = baseCtm;
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let fontKey = '';
  let fontSize = 0;
  let leading = 0;

  const segments: TextSegment[] = [];
  // A TypeScript szűkítése nem lát bele a lezárt függvényekbe, ezért egyelemű
  // tárolóban tartjuk az aktuális szakaszt.
  const cur: { seg: TextSegment | null } = { seg: null };

  const num = (t: TokenValue | undefined): number => (t && t.kind === 'number' ? t.value : 0);

  const startSegment = (): void => {
    flush();
    const m = multiply(tm, ctm);
    const [x, y] = applyPoint(m, 0, 0);
    // A függőleges egységvektor hossza adja a tényleges betűméretet.
    const scale = Math.hypot(m[2], m[3]);
    cur.seg = {
      text: '',
      x,
      y,
      fontSize: fontSize * scale,
      fontKey,
      streamId: stream.id,
      opRanges: [],
      width: 0,
      runs: [],
    };
  };

  const flush = (): void => {
    if (cur.seg && cur.seg.text.trim().length > 0) segments.push(cur.seg);
    cur.seg = null;
  };

  /** A készlet gyűjtője; folyamonként külön, mert az erőforrásnevek folyamonként mást jelentenek. */
  const fontWarning = (key: string, font: FontInfo | undefined): FontWarning => {
    const id = `${stream.id} ${key}`;
    let fw = state.fontWarnings.get(id);
    if (!fw) {
      fw = {
        fontKey: key,
        baseFont: font?.baseFont,
        missingToUnicode: font !== undefined && !font.cmap,
        unknownFont: font === undefined,
        unresolved: 0,
      };
      state.fontWarnings.set(id, fw);
    }
    return fw;
  };

  const show = (op: Operation, bytesList: number[][]): void => {
    if (!cur.seg) startSegment();
    const seg = cur.seg;
    if (!seg) return;
    const font = stream.fonts.get(fontKey);
    const runStart = seg.text.length;
    const [rx, ry] = applyPoint(multiply(tm, ctm), 0, 0);
    for (const bytes of bytesList) {
      if (!font?.cmap) {
        // ToUnicode nélkül csak nyers bájtokat látnánk, ezért nem állítunk
        // szöveget — de MEGSZÁMOLJUK a kimaradt kódokat. Régen ez a lépés
        // némán kimaradt, és a részhalmazolt „Kovács János"-ból „Kovcs Jnos"
        // lett, amire a névkereső soha nem illeszkedik: a program úgy
        // jelentette, hogy nem talált nevet, holott nem is látta a szöveget.
        const step = Math.max(1, font?.codeBytes ?? 1);
        fontWarning(fontKey, font).unresolved += Math.ceil(bytes.length / step);
        continue;
      }
      for (const g of decodeWithCMap(bytes, font.cmap)) {
        // Az üres leképezés is veszteség: a tábla létezik, de ez a kód hiányzik
        // belőle. Egyetlen kiesett betű elég ahhoz, hogy a névre ne illeszkedjünk.
        if (g.text === '') fontWarning(fontKey, font).unresolved++;
        else seg.text += g.text;
      }
    }
    if (seg.text.length > runStart) {
      seg.runs.push({ x: rx, y: ry, textStart: runStart, textEnd: seg.text.length });
    }
    seg.opRanges.push({ start: op.start, end: op.end, streamId: stream.id });
  };

  /** Do: a hivatkozott Form XObject tartalmának bejárása a helyén. */
  const doXObject = (name: string): void => {
    const found = stream.resolveXObject?.(name) ?? { kind: 'missing' as const };
    if (found.kind === 'image') return;
    if (found.kind === 'missing') {
      note(state.warnings.unresolvedXObjects, name);
      return;
    }

    const child = found.stream;
    if (depth + 1 > state.maxDepth || path.has(child.id) || state.formsLeft <= 0) {
      // Körkörös vagy túl mély hivatkozás. Amit nem járunk be, azt kimondjuk:
      // a „nem találtam" itt sem jelentheti azt, hogy „nincs ott".
      note(state.warnings.skippedForms, child.id);
      return;
    }
    state.formsLeft--;

    // A form saját szöveget rajzol; a nyitott szakaszt le kell zárni, különben
    // a beágyazott sorok a lap egy félbehagyott sorába csúsznának bele. Csak
    // itt, a tényleges belépésnél: egy kép Do-ja nem szakíthat ketté egy sort.
    flush();

    // A form saját koordinátarendszere: /Matrix, majd a Do helyén érvényes CTM.
    // A grafikus állapotot nem kell visszaállítani, mert a gyermek a saját
    // másolatán dolgozik — a mi ctm-ünkhöz hozzá sem nyúl.
    const childBase = multiply(child.matrix ?? IDENTITY, ctm);
    path.add(child.id);
    // A betűkészlet és a betűméret szándékosan nem öröklődik: az erőforrásnevek
    // folyamonként mást jelentenek, egy örökölt „F1" a form MÁSIK készletére
    // mutatna, és rossz ToUnicode táblával olvasnánk ki a szöveget.
    for (const seg of walkStream(child, childBase, depth + 1, path, state)) segments.push(seg);
    path.delete(child.id);
  };

  for (const op of ops) {
    switch (op.operator) {
      case 'q':
        ctmStack.push(ctm);
        break;
      case 'Q':
        ctm = ctmStack.pop() ?? ctm;
        break;
      case 'cm': {
        const m: Matrix = [num(op.operands[0]), num(op.operands[1]), num(op.operands[2]), num(op.operands[3]), num(op.operands[4]), num(op.operands[5])];
        ctm = multiply(m, ctm);
        break;
      }
      case 'BT':
        tm = IDENTITY;
        tlm = IDENTITY;
        startSegment();
        break;
      case 'ET':
        flush();
        break;
      case 'Tf': {
        const nameTok = op.operands[0];
        fontKey = nameTok && nameTok.kind === 'name' ? nameTok.value : fontKey;
        fontSize = num(op.operands[1]);
        if (cur.seg) {
          const m = multiply(tm, ctm);
          cur.seg.fontSize = fontSize * Math.hypot(m[2], m[3]);
          cur.seg.fontKey = fontKey;
        }
        break;
      }
      case 'TL':
        leading = num(op.operands[0]);
        break;
      case 'Tm': {
        tm = [num(op.operands[0]), num(op.operands[1]), num(op.operands[2]), num(op.operands[3]), num(op.operands[4]), num(op.operands[5])];
        tlm = tm;
        startSegment();
        break;
      }
      case 'Td': {
        const tx = num(op.operands[0]);
        const ty = num(op.operands[1]);
        tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
        tm = tlm;
        // Csak a függőleges elmozdulás jelent új sort; a vízszintes a
        // betűnkénti pozicionálás (a Chrome minden betűt külön Td-vel tesz ki).
        if (ty !== 0) startSegment();
        break;
      }
      case 'TD': {
        const tx = num(op.operands[0]);
        const ty = num(op.operands[1]);
        leading = -ty;
        tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
        tm = tlm;
        if (ty !== 0) startSegment();
        break;
      }
      case 'T*':
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        startSegment();
        break;
      case 'Tj': {
        const t = op.operands[0];
        if (t && (t.kind === 'string' || t.kind === 'hexstring')) show(op, [t.bytes]);
        break;
      }
      case "'":
      case '"': {
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        startSegment();
        const t = op.operands[op.operands.length - 1];
        if (t && (t.kind === 'string' || t.kind === 'hexstring')) show(op, [t.bytes]);
        break;
      }
      case 'TJ': {
        const arr = op.operands[0];
        if (arr && arr.kind === 'array') {
          const parts: number[][] = [];
          for (const item of arr.items) {
            if (item.kind === 'string' || item.kind === 'hexstring') parts.push(item.bytes);
          }
          show(op, parts);
        }
        break;
      }
      case 'Do': {
        const nameTok = op.operands[0];
        if (nameTok && nameTok.kind === 'name') doXObject(nameTok.value);
        break;
      }
      default:
        if (SHOW_OPS.has(op.operator)) {
          // Ismeretlen formájú szövegrajzoló: a tartományt akkor is jegyezzük.
          if (!cur.seg) startSegment();
          cur.seg?.opRanges.push({ start: op.start, end: op.end, streamId: stream.id });
        }
        break;
    }
  }
  flush();

  // Szélesség: az utolsó és az első rajzolt glifa pozíciója közti távolság
  // pontos számításához betűmetrikák kellenének; itt a szakasz utolsó
  // utasításának pozíciójából becsüljük, csak diagnosztikához.
  return segments;
}

/** Bájttartományok folyamonkénti csoportosítása — a törlés csak így helyes. */
export function groupRangesByStream(ranges: ByteRange[]): Map<string, ByteRange[]> {
  const out = new Map<string, ByteRange[]>();
  for (const r of ranges) {
    const list = out.get(r.streamId);
    if (list) list.push(r);
    else out.set(r.streamId, [r]);
  }
  return out;
}

/**
 * A megadott bájttartományok TÖRLÉSE a tartalomfolyamból.
 *
 * Ez a valódi kitakarás: a glifákat kirajzoló utasítások eltűnnek a fájlból,
 * így semmilyen szövegkinyerő nem tudja visszaolvasni őket. (Szemben a fekete
 * téglalap rajzolásával, ami alatt a szöveg érintetlenül megmarad.)
 *
 * A streamId megadása nem formaság: ha a hívó több folyam tartományait keveri
 * egy listába, a szűrés nélkül a MÁSIK folyam bájtjait vágnánk ki innen.
 */
export function deleteRanges(content: Uint8Array, ranges: ByteRange[], streamId?: string): Uint8Array {
  const own = streamId === undefined ? ranges : ranges.filter((r) => r.streamId === streamId);
  if (own.length === 0) return content;
  const sorted = [...own].sort((a, b) => a.start - b.start);
  const merged: ByteRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const out: number[] = [];
  let cursor = 0;
  for (const r of merged) {
    for (let i = cursor; i < r.start; i++) out.push(content[i]!);
    // Szóközzel pótoljuk, hogy a szomszédos tokenek ne folyjanak össze.
    out.push(0x20);
    cursor = r.end;
  }
  for (let i = cursor; i < content.length; i++) out.push(content[i]!);
  return Uint8Array.from(out);
}
