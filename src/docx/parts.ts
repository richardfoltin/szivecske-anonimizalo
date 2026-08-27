/**
 * A .docx részeinek számbavétele.
 *
 * A kozmetikai kitakarás hibaosztálya itt kezdődik: aki csak a
 * `word/document.xml`-t nézi meg, az a nevek felét a fájlban hagyja. Az élőfej,
 * a lábjegyzet, a szövegdoboz, a megjegyzés, a diagram gyorsítótárazott
 * adatsora, a kapcsolatlistában álló `mailto:` cím és a dokumentum-
 * tulajdonságok mind ugyanúgy azonosítanak — csak nem látszanak.
 *
 * Ez a modul ezért NEM válogat: felsorol minden részt, mindegyikhez megmondja,
 * mi hordozza benne a szöveget, és amit nem ismer fel, azt kimondottan
 * jelenti. A csendes kihagyás itt biztonsági hiba.
 */

import {
  type CarrierProfile,
  CHART_PROFILE,
  CUSTOM_XML_PROFILE,
  DIAGRAM_PROFILE,
  EMPTY_PROFILE,
  PEOPLE_PROFILE,
  PROPS_PROFILE,
  RELS_PROFILE,
  WML_PROFILE,
} from './text.js';
import { attributesOf, checkWellFormed, scanXml } from './xml.js';
import type { ZipArchive } from './zip.js';

export type DocxPartKind =
  | 'contentTypes'
  | 'rels'
  | 'document'
  | 'header'
  | 'footer'
  | 'footnotes'
  | 'endnotes'
  | 'comments'
  | 'commentsMeta'
  | 'people'
  | 'glossary'
  | 'chart'
  | 'diagram'
  | 'embedding'
  | 'customXml'
  | 'coreProps'
  | 'appProps'
  | 'customProps'
  | 'thumbnail'
  | 'settings'
  | 'styles'
  | 'numbering'
  | 'media'
  | 'other';

export interface DocxPart {
  name: string;
  kind: DocxPartKind;
  /** Hordozhat-e látható szöveget vagy személyes adatot. */
  textBearing: boolean;
  profile: CarrierProfile;
  /** Magyar magyarázat, ha a rész külön figyelmet igényel. */
  note?: string;
}

interface Rule {
  test: RegExp;
  kind: DocxPartKind;
  profile: CarrierProfile;
  note?: string;
}

/**
 * A besorolás sorrendje számít: az első illeszkedő szabály nyer. A szótári
 * (`word/glossary/…`) másolatok ugyanolyan WML-részek, mint a törzsbeliek —
 * az AutoSzöveg-bejegyzésekbe simán belekerül az ügyfél neve.
 */
const RULES: Rule[] = [
  { test: /^\[Content_Types\]\.xml$/i, kind: 'contentTypes', profile: EMPTY_PROFILE },
  { test: /(^|\/)_rels\/[^/]*\.rels$/i, kind: 'rels', profile: RELS_PROFILE },

  { test: /^word\/glossary\/document\.xml$/i, kind: 'glossary', profile: WML_PROFILE },
  { test: /^word\/document\d*\.xml$/i, kind: 'document', profile: WML_PROFILE },
  { test: /^word\/(glossary\/)?header\d*\.xml$/i, kind: 'header', profile: WML_PROFILE },
  { test: /^word\/(glossary\/)?footer\d*\.xml$/i, kind: 'footer', profile: WML_PROFILE },
  { test: /^word\/(glossary\/)?footnotes\.xml$/i, kind: 'footnotes', profile: WML_PROFILE },
  { test: /^word\/(glossary\/)?endnotes\.xml$/i, kind: 'endnotes', profile: WML_PROFILE },
  { test: /^word\/(glossary\/)?comments\.xml$/i, kind: 'comments', profile: WML_PROFILE },
  {
    test: /^word\/(glossary\/)?commentsExtended\.xml$/i,
    kind: 'commentsMeta',
    profile: WML_PROFILE,
  },
  {
    test: /^word\/(glossary\/)?comments(Ids|Extensible)\.xml$/i,
    kind: 'commentsMeta',
    profile: EMPTY_PROFILE,
  },
  { test: /^word\/(glossary\/)?people\.xml$/i, kind: 'people', profile: PEOPLE_PROFILE },
  { test: /^word\/(glossary\/)?settings\.xml$/i, kind: 'settings', profile: EMPTY_PROFILE },
  {
    test: /^word\/(glossary\/)?styles(WithEffects)?\.xml$/i,
    kind: 'styles',
    profile: EMPTY_PROFILE,
    note: 'A stílusnevek szövegét nem cseréljük; egyedi stílusnév tartalmazhat nevet.',
  },
  {
    test: /^word\/(glossary\/)?numbering\.xml$/i,
    kind: 'numbering',
    profile: EMPTY_PROFILE,
    note: 'A listaszint szövegmintáit (w:lvlText) nem cseréljük.',
  },

  { test: /^word\/charts\/(chart|chartEx)\d*\.xml$/i, kind: 'chart', profile: CHART_PROFILE },
  { test: /^word\/charts\//i, kind: 'chart', profile: EMPTY_PROFILE },
  { test: /^word\/diagrams\/(data|drawing)\d*\.xml$/i, kind: 'diagram', profile: DIAGRAM_PROFILE },
  { test: /^word\/diagrams\//i, kind: 'diagram', profile: EMPTY_PROFILE },
  {
    test: /^word\/embeddings\//i,
    kind: 'embedding',
    profile: EMPTY_PROFILE,
    note: 'Beágyazott OPC-csomag vagy OLE-objektum: önálló fájl a fájlban.',
  },
  { test: /^customXml\//i, kind: 'customXml', profile: CUSTOM_XML_PROFILE },

  { test: /^docProps\/core\.xml$/i, kind: 'coreProps', profile: PROPS_PROFILE },
  { test: /^docProps\/app\.xml$/i, kind: 'appProps', profile: PROPS_PROFILE },
  { test: /^docProps\/custom\.xml$/i, kind: 'customProps', profile: PROPS_PROFILE },
  {
    test: /^docProps\/thumbnail\./i,
    kind: 'thumbnail',
    profile: EMPTY_PROFILE,
    note: 'Az első oldal előnézeti képe — a neveket KÉPKÉNT tartalmazza, ezért töröljük.',
  },
  {
    test: /^word\/media\//i,
    kind: 'media',
    profile: EMPTY_PROFILE,
    note:
      'Beágyazott kép. A beszkennelt aláírás, a lefényképezett tanúsítvány és a képernyőkép ' +
      'KÉPKÉNT hordozza a nevet — OCR nincs, ezért ezt nem látjuk és nem is cseréljük. ' +
      'A kép metaadatait (EXIF, IPTC, XMP, PNG-szövegdarabok) az export kitakarítja.',
  },
];

export function classifyPart(name: string): DocxPart {
  for (const rule of RULES) {
    if (rule.test.test(name)) {
      return {
        name,
        kind: rule.kind,
        textBearing: rule.profile !== EMPTY_PROFILE,
        profile: rule.profile,
        ...(rule.note === undefined ? {} : { note: rule.note }),
      };
    }
  }
  return { name, kind: 'other', textBearing: false, profile: EMPTY_PROFILE };
}

/** A csomag minden része, besorolva. */
export function listParts(zip: ZipArchive): DocxPart[] {
  return zip.names().map(classifyPart);
}

/** Csak azok a részek, amelyekben szöveget keresünk és cserélünk. */
export function textParts(zip: ZipArchive): DocxPart[] {
  return listParts(zip).filter((p) => p.textBearing);
}

/**
 * Beágyazott csomagok: `word/embeddings/*.docx`, `.xlsx`, `.bin` (OLE).
 *
 * Ezek ÖNÁLLÓ fájlok a fájlban, saját belső szerkezettel — egy beágyazott
 * Excel-tábla ugyanúgy tartalmazhatja a felek nevét, mint a törzsszöveg.
 * Az OOXML alapú beágyazásokat rekurzívan is fel tudjuk dolgozni
 * (`openEmbeddedPackage`), a bináris OLE-t nem: azt jelentjük, és az export
 * előtt döntést kérünk.
 */
export function embeddedPackages(zip: ZipArchive): string[] {
  return zip.names().filter((n) => /^word\/embeddings\//i.test(n));
}

/**
 * Beágyazott OOXML-csomag megnyitása, ha az.
 *
 * A ZIP helyi fejlécének aláírásából derül ki. Az OLE-tárolóban (`.bin`) ülő
 * csomagot nem bontjuk ki: ott a ZIP nem a fájl elején kezdődik, és a
 * találgatás sérült beágyazást adna.
 */
export function isOoxmlPackage(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Beágyazott képek.
 *
 * Külön lekérdezés, mert a `media` besorolás se nem szöveghordozó, se nem
 * ismeretlen rész: e nélkül a felhasználó EGYETLEN sort sem látna róluk, pedig
 * a képre írt nevet mi nem tudjuk lecserélni. Erről szólni kell.
 */
export function mediaParts(zip: ZipArchive): string[] {
  return listParts(zip)
    .filter((p) => p.kind === 'media')
    .map((p) => p.name);
}

/** Amit egyik szabály sem ismert fel — a jelentésben külön soron. */
export function unclassifiedParts(zip: ZipArchive): string[] {
  return listParts(zip)
    .filter((p) => p.kind === 'other')
    .map((p) => p.name);
}

/** Alapvető ellenőrzés: egyáltalán .docx-e, amit kaptunk. */
export function assertDocx(zip: ZipArchive): void {
  if (!zip.has('[Content_Types].xml')) {
    throw new Error('Hiányzik a [Content_Types].xml — ez nem OOXML csomag.');
  }
  if (!zip.has('word/document.xml')) {
    throw new Error(
      'Hiányzik a word/document.xml. Ha .doc (régi Word) vagy .odt fájlról van szó, előbb mentsd el .docx formátumban.',
    );
  }
}

/**
 * Szerkezeti ellenőrzés a KIMENETEN.
 *
 * Nem sémavalidálás — azt a Word végzi el. Ez azt a négy hibát fogja meg,
 * amit mi tudunk okozni, és amitől a Word „javítható hibát" jelent:
 * elrontott XML, hiányzó tartalomtípus, sehová sem mutató kapcsolat, és
 * olyan `[Content_Types]` bejegyzés, aminek nincs mögötte rész.
 */
export function validateStructure(zip: ZipArchive): string[] {
  const problems: string[] = [];
  const names = new Set(zip.names());

  const contentTypes = zip.readText('[Content_Types].xml');
  if (contentTypes === null) {
    problems.push('Hiányzik a [Content_Types].xml.');
    return problems;
  }

  const defaults = new Set<string>();
  const overrides = new Set<string>();
  scanXml(contentTypes, (node) => {
    if (node.kind !== 'open' && node.kind !== 'self') return;
    const attrs = attributesOf(contentTypes, node);
    if (node.name === 'Default') {
      const ext = attrs.find((a) => a.name === 'Extension')?.value;
      if (ext !== undefined) defaults.add(ext.toLowerCase());
    } else if (node.name === 'Override') {
      const part = attrs.find((a) => a.name === 'PartName')?.value;
      if (part !== undefined) overrides.add(part.replace(/^\//, ''));
    }
  });

  for (const part of overrides) {
    if (!names.has(part)) problems.push(`A [Content_Types].xml olyan részre hivatkozik, ami nincs a csomagban: ${part}`);
  }

  for (const name of names) {
    if (name === '[Content_Types].xml' || name.endsWith('/')) continue;
    if (overrides.has(name)) continue;
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    if (!defaults.has(ext)) problems.push(`Nincs tartalomtípus a(z) ${name} részhez.`);
  }

  for (const name of names) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const xml = zip.readText(name);
    if (xml === null) continue;
    for (const p of checkWellFormed(xml)) problems.push(`${name}: ${p}`);
    if (!name.endsWith('.rels')) continue;
    for (const target of internalTargets(xml)) {
      const resolved = resolveTarget(name, target);
      if (!names.has(resolved)) {
        problems.push(`A(z) ${name} olyan részre hivatkozik, ami nincs a csomagban: ${resolved}`);
      }
    }
  }

  return problems;
}

/** A kapcsolatlista csomagon BELÜLI céljai (a külső URL-eket kihagyva). */
function internalTargets(relsXml: string): string[] {
  const out: string[] = [];
  scanXml(relsXml, (node) => {
    if (node.name !== 'Relationship' || (node.kind !== 'open' && node.kind !== 'self')) return;
    const attrs = attributesOf(relsXml, node);
    if (attrs.find((a) => a.name === 'TargetMode')?.value === 'External') return;
    const target = attrs.find((a) => a.name === 'Target')?.value;
    if (target !== undefined && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) out.push(target);
  });
  return out;
}

/** Kapcsolat céljának feloldása a .rels fájl helyéhez képest. */
export function resolveTarget(relsPartName: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const base = relsPartName.replace(/_rels\/[^/]*$/, '');
  const segments = `${base}${target}`.split('/');
  const out: string[] = [];
  for (const s of segments) {
    if (s === '.' || s === '') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}
