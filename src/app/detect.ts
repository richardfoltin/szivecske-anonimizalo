/**
 * A felek automatikus felismerése.
 *
 * A NYELVI MODELL a motor: ő olvassa végig az iratot, és ő találja meg a
 * neveket — ott is, ahol semmilyen szerkezeti jel nem utal rájuk.
 *
 * A szerkezeti minták (》Felperes:《, 》anyja neve:《, 》mint kölcsönadó《,
 * cégforma) két olyan dolgot adnak hozzá, amit egy modell nem tud megmondani:
 *  1. KI az illető az eljárásban — felperes, tanú, kezes. Ez kell az OBH-módhoz.
 *  2. KINEK KELL BENT MARADNIA — az eljáró ügyvéd, a bíró, a bíróság neve a
 *     Bszi. 166. § (2) szerint nem anonimizálható.
 * Emellett a szerkezet tartalékként is szolgál: ha a modell nincs letöltve
 * vagy elszáll, a program ettől még használható marad.
 *
 * Amit itt találunk, az JAVASLAT: a felületen megjelenik, a felhasználó
 * átnézi, kiegészíti, töröl belőle. Sosem dönt helyette.
 */

import { HU_LETTER_CLASS } from '../hu/phonology.js';
import { ALL_CASES, buildParadigm } from '../hu/inflect.js';
import {
  AZONOSITO_NEV,
  findAzonositok,
  resolveOverlaps,
  type AzonositoMatch,
} from '../hu/azonositok.js';
import type { ExtractedEntity } from '../ai/types.js';
import type { EntityKind, Gender, ModelStatus, PartyInput } from './types.js';

export interface DetectedParty extends PartyInput {
  /** Mennyire biztos a felismerés (0..1). */
  confidence: number;
  /** Miből ismertük fel — a felületen ez látszik a sor alatt. */
  evidence: string;
  /** Hányszor fordul elő a szövegben. */
  occurrences: number;
}

export interface DetectionResult {
  parties: DetectedParty[];
  /**
   * Nevek, amiket a törvény szerint BENT KELL hagyni: az eljáró bíró, az eljáró
   * ügyvéd és védő, a bíróság maga (Bszi. 166. § (2)). Ezeket külön mutatjuk,
   * és alapból nem cseréljük.
   */
  keepList: { name: string; why: string }[];
  /**
   * UGYANEZEK A NEVEK, KÉSZ FÉLKÉNT — arra az esetre, ha a felhasználó mégis
   * lecserélteti őket.
   *
   * A `keepList` csak a nevet és az indokot hordozza; ahhoz, hogy egy nevet
   * álnevesíteni lehessen, ennél több kell: fajta, nem (különben a bírónő
   * férfinevet kapna), eljárási szerep és előfordulásszám. Ezt a felismerés
   * tudja, a felület nem — és a vizsgálat percekig tart, tehát nem futtatható
   * le újra csak azért, mert a felhasználó átbillentett egy kapcsolót.
   *
   * A LISTA MAGA NEM DÖNT semmiről: a program alapból a `keepList` szerint
   * bent hagyja ezeket a neveket. Ez a mező csak azt teszi lehetővé, hogy a
   * felhasználó — kimondott figyelmeztetés mellett — mást kérjen.
   */
  officials: DetectedParty[];
  /**
   * Hivatalos azonosítók: adószám, TAJ, lakcím, bankszámlaszám, hrsz.
   *
   * KÜLÖN listán, nem a `parties` között. Egy azonosító nem "fél": nincs neme,
   * nincs eljárási szerepe, és nem témás fedőnevet kap, hanem
   * adatfajta-megjelölést. A felületen is külön rovat való nekik — a felek
   * közé keverve az ügyvéd tíz számsor közül keresné ki a felperest.
   */
  identifiers: DetectedParty[];
  /**
   * A nyelvi modell állapota, ahogy a felismerés után ismerjük.
   *
   * ITT dől el, tehát itt is kell kitölteni. A `session.ts` a jegyzőkönyvbe
   * írja és a felületre is kiteszi (`AnalyzeInput.model`); amíg ez a mező nem
   * jött vissza a felismeréstől, a hívónak nem volt honnan tudnia, hogy a
   * modell futott-e — ezért a jegyzőkönyv MINDEN iratra azt írta, hogy a
   * modell ki van kapcsolva.
   */
  model: ModelStatus;
}

const L = HU_LETTER_CLASS;

/** Egy magyar névelem: nagy kezdőbetű, utána kisbetűk; kötőjeles kettős név is. */
// A folytatás KISBETŰS: így a csupa nagybetűs címsorok („SZERZŐDÉS TÁRGYA")
// nem minősülnek névnek. A csupa nagybetűs aláírásblokkot nem itt kell
// megfogni, hanem a keresésnél — ott a név már ismert.
const NAME_WORD = `[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+(?:-[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+)?`;
/** Névelőtagok, amiket a névvel együtt szoktak írni. */
const TITLES = `(?:(?:prof\\.[ \\t]*)?(?:dr\\.|Dr\\.|DR\\.|ifj\\.|id\\.|özv\\.|néhai)[ \\t]*)*`;
/** Teljes név: vezetéknév + legalább egy keresztnév, névelőtaggal együtt. */
const FULL_NAME = `${TITLES}${NAME_WORD}(?:[ \\t]+${NAME_WORD}){1,2}`;

/** Eljárási szerepek, ahogy a rovatokban és az értelmezőkben szerepelnek. */
const ROLE_WORDS = [
  'felperes',
  'alperes',
  'I. rendű alperes',
  'II. rendű alperes',
  'III. rendű alperes',
  'I. r. alperes',
  'II. r. alperes',
  'tanú',
  'vádlott',
  'sértett',
  'kérelmező',
  'kérelmezett',
  'beavatkozó',
  'kezes',
  'készfizető kezes',
  'adós',
  'hitelező',
  'eladó',
  'vevő',
  'bérlő',
  'bérbeadó',
  'megbízó',
  'megbízott',
  'örökös',
  'indítványozó',
  // Szerződéses szerepek — a kölcsönszerződés, adásvételi és bérleti iratokból.
  'kölcsönadó',
  'kölcsönvevő',
  'jogosult',
  'kötelezett',
  'ajándékozó',
  'megajándékozott',
  'zálogkötelezett',
  'haszonélvező',
  'szerződő fél',
  'szerződő',
];

/**
 * Szavak, amik nagybetűvel kezdődnek, de sosem részei egy névnek. Nélkülük a
 * „Tisztelt Szentendrei Járásbíróság" vagy az „Alulírott Kovács János" alakból
 * rossz nevet állítanánk elő.
 */
const NOT_NAME_WORDS = new Set(
  ('a az ez ezen mint és de ha vagy alulírott tisztelt kérem kelt fenti alábbi felek fél ' +
    'melléklet tárgy indokolás rendelkező ítélet végzés határozat jegyzőkönyv szerződés ' +
    'képviselt képviseletében nevében részére számára ellen között alatt szerint alapján'
  ).split(/\s+/),
);

/** A rovatcímke szövegéből a tárolt szerep. */
function normaliseRole(raw: string): string {
  const r = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/rendű/g, 'r.')
    .replace(/\s*:\s*$/, '')
    .trim();
  if (r.startsWith('i. r') && !r.startsWith('ii')) return 'I. r. alperes';
  if (r.startsWith('ii. r')) return 'II. r. alperes';
  if (r.startsWith('iii. r')) return 'III. r. alperes';
  return r;
}

/** Gyakori magyar keresztnevek neme. Csak a felismerés kényelme miatt. */
const FEMALE = new Set(
  ('mária erzsébet katalin ilona éva anna zsuzsanna margit julianna judit ágnes andrea ildikó ' +
    'krisztina erika mónika edit gabriella tímea gyöngyi rita szilvia beáta anita nikolett ' +
    'viktória alexandra bernadett dóra eszter fanni hanna laura lilla luca noémi orsolya petra ' +
    'réka renáta sára szandra tünde vivien zsófia zsuzsa emese emma boglárka blanka dorottya ' +
    'kinga melinda henrietta klára piroska rozália teréz veronika virág adrienn brigitta cecília ' +
    'diána dorina flóra gréta ivett jázmin karolina lea léna marianna nóra olívia panna sarolta'
  ).split(/\s+/),
);
const MALE = new Set(
  ('lászló istván józsef jános ferenc zoltán sándor gábor attila péter tamás tibor csaba imre ' +
    'lajos zsolt károly györgy balázs gergely dávid bence márk máté ádám levente milán dominik ' +
    'kristóf noel olivér patrik richárd róbert szabolcs viktor vince zsombor ákos andrás antal ' +
    'árpád béla dániel dénes elemér endre ernő gyula jenő kálmán kornél krisztián márton mihály ' +
    'miklós nándor norbert ottó pál róbert rudolf simon tivadar vilmos zalán benedek barnabás ' +
    'bertalan botond ábel áron artúr bendegúz emil frigyes gáspár géza gusztáv hunor iván jakab'
  ).split(/\s+/),
);

function guessGender(fullName: string): Gender {
  const bare = fullName.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').trim();
  if (/né$/.test(bare.split(/\s+/)[0] ?? '')) return 'F';
  if (/né$/.test(bare)) return 'F';
  const parts = bare.split(/\s+/);
  for (let i = parts.length - 1; i >= 1; i--) {
    const w = (parts[i] ?? '').toLowerCase();
    if (FEMALE.has(w)) return 'F';
    if (MALE.has(w)) return 'M';
  }
  return 'N';
}

/** Cégformák — ezek teszik a szervezetnevet egyértelművé. */
const COMPANY_FORM = '(?:Kft|Zrt|Nyrt|Bt|Kkt|Kht|Ec|Rt)\\.';

/** Hatóságok és bíróságok: ezek nem felek, és bent kell maradniuk. */
const AUTHORITY =
  '(?:Járásbíróság|Törvényszék|Ítélőtábla|Kúria|Ügyészség|Főügyészség|Rendőrkapitányság|' +
  'Kormányhivatal|Önkormányzat|Közjegyző|Alkotmánybíróság|Hivatal|Minisztérium)';

/**
 * A Bszi. 166. § (2) szerint BENT MARADÓ tisztségek, ahogy a NÉV UTÁN állnak:
 * „dr. Vasvári Anikó s. k. bíró".
 *
 * Az ÜLNÖK korábban hiányzott a listáról. Ő az eljáró bíróság tagja, tehát a
 * neve nem anonimizálandó — a hiány miatt viszont a modell félként hozta be,
 * és lecseréltük. A hosszabb alakok elöl állnak, hogy a „bírósági titkár"-ból
 * ne csak a „bíró" illeszkedjen, a „népi ülnök"-ből ne csak az „ülnök".
 */
const KEEP_ROLE_AFTER =
  '[Bb]írósági[ \\t]+titkár|[Üü]gyvédnő|[Üü]gyvéd|[Vv]édő|[Jj]ogtanácsos|[Bb]írónő|[Bb]író|' +
  '[Tt]anácselnök|[Üü]gyész|[Kk]özjegyző|[Vv]égrehajtó|[Nn]épi[ \\t]+ülnök|[Üü]lnök';

/**
 * Ugyanezek a tisztségek FORDÍTOTT szórendben, rovatcímkeként. A szókincsben
 * eddig csak az egybeírt „tanácselnök" volt meg, a magyar ítélet fejrésze
 * viszont a különírt birtokos alakot használja: „A tanács elnöke: Kovács Anna".
 *
 * A kis- és nagy kezdőbetűt betűosztály engedi meg, nem az `i` jelző: attól a
 * nagybetűs névosztályok kisbetűre is illeszkednének, és minden köznév névvé
 * válna.
 */
const KEEP_ROLE_BEFORE =
  '[Tt]anács[ \\t]+elnöke|[Tt]anácselnök|[Bb]írósági[ \\t]+titkár|[Üü]gyvédnő|[Üü]gyvéd|' +
  '[Vv]édő|[Jj]ogtanácsos|[Bb]írónő|[Bb]író|[Üü]gyész|[Kk]özjegyző|[Vv]égrehajtó|' +
  '[Nn]épi[ \\t]+ülnökök|[Nn]épi[ \\t]+ülnök|[Üü]lnökök|[Üü]lnök';

let counter = 0;
function nextId(): string {
  return `d${(counter++).toString(36)}${Date.now().toString(36).slice(-4)}`;
}

interface Candidate {
  name: string;
  kind: EntityKind;
  role: string;
  confidence: number;
  evidence: string;
}

export interface DetectOptions {
  /**
   * A nyelvi modell találatai. Ez a fő forrás: a modell találja meg a
   * neveket, a szerkezeti minták pedig megmondják, KI az illető az eljárásban,
   * és kinek kell bent maradnia.
   */
  modelEntities?: ExtractedEntity[];
  /** Köznévvel azonos alakú vezetéknevek — a modell téves találatai ellen. */
  homonyms?: Set<string>;
  /**
   * Amit a HÍVÓ tud a modellről, és mi nem tudhatunk: nincs telepítve
   * ('missing'), a felhasználó kikapcsolta ('off'), vagy futás közben elszállt
   * ('failed', a magyar hibaüzenettel a `message` mezőben).
   *
   * A többit — hogy lefutott-e, hány találatot adott, mennyit nem értettünk —
   * innen már mi töltjük ki, és a `DetectionResult.model` mezőben adjuk vissza.
   * Ha a hívó nem ad semmit, a modell-találatok jelenléte dönt.
   */
  model?: ModelStatus;
}

/**
 * A felek felismerése: a nyelvi modell és a szerkezeti minták együtt.
 *
 * A kettő mást tud. A modell megtalálja a nevet ott is, ahol semmi nem utal rá
 * — egy mondat közepén, felsorolásban, aláírás alatt. A szerkezet viszont
 * megmondja, hogy az illető felperes-e vagy tanú, és hogy az eljáró ügyvéd
 * nevét bent kell hagyni. Egyik sem pótolja a másikat.
 */
export function detectParties(text: string, opts: DetectOptions = {}): DetectionResult {
  const rules = detectByStructure(text);
  if (!opts.modelEntities || opts.modelEntities.length === 0) {
    // A modell nem adott találatot. Hogy MIÉRT, azt csak a hívó tudja (nincs
    // telepítve, ki van kapcsolva, elszállt) — ha nem mondja meg, a
    // legóvatosabb olvasat marad: nem futott.
    return { ...rules, model: modelStatus(opts, 0, new Map()) };
  }
  return mergeModelWithRules(text, rules, opts.modelEntities, opts.homonyms ?? new Set(), opts);
}

/**
 * A modell állapota a jegyzőkönyv és a felület számára.
 *
 * A hívó állapota (`opts.model`) ERŐSEBB: ő tudja, hogy a modell hibára futott
 * vagy nincs telepítve. Ha nem mond semmit, a találatok jelenléte dönt. A
 * darabszámokat viszont mindig mi töltjük ki, mert azokat csak itt látjuk.
 */
function modelStatus(
  opts: DetectOptions,
  entityCount: number,
  dropped: Map<string, number>,
): ModelStatus {
  const given = opts.model;
  const state = given?.state ?? (opts.modelEntities ? 'ok' : 'off');

  const byLabel: Record<string, number> = { ...(given?.unmappedByLabel ?? {}) };
  for (const [label, n] of dropped) byLabel[label] = (byLabel[label] ?? 0) + n;
  const total = Object.values(byLabel).reduce((a, n) => a + n, 0);

  return {
    state,
    ...(given?.message === undefined ? {} : { message: given.message }),
    ...(opts.modelEntities ? { entityCount } : given?.entityCount === undefined ? {} : { entityCount: given.entityCount }),
    ...(total > 0 ? { unmappedLabels: total, unmappedByLabel: byLabel } : {}),
  };
}

/** Csak a szerkezeti minták — a modell nélküli tartalék. */
export function detectByStructure(text: string): DetectionResult {
  const candidates = new Map<string, Candidate>();
  const keep = new Map<string, string>();

  const add = (c: Candidate): void => {
    const cleaned = trimNonNameWords(c.name);
    if (!cleaned) return;
    const key = normaliseName(cleaned);
    if (!key || key.length < 4) return;
    const prev = candidates.get(key);
    if (!prev || c.confidence > prev.confidence) candidates.set(key, { ...c, name: cleaned });
  };

  // ── 1. Rovatok: „Felperes: Kovács János" ─────────────────────────────
  // Ez a legerősebb jel: a szerepet is megadja, nem csak a nevet.
  // A szerepszavak kezdőbetűje lehet kicsi és nagy is („felperes" / „Felperes:"),
  // de a NÉVMINTÁT nem szabad kis-nagybetű-érzéketlenné tenni: attól a
  // nagybetűs osztályok kisbetűre is illeszkednének, és minden köznév névvé válna.
  const roleAlt = ROLE_WORDS.map((w) => {
    const first = w[0]!;
    return escapeRe(w).replace(escapeRe(first), `[${first.toUpperCase()}${first.toLowerCase()}]`);
  })
    .join('|')
    .replace(/rendű/g, 'rend[űu]');
  const fieldRe = new RegExp(
    `^[ \\t]*((?:[IVX]+\\.?[ \\t]*(?:rend[űu]|r\\.)[ \\t]*)?(?:${roleAlt}))[ \\t]*:[ \\t]*(${FULL_NAME})`,
    'gm',
  );
  for (const m of text.matchAll(fieldRe)) {
    add({
      name: m[2]!.trim(),
      kind: 'person',
      role: normaliseRole(m[1]!),
      confidence: 0.97,
      evidence: `„${m[1]!.trim()}:" rovat`,
    });
  }

  // ── 2. Értelmező: „Kovács János felperes", „Nagy Péter I. rendű alperessel" ──
  const appoRe = new RegExp(
    // A név és a szerep közé az iratok gyakran zárójeles személyi adatokat
    // szúrnak: „Kovács János (születési hely és idő: …) felperesnek". Ezt át
    // kell ugrani, különben pont a főszereplőket veszítenénk el.
    // A zárójeles rész NEM léphet át sortörésen: enélkül a minta átugrana egy
    // címsoron és egy bekezdésen, és teljesen más helyről szedné a szerepet.
    `(${FULL_NAME})[ \\t]*(?:\\([^)\\n]{0,500}\\))?[ \\t]*(?:mint[ \\t]+)?((?:[IVX]+\\.?[ \\t]*(?:rend[űu]|r\\.)[ \\t]*)?(?:${roleAlt}))[a-záéíóöőúüű]{0,8}(?![${L}])`,
    'g',
  );
  for (const m of text.matchAll(appoRe)) {
    add({
      name: m[1]!.trim(),
      kind: 'person',
      role: normaliseRole(m[2]!),
      confidence: 0.93,
      evidence: `a név után „${m[2]!.trim()}" áll`,
    });
  }

  // ── 2b. Szerződéses fordulat: „Kovács János (adatok…) mint kölcsönadó" ──
  // A szerződések a felet zárójeles személyi adatokkal vezetik be, és a
  // szerepet a „mint" köti hozzá. Ez elég sajátos ahhoz, hogy külön minta
  // legyen: szűk, ezért nem téveszt.
  const asRoleRe = new RegExp(
    `(${FULL_NAME})[ \\t]*(?:\\([^)\\n]{0,700}\\))?[ \\t]*mint[ \\t]+(?:a[z]?[ \\t]+)?((?:${roleAlt}))`,
    'g',
  );
  for (const m of text.matchAll(asRoleRe)) {
    add({
      name: m[1]!.trim(),
      kind: 'person',
      role: normaliseRole(m[2]!),
      confidence: 0.96,
      evidence: `„mint ${m[2]!.trim()}" fordulat`,
    });
  }

  // ── 3. „anyja neve:" — mindig személynév, és mindig érzékeny ─────────
  // A rovat neve ritkán áll a tankönyvi alakjában. Az űrlapokon és a
  // táblázatcellákban rövidítve („an.:", „a. n.:"), a kettőspont néha elmarad,
  // az anyakönyvi iratokban pedig „anyja születési neve" áll. Ha a rovatot nem
  // ismerjük fel, a NÉV magát a modell még megtalálja — de a SZEREP elveszik,
  // és ez az egyik legérzékenyebb adat: az „egyéb" kategóriára bízni hiba.
  const motherRe = new RegExp(
    `(?:anyja[ \\t]+(?:születési[ \\t]+)?neve|anyja[ \\t]+neve|szül\\.[ \\t]*anyja[ \\t]+neve|` +
      `an\\.|a\\.[ \\t]*n\\.)[ \\t]*:?[ \\t]*(${NAME_WORD}(?:[ \\t]+${NAME_WORD}){1,2})`,
    'g',
  );
  for (const m of text.matchAll(motherRe)) {
    add({
      name: m[1]!.trim(),
      kind: 'person',
      role: 'anyja neve',
      confidence: 0.95,
      evidence: '„anyja neve:" rovat',
    });
  }

  // ── 4. Megszólítás: „Kovács úr", „Szabó asszony" ────────────────────
  // Csak jelzésként: a vezetéknévből nem tudunk teljes nevet csinálni,
  // de ha máshol megvan a teljes név, ez megerősíti.
  const honorRe = new RegExp(`(${NAME_WORD})[ \\t]+(úr|asszony|kisasszony)(?![${L}])`, 'g');
  const honorifics = new Set<string>();
  for (const m of text.matchAll(honorRe)) honorifics.add(m[1]!);

  // ── 5. Szervezetek: cégforma teszi egyértelművé ──────────────────────
  const orgRe = new RegExp(
    `((?:${NAME_WORD}|[A-ZÁÉÍÓÖŐÚÜŰ]{2,})(?:[ \\t]+(?:${NAME_WORD}|[A-ZÁÉÍÓÖŐÚÜŰ]{2,}|és)){0,4}[ \\t]+${COMPANY_FORM})`,
    'g',
  );
  for (const m of text.matchAll(orgRe)) {
    const name = m[1]!.trim();
    if (new RegExp(AUTHORITY).test(name)) continue;
    add({ name, kind: 'org', role: 'szervezet', confidence: 0.96, evidence: 'cégforma a név végén' });
  }

  // ── 6. Hatóságok és bíróságok: NEM felek, bent kell maradniuk ────────
  const authRe = new RegExp(`((?:${NAME_WORD}[ \\t]+){1,3}${AUTHORITY})`, 'g');
  for (const m of text.matchAll(authRe)) {
    keep.set(m[1]!.trim(), 'hatóság vagy bíróság — a törvény szerint nem anonimizálandó');
  }

  // ── 7. Eljáró ügyvéd, védő, bíró: Bszi. 166. § (2) szerint maradnak ──
  // A név és a szerep közé beékelődhet az aláírás jelölése. A magyar bírósági
  // határozat végén ez a szokásos alak: „dr. Vasvári Anikó s. k. bíró" — a
  // „s. k." (saját kezűleg) nélkül a bíró neve nem kerülne a megtartandók közé,
  // és félként cserélnénk le. Márpedig az eljáró bíró nevének a Bszi. 166. §
  // (2) szerint bent kell maradnia.
  const SIGNED = `(?:s\\.?[ \\t]*k\\.?[ \\t]*)?`;
  const lawyerRe = new RegExp(
    `(${TITLES}${NAME_WORD}(?:[ \\t]+${NAME_WORD}){1,2})[ \\t]+,?[ \\t]*${SIGNED}` +
      `(${KEEP_ROLE_AFTER})(?![${L}])`,
    'g',
  );
  for (const m of text.matchAll(lawyerRe)) {
    keep.set(m[1]!.trim(), `eljáró ${m[2]!.toLowerCase()} — a törvény szerint a neve bent marad`);
  }

  // ── 7b. Fordított szórend, kettősponttal: „A tanács elnöke: Kovács Anna" ──
  //
  // Az eddigi minta CSAK a „név, majd szerep" sorrendet ismerte, ezért a
  // magyar ítélet fejrészének szokásos rovatai kimaradtak. A tanács elnöke és
  // az ülnökök az eljáró bíróság tagjai: a nevüket a Bszi. 166. § (2) szerint
  // bent kell hagyni. Amíg ez a minta hiányzott, az ülnököt a nyelvi modell
  // hozta be félként — és mivel nem volt a megtartandó listán, LECSERÉLTÜK.
  //
  // A név több is lehet („Ülnökök: Kovács Anna, Szabó Béla"), ezért a rovat
  // vesszős felsorolást is elfogad.
  const keepFieldRe = new RegExp(
    `(?<![${L}])(?:[Aa][z]?[ \\t]+)?(?:[Ee]ljáró[ \\t]+)?(${KEEP_ROLE_BEFORE})(?![${L}])[ \\t]*:[ \\t]*` +
      `(${FULL_NAME}(?:[ \\t]*,[ \\t]*${FULL_NAME})*)`,
    'g',
  );
  for (const m of text.matchAll(keepFieldRe)) {
    const role = m[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const name of m[2]!.split(/[ \t]*,[ \t]*/)) {
      const cleaned = name.trim();
      // A rovatcímke többes számban áll („Ülnökök:"), az indoklás viszont egy
      // emberről szól — ezért egyes számra állítjuk vissza.
      if (cleaned) keep.set(cleaned, `eljáró ${role.replace(/ülnökök$/, 'ülnök')} — a törvény szerint a neve bent marad`);
    }
  }

  // Ügyvédi iroda ugyanígy.
  for (const m of text.matchAll(new RegExp(`((?:${NAME_WORD}[ \\t]+){0,2}Ügyvédi[ \\t]+Iroda)`, 'g'))) {
    keep.set(m[1]!.trim(), 'eljáró ügyvédi iroda — a neve bent marad');
  }

  // ── 8. Névelőtaggal álló nevek, amik máshonnan nem jöttek elő ────────
  const titledRe = new RegExp(
    `((?:dr\\.|Dr\\.|ifj\\.|id\\.|özv\\.|néhai)[ \\t]+${NAME_WORD}(?:[ \\t]+${NAME_WORD}){1,2})`,
    'g',
  );
  for (const m of text.matchAll(titledRe)) {
    add({
      name: m[1]!.trim(),
      kind: 'person',
      role: 'egyéb',
      confidence: 0.8,
      evidence: 'névelőtag (dr., ifj., özv.) előzi meg',
    });
  }

  // ── összeállítás ────────────────────────────────────────────────────
  const keepNames = new Set([...keep.keys()].map(normaliseName));
  const parties: DetectedParty[] = [];

  for (const c of candidates.values()) {
    const key = normaliseName(c.name);
    // Aki a megtartandó listán van (eljáró ügyvéd, bíró), az nem fél.
    if (keepNames.has(key)) continue;
    // A hatóságneveket sem soroljuk a felek közé.
    if (new RegExp(AUTHORITY).test(c.name)) continue;

    const occurrences = countOccurrences(text, c.name);
    let confidence = c.confidence;
    let evidence = c.evidence;
    const surname = c.name.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').split(/\s+/)[0];
    if (surname && honorifics.has(surname)) {
      confidence = Math.min(1, confidence + 0.02);
      evidence += `, és „${surname} úr/asszony" alakban is szerepel`;
    }

    parties.push({
      id: nextId(),
      kind: c.kind,
      fullName: c.name,
      gender: c.kind === 'person' ? guessGender(c.name) : 'N',
      role: c.role,
      confidence,
      evidence,
      occurrences,
    });
  }

  // Ragozott duplikátumok összevonása („dr. Bach Tivadart" = „dr. Bach Tivadar"),
  // majd előfordulás szerint: a legfontosabb szereplő kerüljön felülre.
  const merged = mergeInflected(parties.map((p) => ({ ...p, name: p.fullName }))).map(
    ({ name, ...rest }) => {
      void name;
      return rest as DetectedParty;
    },
  );
  merged.sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);

  const keepEntries = mergeInflected(
    [...keep.entries()].map(([name, why]) => ({ name: trimNonNameWords(name) || name, why })),
  );

  /*
    A MEGTARTANDÓ NEVEK KÉSZ FÉLKÉNT IS.

    Nem a felületen rakjuk össze, mert ott hiányzik hozzá az adat: a nem
    kitalálása (`guessGender`) és az előfordulás megszámolása a szöveget
    igényli, a szöveg pedig sosem hagyja el a főfolyamatot. Kikapcsolva ez a
    lista nem kerül sehova — a `keepList` marad az érvényes válasz.
  */
  const officials: DetectedParty[] = keepEntries.map((k) => {
    const szervezet = new RegExp(AUTHORITY).test(k.name) || /Ügyvédi[ \t]+Iroda/.test(k.name);
    return {
      id: nextId(),
      kind: szervezet ? ('org' as EntityKind) : ('person' as EntityKind),
      fullName: k.name,
      gender: szervezet ? ('N' as Gender) : guessGender(k.name),
      /*
        SZÁNDÉKOSAN „egyéb", nem az indoklásból vett szerep.

        A csereszöveg zárt szótárból való (`ROLE_VOCABULARY`, src/pseudonym.ts),
        és az „eljáró bíró" nincs benne — helyesen, hiszen az nem eljárási
        szerep a felek értelmében. Ha ide írnánk, a szerep-mód figyelmeztetést
        adna minden bíróra. Az „egyéb" a saját helykitöltőnk: némán az
        adatfajta nevére esik vissza.
      */
      role: szervezet ? 'szervezet' : 'egyéb',
      confidence: 1,
      evidence: k.why,
      occurrences: countOccurrences(text, k.name),
    };
  });

  return {
    parties: merged,
    keepList: keepEntries,
    officials,
    identifiers: detectAzonositok(text),
    // Ez az ág a modell NÉLKÜLI tartalék: itt a modell definíció szerint nem
    // futott. Ha a hívó tudja az okot (nincs telepítve, hiba), azt a
    // `detectParties` írja felül a saját visszatérési értékében.
    model: { state: 'off' },
  };
}

/**
 * Hivatalos azonosítók az iratban, félként kezelhető alakban.
 *
 * A felismerést a `hu/azonositok.ts` végzi; itt csak az adatmodellre képezzük
 * le. Két dolgot teszünk hozzá:
 *  1. Az átfedéseket FELOLDJUK. A "2000 Szentendre" nem versenytársa a
 *     "2000 Szentendre, Bükkös part 14." címnek, hanem a DARABJA — ha a
 *     rövidebbet vennénk fel, a cím másik fele bent maradna a kimenetben.
 *  2. Az azonos értékű előfordulásokat összevonjuk, mert egy adószám egyetlen
 *     adat akkor is, ha az irat hatszor leírja.
 */
export function detectAzonositok(text: string): DetectedParty[] {
  const merged = new Map<string, { hit: AzonositoMatch; occurrences: number }>();

  for (const h of resolveOverlaps(findAzonositok(text))) {
    // A kulcsban a fajta is benne van: ugyanaz a számsor lehet külön adószám
    // és külön bankszámlablokk, és a kettő más adatfajta-címkét kap.
    const key = `${h.kind}|${h.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { hit: h, occurrences: 1 });
      continue;
    }
    prev.occurrences++;
    // A magabiztosabb előfordulás magyarázata a hasznosabb: az egyik mellett
    // ott állt a címke ("adószáma:"), a másik mellett nem.
    if (h.confidence > prev.hit.confidence) prev.hit = h;
  }

  return [...merged.values()]
    .map(({ hit, occurrences }) => ({
      id: nextId(),
      kind: 'identifier' as EntityKind,
      fullName: hit.text,
      // Az azonosítónak nincs neme; a "szerep" helyén az adatfajta neve áll,
      // hogy a felületen látszódjon, MIT találtunk.
      gender: 'N' as Gender,
      role: AZONOSITO_NEV[hit.kind],
      identifierKind: hit.kind,
      confidence: hit.confidence,
      evidence: hit.reason,
      occurrences,
    }))
    .sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
}

/**
 * Igaz, ha ez a modell-találat valójában azonosító, nem név.
 *
 * Az `ai/types.ts` `label` mezője sokáig nem ismert azonosítót, ezért a
 * felismerő a `rawLabel`-be tette a fajtát, a `label`-be pedig 'place'-t vagy
 * 'other'-t. A 'place' ág a fájdalmas: a teljes lakcím így HELYSÉGKÉNT jelent
 * meg a felek listáján. Mindkét jelet nézzük, hogy a régi és az új alak is
 * fennakadjon rajta.
 */
function isIdentifierEntity(e: ExtractedEntity): boolean {
  return e.label === 'identifier' || e.rawLabel.startsWith('AZONOSITO:');
}

/** A név elejéről és végéről a biztosan nem névhez tartozó szavak levágása. */
function trimNonNameWords(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  while (parts.length > 0 && NOT_NAME_WORDS.has((parts[0] ?? '').toLowerCase().replace(/[^a-záéíóöőúüű]/g, ''))) {
    parts.shift();
  }
  while (
    parts.length > 0 &&
    NOT_NAME_WORDS.has((parts[parts.length - 1] ?? '').toLowerCase().replace(/[^a-záéíóöőúüű]/g, ''))
  ) {
    parts.pop();
  }
  // Névelőtag után legalább két névelemnek kell maradnia.
  const bare = parts.filter((p) => !/^(?:prof\.|dr\.|Dr\.|DR\.|ifj\.|id\.|özv\.|néhai)$/i.test(p));
  return bare.length >= 2 ? parts.join(' ') : '';
}

/**
 * Ragozott alakok összevonása. A szövegben „dr. Bach Tivadart" is előfordul;
 * ez ugyanaz a személy, mint a „dr. Bach Tivadar". Ha az egyik név a másik
 * eleje, és a többlet legfeljebb néhány kisbetű, akkor a rövidebbet tartjuk meg.
 */
function mergeInflected<T extends { name: string }>(items: T[]): T[] {
  // A névelőtagot is levesszük az összevetéshez: „dr. Bach Tivadart" és
  // „Bach Tivadar" ugyanaz az ember.
  const key = (s: string): string => normaliseName(s);
  const sorted = [...items].sort((a, b) => key(a.name).length - key(b.name).length);
  const kept: T[] = [];
  const paradigms = new Map<string, Set<string>>();

  for (const item of sorted) {
    const a = key(item.name);
    const dup = kept.find((k) => {
      const b = key(k.name);
      if (a === b) return true;
      let forms = paradigms.get(b);
      if (!forms) {
        forms = samePersonForms(k.name);
        paradigms.set(b, forms);
      }
      return forms.has(a);
    });
    if (!dup) kept.push(item);
  }
  return kept;
}

/**
 * Egy név összes olyan alakja, ami UGYANARRA a személyre utal.
 *
 * A „-né" szándékosan hiányzik: az nem rag, hanem képző, és MÁSIK EMBERT jelöl.
 * A korábbi közelítés — „ha az egyik név a másik eleje, és a többlet legfeljebb
 * néhány kisbetű" — a „Kovács Jánosné"-t a „Kovács János" ragozott alakjának
 * vette, és összevonta a kettőt. Az asszony így a férje fedőnevét kapta volna,
 * a saját neve pedig vagy bent marad, vagy férfinévre cserélődik. Ezért itt
 * nem betűket számolunk, hanem a toldalékoló motort kérdezzük meg.
 */
function samePersonForms(name: string): Set<string> {
  const bare = name.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').trim();
  const out = new Set<string>();
  if (!bare) return out;
  try {
    const p = buildParadigm(bare);
    for (const tag of ALL_CASES) {
      if (tag === 'WIFE') continue; // más ember
      const form = p[tag];
      if (form) out.add(normaliseName(form));
    }
  } catch {
    out.add(normaliseName(bare));
  }
  return out;
}

/** Kulcs az azonos nevek összevonásához: névelőtag és kisbetű nélkül. */
function normaliseName(name: string): string {
  return name
    .replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // A cégforma pontja hol ott van, hol nem („Kft" / „Kft."); ne csináljunk
    // belőle két külön szervezetet.
    .replace(/[.,;:]+$/, '')
    .trim();
}

function countOccurrences(text: string, name: string): number {
  const bare = name.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').trim();
  if (!bare) return 0;
  // A ragozott alakok miatt a tő előfordulásait számoljuk, nem a pontos egyezést.
  const stem = bare.split(/\s+/)[0] ?? bare;
  const re = new RegExp(`(?<![${L}])${escapeRe(stem)}`, 'g');
  return (text.match(re) ?? []).length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ──────────────── a modell és a szerkezet összefésülése ──────────────── */

/**
 * A modell nyers találataiból felek, a szerkezetből szerep.
 *
 * A modell ragozott alakokat is visszaad („Nagy Pétert", „Kovácsnak"). Ezeket
 * egy félbe vonjuk össze, és a leghosszabb, alanyesetűnek látszó alakot
 * választjuk kanonikusnak — abból tudja majd a kereső a teljes paradigmát
 * legyártani.
 */
function mergeModelWithRules(
  text: string,
  rules: DetectionResult,
  entities: ExtractedEntity[],
  homonyms: Set<string>,
  opts: DetectOptions,
): DetectionResult {
  /**
   * Amit a modelltől kaptunk, de nem tudtunk mire használni — NYERS CÍMKE
   * szerint számolva.
   *
   * Eddig ezek némán tűntek el: a `continue` sem naplót, sem számlálót nem
   * hagyott maga után, vagyis a program pont arról hallgatott, amit nem
   * értett. Ha egy iratban tíz találat esik ki „MISC" címkével, azt a
   * felhasználónak tudnia kell — lehet, hogy pont a keresett adat volt.
   */
  const dropped = new Map<string, number>();
  const drop = (label: string): void => {
    dropped.set(label, (dropped.get(label) ?? 0) + 1);
  };

  // A megtartandó neveket UGYANAZZAL a kulccsal kell nyilvántartani, amivel a
  // modell találatait csoportosítjuk — különben a „dr. Sárközi Tamás" ügyvéd a
  // modell „Sárközi Tamás" alakjával nem találkozik, és félként jelenne meg.
  const keepKeys = new Set<string>();
  for (const k of rules.keepList) {
    keepKeys.add(normaliseName(k.name));
    const asPerson = clusterKey(k.name, 'person');
    if (asPerson) keepKeys.add(asPerson);
    const asOrg = clusterKey(k.name, 'org');
    if (asOrg) keepKeys.add(asOrg);
  }
  // A szerkezetből felismert feleket kétféle kulccsal is nyilvántartjuk. A
  // pontos név mellett a csoportkulcs azért kell, mert a modell ragos alakot is
  // adhat: a „Baloghné Fehér Ilonát" kanonikus alak a pontos névvel sosem
  // találkozna a „Baloghné Fehér Ilona" szabály-találattal, és a tanú kétszer
  // jelenne meg a listán — egyszer szerepkörrel, egyszer „egyéb"-ként.
  const byRule = new Map<string, DetectedParty>();
  for (const p of rules.parties) {
    byRule.set(normaliseName(p.fullName), p);
    const ck = clusterKey(p.fullName, p.kind);
    // A pontos név erősebb: csak akkor foglaljuk le a csoportkulcsot, ha még
    // szabad, különben két azonos vezetéknevű fél elfedné egymást.
    if (ck && !byRule.has(ck)) byRule.set(ck, p);
  }

  interface Cluster {
    forms: Map<string, number>;
    kind: EntityKind;
    scoreSum: number;
    count: number;
    singleTokenOnly: boolean;
    sentenceInitialOnly: boolean;
  }
  const clusters = new Map<string, Cluster>();

  for (const e of entities) {
    // Az azonosítót a `rules.identifiers` már tartalmazza — ugyanaz a
    // felismerő adta, ugyanarra a szövegre. Itt csak KI kell venni a
    // névcsoportosításból, különben a teljes lakcím helynévként lenne fél.
    if (isIdentifierEntity(e)) continue;
    // Az 'other' a modell szemétládája: se személy, se szervezet, se helység.
    // Nem tudunk belőle felet csinálni — de MEGSZÁMOLJUK, hogy a jegyzőkönyv
    // és a felület kimondhassa, hány találatot dobtunk el, és milyen címkével.
    if (e.label === 'other') {
      drop(e.rawLabel || 'other');
      continue;
    }
    const surface = e.text.trim();
    if (surface.length < 3) continue;

    const kind: EntityKind = e.label === 'person' ? 'person' : e.label === 'org' ? 'org' : 'place';
    const key = clusterKey(surface, kind);
    if (!key) continue;

    const c = clusters.get(key) ?? {
      forms: new Map<string, number>(),
      kind,
      scoreSum: 0,
      count: 0,
      singleTokenOnly: true,
      sentenceInitialOnly: true,
    };
    c.forms.set(surface, (c.forms.get(surface) ?? 0) + 1);
    c.scoreSum += e.score;
    c.count++;
    if (surface.includes(' ')) c.singleTokenOnly = false;
    if (!isSentenceInitial(text, e.start)) c.sentenceInitialOnly = false;
    clusters.set(key, c);
  }

  // Az önálló vezetéknevet beolvasztjuk a teljes névbe, ha ugyanabban az
  // iratban a teljes név is szerepel: „Kováccsal" ugyanaz az ember, mint
  // „Kovács János".
  //
  // A ragos alakot nem betű-egyezéssel ismerjük fel, hanem a toldalékoló
  // motorral: legyártjuk a vezetéknév mind a 21 esetét, és megnézzük, hogy az
  // önálló említés köztük van-e. Ez viszi át a magyar hasonulást is
  // („Kovács"+„-val" → „Kováccsal", „Kiss"+„-vel" → „Kiss-sel"), amit egy
  // előtag-összevetés nem tudna.
  //
  // Ha az önálló alak TÖBB teljes névhez is illik (két „Kovács" az iratban),
  // nem olvasztjuk be: ott embernek kell döntenie, melyikről van szó.
  // Előbb a RAGOS TELJES NEVEKET vonjuk össze. A csoportkulcs a név első hat
  // betűjéig lát, ezért a „Nagy Pétert" és a „Nagy Péternek" külön csoportba
  // esik — pedig ugyanaz az ember. Amíg ez így van, minden későbbi döntés
  // hamis kétértelműséget lát: a puszta „Balogh" két csoporthoz is illik
  // („Balogh Gábor" és „Balogh Gáborral"), holott azok egyugyanaz.
  //
  // Az összevonás itt is a toldalékoló motort kérdezi, nem betűket számol, így
  // a „-né" nem esik bele: az asszony külön ember marad.
  {
    const byCanon = [...clusters.entries()]
      .filter(([, c]) => c.kind === 'person')
      .map(([key, c]) => ({ key, c, canon: pickCanonical([...c.forms.entries()]) }))
      .sort((a, b) => a.canon.length - b.canon.length);

    const kept: { key: string; forms: Set<string> }[] = [];
    for (const item of byCanon) {
      const me = normaliseName(item.canon);
      const host = kept.find((k) => k.forms.has(me));
      if (host) {
        const h = clusters.get(host.key)!;
        for (const [form, n] of item.c.forms) h.forms.set(form, (h.forms.get(form) ?? 0) + n);
        h.scoreSum += item.c.scoreSum;
        h.count += item.c.count;
        if (!item.c.sentenceInitialOnly) h.sentenceInitialOnly = false;
        if (!item.c.singleTokenOnly) h.singleTokenOnly = false;
        clusters.delete(item.key);
      } else {
        kept.push({ key: item.key, forms: samePersonForms(item.canon) });
      }
    }
  }

  const surnameForms = new Map<string, Set<string>>();
  for (const [key, c] of clusters) {
    if (c.kind !== 'person' || !key.includes(' ')) continue;
    const surname = pickCanonical([...c.forms.entries()])
      .replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '')
      .split(/\s+/)[0];
    if (!surname || surname.length < 3) continue;
    let forms: Set<string>;
    try {
      forms = new Set(Object.values(buildParadigm(surname)).map((f) => f.toLowerCase()));
    } catch {
      forms = new Set([surname.toLowerCase()]);
    }
    forms.add(surname.toLowerCase());
    surnameForms.set(key, forms);
  }

  for (const [key, c] of [...clusters]) {
    if (c.kind !== 'person' || key.includes(' ')) continue;
    const mentions = [...c.forms.keys()].map((f) => f.toLowerCase());
    const hosts = [...surnameForms.entries()]
      .filter(([, forms]) => mentions.every((m) => forms.has(m)))
      .map(([k]) => k);
    if (hosts.length === 0) continue; // nem ismerjük fel: marad külön

    // Több jelölt esetén egy dolog számít: viselik-e UGYANAZT a vezetéknevet.
    // Ha igen — két Kovács az iratban —, akkor mindegy, melyikükről szól a
    // puszta „Kováccsal", mert a csere betűre ugyanaz lesz. Ha nem, embernek
    // kell eldöntenie, ezért nem nyúlunk hozzá.
    const surnameOf = (k: string): string =>
      (
        pickCanonical([...clusters.get(k)!.forms.entries()])
          .replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '')
          .split(/\s+/)[0] ?? ''
      ).toLowerCase();
    const surnames = new Set(hosts.map(surnameOf));
    if (surnames.size !== 1) continue;

    const target = hosts.sort((a, b) => clusters.get(b)!.count - clusters.get(a)!.count)[0]!;
    const host = clusters.get(target)!;
    for (const [form, n] of c.forms) host.forms.set(form, (host.forms.get(form) ?? 0) + n);
    host.scoreSum += c.scoreSum;
    host.count += c.count;
    clusters.delete(key);
  }

  const parties: DetectedParty[] = [];
  const usedRuleKeys = new Set<string>();

  for (const [key, c] of clusters) {
    const canonicalPeek = pickCanonical([...c.forms.entries()]);
    if (
      keepKeys.has(key) ||
      keepKeys.has(normaliseName(canonicalPeek)) ||
      keepKeys.has(clusterKey(canonicalPeek, c.kind) ?? "")
    ) {
      continue; // eljáró ügyvéd, bíró, bíróság, ügyvédi iroda: nem fél
    }

    const canonical = pickCanonical([...c.forms.entries()]);
    const ruleHit = byRule.get(key) ?? byRule.get(normaliseName(canonical));
    if (ruleHit) usedRuleKeys.add(normaliseName(ruleHit.fullName));

    let confidence = c.scoreSum / c.count;
    let evidence = `a nyelvi modell találta (${c.count}×)`;
    if (ruleHit) {
      // A szerkezet megerősíti: ez a legerősebb eset.
      confidence = Math.min(1, Math.max(confidence, ruleHit.confidence) + 0.03);
      evidence = `${ruleHit.evidence}, és a nyelvi modell is megtalálta`;
    }

    // A mért hibamód: egy mondatkezdő, köznévvel azonos alakú, EGYSZAVAS
    // „személynév" majdnem biztosan melléknév. A modell ezt magas
    // magabiztossággal állítja, ezért küszöbbel nem szűrhető — csak így.
    const isAdjectiveTrap =
      c.kind === 'person' &&
      c.singleTokenOnly &&
      c.sentenceInitialOnly &&
      homonyms.has(canonical.toLowerCase());
    if (isAdjectiveTrap && !ruleHit) {
      confidence = Math.min(confidence, 0.3);
      evidence = 'a nyelvi modell névnek jelölte, de köznévvel azonos alakú és mondat elején áll';
    }

    parties.push({
      id: nextId(),
      kind: c.kind,
      fullName: canonical,
      gender: c.kind === 'person' ? (ruleHit?.gender ?? guessGender(canonical)) : 'N',
      role: ruleHit?.role ?? (c.kind === 'org' ? 'szervezet' : 'egyéb'),
      confidence,
      evidence,
      occurrences: countOccurrences(text, canonical),
    });
  }

  // Amit csak a szerkezet talált meg (a modell kihagyta) — ez is fél.
  for (const p of rules.parties) {
    if (usedRuleKeys.has(normaliseName(p.fullName))) continue;
    if (keepKeys.has(normaliseName(p.fullName))) continue;
    parties.push({ ...p, evidence: `${p.evidence} (a modell nem jelölte)` });
  }

  const merged = mergeInflected(parties.map((p) => ({ ...p, name: p.fullName }))).map(({ name, ...rest }) => {
    void name;
    return rest as DetectedParty;
  });
  merged.sort((a, b) => b.occurrences - a.occurrences || b.confidence - a.confidence);

  return {
    parties: merged,
    keepList: rules.keepList,
    // A megtartandó neveket a SZERKEZET ismeri fel (rovat, aláírás, cégforma);
    // a modell ezen a listán nem változtat, csak a felek körén.
    officials: rules.officials,
    identifiers: rules.identifiers,
    model: modelStatus(opts, entities.length, dropped),
  };
}

/**
 * Összevonási kulcs: a ragozott alakokat egy félbe soroljuk.
 * Személynél az első két névelem töve, szervezetnél az első szó töve elég.
 */
function clusterKey(surface: string, kind: EntityKind): string | null {
  const bare = surface.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').trim();
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (kind === 'person') {
    // A tő az első 5-6 betű: ez a ragozáson és a -né képzőn is átvisz.
    return words
      .slice(0, 2)
      .map((w) => w.toLowerCase().slice(0, 6))
      .join(' ');
  }
  return (words[0] ?? '').toLowerCase().slice(0, 7);
}

/**
 * A legjobb kanonikus alak: a legtöbb szóból álló, azon belül a LEGRÖVIDEBB.
 *
 * A két szempont külön-külön hibás, együtt viszont pontos. A legtöbb szó azért
 * kell, hogy a teljes név nyerjen a puszta vezetéknév helyett („Kiss Erika", ne
 * „Kiss"). A legrövidebb pedig azért, mert a magyar hátul told: ugyanannyi
 * szóból a ragozatlan alany eset a legrövidebb — „Kovács Jánosné", nem „Kovács
 * Jánosnéval". Ha csak a hosszúságra mennénk, a ragos alak nyerne, és a
 * felek listáján „Kovács Jánosnéval" jelenne meg névként.
 */
function pickCanonical(forms: [string, number][]): string {
  const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
  const maxWords = Math.max(0, ...forms.map(([f]) => words(f)));
  const best = forms
    .filter(([f]) => words(f) === maxWords)
    .sort((a, b) => a[0].length - b[0].length || b[1] - a[1]);
  return best[0]?.[0] ?? forms[0]?.[0] ?? '';
}

function isSentenceInitial(text: string, pos: number): boolean {
  const before = text.slice(Math.max(0, pos - 4), pos);
  return before === '' || /(^|[.!?:;])\s*$/.test(before) || /\n\s*$/.test(before);
}
