/**
 * Ellenőrző kör a KIMENETEN.
 *
 * A felmérés szerint ez a funkció az, ami egy jogi célra használható eszközt
 * megkülönböztet a játékszertől: a kész fájlt újra beolvassuk, és megnézzük,
 * maradt-e benne bármi az eredetiből. Amíg ez nem tiszta, az exportot tiltjuk.
 *
 * Három külön ellenőrzés fut:
 *  1. Célzott: a megadott felek minden ragozott alakjára rákeresünk a kimenetben.
 *     Bármi találat = szivárgás, nem gyanú. Egyetlen kivétel a `reviewedKept`:
 *     amit a felhasználó tételesen átnézett és bent hagyott, az a maradványok
 *     közé kerül, nem a szivárgások közé — enélkül a köznévvel azonos alakú
 *     vezetéknevek (Nagy, Szabó, Fehér) miatt a jelentés SOHA nem tisztulhat ki.
 *  2. Számformátumú azonosítók: adóazonosító, TAJ, IBAN, bankszámla, adószám,
 *     ügyszám. Ez a kör önálló, mert a nagybetűs szókeresés természeténél fogva
 *     vak a számokra: egy bent maradt adóazonosító korábban nem is jelöltként
 *     bukott el, hanem SOHA nem került a keresés látókörébe, és a jegyzőkönyv
 *     „tiszta" minősítést írt egy azonosítót tartalmazó iratra.
 *  3. Söprő: minden nagybetűs szó, ami nem álnév, nem mondatkezdő és nincs a
 *     megtartandó listán, gyanús maradványként az átnézési listára kerül.
 */

import { HU_LETTER_CLASS, isHuLetter } from './hu/phonology.js';
import { SeedMatcher } from './hu/matcher.js';
import type { SeedEntity } from './hu/names.js';

export interface Leak {
  kind: 'entity' | 'identifier' | 'suspicious_token' | 'suspicious_number';
  start: number;
  end: number;
  surface: string;
  entityId?: string;
  /** Számformátumú találatnál a minta megnevezése ("adóazonosító jel"). */
  label?: string;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  /** Biztos szivárgás: az eredeti fél neve vagy azonosítója megvan a kimenetben. */
  leaks: Leak[];
  /**
   * Gyanús maradvány: emberi átnézést igényel, de nem biztos hiba.
   *
   * Ez a lista LEVÁGOTT — legfeljebb `residualLimit` elem. A teljes darabszám a
   * `residualTotal`, e nélkül a felület a levágás utáni hosszt mutatta, vagyis a
   * csonkolás maga sem derült ki: 137 maradványból 40 látszott, és a képernyőn
   * a „40" szám állt.
   */
  residual: Leak[];
  /** A maradványok TELJES száma, a levágás előtt. */
  residualTotal: number;
  checkedChars: number;
}

/** Számformátumú találat leírója a jegyzőkönyvhöz. */
export interface NumericContext {
  text: string;
  start: number;
  end: number;
}

/**
 * Egy számformátumú azonosító felismerője.
 *
 * A hívó a sajátjait is átadhatja (ügyszám, cégjegyzékszám, rendszám,
 * okmányazonosító), ezért ez nyilvános típus. A minta CSAK magát az azonosítót
 * írja le; a szóhatárt nem kell belefogalmazni, azt a keresés a szomszédos
 * karakter fajtájából dönti el.
 */
export interface NumericPattern {
  /** A jegyzőkönyvben megjelenő megnevezés, magyarul. */
  label: string;
  pattern: RegExp;
  /**
   * Utólagos szűrő, ha a puszta alak nem elég a döntéshez (pl. a szám után
   * „Ft" áll, tehát összeg és nem azonosító).
   */
  accept?: (surface: string, ctx: NumericContext) => boolean;
  /**
   * 'leak' = biztos szivárgás, tiltja az exportot. Csak akkor, ha a minta
   * KONKRÉT, az eredeti iratból ismert azonosítót ír le. Alapértelmezés:
   * 'residual', vagyis emberi átnézésre kerül.
   */
  severity?: 'leak' | 'residual';
}

export interface NumericHit {
  start: number;
  end: number;
  surface: string;
  label: string;
  severity: 'leak' | 'residual';
}

export interface VerifyOptions {
  /** Álnevek, amik jogosan szerepelnek a kimenetben. */
  pseudonyms: string[];
  /**
   * Nevek, amiknek BENT KELL maradniuk: eljáró bíró, ügyvéd, hivatalos
   * minőségben eljáró közszereplő, a bíróság neve (Bszi. 166.§ (2)).
   *
   * A hívónak EZT ÁT KELL ADNIA. Enélkül az eljáró ügyvéd és bíró neve
   * riasztásként jelenik meg, és a zaj miatt a felhasználó a valódi találatokat
   * is átugorja — a lista hiánya tehát nem óvatosság, hanem kockázat.
   */
  keepList?: string[];
  /** Szavak, amikről tudjuk, hogy nem személynevek (Ptk., Kúria, hónapnevek...). */
  safeWords?: string[];
  /**
   * Az EREDETI irat számformátumú azonosítói (adóazonosító, TAJ, bankszámla,
   * ügyszám). Ezek találata biztos szivárgás, nem gyanú. A tagolás nem számít:
   * a „8442130976" a „8442 130 976" alakot is megtalálja.
   */
  numericLiterals?: string[];
  /**
   * További felismerők a beépítettek mellé. Ide adható be egy külön modul
   * kimenete is, anélkül hogy ez a fájl függene tőle.
   */
  numericPatterns?: NumericPattern[];
  /** Hamis érték esetén a beépített alapkészlet nem fut. Alapértelmezés: fut. */
  builtinNumericPatterns?: boolean;
  /**
   * Számformátumú alakok, amik jogosan maradnak bent: jogszabályhely,
   * összeg, a bíróság ügyszáma, a szolgáltató számlaszáma.
   */
  keepNumbers?: string[];
  /** Legfeljebb ennyi maradvány kerüljön a listára. A teljes szám: `residualTotal`. */
  residualLimit?: number;
  /**
   * Előfordulások, amiket a felhasználó ÁTNÉZETT, és tudatosan bent hagyott.
   *
   * Ezek nélkül a jelentés nem volt kitisztítható olyan iraton, ahol egy fél
   * vezetékneve köznév is: a „Nagy összegű", a „Szabó mesterségét" és a „Fehér
   * színű" ugyanaz a karaktersor, mint Nagy Péter, Szabó Márton és Baloghné
   * Fehér Ilona neve. A célzott kör ezeket megtalálja, és mivel „bármi találat
   * = szivárgás", a jegyzőkönyv AKKOR IS bennmaradt nevet írt, ha a jogász már
   * minden egyes találatot végigdöntött. A leggyakoribb magyar vezetéknevek
   * (Nagy, Kis, Szabó, Fehér, Vörös, Balog, Bíró, Király) mind köznevek is,
   * tehát ez nem sarokeset: a „tiszta" minősítés gyakorlatilag elérhetetlen
   * volt, és egy soha ki nem tisztuló riasztást a felhasználó megtanul átlapozni.
   *
   * CSAK a kifejezett emberi döntés tartozik ide. Az EL NEM DÖNTÖTT találat
   * továbbra is kemény szivárgás — a hallgatás nem jóváhagyás.
   *
   * A tétel nem tűnik el: a maradványlistára kerül, tehát látható marad. A
   * darabszám is számít — ha három „Szabó"-t hagytak bent, de a kimenetben öt
   * van, a maradék kettő szivárgásként bukik el.
   */
  reviewedKept?: { entityId: string; surface: string }[];
}

/**
 * Alapértelmezett levágás. Azért pont ennyi, mert a felület ennyit jelenít meg
 * kényelmesen; a `residualTotal` mindig a teljes igazságot mondja.
 */
export const DEFAULT_RESIDUAL_LIMIT = 40;

/** Nagybetűvel kezdődő szavak, amik magyar jogi szövegben nem nevek. */
const DEFAULT_SAFE_WORDS = [
  'A', 'Az', 'Ez', 'Ezt', 'Ezen', 'Így', 'Ha', 'Mivel', 'Ugyanakkor', 'Továbbá', 'Végül',
  'Tekintettel', 'Figyelemmel', 'Ennek', 'Erre', 'Amennyiben', 'Mindezek', 'Ezért', 'Ehhez',
  'Ptk', 'Pp', 'Btk', 'Be', 'Bszi', 'Itv', 'Áfa', 'Áht', 'Ket', 'Ákr', 'Üttv', 'Gdpr', 'GDPR',
  'Kúria', 'Ítélőtábla', 'Törvényszék', 'Járásbíróság', 'Bíróság', 'Alkotmánybíróság',
  'Magyarország', 'Magyar', 'Nemzeti', 'Országos', 'Bírósági', 'Hivatal', 'Alaptörvény',
  'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
  'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December',
  'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap',
  'Ft', 'HUF', 'EUR', 'Kft', 'Zrt', 'Bt', 'Nyrt', 'Kkt',
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
];

const CAPITALIZED = new RegExp(
  `(?<![${HU_LETTER_CLASS}0-9])([A-ZÁÉÍÓÖŐÚÜŰ][${HU_LETTER_CLASS}]{2,})`,
  'g',
);

/**
 * Rövidítések, amik után a pont NEM mondatvég.
 *
 * A „dr." utáni pontot a korábbi változat mondatvégnek nézte. Ennek az volt a
 * következménye, hogy a bíró VEZETÉKNEVÉT mondatkezdőként átugrotta, a
 * keresztnevét viszont maradványként jelentette: ugyanaz a név egyszerre volt
 * láthatatlan és zajos.
 *
 * A „stb." és az „ill." valódi mondat végén is állhat; ilyenkor a következő szó
 * fölöslegesen kerül az átnézési listára. Ez tudatos csere: az ellenőrző körben
 * a fölösleges riasztás olcsó, a kihagyott név drága.
 */
const NOT_SENTENCE_END = new Set(['dr', 'ifj', 'id', 'özv', 'stb', 'ill', 'pl', 'prof']);

/** A számjegyek közé beékelődő tagolás, amit az azonosítókban látunk. */
const IDENTIFIER_SEPARATOR = '[\\s.\\-/]*';

/**
 * Az azonosító „érdemi" karaktere: szám vagy betű. Az ékezetes betűk is
 * beletartoznak — nem azért, mert az azonosítókban gyakoriak, hanem hogy egy
 * ékezetes karakter ne HULLJON KI némán a keresőmintából, mert akkor a minta
 * a nélküle álló alakra is illeszkedne.
 */
const IDENTIFIER_CHAR = new RegExp(`[0-9${HU_LETTER_CLASS}]`);
const NOT_IDENTIFIER_CHAR = new RegExp(`[^0-9${HU_LETTER_CLASS}]`, 'g');

/**
 * Ennél rövidebb alakot nem keresünk konkrét azonosítóként. A valódi
 * azonosítók (TAJ 9, adóazonosító 10, bankszámla 24 jegy) mind hosszabbak,
 * egy négyjegyű szám viszont évszámként a szöveg minden során illeszkedne.
 */
const MIN_IDENTIFIER_CHARS = 6;

/**
 * Összeget jelző utótag: ha ez áll a szám után, nem azonosító.
 *
 * A jogi iratok tele vannak tagolt összegekkel („123 456 789 Ft"), ami alakilag
 * megkülönböztethetetlen egy tagolt TAJ-számtól. A pénznem viszont eldönti —
 * enélkül az átnézési lista minden összeggel megtelne.
 */
const AMOUNT_TAIL = /^\s*(?:,-)?\s*(?:Ft|HUF|EUR|USD|forint|euró)/i;

function notAnAmount(_surface: string, ctx: NumericContext): boolean {
  return !AMOUNT_TAIL.test(ctx.text.slice(ctx.end, ctx.end + 16));
}

/**
 * A legfontosabb magyar számformátumú azonosítók.
 *
 * Szándékosan NINCS bennük ellenőrzőösszeg-számítás (adóazonosító CDV, IBAN
 * mod-97). Az ellenőrző kör az utolsó védvonal: itt a téves riasztás olcsó
 * (egy sor az átnézési listán), a kimaradó találat viszont kikerül a kész
 * iratba. Egy elgépelt vagy OCR-ből származó azonosító ugyanolyan azonosító.
 */
export const BUILTIN_NUMERIC_PATTERNS: NumericPattern[] = [
  { label: 'adóazonosító jel', pattern: /\d{10}/g, accept: notAnAmount },
  // A TAJ-szám tagolva is szokásos: „111 111 110".
  { label: 'TAJ-szám', pattern: /\d{9}|\d{3}[ .]\d{3}[ .]\d{3}/g, accept: notAnAmount },
  // A pénzforgalmi jelzőszám 8-8 vagy 8-8-8 tagolású; a hosszabb alak nyer.
  { label: 'bankszámlaszám', pattern: /\d{8}-\d{8}(?:-\d{8})?/g },
  { label: 'adószám', pattern: /\d{8}-\d-\d{2}/g },
  // IBAN: országkód + két ellenőrző jegy + négyes csoportok, szóközzel vagy anélkül.
  { label: 'IBAN', pattern: /[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?/g },
];

export function verifyOutput(
  output: string,
  originalEntities: SeedEntity[],
  opts: VerifyOptions,
): VerifyReport {
  const leaks: Leak[] = [];
  const residual: Leak[] = [];

  // 1. Célzott keresés: az eredeti nevek bármely alakja a kimenetben hiba —
  //    KIVÉVE, amit a felhasználó átnézett és tudatosan bent hagyott.
  //
  // A „bent hagyott" keret darabszámra megy: minden felhasznált tétel elfogy.
  // Így ha három „Szabó"-ról döntöttek, a negyedik már szivárgás.
  const keptBudget = new Map<string, number>();
  for (const k of opts.reviewedKept ?? []) {
    const key = keptKey(k.entityId, k.surface);
    keptBudget.set(key, (keptBudget.get(key) ?? 0) + 1);
  }

  // Minden célzott találat ide is bekerül, akár szivárgás lett, akár bent
  // hagyott előfordulás. A későbbi körök ezzel néznek átfedést, különben a
  // bent hagyott tételt a söprő kör MÉG EGYSZER felvenné a maradványok közé.
  const entitySpans: Leak[] = [];

  const matcher = new SeedMatcher(originalEntities);
  for (const m of matcher.find(output)) {
    const key = keptKey(m.entityId, m.surface);
    const budget = keptBudget.get(key) ?? 0;
    const hit: Leak = {
      kind: 'entity',
      start: m.start,
      end: m.end,
      surface: m.surface,
      entityId: m.entityId,
      detail: `az eredeti fél neve megmaradt a kimenetben (${m.reason})`,
    };
    entitySpans.push(hit);
    if (budget > 0) {
      keptBudget.set(key, budget - 1);
      residual.push({
        ...hit,
        kind: 'suspicious_token',
        detail:
          'a felhasználó átnézte és tudatosan bent hagyta — a szövegkörnyezet szerint ' +
          `nem a fél neve, hanem köznév (${m.reason})`,
      });
      continue;
    }
    leaks.push(hit);
  }

  // 2. Számformátumú azonosítók.
  const keepNumbers = new Set<string>();
  for (const n of opts.keepNumbers ?? []) keepNumbers.add(identifierKey(n));
  // A saját cseréinket ne jelentsük magunk ellen: ha egy álnév vagy egy
  // beszámozott címke számot is tartalmaz, az a kimenet jogos része. Az egész
  // alakot és a számot tartalmazó szavakat is felvesszük, mert a minta
  // illeszkedhet a teljes álnévre és annak egyetlen darabjára is.
  for (const p of opts.pseudonyms) {
    for (const part of [p, ...p.split(/\s+/)]) {
      if (/\d/.test(part)) keepNumbers.add(identifierKey(part));
    }
  }

  // A konkrét, iratból ismert azonosítók elöl állnak, hogy átfedésnél ŐK
  // nyerjenek az általános minták ellenében — így a jegyzőkönyvbe a biztos
  // szivárgás kerül, nem a gyanú.
  const numericPatterns: NumericPattern[] = [
    ...literalPatterns(opts.numericLiterals ?? []),
    ...(opts.builtinNumericPatterns === false ? [] : BUILTIN_NUMERIC_PATTERNS),
    ...(opts.numericPatterns ?? []),
  ];

  const numericResidual: Leak[] = [];
  for (const hit of findNumericIdentifiers(output, numericPatterns)) {
    if (keepNumbers.has(identifierKey(hit.surface))) continue;
    if (overlapsAny(entitySpans, hit.start, hit.end)) continue;
    if (hit.severity === 'leak') {
      leaks.push({
        kind: 'identifier',
        start: hit.start,
        end: hit.end,
        surface: hit.surface,
        label: hit.label,
        detail: `az irat eredeti azonosítója megmaradt a kimenetben (${hit.label})`,
      });
    } else {
      numericResidual.push({
        kind: 'suspicious_number',
        start: hit.start,
        end: hit.end,
        surface: hit.surface,
        label: hit.label,
        detail: `számformátumú azonosító maradt a szövegben (${hit.label})`,
      });
    }
  }

  // 3. Söprő ellenőrzés a maradék nagybetűs szavakra.
  //
  // Mindhárom forrás UGYANAZON a kapun megy be, és a keresés is ugyanazt a
  // kaput használja. Korábban a két oldal két különböző alakra normalizált: a
  // lista a teljes szót tárolta, a keresés viszont hatkarakteres tővel
  // hasonlított, ezért a hosszabb tételek („Törvényszék", „Alkotmánybíróság",
  // „Szeptember") SOHA nem illeszkedtek. A szűrő némán nem szűrt.
  const known = new Set<string>();
  for (const p of opts.pseudonyms) addKnown(known, p);
  for (const k of opts.keepList ?? []) addKnown(known, k);
  for (const s of [...DEFAULT_SAFE_WORDS, ...(opts.safeWords ?? [])]) addKnown(known, s);

  CAPITALIZED.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CAPITALIZED.exec(output)) !== null) {
    const token = m[1]!;
    const start = m.index;
    if (isKnown(known, token)) continue;
    // A szögletes zárójeles címkék ([NÉV-1], [lakcím]) a mi cseréink, nem maradványok.
    if (output[start - 1] === '[') continue;
    if (isSentenceStart(output, start)) continue;
    if (overlapsAny(entitySpans, start, start + token.length)) continue;
    residual.push({
      kind: 'suspicious_token',
      start,
      end: start + token.length,
      surface: token,
      detail: 'mondaton belüli nagybetűs szó, ami nem álnév és nincs a megtartandó listán',
    });
  }

  // A számformátumú maradványok ELÖL állnak: ha a lista levágásra kerül, a
  // magasabb kockázatú tételek maradjanak bent. Azon belül pozíció szerint,
  // mert az átnézés a dokumentumot végigolvasva történik.
  const allResidual = [...numericResidual, ...residual].sort((a, b) => {
    const rank = (l: Leak): number => (l.kind === 'suspicious_number' ? 0 : 1);
    return rank(a) - rank(b) || a.start - b.start;
  });
  const limit = opts.residualLimit ?? DEFAULT_RESIDUAL_LIMIT;

  return {
    ok: leaks.length === 0,
    leaks,
    residual: allResidual.slice(0, limit),
    residualTotal: allResidual.length,
    checkedChars: output.length,
  };
}

/**
 * Számformátumú azonosítók keresése.
 *
 * Külön, nyilvános függvény, mert a szóhatárt itt NEM a betűosztállyal kell
 * nézni: a „8442130976" határát a szomszédos SZÁMJEGY dönti el. Enélkül egy
 * tizenhat jegyű kártyaszám belsejéből kihasítanánk egy tízjegyű
 * „adóazonosítót".
 */
export function findNumericIdentifiers(text: string, patterns: NumericPattern[]): NumericHit[] {
  const hits: NumericHit[] = [];

  for (const p of patterns) {
    // Mindig saját példánnyal futunk: a hívó mintája lehet globális jelző
    // nélkül (az exec ilyenkor örökké ugyanazt adná vissza), és lehet közös,
    // más hívásból örökölt lastIndex-szel is.
    const re = new RegExp(
      p.pattern.source,
      p.pattern.flags.includes('g') ? p.pattern.flags : `${p.pattern.flags}g`,
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const surface = m[0];
      if (surface === '') {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + surface.length;
      if (!hasIdentifierBoundary(text, start, end)) continue;
      if (p.accept && !p.accept(surface, { text, start, end })) continue;
      hits.push({ start, end, surface, label: p.label, severity: p.severity ?? 'residual' });
    }
  }

  // Átfedésnél a hosszabb találat nyer: a 8-8-8 bankszámlaszámot egészben
  // kell jelenteni, nem a benne lévő nyolcjegyű darabokat. Azonos hosszúságnál
  // a listán előrébb álló minta marad (a rendezés stabil), ezért állnak a
  // konkrét azonosítók a beépített minták előtt.
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: NumericHit[] = [];
  for (const h of hits) {
    if (kept.some((k) => k.start < h.end && h.start < k.end)) continue;
    kept.push(h);
  }
  return kept;
}

/**
 * Konkrét azonosító keresőmintája.
 *
 * A tagolás nem lehet része az összehasonlításnak: ugyanaz a bankszámlaszám
 * szerepelhet „10402142-49575354-56561008" és „10402142 49575354 56561008"
 * alakban is, az irat két különböző pontján. Ezért a karakterek KÖZÉ engedünk
 * tetszőleges elválasztót, magukat a karaktereket viszont kötjük.
 */
function literalPatterns(literals: string[]): NumericPattern[] {
  const out: NumericPattern[] = [];
  for (const literal of literals) {
    const chars = [...literal].filter((c) => IDENTIFIER_CHAR.test(c));
    if (chars.length < MIN_IDENTIFIER_CHARS) continue;
    out.push({
      label: literal.trim(),
      pattern: new RegExp(chars.join(IDENTIFIER_SEPARATOR), 'gi'),
      severity: 'leak',
    });
  }
  return out;
}

/** Tagolás és kis-nagybetű nélküli alak; ezen a szinten vetjük össze az azonosítókat. */
function identifierKey(s: string): string {
  return s.replace(NOT_IDENTIFIER_CHAR, '').toLowerCase();
}

/**
 * Szóhatár azonosítókhoz.
 *
 * Nem betűosztály és főleg nem az ASCII \b dönt, hanem az, hogy a szomszédos
 * karakter UGYANOLYAN fajta-e, mint a találat széle: számjegy mellett számjegy,
 * betű mellett betű folytatja a tokent. Így a „HU42..." előtti szóköz rendben
 * van, egy tizenegy jegyű számsorból viszont nem hasítunk ki tízjegyű darabot.
 */
function hasIdentifierBoundary(text: string, start: number, end: number): boolean {
  return (
    !sameKind(text[start - 1], text[start]!) && !sameKind(text[end], text[end - 1]!)
  );
}

function sameKind(neighbour: string | undefined, edge: string): boolean {
  if (neighbour === undefined) return false;
  if (isDigit(edge)) return isDigit(neighbour);
  if (isHuLetter(edge)) return isHuLetter(neighbour);
  return false;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * A leghosszabb magyar rag, amit a szűrő még letakar: „-éknak", „-jével".
 * Ennél többet levágni már nem tő, hanem találgatás.
 */
const MAX_SUFFIX = 5;

/**
 * Ennél rövidebb kulcsot nem veszünk fel. A „dr" kulcs prefixként a „Drótos"
 * vezetéknevet is elnémítaná — egy megszólítás nem takarhat el egy nevet.
 */
const MIN_KNOWN = 3;

/**
 * Egy megtartandó vagy biztonságos kifejezés felvétele a szűrőbe.
 *
 * Szavanként tároljuk a TELJES alakot: a ragozást a keresés oldalán oldjuk fel,
 * nem itt. Így a lista és a keresés ugyanazt az alakot látja.
 */
function addKnown(known: Set<string>, phrase: string): void {
  for (const word of phrase.split(/\s+/)) {
    const key = letterKey(word);
    if (key.length >= MIN_KNOWN) known.add(key);
  }
}

/**
 * Rajta van-e a szó a szűrőn.
 *
 * A magyar ragok miatt nem elég a pontos egyezés: a „Kőszikla" álnév a
 * kimenetben „Kősziklának" alakban is szerepelhet. A tő EGYSZERŰ CSONKOLÁSA
 * viszont kevés volt: a hatkarakteres tő a hosszú szavakat („Alkotmánybíróság")
 * és a rövid neveket („Ottó" → „Ottónak") egyaránt elvétette. Ezért a szó
 * végéről ragnyi darabokat veszünk le, és minden lépésben teljes alakra
 * keresünk.
 */
function isKnown(known: Set<string>, token: string): boolean {
  const t = letterKey(token);
  if (known.has(t)) return true;
  for (let cut = 1; cut <= MAX_SUFFIX; cut++) {
    const stem = t.slice(0, t.length - cut);
    if (stem.length < MIN_KNOWN) break;
    if (known.has(stem) || known.has(shortenFinalVowel(stem))) return true;
  }
  return false;
}

/**
 * A szóvégi a/e a rag előtt megnyúlik: „Kőszikla" → „Kősziklának". A levágott
 * tő ezért á/é-re végződik, a listán viszont a rövid alak áll.
 */
function shortenFinalVowel(stem: string): string {
  if (stem.endsWith('á')) return `${stem.slice(0, -1)}a`;
  if (stem.endsWith('é')) return `${stem.slice(0, -1)}e`;
  return stem;
}

/**
 * Kisbetűs, csak magyar betűkből álló alak; ezen a szinten vetjük össze a
 * szavakat. A kötőjel, a pont és a szám kiesik: a „Kft."-t és a „Kft"-t
 * ugyanannak kell látni.
 */
function letterKey(word: string): string {
  return word.toLowerCase().replace(/[^a-záéíóöőúüű]/g, '');
}

/**
 * Mondat elején áll-e a szó.
 *
 * Visszafelé olvassuk el a szóközöket az utolsó valódi karakterig. A korábbi
 * változat csak három karaktert nézett meg, és a mintát a kivágott darab
 * elejéhez horgonyozta — így három egymás utáni szóköz (PDF-ből kinyert
 * szövegben mindennapos) mondatkezdetnek számított, és a mögötte álló nevet
 * némán átugrotta.
 */
function isSentenceStart(text: string, pos: number): boolean {
  let i = pos - 1;
  let crossedNewline = false;
  while (i >= 0 && /\s/.test(text[i]!)) {
    if (text[i] === '\n') crossedNewline = true;
    i--;
  }
  if (i < 0) return true;
  // Új sor vagy bekezdés: a jogi iratokban a fejrészek és a felsorolások
  // pont nélkül is új mondatnak számítanak.
  if (crossedNewline) return true;
  const ch = text[i]!;
  if (ch === '.') return !endsWithAbbreviation(text, i);
  return ch === '!' || ch === '?' || ch === ':' || ch === ';';
}

function endsWithAbbreviation(text: string, dotPos: number): boolean {
  let i = dotPos - 1;
  while (i >= 0 && isHuLetter(text[i]!)) i--;
  return NOT_SENTENCE_END.has(text.slice(i + 1, dotPos).toLowerCase());
}

/**
 * A „bent hagyott" keret kulcsa. Az entitás ÉS a pontos felszíni alak együtt
 * azonosít: a „Szabó" bent hagyása nem hallgattathatja el a „Szabó Márton"
 * teljes nevet, és Nagy Péter döntése nem vonatkozhat Kiss Erikára.
 */
function keptKey(entityId: string, surface: string): string {
  return `${entityId} ${surface}`;
}

function overlapsAny(list: Leak[], start: number, end: number): boolean {
  return list.some((l) => l.start < end && start < l.end);
}
