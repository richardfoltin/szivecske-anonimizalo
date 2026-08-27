/**
 * ZIP olvasás és írás a DOCX-hez — külső függőség nélkül.
 *
 * Miért saját, és miért nem kész könyvtár: a formátumhűség itt nem stílus
 * kérdése. A .docx több száz részből áll (képek, betűkészletek, beágyazott
 * csomagok), amikhez nekünk semmi közünk. Ha az egész csomagot újratömörítjük,
 * minden bájt megváltozik, és a Word bármelyik apró eltéréstől „javítható
 * hibát" jelenthet. Itt viszont az érintetlen részek NYERS, tömörített bájtjait
 * másoljuk át változatlanul; csak azt szedjük szét, amit ténylegesen átírtunk.
 *
 * A másik ok üzleti: ez zárt forrású termékbe kerül, és minden felvett
 * függőség licencfelülvizsgálatot igényel. Amit nem veszünk fel, azt nem is
 * kell megvédeni.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** 1980-01-01 00:00 — a ZIP-korszak legkorábbi ábrázolható időpontja. */
const EPOCH_DOS_DATE = 0x0021;
const EPOCH_DOS_TIME = 0x0000;

export interface ZipEntry {
  name: string;
  /** A tömörített bájtok az EREDETI fájlból, változatlan átmásoláshoz. */
  raw: Uint8Array;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  flags: number;
  versionMadeBy: number;
  versionNeeded: number;
  internalAttrs: number;
  externalAttrs: number;
  /** A helyi fejléc és a központi könyvtár extra mezői eltérhetnek egymástól. */
  localExtra: Uint8Array;
  centralExtra: Uint8Array;
  comment: Uint8Array;
  dosTime: number;
  dosDate: number;
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Egy megnyitott ZIP csomag.
 *
 * Az olvasás lusta: a részt csak akkor tömörítjük ki, amikor kérik. Az írás
 * felülírás-naplós: ami nem kapott új tartalmat, az bájtazonosan megy tovább.
 */
export class ZipArchive {
  private readonly order: string[] = [];
  private readonly byName = new Map<string, ZipEntry>();
  private readonly overrides = new Map<string, Uint8Array>();
  private readonly decodedCache = new Map<string, Uint8Array>();
  private readonly deleted = new Set<string>();

  private constructor(entries: ZipEntry[]) {
    for (const e of entries) {
      this.order.push(e.name);
      this.byName.set(e.name, e);
    }
  }

  static open(bytes: Uint8Array): ZipArchive {
    return new ZipArchive(readCentralDirectory(bytes));
  }

  /** Új, üres csomag — a tesztminták legyártásához. */
  static create(): ZipArchive {
    return new ZipArchive([]);
  }

  names(): string[] {
    return this.order.filter((n) => !this.deleted.has(n));
  }

  has(name: string): boolean {
    return !this.deleted.has(name) && (this.byName.has(name) || this.overrides.has(name));
  }

  /** A rész kitömörített bájtjai, vagy null, ha nincs ilyen rész. */
  read(name: string): Uint8Array | null {
    if (this.deleted.has(name)) return null;
    const override = this.overrides.get(name);
    if (override) return override;
    const cached = this.decodedCache.get(name);
    if (cached) return cached;
    const entry = this.byName.get(name);
    if (!entry) return null;
    const out = decompress(entry);
    this.decodedCache.set(name, out);
    return out;
  }

  readText(name: string): string | null {
    const bytes = this.read(name);
    if (!bytes) return null;
    const text = new TextDecoder('utf-8').decode(bytes);
    // A BOM-ot levágjuk, hogy ne kerüljön a szövegoffszetek elé.
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  /** Rész felülírása vagy létrehozása. Csak ezek tömörítődnek újra. */
  write(name: string, data: Uint8Array | string): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.overrides.set(name, bytes);
    this.decodedCache.delete(name);
    this.deleted.delete(name);
    if (!this.order.includes(name)) this.order.push(name);
  }

  remove(name: string): boolean {
    if (!this.has(name)) return false;
    this.deleted.add(name);
    this.overrides.delete(name);
    this.decodedCache.delete(name);
    return true;
  }

  /**
   * Minden időbélyeg egységesítése.
   *
   * A ZIP-bejegyzések dátuma is rejtett adat: elárulja, mikor és milyen
   * sorrendben nyúlt hozzá a szerző az egyes részekhez. Az exportnál ezért
   * mindet a korszak elejére állítjuk, és eldobjuk az extra időbélyeg-mezőket.
   */
  normalizeTimestamps(): void {
    for (const e of this.byName.values()) {
      e.dosDate = EPOCH_DOS_DATE;
      e.dosTime = EPOCH_DOS_TIME;
      e.localExtra = stripTimestampExtras(e.localExtra);
      e.centralExtra = stripTimestampExtras(e.centralExtra);
    }
  }

  toBytes(): Uint8Array {
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    let count = 0;

    for (const name of this.order) {
      if (this.deleted.has(name)) continue;
      const built = this.buildEntry(name);
      if (!built) continue;

      const nameBytes = new TextEncoder().encode(name);
      const utf8Flag = nameBytes.length !== name.length ? 0x0800 : 0;
      // A 3. jelzőbit (adatleíró) törlődik: mi valódi méretet írunk a fejlécbe.
      const flags = (built.flags & ~0x0008) | utf8Flag;

      locals.push(localHeader(built, nameBytes, flags));
      locals.push(built.data);
      centrals.push(centralHeader(built, nameBytes, flags, offset));
      offset += 30 + nameBytes.length + built.localExtra.length + built.data.length;
      count++;
    }

    const centralSize = centrals.reduce((s, b) => s + b.length, 0);
    const eocd = new Uint8Array(22);
    const dv = view(eocd);
    dv.setUint32(0, SIG_EOCD, true);
    dv.setUint16(8, count, true);
    dv.setUint16(10, count, true);
    dv.setUint32(12, centralSize, true);
    dv.setUint32(16, offset, true);

    return concat([...locals, ...centrals, eocd]);
  }

  private buildEntry(name: string): (ZipEntry & { data: Uint8Array }) | null {
    const existing = this.byName.get(name);
    const override = this.overrides.get(name);

    if (existing && !override) {
      // Érintetlen rész: a tömörített bájtok VÁLTOZATLANUL mennek tovább.
      return { ...existing, data: existing.raw };
    }
    if (!existing && !override) return null;

    const plain = override ?? new Uint8Array(0);
    // A mappabejegyzéseket (a nevük / jelre végződik) soha nem tömörítjük.
    const isDir = name.endsWith('/');
    const deflated = isDir || plain.length === 0 ? null : deflateRawSync(plain);
    const useDeflate = deflated !== null && deflated.length < plain.length;
    const data = useDeflate ? new Uint8Array(deflated) : plain;

    return {
      name,
      raw: data,
      data,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(plain),
      compressedSize: data.length,
      uncompressedSize: plain.length,
      flags: 0,
      versionMadeBy: existing?.versionMadeBy ?? 0x0014,
      versionNeeded: useDeflate ? 20 : 10,
      internalAttrs: existing?.internalAttrs ?? 0,
      externalAttrs: existing?.externalAttrs ?? 0,
      localExtra: new Uint8Array(0),
      centralExtra: new Uint8Array(0),
      comment: new Uint8Array(0),
      dosTime: existing?.dosTime ?? EPOCH_DOS_TIME,
      dosDate: existing?.dosDate ?? EPOCH_DOS_DATE,
    };
  }
}

function localHeader(
  e: ZipEntry & { data: Uint8Array },
  nameBytes: Uint8Array,
  flags: number,
): Uint8Array {
  const head = new Uint8Array(30);
  const dv = view(head);
  dv.setUint32(0, SIG_LOCAL, true);
  dv.setUint16(4, e.versionNeeded, true);
  dv.setUint16(6, flags, true);
  dv.setUint16(8, e.method, true);
  dv.setUint16(10, e.dosTime, true);
  dv.setUint16(12, e.dosDate, true);
  dv.setUint32(14, e.crc, true);
  dv.setUint32(18, e.data.length, true);
  dv.setUint32(22, e.uncompressedSize, true);
  dv.setUint16(26, nameBytes.length, true);
  dv.setUint16(28, e.localExtra.length, true);
  return concat([head, nameBytes, e.localExtra]);
}

function centralHeader(
  e: ZipEntry & { data: Uint8Array },
  nameBytes: Uint8Array,
  flags: number,
  localOffset: number,
): Uint8Array {
  const head = new Uint8Array(46);
  const dv = view(head);
  dv.setUint32(0, SIG_CENTRAL, true);
  dv.setUint16(4, e.versionMadeBy, true);
  dv.setUint16(6, e.versionNeeded, true);
  dv.setUint16(8, flags, true);
  dv.setUint16(10, e.method, true);
  dv.setUint16(12, e.dosTime, true);
  dv.setUint16(14, e.dosDate, true);
  dv.setUint32(16, e.crc, true);
  dv.setUint32(20, e.data.length, true);
  dv.setUint32(24, e.uncompressedSize, true);
  dv.setUint16(28, nameBytes.length, true);
  dv.setUint16(30, e.centralExtra.length, true);
  dv.setUint16(32, e.comment.length, true);
  dv.setUint16(36, e.internalAttrs, true);
  dv.setUint32(38, e.externalAttrs, true);
  dv.setUint32(42, localOffset, true);
  return concat([head, nameBytes, e.centralExtra, e.comment]);
}

function decompress(entry: ZipEntry): Uint8Array {
  if (entry.method === METHOD_STORE) return entry.raw;
  if (entry.method === METHOD_DEFLATE) return new Uint8Array(inflateRawSync(entry.raw));
  throw new Error(
    `A(z) "${entry.name}" rész ismeretlen tömörítéssel készült (kód: ${entry.method}). ` +
      'A csomagot nem dolgozzuk fel, mert nem tudjuk igazolni, mi van benne.',
  );
}

function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  const eocd = findEocd(bytes);
  if (eocd < 0) {
    throw new Error('Nem ZIP-csomag: hiányzik a záró rekord. A fájl valószínűleg nem .docx.');
  }

  if (eocd >= 20 && dv.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) {
    throw new Error(
      'ZIP64 csomag. Ezt szándékosan nem dolgozzuk fel: a részleges támogatás ' +
        'csendben sérült fájlt adna, ami rosszabb, mint a nyílt visszautasítás.',
    );
  }

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  if (ptr === 0xffffffff || count === 0xffff) {
    throw new Error('ZIP64 csomag (túlcsordult mezők). Nem dolgozzuk fel.');
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(ptr, true) !== SIG_CENTRAL) {
      throw new Error(`Sérült központi könyvtár a(z) ${i}. bejegyzésnél.`);
    }
    const flags = dv.getUint16(ptr + 8, true);
    if ((flags & 0x0001) !== 0) {
      throw new Error(
        'Jelszóval védett .docx. Nyisd meg a Wordben, mentsd el védelem nélkül, és futtasd újra.',
      );
    }
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // A helyi fejléc név- és extra-hossza ELTÉRHET a központitól, ezért onnan
    // olvassuk vissza; különben a tartalom kezdetét mérnénk el.
    if (dv.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`Sérült helyi fejléc: "${name}".`);
    }
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressedSize = dv.getUint32(ptr + 20, true);

    entries.push({
      name,
      raw: bytes.subarray(dataStart, dataStart + compressedSize),
      method: dv.getUint16(ptr + 10, true),
      crc: dv.getUint32(ptr + 16, true),
      compressedSize,
      uncompressedSize: dv.getUint32(ptr + 24, true),
      flags,
      versionMadeBy: dv.getUint16(ptr + 4, true),
      versionNeeded: dv.getUint16(ptr + 6, true),
      internalAttrs: dv.getUint16(ptr + 36, true),
      externalAttrs: dv.getUint32(ptr + 38, true),
      localExtra: bytes.slice(localOffset + 30 + localNameLen, dataStart),
      centralExtra: bytes.slice(ptr + 46 + nameLen, ptr + 46 + nameLen + extraLen),
      comment: bytes.slice(
        ptr + 46 + nameLen + extraLen,
        ptr + 46 + nameLen + extraLen + commentLen,
      ),
      dosTime: dv.getUint16(ptr + 12, true),
      dosDate: dv.getUint16(ptr + 14, true),
    });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEocd(bytes: Uint8Array): number {
  const dv = view(bytes);
  // A ZIP-megjegyzés legfeljebb 65535 bájt, ennyit kell visszafelé végignézni.
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/** Időbélyeget és felhasználóazonosítót hordozó extra mezők eldobása. */
function stripTimestampExtras(extra: Uint8Array): Uint8Array {
  if (extra.length === 0) return extra;
  const dv = view(extra);
  const keep: Uint8Array[] = [];
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = dv.getUint16(p, true);
    const size = dv.getUint16(p + 2, true);
    if (p + 4 + size > extra.length) break;
    // 0x000a = NTFS idők, 0x5455 = Unix idők, 0x7875 = uid/gid.
    if (id !== 0x000a && id !== 0x5455 && id !== 0x7875) {
      keep.push(extra.slice(p, p + 4 + size));
    }
    p += 4 + size;
  }
  return concat(keep);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
