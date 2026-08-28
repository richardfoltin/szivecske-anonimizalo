import { useId, useRef } from 'react';
import type { PartyInput, ReplacementMode, ThemeSummaryUi } from './api';
import { FelismeroSav, NevkeszletRacs } from './dialogs';
import { Kapcsolo } from './kapcsolo';

/*
  A MEGNYITÁS UTÁNI BEÁLLÍTÓ OLDAL.

  Az iratra vonatkozó döntések IDE kerültek, a Beállítások „Alapértelmezések”
  fülétől elvéve. Azért nem maradhattak ott, mert egyik sem programbeállítás:
  egy peres iratot másképp kell álnevesíteni, mint egy szerződést, és a
  felhasználó a döntést akkor tudja meghozni, amikor már látja, mi van az
  iratban. Amíg ugyanaz a kapcsoló két helyen állt, a Beállításokban beállított
  érték és a dokumentumra érvényes érték csendben szétcsúszott — a felhasználó
  pedig azt hitte, azt állította be, amit lát.

  A lap KÉT FÜLBŐL áll, és ez a kettő a munka két kérdése:

    „Mire cseréljük?”  — mi kerüljön a nevek helyére: címke vagy fedőnév.
    „Mit cserélünk?”   — mihez nyúljunk hozzá az iratban, és mihez ne.

  A „Hogyan cseréljük?” fül megszűnt. Öt kapcsoló állt rajta, és egyik sem
  tartozott össze a másikkal: kettő (összeg, dátum) arról szólt, MIT cserélünk
  — annak a második fülön a helye, a többi találat mellett, ugyanazokkal a
  gombokkal. Kettő (küszöb, kulcsfájl) a második fül fejlécébe került, mert
  ott van hatásuk. Az ötödik, a „kérdezés nélkül menjen végig”, egy KAPCSOLÓ
  volt egy MŰVELETRE: nem állapot, hanem tett — ma gomb a lista fölött
  („Mindent cserélünk”), ott, ahol látszik is, mit csinál.

  A komponens semmit nem tárol magának a nyitott fülön kívül — minden érték
  propként érkezik, minden változás visszahíváson megy vissza. A nyitott fül
  azért kivétel, mert az nem az irat adata: ha a hívó tárolná, egy tetszőleges
  másik állapotváltozás visszaugrasztaná a felhasználót az első fülre.
*/

/* ─────────────────────────── amit a lap kap ─────────────────────────── */

/**
 * A találat fajtája.
 *
 * A motor típusából SZÁRMAZTATVA, nem lemásolva: ha a motorban új fajta
 * születik, itt fordítási hiba lesz belőle (a `FAJTA_CIM` táblázat hiányos
 * lesz), nem pedig egy néma, címke nélkül megjelenő csoport a felületen.
 *
 * A két saját fajta (`amount`, `date`) NEM félfajta, és nincs is a motor
 * `EntityKind`-jában: az összeg és a dátum nem entitás, hanem az iratban
 * megtalált érték. A LAPON viszont ugyanúgy kell viselkedniük, mint a
 * neveknek — a felhasználó kérése szó szerint az volt, hogy „ugyanúgy legyen
 * kezelve” —, ezért kapnak sort a listán, ugyanazokkal a gombokkal.
 */
export type Fajta = PartyInput['kind'] | 'amount' | 'date' | 'hivatalos';

/**
 * Az EBBEN AZ IRATBAN érvényes beállítások.
 *
 * Szándékosan ugyanazok a mezőnevek, mint az `AppSettings` megfelelő mezőin:
 * a hívó a legutóbbi beállításokból egy az egyben fel tudja tölteni, és a
 * mentéskor egy az egyben vissza tudja írni. Külön névvel a két oldal
 * összepárosítása kézi munka volna, és pont ott hibázna, ahol nem látszik.
 */
export interface DokumentumBeallitasok {
  mode: ReplacementMode;
  themeId: string;
  /** A címkék nyelve a szerep-, adatfajta- és számozott módban. */
  labelLang: 'hu' | 'en';
  autoThreshold: number;
  keepKey: boolean;
  replaceAmounts: boolean;
  shiftDates: boolean;
  /** KÉZI szorzó az összegekhez; hiányában az ügy kulcsából számoljuk. */
  amountFactor?: number;
  /** KÉZI eltolás napban a dátumokhoz; hiányában a kulcsból. */
  dateShiftDays?: number;
  /**
   * A törvény szerint bent maradó neveket (eljáró bíró, ügyvéd, bíróság) is
   * lecseréljük-e.
   *
   * ALAPBÓL HAMIS, és ez nem óvatoskodás: a Bszi. 166. § (2) szerint ezeknek a
   * neveknek bent kell maradniuk. A kapcsoló azért létezik mégis, mert nem
   * minden irat megy bíróságra — egy belső feljegyzésben vagy egy nyelvi
   * modellnek átadott másolatban a bíró neve ugyanolyan személyes adat, mint
   * bárkié. A felelősség viszont a felhasználóé, ezért a kapcsoló mellett
   * kimondjuk, mit jelent bekapcsolni.
   *
   * SOHA NEM JEGYEZZÜK MEG a következő iratra: egy alapból kikapcsolt,
   * jogszabályi következménnyel járó kapcsolót nem szabad csendben átvinni egy
   * másik iratra, amit a felhasználó esetleg épp a bíróságra küld.
   */
  replaceOfficials: boolean;
}

/**
 * Hogyan végződött a megnyitás után magától elinduló vizsgálat.
 *
 * Négy külön eset, mert négy külön teendő tartozik hozzájuk. A „nem talált
 * semmit” és a „meg lett szakítva” a képernyőn ugyanúgy üres listának
 * látszik — a kettő közül viszont csak az egyik jelenti azt, hogy az irat
 * tényleg nem tartalmaz nevet. Ha nem mondjuk meg, melyik történt, a
 * felhasználó a félbehagyott vizsgálat után adja ki az iratot.
 */
export type VizsgalatAllapot = 'kesz' | 'megszakitva' | 'hiba' | 'kihagyva';

/** Egy találat úgy, ahogy a „Mit cserélünk?” fülön áll. */
export interface TalaltTetel {
  id: string;
  fajta: Fajta;
  /** Ahogy az iratban szerepel. */
  eredeti: string;
  /** Eljárási szerep („I. r. alperes”) vagy azonosítónál az adatfajta („adószám”). */
  szerep: string;
  /** Hány helyen fordul elő az iratban. */
  elofordulas: number;
  /**
   * Hány előfordulása cserélődik le a MOSTANI állással.
   *
   * Ez a szám mondja meg, melyik gomb aktív a soron — nem egy külön tárolt
   * kapcsolóállás. Külön tárolva a kettő szétcsúszhatna, és a felhasználó egy
   * „cserélünk” feliratú sor mellett kapna változatlan iratot.
   */
  cserelodik: number;
  /** Amit a program a helyére írna a mostani beállításokkal. */
  csere: string;
  /** Ha a felhasználó ezen a lapon átírta a csereszöveget. */
  sajatCsere?: string;
  /**
   * Hány előfordulása vár még emberi döntésre.
   *
   * KÜLÖN a `cserelodik`-tól, mert a „nem cserélődik” két teljesen különböző
   * dolgot jelenthet: vagy MEGMONDTUK, hogy maradjon (döntés), vagy még senki
   * nem nyilatkozott róla (bizonytalan). A régi kapcsoló ezt a kettőt
   * összemosta, és a képernyőn a „Nincs csere” állás bekapcsolva látszott
   * olyan névnél is, amiről a felhasználó soha nem döntött — vagyis a program
   * a saját tétlenségét mutatta be az ő döntéseként.
   */
  bizonytalanDb: number;
  /**
   * A program döntött róla ember helyett (bizonytalan volt, és a program
   * elfogadta). NEM ugyanaz, mint a döntésre váró találat: azt a
   * `bizonytalanDb` számolja. A kettőt összemosva a program a saját
   * tétlenségét mutatta be döntésként.
   */
  programDontott?: boolean;
  /**
   * Van-e még olyan előfordulása, amit a „Csere a következőt” bekapcsolhat.
   *
   * A gomb enélkül ott is aktív maradna, ahol már nincs mit bekapcsolni, és a
   * felhasználó azt hinné, hogy a program nem reagál a kattintására.
   */
  vanKovetkezo: boolean;
  /**
   * Kézzel felvett név: a lista a vizsgálatot pótolja vele.
   *
   * A csereszöveg-mezője ugyanúgy szerkeszthető, de a „bizonytalan” jelvény
   * nem tartozik rá: nem a program ítélte bizonytalannak, hanem a felhasználó
   * írta be.
   */
  kezi?: boolean;
}

/**
 * A LÉPEGETÉS ÁLLÁSA — melyik tétel hányadik előfordulásán áll a kijelölés.
 *
 * Nem a lap tárolja, hanem a hívó, mégpedig a dokumentum kijelöléséből
 * SZÁRMAZTATVA. Ez nem takarékosság: a lépegetés és az iratra kattintás
 * ugyanazt a kijelölést mozgatja, tehát a kettő nem tud széttartani — az
 * iraton megjelölt előfordulás a listán is ott áll, és fordítva.
 */
export interface LepesAllas {
  entityId: string;
  /** Hányadik előfordulásnál járunk (0-tól). */
  index: number;
  osszes: number;
  /** A MOSTANI előfordulás cserélődik-e — ettől világít a „Cserél” vagy a „Kihagy”. */
  cserelodik: boolean;
}

/** Egy név, ami a törvény szerint bent marad. */
export interface BentMarado {
  name: string;
  why: string;
}

export interface DocumentSetupProps {
  /*
    A FÁJLNÉV NEM SZEREPEL A LAPON.

    A lap a kétpaneles elrendezésben jobb oldali panel lett, az irat pedig
    mellette áll, a saját fejlécén a nevével. Másodszor kiírva egy sort venne
    el a magyarázatoktól, cserébe semmi újat nem mondana.
  */
  beallitasok: DokumentumBeallitasok;
  temak: ThemeSummaryUi[];
  tetelek: TalaltTetel[];
  bentMaradok: BentMarado[];
  /**
   * Tudja-e a híd kész félként átadni a megtartandó neveket
   * (`DetectionResult.officials`).
   *
   * Régebbi hídon nincs meg, és ilyenkor a kapcsolót MEG SEM MUTATJUK: egy
   * gomb, ami semmit nem tud lecserélni, rosszabb, mint a hiánya.
   */
  hivatalosCserelheto: boolean;
  vizsgalat: VizsgalatAllapot;
  /**
   * Éppen fut-e a vizsgálat.
   *
   * A lapot a felhasználó akkor is nézheti, amikor a modell újraolvassa az
   * iratot (a vizsgálat innen is indítható). Ilyenkor a modellsáv gombjai
   * tiltottak: egy második indítás vagy egy modellváltás menet közben a futó
   * vizsgálat eredményét dobná el, szó nélkül.
   */
  vizsgalatFut: boolean;
  /** Hiba esetén a hiba szövege; egyébként bármi, amit a vizsgálatról tudni kell. */
  vizsgalatUzenet?: string;
  onBeallitas: (valtozas: Partial<DokumentumBeallitasok>) => void;
  /**
   * A csereszöveg kézi átírása.
   *
   * ÜRES SZÖVEG = vissza az alapértelmezetthez. Így a mező kiürítése nem
   * eredményez üres álnevet — az ugyanis a nevet nem álnevesítené, hanem
   * kitörölné, és a mondat helyén hézag maradna.
   */
  onCsereSzoveg: (id: string, szoveg: string) => void;
  /*
    A HÁROM GOMB (Mind / Következő / Nincs csere) INNEN KIKERÜLT.

    A felhasználó kimondta, hogy nem érti — és igaza volt: három gomb állt egy
    sorban, amiből kettő állapotot mutatott, egy műveletet indított, és
    egyikről sem látszott, melyik. Két KÜLÖNBÖZŐ kérdés bújt meg mögöttük:

      1. cserélődjön-e ez a tétel egyáltalán       → ez EGY kapcsoló;
      2. hadd nézzem végig egyesével a helyeit     → ez a LÉPEGETÉS.
  */
  /** A sor kapcsolója: cserélődjön-e ez a tétel. Ki = minden előfordulása marad. */
  onKapcsol: (id: string, be: boolean) => void;
  /** A lépegetés állása; `null`, ha egyik soron sem lépeget senki. */
  lepes: LepesAllas | null;
  /** Lépegetés indítása: az első előfordulásra ugrik az irat. */
  onLepesKezd: (id: string) => void;
  /** Előző/következő előfordulás — döntés nélkül, csak odagörgetve. */
  onLepesMozog: (id: string, irany: 1 | -1) => void;
  /**
   * Döntés a MOSTANI előfordulásról, majd ugrás a következőre — a Word Csere
   * párbeszédének mozdulata. A „kihagy” pontosan az, mint az iratban a
   * kiemelésre kattintani: egyetlen előfordulás cseréjét kapcsolja ki.
   */
  onLepesDontes: (id: string, dontes: 'accept' | 'skip') => void;
  /** Egy egész csoport ki- vagy bekapcsolása a fejlécéből. */
  onCsoport: (fajta: Fajta, be: boolean) => void;
  /** Mindent, ami az iratban találat: egyetlen kattintással cserére. */
  onUjraVizsgalat: () => void;
  onKeziFelvitel: () => void;
  /** A nevek újra kiosztása; hiányában a gomb meg sem jelenik. */
  onUjraOsztas?: () => void;
  /**
   * Új névkészlet gyártása — a „Mire cseréljük?” fül hozzáadó kártyájáról.
   *
   * A gyártás nem az irat dolga (a készlet minden ügyben ugyanaz, és percekbe
   * telik előállítani), a KÉRÉS viszont itt születik: a felhasználó a rácsot
   * nézve jön rá, hogy egyik készlet sem jó neki. Ezért nem maga a lap nyitja
   * meg az ablakot, hanem szól a főfolyamatnak.
   */
  onUjKeszlet: () => void;
  onKeszletTorles: (id: string) => void;
  /**
   * A NYITOTT FÜL — kívülről vezérelve.
   *
   * Korábban a lap SAJÁT állapota volt, épp azért, hogy egy tetszőleges
   * újraszámolás ne ugrasszon vissza az első fülre. A harmadik fül viszont a
   * folyamat állomása: a „Mehet a csere" ide lép tovább, a mentés utáni
   * „nézzük át" út pedig visszahoz a másodikra. Ezt csak a hívó tudja
   * elvégezni — a stabilitást pedig az adja, hogy CSAK ő írja, és csak
   * kimondott lépésnél.
   */
  ful: Ful;
  onFul: (ful: Ful) => void;
  /** Az „Ellenőrzés és mentés" fül tartalma — a hívó rakja össze. */
  keszLap: React.ReactNode;
  /** A lap láblécének fő gombja a harmadik fülön: a mentés. */
  onMentes: () => void;
  /** Miért nem lehet menteni; `null`, ha mehet. */
  mentesAkadaly: string | null;
  onTovabb: () => void;
  /*
    AZ `onMegse` INNEN ELTŰNT.

    A „Másik iratot nyitok" gombot vitte, az pedig ugyanoda vezetett, ahova a
    fejléc megnyitás ikonja — csak a lap alján, a legfontosabb gomb mellől
    elvéve a figyelmet. A megnyitás útja egy maradt: a fejléc (és vele a menü
    meg a Ctrl+O).
  */
}

/* ─────────────────────────── szövegtáblák ─────────────────────────── */

/**
 * A csere-módok nevei.
 *
 * Táblázatban állnak, mert nem csak a kártya hivatkozik rájuk: a lépéssáv is
 * ezen a néven nevezi az érvényes módot. Két külön leírt szöveg előbb-utóbb
 * kétféle nevet adna ugyanannak a döntésnek.
 *
 * A 'theme' azért maradt bent, mert a lépéssáv továbbra is használja — a
 * kártyák között viszont NINCS „Fedőnevek” kártya: azt a névkészlet-kártyák
 * MAGUK jelentik. Egy külön „Fedőnevek” kártya mellett a felhasználónak
 * kétszer kellene választania ugyanazt (előbb a módot, aztán a készletet),
 * pedig a kettő egyetlen döntés.
 */
export const MODE_LABEL: Record<ReplacementMode, string> = {
  theme: 'Fedőnevek',
  role: 'Hivatalos (OBH) — eljárási szerep',
  type: 'Adatfajta neve',
  numbered: 'Számozott címke',
};

/**
 * A MÓD NEVE ÖNMAGÁBAN NEM MOND SEMMIT — a kártyán ezért PÉLDA áll.
 *
 * „Adatfajta neve” és „Számozott címke” két olyan megnevezés, amiből egy
 * ügyvéd nem tudja kitalálni, hogyan fog kinézni a kész irat; a különbséget
 * viszont egyetlen pillantásra meglátja rajta, ha ugyanaz a név mindegyik
 * kártyán ott áll, más-más kimenettel.
 *
 * A példák BAL OLDALA szándékosan azonos (`PELDA_NEV`): a szem így a jobb
 * oldalt hasonlítja össze, nem két különböző mondatot olvas el.
 */
const PELDA_NEV = 'Kovács János';

type CimkeMod = Exclude<ReplacementMode, 'theme'>;

const CIMKE_MODOK: CimkeMod[] = ['role', 'type', 'numbered'];

/**
 * Mi kerül a példanév helyére — MINDKÉT NYELVEN.
 *
 * Az angol változat nem fordítás-kísérlet, hanem ugyanaz a zárt táblázat, ami
 * a motorban is áll (`ROLE_EN`, `TYPE_LABEL_EN`, `NUMBERED_LABEL_EN`,
 * src/pseudonym.ts). A kártyán tehát pontosan az látszik, ami az iratba kerül.
 */
const MODE_PELDA: Record<CimkeMod, Record<'hu' | 'en', string>> = {
  role: { hu: 'a felperes', en: 'the plaintiff' },
  type: { hu: '[név]', en: '[name]' },
  numbered: { hu: '[NÉV-1]', en: '[NAME-1]' },
};

/**
 * Egy mondat arról, mit jelent a mód — a kártyán a példa alatt.
 *
 * RÖVID, mert a kártyán négy sor jut rá: a hosszabb szöveg nem tolná lejjebb a
 * következő rovatot, hanem elfogyna a végén. A teljes szöveg így is elolvasható
 * — a kártya lebegő súgójában áll —, de a képernyőn nem szabad félbevágott
 * mondatnak látszania.
 */
const MODE_LEIRAS: Record<CimkeMod, string> = {
  role: 'Az eljárásbeli szerep kerül a helyére. Akinek nincs szerepe, az az adatfajta nevét kapja.',
  type: 'Az adatfajta megjelölése kerül a helyére, az OBH 4/2021. §10(2) szóhasználatával.',
  numbered: 'Semleges címke. Minden fél saját számot kap, tehát végig megkülönböztethetők.',
};

/*
  A CSOPORTOK SORRENDJE nem ábécé és nem is a találatok száma szerinti: a
  személynév a legsúlyosabb, azt nézi át a felhasználó a legfigyelmesebben,
  ezért az áll elöl. Az azonosító után jön az összeg és a dátum: azokat a
  program magától is felveszi vagy kihagyja, ott ellenőrizni kell, nem dönteni.
*/
/*
  A „hivatalos” SZÁNDÉKOSAN NINCS ITT. Külön szakaszt kap a lista végén, saját
  kapcsolóval és saját magyarázattal — a felek közé keverve a felhasználó
  hibának nézné őket, és „kijavítana” egy olyan iratot, ami így volt helyes.
*/
const CSOPORT_SORREND: Fajta[] = ['person', 'org', 'place', 'identifier', 'amount', 'date'];

const FAJTA_CIM: Record<Fajta, string> = {
  person: 'Személyek',
  org: 'Szervezetek',
  place: 'Helyek',
  identifier: 'Azonosítók',
  amount: 'Összegek',
  date: 'Dátumok',
  hivatalos: 'Hivatalos szereplők',
};

/*
  EGY SOR CSOPORTONKÉNT — amit a csoport címe nem mond el.

  A hosszabb magyarázat a lebegő súgóba került (`FAJTA_SUGO`): a képernyőn a
  lista a lényeg, nem a köré írt szöveg. Ami itt maradt, az mind TÉNY, amit a
  csoport nevéből nem lehet kitalálni — hogy az azonosító nem álnevet kap,
  hogy az összegek közös szorzóval változnak, hogy az eltolt dátumból nem
  szabad határidőt számolni.
*/
const FAJTA_MIERT: Record<Fajta, string> = {
  person: 'A felek, a tanúk, a hozzátartozók.',
  org: 'Cégek, hivatalok, intézmények.',
  place: 'Települések, utcák, ingatlanok.',
  identifier: 'Ezek adatfajta-megjelölést kapnak, nem álnevet.',
  amount: 'Közös szorzóval változnak. Az arányuk egymáshoz megmarad.',
  date: 'Közös eltolás. Az eltolt iratból határidőt számolni nem szabad.',
  hivatalos: 'Az eljáró bíró, az ügyvéd és a bíróság neve. A Bszi. 166. § (2) szerint bent kell maradniuk.',
};

/** A teljes magyarázat — a csoport fejlécének lebegő súgójában. */
const FAJTA_SUGO: Record<Fajta, string> = {
  person: 'Akiknek a neve az iratban szerepel: a felek, a tanúk, a hozzátartozók.',
  org: 'Cégek, hivatalok, intézmények neve.',
  place: 'Települések, utcák, ingatlanok megnevezése.',
  identifier:
    'Lakcím, e-mail, adószám, TAJ, bankszámlaszám, helyrajzi szám. Ezek helyére sosem álnév kerül, hanem az adatfajta megjelölése — egy kitalált tízjegyű szám ugyanúgy valódinak látszana.',
  amount:
    'Fedőnév-módban minden összeg ugyanazzal, az ügyre állandó szorzóval változik, így az összefüggések megmaradnak. A másik három módban [összeg] kerül a helyükre. Pénznem nélküli számhoz — paragrafus, ügyszám, határidő — a program nem nyúl.',
  date:
    'Egyetlen, az ügyre állandó eltolás: az időközök megmaradnak, a 90 napos felmondási idő utána is 90 nap. Az eltolt iratból viszont határidőt számolni nem szabad. A jogszabályok évszámához a program nem nyúl.',
  hivatalos:
    'A Bszi. 166. § (2) szerint az eljáró bíró, az ügyvéd, az ügyvédi iroda és a bíróság neve a bírósági határozat közzétett változatában nem anonimizálható.',
};

/**
 * EGY CSOPORT FEJLÉCE — a kapcsoló IDE került, nem egy külön sorba alá.
 *
 * Az összeg, a dátum és a hivatalos szereplők kapcsolója korábban a csoporton
 * BELÜL állt, saját sorban, a fejléc alatt. Így viszont ugyanaz a kapcsoló két
 * dolognak látszott: a fejléc a csoportról szólt, a sor pedig mintha a csoport
 * egyik tétele volna. A fejlécsor jobb szélén nincs kérdés — a kapcsoló arra
 * vonatkozik, aminek a nevét mellette olvassa a felhasználó.
 */
function CsoportFejlec({
  fajta,
  darab,
  be,
  kapcsolo,
  figyelem,
  mertek,
}: {
  fajta: Fajta;
  darab: number;
  /**
   * Cserélődik-e ebből a csoportból bármi.
   *
   * A FEJLÉC SZÍNE MONDJA EL — nem soronként egy felirat. Korábban minden
   * kikapcsolt sor alatt ott állt, hogy „az eredeti szöveg bent marad az
   * iratban”: húsz sornál hússzor ugyanaz a mondat, és a lényeg — hogy EGY
   * egész csoporthoz nem nyúlunk — épp elveszett benne. A bekapcsolt csoport
   * fejléce viseli a saját színét, a kikapcsolté elhalványul.
   */
  be: boolean;
  /** A csoport egészére szóló kapcsoló; ahol nincs, ott a fejléc egyszerű. */
  kapcsolo?: React.ReactNode;
  /** A leírósor HELYÉRE kerülő figyelmeztetés — a fejléc magassága nem változik tőle. */
  figyelem?: React.ReactNode;
  /**
   * A csoport SAJÁT mértéke: az összegek szorzója, a dátumok eltolása.
   *
   * Csak bekapcsolt csoportnál van értelme, ezért a hívó dönti el, adja-e.
   */
  mertek?: React.ReactNode;
}) {
  return (
    <div className={`fghead ${FAJTA_SZIN[fajta]}${be ? '' : ' ki'}`}>
      <div className="fgszoveg">
        <div className="t">
          {FAJTA_CIM[fajta]} <span className="count">{darab}</span>
        </div>
        <div className="s">{figyelem ?? FAJTA_MIERT[fajta]}</div>
      </div>
      {mertek !== undefined && <div className="fgmertek">{mertek}</div>}
      {kapcsolo !== undefined && <div className="fgctl">{kapcsolo}</div>}
    </div>
  );
}

/**
 * A CSOPORT MÉRTÉKE: a szorzó és az eltolás, kézzel átírhatóan.
 *
 * MIÉRT KELL. Alapból mindkettő az ügy kulcsából származik — kiszámíthatatlan,
 * de ügyön belül állandó. Van viszont, amikor az ügyvédnek KEREK érték kell,
 * mert az iratot valakinek el kell magyaráznia: „minden összeg a
 * háromnegyede", „minden dátum egy évvel korábbi". Ez a mező erről szól.
 *
 * AMI NEM VÁLTOZIK TŐLE: az összegek egymáshoz való aránya és a dátumok közti
 * időköz. Minden érték UGYANAZZAL a mértékkel mozdul — a kézi megadás csak azt
 * dönti el, mennyivel.
 */
function MertekMezo({
  cimke,
  ertek,
  utotag,
  helykitolto,
  onValt,
}: {
  cimke: string;
  ertek: number | undefined;
  utotag: string;
  helykitolto: string;
  onValt: (uj: number | undefined) => void;
}) {
  return (
    <label className="mertek">
      <span className="mcimke">{cimke}</span>
      <input
        spellCheck={false}
        type="text"
        inputMode="decimal"
        className="mmezo"
        value={ertek === undefined ? '' : String(ertek)}
        placeholder={helykitolto}
        onChange={(e) => {
          const t = e.target.value.trim().replace(',', '.');
          if (t === '') {
            onValt(undefined);
            return;
          }
          const n = Number(t);
          if (Number.isFinite(n)) onValt(n);
        }}
      />
      <span className="mutotag">{utotag}</span>
    </label>
  );
}

/**
 * A CSOPORT SZÍNE UGYANAZ, MINT A KIEMELÉSÉ AZ IRATON.
 *
 * A bal oldali nézeten négy szín különbözteti meg a találatokat: név (rózsa),
 * összeg (zöld), dátum (kék), hivatalos szereplő (ibolya). Ha a jobb oldali
 * lista csoportjai semlegesek maradnának, a felhasználónak fejben kellene
 * párosítania a kettőt — pedig ugyanarról a négy dologról van szó. A csoport
 * fejléce ezért ugyanazt a színt viseli, amit az iratbeli kiemelés.
 *
 * A négy NÉV-JELLEGŰ fajta (személy, szervezet, hely, azonosító) egy színre
 * megy, mert az iraton is egy színnel áll: mind a négy „név", a csere is
 * ugyanaz rájuk. A csoportok elkülönítése a CÍMÜK dolga, nem a színé.
 */
const FAJTA_SZIN: Record<Fajta, string> = {
  person: 'k-nev',
  org: 'k-nev',
  place: 'k-nev',
  identifier: 'k-nev',
  amount: 'k-osszeg',
  date: 'k-datum',
  hivatalos: 'k-hivatalos',
};

/* ─────────────────────────── építőelemek ─────────────────────────── */

/**
 * EGY BEÁLLÍTÁS EGY SOR: fent a megnevezés és a vezérlő, alattuk teljes
 * szélességben a magyarázat.
 *
 * A MAGYARÁZAT AZÉRT KERÜLT A SOR ALÁ, mert a lap panellé keskenyedett. A
 * megnevezés mellett, a 200 képpontos vezérlőoszlop mellett 177 képpont maradt
 * a szövegnek: a leghosszabb magyarázat tizenegy sorba tört, és a beállítás
 * egy hosszú, keskeny szövegoszloppá vált. Teljes szélességben ugyanaz a
 * magyarázat négy-öt sor, és a sorhossz is olvasható tartományba kerül.
 *
 * A VEZÉRLŐK JOBB SZÉLE viszont EGY VONALBAN MARADT: a rács jobb oszlopában
 * ülnek, a megnevezés első sorával egy magasságban. A szem így továbbra is
 * egyetlen függőleges vonal mentén olvassa le, mi van bekapcsolva — ez volt az
 * eredeti elrendezés lényege, és ez nem esett áldozatul a keskenyedésnek.
 *
 * A megnevezés `<label>`, tehát rá lehet kattintani, és a képernyőolvasó ezt
 * mondja ki a vezérlő neveként. A magyarázat NEM a névbe került bele, hanem
 * `aria-describedby`-jal kapcsolódik: a nevekbe fűzve minden kapcsoló egy
 * három mondatos felolvasással kezdődne, és a lényeg — hogy be vagy ki van
 * kapcsolva — a mondat végére csúszna.
 */
function Sor({
  cim,
  leiras,
  vezerloId,
  children,
}: {
  cim: string;
  leiras: React.ReactNode;
  vezerloId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setrow">
      <label className="t" htmlFor={vezerloId}>
        {cim}
      </label>
      <div className="setctl">{children}</div>
      <div className="s" id={`${vezerloId}-s`}>
        {leiras}
      </div>
    </div>
  );
}

/*
  A KAPCSOLÓ INNEN KIKERÜLT: `ui/src/kapcsolo.tsx`.

  Nem ennek a lapnak a tartozéka, hanem a felület alapeleme — a Beállítások
  ablak és a párbeszédek is ezt használják. Amíg itt lakott, azok
  rendszer-rajzolású jelölőnégyzetet kaptak helyette: ugyanaz a kérdés, két
  külön vezérlő.
*/

/* ─────────────────────────── a lap ─────────────────────────── */

/*
  A FÜLEK SORRENDJE A MUNKA MENETE.

  Előbb az dől el, MIRE cseréljük a neveket — ez határozza meg az egész irat
  kimenetét, és ettől függ minden csereszöveg. Utána jön, MIT cserélünk: azt
  már a fenti döntés ismeretében érdemes átnézni, mert a listán álló
  csereszövegek onnan származnak.

  Fordított sorrendben a felhasználó előbb nézné át a listát, aztán a mód
  átállításával az egészet újraírná maga alatt.
*/
export type Ful = 'mire' | 'csere' | 'kesz';

/*
  A HARMADIK FÜL A MUNKALAP HELYE.

  Az „Ellenőrzés és mentés" korábban KÜLÖN KÉPERNYŐ volt (`fazis === 'munka'`),
  és a fejlécben állt egy ikon, amivel oda-vissza lehetett járni közte és a
  beállító lap közt. Két baj volt vele. Az egyik, hogy a két képernyő
  ugyanúgy nézett ki — bal oldalt az irat, jobbra egy panel —, tehát a
  felhasználó nem látta, mi változott a váltástól. A másik, hogy a folyamat
  harmadik állomása egy fejléc-ikon mögé volt rejtve, miközben az első kettő
  fülként állt egymás mellett.

  Egy fülsor, három állomás: mire cseréljük → mit cserélünk → ellenőrzés és
  mentés. A lépések sorrendje így magától olvasható.
*/
const FULEK: { id: Ful; cim: string }[] = [
  { id: 'mire', cim: 'Mire cseréljük?' },
  { id: 'csere', cim: 'Mit cserélünk?' },
  { id: 'kesz', cim: 'Ellenőrzés és mentés' },
];

export function DocumentSetup({
  beallitasok,
  temak,
  tetelek,
  bentMaradok,
  hivatalosCserelheto,
  vizsgalat,
  vizsgalatFut,
  vizsgalatUzenet,
  onBeallitas,
  onCsereSzoveg,
  onKapcsol,
  lepes,
  onLepesKezd,
  onLepesMozog,
  onLepesDontes,
  onCsoport,
  onUjraVizsgalat,
  onKeziFelvitel,
  onUjraOsztas,
  onUjKeszlet,
  onKeszletTorles,
  ful,
  onFul,
  keszLap,
  onMentes,
  mentesAkadaly,
  onTovabb,
}: DocumentSetupProps) {

  /* Egy lapon több azonosító is van, és a lap elvben kétszer is a képernyőre
     kerülhet (pl. átmenet közben). A rögzített azonosítók ilyenkor összeérnének,
     és a `<label for>` a MÁSIK példány vezérlőjére mutatna. */
  const uid = useId();
  const az = (nev: string): string => `${uid}-${nev}`;

  /* A fülek gombjai a nyílbillentyűs lépkedéshez kellenek: a fókusznak követnie
     kell a váltást, különben a billentyűzetes felhasználó egy olyan gombon áll,
     ami már nem az aktív fül. */
  const fulGombok = useRef<Partial<Record<Ful, HTMLButtonElement | null>>>({});

  const cserelendo = tetelek.filter((t) => t.cserelodik > 0);
  /*
    A „MARAD" CSAK AZT SZÁMOLJA, AMI TÉNYLEG BENT MARAD.

    Aki nem szerepel az iratban (kézzel felvitt név, akit a szöveg nem említ),
    az nem „bent maradt" — nincs mit bent hagyni belőle. A két esetet
    összeszámolva a lábléc olyan iratról állítana bent maradt adatot, amiben
    egyetlen ilyen sincs, és a felhasználó azt keresné, mit rontott el.
  */
  /*
    ÉS CSAK AZT, AMIRŐL DÖNTÖTTEK. A csupa-eldöntetlen tétel (bizonytalanDb > 0,
    cserelodik === 0) eddig „marad"-ként állt a láblécben — miközben a fül
    teteje ugyanazt „döntésre vár"-nak nevezte. A „marad" döntés; a bizonytalan
    a döntés HIÁNYA. A kettőt összemosva a lábléc a program tétlenségét a
    felhasználó döntéseként mutatta be.
  */
  const kihagyott = tetelek.filter(
    (t) => t.elofordulas > 0 && t.cserelodik === 0 && t.bizonytalanDb === 0,
  ).length;
  const dontesreVar = tetelek.filter((t) => t.bizonytalanDb > 0).length;

  function fulValt(uj: Ful): void {
    onFul(uj);
    fulGombok.current[uj]?.focus();
  }

  function fulBillentyu(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    e.preventDefault();
    const most = FULEK.findIndex((f) => f.id === ful);
    let cel = most;
    if (e.key === 'ArrowLeft') cel = (most - 1 + FULEK.length) % FULEK.length;
    if (e.key === 'ArrowRight') cel = (most + 1) % FULEK.length;
    if (e.key === 'Home') cel = 0;
    if (e.key === 'End') cel = FULEK.length - 1;
    const kovetkezo = FULEK[cel];
    if (kovetkezo !== undefined) fulValt(kovetkezo.id);
  }

  return (
    <div className="docsetup">
      <div className="ds-card">
        {/*
          A LAP FEJLÉCE ELTŰNT.

          Egy cím („Mi történjen ezzel az irattal?”) és egy mondat állt itt,
          és mindkettő ugyanazt mondta el, amit a két fül felirata: hogy most a
          csere beállításai jönnek. Egy panelen, ahol a hely a
          magyarázatoké, ez két sor volt a semmiért.
        */}
        <div className="tabs ds-tabs" role="tablist" onKeyDown={fulBillentyu}>
          {FULEK.map((f) => (
            <button
              key={f.id}
              ref={(el) => {
                fulGombok.current[f.id] = el;
              }}
              className={`tab${ful === f.id ? ' active' : ''}`}
              role="tab"
              id={az(`ful-${f.id}`)}
              aria-selected={ful === f.id}
              aria-controls={az(`lap-${f.id}`)}
              tabIndex={ful === f.id ? 0 : -1}
              onClick={() => onFul(f.id)}
            >
              {f.cim}
              {f.id === 'csere' && tetelek.length > 0 && (
                <span className="count">{tetelek.length}</span>
              )}
            </button>
          ))}
        </div>

        <div
          className="ds-body"
          role="tabpanel"
          id={az(`lap-${ful}`)}
          aria-labelledby={az(`ful-${ful}`)}
          tabIndex={0}
        >
          {ful === 'mire' && (
            <MireLap
              beallitasok={beallitasok}
              temak={temak}
              onBeallitas={onBeallitas}
              onUjKeszlet={onUjKeszlet}
              onKeszletTorles={onKeszletTorles}
            />
          )}

          {ful === 'kesz' && keszLap}

          {ful === 'csere' && (
            <CsereLap
              az={az}
              beallitasok={beallitasok}
              tetelek={tetelek}
              bentMaradok={bentMaradok}
              hivatalosCserelheto={hivatalosCserelheto}
              vizsgalat={vizsgalat}
              fut={vizsgalatFut}
              {...(vizsgalatUzenet === undefined ? {} : { vizsgalatUzenet })}
              onBeallitas={onBeallitas}
              onCsereSzoveg={onCsereSzoveg}
              onKapcsol={onKapcsol}
              lepes={lepes}
              onLepesKezd={onLepesKezd}
              onLepesMozog={onLepesMozog}
              onLepesDontes={onLepesDontes}
              onCsoport={onCsoport}
              onUjraVizsgalat={onUjraVizsgalat}
              onKeziFelvitel={onKeziFelvitel}
              {...(onUjraOsztas ? { onUjraOsztas } : {})}
            />
          )}
        </div>

        <div className="ds-foot">
          {/* Az összegzés a gomb MELLETT áll, nem egy fül belsejében: a
              felhasználó a továbblépés pillanatában lássa, hány nevet visz
              magával, és hány marad bent szándékosan. */}
          {/* A harmadik fülön ugyanez tételesen ott áll a lapon: a lábléc
              nem ismételné meg egy sorral lejjebb. */}
          <div className="ds-sum" hidden={ful === 'kesz'}>
            <b>{cserelendo.length}</b> cserélődik
            {kihagyott > 0 && (
              <>
                {' · '}
                <b>{kihagyott}</b> marad
              </>
            )}
            {dontesreVar > 0 && (
              <>
                {' · '}
                <b className="warntext">{dontesreVar}</b> vár döntésre
              </>
            )}
            {!beallitasok.replaceOfficials && bentMaradok.length > 0 && (
              <>
                {' · '}
                <b>{bentMaradok.length}</b> a törvény szerint bent marad
              </>
            )}
          </div>
          {/*
            A „MÁSIK IRATOT NYITOK" GOMB INNEN KIKERÜLT.

            Ugyanazt tette, amit a fejléc megnyitás ikonja — és a fejléc végig
            látszik, ezen a lapon is. Két gomb ugyanarra a műveletre azt
            kérdezteti meg, mi a különbség köztük; itt ráadásul a lap
            legfontosabb gombja mellől vett el figyelmet.
          */}
          {/*
            A LÁBLÉC GOMBJA AZT MONDJA, AMI KÖVETKEZIK.

            Az első két fülön a csere futtatása és a továbblépés az
            ellenőrzésre; a harmadikon már nincs hova továbblépni — ott a
            mentés a következő lépés. Egy gomb, ami a fülnek megfelelően
            mást csinál, kevesebb, mint két gomb, amiből mindig csak az egyik
            értelmes.
          */}
          <div className="ds-acts">
            {ful === 'kesz' ? (
              <button
                className="btn primary"
                disabled={mentesAkadaly !== null}
                onClick={onMentes}
              >
                Mentés másként…
              </button>
            ) : (
              <button className="btn primary" onClick={onTovabb}>
                Mehet a csere
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── „Mire cseréljük?” ─────────────────────────── */

/**
 * EGY RÁCS, EGY DÖNTÉS.
 *
 * Eddig két rács állt itt egymás alatt: fent négy csere-mód kártyája, lent a
 * névkészleteké — és a felső rács egyik kártyája („Fedőnevek”) semmi mást nem
 * csinált, mint hogy az alsó rácsot élővé tette. A felhasználónak tehát
 * kétszer kellett ugyanazt választania, és amíg nem tette meg mindkettőt, az
 * alsó rács letiltva, halványan állt ott.
 *
 * Márpedig a négy mód KIZÁRJA EGYMÁST, és a névkészlet pontosan ugyanennek a
 * kérdésnek a válasza: mi kerüljön a nevek helyére. Ezért innentől EGY rács
 * van. Elöl a három címkés mód, utánuk a névkészletek — egy készletre
 * kattintva a program egyszerre kapcsol fedőnév-módra és választ készletet.
 *
 * A JELVÉNY MONDJA MEG, MELYIK FAJTA. A címkés módoké „címke”, a
 * készleteké „névkészlet”: a kártyák egyformák, a döntés következménye viszont
 * nem az, és ezt látni kell.
 */
function MireLap({
  beallitasok,
  temak,
  onBeallitas,
  onUjKeszlet,
  onKeszletTorles,
}: {
  beallitasok: DokumentumBeallitasok;
  temak: ThemeSummaryUi[];
  onBeallitas: (valtozas: Partial<DokumentumBeallitasok>) => void;
  onUjKeszlet: () => void;
  onKeszletTorles: (id: string) => void;
}) {
  const fedonevMod = beallitasok.mode === 'theme';

  return (
    <>
      <div className="ds-szakasz">
        <h3>Mi kerüljön a nevek helyére?</h3>
        <p>
          Az első három kártya címkét ír a nevek helyére, a többi fedőnevet. A kártyán a kimenet
          nyelve is váltható.
        </p>
      </div>

      {/*
        A HÁROM CÍMKÉS KÁRTYA A KÉSZLETEK RÁCSÁN BELÜL áll, nem fölötte: a
        `NevkeszletRacs` az `elotte` gyerekeit ugyanabba a rácsba teszi,
        ugyanabba a `radiogroup`-ba. Így a billentyűzetes felhasználó is egyetlen
        csoportként lépked végig rajtuk, és a rács hat egyforma magas kártyája
        egy vonalban marad.
      */}
      <NevkeszletRacs
        themes={temak}
        // Fedőnév-módon kívül EGYETLEN készletkártya sem kiválasztott: a
        // választás a fenti három kártya valamelyikén áll. Egy pipa mindkét
        // helyen azt jelentené, hogy két dolog van egyszerre kiválasztva.
        selected={fedonevMod ? beallitasok.themeId : ''}
        onPick={(id) => onBeallitas({ mode: 'theme', themeId: id })}
        onNewCustom={onUjKeszlet}
        onRemoveCustom={onKeszletTorles}
        elotte={CIMKE_MODOK.map((m) => (
          <ModKartya
            key={m}
            mod={m}
            nyelv={beallitasok.labelLang}
            kivalasztott={beallitasok.mode === m}
            onValaszt={() => onBeallitas({ mode: m })}
            onNyelv={(ny) => onBeallitas({ mode: m, labelLang: ny })}
          />
        ))}
      />

      {/* A RAGOZÁS EGYSZER, A KÁRTYÁK ALATT.

          Mindegyik módra ugyanaz áll, és a kártyákon négyszer leírva a példát
          nyomná el — pedig épp a példa a kártya lényege. */}
      <p className="hint" style={{ marginTop: 10 }}>
        A toldalék a mondathoz igazodik: „{PELDA_NEV}nak” → „a felperesnek”, angolul „the
        plaintiff-nek”.
      </p>
    </>
  );
}

/**
 * Egy címkés csere-mód kártyája.
 *
 * Szándékosan ugyanaz a `themecard` alap, mint a névkészleté: a felhasználónak
 * egyetlen kártyás felületet kell megtanulnia, nem kettőt. A nyelvkapcsoló is
 * ugyanaz a `langchip` sor, ugyanazon a helyen — ami a készletnél a nevek
 * nyelve, az itt a címkéké.
 */
function ModKartya({
  mod,
  nyelv,
  kivalasztott,
  onValaszt,
  onNyelv,
}: {
  mod: CimkeMod;
  nyelv: 'hu' | 'en';
  kivalasztott: boolean;
  onValaszt: () => void;
  onNyelv: (nyelv: 'hu' | 'en') => void;
}) {
  return (
    <div
      className={`themecard modcard${kivalasztott ? ' selected' : ''}`}
      role="radio"
      aria-checked={kivalasztott}
      /*
        A KÁRTYA NEVE A MÓD NEVE — nem a leírása.

        Enélkül a kártya felolvasott neve a `title`, vagyis a négysoros
        magyarázat: a képernyőolvasós felhasználó végighallgat egy mondatot
        arról, MIT csinál a mód, de azt a szót sosem hallja meg, amivel a
        program máshol hivatkozik rá — pedig a lépéssáv is ezen a néven nevezi.
        A `title` ettől nem vész el: `aria-label` mellett leírásként hangzik el,
        tehát a sorrend áll helyre, nem az egyik szöveg szorítja ki a másikat.
      */
      aria-label={MODE_LABEL[mod]}
      tabIndex={0}
      onClick={onValaszt}
      onKeyDown={(e) => {
        // Csak a kártya SAJÁT billentyűje választ: a nyelvkapcsoló valódi gomb,
        // azé az Enter és a szóköz.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onValaszt();
        }
      }}
    >
      {/* UGYANAZ A FEJLÉCSOR, mint a névkészlet-kártyákon: balra a jelvény
          (mi ez), jobbra a nyelvváltó (vezérlő). A hat kártya így azonos
          szerkezettel kezdődik, és a szem egy vonalban futja végig őket. */}
      <div className="kartyafej">
        <div className="jelek">
          <span className="kartyajel mod">címke</span>
        </div>
        <div className="langsor">
          {(['hu', 'en'] as const).map((ny) => (
            <button
              key={ny}
              className={`langchip${ny === nyelv ? ' on' : ''}`}
              aria-pressed={ny === nyelv}
              onClick={(e) => {
                e.stopPropagation();
                onNyelv(ny);
              }}
            >
              {ny === 'hu' ? 'magyar' : 'angol'}
            </button>
          ))}
        </div>
      </div>
      <div className="t">
        <span className="nev">{MODE_LABEL[mod]}</span>
        {kivalasztott && <span className="pipa">✓</span>}
      </div>
      <div className="pelda">
        <span className="bal">{PELDA_NEV}</span>
        <span className="nyil" aria-hidden="true">
          →
        </span>
        <span className="jobb">{MODE_PELDA[mod][nyelv]}</span>
      </div>
      <div className="s">{MODE_LEIRAS[mod]}</div>
    </div>
  );
}

/* ─────────────────────────── „Mit cserélünk?” ─────────────────────────── */

function CsereLap({
  az,
  beallitasok,
  tetelek,
  bentMaradok,
  hivatalosCserelheto,
  vizsgalat,
  fut,
  vizsgalatUzenet,
  onBeallitas,
  onCsereSzoveg,
  onKapcsol,
  lepes,
  onLepesKezd,
  onLepesMozog,
  onLepesDontes,
  onCsoport,
  onUjraVizsgalat,
  onKeziFelvitel,
  onUjraOsztas,
}: {
  az: (nev: string) => string;
  beallitasok: DokumentumBeallitasok;
  tetelek: TalaltTetel[];
  bentMaradok: BentMarado[];
  hivatalosCserelheto: boolean;
  vizsgalat: VizsgalatAllapot;
  fut: boolean;
  vizsgalatUzenet?: string;
  onBeallitas: (valtozas: Partial<DokumentumBeallitasok>) => void;
  onCsereSzoveg: (id: string, szoveg: string) => void;
  onKapcsol: (id: string, be: boolean) => void;
  lepes: LepesAllas | null;
  onLepesKezd: (id: string) => void;
  onLepesMozog: (id: string, irany: 1 | -1) => void;
  onLepesDontes: (id: string, dontes: 'accept' | 'skip') => void;
  onCsoport: (fajta: Fajta, be: boolean) => void;
  onUjraVizsgalat: () => void;
  onKeziFelvitel: () => void;
  /** A nevek újra kiosztása; hiányában a gomb meg sem jelenik. */
  onUjraOsztas?: () => void;
}) {
  const szazalek = Math.round(beallitasok.autoThreshold * 100);
  /* Előfordulást számol, nem sort: a „találat" szó a lap tetején és a
     jelmagyarázatban is előfordulást jelent — itt sem jelenthet mást. */
  const bizonytalan = tetelek.reduce((db, t) => db + t.bizonytalanDb, 0);
  /* Egy művelet egy néven: ha a vizsgálat még nem futott le, az indítása
     „indítás", ha már igen, „újra" — és ugyanez a szó áll a modellsávon is. */
  const vizsgalatFelirat = vizsgalat === 'kihagyva' ? 'Vizsgálat indítása' : 'Vizsgálat újra';

  /*
    A KIÚT MINDIG OTT VAN.

    Nem csak az üres listánál: a félbeszakadt vizsgálat listája is hiányos
    lehet, és a felhasználó akkor jön rá, amikor már végigolvasta. Ha ilyenkor
    vissza kellene lépnie a megnyitásig, inkább kiadná az iratot úgy, ahogy van.
  */
  const kiutak = (
    <div className="ds-ways">
      <button className="btn sm ghost" onClick={onUjraVizsgalat}>
        {vizsgalatFelirat}
      </button>
      <button className="btn sm ghost" onClick={onKeziFelvitel}>
        Nevet veszek fel kézzel
      </button>
      {/*
        NEVEK ÚJRA KIOSZTÁSA — kézi kérésre, mert magától kárt okozna.

        Az álnév egyszer dől el, és attól kezdve tapad a félhez: egy kapcsoló
        átbillentése nem írhatja át az egész névsort. Van viszont egy eset,
        amikor épp ez az útban van — ha a program tévedésből vett fel egy szót
        félként, az elvitte a névsor elejéről a legjellemzőbb nevet, és a
        felhasználó utólag kitörli. A név ilyenkor foglalt marad egy nem
        létező szereplőn.

        Ezt csak az újraszámolás oldja fel, és csakis kérésre: automatikusan
        futtatva pontosan azt tenné, ami ellen a tapadás szól.
      */}
      {onUjraOsztas && (
        <button
          className="btn sm ghost"
          onClick={onUjraOsztas}
        >
          Nevek újra kiosztása
        </button>
      )}
    </div>
  );

  return (
    <>
      {/*
        A KÉT MEGMARADT BEÁLLÍTÁS A LAP TETEJÉN.

        Mindkettő ERRE a lapra tartozik, mert itt van hatásuk: a küszöb azt
        szabja meg, mi számít bizonytalannak az alábbi listán, a kulcsfájl
        pedig azt, hogy a most beállított cserék visszafejthetők maradnak-e.
        Külön fülön állva a felhasználó a lista átnézése közben nem látta,
        milyen küszöbbel néz szembe.
      */}
      {/*
        A NYELVI MODELL A LAP TETEJÉN.

        Innen derül ki, hogy a lenti lista miért rövid — és innen is orvosolható:
        a dokumentum nyelve szerinti modell kiválasztható, letölthető, és a
        vizsgálat is elindítható. Eddig ehhez a Beállításokba kellett átmenni,
        onnan vissza, és a vizsgálatot még egyszer elindítani.
      */}
      <FelismeroSav fut={fut} felirat={vizsgalatFelirat} onVizsgalat={onUjraVizsgalat} />

      <div className="ds-teteje">
        {/*
          MI EZ A KÜSZÖB — mert a nevéből nem derül ki, és a felhasználó
          jogosan kérdezte meg, hogy a nyelvi modellhez van-e köze.

          NINCS. A modell azt találja meg, KIK a felek; ez a szám azt szabja
          meg, hogy a nevük melyik ELŐFORDULÁSÁHOZ nyúlunk hozzá kérdezés
          nélkül. A programnak minden egyes előfordulásra van egy
          magabiztossága: a teljes név 100%, a puszta vezetéknév 80%, a
          monogram 60%, egy ismeretlen toldalék 50%. Ez a küszöb húzza meg,
          hol kezdődik a „kérdezz rá".

          Ezért a küszöb modell nélkül is dolgozik — sőt, olyankor a
          legfontosabb, mert a szerkezeti felismerés kevesebbet tud a
          szövegkörnyezetről.
        */}
        <Sor
          cim="Csere kérdés nélkül eddig a magabiztosságig"
          vezerloId={az('thr')}
          leiras={
            <>
              A program minden megtalált <b>névelőforduláshoz</b> magabiztosságot számol: a teljes
              név 100%, a puszta vezetéknév 80%, a monogram 60%. Ami ez alá esik, azt nem cseréljük
              magától — döntésre vár. <b>A nyelvi modellhez nincs köze:</b> az azt találja meg, kik
              a felek, ez pedig azt, hogy a nevük melyik előfordulását cseréljük kérdezés nélkül.
            </>
          }
        >
          <span className="rangeval" aria-hidden="true">
            {szazalek}%
          </span>
          <input
            spellCheck={false}
            id={az('thr')}
            type="range"
            min={50}
            max={100}
            step={5}
            value={szazalek}
            aria-describedby={az('thr-s')}
            onChange={(e) => onBeallitas({ autoThreshold: Number(e.target.value) / 100 })}
          />
        </Sor>

        {/*
          A KULCSFÁJL KAPCSOLÓJA INNEN KIKERÜLT.

          Ugyanezt a kérdést a mentés ablaka is felteszi — ott, ahol a
          jelszót is meg kell adni hozzá, és ahol a döntésnek tényleg
          következménye van. Két helyen ugyanaz a kapcsoló azt tanítja meg,
          hogy az egyik állás valahol felülíródik; ráadásul a lapon beállított
          érték csak a mentés ablakának INDULÓ állása volt, nem a végleges.

          Az érték nem veszett el: a mentés ablaka továbbra is a legutóbbi
          állásból indul (`keepKey`), csak most ott is dől el.
        */}
      </div>

      {vizsgalat === 'megszakitva' && (
        <div className="note">
          <b>A vizsgálat meg lett szakítva.</b> Ami itt látszik, hiányos: a program addig jutott,
          ameddig megszakítottad. Amit nem talált meg, azt nem is cseréli le.
        </div>
      )}
      {vizsgalat === 'hiba' && (
        <div className="note bad">
          <b>A vizsgálat hibába futott.</b>{' '}
          {vizsgalatUzenet === undefined || vizsgalatUzenet === ''
            ? 'A program nem tudta végigolvasni az iratot, ezért ez a lista nem teljes.'
            : vizsgalatUzenet}
        </div>
      )}
      {vizsgalat === 'kihagyva' && (
        <div className="note">
          <b>A vizsgálat nem futott le.</b> A program nem keresett neveket ebben az iratban, tehát
          magától nem is cserél le egyet sem.
        </div>
      )}
      {vizsgalat === 'kesz' && vizsgalatUzenet !== undefined && vizsgalatUzenet !== '' && (
        <p className="hint">{vizsgalatUzenet}</p>
      )}

      {tetelek.length === 0 ? (
        <div className="empty">
          <div className="big">◌</div>
          {vizsgalat === 'kesz' ? (
            <p>
              A vizsgálat lefutott, de <b>egyetlen nevet sem talált</b>. Ez kétféle okból lehet: az
              irat tényleg nem tartalmaz nevet, vagy a szöveg nem olvasható ki belőle — szkennelt
              iratban a betűk kép formájában állnak, azokat a program nem látja.
            </p>
          ) : (
            <p>Nincs mit átnézni. Az alábbi két úton juthatsz tovább.</p>
          )}
          {kiutak}
        </div>
      ) : (
        <>
          <div className="ds-listtop">
            {/*
              EGY GOMB MINDENRE — a régi „kérdezés nélkül menjen végig” kapcsoló
              helyén.

              A kapcsoló ÁLLAPOTOT ígért, holott MŰVELETRŐL volt szó: nem
              maradt utána semmi, amit a felhasználó a képernyőn ellenőrizhetett
              volna. Egy gomb ugyanazt teszi, csak a hatása azonnal látszik is:
              a lenti sorok mind „mind” állásba billennek, és a bal oldali
              iratnézeten minden kiemelés kiszínesedik.
            */}
            {/*
              A „MINDENT CSERÉLÜNK" GOMB INNEN KIKERÜLT.

              A felhasználó jelezte, hogy nem tudja megkülönböztetni a lap alján
              álló „Mehet a csere" gombtól — és igaza volt abban, ami ebből
              következik: két nagy, egymás fölött álló gomb, mindkettő a
              cseréről, egyértelmű különbség nélkül. Az alsó a folyamat
              továbbvitele, ez pedig egy tömeges bekapcsolás volt, amire
              alapállásban nincs is szükség: minden találat eleve cserére van
              kapcsolva. Ami visszakapcsolható, azt a sorok „Mind" gombja és a
              csoportok fejléckapcsolója teszi — ott, ahol a hatása is látszik.
            */}
            {bizonytalan > 0 && (
              <p className="hint">
                <b>{bizonytalan}</b> találat vár döntésre.
              </p>
            )}
            {kiutak}
          </div>

          {CSOPORT_SORREND.map((fajta) => {
            const sorok = tetelek.filter((t) => t.fajta === fajta);
            if (sorok.length === 0) return null;
            /*
              A FEJLÉC ÁLLAPOTA UGYANAZ, MINT A KAPCSOLÓÉ. Az összegnél és a
              dátumnál a fajtakapcsoló állása, a névcsoportoknál az, hogy
              cserélődik-e még valami. Két külön forrásból a fejléc színe és a
              kapcsoló állása szétcsúszhatna — az volt itt korábban.
            */
            const be =
              fajta === 'amount'
                ? beallitasok.replaceAmounts
                : fajta === 'date'
                  ? beallitasok.shiftDates
                  : sorok.some((t) => t.cserelodik > 0);
            return (
              /* A fajtaszín a KERETEN áll (`FAJTA_SZIN`), nem csak a fejlécen:
                 innen örökli a fejléc háttere, a bal szélső csík ÉS a kapcsoló
                 bekapcsolt színe is. Egy zöld „Összegek" csoportban rózsaszín
                 kapcsoló állt — a szín azt állította, hogy nevet cserélünk. */
              <div className={`fgroup ${FAJTA_SZIN[fajta]}${be ? '' : ' ki'}`} key={fajta}>
                {/*
                  MINDEN CSOPORT KAPCSOLHATÓ, nem csak az összeg és a dátum.

                  Húsz név mellett a soronkénti „Nincs csere" húsz kattintás; a
                  csoportkapcsoló egy. Az összeg és a dátum a saját FAJTA-
                  kapcsolóját állítja (az a következő elemzésre is érvényes
                  marad), a névcsoportok pedig a soraik döntését — a kettő
                  ugyanúgy néz ki, mert a felhasználó számára ugyanaz a
                  kérdés.
                */}
                <CsoportFejlec
                  fajta={fajta}
                  darab={sorok.length}
                  be={be}
                  {...(be && fajta === 'amount'
                    ? {
                        mertek: (
                          <MertekMezo
                            cimke="szorzó"
                            ertek={beallitasok.amountFactor}
                            utotag="×"
                            helykitolto="kulcsból"
                            onValt={(uj) => onBeallitas({ amountFactor: uj })}
                          />
                        ),
                      }
                    : {})}
                  {...(be && fajta === 'date'
                    ? {
                        mertek: (
                          <MertekMezo
                            cimke="eltolás"
                            ertek={beallitasok.dateShiftDays}
                            utotag="nap"
                            helykitolto="kulcsból"
                            onValt={(uj) => onBeallitas({ dateShiftDays: uj })}
                          />
                        ),
                      }
                    : {})}
                  kapcsolo={
                    <Kapcsolo
                      id={az(fajta)}
                      cimke={fajta === 'date' ? 'Dátumok eltolása' : `${FAJTA_CIM[fajta]} cseréje`}
                      be={be}
                      onValt={(ujBe) =>
                        /*
                          Az összeg és a dátum a SOR kapcsolóján át megy
                          (`onKapcsol`): az a fajtakapcsolót ÉS a
                          találatonkénti döntéseket együtt állítja. Csak a
                          fajtakapcsolót állítva a lépegetésben hozott egyedi
                          döntések a motorban erősebbek maradnának, és a
                          kapcsoló „Ki" állása mellett is cserélődne, amit a
                          felhasználó egyszer „Cserél"-re állított.
                        */
                        fajta === 'amount' || fajta === 'date'
                          ? onKapcsol(sorok[0]!.id, ujBe)
                          : onCsoport(fajta, ujBe)
                      }
                    />
                  }
                />
                {sorok.map((t) => (
                  <TalaltSor
                    key={t.id}
                    tetel={t}
                    lepes={lepes}
                    onCsereSzoveg={onCsereSzoveg}
                    onKapcsol={onKapcsol}
                    onLepesKezd={onLepesKezd}
                    onLepesMozog={onLepesMozog}
                    onLepesDontes={onLepesDontes}
                  />
                ))}
              </div>
            );
          })}
        </>
      )}

      <HivatalosSzakasz
        az={az}
        be={beallitasok.replaceOfficials}
        cserelheto={hivatalosCserelheto}
        bentMaradok={bentMaradok}
        sorok={tetelek.filter((t) => t.fajta === 'hivatalos')}
        lepes={lepes}
        onValt={(be) => onBeallitas({ replaceOfficials: be })}
        onCsereSzoveg={onCsereSzoveg}
        onKapcsol={onKapcsol}
        onLepesKezd={onLepesKezd}
        onLepesMozog={onLepesMozog}
        onLepesDontes={onLepesDontes}
      />
    </>
  );
}

/**
 * A TÖRVÉNY SZERINT BENT MARADÓ NEVEK — külön szakaszon, saját kapcsolóval.
 *
 * Nem kimaradt találatok, hanem a jogszabály előírása (Bszi. 166. § (2)): az
 * eljáró bíró, az ügyvéd, az ügyvédi iroda és a bíróság neve nyilvános. A többi
 * közé keverve a felhasználó hibának nézné őket, és „kijavítana” egy olyan
 * iratot, ami így volt helyes.
 *
 * A KAPCSOLÓ MÉGIS OTT VAN, mert nem minden irat megy bíróságra. Egy belső
 * feljegyzésben, egy ügyfélnek küldött másolatban vagy egy nyelvi modellnek
 * átadott szövegben a bíró neve ugyanolyan személyes adat, mint bárkié — és a
 * felhasználó kérése kifejezetten az volt, hogy erre legyen mód. Ezért:
 * elszeparálva, alapból kikapcsolva, és kimondva, mit jelent bekapcsolni.
 */
function HivatalosSzakasz({
  az,
  be,
  cserelheto,
  bentMaradok,
  sorok,
  lepes,
  onValt,
  onCsereSzoveg,
  onKapcsol,
  onLepesKezd,
  onLepesMozog,
  onLepesDontes,
}: {
  az: (nev: string) => string;
  be: boolean;
  cserelheto: boolean;
  bentMaradok: BentMarado[];
  /** A hivatalos szereplők találatai — csak bekapcsolt cserénél van bennük sor. */
  sorok: TalaltTetel[];
  lepes: LepesAllas | null;
  onValt: (be: boolean) => void;
  onCsereSzoveg: (id: string, szoveg: string) => void;
  onKapcsol: (id: string, be: boolean) => void;
  onLepesKezd: (id: string) => void;
  onLepesMozog: (id: string, irany: 1 | -1) => void;
  onLepesDontes: (id: string, dontes: 'accept' | 'skip') => void;
}) {
  // Nincs kit cserélni ÉS nincs mit kiírni: a szakasz elmarad. Egy üres rovat
  // azt a kérdést vetné fel, hogy hova tűntek a nevek.
  if (bentMaradok.length === 0) return null;

  return (
    <div className={`fgroup keep k-hivatalos${be ? ' nyitva' : ' ki'}`}>
      <CsoportFejlec
        fajta="hivatalos"
        darab={be && sorok.length > 0 ? sorok.length : bentMaradok.length}
        be={be}
        {...(be
          ? {
              /*
                A FIGYELMEZTETÉS A FEJLÉC LEÍRÓSORÁBAN ÁLL, nem külön sávban.

                Külön sávként a bekapcsolás MEGNÖVELTE a szakaszt: minden
                alatta álló sor lejjebb csúszott, és a görgetés ugrott egyet a
                felhasználó keze alatt. A fejléc leírósora viszont mindig ott
                van — csak a szövege vált: kikapcsolva a jogszabályt idézi,
                bekapcsolva a következményét.
              */
              figyelem: (
                <>
                  <b className="warntext">
                    Bírósági határozat közzétett változatában ez jogszabályba ütközik.
                  </b>{' '}
                  Csak akkor hagyd bekapcsolva, ha az irat nem közzétételre megy.
                </>
              ),
            }
          : {})}
        {...(cserelheto
          ? {
              kapcsolo: (
                <Kapcsolo
                  id={az('officials')}
                  cimke="A hivatalos szereplők cseréje"
                  be={be}
                  onValt={onValt}
                />
              ),
            }
          : {})}
      />

      {/*
        A SZAKASZ SOSEM ÜRÜL KI ÁTKAPCSOLÁSKOR.

        A kapcsoló átbillentése új elemzést indít, és az néhány tized
        másodpercig tart. Ha a sorokat pusztán a kapcsoló állására kötnénk, a
        szakasz ez alatt ÜRESEN állna: a nevek eltűnnének, majd más
        magasságban visszajönnének — a felhasználó ezt ugrásnak látja, és
        joggal, mert az.

        Ezért a döntés nem a kapcsolón múlik, hanem azon, VAN-E MÁR SOR. Amíg
        nincs, a törvény szerinti lista áll ott, ugyanazokkal a nevekkel; ha
        megjött, a teljes sorok veszik át a helyét. A két sorfajta MAGASSÁGA
        EGYEZIK (styles.css), tehát az átváltás a görgetést sem mozdítja meg.
      */}
      {be && sorok.length > 0
        ? sorok.map((t) => (
            <TalaltSor
              key={t.id}
              tetel={t}
              lepes={lepes}
              onCsereSzoveg={onCsereSzoveg}
              onKapcsol={onKapcsol}
              onLepesKezd={onLepesKezd}
              onLepesMozog={onLepesMozog}
              onLepesDontes={onLepesDontes}
            />
          ))
        : bentMaradok.map((b) => (
            /*
              UGYANAZ A SOR, KIKAPCSOLVA.

              Itt korábban egy MÁSFAJTA sor állt: két egymás alatti szöveg,
              nyíl nélkül, mező nélkül, kapcsoló nélkül. A szakasz
              bekapcsolásakor tehát nem egy állapot változott, hanem az egész
              lista más alakot öltött — a felhasználó ezt joggal nézte
              hibának. Ma ugyanaz a négy oszlop áll itt is: a név, a nyíl, a
              „marad az eredeti" jelzés a csereszöveg helyén, és az üres
              vezérlőoszlop (a kapcsoló a szakasz fejlécében van, mert a
              döntés az egész szakaszra szól).
            */
            <div className="findrow off" key={`${b.name}|${b.why}`}>
              <span className="orig">
                {b.name}
              </span>
              <span className="farrow" aria-hidden="true">
                →
              </span>
              <span className="frepl static">
                {b.name}
              </span>
              <div className="fctl" />
              {/*
                A JOGSZABÁLY EGYSZER ÁLL A KÉPERNYŐN, NEM SORONKÉNT.

                Itt korábban két címke ült egymás mellett, és mindkettő
                ugyanazt mondta: „— a törvény szerint a neve bent marad" és „a
                Bszi. 166. § (2) szerint bent marad". Nyolc-tíz név mellett
                ugyanez a mondat tizenhatszor. A hivatkozást a SZAKASZ FEJLÉCE
                mondja ki (`CSOPORT_LEIRAS.hivatalos`), egyszer, ahol a
                szabály hatálya is van.

                Ami soronként MÁS, az marad: a szerep — „eljáró bíró",
                „hatóság vagy bíróság", „eljáró ügyvédi iroda". Ez az, amiért
                ez a név ezen a listán van. A teljes indoklás a buboréksúgóban.
              */}
              <div className="fmeta">
                <span className="pill kind">
                  {szerepBol(b.why)}
                </span>
              </div>
            </div>
          ))}
    </div>
  );
}

/**
 * A MEGTARTÁS INDOKÁBÓL CSAK A SZEREP.
 *
 * A motor egy mondatot ad („eljáró bíró — a törvény szerint a neve bent
 * marad"): elöl az, ami soronként más, a gondolatjel után az, ami mindegyikre
 * ugyanaz. A képernyőn az elsőre van szükség; a másodikat a szakasz fejléce
 * mondja ki egyszer. A teljes mondat a buboréksúgóban marad, tehát nem vész el.
 */
function szerepBol(why: string): string {
  const i = why.indexOf(' — ');
  return i < 0 ? why : why.slice(0, i);
}

/**
 * EGY TALÁLAT SORA: kapcsoló + lépegetés.
 *
 * A régi gombhármas (Mind / Következő / Nincs csere) két különböző kérdést
 * mosott össze, és a felhasználó kimondta, hogy nem érti. A két kérdés két
 * külön vezérlőt kapott:
 *
 *   A KAPCSOLÓ a sor jobb szélén azt dönti el, cserélődjön-e ez a tétel
 *   egyáltalán — ugyanaz a mozdulat, mint a csoportfejléceken és mindenhol
 *   máshol a programban.
 *
 *   A LÉPEGETÉS a Word Csere párbeszédének mozdulata: előfordulásról
 *   előfordulásra ugrik az iratban, és mindegyikről külön dönthető, hogy
 *   „Cserél” vagy „Kihagy”. A „Kihagy” PONTOSAN az, mint az iraton a
 *   kiemelésre kattintani — ugyanabba a tárolóba ír.
 *
 * A SOR MAGASSÁGA RÖGZÍTETT (styles.css): a hosszú név és a hosszú megjegyzés
 * levágódik (a teljes szöveg a buboréksúgóban áll), nem töri több sorba a
 * sort. Húsz különböző magasságú sor alatt a szem nem talál vissza oda, ahol
 * az előbb járt.
 */
function TalaltSor({
  tetel,
  lepes,
  onCsereSzoveg,
  onKapcsol,
  onLepesKezd,
  onLepesMozog,
  onLepesDontes,
}: {
  tetel: TalaltTetel;
  lepes: LepesAllas | null;
  onCsereSzoveg: (id: string, szoveg: string) => void;
  onKapcsol: (id: string, be: boolean) => void;
  onLepesKezd: (id: string) => void;
  onLepesMozog: (id: string, irany: 1 | -1) => void;
  onLepesDontes: (id: string, dontes: 'accept' | 'skip') => void;
}) {
  /**
   * NEM SZEREPEL AZ IRATBAN — külön eset, nem „nincs csere".
   *
   * Ide a kézzel felvitt név kerül, amit a szöveg nem említ. A kapcsoló és a
   * lépegetés értelmetlen rajta (nincs mit kapcsolni, nincs hova lépni). A sor
   * mégis látszik, mert a felhasználó felvitte — a hallgatás azt üzenné, hogy
   * a program elnyelte.
   */
  const nincsBenne = tetel.elofordulas === 0;
  const be = tetel.cserelodik > 0;
  const reszben = be && tetel.cserelodik < tetel.elofordulas;
  /* A „kézzel átírva” csak akkor igaz, ha a szöveg TÉNYLEG más, mint amit a
     program adna: aki visszagépeli az alapértelmezettet, ne kapjon róla
     figyelmeztetést, mert nincs mit visszaállítania. */
  const sajat = tetel.sajatCsere ?? '';
  const atirt = sajat !== '' && sajat !== tetel.csere;
  const ertek = sajat === '' ? tetel.csere : sajat;
  /* Ezen a soron áll-e éppen a lépegetés. Az állást a hívó a dokumentum
     kijelöléséből származtatja, tehát az iratra kattintás is ide hozza. */
  const aktiv = lepes !== null && lepes.entityId === tetel.id;

  return (
    /*
      A SOR NÉGY OSZLOPA: név · nyíl · csereszöveg · kapcsoló.

      A `.fmain` burkoló INNEN KIKERÜLT. Amíg megvolt, a három cella egy
      rugalmas dobozban ült, és a nyíl helyét a NÉV hossza szabta meg: a
      „Kiss Erika" sorban 77 képpontnál állt, az „Aranykalász Agrár Kft."
      sorában 155-nél — húsz sor alatt cikcakkban futott, és a csereszöveg
      mezői is mind más szélesek lettek. Burkoló nélkül a három cella a sor
      SAJÁT rácsába kerül, és mivel minden sor ugyanolyan széles, az oszlopok
      is mind egy vonalban állnak.
    */
    <div className={`findrow${!be && !nincsBenne ? ' off' : ''}${aktiv ? ' aktiv' : ''}`}>
      <span className="orig">
        {tetel.eredeti}
      </span>
      <span className="farrow" aria-hidden="true">
        →
      </span>
        {/* A csereszöveg NEM címke, hanem szerkeszthető mező: a ragozó motor
            néha mellényúl egy ritka névnél, és ilyenkor az ügyvéd egyetlen
            helyen javítja, nem a kész iratban keresi végig.

            Az összeg és a dátum kivétel: ott a csereszöveget MÉRÉS adja (közös
            szorzó, közös eltolás), és egyetlen érték kézi átírása pont azt az
            összefüggést törné el, amiért a közös szorzó van. */}
      {tetel.fajta === 'amount' || tetel.fajta === 'date' ? (
        <span
          className="frepl static"
        >
          {be ? ertek : tetel.eredeti}
        </span>
      ) : (
        <input
          spellCheck={false}
          type="text"
          className="frepl"
          value={be || tetel.bizonytalanDb > 0 ? ertek : tetel.eredeti}
          disabled={(!be && tetel.bizonytalanDb === 0) || nincsBenne}
          aria-label={`${tetel.eredeti} helyére kerülő szöveg`}
          onChange={(e) => onCsereSzoveg(tetel.id, e.target.value)}
        />
      )}

      {/*
        A VEZÉRLŐOSZLOP CSAK A KAPCSOLÓÉ, semmi másé.

        A „nem szerepel az iratban" jelvény innen a magyarázósorba költözött:
        szélesebb volt a kapcsolónál, tehát ahol megjelent, ott az EGÉSZ
        oszlop kiszélesedett, és a fölötte-alatta álló sorok kapcsolói
        elcsúsztak. Ráadásul nem is vezérlő volt, hanem közlés.
      */}
      <div className="fctl">
        {!nincsBenne && (
          <Kapcsolo
            id={`sor-${tetel.id.replace(/[^\w-]/g, '_')}`}
            cimke={`${tetel.eredeti} ${tetel.fajta === 'date' ? 'eltolása' : 'cseréje'}`}
            be={be}
            onValt={(ujBe) => onKapcsol(tetel.id, ujBe)}
          />
        )}
      </div>

      <div className="fmeta">
        <span className="pill kind">{tetel.szerep}</span>
        {nincsBenne && <span className="pill kind">nem szerepel az iratban</span>}
        <span className="occ">
          {nincsBenne ? (
            ''
          ) : reszben ? (
            <b>
              {tetel.cserelodik}/{tetel.elofordulas} helyen
            </b>
          ) : (
            `${tetel.elofordulas} helyen`
          )}
        </span>
        {/*
          A PÖTTY HELYETT SZÁM: HÁNYBÓL HÁNY.

          Egy üres kis kör csak annyit mondott, hogy „van itt valami" — sem
          azt, MI a bizonytalan, sem azt, MENNYI. A felhasználó vagy fölé vitte
          az egeret a buboréksúgóért, vagy nem tudta meg. Márpedig épp ez az a
          szám, ami alapján eldönti, hogy nekiáll-e a végignézésnek: négy
          eldöntetlen tizenhatból egészen más munka, mint tizenhatból tizenhat.

          A BOROSTYÁN MARAD. Ugyanaz a szín, mint az iraton a bizonytalan
          kiemelésé, a jelmagyarázatban és a „Végignézem" gombon — a szem
          ebből köti össze, hogy ugyanarról a négy előfordulásról van szó.
        */}
        {tetel.bizonytalanDb > 0 && (
          <span
            className="pill bizonytalan"
          >
            {tetel.bizonytalanDb}/{tetel.elofordulas} bizonytalan
          </span>
        )}
        {/*
          A PÖTTY HELYETT ITT IS SZÁM.

          „A program döntött helyetted" — de hányról? Egy üres kis kör ezt nem
          mondta meg, pedig ez a különbség: egy eldöntött bizonytalanság
          ránézésre ellenőrizhető, tizenöt már átnézendő munka. Ugyanaz a
          borostyán, mint a bizonytalan jelvényen: mindkettő ugyanarról szól,
          csak az egyikről már döntött valaki.
        */}
        {tetel.programDontott === true && tetel.bizonytalanDb === 0 && (
          <span className="pill dontott">
            {tetel.elofordulas}/{tetel.elofordulas} · a program döntötte
          </span>
        )}
        {tetel.kezi === true && <span className="pill kind">kézzel felvéve</span>}
        {atirt && be && (
          <span className="occ atirva">
            átírva{' '}
            <button className="ds-link" onClick={() => onCsereSzoveg(tetel.id, '')}>
              vissza
            </button>
          </span>
        )}

        {/*
          A LÉPEGETŐ a metasor jobb szélén. Amíg nem ezen a soron áll, egyetlen
          gomb („Végignézem”); elindítva a Word-féle vezérlősor veszi át:
          ‹ › a mozgás, „Cserél” / „Kihagy” a döntés a mostani előfordulásról —
          döntés után magától a következőre lép. A világító gomb az AKTUÁLIS
          előfordulás állását mutatja.
        */}
        {!nincsBenne &&
          (aktiv && lepes !== null ? (
            <span className="lepteto" role="group" aria-label={`${tetel.eredeti} előfordulásai egyenként`}>
              <button
                className="lepbtn"
                disabled={lepes.index === 0}
                aria-label="Előző előfordulás"
                onClick={() => onLepesMozog(tetel.id, -1)}
              >
                ‹
              </button>
              <span className="lepoz" aria-live="polite">
                {lepes.index + 1}/{lepes.osszes}
              </span>
              <button
                className="lepbtn"
                disabled={lepes.index >= lepes.osszes - 1}
                aria-label="Következő előfordulás"
                onClick={() => onLepesMozog(tetel.id, 1)}
              >
                ›
              </button>
              <button
                className={`lepbtn szo${lepes.cserelodik ? ' on' : ''}`}
                aria-pressed={lepes.cserelodik}
                onClick={() => onLepesDontes(tetel.id, 'accept')}
              >
                Cserél
              </button>
              <button
                className={`lepbtn szo ki${lepes.cserelodik ? '' : ' on'}`}
                aria-pressed={!lepes.cserelodik}
                onClick={() => onLepesDontes(tetel.id, 'skip')}
              >
                Kihagy
              </button>
            </span>
          ) : (
            /*
              A GOMB KIEMELKEDIK, HA VAN MIT VÉGIGNÉZNI.

              Halvány szellemgombként minden soron ugyanúgy nézett ki — azon
              is, ahol a program mindenről döntött, és azon is, ahol tíz
              előfordulás vár emberre. A borostyán UGYANAZ a szín, mint a
              bizonytalan találat pöttyéé a sor másik végén és a kiemelésé az
              iraton: a szem így köti össze, hogy ez a gomb pont azokhoz visz.
              Ahol nincs eldöntetlen, ott marad a halvány gomb — az végignézés,
              nem teendő.
            */
            <button
              className={`btn ghost sm lepnyit${tetel.bizonytalanDb > 0 ? ' varakozik' : ''}`}
              onClick={() => onLepesKezd(tetel.id)}
            >
              Végignézem
            </button>
          ))}
      </div>
    </div>
  );
}
