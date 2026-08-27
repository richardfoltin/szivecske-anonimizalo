/**
 * Lapos szöveg egy DOCX-részből, visszaképzéssel — a futamokra tört név gondja.
 *
 * A Word egyetlen szót is szétvághat több `<w:r>` futamra. Nem azért, mert
 * máshogy néznek ki, hanem mert a szerkesztés nyomát (RSID) őrzi. A „Kovács
 * János" a fájlban gyakran így áll:
 *
 *   <w:r w:rsidR="00A1"><w:t>Kov</w:t></w:r>
 *   <w:r w:rsidR="00B2"><w:t>ács Já</w:t></w:r>
 *   <w:r w:rsidR="00C3"><w:t>nos</w:t></w:r>
 *
 * Ha futamonként keresnénk, ezt a nevet SOHA nem találnánk meg. Ugyanaz a hiba,
 * mint a PDF-nél a sortörésen átnyúló név (lásd `pdf/pageText.ts`), és ugyanaz a
 * megoldás: normalizálás → laposítás → csere → visszaképzés.
 *
 * A visszaképzés szándékosan nem hasít futamot. A cserét az ELSŐ érintett
 * `<w:t>` elembe írjuk, a többiből csak a lefedett részt vesszük ki. Így az
 * álnév automatikusan az első futam `<w:rPr>` formázását viseli, a találat
 * utáni maradék pedig a saját futamában marad a saját formázásával — futamhasítás
 * nélkül, kevesebb változtatott bájttal.
 */

import type { Edit } from '../pdf/pageText.js';
import {
  type Splice,
  type XmlNode,
  applySplices,
  attributesOf,
  escapeXmlAttr,
  escapeXmlText,
  findElements,
  scanXml,
  unescapeXml,
} from './xml.js';

/**
 * Mit hordoz a töredék:
 *  'text'  — látható szöveg (`w:t`, `a:t`, `c:v`),
 *  'instr' — mezőkód (`w:instrText`): HYPERLINK, MERGEFIELD, AUTHOR, FILENAME
 *            — ezekben rendszeresen ott a név és a szerző gépének útvonala,
 *  'del'   — változáskövetéssel törölt szöveg (`w:delText`); a Wordben nem
 *            látszik, a fájlban szó szerint ott van,
 *  'attr'  — attribútumérték (kapcsolat célja, alternatív szöveg, WordArt).
 */
export type FragmentKind = 'text' | 'instr' | 'del' | 'attr';

export interface TextFragment {
  /** Hely a rész lapos szövegében. */
  start: number;
  end: number;
  kind: FragmentKind;
  /** A hordozó elem teljes tartománya (üres elem újraírásához kell). */
  elementStart: number;
  elementEnd: number;
  /** A nyitó tag vége — ide szúrjuk be az `xml:space` attribútumot. */
  openTagEnd: number;
  /** A cserélendő tartalom tartománya az XML-forrásban. */
  contentStart: number;
  contentEnd: number;
  tagName: string;
  selfClosing: boolean;
  /** Igaz, ha attribútumértéket írunk (más a kódolás, nincs `xml:space`). */
  isAttribute: boolean;
  /** A tartalom entitásmentesítve — a lapos szöveg ebből épül. */
  decoded: string;
  /** Hányadik `<w:r>` futamban áll; −1, ha nem futamban. */
  runIndex: number;
}

export interface PartText {
  text: string;
  fragments: TextFragment[];
}

/** Egy résztípus szöveghordozóinak leírása. */
export interface CarrierProfile {
  /** Elemnév → mit hordoz. */
  elements: Map<string, FragmentKind>;
  /** Elemnév → szöveget hordozó attribútumainak neve. */
  attributes: Map<string, string[]>;
  /** Üres elem, ami elválasztót jelent a lapos szövegben (`w:tab` → tab). */
  emptyBreaks: Map<string, string>;
  /** Zárótag, ami elválasztót jelent (`w:p` → sortörés). */
  closeBreaks: Map<string, string>;
  /** Igaz, ha a részben futamokat kell nyilvántartani. */
  hasRuns: boolean;
  /**
   * Igaz, ha MINDEN tisztán szöveges elem hordozónak számít.
   *
   * A `customXml/item*.xml` részekhez kell: azok tetszőleges sémájú, az ügyvédi
   * iroda saját sablonjából származó adatok, ahol az elemneveket nem ismerjük
   * előre — viszont pont ott ülnek a tartalomvezérlőkhöz kötött nevek.
   */
  allText: boolean;
}

function profile(
  elements: [string, FragmentKind][],
  attributes: [string, string[]][],
  emptyBreaks: [string, string][],
  closeBreaks: [string, string][],
  hasRuns: boolean,
  allText = false,
): CarrierProfile {
  return {
    elements: new Map(elements),
    attributes: new Map(attributes),
    emptyBreaks: new Map(emptyBreaks),
    closeBreaks: new Map(closeBreaks),
    hasRuns,
    allText,
  };
}

/**
 * WordprocessingML: a törzs, az élőfej, az élőláb, a lábjegyzet, a végjegyzet,
 * a megjegyzés és a szótár része. A `<a:t>` is itt van, mert az alakzatokba és
 * a WordArtba írt szöveg DrawingML-ként ül a `<w:drawing>` belsejében.
 */
export const WML_PROFILE = profile(
  [
    ['w:t', 'text'],
    ['a:t', 'text'],
    ['w:instrText', 'instr'],
    ['w:delInstrText', 'instr'],
    ['w:delText', 'del'],
  ],
  [
    // Kép alternatív szövege: a Word ide másolja a fájlnevet, benne a névvel.
    // A `name` ugyanennek a másik fele: a rajzelem neve az objektumablakban
    // („Kovács János aláírása"), és a képnél magának a képfájlnak a neve.
    ['wp:docPr', ['descr', 'title', 'name']],
    ['pic:cNvPr', ['descr', 'title', 'name']],
    // WordArt a régi (VML) ágon: a szöveg attribútumban áll.
    ['v:textpath', ['string']],
    // Ugyanennek a régi ágnak az alternatív szövege és címe. A szövegdoboz
    // `mc:Fallback` ágán nincs `wp:docPr`, a leírás ide kerül — vagyis ez az
    // a rejtekhely, ami a másik ág takarítása után is megmaradna.
    ['v:shape', ['alt', 'o:title']],
    ['w:comment', ['w:author', 'w:initials']],
    // Az egyszerű mező a kódját ATTRIBÚTUMBAN hordozza. A mezőkód-kezelés a
    // `w:instrText` ELEMRE néz, ezért a `w:fldSimple w:instr=" MERGEFIELD
    // Kovács_János "` alak eddig érintetlenül ment át a kimenetre.
    ['w:fldSimple', ['w:instr']],
    // A könyvjelző nevét a Word a kijelölt szövegből — jellemzően a címsorból —
    // gyártja, ezért a felek neve rendszeresen bekerül. A Wordben soha nem
    // látszik, kicsomagolva egy sorban ott van.
    ['w:bookmarkStart', ['w:name']],
    // A `w:anchor` ugyanaz a karakterlánc, mint a könyvjelző neve. Ha csak az
    // egyiket cserélnénk, a Word a hivatkozás helyére „Hiba! A könyvjelző nem
    // létezik" üzenetet írna — ezért a kettő EGYÜTT hordozó.
    ['w:hyperlink', ['w:tooltip', 'w:anchor']],
    // A táblázat kisegítő címe és leírása: a Word csak a tulajdonságablakban
    // mutatja, a fájlban sima attribútum.
    ['w:tblCaption', ['w:val']],
    ['w:tblDescription', ['w:val']],
  ],
  [
    ['w:br', '\n'],
    ['w:cr', '\n'],
    ['a:br', '\n'],
    ['w:tab', '\t'],
    ['w:noBreakHyphen', '-'],
  ],
  [
    ['w:p', '\n'],
    ['a:p', '\n'],
    ['w:tr', '\n'],
    ['w:tc', '\t'],
  ],
  true,
);

/** Diagramok: a cím és a gyorsítótárazott kategóriaértékek is nevet hordoznak. */
export const CHART_PROFILE = profile(
  [
    ['a:t', 'text'],
    ['c:v', 'text'],
  ],
  [],
  [['a:br', '\n']],
  [
    ['a:p', '\n'],
    ['c:pt', '\n'],
    ['c:tx', '\n'],
  ],
  false,
);

/** SmartArt adatmodell: a szöveg `<a:t>` elemekben. */
export const DIAGRAM_PROFILE = profile([['a:t', 'text']], [], [['a:br', '\n']], [['a:p', '\n']], false);

/** Dokumentumtulajdonságok: szerző, cég, sablon, dokumentumrész-címek. */
export const PROPS_PROFILE = profile(
  [
    ['dc:creator', 'text'],
    ['dc:title', 'text'],
    ['dc:subject', 'text'],
    ['dc:description', 'text'],
    ['cp:lastModifiedBy', 'text'],
    ['cp:keywords', 'text'],
    ['cp:category', 'text'],
    ['cp:contentStatus', 'text'],
    ['Company', 'text'],
    ['Manager', 'text'],
    ['Template', 'text'],
    ['Application', 'text'],
    ['vt:lpstr', 'text'],
    ['vt:lpwstr', 'text'],
  ],
  [['property', ['name']]],
  [],
  [
    ['dc:creator', '\n'],
    ['dc:title', '\n'],
    ['dc:subject', '\n'],
    ['dc:description', '\n'],
    ['cp:lastModifiedBy', '\n'],
    ['cp:keywords', '\n'],
    ['cp:category', '\n'],
    ['Company', '\n'],
    ['Manager', '\n'],
    ['Template', '\n'],
    ['vt:lpstr', '\n'],
    ['vt:lpwstr', '\n'],
  ],
  false,
);

/**
 * Kapcsolatlista. A `Target` külső hivatkozásnál teljes URL vagy útvonal:
 * `mailto:kovacs.janos@pelda.hu`, `file:///C:/Users/kovacsj/...`. A Wordben
 * ebből semmi nem látszik, kicsomagolva minden.
 */
export const RELS_PROFILE = profile([], [['Relationship', ['Target']]], [], [], false);

/**
 * Megjegyzésírók listája. A név itt attribútumban ül, nem szövegben —
 * `<w15:person w15:author="Kovács János">`.
 */
export const PEOPLE_PROFILE = profile(
  [],
  [
    ['w15:person', ['w15:author']],
    ['w15:presenceInfo', ['w15:userId']],
  ],
  [],
  [],
  false,
);

/**
 * Egyedi XML adatrész. Tetszőleges séma, ezért minden szöveges elemet
 * hordozónak veszünk; a tartalomvezérlőkhöz kötött nevek itt élnek.
 */
export const CUSTOM_XML_PROFILE = profile([], [], [], [], false, true);

/** Nincs benne kezelendő szöveg (kép, betűkészlet, téma). */
export const EMPTY_PROFILE = profile([], [], [], [], false);

/**
 * Amit a Word maga gyárt, és sosem tartalmaz nevet.
 *
 * A `_GoBack` az utolsó szerkesztés helye, a `_Toc…` a tartalomjegyzék
 * horgonya. Ezek minden Word-dokumentumban ott vannak, tucatszámra; ha
 * beengednénk őket a lapos szövegbe, az átnézendő szöveget hígítanák fel.
 * Szándékosan HORGONYZOTT a minta: valódi könyvjelzőnév soha nem áll pontosan
 * ebből az alakból.
 */
const WORD_GENERATED_ATTR = /^_(GoBack|Toc\d+|Hlk\d+|Ref\d+)$/;

/**
 * A rész lapos szövege és a töredéktérkép.
 *
 * A mezőkódok, a törölt szövegek és az attribútumok sortöréssel elválasztva
 * kerülnek a lapos szövegbe. Így egy `SeedMatcher`-futás lefedi az egész részt,
 * de a mezőkód szövege nem folyik össze a törzsszöveggel — az összefolyás
 * kitalált találatokat szülne.
 *
 * Az attribútumok ezen belül a rész szövegének VÉGÉRE kerülnek, nem oda, ahol
 * az elemük áll. A `w:bookmarkStart` és a `w:fldSimple` ugyanis a mondat
 * közepén, sőt szó közepén is állhat — a Word a `_GoBack` könyvjelzőt pontosan
 * oda teszi, ahol utoljára szerkesztettek. Ha ott elválasztót írnánk a lapos
 * szövegbe, a „Kov|ács" határon kettévágnánk a nevet, és a keresés soha nem
 * találná meg. Külön blokkban a végén se a mondatot nem vágjuk el, se a
 * törzsszöveggel nem folyik össze az attribútum tartalma.
 */
export function buildPartText(xml: string, prof: CarrierProfile): PartText {
  const fragments: TextFragment[] = [];
  const deferredAttrs: { fragment: TextFragment; decoded: string }[] = [];
  let text = '';
  let runIndex = -1;
  let runCounter = -1;
  let pending: { node: XmlNode; kind: FragmentKind } | null = null;

  const appendSeparated = (fragment: TextFragment, decoded: string): void => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
    fragment.start = text.length;
    text += decoded;
    fragment.end = text.length;
    text += '\n';
    fragments.push(fragment);
  };

  scanXml(xml, (node) => {
    if (prof.hasRuns) {
      if (node.name === 'w:r' && node.kind === 'open') runIndex = ++runCounter;
      else if (node.name === 'w:r' && node.kind === 'close') runIndex = -1;
    }

    if (pending !== null) {
      if (node.kind === 'close' && node.name === pending.node.name) {
        const open = pending.node;
        const kind = pending.kind;
        pending = null;
        const decoded = unescapeXml(xml.slice(open.end, node.start));
        const fragment: TextFragment = {
          start: 0,
          end: 0,
          kind,
          elementStart: open.start,
          elementEnd: node.end,
          openTagEnd: open.end,
          contentStart: open.end,
          contentEnd: node.start,
          tagName: open.name,
          selfClosing: false,
          isAttribute: false,
          decoded,
          runIndex,
        };
        if (kind === 'text' && !prof.allText) {
          fragment.start = text.length;
          text += decoded;
          fragment.end = text.length;
          fragments.push(fragment);
        } else {
          appendSeparated(fragment, decoded);
        }
        return;
      }
      // Idegen csomópont a hordozón belül: a hordozót lezártnak tekintjük, hogy
      // egy hibás fájl ne nyelje el a rész maradékát.
      if (node.kind !== 'text') pending = null;
    }

    if (node.kind === 'self') {
      const sep = prof.emptyBreaks.get(node.name);
      if (sep !== undefined) text += sep;
      const carrier = prof.elements.get(node.name);
      if (carrier !== undefined) {
        const fragment: TextFragment = {
          start: 0,
          end: 0,
          kind: carrier,
          elementStart: node.start,
          elementEnd: node.end,
          openTagEnd: node.end,
          contentStart: node.end,
          contentEnd: node.end,
          tagName: node.name,
          selfClosing: true,
          isAttribute: false,
          decoded: '',
          runIndex,
        };
        if (carrier === 'text') {
          fragment.start = text.length;
          fragment.end = text.length;
          fragments.push(fragment);
        } else {
          appendSeparated(fragment, '');
        }
      }
    }

    if (node.kind === 'close') {
      const sep = prof.closeBreaks.get(node.name);
      if (sep !== undefined) text += sep;
      return;
    }

    if (node.kind !== 'open' && node.kind !== 'self') return;

    const attrNames = prof.attributes.get(node.name);
    if (attrNames !== undefined) {
      for (const a of attributesOf(xml, node)) {
        if (!attrNames.includes(a.name) || a.value === '') continue;
        if (WORD_GENERATED_ATTR.test(a.value)) continue;
        deferredAttrs.push({
          fragment: {
            start: 0,
            end: 0,
            kind: 'attr',
            elementStart: node.start,
            elementEnd: node.end,
            openTagEnd: node.end,
            contentStart: a.valueStart,
            contentEnd: a.valueEnd,
            tagName: node.name,
            selfClosing: node.kind === 'self',
            isAttribute: true,
            decoded: a.value,
            runIndex,
          },
          decoded: a.value,
        });
      }
    }

    if (node.kind === 'open') {
      const carrier = prof.elements.get(node.name) ?? (prof.allText ? 'text' : undefined);
      if (carrier !== undefined) pending = { node, kind: carrier };
    }
  });

  // A töredéklista így is növekvő sorrendben marad: minden itt hozzáfűzött
  // attribútum a törzsszöveg VÉGE után kap helyet. A visszaírás erre a
  // sorrendre épül (az első érintett töredék kapja a teljes cserét).
  for (const d of deferredAttrs) appendSeparated(d.fragment, d.decoded);

  return { text, fragments };
}

export interface ApplyResult {
  xml: string;
  applied: number;
  warnings: string[];
}

/**
 * A lapos szövegen megadott cserék visszaírása az XML-be.
 *
 * A csere teljes egészében az ELSŐ érintett töredékbe kerül, a többiből a
 * lefedett rész kimarad — ugyanaz a szabály, mint a PDF oldalain
 * (`segmentTextAfterEdits`). Minden érintett `<w:t>` megkapja az
 * `xml:space="preserve"` attribútumot: nélküle a Word levágja a szó eleji és
 * végi szóközt, és a szavak összefolynak.
 */
export function applyEditsToPart(xml: string, part: PartText, edits: Edit[]): ApplyResult {
  const warnings: string[] = [];
  if (edits.length === 0) return { xml, applied: 0, warnings };

  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      throw new Error(
        `Átfedő csere a lapos szöveg ${sorted[i]!.start}. pozíciójánál — ezt nem hajtjuk végre.`,
      );
    }
  }

  interface LocalOp {
    from: number;
    to: number;
    insert: string;
  }
  const ops = new Map<number, LocalOp[]>();
  let applied = 0;

  for (const edit of sorted) {
    const touched: number[] = [];
    for (let i = 0; i < part.fragments.length; i++) {
      const f = part.fragments[i]!;
      if (f.start < edit.end && edit.start < f.end) touched.push(i);
      // Nulla hosszú töredékbe (üres `<w:t/>`) is beleeshet a beszúrás.
      else if (f.start === f.end && f.start === edit.start && edit.start === edit.end) touched.push(i);
    }
    if (touched.length === 0) {
      warnings.push(
        `A(z) ${edit.start}–${edit.end} csere nem esik szöveghordozóra (elválasztóra esik), kimaradt.`,
      );
      continue;
    }

    const sink = touched[0]!;
    for (const i of touched) {
      const f = part.fragments[i]!;
      const list = ops.get(i) ?? [];
      list.push({
        from: Math.max(edit.start, f.start) - f.start,
        to: Math.min(edit.end, f.end) - f.start,
        insert: i === sink ? edit.replacement : '',
      });
      ops.set(i, list);
    }
    applied++;
  }

  const splices: Splice[] = [];
  for (const [index, list] of ops) {
    const f = part.fragments[index]!;
    list.sort((a, b) => a.from - b.from);
    let next = '';
    let cursor = 0;
    for (const op of list) {
      next += f.decoded.slice(cursor, op.from) + op.insert;
      cursor = op.to;
    }
    next += f.decoded.slice(cursor);
    if (next === f.decoded) continue;

    if (f.isAttribute) {
      splices.push({ start: f.contentStart, end: f.contentEnd, text: escapeXmlAttr(next) });
      continue;
    }

    const encoded = escapeXmlText(next);
    if (f.selfClosing) {
      // `<w:t/>` → `<w:t xml:space="preserve">…</w:t>`, a meglévő attribútumokkal.
      const openSource = xml.slice(f.elementStart, f.elementEnd).replace(/\/>$/, '>');
      splices.push({
        start: f.elementStart,
        end: f.elementEnd,
        text: `${withPreserve(openSource, f.tagName)}${encoded}</${f.tagName}>`,
      });
      continue;
    }

    const openSource = xml.slice(f.elementStart, f.openTagEnd);
    const withSpace = withPreserve(openSource, f.tagName);
    if (withSpace !== openSource) {
      splices.push({ start: f.elementStart, end: f.openTagEnd, text: withSpace });
    }
    splices.push({ start: f.contentStart, end: f.contentEnd, text: encoded });
  }

  return { xml: applySplices(xml, splices), applied, warnings };
}

/**
 * `xml:space="preserve"` a nyitó tagra.
 *
 * Csak a `w:` névtér szövegelemeire tesszük ki: a DrawingML `<a:t>` alapból
 * megőrzi a szóközt, és nem akarunk olyan attribútumot írni a fájlba, amit a
 * Word nem maga írna oda.
 */
function withPreserve(openTag: string, tagName: string): string {
  if (!tagName.startsWith('w:')) return openTag;
  if (/\sxml:space\s*=/.test(openTag)) return openTag;
  return `${openTag.slice(0, -1)} xml:space="preserve">`;
}

export interface NormalizeResult {
  xml: string;
  merged: number;
  warnings: string[];
}

/**
 * Normalizálás: az azonos formázású, szomszédos futamok összevonása.
 *
 * A legtöbb futamhatár nem formázási különbség, hanem a Word szerkesztésnyoma
 * (RSID). Ha ezeket előbb összevonjuk, a csere egyetlen `<w:t>`-be kerül,
 * és nem marad utána féltucat üres futam.
 *
 * Biztonsági feltétel: az összevonás UTÁN a lapos szövegnek karakterre
 * azonosnak kell lennie. Ha nem az, az eredeti XML-lel megyünk tovább —
 * inkább maradjon szétvágva, mint hogy csendben elmozduljon a szöveg.
 */
export function mergeAdjacentRuns(xml: string, prof: CarrierProfile): NormalizeResult {
  if (!prof.hasRuns) return { xml, merged: 0, warnings: [] };

  // Szándékosan MINDEN futam, nem csak a legkülső: a szövegdoboz futamai egy
  // külső `<w:r>` belsejében ülnek, és ott ugyanúgy szét van vágva a név.
  // Átfedés nem keletkezhet, mert összevonhatónak csak az a futam számít,
  // amiben már nincs másik futam (csak `<w:t>` vagy `<w:instrText>`).
  const runs = findElements(xml, new Set(['w:r'])).filter((r) => !r.selfClosing);
  const shapes = runs.map((r) => runShape(xml, r.contentStart, r.contentEnd));

  const splices: Splice[] = [];
  let merged = 0;
  let i = 0;
  while (i < runs.length) {
    const first = runs[i]!;
    const firstShape = shapes[i]!;
    let j = i;
    if (firstShape.bodyKind !== null) {
      while (j + 1 < runs.length) {
        const next = runs[j + 1]!;
        const nextShape = shapes[j + 1]!;
        const between = xml.slice(runs[j]!.end, next.start);
        if (between.trim() !== '') break;
        if (nextShape.bodyKind !== firstShape.bodyKind) break;
        if (nextShape.rPr !== firstShape.rPr) break;
        j++;
      }
    }
    if (j > i) {
      let body = xml.slice(first.contentStart, first.contentEnd);
      for (let k = i + 1; k <= j; k++) {
        body += xml.slice(shapes[k]!.bodyStart, runs[k]!.contentEnd);
      }
      splices.push({
        start: first.start,
        end: runs[j]!.end,
        text: `${xml.slice(first.start, first.contentStart)}${body}</w:r>`,
      });
      merged += j - i;
    }
    i = j + 1;
  }

  if (splices.length === 0) return { xml, merged: 0, warnings: [] };

  const next = applySplices(xml, splices);
  const before = buildPartText(xml, prof).text;
  const after = buildPartText(next, prof).text;
  if (before !== after) {
    return {
      xml,
      merged: 0,
      warnings: ['A futamösszevonás megváltoztatta volna a szöveget, ezért kimaradt.'],
    };
  }
  return { xml: next, merged, warnings: [] };
}

interface RunShape {
  /** A futam `<w:rPr>` blokkja szó szerint, vagy üres, ha nincs. */
  rPr: string;
  /** A tartalom kezdete az `<w:rPr>` után. */
  bodyStart: number;
  /** 'text', ha a törzs csak `<w:t>`; 'instr', ha csak `<w:instrText>`; null, ha egyéb. */
  bodyKind: 'text' | 'instr' | null;
}

/**
 * Egy futam alakja.
 *
 * Csak a tisztán szöveges futamot vonjuk össze. Amint bármi más van benne
 * (kép, mezőkarakter, tabulátor, sortörés, lábjegyzet-hivatkozás, szimbólum),
 * az összevonás jelentést változtathat, ezért nem nyúlunk hozzá.
 */
function runShape(xml: string, contentStart: number, contentEnd: number): RunShape {
  const body = xml.slice(contentStart, contentEnd);
  let rPr = '';
  let rPrStart = 0;
  let bodyStart = contentStart;
  let depth = 0;
  let bodyKind: 'text' | 'instr' | null = null;
  let failed = false;

  scanXml(body, (node) => {
    if (failed) return;

    if (depth > 0) {
      if (node.kind === 'open') depth++;
      else if (node.kind === 'close') {
        depth--;
        if (depth === 0 && node.name === 'w:rPr') {
          rPr = body.slice(rPrStart, node.end);
          bodyStart = contentStart + node.end;
        }
      }
      return;
    }

    if (node.kind === 'text') {
      // A futam gyermekei között csak elválasztó szóköz állhat.
      if (body.slice(node.start, node.end).trim() !== '') failed = true;
      return;
    }
    if (node.kind === 'comment' || node.kind === 'pi' || node.kind === 'cdata') {
      failed = true;
      return;
    }
    if (node.kind === 'close') return; // a saját záró tagunk nincs a törzsben

    if (node.name === 'w:rPr') {
      if (bodyKind !== null) {
        failed = true; // formázás a tartalom UTÁN: nem nyúlunk hozzá
        return;
      }
      if (node.kind === 'self') {
        rPr = body.slice(node.start, node.end);
        bodyStart = contentStart + node.end;
      } else {
        rPrStart = node.start;
        depth = 1;
      }
      return;
    }

    const kind = node.name === 'w:t' ? 'text' : node.name === 'w:instrText' ? 'instr' : null;
    if (kind === null || (bodyKind !== null && bodyKind !== kind)) {
      failed = true;
      return;
    }
    bodyKind = kind;
    if (node.kind === 'open') depth = 1;
  });

  return { rPr, bodyStart, bodyKind: failed ? null : bodyKind };
}
