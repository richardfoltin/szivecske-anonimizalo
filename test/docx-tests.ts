/**
 * DOCX be- és kimenet mérése — a minta a programból készül, nem Wordből.
 *
 *   npm run test:docx
 *
 * Miért gyártott minta: a mérésnek attól van értéke, hogy PONTOSAN tudjuk,
 * hova rejtettük el a nevet. Egy Wordből kimentett fájlnál csak reménykednénk,
 * hogy benne van a szövegdoboz mindkét ága és a változáskövetés is.
 *
 * A minta ezért szándékosan minden ismert rejtekhelyet tartalmaz:
 *  1. három `<w:r>` futamra vágott név a törzsben,
 *  2. név az élőfejben,
 *  3. név a lábjegyzetben,
 *  4. név a szövegdobozban, `<mc:Choice>` ÉS `<mc:Fallback>` ágon egyaránt,
 *  5. név mezőkódban (`<w:instrText>`: HYPERLINK és MERGEFIELD),
 *  6. név a `docProps/core.xml` metaadatban,
 *  7. név `<w:del>` változáskövetéses törlésben,
 *  8. név ATTRIBÚTUMBAN: könyvjelzőnév, hivatkozásbuborék, egyszerű mezőkód,
 *     táblázatcím és -leírás, VML alternatív szöveg és cím, rajzelem neve,
 *  9. név a beágyazott képek EXIF/IPTC/XMP és PNG-szövegdarabjaiban,
 * 10. név egy rejtett bináris részben, UTF-16LE kódolással (külön mintában).
 *
 * A záró ellenőrzés NEM a kinyert szövegben keres, hanem minden rész NYERS
 * bájtjaiban — ahogy egy kicsomagoló is tenné.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SeedMatcher } from '../src/hu/matcher.js';
import type { SeedEntity, SeedPerson } from '../src/hu/names.js';
import type { Edit } from '../src/pdf/pageText.js';
import {
  type ReplacementContext,
  type Theme,
  assignPseudonyms,
  buildContext,
  renderReplacement,
} from '../src/pseudonym.js';
import {
  type DocxAnalysis,
  analyzeDocx,
  normalisePartXml,
  resolveRevisions,
  writeDocxDetailed,
} from '../src/docx/anonymize.js';
import { stripImageMetadata } from '../src/docx/media.js';
import { classifyPart, mediaParts, validateStructure } from '../src/docx/parts.js';
import { findResidue } from '../src/docx/sanitize.js';
import { buildPartText, mergeAdjacentRuns, WML_PROFILE } from '../src/docx/text.js';
import { ZipArchive } from '../src/docx/zip.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const KOVACS: SeedPerson = {
  kind: 'person',
  id: 'p1',
  surname: 'Kovács',
  given: 'János',
  gender: 'M',
  role: 'felperes',
};

/**
 * Amiknek NEM szabad megmaradniuk a kimenetben, semmilyen részben.
 *
 * A "kovacsj" a szerző Windows-felhasználóneve a csatolt sablon útvonalából —
 * a Wordben soha nem látszik, kicsomagolva egy sorban ott van.
 */
const FORBIDDEN = ['Kovács', 'KOVÁCS', 'kovacs', 'János', 'JÁNOS', 'kovacsj'];

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) return;
  failures++;
  console.log(`  BUKTA  ${name}${detail ? `\n         ${detail}` : ''}`);
}

/** Szerepel-e a bájtsor a részben — a kicsomagoló szemszöge. */
function hasBytes(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    n++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

// ---------------------------------------------------------------------------
// A minta legyártása
// ---------------------------------------------------------------------------

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Álbináris rész: a bájtazonos átmásolást méri, és azt, hogy nem dekódoljuk. */
function fakeImage(): Uint8Array {
  const out = new Uint8Array(512);
  for (let i = 0; i < out.length; i++) out[i] = (i * 37 + 11) % 256;
  out.set([0x89, 0x50, 0x4e, 0x47], 0);
  return out;
}

/** UTF-8 bájtok — az ékezetes betű így két bájt, ahogy a valódi fájlokban is. */
function utf8(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG szöveges darabokkal.
 *
 * A CRC helyén szándékosan nulla áll: a takarítás EGÉSZ darabokat vág ki, a
 * megmaradó darabok ellenőrzőösszege pedig csak önmagukra vonatkozik — így
 * nincs mit újraszámolni, és a mérésnek sem kell valódi képet gyártania.
 * A `zTXt` tartalma itt tömörítetlen, hogy a bájtszintű keresés lássa a nevet:
 * a mérés tárgya a darab eltávolítása, nem a zlib.
 */
function pngWithText(): Uint8Array {
  const out: number[] = [...PNG_SIGNATURE];
  const chunk = (type: string, data: number[]): void => {
    const n = data.length;
    out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    out.push(...utf8(type), ...data, 0, 0, 0, 0);
  };
  chunk('IHDR', [0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
  chunk('tEXt', [...utf8('Author'), 0, ...utf8('Kovács János')]);
  chunk('zTXt', [...utf8('Comment'), 0, 0, ...utf8('Kovács János irodája')]);
  chunk('iTXt', [...utf8('XML:com.adobe.xmp'), 0, 0, 0, 0, 0, ...utf8('Kovács János')]);
  chunk('IDAT', [0x78, 0x9c, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
  chunk('IEND', []);
  return new Uint8Array(out);
}

/** A PNG-ből az a rész, aminek bájtra változatlanul át kell mennie. */
const PNG_IDAT_MARKER = [0x78, 0x9c, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06];

/**
 * JPEG EXIF, XMP és IPTC szegmenssel.
 *
 * A képadat helyén tetszőleges bájtok állnak: a mérés tárgya az, hogy a vágás
 * pontosan a metaadatot viszi el, a JFIF fejlécet és a képadatot pedig békén
 * hagyja.
 */
function jpegWithMetadata(): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  const segment = (marker: number, payload: number[]): void => {
    const n = payload.length + 2;
    out.push(0xff, marker, (n >> 8) & 0xff, n & 0xff, ...payload);
  };
  segment(0xe0, [...utf8('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  segment(0xe1, [...utf8('Exif'), 0, 0, ...utf8('Artist: Kovács János; GPS: 47.49,19.04')]);
  segment(0xe1, [...utf8('http://ns.adobe.com/xap/1.0/'), 0, ...utf8('<xmp>Kovács János</xmp>')]);
  segment(0xed, [...utf8('Photoshop 3.0'), 0, ...utf8('8BIM by-line Kovács János')]);
  segment(0xdb, [0x00, ...new Array<number>(64).fill(0x10)]);
  // SOS: innentől entrópiakódolt képadat, itt már nem elemzünk tovább.
  out.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  out.push(0xde, 0xad, 0xbe, 0xef, 0xff, 0xd9);
  return new Uint8Array(out);
}

/** A JPEG-ből az a rész, aminek bájtra változatlanul át kell mennie. */
const JPEG_SCAN_MARKER = [0xde, 0xad, 0xbe, 0xef, 0xff, 0xd9];

function contentTypes(withBin: boolean): string {
  return `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
<Default Extension="xml" ContentType="application/xml"/>\
<Default Extension="png" ContentType="image/png"/>\
<Default Extension="jpg" ContentType="image/jpeg"/>\
${withBin ? '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' : ''}\
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>\
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>\
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>\
<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>\
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>\
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\
<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>\
</Types>`;
}

function packageRels(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>\
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\
<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>\
<Relationship Id="rId4" Type="${REL}/custom-properties" Target="docProps/custom.xml"/>\
</Relationships>`;
}

function documentRels(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="${REL}/header" Target="header1.xml"/>\
<Relationship Id="rId2" Type="${REL}/footnotes" Target="footnotes.xml"/>\
<Relationship Id="rId3" Type="${REL}/comments" Target="comments.xml"/>\
<Relationship Id="rId4" Type="${REL}/settings" Target="settings.xml"/>\
<Relationship Id="rId5" Type="${REL}/people" Target="people.xml"/>\
<Relationship Id="rId6" Type="${REL}/hyperlink" Target="mailto:kovacs.janos@pelda.hu" TargetMode="External"/>\
<Relationship Id="rId7" Type="${REL}/image" Target="media/image1.png"/>\
</Relationships>`;
}

/** A csatolt sablon útvonala: a szerző gépének felhasználóneve is benne van. */
function settingsRels(): string {
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="${REL}/attachedTemplate" Target="file:///C:/Users/kovacsj/AppData/Roaming/Microsoft/Templates/Iroda.dotx" TargetMode="External"/>\
</Relationships>`;
}

function documentXml(): string {
  const attrs = [
    `xmlns:w="${NS_W}"`,
    `xmlns:r="${NS_R}"`,
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"',
    'xmlns:v="urn:schemas-microsoft-com:vml"',
    'xmlns:o="urn:schemas-microsoft-com:office:office"',
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
    'mc:Ignorable="w14"',
  ].join(' ');

  // 1. A név három futamra vágva, közte helyesírás-ellenőrző jelöléssel — pont
  //    úgy, ahogy a Word szokta. Az RSID-k szándékosan mind különböznek.
  const splitName = `<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3">\
<w:r w:rsidR="00A1B2C3"><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Felperes: </w:t></w:r>\
<w:proofErr w:type="spellStart"/>\
<w:r w:rsidR="00B2C3D4"><w:rPr><w:b/></w:rPr><w:t>Kov</w:t></w:r>\
<w:r w:rsidR="00C3D4E5"><w:rPr><w:b/></w:rPr><w:t>ács Já</w:t></w:r>\
<w:r w:rsidR="00D4E5F6"><w:rPr><w:b/></w:rPr><w:t>nos</w:t></w:r>\
<w:proofErr w:type="spellEnd"/>\
<w:r><w:t xml:space="preserve"> keresetet nyújtott be a bíróságon.</w:t></w:r>\
</w:p>`;

  // 5. Mezőkódok: a megjelenített szöveg és a kód is hordozza a nevet.
  const fields = `<w:p>\
<w:r><w:fldChar w:fldCharType="begin"/></w:r>\
<w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:kovacs.janos@pelda.hu" </w:instrText></w:r>\
<w:r><w:fldChar w:fldCharType="separate"/></w:r>\
<w:r><w:rPr><w:color w:val="0000FF"/></w:rPr><w:t>Kovács János e-mail címe</w:t></w:r>\
<w:r><w:fldChar w:fldCharType="end"/></w:r>\
</w:p>\
<w:p>\
<w:r><w:fldChar w:fldCharType="begin"/></w:r>\
<w:r><w:instrText xml:space="preserve"> MERGEFIELD  Kovács_János  \\* MERGEFORMAT </w:instrText></w:r>\
<w:r><w:fldChar w:fldCharType="end"/></w:r>\
</w:p>`;

  // 4. Szövegdoboz: a Choice és a Fallback UGYANAZT a szöveget tartalmazza.
  //    A Word csak az egyiket mutatja; a másikban felejtett név kicsomagolva
  //    teljes egészében kiolvasható.
  const boxText = `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Kovács János s.k.</w:t></w:r></w:p>`;
  const textBox = `<w:p><w:r>\
<mc:AlternateContent>\
<mc:Choice Requires="wps">\
<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">\
<wp:extent cx="2540000" cy="635000"/>\
<wp:docPr id="1" name="Kovács János aláírásmezője" descr="Kovács János aláírása"/>\
<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">\
<wps:wsp><wps:txbx><w:txbxContent>${boxText}</w:txbxContent></wps:txbx></wps:wsp>\
</a:graphicData></a:graphic>\
</wp:inline></w:drawing>\
</mc:Choice>\
<mc:Fallback>\
<w:pict><v:shape id="_x0000_s1026" type="#_x0000_t202" style="width:200pt;height:50pt" \
alt="Kovács János aláírása" o:title="Kovács János">\
<v:textbox><w:txbxContent>${boxText}</w:txbxContent></v:textbox>\
</v:shape></w:pict>\
</mc:Fallback>\
</mc:AlternateContent>\
</w:r></w:p>`;

  // 7. Változáskövetés: a <w:del> tartalma szó szerint a fájlban van.
  const tracked = `<w:p>\
<w:r><w:t xml:space="preserve">A szerződés </w:t></w:r>\
<w:del w:id="11" w:author="Kovács János" w:date="2024-03-01T10:00:00Z">\
<w:r><w:delText xml:space="preserve">Kovács János korábbi nyilatkozata szerint </w:delText></w:r>\
</w:del>\
<w:ins w:id="12" w:author="Kovács János" w:date="2024-03-01T10:05:00Z">\
<w:r><w:t xml:space="preserve">a becsatolt okiratok szerint </w:t></w:r>\
</w:ins>\
<w:r><w:t>érvényes.</w:t></w:r>\
</w:p>`;

  const comments = `<w:p>\
<w:commentRangeStart w:id="1"/>\
<w:r><w:t>A tanú vallomása ellentmondásos.</w:t></w:r>\
<w:commentRangeEnd w:id="1"/>\
<w:r><w:commentReference w:id="1"/></w:r>\
</w:p>`;

  // A táblázat kisegítő címe és leírása: a Word csak a tulajdonságablakban
  // mutatja meg, a fájlban sima attribútum.
  const table = `<w:tbl>\
<w:tblPr><w:tblW w:w="0" w:type="auto"/>\
<w:tblCaption w:val="Kovács János vagyonmérlege"/>\
<w:tblDescription w:val="A felperes, Kovács János tételei"/>\
</w:tblPr>\
<w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>\
<w:tr w:rsidTr="00A1B2C3">\
<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Fél neve</w:t></w:r></w:p></w:tc>\
<w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Kovács János</w:t></w:r></w:p></w:tc>\
</w:tr></w:tbl>`;

  // 8. Attribútumban ülő nevek. A Wordben egyikük sem látszik: a könyvjelző
  //    nevét a program a kijelölt szövegből gyártja, a buborékszöveget csak
  //    rámutatáskor mutatja, az egyszerű mező kódja pedig attribútum.
  const hiddenAttrs = `<w:p>\
<w:bookmarkStart w:id="2" w:name="Kovács_János_nyilatkozata"/>\
<w:hyperlink w:anchor="Kovács_János_nyilatkozata" w:tooltip="Ugrás Kovács János nyilatkozatához">\
<w:r><w:rPr><w:rStyle w:val="Hiperhivatkozs"/></w:rPr><w:t>a nyilatkozat</w:t></w:r>\
</w:hyperlink>\
<w:bookmarkEnd w:id="2"/>\
<w:fldSimple w:instr=" MERGEFIELD  Kovács_János_lakcím  \\* MERGEFORMAT ">\
<w:r><w:t>a lakcím helye</w:t></w:r>\
</w:fldSimple>\
</w:p>`;

  // A Word a `_GoBack` könyvjelzőt oda teszi, ahol utoljára szerkesztettek —
  //  akár SZÓ KÖZEPÉRE. Ha az attribútum a lapos szövegbe a helyén kerülne be,
  //  itt kettévágná a nevet, és a keresés soha nem találná meg.
  const bookmarkInsideName = `<w:p>\
<w:r><w:t xml:space="preserve">Alperes: </w:t></w:r>\
<w:r><w:t>Kov</w:t></w:r>\
<w:bookmarkStart w:id="3" w:name="_GoBack"/><w:bookmarkEnd w:id="3"/>\
<w:r><w:t>ács János lakcíme ismert.</w:t></w:r>\
</w:p>`;

  const footnoteRef = `<w:p><w:r><w:t xml:space="preserve">Lásd a lábjegyzetet.</w:t></w:r>\
<w:r><w:rPr><w:rStyle w:val="Lbjegyzethivatkozs"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>`;

  const sect = `<w:sectPr w:rsidR="00A1B2C3">\
<w:headerReference w:type="default" r:id="rId1"/>\
<w:pgSz w:w="11906" w:h="16838"/>\
<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>\
</w:sectPr>`;

  return `${XML_HEAD}<w:document ${attrs}><w:body>${splitName}${fields}${textBox}${tracked}${comments}${table}\
${hiddenAttrs}${bookmarkInsideName}${footnoteRef}${sect}</w:body></w:document>`;
}

function headerXml(): string {
  return `${XML_HEAD}<w:hdr xmlns:w="${NS_W}"><w:p w:rsidR="00A1B2C3">\
<w:r><w:t>Kovács János ügyvédi iroda</w:t></w:r></w:p></w:hdr>`;
}

function footnotesXml(): string {
  return `${XML_HEAD}<w:footnotes xmlns:w="${NS_W}">\
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>\
<w:footnote w:id="1"><w:p>\
<w:r><w:rPr><w:rStyle w:val="Lbjegyzethivatkozs"/></w:rPr><w:footnoteRef/></w:r>\
<w:r><w:t xml:space="preserve"> Kovács János 2024. évi nyilatkozata alapján.</w:t></w:r>\
</w:p></w:footnote></w:footnotes>`;
}

function commentsXml(): string {
  return `${XML_HEAD}<w:comments xmlns:w="${NS_W}">\
<w:comment w:id="1" w:author="Kovács János" w:initials="KJ" w:date="2024-03-01T10:00:00Z">\
<w:p><w:r><w:t>Kovács János szerint ez pontatlan.</w:t></w:r></w:p></w:comment></w:comments>`;
}

function peopleXml(): string {
  return `${XML_HEAD}<w15:people xmlns:w="${NS_W}" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">\
<w15:person w15:author="Kovács János">\
<w15:presenceInfo w15:providerId="AD" w15:userId="kovacs.janos@pelda.hu"/>\
</w15:person></w15:people>`;
}

function settingsXml(): string {
  return `${XML_HEAD}<w:settings xmlns:w="${NS_W}" xmlns:r="${NS_R}">\
<w:proofState w:spelling="clean" w:grammar="clean"/>\
<w:attachedTemplate r:id="rId1"/>\
<w:trackChanges/>\
<w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/><w:rsid w:val="00B2C3D4"/>\
<w:rsid w:val="00C3D4E5"/><w:rsid w:val="00D4E5F6"/></w:rsids>\
</w:settings>`;
}

function coreXml(): string {
  return `${XML_HEAD}<cp:coreProperties \
xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" \
xmlns:dc="http://purl.org/dc/elements/1.1/" \
xmlns:dcterms="http://purl.org/dc/terms/" \
xmlns:dcmitype="http://purl.org/dc/dcmitype/" \
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\
<dc:title>Keresetlevél — Kovács János</dc:title>\
<dc:subject>peres irat</dc:subject>\
<dc:creator>Kovács János</dc:creator>\
<cp:keywords>Kovács, kereset</cp:keywords>\
<dc:description>Kovács János ügye</dc:description>\
<cp:lastModifiedBy>Kovács János</cp:lastModifiedBy>\
<cp:revision>7</cp:revision>\
<dcterms:created xsi:type="dcterms:W3CDTF">2024-03-01T10:00:00Z</dcterms:created>\
<dcterms:modified xsi:type="dcterms:W3CDTF">2024-03-02T11:00:00Z</dcterms:modified>\
</cp:coreProperties>`;
}

function appXml(): string {
  return `${XML_HEAD}<Properties \
xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" \
xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\
<Template>KovacsIroda.dotx</Template>\
<TotalTime>412</TotalTime>\
<Application>Microsoft Office Word</Application>\
<Company>Kovács és Társa Ügyvédi Iroda</Company>\
<Manager>Kovács János</Manager>\
<HeadingPairs><vt:vector size="2" baseType="variant">\
<vt:variant><vt:lpstr>Cím</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant>\
</vt:vector></HeadingPairs>\
<TitlesOfParts><vt:vector size="1" baseType="lpstr">\
<vt:lpstr>Keresetlevél — Kovács János</vt:lpstr></vt:vector></TitlesOfParts>\
<AppVersion>16.0000</AppVersion>\
</Properties>`;
}

function customXml(): string {
  return `${XML_HEAD}<Properties \
xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" \
xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">\
<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Ügyfél">\
<vt:lpwstr>Kovács János</vt:lpwstr></property></Properties>`;
}

interface FixtureOptions {
  /**
   * Rejtett bináris rész UTF-16LE szöveggel — ez a beágyazott OLE-objektum
   * mása. A saját szövegkinyerőnk NEM látja; csak a bájtszintű vizsgálat.
   */
  hiddenOle?: boolean;
}

function buildFixture(opts: FixtureOptions = {}): Uint8Array {
  const zip = ZipArchive.create();
  // A [Content_Types].xml elöl: a Word ezt keresi először.
  zip.write('[Content_Types].xml', contentTypes(opts.hiddenOle === true));
  zip.write('_rels/.rels', packageRels());
  zip.write('word/document.xml', documentXml());
  zip.write('word/_rels/document.xml.rels', documentRels());
  zip.write('word/_rels/settings.xml.rels', settingsRels());
  zip.write('word/header1.xml', headerXml());
  zip.write('word/footnotes.xml', footnotesXml());
  zip.write('word/comments.xml', commentsXml());
  zip.write('word/people.xml', peopleXml());
  zip.write('word/settings.xml', settingsXml());
  zip.write('word/media/image1.png', fakeImage());
  zip.write('word/media/image2.png', pngWithText());
  zip.write('word/media/image3.jpg', jpegWithMetadata());
  zip.write('docProps/core.xml', coreXml());
  zip.write('docProps/app.xml', appXml());
  zip.write('docProps/custom.xml', customXml());
  if (opts.hiddenOle === true) zip.write('word/embeddings/oleObject1.bin', utf16leBytes('Kovács János titkos melléklete'));
  return zip.toBytes();
}

/** A régi bináris részek (OLE) így tárolják a szöveget: két bájt karakterenként. */
function utf16leBytes(s: string): Uint8Array {
  const out = new Uint8Array(8 + s.length * 2);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0); // OLE-tároló aláírása
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[8 + i * 2] = c & 0xff;
    out[8 + i * 2 + 1] = c >> 8;
  }
  return out;
}

// ---------------------------------------------------------------------------
// A csere előállítása a valódi motorral
// ---------------------------------------------------------------------------

function buildEdits(
  analysis: DocxAnalysis,
  matcher: SeedMatcher,
  entities: Map<string, SeedEntity>,
  ctx: ReplacementContext,
): { edits: Map<string, Edit[]>; matched: number; skipped: number } {
  const edits = new Map<string, Edit[]>();
  let matched = 0;
  let skipped = 0;

  for (const part of analysis.parts) {
    const list: Edit[] = [];
    for (const m of matcher.find(part.text)) {
      matched++;
      // A "mindent jóváhagyok" gomb szemantikája: a köznévnek tartott
      // találatot ez sem cseréli le.
      if (m.disposition === 'reject') {
        skipped++;
        continue;
      }
      const entity = entities.get(m.entityId);
      const replacement = entity ? renderReplacement(m, entity, ctx) : null;
      if (replacement === null) {
        skipped++;
        continue;
      }
      list.push({ start: m.start, end: m.end, replacement });
    }
    if (list.length > 0) edits.set(part.name, list);
  }
  return { edits, matched, skipped };
}

function partText(zip: ZipArchive, name: string): string {
  return zip.readText(name) ?? '';
}

// ---------------------------------------------------------------------------
// A mérés
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const entities: SeedEntity[] = [KOVACS];
  const byId = new Map<string, SeedEntity>(entities.map((e) => [e.id, e]));
  const matcher = new SeedMatcher(entities);

  const original = buildFixture();
  console.log(`\nMinta: ${original.length} bájt, ${ZipArchive.open(original).names().length} rész`);

  // --- 1. A minta egyáltalán .docx-e, és megvan-e minden rejtekhely ---------
  const srcZip = ZipArchive.open(original);
  check('a minta szerkezete ép', validateStructure(srcZip).length === 0, validateStructure(srcZip).join('; '));
  check(
    'a szövegdoboz mindkét ágán ott a név',
    countOccurrences(partText(srcZip, 'word/document.xml'), 'Kovács János s.k.') === 2,
  );

  // --- 2. Az elemzés látja a feloldatlan változáskövetést -------------------
  const firstPass = await analyzeDocx(original);
  check('az elemzés jelzi a változáskövetést', firstPass.revisions.contentCount >= 2);
  check(
    'a változáskövetés szerzőjét is jelenti',
    firstPass.revisions.authors.includes('Kovács János'),
    firstPass.revisions.authors.join(', '),
  );

  let refused = false;
  try {
    await writeDocxDetailed(original, new Map());
  } catch {
    refused = true;
  }
  check('feloldatlan változáskövetéssel nem exportál', refused);

  // --- 3. Feloldás után újra elemzünk ---------------------------------------
  const resolved = await resolveRevisions(original, 'accept');
  const resolvedZip = ZipArchive.open(resolved);
  check(
    'az elfogadás kitörli a <w:delText> tartalmát',
    !partText(resolvedZip, 'word/document.xml').includes('korábbi nyilatkozata'),
  );

  const analysis = await analyzeDocx(resolved);
  check('nincs feloldatlan változás', analysis.revisions.contentCount === 0);

  const byPart = new Map(analysis.parts.map((p) => [p.name, p]));
  const doc = byPart.get('word/document.xml');
  check('a törzs elemzése megvan', doc !== undefined);

  // --- 4. A futamokra tört név EGY találat ----------------------------------
  if (doc) {
    check(
      'a három futamra tört név egyben látszik',
      doc.text.includes('Felperes: Kovács János keresetet'),
      doc.text.slice(0, 80),
    );
    const hits = matcher.find(doc.text).filter((m) => m.surface === 'Kovács János');
    check('a szétvágott név megtalálható', hits.length >= 1);
  }
  check(
    'az élőfej szövege megvan',
    (byPart.get('word/header1.xml')?.text ?? '').includes('Kovács János ügyvédi iroda'),
  );
  check(
    'a lábjegyzet szövege megvan',
    (byPart.get('word/footnotes.xml')?.text ?? '').includes('Kovács János 2024'),
  );
  check(
    'a mezőkód szövege megvan',
    (doc?.text ?? '').includes('HYPERLINK "mailto:kovacs.janos@pelda.hu"'),
  );
  check(
    'a szövegdoboz MINDKÉT ága a lapos szövegben van',
    countOccurrences(doc?.text ?? '', 'Kovács János s.k.') === 2,
  );
  check(
    'a kapcsolat célja (mailto) is elemzés alá kerül',
    (byPart.get('word/_rels/document.xml.rels')?.text ?? '').includes('kovacs.janos@pelda.hu'),
  );
  check(
    'a dokumentumtulajdonságok is elemzés alá kerülnek',
    (byPart.get('docProps/core.xml')?.text ?? '').includes('Kovács János'),
  );

  // --- 4/b. Az attribútumban ülő nevek is bekerülnek a lapos szövegbe ------
  const docText = doc?.text ?? '';
  for (const [what, needle] of [
    ['a könyvjelző neve', 'Kovács_János_nyilatkozata'],
    ['a hivatkozás buborékszövege', 'Ugrás Kovács János nyilatkozatához'],
    ['az egyszerű mező kódja (w:fldSimple/@w:instr)', 'MERGEFIELD  Kovács_János_lakcím'],
    ['a táblázat kisegítő címe', 'Kovács János vagyonmérlege'],
    ['a táblázat kisegítő leírása', 'A felperes, Kovács János tételei'],
    ['a VML alakzat alternatív szövege', 'Kovács János aláírása'],
    ['a rajzelem neve (wp:docPr/@name)', 'Kovács János aláírásmezője'],
  ] as [string, string][]) {
    check(`${what} elemzés alá kerül`, docText.includes(needle), JSON.stringify(needle));
  }
  check(
    'a Word saját könyvjelzőneve (_GoBack) nem hígítja az átnézendő szöveget',
    !docText.includes('_GoBack'),
  );
  // Ez a feltétele annak, hogy az attribútumokat egyáltalán be merjük engedni:
  // a szó közepén álló könyvjelző NEM vághatja ketté a nevet.
  check(
    'a szó közepén álló könyvjelző nem vágja ketté a nevet',
    docText.includes('Alperes: Kovács János lakcíme ismert.'),
    JSON.stringify(docText.slice(Math.max(0, docText.indexOf('Alperes:')), docText.indexOf('Alperes:') + 60)),
  );
  check(
    'a kettévágott név egyetlen találat a könyvjelző ellenére',
    matcher.find(docText).some((m) => m.surface === 'Kovács János' && docText.slice(m.end, m.end + 8) === ' lakcíme'),
  );

  // --- 4/c. Beágyazott képek: figyelmeztetés és metaadat-takarítás -------
  check('az elemzés felsorolja a beágyazott képeket', analysis.images.length === 3, analysis.images.join(', '));
  check(
    'a beágyazott képről HANGOS figyelmeztetés szól, darabszámmal',
    analysis.warnings.some((w) => w.includes('3 beágyazott kép') && w.includes('OCR')),
    analysis.warnings.join('\n         '),
  );
  check(
    'a kép besorolása magyar megjegyzést hordoz',
    (classifyPart('word/media/image3.jpg').note ?? '').includes('KÉPKÉNT'),
  );
  check('a képek nem esnek az ismeretlen részek közé', !analysis.unclassified.some((n) => n.startsWith('word/media/')));

  const cleanedJpeg = stripImageMetadata(jpegWithMetadata());
  check(
    'a JPEG EXIF, XMP és IPTC szegmense eltűnik',
    cleanedJpeg.removed.length === 3 && cleanedJpeg.removed.every((r) => r.startsWith('JPEG')),
    cleanedJpeg.removed.join(', '),
  );
  check(
    'a JPEG képadata és a JFIF fejléce érintetlen',
    hasBytes(cleanedJpeg.bytes, JPEG_SCAN_MARKER) && hasBytes(cleanedJpeg.bytes, utf8('JFIF')),
  );
  const cleanedPng = stripImageMetadata(pngWithText());
  check(
    'a PNG tEXt, zTXt és iTXt darabja eltűnik',
    cleanedPng.removed.length === 3,
    cleanedPng.removed.join(', '),
  );
  check(
    'a PNG képadata és fejléce érintetlen',
    hasBytes(cleanedPng.bytes, PNG_IDAT_MARKER) && hasBytes(cleanedPng.bytes, utf8('IHDR')),
  );
  // Amit nem ismerünk fel, ahhoz hozzá sem nyúlunk: sérült képet előállítani
  // rosszabb, mint bennhagyni egy metaadatot, amiről szólunk.
  const untouchedImage = stripImageMetadata(fakeImage());
  const originalImage = fakeImage();
  check(
    'az ismeretlen formátumú képhez nem nyúlunk',
    untouchedImage.removed.length === 0 &&
      untouchedImage.bytes.length === originalImage.length &&
      untouchedImage.bytes.every((b, i) => b === originalImage[i]),
  );

  // --- 5. Csere és visszaírás ('numbered' mód: determinisztikus címkék) -----
  const ctx = buildContext('numbered', entities, new Map());
  const built = buildEdits(analysis, matcher, byId, ctx);
  console.log(
    `Találat: ${built.matched}, cserélve: ${built.matched - built.skipped}, kihagyva: ${built.skipped}`,
  );

  const result = await writeDocxDetailed(resolved, built.edits, { forbidden: FORBIDDEN });
  const outZip = ZipArchive.open(result.bytes);

  // --- 6. Semmilyen részben nem maradt eredeti név --------------------------
  const residue = findResidue(outZip, FORBIDDEN);
  check(
    'a NYERS bájtokban sincs eredeti név egyetlen részben sem',
    residue.length === 0,
    residue.map((r) => `${r.part} (${r.encoding}): "${r.needle}"`).join('\n         '),
  );

  // --- 7. Rejtekhelyenkénti ellenőrzés --------------------------------------
  const outDoc = partText(outZip, 'word/document.xml');
  check('a törzsben megjelent a címke', outDoc.includes('[NÉV-1]'));
  check(
    'a szövegdoboz MINDKÉT ága cserélve lett',
    countOccurrences(outDoc, '[NÉV-1] s.k.') === 2,
    `talált: ${countOccurrences(outDoc, '[NÉV-1] s.k.')}`,
  );
  check('a mezőkód cserélve lett', outDoc.includes('HYPERLINK') && !outDoc.includes('kovacs.janos'));
  check('a kép alternatív szövege cserélve lett', !outDoc.includes('aláírása') || !outDoc.includes('Kovács'));

  // Az attribútumok visszaírása: a hivatkozás horgonyának és a könyvjelző
  // nevének AZONOSNAK kell maradnia, különben a Word „Hiba! A könyvjelző nem
  // létezik" üzenetet ír a hivatkozás helyére.
  const bookmarkName = /<w:bookmarkStart [^>]*w:name="([^"]*)"/.exec(outDoc)?.[1] ?? '';
  const anchor = /<w:hyperlink [^>]*w:anchor="([^"]*)"/.exec(outDoc)?.[1] ?? '';
  check('a könyvjelző neve cserélve lett', bookmarkName !== '' && !bookmarkName.includes('Kovács'), bookmarkName);
  check('a horgony a könyvjelző nevével együtt változott', bookmarkName === anchor, `${bookmarkName} ≠ ${anchor}`);
  check('a _GoBack könyvjelző érintetlen maradt', outDoc.includes('w:name="_GoBack"'));
  check(
    'az egyszerű mező kódja cserélve lett',
    outDoc.includes('w:fldSimple') && outDoc.includes('MERGEFIELD') && !/w:instr="[^"]*Kovács/.test(outDoc),
  );
  check(
    'a táblázat kisegítő címe és leírása cserélve lett',
    outDoc.includes('w:tblCaption') && outDoc.includes('w:tblDescription') && !/w:val="[^"]*Kovács/.test(outDoc),
  );
  check('a VML alakzat alt és o:title attribútuma cserélve lett', !/(alt|o:title)="[^"]*Kovács/.test(outDoc));
  check(
    'az élőfej cserélve lett',
    partText(outZip, 'word/header1.xml').includes('[NÉV-1]'),
  );
  check(
    'a lábjegyzet cserélve lett',
    partText(outZip, 'word/footnotes.xml').includes('[NÉV-1]'),
  );

  // --- 8. xml:space minden általunk írt <w:t>-n -----------------------------
  const missingPreserve: string[] = [];
  for (const name of outZip.names()) {
    if (classifyPart(name).profile !== WML_PROFILE) continue;
    const xml = partText(outZip, name);
    for (const f of buildPartText(xml, WML_PROFILE).fragments) {
      if (f.isAttribute || !f.tagName.startsWith('w:')) continue;
      if (!f.decoded.includes('[NÉV-1]')) continue;
      if (!/\sxml:space\s*=\s*"preserve"/.test(xml.slice(f.elementStart, f.openTagEnd))) {
        missingPreserve.push(`${name}: ${f.decoded.slice(0, 40)}`);
      }
    }
  }
  check(
    'minden általunk írt <w:t> hordozza az xml:space="preserve"-t',
    missingPreserve.length === 0,
    missingPreserve.join('\n         '),
  );
  // A szóközt a LAPOS szövegen kell mérni: a csere után a mondat több <w:t>
  // elemre oszlik, és pont az a kérdés, hogy a határon nem vész-e el a szóköz.
  const outDocText = buildPartText(outDoc, WML_PROFILE).text;
  check(
    'a szóközök nem tűntek el a csere körül',
    outDocText.includes('Felperes: [NÉV-1] keresetet nyújtott be'),
    JSON.stringify(outDocText.slice(0, 80)),
  );

  // --- 9. Metaadat és rejtett adat -----------------------------------------
  const core = partText(outZip, 'docProps/core.xml');
  check('a dc:creator kiürült', /<dc:creator><\/dc:creator>|<dc:creator\/>/.test(core), core);
  check('a cp:lastModifiedBy kiürült', !core.includes('Kovács'));
  check('a dcterms:created eltűnt', !core.includes('dcterms:created'));
  check('a docProps/custom.xml törölve', !outZip.has('docProps/custom.xml'));
  check('a word/comments.xml törölve', !outZip.has('word/comments.xml'));
  check('a word/people.xml törölve', !outZip.has('word/people.xml'));
  check(
    'a megjegyzésjelölők eltűntek a törzsből',
    !outDoc.includes('commentRangeStart') && !outDoc.includes('commentReference'),
  );
  const settings = partText(outZip, 'word/settings.xml');
  check('a w:rsids eltűnt', !settings.includes('w:rsid'));
  check('a w:proofState eltűnt', !settings.includes('proofState'));
  check('a w:attachedTemplate eltűnt', !settings.includes('attachedTemplate'));
  check(
    'a csatolt sablon kapcsolata is eltűnt',
    !partText(outZip, 'word/_rels/settings.xml.rels').includes('kovacsj'),
  );
  check('a w:rsid attribútumok eltűntek a törzsből', !outDoc.includes('w:rsid'));
  check('a TitlesOfParts eltűnt', !partText(outZip, 'docProps/app.xml').includes('TitlesOfParts'));

  // --- 10. Formátumhűség ----------------------------------------------------
  check('a kimenet szerkezete ép', validateStructure(outZip).length === 0, validateStructure(outZip).join('; '));
  const srcImage = srcZip.read('word/media/image1.png');
  const outImage = outZip.read('word/media/image1.png');
  check(
    'a bináris rész bájtazonosan ment át',
    srcImage !== null &&
      outImage !== null &&
      srcImage.length === outImage.length &&
      srcImage.every((b, i) => b === outImage[i]),
  );
  check('a félkövér formázás megmaradt', outDoc.includes('<w:b/>'));
  check('a dőlt formázás megmaradt a szövegdobozban', countOccurrences(outDoc, '<w:i/>') === 2);
  check('a táblázat megmaradt', outDoc.includes('<w:tbl>') && outDoc.includes('<w:gridCol'));
  check('a mezőkarakterek megmaradtak', countOccurrences(outDoc, 'w:fldCharType="begin"') === 2);

  // --- 11. A futamösszevonás megtörtént, és nem változtatott szöveget -------
  const rawDoc = partText(resolvedZip, 'word/document.xml');
  const normalised = normalisePartXml(rawDoc, WML_PROFILE);
  check('a szomszédos futamok összevonódtak', mergeAdjacentRuns(rawDoc, WML_PROFILE).merged >= 3);
  check(
    'a törzs futamszáma csökkent az összevonástól',
    countOccurrences(outDoc, '<w:r>') + countOccurrences(outDoc, '<w:r ') <
      countOccurrences(partText(srcZip, 'word/document.xml'), '<w:r>') +
        countOccurrences(partText(srcZip, 'word/document.xml'), '<w:r '),
  );
  // A normalizálás egyetlen karaktert sem mozdíthat el a lapos szövegben —
  // ez az a feltétel, ami az összevonást egyáltalán vállalhatóvá teszi.
  const beforeMerge = buildPartText(rawDoc, WML_PROFILE).text;
  const afterMerge = buildPartText(normalised.xml, WML_PROFILE).text;
  check(
    'a normalizálás karakterre azonos szöveget ad',
    beforeMerge === afterMerge,
    `\n         előtte: ${JSON.stringify(beforeMerge.slice(0, 100))}\n         utána:  ${JSON.stringify(afterMerge.slice(0, 100))}`,
  );

  // --- 12. Szerkesztés nélküli körbefordulás --------------------------------
  const untouched = await writeDocxDetailed(resolved, new Map(), { sanitize: false });
  check('szerkesztés nélkül is ép marad', validateStructure(ZipArchive.open(untouched.bytes)).length === 0);

  // --- 13. A témás mód is végigmegy a .docx-en ------------------------------
  const theme = JSON.parse(
    readFileSync(join(ROOT, 'data', 'themes', 'semleges_magyar.json'), 'utf8'),
  ) as Theme;
  const themeCtx = buildContext(
    'theme',
    entities,
    assignPseudonyms(entities, theme, { caseSecret: 'docx-teszt' }),
  );
  const themeEdits = buildEdits(analysis, matcher, byId, themeCtx);
  const themed = await writeDocxDetailed(resolved, themeEdits.edits);
  const themedZip = ZipArchive.open(themed.bytes);
  check('témás módban is ép a kimenet', validateStructure(themedZip).length === 0);
  const themeResidue = findResidue(themedZip, FORBIDDEN);
  check(
    'témás módban sem marad eredeti név',
    themeResidue.length === 0,
    themeResidue.map((r) => `${r.part}: "${r.needle}"`).join('\n         '),
  );

  // --- 14. Az elutasítás visszahozza a törölt szöveget ----------------------
  const rejected = ZipArchive.open(await resolveRevisions(original, 'reject'));
  const rejectedDoc = partText(rejected, 'word/document.xml');
  check(
    'az elutasítás visszateszi a törölt szöveget normál szövegként',
    rejectedDoc.includes('Kovács János korábbi nyilatkozata') && !rejectedDoc.includes('w:delText'),
  );
  check(
    'az elutasítás kiveszi a beszúrt szöveget',
    !rejectedDoc.includes('becsatolt okiratok'),
  );


  const outJpeg = outZip.read('word/media/image3.jpg');
  const outPng2 = outZip.read('word/media/image2.png');
  check(
    'az exportált JPEG-ből eltűnt az EXIF, de a képadat megvan',
    outJpeg !== null && !hasBytes(outJpeg, utf8('Exif')) && hasBytes(outJpeg, JPEG_SCAN_MARKER),
  );
  check(
    'az exportált PNG-ből eltűntek a szövegdarabok, de a képadat megvan',
    outPng2 !== null && !hasBytes(outPng2, utf8('tEXt')) && hasBytes(outPng2, PNG_IDAT_MARKER),
  );
  check(
    'a takarítás jelenti, mit vágott ki a képekből',
    (result.sanitize?.clearedFields ?? []).some((f) => f.startsWith('word/media/image3.jpg')),
    (result.sanitize?.clearedFields ?? []).join('; '),
  );
  check(
    'az export figyelmeztetése is szól a képekről',
    result.warnings.some((w) => w.includes('beágyazott kép')),
  );
  check('a takarítás a képek részeit nem törli', mediaParts(outZip).length === 3);

  // --- 16. A bájtszintű vizsgálat FÉLKÉSZ átnézésnél is fut ----------------
  //
  // Ez a hézag lényege: a tiltólista eddig csak akkor telt meg, ha minden
  // találat el volt döntve — vagyis pont a leggyakoribb valós helyzetben, a
  // félkész átnézésnél nem védett semmi. A hívó itt SEMMILYEN tiltólistát nem
  // ad meg; a motornak a szerkesztésekből kell tudnia, mit tilos bennhagyni.
  const oleFixture = buildFixture({ hiddenOle: true });
  const oleResolved = await resolveRevisions(oleFixture, 'accept');
  const oleAnalysis = await analyzeDocx(oleResolved);
  check(
    'a rejtett bináris rész szövegét a kinyerő NEM látja',
    !oleAnalysis.parts.some((p) => p.text.includes('titkos melléklete')),
  );
  const oleEdits = buildEdits(oleAnalysis, matcher, byId, ctx);
  let blocked = '';
  try {
    await writeDocxDetailed(oleResolved, oleEdits.edits);
  } catch (e) {
    blocked = e instanceof Error ? e.message : String(e);
  }
  check(
    'üres tiltólistával is megáll a rejtett bináris részben maradt névtől',
    blocked.includes('Kovács János') && blocked.includes('utf-16le'),
    blocked.slice(0, 200),
  );
  check(
    'a hibaüzenet megnevezi a részt is',
    blocked.includes('word/embeddings/oleObject1.bin'),
    blocked.slice(0, 200),
  );

  // A félkész átnézés viszont NEM állhat meg: amit a felhasználó még nem
  // döntött el, az jogosan marad a fájlban — arról jelentést kap, nem hibát.
  const halfEdits = new Map(built.edits);
  halfEdits.delete('word/header1.xml');
  let halfFailed = '';
  let halfWarnings: string[] = [];
  try {
    halfWarnings = (await writeDocxDetailed(resolved, halfEdits)).warnings;
  } catch (e) {
    halfFailed = e instanceof Error ? e.message : String(e);
  }
  check('a félkész átnézés exportja nem áll meg', halfFailed === '', halfFailed.slice(0, 200));
  check(
    'a bennhagyott névről jelentést ad',
    halfWarnings.some((w) => w.includes('word/header1.xml') && w.includes('Kovács János')),
    halfWarnings.join('\n         '),
  );

  console.log(`\nDOCX: ${checks - failures}/${checks} ellenőrzés rendben`);
  if (result.warnings.length > 0) {
    console.log('\nFigyelmeztetések az exportból:');
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  console.log('');
  process.exit(failures === 0 ? 0 : 1);
}

void main();
