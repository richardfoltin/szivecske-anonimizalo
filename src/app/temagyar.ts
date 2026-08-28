/**
 * SAJÁT NÉVKÉSZLET a felhasználó által beírt téma alapján.
 *
 * A felhasználó beírja, hogy „görög mitológia” vagy „csillagképek”, és kap egy
 * kész álnévkészletet, ugyanabban a szerkezetben, mint a programmal szállított
 * négy csomag (`data/themes/*.json`).
 *
 * A MUNKAMEGOSZTÁS — és ez a modul lényege:
 *
 *   1. A modell JAVASOL. Egy nyelvi modell tudja, hogy a görög mitológiában van
 *      Akhilleusz és Kasszandra. Ehhez nem kell magyar nyelvtan, csak műveltség.
 *   2. A MI motorunk RAGOZ. A magyar toldalékolást (`hu/inflect.ts`) nem a
 *      modellre bízzuk: az determinisztikus szabály, 330/330-as méréssel a háta
 *      mögött, míg egy 4 milliárd paraméteres háló a huszonegy alakból néhányat
 *      biztosan elront — és pont az elrontott alak az, ami az iratban árulkodó
 *      hibaként megjelenik.
 *   3. A program ELLENŐRIZ. A javaslat nyers anyag, nem eredmény: ami nem
 *      magyar betű, nem ragozható, valódi névvel ütközik vagy nem illik a
 *      készletbe, azt kidobjuk. A kidobás indoklása magyar mondat, mert a
 *      felhasználó látja.
 *
 * AMIT EZ A MODUL NEM CSINÁL: nem futtat modellt és nem nyit hálózatot. Kap egy
 * kérésszöveget építő és egy választ értelmező függvényt, meg egy listát nyers
 * javaslatokból — hogy honnan jött, az nem ránk tartozik. Ez nem elvi
 * finomkodás: enélkül a `test/temagyar-tests.ts` nem tudna lefutni a 2,7 GB-os
 * modell nélkül, és így az ellenőrző rész sosem kapna tesztet.
 */

import {
  ALL_CASES,
  CASE_LABELS_HU,
  type CaseTag,
  type NameOverrides,
  type Paradigm,
  buildParadigm,
} from '../hu/inflect.js';
import type { Gender } from '../hu/names.js';
import { type Harmony, detectHarmony } from '../hu/phonology.js';
import type { Theme, ThemeEntry, ThemePlace } from '../pseudonym.js';

/* ------------------------------------------------------------------ *
 *  MENNYI NÉV ELÉG
 * ------------------------------------------------------------------ */

/*
  A KÜSZÖBÖK MÉRÉSBŐL JÖNNEK, nem érzésből.

  A mintairatokban (`samples/*.json`) a legnépesebb ügy 5 férfi, 3 nő és 2
  szervezet — összesen 10 fél. A vezetéknevek és a cégnév-előtagok KÖZÖS
  készletből fogynak (lásd `assignPseudonyms`, pseudonym.ts), tehát abból a
  10-ből 10 vezetéknév-igény lesz. Ha a készlet elfogy, a program nem áll meg:
  számozott utótagot ragaszt a névhez („Bazalt 2”) — ami működik, de az iratban
  csúnyán látszik, hogy gépi.

  A szállított csomagok padlója 24 utónév (12 férfi, 12 női) és 26 vezetéknév.
  Az alábbi küszöbök ez alatt vannak: nem a szállított minőséget követeljük meg
  egy géppel gyártott készlettől, csak annyit, hogy egy valódi iratot
  ismétlődés és számozás nélkül kiszolgáljon.
*/

/** Ennyi utónév kell NEMENKÉNT. A mért legrosszabb eset 5; ez 60% ráhagyás. */
export const MIN_UTONEV_NEMENKENT = 8;

/** Ennyi vezetéknév kell. A mért legrosszabb eset 10 (fél + szervezet együtt). */
export const MIN_VEZETEKNEV = 12;

/**
 * Ennyi cégnév-előtag AJÁNLOTT — de nem kötelező: ha nincs, a kiosztó a
 * vezetéknevekből dolgozik (`assignOrg`), ami elfogadható eredményt ad.
 */
export const AJANLOTT_CEGELEM = 6;

/**
 * Ennyi helységnév AJÁNLOTT — szintén nem kötelező: helynév hiányában a kiosztó
 * beépített listára esik vissza (`assignPlace`).
 */
export const AJANLOTT_HELYNEV = 4;

/** Ennyi nevet kérünk a modelltől csoportonként — a kidobás miatt bőven többet. */
const KERT_DARAB: Record<JavaslatCsoport, number> = {
  given: 30,
  surname: 30,
  org: 12,
  place: 10,
};

/**
 * A felületen megmutatott ragozott alakok.
 *
 * Nem véletlenszerű válogatás: pontosan azok az esetek, ahol a magyar
 * toldalékolás EL TUD romlani. A tárgyeset a kötőhangzón (-ot/-at/-öt/-et), a
 * részes és a hozzávető eset a hangrenden (-nak/-nek, -hoz/-hez/-höz), az
 * eszközhatározó a szóvégi mássalhangzó hasonulásán (Kováccsal, Naggyal). Ha
 * ez az öt alak jó, a maradék tizenhat is az.
 */
const MUTATVANY_ESETEK: readonly CaseTag[] = ['ACC', 'DAT', 'INS', 'SUP', 'ALL'];

/** Vezetéknévnél az asszonynév is látszik: abból lesz a „Kőszikla Frédné”. */
const MUTATVANY_VEZETEKNEV: readonly CaseTag[] = ['ACC', 'DAT', 'INS', 'WIFE'];

/* ------------------------------------------------------------------ *
 *  BETŰOSZTÁLYOK
 * ------------------------------------------------------------------ */

/*
  FIGYELEM: ITT NINCS \b ÉS NINCS \w.

  A JavaScript mindkettőt ASCII-alapon értelmezi, tehát az „Ódor” szó elején az
  Ó nem betű, a „Kőszikla” közepén az ő szóhatár. Ez a projektben már okozott
  valódi szivárgást, ezért minden magyar szövegre illeszkedő mintában kiírt
  betűosztály áll.
*/
const HU_NAGYBETU = 'A-ZÁÉÍÓÖŐÚÜŰ';
const HU_KISBETU = 'a-záéíóöőúüű';

/**
 * Egy névelem elfogadható alakja: nagybetűvel kezdődik, magyar betűkből áll,
 * és legfeljebb kötőjellel összetett („Kis-Bazalt”). Szóköz nincs benne: a
 * témacsomagok minden eleme egyszavas, a vezeték- és utónevet a kiosztó rakja
 * össze.
 */
const NEV_ALAK = new RegExp(
  `^[${HU_NAGYBETU}][${HU_KISBETU}]+(?:-[${HU_NAGYBETU}]?[${HU_KISBETU}]+)*$`,
);

const VAN_MAGANHANGZO = /[aáeéiíoóöőuúüűAÁEÉIÍOÓÖŐUÚÜŰ]/;

/** A magyar ábécében nem szereplő betűk (az y-t külön kezeljük, lásd lentebb). */
const IDEGEN_BETU = /[qwxQWX]/;

/**
 * Magányos y: nem a gy/ly/ny/ty kétjegyű mássalhangzó része.
 *
 * Az „Ödy” vagy a „Byron” kiejtése az írásképből nem következik, a „Nagy”-é
 * viszont igen — ezért nem elég az y betűt keresni.
 */
const MAGANYOS_Y = /(^|[^glntGLNT])[yY]/;

/** Semleges (átlátszó) magánhangzók: ezek nem döntik el a hangrendet. */
const SEMLEGES_MAGANHANGZO = /[iíéIÍÉ]/;
const BARMELY_MAGANHANGZO = /[aáeéiíoóöőuúüűAÁEÉIÍOÓÖŐUÚÜŰ]/g;

/** Idegen szóvégek, ahol a toldalék kötőjellel kapcsolódna (Rousseau-val). */
const IDEGEN_SZOVEG: readonly string[] = ['eau', 'eux', 'oux', 'ough', 'oo', 'ee', 'ow', 'ew'];

/* ------------------------------------------------------------------ *
 *  TÍPUSOK
 * ------------------------------------------------------------------ */

/** Melyik készletbe szánjuk a nevet. */
export type JavaslatCsoport = 'given' | 'surname' | 'org' | 'place';

/** Egy nyers javaslat, ahogy a modelltől érkezik. Semmi nincs benne igazolva. */
export interface NevJavaslat {
  form: string;
  csoport: JavaslatCsoport;
  /** Utónévnél kötelező; máshol nincs értelme. */
  gender?: Gender;
}

/** Miért dobtunk ki egy javaslatot. A felület ezt csoportosíthatja. */
export type ElutasitasOka =
  | 'ures'
  | 'nem_magyar_betuk'
  | 'nincs_maganhangzo'
  | 'tul_rovid'
  | 'tul_hosszu'
  | 'ismetlodes'
  | 'valodi_nev'
  | 'nem_nelkul'
  | 'ket_nemben'
  | 'utonev_es_vezeteknev'
  | 'ragozhatatlan';

export interface ElutasitottNev {
  form: string;
  csoport: JavaslatCsoport;
  ok: ElutasitasOka;
  /** Magyar mondat: MIÉRT nem jó. Ez megy a felületre. */
  indoklas: string;
}

/** Egy megmutatható ragozott alak: „részes eset (-nak/-nek)” → „Akhilleusznak”. */
export interface MutatvanyAlak {
  eset: CaseTag;
  cimke: string;
  alak: string;
}

/** Egy név, ami átment az ellenőrzésen — a teljes ragozási táblájával együtt. */
export interface EllenorzottNev {
  form: string;
  csoport: JavaslatCsoport;
  gender?: Gender;
  harmony: Harmony;
  overrides: NameOverrides;
  /** Mind a 21 alak, a saját ragozó motorunkból. */
  paradigma: Paradigm;
  /** Amit a felület kirajzol a név mellé. */
  mutatvany: MutatvanyAlak[];
  /**
   * Igaz, ha a ragozás a KIEJTÉSEN múlik, amit a helyesírásból nem lehet
   * levezetni. Ilyenkor a program nem tud, csak tippel — és a tippet a
   * felhasználónak látnia kell.
   */
  kiejtesFuggo: boolean;
  /** Magyar megjegyzés a rendhagyóságról; üres, ha a név szabályos. */
  notes: string;
}

/** Mi hiányzik a készletből, és mennyi. */
export interface TemaHiany {
  csoport: JavaslatCsoport;
  gender?: Gender;
  van: number;
  kell: number;
  /** Igaz, ha enélkül a készlet használhatatlan; hamis, ha csak gyengébb. */
  kotelezo: boolean;
  uzenet: string;
}

export interface TemaJelentes {
  /** Amit a felhasználó beírt. */
  temaSzoveg: string;
  /** Hány javaslat érkezett összesen. */
  javaslatokSzama: number;
  elfogadva: EllenorzottNev[];
  elutasitva: ElutasitottNev[];
  /**
   * Az elfogadott nevek közül azok, amelyeknél a ragozás tippen alapul.
   * A felületnek EZT kell kiemelnie, nem a teljes listát.
   */
  atnezendo: EllenorzottNev[];
  hianyok: TemaHiany[];
  /** Igaz, ha a készlet valódi iraton használható. */
  hasznalhato: boolean;
  /** Amit a felhasználónak el kell olvasnia, mielőtt használja. */
  figyelmeztetesek: string[];
}

export interface TemaEredmeny {
  /** A kész téma, a szállított csomagokkal azonos szerkezetben; null, ha kevés a név. */
  theme: Theme | null;
  jelentes: TemaJelentes;
}

export interface TemaBemenet {
  /** Amit a felhasználó beírt: „görög mitológia”. */
  temaSzoveg: string;
  /** Amit a modell javasolt. */
  javaslatok: NevJavaslat[];
  /**
   * A `data/homonyms.json` formái, kisbetűsen — ugyanaz a halmaz, amit a
   * felismerő is kap. A hívó tölti be, mert ez a modul nem nyúl fájlhoz.
   */
  homonimak: Set<string>;
  /**
   * A `data/name-overrides.json` 》names《 mezője, ha a hívó betöltötte. Ha egy
   * javasolt név véletlenül szerepel benne (Bach, Voltaire), a kézzel
   * ellenőrzött kivételt átvesszük — jobb, mint amit kitalálnánk.
   */
  nevKivetelek?: Record<string, NameOverrides>;
}

/* ------------------------------------------------------------------ *
 *  1. A KÉRÉS, AMIT A MODELLNEK KÜLDÜNK
 * ------------------------------------------------------------------ */

/**
 * MILYEN ALAKBAN KÉRJÜK A VÁLASZT — csoportonként külön.
 *
 * MIÉRT NEM MINDENHOL UGYANAZ AZ OBJEKTUM: mert a válasz hossza IDŐ. Mérve,
 * ezen a gépen, a valódi kéréssel: 1,4 token másodpercenként. Egy
 * `{"form": "Olümposz", "kind": "org"}` alakú elem 13-15 token, ugyanaz sima
 * szövegként 4 — harminc névnél ez perceket jelent, és a mezők közben SEMMIT
 * nem tesznek hozzá: a csoportot úgyis mi mondtuk meg a kérésben, és az
 * elemző (`olvasdAJavaslatot`) a sima szöveget is elfogadja, ha megkapja
 * mellé, melyik csoportot kérte.
 *
 * Az utónév a kivétel: ott a nem nem elhagyható. A program a férfi és a női
 * utóneveket külön kezeli, nem nélkül a javaslat kiesik (lásd `keszitsTemat`,
 * 'nem_nelkul') — vagyis ott a rövidítés nem időt spórolna, hanem a válasz
 * felét dobná ki.
 */
const VALASZ_ALAK: Record<JavaslatCsoport, string[]> = {
  given: [
    'Válaszolj CSAK egy JSON tömbbel, más szöveg nélkül. Egy elem így néz ki:',
    '  {"form": "Akhilleusz", "gender": "M"}',
    'A "gender" kötelező: "M" férfi, "F" női utónév.',
  ],
  surname: [
    'Válaszolj CSAK egy JSON tömbbel, más szöveg nélkül. A tömb elemei sima szövegek:',
    '  ["Olümposzi", "Thébai", "Küklopszi"]',
    'Vezetéknevet kérek: a témából képzett, magyaros alakot (-i, -s képző, összetétel).',
  ],
  org: [
    'Válaszolj CSAK egy JSON tömbbel, más szöveg nélkül. A tömb elemei sima szövegek:',
    '  ["Olümposz", "Delphoi", "Aigisz"]',
    'Cégnév-előtagot kérek: a témából vett egyszavas nevet, amiből cégnév lehet.',
  ],
  place: [
    'Válaszolj CSAK egy JSON tömbbel, más szöveg nélkül. A tömb elemei sima szövegek:',
    '  ["Thébafalva", "Olümposzhalom", "Delphoivár"]',
    'Kitalált településnevet kérek: a téma szava + magyar utótag (-falva, -halom, -vár).',
  ],
};

/** Ha egyszerre kérjük mind a négy csoportot, a fajtát az elemnek kell vinnie. */
const TELJES_VALASZ_ALAK: string[] = [
  'Válaszolj CSAK egy JSON tömbbel, más szöveg nélkül. Egy elem így néz ki:',
  '  {"form": "Akhilleusz", "kind": "given", "gender": "M"}',
  '',
  'A "kind" lehetséges értékei:',
  '  "given"   utónév — ilyenkor a "gender" kötelező: "M" férfi, "F" női',
  '  "surname" vezetéknév — a témából képzett, magyaros alak (-i, -s képző, összetétel)',
  '  "org"     cégnév-előtag — a témából vett egyszavas név, amiből cégnév lehet',
  '  "place"   kitalált településnév — a téma szava + magyar utótag (-falva, -halom, -vár)',
];

/**
 * A modellnek szóló kérés szövege.
 *
 * MIÉRT MAGYARUL: a kérés nyelve elhúzza a választ is. Magyar kérésre a modell
 * magyar helyesírással ír („Akhilleusz”, „Poszeidón”), angolra „Achilles”-t és
 * „Poseidon”-t — az utóbbi a magyar ragozó motoron át „Achilles-szel” lenne, és
 * a magyar olvasónak idegen. A helyesírást tehát nem utólag javítjuk, hanem
 * eleve úgy kérjük.
 *
 * MIÉRT LEHET CSOPORTONKÉNT KÉRNI: egy 4 milliárd paraméteres modell hetven
 * tételes JSON-t gyakran elront a végén (levágja, elfelejti a zárójelet). Négy
 * rövid kérés négy rövid válasza megbízhatóbb, mint egy hosszú — ezért a
 * `csoport` megadható.
 *
 * MIÉRT KÉRÜNK PRIORITÁSI SORRENDET (6. szabály): a válasz sorrendje nem
 * díszítés, hanem adat. A kiosztó a névsor ELEJÉRŐL adja a nevet annak, aki az
 * iratban elsőként megjelenik (`AssignOptions.appearanceOrder`), tehát a lista
 * eleje a felperesé és az alperesé lesz. Ha a modell ömlesztve sorolja fel a
 * neveket, a főszereplő egy mellékes nevet kap — a készlet formailag hibátlan
 * marad, csak épp rosszul osztja ki magát.
 *
 * @param temaSzoveg amit a felhasználó beírt
 * @param csoport    ha megadod, csak ezt a csoportot kéri
 */
export function epitsdAJavaslatKerest(temaSzoveg: string, csoport?: JavaslatCsoport): string {
  const tema = temaSzoveg.trim();
  const sorok: string[] = [
    'Magyar jogi iratok álnevesítéséhez állítunk össze névkészletet. A valódi neveket',
    'cseréljük le a te javaslataidra, ezért a neveknek KITALÁLTNAK kell látszaniuk.',
    '',
    `A felhasználó által megadott téma: „${tema}”`,
    '',
    ...(csoport ? VALASZ_ALAK[csoport] : TELJES_VALASZ_ALAK),
    '',
    'Szabályok:',
    '1. MAGYAR HELYESÍRÁSSAL írj: Akhilleusz, nem Achilles; Poszeidón, nem Poseidon.',
    '2. Minden név EGY szó legyen, a magyar ábécé betűivel, nagybetűvel kezdve.',
    '3. NE javasolj valódi, gyakori magyar nevet (János, Ilona, Kovács, Nagy, Szabó):',
    '   a fedőnévnek látszania kell, hogy kitalált, különben az olvasó valódi',
    '   személyre gondol.',
    '4. Ne ismételd ugyanazt a nevet, és ugyanaz a név ne legyen utónév is meg',
    '   vezetéknév is.',
    '5. Kerüld a védjegyzett és a szerzői jogi oltalom alatt álló művekből vett',
    '   neveket (filmek, könyvsorozatok szereplői).',
    '6. PRIORITÁSI SORRENDBEN sorold fel őket: legelöl a téma legjellemzőbb,',
    '   legismertebb nevei, hátrébb a mellékesek. Ez nem formaság: az irat',
    '   LEGFONTOSABB szereplője — a felperes, az alperes — a lista ELEJÉRŐL kapja',
    '   az álnevét, a mellékszereplők hátrébbról. Ezért az első vezetéknév és az',
    '   első utónév párban is álljon meg: abból lesz a főszereplő teljes neve.',
    '   A férfi és a női utóneveket külön-külön rangsorold, mindkét nem élén a',
    '   téma legismertebb nevével.',
    '',
  ];

  if (csoport) {
    sorok.push(`Ebből a csoportból kérek ${KERT_DARAB[csoport]} darabot: "${csoport}".`);
    if (csoport === 'given') {
      sorok.push('Fele férfi, fele női utónév legyen.');
    }
    sorok.push('A lista sorrendje számít: elöl a legjellemzőbb nevek.');
  } else {
    sorok.push(
      `Kérek ${Math.ceil(KERT_DARAB.given / 2)} férfi és ${Math.ceil(KERT_DARAB.given / 2)} női utónevet, ` +
        `${KERT_DARAB.surname} vezetéknevet, ${KERT_DARAB.org} cégnév-előtagot és ` +
        `${KERT_DARAB.place} településnevet.`,
    );
  }

  return sorok.join('\n');
}

/* ------------------------------------------------------------------ *
 *  2. A VÁLASZ ÉRTELMEZÉSE
 * ------------------------------------------------------------------ */

/**
 * A modell válaszából javaslatlista.
 *
 * MIÉRT ENNYIRE ENGEDÉKENY: a nyilvántartásba vett gyártó egy 》gondolkodó《
 * modell — mielőtt válaszol, magában végigfut a feladaton, és ezt a
 * gondolatmenetet `<think>` … `</think>` közé zárva ki is írja. Ha ezt nem
 * vágnánk le, a JSON-keresés a gondolatmenetben talált első tömbre ülne rá. A
 * kódkerítés, a „Íme a lista:” bevezető és a magyarul megnevezett mezők
 * (`nev`, `nem`, `fajta`) ugyanígy valóságos válaszalakok, nem elméleti esetek.
 *
 * Amit NEM csinálunk: nem próbálunk értelmet adni a formátlan válasznak.
 * Ha nincs benne JSON tömb, üres listát adunk vissza — a hívó ebből tudja, hogy
 * újra kell kérdeznie, és nem abból, hogy néhány félreolvasott szó bekerült a
 * készletbe.
 *
 * @param valasz      a modell nyers kimenete
 * @param alapCsoport ha az elemből hiányzik a "kind", ezt vesszük
 */
export function olvasdAJavaslatot(valasz: string, alapCsoport?: JavaslatCsoport): NevJavaslat[] {
  const tomb = kereskJsonTombot(vagdLeAGondolatmenetet(valasz));
  if (tomb === null) return [];

  const out: NevJavaslat[] = [];
  for (const elem of tomb) {
    if (typeof elem === 'string') {
      if (alapCsoport) out.push({ form: elem, csoport: alapCsoport });
      continue;
    }
    if (typeof elem !== 'object' || elem === null) continue;
    const rec = elem as Record<string, unknown>;
    const form = elsoSzoveg(rec, ['form', 'nev', 'name', 'név']);
    if (form === null) continue;
    const csoport = olvasCsoportot(elsoSzoveg(rec, ['kind', 'csoport', 'fajta', 'type'])) ?? alapCsoport;
    if (!csoport) continue;
    const gender = olvasNemet(elsoSzoveg(rec, ['gender', 'nem', 'sex']));
    out.push({ form, csoport, ...(gender ? { gender } : {}) });
  }
  return out;
}

/**
 * A gondolatmenet levágása.
 *
 * Az utolsó `</think>` utáni rész a válasz. Ha a modellnek elfogyott a
 * kerete, a záró jel elmarad — ilyenkor a nyitó jel utáni részt hagyjuk meg,
 * mert a válasz (ha van) csak ott lehet.
 */
function vagdLeAGondolatmenetet(valasz: string): string {
  const zaro = valasz.lastIndexOf('</think>');
  if (zaro >= 0) return valasz.slice(zaro + '</think>'.length);
  const nyito = valasz.lastIndexOf('<think>');
  if (nyito >= 0) return valasz.slice(nyito + '<think>'.length);
  return valasz;
}

/**
 * Az első ÉRVÉNYES JSON tömb a szövegben.
 *
 * Zárójelszámlálással keressük, nem reguláris kifejezéssel: a beágyazott
 * objektumok miatt a mohó és a lusta minta is rossz helyen zárna. A
 * karakterláncokat átugorjuk, hogy egy névben álló szögletes zárójel ne
 * zárja le a tömböt idő előtt.
 */
function kereskJsonTombot(szoveg: string): unknown[] | null {
  for (let i = 0; i < szoveg.length; i++) {
    if (szoveg[i] !== '[') continue;
    let melyseg = 0;
    let stringben = false;
    for (let j = i; j < szoveg.length; j++) {
      const ch = szoveg[j];
      if (stringben) {
        if (ch === '\\') j++;
        else if (ch === '"') stringben = false;
        continue;
      }
      if (ch === '"') stringben = true;
      else if (ch === '[') melyseg++;
      else if (ch === ']') {
        melyseg--;
        if (melyseg === 0) {
          try {
            const ertek: unknown = JSON.parse(szoveg.slice(i, j + 1));
            if (Array.isArray(ertek)) return ertek;
          } catch {
            // Nem érvényes JSON: megyünk tovább a következő nyitó zárójelre.
          }
          break;
        }
      }
    }
  }
  return null;
}

function elsoSzoveg(rec: Record<string, unknown>, kulcsok: readonly string[]): string | null {
  for (const k of kulcsok) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function olvasCsoportot(nyers: string | null): JavaslatCsoport | null {
  if (nyers === null) return null;
  const v = nyers.toLowerCase();
  // Az ékezetes és az ékezet nélküli alak is előfordul: a modell hol
  // „utónév”-et, hol „utonev”-et ír. Mindkettőt ismerni kell, mert egy
  // félreolvasott csoportcímke miatt a név a rossz listába kerülne.
  if (v.startsWith('given') || v.startsWith('utó') || v.startsWith('uto') || v.startsWith('kereszt'))
    return 'given';
  if (v.startsWith('sur') || v.startsWith('family') || v.startsWith('vezet') || v.startsWith('csal'))
    return 'surname';
  if (v.startsWith('org') || v.startsWith('ceg') || v.startsWith('cég')) return 'org';
  if (v.startsWith('place') || v.startsWith('hely') || v.startsWith('telep')) return 'place';
  return null;
}

function olvasNemet(nyers: string | null): Gender | null {
  if (nyers === null) return null;
  const v = nyers.toLowerCase();
  if (v === 'm' || v.startsWith('férfi') || v.startsWith('ferfi') || v.startsWith('male')) return 'M';
  // A 》female《 az 》f《-fel kezdődik, a 》férfi《 is: a hosszabb alakokat előbb
  // nézzük meg, különben a 》female《 férfiként érkezne be.
  if (v === 'f' || v.startsWith('nő') || v.startsWith('no') || v.startsWith('female')) return 'F';
  if (v === 'n' || v.startsWith('semleges')) return 'N';
  return null;
}

/* ------------------------------------------------------------------ *
 *  3. AZ ELLENŐRZÉS
 * ------------------------------------------------------------------ */

interface EllenorzesEredmeny {
  elfogadva: EllenorzottNev[];
  elutasitva: ElutasitottNev[];
}

/**
 * A javaslatok végignézése.
 *
 * A sorrend nem mindegy: előbb az egyedi vizsgálatok (betűk, ragozhatóság,
 * valódi névvel ütközés), utána a készletszintűek (ismétlődés, két nemben
 * szereplő név). Fordítva egy már kidobott név is „ismétlődésnek” minősítené a
 * párját, és két hibaüzenet szólna ugyanarról a bajról.
 */
export function ellenorizdAJavaslatokat(
  javaslatok: readonly NevJavaslat[],
  homonimak: Set<string>,
  nevKivetelek: Record<string, NameOverrides> = {},
): EllenorzesEredmeny {
  const elfogadva: EllenorzottNev[] = [];
  const elutasitva: ElutasitottNev[] = [];

  // Csoportonként külön nyilvántartás: a „Bazalt” lehet egyszerre cégnév-előtag
  // és utónév (a szállított csomagokban is az), vezetéknév és utónév viszont
  // nem — abból „Bazalt Bazalt” lenne.
  const latott = new Map<JavaslatCsoport, Set<string>>();
  for (const cs of ['given', 'surname', 'org', 'place'] as const) latott.set(cs, new Set());
  const nemenkent = new Map<string, Gender>();

  for (const j of javaslatok) {
    const form = (j.form ?? '').normalize('NFC').trim();
    const kulcs = form.toLowerCase();

    const alaki = alakiHiba(form, j.csoport);
    if (alaki !== null) {
      elutasitva.push({ form, csoport: j.csoport, ...alaki });
      continue;
    }

    if (valodiNev(kulcs, homonimak)) {
      elutasitva.push({
        form,
        csoport: j.csoport,
        ok: 'valodi_nev',
        indoklas:
          `A „${form}” valódi, gyakori magyar név vagy köznév. Fedőnévnek nem jó: az olvasó ` +
          'valódi személyre gondolna, a felismerő pedig ugyanezt a nevet keresné az iratban.',
      });
      continue;
    }

    /*
      A NEM SZERINTI VIZSGÁLAT ELŐBB JÖN, MINT AZ ISMÉTLŐDÉSÉ.

      Mérés döntötte el: a beégetett modellválaszban a „Nüx” egyszer női,
      egyszer férfi utónévként érkezik. Fordított sorrendben a második
      példányra „ismétlődés” lett a válasz — ami igaz, de nem ez a baj. A
      felhasználónak azt kell megtudnia, hogy a modell egy nevet két nemhez is
      hozzárendelt, mert ez a készlet minőségéről mond valamit.
    */
    if (j.csoport === 'given') {
      if (j.gender !== 'M' && j.gender !== 'F') {
        elutasitva.push({
          form,
          csoport: j.csoport,
          ok: 'nem_nelkul',
          indoklas:
            `A „${form}” utónévhez a modell nem adott meg nemet. A program a férfi és a női ` +
            'utónevet külön kezeli, nem szerinti besorolás nélkül nem tudja kiosztani.',
        });
        continue;
      }
      const korabbi = nemenkent.get(kulcs);
      if (korabbi !== undefined && korabbi !== j.gender) {
        elutasitva.push({
          form,
          csoport: j.csoport,
          ok: 'ket_nemben',
          indoklas: `A „${form}” egyszer férfi, egyszer női utónévként érkezett — így nem használható.`,
        });
        continue;
      }
    }

    if (latott.get(j.csoport)?.has(kulcs)) {
      elutasitva.push({
        form,
        csoport: j.csoport,
        ok: 'ismetlodes',
        indoklas: `A „${form}” már szerepel ebben a készletrészben; a másodpéldány kimarad.`,
      });
      continue;
    }

    // Utónév és vezetéknév ugyanazzal az alakkal: a kiosztó tiltja az azonos
    // tövű párt („Zsályás Zsálya”), de ha csak ez a két név maradna a
    // készletben, a tiltás nem tudná mit tenni.
    const masikNevlista = j.csoport === 'given' ? 'surname' : j.csoport === 'surname' ? 'given' : null;
    if (masikNevlista !== null && latott.get(masikNevlista)?.has(kulcs)) {
      elutasitva.push({
        form,
        csoport: j.csoport,
        ok: 'utonev_es_vezeteknev',
        indoklas:
          `A „${form}” már szerepel a másik névlistában. Ugyanaz a szó nem lehet utónév is meg ` +
          `vezetéknév is: „${form} ${form}” lenne belőle.`,
      });
      continue;
    }

    const nev = epitsdANevet(form, j, nevKivetelek);
    if (nev === null) {
      elutasitva.push({
        form,
        csoport: j.csoport,
        ok: 'ragozhatatlan',
        indoklas:
          `A „${form}” nevet a ragozó motor nem tudta végigragozni. Egy fedőnév, amit a program ` +
          'nem tud toldalékolni, az iratban ragozatlanul maradna — azonnal látszana, hogy gépi csere.',
      });
      continue;
    }

    latott.get(j.csoport)?.add(kulcs);
    if (j.csoport === 'given' && j.gender) nemenkent.set(kulcs, j.gender);
    elfogadva.push(nev);
  }

  return { elfogadva, elutasitva };
}

/** A név alaki hibái. Null, ha nincs hiba. */
function alakiHiba(
  form: string,
  csoport: JavaslatCsoport,
): { ok: ElutasitasOka; indoklas: string } | null {
  if (form.length === 0) {
    return { ok: 'ures', indoklas: 'Üres név érkezett.' };
  }
  if (!NEV_ALAK.test(form)) {
    return {
      ok: 'nem_magyar_betuk',
      indoklas:
        `A „${form}” nem egyszavas, nagybetűvel kezdődő magyar név. A ragozó motor a magyar ` +
        'ábécé betűire épül; ami nem az, azon a toldalékolás kiszámíthatatlan.',
    };
  }
  if (!VAN_MAGANHANGZO.test(form)) {
    return {
      ok: 'nincs_maganhangzo',
      indoklas: `A „${form}” nem tartalmaz magánhangzót, ezért a hangrendje sem állapítható meg.`,
    };
  }
  // A két betűnél rövidebb nevek („Ré”, „Ió”) toldalékolása szinte mindig
  // kötőjeles vagy rendhagyó, a húsz betűnél hosszabb pedig a szereplapon és a
  // PDF sorában sem fér el.
  if (form.length < 3) {
    return { ok: 'tul_rovid', indoklas: `A „${form}” túl rövid: legalább három betű kell.` };
  }
  const felsoHatar = csoport === 'place' ? 24 : 20;
  if (form.length > felsoHatar) {
    return {
      ok: 'tul_hosszu',
      indoklas: `A „${form}” túl hosszú (${form.length} betű): a szereplapon és az irat sorában sem fér el.`,
    };
  }
  return null;
}

/**
 * Ütközik-e valódi, gyakori magyar névvel.
 *
 * Két forrásból nézzük. A `data/homonyms.json` a köznévvel azonos neveket
 * tartalmazza (Nagy, Kis, Virág) — ezek egyben a leggyakoribb magyar
 * vezetéknevek is. A lenti beépített lista pedig azokat a gyakori neveket, amik
 * NEM köznevek (János, Erzsébet, Lukács), tehát a homonimafájlból hiányoznak.
 *
 * Az összetett nevet elemenként is megnézzük: a „Kis-Bazalt” éppúgy valódi
 * névvel kezdődik, mint a „Kis”.
 */
function valodiNev(kulcs: string, homonimak: Set<string>): boolean {
  const reszek = [kulcs, ...kulcs.split('-')];
  for (const r of reszek) {
    if (r.length === 0) continue;
    if (homonimak.has(r)) return true;
    if (VALODI_MAGYAR_NEVEK.has(r)) return true;
  }
  return false;
}

/**
 * Gyakori magyar utónevek és azok a gyakori vezetéknevek, amik nem köznevek.
 *
 * MIÉRT A KÓDBAN, ÉS NEM A `data/` ALATT: ez nem tartalom, hanem az ellenőrzés
 * saját tiltólistája. Ha adatfájl lenne, a hiánya nem hibát okozna, hanem
 * CSENDES ÁTENGEDÉST — a program minden javaslatot elfogadna, és a felhasználó
 * abban a hitben kapna „Kovács”-ot fedőnévnek, hogy a program megnézte. A
 * `homonyms.json` azért lehet mégis kívül, mert azt a felismerő is használja,
 * és ott a hiánya már ma is látható következménnyel jár.
 */
const VALODI_MAGYAR_NEVEK: ReadonlySet<string> = new Set(
  [
    // Férfi utónevek
    'lászló', 'istván', 'józsef', 'jános', 'zoltán', 'sándor', 'gábor', 'ferenc',
    'attila', 'péter', 'tamás', 'zsolt', 'tibor', 'andrás', 'csaba', 'imre',
    'balázs', 'gyula', 'károly', 'béla', 'lajos', 'miklós', 'róbert', 'krisztián',
    'dániel', 'dávid', 'bálint', 'máté', 'bence', 'ádám', 'levente', 'márton',
    'gergely', 'gergő', 'norbert', 'richárd', 'roland', 'szabolcs', 'antal',
    'árpád', 'barnabás', 'benedek', 'dezső', 'ernő', 'gáspár', 'géza', 'győző',
    'hunor', 'jenő', 'kálmán', 'kornél', 'kristóf', 'márk', 'mihály', 'nándor',
    'olivér', 'ottó', 'pál', 'patrik', 'rudolf', 'simon', 'szilárd', 'vince',
    'zsigmond', 'ákos', 'áron', 'botond', 'bertalan', 'endre', 'zsombor', 'milán',
    'viktor', 'zalán', 'vilmos', 'elemér', 'tivadar', 'szilveszter', 'domonkos',
    // Női utónevek
    'mária', 'erzsébet', 'katalin', 'ilona', 'éva', 'anna', 'zsuzsanna', 'margit',
    'judit', 'ágnes', 'julianna', 'andrea', 'krisztina', 'eszter', 'erika',
    'gabriella', 'mónika', 'szilvia', 'tímea', 'irén', 'piroska', 'terézia',
    'veronika', 'viktória', 'zsófia', 'beáta', 'bernadett', 'brigitta', 'csilla',
    'dóra', 'edit', 'emese', 'enikő', 'etelka', 'franciska', 'henrietta', 'ida',
    'ildikó', 'klára', 'kinga', 'lilla', 'luca', 'magdolna', 'marianna', 'melinda',
    'nikolett', 'noémi', 'nóra', 'olga', 'orsolya', 'petra', 'renáta', 'réka',
    'rita', 'sarolta', 'vivien', 'zita', 'alexandra', 'anita', 'adrienn',
    'barbara', 'bianka', 'cecília', 'dorottya', 'fanni', 'flóra', 'gréta',
    'hanna', 'jolán', 'karolina', 'laura', 'lívia', 'márta', 'matild', 'regina',
    'sára', 'szabina', 'tünde', 'valéria', 'vanda', 'zsanett', 'zsuzsa',
    // Gyakori vezetéknevek, amik nem köznevek — a homonimafájlból hiányoznak
    'lukács', 'fülöp', 'gál', 'bogdán', 'fábián', 'bencze', 'illés', 'bakos',
    'barta', 'budai', 'kelemen', 'vincze', 'berki', 'váradi', 'jakab',
    'ferenczi', 'kozma', 'orbán', 'vass', 'szalai', 'szalay', 'kerekes',
    'orsós', 'kolompár', 'kocsis', 'lengyel', 'losonczi', 'benedek',
  ].map((x) => x.normalize('NFC')),
);

/**
 * Az ellenőrzött név felépítése: hangrend, kivételek, teljes paradigma.
 *
 * A `harmony` szándékosan BELE KERÜL a téma-bejegyzésbe, akkor is, ha a
 * felismert érték megegyezik azzal, amit a motor futásidőben is kiszámolna. A
 * szállított csomagok is így csinálják: „futásidőben nincs találgatás” — ha egy
 * későbbi hangtani javítás megváltoztatná a `detectHarmony` eredményét, a
 * felhasználó által már jóváhagyott készlet ne kezdjen másképp ragozni.
 */
function epitsdANevet(
  form: string,
  j: NevJavaslat,
  nevKivetelek: Record<string, NameOverrides>,
): EllenorzottNev | null {
  const kivetel = nevKivetelek[form];
  const harmony: Harmony = kivetel?.harmony ?? detectHarmony(form);
  const overrides: NameOverrides = { ...(kivetel ?? {}), harmony };

  let paradigma: Paradigm;
  try {
    paradigma = buildParadigm(form, overrides);
  } catch {
    return null;
  }
  for (const eset of ALL_CASES) {
    const alak = paradigma[eset];
    // Üres alak, vagy olyan toldalékolt alak, ami nem hosszabb az alanyesetnél:
    // mindkettő azt jelenti, hogy a ragozás nem történt meg.
    if (!alak || alak.length === 0) return null;
    if (eset !== 'NOM' && alak.length <= form.length) return null;
  }

  const { kiejtesFuggo, notes } = ragozasiFigyelmeztetes(form, harmony, j.csoport, kivetel !== undefined);
  const esetek = j.csoport === 'surname' ? MUTATVANY_VEZETEKNEV : MUTATVANY_ESETEK;

  return {
    form,
    csoport: j.csoport,
    ...(j.gender ? { gender: j.gender } : {}),
    harmony,
    overrides,
    paradigma,
    mutatvany: esetek.map((eset) => ({
      eset,
      cimke: CASE_LABELS_HU[eset],
      alak: paradigma[eset],
    })),
    kiejtesFuggo,
    notes,
  };
}

/**
 * HOL TIPPEL A PROGRAM — és ezt ki kell mondani.
 *
 * A ragozó motor determinisztikus, de a bemenete nem mindig elég: van, amit a
 * magyar helyesírásból elvileg sem lehet levezetni, csak a KIEJTÉSBŐL. Ilyenkor
 * a motor a gyakoribb esetet választja, ami a magyar neveken szinte mindig jó, az
 * idegen eredetűeken viszont bukik. A „Héraklész” a program szerint mély
 * hangrendű (mert az utolsó nem semleges magánhangzója az 》a《), tehát
 * „Héraklésznak” lenne — a helyes alak „Héraklésznek”.
 *
 * Ezért a hibás alakot NEM dobjuk ki (attól még a név jó), hanem megjelöljük, és
 * a felhasználó elé tesszük a ragozott alakokkal együtt.
 */
function ragozasiFigyelmeztetes(
  form: string,
  harmony: Harmony,
  csoport: JavaslatCsoport,
  vanKezikivetel: boolean,
): { kiejtesFuggo: boolean; notes: string } {
  const jegyzetek: string[] = [];
  let kiejtesFuggo = false;
  const also = form.toLowerCase();

  /*
    (a) VEGYES HANGREND. A szó mélynek számít, mert az utolsó nem semleges
    magánhangzója mély — de a szó VÉGÉN semleges magánhangzó áll, és a fül a
    végét hallja. Két esetre bomlik, és a kettő nem egyforma kockázatú:

    ・ szóvégi i/í („Gránit”, „Olümposzi”): a mély toldalék a magyar szabály, és
      a szállított csomagok is így ragozzák. Megjegyzést érdemel, tippelésnek
      viszont nem nevezhető — ezért NEM kap kiejtésfüggő jelölést. (A mérés:
      minden szállított csomag i-re végződő mély neve mély toldalékot kap, és
      egyik sem hibás.)
    ・ szóvégi é („Héraklész”, „Andromakhé”): itt a program mélyet ad
      („Héraklésznak”), a valóságban viszont a görög-latin eredetű nevek magas
      toldalékot kapnak („Héraklésznek”). Ez valódi tévedés, tehát jelöljük.
  */
  const maganhangzok = form.match(BARMELY_MAGANHANGZO) ?? [];
  const utolso = maganhangzok[maganhangzok.length - 1];
  if (harmony === 'back' && utolso !== undefined && SEMLEGES_MAGANHANGZO.test(utolso)) {
    if (utolso === 'é' || utolso === 'É') {
      kiejtesFuggo = true;
      jegyzetek.push(
        'Mély hangrendű szó, de é-re végződik: a program mély toldalékot ad (…nak, …val, …hoz). ' +
          'A görög és latin eredetű neveknél ez a valóságban magas (…nek, …vel, …hez) — nézd meg ' +
          'a ragozott alakokat.',
      );
    } else {
      jegyzetek.push(
        'Az utolsó magánhangzó semleges i, de a szó mély hangrendű: …nak, …val, …hoz. Ez a ' +
          'magyar szabály szerint így helyes.',
      );
    }
  }

  // (b) A magyar ábécében nem szereplő betűk. A -val/-vel a KIEJTETT véghanghoz
  //     hasonul, azt viszont az írásképből nem lehet kiolvasni.
  if (IDEGEN_BETU.test(form) || MAGANYOS_Y.test(form)) {
    kiejtesFuggo = true;
    jegyzetek.push(
      'Nem magyar betűt tartalmaz (q, w, x vagy magányos y): az eszközhatározó alakja a kiejtett ' +
        'véghangtól függ, nem az írásképtől.',
    );
  }

  // (c) A „ch”: magyar névben [cs] (Madách → Madáchcsal), németben [h] (Bach →
  //     Bachhal). Az írásképből nem dönthető el — ezt az `inflect.ts` is
  //     kimondja, és ezért nincs rá szabály.
  if (also.includes('ch') && !vanKezikivetel) {
    kiejtesFuggo = true;
    jegyzetek.push(
      'A „ch” betűkapcsolat kiejtése kétféle lehet ([cs] vagy [h]), és ezen múlik a -val/-vel alak.',
    );
  }

  // (d) Idegen szóvég, ahol a toldalék kötőjellel kapcsolódna (Rousseau-val).
  for (const veg of IDEGEN_SZOVEG) {
    if (also.endsWith(veg)) {
      kiejtesFuggo = true;
      jegyzetek.push(
        `Idegen szóvég („-${veg}”): a toldalék valószínűleg kötőjellel kapcsolódik, amit a program ` +
          'magától nem tud eldönteni.',
      );
      break;
    }
  }

  // (e) Magas, ajakkerekítéses szó mássalhangzós véggel: a tárgyeset és a
  //     többes szám kötőhangzója -öt és -et között oszlik meg (tölgyet, de
  //     gyöngyöt). A hangrend ezt NEM dönti el — lásd `linkVowel`, inflect.ts.
  if (harmony === 'front_rounded' && !VAN_MAGANHANGZO.test(form.slice(-1))) {
    kiejtesFuggo = true;
    jegyzetek.push(
      'Magas, ajakkerekítéses szó: a tárgyeset kötőhangzója -ö és -e között oszlik meg ' +
        '(gyöngyöt, de tölgyet) — a program -ö-t ad, ellenőrizd.',
    );
  }

  // (f) Kettőzött mássalhangzós vég: az eszközhatározó kötőjeles lesz
  //     (Korall-lal). Ez SZABÁLYBÓL következik, tehát nem tipp — de a
  //     felhasználó furcsállná, ha nem mondanánk meg előre.
  const vegsoBetu = also.slice(-1);
  const elottiBetu = also.slice(-2, -1);
  if (vegsoBetu === elottiBetu && vegsoBetu.length === 1 && !VAN_MAGANHANGZO.test(vegsoBetu)) {
    jegyzetek.push(
      'Kettőzött mássalhangzóra végződik: az eszközhatározó kötőjeles alakú (a hármas ' +
        'betűtorlódás miatt). Ez így helyes.',
    );
  }

  // (g) Helységnév: a -n és a -ban közti választás a magyarban lexikális
  //     (Szolnokon, de Debrecenben). Szabályból nem következik, tehát MINDEN
  //     géppel javasolt helységnév tipp.
  if (csoport === 'place') {
    kiejtesFuggo = true;
    jegyzetek.push(
      'Helységnév: a program -n ragot ad (…on/…en), de a magyar helynevek egy része -ban/-ben ' +
        'ragot kap (Debrecenben). Ez nem szabály, hanem szokás — ellenőrizd.',
    );
  }

  return { kiejtesFuggo, notes: jegyzetek.join(' ') };
}

/* ------------------------------------------------------------------ *
 *  4. A KÉSZ TÉMA
 * ------------------------------------------------------------------ */

/**
 * A teljes út: nyers javaslatokból ellenőrzött, ragozott, használható téma.
 *
 * Ha nincs elég név, a `theme` NULL, és a jelentés megmondja, miből mennyi
 * hiányzik. Szándékosan nem adunk vissza félkész készletet: abból a program
 * számozott álneveket („Bazalt 2”) gyártana, és a felhasználó csak a kész
 * iratban venné észre.
 */
export function keszitsTemat(bemenet: TemaBemenet): TemaEredmeny {
  const { elfogadva, elutasitva } = ellenorizdAJavaslatokat(
    bemenet.javaslatok,
    bemenet.homonimak,
    bemenet.nevKivetelek ?? {},
  );

  const ferfi = elfogadva.filter((n) => n.csoport === 'given' && n.gender === 'M');
  const noi = elfogadva.filter((n) => n.csoport === 'given' && n.gender === 'F');
  const vezetek = elfogadva.filter((n) => n.csoport === 'surname');
  const cegek = elfogadva.filter((n) => n.csoport === 'org');
  const helyek = elfogadva.filter((n) => n.csoport === 'place');

  const hianyok: TemaHiany[] = [];
  if (ferfi.length < MIN_UTONEV_NEMENKENT) {
    hianyok.push(hiany('given', ferfi.length, MIN_UTONEV_NEMENKENT, true, 'férfi utónév', 'M'));
  }
  if (noi.length < MIN_UTONEV_NEMENKENT) {
    hianyok.push(hiany('given', noi.length, MIN_UTONEV_NEMENKENT, true, 'női utónév', 'F'));
  }
  if (vezetek.length < MIN_VEZETEKNEV) {
    hianyok.push(hiany('surname', vezetek.length, MIN_VEZETEKNEV, true, 'vezetéknév'));
  }
  if (cegek.length < AJANLOTT_CEGELEM) {
    hianyok.push(hiany('org', cegek.length, AJANLOTT_CEGELEM, false, 'cégnév-előtag'));
  }
  if (helyek.length < AJANLOTT_HELYNEV) {
    hianyok.push(hiany('place', helyek.length, AJANLOTT_HELYNEV, false, 'helységnév'));
  }

  const hasznalhato = hianyok.every((h) => !h.kotelezo);
  const atnezendo = elfogadva.filter((n) => n.kiejtesFuggo);

  const jelentes: TemaJelentes = {
    temaSzoveg: bemenet.temaSzoveg.trim(),
    javaslatokSzama: bemenet.javaslatok.length,
    elfogadva,
    elutasitva,
    atnezendo,
    hianyok,
    hasznalhato,
    figyelmeztetesek: figyelmeztetesek(atnezendo, elutasitva, hasznalhato),
  };

  if (!hasznalhato) return { theme: null, jelentes };

  const theme: Theme = {
    id: temaAzonosito(bemenet.temaSzoveg),
    name_hu: temaCime(bemenet.temaSzoveg),
    description_hu: leiras(bemenet.temaSzoveg, ferfi.length, noi.length, vezetek.length, elutasitva.length),
    license_note: LICENC_MEGJEGYZES,
    /*
      A SORREND ITT TEHERVISELŐ, ezért nincs sehol rendezés ezen az úton.

      A névsorok prioritási listák: a kiosztó (`assignPseudonyms`) a lista
      ELEJÉRŐL adja a nevet az iratban elsőként megjelenő félnek. A modelltől
      is prioritási sorrendben kérjük a listát (`epitsdAJavaslatKerest` 6.
      szabálya), és ez a sorrend a szűrésen át idáig változatlanul jut el.
      Aki ide ábécésorrendet vagy bármi más rendezést tesz, az a legfontosabb
      fél álnevét teszi véletlenszerűvé.

      A férfi és a női utónevek külön blokkban követik egymást; a kiosztó
      nemenként szűr, tehát mindkét nem a SAJÁT blokkja elejéről kap nevet.
    */
    given_names: [...ferfi, ...noi].map(temaBejegyzes),
    surnames: vezetek.map(temaBejegyzes),
    // A cégnév-előtag a téma-szerkezetben puszta szó: a szervezetnevet a kiosztó
    // rakja össze belőle, a toldalékolást pedig az `inflectOrganization` végzi,
    // ami a cégformából (Kft., Zrt.) dolgozik, nem a névből.
    org_parts: cegek.map((n) => n.form),
    place_names: helyek.map(helyBejegyzes),
  };

  return { theme, jelentes };
}

function hiany(
  csoport: JavaslatCsoport,
  van: number,
  kell: number,
  kotelezo: boolean,
  megnevezes: string,
  gender?: Gender,
): TemaHiany {
  const hianyzik = kell - van;
  const uzenet = kotelezo
    ? `Kevés a ${megnevezes}: ${van} van meg a szükséges ${kell}-ból. Kérj még legalább ${hianyzik} darabot.`
    : `Kevés a ${megnevezes} (${van} db). Enélkül is működik a készlet, de a program ilyenkor a ` +
      'vezetéknevekből vagy a beépített listából dolgozik, ami elüt a témától.';
  return { csoport, ...(gender ? { gender } : {}), van, kell, kotelezo, uzenet };
}

function figyelmeztetesek(
  atnezendo: readonly EllenorzottNev[],
  elutasitva: readonly ElutasitottNev[],
  hasznalhato: boolean,
): string[] {
  const out: string[] = [];

  out.push(
    'A neveket nyelvi modell javasolta, a ragozást viszont a program saját motorja készítette. ' +
      'A készletet HASZNÁLAT ELŐTT nézd át: a ragozott alakokat a lista mutatja.',
  );

  if (atnezendo.length > 0) {
    const peldak = atnezendo.slice(0, 3).map((n) => `„${n.form}”`).join(', ');
    out.push(
      `${atnezendo.length} névnél a helyes ragozás a KIEJTÉSEN múlik, amit a helyesírásból nem ` +
        `lehet levezetni (${peldak}). Ezeknél a program a gyakoribb alakot választotta, de ` +
        'tévedhet: idegen eredetű névnél ez a jellemző eset, mert az írásképből nem derül ki, ' +
        'hogyan hangzik a szó vége.',
    );
  }

  const valodiUtkozes = elutasitva.filter((e) => e.ok === 'valodi_nev').length;
  if (valodiUtkozes > 0) {
    out.push(
      `${valodiUtkozes} javaslat valódi, gyakori magyar névvel ütközött, ezért kimaradt. Ez ` +
        'szándékos: a fedőnévnek látszania kell, hogy kitalált.',
    );
  }

  out.push(
    'A program azt NEM tudja megnézni, hogy egy javasolt név védjegy vagy szerzői jogi oltalom ' +
      'alatt álló műből származik-e. A mitológiai, csillagászati és köznyelvi nevek szabadok; egy ' +
      'filmből vagy könyvsorozatból vett név nem feltétlenül.',
  );

  if (!hasznalhato) {
    out.push('Ez a készlet így még nem használható: kevés név ment át az ellenőrzésen.');
  }

  return out;
}

function temaBejegyzes(n: EllenorzottNev): ThemeEntry {
  return {
    form: n.form,
    ...(n.gender ? { gender: n.gender } : {}),
    harmony: n.harmony,
    notes: n.notes,
    // A `harmony` már külön mezőben áll (a `toOverrides` úgyis oda teszi);
    // ide csak akkor kerül bármi, ha valódi kivétel is tartozik a névhez.
    ...(vanErdemiKivetel(n.overrides) ? { overrides: n.overrides } : {}),
  };
}

function helyBejegyzes(n: EllenorzottNev): ThemePlace {
  return {
    form: n.form,
    // Alapértelmezés a -n rag, ugyanaz, amit az `assignPlace` is használ. A
    // -ban/-ben ragot kapó helynevek lexikálisan térnek el; ezt a modell nem
    // tudja, ezért nem is kérjük tőle — a figyelmeztetés viszont kimondja.
    locative: 'sup',
    ...(vanErdemiKivetel(n.overrides) ? { overrides: n.overrides } : {}),
  };
}

function vanErdemiKivetel(ov: NameOverrides): boolean {
  return Object.keys(ov).some((k) => k !== 'harmony');
}

const LICENC_MEGJEGYZES =
  'Saját készlet: a neveket nyelvi modell javasolta a beírt téma alapján, a magyar ragozást a ' +
  'program állította elő. A program a magyar helyesírást, a ragozhatóságot és a valódi magyar ' +
  'nevekkel való ütközést ellenőrizte. Azt NEM tudta megnézni, hogy egy név védjegy, létező ' +
  'cégnév vagy szerzői jogi oltalom alatt álló műből vett szereplőnév-e. Kiadott iraton csak ' +
  'akkor használd, ha ezt magad átnézted.';

function leiras(
  temaSzoveg: string,
  ferfi: number,
  noi: number,
  vezetek: number,
  kidobva: number,
): string {
  return (
    `„${temaCime(temaSzoveg)}” — saját névkészlet, amelyet nyelvi modell javasolt, és a program ` +
    `magyar ragozó motorja ellenőrzött. ${ferfi} férfi és ${noi} női utónév, ${vezetek} vezetéknév. ` +
    `Az ellenőrzésen ${kidobva} javaslat nem ment át.`
  );
}

/** A téma megjelenített címe: az első betű nagy, a többi marad. */
export function temaCime(temaSzoveg: string): string {
  const t = temaSzoveg.trim().replace(/\s+/g, ' ');
  if (t.length === 0) return 'Saját névkészlet';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * A téma azonosítója a beírt szövegből.
 *
 * A 》sajat_《 előtag nem díszítés: ebből tudja a felület és a beállításfájl,
 * hogy nem szállított csomagról van szó, és ez zárja ki, hogy egy „ásványok”
 * témájú saját készlet felülírja a szállított `asvanyok` csomagot.
 */
export function temaAzonosito(temaSzoveg: string): string {
  const ekezettelen = [...temaSzoveg.trim().toLowerCase()]
    .map((ch) => EKEZET_NELKUL[ch] ?? ch)
    .join('');
  // Az ékezetek eltávolítása UTÁN már tiszta ASCII-ról van szó, tehát itt az
  // ASCII-alapú osztály nem hazudik — ez a szabály alóli egyetlen eset, és
  // szándékos: az azonosító fájlnévben és beállításban is szerepel.
  const mag = ekezettelen.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `sajat_${mag.length > 0 ? mag : 'nevkeszlet'}`;
}

const EKEZET_NELKUL: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ö: 'o', ő: 'o', ú: 'u', ü: 'u', ű: 'u',
};
