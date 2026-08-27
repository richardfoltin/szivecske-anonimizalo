/**
 * Magyar hangtan a toldalékoláshoz: magánhangzó-harmónia és a betűkapcsolatok
 * (kétjegyű és háromjegyű mássalhangzók) kezelése.
 *
 * Minden itteni szabály determinisztikus és tesztelhető — szándékosan nincs benne
 * se modell, se találgatás. Amit a helyesírásból nem lehet levezetni (idegen nevek
 * kiejtés szerinti hasonulása), az a névhez tartozó adat, nem szabály; lásd
 * `NameOverrides` az inflect.ts-ben.
 */

/** Mély (hátul képzett) magánhangzók. */
const BACK_VOWELS = new Set(['a', 'á', 'o', 'ó', 'u', 'ú']);

/** Magas, ajakkerekítéses magánhangzók. */
const FRONT_ROUNDED_VOWELS = new Set(['ö', 'ő', 'ü', 'ű']);

/**
 * Semleges (transzparens) magánhangzók. Ha a szó végén ezek állnak, a harmóniát
 * a mögöttük lévő magánhangzó dönti el: "papír" → papírnak (mély), "kávé" → kávéval.
 * Az "e" szándékosan NINCS köztük: "József" → Józsefnek, "Ágnes" → Ágnesnek.
 */
const NEUTRAL_VOWELS = new Set(['i', 'í', 'é']);

const ALL_VOWELS = new Set([
  ...BACK_VOWELS,
  ...FRONT_ROUNDED_VOWELS,
  ...NEUTRAL_VOWELS,
  'e',
]);

export type Harmony = 'back' | 'front_unrounded' | 'front_rounded';

/** Magyar betű (a szóhatár-felismeréshez; a JS \b nem ismeri az ékezeteket). */
export const HU_LETTER_CLASS = 'A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű';
const HU_LETTER_RE = new RegExp(`[${HU_LETTER_CLASS}]`);

export function isVowel(ch: string): boolean {
  return ALL_VOWELS.has(ch.toLowerCase());
}

export function isHuLetter(ch: string): boolean {
  return HU_LETTER_RE.test(ch);
}

/**
 * Egy szóalak magánhangzó-harmóniája.
 *
 * Az utolsó nem-semleges magánhangzó dönt; ha csak semleges magánhangzó van a
 * szóban, magas (ajakréses) az eredmény. A kivételes mély harmóniájú, csupa
 * semleges magánhangzós szavakat (híd, cél, nyíl) nevek esetén nem próbáljuk
 * kitalálni — azokat a névhez tartozó `harmony` mező írja felül.
 */
export function detectHarmony(word: string): Harmony {
  const w = word.toLowerCase();

  // 1. Mély vagy magas? Az utolsó NEM SEMLEGES magánhangzó dönt; a semlegesek
  //    (i, í, é) átlátszóak: "papír" → papírnak, "Gránit" → Gránitnak.
  let back: boolean | null = null;
  for (let i = w.length - 1; i >= 0; i--) {
    const ch = w[i]!;
    if (!ALL_VOWELS.has(ch)) continue;
    if (NEUTRAL_VOWELS.has(ch)) continue;
    back = BACK_VOWELS.has(ch);
    break;
  }
  if (back === true) return 'back';

  // 2. Magas szó ajakkerekítése: itt már a LEGUTOLSÓ magánhangzó dönt, akkor is,
  //    ha semleges. Ezért "Kökény" → Kökényhez és Kökényen, nem "-höz"/"-ön",
  //    noha a szóban van ö.
  for (let i = w.length - 1; i >= 0; i--) {
    const ch = w[i]!;
    if (!ALL_VOWELS.has(ch)) continue;
    return FRONT_ROUNDED_VOWELS.has(ch) ? 'front_rounded' : 'front_unrounded';
  }
  return 'front_unrounded';
}

export function isBack(h: Harmony): boolean {
  return h === 'back';
}

/**
 * Kétjegyű és háromjegyű mássalhangzók. Hosszabbak elöl, hogy a leghosszabb
 * illeszkedjen először ("dzs" a "dz" előtt, "dz" a "z" előtt).
 */
const DIGRAPHS = ['dzs', 'cs', 'dz', 'gy', 'ly', 'ny', 'sz', 'ty', 'zs'] as const;

/**
 * A kétjegyű mássalhangzók kettőzött írásmódja (AkH. 12. 62.):
 * cs → ccs, nem cscs.
 */
const DOUBLED: Record<string, string> = {
  dzs: 'ddzs',
  cs: 'ccs',
  dz: 'ddz',
  gy: 'ggy',
  ly: 'lly',
  ny: 'nny',
  sz: 'ssz',
  ty: 'tty',
  zs: 'zzs',
};

/**
 * Régies írásmódú magyar családnevek és idegen nevek szóvégei, ahol az írott
 * alak nem egyezik a kiejtett hanggal. A -val/-vel és a -vá/-vé ilyenkor a
 * KIEJTETT hanghoz hasonul, és a betűjelét a változatlan névhez fűzzük:
 * Tóth + val → Tóthtal, Balogh → Baloghgal, Móricz → Móriczcal, Marx → Marxszal.
 * (AkH. 12. 160. b))
 *
 * A "ch" szándékosan HIÁNYZIK innen: magyar névben [cs] (Madách → Madáchcsal),
 * németben [h] (Bach → Bachhal). Ez az írásképből nem dönthető el, ezért az
 * ilyen nevek a névhez tartozó `ins` kivétellel jönnek, nem szabályból.
 */
const ARCHAIC_FINALS: readonly [string, string][] = [
  ['th', 't'],
  ['gh', 'g'],
  ['cz', 'c'],
  ['tz', 'c'],
  ['ts', 'cs'],
  ['x', 'sz'],
];

/** A szóvégi betűkapcsolat kiejtett mássalhangzója, ha eltér az írottól. */
export function archaicFinalSound(word: string): string | null {
  const w = word.toLowerCase();
  for (const [written, pronounced] of ARCHAIC_FINALS) {
    if (w.endsWith(written)) return pronounced;
  }
  return null;
}

/**
 * Hármas betűtorlódás feloldása kötőjellel: kettőzött mássalhangzóra végződő
 * tulajdonnév + ugyanazzal a betűvel kezdődő toldalék. Mann + -nak → Mann-nak,
 * Scott + -tól → Scott-tól, Kiss + -sel → Kiss-sel. (AkH. 12. 93., 217.)
 */
export function needsCollisionHyphen(stem: string, suffix: string): boolean {
  if (stem.length < 2 || suffix.length === 0) return false;
  const a = stem[stem.length - 1]!.toLowerCase();
  const b = stem[stem.length - 2]!.toLowerCase();
  if (a !== b || ALL_VOWELS.has(a)) return false;
  return suffix[0]!.toLowerCase() === a;
}

export interface FinalGrapheme {
  /** A szóvégi mássalhangzó betűjele, pl. "d", "cs", "dzs". */
  grapheme: string;
  /** Hány karakter az eredeti szóból. */
  length: number;
  /** Kettőzött írásmódja, pl. "dd", "ccs". */
  doubled: string;
  /** Igaz, ha a szó már eleve kettőzött mássalhangzóra végződik (Kiss, Papp, Kovácscs). */
  alreadyDoubled: boolean;
}

/**
 * A szóvégi mássalhangzó kinyerése, a kétjegyűeket egyben kezelve.
 * Magánhangzóra végződő szónál null.
 */
export function finalConsonant(word: string): FinalGrapheme | null {
  const w = word.toLowerCase();
  if (w.length === 0) return null;
  const last = w[w.length - 1]!;
  if (ALL_VOWELS.has(last)) return null;

  for (const dg of DIGRAPHS) {
    if (w.endsWith(dg)) {
      const doubled = DOUBLED[dg]!;
      // Kettőzött kétjegyű: a szó már "ccs"-re / "ssz"-re végződik.
      const alreadyDoubled = w.endsWith(doubled);
      return { grapheme: dg, length: dg.length, doubled, alreadyDoubled };
    }
  }

  const prev = w.length >= 2 ? w[w.length - 2] : undefined;
  return {
    grapheme: last,
    length: 1,
    doubled: last + last,
    alreadyDoubled: prev === last,
  };
}

/** Rövid a/e szóvégen, amit a toldalék megnyújt (Anna → Annának). */
export function endsInShortAE(word: string): boolean {
  const last = word[word.length - 1];
  return last === 'a' || last === 'e' || last === 'A' || last === 'E';
}

/** A szóvégi rövid a/e megnyújtása á/é-re, az eredeti kisbetű/nagybetű megtartásával. */
export function lengthenFinalAE(word: string): string {
  const last = word[word.length - 1];
  if (last === 'a') return word.slice(0, -1) + 'á';
  if (last === 'e') return word.slice(0, -1) + 'é';
  if (last === 'A') return word.slice(0, -1) + 'Á';
  if (last === 'E') return word.slice(0, -1) + 'É';
  return word;
}

/**
 * Betűk, amelyek MAGYAR BETŰNEVE magánhangzóval kezdődik. Rövidítéseknél
 * ("az MFB", mert "emm-eff-bé") ez dönti el a névelőt, nem az írott alak.
 */
const VOWEL_INITIAL_LETTER_NAMES = new Set(['a', 'á', 'e', 'é', 'f', 'i', 'í', 'l', 'm', 'n', 'o', 'ó', 'ö', 'ő', 'r', 's', 'u', 'ú', 'ü', 'ű', 'x', 'y']);

/**
 * Kell-e "az" névelő a szó elé. A magyar névelő a KÖVETKEZŐ szó kezdőhangjától
 * függ, ezért névcsere után a névelőt is javítani kell: "az Aranykalász" →
 * "a Tűzkő". Enélkül minden csere után látszik, hogy a szöveget gép írta át.
 */
export function needsAz(word: string): boolean {
  const first = word.trim()[0];
  if (!first) return false;

  // Csupa nagybetűs rövidítés: a betűnév kiejtése dönt.
  const bare = word.trim().replace(/[^A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g, '');
  if (bare.length >= 2 && bare === bare.toUpperCase()) {
    return VOWEL_INITIAL_LETTER_NAMES.has(first.toLowerCase());
  }
  return isVowel(first);
}

/** A szó nagybetűs írásmódját megtartva cseréli a végét (KOVÁCS → KOVÁCCSAL). */
export function matchCase(source: string, produced: string): string {
  if (source.length >= 2 && source === source.toUpperCase() && /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(source)) {
    return produced.toUpperCase();
  }
  return produced;
}
