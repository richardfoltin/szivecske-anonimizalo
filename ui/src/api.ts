import type {
  AnalysisResult,
  DocumentInfo,
  ExportOptions,
  ExportResult,
  ModelStatus as MotorModelStatus,
  PartyInput,
  PreviewPages,
  ReplacementMode,
  ThemeSummary,
} from '../../src/app/types.js';
import type { TemaEredmeny } from '../../src/app/temagyar.js';

/*
  A motor típusai VÁLTOZATLANUL mennek tovább a felületnek: nem másoljuk le
  őket, mert a másolat némán elcsúszna az eredetitől, és pontosan az a helyzet
  állna elő, ami eddig — a motor kitölt egy mezőt, a felület típusa nem ismeri,
  a mező pedig ott áll az objektumban, láthatatlanul.

  Ezért van itt `ExportResult` is: a `warnings` (a MENTÉSKOR keletkezett
  figyelmeztetések) és a `certificatePath` (a lemezre kikerült jegyzőkönyv
  útvonala) ezen az újrakiadáson keresztül érkezik meg a felületre. Mindkettő a
  motorban kötelező (`SessionExportResult`, src/app/session.ts), a közös
  típusban csak azért nem az, mert a böngészős fejlesztői álkimenet is
  `ExportResult`-ot ad.

  A `VerifyReportUi` és az `ExportOptions` azért kerül ki, mert a felületnek
  MINDKETTŐ kell: az egyiket ő állítja össze a mentéshez, a másikat ő jeleníti
  meg az ellenőrző kör eredményeként.
*/
export type {
  AnalysisResult,
  AutoDecisionRow,
  AzonositoKind,
  CastRow,
  EntityKind,
  DocumentInfo,
  ExportOptions,
  ExportResult,
  Highlight,
  MatchKind,
  DocSection,
  MatchOutcome,
  MatchRow,
  PageImage,
  PartyInput,
  PreviewPages,
  ReplacementMode,
  TextSpan,
  ThemeSummary,
  VerifyReportUi,
} from '../../src/app/types.js';

/*
  A TALÁLAT KIMENETE — FUTTATHATÓ KÓD, NEM TÍPUS.

  Ez az egyetlen hely, ahol a felület tényleges kódot vesz át a motortól, és
  szándékosan az: a kiemelés színe, a jelmagyarázat és az állapotsor
  ugyanabból a függvényből dolgozik, amiből a motor `outcomes` számhármasa. Egy
  felületi másolat pontosan az a csendes hiba volna, ami ebben a programban a
  legdrágább: a képernyőn más szín állna, mint amit a mentés tesz.

  A `types.ts` tisztán típusokból és ebből az egy tiszta függvényből áll — se
  fájlrendszer, se motor, se `node:` modul nem kerül vele a felületi kötegbe.
*/
export { matchKind, matchOutcome } from '../../src/app/types.js';

/*
  AZ AZONOSÍTÓFAJTÁK MAGYAR NEVE — a motor szótára, nem felületi másolat.

  A jobb gombos menü „Azonosító" almenüje ebből épül, és a szereplap ugyanezt
  írja ki. Egy felületi második lista előbb-utóbb lemaradna egy fajtáról: a
  motor megtanulná a tizenötödiket, a menüben tizennégy maradna, és a
  felhasználó azt hinné, hogy azt a fajtát a program nem ismeri.
*/
export { AZONOSITO_NEV } from '../../src/app/types.js';

/*
  A SAJÁT NÉVKÉSZLET típusai UGYANABBÓL A FORRÁSBÓL jönnek, mint a motoré.

  A `TemaEredmeny` az egész jelentést hordozza: mi ment át az ellenőrzésen, mi
  nem és miért, melyik névnél tippel a ragozó motor, és mi hiányzik még. A
  felület mindezt kirajzolja — ha itt lemásolnánk a típust, a másolat némán
  elcsúszna, és pont az a mező veszne el, amit a felhasználónak jóváhagyás előtt
  látnia kell. A `import type` a fordításkor eltűnik, tehát a motor kódjából
  semmi nem kerül a felület kötegébe.
*/
export type {
  EllenorzottNev,
  ElutasitottNev,
  MutatvanyAlak,
  TemaEredmeny,
  TemaHiany,
  TemaJelentes,
} from '../../src/app/temagyar.js';

/**
 * A nyelvi modell FUTÁSÁNAK állapota — nem tévesztendő össze az alább álló
 * `ModelStatus`-szal, ami a LETÖLTÉS állapota.
 *
 * A két kérdés különböző, és a felületen is külön helyre való: a letöltés a
 * Beállítások → Nyelvi modellek lapé, a futás pedig azé az iraté, ami éppen
 * nyitva van. Ezért érkezik átnevezve — a puszta „ModelStatus" a felületi
 * kódban két különböző dolgot jelentene.
 *
 *  - 'ok'      — lefutott, olvasta az iratot (`entityCount` a találatok száma)
 *  - 'off'     — nem olvasta: ki van kapcsolva, vagy nem futott felismerés
 *  - 'missing' — nincs telepítve, ezért nem is olvashatta
 *  - 'failed'  — futás közben elszállt; a `message` a magyar hibamondat
 */
export type ModelRunStatus = MotorModelStatus;
export type { ModelState as ModelRunState } from '../../src/app/types.js';

interface AnalyzeInput {
  parties: PartyInput[];
  themeId: string;
  mode: ReplacementMode;
  caseSecret: string;
  decisions?: Record<number, 'accept' | 'skip'>;
  /**
   * A három beállítás CSAK ezen a csatornán jut el a motorig: a munkamenet nem
   * olvas beállításfájlt (lásd `AnalyzeInput`, src/app/types.ts). Ha a felület
   * nem adja át őket, a csúszka és a két kapcsoló a képernyőn mozog, a motor
   * pedig változatlanul a beépített alapértékkel dolgozik — és a felhasználó
   * abban a hitben adja ki az iratot, hogy az összegek át vannak írva.
   */
  autoThreshold?: number;
  replaceAmounts?: boolean;
  shiftDates?: boolean;
  /**
   * A CÍMKÉK NYELVE a szerep-, adatfajta- és számozott módban.
   *
   * Ugyanaz a helyzet, mint a fenti hármé: a munkamenet nem olvas
   * beállításfájlt, tehát ha a felület nem küldi át, a kártyán bekapcsolt
   * „angol" semmit nem érne — a kimenetben magyar címkék állnának.
   */
  labelLang?: 'hu' | 'en';
  /**
   * Fogadja el a program az ÁTNÉZÉSRE váró találatokat is, emberi döntés nélkül.
   *
   * A „kérdezés nélkül" út motoroldali kapcsolója. Ugyanúgy a felület adja át,
   * mint a fenti hármat, és ugyanabból az okból: a munkamenet nem olvas
   * beállításfájlt. Ha a felület elfelejtené elküldeni, a mód a képernyőn
   * bekapcsolva állna, a motor pedig változatlanul emberi döntésre várna — a
   * felhasználó tehát abban a hitben adná ki az iratot, hogy a program mindent
   * lecserélt, közben minden bizonytalan találat bent maradt volna.
   */
  acceptReview?: boolean;
  /**
   * A törvény szerint MEGTARTANDÓ nevek: eljáró bíró, ügyvéd, ügyvédi iroda, a
   * bíróság neve (Bszi. 166. § (2)). A felismerés adja vissza
   * (`DetectionResult.keepList`), és a felületnek TOVÁBB KELL KÜLDENIE.
   *
   * Nem a cserét befolyásolja — ezek a nevek eleve nem kerülnek a `parties`
   * közé (`detectParties`, src/app/detect.ts), tehát cserélni sosem cseréltük
   * őket. Az ELLENŐRZŐ KÖR használja: a `verifyOutput` söprő ága minden
   * mondaton belüli nagybetűs szót maradványként jelent, ha nincs a
   * megtartandó listán. Amíg ez a mező nem ment át, az eljáró bíró és a két
   * ügyvéd SAJÁT NEVE jelent meg riasztásként a mentés utáni ablakban — mérve
   * az ítéleten 4 helyett 21 maradvány, ebből 17 a bíró és az ügyvédek neve.
   * Ez nem kozmetika: a zajban a valódi találat vész el.
   */
  keepList?: string[];
  /*
    A NYELVI MODELL ÁLLAPOTA SZÁNDÉKOSAN NINCS ITT.

    A motor `AnalyzeInput`-ja ismer egy `model` mezőt (src/app/session.ts), és a
    jegyzőkönyv abból írja ki, hogy a modell futott-e. Azt viszont a felület nem
    tudhatja: a modell külön folyamatban fut, a hibája a főfolyamatban
    keletkezik. Ezért a `doc:analyze` kezelője tölti ki (electron/main.ts) abból,
    amit a felismeréskor MÉRT — a felületnek nincs vele dolga, és ha mégis
    küldene valamit, azzal csak felülírná a valóságot.
  */
}

export interface DetectedParty extends PartyInput {
  confidence: number;
  evidence: string;
  occurrences: number;
}

export interface DetectionResult {
  parties: DetectedParty[];
  keepList: { name: string; why: string }[];
  /**
   * UGYANEZEK A NEVEK KÉSZ FÉLKÉNT — ha a felhasználó mégis lecserélteti őket.
   *
   * A `keepList` csak nevet és indokot hordoz; az álnevesítéshez fajta, nem,
   * szerep és előfordulásszám is kell, és azt csak a felismerés tudja. Enélkül
   * a felületnek magának kellene kitalálnia a bíró nemét — a bírónő pedig
   * férfinevet kapna.
   *
   * Opcionális, mert egy RÉGEBBI hídon nincs meg. Hiányában a „hivatalos
   * szereplőket is cseréljük" kapcsoló nem jelenik meg: egy gomb, ami semmit
   * nem tud lecserélni, rosszabb, mint a hiánya.
   */
  officials?: DetectedParty[];
  /**
   * Hivatalos azonosítók: lakcím, e-mail, adószám, TAJ, bankszámlaszám, hrsz.
   *
   * KÜLÖN listán, nem a `parties` között — a felületen is külön rovat való
   * nekik. Egy azonosító nem „fél": nincs neme és nincs eljárási szerepe, a
   * `role` mezőjében az adatfajta neve áll („adószám"), a `fullName`-ben pedig
   * maga a számsor. A csere sem témás fedőnevet ad rá, hanem
   * adatfajta-megjelölést (»[lakcím]«) az OBH 4/2021. §10(2) szerint.
   *
   * A motor ezeket MAGÁTÓL is felveszi a cserébe (`foundIdentifierParties`,
   * src/app/session.ts), tehát a felületnek nem kell visszaküldenie őket az
   * elemzéshez — a lista az ÁTNÉZÉSHEZ kell: az ügyvéd lássa, mit talált a
   * program, és mit fog kitakarni.
   */
  identifiers: DetectedParty[];
  /**
   * A nyelvi modell futásának állapota — a négy eset négy külön teendő.
   *
   * A `modelUsed` csak igen/nem; ez mondja meg, hogy MIÉRT nem futott, és
   * ezért ez való a felületre is. A jegyzőkönyvbe ugyanez kerül: a főfolyamat
   * jegyzi meg a felismeréskor, és a mentéskor írja ki (electron/main.ts).
   */
  model: ModelRunStatus;
  /** Futott-e ténylegesen a nyelvi modell. Ugyanaz, mint `model.state === 'ok'`. */
  modelUsed: boolean;
  /** Mit érdemes tudni róla — a felületen ez látszik. */
  modelNote: string;
  /**
   * Leállította-e a felhasználó a vizsgálatot.
   *
   * A megszakítás NEM HIBA, ezért nem kivételként érkezik: a válasz rendben
   * megjön, csak kevesebbet tud. A szerkezeti felismerés ilyenkor is lefutott
   * — a rovatokból („Felperes:”) előkerült felek és az azonosítók bent vannak
   * a listákban —, tehát VAN mit megmutatni. A felületnek ezt nyugodt
   * mondattal kell jeleznie, nem piros hibasávval: a felhasználó azt kapta,
   * amit kért.
   */
  megszakitva: boolean;
}

/* ─────────────────────────── a vizsgálat haladása ─────────────────────────── */

/**
 * A felismerés szakaszai — négy valódi lépés és két végállapot.
 *
 * MIÉRT NEM ELÉG EGY PÖRGŐ KÖR: a négy szakasz négy különböző okból tarthat
 * sokáig. A modell betöltése egyszeri, ~650 MB-os lemezművelet, a vizsgálat
 * viszont a szöveg hosszával nő. Aki látja, hogy „a nyelvi modell betöltése”
 * tart, tudja, hogy ez a rész a következő iratnál gyorsabb lesz; aki csak egy
 * pörgő kört lát, azt hiszi, megállt a program — és a tapasztalat szerint
 * ilyenkor lövi ki az egészet, a megnyitott irattal együtt.
 *
 *  - 'szoveg'      az irat szövegének kinyerése (PDF-nél ez sem ingyenes)
 *  - 'modell'      a nyelvi modell betöltése a lemezről
 *  - 'vizsgalat'   a modell olvassa az iratot — ehhez tartozhat arány is
 *  - 'osszesites'  a találatok összefésülése a szerkezeti felismeréssel
 *  - 'kesz'        lefutott
 *  - 'megszakitva' a felhasználó leállította; NEM hiba
 */
export type FelismeresSzakasz =
  | 'szoveg'
  | 'modell'
  | 'vizsgalat'
  | 'osszesites'
  | 'kesz'
  | 'megszakitva';

export interface DetectProgress {
  szakasz: FelismeresSzakasz;
  /** Magyar mondat, közvetlenül kiírható. Mindig ki van töltve. */
  uzenet: string;
  /** Hányadik résszel végzett a modell; 0, ha még nem tart sehol. */
  ablak: number;
  /** Hány rész lesz összesen; 0, ha nem tudjuk. */
  ablakok: number;
  /**
   * 0..1, VAGY `null`, ha nem tudjuk.
   *
   * A `null` szándékosan külön eset, nem 0: a nulla azt jelentené, hogy éppen
   * most kezdtük, a `null` viszont azt, hogy ebben a szakaszban nincs mit
   * arányosítani. Határozott csíkot csak az elsőre szabad rajzolni — egy
   * kitalált százalékból a felhasználó rossz időt becsül, és pont akkor lövi
   * ki a programot, amikor a végén tartana.
   */
  arany: number | null;
}

export interface AppSettings {
  themeId: string;
  mode: ReplacementMode;
  keepKey: boolean;
  autoDetect: boolean;
  useModel: boolean;
  modelId: string;
  autoThreshold: number;
  replaceAmounts: boolean;
  shiftDates: boolean;
  /**
   * Kérdezés nélkül menjen-e végig a program az iraton.
   *
   * Igaz esetén a megnyitás után nincs Felek-párbeszéd és nincs végigkattintás
   * a bizonytalan találatokon: a program a mentésig magától eljut, a
   * felhasználó a fájlnevet adja meg. A döntéseit utólag, a mentés utáni
   * jelentésben nézi át.
   *
   * MÉRÉS döntötte el, nem ízlés (test/nulla-kattintas.ts, három mintairaton,
   * valódi modellel): egy át nem nézett iratban 35 eredeti név marad bent, ha
   * csak a magabiztos találatok cserélnek — és 1, ha a program az átnézésre
   * várókat is elfogadja. Az ára 4 fölösleges csere köznéven.
   */
  autoMode: boolean;
  /**
   * A címkék nyelve a szerep-, adatfajta- és számozott módban.
   *
   * Opcionális, mert egy RÉGEBBI beállításfájlban nincs benne — és a hiányt
   * nem szabad választásnak venni: olyankor a magyar marad érvényben.
   */
  labelLang?: 'hu' | 'en';
}

/**
 * Az IRATONKÉNT állítható értékek — pontosan az, ami a beállító oldalon áll.
 *
 * Ezek ügyenként mások lehetnek: az egyik iratban ásványnevekkel dolgozunk és
 * kell kulcsfájl, a másikban kőkorszakiakkal és nem kell. Ezért kerültek le a
 * Beállítások „Alapértelmezések” lapjáról a dokumentum beállító oldalára.
 *
 * A LEGUTÓBB HASZNÁLT értékekkel nyílnak meg (`api.getUiState`), hogy aki
 * mindig ugyanúgy dolgozik, ne állítgasson újra semmit. A tárolójuk NEM külön
 * másolat: ugyanaz a beállításfájl, amibe a `setUiState` visszaír — két
 * példányból előbb-utóbb kettő lenne, és a felhasználó azt hinné, azzal a
 * névkészlettel dolgozik, amit a képernyőn lát.
 *
 * Ami itt NINCS: a modell azonosítója, az automatikus felismerés és a modell
 * használatának kapcsolója. Azok a programra vonatkoznak, nem az iratra — azok
 * maradnak a Beállításokban.
 */
export interface IratBeallitas {
  themeId: string;
  mode: ReplacementMode;
  keepKey: boolean;
  autoThreshold: number;
  replaceAmounts: boolean;
  shiftDates: boolean;
  /**
   * A címkék nyelve a szerep-, adatfajta- és számozott módban.
   *
   * Opcionális, mert egy RÉGEBBI beállításfájlban nincs benne, és a hiányzó
   * mezőt nem szabad választásnak venni: olyankor a magyar marad érvényben.
   */
  labelLang?: 'hu' | 'en';
}

/**
 * Amit a beállító oldal a megnyitáskor lekérdez.
 *
 * Kétféle adat, két különböző okból. A `modeAsked` a PROGRAM emlékezete:
 * megkérdeztük-e már, melyik úton menjünk végig az iraton. Enélkül az első
 * megnyitásnál vagy minden alkalommal kérdeznénk, vagy egyszer sem — az utóbbi
 * azt jelentené, hogy a program az első iratnál szó nélkül dönt a felhasználó
 * helyett.
 *
 * Az `iratBeallitas` viszont a FELHASZNÁLÓ döntéseinek legutóbbi állása. Azért
 * jön mégis ezen az egy híváson, mert a beállító oldalnak pontosan azt a hatot
 * kell megkapnia, ami rajta állítható — a felületnek nem dolga fejben tartani,
 * hogy a tíz beállításból melyik vonatkozik az iratra.
 */
export interface UiState {
  modeAsked: boolean;
  iratBeallitas: IratBeallitas;
}

export interface ModelStatus {
  id: string;
  name: string;
  repo: string;
  license: string;
  /** Mi ez: felépítés, származás, címkék. */
  mi: string;
  /** Mit csinál: MÉRT tények. */
  mit: string;
  languages: string[];
  recommended: boolean;
  /**
   * MIRE VALÓ a modell — és ez nem címke, hanem elválasztás.
   *
   * 》detect《: felismerő, ez olvassa végig az iratot. Csak ilyet szabad
   * aktívvá tenni. 》namegen《: névkészlet-gyártó, a kitakaráshoz semmi köze.
   *
   * MIÉRT KELL A FELÜLETEN: a Beállítások két külön listába rendezi a kettőt,
   * mert a generálót olvasó modellnek beállítva a névfelismerés NÉMÁN romlana
   * el — a program üres találatlistát adna, vagyis azt mondaná, hogy nincs név
   * az iratban. A mező a nyilvántartásban mindig megvolt (`ModelSpec.purpose`,
   * src/app/models.ts), de a hídon nem jött át, ezért a felület az azonosítót
   * volt kénytelen találgatni — és a nyilvántartásba került gyártó azonosítója
   * (`qwen3-4b-thinking-namegen`) nem az, amit a találgatás keresett.
   */
  purpose: "detect" | "namegen";
  /** "converted": a programmal érkezik, nincs mit letölteni. */
  source: "hub" | "converted";
  state: "missing" | "partial" | "installed";
  bytesOnDisk: number;
  totalBytes: number;
}

export interface ModelListResult {
  models: ModelStatus[];
  diskUsage: number;
  diskUsageLabel: string;
}

export interface DownloadProgress {
  modelId: string;
  file: string;
  receivedBytes: number;
  totalBytes: number;
  ratio: number;
  done: boolean;
}

/**
 * A menüsor egy pontjára kattintottak.
 *
 * A menü maga semmit nem végez el: a főfolyamat csak megüzeni, mit kért a
 * felhasználó, és a felület dönti el, mit jelent ez az éppen aktuális
 * állapotban (van-e megnyitott irat, van-e mit menteni).
 */
export type MenuAction =
  | 'open'
  | 'save'
  | 'print'
  | 'settings'
  | 'newCase'
  | 'keyfile'
  | 'about'
  | 'update';

/* ─────────────────────────── névkészletek ─────────────────────────── */

/**
 * Egy névkészlet a választóban — a motor összefoglalója, egyetlen mezővel
 * kiegészítve.
 *
 * A `sajat` azért kell, mert a kétféle készlet nem egyenrangú: a szállított
 * négyet átnézett ember állította össze, a sajátot egy nyelvi modell javasolta
 * és a program ellenőrizte. A felhasználónak látnia kell, melyiket használja —
 * és csak a sajátot szabad tudnia törölni.
 */
export interface ThemeSummaryUi extends ThemeSummary {
  sajat?: boolean;
}

/**
 * A saját készlet gyártásának állapota, amíg tart.
 *
 * A modell csoportonként dolgozik (utónév, vezetéknév, cégnév-előtag,
 * helységnév), és egy-egy csoport processzoron percekbe telik. Enélkül a
 * felhasználó egy mozdulatlan pörgőt nézne, és azt hinné, megállt a program.
 */
export interface TemaGenStatus {
  /** Magyar mondat arról, mi történik éppen. */
  uzenet: string;
  /** Hányadik csoportnál tartunk, 1-től. */
  lepes: number;
  /** Hány csoport lesz összesen. */
  lepesek: number;
}

/* ─────────────────────────── frissítés ─────────────────────────── */

/**
 * A frissítés állapota — kilenc eset, mert kilencféle teendő tartozik hozzájuk.
 *
 *  - 'off'          nincs beállítva frissítési cím: a funkció nincs bekapcsolva
 *  - 'unsupported'  ebben a futtatásban nem működhet (fejlesztői indítás, vagy
 *                   hiányzik a frissítő összetevő a csomagból)
 *  - 'idle'         be van állítva, de még nem kerestünk
 *  - 'checking'     éppen kérdezzük a kiszolgálót
 *  - 'current'      naprakész
 *  - 'available'    van újabb verzió, még nincs letöltve
 *  - 'downloading'  töltjük
 *  - 'ready'        letöltve, újraindítás kell hozzá
 *  - 'failed'       nem sikerült; az `uzenet` mondja meg, miért
 */
export type UpdatePhase =
  | 'off'
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'failed';

export interface UpdateState {
  phase: UpdatePhase;
  /** A beállított frissítési cím; üres, ha nincs. */
  feedUrl: string;
  /** A most futó verzió. */
  currentVersion: string;
  /** Az elérhető verzió; üres, ha nem tudjuk. */
  newVersion: string;
  /** Kiadási jegyzet, ha a csatorna közölt ilyet. */
  notes: string;
  /** Magyar mondat: mi a helyzet, vagy mi a hiba. Mindig ki van töltve. */
  uzenet: string;
}

/** A frissítés letöltésének haladása. */
export interface UpdateProgress {
  receivedBytes: number;
  totalBytes: number;
  /** 0..1 */
  ratio: number;
  /** Bájt/másodperc, ahogy a letöltő méri; 0, ha nem tudjuk. */
  bytesPerSecond: number;
}

/** A „A programról" ablak adatai. */
export interface AppInfo {
  version: string;
  modelId: string;
  modelName: string;
  modelState: 'missing' | 'partial' | 'installed';
  /**
   * A ténylegesen betöltendő hálófájl neve — nem a beállított, hanem az, ami
   * tényleg futni fog. A betöltő szó nélkül a 8 bites változatra vált, ha a
   * pontos nincs a gépen, és a kettő nem egyformán pontos.
   */
  modelFile: string;
  /** A futtató neve emberi alakban, pl. „ONNX Runtime". */
  engine: string;
}

/** Egy sor a visszafejtett kulcsfájlból. */
export interface KeyEntry {
  original: string;
  pseudonym: string;
  /** Magyarul, megjelenítésre: „személy" vagy „szervezet". */
  kind: string;
}

/**
 * Melyik téma van érvényben. A főfolyamat NEM látja a lapot: a stíluslapot nem
 * tudja megkérdezni, tehát tippelnie kellene — ezért ezt az egy értéket a
 * felületnek kell megmondania.
 */
export type FeluletTema = 'vilagos' | 'sotet';

/**
 * A NATÍV ABLAKGOMBOK állapota: a kicsinyítés / teljes méret / bezárás gomb.
 *
 * Ezt a hármat nem mi rajzoljuk, hanem az Electron a lap FÖLÖTT. A párbeszédek
 * mögé húzott fátyol (`.overlay`, styles.css) ezért nem ér el odáig: a felület
 * elhalványul, a három gomb viszont világosan ott marad a jobb felső sarokban.
 * Ez az állapot mondja meg a főfolyamatnak, mikor kell őket vele EGYÜTT
 * halványítania.
 */
export interface AblakkeretAllapot {
  /** Van-e ÉPPEN nyitva modális párbeszéd — vagyis fátyol alatt van-e a lap. */
  halvanyitva: boolean;
  tema: FeluletTema;
}

interface SzivecskeApi {
  detectParties(): Promise<DetectionResult>;

  /**
   * A FUTÓ VIZSGÁLAT LEÁLLÍTÁSA.
   *
   * Egy hosszú iraton a modell percekig dolgozhat. Amíg ez nem volt meg, a
   * felhasználó ez alatt tehetetlen volt — és a leggyakoribb reakciója az volt,
   * hogy kilőtte az egész programot, a megnyitott irattal együtt.
   *
   * A hívás UTÁN a `detectParties` ígérete rendben teljesül, `megszakitva:
   * true` értékkel és a szerkezeti felismerés eredményével — tehát a felületnek
   * nem kell külön elvarrnia a futó hívást.
   *
   * Szándékosan `?`, ugyanazért, amiért a `getUiState`: egy régebbi híd nem
   * ismeri, és ilyenkor a Leállítás gombot meg sem szabad jeleníteni. Egy néma
   * gomb rosszabb, mint a hiánya.
   *
   * @returns volt-e mit leállítani; a hamis érték nem hiba, csak annyit
   * jelent, hogy a vizsgálat közben magától befejeződött
   */
  cancelDetect?(): Promise<boolean>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /**
   * A beállító oldal be- és kimenete. Szándékosan `?`: a fejlesztői álkimenet
   * és egy régi híd is működhet nélküle, és ilyenkor a program NEM kérdez — egy
   * meg nem jegyezhető választ újra és újra feltenni rosszabb, mint fel sem
   * tenni.
   */
  getUiState?(): Promise<UiState>;
  setUiState?(patch: {
    modeAsked?: boolean;
    iratBeallitas?: Partial<IratBeallitas>;
  }): Promise<UiState>;
  listModels(): Promise<ModelListResult>;
  downloadModel(id: string): Promise<ModelStatus[]>;
  cancelDownload(): Promise<void>;
  removeModel(id: string): Promise<ModelStatus[]>;
  onDownloadProgress(cb: (p: DownloadProgress) => void): () => void;
  /**
   * A vizsgálat haladása EGYETLEN MONDATBAN — pontosan a `DetectProgress.uzenet`.
   *
   * A munkalap tetején álló „elfoglalt” sor csak egy mondatot tud kiírni, és
   * annak nem kell tudnia a szakaszokról. Aki folyamatjelzőt rajzol, az
   * `onDetectProgress`-t vegye: a kettő ugyanabból a forrásból, ugyanabban a
   * pillanatban megy ki (electron/main.ts, `jelezdAHaladast`), tehát nem
   * csúszhatnak szét.
   */
  onDetectStatus(cb: (s: string) => void): () => void;

  /**
   * Ugyanaz, szakasszal és — ha értelmezhető — aránnyal.
   *
   * Szándékosan `?`: egy régebbi híd nem küldi, és ilyenkor a felületnek az
   * `onDetectStatus` mondatára kell visszaesnie, nem egy üres
   * folyamatjelzőre.
   */
  onDetectProgress?(cb: (p: DetectProgress) => void): () => void;
  listThemes(): Promise<ThemeSummaryUi[]>;

  /*
    SAJÁT NÉVKÉSZLET.

    A gyártás a főfolyamatban fut: ott lakik a modell, és ott van a ragozó
    motor. A felület a témát adja meg és a kész jelentést kapja vissza —
    jóváhagyás előtt, mert a modell a magyar ragozást nem tudja megbízhatóan.
  */
  generateTheme(temaSzoveg: string): Promise<TemaEredmeny>;
  /**
   * A LEGUTÓBB LEGYÁRTOTT készlet elmentése. Szándékosan nincs paramétere: a
   * felület nem adhat át kész témát, csak jóváhagyhatja azt, amit a program
   * maga állított elő és maga ellenőrzött. Egy felületről érkező témaobjektum
   * megkerülhetné az ellenőrzést, és onnantól ellenőrizetlen nevek kerülnének
   * az iratba.
   */
  saveGeneratedTheme(): Promise<ThemeSummaryUi[]>;
  removeCustomTheme(id: string): Promise<ThemeSummaryUi[]>;
  onThemeGenStatus(cb: (s: TemaGenStatus) => void): () => void;

  /*
    FRISSÍTÉS. A csatorna beállítása is itt van, nem a beállításfájlban: ez az
    egyetlen érték a programban, ami megmondja, hova csatlakozzon.
  */
  updateState(): Promise<UpdateState>;
  setUpdateFeed(url: string): Promise<UpdateState>;
  checkUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  /** Kilép és telepít. Csak `ready` állapotban van értelme. */
  installUpdate(): Promise<void>;
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
  chooseDocument(): Promise<string | null>;
  /**
   * IRAT MEGNYITÁSA — a meglévők mellé vagy helyettük.
   *
   * @param hozzaad igaz: ugyanahhoz az ügyhöz adja hozzá. Egy ügy iratai
   *   EGYÜTT mennek át az elemzésen, közös álnév-kiosztással — ugyanaz a
   *   valódi név mindegyik iratban ugyanazt a fedőnevet kapja.
   * @returns MINDEN betöltött irat leírója, betöltési sorrendben.
   */
  openDocument(path: string, hozzaad?: boolean): Promise<DocumentInfo[]>;
  /** Egy irat kivétele a listából; a visszatérés a maradék. */
  closeDocument?(path: string): Promise<DocumentInfo[]>;
  /** A betöltött iratok leírói — induláskor és a lista helyreállításához. */
  listDocuments?(): Promise<DocumentInfo[]>;
  resolveRevisions(mode: 'accept' | 'reject'): Promise<DocumentInfo[]>;
  analyze(input: AnalyzeInput): Promise<AnalysisResult>;
  /**
   * A BEZÁRÁS MEGERŐSÍTÉSE — a főfolyamat kérdez, a felület válaszol.
   *
   * A kérdést a program saját ablaka teszi fel, nem a Windows
   * rendszerpárbeszéde. A bezárás viszont a főfolyamaté marad: innen csak a
   * válasz megy vissza.
   *
   * Opcionális, mert egy RÉGEBBI hídon nincs meg. Olyankor a főfolyamat a
   * rendszerpárbeszédet nyitja ki, ahogy régen — a program tehát nem
   * bezárhatatlan, csak nem szép.
   */
  onConfirmClose?(cb: () => void): () => void;
  /**
   * NYUGTA a bezárási kérdésre: megkaptam, ki is rajzoltam.
   *
   * Küldd el, AMINT a kérdés a képernyőre került — a válasz előtt, attól
   * függetlenül. A főfolyamat ettől állítja le a tartalék-időzítőt, ami
   * különben a rendszerpárbeszédet nyitná ki a mi kérdésünk tetejére.
   *
   * Opcionális, mint a párja: egy régebbi hídon nincs meg. Olyankor a régi
   * viselkedés marad — a program bezárható, csak a tartalék hamarabb szólal
   * meg.
   */
  closeAsked?(): Promise<void>;
  closeDecision?(valasz: 'save' | 'discard' | 'cancel'): Promise<void>;
  /** Az álnevesített szöveg; útvonal nélkül az első betöltött iraté. */
  previewText(path?: string): Promise<string>;
  /**
   * AZ ÁLNEVESÍTETT IRAT LAPKÉPEI (PDF) — az előnézet valódi tördeléssel.
   *
   * A motor a KÉSZ kimeneti bájtokat rajzolja ki, tehát az előnézet nem
   * hasonlít a mentett fájlra: az. Üres `pages`: nincs lapkép (DOCX, TXT, vagy
   * hiányzik a natív rajzoló) — olyankor a `previewText` szövege marad.
   *
   * Opcionális, mert egy RÉGEBBI híd (és a böngészős fejlesztői álkimenet) nem
   * ismeri. Hiányában az előnézet a szöveges nézetre esik vissza — ugyanaz,
   * ami eddig volt.
   */
  previewPages?(path?: string): Promise<PreviewPages>;
  suggestOutputPath(mode: string): Promise<string>;
  chooseSaveTarget(suggested: string): Promise<string | null>;
  exportDocument(opts: ExportOptions): Promise<ExportResult>;
  showItemInFolder(path: string): Promise<void>;

  /**
   * Jelezd, ha van elveszíthető munka. Ettől kérdez rá a program a bezárásra
   * ahelyett, hogy szó nélkül eldobná az iratot és a döntéseket.
   */
  setDirty(dirty: boolean): Promise<void>;

  /**
   * Szólj, ha modális párbeszéd nyílt vagy zárult — a natív ablakgombok ettől
   * halványulnak el a felülettel EGYÜTT.
   *
   * MIKOR HÍVD: minden nyitáskor és záráskor, és a téma váltásakor is. Egymás
   * után nyíló párbeszédeknél nem kell számolgatni: a rövid „nincs párbeszéd”
   * pillanatokat a főfolyamat elnyeli, tehát a gombok nem villannak fel közben.
   *
   * SZÍNT NE KÜLDJ: a színtáblát a főfolyamat tartja (electron/main.ts,
   * `KERET_SZINEK` és `KERET_FATYOL`). Két helyen tartott színtábla
   * előbb-utóbb elcsúszik, és onnantól a sáv jobb széle más árnyalatú csíkként
   * válik le a fejléc többi részéről.
   *
   * Szándékosan `?`, ugyanazért, amiért a `cancelDetect`: egy régebbi híd nem
   * ismeri. Ha hiányzik, a felület minden mást ugyanúgy tud — csak a három
   * gomb marad világos a párbeszéd mögött.
   */
  ablakkeretetIgazit?(allapot: AblakkeretAllapot): Promise<void>;
  appInfo(): Promise<AppInfo>;
  /**
   * A ráejtett fájl útvonala.
   *
   * A böngésző `File` objektuma az Electron 32 óta NEM hordoz útvonalat (a
   * `File.path` mezőt eltávolították), a felület pedig nem lát fájlrendszert.
   * Ezért az útvonalat a hídnak kell megmondania — enélkül az ejtőmező csak
   * annyit tudna tenni, amit eddig tett: elejti a behúzott fájlt, és megnyitja
   * a tallózót. A visszatérés üres, ha a híd nem tudja feloldani.
   */
  pathForFile?(file: File): string | null;
  chooseKeyFile(): Promise<string | null>;
  readKeyFile(path: string, passphrase: string): Promise<KeyEntry[]>;
  print(): Promise<void>;
  /** Feliratkozás a menüre; a visszakapott függvény leiratkoztat. */
  onMenu(cb: (action: MenuAction) => void): () => void;
}

declare global {
  interface Window {
    szivecske: SzivecskeApi;
  }
}

/**
 * Az Electron minden IPC-hibát ezzel az előtaggal ad át a felületnek:
 * „Error invoking remote method 'doc:open': Error: …". A mondatot a főfolyamat
 * már magyarul fogalmazta meg — az előtag csak zaj a felhasználó szemében,
 * ezért itt leszedjük.
 */
const IPC_ELOTAG = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/;

function tisztaHiba(err: unknown): Error {
  const nyers = err instanceof Error ? err.message : String(err);
  return new Error(nyers.replace(IPC_ELOTAG, ''));
}

/**
 * A hidat futásidőben oldjuk fel, nem a modul betöltésekor: a böngészős
 * fejlesztői helyettesítő csak a modulok kiértékelése UTÁN települ.
 */
export const api: SzivecskeApi = new Proxy({} as SzivecskeApi, {
  get(_t, prop: string) {
    const bridge = window.szivecske;
    if (!bridge) throw new Error('A program hídja nem érhető el.');
    const tag = (bridge as unknown as Record<string, unknown>)[prop];
    if (typeof tag !== 'function') return tag;

    return (...args: unknown[]): unknown => {
      const eredmeny = (tag as (...a: unknown[]) => unknown)(...args);
      // Csak az ígéretet kísérjük tovább: az eseményfeliratkozók leiratkoztató
      // függvényt adnak vissza, azon nincs mit tisztítani.
      const igeret = eredmeny as { then?: unknown } | null;
      if (typeof igeret?.then !== 'function') return eredmeny;
      return Promise.resolve(eredmeny).catch((err: unknown) => {
        throw tisztaHiba(err);
      });
    };
  },
});
