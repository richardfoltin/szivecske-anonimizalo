/**
 * Magyar hivatalos azonosítók felismerése jogi iratban: adóazonosító jel,
 * TAJ, adószám, cégjegyzékszám, bankszámlaszám, IBAN, helyrajzi szám,
 * irányítószám, telefonszám, személyazonosító igazolvány, bírósági ügyszám,
 * e-mail és teljes lakcím.
 *
 * A LEGFONTOSABB TERVEZÉSI DÖNTÉS: az ellenőrzőszám NEM kapu, csak pont.
 *
 * Ezt a saját mintairatainkon mértük meg, és az eredmény egyértelmű: a három
 * adóazonosító jelből egy érvényes, a két bankszámlaszámnál csak az első
 * nyolcas blokk jó, az IBAN ellenőrzőszáma pedig hibás. Kemény ellenőrzőszám-
 * kapuval a program a saját tesztadatai többségét sem találná meg — és a valódi
 * iratokban is van elgépelés, OCR-hiba, szándékosan rontott példa. Egy
 * anonimizálóban a ki nem szűrt adóazonosító sokkal drágább hiba, mint egy
 * fölöslegesen átnézésre küldött számsor.
 *
 * Ezért:
 *  - a minta illeszkedése önmagában TALÁLAT,
 *  - érvényes ellenőrzőszám → magasabb megbízhatóság (automatikus csere),
 *  - érvénytelen ellenőrzőszám → alacsonyabb megbízhatóság, emberi átnézés,
 *    de a találat NEM esik ki,
 *  - a címke-kontextus ("adóazonosító jel:", "TAJ szám:", "hrsz.") ERŐSEBB
 *    jel az ellenőrzőszámnál: a téves illeszkedést a szövegkörnyezet zárja ki,
 *    nem a matematika. Tíz számjegy sok mindent jelenthet; a "TAJ szám:" után
 *    álló kilenc számjegy viszont TAJ, akkor is, ha el van gépelve.
 *
 * Ebből következik, hogy itt nincs 'reject' állapot (a matcher.ts-szel
 * ellentétben): amit felismertünk, az legrosszabb esetben is az átnézési
 * listára kerül, nem a kukába.
 */

import { HU_LETTER_CLASS } from './phonology.js';
import { AUTO_REPLACE_THRESHOLD, findIdentifierTokens } from './identifiers.js';

const L = HU_LETTER_CLASS;

/** Nincs előtte magyar betű vagy számjegy. Az ASCII \b itt használhatatlan. */
const NOT_BEFORE = `(?<![${L}0-9])`;
/** Nincs utána magyar betű vagy számjegy. */
const NOT_AFTER = `(?![${L}0-9])`;

/** Szóhatár csak betűre (számjegy megengedett), címkeszavakhoz. */
const NB = `(?<![${L}])`;
const NA = `(?![${L}])`;

/** Magyar toldalék a címkeszó végén: "bankszámlájára", "adószáma". */
const TOLDALEK = `[a-záéíóöőúüű]*`;

export type AzonositoKind =
  | 'ado_azonosito_jel'
  | 'taj'
  | 'adoszam'
  | 'cegjegyzekszam'
  | 'bankszamlaszam'
  | 'iban'
  | 'helyrajzi_szam'
  | 'iranyitoszam'
  | 'telefonszam'
  | 'szemelyazonosito_igazolvany'
  | 'birosagi_ugyszam'
  | 'email'
  | 'rendszam'
  | 'cim';

/** Megjelenítendő magyar név a szereplapon. */
export const AZONOSITO_NEV: Record<AzonositoKind, string> = {
  ado_azonosito_jel: 'adóazonosító jel',
  taj: 'TAJ-szám',
  adoszam: 'adószám',
  cegjegyzekszam: 'cégjegyzékszám',
  bankszamlaszam: 'bankszámlaszám',
  iban: 'IBAN',
  helyrajzi_szam: 'helyrajzi szám',
  iranyitoszam: 'irányítószám',
  telefonszam: 'telefonszám',
  szemelyazonosito_igazolvany: 'személyazonosító igazolvány száma',
  birosagi_ugyszam: 'bírósági ügyszám',
  email: 'e-mail cím',
  rendszam: 'rendszám',
  cim: 'cím',
};

/**
 * Az ellenőrzőszám állapota.
 *
 * A 'not_applicable' nem hiba: a cégjegyzékszámnak és a helyrajzi számnak
 * nincs ellenőrzőszáma, ezért ezeknél a hiánya semmit nem mond a találatról.
 */
export type ChecksumState = 'valid' | 'invalid' | 'not_applicable';

export interface AzonositoMatch {
  /** Karakterpozíció az ÁTADOTT szövegben. */
  start: number;
  end: number;
  /** A felszíni szöveg pontosan úgy, ahogy a forrásban áll. */
  text: string;
  kind: AzonositoKind;
  /** 0..1 — a matcher.ts Match.confidence mezőjével azonos skála. */
  confidence: number;
  checksum: ChecksumState;
  /** A találat mellett álló címke ("adóazonosító jel", "TAJ"), ha volt. */
  label: string | null;
  /** Magyar magyarázat: miért ennyi a megbízhatóság. */
  reason: string;
  /** 'auto' — magától cserélhető; 'review' — emberi döntést vár. */
  disposition: 'auto' | 'review';
}

/**
 * E fölött cserélünk automatikusan.
 *
 * Korábban itt SAJÁT 0.8-as másolat állt, azzal az indokkal, hogy „szándékosan
 * ugyanaz az érték, mint a matcher.ts AUTO_REPLACE_THRESHOLD-ja". A szándék
 * viszont nem tartja szinkronban a két számot: aki az egyiket állítja, a
 * másikról nem tud, és a felhasználó ugyanazon a 0..1 skálán két különböző
 * határon kapta volna a találatait. Az érték ezért az identifiers.ts-ben áll,
 * amit EZ a modul és a matcher is behúz — így nincs körkörös függés sem.
 */
export { AUTO_REPLACE_THRESHOLD as AUTO_THRESHOLD } from './identifiers.js';

/**
 * Alap-megbízhatóság azonosítófajtánként: mennyire jellegzetes maga a minta.
 *
 * Az e-mail és az ügyszám mintája önmagában is félreérthetetlen, ezért magas.
 * A puszta irányítószám a leggyengébb: négy számjegy egy nagybetűs szó előtt
 * évszám is lehet — ezt szinte mindig a teljes cím találata nyeli el.
 */
const BASE: Record<AzonositoKind, number> = {
  ado_azonosito_jel: 0.55,
  taj: 0.55,
  adoszam: 0.55,
  cegjegyzekszam: 0.6,
  bankszamlaszam: 0.55,
  iban: 0.6,
  helyrajzi_szam: 0.6,
  iranyitoszam: 0.35,
  telefonszam: 0.75,
  szemelyazonosito_igazolvany: 0.55,
  birosagi_ugyszam: 0.8,
  email: 0.85,
  // A rendszám mintája jellegzetes, de nem egyedi: az „ABC-123" alakra egy
  // szabványhivatkozás vagy egy terméktípus-jelölés is ráillik. Címke nélkül
  // ezért átnézésre megy, a „rendszáma:" mellett viszont magától cserélhető —
  // ugyanaz a beállítás, mint az adószámnál és a TAJ-nál.
  rendszam: 0.55,
  cim: 0.7,
};

/** A címke a legerősebb egyetlen jel — többet ér, mint az ellenőrzőszám. */
const LABEL_BONUS = 0.25;
const CHECKSUM_OK = 0.2;
const CHECKSUM_BAD = -0.15;
/** Szerkezeti hiba (megyekód tartományon kívül): ugyanannyi, mint egy rossz ellenőrzőszám. */
const STRUCTURE_BAD = -0.15;

/* ------------------------------------------------------------------ *
 *  Ellenőrzőszámok
 * ------------------------------------------------------------------ */

/**
 * Adóazonosító jel: 10 számjegy, az első 8-as. Az első 9 jegyet rendre
 * 1..9-cel szorozva összegezzük, a 11-es maradék adja a 10. jegyet.
 */
export function adoazonositoOk(digits: string): boolean {
  if (!/^[0-9]{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (i + 1);
  return sum % 11 === Number(digits[9]);
}

/**
 * TAJ-szám: 9 számjegy. A páratlan helyiértékű jegyek súlya 3, a párosaké 7;
 * az első 8 jegy súlyozott összegének 10-es maradéka a 9. jegy.
 */
export function tajOk(digits: string): boolean {
  if (!/^[0-9]{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 3 : 7);
  return sum % 10 === Number(digits[8]);
}

/**
 * A 9,7,3,1,9,7,3 súlyozású nyolcjegyű blokk ellenőrzése. Ugyanaz a képlet
 * mozgatja az adószám törzsszámát és a bankszámlaszám minden nyolcas blokkját —
 * ezért egy függvény, nem kettő.
 */
export function nyolcasBlokkOk(block: string): boolean {
  if (!/^[0-9]{8}$/.test(block)) return false;
  const weights = [9, 7, 3, 1, 9, 7, 3];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(block[i]) * weights[i]!;
  return (10 - (sum % 10)) % 10 === Number(block[7]);
}

/**
 * IBAN mod-97: az első négy karaktert a végére forgatjuk, a betűket számmá
 * alakítjuk (A=10 … Z=35), és a kapott nagy szám 97-es maradéka 1 kell legyen.
 *
 * A maradékot jegyenként görgetjük, mert a 28 karakteres magyar IBAN-ból
 * ~30 jegyű szám lesz, ami a JS pontos egész-tartományán kívül esik.
 */
export function ibanOk(raw: string): boolean {
  const compact = raw.replace(/[\s\u00A0]/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) return false;
  const rotated = compact.slice(4) + compact.slice(0, 4);
  let rem = 0;
  for (const ch of rotated) {
    const value = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of value) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/* ------------------------------------------------------------------ *
 *  Minták
 * ------------------------------------------------------------------ */

/** Településnév: nagybetűvel kezdődő, kötőjeles összetételt is megengedő szó. */
const TELEPULES = `[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:-[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)?`;

/**
 * Közterület jellege. A hosszabb alakok elöl állnak, különben az "út" levágná
 * az "útja" elejét, a "sor" a "fasor" végét, a "part" a "rakpart"-ot.
 */
const KOZTERULET_JELLEG =
  'körútja|körút|sugárútja|sugárút|rakpart|part|utcája|utca|útja|út|fasor|sétány|lakótelep' +
  '|liget|park|köz|tér|sor|dűlő|lejtő|domb|kert|udvar|árok|krt\\.|ltp\\.|u\\.';

/** Házszám: "14", "78/B", "12.", "3/A." */
const HAZSZAM = `[0-9]{1,4}(?:\\/[A-ZÁÉÍÓÖŐÚÜŰ0-9]{1,3})?\\.?`;

/**
 * Ajtószám a szint után: "4", "4.", "12. ajtó".
 *
 * A záró előretekintés a rendeletszámok ellen véd: az „5/2015." alakban a
 * „201" még beleférne a három számjegybe, és a cím ráfutna a jogszabályra.
 */
const AJTO = `[0-9]{1,3}(?![0-9])\\.?(?:[ \\t]*ajtó)?`;

/**
 * Emelet és ajtó — ha van, a címhez TARTOZIK.
 *
 * Enélkül a „12. 2/4." címből csak a „12."-ig tartott a találat, a csere után
 * pedig „[lakcím] 2/4." maradt a kimenetben: az emelet és az ajtó változatlanul
 * ott, ami egy társasházban gyakran elég az azonosításhoz.
 *
 * Négy alakot ismerünk el, és mindegyiket MÁS horgonyozza le — ez tartja
 * távol a téves találatot:
 *  1. „2. em. 4."      — az „em"/„emelet" szó horgonyoz, itt az ajtó elhagyható
 *  2. „fszt. 3."       — a földszint szava horgonyoz
 *  3. „2/4.", „II/4."  — a PERJEL horgonyoz
 *  4. „III. 12."       — csak római szám áll, ezért az ajtószám KÖTELEZŐ
 *
 * A 4. eset szigora nem óvatoskodás: a jogi iratban a cím után gyakran „I. r.
 * alperes" vagy „II. fejezet" következik. Kötelező ajtószám nélkül az „I."-t a
 * cím elnyelné. Ugyanezért áll ott az [IVX] és nem az [IVXLC]: az „L." és a
 * „C." önmagában sokkal gyakrabban listajel, mint tizedik feletti emelet.
 */
const EMELET =
  `(?:` +
  // A hosszabb alak elöl — ugyanaz a szabály, mint a közterület-jellegnél. Az
  // „em" előbbre véve a „2. emelet 4."-ből csak „2. em"-et vinne el, és az
  // ajtószám kimaradna. Ez a régi mintában is így volt.
  `[ \\t]*(?:[IVXLC]+|[0-9]{1,2})\\.[ \\t]*(?:emelet|em)\\.?(?:[ \\t]*${AJTO})?` +
  `|[ \\t]*(?:m?fszt|magasföldszint|földszint)\\.?(?:[ \\t]*${AJTO})?` +
  `|[ \\t]*(?:[IVX]{1,4}|[0-9]{1,2})\\/(?:[0-9]{1,3}(?![0-9])|[A-ZÁÉÍÓÖŐÚÜŰ])\\.?(?:[ \\t]*ajtó)?` +
  `|[ \\t]*[IVX]{1,4}\\.[ \\t]*${AJTO}` +
  `)?`;

/** Helyrajzi szám törzse: "1234", "1234/5", "1234/5/A". */
const HRSZ_SZAM = `[0-9]{1,5}(?:\\/[0-9]{1,3})?(?:\\/[A-ZÁÉÍÓÖŐÚÜŰ])?`;

/** A "hrsz." címke minden szokásos alakja. */
const HRSZ_CIMKE = `(?:hrsz\\.?|helyrajzi[ \\t]+szám${TOLDALEK})`;

const RE = {
  /** Adóazonosító jel: mindig 8-cal kezdődő tíz számjegy. */
  adoAzonosito: new RegExp(`${NOT_BEFORE}8[0-9]{9}${NOT_AFTER}`, 'g'),

  /**
   * TAJ: 9 számjegy, 3-3-3 tagolással is. A `(?<![0-9][ \-])` őr azért kell,
   * hogy a "3 550 000 Ft" típusú összegekből ne vágjunk ki kilenc jegyet:
   * ott a hármas csoport előtt szóközzel elválasztott számjegy áll.
   */
  taj: new RegExp(`${NOT_BEFORE}(?<![0-9][ \\-])[0-9]{3}[ \\-]?[0-9]{3}[ \\-]?[0-9]{3}${NOT_AFTER}`, 'g'),

  /** Adószám: törzsszám-áfakód-megyekód. Az áfakód mindig 1..5. */
  adoszam: new RegExp(`${NOT_BEFORE}([0-9]{8})-([1-5])-([0-9]{2})${NOT_AFTER}`, 'g'),

  /** Cégjegyzékszám: megyekód-cégformakód-sorszám. */
  cegjegyzekszam: new RegExp(`${NOT_BEFORE}([0-9]{2})-([0-9]{2})-([0-9]{6})${NOT_AFTER}`, 'g'),

  /**
   * Bankszámlaszám: 8-8 vagy 8-8-8. A harmadik blokk mohó opcionális csoport,
   * hogy a 8-8-8 alakot egyben vegyük fel — így nem keletkezik olyan átfedés,
   * amit utólag kellene feloldani.
   */
  bankszamlaszam: new RegExp(`${NOT_BEFORE}([0-9]{8})-([0-9]{8})(?:-([0-9]{8}))?${NOT_AFTER}`, 'g'),

  /** Magyar IBAN: HU + 2 ellenőrző jegy + 24 jegy, négyes csoportokban is. */
  iban: new RegExp(`${NOT_BEFORE}HU[0-9]{2}(?:[ \\u00A0]?[0-9]{4}){6}${NOT_AFTER}`, 'g'),

  /**
   * Helyrajzi szám. Az első ág a fontos: a településnevet EGYBEN veszi fel a
   * számmal ("Szentendre belterület 4127/8. hrsz."). Enélkül a helynév külön
   * találatként fedné le a "Szentendre" szót, és a lefedettségi logika a
   * hosszabb, valódi azonosítót dobná el.
   */
  helyrajziSzam: new RegExp(
    `${NOT_BEFORE}(?:` +
      `${TELEPULES}(?:[ \\t]+(?:belterület|külterület|zártkert)[a-záéíóöőúüű]*|[ \\t]*,)?[ \\t]+${HRSZ_SZAM}\\.?[ \\t]*${HRSZ_CIMKE}` +
      `|${HRSZ_CIMKE}[ \\t]*:?[ \\t]*${HRSZ_SZAM}` +
      `|${HRSZ_SZAM}\\.?[ \\t]*${HRSZ_CIMKE}` +
      `)${NOT_AFTER}`,
    'g',
  ),

  /** Teljes cím: irányítószám + település + közterület + házszám (+ emelet). */
  cim: new RegExp(
    `${NOT_BEFORE}[1-9][0-9]{3}[ \\u00A0]+${TELEPULES}[ \\t]*,[ \\t]*` +
      `(?:[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+[ \\t]+){1,3}(?:${KOZTERULET_JELLEG})${NA}` +
      `[ \\t]+${HAZSZAM}${EMELET}`,
    'g',
  ),

  /** Irányítószám nagybetűs településnév előtt. */
  iranyitoszam: new RegExp(`${NOT_BEFORE}[1-9][0-9]{3}[ \\u00A0]+${TELEPULES}${NA}`, 'g'),

  /**
   * Magyar telefonszám +36 vagy 06 előhívóval. Két hosszúság van: a mobil és
   * a budapesti vezetékes 7 jegyű (3+2+2), a vidéki vezetékes 6 jegyű (3+3).
   * A hosszabb alak áll elöl, hogy a 7 jegyű számból ne csak 6 jegyet vegyünk.
   */
  telefonszam: new RegExp(
    `(?<![${L}0-9+])(?:\\+36|06)[ \\-/]?\\(?(?:1|[2-9][0-9])\\)?[ \\-/]?` +
      `(?:[0-9]{3}[ \\-/]?[0-9]{2}[ \\-/]?[0-9]{2}|[0-9]{3}[ \\-/]?[0-9]{3})${NOT_AFTER}`,
    'g',
  ),

  /**
   * Személyazonosító igazolvány: a mai 6 számjegy + 2 nagybetű, illetve a régi
   * 2 nagybetű + 6 számjegy. A réginél elválasztót nem engedünk meg, mert a
   * "II. 123456" típusú római számos hivatkozás különben beleillene.
   */
  szemelyiUj: new RegExp(`${NOT_BEFORE}[0-9]{6}[ ]?[A-ZÁÉÍÓÖŐÚÜŰ]{2}${NOT_AFTER}`, 'g'),
  szemelyiRegi: new RegExp(`${NOT_BEFORE}[A-ZÁÉÍÓÖŐÚÜŰ]{2}[0-9]{6}${NOT_AFTER}`, 'g'),

  /**
   * Gépjármű forgalmi rendszáma, mindhárom magyar alakban:
   *  - a régi „ABC-123",
   *  - a kétbetűs csoportokra tagolt „AA-BB-123",
   *  - és a 2022 óta kiadott „AABB-123".
   *
   * CSAK ÉKEZET NÉLKÜLI NAGYBETŰ: a magyar rendszámtábla sem ékezetet, sem
   * kisbetűt nem visel, és a szűkítés egyben a téves illeszkedés ellen is
   * dolgozik („MÁV-101" így nem rendszám). A négybetűs ág áll hátul, mert a
   * hárombetűs minta a négybetűs alakra nem illeszkedik (a negyedik betű nem
   * kötőjel), fordítva viszont igen — a sorrend tehát nem ízlés kérdése.
   */
  rendszam: new RegExp(
    `${NOT_BEFORE}(?:[A-Z]{3}-[0-9]{3}|[A-Z]{2}-[A-Z]{2}-[0-9]{3}|[A-Z]{4}-[0-9]{3})${NOT_AFTER}`,
    'g',
  ),

  /** Bírósági ügyszám: "12.P.20.845/2026" vagy "5.P.20.123/2025/8". */
  ugyszam: new RegExp(
    `${NOT_BEFORE}(?:[0-9]{1,3}\\.)?[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]{0,3}\\.` +
      `[0-9]{1,3}\\.[0-9]{1,4}\\/[0-9]{4}(?:\\/[0-9]{1,3})?${NOT_AFTER}`,
    'g',
  ),
} as const;

/* ------------------------------------------------------------------ *
 *  Címke-kontextus
 * ------------------------------------------------------------------ */

/**
 * Címkeszavak azonosítófajtánként. Mind toldalékolható ("bankszámlájára",
 * "adószáma"), ezért a szótő után magyar betűk állhatnak — de a szó ELEJÉN
 * betűhatárt követelünk, különben az "IBAN" beleillene az "irataiban" szóba.
 */
const LABEL_PATTERNS: Partial<Record<AzonositoKind, RegExp>> = {
  ado_azonosito_jel: new RegExp(`${NB}adó[ \\t]*azonosító${TOLDALEK}(?:[ \\t]+jel${TOLDALEK})?${NA}`, 'i'),
  taj: new RegExp(`${NB}(?:TAJ|T\\.A\\.J\\.|társadalombiztosítási${TOLDALEK})${NA}`, 'i'),
  adoszam: new RegExp(`${NB}adószám${TOLDALEK}${NA}`, 'i'),
  cegjegyzekszam: new RegExp(`${NB}cégjegyzék${TOLDALEK}${NA}`, 'i'),
  // A "bankszáml[aá]" nem elgépelés: a magyar toldalék megnyújtja a szótő
  // végi rövid a-t, ezért a "bankszámla" a szövegben "bankszámlájára"
  // alakban áll. A puszta "bankszámla" szótő ezt soha nem találná meg.
  bankszamlaszam: new RegExp(
    `${NB}(?:bankszáml[aá]|pénzforgalmi[ \\t]+jelzőszám|számlaszám|száml[aá]szám)${TOLDALEK}${NA}`,
    'i',
  ),
  iban: new RegExp(`${NB}IBAN${NA}`, 'i'),
  telefonszam: new RegExp(`${NB}(?:telefonszám${TOLDALEK}|telefon|mobilszám${TOLDALEK}|mobil|tel\\.)${NA}`, 'i'),
  szemelyazonosito_igazolvany: new RegExp(
    `${NB}(?:személyazonosító[ \\t]+igazolvány${TOLDALEK}|személyi[ \\t]+igazolvány${TOLDALEK}|szig\\.)${NA}`,
    'i',
  ),
  birosagi_ugyszam: new RegExp(`${NB}(?:ügyszám${TOLDALEK}|ügy[ \\t]+szám${TOLDALEK})${NA}`, 'i'),
  email: new RegExp(`${NB}(?:e-?mail${TOLDALEK}|villámposta${TOLDALEK})${NA}`, 'i'),
  // A „forgalmi rendszám", a „rendszáma" és az „frsz." ugyanazt jelöli. A
  // „forgalmi engedély" szándékosan nincs benne: az az okmány, nem a szám.
  rendszam: new RegExp(`${NB}(?:(?:forgalmi[ ]+)?rendszám${TOLDALEK}|frsz\\.)${NA}`, 'i'),
  cim: new RegExp(
    `${NB}(?:lakcím|lakóhely|székhely|tartózkodási[ \\t]+hely|telephely|cím)${TOLDALEK}${NA}`,
    'i',
  ),
};

/** Ennyi karaktert nézünk visszafelé a címkéért. */
const LABEL_BEFORE_CHARS = 40;

/**
 * Előre többet, mert közbeékelődhet egy egész IBAN:
 * "10402142-49575354-56561008 számú (IBAN: …) bankszámlájára".
 */
const LABEL_AFTER_CHARS = 80;

/**
 * Ezeknél a fajtáknál a címke ÁLLHAT a szám után is, mert a magyar jogi
 * szöveg jelzős szerkezetbe teszi: "… számú bankszámlájára", "… adószámú".
 *
 * A címnél és az irányítószámnál viszont KIZÁRÓLAG előre nézünk. A magyar
 * iratban a cím címkéje mindig megelőzi a címet ("lakcím: …"), a mögötte álló
 * szöveg viszont már a KÖVETKEZŐ félé — az ítéletben az ügyvédi iroda címét
 * pont az utána következő alperes „lakcím:" szava emelte volna magabiztos
 * találattá, holott az irodai cím épp hogy átnézendő.
 */
const LABEL_AFTER_ALLOWED: ReadonlySet<AzonositoKind> = new Set<AzonositoKind>([
  'bankszamlaszam',
  'adoszam',
  'cegjegyzekszam',
  // A rendszám a magyar iratban szinte mindig jelzős szerkezetben áll: „az
  // ABC-123 forgalmi rendszámú gépjármű". Ha csak visszafelé néznénk, épp a
  // leggyakoribb alak maradna címke nélkül, vagyis átnézésre várna.
  'rendszam',
]);

function findLabel(text: string, kind: AzonositoKind, start: number, end: number): string | null {
  const re = LABEL_PATTERNS[kind];
  if (!re) return null;
  const before = re.exec(text.slice(Math.max(0, start - LABEL_BEFORE_CHARS), start));
  if (before) return before[0];
  if (!LABEL_AFTER_ALLOWED.has(kind)) return null;
  const after = re.exec(text.slice(end, Math.min(text.length, end + LABEL_AFTER_CHARS)));
  return after ? after[0] : null;
}

/* ------------------------------------------------------------------ *
 *  Felismerés
 * ------------------------------------------------------------------ */

interface RawHit {
  start: number;
  end: number;
  text: string;
  kind: AzonositoKind;
  checksum: ChecksumState;
  /** Igaz, ha a szerkezet (megyekód, áfakód) rendben van. */
  structureOk: boolean;
  /** Kiegészítő magyarázat: blokkonkénti eredmény, megyekód neve. */
  note: string;
  /** Ha a címke maga a mintában van ("hrsz."), nem kell külön keresni. */
  builtInLabel?: string;
}

/** Csak a megyekód-tartományt nézzük; a listát nem soroljuk fel, mert változhat. */
function megyekodOk(code: string): boolean {
  const n = Number(code);
  return n >= 1 && n <= 20;
}

function scan(
  text: string,
  re: RegExp,
  kind: AzonositoKind,
  evaluate: (m: RegExpExecArray) => Pick<RawHit, 'checksum' | 'structureOk' | 'note'>,
): RawHit[] {
  const out: RawHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const surface = m[0];
    out.push({
      start: m.index,
      end: m.index + surface.length,
      text: surface,
      kind,
      ...evaluate(m),
    });
    // Nulla hosszú találat nem fordulhat elő, de a végtelen ciklus ára nagy.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

const NO_CHECK = { checksum: 'not_applicable' as ChecksumState, structureOk: true, note: '' };

function collectRaw(text: string): RawHit[] {
  const hits: RawHit[] = [];

  hits.push(
    ...scan(text, RE.adoAzonosito, 'ado_azonosito_jel', (m) => {
      const ok = adoazonositoOk(m[0]);
      return { checksum: ok ? 'valid' : 'invalid', structureOk: true, note: '' };
    }),
  );

  hits.push(
    ...scan(text, RE.taj, 'taj', (m) => {
      const digits = m[0].replace(/[^0-9]/g, '');
      const ok = tajOk(digits);
      return { checksum: ok ? 'valid' : 'invalid', structureOk: true, note: '' };
    }),
  );

  hits.push(
    ...scan(text, RE.adoszam, 'adoszam', (m) => {
      const ok = nyolcasBlokkOk(m[1] ?? '');
      const megye = m[3] ?? '';
      return {
        checksum: ok ? 'valid' : 'invalid',
        // Az adószám megyekódja tágabb tartomány, mint a cégjegyzékszámé
        // (44-ig megy, plusz az 51-es különleges kód), ezért csak durván nézzük.
        structureOk: Number(megye) >= 1 && Number(megye) <= 51,
        note: `áfakód: ${m[2] ?? ''}, megyekód: ${megye}`,
      };
    }),
  );

  hits.push(
    ...scan(text, RE.cegjegyzekszam, 'cegjegyzekszam', (m) => {
      const megye = m[1] ?? '';
      return {
        // A cégjegyzékszámnak nincs ellenőrzőszáma — ez nem gyanújel, hanem
        // a szám természete, ezért nem is vonunk le érte.
        checksum: 'not_applicable',
        structureOk: megyekodOk(megye),
        note: `megyekód: ${megye}, cégformakód: ${m[2] ?? ''}`,
      };
    }),
  );

  hits.push(
    ...scan(text, RE.bankszamlaszam, 'bankszamlaszam', (m) => {
      const blocks = [m[1], m[2], m[3]].filter((b): b is string => typeof b === 'string');
      const results = blocks.map((b) => nyolcasBlokkOk(b));
      const good = results.filter(Boolean).length;
      return {
        checksum: good === blocks.length ? 'valid' : 'invalid',
        structureOk: true,
        note: `${good}/${blocks.length} nyolcas blokk ellenőrzőszáma jó`,
      };
    }),
  );

  hits.push(
    ...scan(text, RE.iban, 'iban', (m) => {
      const ok = ibanOk(m[0]);
      return { checksum: ok ? 'valid' : 'invalid', structureOk: true, note: '' };
    }),
  );

  hits.push(
    ...scan(text, RE.helyrajziSzam, 'helyrajzi_szam', () => ({
      ...NO_CHECK,
      note: 'a helyrajzi számnak nincs ellenőrzőszáma',
    })),
  );

  hits.push(...scan(text, RE.cim, 'cim', () => NO_CHECK));
  hits.push(...scan(text, RE.iranyitoszam, 'iranyitoszam', () => NO_CHECK));
  hits.push(...scan(text, RE.telefonszam, 'telefonszam', () => NO_CHECK));
  hits.push(...scan(text, RE.szemelyiUj, 'szemelyazonosito_igazolvany', () => NO_CHECK));
  hits.push(...scan(text, RE.szemelyiRegi, 'szemelyazonosito_igazolvany', () => NO_CHECK));
  hits.push(...scan(text, RE.ugyszam, 'birosagi_ugyszam', () => NO_CHECK));
  hits.push(...scan(text, RE.rendszam, 'rendszam', () => NO_CHECK));

  // A "hrsz." címke a mintában van, nem a környezetben.
  for (const h of hits) {
    if (h.kind === 'helyrajzi_szam') h.builtInLabel = 'hrsz.';
  }

  // Az e-mail nem regexből jön: az identifiers.ts már ismeri az azonosító-
  // tokeneket, és az ott bevált mintát nem érdemes lemásolni.
  for (const t of findIdentifierTokens(text)) {
    if (t.kind !== 'email') continue;
    hits.push({ start: t.start, end: t.end, text: t.text, kind: 'email', ...NO_CHECK });
  }

  return hits;
}

function clamp(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function reasonOf(hit: RawHit, label: string | null): string {
  const parts: string[] = [AZONOSITO_NEV[hit.kind] + ' mintája illeszkedik'];
  if (label) parts.push(`címke a szövegben: „${label}”`);
  if (hit.checksum === 'valid') parts.push('az ellenőrzőszám érvényes');
  if (hit.checksum === 'invalid') parts.push('az ellenőrzőszám HIBÁS — elgépelés vagy téves illeszkedés, átnézendő');
  if (hit.note) parts.push(hit.note);
  if (!hit.structureOk) parts.push('a megyekód a szokásos tartományon kívül esik');
  return parts.join('; ');
}

/**
 * Minden azonosító a szövegben, ÁTFEDÉSEKKEL együtt.
 *
 * Szándékosan nem oldjuk fel itt az átfedéseket: a "2000 Szentendre" egyszerre
 * irányítószám és egy teljes cím eleje, és a hívónak kell eldöntenie, melyikre
 * van szüksége. A feloldáshoz lásd `resolveOverlaps`.
 */
export function findAzonositok(text: string): AzonositoMatch[] {
  const seen = new Set<string>();
  const out: AzonositoMatch[] = [];

  for (const hit of collectRaw(text)) {
    const key = `${hit.kind}:${hit.start}:${hit.end}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = hit.builtInLabel ?? findLabel(text, hit.kind, hit.start, hit.end);
    const confidence = clamp(
      BASE[hit.kind] +
        (label ? LABEL_BONUS : 0) +
        (hit.checksum === 'valid' ? CHECKSUM_OK : hit.checksum === 'invalid' ? CHECKSUM_BAD : 0) +
        (hit.structureOk ? 0 : STRUCTURE_BAD),
    );

    out.push({
      start: hit.start,
      end: hit.end,
      text: hit.text,
      kind: hit.kind,
      confidence,
      checksum: hit.checksum,
      label,
      reason: reasonOf(hit, label),
      disposition: confidence >= AUTO_REPLACE_THRESHOLD ? 'auto' : 'review',
    });
  }

  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out;
}

/**
 * Átfedések feloldása: a hosszabb találat nyer, azonos hosszon a magasabb
 * megbízhatóságú.
 *
 * A hossz azért erősebb szempont a megbízhatóságnál, mert a rövidebb találat
 * a hosszabb DARABJA szokott lenni, nem az alternatívája: a "2000 Szentendre"
 * nem versenytársa a "2000 Szentendre, Bükkös part 14." címnek, hanem a része.
 * Ha a rövidebbet választanánk, a cím többi fele bent maradna a kimenetben.
 */
export function resolveOverlaps(matches: readonly AzonositoMatch[]): AzonositoMatch[] {
  const ranked = [...matches].sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.start - b.start;
  });

  const kept: AzonositoMatch[] = [];
  for (const m of ranked) {
    if (kept.some((k) => m.start < k.end && k.start < m.end)) continue;
    kept.push(m);
  }
  kept.sort((a, b) => a.start - b.start || a.end - b.end);
  return kept;
}

/** Ezek a fajták településnevet is magukba foglalnak. */
const HELYNEVET_TARTALMAZ: ReadonlySet<AzonositoKind> = new Set<AzonositoKind>([
  'helyrajzi_szam',
  'cim',
  'iranyitoszam',
]);

/**
 * A találatok abban a sorrendben, ahogyan a lefedettségi térképbe be kell
 * jegyezni őket.
 *
 * A helynevet is tartalmazó azonosítók (helyrajzi szám, teljes cím) mennek
 * elöl. A matcher.ts elsőbbségi alapon jegyzi be a találatokat: ami előbb
 * kerül a `covered` tömbbe, az nyer. Ha a modell "Szentendre" helynév-találata
 * kerül be előbb, a „Szentendre belterület 4127/8. hrsz." már ütközik vele, és
 * a hosszabb, valódi azonosító elveszik — pontosan a fontosabbik.
 */
export function sortForCoverage(matches: readonly AzonositoMatch[]): AzonositoMatch[] {
  const composite = matches.filter((m) => HELYNEVET_TARTALMAZ.has(m.kind));
  const rest = matches.filter((m) => !HELYNEVET_TARTALMAZ.has(m.kind));
  const byStart = (a: AzonositoMatch, b: AzonositoMatch): number => a.start - b.start || b.end - a.end;
  return [...composite.sort(byStart), ...rest.sort(byStart)];
}

/**
 * Az ai/types.ts ExtractedEntity alakja, hogy a modell találatai és az
 * azonosítók egy listában kezelhetők legyenek.
 *
 * Szándékosan itt van a leképezés, és nem az ai/types.ts-ben: az a fájl a
 * MODELL határa, és nem szabad, hogy tudjon a magyar azonosítókról. A `label`
 * mező mai készlete ('person' | 'org' | 'place' | 'other') nem ismer
 * azonosítót, ezért a fajtát a `rawLabel`-be tesszük — ott úgyis a felismerő
 * saját címkéje áll, és a szereplapon megjelenik.
 */
export interface AzonositoEntityShape {
  start: number;
  end: number;
  text: string;
  label: 'place' | 'other';
  rawLabel: string;
  score: number;
}

export function asEntityShape(m: AzonositoMatch): AzonositoEntityShape {
  return {
    start: m.start,
    end: m.end,
    text: m.text,
    label: HELYNEVET_TARTALMAZ.has(m.kind) ? 'place' : 'other',
    rawLabel: `AZONOSITO:${m.kind}`,
    score: m.confidence,
  };
}
