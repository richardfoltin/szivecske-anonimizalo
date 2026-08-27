/**
 * Híd a PDF-objektumok és a szövegkinyerő között.
 *
 * A textRuns.ts szándékosan csak bájtokat és mátrixokat ismer — így tesztelhető
 * marad PDF-könyvtár nélkül. De valahol fel kell oldani a /XObject
 * hivatkozásokat és a betűkészletek ToUnicode tábláit, és ez a valahol itt van.
 *
 * A lap szövege ugyanis nem csak a /Contents folyamban áll. A Do operátor egy
 * másik objektum tartalmát rajzolja be a lapra; fejléc, lábléc, bélyegző,
 * aláírásblokk és iratsablon szinte mindig így kerül oda. Amíg ide nem léptünk
 * be, az ott lévő név nem jutott el a keresőig, és mivel a kimenet ellenőrzése
 * is a MI kiolvasott szövegünkön fut, semmi nem jelezte a hiányt: a program
 * tisztának mondta az iratot.
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';

import {
  ROOT_STREAM_ID,
  type ContentStream,
  type FontInfo,
  type FormXObject,
  type Matrix,
  type XObjectLookup,
} from './textRuns.js';
import { type CMap, parseToUnicode } from './toUnicode.js';

type Context = PDFPage['node']['context'];

export interface PageStreams {
  /** A lap gyökér-tartalomfolyama, a Do-feloldással együtt. */
  root: ContentStream;
  /**
   * Amit ki sem tudtunk csomagolni (ismeretlen tömörítés, sérült folyam).
   * Ezek tartalmát NEM láttuk, tehát a felületnek szólnia kell róla — a néma
   * kihagyás pont az a hiba, ami miatt a program tisztának mondta az iratot.
   */
  unreadable: string[];
  /** Egy folyam nyers (kicsomagolt) tartalma azonosító szerint. */
  content(streamId: string): Uint8Array | null;
  /** A megváltozott folyam visszaírása. Hamis, ha a folyamot nem tudtuk azonosítani. */
  write(streamId: string, bytes: Uint8Array): boolean;
}

/**
 * A lap bejárható folyamai.
 *
 * A visszaadott szerkezet lusta: az XObjectek csak akkor oldódnak fel, amikor a
 * bejárás tényleg rájuk lép. Egy száz bélyegzős iraton ez a különbség a
 * megnyitás sebességében is látszik.
 *
 * A rootId azért állítható, mert a lap saját folyamának neve laponként ugyanaz
 * volna. Aki több lap törlendő tartományait EGY listába gyűjti, annak lapnyi
 * egyedi nevet kell adnia (`page:0`, `page:1`, …), különben a második lap
 * tartományai az első lap folyamára íródnának rá.
 */
export function readPageStreams(page: PDFPage, rootId: string = ROOT_STREAM_ID): PageStreams {
  const ctx = page.node.context;
  const registry = new Map<string, { content: Uint8Array; ref: PDFRef | null }>();
  const fontCache = new Map<PDFDict, Map<string, FontInfo>>();
  const streamCache = new Map<string, FormXObject>();

  const unreadable: string[] = [];
  const rootContent = readContents(ctx, page, unreadable);
  registry.set(rootId, { content: rootContent, ref: null });

  const rootResources = page.node.Resources();
  const root: ContentStream = {
    id: rootId,
    content: rootContent,
    fonts: readFonts(ctx, rootResources, fontCache),
    resolveXObject: (name) => resolve(ctx, rootResources, name, registry, fontCache, streamCache, unreadable),
  };

  return {
    root,
    unreadable,
    content(streamId) {
      const hit = registry.get(streamId);
      if (hit) return hit.content;
      // Az exportkor a munkamenet ÚJRA betölti a fájlt, tehát más
      // PDFDocument-példányon dolgozik, mint elemzéskor. Az azonosító viszont a
      // PDF-hivatkozás, ami ugyanazokra a bájtokra ugyanaz — így a folyam a
      // bejárás megismétlése nélkül is megtalálható.
      const ref = parseRefId(streamId);
      if (!ref) return null;
      const bytes = streamBytes(ctx.lookup(ref));
      if (!bytes) return null;
      registry.set(streamId, { content: bytes, ref });
      return bytes;
    },
    write(streamId, bytes) {
      if (streamId === rootId) {
        // Ha a /Contents tömb volt, a bájtjainkat az összefűzött folyamra
        // számoltuk, ezért a tömb helyére EGY folyam kerül.
        page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(bytes)));
        return true;
      }
      const ref = registry.get(streamId)?.ref ?? parseRefId(streamId);
      if (!ref) return false;
      const original = ctx.lookup(ref);
      if (!(original instanceof PDFStream)) return false;
      ctx.assign(ref, rebuildStream(ctx, original, bytes));
      return true;
    },
  };
}

/** Egy oldal tartalomfolyama egyben (a /Contents tömb is lehet). */
function readContents(ctx: Context, page: PDFPage, unreadable: string[]): Uint8Array {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array();
  if (contents instanceof PDFArray) {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const bytes = streamBytes(ctx.lookup(contents.get(i)));
      if (bytes) parts.push(bytes);
      // Kihagyott darab: a bájtjaink így is önmagukkal konzisztensek, de az itt
      // rajzolt szöveget nem láttuk — ezt ki kell mondani, nem elnyelni.
      else unreadable.push(`${contents.get(i)}`);
    }
    const total = parts.reduce((a, b) => a + b.length + 1, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
      // Sorvég a darabok közé: a szabvány szerint a tömb elemhatára egyben
      // tokenhatár is, e nélkül két utasítás összeragadna.
      out[o++] = 0x0a;
    }
    return out;
  }
  return streamBytes(contents) ?? new Uint8Array();
}

/** A /XObject bejegyzés feloldása a folyam SAJÁT erőforrás-szótárából. */
function resolve(
  ctx: Context,
  resources: PDFDict | undefined,
  name: string,
  registry: Map<string, { content: Uint8Array; ref: PDFRef | null }>,
  fontCache: Map<PDFDict, Map<string, FontInfo>>,
  streamCache: Map<string, FormXObject>,
  unreadable: string[],
): XObjectLookup {
  const xobjects = dictEntry(ctx, resources, 'XObject');
  if (!xobjects) return { kind: 'missing' };
  const entry = xobjects.get(PDFName.of(name));
  if (!entry) return { kind: 'missing' };

  // A szabvány szerint a folyam mindig önálló objektum. Ha itt mégsem
  // hivatkozás áll, a fájl szerkezete sérült: ilyenkor nem találgatunk, hanem
  // hiányként jelentjük — a felhasználó legalább tudja, hogy nem néztük meg.
  if (!(entry instanceof PDFRef)) return { kind: 'missing' };
  const ref = entry;
  const obj = ctx.lookup(ref);
  if (!(obj instanceof PDFStream)) return { kind: 'missing' };

  const subtype = nameValue(obj.dict.get(PDFName.of('Subtype')));
  // A kép nem hiba és nem hiány: minden szkennelt lapon van. Ha hiányzó
  // tartalomként jelentenénk, a figyelmeztetés zajjá válna, és a felhasználó
  // pont akkor lapozná át, amikor számítana.
  if (subtype === 'Image') return { kind: 'image' };
  if (subtype !== 'Form') return { kind: 'missing' };

  // Azonosító: a PDF-hivatkozás. Ez az, ami a fájl újratöltése után is ugyanaz,
  // és ettől ismerjük fel a körkörös hivatkozást is.
  const id = ref.tag;
  const cached = streamCache.get(id);
  if (cached) return { kind: 'form', stream: cached };

  const bytes = streamBytes(obj);
  if (!bytes) {
    unreadable.push(id);
    return { kind: 'missing' };
  }

  // Ha a formnak nincs saját /Resources szótára, a szabvány szerint azét
  // használjuk, ahonnan berajzolták.
  const own = dictEntry(ctx, obj.dict, 'Resources') ?? resources;

  const stream: FormXObject = {
    id,
    content: bytes,
    fonts: readFonts(ctx, own, fontCache),
    matrix: readMatrix(ctx, obj.dict),
    resolveXObject: (child) => resolve(ctx, own, child, registry, fontCache, streamCache, unreadable),
  };
  registry.set(id, { content: bytes, ref });
  streamCache.set(id, stream);
  return { kind: 'form', stream };
}

/** A betűkészletek ToUnicode táblái erőforrásnév szerint. */
function readFonts(
  ctx: Context,
  resources: PDFDict | undefined,
  cache: Map<PDFDict, Map<string, FontInfo>>,
): Map<string, FontInfo> {
  const fonts = dictEntry(ctx, resources, 'Font');
  if (!fonts) return new Map();
  const hit = cache.get(fonts);
  if (hit) return hit;

  const out = new Map<string, FontInfo>();

  for (const [key, value] of fonts.entries()) {
    const dict = asDict(ctx.lookup(value));
    if (!dict) continue;
    const subtype = nameValue(dict.get(PDFName.of('Subtype')));
    const encoding = nameValue(dict.get(PDFName.of('Encoding')));
    const baseFont = nameValue(dict.get(PDFName.of('BaseFont')));

    let cmap: CMap | null = null;
    const tu = dict.get(PDFName.of('ToUnicode'));
    if (tu) {
      const bytes = streamBytes(ctx.lookup(tu));
      // Egy sérült tábla nem akadályozhatja meg az irat megnyitását; a
      // hiányzó kódokat úgyis megszámoljuk, tehát nem lesz néma a veszteség.
      if (bytes) {
        try {
          cmap = parseToUnicode(bytes);
        } catch {
          cmap = null;
        }
      }
    }

    // A kód hossza a betűkészlet KÓDOLÁSÁBÓL következik, nem a ToUnicode
    // táblából: az egyszerű készletek kódjai mindig egybájtosak, az
    // Identity-H/V pedig mindig kétbájtos. Van készítő, amelyik ezt rosszul
    // írja a táblába — ilyenkor minden második bájt kódnak látszana, és az
    // egész sor felismerhetetlen betűhalmazzá esne szét. Ahol nem tudjuk
    // biztosan (ismeretlen altípus), ott a táblát hagyjuk dönteni.
    const identity = encoding === 'Identity-H' || encoding === 'Identity-V';
    const simple = subtype === 'Type1' || subtype === 'MMType1' || subtype === 'TrueType' || subtype === 'Type3';
    if (cmap && subtype === 'Type0' && identity) cmap.codeBytes = 2;
    if (cmap && simple) cmap.codeBytes = 1;

    // Ha ToUnicode tábla nincs, a kimaradt karakterek MEGSZÁMOLÁSÁHOZ is kell a
    // kódhossz, különben egy kétbájtos készletnél kétszer annyi elveszett
    // betűt jelentenénk, mint amennyi valójában van.
    const codeBytes = cmap?.codeBytes ?? (subtype === 'Type0' ? 2 : 1);

    out.set(key.asString().replace(/^\//, ''), {
      cmap,
      codeBytes,
      ...(baseFont ? { baseFont } : {}),
    });
  }
  cache.set(fonts, out);
  return out;
}

/** A form /Matrix-a, ha van és hat számból áll. */
function readMatrix(ctx: Context, dict: PDFDict): Matrix | undefined {
  const raw = ctx.lookup(dict.get(PDFName.of('Matrix')));
  if (!(raw instanceof PDFArray) || raw.size() !== 6) return undefined;
  const nums: number[] = [];
  for (let i = 0; i < 6; i++) {
    const n = ctx.lookup(raw.get(i));
    if (!(n instanceof PDFNumber)) return undefined;
    nums.push(n.asNumber());
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!];
}

/**
 * Új folyam a régi szótárával.
 *
 * A /BBox, a /Matrix, a /Resources és a /Group át kell hogy jöjjön, különben a
 * form üresen vagy rossz helyen jelenne meg. A tömörítés leírását viszont NEM
 * visszük át: az új tartalom másképp van tömörítve.
 */
function rebuildStream(ctx: Context, original: PDFStream, bytes: Uint8Array): PDFRawStream {
  const fresh = ctx.flateStream(bytes);
  const skip = [PDFName.of('Filter'), PDFName.of('Length'), PDFName.of('DecodeParms'), PDFName.of('DL')];
  for (const [key, value] of original.dict.entries()) {
    if (skip.includes(key)) continue;
    fresh.dict.set(key, value);
  }
  return fresh;
}

/** Kicsomagolt bájtok bármilyen folyamból; hiba esetén null, sosem kivétel. */
function streamBytes(obj: unknown): Uint8Array | null {
  try {
    if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode();
    if (obj instanceof PDFStream) return obj.getContents();
  } catch {
    // Ismeretlen tömörítés (pl. JPXDecode) vagy sérült folyam: a hívó ezt
    // hiányként jelenti, nem tesz úgy, mintha üres lenne a tartalom.
    return null;
  }
  return null;
}

function dictEntry(ctx: Context, dict: PDFDict | undefined, key: string): PDFDict | undefined {
  if (!dict) return undefined;
  // Szándékosan nem a lookup(kulcs, PDFDict) alakot használjuk: az KIVÉTELT dob,
  // ha a kulcs hiányzik — és a hiányzó /Font vagy /XObject teljesen szabályos.
  return asDict(ctx.lookup(dict.get(PDFName.of(key))));
}

function asDict(obj: unknown): PDFDict | undefined {
  return obj instanceof PDFDict ? obj : undefined;
}

function nameValue(obj: unknown): string | undefined {
  return obj instanceof PDFName ? obj.asString().replace(/^\//, '') : undefined;
}

/** „12 0 R" → hivatkozás. Más alakra null. */
function parseRefId(id: string): PDFRef | null {
  const m = /^(\d+) (\d+) R$/.exec(id);
  if (!m) return null;
  return PDFRef.of(Number(m[1]), Number(m[2]));
}
