/**
 * Metaadat- és rejtettadat-takarítás, plusz a változáskövetés feloldása.
 *
 * A kozmetikai kitakarás klasszikus bukása nem a szövegben van, hanem mellette:
 * a szerző neve a dokumentumtulajdonságokban, a cég a `docProps/app.xml`-ben, a
 * megjegyzésírók a `people.xml`-ben, az első oldal előnézeti KÉPE a
 * `docProps/thumbnail`-ben, és mindenekelőtt a `<w:del>` blokkok, amelyekben a
 * „törölt" mondat szó szerint, épen ott áll a fájlban.
 *
 * Ezért az export addig nem indul el, amíg feloldatlan változáskövetés van a
 * dokumentumban. Nem javítjuk ki magunktól: az elfogadás és az elutasítás
 * MÁS iratot ad, ezt csak az ügyvéd döntheti el.
 */

import { stripImageMetadata } from './media.js';
import { classifyPart, mediaParts, resolveTarget } from './parts.js';
import { WML_PROFILE } from './text.js';
import {
  type Splice,
  applySplices,
  attributesOf,
  removeElements,
  renameElements,
  scanXml,
  setElementText,
  stripAttributes,
  unwrapElements,
} from './xml.js';
import type { ZipArchive } from './zip.js';

/** Tartalmi változáskövetés: ezekben ott a másik változat szövege. */
const CONTENT_REVISIONS = ['w:ins', 'w:del', 'w:moveFrom', 'w:moveTo'] as const;

/**
 * Formázási változáskövetés. Ezekben nincs szöveg, de a KORÁBBI formázás igen —
 * és a jelenlétük elárulja, hogy az iraton dolgoztak. Mindkét irányban törlődnek.
 */
const FORMAT_REVISIONS = [
  'w:rPrChange',
  'w:pPrChange',
  'w:tblPrChange',
  'w:trPrChange',
  'w:tcPrChange',
  'w:sectPrChange',
  'w:tblGridChange',
  'w:tblPrExChange',
  'w:numberingChange',
];

/** Tartomány- és cellajelölők: önmagukban üresek, de párban maradva zavarnak. */
const REVISION_MARKERS = [
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
  'w:customXmlInsRangeStart',
  'w:customXmlInsRangeEnd',
  'w:customXmlDelRangeStart',
  'w:customXmlDelRangeEnd',
  'w:customXmlMoveFromRangeStart',
  'w:customXmlMoveFromRangeEnd',
  'w:customXmlMoveToRangeStart',
  'w:customXmlMoveToRangeEnd',
  'w:cellIns',
  'w:cellDel',
  'w:cellMerge',
];

export interface RevisionReport {
  /** Részenként és fajtánként hány darab. */
  byPart: Map<string, Map<string, number>>;
  /** Összes feloldatlan tartalmi változás. */
  contentCount: number;
  /** Összes formázási változás. */
  formatCount: number;
  /** A változásokat jegyző szerzők neve — ez maga is személyes adat. */
  authors: string[];
}

export function findRevisions(zip: ZipArchive): RevisionReport {
  const byPart = new Map<string, Map<string, number>>();
  const authors = new Set<string>();
  let contentCount = 0;
  let formatCount = 0;

  const watched = new Set<string>([...CONTENT_REVISIONS, ...FORMAT_REVISIONS, ...REVISION_MARKERS]);

  for (const name of zip.names()) {
    const part = classifyPart(name);
    if (part.profile !== WML_PROFILE) continue;
    const xml = zip.readText(name);
    if (xml === null) continue;

    const counts = new Map<string, number>();
    scanXml(xml, (node) => {
      if (node.kind !== 'open' && node.kind !== 'self') return;
      if (!watched.has(node.name)) return;
      counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
      if ((CONTENT_REVISIONS as readonly string[]).includes(node.name)) contentCount++;
      else if (FORMAT_REVISIONS.includes(node.name)) formatCount++;
      const author = attributesOf(xml, node).find((a) => a.name === 'w:author')?.value;
      if (author !== undefined && author !== '') authors.add(author);
    });
    if (counts.size > 0) byPart.set(name, counts);
  }

  return { byPart, contentCount, formatCount, authors: [...authors].sort() };
}

/**
 * Minden változás ELFOGADÁSA egy WML-részben.
 *
 * A `<w:del>` blokk a tartalmával együtt eltűnik — ez a lényeg: onnantól nincs
 * mit visszafejteni belőle. A `<w:ins>` burka lekerül, a tartalma marad.
 *
 * Korlát: a bekezdésjel törlését (`<w:pPr><w:rPr><w:del/>`) nem hajtjuk végre,
 * csak a jelölőt vesszük ki. A két bekezdés így különálló marad, ahelyett hogy
 * összeolvadna. Szöveg nem szivárog, de a tördelés eltérhet attól, amit a Word
 * „Minden elfogadása" gombja adna.
 */
export function acceptAllRevisions(xml: string): string {
  let out = removeElements(xml, new Set(['w:del', 'w:moveFrom', ...FORMAT_REVISIONS, ...REVISION_MARKERS]));
  out = unwrapElements(out, new Set(['w:ins', 'w:moveTo']));
  return out;
}

/**
 * Minden változás ELUTASÍTÁSA egy WML-részben.
 *
 * A `<w:ins>` a tartalmával együtt eltűnik, a `<w:del>` tartalma visszakerül a
 * törzsbe — ezért a `w:delText` elemeket vissza kell nevezni `w:t`-re,
 * különben a Word nem jeleníti meg őket. A visszakerült szöveg innentől normál
 * szöveg: az álnevesítés is látja és cseréli.
 */
export function rejectAllRevisions(xml: string): string {
  let out = removeElements(xml, new Set(['w:ins', 'w:moveTo', ...FORMAT_REVISIONS, ...REVISION_MARKERS]));
  out = unwrapElements(out, new Set(['w:del', 'w:moveFrom']));
  out = renameElements(out, 'w:delText', 'w:t');
  out = renameElements(out, 'w:delInstrText', 'w:instrText');
  return out;
}

/** A változáskövetés feloldása a csomag minden WML-részében. */
export function resolveRevisionsInPackage(zip: ZipArchive, mode: 'accept' | 'reject'): number {
  let touched = 0;
  for (const name of zip.names()) {
    if (classifyPart(name).profile !== WML_PROFILE) continue;
    const xml = zip.readText(name);
    if (xml === null) continue;
    const next = mode === 'accept' ? acceptAllRevisions(xml) : rejectAllRevisions(xml);
    if (next !== xml) {
      zip.write(name, next);
      touched++;
    }
  }
  return touched;
}

export interface SanitizeOptions {
  /** Ha igaz, a megjegyzések a fájlban maradnak (alapból töröljük őket). */
  keepComments?: boolean;
  /** Ha igaz, a `dc:title` és `dc:subject` marad (alapból ezeket is töröljük). */
  keepTitle?: boolean;
}

export interface SanitizeReport {
  /** Törölt részek. */
  removedParts: string[];
  /** Kiürített metaadatmezők, "rész: mező" alakban. */
  clearedFields: string[];
  /** Magyar figyelmeztetések a szereplapra. */
  warnings: string[];
}

const CORE_FIELDS_ALWAYS = [
  'dc:creator',
  'cp:lastModifiedBy',
  'cp:keywords',
  'cp:category',
  'dc:description',
  'cp:contentStatus',
];
const CORE_FIELDS_TITLE = ['dc:title', 'dc:subject'];
const CORE_FIELDS_REMOVE = ['dcterms:created', 'dcterms:modified', 'cp:lastPrinted'];

/**
 * A teljes csomag takarítása. Ez az export KÖTELEZŐ lépése, nem opció.
 *
 * A sorrend számít: előbb törlünk részeket, aztán söpörjük ki a rájuk mutató
 * kapcsolatokat és tartalomtípusokat. Fordítva sehová sem mutató hivatkozás
 * maradna, amitől a Word „javítható hibát" jelent a megnyitáskor.
 */
export function sanitizePackage(zip: ZipArchive, opts: SanitizeOptions = {}): SanitizeReport {
  const report: SanitizeReport = { removedParts: [], clearedFields: [], warnings: [] };

  const core = zip.readText('docProps/core.xml');
  if (core !== null) {
    let next = core;
    const fields = [...CORE_FIELDS_ALWAYS, ...(opts.keepTitle === true ? [] : CORE_FIELDS_TITLE)];
    for (const f of fields) {
      const cleared = setElementText(next, f, '');
      if (cleared !== next) report.clearedFields.push(`docProps/core.xml: ${f}`);
      next = cleared;
    }
    next = setElementText(next, 'cp:revision', '1');
    const removed = removeElements(next, new Set(CORE_FIELDS_REMOVE));
    if (removed !== next) report.clearedFields.push('docProps/core.xml: időbélyegek');
    next = removed;
    if (next !== core) zip.write('docProps/core.xml', next);
  }

  const app = zip.readText('docProps/app.xml');
  if (app !== null) {
    let next = app;
    for (const [field, value] of [
      ['Company', ''],
      ['Manager', ''],
      ['Template', 'Normal.dotm'],
      ['TotalTime', '0'],
    ] as [string, string][]) {
      const set = setElementText(next, field, value);
      if (set !== next) report.clearedFields.push(`docProps/app.xml: ${field}`);
      next = set;
    }
    // A TitlesOfParts a dokumentum címsorainak SZÖVEGÉT sorolja fel — ott a név
    // akkor is megmarad, ha a törzsben már lecseréltük.
    const stripped = removeElements(next, new Set(['TitlesOfParts', 'HeadingPairs']));
    if (stripped !== next) report.clearedFields.push('docProps/app.xml: TitlesOfParts, HeadingPairs');
    next = stripped;
    if (next !== app) zip.write('docProps/app.xml', next);
  }

  const toRemove: string[] = [];
  for (const name of zip.names()) {
    const kind = classifyPart(name).kind;
    if (kind === 'customProps') toRemove.push(name);
    else if (kind === 'thumbnail') toRemove.push(name);
    else if (!(opts.keepComments === true) && (kind === 'comments' || kind === 'commentsMeta' || kind === 'people')) {
      toRemove.push(name);
    }
  }
  for (const name of toRemove) {
    if (zip.remove(name)) report.removedParts.push(name);
  }

  // A megjegyzésjelölők a törzsben maradnának, immár sehová sem mutatva.
  if (!(opts.keepComments === true)) {
    for (const name of zip.names()) {
      if (classifyPart(name).profile !== WML_PROFILE) continue;
      const xml = zip.readText(name);
      if (xml === null) continue;
      const next = removeElements(
        xml,
        new Set(['w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference']),
      );
      if (next !== xml) zip.write(name, next);
    }
  }

  const settings = zip.readText('word/settings.xml');
  if (settings !== null) {
    // A w:rsids a szerkesztési munkamenetek ujjlenyomata: össze lehet belőle
    // kötni két iratot, és látszik rajta, mit mikor írtak bele.
    let next = removeElements(settings, new Set(['w:rsids', 'w:proofState']));
    // A csatolt sablon a szerző gépének teljes útvonalát tartalmazza, benne a
    // Windows-felhasználónévvel: "file:///C:/Users/kovacsj/.../Iroda.dotx".
    // Az elemet és a hozzá tartozó kapcsolatot is ki kell venni — magában az
    // elem törlése a külső célt a .rels fájlban hagyná.
    const withoutTemplate = removeElements(next, new Set(['w:attachedTemplate']));
    if (withoutTemplate !== next) {
      report.clearedFields.push('word/settings.xml: w:attachedTemplate');
      dropRelationshipsByType(zip, ['attachedTemplate']);
    }
    next = withoutTemplate;
    if (next !== settings) {
      report.clearedFields.push('word/settings.xml: w:rsids, w:proofState');
      zip.write('word/settings.xml', next);
    }
  }

  for (const name of zip.names()) {
    if (classifyPart(name).profile !== WML_PROFILE) continue;
    const xml = zip.readText(name);
    if (xml === null) continue;
    let next = stripAttributes(xml, (attr) => attr.startsWith('w:rsid'));
    next = removeElements(next, new Set(['w:proofErr']));
    if (next !== xml) zip.write(name, next);
  }

  report.warnings.push(...cleanMedia(zip, report));

  dropDeadRelationships(zip);
  dropDeadOverrides(zip);
  zip.normalizeTimestamps();

  const embedded = zip.names().filter((n) => classifyPart(n).kind === 'embedding');
  if (embedded.length > 0) {
    report.warnings.push(
      `${embedded.length} beágyazott objektum maradt a csomagban (${embedded.join(', ')}). ` +
        'Ezek önálló fájlok a fájlban; a tartalmukat NEM néztük át.',
    );
  }

  return report;
}

/**
 * Beágyazott képek: metaadat-takarítás és HANGOS figyelmeztetés.
 *
 * A kettő elválaszthatatlan. Az EXIF-et ki tudjuk venni, a képre RAJZOLT nevet
 * nem — a beszkennelt aláírás ugyanúgy azonosít, mint a kinyomtatott. Ezért a
 * darabszámot akkor is kimondjuk, ha egyetlen metaadatot sem találtunk: a
 * felhasználónak tudnia kell, hogy ezen a felületen nem dolgoztunk helyette.
 */
function cleanMedia(zip: ZipArchive, report: SanitizeReport): string[] {
  const images = mediaParts(zip);
  if (images.length === 0) return [];

  for (const name of images) {
    const bytes = zip.read(name);
    if (bytes === null || bytes.length === 0) continue;
    const cleaned = stripImageMetadata(bytes);
    if (cleaned.removed.length === 0) continue;
    zip.write(name, cleaned.bytes);
    report.clearedFields.push(`${name}: ${cleaned.removed.join(', ')}`);
  }

  return [
    `${images.length} beágyazott kép van a dokumentumban (${images.join(', ')}). ` +
      'A metaadataikat (EXIF, IPTC, XMP, PNG-szövegdarabok) kitöröltük, de a KÉPEN lévő ' +
      'szöveget nem olvassuk: ha aláírás, fejléc vagy képernyőkép van köztük, a nevet ' +
      'saját szemmel kell ellenőrizni.',
  ];
}

/**
 * Kapcsolatok törlése a típusuk alapján, minden .rels részből.
 *
 * A típus URI utolsó szakaszát nézzük ("…/attachedTemplate"), mert a névtér
 * eleje verziónként változik, a végződés nem.
 */
export function dropRelationshipsByType(zip: ZipArchive, typeSuffixes: string[]): number {
  const wanted = new Set(typeSuffixes);
  let dropped = 0;

  for (const relsName of zip.names()) {
    if (!relsName.endsWith('.rels')) continue;
    const xml = zip.readText(relsName);
    if (xml === null) continue;

    const splices: Splice[] = [];
    scanXml(xml, (node) => {
      if (node.name !== 'Relationship' || (node.kind !== 'open' && node.kind !== 'self')) return;
      const type = attributesOf(xml, node).find((a) => a.name === 'Type')?.value ?? '';
      if (!wanted.has(type.slice(type.lastIndexOf('/') + 1))) return;
      splices.push({ start: node.start, end: node.end, text: '' });
      dropped++;
    });
    if (splices.length > 0) zip.write(relsName, applySplices(xml, splices));
  }
  return dropped;
}

/** Sehová sem mutató kapcsolatok kisöprése minden .rels részből. */
export function dropDeadRelationships(zip: ZipArchive): number {
  const names = new Set(zip.names());
  let dropped = 0;

  for (const relsName of zip.names()) {
    if (!relsName.endsWith('.rels')) continue;
    const xml = zip.readText(relsName);
    if (xml === null) continue;

    const splices: Splice[] = [];
    scanXml(xml, (node) => {
      if (node.name !== 'Relationship' || (node.kind !== 'open' && node.kind !== 'self')) return;
      const attrs = attributesOf(xml, node);
      if (attrs.find((a) => a.name === 'TargetMode')?.value === 'External') return;
      const target = attrs.find((a) => a.name === 'Target')?.value;
      // A séma-előtaggal kezdődő cél külső hivatkozás, nem csomagon belüli rész.
      if (target === undefined || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return;
      if (names.has(resolveTarget(relsName, target))) return;
      splices.push({ start: node.start, end: node.end, text: '' });
      dropped++;
    });
    if (splices.length > 0) zip.write(relsName, applySplices(xml, splices));
  }
  return dropped;
}

/** Gazdátlan tartalomtípus-bejegyzések kisöprése. */
export function dropDeadOverrides(zip: ZipArchive): number {
  const xml = zip.readText('[Content_Types].xml');
  if (xml === null) return 0;
  const names = new Set(zip.names());
  const splices: Splice[] = [];
  let dropped = 0;

  scanXml(xml, (node) => {
    if (node.name !== 'Override' || (node.kind !== 'open' && node.kind !== 'self')) return;
    const part = attributesOf(xml, node).find((a) => a.name === 'PartName')?.value;
    if (part === undefined) return;
    if (names.has(part.replace(/^\//, ''))) return;
    splices.push({ start: node.start, end: node.end, text: '' });
    dropped++;
  });

  if (splices.length > 0) zip.write('[Content_Types].xml', applySplices(xml, splices));
  return dropped;
}

export interface Residue {
  part: string;
  needle: string;
  /** Bájtpozíció a KITÖMÖRÍTETT részben. */
  offset: number;
  encoding: 'utf-8' | 'utf-16le';
}

/**
 * Ellenőrző kör a kimeneten: megmaradt-e valahol az eredeti név.
 *
 * Szándékosan a NYERS bájtokban keres, minden részben, nem a kinyert szövegben.
 * A saját szövegkinyerőnk ugyanazokat a helyeket nézné, ahol cserélt — ezzel
 * saját magát igazolná vissza. Egy kicsomagoló viszont mindent lát, és az
 * ellenfél is azt fogja használni.
 *
 * A UTF-16LE azért kell, mert a beágyazott OLE-objektumok és a régi bináris
 * részek így tárolják a szöveget.
 *
 * MINDEN előfordulást visszaadunk, nem csak az elsőt. A darabszám maga is
 * bizonyíték: abból derül ki, hogy egy alak a szándékosan bennhagyott helyen
 * kívül MÁSHOL is ott van-e (lásd `anonymize.ts`, a megjósolt maradék).
 */
export function findResidue(zip: ZipArchive, needles: string[]): Residue[] {
  const out: Residue[] = [];
  const patterns: { needle: string; bytes: Uint8Array; encoding: 'utf-8' | 'utf-16le' }[] = [];
  for (const needle of needles) {
    if (needle === '') continue;
    patterns.push({ needle, bytes: new TextEncoder().encode(needle), encoding: 'utf-8' });
    patterns.push({ needle, bytes: utf16le(needle), encoding: 'utf-16le' });
  }

  for (const name of zip.names()) {
    const bytes = zip.read(name);
    if (bytes === null || bytes.length === 0) continue;
    for (const p of patterns) {
      // Átfedés nélkül lépkedünk: ugyanazt a bájtsort kétszer megszámolni
      // hamis többletet mutatna a megjósolt maradékhoz képest.
      let at = indexOfBytes(bytes, p.bytes, 0);
      while (at >= 0) {
        out.push({ part: name, needle: p.needle, offset: at, encoding: p.encoding });
        at = indexOfBytes(bytes, p.bytes, at + p.bytes.length);
      }
    }
  }
  return out;
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  const first = needle[0]!;
  const limit = haystack.length - needle.length;
  outer: for (let i = from; i <= limit; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
