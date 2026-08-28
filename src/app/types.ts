/**
 * A felület és a motor közötti közös típusok.
 *
 * A felület (Electron renderer) sosem lát fájlt és sosem futtat motort: mindent
 * a főfolyamattól kér. Így a dokumentum tartalma egyetlen helyen létezik, és
 * bizonyítható, hogy semmi nem megy hálózatra.
 */

// Csak típus: a fordítás után nyoma sem marad, tehát a felületi csomagba sem
// kerül bele a magyar azonosító-felismerő.
/**
 * AZ AZONOSÍTÓ FAJTÁI — ÉS A MAGYAR NEVÜK, EGY HELYEN.
 *
 * Ez a lista korábban a `hu/azonositok.ts`-ben lakott, a felismerő kódja
 * mellett. Attól fogva, hogy a FELÜLET is szüksége lett rá (a jobb gombos menü
 * „Azonosító" almenüje ezekből áll), két rossz választás maradt volna: vagy a
 * teljes felismerő motor bekerül a felületi kötegbe egyetlen szótár kedvéért,
 * vagy a lista MÁSODSZOR is leíródik a felület oldalán — és a másolat előbb-
 * utóbb szétcsúszik: a motor megtanul egy tizenötödik fajtát, a menüben pedig
 * tizennégy marad.
 *
 * A `types.ts` a közös nyelv: se fájlrendszer, se motor, se `node:` modul nem
 * kerül vele a felületre. A `hu/azonositok.ts` innen veszi át (és tovább is
 * adja, hogy a régi importok változatlanul működjenek).
 */
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

/** Megjelenítendő magyar név a szereplapon és a jobb gombos menüben. */
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
 * Mit takarunk ki. Az 'identifier' azért külön fajta, és nem a 'place' vagy az
 * 'org' egyik alesete, mert MÁS a csere logikája: egy adószámnak nincs értelmes
 * témás fedőneve, csak adatfajta-megjelölése. Enélkül a lakcím és az adószám
 * nem fért volna bele az adatmodellbe — pedig az OBH 4/2021. §10(2) szerinti
 * adatfajta-megjelölés (»[lakcím]«) nélkülük hiányos.
 */
export type EntityKind = 'person' | 'org' | 'place' | 'identifier';
export type Gender = 'F' | 'M' | 'N';
export type ReplacementMode = 'theme' | 'role' | 'type' | 'numbered';

/** Egy fél úgy, ahogy az ügyvéd beírja a felületen. */
export interface PartyInput {
  id: string;
  kind: EntityKind;
  /** Személynél: "Kovács János", "Kovács Jánosné", "özv. Baloghné Fehér Ilona". */
  fullName: string;
  gender: Gender;
  /** Eljárási szerep: "felperes", "I. r. alperes", "tanú". */
  role: string;
  /** Szervezetnél a szövegben használt rövidítés, pl. "MFB". */
  abbreviation?: string;
  /**
   * Azonosítónál (`kind === 'identifier'`) az azonosító fajtája. Ebből lesz az
   * adatfajta-címke a kimenetben, ezért nem elég a felszíni alakot tárolni:
   * a "8442130976" számsorról a csere pillanatában már nem derülne ki, hogy
   * adóazonosító jel volt-e vagy telefonszám.
   */
  identifierKind?: AzonositoKind;
  /** Ha a felhasználó kézzel adta meg az álnevet. */
  manualReplacement?: string;
  /** Kihagyva: ezt a felet nem cseréljük. */
  skipped?: boolean;
}

/**
 * Az elemzés bemenete — ezen a csatornán jut el a FELÜLETI BEÁLLÍTÁS a motorig.
 *
 * FIGYELEM: a MOTOR által ténylegesen fogadott alak a `session.ts`-ben áll, és
 * bővebb ennél (`keepList`, `safeWords`, `model`). Ez itt a felület felé
 * dokumentált részhalmaz; ami hiányzik belőle, azt a felület ma nem küldi. Ha
 * új mezőt veszel fel a motor oldalán, ELLENŐRIZD, hogy a felület is átadja —
 * enélkül a mező megvan, olvasója is van, és mindig üresen érkezik.
 *
 * A három beállítás azért itt van, és nem a `SettingsStore`-ból olvasva a
 * motorban, mert a munkamenet nem ismer felhasználói mappát: fájlt és
 * beállításfájlt kizárólag a főfolyamat lát. Ha a motor maga olvasná ki őket,
 * a tesztek és a `spike/` futtatók nem tudnák beállítani, és pontosan az a
 * helyzet állna elő, ami eddig: a csúszka a felületen mozog, a motor pedig
 * változatlanul a beépített 0,8-cel dolgozik.
 */
export interface AnalyzeInput {
  parties: PartyInput[];
  themeId: string;
  mode: ReplacementMode;
  caseSecret: string;
  /** Találatonkénti felhasználói döntések (találat-azonosító → döntés). */
  decisions?: Record<number, 'accept' | 'skip'>;
  /**
   * E fölött cserélünk automatikusan. Hiányában a motor beépített
   * alapértelmezése (`AUTO_REPLACE_THRESHOLD`) érvényes.
   */
  autoThreshold?: number;
  /**
   * A FELEK MEGJELENÉSI SORRENDJE — kívülről megadva, ha a hívó ismeri.
   *
   * Az álnév-kiosztás ebből dönti el, ki kapja a névsor élén álló, legjellemzőbb
   * fedőnevet (`AssignOptions.appearanceOrder`). Egy irat esetén a munkamenet
   * maga számolja ki a saját szövegéből — ez a mező üresen marad.
   *
   * TÖBB IRAT ESETÉN VISZONT KÖTELEZŐ EGYBŐL DOLGOZNI. Minden irat más
   * sorrendben említi a feleket: a keresetlevélben a felperes áll elöl, az
   * ítéletben a bíróság. Iratonként külön számolva ugyanaz a valódi név
   * IRATONKÉNT MÁS fedőnevet kapna — vagyis pont az veszne el, amiért egy ügy
   * iratai egyszerre vannak betöltve. Ezért a főfolyamat egyetlen sorrendet
   * állapít meg az ügyre, és azt adja át mindegyik iratnak.
   */
  appearanceOrder?: readonly string[];
  /**
   * A CÍMKÉK NYELVE a szerep-, adatfajta- és számozott módban. Alapból magyar.
   *
   * A fedőnév-módra nincs hatása: ott a NÉVKÉSZLET dönti el a nyelvet, és a
   * szállított készleteknek külön angol kiadásuk van. Két kapcsoló ugyanarra a
   * döntésre garantáltan szétcsúszik.
   */
  labelLang?: 'hu' | 'en';
  /** Az összegek átírása. Alapból nem: szétveri a végösszegeket. */
  replaceAmounts?: boolean;
  /** A dátumok egységes eltolása ügyenként. */
  shiftDates?: boolean;
  /**
   * BEKEZDÉSENKÉNTI ÚJRATÖRDELÉS a kimeneti PDF-ben. Alapból igaz.
   *
   * A PDF-ben nincs bekezdés, csak SOROK: mindegyik külön rajzolási utasítás.
   * Soronként újrarajzolva a csere két dolgot ront el — a sorkizárás elvész (a
   * mi sorunk normál szóközökkel áll, tehát csipkés a jobb széle), és egy
   * hosszabb álnév kifut a margóból, mert a szöveg nem tud a következő sorba
   * csordulni.
   *
   * Bekapcsolva a bekezdés EGÉSZ szövegét tördeljük újra a saját szélességére,
   * és a sorokat kizárjuk. A részletes indoklás a motoroldali párjánál áll
   * (`AnalyzeInput`, src/app/session.ts).
   */
  paragraphReflow?: boolean;
  /**
   * Fogadja el a program az ÁTNÉZÉSRE váró találatokat is, emberi döntés nélkül.
   *
   * Ez a „Csak csináld" mód motoroldali kapcsolója (`Settings.autoMode`), és
   * MÉRÉS döntötte el, nem ízlés. Három mintairaton, valódi modellel futtatva
   * (`test/nulla-kattintas.ts`): egy át nem nézett irat 35 bennmaradt nevet
   * hagy, ha csak az automatikus találatok cserélnek — és 1-et, ha az
   * átnézésre várókat is elfogadjuk. Az ára 4 fölösleges csere köznéven
   * (Nagy, Szabó, Fehér).
   *
   * A két hibafajta nem egyenrangú, ezért nem tanácstalanság ez a csere:
   * a kimaradt név SZIVÁRGÁS és láthatatlan — a felhasználó nem tud róla —,
   * a fölösleges csere viszont ott áll az olvasó szeme előtt („Kőszikla a
   * kockázat"), csúnya, de nem árul el senkit. Kétség esetén tehát cserélünk.
   *
   * Amit ez NEM érint: az „elutasítva" fokozatot (azok bizonyítottan nem
   * nevek), és a Bszi. 166. § (2) szerint megtartandó neveket — az eljáró
   * bíró, ügyvéd, védő és a bíróság nevét a törvény tiltja lecserélni, tehát
   * ők automatikus módban sem cserélődnek.
   */
  acceptReview?: boolean;
}

/**
 * A nyelvi modell állapota, ahogy a felismerés után ismerjük.
 *
 * A modell a felismerés MOTORJA: a szerkezeti minták csak azokat a feleket
 * találják meg, akiket az irat kifejezetten megnevez. Ha a modell nem futott,
 * az nem lábjegyzet, hanem a felismerés minőségének megváltozása — és a három
 * ok (nincs telepítve / hiba történt / kikapcsolva) három különböző teendőt
 * jelent a felhasználónak.
 *
 * MIÉRT ITT, ÉS NEM A `session.ts`-BEN: a felismerő (`detect.ts`) tölti ki, a
 * munkamenet (`session.ts`) olvassa, a felület pedig megjeleníti. Amíg a típus
 * a munkamenetben lakott, a felismerő nem hivatkozhatott rá anélkül, hogy a
 * teljes PDF-motort behúzza — és pontosan ezért nem is töltötte ki senki.
 */
export type ModelState = 'ok' | 'off' | 'missing' | 'failed';

export interface ModelStatus {
  state: ModelState;
  /** 'failed' esetén a magyar hibaüzenet. */
  message?: string;
  /** 'ok' esetén hány entitást adott vissza a modell. */
  entityCount?: number;
  /**
   * Hány modell-találatot nem tudtunk értelmezni: a nyers címkéjükhöz nem volt
   * bejegyzés a címketérképben, vagy a program nem tud mit kezdeni a fajtával.
   * Ezek eddig naplózás és számláló nélkül tűntek el, vagyis a program pont
   * arról hallgatott, amit nem értett.
   */
  unmappedLabels?: number;
  /**
   * Ugyanaz FAJTÁNKÉNT: nyers címke → darabszám.
   *
   * A puszta összeg nem elég a teendőhöz. A „3 találatot nem értettünk” mondat
   * mögött más a döntés, ha mind MISC (a modell szemétládája), és megint más,
   * ha mind DATE vagy AMOUNT — az utóbbi azt jelenti, hogy a modell olyasmit
   * ismer, amit a címketérképünk elhallgat.
   */
  unmappedByLabel?: Record<string, number>;
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
  licenseNote: string;
  givenCount: number;
  surnameCount: number;
  sample: string[];
}

export interface PageImage {
  index: number;
  /** PNG data URL. */
  dataUrl: string;
  /** A kép mérete képpontban. */
  width: number;
  height: number;
  /** Az oldal mérete pontban — a kiemelések ehhez képest vannak megadva. */
  pageWidth: number;
  pageHeight: number;
}

/**
 * EGY KIJELÖLHETŐ SZÖVEGSZAKASZ A LAPKÉP FÖLÖTT.
 *
 * A PDF a felületen KÉP: a lapot a natív rajzoló festi meg, és a képen nincs
 * szöveg, amit meg lehetne fogni. Emiatt a jobb gombos „jelöld ki, és mondd
 * meg, minek értelmezze" pontosan azon a formátumon nem működött volna, ami a
 * program fő tárgya — a bírósági iratok PDF-ben járnak.
 *
 * A megoldás ugyanaz, amit a PDF-olvasók használnak: a kép fölé ÁTLÁTSZÓ
 * szöveget rakunk, ugyanoda, ugyanakkorát. Nem látszik, de kijelölhető, és a
 * kijelölés a képen látható szavakon fut végig.
 *
 * Az arányok (0..1) a lap méretéhez képest értendők, mint a `Highlight`-nál —
 * így a réteg a lapképpel EGYÜTT nagyítódik, külön számolás nélkül.
 */
export interface TextSpan {
  page: number;
  /** A szakasz bal felső sarka és magassága a lap arányában. */
  left: number;
  top: number;
  height: number;
  /** A ténylegesen kirajzolt szélesség a lap arányában — ehhez igazítjuk a betűt. */
  width: number;
  /** Betűméret a lapszélesség arányában (így a nagyítás magától követi). */
  fontSize: number;
  text: string;
}

export interface Highlight {
  matchId: number;
  page: number;
  /** Az oldal bal felső sarkához képest, a lap méretének arányában (0..1). */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * AZ ÖSSZEG ÉS A DÁTUM ÁLAZONOSÍTÓJA.
 *
 * Nem fél és nem entitás: az iratban megtalált ÉRTÉK. Azonosítót mégis kap,
 * mert a találatoknak egységes a szerkezetük, és így ugyanaz a találatonkénti
 * döntés (`decisions`) vonatkozik rájuk, mint a nevekre.
 *
 * ITT LAKIK, a közös típusok között, mert MINDKÉT OLDAL használja: a motor a
 * találat előállításánál, a felület pedig ahhoz, hogy külön színnel emelje ki
 * őket az iraton. Két helyen leírva a két karakterlánc előbb-utóbb
 * szétcsúszna, és a felület némán a nevek színével rajzolná az összegeket.
 */
export const AMOUNT_ENTITY_ID = '#osszeg';
export const DATE_ENTITY_ID = '#datum';

/**
 * MI EZ A TALÁLAT — a kiemelés SZÍNÉT ez dönti el, a kimenet a fedettségét.
 *
 * A felhasználó kérése az volt, hogy az iraton külön színnel lássa az
 * összegeket, a dátumokat és a hivatalos szereplőket. A kettő MÁS KÉRDÉSRE
 * válaszol, és ezért nem is vonható össze:
 *
 *   `matchOutcome`  — MI TÖRTÉNIK vele: lecserélődik, döntésre vár, vagy marad.
 *   `MatchKind`     — MI EZ: név, összeg, dátum, hivatalos szereplő neve.
 *
 * A „hivatalos” nem a motor fogalma — ott ők közönséges felek, ha a felhasználó
 * a cseréjüket kérte —, ezért a besorolást a felület végzi, a felismerés
 * `officials` listája alapján.
 */
export type MatchKind = 'nev' | 'osszeg' | 'datum' | 'hivatalos';

/**
 * Egy találat besorolása.
 *
 * @param hivatalosIdk A Bszi. 166. § (2) szerinti szereplők azonosítói
 *   (`DetectionResult.officials`). Üres halmaz is jó: olyankor egyszerűen
 *   nincs „hivatalos” besorolás.
 */
export function matchKind(
  row: { entityId: string },
  hivatalosIdk: ReadonlySet<string>,
): MatchKind {
  if (row.entityId === AMOUNT_ENTITY_ID) return 'osszeg';
  if (row.entityId === DATE_ENTITY_ID) return 'datum';
  return hivatalosIdk.has(row.entityId) ? 'hivatalos' : 'nev';
}

export type Disposition = 'auto' | 'review' | 'reject';

/**
 * MI TÖRTÉNIK EZZEL A TALÁLATTAL — nem az, hogy mennyire voltunk biztosak benne.
 *
 * A `Disposition` a FELISMERÉS magabiztossága; ez itt a KIMENET. A kettő
 * rendszeresen szétválik: egy magabiztos találat is bent maradhat, ha a
 * felhasználó kikapcsolta, és egy elutasított is lecserélődhet, ha kézzel
 * bekapcsolta. A képernyőn a felhasználó azt akarja látni, MI LESZ — a
 * jelmagyarázat, a kiemelés színe és az állapotsor mind ezt mondja ki.
 *
 *  - 'csere'       lecserélődik
 *  - 'bizonytalan' a program bizonytalan, és még senki nem döntött róla
 *  - 'nincs'       nem cserélődik le (a program ítélte így, vagy kikapcsolták)
 */
export type MatchOutcome = 'csere' | 'bizonytalan' | 'nincs';

/**
 * A találat kimenete — EGY HELYEN eldöntve.
 *
 * Futtatható függvény, nem típus: a motor (`counts`/`outcomes`) és a felület
 * (a kiemelés színe, a jelmagyarázat) UGYANEZT hívja. Két külön másolat előbb-
 * utóbb szétcsúszna, és a képernyőn más szín állna, mint amit a mentés tesz —
 * pontosan az a fajta csendes hiba, amit ebben a programban nem szabad
 * megengedni. A függvény tiszta és függőségmentes, tehát a felületi kötegbe is
 * belefér.
 */
export function matchOutcome(row: {
  decision?: 'accept' | 'skip';
  disposition: Disposition;
}): MatchOutcome {
  if (row.decision === 'accept') return 'csere';
  if (row.decision === 'skip') return 'nincs';
  if (row.disposition === 'auto') return 'csere';
  if (row.disposition === 'review') return 'bizonytalan';
  return 'nincs';
}

export interface MatchRow {
  id: number;
  entityId: string;
  surface: string;
  replacement: string | null;
  reason: string;
  confidence: number;
  disposition: Disposition;
  /**
   * A döntés a találatról; ha nincs, az alapértelmezés (`disposition`) érvényes.
   *
   * Automatikus módban a PROGRAM tölti ki ember helyett. Hogy a kettő közül
   * melyik történt, azt az `autoDecided` mondja meg — a mező értéke önmagában
   * nem árulja el a döntés forrását.
   */
  decision?: 'accept' | 'skip';
  /**
   * Igaz, ha a döntést a program hozta ember helyett (automatikus mód).
   *
   * A felületnek pont ez a különbség számít: a felhasználó saját döntését nem
   * kérdőjelezzük meg, a program helyette hozott döntését viszont meg kell
   * mutatnia. Ha ez a mező nem volna, a képernyőn a kettő megkülönböztethetetlen
   * lenne, és a program úgy tenne, mintha a felhasználó döntött volna.
   */
  autoDecided?: boolean;
  page: number;
  /** Környezet a szereplaphoz: a találat körüli szöveg. */
  context: string;
  /**
   * A találat helye az `AnalysisResult.previewText`-ben (kezdő és záró
   * karakterindex).
   *
   * A felület szöveges nézete eddig a FELSZÍNI ALAKOKAT kereste vissza
   * szövegkereséssel, mert a pozíciót nem ismerte. Ez két dolgot rontott el:
   * ugyanaz a szó minden előfordulását megjelölte (akkor is, ahol nem találat
   * volt), és a jelölésekhez nem tartozott találat — vagyis rájuk kattintva
   * nem lehetett eldönteni, cserélődjenek-e. A pozíciót a motor amúgy is
   * ismeri; csak nem adta ki.
   *
   * Opcionális, mert a felületi fejlesztői álkimenet (`ui/src/devMock.ts`) is
   * `MatchRow`-t állít elő. A MOTOR mindig kitölti.
   */
  previewStart?: number;
  previewEnd?: number;
}

/**
 * Egy találat, amiről a program EMBER HELYETT döntött.
 *
 * Ez az automatikus mód ára, és nem szabad elhallgatni. A felhasználó egyetlen
 * kattintás nélkül kap kész iratot; cserébe joga van megtudni, hol döntött
 * helyette a program, és mi volt a bizonytalanság oka. A lista a felületre és a
 * jegyzőkönyvbe is kimegy.
 */
export interface AutoDecisionRow {
  /** A találat azonosítója (`MatchRow.id`) — a felület erre ugrik vissza. */
  matchId: number;
  entityId: string;
  surface: string;
  /** A találat körüli szöveg, a találat ⟦…⟧ közé zárva. */
  context: string;
  /** Miért volt bizonytalan: a felismerő saját indoklása. */
  reason: string;
  confidence: number;
  page: number;
  /** Amire kicseréltük. */
  replacement: string | null;
  /**
   * A felszíni alak (vagy a találat névrész-magja) köznévként is létezik:
   * Nagy, Szabó, Fehér. Ezek a valószínű FÖLÖSLEGES cserék, ezért kapnak külön
   * jelölést — az elrontott mondatot („Kőszikla a kockázat") itt kell keresni,
   * nem a lista többi tételénél.
   */
  commonWord: boolean;
}

export interface CastRow {
  entityId: string;
  original: string;
  replacement: string;
  kind: EntityKind;
  role: string;
  gender: Gender;
  occurrences: number;
  /** Hány találat vár emberi döntésre ennél a félnél. */
  pendingCount: number;
  manual: boolean;
  skipped: boolean;
}

export interface DocumentInfo {
  path: string;
  fileName: string;
  format: 'pdf' | 'docx' | 'txt';
  pageCount: number;
  charCount: number;
  /** Igaz, ha a fájlban nem találtunk kiolvasható szöveget (valószínűleg szkennelt). */
  looksScanned: boolean;
  /**
   * Feloldatlan változáskövetés a Word-dokumentumban. Amíg van, nem exportálunk:
   * a <w:del> elemek szó szerint őrzik az eredeti szöveget, és ha úgy mentenénk,
   * pontosan azt a hibát követnénk el, amit a fekete csík rárajzolása jelent.
   */
  pendingRevisions: number;
  /** Részek, amiket nem néztünk át (beágyazott objektum, ismeretlen rész). */
  loadWarnings: string[];
}

/**
 * EGY BETÖLTÖTT IRAT SAJÁT RÉSZE az elemzésben.
 *
 * A program EGYSZERRE TÖBB IRATOT tart nyitva: egy ügy több irata egy
 * munkamenetben megy át, hogy ugyanaz a valódi név mindegyikben ugyanazt a
 * fedőnevet kapja. Ami közös (a felek, a találatok listája, a döntések),
 * az az `AnalysisResult` gyökerén áll; ami IRATONKÉNT más — a lapképek, a
 * kiemelések koordinátái, a szöveg —, az ide kerül.
 *
 * A `matchIdTol`/`matchIdIg` az irat találatainak azonosító-tartománya. A
 * találatok azonosítója az egész munkamenetben egyedi (a főfolyamat iratonként
 * eltolja), így a `decisions` tároló egyetlen kulcstérben marad — a felület
 * nem tudja véletlenül a MÁSIK irat egy találatára írni a döntést.
 */
export interface DocSection {
  doc: DocumentInfo;
  pages: PageImage[];
  highlights: Highlight[];
  /**
   * A LAPKÉP FÖLÉ FEKTETETT, KIJELÖLHETŐ SZÖVEG — csak PDF-en.
   *
   * Üres lista DOCX-en és TXT-n: ott a nézet magát a szöveget rajzolja ki,
   * tehát eleve kijelölhető. Opcionális, mert a felületi fejlesztői álkimenet
   * is `DocSection`-t állít elő.
   */
  textSpans?: TextSpan[];
  /** A dokumentum szövege — a szöveges előnézethez (DOCX, TXT). */
  previewText: string;
  /**
   * BEKEZDÉSHATÁROK a `previewText`-ben — karakterindexek, ahol új bekezdés kezdődik.
   *
   * MIÉRT KELL. A PDF-ből kiolvasott szövegben NINCS sortörés: a lapot
   * soronként rajzolják, mi pedig szóközzel fűzzük össze őket, hogy a
   * sortörésen átnyúló nevet meg tudjuk találni (`buildPageText`). A szöveg
   * emiatt egyetlen, végtelen bekezdésként áll a képernyőn — olvashatatlanul.
   *
   * A motor ismeri a bekezdéseket (ugyanaz a csoportosítás, amivel a kimenetet
   * újratördeli), tehát meg tudja mondani, hol kezdődik új. A felület ebből
   * rakja vissza a tagolást — a szöveghez magához nem nyúlva, mert a találatok
   * pozíciói arra hivatkoznak.
   *
   * Üres lista DOCX-en és TXT-n: ott a szövegben eleve ott a sortörés.
   */
  paragraphs?: { start: number; center: boolean }[];
  matchIdTol: number;
  matchIdIg: number;
}

/**
 * AZ ÁLNEVESÍTETT IRAT LAPKÉPEI — a PDF-előnézet tartalma.
 *
 * Nem az elemzés része, és szándékosan nem is: az elemzés minden
 * beállításváltozásra újrafut, ez viszont a KÉSZ KIMENETET rajzolja ki
 * (betűtörlés, újrarajzolás, teljes újramentés), tehát drága. Csak akkor
 * készül el, amikor a felhasználó tényleg az előnézetre vált.
 *
 * Üres lista: nincs lapkép (DOCX, TXT, vagy hiányzik a natív rajzoló) — a
 * felület ilyenkor a szöveges előnézetre esik vissza.
 */
export interface PreviewPages {
  pages: PageImage[];
  /** A csereszövegek helye a KÉSZ lapon; a `matchId` a találatra mutat vissza. */
  highlights: Highlight[];
}

export interface AnalysisResult {
  /**
   * AZ ELSŐ betöltött irat — a `docs` első eleme, kibontva.
   *
   * Nem az „aktív" iraté: melyik látszik éppen, azt a FELÜLET tudja, és neki
   * ott a `docs` tömb. Ezek a mezők azért maradtak meg, mert a motor és a
   * tesztek egy iratra írt útjai változatlanul működnek tőlük.
   */
  doc: DocumentInfo;
  pages: PageImage[];
  /** A kijelölhető szövegréteg az ELSŐ irathoz — a `docs` első elemének mása. */
  textSpans?: TextSpan[];
  /** Bekezdéshatárok az ELSŐ irat szövegében — a `docs` első elemének mása. */
  paragraphs?: { start: number; center: boolean }[];
  /**
   * MINDEN betöltött irat, betöltési sorrendben. Egy iratnál egyelemű.
   *
   * Opcionális, mert a felületi fejlesztői álkimenet (`ui/src/devMock.ts`) is
   * `AnalysisResult`-ot állít elő; a MOTOR mindig kitölti.
   */
  docs?: DocSection[];
  cast: CastRow[];
  matches: MatchRow[];
  highlights: Highlight[];
  warnings: string[];
  counts: { auto: number; review: number; reject: number };
  /**
   * UGYANEZ A TALÁLATLISTA A KIMENET FELŐL: mi cserélődik le, mi vár döntésre,
   * és mi marad bent.
   *
   * A `counts` a felismerés magabiztossági fokozatait számolja — az az elemzés
   * minőségéről szól, és szándékosan nem változik attól, hogy a felhasználó mit
   * kapcsolt ki. A képernyőn viszont az a kérdés, hogy MI LESZ AZ IRATTAL: egy
   * kikapcsolt összeg a `counts.auto` alatt marad, a jelmagyarázat mégis azt
   * kell hogy mondja róla, hogy nem cserélődik. Ezért két külön számhármas.
   *
   * Opcionális, mert a felületi fejlesztői álkimenet (`ui/src/devMock.ts`) is
   * `AnalysisResult`-ot állít elő; a MOTOR mindig kitölti.
   */
  outcomes?: { csere: number; bizonytalan: number; nincs: number };
  /** A dokumentum szövege — a szöveges előnézethez (DOCX, TXT). */
  previewText: string;
  /**
   * Amit a program EMBER HELYETT fogadott el (automatikus mód). Üres lista, ha
   * a felhasználó maga dönt.
   *
   * Szándékosan opcionális, ugyanabból az okból, amiért az
   * `ExportResult.warnings` is az: a felületi fejlesztői álkimenet
   * (`ui/src/devMock.ts`) szintén `AnalysisResult`-ot állít elő, és egy kötelező
   * mező ott fordítási hibát okozna. A MOTOR viszont mindig kitölti.
   */
  autoAccepted?: AutoDecisionRow[];
}

export interface ExportOptions {
  mode: ReplacementMode;
  /** Titkosított kulcsfájl készüljön-e (álnevesítés), vagy semmisüljön meg (anonimizálás). */
  keepKey: boolean;
  keyPassphrase?: string;
  outputPath: string;
}

export interface VerifyReportUi {
  ok: boolean;
  leaks: { surface: string; detail: string }[];
  /**
   * A gyanús maradványok LEVÁGOTT listája. A hosszát tilos darabszámként
   * mutatni — arra a `residualTotal` való.
   */
  residual: { surface: string; detail: string }[];
  /**
   * A maradványok TELJES száma, a levágás előtt.
   *
   * A verify.ts pontosan azért adja vissza, mert enélkül a felület a levágás
   * utáni hosszt mutatta, és így maga a csonkolás sem derült ki: 137
   * maradványból 40 látszott, a képernyőn pedig a „40" szám állt. A mező eddig
   * megvolt a verify.ts jelentésében, de ezen a határon kiesett.
   */
  residualTotal: number;
  replaced: number;
  pending: number;
  checkedChars: number;
}

/** Egy irat mentésének eredménye a kötegben. */
export interface ExportFileResult {
  fileName: string;
  outputPath: string;
  report: VerifyReportUi;
  certificatePath?: string | null;
  warnings?: string[];
}

export interface ExportResult {
  outputPath: string;
  keyPath: string | null;
  report: VerifyReportUi;
  /**
   * MINDEN mentett irat külön-külön. Egy iratnál egyelemű, és a gyökérmezők
   * (`outputPath`, `report`) ugyanannak az egynek az adatai.
   *
   * A SZIVÁRGÁSI KAPU IRATONKÉNT ZÁR. Ha egy irat ellenőrzése bukik, abból
   * nem keletkezik fájl — a többi viszont igen. A köteg egészét eldobni azt
   * jelentené, hogy kilenc rendben lévő irat munkája vész el a tizedik miatt;
   * a bukott iratról viszont a lista tételesen megmondja, hogy nem készült el,
   * és miért.
   */
  files?: ExportFileResult[];
  /** Az anonimizálási jegyzőkönyv szövege. */
  certificate: string;
  /**
   * A MENTÉS figyelmeztetései: beágyazott objektum, át nem nézett
   * dokumentumrész, az összeg- és dátumcsere következményei, a PDF-ből
   * eltávolított jegyzet és űrlap.
   *
   * Ezek egy része KIZÁRÓLAG a mentés közben derül ki (a PDF-metaadat
   * kitakarítása, a nem visszaírható tartalomfolyam), tehát az elemzés
   * `AnalysisResult.warnings` mezőjében még nem szerepelhettek. Amíg ez a mező
   * nem volt meg, a felhasználó csak akkor látta volna őket, ha a mentés UTÁN,
   * ugyanabban a munkamenetben újra lefuttatja az elemzést — vagyis a
   * gyakorlatban soha.
   *
   * Szándékosan opcionális: a felületi fejlesztői álkimenet
   * (`ui/src/devMock.ts`) is `ExportResult`-ot ad, és egy szükséges mező ott
   * fordítási hibát okozna. A MOTOR viszont mindig kitölti — lásd
   * `SessionExportResult`, ahol a mező kötelező.
   */
  warnings?: string[];
  /**
   * Az anonimizálási jegyzőkönyv ÚTVONALA; null, ha nem keletkezett fájl.
   *
   * A `certificate` mező csak a szövegét adja. Az irat mellé viszont egy
   * HARMADIK fájl is kikerül a lemezre, ráadásul származtatott néven — erről a
   * felhasználó eddig sehol nem értesült, tehát nem is tudta, hogy a mappa
   * kiküldésével a jegyzőkönyvet is kiküldi.
   */
  certificatePath?: string | null;
  /**
   * Amit a program EMBER HELYETT fogadott el — UGYANAZ a lista, ami az
   * elemzésből is kijött.
   *
   * Azért itt is, mert automatikus módban a felhasználó a mentés eredményét
   * látja először: ha a lista csak az elemzésnél lenne meg, a „kész van"
   * képernyőn semmi nem mondaná meg, hol döntött helyette a program. A
   * jegyzőkönyvbe ugyanez kerül, tehát a képernyő és a fájl nem mondhat mást.
   *
   * Opcionális, mert az `ui/src/devMock.ts` is `ExportResult`-ot állít elő; a
   * motor viszont mindig kitölti — lásd `SessionExportResult`.
   */
  autoAccepted?: AutoDecisionRow[];
}
