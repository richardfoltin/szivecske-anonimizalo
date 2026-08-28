/**
 * Dátumok felismerése és eltolása magyar jogi iratban.
 *
 * MIÉRT LÉTEZIK EZ A MODUL: a beállításokban ott állt a „shiftDates” kapcsoló,
 * a motorban viszont NULLA olvasója volt. A jogász bekapcsolta, a pipa
 * megmaradt, és az irat a valódi születési dátumokkal ment ki. A születési idő
 * a magyar iratokban a név után a legerősebb azonosító — anyja nevével együtt
 * egyértelműen kijelöl egy embert.
 *
 * A CSERE: az ügy titkából képzett, ügyre ÁLLANDÓ eltolás napokban. Így az
 * IDŐKÖZÖK MEGMARADNAK: ha a szerződés és a felmondás közt 90 nap telt el, az
 * eltolás után is 90 nap telik el. Ez nem kényelmi kérdés — a jogi érvelés
 * gyakran épp az időközre épül (elévülés, felmondási idő, késedelem kezdete),
 * és egy véletlenszerű dátumcsere az érvelést tenné értelmetlenné.
 *
 * A NEHÉZ RÉSZ: A RAGOZOTT ALAKOT ÚJRA KELL RAGOZNI.
 *
 * A magyar napok toldaléka a szám KIEJTÉSÉTŐL függ, nem a leírt alakjától:
 * „4-én”, de „5-én”; „20-án”, de „21-én”. A kiejtett alak a sorszámnév
 * („negyedike”, „huszadika”), és annak a hangrendje dönt. Ezt nem találgatjuk:
 * a sorszámneveket táblázatból vesszük, a toldalékot pedig a már meglévő
 * inflect.ts állítja elő belőlük — így a napok toldaléka ugyanabból a
 * hangrend-felismerésből származik, mint a nevek ragozása.
 *
 * Az elseje kivétel: „1-jén”, nem „1-én” (AkH. 12. 300.). A j azért marad ott,
 * mert a leírt „1” önmagában „egy”-nek olvasható, és a „-jén” mutatja, hogy
 * „elsején” a kiejtett alak.
 *
 * AMIT SOHA NEM TOLUNK EL: a jogszabály-hivatkozás évszámát. A „2016. évi CXXX.
 * törvény” nem dátum, hanem egy törvény NEVE. Eltolva az irat egy másik
 * törvényre hivatkozna — ez nem anonimizálás, hanem hamisítás. Ezért az „évi”
 * szó a felismerés kifejezett kizáró jele.
 */

import { createHmac } from 'node:crypto';

import { HU_LETTER_CLASS } from './phonology.js';
import { type CaseTag, ALL_CASES, inflectWord } from './inflect.js';
import { AUTO_REPLACE_THRESHOLD } from './identifiers.js';
import { szamBetuvel } from './osszegek.js';

const L = HU_LETTER_CLASS;

/** Ugyanaz a küszöb, mint a matcher.ts-ben és az azonositok.ts-ben. */
export { AUTO_REPLACE_THRESHOLD as AUTO_THRESHOLD } from './identifiers.js';

/* ================================================================== *
 *  SZÓTÁRAK
 * ================================================================== */

export const HONAP_NEVEK: readonly string[] = [
  'január', 'február', 'március', 'április', 'május', 'június',
  'július', 'augusztus', 'szeptember', 'október', 'november', 'december',
];

/** A szokásos rövidítések; az első a kanonikus, azt írjuk vissza. */
const HONAP_ROVIDITESEK: readonly (readonly string[])[] = [
  ['jan'], ['febr', 'feb'], ['márc', 'marc'], ['ápr', 'apr'], ['máj', 'maj'], ['jún', 'jun'],
  ['júl', 'jul'], ['aug'], ['szept', 'szep'], ['okt'], ['nov'], ['dec'],
];

const HONAP_ROMAI: readonly string[] = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
];

/**
 * A hónapok birtokos alakja: „2025 februárjában”, „2025 júniusa és szeptembere
 * között”. A kötőhangzó lexikális (februárJa, de márciusA), ezért táblázat.
 */
const HONAP_BIRTOKOS: readonly string[] = [
  'januárja', 'februárja', 'márciusa', 'áprilisa', 'májusa', 'júniusa',
  'júliusa', 'augusztusa', 'szeptembere', 'októbere', 'novembere', 'decembere',
];

/**
 * A napok sorszámneve, alanyesetben.
 *
 * Miért táblázat és nem képzés? Mert a sor eleje rendhagyó („elseje”, nem
 * „egyedike”), a képző pedig hangrend szerint váltakozik („másodika”, de
 * „negyedike”). A táblázat 31 sora egyszer leírható és emberrel ellenőrizhető;
 * egy képzőszabály ugyanennyi kivétellel járna, csak rejtve.
 */
const NAP_SORSZAM: readonly string[] = [
  '', // 0 — nincs nulladika
  'elseje', 'másodika', 'harmadika', 'negyedike', 'ötödike', 'hatodika',
  'hetedike', 'nyolcadika', 'kilencedike', 'tizedike', 'tizenegyedike',
  'tizenkettedike', 'tizenharmadika', 'tizennegyedike', 'tizenötödike',
  'tizenhatodika', 'tizenhetedike', 'tizennyolcadika', 'tizenkilencedike',
  'huszadika', 'huszonegyedike', 'huszonkettedike', 'huszonharmadika',
  'huszonnegyedike', 'huszonötödike', 'huszonhatodika', 'huszonhetedike',
  'huszonnyolcadika', 'huszonkilencedike', 'harmincadika', 'harmincegyedike',
];

/** A hét napjai — csak figyelmeztetéshez: ezeket az eltolás elrontja. */
const NAPNEVEK: readonly string[] = [
  'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap',
];

/* ================================================================== *
 *  NAPTOLDALÉK
 * ================================================================== */

export type NapToldalekFajta =
  /** Alapalak: „24-e”, „1-je”. */
  | 'alap'
  /** Melléknévképző: „24-i”, „1-jei”. */
  | 'kepzo'
  /** Ragozott alak: „24-én”, „1-jétől”. */
  | 'eset';

export interface NapToldalek {
  /** A felszíni toldalék a kötőjel után, ahogy az iratban állt: „én”, „jén”, „i”. */
  felszin: string;
  fajta: NapToldalekFajta;
  /** Az eset, ha fajta === 'eset'. */
  eset: CaseTag | null;
  /**
   * Igaz, ha az iratban ott állt a kötőhangzó („24-éig”), hamis, ha nem
   * („24-ig”). Csak a határvető esetnél tartjuk meg a rövid alakot — lásd
   * `napToldalekFelszin`.
   */
  kotohangzo: boolean;
}

/**
 * A toldalék betűsora és az eset összerendelése. Ugyanaz a készlet, mint az
 * osszegek.ts-ben, de itt a KÖTŐHANGZÓ NÉLKÜLI maradékra alkalmazzuk: a
 * „24-én” toldaléka a kötőhangzó levágása után csak „n”.
 */
const TOLDALEK_ESET: Readonly<Record<string, CaseTag>> = {
  n: 'SUP', on: 'SUP', en: 'SUP', ön: 'SUP',
  t: 'ACC', ot: 'ACC', at: 'ACC', et: 'ACC', öt: 'ACC',
  ig: 'TER',
  tól: 'ABL', től: 'ABL',
  ra: 'SUB', re: 'SUB',
  ról: 'DEL', ről: 'DEL',
  ban: 'INE', ben: 'INE',
  ba: 'ILL', be: 'ILL',
  ból: 'ELA', ből: 'ELA',
  nak: 'DAT', nek: 'DAT',
  nál: 'ADE', nél: 'ADE',
  hoz: 'ALL', hez: 'ALL', höz: 'ALL',
  ért: 'CAU',
  ként: 'FOR',
  val: 'INS', vel: 'INS',
};

/** Egy iratbeli naptoldalék értelmezése; null, ha nem naptoldalék. */
export function ertelmezNapToldalek(felszin: string): NapToldalek | null {
  let t = felszin.toLowerCase();
  // Az „1-jén” j-je a kiejtett „elseje” alakot jelöli, nem toldalék.
  if (t.startsWith('j')) t = t.slice(1);

  if (t === 'i' || t === 'ei') {
    return { felszin, fajta: 'kepzo', eset: null, kotohangzo: t === 'ei' };
  }
  if (t === 'a' || t === 'e') {
    return { felszin, fajta: 'alap', eset: null, kotohangzo: true };
  }

  let kotohangzo = false;
  if (t.startsWith('á') || t.startsWith('é')) {
    kotohangzo = true;
    t = t.slice(1);
  }
  const eset = TOLDALEK_ESET[t];
  if (eset === undefined) return null;
  return { felszin, fajta: 'eset', eset, kotohangzo };
}

/**
 * Az ÚJ naphoz tartozó toldalék felszíne, a kötőjellel együtt.
 *
 * A toldalékot nem a régi felszínből másoljuk, hanem a sorszámnévből képezzük
 * újra: „20-án”, de „21-én”, mert a „huszadika” mély, a „huszonegyedike” magas
 * hangrendű. A hangrendet a phonology.ts ismeri fel, az inflect.ts pedig
 * ugyanazokkal a szabályokkal toldalékol, mint a neveket — ezért itt nincs
 * külön naptoldalék-táblázat.
 */
export function napToldalekFelszin(nap: number, t: NapToldalek): string {
  const sorszam = NAP_SORSZAM[nap];
  if (sorszam === undefined || sorszam === '') return '';
  // A sorszámnév szóvégi magánhangzója a kötőhangzó: „huszonnegyedik|e”.
  const to = sorszam.slice(0, -1);
  const j = nap === 1 ? 'j' : '';

  if (t.fajta === 'alap') return `-${j}${sorszam.slice(to.length)}`;
  if (t.fajta === 'kepzo') return nap === 1 ? '-jei' : '-i';

  const teljes = inflectWord(sorszam, t.eset ?? 'SUP');
  const veg = teljes.slice(to.length);
  // „24-ig” a bevett rövid alak a „24-éig” mellett; ha az irat így írta, nem
  // írjuk át a stílusát. A többi esetnél a kötőhangzó nélküli alak hibás
  // volna („24-n”), ezért ott mindig a teljes alakot adjuk vissza.
  if (!t.kotohangzo && t.eset === 'TER' && nap !== 1) return '-ig';
  return `-${j}${veg}`;
}

/**
 * Azok az esetek, amelyeknél az évszám toldaléka biztonságosan képezhető.
 *
 * Ezek mind mássalhangzóval kezdődő toldalékok: a tőhöz változatlanul
 * kapcsolódnak, csak a hangrend választ közülük. A tárgyeset SZÁNDÉKOSAN
 * hiányzik: ott a tő is változik („húsz” → „huszat”, „ezer” → „ezret”), és
 * ezt a toldalék levágásával nem lehet megkapni. Inkább nem ismerünk fel egy
 * „2020-at” alakot, mint hogy „2027-t”-t írjunk a helyére — a hibás magyar
 * alak azonnal elárulja, hogy a szöveget gép írta át.
 */
const EV_BIZTONSAGOS_ESETEK: ReadonlySet<CaseTag> = new Set<CaseTag>([
  'INE', 'ILL', 'ELA', 'SUB', 'DEL', 'ADE', 'ALL', 'ABL', 'TER', 'DAT', 'CAU',
]);

/**
 * Az önálló évhez tapadt toldalék az ÚJ évhez igazítva: „2019-ben”, de
 * „2020-ban”. A hangrendet az év KIEJTETT alakja dönti el
 * („kétezer-tizenkilenc” magas, „kétezer-húsz” mély) — ezért kell hozzá a
 * számnév-generátor. Nem biztonságos esetnél üres sztring jön vissza.
 */
export function evToldalekFelszin(ev: number, eset: CaseTag): string {
  if (!EV_BIZTONSAGOS_ESETEK.has(eset)) return '';
  const betus = szamBetuvel(ev);
  const teljes = inflectWord(betus, eset);
  return teljes.slice(betus.length);
}

/* ================================================================== *
 *  TALÁLAT
 * ================================================================== */

export type DatumKind =
  /** Év + hónap + nap: „2026. június 24.”, „2026.06.24.”, „június 24-én”. */
  | 'teljes_datum'
  /** Év + hónap, nap nélkül: „2025. február”, „2025 februárjában”. */
  | 'honap_ev'
  /** Puszta ragozott nap, a környezetből örökölt hónappal: „…20-tól 24-ig”. */
  | 'nap'
  /** Puszta évszám időhatározóval: „2019 óta”, „2025-ben”. */
  | 'ev';

export const DATUM_NEV: Record<DatumKind, string> = {
  teljes_datum: 'dátum',
  honap_ev: 'hónap és év',
  nap: 'nap a szövegkörnyezetből',
  ev: 'évszám',
};

export type HonapAlak = 'nev' | 'rovid' | 'szam' | 'romai' | 'birtokos' | 'nincs';

/** A felszín darabjai, hogy a csere pontosan ugyanúgy nézzen ki. */
export interface DatumFelszin {
  /** Van-e kiírva év. */
  vanEv: boolean;
  /** Ami az év után, a hónap előtt állt: „. ”, „.”, „-”, „ ”. */
  evUtan: string;
  honapAlak: HonapAlak;
  /** Ami a hónap után, a nap előtt állt. */
  honapUtan: string;
  /** Kétjegyűre töltött-e a számmal írt hónap („06” vs „6”). */
  honapParnazott: boolean;
  napParnazott: boolean;
  /** A nap utáni zárópont: „2026. június 24.” */
  zaroPont: boolean;
  napToldalek: NapToldalek | null;
  /** Birtokos hónapalaknál az eset, amellyel újra kell ragozni. */
  birtokosEset: CaseTag | null;
  /** Önálló évnél a rátapadt toldalék esete („2019-ben” → INE). */
  evEset: CaseTag | null;
  /** Önálló évnél a záró pont („2025. évben”). */
  evZaroPont: boolean;
}

export interface DatumMatch {
  /** Karakterpozíció az ÁTADOTT szövegben. */
  start: number;
  end: number;
  /** A felszíni szöveg pontosan úgy, ahogy a forrásban áll. */
  text: string;
  kind: DatumKind;
  /** 0..1 — a matcher.ts Match.confidence mezőjével azonos skála. */
  confidence: number;
  /** Magyar magyarázat: miért ennyi a megbízhatóság. */
  reason: string;
  /** 'auto' — magától cserélhető; 'review' — emberi döntést vár. */
  disposition: 'auto' | 'review';

  ev: number | null;
  honap: number | null;
  nap: number | null;
  /** Igaz, ha az évet nem az irat írta ki, hanem a környező dátumokból vettük. */
  evOrokolt: boolean;
  alak: DatumFelszin;
}

/* ================================================================== *
 *  MINTÁK
 * ================================================================== */

/** Nincs előtte magyar betű vagy számjegy. Az ASCII \b itt használhatatlan. */
const NB = `(?<![${L}0-9])`;
/** Nincs utána magyar betű. */
const NA = `(?![${L}])`;

const EV = '(19[0-9]{2}|20[0-9]{2})';
const NAP = '(0?[1-9]|[12][0-9]|3[01])';
const HONAP_SZAM = '(0?[1-9]|1[0-2])';
const SZ = '[ \\t\\u00A0]';

/** Hónapnevek és rövidítéseik, a hosszabb alak elöl. */
const HONAP_MINTA = [
  ...HONAP_NEVEK,
  ...HONAP_ROVIDITESEK.flatMap((v) => v.map((r) => `${r}\\.`)),
]
  .sort((a, b) => b.length - a.length)
  .join('|');

/** A római hónapszámok, a hosszabb alak elöl — különben az „I” levágná a „IX”-et. */
const ROMAI_MINTA = [...HONAP_ROMAI].sort((a, b) => b.length - a.length).join('|');

/** A birtokos hónapalakok töve, a szóvégi kötőhangzó nélkül. */
const BIRTOKOS_MINTA = HONAP_BIRTOKOS.map((b) => b.slice(0, -1))
  .sort((a, b) => b.length - a.length)
  .join('|');

/** A nap utáni zárás: pont, vagy kötőjeles toldalék. */
const NAP_ZARAS = `(\\.|-([a-záéíóöőúüű]{1,6}))?`;

/**
 * A jogszabály-hivatkozás kizárása. A „2016. évi CXXX. törvény” évszáma a
 * törvény NEVÉNEK része; eltolva az irat más jogszabályra hivatkozna.
 */
const NEM_EVI = `(?!${SZ}*évi${NA})`;

const RE = {
  /** „2026. június 24.”, „2026. jún. 24-én”, „2026 június 24-i”. */
  teljesNev: new RegExp(
    `${NB}${EV}(\\.?)${NEM_EVI}(${SZ}*)(${HONAP_MINTA})(${SZ}+)${NAP}(?![0-9])${NAP_ZARAS}${NA}`,
    'gi',
  ),

  /** „2026.06.24.”, „2026. 06. 24.”, „2026-06-24”. */
  teljesSzam: new RegExp(
    `${NB}${EV}(\\.${SZ}*|-)${HONAP_SZAM}(\\.${SZ}*|-)${NAP}(?![0-9])(\\.)?${NA}`,
    'g',
  ),

  /** „2026. VI. 24.” — a hónap római számmal. */
  teljesRomai: new RegExp(
    `${NB}${EV}(\\.${SZ}*)(${ROMAI_MINTA})(\\.${SZ}*)${NAP}(?![0-9])${NAP_ZARAS}${NA}`,
    'g',
  ),

  /** „június 24-én”, „március 15-i”, „máj. 6.” — év nélkül. */
  nevNap: new RegExp(`${NB}(${HONAP_MINTA})(${SZ}+)${NAP}(?![0-9])${NAP_ZARAS}${NA}`, 'gi'),

  /** „2025. február” — nap nélkül. */
  evHonap: new RegExp(`${NB}${EV}(\\.?)${NEM_EVI}(${SZ}*)(${HONAP_MINTA})${NA}`, 'gi'),

  /** „2025 februárjában”, „júniusa”, „októberében”. */
  birtokos: new RegExp(`${NB}(?:${EV}(${SZ}+))?(${BIRTOKOS_MINTA})([aáeé][a-záéíóöőúüű]*)${NA}`, 'g'),

  /**
   * Puszta évszám időhatározóval. Kizárólag időre utaló szókörnyezetben
   * fogadjuk el: a négyjegyű szám az iratban irányítószám is lehet („2000
   * Szentendre”), és azt eltolni értelmetlen rongálás volna.
   */
  evOnallo: new RegExp(
    `${NB}${EV}(\\.)?${NEM_EVI}` +
      `(?=${SZ}+(?:óta|nyarán|telén|tavaszán|őszén|folyamán|során|végén|elején|közepén|karácsonyán|évben|évtől|évig)${NA}` +
      `|-(?:ban|ben|tól|től|ig|ra|re|hoz|hez|ból|ből|ról|ről|nál|nél|nak|nek)${NA})` +
      `(?:-([a-záéíóöőúüű]{1,4}))?`,
    'g',
  ),

  /** Puszta ragozott nap: „…20-ától 24-éig”. Csak környezettel érvényes. */
  nap: new RegExp(`${NB}${NAP}-([a-záéíóöőúüű]{1,6})${NA}`, 'g'),
} as const;

/* ================================================================== *
 *  FELISMERÉS
 * ================================================================== */

function honapIndex(felszin: string): { index: number; alak: HonapAlak } | null {
  const s = felszin.toLowerCase().replace(/\.$/, '');
  const nev = HONAP_NEVEK.indexOf(s);
  if (nev >= 0) return { index: nev + 1, alak: 'nev' };
  for (let i = 0; i < HONAP_ROVIDITESEK.length; i++) {
    if (HONAP_ROVIDITESEK[i]!.includes(s)) return { index: i + 1, alak: 'rovid' };
  }
  const romai = HONAP_ROMAI.indexOf(felszin.toUpperCase());
  if (romai >= 0) return { index: romai + 1, alak: 'romai' };
  return null;
}

/** Az irat által használt birtokos alak esete; null, ha nem ismerjük fel. */
function birtokosEset(honap: number, felszin: string): CaseTag | null {
  const alap = HONAP_BIRTOKOS[honap - 1];
  if (alap === undefined) return null;
  const s = felszin.toLowerCase();
  if (s === alap) return 'NOM';
  for (const tag of ALL_CASES) {
    if (tag === 'NOM' || tag === 'WIFE') continue;
    if (inflectWord(alap, tag).toLowerCase() === s) return tag;
  }
  return null;
}

/** Érvényes-e a naptári nap az adott hónapban. */
function ervenyesNap(ev: number, honap: number, nap: number): boolean {
  const utolso = new Date(Date.UTC(ev, honap, 0)).getUTCDate();
  return nap >= 1 && nap <= utolso;
}

const BASE_CONFIDENCE: Record<DatumKind, number> = {
  // Év + hónap + nap: a magyar dátumalak félreérthetetlen.
  teljes_datum: 0.92,
  honap_ev: 0.82,
  // A puszta nap a környezetből örökli a hónapot — ez következtetés, nem
  // felismerés, ezért soha nem megy automatikusan.
  nap: 0.55,
  // Az évszám önmagában a leggyengébb: az irányítószámtól csak a mellette
  // álló időhatározó különbözteti meg.
  ev: 0.5,
};

interface Nyers extends Omit<DatumMatch, 'confidence' | 'disposition' | 'reason' | 'evOrokolt'> {
  evOrokolt?: boolean;
  megjegyzes: string;
}

function ujFelszin(): DatumFelszin {
  return {
    vanEv: false,
    evUtan: '',
    honapAlak: 'nincs',
    honapUtan: '',
    honapParnazott: false,
    napParnazott: false,
    zaroPont: false,
    napToldalek: null,
    birtokosEset: null,
    evEset: null,
    evZaroPont: false,
  };
}

function scan(text: string, re: RegExp, fn: (m: RegExpExecArray) => Nyers | null): Nyers[] {
  const out: Nyers[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    const hit = fn(m);
    if (hit !== null) out.push(hit);
  }
  return out;
}

/** A záró pontot vagy a kötőjeles toldalékot dolgozza fel. */
function napZaras(zaras: string | undefined, toldalek: string | undefined): {
  zaroPont: boolean;
  napToldalek: NapToldalek | null;
  ervenyes: boolean;
} {
  if (toldalek !== undefined) {
    const t = ertelmezNapToldalek(toldalek);
    // Ismeretlen betűsor a kötőjel után: nem naptoldalék, tehát nem dátum
    // („13-09-184627” cégjegyzékszám, „78/B-2” házszám).
    return { zaroPont: false, napToldalek: t, ervenyes: t !== null };
  }
  return { zaroPont: zaras === '.', napToldalek: null, ervenyes: true };
}

function collectRaw(text: string): Nyers[] {
  const hits: Nyers[] = [];

  // 1. Év + hónapnév + nap.
  hits.push(
    ...scan(text, RE.teljesNev, (m) => {
      const evUtan = `${m[2] ?? ''}${m[3] ?? ''}`;
      // Az év és a hónapnév között kell valamilyen elválasztás; enélkül a
      // „2026június” is illeszkedne, ami nem magyar dátumalak.
      if (evUtan === '') return null;
      const h = honapIndex(m[4] ?? '');
      if (h === null) return null;
      const z = napZaras(m[7], m[8]);
      if (!z.ervenyes) return null;
      const ev = Number(m[1]);
      const nap = Number(m[6]);
      const alak = ujFelszin();
      alak.vanEv = true;
      alak.evUtan = evUtan;
      alak.honapAlak = h.alak;
      alak.honapUtan = m[5] ?? ' ';
      alak.napParnazott = (m[6] ?? '').length === 2 && (m[6] ?? '').startsWith('0');
      alak.zaroPont = z.zaroPont;
      alak.napToldalek = z.napToldalek;
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'teljes_datum',
        ev,
        honap: h.index,
        nap,
        alak,
        megjegyzes: ervenyesNap(ev, h.index, nap) ? '' : 'a nap nem létezik ebben a hónapban',
      };
    }),
  );

  // 2. Év + számmal írt hónap + nap.
  hits.push(
    ...scan(text, RE.teljesSzam, (m) => {
      const ev = Number(m[1]);
      const honap = Number(m[3]);
      const nap = Number(m[5]);
      const alak = ujFelszin();
      alak.vanEv = true;
      alak.evUtan = m[2] ?? '.';
      alak.honapAlak = 'szam';
      alak.honapUtan = m[4] ?? '.';
      alak.honapParnazott = (m[3] ?? '').length === 2 && (m[3] ?? '').startsWith('0');
      alak.napParnazott = (m[5] ?? '').length === 2 && (m[5] ?? '').startsWith('0');
      alak.zaroPont = m[6] === '.';
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'teljes_datum',
        ev,
        honap,
        nap,
        alak,
        megjegyzes: ervenyesNap(ev, honap, nap) ? '' : 'a nap nem létezik ebben a hónapban',
      };
    }),
  );

  // 3. Év + római hónap + nap.
  hits.push(
    ...scan(text, RE.teljesRomai, (m) => {
      const h = honapIndex(m[3] ?? '');
      if (h === null) return null;
      const z = napZaras(m[6], m[7]);
      if (!z.ervenyes) return null;
      const ev = Number(m[1]);
      const nap = Number(m[5]);
      const alak = ujFelszin();
      alak.vanEv = true;
      alak.evUtan = m[2] ?? '. ';
      alak.honapAlak = 'romai';
      alak.honapUtan = m[4] ?? '. ';
      alak.napParnazott = (m[5] ?? '').length === 2 && (m[5] ?? '').startsWith('0');
      alak.zaroPont = z.zaroPont;
      alak.napToldalek = z.napToldalek;
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'teljes_datum',
        ev,
        honap: h.index,
        nap,
        alak,
        megjegyzes: ervenyesNap(ev, h.index, nap) ? '' : 'a nap nem létezik ebben a hónapban',
      };
    }),
  );

  // 4. Hónapnév + nap, év nélkül.
  hits.push(
    ...scan(text, RE.nevNap, (m) => {
      const h = honapIndex(m[1] ?? '');
      if (h === null) return null;
      const z = napZaras(m[4], m[5]);
      if (!z.ervenyes) return null;
      const alak = ujFelszin();
      alak.honapAlak = h.alak;
      alak.honapUtan = m[2] ?? ' ';
      alak.napParnazott = (m[3] ?? '').length === 2 && (m[3] ?? '').startsWith('0');
      alak.zaroPont = z.zaroPont;
      alak.napToldalek = z.napToldalek;
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'teljes_datum',
        ev: null,
        honap: h.index,
        nap: Number(m[3]),
        alak,
        megjegyzes: 'az irat nem írta ki az évet',
      };
    }),
  );

  // 5. Év + hónapnév, nap nélkül.
  hits.push(
    ...scan(text, RE.evHonap, (m) => {
      const evUtan = `${m[2] ?? ''}${m[3] ?? ''}`;
      if (evUtan === '') return null;
      const h = honapIndex(m[4] ?? '');
      if (h === null) return null;
      const alak = ujFelszin();
      alak.vanEv = true;
      alak.evUtan = evUtan;
      alak.honapAlak = h.alak;
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'honap_ev',
        ev: Number(m[1]),
        honap: h.index,
        nap: null,
        alak,
        megjegyzes: '',
      };
    }),
  );

  // 6. Birtokos hónapalak: „2025 februárjában”, „júniusa”.
  hits.push(
    ...scan(text, RE.birtokos, (m) => {
      const to = (m[3] ?? '').toLowerCase();
      const idx = HONAP_BIRTOKOS.findIndex((b) => b.slice(0, -1).toLowerCase() === to);
      if (idx < 0) return null;
      const felszin = `${m[3] ?? ''}${m[4] ?? ''}`;
      const eset = birtokosEset(idx + 1, felszin);
      const alak = ujFelszin();
      alak.vanEv = m[1] !== undefined;
      alak.evUtan = m[2] ?? ' ';
      alak.honapAlak = 'birtokos';
      alak.birtokosEset = eset;
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'honap_ev',
        ev: m[1] === undefined ? null : Number(m[1]),
        honap: idx + 1,
        nap: null,
        alak,
        megjegyzes:
          eset === null
            ? `a „${felszin}” toldaléka ismeretlen, az alakot nem tudjuk újraképezni`
            : '',
      };
    }),
  );

  // 7. Önálló évszám időhatározóval.
  hits.push(
    ...scan(text, RE.evOnallo, (m) => {
      const alak = ujFelszin();
      alak.vanEv = true;
      alak.evZaroPont = m[2] === '.';
      if (m[3] !== undefined) {
        const eset = TOLDALEK_ESET[m[3].toLowerCase()];
        // Ismeretlen vagy nem biztonságosan képezhető toldalék: inkább nincs
        // találat, mint rossz magyar alak a kimenetben.
        if (eset === undefined || evToldalekFelszin(2000, eset) === '') return null;
        alak.evEset = eset;
      }
      return {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        kind: 'ev',
        ev: Number(m[1]),
        honap: null,
        nap: null,
        alak,
        megjegyzes: 'csak az évszám ismert, ezért az eltolás egész évre kerekít',
      };
    }),
  );

  return hits;
}

/**
 * Puszta ragozott napok, a környezetből örökölt hónappal.
 *
 * Ezt szándékosan a többi találat UTÁN keressük, mert csak akkor van
 * értelme, ha előtte áll egy dátum, amitől a hónapot örökölheti:
 * „…2025. június 20-ától 24-éig”. Kontextus nélkül a „24-ig” bármi lehet,
 * ezért olyankor nem is találat.
 */
const NAP_KONTEXTUS_TAV = 60;

function napTalalatok(text: string, kesz: readonly Nyers[]): Nyers[] {
  const kontextusok = kesz
    .filter((h) => h.honap !== null)
    .sort((a, b) => a.end - b.end);
  if (kontextusok.length === 0) return [];

  return scan(text, RE.nap, (m) => {
    const start = m.index;
    if (kesz.some((h) => start < h.end && h.start < start + m[0].length)) return null;
    const t = ertelmezNapToldalek(m[2] ?? '');
    if (t === null) return null;
    const nap = Number(m[1]);
    if (nap < 1 || nap > 31) return null;

    let kontextus: Nyers | null = null;
    for (const k of kontextusok) {
      if (k.end <= start && start - k.end <= NAP_KONTEXTUS_TAV) kontextus = k;
    }
    if (kontextus === null) return null;

    const alak = ujFelszin();
    alak.napParnazott = (m[1] ?? '').length === 2 && (m[1] ?? '').startsWith('0');
    alak.napToldalek = t;
    return {
      start,
      end: start + m[0].length,
      text: m[0],
      kind: 'nap',
      ev: kontextus.ev,
      honap: kontextus.honap,
      nap,
      alak,
      megjegyzes: `a hónapot a szövegkörnyezetből („${kontextus.text}”) örökölte`,
    };
  });
}

function indoklas(h: Nyers): string {
  const parts: string[] = [`${DATUM_NEV[h.kind]} mintája illeszkedik`];
  if (h.alak.honapAlak === 'birtokos') parts.push('birtokos hónapalak');
  if (h.alak.napToldalek !== null) parts.push(`ragozott nap: „-${h.alak.napToldalek.felszin}”`);
  if (!h.alak.vanEv && h.kind !== 'nap') parts.push('év nélkül');
  if (h.evOrokolt === true) parts.push(`az évet a szövegkörnyezetből örököltük: ${h.ev ?? '?'}`);
  if (h.megjegyzes) parts.push(h.megjegyzes);
  return parts.join('; ');
}

/**
 * Minden dátum a szövegben, ÁTFEDÉS NÉLKÜL.
 *
 * Az azonositok.ts meghagyja az átfedéseket, mert ott a hívó választ. Itt
 * viszont a találatból közvetlenül szövegcsere lesz, és két átfedő csere
 * egymásra írna. A hosszabb találat nyer: a „2026. június 24.” nem
 * versenytársa a „június 24.” találatnak, hanem tartalmazza.
 */
export function findDatumok(text: string): DatumMatch[] {
  const nyersek = collectRaw(text);
  const feloldott = orokoltEvek(atfedesFeloldas(nyersek));
  const napok = napTalalatok(text, feloldott);
  const osszes = atfedesFeloldas([...feloldott, ...napok]);

  return osszes.map((h) => {
    let confidence = BASE_CONFIDENCE[h.kind];
    if (h.megjegyzes.includes('nem létezik')) confidence -= 0.2;
    if (h.megjegyzes.includes('ismeretlen')) confidence -= 0.2;
    if (h.kind === 'teljes_datum' && !h.alak.vanEv) confidence -= 0.1;
    confidence = Math.max(0, Math.min(1, confidence));
    return {
      start: h.start,
      end: h.end,
      text: h.text,
      kind: h.kind,
      confidence,
      reason: indoklas(h),
      disposition: confidence >= AUTO_REPLACE_THRESHOLD ? 'auto' : 'review',
      ev: h.ev,
      honap: h.honap,
      nap: h.nap,
      evOrokolt: h.evOrokolt === true,
      alak: h.alak,
    };
  });
}

/**
 * Az évet ki nem író dátumok az irat többi dátumából öröklik.
 *
 * A „2025 júniusa és szeptembere között” mondatban a szeptemberhez nem írták
 * ki az évet, mert az előző tagmondatból következik. Ha ilyenkor a MAI évet
 * vennénk, a júniust és a szeptembert két különböző évvel tolnánk el, és az
 * irat elbeszélése szétesne — a törlesztés a kölcsön előtt történne.
 */
function orokoltEvek(hits: Nyers[]): Nyers[] {
  let utolso: number | null = null;
  for (const h of hits) {
    if (h.ev !== null) utolso = h.ev;
    else if (utolso !== null) {
      h.ev = utolso;
      h.evOrokolt = true;
    }
  }
  // Ami az első évszám ELŐTT állt, azt visszafelé haladva pótoljuk.
  utolso = null;
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!;
    if (h.ev !== null && h.evOrokolt !== true) utolso = h.ev;
    else if (h.ev === null && utolso !== null) {
      h.ev = utolso;
      h.evOrokolt = true;
    }
  }
  return hits;
}

function atfedesFeloldas(hits: readonly Nyers[]): Nyers[] {
  const ranked = [...hits].sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.start - b.start;
  });
  const kept: Nyers[] = [];
  for (const h of ranked) {
    if (kept.some((k) => h.start < k.end && k.start < h.end)) continue;
    kept.push(h);
  }
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  return kept;
}

/* ================================================================== *
 *  ELTOLÁS
 * ================================================================== */

const NAP_MS = 86_400_000;

/**
 * Az eltolás tartománya. A 30 napos alsó korlát nem díszítés: egy három napos
 * eltolás nem anonimizál (a születési dátum lényegében felismerhető marad),
 * viszont a határidőket már elrontja — a rosszabbik felét kapnánk mindkettőnek.
 */
const ELTOLAS_MIN = 30;
const ELTOLAS_MAX = 400;

/** Determinisztikus, de kiszámíthatatlan eltolás az ügy titkos kulcsából. */
export function datumEltolas(caseSecret: string): number {
  const digest = createHmac('sha256', caseSecret).update('dátum-eltolás').digest();
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i]!;
  const nagysag = ELTOLAS_MIN + (n % (ELTOLAS_MAX - ELTOLAS_MIN + 1));
  return (digest[6]! & 1) === 0 ? -nagysag : nagysag;
}

export interface EltoltDatum {
  ev: number;
  honap: number;
  nap: number;
}

/** Naptári eltolás UTC-ben, hogy a nyári időszámítás ne csúsztassa el a napot. */
export function tolDatum(ev: number, honap: number, nap: number, eltolas: number): EltoltDatum {
  const d = new Date(Date.UTC(ev, honap - 1, nap) + eltolas * NAP_MS);
  return { ev: d.getUTCFullYear(), honap: d.getUTCMonth() + 1, nap: d.getUTCDate() };
}

/**
 * A nap nélküli dátumokat a hónap KÖZEPÉHEZ horgonyozzuk.
 *
 * Ha a hónap elsejét tolnánk el, a „2025 februárjában” és a „2025. február 20.”
 * két különböző hónapba kerülhetne, és az irat elbeszélése szétesne: a tanú
 * arról vallana, ami egy hónappal a szerződés előtt történt. A 15-i horgony a
 * hónap átlagos napja, ezért a legritkábban csúszik el a többitől.
 */
const HONAP_HORGONY = 15;
/** Ugyanez évre: az év közepe a legkevésbé félrevivő horgony. */
const EV_HORGONY_HONAP = 7;
const EV_HORGONY_NAP = 1;

/* ================================================================== *
 *  CSERE TERVEZÉSE
 * ================================================================== */

export interface DatumCsereOpciok {
  /** Az ügy titkos kulcsa; ugyanaz a kulcs ugyanazt az eltolást adja. */
  caseSecret: string;
  /**
   * KÉZI ELTOLÁS NAPBAN, ha a felhasználó megadta. Hiányában a kulcsból jön.
   *
   * Az időközök így is sértetlenek: minden dátum ugyanannyit mozdul.
   */
  eltolas?: number;
  /** A teljes szöveg — csak a figyelmeztetésekhez (naptári napok keresése). */
  szoveg?: string;
}

export interface Csere {
  start: number;
  end: number;
  szoveg: string;
  indoklas: string;
}

export interface DatumTerv {
  cserek: Csere[];
  /** Az ügyre állandó eltolás napokban. */
  eltolas: number;
  /** Amit a hívónak KI KELL ÍRNIA a felhasználónak. */
  figyelmeztetesek: string[];
}

/** A kezdő nagybetűt megtartjuk (mondat elején álló hónapnév). */
function nagybetuMint(eredeti: string, uj: string): string {
  const elso = eredeti[0];
  if (elso === undefined || elso !== elso.toUpperCase() || elso === elso.toLowerCase()) return uj;
  return uj.charAt(0).toUpperCase() + uj.slice(1);
}

function honapFelszin(honap: number, alak: DatumFelszin): string {
  switch (alak.honapAlak) {
    case 'nev':
      return HONAP_NEVEK[honap - 1] ?? '';
    case 'rovid':
      return `${HONAP_ROVIDITESEK[honap - 1]?.[0] ?? ''}.`;
    case 'szam':
      return alak.honapParnazott ? String(honap).padStart(2, '0') : String(honap);
    case 'romai':
      return HONAP_ROMAI[honap - 1] ?? '';
    case 'birtokos': {
      const alap = HONAP_BIRTOKOS[honap - 1] ?? '';
      if (alak.birtokosEset === null || alak.birtokosEset === 'NOM') return alap;
      return inflectWord(alap, alak.birtokosEset);
    }
    default:
      return '';
  }
}

function napFelszin(nap: number, alak: DatumFelszin): string {
  const szam = alak.napParnazott ? String(nap).padStart(2, '0') : String(nap);
  if (alak.napToldalek !== null) return szam + napToldalekFelszin(nap, alak.napToldalek);
  return alak.zaroPont ? `${szam}.` : szam;
}

/** Egy találat új felszíne az eltolt dátumból. */
export function rendezDatum(m: DatumMatch, uj: EltoltDatum): string | null {
  const a = m.alak;

  if (m.kind === 'ev') {
    const szam = String(uj.ev);
    if (a.evEset !== null) return `${szam}-${evToldalekFelszin(uj.ev, a.evEset)}`;
    return a.evZaroPont ? `${szam}.` : szam;
  }

  if (m.kind === 'nap') {
    return napFelszin(uj.nap, a);
  }

  // A birtokos alakot csak akkor tudjuk újraképezni, ha felismertük az esetét.
  if (a.honapAlak === 'birtokos' && a.birtokosEset === null) return null;

  const reszek: string[] = [];
  if (a.vanEv) reszek.push(String(uj.ev) + a.evUtan);
  reszek.push(nagybetuMint(m.text.trimStart(), honapFelszin(uj.honap, a)));
  if (m.kind === 'teljes_datum') {
    reszek.push(a.honapUtan + napFelszin(uj.nap, a));
  }
  return reszek.join('');
}

/**
 * A cserék megtervezése.
 *
 * A `figyelmeztetesek` mezőt a hívónak KI KELL ÍRNIA. A felület ma is közli a
 * beállításnál, hogy a határidő-számítás elcsúszik — de a motornak is jeleznie
 * kell, mert a beállítást bekapcsoló és a kimenetet átvevő ember nem
 * feltétlenül ugyanaz.
 */
export function tervezDatumCsere(
  matches: readonly DatumMatch[],
  opts: DatumCsereOpciok,
): DatumTerv {
  /*
    AZ ELTOLÁS KÉZZEL IS MEGADHATÓ.

    Alapból az ügyazonosító titokból származik. A kézi érték annak való, aki
    kerek eltolást akar (pontosan egy év, pontosan száz nap) — az időközök
    ettől ugyanúgy sértetlenek maradnak, hiszen minden dátum ugyanannyit
    mozdul.
  */
  const eltolas = opts.eltolas ?? datumEltolas(opts.caseSecret);
  const cserek: Csere[] = [];
  const figyelmeztetesek: string[] = [];
  let evNelkuli = 0;
  let evOrokolt = 0;
  let atnezendo = 0;
  let durvaFelbontas = 0;

  for (const m of matches) {
    if (m.honap === null && m.kind !== 'ev') continue;
    if (m.disposition === 'review') atnezendo++;

    // Év nélküli dátumnál kell egy referenciaév, különben a naptári eltolást
    // nem tudjuk elvégezni. A mai évet vesszük, és jelezzük: az iratban álló
    // hónap–nap párost így is ugyanannyi nappal toljuk el, csak az évforduló
    // körül csúszhat a hónap.
    const ev = m.ev ?? new Date().getUTCFullYear();
    if (m.ev === null) evNelkuli++;
    else if (m.evOrokolt) evOrokolt++;

    let uj: EltoltDatum;
    if (m.kind === 'ev') {
      durvaFelbontas++;
      uj = tolDatum(ev, EV_HORGONY_HONAP, EV_HORGONY_NAP, eltolas);
    } else if (m.nap === null) {
      durvaFelbontas++;
      uj = tolDatum(ev, m.honap ?? 1, HONAP_HORGONY, eltolas);
    } else {
      // Nem létező napot (2025.02.30.) a hónap utolsó napjára húzunk, mert a
      // JS naptára különben csendben átlépne a következő hónapra.
      const utolso = new Date(Date.UTC(ev, m.honap ?? 1, 0)).getUTCDate();
      uj = tolDatum(ev, m.honap ?? 1, Math.min(m.nap, utolso), eltolas);
    }

    const szoveg = rendezDatum(m, uj);
    if (szoveg === null) {
      figyelmeztetesek.push(
        `Nem cseréltük: a „${m.text}” alakot nem tudjuk újraragozni, mert a ` +
          'toldalékát nem ismerjük fel. Ez a dátum BENNE MARAD az iratban — nézd át kézzel.',
      );
      continue;
    }
    // Egy puszta évszám akkor sem változik, ha az eltolás helyes: 2019 nyara
    // plusz 99 nap is 2019. Ez nem hiba, de a felhasználónak tudnia kell, hogy
    // az az adat BENT MARADT az iratban — a születési év magában is azonosít.
    if (m.kind === 'ev' && szoveg === m.text) {
      figyelmeztetesek.push(
        `Nem változott: a „${m.text}” évszám az eltolás után is ugyanaz a naptári év, ` +
          'tehát ez az adat NEM lett anonimizálva.',
      );
    }

    cserek.push({
      start: m.start,
      end: m.end,
      szoveg,
      indoklas: `${m.text} → ${szoveg} (eltolás: ${eltolas > 0 ? '+' : ''}${eltolas} nap)`,
    });
  }

  if (cserek.length > 0) {
    figyelmeztetesek.unshift(
      `A dátumok egységesen ${eltolas > 0 ? '+' : ''}${eltolas} nappal tolódtak el. Az időközök ` +
        'megmaradnak, de A HATÁRIDŐ-SZÁMÍTÁS A VALÓS NAPTÁRHOZ KÉPEST ELCSÚSZIK: az iratban ' +
        'szereplő határnapok nem a valódi naptári napokra esnek, és a munkanap/ünnepnap ' +
        'számítás sem érvényes rájuk.',
    );
  }
  if (eltolas % 7 !== 0 && opts.szoveg !== undefined && tartalmazNapnevet(opts.szoveg)) {
    figyelmeztetesek.push(
      'Az irat a hét napjaira is hivatkozik (pl. „hétfőn”). Az eltolás nem hét ' +
        'többszöröse, ezért ezek a megnevezések már NEM az eltolt dátumok napjaira illenek.',
    );
  }
  if (durvaFelbontas > 0) {
    figyelmeztetesek.push(
      `${durvaFelbontas} dátum csak hónap vagy év pontossággal szerepel az iratban ` +
        '(„2025 februárjában”, „2019 óta”). Ezeket a hónap, illetve az év közepéhez ' +
        'igazítva toljuk el, ezért a NAPRA PONTOS dátumokhoz képest az időköz akár két ' +
        'héttel is elcsúszhat. A napra pontos dátumok egymás közti távolsága sértetlen.',
    );
  }
  if (evOrokolt > 0) {
    figyelmeztetesek.push(
      `${evOrokolt} dátumnál az irat nem írta ki az évet, ezért a környező dátumokból ` +
        'vettük. Ha az irat évfordulón átnyúló időszakról beszél, ezeket nézd át.',
    );
  }
  if (evNelkuli > 0) {
    figyelmeztetesek.push(
      `${evNelkuli} dátumnál sehol az iratban nem szerepelt évszám; ezeknél a mai évet ` +
        'vettük referenciának, így az évforduló környékén a hónap elcsúszhat.',
    );
  }
  if (atnezendo > 0) {
    figyelmeztetesek.push(
      `${atnezendo} dátumtalálat „átnézendő” besorolású (puszta évszám vagy a ` +
        'szövegkörnyezetből örökölt nap). Ezeket ember nézze át csere előtt.',
    );
  }

  cserek.sort((a, b) => a.start - b.start || a.end - b.end);
  return { cserek, eltolas, figyelmeztetesek };
}

function tartalmazNapnevet(text: string): boolean {
  const re = new RegExp(`(?<![${L}])(?:${NAPNEVEK.join('|')})`, 'i');
  return re.test(text);
}

/**
 * A tervezett cserék végrehajtása. Hátulról előre haladunk, hogy a korábbi
 * cserék ne tolják el a későbbiek pozícióit.
 *
 * FIGYELEM: egy szövegre az ÖSSZES cserét EGY hívásban kell átadni — a
 * dátumtervet és az összegtervet egyetlen listába fűzve. Két külön hívás a
 * másodikat már eltolódott pozíciókra alkalmazná, és a hiba csendes: nem
 * kivétel lesz belőle, hanem szétkaszabolt szöveg. A két terv tartományai
 * sosem fedik egymást, ezért az összefűzés mindig biztonságos.
 */
export function alkalmazCserek(text: string, cserek: readonly Csere[]): string {
  const rendezett = [...cserek].sort((a, b) => b.start - a.start);
  let out = text;
  let elozoStart = Number.POSITIVE_INFINITY;
  for (const cs of rendezett) {
    if (cs.end > elozoStart) continue;
    out = out.slice(0, cs.start) + cs.szoveg + out.slice(cs.end);
    elozoStart = cs.start;
  }
  return out;
}

/**
 * Az ai/types.ts ExtractedEntity alakja, hogy a dátumok és a modell találatai
 * egy listában kezelhetők legyenek — ugyanaz a leképezés, mint az
 * azonositok.ts-ben.
 */
export interface DatumEntityShape {
  start: number;
  end: number;
  text: string;
  label: 'other';
  rawLabel: string;
  score: number;
}

export function asEntityShape(m: DatumMatch): DatumEntityShape {
  return {
    start: m.start,
    end: m.end,
    text: m.text,
    label: 'other',
    rawLabel: `DATUM:${m.kind}`,
    score: m.confidence,
  };
}
