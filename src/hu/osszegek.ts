/**
 * Pénzösszegek felismerése és cseréje magyar jogi iratban.
 *
 * MIÉRT LÉTEZIK EZ A MODUL: a beállításokban ott állt a „replaceAmounts”
 * kapcsoló — elmentve, visszaolvasva, magyarázó szöveggel —, a motorban
 * viszont NULLA olvasója volt. A jogász bekapcsolta, a pipa megmaradt, és az
 * irat a valódi összegekkel ment ki. Ez rosszabb, mint ha a kapcsoló nem is
 * létezne: a hamis biztonságérzet miatt a kimenetet át sem nézi senki.
 *
 * A LEGFONTOSABB TERVEZÉSI DÖNTÉS: PÉNZNEM NÉLKÜL NINCS TALÁLAT.
 *
 * Egy jogi irat tele van olyan számokkal, amiket halálos hiba lenne átírni:
 * a „Ptk. 6:383. §”, a „2016. évi CXXX. törvény”, a „12.P.20.845/2026/8.”
 * ügyszám, a „15 napon belül”, a bankszámlaszám nyolcas blokkjai. Ezek közül
 * egyet átírni nem anonimizálás, hanem az irat MEGHAMISÍTÁSA — más törvényre,
 * más ügyszámra hivatkozik. Ezért a puszta szám sosem elég: kell mellé Ft,
 * HUF, forint, EUR vagy más pénznem. Ez a kapu olcsó, és pontosan azt a
 * hibaosztályt zárja ki, amelyik a legdrágább.
 *
 * A CSERE KÉT MÓDJA. A beállítás magyarázó szövege igazat mond: „Az összegek
 * átírása szétveri a végösszegeket, és ezt egy ügyvéd azonnal észreveszi.”
 * Ezért:
 *  - 'aranyos': az ügy titkából képzett, ügyre ÁLLANDÓ szorzó minden összeget
 *    ugyanúgy szoroz. Így az összeadások megmaradnak (ha a+b=c, akkor
 *    ka+kb=kc) — a kerekítés viszont elronthatja őket, ezért a tervezés végén
 *    minden felismert összefüggést VISSZAELLENŐRZÜNK, és amit nem sikerült
 *    megmenteni, azt figyelmeztetésként visszaadjuk. Elhallgatni nem szabad:
 *    egy stimmelőnek látszó, de valójában elrontott végösszeg rosszabb, mint
 *    egy bevallottan elrontott.
 *  - 'cimke': minden összeg helyére „[összeg]” kerül. Egyszerű és őszinte, de
 *    a szám elvész, és az irat számszaki érvelése olvashatatlanná válik.
 *
 * A BETŰS ALAK. Ha az irat kiírja betűvel is — „4 800 000 Ft, azaz
 * négymillió-nyolcszázezer forint” —, akkor a betűs alakot IS át kell írni az
 * ÚJ számra. Enélkül a csere értelmetlen: a betűs alak egy sorral odébb
 * kiírja az eredetit. Ezért van ebben a modulban teljes magyar
 * számnév-generátor ÉS -értelmező.
 */

import { createHmac } from 'node:crypto';

import { HU_LETTER_CLASS } from './phonology.js';
import { type CaseTag, inflectWord } from './inflect.js';
import { AUTO_REPLACE_THRESHOLD } from './identifiers.js';

const L = HU_LETTER_CLASS;

/**
 * Ugyanaz a határ, mint a matcher.ts-ben és az azonositok.ts-ben. Nem másoljuk
 * le a számot: a felhasználó ugyanazon a 0..1 skálán nem kaphatja a
 * találatait két különböző küszöbnél.
 */
export { AUTO_REPLACE_THRESHOLD as AUTO_THRESHOLD } from './identifiers.js';

/* ================================================================== *
 *  MAGYAR SZÁMNÉV — GENERÁLÁS
 * ================================================================== */

const EGYESEK = ['', 'egy', 'kettő', 'három', 'négy', 'öt', 'hat', 'hét', 'nyolc', 'kilenc'] as const;
const TIZESEK = ['', 'tíz', 'húsz', 'harminc', 'negyven', 'ötven', 'hatvan', 'hetven', 'nyolcvan', 'kilencven'] as const;

/**
 * A 11–19 és a 21–29 tövének rendhagyó alakja: „tizenegy”, „huszonegy”. A
 * 30-tól fölfelé nincs ilyen: „harmincegy”, „negyvenkettő”.
 */
const TIZEN_ELOTAG: Readonly<Record<number, string>> = { 1: 'tizen', 2: 'huszon' };

/** Hármas csoportok szorzói, a legnagyobbtól lefelé. */
const CSOPORT_SZORZOK: readonly { ertek: number; nev: string }[] = [
  { ertek: 1e12, nev: 'billió' },
  { ertek: 1e9, nev: 'milliárd' },
  { ertek: 1e6, nev: 'millió' },
  { ertek: 1e3, nev: 'ezer' },
];

/**
 * A „kettő” a szorzó előtt „két”: kétezer, kétmillió, tizenkétezer. Önállóan
 * viszont „kettő” marad: 2 = kettő, 22 = huszonkettő.
 */
function kettoBolKet(s: string): string {
  return s.endsWith('kettő') ? `${s.slice(0, -'kettő'.length)}két` : s;
}

/** Egy hármas csoport (1..999) betűs alakja, szorzó nélkül. */
function haromjegyu(n: number): string {
  if (n <= 0) return '';
  const szazas = Math.floor(n / 100);
  const tizes = Math.floor((n % 100) / 10);
  const egyes = n % 10;

  let out = '';
  // A százas helyiértéken az 1 elmarad („száz”, nem „egyszáz”), a 2 pedig
  // „két” („kétszáz”, nem „kettőszáz”).
  if (szazas === 1) out += 'száz';
  else if (szazas >= 2) out += `${kettoBolKet(EGYESEK[szazas]!)}száz`;

  if (tizes === 0) out += EGYESEK[egyes]!;
  else if (egyes === 0) out += TIZESEK[tizes]!;
  else out += (TIZEN_ELOTAG[tizes] ?? TIZESEK[tizes]!) + EGYESEK[egyes]!;

  return out;
}

/**
 * Szám → magyar betűs alak.
 *
 * A tagolás az AkH. 289. szerint: kétezer FÖLÖTT a hármas számcsoportok
 * határán kötőjel áll, ha a szám összetett — „kétezer-tizenkilenc”,
 * „egymillió-kétszázötvenezer”. Kétezerig egybeírjuk:
 * „ezerkilencszázkilencvenkilenc”.
 */
export function szamBetuvel(n: number): string {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error('A betűs alak csak egész számra képezhető.');
  }
  if (n < 0) return `mínusz ${szamBetuvel(-n)}`;
  if (n === 0) return 'nulla';

  const reszek: string[] = [];
  let maradek = n;

  for (const { ertek, nev } of CSOPORT_SZORZOK) {
    const csoport = Math.floor(maradek / ertek);
    if (csoport === 0) continue;
    maradek -= csoport * ertek;
    // Az „ezer” egyedül áll, előtte nincs „egy”: 1000 = ezer, nem egyezer.
    // A nagyobb szorzóknál viszont kell: 1 000 000 = egymillió.
    const elotag = csoport === 1 && nev === 'ezer' ? '' : kettoBolKet(haromjegyu(csoport));
    reszek.push(elotag + nev);
  }
  if (maradek > 0) reszek.push(haromjegyu(maradek));

  return n > 2000 ? reszek.join('-') : reszek.join('');
}

/* ================================================================== *
 *  MAGYAR SZÁMNÉV — ÉRTELMEZÉS
 * ================================================================== */

/**
 * A számnév-atomok, HOSSZ SZERINT CSÖKKENŐ sorrendben. A sorrend nem
 * kényelmi kérdés: az „ötvenezer” elején az „öt” is illeszkedne, és akkor a
 * maradék „venezer” értelmezhetetlen lenne. A leghosszabb illeszkedés nyer.
 */
interface SzamnevAtom {
  szo: string;
  ertek: number;
}

const SZAMNEV_ATOMOK: readonly SzamnevAtom[] = (
  [
    { szo: 'billió', ertek: 1e12 },
    { szo: 'milliárd', ertek: 1e9 },
    { szo: 'millió', ertek: 1e6 },
    { szo: 'ezer', ertek: 1e3 },
    { szo: 'száz', ertek: 100 },
    { szo: 'kilencven', ertek: 90 },
    { szo: 'nyolcvan', ertek: 80 },
    { szo: 'hetven', ertek: 70 },
    { szo: 'hatvan', ertek: 60 },
    { szo: 'ötven', ertek: 50 },
    { szo: 'negyven', ertek: 40 },
    { szo: 'harminc', ertek: 30 },
    { szo: 'huszon', ertek: 20 },
    { szo: 'húsz', ertek: 20 },
    { szo: 'tizen', ertek: 10 },
    { szo: 'tíz', ertek: 10 },
    { szo: 'kilenc', ertek: 9 },
    { szo: 'nyolc', ertek: 8 },
    { szo: 'hét', ertek: 7 },
    { szo: 'hat', ertek: 6 },
    { szo: 'öt', ertek: 5 },
    { szo: 'négy', ertek: 4 },
    { szo: 'három', ertek: 3 },
    { szo: 'kettő', ertek: 2 },
    { szo: 'két', ertek: 2 },
    { szo: 'egy', ertek: 1 },
    { szo: 'nulla', ertek: 0 },
  ] satisfies SzamnevAtom[]
).sort((a, b) => b.szo.length - a.szo.length);

/**
 * Egy magyar számnév beolvasása a szöveg adott pontjától, addig, amíg az
 * összeolvasott érték PONTOSAN a keresett szám lesz.
 *
 * Miért a célértékhez kötjük? Mert a „hét” egyszerre számnév és a hét mint
 * időszak, a „száz” pedig lehet egy hosszabb szó eleje. Ha vakon olvasnánk,
 * a „…négymillió-nyolcszázezer forint hét napon belül” szövegből 4 800 007-et
 * kapnánk. Így viszont a betűs alak CSAK akkor találat, ha a mellette álló
 * számjegyes összeggel egyezik — a szám maga az ellenőrzőösszeg.
 *
 * A visszaadott érték a betűs alak VÉGÉNEK indexe, vagy null, ha nincs ilyen.
 */
export function olvasSzamnev(text: string, from: number, cel: number): number | null {
  if (!Number.isInteger(cel) || cel < 0) return null;

  const also = text.toLowerCase();
  let pos = from;
  let total = 0;
  let current = 0;
  let legjobb: number | null = null;

  for (;;) {
    const talalt = SZAMNEV_ATOMOK.find((atom) => also.startsWith(atom.szo, pos));
    if (talalt === undefined) break;

    if (talalt.ertek >= 1000) {
      // Szorzó: lezárja az addig gyűlt csoportot. Az „ezer” előtt állhat üres
      // csoport is („ezeregy”), ilyenkor a szorzó maga az érték.
      total += (current === 0 ? 1 : current) * talalt.ertek;
      current = 0;
    } else if (talalt.ertek === 100) {
      current = (current === 0 ? 1 : current) * 100;
    } else {
      current += talalt.ertek;
    }

    pos += talalt.szo.length;
    if (total + current === cel) legjobb = pos;

    // A csoportok között kötőjel vagy szóköz állhat („egymillió-kétszázezer”),
    // de csak akkor lépünk át rajta, ha utána tényleg számnév következik.
    const kov = also[pos];
    if (kov === '-' || kov === ' ' || kov === '\u00A0') {
      const utana = pos + 1;
      if (SZAMNEV_ATOMOK.some((a) => also.startsWith(a.szo, utana))) pos = utana;
    }
  }

  // Ne álljunk meg szó közepén: a „hatvan” nem lehet a „hatvanas” eleje.
  if (legjobb !== null) {
    const utolso = text[legjobb];
    if (utolso !== undefined && new RegExp(`[${L}]`).test(utolso)) return null;
  }
  return legjobb;
}

/* ================================================================== *
 *  FELISMERÉS
 * ================================================================== */

export type Penznem = 'HUF' | 'EUR' | 'USD' | 'CHF' | 'GBP';

export type OsszegKind =
  /** Csak számjegyes alak: „1 250 000 Ft”. */
  | 'osszeg'
  /** Az irat betűvel is kiírja: „4 800 000 Ft, azaz négymillió-nyolcszázezer forint”. */
  | 'osszeg_betuvel';

/** Megjelenítendő magyar név a szereplapon. */
export const OSSZEG_NEV: Record<OsszegKind, string> = {
  osszeg: 'pénzösszeg',
  osszeg_betuvel: 'pénzösszeg betűvel is kiírva',
};

/** A szám írásmódja, hogy a csere ugyanúgy nézzen ki, mint az eredeti. */
export interface SzamAlak {
  /** A hármas csoportok elválasztója, vagy null, ha tagolatlan a szám. */
  elvalaszto: string | null;
  /** Hány tizedesjegy állt az iratban. */
  tizedesek: number;
  /** Igaz, ha a szám után „,-” állt („1.250.000,- Ft”). */
  vesszoKotojel: boolean;
}

export interface Tartomany {
  start: number;
  end: number;
  text: string;
}

export interface OsszegMatch {
  /** Karakterpozíció az ÁTADOTT szövegben. */
  start: number;
  end: number;
  /** A felszíni szöveg pontosan úgy, ahogy a forrásban áll. */
  text: string;
  kind: OsszegKind;
  /** 0..1 — a matcher.ts Match.confidence mezőjével azonos skála. */
  confidence: number;
  /** Magyar magyarázat: miért ennyi a megbízhatóság. */
  reason: string;
  /** 'auto' — magától cserélhető; 'review' — emberi döntést vár. */
  disposition: 'auto' | 'review';

  /** Az összeg értéke a felismert pénznemben. */
  ertek: number;
  penznem: Penznem;
  /** A számjegyes rész tartománya — arányos módban CSAK ezt írjuk át. */
  szam: Tartomany;
  alak: SzamAlak;
  /** A betűvel kiírt alak tartománya, ha az irat kiírta. */
  betuvel: Tartomany | null;
  /** A pénznem felszíne („Ft”, „forint”, „EUR”). */
  penznemFelszin: string;
  /** A pénznemre tapadt magyar toldalék: „Ft-ot” → „ot”, „forintot” → „ot”. */
  penznemToldalek: string | null;
}

/**
 * Számjegyes összeg. A tagolt alakok állnak elöl, különben a tagolatlan ág
 * levágná az „1 250 000” elejét. A vezető negatív előretekintés azt zárja ki,
 * hogy egy hosszabb szám közepén kezdjünk („1.250.000” → „250”).
 */
const SZAM_RE = new RegExp(
  '(?<![0-9.,\\-])(' +
    '[0-9]{1,3}(?:[ \\u00A0\\u202F][0-9]{3})+' +
    '|[0-9]{1,3}(?:\\.[0-9]{3})+' +
    '|[0-9]+' +
    ')(,[0-9]{1,2}|,-)?',
  'g',
);

/**
 * Pénznem a szám után. A rövidítés kötőjellel toldalékolódik („Ft-ot”), a
 * teljes szó közvetlenül („forintot”) — ezért két ág. A záró negatív
 * előretekintés magyar betűosztályt használ: az ASCII \b az ékezeteken
 * csendben elromlana, és ez a projektben már okozott valódi szivárgást.
 */
const PENZNEM_RE = new RegExp(
  '(?:(Ft|FT|HUF|EURO|EUR|USD|CHF|GBP)(?:-([a-záéíóöőúüű]{1,5}))?' +
    `|(forint|euró|euro|dollár|frank)([a-záéíóöőúüű]{0,6}))(?![${L}0-9])`,
  'y',
);

/** A pénznem-felszínek leképezése kódra. */
const PENZNEM_KOD: Readonly<Record<string, Penznem>> = {
  ft: 'HUF',
  huf: 'HUF',
  forint: 'HUF',
  eur: 'EUR',
  euro: 'EUR',
  euró: 'EUR',
  usd: 'USD',
  dollár: 'USD',
  chf: 'CHF',
  frank: 'CHF',
  gbp: 'GBP',
};

/** „, azaz”, „(azaz”, „azaz:” — a betűs alakot bevezető fordulatok. */
const AZAZ_RE = /[ \u00A0\t]*[,;]?[ \u00A0\t]*\(?[ \u00A0\t]*(?:azaz|szóval|betűvel|betűkkel)[ \u00A0\t]*:?[ \u00A0\t]+/y;

function ugorjSzokoz(text: string, i: number): number {
  let p = i;
  while (p < text.length && (text[p] === ' ' || text[p] === '\u00A0' || text[p] === '\t')) p++;
  return p;
}

interface PenznemTalalat {
  end: number;
  felszin: string;
  toldalek: string | null;
  kod: Penznem;
}

function penznemAt(text: string, i: number): PenznemTalalat | null {
  PENZNEM_RE.lastIndex = i;
  const m = PENZNEM_RE.exec(text);
  if (m === null) return null;
  const felszin = m[1] ?? m[3] ?? '';
  const toldalek = m[2] ?? (m[4] !== undefined && m[4] !== '' ? m[4] : null);
  const kod = PENZNEM_KOD[felszin.toLowerCase()];
  if (kod === undefined) return null;
  return { end: i + m[0].length, felszin, toldalek, kod };
}

/** A számjegyes felszínből érték és írásmód. */
function olvasSzam(egesz: string, farok: string | undefined): { ertek: number; alak: SzamAlak } {
  let elvalaszto: string | null = null;
  if (/[ \u00A0\u202F]/.test(egesz)) elvalaszto = egesz.replace(/[^ \u00A0\u202F]/g, '')[0] ?? ' ';
  else if (egesz.includes('.')) elvalaszto = '.';

  const jegyek = egesz.replace(/[^0-9]/g, '');
  let ertek = Number(jegyek);
  let tizedesek = 0;
  let vesszoKotojel = false;

  if (farok === ',-') {
    vesszoKotojel = true;
  } else if (farok !== undefined && farok.length > 1) {
    const tort = farok.slice(1);
    tizedesek = tort.length;
    ertek += Number(tort) / 10 ** tizedesek;
  }
  return { ertek, alak: { elvalaszto, tizedesek, vesszoKotojel } };
}

const BASE_CONFIDENCE: Record<OsszegKind, number> = {
  // A pénznem melletti tagolt szám önmagában is félreérthetetlen.
  osszeg: 0.85,
  // A betűs alak a saját ellenőrzőösszege: ha a betűvel kiírt érték egyezik a
  // számjegyessel, gyakorlatilag kizárt a téves illeszkedés.
  osszeg_betuvel: 0.97,
};

/** Tagolatlan, rövid szám: „1250000 forint” jó, de „5 Ft” inkább példa, mint összeg. */
const TAGOLATLAN_LEVONAS = 0.08;

/**
 * Minden pénzösszeg a szövegben, ÁTFEDÉS NÉLKÜL.
 *
 * Az azonositok.ts szándékosan meghagyja az átfedéseket, mert ott a hívónak
 * kell választania irányítószám és teljes cím között. Itt viszont a találatból
 * közvetlenül SZÖVEGCSERE lesz: két átfedő csere egymásra írna, és a kimenet
 * értelmezhetetlen lenne. Ezért itt a modul dönt, és a leghosszabbat tartja meg.
 */
export function findOsszegek(text: string): OsszegMatch[] {
  const out: OsszegMatch[] = [];
  SZAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = SZAM_RE.exec(text)) !== null) {
    if (m.index === SZAM_RE.lastIndex) SZAM_RE.lastIndex++;

    const egesz = m[1];
    if (egesz === undefined) continue;
    const szamStart = m.index;
    const szamEnd = m.index + m[0].length;
    const { ertek, alak } = olvasSzam(egesz, m[2]);
    if (!Number.isFinite(ertek)) continue;

    let i = ugorjSzokoz(text, szamEnd);
    let betuvel: Tartomany | null = null;

    // 1. Zárójeles betűs alak a szám és a pénznem KÖZÖTT:
    //    „1 250 000 (egymillió-kétszázötvenezer) forint”.
    if (text[i] === '(' && Number.isInteger(ertek)) {
      const szoKezdet = ugorjSzokoz(text, i + 1);
      const szoVeg = olvasSzamnev(text, szoKezdet, ertek);
      if (szoVeg !== null) {
        const zaro = ugorjSzokoz(text, szoVeg);
        if (text[zaro] === ')') {
          betuvel = { start: szoKezdet, end: szoVeg, text: text.slice(szoKezdet, szoVeg) };
          i = ugorjSzokoz(text, zaro + 1);
        }
      }
    }

    // 2. A pénznem KÖTELEZŐ. Enélkül a „6:383. §”, a „2016. évi” és a
    //    bankszámlaszám blokkjai is összegnek látszanának.
    const pm = penznemAt(text, i);
    if (pm === null) continue;
    let end = pm.end;

    // 3. „…, azaz négymillió-nyolcszázezer forint” — a betűs alak a pénznem UTÁN.
    if (betuvel === null && Number.isInteger(ertek)) {
      AZAZ_RE.lastIndex = end;
      const azaz = AZAZ_RE.exec(text);
      if (azaz !== null) {
        const szoKezdet = end + azaz[0].length;
        const szoVeg = olvasSzamnev(text, szoKezdet, ertek);
        if (szoVeg !== null) {
          betuvel = { start: szoKezdet, end: szoVeg, text: text.slice(szoKezdet, szoVeg) };
          end = szoVeg;
          // A betűs alak után álló pénznem és a záró zárójel még a találathoz
          // tartozik: „azaz négymillió-nyolcszázezer forint)”.
          const utanaPenznem = penznemAt(text, ugorjSzokoz(text, szoVeg));
          if (utanaPenznem !== null) end = utanaPenznem.end;
          const zaro = ugorjSzokoz(text, end);
          if (text[zaro] === ')' && text.slice(szamEnd, szoKezdet).includes('(')) end = zaro + 1;
        }
      }
    }

    const kind: OsszegKind = betuvel === null ? 'osszeg' : 'osszeg_betuvel';
    const tagolatlan = alak.elvalaszto === null && ertek >= 10000;
    const confidence = Math.max(
      0,
      Math.min(1, BASE_CONFIDENCE[kind] - (tagolatlan ? TAGOLATLAN_LEVONAS : 0)),
    );

    out.push({
      start: szamStart,
      end,
      text: text.slice(szamStart, end),
      kind,
      confidence,
      reason: indoklas(kind, pm.felszin, alak, betuvel),
      disposition: confidence >= AUTO_REPLACE_THRESHOLD ? 'auto' : 'review',
      ertek,
      penznem: pm.kod,
      szam: { start: szamStart, end: szamEnd, text: text.slice(szamStart, szamEnd) },
      alak,
      betuvel,
      penznemFelszin: pm.felszin,
      penznemToldalek: pm.toldalek,
    });
  }

  return atfedesFeloldas(out);
}

function indoklas(kind: OsszegKind, penznem: string, alak: SzamAlak, betuvel: Tartomany | null): string {
  const parts: string[] = [`${OSSZEG_NEV[kind]} „${penznem}” pénznemmel`];
  if (alak.elvalaszto !== null) parts.push('a szám hármas csoportokra tagolt');
  else parts.push('a szám tagolatlan');
  if (alak.vesszoKotojel) parts.push('„,-” jelöléssel');
  if (betuvel !== null) parts.push(`betűvel is kiírva: „${betuvel.text}” — az érték egyezik`);
  return parts.join('; ');
}

/** Átfedések: a hosszabb találat nyer, azonos hosszon a magasabb megbízhatóságú. */
function atfedesFeloldas(matches: readonly OsszegMatch[]): OsszegMatch[] {
  const ranked = [...matches].sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.start - b.start;
  });
  const kept: OsszegMatch[] = [];
  for (const m of ranked) {
    if (kept.some((k) => m.start < k.end && k.start < m.end)) continue;
    kept.push(m);
  }
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  return kept;
}

/* ================================================================== *
 *  SZÁMFORMÁZÁS
 * ================================================================== */

function csoportosit(jegyek: string, elvalaszto: string): string {
  let out = '';
  for (let i = 0; i < jegyek.length; i++) {
    if (i > 0 && (jegyek.length - i) % 3 === 0) out += elvalaszto;
    out += jegyek[i]!;
  }
  return out;
}

/** Egy értéket ugyanabba az írásmódba önt, amelyben az eredeti állt. */
export function formazSzam(ertek: number, alak: SzamAlak): string {
  const elojel = ertek < 0 ? '-' : '';
  const abs = Math.abs(ertek);
  const rogzitett = abs.toFixed(alak.tizedesek);
  const pont = rogzitett.indexOf('.');
  const egesz = pont === -1 ? rogzitett : rogzitett.slice(0, pont);
  const tort = pont === -1 ? '' : rogzitett.slice(pont + 1);

  let out = alak.elvalaszto === null ? egesz : csoportosit(egesz, alak.elvalaszto);
  if (tort !== '') out += `,${tort}`;
  else if (alak.vesszoKotojel) out += ',-';
  return elojel + out;
}

/* ================================================================== *
 *  CSERE TERVEZÉSE
 * ================================================================== */

export type OsszegMod = 'aranyos' | 'cimke';

export interface OsszegCsereOpciok {
  /** Az ügy titkos kulcsa; ugyanaz a kulcs ugyanazt a szorzót adja. */
  caseSecret: string;
  mod: OsszegMod;
  /**
   * Az ügy TÖBBI iratában szereplő összegek, ha van ilyen.
   *
   * MIÉRT KELL: a szorzó az ügy titkából jön, tehát iratról iratra ugyanaz —
   * a kerekítési rács viszont abból áll össze, hogy MELY összegek adódnak
   * össze EBBEN az iratban. Ha a kölcsönszerződésben a 4 800 000 két tag
   * összege, az ítéletben pedig három másiké, a két irat ugyanarra az összegre
   * két különböző új értéket adhat — és az ügyvéd, aki egymás mellé teszi a
   * két iratot, ezt azonnal látja.
   *
   * Ezért aki egy ügy több iratát anonimizálja, adja át ITT az összes többi
   * irat összegeit: akkor a rács az EGÉSZ ügyre közös lesz, és ugyanaz az
   * összeg minden iratban ugyanarra cserélődik.
   */
  tovabbiErtekek?: readonly { penznem: Penznem; ertek: number; tizedesek?: number }[];
}

export interface Csere {
  start: number;
  end: number;
  szoveg: string;
  /** Magyar magyarázat a naplóhoz és a szereplaphoz. */
  indoklas: string;
}

export interface OsszefuggesJelentes {
  penznem: Penznem;
  a: number;
  b: number;
  c: number;
  ujA: number;
  ujB: number;
  ujC: number;
  /** Igaz, ha az összefüggés a csere UTÁN is fennáll. */
  megmaradt: boolean;
  /** Igaz, ha a végösszeget a kerekítés után igazítani kellett. */
  javitva: boolean;
}

export interface OsszegTerv {
  cserek: Csere[];
  /** Az ügyre állandó szorzó; 'cimke' módban null. */
  szorzo: number | null;
  /** Minden felismert a+b=c összefüggés és a sorsa. */
  osszefuggesek: OsszefuggesJelentes[];
  /** Amit a hívónak KI KELL ÍRNIA a felhasználónak. Sosem elhallgatandó. */
  figyelmeztetesek: string[];
}

/** A címkés mód alapszava; a toldalékot ehhez ragasztjuk. */
const CIMKE_SZO = 'összeg';

/**
 * A szorzó tartománya. Szűkebb sáv értelmetlen (nem anonimizál), tágabb sáv
 * feltűnő: egy 400 forintos vagy egy 40 milliós kölcsön más ügy, és az irat
 * többi része (kamat, illeték, „nagy összegű beruházás”) elárulná a hamisítást.
 */
const SZORZO_MIN = 0.8;
const SZORZO_MAX = 1.25;
/**
 * Az 1 körüli sávot kihagyjuk: egy 1,004-es szorzó a kerekítés után
 * VÁLTOZATLANUL hagyná az összegeket, és a felhasználó azt hinné, cserélt.
 */
const SZORZO_HOLTSAV_ALSO = 0.97;
const SZORZO_HOLTSAV_FELSO = 1.03;

/** Determinisztikus, de kiszámíthatatlan szorzó az ügy titkos kulcsából. */
export function osszegSzorzo(caseSecret: string): number {
  const digest = createHmac('sha256', caseSecret).update('összeg-szorzó').digest();
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i]!;
  const also = SZORZO_HOLTSAV_ALSO - SZORZO_MIN;
  const felso = SZORZO_MAX - SZORZO_HOLTSAV_FELSO;
  const t = (n % 1_000_000) / 1_000_000;
  const hasznos = t * (also + felso);
  const nyers = hasznos < also ? SZORZO_MIN + hasznos : SZORZO_HOLTSAV_FELSO + (hasznos - also);
  return Math.round(nyers * 10000) / 10000;
}

/**
 * Az eredeti nagyságrendjéhez igazodó kerekítési lépés.
 *
 * Nem a szám nagyságából, hanem a KEREKSÉGÉBŐL indulunk ki: a „4 800 000” öt
 * nullára végződik, tehát az irat kerek összegben gondolkodik, és a csere is
 * kerek maradjon. A „619.400” viszont csak két nullára — ott a százas lépés a
 * helyes. Ha a lépés a szám nagyságából jönne, a kerek összegekből
 * „4 830 000”-féle álpontos szám lenne, ami épp olyan feltűnő, mint a valódi.
 *
 * Legalább két értékes jegyet mindig meghagyunk, különben a 3 000 000-ból
 * 3 000 000 vagy 4 000 000 lenne, és az összeadások menthetetlenül elromlanának.
 */
export function kerekitesiLepes(eredeti: number, tizedesek: number): number {
  if (tizedesek > 0) return 10 ** -tizedesek;
  const abs = Math.abs(Math.round(eredeti));
  if (abs === 0) return 1;
  const jegyek = String(abs).length;
  let nullak = 0;
  let n = abs;
  while (n % 10 === 0) {
    nullak++;
    n /= 10;
  }
  return 10 ** Math.min(nullak, Math.max(0, jegyek - 2));
}

function kerekit(ertek: number, lepes: number): number {
  const out = Math.round(ertek / lepes) * lepes;
  // A lebegőpontos szorzás után „4799999.999999” is kijöhet; a tizedesekre
  // kerekítés visszateszi a számot arra a rácsra, ahol a hívó várja.
  return Number(out.toFixed(6));
}

/** Egy pénznem összes eltérő értéke, kulcsolva. */
function kulcs(penznem: Penznem, ertek: number): string {
  return `${penznem}:${ertek}`;
}

/**
 * a+b=c alakú összefüggések keresése egy pénznem értékei között.
 *
 * Csak azonos pénznemen belül van értelme: 3 000 000 Ft + 1 800 000 Ft =
 * 4 800 000 Ft valódi összefüggés, forint és euró összeadása nem az.
 */
function keresOsszefuggesek(ertekek: readonly number[]): { a: number; b: number; c: number }[] {
  const out: { a: number; b: number; c: number }[] = [];
  // A négyzetes keresés kis készleten olcsó; egy irat néhány tucat összeget
  // tartalmaz. A felső korlát csak a kórosan hosszú kimutatások ellen véd.
  if (ertekek.length > 200) return out;
  const halmaz = new Set(ertekek);
  for (let i = 0; i < ertekek.length; i++) {
    for (let j = i; j < ertekek.length; j++) {
      const a = ertekek[i]!;
      const b = ertekek[j]!;
      if (a <= 0 || b <= 0) continue;
      const c = Number((a + b).toFixed(6));
      if (c === a || c === b) continue;
      if (halmaz.has(c)) out.push({ a, b, c });
    }
  }
  return out;
}

/**
 * Az egymással összefüggő összegek KÖZÖS kerekítési rácsra kerülnek.
 *
 * Ez a modul legfontosabb számtani döntése, és drágán tanultuk meg. Ha minden
 * összeget a SAJÁT kerekségéhez igazítunk, akkor a kerekebb tagok durvább
 * rácsra ugranak, mint a finomabbak, és az összeadás elromlik: a 3 000 000
 * (százezres rács) és az 1 800 000 (százezres rács) összege nem ugyanoda esik,
 * mint az 1 250 000 és a 3 550 000 (tízezres rács) összege — pedig az iratban
 * mindkét pár ugyanazt a 4 800 000-t adja ki.
 *
 * A megoldás: egy összefüggés-csoporton belül MINDENKI a csoport LEGFINOMABB
 * rácsán kerekedik. Ez nem önkényes: az irat maga használja ezt a pontosságot
 * abban a csoportban, tehát a kimenet sem lesz tőle hihetetlen. Cserébe az
 * összeadások túlélik a kerekítést — azaz pontosan az, amiért az arányos mód
 * egyáltalán létezik.
 */
function kozosRacs(
  osszefuggesek: readonly { penznem: Penznem; a: number; b: number; c: number }[],
  lepesek: Map<string, number>,
): Map<string, string[]> {
  const szulo = new Map<string, string>();
  const gyoker = (k: string): string => {
    let x = k;
    for (;;) {
      const p = szulo.get(x);
      if (p === undefined || p === x) return x;
      x = p;
    }
  };
  const egyesit = (a: string, b: string): void => {
    if (!szulo.has(a)) szulo.set(a, a);
    if (!szulo.has(b)) szulo.set(b, b);
    const ga = gyoker(a);
    const gb = gyoker(b);
    if (ga !== gb) szulo.set(gb, ga);
  };

  for (const o of osszefuggesek) {
    const ka = kulcs(o.penznem, o.a);
    egyesit(ka, kulcs(o.penznem, o.b));
    egyesit(ka, kulcs(o.penznem, o.c));
  }

  const csoportLepes = new Map<string, number>();
  for (const k of szulo.keys()) {
    const g = gyoker(k);
    csoportLepes.set(g, Math.min(csoportLepes.get(g) ?? Number.POSITIVE_INFINITY, lepesek.get(k) ?? 1));
  }
  const csoportok = new Map<string, string[]>();
  for (const k of szulo.keys()) {
    const g = gyoker(k);
    const lepes = csoportLepes.get(g);
    if (lepes !== undefined) lepesek.set(k, lepes);
    csoportok.set(g, [...(csoportok.get(g) ?? []), k]);
  }
  return csoportok;
}

/** Ekkora csoportig keresünk pontos megoldást; fölötte a kerekítés dönt. */
const MAX_CSOPORT = 9;
/** Ennyi rácslépéssel térhetünk el a pontos szorzattól a megoldás kedvéért. */
const MAX_LEPES_ELTERES = 2;

interface Relacio {
  a: string;
  b: string;
  c: string;
}

/**
 * A csoport összes összefüggését EGYSZERRE kielégítő értékek keresése.
 *
 * A közös rács önmagában nem elég, és ezt a mintairat mutatta meg: az
 * 1 250 000 + 3 550 000 és az 1 800 000 + 3 000 000 UGYANAZT a 4 800 000-t
 * adja ki, tehát a négy tag nem független — a szorzataik kerekítési hibája
 * nem tud egyszerre kioltódni mindkét összeadásban. Ha tagonként külön
 * kerekítünk, az egyik összeadás menthetetlenül elromlik.
 *
 * Ezért nem kerekítünk, hanem KERESÜNK: minden tagnak a pontos szorzat körüli
 * néhány rácspont a jelöltje, és visszalépéses kereséssel olyan együttállást
 * választunk, amelyben MINDEN összeadás stimmel. A jelöltek a pontos
 * szorzathoz való közelség szerint sorrendben állnak, így az első megtalált
 * megoldás egyben a legkevésbé torzító is.
 *
 * Két korlát véd a robbanástól: a csoportméret és a rácslépés-eltérés. Ha
 * ezeken belül nincs megoldás, null jön vissza — olyankor a hívó a sima
 * kerekítésnél marad, és FIGYELMEZTET a maradék hibáról. Csendben elrontott
 * végösszeg nem születhet.
 */
function csoportMegoldas(
  tagok: readonly string[],
  celok: ReadonlyMap<string, number>,
  lepesek: ReadonlyMap<string, number>,
  relaciok: readonly Relacio[],
): Map<string, number> | null {
  if (tagok.length === 0 || tagok.length > MAX_CSOPORT) return null;

  // Növekvő sorrend: a végösszegek hátrébb kerülnek, így a keresés hamarabb
  // tud metszeni (egy összeadás akkor ellenőrizhető, ha mindhárom tagja megvan).
  const sorrend = [...tagok].sort((a, b) => (celok.get(a) ?? 0) - (celok.get(b) ?? 0));

  const jeloltek = sorrend.map((k) => {
    const cel = celok.get(k) ?? 0;
    const lepes = lepesek.get(k) ?? 1;
    const alap = Math.round(cel / lepes) * lepes;
    const lista: number[] = [];
    for (let d = -MAX_LEPES_ELTERES; d <= MAX_LEPES_ELTERES; d++) {
      const v = Number((alap + d * lepes).toFixed(6));
      if (v > 0 && !lista.includes(v)) lista.push(v);
    }
    lista.sort((x, y) => Math.abs(x - cel) - Math.abs(y - cel));
    return lista;
  });

  const helye = new Map<string, number>();
  sorrend.forEach((k, i) => helye.set(k, i));
  const kiosztas = new Map<string, number>();

  const ellenoriz = (i: number): boolean => {
    for (const r of relaciok) {
      const ia = helye.get(r.a);
      const ib = helye.get(r.b);
      const ic = helye.get(r.c);
      if (ia === undefined || ib === undefined || ic === undefined) continue;
      if (ia > i || ib > i || ic > i) continue;
      const va = kiosztas.get(r.a);
      const vb = kiosztas.get(r.b);
      const vc = kiosztas.get(r.c);
      if (va === undefined || vb === undefined || vc === undefined) continue;
      if (Number((va + vb).toFixed(6)) !== vc) return false;
    }
    return true;
  };

  const dfs = (i: number): boolean => {
    if (i === sorrend.length) return true;
    const k = sorrend[i]!;
    for (const v of jeloltek[i]!) {
      // Két különböző eredeti összeg nem eshet egybe: az iratban két tétel
      // állt, és a kimenetben is kettőnek kell látszania.
      let utkozik = false;
      for (const [mas, ertek] of kiosztas) {
        if (mas !== k && ertek === v) {
          utkozik = true;
          break;
        }
      }
      if (utkozik) continue;
      kiosztas.set(k, v);
      if (ellenoriz(i) && dfs(i + 1)) return true;
      kiosztas.delete(k);
    }
    return false;
  };

  return dfs(0) ? new Map(kiosztas) : null;
}

/**
 * A címkés mód szövege a pénznemre tapadt toldalék szerint.
 *
 * „3 000 000 Ft-ot” helyére nem „[összeg]” kell, hanem „[összeget]”: a „Ft-ot”
 * kiejtve „forintot”, és a mondat a toldalék nélkül elromlik. A toldalékot nem
 * lemásoljuk, hanem ÚJRAKÉPEZZÜK az „összeg” szóra — a „-ot” a „forint”
 * hangrendjéhez tartozik, az „összeg”-hez „-et” való.
 */
const TOLDALEK_ESET: Readonly<Record<string, CaseTag>> = {
  ot: 'ACC', at: 'ACC', et: 'ACC', öt: 'ACC', t: 'ACC',
  ra: 'SUB', re: 'SUB',
  ban: 'INE', ben: 'INE',
  ba: 'ILL', be: 'ILL',
  ból: 'ELA', ből: 'ELA',
  ról: 'DEL', ről: 'DEL',
  tól: 'ABL', től: 'ABL',
  nak: 'DAT', nek: 'DAT',
  nál: 'ADE', nél: 'ADE',
  hoz: 'ALL', hez: 'ALL', höz: 'ALL',
  ig: 'TER',
  ért: 'CAU',
  ként: 'FOR',
  on: 'SUP', en: 'SUP', ön: 'SUP', n: 'SUP',
  val: 'INS', vel: 'INS',
};

export function cimkeSzoveg(penznemToldalek: string | null): string {
  if (penznemToldalek === null) return `[${CIMKE_SZO}]`;
  const tag = TOLDALEK_ESET[penznemToldalek.toLowerCase()];
  // Ismeretlen toldalékot inkább elhagyunk, mint rosszul ragozunk: a hibás
  // magyar alak azonnal elárulja, hogy a szöveget gép írta át.
  if (tag === undefined) return `[${CIMKE_SZO}]`;
  return `[${inflectWord(CIMKE_SZO, tag)}]`;
}

/** A betűs alak kezdő nagybetűjét megtartjuk. */
function nagybetuMint(eredeti: string, uj: string): string {
  const elso = eredeti[0];
  if (elso === undefined || elso !== elso.toUpperCase() || elso === elso.toLowerCase()) return uj;
  return uj.charAt(0).toUpperCase() + uj.slice(1);
}

/**
 * A cserék megtervezése.
 *
 * A visszaadott terv NEM hajtja végre a cserét: a hívó dönti el, hogy a
 * 'review' besorolású találatokat is átírja-e. A `figyelmeztetesek` mezőt
 * viszont ki KELL írnia — ez az egyetlen hely, ahol kiderül, ha egy végösszeg
 * a kerekítés miatt elromlott.
 */
export function tervezOsszegCsere(
  matches: readonly OsszegMatch[],
  opts: OsszegCsereOpciok,
): OsszegTerv {
  const figyelmeztetesek: string[] = [];
  const cserek: Csere[] = [];

  if (opts.mod === 'cimke') {
    for (const m of matches) {
      cserek.push({
        start: m.start,
        end: m.end,
        szoveg: cimkeSzoveg(m.penznemToldalek),
        indoklas: `${m.text} → címke (a szám elvész)`,
      });
    }
    if (matches.length > 0) {
      figyelmeztetesek.push(
        'Címkés módban minden összeg helyére „[összeg]” kerül: az irat számszaki ' +
          'érvelése (tőke, törlesztés, hátralék viszonya) nem lesz követhető.',
      );
    }
    return { cserek: rendez(cserek), szorzo: null, osszefuggesek: [], figyelmeztetesek };
  }

  const szorzo = osszegSzorzo(opts.caseSecret);

  // 1. Értékenként EGY új érték: ugyanaz az összeg az irat minden pontján
  //    ugyanarra cserélődik, különben az olvasó két különböző tételt lát ott,
  //    ahol az iratban egy állt.
  const lepesek = new Map<string, number>();
  const eredetiek = new Map<string, number>();
  const penznemErtekek = new Map<Penznem, Set<number>>();

  const felvesz = (penznem: Penznem, ertek: number, tizedesek: number): void => {
    const k = kulcs(penznem, ertek);
    eredetiek.set(k, ertek);
    lepesek.set(k, Math.max(lepesek.get(k) ?? 0, kerekitesiLepes(ertek, tizedesek)));
    const halmaz = penznemErtekek.get(penznem) ?? new Set<number>();
    halmaz.add(ertek);
    penznemErtekek.set(penznem, halmaz);
  };

  for (const m of matches) felvesz(m.penznem, m.ertek, m.alak.tizedesek);
  // Az ügy többi iratának összegei csak a rácsot alakítják; szövegcsere nem
  // lesz belőlük, mert ebben az iratban nincs hozzájuk tartozó tartomány.
  for (const t of opts.tovabbiErtekek ?? []) felvesz(t.penznem, t.ertek, t.tizedesek ?? 0);

  // 2. Összefüggések keresése, MÉG a kerekítés előtt: a rácsot ezek szabják meg.
  const nyersek: { penznem: Penznem; a: number; b: number; c: number }[] = [];
  for (const [penznem, halmaz] of penznemErtekek) {
    for (const r of keresOsszefuggesek([...halmaz].sort((x, y) => x - y))) {
      nyersek.push({ penznem, ...r });
    }
  }
  const csoportok = kozosRacs(nyersek, lepesek);

  // 3. Szorzás és kerekítés a — most már csoportonként közös — rácson.
  const celok = new Map<string, number>();
  const ujErtek = new Map<string, number>();
  for (const [k, eredeti] of eredetiek) {
    const cel = eredeti * szorzo;
    celok.set(k, cel);
    ujErtek.set(k, kerekit(cel, lepesek.get(k) ?? 1));
  }

  // 3b. Ahol több összeadás köti egymáshoz ugyanazokat az összegeket, ott a
  //     tagonkénti kerekítés nem tud mindegyiknek megfelelni — keressük meg
  //     azt az együttállást, amelyben mindegyik stimmel.
  for (const tagok of csoportok.values()) {
    const kulcsok = new Set(tagok);
    const relaciok: Relacio[] = nyersek
      .map((o) => ({
        a: kulcs(o.penznem, o.a),
        b: kulcs(o.penznem, o.b),
        c: kulcs(o.penznem, o.c),
      }))
      .filter((r) => kulcsok.has(r.a) && kulcsok.has(r.b) && kulcsok.has(r.c));
    if (relaciok.length === 0) continue;
    const megoldas = csoportMegoldas(tagok, celok, lepesek, relaciok);
    if (megoldas === null) continue;
    for (const [k, v] of megoldas) ujErtek.set(k, v);
  }

  // 4. A közös rács után is maradhat egy lépésnyi elcsúszás — azt igazítjuk.
  const osszefuggesek: OsszefuggesJelentes[] = [];
  for (const { penznem, a, b, c } of nyersek) {
    const kc = kulcs(penznem, c);
    const ujA = ujErtek.get(kulcs(penznem, a))!;
    const ujB = ujErtek.get(kulcs(penznem, b))!;
    const ujC = ujErtek.get(kc)!;
    let javitva = false;
    if (Number((ujA + ujB).toFixed(6)) !== ujC) {
      // A kerekítés legfeljebb egy lépéssel tolhatta el a végösszeget. Ha az
      // eltérés ezen belül van, a végösszeget igazítjuk — a kerekség így is
      // megmarad, mert a részek maguk is a rácson vannak. Ha nem fér bele,
      // nem hamisítunk tovább: marad, és jelentjük.
      const cel = Number((ujA + ujB).toFixed(6));
      if (Math.abs(cel - ujC) <= (lepesek.get(kc) ?? 1)) {
        ujErtek.set(kc, cel);
        javitva = true;
      }
    }
    osszefuggesek.push({ penznem, a, b, c, ujA, ujB, ujC, megmaradt: false, javitva });
  }

  // 5. VISSZAELLENŐRZÉS. A javítás egy másik összefüggést elronthatott, ezért
  //    a végleges leképezésen mérünk újra, nem a javítás közbeni állapoton.
  for (const o of osszefuggesek) {
    o.ujA = ujErtek.get(kulcs(o.penznem, o.a))!;
    o.ujB = ujErtek.get(kulcs(o.penznem, o.b))!;
    o.ujC = ujErtek.get(kulcs(o.penznem, o.c))!;
    o.megmaradt = Number((o.ujA + o.ujB).toFixed(6)) === o.ujC;
    if (!o.megmaradt) {
      figyelmeztetesek.push(
        `Elromlott végösszeg: az iratban ${o.a} + ${o.b} = ${o.c} ${o.penznem}, ` +
          `a csere után ${o.ujA} + ${o.ujB} = ${Number((o.ujA + o.ujB).toFixed(6))}, ` +
          `de a végösszeg helyén ${o.ujC} áll. Ezt egy ügyvéd észreveszi — ` +
          'nézd át kézzel, vagy válts címkés módra.',
      );
    }
  }

  // 6. Ütközések: két különböző eredeti összeg ugyanarra az új értékre esett.
  const forditott = new Map<string, number[]>();
  for (const [k, uj] of ujErtek) {
    const penznem = k.slice(0, k.indexOf(':'));
    const kk = `${penznem}:${uj}`;
    forditott.set(kk, [...(forditott.get(kk) ?? []), eredetiek.get(k)!]);
  }
  for (const [kk, lista] of forditott) {
    if (lista.length > 1) {
      figyelmeztetesek.push(
        `Összeolvadt összegek: ${lista.join(' és ')} egyaránt ${kk.slice(kk.indexOf(':') + 1)} ` +
          'lett a kerekítés után, így az iratban két különböző tétel azonosnak látszik.',
      );
    }
  }

  // 7. Változatlanul maradt összegek: ezek NEM anonimizálódtak. Csak az EBBEN
  //    az iratban álló összegekről szólunk: a más iratból behozott értékek itt
  //    csak a rácsot alakítják, cserélni nem fogjuk őket.
  const ittAllnak = new Set(matches.map((m) => kulcs(m.penznem, m.ertek)));
  for (const [k, uj] of ujErtek) {
    if (!ittAllnak.has(k)) continue;
    if (uj === eredetiek.get(k)) {
      figyelmeztetesek.push(
        `Nem változott: a ${eredetiek.get(k)} ${k.slice(0, k.indexOf(':'))} összeg a szorzás és ` +
          'kerekítés után önmaga maradt, tehát ez az adat NEM lett anonimizálva.',
      );
    }
  }

  // 8. A tényleges szövegcserék.
  for (const m of matches) {
    const uj = ujErtek.get(kulcs(m.penznem, m.ertek));
    if (uj === undefined) continue;
    cserek.push({
      start: m.szam.start,
      end: m.szam.end,
      szoveg: formazSzam(uj, m.alak),
      indoklas: `${m.szam.text} → ${formazSzam(uj, m.alak)} (szorzó: ${szorzo})`,
    });
    if (m.betuvel !== null) {
      if (!Number.isInteger(uj)) {
        figyelmeztetesek.push(
          `A betűs alak („${m.betuvel.text}”) nem írható át: az új érték (${uj}) nem egész szám.`,
        );
        continue;
      }
      const ujBetu = nagybetuMint(m.betuvel.text, szamBetuvel(uj));
      cserek.push({
        start: m.betuvel.start,
        end: m.betuvel.end,
        szoveg: ujBetu,
        indoklas: `betűs alak: ${m.betuvel.text} → ${ujBetu}`,
      });
    }
  }

  return { cserek: rendez(cserek), szorzo, osszefuggesek, figyelmeztetesek };
}

function rendez(cserek: Csere[]): Csere[] {
  return [...cserek].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * A tervezett cserék végrehajtása egy szövegen. Hátulról előre haladunk, hogy
 * a korábbi cserék ne tolják el a későbbiek pozícióit.
 *
 * FIGYELEM: egy szövegre az ÖSSZES cserét EGY hívásban kell átadni — az
 * összegtervet és a dátumtervet egyetlen listába fűzve. Két külön hívás a
 * másodikat már eltolódott pozíciókra alkalmazná: a betűs alak cseréje
 * ("hárommillió-ötszázötvenezer" → "négymillió-hetvenezer") megváltoztatja a
 * szöveg hosszát, és onnantól minden későbbi dátumtartomány elcsúszik. Ez a
 * hiba csendes — a kimenet nem hibaüzenetet ad, hanem szétkaszabolt szöveget.
 */
export function alkalmazCserek(text: string, cserek: readonly Csere[]): string {
  const rendezett = [...cserek].sort((a, b) => b.start - a.start);
  let out = text;
  let elozoStart = Number.POSITIVE_INFINITY;
  for (const cs of rendezett) {
    if (cs.end > elozoStart) continue; // átfedő csere: az elsőbbséget a hosszabb kapta
    out = out.slice(0, cs.start) + cs.szoveg + out.slice(cs.end);
    elozoStart = cs.start;
  }
  return out;
}

/**
 * Az ai/types.ts ExtractedEntity alakja, hogy az összegek és a modell találatai
 * egy listában kezelhetők legyenek. Ugyanaz a leképezés, mint az
 * azonositok.ts-ben: a fajta a `rawLabel`-be kerül, mert az ai/types.ts címkéi
 * nem ismerik a pénzösszeget.
 */
export interface OsszegEntityShape {
  start: number;
  end: number;
  text: string;
  label: 'other';
  rawLabel: string;
  score: number;
}

export function asEntityShape(m: OsszegMatch): OsszegEntityShape {
  return {
    start: m.start,
    end: m.end,
    text: m.text,
    label: 'other',
    rawLabel: `OSSZEG:${m.kind}`,
    score: m.confidence,
  };
}
