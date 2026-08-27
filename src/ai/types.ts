/**
 * A nyelvi modell és a program közötti határ.
 *
 * Szándékosan szűk: a modell szöveget kap, és karakterpozícióval megjelölt
 * entitásokat ad vissza. Semmi mást nem tud, semmi mást nem dönt el. Így a
 * modell cserélhető — kódoló, GLiNER-féle vagy generatív —, anélkül, hogy a
 * program bármely más része tudna róla.
 */

/**
 * Az 'identifier' szándékosan FAJTA NÉLKÜLI címke: ez a fájl a modell határa,
 * és nem szabad, hogy tudjon a magyar azonosítófajtákról (adószám, TAJ, hrsz.).
 * Hogy melyik fajtáról van szó, a `rawLabel` mondja meg — a felismerő ott adja
 * meg a saját címkéjét (`AZONOSITO:adoszam`), és a szereplapon úgyis az látszik.
 *
 * Azért kell mégis külön címke, mert az 'other' kukát jelent: a felismerő
 * eddig oda vagy a 'place'-be volt kénytelen sorolni az azonosítót, és a
 * teljes lakcím így HELYNÉVKÉNT jelent meg a felek listáján.
 */
export type EntityLabel = 'person' | 'org' | 'place' | 'other' | 'identifier';

export interface ExtractedEntity {
  /** Karakterpozíció az ÁTADOTT szövegben. Enélkül nem tudunk cserélni. */
  start: number;
  end: number;
  /** A szöveg pontosan úgy, ahogy a forrásban áll. */
  text: string;
  label: EntityLabel;
  /** A modell saját címkéje — a szereplapon megmutatjuk, hogy látszódjon, mit hitt. */
  rawLabel: string;
  /** 0..1 */
  score: number;
}

export interface ExtractOptions {
  /** Ekkora darabokban adjuk a modellnek (karakter). */
  chunkChars?: number;
  /** Ennyi átfedéssel, hogy a darabhatáron se vesszen el név. */
  overlapChars?: number;
  /** Ez alatt eldobjuk a találatot. */
  minScore?: number;
  /**
   * Ablakonkénti visszajelzés a haladásról.
   *
   * A modell csúszóablakokban dolgozik, és az ablakok száma az EGYETLEN
   * tisztességes alapja egy folyamatjelzőnek: a karakterszám nem az, mert a
   * tokenizálás után egy ékezetes magyar szó két-három tokenre esik szét,
   * tehát a szöveg hossza nem arányos a munkával.
   *
   * Azért itt van és nem a futtató mellékágán: a felület a KÖZÖS felületen át
   * kapja a modellt, és egy folyamatjelző, ami csak az egyik futtatónál
   * működik, rosszabb a semminél — a felhasználó nem tudja, mikor higgyen neki.
   */
  onWindow?: (h: AblakHaladas) => void;
}

/** Hányadik ablakkal végzett a modell, és hány lesz összesen. */
export interface AblakHaladas {
  /** Hányadik ablakkal végzett a modell, 1-től. */
  ablak: number;
  /** Hány ablak lesz összesen ezen az iraton. */
  ablakok: number;
}

export interface ExtractorInfo {
  modelId: string;
  repo: string;
  /** Honnan jönnek a pozíciók: a modelltől vagy mi állítjuk elő. */
  offsets: 'native' | 'reconstructed';
  loadMs: number;
}

export interface EntityExtractor {
  load(): Promise<ExtractorInfo>;
  extract(text: string, opts?: ExtractOptions): Promise<ExtractedEntity[]>;
  dispose(): Promise<void>;
}
