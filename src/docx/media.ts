/**
 * Beágyazott képek metaadatainak törlése — a KÉPI TARTALOMHOZ nem nyúlunk.
 *
 * Ugyanaz az érv, ami miatt a `docProps/thumbnail` részt töröljük: a
 * beszkennelt aláírás, a lefényképezett tanúsítvány és a képernyőkép ugyanúgy
 * hordozza a nevet, csak nem szövegként. OCR-ünk nincs (és most nem is lesz),
 * ezért a képre írt nevet nem tudjuk lecserélni — de a kép MELLÉ írt adatot
 * igen, és az legalább annyira azonosít:
 *
 *  - a JPEG EXIF-jében ott a fényképezőgép sorozatszáma, a szerző neve, a
 *    szkennelő program és nem ritkán a GPS-koordináta,
 *  - az APP13/IPTC blokkban a szerkesztőségi „byline" mező, szintén névvel,
 *  - az XMP-ben a Windows-felhasználónév és a dokumentumazonosító, amivel két
 *    külön ügy iratai összeköthetők,
 *  - a PNG szöveges darabjaiba a szerkesztőprogram írja bele a szerzőt.
 *
 * A képpontokat viszont bántatlanul hagyjuk: a bájtokat változatlanul másoljuk,
 * csak a felsorolt szegmenseket vágjuk ki. Ha a fájl szerkezetét bármikor nem
 * értjük, VÁLTOZATLANUL adjuk vissza — sérült képet előállítani rosszabb, mint
 * bennhagyni egy EXIF-blokkot, amiről szólunk a felhasználónak.
 */

export interface ImageCleanResult {
  bytes: Uint8Array;
  /** Mit vágtunk ki, magyarul — ez megy a jelentésbe. */
  removed: string[];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG-e a rész: SOI + az első jelölő kezdete. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Van-e egyáltalán olyan formátum, amiből ki tudunk takarítani. */
export function isCleanableImage(bytes: Uint8Array): boolean {
  return isJpeg(bytes) || isPng(bytes);
}

/**
 * Metaadat-szegmensek kivágása egy képből.
 *
 * A vissza nem ismert formátumot (GIF, EMF, TIFF, WebP) érintetlenül hagyjuk:
 * ott a `removed` üres marad, és a hívó figyelmeztetése az egyetlen védelem.
 */
export function stripImageMetadata(bytes: Uint8Array): ImageCleanResult {
  const cuts = isJpeg(bytes) ? jpegMetadataCuts(bytes) : isPng(bytes) ? pngMetadataCuts(bytes) : null;
  if (cuts === null || cuts.length === 0) return { bytes, removed: [] };
  return { bytes: cutOut(bytes, cuts), removed: cuts.map((c) => c.label) };
}

interface Cut {
  start: number;
  end: number;
  label: string;
}

function cutOut(bytes: Uint8Array, cuts: Cut[]): Uint8Array {
  const kept = bytes.length - cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
  const out = new Uint8Array(kept);
  let at = 0;
  let cursor = 0;
  for (const c of cuts) {
    out.set(bytes.subarray(cursor, c.start), at);
    at += c.start - cursor;
    cursor = c.end;
  }
  out.set(bytes.subarray(cursor), at);
  return out;
}

/**
 * JPEG: a jelölős szegmensek végigjárása a képadat kezdetéig.
 *
 * A `SOS` (képadat) után entrópiakódolt bájtfolyam jön, amiben a 0xFF bájt már
 * NEM jelölő — ott a további elemzés csak kárt okozhatna, ezért megállunk.
 * A `null` visszatérés azt jelenti: nem értjük a fájlt, ne nyúljunk hozzá.
 */
function jpegMetadataCuts(bytes: Uint8Array): Cut[] | null {
  const cuts: Cut[] = [];
  let i = 2;

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Kitöltő 0xFF bájtok állhatnak a jelölő előtt.
    let m = i + 1;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    const marker = bytes[m];
    if (marker === undefined) return null;

    // Hossz nélküli jelölők: újraindítás, SOI, TEM.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = m + 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;

    if (m + 2 >= bytes.length) return null;
    const length = (bytes[m + 1]! << 8) | bytes[m + 2]!;
    if (length < 2) return null;
    const segmentEnd = m + 1 + length;
    if (segmentEnd > bytes.length) return null;

    const label = jpegSegmentLabel(marker, bytes, m + 3, segmentEnd);
    if (label !== null) cuts.push({ start: i, end: segmentEnd, label });
    i = segmentEnd;
  }

  return cuts;
}

/** Az EXIF, az IPTC és az XMP szegmens felismerése az azonosító előtagjáról. */
function jpegSegmentLabel(marker: number, bytes: Uint8Array, from: number, to: number): string | null {
  if (marker === 0xe1) {
    if (startsWithAscii(bytes, from, to, 'Exif\0\0')) return 'JPEG EXIF (APP1)';
    if (startsWithAscii(bytes, from, to, 'http://ns.adobe.com/xap/1.0/\0')) return 'JPEG XMP (APP1)';
    return null;
  }
  if (marker === 0xed && startsWithAscii(bytes, from, to, 'Photoshop 3.0\0')) {
    return 'JPEG IPTC (APP13)';
  }
  return null;
}

function startsWithAscii(bytes: Uint8Array, from: number, to: number, prefix: string): boolean {
  if (to - from < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[from + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * PNG: darabok (chunk) végigjárása.
 *
 * A hossz és a típus után a CRC következik, amit nem kell újraszámolni: a
 * darabot EGÉSZBEN vágjuk ki, a többi darab CRC-je pedig önmagára vonatkozik.
 * Az `IEND` után maradt bájtok érintetlenül maradnak — ott már nem a PNG-é a
 * terület, és nem a mi dolgunk eldönteni, mi az.
 */
function pngMetadataCuts(bytes: Uint8Array): Cut[] | null {
  const cuts: Cut[] = [];
  let i = PNG_SIGNATURE.length;

  while (i + 8 <= bytes.length) {
    const length = readU32(bytes, i);
    const type = asciiAt(bytes, i + 4, 4);
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      cuts.push({ start: i, end, label: `PNG ${type}` });
    }
    i = end;
    if (type === 'IEND') break;
  }

  return cuts;
}

function readU32(bytes: Uint8Array, at: number): number {
  return bytes[at]! * 0x1000000 + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
}

function asciiAt(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i]!);
  return out;
}
