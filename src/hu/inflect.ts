/**
 * Magyar névszói toldalékolás tulajdonnevekre.
 *
 * Ez a modul KÉT irányban használatos:
 *  1. előre: egy álnév minden ragozott alakjának legyártása (paradigma),
 *  2. visszafelé: a megadott valódi név minden lehetséges alakjának előállítása,
 *     hogy a szövegben meg tudjuk találni őket.
 *
 * Fontos tervezési döntés: ami a helyesírásból NEM vezethető le (idegen nevek
 * kiejtés szerinti -val/-vel hasonulása, néhány rendhagyó tárgyeset), az nem
 * szabály, hanem a névhez tartozó adat: `NameOverrides`. A szállított
 * témacsomagokban ezek előre ki vannak töltve és emberrel ellenőrizve, így
 * futásidőben nincs találgatás.
 */

import {
  type Harmony,
  archaicFinalSound,
  detectHarmony,
  endsInShortAE,
  finalConsonant,
  isBack,
  lengthenFinalAE,
  matchCase,
  needsCollisionHyphen,
} from './phonology.js';

export type CaseTag =
  | 'NOM' // alanyeset            Kovács
  | 'ACC' // tárgyeset -t         Kovácsot
  | 'DAT' // részes -nak/-nek     Kovácsnak
  | 'INS' // eszközhat. -val/-vel Kováccsal
  | 'INE' // -ban/-ben            Kovácsban
  | 'ILL' // -ba/-be              Kovácsba
  | 'ELA' // -ból/-ből            Kovácsból
  | 'SUP' // -on/-en/-ön/-n       Kovácson
  | 'SUB' // -ra/-re              Kovácsra
  | 'DEL' // -ról/-ről            Kovácsról
  | 'ADE' // -nál/-nél            Kovácsnál
  | 'ALL' // -hoz/-hez/-höz       Kovácshoz
  | 'ABL' // -tól/-től            Kovácstól
  | 'TER' // -ig                  Kovácsig
  | 'CAU' // -ért                 Kovácsért
  | 'FOR' // -ként                Kovácsként
  | 'TRANS' // -vá/-vé            Kováccsá
  | 'POSS' // -é                  Kovácsé
  | 'FAM' // -ék                  Kovácsék
  | 'PL' // -k/-ok/-ek/-ök       Kovácsok
  | 'WIFE'; // -né                 Kovács Jánosné

export const ALL_CASES: readonly CaseTag[] = [
  'NOM', 'ACC', 'DAT', 'INS', 'INE', 'ILL', 'ELA', 'SUP', 'SUB', 'DEL',
  'ADE', 'ALL', 'ABL', 'TER', 'CAU', 'FOR', 'TRANS', 'POSS', 'FAM', 'PL', 'WIFE',
];

/** Emberi olvasásra szánt magyar megnevezések a szereplap "Alak" oszlopához. */
export const CASE_LABELS_HU: Record<CaseTag, string> = {
  NOM: 'alanyeset',
  ACC: 'tárgyeset (-t)',
  DAT: 'részes eset (-nak/-nek)',
  INS: 'eszközhatározó (-val/-vel)',
  INE: 'belviszony (-ban/-ben)',
  ILL: 'irány (-ba/-be)',
  ELA: 'kiindulás (-ból/-ből)',
  SUP: 'felszíni (-on/-en/-ön)',
  SUB: 'rá (-ra/-re)',
  DEL: 'róla (-ról/-ről)',
  ADE: 'közelében (-nál/-nél)',
  ALL: 'felé (-hoz/-hez/-höz)',
  ABL: 'tőle (-tól/-től)',
  TER: 'határvető (-ig)',
  CAU: 'okhatározó (-ért)',
  FOR: 'módhatározó (-ként)',
  TRANS: 'eredményhatározó (-vá/-vé)',
  POSS: 'birtokjel (-é)',
  FAM: 'családnév (-ék)',
  PL: 'többes szám (-k)',
  WIFE: 'asszonynév (-né)',
};

/**
 * Névhez tartozó kivételek. Csak akkor kell kitölteni, ha a helyesírásból nem
 * vezethető le a helyes alak.
 */
export interface NameOverrides {
  /** Felülírja a kiszámított magánhangzó-harmóniát (pl. "híd"-típusú nevek). */
  harmony?: Harmony;
  /**
   * Az egész -val/-vel alak, ha a hasonulás a kiejtésen múlik és nem az
   * írásképen: Balzac → "Balzackal", Bach → "Bachhal", Greenwich → "Greenwichcsel".
   */
  ins?: string;
  /** Rendhagyó tárgyeset, pl. tőhangzó-kieséssel: Tücsök → "Tücsköt". */
  acc?: string;
  /**
   * A tárgyeset és a többes szám KÖTŐHANGZÓJA. A háromértékű hangrend ezt NEM
   * dönti el: a mély szavak -ot és -at között oszlanak meg (bot → botot, ház →
   * házat), a magas kerekítettek -öt és -et között (tölgy → tölgyet, gyöngy →
   * gyöngyöt). Ezért ez a névhez tartozó adat, nem szabály.
   */
  linkVowel?: 'o' | 'a' | 'e' | 'ö';
  /**
   * Hangzóhiányos tő: magánhangzóval kezdődő toldalék előtt rövidül.
   * "halom" → "halm-": Agyarhalmon, Agyarhalmot — de Agyarhalomnak, Agyarhalomra.
   */
  stemAlt?: string;
  /** Rendhagyó többes szám. */
  pl?: string;
  /**
   * A toldalékot kötőjellel kell kapcsolni (néma betűre vagy nem magyar
   * betűkapcsolatra végződő idegen nevek: Loire-ral, Rousseau-val).
   */
  hyphenate?: boolean;
  /** Tetszőleges alak kézi felülírása. */
  forms?: Partial<Record<CaseTag, string>>;
}

interface SuffixSpec {
  /** mély / magas ajakréses / magas ajakkerekítéses változat */
  back: string;
  frontU: string;
  frontR: string;
  /** Megnyújtja-e a szóvégi rövid a/e-t. */
  lengthens: boolean;
}

/** A közvetlenül kapcsolható toldalékok. Az ACC, INS, SUP, PL külön kezelést kap. */
const SUFFIXES: Partial<Record<CaseTag, SuffixSpec>> = {
  DAT: { back: 'nak', frontU: 'nek', frontR: 'nek', lengthens: true },
  INE: { back: 'ban', frontU: 'ben', frontR: 'ben', lengthens: true },
  ILL: { back: 'ba', frontU: 'be', frontR: 'be', lengthens: true },
  ELA: { back: 'ból', frontU: 'ből', frontR: 'ből', lengthens: true },
  SUB: { back: 'ra', frontU: 're', frontR: 're', lengthens: true },
  DEL: { back: 'ról', frontU: 'ről', frontR: 'ről', lengthens: true },
  ADE: { back: 'nál', frontU: 'nél', frontR: 'nél', lengthens: true },
  ALL: { back: 'hoz', frontU: 'hez', frontR: 'höz', lengthens: true },
  ABL: { back: 'tól', frontU: 'től', frontR: 'től', lengthens: true },
  TER: { back: 'ig', frontU: 'ig', frontR: 'ig', lengthens: true },
  CAU: { back: 'ért', frontU: 'ért', frontR: 'ért', lengthens: true },
  // A -ként nem nyújt: "alma" → "almaként".
  FOR: { back: 'ként', frontU: 'ként', frontR: 'ként', lengthens: false },
  POSS: { back: 'é', frontU: 'é', frontR: 'é', lengthens: true },
  FAM: { back: 'ék', frontU: 'ék', frontR: 'ék', lengthens: true },
  WIFE: { back: 'né', frontU: 'né', frontR: 'né', lengthens: true },
};

function pick(spec: SuffixSpec, h: Harmony): string {
  if (h === 'back') return spec.back;
  if (h === 'front_rounded') return spec.frontR;
  return spec.frontU;
}

/**
 * Kötőhangzó a tárgyeset és a többes szám előtt. Alapértelmezés a hangrendből,
 * de a névhez tartozó `linkVowel` felülírja — mert a hangrend önmagában nem
 * dönti el (botot vs. házat, tölgyet vs. gyöngyöt).
 */
function linkVowel(h: Harmony, ov: NameOverrides = {}): string {
  if (ov.linkVowel) return ov.linkVowel;
  if (h === 'back') return 'o';
  if (h === 'front_rounded') return 'ö';
  return 'e';
}

/** Hangzóhiányos tő a magánhangzóval kezdődő toldalék előtt. */
function stemFor(word: string, ov: NameOverrides, vowelInitialSuffix: boolean): string {
  if (!vowelInitialSuffix || !ov.stemAlt) return word;
  return ov.stemAlt;
}

/**
 * Azok a szóvégi mássalhangzók, amelyek után a tárgyeset -t-je kötőhangzó nélkül
 * kapcsolódik (Molnárt, Jánost, Ödönt).
 */
const BARE_ACC_CONSONANTS = new Set(['j', 'l', 'ly', 'n', 'ny', 'r', 's', 'sz', 'z', 'zs']);

function countVowels(word: string): number {
  return (word.toLowerCase().match(/[aáeéiíoóöőuúüű]/g) ?? []).length;
}

/**
 * -val/-vel: a v hasonul a szóvégi mássalhangzóhoz, ami megkettőződik.
 *
 *   magánhangzó után:      Anna → Annával, Szabó → Szabóval
 *   mássalhangzó után:     Fréd → Fréddel, Kovács → Kováccsal, Nagy → Naggyal
 *   eleve kettőzött után:  Kiss → Kiss-sel, Papp → Papp-pal   (AkH. 12. 95.)
 */
function instrumental(stem: string, h: Harmony, ov: NameOverrides, translative = false): string {
  if (ov.ins) {
    if (!translative) return ov.ins;
    /*
      A -vá/-vé UGYANÚGY HASONUL, MINT A -val/-vel.

      Ahol a hasonulás a KIEJTÉSEN múlik, ott a névhez adott `ins` az egyetlen
      hely, ahol ez a tudás megvan — az írásképből nem vezethető le. Enélkül a
      két alak szétcsúszott: a program „Torchcsal”-t adott, de „Torchhá”-t (a
      néma h-hoz hasonított), „Bruce-szal”-t, de „Bruce-vá”-t, „Jade-del”-t, de
      „Jade-vé”-t. Egy iratban a kettő egymás mellett áll, tehát az ellentmondás
      látszik is.

      A két toldalék csak a végén tér el: a -val/-vel „al”/„el”-re végződik, a
      -vá/-vé pedig ugyanazon a hasonult mássalhangzón „á”/„é”-re. A megadott
      alak végét cserélve tehát pontosan a helyes alak jön ki, és éppen az a
      betűsor marad meg, ami a kiejtés tudását hordozza:

        Torchcsal → Torchcsá     Bruce-szal → Bruce-szá    Jade-del → Jade-dé
        Stone-nal → Stone-ná     Birchcsel  → Birchcsé     Rubyval  → Rubyvá

      Ha a megadott alak nem így végződik (kézzel írt, rendhagyó alak), nem
      találgatunk: a számított ágra esünk vissza. A `forms.TRANS` továbbra is
      mindent felülír — azt a hívó már az `inflectWord` elején kiveszi.
    */
    if (ov.ins.endsWith('al')) return `${ov.ins.slice(0, -2)}á`;
    if (ov.ins.endsWith('el')) return `${ov.ins.slice(0, -2)}é`;
  }

  const vowelSuffix = translative ? (isBack(h) ? 'á' : 'é') : isBack(h) ? 'al' : 'el';
  const vForm = translative ? (isBack(h) ? 'vá' : 'vé') : isBack(h) ? 'val' : 'vel';
  // A néma betűre vagy idegen betűkapcsolatra végződő neveknél a toldalék
  // kötőjellel kapcsolódik, és a szóvégi e NEM magyar rövid e: nem nyúlik meg.
  if (ov.hyphenate) {
    return `${stem}-${vForm}`;
  }

  const fc = finalConsonant(stem);

  if (fc === null) {
    // Magánhangzóra végződik: nincs hasonulás, a v megmarad.
    const base = endsInShortAE(stem) ? lengthenFinalAE(stem) : stem;
    return base + vForm;
  }

  // Régies vagy idegen írásmód: a kiejtett hang betűjele kerül a névhez,
  // a név írásképe változatlan marad. Tóth → Tóthtal, Marx → Marxszal.
  const archaic = archaicFinalSound(stem);
  if (archaic !== null) {
    return matchCase(stem, stem + archaic + vowelSuffix);
  }

  if (fc.alreadyDoubled) {
    // Kettőzött mássalhangzóra végződő tulajdonnév: kötőjel, hogy a hármas
    // betűtorlódás látszódjon. Kiss-sel, Papp-pal, Bernadett-tel.
    return `${stem}-${fc.grapheme}${vowelSuffix}`;
  }

  // A szóvégi betűjelet a kettőzött írásmódjára cseréljük: Kovács → Ková + ccs + al.
  const withoutFinal = stem.slice(0, stem.length - fc.length);
  return matchCase(stem, withoutFinal + fc.doubled + vowelSuffix);
}

/** Tárgyeset: -t, szükség szerint kötőhangzóval. */
function accusative(stem: string, h: Harmony, ov: NameOverrides): string {
  if (ov.acc) return ov.acc;

  if (ov.hyphenate) return `${stem}-t`;

  const fc = finalConsonant(stem);
  if (fc === null) {
    const base = endsInShortAE(stem) ? lengthenFinalAE(stem) : stem;
    return base + 't';
  }

  // Egytagú nevek után a kötőhangzó nélküli alak gyakran rossz ("Borst"),
  // de a többtagúaknál helyes ("Jánost", "Molnárt"). A pontos érték a
  // témacsomagban felülírható.
  const bare = BARE_ACC_CONSONANTS.has(fc.grapheme) && countVowels(stem) >= 2;
  if (bare) return needsCollisionHyphen(stem, 't') ? `${stem}-t` : `${stem}t`;
  return `${stemFor(stem, ov, true)}${linkVowel(h, ov)}t`;
}

/** Felszíni határozó: magánhangzó után -n, egyébként kötőhangzó + n. */
function superessive(stem: string, h: Harmony, ov: NameOverrides): string {
  if (ov.hyphenate) return `${stem}-${linkVowel(h, ov)}n`;
  const fc = finalConsonant(stem);
  if (fc === null) {
    const base = endsInShortAE(stem) ? lengthenFinalAE(stem) : stem;
    return base + 'n';
  }
  return `${stemFor(stem, ov, true)}${linkVowel(h, ov)}n`;
}

/** Többes szám: -k magánhangzó után, egyébként kötőhangzó + k. */
function plural(stem: string, h: Harmony, ov: NameOverrides): string {
  if (ov.pl) return ov.pl;
  if (ov.hyphenate) return `${stem}-${linkVowel(h)}k`;
  const fc = finalConsonant(stem);
  if (fc === null) {
    const base = endsInShortAE(stem) ? lengthenFinalAE(stem) : stem;
    return base + 'k';
  }
  if (ov.hyphenate) return `${stem}-${linkVowel(h)}k`;
  // Régies írásmódú, -y-ra végződő családnevek kötőhangzója -a-, nem -o-:
  // Kisfaludy → Kisfaludyak, Rákóczy → Rákóczyak. (AkH. 12. 162.)
  // A gy/ly/ny/ty kétjegyű mássalhangzók nem ide tartoznak: "Nagy" → Nagyok.
  if (isBack(h) && /[^aáeéiíoóöőuúüűglnt]y$/i.test(stem)) return `${stem}ak`;
  return `${stem}${linkVowel(h)}k`;
}

/**
 * Egyetlen szó (névelem) toldalékolása. Többtagú neveknél csak az utolsó elemet
 * kell átadni — lásd `inflectName`.
 */
export function inflectWord(word: string, tag: CaseTag, ov: NameOverrides = {}): string {
  const manual = ov.forms?.[tag];
  if (manual) return manual;
  if (tag === 'NOM') return word;

  const h = ov.harmony ?? detectHarmony(word);

  switch (tag) {
    case 'INS':
      return instrumental(word, h, ov);
    case 'TRANS':
      return instrumental(word, h, ov, true);
    case 'ACC':
      return accusative(word, h, ov);
    case 'SUP':
      return superessive(word, h, ov);
    case 'PL':
      return plural(word, h, ov);
    default: {
      const spec = SUFFIXES[tag];
      if (!spec) throw new Error(`Nincs toldalékszabály: ${tag}`);
      const suffix = pick(spec, h);
      if (ov.hyphenate) return `${word}-${suffix}`;
      const base = spec.lengthens && endsInShortAE(word) ? lengthenFinalAE(word) : word;
      // Mann + -nak → Mann-nak: három azonos betű nem kerülhet egymás mellé.
      if (needsCollisionHyphen(base, suffix)) return `${base}-${suffix}`;
      return base + suffix;
    }
  }
}

/**
 * Többtagú tulajdonnév toldalékolása: a ragot csak az UTOLSÓ névelem kapja.
 * "Kovács János" + DAT → "Kovács Jánosnak", nem "Kovácsnak Jánosnak".
 */
export function inflectName(name: string, tag: CaseTag, ov: NameOverrides = {}): string {
  const manual = ov.forms?.[tag];
  if (manual) return manual;
  if (tag === 'NOM') return name;

  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (last === undefined) return name;

  const inflectedLast = inflectWord(last, tag, ov);
  parts[parts.length - 1] = inflectedLast;
  return parts.join(' ');
}

/** Egy név teljes ragozási táblája — ez kerül a témacsomagba, előre legyártva. */
export type Paradigm = Record<CaseTag, string>;

export function buildParadigm(name: string, ov: NameOverrides = {}): Paradigm {
  const out = {} as Paradigm;
  for (const tag of ALL_CASES) {
    out[tag] = inflectName(name, tag, ov);
  }
  return out;
}

/**
 * Rövidítésre végződő szervezetnév: a toldalék kötőjellel kapcsolódik, és a
 * harmóniát a rövidítés KIEJTÉSE dönti el ("Kft." = "káeftté" → magas).
 */
const ABBREV_HARMONY: Record<string, Harmony> = {
  'kft.': 'front_unrounded',
  'zrt.': 'front_unrounded',
  'nyrt.': 'front_unrounded',
  'bt.': 'front_unrounded',
  'kkt.': 'front_unrounded',
  'kht.': 'front_unrounded',
  'ec.': 'front_unrounded',
  'rt.': 'front_unrounded',
  'kv.': 'front_unrounded',
};

export function isAbbreviation(word: string): boolean {
  return word.endsWith('.') && ABBREV_HARMONY[word.toLowerCase()] !== undefined;
}

/** Szervezetnév toldalékolása: "Aranykalász Kft." + DAT → "Aranykalász Kft.-nek". */
export function inflectOrganization(name: string, tag: CaseTag, ov: NameOverrides = {}): string {
  const manual = ov.forms?.[tag];
  if (manual) return manual;
  if (tag === 'NOM') return name;

  const parts = name.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (last === undefined) return name;

  const abbrevHarmony = ABBREV_HARMONY[last.toLowerCase()];
  if (abbrevHarmony !== undefined) {
    const suffix = suffixOnly(tag, abbrevHarmony);
    return `${name}-${suffix}`;
  }
  return inflectName(name, tag, ov);
}

/** Csak a toldalék betűsora, tő nélkül — a kötőjeles kapcsoláshoz. */
function suffixOnly(tag: CaseTag, h: Harmony): string {
  switch (tag) {
    case 'INS':
      return isBack(h) ? 'val' : 'vel';
    case 'TRANS':
      return isBack(h) ? 'vá' : 'vé';
    case 'ACC':
      return 't';
    case 'SUP':
      return `${linkVowel(h)}n`;
    case 'PL':
      return `${linkVowel(h)}k`;
    default: {
      const spec = SUFFIXES[tag];
      if (!spec) throw new Error(`Nincs toldalékszabály: ${tag}`);
      return pick(spec, h);
    }
  }
}
