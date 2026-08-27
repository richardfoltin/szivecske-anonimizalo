/**
 * DOCX beolvasás és álnevesített visszaírás — a felső szint.
 *
 * Ugyanaz az alak, mint a PDF oldalán: előbb egy LAPOS szöveget adunk
 * részenként, offszettérképpel; a hívó ezen futtatja a `SeedMatcher`-t és a
 * `substitute`-ot; végül a `{start, end, replacement}` szerkesztéseket
 * visszaírjuk a formázás megtartásával.
 *
 * Két dolgot ez a modul kényszerít ki, mert enélkül az egész munka
 * kozmetikai maradna:
 *
 *  1. **Feloldatlan változáskövetéssel nem exportálunk.** A `<w:del>` blokkban
 *     az eredeti mondat szó szerint ott van. Aki ilyen fájlt ad ki a kezéből,
 *     az pontosan azt a hibát követi el, amit el akar kerülni. Nem döntünk
 *     helyette: elfogadni vagy elutasítani más iratot ad, ezt az ügyvéd
 *     dönti el (`resolveRevisions`).
 *  2. **A szövegdoboz mindkét ága cserélődik.** Az `<mc:AlternateContent>`
 *     `<mc:Choice>` és `<mc:Fallback>` ága UGYANAZT a szöveget tartalmazza
 *     kétszer. A Word csak az egyiket mutatja — a másikban bennfelejtett név
 *     kicsomagolással szabadon kiolvasható. Ezt nem külön kezeljük: a lapos
 *     szöveg mindkét ágat tartalmazza, így a keresés mindkettőt megtalálja,
 *     és mindkettőre külön szerkesztés születik.
 */

import type { Edit } from '../pdf/pageText.js';
import { type DocxPart, type DocxPartKind, assertDocx, isOoxmlPackage, listParts, mediaParts, unclassifiedParts, validateStructure } from './parts.js';
import {
  type RevisionReport,
  type Residue,
  type SanitizeOptions,
  type SanitizeReport,
  findResidue,
  findRevisions,
  resolveRevisionsInPackage,
  sanitizePackage,
} from './sanitize.js';
import {
  type CarrierProfile,
  type PartText,
  type TextFragment,
  WML_PROFILE,
  applyEditsToPart,
  buildPartText,
  mergeAdjacentRuns,
} from './text.js';
import { removeElements, stripAttributes } from './xml.js';
import { ZipArchive } from './zip.js';

export type { Edit };
export type { TextFragment, PartText };

export interface DocxPartAnalysis {
  name: string;
  kind: DocxPartKind;
  /** A rész lapos szövege — ezen fut a keresés. */
  text: string;
  /** Offszettérkép: melyik karaktertartomány melyik XML-elemben ül. */
  fragments: TextFragment[];
  /** Magyar megjegyzés, ha a rész külön figyelmet igényel. */
  note?: string;
}

export interface EmbeddedPackage {
  name: string;
  /** Igaz, ha OOXML csomag (kibontható); hamis, ha bináris OLE-tároló. */
  ooxml: boolean;
  byteLength: number;
}

export interface DocxAnalysis {
  parts: DocxPartAnalysis[];
  embeddedPackages: EmbeddedPackage[];
  /** Beágyazott képek: a rajtuk lévő nevet nem tudjuk lecserélni. */
  images: string[];
  /** Részek, amiket egyik szabály sem ismert fel. */
  unclassified: string[];
  revisions: RevisionReport;
  warnings: string[];
}

/**
 * A csomag beolvasása és laposítása.
 *
 * A visszaadott offszetek a NORMALIZÁLT XML-hez tartoznak (lásd
 * `normalisePartXml`). A `writeDocx` ugyanazt a normalizálást futtatja le
 * ugyanazon a bemeneten, ezért a két oldal offszetei mindig egyeznek.
 */
export async function analyzeDocx(bytes: Uint8Array): Promise<DocxAnalysis> {
  const zip = ZipArchive.open(bytes);
  assertDocx(zip);
  const prepared = preparePackage(zip);

  const parts: DocxPartAnalysis[] = [];
  for (const p of prepared.parts) {
    parts.push({
      name: p.part.name,
      kind: p.part.kind,
      text: p.text.text,
      fragments: p.text.fragments,
      ...(p.part.note === undefined ? {} : { note: p.part.note }),
    });
  }

  const embeddedPackages: EmbeddedPackage[] = [];
  for (const part of listParts(zip)) {
    if (part.kind !== 'embedding') continue;
    const raw = zip.read(part.name);
    embeddedPackages.push({
      name: part.name,
      ooxml: raw !== null && isOoxmlPackage(raw),
      byteLength: raw?.length ?? 0,
    });
  }

  const revisions = findRevisions(zip);
  const warnings = [...prepared.warnings];
  if (revisions.contentCount > 0) {
    warnings.push(
      `${revisions.contentCount} feloldatlan változáskövetés van a dokumentumban` +
        (revisions.authors.length > 0 ? ` (szerzők: ${revisions.authors.join(', ')})` : '') +
        '. Az exporthoz előbb el kell fogadni vagy el kell utasítani őket.',
    );
  }
  for (const e of embeddedPackages) {
    warnings.push(
      `Beágyazott objektum: ${e.name} (${e.byteLength} bájt, ${e.ooxml ? 'OOXML csomag' : 'bináris OLE'}). ` +
        'A tartalmát NEM néztük át; ha adatot tartalmaz, külön kell álnevesíteni.',
    );
  }
  // A beágyazott kép se nem szöveghordozó rész, se nem ismeretlen — a
  // figyelmeztetés nélkül a felhasználó EGYETLEN sort sem látna róla, pedig a
  // beszkennelt aláíráson ugyanúgy ott a név, csak képként. OCR-ünk nincs.
  const images = mediaParts(zip);
  if (images.length > 0) {
    warnings.push(
      `${images.length} beágyazott kép van a dokumentumban (${images.join(', ')}). ` +
        'A képre írt szöveget NEM olvassuk el (nincs OCR): ha aláírás, fejléces papír vagy ' +
        'képernyőkép van közöttük, a rajta lévő nevet saját szemmel kell ellenőrizni. ' +
        'A képek rejtett metaadatait (EXIF, IPTC, XMP) az export kitakarítja.',
    );
  }

  for (const name of unclassifiedParts(zip)) {
    warnings.push(`Ismeretlen rész: ${name}. Nem kerestünk benne nevet.`);
  }

  return { parts, embeddedPackages, images, unclassified: unclassifiedParts(zip), revisions, warnings };
}

/**
 * A változáskövetés feloldása, önálló lépésként.
 *
 * Azért külön hívás, és azért nem a `writeDocx` belsejében, mert a feloldás
 * MEGVÁLTOZTATJA a szöveget — és ezzel az összes offszetet. A helyes sorrend:
 * feloldás → `analyzeDocx` → keresés → `writeDocx`.
 */
export async function resolveRevisions(
  bytes: Uint8Array,
  mode: 'accept' | 'reject',
): Promise<Uint8Array> {
  const zip = ZipArchive.open(bytes);
  assertDocx(zip);
  resolveRevisionsInPackage(zip, mode);
  return zip.toBytes();
}

export interface WriteDocxOptions {
  /** Metaadat-takarítás beállításai; `false` esetén kimarad (nem ajánlott). */
  sanitize?: SanitizeOptions | false;
  /**
   * Karakterláncok, amiknek NEM szabad megmaradniuk a kimenetben. Az írás után
   * a nyers bájtokban keresünk rájuk, minden részben; ha bármelyik megvan,
   * hibát dobunk a mentés helyett.
   */
  forbidden?: string[];
  /**
   * Ha igaz, feloldatlan változáskövetéssel is exportálunk. Csak akkor add meg,
   * ha a hívó már MÁS módon gondoskodott a `<w:del>` tartalmáról.
   */
  allowUnresolvedRevisions?: boolean;
}

export interface DocxWriteResult {
  bytes: Uint8Array;
  /** Részenként hány szerkesztést sikerült visszaírni. */
  applied: Map<string, number>;
  sanitize: SanitizeReport | null;
  warnings: string[];
}

/**
 * A szerkesztések visszaírása és a kész .docx előállítása.
 *
 * A `edits` kulcsa a rész neve a csomagban (`word/document.xml`,
 * `word/header1.xml`, …), az értéke az `analyzeDocx` lapos szövegére vonatkozó
 * `{start, end, replacement}` lista.
 */
export async function writeDocx(
  bytes: Uint8Array,
  edits: Map<string, Edit[]>,
  opts: WriteDocxOptions = {},
): Promise<Uint8Array> {
  return (await writeDocxDetailed(bytes, edits, opts)).bytes;
}

/** Ugyanaz, mint a `writeDocx`, de jelentéssel együtt — a szereplaphoz. */
export async function writeDocxDetailed(
  bytes: Uint8Array,
  edits: Map<string, Edit[]>,
  opts: WriteDocxOptions = {},
): Promise<DocxWriteResult> {
  const zip = ZipArchive.open(bytes);
  assertDocx(zip);

  const revisions = findRevisions(zip);
  if (revisions.contentCount > 0 && opts.allowUnresolvedRevisions !== true) {
    throw new Error(
      `Az export leállt: ${revisions.contentCount} feloldatlan változáskövetés van a dokumentumban. ` +
        'A <w:del> blokkokban az EREDETI szöveg szó szerint benne marad, akkor is, ha a Wordben ' +
        'nem látszik. Előbb futtasd a resolveRevisions() hívást elfogadás vagy elutasítás módban.',
    );
  }

  const prepared = preparePackage(zip);
  const warnings = [...prepared.warnings];
  const applied = new Map<string, number>();

  const known = new Set(prepared.parts.map((p) => p.part.name));
  for (const name of edits.keys()) {
    if (!known.has(name)) warnings.push(`Ismeretlen részre érkezett szerkesztés: ${name}. Kimaradt.`);
  }

  // A tiltólistát a szerkesztésekből MAGUNK állítjuk elő, még mielőtt bármit
  // átírnánk — a hívó jóindulatától nem függhet, hogy fut-e az ellenőrző kör.
  const guard = buildResidueGuard(prepared, edits);

  for (const p of prepared.parts) {
    const list = edits.get(p.part.name);
    if (list === undefined || list.length === 0) continue;
    const result = applyEditsToPart(p.xml, p.text, list);
    warnings.push(...result.warnings.map((w) => `${p.part.name}: ${w}`));
    applied.set(p.part.name, result.applied);
    if (result.xml !== p.xml) zip.write(p.part.name, result.xml);
  }

  const sanitizeReport =
    opts.sanitize === false ? null : sanitizePackage(zip, opts.sanitize ?? {});
  if (sanitizeReport !== null) warnings.push(...sanitizeReport.warnings);

  const problems = validateStructure(zip);
  if (problems.length > 0) {
    throw new Error(
      `A kimenet szerkezeti ellenőrzése elbukott, ezért nem mentjük ki:\n  ${problems.join('\n  ')}`,
    );
  }

  const out = zip.toBytes();
  // Az ellenőrzés a KÉSZ fájlon fut, újra megnyitva — nem a memóriabeli
  // állapoton. Így nem a saját munkánkat igazoljuk vissza.
  const written = ZipArchive.open(out);

  if (opts.forbidden !== undefined && opts.forbidden.length > 0) {
    const residue = findResidue(written, opts.forbidden);
    if (residue.length > 0) {
      const details = residue
        .map((r) => `${r.part} (${r.encoding}, ${r.offset}. bájt): "${r.needle}"`)
        .join('\n  ');
      throw new Error(`Az eredeti adat megmaradt a kimenetben, ezért nem mentjük ki:\n  ${details}`);
    }
  }

  warnings.push(...checkResidueGuard(written, guard));

  return { bytes: out, applied, sanitize: sanitizeReport, warnings };
}

/**
 * Amit a kimenetben tiltunk, és amit még megtűrünk.
 *
 * A `needles` azok a felszíni alakok, amikhez TÉNYLEGESEN tartozik elfogadott
 * csere. Az `allowed` pedig részenként megmondja, hányszor maradhat bent
 * jogosan ugyanaz az alak: pontosan annyiszor, ahányszor a cserék után a
 * kinyert szövegben még ott áll.
 */
interface ResidueGuard {
  needles: string[];
  /** Rész → alak → hányszor tűrjük meg. */
  allowed: Map<string, Map<string, number>>;
}

/**
 * Rövid alakokat nem tiltunk bájtszinten.
 *
 * A vizsgálat a NYERS bájtokban keres, a képekben és a bináris részekben is.
 * Egy három betűs alak ("Kis") ott véletlenül is előfordul, és a hamis riasztás
 * megakadályozná a mentést — a rövid alakok tiltása ezért a hívó kifejezett
 * `forbidden` listájára tartozik, nem az automatikára.
 */
const MIN_RESIDUE_NEEDLE = 4;

/**
 * A tiltólista előállítása a szerkesztésekből.
 *
 * Miért innen, és nem a hívótól: a szerkesztés a bizonyíték arra, hogy az adott
 * alakhoz elfogadott csere tartozik. Így a vizsgálat akkor is fut, amikor az
 * átnézés még félkész — márpedig épp ilyenkor a legnagyobb a tét: a
 * szövegdoboz `mc:Fallback` ága, a beágyazott objektum és a régi bináris rész
 * UTF-16LE szövege csak itt bukik ki.
 */
function buildResidueGuard(prepared: PreparedPackage, edits: Map<string, Edit[]>): ResidueGuard {
  const needles = new Set<string>();
  for (const p of prepared.parts) {
    for (const e of edits.get(p.part.name) ?? []) {
      const surface = p.text.text.slice(e.start, e.end).trim();
      if (surface.length >= MIN_RESIDUE_NEEDLE) needles.add(surface);
    }
  }
  if (needles.size === 0) return { needles: [], allowed: new Map() };

  // A megtűrt darabszám a MEGJÓSOLT kimenetből jön: a lapos szövegre
  // ráolvassuk a cseréket, és megszámoljuk, mi marad. Ami ezen felül van a
  // kész fájlban, azt nem mi tettük oda, és nem is láttuk — az a szivárgás.
  //
  // Ez oldja fel azt a csapdát is, ami miatt a vizsgálat eddig ki volt
  // kapcsolva: a bennhagyott „Kovács Jánosné" tartalmazza a lecserélt „Kovács
  // János" alakot, de csak ANNYISZOR, ahányszor a jóslat is várja.
  const allowed = new Map<string, Map<string, number>>();
  for (const p of prepared.parts) {
    const expected = applyEditsToText(p.text.text, edits.get(p.part.name) ?? []);
    const counts = new Map<string, number>();
    for (const needle of needles) {
      const n = countOccurrences(expected, needle);
      if (n > 0) counts.set(needle, n);
    }
    if (counts.size > 0) allowed.set(p.part.name, counts);
  }

  return { needles: [...needles], allowed };
}

/** A megjósolt kimenet: a cserék ráolvasva a lapos szövegre. */
function applyEditsToText(text: string, edits: Edit[]): string {
  if (edits.length === 0) return text;
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) continue; // átfedést az applyEditsToPart úgyis hibának vesz
    out += text.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return out + text.slice(cursor);
}

/** Átfedés nélküli előfordulásszám — a bájtos kereséssel azonos szabály. */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    n++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * A kész fájl átvizsgálása a tiltólistával.
 *
 * A megtűrt darabszám feletti előfordulás megállítja a mentést. A megtűrt is
 * kap egy sort a jelentésbe: a félkész átnézésnél a felhasználónak látnia
 * kell, mi maradt még bent, akkor is, ha ezt ő maga hagyta így.
 */
function checkResidueGuard(written: ZipArchive, guard: ResidueGuard): string[] {
  if (guard.needles.length === 0) return [];

  const grouped = new Map<string, Residue[]>();
  for (const hit of findResidue(written, guard.needles)) {
    const key = `${hit.part}\u0000${hit.needle}`;
    const list = grouped.get(key);
    if (list === undefined) grouped.set(key, [hit]);
    else list.push(hit);
  }

  const leaks: string[] = [];
  const notes: string[] = [];
  for (const hits of grouped.values()) {
    const first = hits[0]!;
    const budget = guard.allowed.get(first.part)?.get(first.needle) ?? 0;
    if (hits.length <= budget) {
      notes.push(
        `A(z) "${first.needle}" alak ${hits.length} helyen bennmaradt a(z) ${first.part} részben: ` +
          'oda nem érkezett elfogadott csere. Amíg az átnézés nincs végig, ez így marad a fájlban.',
      );
      continue;
    }
    const where = hits
      .slice(0, 5)
      .map((h) => `${h.offset}. bájt (${h.encoding})`)
      .join(', ');
    leaks.push(
      `${first.part}: "${first.needle}" — ${hits.length} előfordulás, ` +
        `ebből ${hits.length - budget} olyan helyen, ahol a kinyert szövegben nincs: ${where}`,
    );
  }

  if (leaks.length > 0) {
    throw new Error(
      'Az elfogadott csere ellenére megmaradt az eredeti adat a kimenetben, ezért nem mentjük ki:\n  ' +
        `${leaks.join('\n  ')}\n` +
        'A vizsgálat a NYERS bájtokban keresett, minden részben — a szövegdoboz rejtett ága, a ' +
        'beágyazott objektum és a régi bináris rész UTF-16LE szövege is ide számít.',
    );
  }
  return notes;
}

interface PreparedPart {
  part: DocxPart;
  xml: string;
  text: PartText;
}

interface PreparedPackage {
  parts: PreparedPart[];
  warnings: string[];
}

/**
 * Normalizálás és laposítás minden szöveget hordozó részre.
 *
 * A normalizált XML VISSZAÍRÓDIK a csomagba, hogy az offszetek és a fájl
 * tartalma ne térhessen el egymástól. Ugyanez a függvény fut az elemzésnél és
 * az írásnál is — ez a garancia arra, hogy a hívó offszetei érvényesek.
 */
function preparePackage(zip: ZipArchive): PreparedPackage {
  const parts: PreparedPart[] = [];
  const warnings: string[] = [];

  for (const part of listParts(zip)) {
    if (!part.textBearing) continue;
    const original = zip.readText(part.name);
    if (original === null) continue;

    const normalised = normalisePartXml(original, part.profile);
    warnings.push(...normalised.warnings.map((w) => `${part.name}: ${w}`));
    if (normalised.xml !== original) zip.write(part.name, normalised.xml);

    parts.push({
      part,
      xml: normalised.xml,
      text: buildPartText(normalised.xml, part.profile),
    });
  }

  return { parts, warnings };
}

/**
 * Egy rész normalizálása a laposítás előtt.
 *
 * A sorrend nem cserélhető fel: a helyesírás-ellenőrző jelöléseit
 * (`<w:proofErr>`) előbb ki kell venni a futamok közül, különben elválasztónak
 * látszanak, és az összevonás nem történik meg ott, ahol a legtöbb szétvágott
 * név van.
 */
export function normalisePartXml(
  xml: string,
  prof: CarrierProfile,
): { xml: string; warnings: string[] } {
  if (prof !== WML_PROFILE) return { xml, warnings: [] };

  // A w:rsid* attribútumok a szerkesztési munkamenet ujjlenyomatai: nem
  // látszanak, de összekötnek két iratot. Itt esnek ki, nem a takarításnál,
  // mert az összevonás összehasonlítását is ezek rontanák el.
  let out = stripAttributes(xml, (attr) => attr.startsWith('w:rsid'));
  out = removeElements(out, new Set(['w:proofErr']));
  const merged = mergeAdjacentRuns(out, prof);
  return { xml: merged.xml, warnings: merged.warnings };
}
