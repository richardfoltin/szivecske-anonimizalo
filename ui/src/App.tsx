import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  // Ugyanazok a függvények, amikkel a motor a `outcomes` számhármast számolja
  // és a bal oldali nézet színez: a listán álló „mind / részben / nincs csere”
  // állapot és a jelmagyarázat ebből következik, nem külön tárolt adatból.
  matchKind,
  matchOutcome,
  type AnalysisResult,
  type MatchKind,
  type AppSettings,
  type DetectProgress,
  type DocumentInfo,
  type ExportResult,
  type IratBeallitas,
  type PartyInput,
  type DetectionResult,
  type ReplacementMode,
  type ThemeSummaryUi,
} from './api';
import { CastPanel, DocumentView, FAJTA_CIMKE, KIMENET_CIMKE, PreviewView } from './panels';
import {
  DocumentSetup,
  type DokumentumBeallitasok,
  type TalaltTetel,
  type VizsgalatAllapot,
} from './documentSetup';
import {
  AutoReportDialog,
  ExitDialog,
  ExportDialog,
  KeyFileDialog,
  LoadWarningsDialog,
  NewCaseDialog,
  OpenOtherDialog,
  PartiesDialog,
  RevisionsDialog,
  SajatKeszletDialog,
  ScannedDialog,
  UpdateDialog,
  emptyParty,
} from './dialogs';
import { devPreset } from './devMock';
import { SettingsDialog } from './settings';
/*
  AZ EMBLÉMA VEKTOROS, nem raszteres — és ez nem esztétikai finomkodás.

  A jel mozaikos szivecske: 11×11 kockás rács, az a kép, amit a tévében látni
  egy kitakart arcon. Ez egy anonimizáló programnál nem díszítés, hanem maga a
  mondanivaló. A rácsot viszont csak akkor lehet kivenni, ha a cellahatárok
  EGÉSZ képpontra esnek: az SVG-t ezért kizárólag 11 többszöröseiben szabad
  megjeleníteni (fejléc 22, nyitókép 33, „A programról" 88) — a méreteket a
  `ui/src/styles.css` rögzíti. Egy 64 képpontos PNG-t 22-re kicsinyítve a
  böngésző elsimítaná, és a szabályos rácsból pöttyös zaj lenne.
*/
import markUrl from '../assets/szivecske-mozaik.svg';

/*
  AMI ITT NINCS TÖBBÉ: a 'mode' és a 'modeChoice'.

  A csere módját a beállító oldal kártyás rácsa adja meg (ott áll a névkészlet
  is, ugyanabban a rácsban), a „kérdezés nélkül menjen végig" pedig már nem
  kapcsoló, hanem a találatlista fölötti „Mindent cserélünk" gomb. Mindkettő az
  irat beállítása, nem külön megállító kérdés. Amíg párbeszédként is léteztek,
  ugyanaz az érték két helyről volt állítható, és a megnyitás után két ablakon
  kellett átverekedni magát a felhasználónak, mielőtt egyetlen nevet is látott
  volna.

  A 'parties' MEGMARADT, de már nem a folyamat kötelező állomása: csak akkor
  nyílik ki, ha a felhasználó KÉRI (kézi névfelvitel a beállító lapról vagy a
  félbeszakadt vizsgálat képernyőjéről). A felismerés eredményét innentől a
  beállító oldal „Mit cserélünk?" füle mutatja.
*/
/*
  AMI EBBŐL IS KIKERÜLT: a 'theme'.

  A névkészletek kártyás rácsa külön ablak volt, a fejléc „Névkészletek…”
  gombjáról nyílt — miközben ugyanazt a készletet a beállító lap egy legördülőn
  is állította. Két hely, két kinézet, EGY döntés: a felhasználó az egyiken
  átállította, a másikon a régit látta. A rács innentől a beállító lap „Mire
  cseréljük?” füle, a legördülő pedig nincs többé.
*/
type Dialog =
  | 'parties'
  | 'export'
  | 'revisions'
  | 'settings'
  | 'scanned'
  // A megnyitáskor keletkezett figyelmeztetések. Nem az elemzés végén, hanem
  // ITT: ahol nem láttuk a szöveget, ott nevet sem találunk.
  | 'loadWarnings'
  | 'newCase'
  // A „Másik irat" ág megerősítése — ez is eldobja a felvitt feleket és a
  // meghozott döntéseket, ezért ugyanúgy kérdeznie kell, ahogy az „Új ügy".
  | 'openOther'
  | 'keyfile'
  // Amiről a program döntött ember helyett — mentés ELŐTT is előhívhatóan.
  | 'autoReport'
  // Saját névkészlet gyártása a felhasználó által beírt témából.
  | 'sajatKeszlet'
  // Frissítés keresése — a Súgó menüből.
  | 'update'
  /*
    A BEZÁRÁS MEGERŐSÍTÉSE — a főfolyamat kérdésére nyílik, nem gombra.

    A többi ablaktól abban különbözik, hogy NEM a felhasználó kattintására
    jelenik meg, hanem az ablak bezárási kísérletére: a főfolyamat kérdez
    (`onConfirmClose`), és a válaszra vár. Ezért nem szabad más ablaknak
    fölülírnia, és a bezárása is válasz — az elnyelt „Mégse" a főfolyamatot
    örökre várakozásban hagyná.
  */
  | 'exit'
  | null;

/*
  A `ModalisKeretHid` TÍPUS INNEN KIKERÜLT.

  Egy `setModalOpen` nevű hídpontot írt le, ami SOHA NEM LÉTEZETT: a hídon
  `ablakkeretetIgazit` néven áll ugyanez (electron/preload.ts). A típus
  egyetlen dolgot csinált — meggyőzte az olvasót arról, hogy a hívás rendben
  van —, és a fordító sem szólhatott, mert a felület egy `as unknown as`
  átminősítéssel jutott el hozzá. Ma a hívás a `SzivecskeApi` valódi, gépelt
  pontjára megy: ha az elnevezés megváltozik, fordítási hiba lesz belőle, nem
  néma tétlenség.
*/

/** Melyik szöveget nézi a felhasználó: az eredetit vagy a kimenetet. */
type View = 'source' | 'preview';

/**
 * A FŐ KÉPERNYŐ ÁLLOMÁSAI — megnyitás után.
 *
 * A folyamat egyirányú: vizsgálat → beállítás → munka. Azért állapot és nem
 * levezetett érték (pl. „van-e elemzés"), mert a három állomás közül kettőn is
 * lehet kész elemzés: a beállító lap már számol, hogy a „Mit cserélünk?" fülnek
 * legyen mit mutatnia. Levezetve a felhasználó a beállító lapról az első
 * újraszámolás pillanatában átugrana a munkalapra.
 */
type Fazis = 'vizsgalat' | 'beallitas' | 'munka';

/**
 * A vizsgálat képernyőjének három állása.
 *
 *  - 'nyit' a fájl beolvasása még tart — ez az ELSŐ dolog, amit a felhasználó
 *           lát a megnyitás után. Régen a helyén egy teljes képernyős „elfoglalt"
 *           réteg állt, majd eltűnt, és a helyére ez a képernyő lépett a saját
 *           folyamatjelzőjével: a felhasználó két külön betöltést látott egymás
 *           után ugyanarra az egy műveletre. Egy képernyő, két szakasszal.
 *  - 'var'  még nem indult el: blokkoló kérdés (változáskövetés, szkennelt
 *           irat, betöltési figyelmeztetés) áll előtte. Ez a képernyő
 *           kattintható kiutat ad arra az esetre, ha a felhasználó a kérdést
 *           válasz nélkül zárja be — enélkül üres képernyőn ragadna.
 *  - 'fut'  megy; ilyenkor van folyamatjelző és Leállítás gomb
 *  - 'allt' véget ért, de nem sikerrel: megszakították vagy hibára futott
 *
 * A sikeres befejezésnek nincs állása, mert nem is állomás: onnan a program
 * magától lép tovább a beállító oldalra.
 */
type VizsgalatKep = 'nyit' | 'var' | 'fut' | 'allt';

/** Ha nincs mentett érték, ezzel a küszöbbel indulunk (src/app/settings.ts). */
const DEFAULT_THRESHOLD = 0.8;

/** Amit meg tudunk nyitni. A ráejtett fájlt ezen szűrjük. */
const OPENABLE = /\.(pdf|docx|txt)$/i;

/**
 * A nyomtatás a KÉPERNYŐ tartalmát viszi papírra, ezért meg kell várni, amíg a
 * React kirajzolta az előnézetet. Egyetlen képkocka nem elég: az elsőnél a
 * böngésző még a régi fát méri, a második után viszont már a friss kép áll.
 */
function kovetkezoKep(): Promise<void> {
  return new Promise((resolve) => {
    // Takart vagy tálcára tett ablakban a képkocka-visszahívás elmaradhat —
    // ilyenkor a nyomtatás sosem indulna el. Az időzítő ezért nem tartalék
    // ízlésből: enélkül a funkció némán nem csinálna semmit.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    setTimeout(resolve, 120);
  });
}

/**
 * A Beállítások fülei — a `settings.tsx` `Tab` típusával egyezően.
 *
 * NINCS köztük „Alapértelmezések": ami ott állt, az iratonként más lehet, és
 * átkerült a megnyitás utáni beállító oldalra.
 */
type SettingsTab = 'models' | 'what' | 'about';

/**
 * A menü akcióinak típusát a hídtól vesszük át, nem írjuk le másodszor: így
 * fordítási hiba lesz belőle, ha a menü új pontot kap, és itt elfelejtjük
 * lekezelni.
 */
type MenuAction = Parameters<Parameters<typeof api.onMenu>[0]>[0];

const MODE_LABEL: Record<ReplacementMode, string> = {
  theme: 'Fedőnevek',
  role: 'Hivatalos (OBH)',
  type: 'Adatfajta neve',
  numbered: 'Számozott címke',
};

/**
 * A modell állapota a FEJLÉCBEN — csak akkor, ha nem futott.
 *
 * Eddig a lépéssávban állt, vagyis CSAK a munkalapon látszott: aki a beállító
 * lapon nézte át a találatokat, semmit nem tudott arról, hogy a lista azért
 * ilyen rövid, mert a nyelvi modell el sem indult. A fejléc mindhárom
 * állomáson ott van (vizsgálat, beállítás, munka), ezért a jelzés innentől
 * végig kint marad — és oda visz, ahol a teendő is elvégezhető.
 */
const MODEL_CHIP: Record<'off' | 'missing' | 'failed', { t: string; title: string; loud: boolean }> =
  {
    off: {
      t: '◈ Modell: kikapcsolva',
      title:
        'A nyelvi modell ki van kapcsolva, ezért csak a szerkezeti minták találtak feleket: a folyó szövegben elszórt nevekre nem kerestünk rá. Kattints: itt olvasható, mit jelent ez, és mit tehetsz.',
      loud: false,
    },
    missing: {
      t: '◈ Modell: hiányzik',
      title:
        'A nyelvi modell nincs telepítve, ezért csak a szerkezeti minták találtak feleket: a folyó szövegben elszórt nevekre nem kerestünk rá. Kattints: itt lehet letölteni.',
      loud: false,
    },
    failed: {
      t: '◈ Modell: hiba',
      title:
        'A nyelvi modell hibára futott, ezért csak a szerkezeti minták találtak feleket. Ezt az iratot ne fogadd el anonimizáltként, amíg a modell újra le nem futott. Kattints a részletekért.',
      loud: true,
    },
  };

/**
 * A FEJLÉC IKONJAI — TABLER ICONS, beágyazva.
 *
 * Korábban kézzel rajzolt útvonalak álltak itt, azzal az indoklással, hogy egy
 * offline programba nem hozunk be ikoncsomagot. Az indoklás fele igaz maradt —
 * CSOMAGOT tényleg nem hozunk be, se betűkészletet, se React-komponenskönyvtárat,
 * se hálózati hivatkozást —, a következtetés viszont rossz volt: a saját rajz
 * kimérten esetlen lett, és a felhasználó ezt szóvá is tette.
 *
 * A megoldás a kettő között van: a Tabler Icons (MIT) hivatalos útvonaladatai,
 * BEMÁSOLVA. A programba így hét útvonal kerül be, nem egy csomag; a kötegelés
 * mérete nem változik, futásidejű függőség nem keletkezik, és a rajz mégis
 * olyan, amilyennek egy program ikonjának lennie kell.
 *
 * AZ ADAT HITELES, nem emlékezetből: a @tabler/icons 3.46.0 `icons/outline`
 * mappájából származik (unpkg), ikononként egyenként letöltve. A licenc MIT,
 * feltüntetve a `docs/licencek.md` fájlban.
 *
 * A 24×24-es rajzvászon és a 2-es vonalvastagság a Tabler sajátja — ha ezt
 * átírnánk 16×16-ra, az útvonalak arányai romlanának el. A megjelenítési méretet
 * a CSS adja (`.btnikon`), nem a `viewBox`.
 *
 * A rajz `currentColor`-ral megy, tehát a gomb színét örökli — így a letiltott
 * állapot áttetszősége és a lebegtetés is magától érvényesül rá.
 *
 * `aria-hidden`: az ikon díszítés, a jelentést a gomb `aria-label`-je hordozza.
 * Enélkül a képernyőolvasó a rajzot is bejelentené a felirat mellé.
 */
type IkonNev =
  | 'megnyitas'
  | 'mentes'
  | 'iratbeallitas'
  | 'ujugy'
  | 'programbeallitas'
  | 'dontottunk'
  | 'figyelem';

/** A Tabler-útvonalak ikononként, pontosan úgy, ahogy az eredeti SVG-ben állnak. */
const IKON_UTVONALAK: Record<IkonNev, string[]> = {
  // tabler: folder-open
  megnyitas: [
    'M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2',
  ],
  // tabler: device-floppy
  mentes: [
    'M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2',
    'M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M14 4l0 4l-6 0l0 -4',
  ],
  // tabler: adjustments — az EBBEN AZ IRATBAN érvényes beállítások
  iratbeallitas: [
    'M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M6 4v4',
    'M6 12v8',
    'M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M12 4v10',
    'M12 18v2',
    'M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M18 4v1',
    'M18 9v11',
  ],
  // tabler: sparkles
  ujugy: [
    'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6',
  ],
  // tabler: settings — a PROGRAM beállításai (modellek, névjegy)
  programbeallitas: [
    'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065',
    'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  ],
  // tabler: eye-check — amit a program ember helyett nézett át
  dontottunk: [
    'M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M11.102 17.957c-3.204 -.307 -5.904 -2.294 -8.102 -5.957c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6a19.5 19.5 0 0 1 -.663 1.032',
    'M15 19l2 2l4 -4',
  ],
  // tabler: alert-triangle
  figyelem: [
    'M12 9v4',
    'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0',
    'M12 16h.01',
  ],
};

function FejlecIkon({ nev }: { nev: IkonNev }) {
  return (
    <svg
      className="btnikon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {IKON_UTVONALAK[nev].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Ha nincs mentett beállítás, ezzel indulunk. */
const DEFAULT_THEME = 'kokorszak';

/**
 * Az ügyazonosító titok dönti el, melyik valódi név melyik álnevet kapja. Egy
 * ügy több iratán át SZÁNDÉKOSAN ugyanaz — így a felperes mindenhol ugyanaz a
 * fedőnév marad. Két külön ügy között viszont új titok kell, különben az azonos
 * álnév összeköti a két iratot.
 */
function newCaseSecret(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Ismeri-e a híd a vizsgálat leállítását.
 *
 * Egy régebbi hídon nincs `cancelDetect`, és ilyenkor a Leállítás gombot MEG SEM
 * SZABAD jeleníteni: egy gomb, ami szó szerint nem csinál semmit, rosszabb,
 * mint a hiánya — a felhasználó azt hiszi, megnyomta, és tovább vár.
 * A hídhoz nyúlás önmagában is elszállhat (nincs beinjektálva), ezért a kérdés
 * nem maradhat védtelen: ilyenkor a válasz „nem".
 */
function vanLeallitas(): boolean {
  try {
    return typeof api.cancelDetect === 'function';
  } catch {
    return false;
  }
}

/** A felismerés extra mezőit leválasztjuk: a motor csak a szerkesztett felet kapja. */
function stripDetection(p: DetectionResult["parties"][number]) {
  const { confidence, evidence, occurrences, ...rest } = p;
  void confidence;
  void evidence;
  void occurrences;
  return rest;
}

export default function App() {
  const [themes, setThemes] = useState<ThemeSummaryUi[]>([]);
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [parties, setParties] = useState<PartyInput[]>([]);
  const [themeId, setThemeId] = useState(DEFAULT_THEME);
  const [mode, setMode] = useState<ReplacementMode>('theme');
  /**
   * Készüljön-e visszafejtő kulcsfájl EBBEN AZ IRATBAN.
   *
   * Korábban „alapértelmezés" volt a Beállításokból; ma a beállító lap egyik
   * kapcsolója. A mentés ablaka ezt az értéket kapja induló állásnak.
   */
  const [keepKey, setKeepKey] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);
  const [decisions, setDecisions] = useState<Record<number, 'accept' | 'skip'>>({});
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  /**
   * Hol tart a folyamat. Csak megnyitott irat mellett számít; irat nélkül a
   * nyitóképernyő áll a helyén.
   *
   * A kezdőérték azért 'munka', mert a fejlesztői belépő (`?dev=…`) kész
   * elemzéssel indít: ha 'vizsgalat'-ról indulnánk, a felület átnézése előtt
   * végig kellene nézni egy vizsgálatot, ami el sem indult.
   */
  const [fazis, setFazis] = useState<Fazis>('munka');
  const [vizsgalatKep, setVizsgalatKep] = useState<VizsgalatKep>('var');
  /**
   * A MEGNYITÁS ALATT ÁLLÓ FÁJL NEVE — amíg a motor még nem adta vissza az iratot.
   *
   * Enélkül a beolvasás ideje alatt nem volna mit mutatni: a `doc` még `null`,
   * tehát a nyitóképernyő állna a helyén, és a vizsgálat képernyője csak
   * utána jelenne meg. Pont ez okozta a két egymás utáni betöltést. A név a
   * megnyitandó útvonalból jön, tehát az első pillanattól kiírható.
   */
  const [nyitandoNev, setNyitandoNev] = useState<string | null>(null);
  /**
   * Hogyan végződött a legutóbbi vizsgálat — ezt viszi tovább a beállító lap.
   *
   * A „nem talált semmit" és a „megszakították" a képernyőn ugyanúgy üres
   * listának látszik, csak az egyik jelenti azt, hogy az iratban tényleg
   * nincs név. Ezért nem elég a találatok darabszáma.
   */
  const [vizsgalat, setVizsgalat] = useState<VizsgalatAllapot>('kihagyva');
  /**
   * A vizsgálat haladása. `null`: nem tudunk róla semmit — ilyenkor pörgő jár,
   * nem 0%-os csík. Egy nullán álló folyamatjelzőből a felhasználó azt olvassa
   * ki, hogy a program megállt.
   */
  const [haladas, setHaladas] = useState<DetectProgress | null>(null);
  /**
   * Megjeleníthető-e a Leállítás gomb.
   *
   * KÉT feltétele van, és mindkettő változik: a híd ismerje a `cancelDetect`-et
   * (régebbi hídon nem), ÉS éppen tartson a felismerés. Az összesítés alatt a
   * gomb már nem szakítana meg semmit — egy néma gomb rosszabb, mint a hiánya.
   */
  const [leallithato, setLeallithato] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  // A Beállításokat a kézi névfelvitelből és a saját készlet gyártásából is meg
  // lehet nyitni; onnan oda kell visszatérni, különben a felhasználó a semmiben
  // találja magát azután, hogy letöltötte, amiért odaküldtük.
  const [settingsBack, setSettingsBack] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectionResult | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  /**
   * A megtalált hivatalos azonosítók, felületi alakban.
   *
   * KÜLÖN a `parties`-tól, mert a felületen is külön rovat való nekik: egy
   * adószámnak nincs neme és nincs eljárási szerepe. Az elemzésnek viszont
   * EGYÜTT megy át a kettő, mert a motor a `parties` listából tudja meg, hogy
   * egy azonosítót a felhasználó kikapcsolt (`skipped`). Ha itt nem küldenénk
   * vissza őket, a pipa a képernyőn átbillenne, a motor pedig változatlanul
   * kicserélné mindet — a `foundIdentifierParties` (src/app/session.ts) magától
   * felveszi az összes megtalált azonosítót.
   */
  const [identifiers, setIdentifiers] = useState<PartyInput[]>([]);
  /**
   * A megerősítésre váró megnyitás: `path` a ráejtett irat útvonala, `null`
   * pedig azt jelenti, hogy tallózni kell. Azért állapot, mert a kérdés és a
   * művelet két külön kattintás — enélkül a felhasználó behúzott irata a
   * párbeszéd megnyitásával elveszne.
   */
  const [pendingOpen, setPendingOpen] = useState<{ path: string | null } | null>(null);
  const [hasWork, setHasWork] = useState(false);
  /**
   * Hozott-e a felhasználó SAJÁT döntést ezen az iraton.
   *
   * Nem ugyanaz, mint a `hasWork`: az a kilépés-védelemé, és a megnyitástól
   * igaz. Ez azt a kérdést dönti el, hogy egy másik irat megnyitása előtt van-e
   * mit elveszíteni — vagyis nyúlt-e valamihez a felhasználó, vagy csak a
   * program dolgozott helyette. A puszta megnyitás egy kattintással
   * megismételhető; egy kézzel felvitt név vagy kikapcsolt csere nem.
   */
  const [sajatDontes, setSajatDontes] = useState(false);
  const [caseSecret, setCaseSecret] = useState(newCaseSecret);
  const [view, setView] = useState<View>('source');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Mentés után ezzel nyílik a kulcsfájl-ablak: a most készült fájlt ne kelljen
  // újra megkeresni a tallózóban.
  const [keyFilePath, setKeyFilePath] = useState<string | null>(null);
  /**
   * A három motorbeállítás a felületen él, mert az elemzés bemenetén kell
   * átmennie: a munkamenet szándékosan nem olvas beállításfájlt. Ha itt nem
   * tartanánk számon, a Beállítások csúszkája és két kapcsolója némán
   * hatástalan maradna.
   */
  const [autoThreshold, setAutoThreshold] = useState<number | undefined>(undefined);
  const [replaceAmounts, setReplaceAmounts] = useState(false);
  const [shiftDates, setShiftDates] = useState(false);
  /**
   * A CÍMKÉK NYELVE a szerep-, adatfajta- és számozott módban.
   *
   * Ugyanúgy a felületen él, mint a fenti három: a munkamenet nem olvas
   * beállításfájlt, tehát az elemzés bemenetén kell átmennie. Ha itt nem
   * tartanánk számon, a kártyán bekapcsolt „angol" némán hatástalan maradna, és
   * a felhasználó magyar címkékkel adná ki az iratot.
   */
  const [labelLang, setLabelLang] = useState<'hu' | 'en'>('hu');
  /**
   * Lecseréljük-e a törvény szerint bent maradó neveket is (Bszi. 166. § (2)).
   *
   * SZÁNDÉKOSAN NEM KERÜL A MENTETT BEÁLLÍTÁSOK KÖZÉ, és minden irat
   * kikapcsolva indul. Egy jogszabályi következménnyel járó kapcsolót nem
   * szabad csendben átvinni a következő iratra: aki egyszer egy belső
   * feljegyzéshez bekapcsolta, holnap egy bíróságra menő határozatot nyitna meg
   * vele — és semmi nem szólna róla.
   */
  const [replaceOfficials, setReplaceOfficials] = useState(false);
  /**
   * A BEÁLLÍTOTT út: kérdezés nélkül menjen-e végig a program az iraton.
   *
   * Ez az alapállás, amivel minden új irat indul. A mentett beállításig
   * `false`-ról indulunk, mert a betöltés a program indulása után egy körrel
   * fejeződik be: ha addig `true` állna itt, egy villámgyorsan megnyitott irat
   * kérdezés nélkül futna végig azon a gépen is, ahol a felhasználó épp az
   * ellenkezőjét állította be.
   */
  const [autoMode, setAutoMode] = useState(false);
  /**
   * AZ ÉPPEN NYITOTT IRAT útja — külön a beállítástól.
   *
   * Ettől lehet visszaút: a mentés utáni jelentésből egy kattintással át lehet
   * váltani az átnézős útra ugyanezen az iraton, anélkül hogy ez a felhasználó
   * tartós beállítását átírná. A megnyitás mindig a beállításból indítja.
   */
  const [autoModeForDoc, setAutoModeForDoc] = useState(false);
  /**
   * ÚJRASZÁMOLÁSI KÉRÉS — számláló, nem logikai érték.
   *
   * Aki a beállító lapon elmozdítja a küszöb csúszkáját, egyetlen mozdulattal
   * tíz értéket ír be. Ha mindegyik azonnal elemzést indítana, a lap
   * másodpercenként többször írná át a „Mit cserélünk?" fül csereszövegeit, és a
   * gép a mozdulat végén még mindig a második lépésnél tartana. Ezért a
   * változás nem futtat, hanem KÉR: a lenti figyelő gyűjti össze a kéréseket,
   * és egy rövid szünet után egyetlen számolást indít.
   *
   * Számláló, mert ugyanaz a kérés kétszer is jöhet (ugyanarra az értékre
   * visszaállítva), és a másodiknak ugyanúgy le kell futnia.
   */
  const [ujraszamolas, setUjraszamolas] = useState(0);
  const ujraKert = useCallback(() => setUjraszamolas((n) => n + 1), []);
  /**
   * A KÉZZEL FELVITT NEVEK, amíg az új vizsgálat fut.
   *
   * Referencia, nem állapot: a vizsgálat elindításának pillanatában olvassuk ki
   * és a végén használjuk fel, közben a `parties` már a friss listára cserélődik.
   * Állapotban tartva a `startScan` a saját indulásakor érvényes — vagyis üres —
   * másolatot látná.
   */
  const keziekRef = useRef<PartyInput[]>([]);
  /**
   * A LEGUTOLSÓ VIZSGÁLAT SORSZÁMA.
   *
   * Egy vizsgálat percekig futhat, és közben a felhasználó nyithat másik iratot
   * vagy indíthat újat. A régi kérés ígérete ilyenkor is teljesül — és ha nem
   * néznénk meg, kinek szólt, a MÁSIK irat találatlistáját írná felül a
   * korábbié. A név ugyanaz maradna a képernyőn, csak épp nem abban az iratban
   * szerepel, ami nyitva van.
   */
  const vizsgalatSzamRef = useRef(0);
  /**
   * Melyik névhez MI lenne a program saját csereszövege.
   *
   * A `CastRow.replacement` a kézi átírást tartalmazza, ha van ilyen — abból
   * tehát nem derül ki, mihez tér vissza a felhasználó, ha meggondolja magát.
   * Ezért az utolsó, még kézzel nem bántott értéket megjegyezzük.
   */
  const alapCsereRef = useRef<Map<string, string>>(new Map());
  /**
   * Az átnézős útra váltás jelzése a találatpanelnek: ugorjon az „Átnézésre
   * vár” fülre. Számláló, nem logikai érték — ugyanaz a kérés kétszer is
   * jöhet, és a második ugyanúgy oda kell vigyen.
   */
  const [reviewFocus, setReviewFocus] = useState(0);
  /**
   * A FELISMERŐ MODELL hiánya — a program INDULÁSÁTÓL látszik.
   *
   * A modell nem a telepítővel érkezik: a felhasználó tölti le a
   * Beállításokban. Amíg nincs meg, a program elindul és dolgozik, de a
   * neveket csak a szerkezeti jelekből („Felperes:”, „anyja neve:”, cégforma)
   * találja meg — a folyó szövegben elszórt nevekre nem keres rá. Ez nem
   * lábjegyzet: egy kitakaró programnál ez a különbség maga a kockázat.
   *
   * A lépéssáv jelzése (`MODEL_CHIP`) ehhez kevés volt: az csak MEGNYITOTT
   * irat mellett, a felismerés LEFUTÁSA után jelenik meg. Aki most indította
   * el a programot, semmit nem látott belőle — pedig épp ilyenkor van ideje
   * letölteni.
   *
   * `null`, amíg nem tudjuk: ilyenkor nem állítunk semmit.
   */
  const [modellHiany, setModellHiany] = useState<{ nev: string; hianyzik: boolean } | null>(null);

  const runAnalysis = useCallback(
    async (
      p: PartyInput[],
      t: string,
      m: ReplacementMode,
      d: Record<number, 'accept' | 'skip'>,
      /**
       * Az azonosítók. Külön paraméter, mert a kézi névfelvitel MENTÉSKOR adja
       * át a friss listát, és az állapot addigra még nem íródott ki — a
       * `setIdentifiers` utáni olvasat a régi értéket adná vissza, tehát a
       * felhasználó imént kikapcsolt azonosítója ugyanabban a körben még
       * kicserélődne.
       */
      ids: PartyInput[] = identifiers,
      /**
       * Fogadja-e el a program a bizonytalan találatokat is. Külön paraméter
       * ugyanabból az okból, mint az azonosítók: a mód váltása és az elemzés
       * ugyanabban a kattintásban történik, és az állapot addigra még nem
       * íródott ki — az imént választott út tehát a következő körre csúszna át.
       */
      accept: boolean = autoModeForDoc,
      /**
       * A törvény szerint megtartandó nevek (Bszi. 166. § (2)). Külön paraméter
       * ugyanabból az okból, mint az azonosítók és a mód: a felismerés
       * eredménye és az elemzés ugyanabban a kattintásban történik, a
       * `setDetected` utáni olvasat tehát még a KORÁBBI irat listáját adná.
       */
      keep: string[] = detected?.keepList.map((k) => k.name) ?? [],
      /**
       * FÁTYOL NÉLKÜL fusson-e.
       *
       * A beállító lapon minden kapcsolóállás új elemzést igényel — a „Mit
       * talált?" fülön a csereszövegek a módtól és a névkészlettől függenek.
       * Ha ezek mindegyike fölhúzná a teljes képernyős „elfoglalt" réteget, a
       * lap minden kattintásra kétszer villanna, és a felhasználó a saját
       * kapcsolóját sem látná átbillenni. A vizsgálat képernyője ugyanezért
       * csendes: ott a saját folyamatjelzője mondja el, mi történik.
       *
       * Ahol a felhasználó KIFEJEZETTEN várakozásra számít — mentés előtti
       * csere, visszaváltás az átnézős útra —, ott marad a fátyol: ott a
       * mozdulatlan képernyő azt jelentené, hogy nem történt semmi.
       */
      csendes = false,
      /*
        A VISSZATÉRÉS az elemzés eredménye, `null`, ha nem született.

        A kérdezés nélküli út ezen dől el: elemzés nélkül nincs mit menteni, és
        a mentés ablakát fölnyitni egy meghiúsult elemzés után azt jelentené,
        hogy a felhasználó egy érintetlen iratot ment el álnevesítettként.
      */
    ): Promise<AnalysisResult | null> => {
      /*
        A HIVATALOS SZEREPLŐK BEFŰZÉSE ITT TÖRTÉNIK, EGY HELYEN.

        A `runAnalysis`-t öt helyről hívjuk, és mindegyik a saját féllistáját
        adja át. Ha a befűzést a hívókra bíznánk, elég egyetlen helyen
        elfelejteni, és a felhasználó bekapcsolva hagyná a kapcsolót, miközben a
        bíró neve változatlanul bent marad — láthatatlanul, mert a képernyőn a
        kapcsoló bekapcsolva áll.

        Amit a hívó KIFEJEZETTEN átadott, azt nem duplázzuk: ha egy hivatalos
        szereplő már a `p` listában van (mert a felhasználó átírta a
        csereszövegét), az ő sora az erősebb.
      */
      const megvan = new Set(p.map((x) => x.id));
      const hivatalosak = replaceOfficials
        ? (detected?.officials ?? []).filter((o) => !megvan.has(o.id)).map(stripDetection)
        : [];
      const felek = [...p, ...hivatalosak];
      if (felek.length === 0) return null;
      if (!csendes) setBusy(accept ? 'Keresés és csere az iratban…' : 'Keresés az iratban…');
      try {
        const res = await api.analyze({
          parties: [...felek, ...ids],
          themeId: t,
          mode: m,
          caseSecret,
          decisions: d,
          ...(autoThreshold === undefined ? {} : { autoThreshold }),
          labelLang,
          replaceAmounts,
          shiftDates,
          acceptReview: accept,
          /*
            A MEGTARTANDÓ LISTA ÜRES, ha a felhasználó ezeket is cserélteti.

            Nem kozmetika: az ellenőrző kör ebből tudja, mely nevek maradhatnak
            jogosan a kimenetben. Ha a bíró neve a megtartandók közt maradna,
            miközben cserélni akarjuk, a mentés utáni ellenőrzés éppen azt a
            szivárgást nem venné észre, amit a felhasználó megszüntetni kért.
          */
          keepList: replaceOfficials ? [] : keep,
        });
        setAnalysis(res);
        // Az előnézet az ELŐZŐ elemzésé volt: eldobjuk. Nem az `analysis`
        // változására figyelünk, mert az azonosság szerint dönt — egy
        // változatlan eredményobjektum mellett a képernyőn a döntés előtti
        // kimenet maradna, és a felhasználó azt hinné, hogy a döntése nem
        // érvényesült.
        setPreview(null);
        setPreviewError(null);
        return res;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        // Csak azt a fátylat vesszük le, amit MI húztunk föl: egy csendes
        // futás közben elindított másik művelet jelzését elnyelni azt
        // jelentené, hogy a felhasználó egy dolgozó programot lát tétlennek.
        if (!csendes) setBusy(null);
      }
    },
    [
      caseSecret,
      autoThreshold,
      labelLang,
      replaceAmounts,
      replaceOfficials,
      shiftDates,
      identifiers,
      autoModeForDoc,
      detected,
    ],
  );

  /**
   * A VIZSGÁLAT — a megnyitás után magától indul.
   *
   * A felhasználó kikötése az volt, hogy ne kelljen a tulajdonneveket
   * begépelnie: ezért a program előbb végigolvassa az iratot, és a beállító lap
   * már kitöltött találatlistával nyílik meg. Amíg tart, a saját képernyője
   * mutatja, hol jár, és le lehet állítani.
   *
   * A SIKERES VIZSGÁLAT UTÁN MÉG NEM LÉPÜNK TOVÁBB azonnal: itt fut le az első
   * elemzés is. Nem azért, mert a beállító lapnak kész adat kellene — az első
   * füle enélkül is használható volna —, hanem mert a „Mit cserélünk?" fül ÜRES
   * listája nem különböztethető meg a „nem találtunk semmit" esettől: a lap a
   * vizsgálat állapotából olvassa ki, mit írjon a lista helyére, és a „még
   * számolunk" nincs az állapotai között. Fél másodpercig azt állítani, hogy az
   * irat nem tartalmaz nevet, pontosan az a hazugság, ami ellen ez a program
   * készült.
   *
   * @param autoOverride Az ehhez az irathoz tartozó út. Azért paraméter, mert a
   *   megnyitás és a vizsgálat indítása ugyanabban a kattintásban történik: az
   *   állapotból olvasva még az ELŐZŐ irat útja jönne vissza.
   */
  const startScan = useCallback(
    async (autoOverride?: boolean) => {
      const auto = autoOverride ?? autoModeForDoc;
      // Ez a vizsgálat sorszáma. Minden `await` után megnézzük, hogy még
      // mindig ez-e a legutolsó: ha közben másik irat nyílt meg, a mi
      // eredményünk már nem erre az iratra vonatkozik.
      const sorszam = ++vizsgalatSzamRef.current;
      const elavult = (): boolean => vizsgalatSzamRef.current !== sorszam;
      setAutoModeForDoc(auto);
      setDetectError(null);
      setHaladas(null);
      setFazis('vizsgalat');

      if (!autoDetect) {
        // Kikapcsolt felismerés: nincs mit megvárni. A beállító lap kinyílik, a
        // „Mit cserélünk?" fül pedig kimondja, hogy a program egyetlen nevet sem
        // keresett — és ott van mellette a kézi felvitel gombja. Az „egy
        // kattintás nélkül" ígéret a FELISMERÉSRE épül; kikapcsolva nem az út
        // vész el, csak a kiindulópontja.
        setDetected(null);
        // A kézzel felvitt nevek itt is megmaradnak: a felismerés kikapcsolása
        // nem azt jelenti, hogy a felhasználó munkája elévült.
        setParties(keziekRef.current);
        keziekRef.current = [];
        setIdentifiers([]);
        setVizsgalat('kihagyva');
        setVizsgalatKep('var');
        setFazis('beallitas');
        return;
      }

      setVizsgalatKep('fut');
      // A Leállítás gomb CSAK akkor jelenik meg, ha a híd ismeri a műveletet.
      setLeallithato(vanLeallitas());

      let res: DetectionResult | null = null;
      try {
        res = await api.detectParties();
        if (elavult()) return;
      } catch (e) {
        if (elavult()) return;
        // A felismerés kényelmi funkció: a kézi felvitel nélküle is működik.
        // Ezért a hiba nem zsákutca, hanem a vizsgálat képernyőjének harmadik
        // állása — onnan újra lehet indítani, vagy kézzel felvinni a neveket.
        setDetected(null);
        setParties([]);
        setIdentifiers([]);
        setDetectError((e as Error).message);
        setVizsgalat('hiba');
        setVizsgalatKep('allt');
        setLeallithato(false);
        return;
      }
      setLeallithato(false);
      setDetected(res);
      const talalt = res.parties.map(stripDetection);
      /*
        AMIT A FELHASZNÁLÓ KÉZZEL VITT FEL, AZT AZ ÚJ VIZSGÁLAT NEM TÖRLI.

        Az újraindítás tipikus oka éppen az, hogy az előző félbemaradt, és a
        felhasználó közben pótolta, ami hiányzott. Ha a friss lista némán
        fölülírná a kézi sorokat, a második vizsgálat ROSSZABB iratot adna, mint
        az első — és semmi nem szólna róla. Névazonosság esetén a felismerésé az
        elsőbbség: két azonos nevű fél két külön álnevet kapna.
      */
      const nevek = new Set(talalt.map((f) => f.fullName.trim().toLocaleLowerCase('hu')));
      const keziek = keziekRef.current.filter(
        (k) => !nevek.has(k.fullName.trim().toLocaleLowerCase('hu')),
      );
      keziekRef.current = [];
      const felek = [...talalt, ...keziek];
      // Az azonosítók alapból BE vannak kapcsolva: a motor magától is
      // kicserélné mindet, tehát az alapállásnak ugyanazt kell mutatnia, amit a
      // program tenne. A kikapcsolás a felhasználó tudatos döntése.
      const ids = res.identifiers.map(stripDetection);
      setParties(felek);
      setIdentifiers(ids);
      setDecisions({});
      setHasWork(true);

      /*
        A LEÁLLÍTOTT VIZSGÁLAT UTÁN IS SZÁMOLUNK.

        A leállított vizsgálat nem üres kézzel tér vissza: a szerkezeti
        felismerés lefutott, a rovatokból és a cégformákból előkerült nevek
        megvannak. Ha ezekre nem futna le az elemzés, a beállító lap „Mit
        talált?" füle üresen nyílna meg — miközben az előző képernyő az imént
        írta ki, hogy hány nevet találtunk. Két egymásnak ellentmondó szám két
        képernyőn: a felhasználó azt hinné, a leállítás eldobta a munkát.
      */
      setVizsgalat(res.megszakitva ? 'megszakitva' : 'kesz');
      setHaladas({
        szakasz: 'osszesites',
        uzenet: 'A csereszövegek kiszámolása a találatokhoz…',
        ablak: 0,
        ablakok: 0,
        arany: null,
      });
      // A megtartandó neveket ÁTADJUK: a `setDetected` ebben a körben még nem
      // írta ki magát, az állapotból olvasva a KORÁBBI irat listája jönne.
      if (felek.length + ids.length > 0) {
        await runAnalysis(
          felek,
          themeId,
          mode,
          {},
          ids,
          auto,
          res.keepList.map((k) => k.name),
          true,
        );
        if (elavult()) return;
      }
      if (res.megszakitva) {
        // A képernyőn maradunk: a felhasználó épp az imént állította le a
        // programot, és a kérdésére („és most?") itt kell válaszolni, nem egy
        // fül mélyén, ahova előbb el kell navigálnia.
        setVizsgalatKep('allt');
        return;
      }
      setVizsgalatKep('var');
      setFazis('beallitas');
    },
    [autoDetect, autoModeForDoc, mode, runAnalysis, themeId],
  );

  /**
   * A megnyitás utáni kapuk, sorrendben — MIND A VIZSGÁLAT ELŐTT.
   *
   * Mindkettő blokkoló: a feloldatlan változáskövetés mellett a mentés úgyis
   * tilos, a ki nem olvasható szövegrészben pedig nincs mit keresni. Ha a
   * vizsgálat UTÁN kérdeznénk, a felhasználó percekig várna egy iratra, amiről
   * itt már tudjuk, hogy nem lesz belőle teljes kimenet. Ahol nem látunk
   * szöveget, ott nevet sem találunk: ez a folyamat elején tartozik rá.
   */
  const continueAfterOpen = useCallback(
    /**
     * @param auto Az ehhez az irathoz tartozó út. Végig kell adni, mert a
     *   megnyitás és a vizsgálat indítása ugyanabban a kattintásban történik.
     */
    async (info: DocumentInfo, auto?: boolean) => {
      // A változáskövetés blokkoló: amíg van, nincs értelme neveket keresni.
      // Mindkét ág MEGÁLLÍTJA a folyamatot, ezért itt vált át a betöltőképernyő
      // a „várunk" lapra: a kérdés fölött annak is legyen kiútja, aki válasz
      // nélkül zárja be.
      if (info.pendingRevisions > 0) {
        setVizsgalatKep('var');
        setDialog('revisions');
        return;
      }
      if (info.loadWarnings.length > 0) {
        setVizsgalatKep('var');
        setDialog('loadWarnings');
        return;
      }
      await startScan(auto);
    },
    [startScan],
  );

  /**
   * A megnyitás útvonalról. Külön áll a tallózástól, mert a ráejtett fájlnál
   * már van útvonal — a tallózó ablak megnyitása ilyenkor csak visszakérdezné,
   * amit a felhasználó az imént megmutatott.
   */
  const openPath = useCallback(
    async (path: string) => {
      /*
        EGY BETÖLTÉS, NEM KETTŐ.

        Régen itt egy teljes képernyős „elfoglalt" réteg jött föl („Irat
        megnyitása…"), majd eltűnt, és a helyére lépett a vizsgálat képernyője a
        SAJÁT folyamatjelzőjével. A felhasználó tehát két külön betöltést látott
        egymás után ugyanarra az egy mozdulatra — a második azt üzente, hogy az
        első nem sikerült.

        Innentől a vizsgálat képernyője áll ott az első pillanattól, és a
        beolvasás csak az első szakasza. A fájlnevet az útvonalból már ismerjük,
        tehát van mit kiírni akkor is, amikor a motor még nem adta vissza az
        iratot.
      */
      setNyitandoNev(path.split(/[\/]/).pop() ?? path);
      setVizsgalat('kihagyva');
      setVizsgalatKep('nyit');
      setHaladas(null);
      setFazis('vizsgalat');
      try {
        const info = await api.openDocument(path);
        setDoc(info);
        // Az előző irat felei nem jöhetnek át: a beállító lap különben a MÁSIK
        // ügy valódi neveivel nyílna meg, és a felhasználó azokat mentené el ide.
        setParties([]);
        setDetected(null);
        setIdentifiers([]);
        setDetectError(null);
        setAnalysis(null);
        setDecisions({});
        setSelected(null);
        setExportResult(null);
        // A hivatalos szereplők cseréje MINDEN iratnál kikapcsolva indul: egy
        // jogszabályi következménnyel járó kapcsolót nem szabad csendben
        // átvinni a következő iratra (lásd `replaceOfficials`).
        setReplaceOfficials(false);
        keziekRef.current = [];
        // Ha egy korábbi irat vizsgálata még fut, az eredménye már nem ide
        // tartozik: a sorszám léptetésével eldobjuk.
        vizsgalatSzamRef.current += 1;
        // Új irat: a felhasználó még semmihez nem nyúlt, tehát nincs mit
        // elveszíteni — a következő megnyitásnál ne kérdezzünk fölöslegesen.
        setSajatDontes(false);
        // Az előnézet az ELŐZŐ iratról szólt: eldobjuk, és az eredetivel
        // indulunk, hogy a felhasználó ne a régi kimenetet lássa új irat alatt.
        setPreview(null);
        setPreviewError(null);
        setView('source');
        setHasWork(true);
        // Minden új irat a BEÁLLÍTOTT úton indul. A `switchToReview` csak erre
        // az egy iratra kapcsol vissza átnézősre — azt a következő megnyitás
        // nem örökölheti, különben a felhasználó beállítása csendben elveszne.
        setAutoModeForDoc(autoMode);
        /*
          A BETÖLTŐKÉPERNYŐ NEM SZAKAD MEG A MEGNYITÁS UTÁN.

          Itt korábban a „Készen állunk a vizsgálatra" lapra váltottunk, majd a
          következő sorban elindult a vizsgálat — a felhasználó tehát egy
          pillanatra megkapott egy teljes képernyős kérdést arról, hogy
          elindítsa-e azt, ami magától elindul. Innentől a betöltőképernyő
          végigfut a megnyitástól a kész találatlistáig, és a „várunk"
          képernyő CSAK akkor jelenik meg, ha tényleg meg is kell állni:
          blokkoló kérdés esetén (lásd alább és a `continueAfterOpen`-ben).
        */
        setNyitandoNev(null);
        // A szkennelt irat ténye itt már ismert. Ha csak az elemzés után szólnánk,
        // a felhasználó végigvárná a vizsgálatot, és csak utána tudná meg, hogy
        // nincs miből dolgozni.
        if (info.looksScanned) {
          // Itt MEGÁLLUNK: a kérdés fölött a „várunk" képernyő ad kiutat annak,
          // aki a kérdést válasz nélkül zárja be.
          setVizsgalatKep('var');
          setDialog('scanned');
          return;
        }
        await continueAfterOpen(info, autoMode);
      } catch (e) {
        // A megnyitás elakadt: nincs irat, tehát nincs mit vizsgálni sem. A
        // nyitóképernyőre esünk vissza — ott van a következő mozdulat.
        setError((e as Error).message);
        setNyitandoNev(null);
        setVizsgalatKep('var');
      }
    },
    [autoMode, continueAfterOpen],
  );

  const openDocument = useCallback(async () => {
    const path = await api.chooseDocument();
    if (!path) return;
    await openPath(path);
  }, [openPath]);

  /**
   * A „Másik irat" ág — KÉRDÉSSEL, ha van elveszíthető munka.
   *
   * Az „Új ügy" gomb már rákérdezett, ez viszont szó nélkül dobta el
   * mindazt, amit a felhasználó felvitt: a feleket, az azonosítók
   * ki-bekapcsolását és minden egyenkénti döntést. A veszteség ugyanakkora,
   * tehát a kérdésnek is ugyanúgy jár.
   *
   * A MÉRCE A FELHASZNÁLÓ SAJÁT DÖNTÉSE, nem a lefutott elemzés. Régen a kettő
   * egybeesett — elemzés csak a Felek-párbeszéd jóváhagyása után született —,
   * ma viszont a beállító lap már a megnyitás után magától számol, hogy legyen
   * mit mutatnia. Az elemzést nézve tehát MINDEN megnyitáskor rákérdeznénk,
   * még akkor is, ha a felhasználó egyetlen kapcsolóhoz sem nyúlt: egy
   * fölösleges kérdés pedig épp arra tanítaná meg, hogy gépiesen elüsse.
   *
   * A `path` a ráejtett irat útvonala; `null` esetén tallózni kell.
   */
  const requestOpen = useCallback(
    (path: string | null) => {
      if (sajatDontes) {
        setPendingOpen({ path });
        setDialog('openOther');
        return;
      }
      if (path) void openPath(path);
      else void openDocument();
    },
    [sajatDontes, openDocument, openPath],
  );

  /**
   * A ráejtett fájl megnyitása.
   *
   * Eddig az ejtőmező eldobta a behúzott fájlt, és csak a tallózót nyitotta meg
   * — a felhasználó tehát kétszer mutatta meg ugyanazt az iratot. Az útvonalat
   * a hídtól kérjük: a `File` objektumban az Electron 32 óta nincs benne.
   */
  const openDropped = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!OPENABLE.test(file.name)) {
        setError(
          `A(z) „${file.name}” fajtáját nem tudjuk megnyitni. PDF, Word (.docx) vagy egyszerű szöveg kell.`,
        );
        return;
      }
      let path: string | null = null;
      try {
        path = api.pathForFile?.(file) ?? null;
      } catch {
        // A híd hiánya nem hiba: a tallózás alatta ugyanúgy működik.
      }
      // Ha az útvonal nem oldható fel, a tallózás a becsületes visszalépés —
      // némán nem nyelhetjük el a felhasználó mozdulatát. A ráejtés ugyanúgy
      // eldobja a munkát, mint a „Másik irat" gomb, ezért ugyanazon a kapun
      // megy át: enélkül a kérdés egy behúzott fájllal megkerülhető volna.
      requestOpen(path);
    },
    [requestOpen],
  );

  const resolveRevisions = useCallback(
    async (m: 'accept' | 'reject') => {
      setBusy(m === 'accept' ? 'Módosítások elfogadása…' : 'Módosítások elutasítása…');
      let resolved: DocumentInfo | null = null;
      try {
        const info = await api.resolveRevisions(m);
        setDoc(info);
        setAnalysis(null);
        resolved = info;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
      if (!resolved) return;
      // A változáskövetés-kapun átjutva a betöltési figyelmeztetés kapuja
      // következik: a `continueAfterOpen` itt újra a változáskövetést kérdezné
      // (a feloldott iratban már nincs), ezért a második kaput hívjuk közvetlenül.
      if (resolved.loadWarnings.length > 0) {
        setDialog('loadWarnings');
        return;
      }
      await startScan();
    },
    [startScan],
  );

  const saveParties = async (p: PartyInput[], ids: PartyInput[]) => {
    setParties(p);
    setIdentifiers(ids);
    setDialog(null);
    setDecisions({});
    setHasWork(true);
    setSajatDontes(true);
    /*
      A KÉZI FELVITEL UTÁN MINDIG A BEÁLLÍTÓ LAP JÖN.

      Bárhonnan nyílt is a párbeszéd — a félbemaradt vizsgálat képernyőjéről, a
      beállító lapról vagy az „egyetlen nevet sem cserélünk" képernyőről —, a
      felhasználó most adta meg, KIT keressen a program. A következő kérdés
      mindhárom esetben ugyanaz: mi kerüljön a nevük helyére. Visszaejtve arra
      a képernyőre, ahonnan jött, még egyszer rá kellene kattintania a
      továbblépésre — ugyanarra, amit az imént kért.
    */
    setVizsgalatKep('var');
    setFazis('beallitas');
    // Az azonosítókat ÁTADJUK, nem az állapotból olvassuk: a `setIdentifiers`
    // csak a következő kirajzoláskor hat, addig a régi lista állna itt.
    await runAnalysis(p, themeId, mode, {}, ids);
  };

  /*
    A `pickTheme` INNEN ELTŰNT, nem elveszett.

    A készletválasztás a beállító lap füle lett, és a lap MINDEN beállítást
    ugyanazon az egy visszahíváson (`setupBeallitas`) küld vissza — az pedig
    pontosan ugyanezt teszi: átállítja a készletet és újraszámolást kér. Egy
    külön útvonal ugyanarra a döntésre előbb-utóbb elcsúszna a másiktól.
  */

  /**
   * Az imént legyártott saját készlet átvétele.
   *
   * A frissült listát a főfolyamattól kapjuk, nem magunk toldjuk hozzá: ő
   * tudja, mi került ténylegesen lemezre. Az új készletet rögtön ki is
   * választjuk — aki percekig várt a gyártásra, nem azért tette, hogy utána
   * még egyszer rákattintson.
   *
   * MENTÉS UTÁN A RÁCSRA TÉRÜNK VISSZA, nem a munkalapra. A felhasználó egy
   * készletet adott a listához; azt látnia kell, hogy ott van, és hogy a
   * többivel egyenrangú — enélkül a mentés csak egy becsukódó ablak volna,
   * ami után nem derül ki, hová került, amit legyártott. A rács immár a
   * beállító lap füle, ami az ablak MÖGÖTT végig ott állt: elég becsukni.
   */
  const temaMentve = (lista: ThemeSummaryUi[], id: string): void => {
    setThemes(lista);
    setDialog(null);
    if (!id) return;
    setThemeId(id);
    ujraKert();
  };

  /**
   * Saját készlet törlése.
   *
   * Ha épp az volt kiválasztva, MÁSIKRA kell váltani, és az elemzést újra kell
   * futtatni: a képernyőn maradó álnevek különben egy olyan készletből
   * származnának, ami már nincs meg — a következő mentés pedig másokat adna.
   */
  const removeCustomTheme = async (id: string): Promise<void> => {
    try {
      const lista = await api.removeCustomTheme(id);
      setThemes(lista);
      if (themeId !== id) return;
      const uj = lista.find((t) => !t.sajat)?.id ?? lista[0]?.id ?? DEFAULT_THEME;
      setThemeId(uj);
      ujraKert();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /*
    A TALÁLATONKÉNTI DÖNTÉS a munkalapon marad, mert csak ott van meg hozzá,
    ami a döntéshez kell: a találat körüli mondat. A beállító lap „Mit cserélünk?"
    füle félenként dolgozik — az „ezt a nevet cseréljük-e" kérdésre válaszol —,
    ez pedig arra, hogy „EZ a szó itt név volt-e".
  */
  const decide = async (id: number, d: 'accept' | 'skip' | undefined) => {
    const next = { ...decisions };
    if (d) next[id] = d;
    else delete next[id];
    setDecisions(next);
    setHasWork(true);
    setSajatDontes(true);
    await runAnalysis(parties, themeId, mode, next);
  };

  const startNewCase = useCallback(() => {
    setCaseSecret(newCaseSecret());
    setDoc(null);
    setParties([]);
    setDetected(null);
    setIdentifiers([]);
    setDetectError(null);
    setAnalysis(null);
    setDecisions({});
    setSelected(null);
    setExportResult(null);
    setBusy(null);
    setDialog(null);
    setHasWork(false);
    setSajatDontes(false);
    setPreview(null);
    setPreviewError(null);
    setView('source');
    setNyitandoNev(null);
    setReplaceOfficials(false);
    keziekRef.current = [];
    // Az előző ügy kulcsfájlja nem az új ügyé: a felkínált útvonalat is
    // elengedjük, különben a következő mentés után a RÉGI kulcsot ajánlanánk.
    setKeyFilePath(null);
  }, []);

  const requestNewCase = useCallback(() => {
    if (doc || parties.length > 0) setDialog('newCase');
    else startNewCase();
  }, [doc, parties.length, startNewCase]);

  const doExport = useCallback(
    // A paraméter neve szándékosan más, mint az azonos jelentésű állapoté: a
    // mentés ablakában a felhasználó még egyszer átbillentheti a kapcsolót, és
    // AZ az érték számít, nem a beállító lapon hagyott alapállás.
    async (kulcsfajl: boolean, passphrase: string) => {
      let target: string | null = null;
      try {
        const suggested = await api.suggestOutputPath(mode);
        // Fátyol nélkül: amíg a natív fájlnév-ablak áll, a program a
        // felhasználóra vár, nem fordítva. A pörgő jelzés itt hazudna.
        target = await api.chooseSaveTarget(suggested);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      if (!target) return;
      setBusy('Mentés és ellenőrzés…');
      try {
        const res = await api.exportDocument({
          mode,
          keepKey: kulcsfajl,
          keyPassphrase: passphrase,
          outputPath: target,
        });
        setExportResult(res);
        // A kulcsfájl útvonalát megjegyezzük: a ki-kicsoda tábla innen egy
        // kattintás, tallózás nélkül.
        if (res.keyPath) setKeyFilePath(res.keyPath);
        // A munka CSAK AKKOR került fájlba, ha az ellenőrzés tiszta volt.
        // Szivárgásnál a motor szándékosan semmit nem ír ki — a jelzés
        // törlése ilyenkor azt jelentette, hogy a felhasználó a blokkolt
        // mentés után figyelmeztetés nélkül ki tudott lépni, és vitte magával
        // a felvitt feleket meg az összes egyenkénti döntést. Épp az a
        // munkamenet veszett volna el némán, amelyiket még be kell fejezni.
        if (res.report.ok) setHasWork(false);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [mode],
  );

  const openSettings = useCallback((tab: SettingsTab, back: Dialog = null) => {
    setSettingsTab(tab);
    setSettingsBack(back);
    setDialog('settings');
  }, []);

  /**
   * A felismerő modell állapotának újrakérdezése.
   *
   * Nem elég induláskor egyszer: a felhasználó a Beállításokban letöltheti vagy
   * törölheti a modellt, és a nyitóképernyő figyelmeztetése ilyenkor hazudna.
   * A hívás olcsó — egy lemezes állapotlekérdezés —, a hazugság ára viszont
   * egy át nem nézett irat.
   */
  const modellAllapotFrissit = useCallback(async (): Promise<void> => {
    try {
      const info = await api.appInfo();
      setModellHiany({ nev: info.modelName, hianyzik: info.modelState !== 'installed' });
    } catch {
      // Ha nem tudjuk megkérdezni, NEM állítunk semmit: egy téves „hiányzik”
      // felirat ugyanúgy félrevezet, mint a hallgatás.
      setModellHiany(null);
    }
  }, []);

  /**
   * A feloldatlan változáskövetés BLOKKOLÓ állapot, nem egy párbeszéd
   * mondanivalója.
   *
   * A párbeszéd kimondja, hogy „amíg ez fennáll, nem mentünk” — a Mégse
   * viszont eddig egyszerűen bezárta az ablakot, és utána semmi nem tiltotta a
   * mentést. A felhasználó felvitte a feleket, végigrágta a találatokat,
   * jelszót adott a kulcsfájlhoz, kiválasztotta a fájlnevet, és CSAK EKKOR
   * kapott hibaüzenetet. Az állapotot ezért a felület tartja fenn.
   */
  const revisionsBlocked = (doc?.pendingRevisions ?? 0) > 0;

  const requestExport = useCallback(() => {
    if (!analysis) return;
    if (revisionsBlocked) {
      // Nem hibaüzenet, hanem a feloldás helye: a felhasználónak dönteni kell,
      // nem tudomásul venni.
      setDialog('revisions');
      return;
    }
    setExportResult(null);
    setDialog('export');
  }, [analysis, revisionsBlocked]);

  /**
   * Az előnézet a MOTOR kimenete, nem a felület találgatása: a felület nem
   * ismeri sem a ragozást, sem a döntéseket. Ezért kérjük le, ahelyett hogy
   * összeraknánk.
   */
  useEffect(() => {
    // Csak akkor kérjük le, ha tényleg az előnézet látszik: a szöveg
    // előállítása az egész iraton végigmegy.
    if (view !== 'preview' || !analysis || preview !== null || previewError !== null) return;
    let el = true;
    void api
      .previewText()
      .then((t) => {
        if (el) setPreview(t);
      })
      .catch((e: Error) => {
        if (el) setPreviewError(e.message);
      });
    return () => {
      el = false;
    };
  }, [view, analysis, preview, previewError]);

  /**
   * Nyomtatás.
   *
   * A főfolyamat a KÉPERNYŐ tartalmát viszi papírra, ezért a nyomtatás előtt át
   * kell váltani az álnevesített előnézetre — az eredeti nézetben a valódi
   * nevek állnak, és azokat nyomtatóra küldeni ugyanaz a hiba volna, mint
   * fekete csíkot rajzolni föléjük. A nyomtatási szabályok (styles.css) emellett
   * az eredeti nézetet külön is elrejtik, hogy egy versenyhelyzet se
   * fordíthassa vissza ezt a döntést.
   */
  const doPrint = useCallback(async () => {
    /*
      A NYOMTATÁS A KÉPERNYŐ TARTALMÁT VISZI PAPÍRRA, tehát csak ott van
      értelme, ahol az álnevesített szöveg látszik. A vizsgálat és a beállító
      lap alatt a nyomtatás a beállítások képét adná ki — a felhasználó pedig
      abban a hitben venné el a papírt, hogy az iratot nyomtatta ki.
    */
    if (!analysis || fazis !== 'munka') {
      setError(
        'Nincs mit nyomtatni: előbb menj végig a beállító lapon, hogy elkészüljön az álnevesített szöveg.',
      );
      return;
    }
    setView('preview');
    // A fátyol csak akkor jár, ha tényleg várni kell rá: kész szövegnél a
    // felvillanó jelzés hazudna.
    if (preview === null) setBusy('Az álnevesített szöveg előállítása…');
    try {
      const text = preview ?? (await api.previewText());
      setPreview(text);
      setPreviewError(null);
      setBusy(null);
      await kovetkezoKep();
      await api.print();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [analysis, fazis, preview]);

  /**
   * AZ ÖSSZEGYŰJTÖTT ÚJRASZÁMOLÁSI KÉRÉSEK KISZOLGÁLÁSA.
   *
   * Minden beállításváltozás — csere-mód, névkészlet, küszöb, összegek,
   * dátumok, az út, sőt egy kézzel átírt álnév is — MÁS KIMENETET ad, tehát a
   * képernyőn álló találatlista utána hazudna: a kapcsoló átbillen, a
   * csereszöveg marad a régi. Ezért mindegyik újraszámolást kér.
   *
   * A rövid szünet nem finomkodás. A küszöb csúszkája egyetlen mozdulattal
   * tucatnyi értéket ad, és mindegyikre elindulna egy teljes iratot végigolvasó
   * elemzés: a gép a mozdulat végén a második lépésnél tartana, a lista pedig
   * közben végig ugrálna. A beállító lapon ráadásul CSENDBEN fut, fátyol
   * nélkül — ott a felhasználó a saját kapcsolóját nézi, nem egy villogó
   * réteget.
   *
   * Az időzítőt referencia tartja, nem a hatás takarítója: a takarító minden
   * újrarajzoláskor lefutna (a `runAnalysis` azonossága gyakran változik), és
   * némán eldobná a még ki nem szolgált kérést.
   */
  const ujraIdoRef = useRef<number | null>(null);
  const kiszolgaltRef = useRef(0);
  useEffect(() => {
    if (ujraszamolas === 0 || kiszolgaltRef.current === ujraszamolas) return;
    kiszolgaltRef.current = ujraszamolas;
    if (ujraIdoRef.current !== null) window.clearTimeout(ujraIdoRef.current);
    const csendes = fazis === 'beallitas';
    ujraIdoRef.current = window.setTimeout(
      () => {
        ujraIdoRef.current = null;
        void runAnalysis(
          parties,
          themeId,
          mode,
          decisions,
          identifiers,
          autoModeForDoc,
          undefined,
          csendes,
        );
      },
      csendes ? 240 : 0,
    );
  }, [
    ujraszamolas,
    fazis,
    parties,
    themeId,
    mode,
    decisions,
    identifiers,
    autoModeForDoc,
    runAnalysis,
  ]);

  // A programból kilépve ne maradjon időzítő, ami egy eltűnt felületre ír.
  useEffect(
    () => () => {
      if (ujraIdoRef.current !== null) window.clearTimeout(ujraIdoRef.current);
    },
    [],
  );

  /**
   * VISSZAÚT: átváltás az átnézős útra UGYANAZON az iraton.
   *
   * Nem nyit új iratot és nem futtat új felismerést: a felek listája, az
   * azonosítók és a felhasználó eddigi döntései megmaradnak — csak a
   * bizonytalan találatok kerülnek vissza emberi döntésre. Aki a mentés utáni
   * jelentésben hibát lát, ne kezdje elölről.
   *
   * Az `autoModeForDoc` az elemzés bemenetén megy át (`acceptReview`), tehát a
   * váltás után újra kell számolni — ezt a fenti figyelő végzi el, a
   * munkalapon fátyollal, mert itt a felhasználó KIFEJEZETTEN várakozásra
   * számít: rákattintott egy gombra, aminek látható eredménye lesz.
   */
  const switchToReview = useCallback(() => {
    setDialog(null);
    setExportResult(null);
    setAutoModeForDoc(false);
    setFazis('munka');
    setView('source');
    // A mentés után a jelzést töröltük; ha innen visszalép, megint van
    // elveszíthető munka, és a bezárásnak megint kérdeznie kell.
    setHasWork(true);
    setReviewFocus((n) => n + 1);
    ujraKert();
  }, [ujraKert]);

  const handleMenu = useCallback(
    (action: MenuAction) => {
      switch (action) {
        case 'open':
          // A menüpont ugyanazt teszi, mint a „Másik irat" gomb, tehát ugyanúgy
          // kérdez: egy megkerülhető kérdés nem védelem.
          requestOpen(null);
          break;
        case 'save':
          /*
            A BEÁLLÍTÓ LAPON A MENTÉS PARANCS A TOVÁBBLÉPÉST JELENTI.

            Aki ott nyom Ctrl+S-t, menteni akar — de a lapon állított
            beállítások még nincsenek lemezen, és a csere sem futott le velük
            biztosan. A mentés ablakát fölnyitni fölötte azt jelentené, hogy a
            beállítás ELŐTTI irat kerül fájlba. Ezért ugyanaz fut le, mint a
            „Mehet a csere" gombra, és a mentés ablaka utána nyílik ki.
          */
          if (fazis === 'beallitas') void setupTovabb(true);
          else requestExport();
          break;
        case 'print':
          void doPrint();
          break;
        case 'settings':
          openSettings('models');
          break;
        case 'about':
          openSettings('about');
          break;
        case 'update':
          // A frissítés ablaka MAGA mondja meg, ha nincs bekapcsolva, és ott
          // is lehet bekapcsolni. Egy néma menüpont vagy egy „nincs beállítva”
          // hibaüzenet ugyanoda vezetne: a felhasználó nem tudná, mit tegyen.
          setDialog('update');
          break;
        case 'newCase':
          requestNewCase();
          break;
        case 'keyfile':
          setDialog('keyfile');
          break;
      }
    },
    // A `setupTovabb` nincs memoizálva, tehát ez a kezelő minden kirajzoláskor
    // új. Ez itt nem baj: a menü nem közvetlenül rá iratkozik fel, hanem az
    // alábbi referencián keresztül éri el — épp azért, hogy a feliratkozás
    // egyetlen egyszer történjen meg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doPrint, fazis, openSettings, requestExport, requestNewCase, requestOpen],
  );

  // A menü feliratkozása egyszer történik; a mindenkori kezelőt referencián át
  // érjük el, hogy egy-egy állapotváltozás ne iratkozzon le-fel feleslegesen.
  const menuRef = useRef(handleMenu);
  useEffect(() => {
    menuRef.current = handleMenu;
  }, [handleMenu]);

  useEffect(() => api.onMenu?.((action: MenuAction) => menuRef.current(action)), []);

  /*
    A BEZÁRÁS KÉRDÉSE A SAJÁT ABLAKUNKBAN.

    A főfolyamat nem a Windows rendszerpárbeszédét nyitja ki többé, hanem
    átszól ide, és a válaszunkra vár. A feliratkozás EGYSZER történik: a
    kérdés bármikor jöhet, és ha közben le-fel iratkoznánk, épp a bezárás
    pillanatában maradhatna feliratkozó nélkül — az ablak pedig a
    főfolyamat időzítőjéig bezárhatatlannak látszana.
  */
  useEffect(() => api.onConfirmClose?.(() => setDialog('exit')), []);

  // Ebből tudja a főfolyamat, hogy kilépéskor van-e elveszíthető munka.
  useEffect(() => {
    void api.setDirty?.(hasWork).catch(() => {
      // A piszkos állapot jelzése kényelmi funkció; ha nem megy, nem áll meg tőle a munka.
    });
  }, [hasWork]);

  /*
    A NATÍV ABLAKKERET IS HALVÁNYODJON, amíg modális ablak áll a képernyőn.

    A fátyol csak a lapot fedi le; a Windows címsora és kerete fölötte marad,
    élesen. A képernyő egyik fele tehát azt mondja, hogy a program most egy
    kérdésre vár, a másik fele azt, hogy nem. A keret a főfolyamaté, ezért ő
    kapja a jelzést — a lap csak annyit tud, hogy nyitva van-e ablak.

    A hívás VÉDEKEZŐ: ha a híd nem ismeri a pontot, nem történik semmi. Egy
    díszítés miatt nem szabad elhasalnia annak a felületnek, amin az irat
    álnevesítése folyik.
  */
  useEffect(() => {
    /*
      EZ A HÍVÁS EDDIG A SEMMIBE MENT.

      A felület egy `setModalOpen` nevű hídpontot keresett, és ha nem találta,
      csendben visszatért. Márpedig SOHA nem találta: a hídon
      `ablakkeretetIgazit` néven áll ugyanez, az `ui:ablakkeret` csatornán
      (electron/preload.ts) — a főfolyamatban pedig ott a teljes, kész gépezet:
      színkeverés a fátyol alá, türelmi idő a visszaállításnak, a fölös hívások
      szűrése (`keretetIgazit`, electron/main.ts).

      Kész motor, hívó nélkül. A védekező `if (!hid.setModalOpen) return;` pedig
      pontosan azt tette, amiért a védekezés van — nem hasalt el —, cserébe
      viszont elnyelte a hiba MINDEN jelét: a felhasználó háromszor jelezte,
      hogy a natív ablakgombok nem halványodnak, a képernyőn pedig semmi nem
      árulta el, hogy a lap meg sem próbálja.

      A `?.` marad: egy régebbi hídon nincs meg a pont, és egy ablakkeret
      árnyalata miatt nem hasalhat el az a felület, amin az irat álnevesítése
      folyik. A KÜLÖNBSÉG az, hogy a név mostantól gépelt — ha elmozdul,
      fordítási hiba lesz belőle, nem néma tétlenség.
    */
    /*
      A NÉMA ÁG MEGTÖRÉSE FEJLESZTÉSKOR.

      A `?.` valódi visszafelé kompatibilitás — egy régebbi hídon nincs meg a
      pont —, de ugyanaz a `?.` nyelte el három hónapig az elgépelt nevet is.
      A kettő közt futásidőben nincs különbség; a fejlesztő gépén viszont van,
      és ott ki KELL mondani. Éles futásban nem szólal meg: a felhasználót nem
      érdekli egy hídpont neve, és a program dolgozik nélküle is.
    */
    if (import.meta.env.DEV && !api.ablakkeretetIgazit) {
      // eslint-disable-next-line no-console
      console.warn(
        'Hiányzó hídpont: ablakkeretetIgazit — a natív ablakgombok nem fognak halványodni.',
      );
    }
    void Promise.resolve(
      api.ablakkeretetIgazit?.({ halvanyitva: dialog !== null, tema: 'vilagos' }),
    ).catch(() => {
      // Az elutasítást elnyeljük: a keret színe díszítés, a munka nem áll meg tőle.
    });
  }, [dialog]);

  useEffect(() => {
    // A mentett értékeket induláskor kell betölteni. Enélkül a felhasználó
    // beállítása csak azután élne, hogy ugyanabban a munkamenetben kinyitotta a
    // Beállításokat — a beállító lap pedig a beépített alapállással nyílna meg
    // ahelyett, hogy a legutóbb használt értékeket hozná.
    void (async () => {
      let saved: AppSettings | null = null;
      try {
        saved = await api.getSettings();
        setAutoDetect(saved.autoDetect);
        // Kifejezetten `=== true`: egy régi beállításfájlban vagy egy régi
        // hídon ez a mező nincs meg, és a hiányzó értéket NEM szabad
        // beleegyezésnek venni. Kérdezés nélkül csak az az irat futhat végig,
        // amelyikre a felhasználó ezt kérte.
        setAutoMode(saved.autoMode === true);
        setAutoModeForDoc(saved.autoMode === true);
      } catch {
        // A beállítások hiánya nem végzetes: a beépített alapállással megyünk tovább.
      }
      /*
        AZ IRATONKÉNTI ÉRTÉKEK A LEGUTÓBBI ÁLLÁSUKBÓL INDULNAK.

        Ezt a hatot a beállító lap állítja, és a továbblépéskor ugyanide íródik
        vissza (`api.setUiState`). Így aki mindig ugyanúgy dolgozik, a
        megnyitás után egyetlen kapcsolóhoz sem nyúl — csak továbblép.

        A `getSettings` ugyanezeket a mezőket ismeri, és a főfolyamatban
        ugyanabból a fájlból származnak; azért mégis innen olvassuk, mert így
        EGY helyen dől el, mi számít iratbeállításnak. Két külön olvasat előbb-
        utóbb kétféle listát tartana számon.
      */
      let irat: IratBeallitas | null = null;
      try {
        const ui = await api.getUiState?.();
        irat = ui?.iratBeallitas ?? null;
      } catch {
        // Régi híd: marad az, amit a beállításfájlból tudunk.
      }
      const kezdo = irat ?? saved;
      if (kezdo) {
        setMode(kezdo.mode);
        setKeepKey(kezdo.keepKey);
        setAutoThreshold(kezdo.autoThreshold);
        setReplaceAmounts(kezdo.replaceAmounts);
        setShiftDates(kezdo.shiftDates);
        // Kifejezett vizsgálat: egy RÉGEBBI beállításfájlban nincs meg a mező, és
        // a hiányt nem szabad választásnak venni — olyankor a magyar marad.
        if (kezdo.labelLang === 'hu' || kezdo.labelLang === 'en') setLabelLang(kezdo.labelLang);
      }
      try {
        const t = await api.listThemes();
        setThemes(t);
        const wanted = kezdo?.themeId ?? DEFAULT_THEME;
        setThemeId(t.length && !t.some((x) => x.id === wanted) ? t[0]!.id : wanted);
      } catch (e) {
        setError((e as Error).message);
      }
      // A modell állapotát az INDULÁSKOR kérdezzük meg, nem az első felismerés
      // után: ha hiányzik, a felhasználónak most van ideje letölteni.
      await modellAllapotFrissit();
    })();

    /*
      A VIZSGÁLAT HALADÁSA A SAJÁT KÉPERNYŐJÉRE MEGY, nem a fátyolra.

      Eddig ez az üzenet a teljes képernyős „elfoglalt" rétegbe került. Az a
      réteg viszont mindent letakar — vele együtt a Leállítás gombot is, ami
      épp azért van, hogy a percekig futó vizsgálat ne legyen kivárhatatlan.

      A gazdagabb csatornát részesítjük előnyben (szakasz, arány), és csak akkor
      esünk vissza a puszta mondatra, ha a híd nem ismeri: a kettő ugyanabban a
      pillanatban, ugyanabból a forrásból megy ki, tehát mindkettőre feliratkozva
      ugyanaz az adat érkezne kétszer.
    */
    let offHaladas: (() => void) | undefined;
    try {
      offHaladas = api.onDetectProgress?.((p) => setHaladas(p));
    } catch {
      // A híd hiánya nem hiba: alatta a pörgő ugyanúgy elmondja, hogy dolgozunk.
    }
    if (!offHaladas) {
      offHaladas = api.onDetectStatus?.((s) =>
        setHaladas({ szakasz: 'vizsgalat', uzenet: s, ablak: 0, ablakok: 0, arany: null }),
      );
    }

    // Fejlesztői belépő: a felület átnézéséhez ne kelljen végigkattintani a folyamatot.
    const preset = devPreset();
    if (preset) {
      setDoc(preset.doc);
      setParties(preset.parties);
      // A felismerés eredménye is kell: enélkül minden sor „kézzel felvéve"
      // jelvényt kapna, és a törvény szerint bent maradó nevek szakasza meg sem
      // jelenne — épp az a két ág, amit a belépővel nézni akarunk.
      setDetected(preset.detected);
      void runAnalysis(preset.parties, themeId, 'theme', {});
      // `?dev=settings`, `?dev=parties`… — így egy-egy párbeszéd külön is
      // megnyitható átnézésre, végigkattintás nélkül.
      const which = new URLSearchParams(window.location.search).get('dev');
      // A beállító lap és a vizsgálat képernyője NEM párbeszéd, hanem a
      // folyamat állomása: azokat fázisváltással kell előhozni, nem
      // ablaknyitással.
      if (which === 'docsetup') {
        setVizsgalat('kesz');
        setTimeout(() => setFazis('beallitas'), 400);
      } else if (which === 'scan') {
        setVizsgalatKep('fut');
        setLeallithato(vanLeallitas());
        setTimeout(() => setFazis('vizsgalat'), 400);
      } else if (which && which !== 'workspace') {
        setTimeout(() => setDialog(which as Dialog), 400);
      }
    }
    return offHaladas;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Ablakszintű ejtés.
   *
   * Alapból a lap NAVIGÁL a ráejtett fájlra: a program helyén a behúzott PDF
   * nyílna meg, és vele együtt tűnne el a megnyitott irat, a felvitt felek és
   * minden meghozott döntés. Ezért az alapműveletet mindenhol elvesszük — a
   * mezőn kívülre ejtett iratot pedig ugyanúgy megnyitjuk, mert a felhasználó
   * mozdulata ott is egyértelmű.
   */
  useEffect(() => {
    const dragover = (e: DragEvent): void => e.preventDefault();
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      // Nyitott párbeszéd fölött nem cserélünk iratot: a felhasználó éppen egy
      // kérdésre válaszol, és a válasz alól nem húzzuk ki a szöveget. Futó
      // vizsgálat közben ugyanezért nem: ott a program dolgozik az iraton,
      // amit a ráejtés kicserélne alóla.
      if (dialog !== null || busy !== null || vizsgalatKep === 'fut') return;
      void openDropped(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragover', dragover);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('drop', drop);
    };
  }, [dialog, busy, vizsgalatKep, openDropped]);

  /*
    ELDÖNTETLEN találat: amit a mentés bent hagy, és amiről még senki nem
    döntött. A program saját döntése (`autoDecided`) kimarad belőle — az nem
    eldöntetlen, hanem eldöntött, csak nem a felhasználó által. Ha itt maradna,
    a mentés előtti ablak a „Mindent cserélünk" után minden bent hagyott
    találatra azt írná, hogy „eldöntetlen, nézd át", miközben az „Átnézésre
    vár" listán már nincs mit eldönteni. Ami így bent marad, azt a mentés
    utáni maradványlista tételesen kiírja.
  */
  const pendingCount = analysis
    ? analysis.matches.filter(
        (m) => !m.autoDecided && (m.decision ? m.decision === 'skip' : m.disposition !== 'auto'),
      ).length
    : 0;

  /** Hány bizonytalan találatot fogadott el a program ember helyett. */
  const autoAccepted = analysis?.autoAccepted ?? [];
  const autoDecidedCount = autoAccepted.length;

  /* ──────────────── a megnyitás utáni beállító lap kiszolgálása ──────────────── */

  /**
   * Az EBBEN AZ IRATBAN érvényes beállítások, ahogy a lap várja.
   *
   * Nem külön tároló: pontosan azok az állapotok, amikkel az elemzés is fut.
   * Egy másolatból a lap és a motor előbb-utóbb szétcsúszna, és a felhasználó
   * azt hinné, azzal a névkészlettel dolgozik, amit a képernyőn lát.
   */
  const beallitasok: DokumentumBeallitasok = {
    mode,
    themeId,
    labelLang,
    autoThreshold: autoThreshold ?? DEFAULT_THRESHOLD,
    keepKey,
    replaceAmounts,
    shiftDates,
    replaceOfficials,
  };

  /**
   * A KÉZZEL FELVITT NEVEK azonosítói — a listán ez ad nekik jelvényt.
   *
   * A felismerés a saját sorainál megmondja, mennyire biztos bennük; a kézzel
   * beírt névnél viszont nincs mit mérni, azt a felhasználó tudja. Enélkül a
   * saját maga felvitte név „bizonytalan” jelvényt kapna, és a program azt
   * kérdezné vissza, amit az imént állítottak neki.
   */
  /**
   * A HIVATALOS SZEREPLŐK AZONOSÍTÓI (Bszi. 166. § (2)).
   *
   * Három helyen kell: a találatlista külön szakaszba sorolja őket, az irat
   * külön színnel emeli ki, a jelmagyarázat pedig megnevezi a színt. Egyetlen
   * halmazból dolgozik mind a három — külön kiszámolva előbb-utóbb az egyik
   * lemaradna, és a felület más színnel rajzolná ugyanazt a nevet, mint amit a
   * listán mutat.
   */
  const hivatalosIdk = useMemo(
    () => new Set((detected?.officials ?? []).map((o) => o.id)),
    [detected],
  );

  /**
   * A JELMAGYARÁZAT SORAI — ugyanabból a két függvényből, amiből a színek.
   *
   * Nem az `AnalysisResult.outcomes` számhármasából: az csak a kimenetet
   * ismeri, a FAJTÁT (összeg, dátum, hivatalos szereplő) nem — pedig a
   * felhasználó kérése épp az volt, hogy azokat külön színnel lássa. Ha a
   * jelmagyarázat máshonnan számolna, mint a kiemelés, előbb-utóbb más számot
   * írna ki, mint amennyi színt a szem megszámol.
   *
   * AMI NEM SZEREPEL, AZ NEM IS LÁTSZIK: a nulla darabszámú sorokat elhagyjuk.
   * Egy „dátum · 0” jelmagyarázat azt ígérné, hogy van a képernyőn ilyen szín,
   * és a felhasználó keresné.
   */
  const jelmagyarazat = useMemo(() => {
    if (!analysis) return [];
    const cserelodo = analysis.matches.filter((m) => matchOutcome(m) === 'csere');
    const fajtak: MatchKind[] = ['nev', 'osszeg', 'datum', 'hivatalos'];
    const sorok = fajtak.map((f) => ({
      kulcs: f,
      osztaly: `csere k-${f}`,
      cimke: FAJTA_CIMKE[f],
      db: cserelodo.filter((m) => matchKind(m, hivatalosIdk) === f).length,
      sugo: `Lecseréljük. Kiemelve az iraton, ezzel a színnel: ${FAJTA_CIMKE[f]}.`,
    }));
    return [
      ...sorok,
      {
        kulcs: 'bizonytalan',
        osztaly: 'bizonytalan',
        cimke: KIMENET_CIMKE.bizonytalan,
        db: analysis.matches.filter((m) => matchOutcome(m) === 'bizonytalan').length,
        sugo: 'A program bizonytalan benne, és még senki nem döntött róla.',
      },
      {
        kulcs: 'nincs',
        osztaly: 'nincs',
        cimke: KIMENET_CIMKE.nincs,
        db: analysis.matches.filter((m) => matchOutcome(m) === 'nincs').length,
        sugo: 'Nem cserélődik: az eredeti szöveg marad. Kattints rá az iraton, ha mégis kell.',
      },
    ].filter((j) => j.db > 0);
  }, [analysis, hivatalosIdk]);

  const keziIdk = useMemo(() => {
    const felismert = new Set([
      ...(detected?.parties ?? []).map((d) => d.id),
      ...(detected?.identifiers ?? []).map((d) => d.id),
      ...(detected?.officials ?? []).map((d) => d.id),
    ]);
    return new Set([...parties, ...identifiers].filter((p) => !felismert.has(p.id)).map((p) => p.id));
  }, [detected, parties, identifiers]);

  /**
   * A megtalált nevek, amiket a program cserélni fog — az ELEMZÉS eredményéből.
   *
   * Nem a felismerés nyers listájából: a felismerés csak azt tudja, KIT talált,
   * azt nem, hogy MI kerül a helyére. A csereszöveg a csere-módtól, a
   * névkészlettől és az ügyazonosító titoktól függ, és mindhármat az elemzés
   * ismeri. Ezért kell az elemzésnek lefutnia, mielőtt ez a lista megjelenhet.
   *
   * A SOR ÁLLAPOTA A TALÁLATOKBÓL SZÁMOLÓDIK, nem külön tárolt kapcsolóból.
   * Minden sor megnézi a saját találatait az elemzésben, és megszámolja, hány
   * cserélődik le közülük (`matchOutcome`) — ugyanazzal a függvénnyel, amivel a
   * bal oldali iratnézet is színez. Így a lista és az irat SOSEM mondhat mást:
   * egy külön tárolt „kikapcsolva” jelző pontosan attól csúszna el, hogy a
   * motor közben mást döntött (például mert egy azonosítót magától is fölvett).
   */
  const tetelek: TalaltTetel[] = useMemo(() => {
    if (!analysis) return [];
    const kezi = new Map(
      [...parties, ...identifiers].map((p) => [p.id, p.manualReplacement?.trim() ?? '']),
    );
    /*
      AZ ALAPÉRTELMEZETT CSERESZÖVEG MEGJEGYEZVE.

      A `CastRow.replacement` már a kézi átírást tartalmazza, ha van ilyen —
      abból tehát nem derülne ki, mit adna a program magától. Márpedig a lapon
      épp ezt kell kiírni a „vissza” gomb mellé: mihez tér vissza a felhasználó,
      ha meggondolja magát.
    */
    for (const c of analysis.cast) {
      if (!c.manual) alapCsereRef.current.set(c.entityId, c.replacement);
    }

    /** entityId → a találatai, az iratbeli sorrendjükben. */
    const talalatok = new Map<string, typeof analysis.matches>();
    for (const m of analysis.matches) {
      const lista = talalatok.get(m.entityId) ?? [];
      lista.push(m);
      talalatok.set(m.entityId, lista);
    }

    const allapot = (
      entityId: string,
    ): {
      elofordulas: number;
      cserelodik: number;
      bizonytalanDb: number;
      vanKovetkezo: boolean;
    } => {
      const lista = talalatok.get(entityId) ?? [];
      const cserelodik = lista.filter((m) => matchOutcome(m) === 'csere').length;
      const bizonytalanDb = lista.filter((m) => matchOutcome(m) === 'bizonytalan').length;
      return {
        elofordulas: lista.length,
        cserelodik,
        bizonytalanDb,
        vanKovetkezo: cserelodik < lista.length,
      };
    };

    // Közvetlenül az elemzésből, nem a fenti `autoAccepted`-ből: az minden
    // kirajzoláskor új tömb, amitől ez a számolás fölöslegesen újrafutna.
    const bizonytalanok = new Set((analysis.autoAccepted ?? []).map((r) => r.entityId));

    const sorok = new Map<string, TalaltTetel>();
    for (const c of analysis.cast) {
      const sajat = kezi.get(c.entityId) ?? '';
      const a = allapot(c.entityId);
      const tetel: TalaltTetel = {
        id: c.entityId,
        /*
          A HIVATALOS SZEREPLŐ SAJÁT CSOPORTOT KAP, akkor is, ha éppen
          cserélődik. A felek közé sorolva a felhasználó nem látná, hogy egy
          jogszabállyal (Bszi. 166. § (2)) szemben döntött — pedig a
          bekapcsolás pont ezt jelenti, és a listán is látszania kell.
        */
        fajta: hivatalosIdk.has(c.entityId) ? 'hivatalos' : c.kind,
        eredeti: c.original,
        szerep: c.role,
        elofordulas: a.elofordulas,
        cserelodik: a.cserelodik,
        bizonytalanDb: a.bizonytalanDb,
        vanKovetkezo: a.vanKovetkezo,
        csere: alapCsereRef.current.get(c.entityId) ?? c.replacement,
        ...(sajat === '' ? {} : { sajatCsere: sajat }),
        ...(keziIdk.has(c.entityId) ? { kezi: true } : {}),
        /*
          BIZONYTALAN = van még emberi döntésre váró találata, VAGY a program
          döntött helyette. A kettő ugyanannak a névnek a két útja: a felhasználó
          döntetlenül hagyva `pendingCount`-ot lát, a „Mindent cserélünk” után
          viszont a motor dönt, és a `pendingCount` lenullázódik. Csak az elsőt
          nézve a mindent-cserélő úton egyetlen bizonytalan találat sem
          látszana — épp azon az úton, ahol a legfontosabb tudni róluk.
        */
        bizonytalan: c.pendingCount > 0 || bizonytalanok.has(c.entityId),
      };
      // Ugyanaz az azonosító kétszer csak akkor fordulhat elő, ha a motor a mi
      // sorunk mellé fölvette a magáét. Az AKTÍV sor az igaz: az mondja meg,
      // mi fog történni.
      const meglevo = sorok.get(c.entityId);
      if (meglevo === undefined || (meglevo.cserelodik === 0 && tetel.cserelodik > 0)) {
        sorok.set(c.entityId, tetel);
      }
    }

    /*
      AZ ÖSSZEG ÉS A DÁTUM IS SOR A LISTÁN.

      Nincsenek a `cast`-ban — nem felek, hanem az iratban megtalált értékek —,
      a felhasználó szempontjából viszont ugyanaz a kérdés áll rájuk: hozzányúlunk
      vagy sem. Amíg két külön kapcsoló állt rájuk egy másik fülön, a program
      kétféle felületet mutatott ugyanarra a döntésre, és az iraton semmi nem
      jelezte, hol vannak. Innentől ugyanaz a sor, ugyanazok a gombok.
    */
    for (const [entityId, fajta] of [
      ['#osszeg', 'amount'],
      ['#datum', 'date'],
    ] as const) {
      const a = allapot(entityId);
      if (a.elofordulas === 0) continue;
      /*
        A SOR EGY VALÓDI PÉLDÁT MUTAT, nem összefoglaló címet.

        „Összegek az iratban → Összegek az iratban” semmit nem mondott volna
        arról, mi fog történni. Az ELSŐ megtalált érték és a hozzá kiszámolt
        csereszöveg viszont pontosan megmutatja a szorzót, illetve az eltolást
        — a csoport fejléce már úgyis kimondja, hogy összegekről van szó, az
        előfordulásszám pedig azt, hogy nem csak erről az egyről.
      */
      const minta = (talalatok.get(entityId) ?? [])[0];
      if (minta === undefined) continue;
      sorok.set(entityId, {
        id: entityId,
        fajta,
        eredeti: minta.surface,
        szerep: fajta === 'amount' ? 'összeg' : 'dátum',
        elofordulas: a.elofordulas,
        cserelodik: a.cserelodik,
        bizonytalanDb: a.bizonytalanDb,
        vanKovetkezo: a.vanKovetkezo,
        csere: minta.replacement ?? '—',
      });
    }

    return [...sorok.values()];
  }, [analysis, parties, identifiers, keziIdk, hivatalosIdk]);

  /**
   * VAN-E EGYÁLTALÁN MIT MENTENI — és ha nincs, MIÉRT nincs.
   *
   * Egy mentés gomb háromféleképpen lehet értelmetlen, és a három OKA
   * különbözik, tehát a magyarázat sem lehet közös. Egy néma, szürke gomb
   * mindhárom esetben ugyanazt üzenné („valamiért nem lehet”), pedig az első
   * kettőn a felhasználónak konkrét teendője van: megvárni a vizsgálatot,
   * vagy visszakapcsolni legalább egy nevet.
   *
   * A HARMADIK (sehol nincs csere) azért tiltás és nem figyelmeztetés: ha
   * minden nevet kikapcsoltak, a kimenet betűre azonos volna a bemenettel. Az
   * a fájl nem álnevesített irat, csak egy második példány — és mivel
   * „-alnevesitett” néven születne, pont annak látszana, ami nem.
   *
   * A `null` azt jelenti, hogy MEHET: így a hívó helyen a `title` egyetlen
   * kifejezéssel megadható, és nem kell külön logikát írni a gombra.
   */
  const mentesAkadaly: string | null = useMemo(() => {
    if (!analysis) return 'Előbb le kell futnia a vizsgálatnak: amíg nincs elemzés, nincs mit menteni.';
    if (revisionsBlocked)
      return 'Előbb a változáskövetést kell feloldani: a törölt szöveg különben szó szerint bent maradna a fájlban.';
    if (!tetelek.some((t) => t.cserelodik > 0))
      return 'Egyetlen találat sincs cserére kapcsolva, tehát a kimenet szóról szóra az eredeti irat lenne. Kapcsolj be legalább egy cserét a beállító lapon.';
    return null;
  }, [analysis, revisionsBlocked, tetelek]);

  /**
   * A vizsgálatról szóló mondat a „Mit cserélünk?” fülön.
   *
   * A modell futásáról CSAK a felismerés tud, és a beállító lapon nincs más
   * hely, ahol ez kimondható volna. Márpedig ez a különbség maga a kockázat:
   * modell nélkül csak azokat a neveket találtuk meg, amiket az irat
   * kifejezetten megnevez.
   */
  const vizsgalatUzenet =
    vizsgalat === 'hiba'
      ? (detectError ?? undefined)
      : detected
        ? detected.modelUsed
          ? detected.modelNote
          : `${detected.modelNote} A folyó szövegben szabadon említett nevekre nem kerestünk rá — azokat neked kell felvenned.`
        : undefined;

  /** Egy fél vagy azonosító módosítása a lapról, azonosító szerint. */
  const tetelValtoztat = (id: string, patch: Partial<PartyInput>, minta: TalaltTetel): void => {
    const talalt = (lista: PartyInput[]): boolean => lista.some((p) => p.id === id);
    if (talalt(parties)) {
      setParties(parties.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    } else if (talalt(identifiers)) {
      setIdentifiers(identifiers.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    } else {
      /*
        HIVATALOS SZEREPLŐ, akit a `runAnalysis` fűz be — még nincs sora a
        listáinkban. A módosítás pillanatában vesszük fel: innentől a
        kifejezetten átadott sor az erősebb, tehát a kézi csereszöveg
        érvényesül, a befűzés pedig nem duplázza meg (azonosító szerint kihagyja).
      */
      const hivatalos = (detected?.officials ?? []).find((o) => o.id === id);
      if (hivatalos) {
        setParties([...parties, { ...stripDetection(hivatalos), ...patch }]);
      } else {
        /*
          A MOTOR SAJÁT KEZŰLEG FÖLVETT AZONOSÍTÓJA — nincs sora egyik listánkban
          sem. Ilyenkor pótoljuk: a motor a kifejezetten átadott sort erősebbnek
          veszi a magáénál, tehát a kézi csereszöveg érvényesül.

          Csak névfajtát veszünk fel: az összeg és a dátum sora nem fél, azt a
          saját kapcsolója és a találatonkénti döntés kezeli.
        */
        const fajta: PartyInput['kind'] =
          minta.fajta === 'amount' || minta.fajta === 'date' || minta.fajta === 'hivatalos'
            ? 'identifier'
            : minta.fajta;
        setIdentifiers([
          ...identifiers,
          { id, kind: fajta, fullName: minta.eredeti, gender: 'N', role: minta.szerep, ...patch },
        ]);
      }
    }
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  const setupCsereSzoveg = (id: string, szoveg: string): void => {
    const minta = tetelek.find((t) => t.id === id);
    if (!minta) return;
    // ÜRES SZÖVEG = vissza az alapértelmezetthez. A mező kiürítése különben üres
    // álnevet adna, és a mondat helyén hézag maradna.
    tetelValtoztat(id, { manualReplacement: szoveg.trim() === '' ? undefined : szoveg }, minta);
  };

  /* ─────────── a sor három gombja: mind / következő / nincs csere ─────────── */

  /**
   * A SOR DÖNTÉSE TALÁLATONKÉNT ÍRÓDIK BE, nem félre szólóan.
   *
   * Ez nem részletkérdés. A régi kapcsoló a FÉL `skipped` mezőjét állította, és
   * abból csak két állás létezett: mindent vagy semmit. Az iratban viszont
   * ugyanaz a szó egyszer név, másszor köznév — a „Szabó” az egyik mondatban a
   * II. r. alperes, a másikban ige. Találatonkénti döntéssel a felhasználó
   * pontosan ezt tudja kimondani, és a döntés ugyanabban a tárolóban
   * (`decisions`) landol, amit az iratra kattintás is használ. Egyetlen igazság,
   * két bejárati ajtó.
   *
   * A HIVATALOS SZEREPLŐK is ezen az úton mennek: nekik nem kell külön
   * `skipped` mezőt kezelni, tehát a befűzésük egyetlen ponton (a `runAnalysis`
   * elején) marad.
   */
  const dontesekre = (id: string, valtozas: (matchId: number) => 'accept' | 'skip' | null): void => {
    if (!analysis) return;
    const next = { ...decisions };
    for (const m of analysis.matches) {
      if (m.entityId !== id) continue;
      const d = valtozas(m.id);
      if (d === null) continue;
      next[m.id] = d;
    }
    setDecisions(next);
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  const setupMind = (id: string): void => {
    // Az összeg és a dátum FAJTAKAPCSOLÓJA is átbillen: a találatonkénti
    // döntés önmagában működne, de a kapcsoló a képernyőn kikapcsolva maradna,
    // és az új találatok (más csere-mód, újraszámolás) megint kimaradnának.
    if (id === '#osszeg') setReplaceAmounts(true);
    if (id === '#datum') setShiftDates(true);
    dontesekre(id, () => 'accept');
  };

  const setupNincs = (id: string): void => {
    if (id === '#osszeg') setReplaceAmounts(false);
    if (id === '#datum') setShiftDates(false);
    dontesekre(id, () => 'skip');
  };

  /**
   * A KÖVETKEZŐ ELŐFORDULÁS — és az irat oda is görög.
   *
   * A döntés és a mondat, amiről szól, egyszerre kell hogy látszódjon: aki
   * egyesével dönt, azért teszi, mert a szövegkörnyezet számít. A kijelölés
   * (`setSelected`) az, amitől a bal oldali nézet odagörget.
   */
  const setupKovetkezo = (id: string): void => {
    if (!analysis) return;
    const kovetkezo = analysis.matches.find(
      (m) => m.entityId === id && matchOutcome(m) !== 'csere',
    );
    if (!kovetkezo) return;
    if (id === '#osszeg') setReplaceAmounts(false);
    if (id === '#datum') setShiftDates(false);
    setSelected(kovetkezo.id);
    setDecisions({ ...decisions, [kovetkezo.id]: 'accept' });
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  /*
    A `setupMindentCserel` INNEN KIKERÜLT.

    A „Mindent cserélünk" gombot szolgálta ki, az pedig a lap alján álló „Mehet
    a csere" gombtól volt megkülönböztethetetlen. Amit tudott — minden döntés
    eldobása és a bizonytalanok elfogadása — alapállásban amúgy is érvényes
    (`autoModeForDoc`), a visszakapcsolást pedig a sorok „Mind" gombja és a
    csoportok fejléckapcsolója végzi, ott, ahol a hatása is látszik.
  */

  /**
   * KATTINTÁS AZ IRATON: ki-be kapcsolja EGY előfordulás cseréjét.
   *
   * Ugyanabba a tárolóba ír, mint a lista gombjai, tehát a két felület nem
   * mondhat mást. Csendben számol újra (a beállító lapon a `ujraKert` fátyol
   * nélkül fut): a felhasználó a saját kattintásának hatását nézi a szövegen,
   * nem egy villanó réteget.
   */
  const iratKattintas = (matchId: number): void => {
    if (!analysis) return;
    const m = analysis.matches.find((x) => x.id === matchId);
    if (!m) return;
    setSelected(matchId);
    setDecisions({ ...decisions, [matchId]: matchOutcome(m) === 'csere' ? 'skip' : 'accept' });
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  const setupBeallitas = (valtozas: Partial<DokumentumBeallitasok>): void => {
    if (valtozas.mode !== undefined) setMode(valtozas.mode);
    if (valtozas.themeId !== undefined) setThemeId(valtozas.themeId);
    if (valtozas.labelLang !== undefined) setLabelLang(valtozas.labelLang);
    if (valtozas.autoThreshold !== undefined) setAutoThreshold(valtozas.autoThreshold);
    if (valtozas.keepKey !== undefined) setKeepKey(valtozas.keepKey);
    if (valtozas.replaceAmounts !== undefined) setReplaceAmounts(valtozas.replaceAmounts);
    if (valtozas.shiftDates !== undefined) setShiftDates(valtozas.shiftDates);
    if (valtozas.replaceOfficials !== undefined) {
      setReplaceOfficials(valtozas.replaceOfficials);
      /*
        A TALÁLATONKÉNTI DÖNTÉSEKET ELDOBJUK — és ez nem óvatoskodás.

        A találat azonosítója az iratbeli SORRENDJE (`addRow`,
        src/app/session.ts): a bíró nevének felvételével a mögötte álló
        találatok azonosítója eggyel-kettővel elcsúszik. A `decisions` viszont
        erre az azonosítóra hivatkozik, tehát a megőrzött döntések a csúszás
        után MÁS SZAVAKRA vonatkoznának — épp arra a kimondott „ne cseréld"
        döntésre, amivel a felhasználó egy nevet bent akart hagyni.

        Egy elveszett kattintás bosszantó; egy másik szóra átcsúszott döntés
        néma hiba a kész iratban. Ezért itt a felejtés a helyes.
      */
      setDecisions({});
      /*
        KIKAPCSOLÁSKOR A BEFŰZÖTT SOROKAT IS ELVISSZÜK.

        Akinek közben átírták a csereszövegét, az bekerült a `parties` közé —
        onnan a `runAnalysis` már nem tudja kihagyni, mert a kifejezetten
        átadott sor az erősebb. Ha itt nem takarítanánk, a kapcsoló
        kikapcsolása után a bíró neve továbbra is cserélődne, miközben a
        képernyőn a kapcsoló „Ki” állásban áll.
      */
      if (!valtozas.replaceOfficials) {
        const hivatalosIdk = new Set((detected?.officials ?? []).map((o) => o.id));
        if (parties.some((p) => hivatalosIdk.has(p.id))) {
          setParties(parties.filter((p) => !hivatalosIdk.has(p.id)));
        }
      }
    }
    /*
      A KULCSFÁJL az egyetlen, ami NEM indít újraszámolást: az a mentés
      beállítása, nem a cseréé — a kimenet szövege tőle nem változik. Egy
      fölösleges kör itt csak annyit érne, hogy a lap a semmiért akadna meg.
    */
    const csakKulcs =
      Object.keys(valtozas).length === 1 && Object.keys(valtozas)[0] === 'keepKey';
    if (!csakKulcs) ujraKert();
  };

  /** Nevet veszek fel kézzel — a Felek-párbeszéd, most már kérésre. */
  const keziFelvitel = (): void => setDialog('parties');

  /** Vizsgálat újra — a kézzel felvitt neveket megőrizve. */
  const ujraVizsgalat = (): void => {
    const felismertek = new Set((detected?.parties ?? []).map((d) => d.id));
    keziekRef.current = parties.filter((p) => !felismertek.has(p.id));
    void startScan();
  };

  /**
   * TOVÁBBLÉPÉS A BEÁLLÍTÓ LAPRÓL.
   *
   * Három dolog történik, ebben a sorrendben. Először a beállítások mennek
   * lemezre: innentől ezekkel nyílik a következő irat is. Utána MINDIG lefut egy
   * elemzés — akkor is, ha közben nem változott semmi. Ez az egyetlen pont,
   * ahol a felhasználó kifejezetten munkára számít („Mehet a csere"), és az
   * egyetlen, ahol biztosra kell menni: egy még be nem fejezett csendes
   * számolásból a mentés a beállítás ELŐTTI iratot vinné fájlba.
   *
   * Végül az út dönt: kérdezés nélkül a mentés ablaka jön, egyébként a munkalap,
   * ahol a bizonytalan találatokat egyenként végig lehet nézni.
   */
  const setupTovabb = async (mentesre = false): Promise<void> => {
    if (ujraIdoRef.current !== null) {
      window.clearTimeout(ujraIdoRef.current);
      ujraIdoRef.current = null;
    }
    void api
      .setUiState?.({
        iratBeallitas: {
          themeId,
          mode,
          keepKey,
          autoThreshold: autoThreshold ?? DEFAULT_THRESHOLD,
          replaceAmounts,
          shiftDates,
          labelLang,
          /*
            A `replaceOfficials` SZÁNDÉKOSAN NINCS ITT.

            Minden más beállítás azzal az értékkel nyílik meg a következő
            iraton, amivel a felhasználó legutóbb dolgozott — ez a
            kényelem. A hivatalos szereplők cseréje viszont jogszabályi
            következménnyel jár (Bszi. 166. § (2)): aki egyszer egy belső
            feljegyzéshez bekapcsolta, holnap egy bíróságra menő határozatot
            nyitna meg vele, és semmi nem szólna róla.
          */
        },
      })
      ?.catch(() => {
        // A meg nem jegyzett beállítás erre az iratra akkor is érvényes: a
        // felhasználó döntött, ezt nem írjuk felül egy hibaüzenettel.
      });
    /*
      AZ `autoMode` MENTÉSE INNEN KIKERÜLT.

      Amíg volt „kérdezés nélkül menjen végig" kapcsoló a lapon, ez a sor a
      felhasználó DÖNTÉSÉT írta vissza. A kapcsoló megszűnt (helyette a
      „Mindent cserélünk" gomb áll a listán), tehát a mező már nem a
      felhasználóé — ha innen mégis írnánk, a mentés utáni jelentésből
      visszalépő „nézzük át" út (`switchToReview`) csendben MINDEN további
      iratra átállítaná a program alapállását, egyetlen kapcsoló nélkül, amin
      ezt vissza lehetne venni.
    */
    setHasWork(true);
    // A továbblépés maga is döntés: innentől a másik irat megnyitása
    // elveszíthető munkát dob el, tehát kérdeznie kell.
    setSajatDontes(true);
    setFazis('munka');

    const kesz = await runAnalysis(
      parties,
      themeId,
      mode,
      decisions,
      identifiers,
      autoModeForDoc,
      undefined,
      false,
    );
    // Elemzés nélkül nincs mit menteni: a munkalap ilyenkor kimondja, hogy
    // egyetlen nevet sem cserélünk, és visszavezet ide. A mentés ablakát
    // fölnyitni fölötte azt hazudná, hogy van kész irat.
    if (!kesz) return;
    /*
      A „MEHET A CSERE" UTÁN NEM NYITJUK KI MAGÁTÓL A MENTÉST.

      Eddig igen: kérdezés nélküli úton a beállító lapról egyenesen a mentés
      ablaka jött föl. Az az ablak viszont nem a csere eredményét mutatja,
      hanem KÉRDEZ — fájlnevet, kulcsfájlt, jelszót —, méghozzá azelőtt, hogy a
      felhasználó egyetlen pillantást vethetett volna arra, amit a program
      csinált. A gomb felirata („Mehet a csere") azt ígéri, hogy a csere
      következik, nem a mentés.

      Innentől a csere után a MUNKALAP jön: ott áll az irat a kiemelésekkel, az
      előnézet, a találatlista és a mentés gombja. Menteni egy kattintás — de a
      felhasználó dönti el, mikor.

      A `mentesre` továbbra is átvisz: azt a Ctrl+S és a menü „Mentés
      másként…" pontja adja át, vagyis ott a felhasználó KIFEJEZETTEN menteni
      akart, csak épp a beállító lapon állt.
    */
    if (!mentesre) return;
    /*
      A FELOLDATLAN VÁLTOZÁSKÖVETÉS ITT IS BLOKKOL.

      Ide akkor jutunk, ha a felhasználó a megnyitáskor válasz nélkül zárta be
      a változáskövetés kérdését, majd végigment a beállító lapon. A mentés
      ablakát fölnyitni fölötte azt ígérné, hogy van mit menteni — pedig a
      <w:del> elemek szó szerint őrzik az eredeti szöveget, és a mentés úgyis
      elakadna. A feloldás HELYÉT nyitjuk ki helyette, nem egy hibaüzenetet:
      itt dönteni kell, nem tudomásul venni.
    */
    if (revisionsBlocked) {
      setDialog('revisions');
      return;
    }
    // A mentés az a pont, ahol a felhasználó átveszi: a fájlnév, a kulcsfájl
    // és a jelszó az ő döntése marad.
    setExportResult(null);
    setDialog('export');
  };

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          {/* `alt=""`: a jel díszítő, a program neve közvetlenül mellette áll
              szövegként — felolvasva a „Szivecske Szivecske” csak zaj volna. */}
          <img src={markUrl} alt="" />
          Szivecske
          <span className="sub">Anonimizáló</span>
        </div>
        {/*
          A FÁJLNÉV NEM A FEJLÉCBEN ÁLL.

          Az irat neve oda tartozik, ahol maga az irat van: a dokumentumpanel
          fejlécére. A programfejlécen ugyanez harmadszor szerepelt volna
          (a panel fejléce és a vizsgálat képernyője mellett), és pont abból a
          sávból vett el helyet, ahol a műveleti gombok és a modell jelzése áll.
        */}
        <div className="spacer" />
        {/*
          MŰVELETI GOMBOK A FEJLÉCBEN — csak megnyitott irat mellett.

          Irat nélkül a megnyitást a nyitóképernyő nagy gombja végzi, menteni
          pedig nincs mit: két szürke ikon a fejlécben csak azt kérdeztetné
          meg, mikor élednek föl.

          MINDKÉT GOMB A MENÜ ÚTJÁT HÍVJA (`handleMenu`), nem egy másolt
          műveletet. Így a fejléc, a menüsor és a Ctrl+O / Ctrl+S ugyanazon az
          egyetlen elágazáson megy át — beleértve azt is, hogy a beállító
          lapon a mentés parancs TOVÁBBLÉPÉST jelent, és hogy a megnyitás
          előbb rákérdez, ha van elveszíthető munka. Egy párhuzamos út itt
          garantáltan elcsúszna a menütől, és a felhasználó két különbözőt
          kapna ugyanarra a szándékra.
        */}
        {doc && (
          <div className="titleacts">
            <button
              className="btn ghost icon"
              onClick={() => handleMenu('open')}
              title="Másik irat megnyitása (Ctrl+O)"
              aria-label="Másik irat megnyitása"
            >
              <FejlecIkon nev="megnyitas" />
            </button>
            {/*
              EGY mentés gomb áll itt, nem kettő.

              A program soha nem írja felül a megnyitott iratot: a mentés
              MINDIG új fájlba megy, és mindig a Windows „Mentés másként”
              ablakával kérdezi meg, hova (lásd `doExport`). „Mentés” és
              „mentés másként” tehát ugyanaz az egyetlen művelet — két gomb
              ugyanarra azt tanítaná az ügyvédnek, hogy az egyik felülírja az
              eredeti iratot. Egy jogi iraton ez pont az a félreértés, amit
              nem szabad megengedni, ezért a felirat is azt mondja, ami
              történik.
            */}
            <button
              className="btn ghost icon"
              disabled={mentesAkadaly !== null}
              onClick={() => handleMenu('save')}
              title={
                mentesAkadaly ??
                'Mentés másként: az álnevesített irat új fájlba kerül, az eredeti érintetlen marad (Ctrl+S)'
              }
              aria-label="Mentés másként"
            >
              <FejlecIkon nev="mentes" />
            </button>

            <div className="titlesep" />

            {/*
              A MEGSZŰNT LÉPÉSSÁV KÉT MŰVELETE.

              Mindkettő CSAK ott volt elérhető, és mindkettő a munkalapon
              kellett — a beállító lapon viszont nem is látszott. A fejléc
              mindhárom állomáson ott van, tehát innentől mindenhonnan
              elérhetők.

              A találatok lapja csak a munkalapról értelmes: ott VISSZAvisz.
              A beállító lapon állva ugyanaz a gomb önmagára mutatna.
            */}
            {fazis === 'munka' && (
              <button
                className="btn ghost icon"
                onClick={() => setFazis('beallitas')}
                title={`Beállítások és találatok: mit cseréljünk, és mire — ${MODE_LABEL[mode]}${
                  mode === 'theme' ? ` · ${themes.find((t) => t.id === themeId)?.name ?? '—'}` : ''
                } · ${tetelek.length} név`}
                aria-label="Beállítások és találatok"
              >
                <FejlecIkon nev="iratbeallitas" />
              </button>
            )}
            <button
              className="btn ghost icon"
              onClick={requestNewCase}
              title="Új ügy: új álnév-kiosztással indul (a Fájl menüben is)"
              aria-label="Új ügy"
            >
              <FejlecIkon nev="ujugy" />
            </button>
          </div>
        )}

        {/*
          AMIT A PROGRAM DÖNTÖTT EMBER HELYETT — a jelzés a mentésig kint marad.

          A lista a mentés utáni ablakban is előjön, de aki a mentést
          megszakítja, ugyanígy ott áll egy irattal, amiben döntöttek helyette —
          akkor sem szabad, hogy ez a tény eltűnjön a képernyőről.
        */}
        {doc && autoDecidedCount > 0 && (
          <button
            className="btn ghost sm jelzes"
            onClick={() => setDialog('autoReport')}
            title="A program ember helyett fogadta el ezeket a bizonytalan találatokat. Kattints: melyek ezek, és hol cserélhetett köznevet."
          >
            <FejlecIkon nev="dontottunk" />
            <span className="btnszo">{autoDecidedCount}× döntöttünk helyetted</span>
          </button>
        )}

        {/* A blokkoló állapot LÁTSZIK is, nemcsak tilt: a letiltott mentés
            gomb magában csak annyit üzen, hogy „valamiért nem lehet". */}
        {doc && revisionsBlocked && (
          <button
            className="btn ghost sm jelzes gond"
            onClick={() => setDialog('revisions')}
            title="A feloldatlan változáskövetés miatt nem menthető. Kattints: itt lehet feloldani."
          >
            <FejlecIkon nev="figyelem" />
            <span className="btnszo">{doc.pendingRevisions} feloldatlan módosítás</span>
          </button>
        )}
        {/*
          A MODELL HIÁNYA MINDHÁROM ÁLLOMÁSON LÁTSZIK.

          Eddig a lépéssávban állt, vagyis csak a munkalapon — aki a beállító
          lapon nézte át a találatokat, semmit nem tudott arról, hogy a lista
          azért ilyen rövid, mert a nyelvi modell el sem indult. A fejléc végig
          ott van, ezért a jelzés innentől a mentésig kint marad.
        */}
        {detected && detected.model.state !== 'ok' && (
          <button
            className="btn ghost sm"
            style={MODEL_CHIP[detected.model.state].loud ? { color: 'var(--amber)' } : undefined}
            title={MODEL_CHIP[detected.model.state].title}
            onClick={() => openSettings('models')}
          >
            {MODEL_CHIP[detected.model.state].t}
          </button>
        )}
        {/*
          A „NÉVKÉSZLETEK…” GOMB INNEN KIKERÜLT.

          Ugyanazt a döntést nyitotta meg, amit a beállító lap is állított —
          csak másik kinézettel és egy külön ablakban. A készletek kezelése
          (böngészés, nyelvváltás, hozzáadás, törlés) hiánytalanul átkerült a
          lap „Mire cseréljük?” fülére, tehát nincs mit külön elérhetővé tenni:
          egy gomb, ami ugyanoda visz, ahol a felhasználó amúgy is jár, csak
          azt sugallná, hogy két különböző dologról van szó.
        */}
        {/* A felirat KÜLÖN elemben áll, mert keskeny ablakban ez tűnik el
            elsőként a gombok közül — a fogaskerék magában is érthető, és a
            hely a műveleti gomboké. A `title` ilyenkor is kimondja a nevét. */}
        {/* `aria-label` KELL: keskeny ablakban a felirat elrejtve marad, és a
            képernyőolvasó a puszta „⚙” jelből nem mond ki semmit. */}
        <button
          className="btn ghost sm"
          onClick={() => openSettings('models')}
          title="A program beállításai és a nyelvi modellek"
          aria-label="A program beállításai és a nyelvi modellek"
        >
          <FejlecIkon nev="programbeallitas" />
          <span className="btnszo">Beállítások</span>
        </button>
      </header>

      {/*
        A LÉPÉSSÁV MEGSZŰNT.

        Öt dolog állt benne, és három közülük SZÓ SZERINT ugyanaz volt, ami a
        fejlécben: a megnyitás, a mentés és a beállítások. A felhasználó
        jelezte is — egy sávnyi hely ment el arra, hogy a képernyő két pontján
        ugyanazt a három gombot kínáljuk.

        Ami CSAK ott volt, az a fejlécbe költözött, nem veszett el:
          - „Beállítások és találatok" → a fejléc csúszkás ikonja,
          - „Új ügy" → a fejléc csillagos ikonja (a Fájl menüben is megvan),
          - „N× döntöttünk helyetted" → a fejléc jelzése, ugyanazzal az ablakkal,
          - a feloldatlan változáskövetés → a fejléc borostyán jelzése.

        A helye is jobb lett: a fejléc MINDHÁROM állomáson ott van, a lépéssáv
        csak a munkalapon volt — az „Új ügy" tehát épp a beállító lapon, a
        leghosszabb munkaszakaszban nem látszott.
      */}

      {!doc && nyitandoNev === null && (
        <Welcome
          onOpen={openDocument}
          onDropFiles={openDropped}
          modellHiany={modellHiany}
          onOpenModels={() => openSettings('models')}
        />
      )}

      {(doc || nyitandoNev !== null) && fazis === 'vizsgalat' && (
        <VizsgalatKepernyo
          fajlNev={doc?.fileName ?? nyitandoNev ?? ''}
          kep={vizsgalatKep}
          allapot={vizsgalat}
          haladas={haladas}
          hiba={detectError}
          leallithato={leallithato}
          valtozaskovetes={revisionsBlocked && doc ? doc.pendingRevisions : 0}
          onValtozaskovetes={() => setDialog('revisions')}
          talalatok={parties.length + identifiers.length}
          onIndit={() => void startScan()}
          onLeallit={() => {
            // A leállítás UTÁN a `detectParties` rendben teljesül, csak
            // kevesebbet tud: nincs mit külön elvarrni. A gombot viszont azonnal
            // levesszük, hogy ne lehessen másodszor rákattintani.
            setLeallithato(false);
            void api.cancelDetect?.().catch(() => {
              // Ha nem sikerült leállítani, a vizsgálat magától befejeződik: a
              // képernyő ugyanoda visz tovább.
            });
          }}
          onKeziFelvitel={keziFelvitel}
          onTovabb={() => {
            setVizsgalatKep('var');
            setFazis('beallitas');
          }}
        />
      )}

      {/*
        A BEÁLLÍTÓ LAP KÉT PANELBŐL ÁLL: BALRA AZ IRAT, JOBBRA A DÖNTÉSEK.

        Eddig egy középre igazított kártya állt itt, az irat pedig sehol nem
        látszott: a felhasználó úgy állította be a csere módját és a
        névkészletet, hogy közben nem látta, mihez. A bal panel ugyanaz a
        `DocumentView`, ami a munkalapon is áll — a megtalált nevek ki vannak
        emelve, tehát minden beállításváltozás következménye AZONNAL látszik a
        szövegen (az elemzés a lapon csendben újrafut).

        A két panel KÜLÖN GÖRGŐDIK. Ha az egész oldal görögne, a beállítások
        lába — vele a továbblépés gombja — elúszna az irat alján, és a
        felhasználó a saját kiútját keresné.
      */}
      {doc && fazis === 'beallitas' && (
        <div className="setuppage">
          <div className="setupdoc">
            <div className="setupdoc-head">
              <b>{doc.fileName}</b>
              {analysis ? (
                <>
                  {/* A JELMAGYARÁZAT a kiemelés színeit köti a döntéshez.
                      Enélkül a rózsaszín és a borostyán csak dísz volna, és a
                      felhasználó nem tudná, mit néz. */}
                  {/*
                    A JELMAGYARÁZAT KÉT DOLGOT MAGYARÁZ, mert a kiemelés is
                    kettőt mond egyszerre.

                    A FEDETTSÉG a kimenet: kitöltve = lecseréljük, csak
                    aláhúzva = marad. A SZÍN a fajta: név, összeg, dátum,
                    hivatalos szereplő. Négy szín és három fedettség
                    magyarázat nélkül csak tarkaság volna — így viszont
                    egyetlen pillantással látszik, hogy egy bekarikázott szám
                    összeg-e vagy dátum, és hogy egy név a feleké-e vagy az
                    eljáró bíróé.

                    A SZÁMOK UGYANAZOKBÓL A FÜGGVÉNYEKBŐL jönnek, amelyekből a
                    színek (`matchOutcome`, `matchKind`), tehát a
                    jelmagyarázat nem mondhat mást, mint amit a szemünk lát.
                  */}
                  <span className="jelek">
                    {jelmagyarazat.map((j) => (
                      <span key={j.kulcs} className={`jel ${j.osztaly}`} title={j.sugo}>
                        {j.cimke} · {j.db}
                      </span>
                    ))}
                  </span>
                  <span className="spacer" />
                  <span className="db">{analysis.matches.length} találat</span>
                </>
              ) : null}
            </div>
            {analysis ? (
              /*
                AZ IRAT ITT NEM NÉZET, HANEM VEZÉRLŐ.

                Eddig a beállító lap bal oldala csak mutatta, mihez fogunk
                nyúlni: a kiemelésekről le volt véve a kattintáskezelő. A
                felhasználó tehát látta a kérdést („ez itt tényleg név?”), a
                választ viszont a képernyő MÁSIK felén, a listában kellett
                megkeresnie hozzá. Innentől a kiemelésre kattintva egyetlen
                előfordulás cseréje kapcsolható ki-be — ugyanabba a tárolóba,
                amit a lista gombjai is írnak.
              */
              <DocumentView
                analysis={analysis}
                selected={selected}
                hivatalosIdk={hivatalosIdk}
                onSelect={setSelected}
                onToggle={iratKattintas}
              />
            ) : (
              <div className="viewport source">
                <div className="empty">
                  <div className="big">◌</div>
                  <p>
                    Ebben az iratban még egyetlen név sincs megjelölve. A jobb oldali „Mit cserélünk?”
                    fülön indíthatod újra a vizsgálatot, vagy vehetsz fel nevet kézzel.
                  </p>
                </div>
              </div>
            )}
          </div>

          <DocumentSetup
            beallitasok={beallitasok}
            temak={themes}
            tetelek={tetelek}
            bentMaradok={detected?.keepList ?? []}
            // Régebbi hídon nincs `officials`: ilyenkor a kapcsoló meg sem
            // jelenik. Egy gomb, ami semmit nem tud lecserélni, rosszabb, mint
            // a hiánya — a felhasználó azt hinné, bekapcsolta.
            hivatalosCserelheto={(detected?.officials ?? []).length > 0}
            vizsgalat={vizsgalat}
            // A modellsáv gombjai futó vizsgálat alatt tiltottak: egy második
            // indítás vagy egy modellváltás menet közben az elsőt dobná el.
            vizsgalatFut={vizsgalatKep === 'fut'}
            {...(vizsgalatUzenet === undefined ? {} : { vizsgalatUzenet })}
            onBeallitas={setupBeallitas}
            onCsereSzoveg={setupCsereSzoveg}
            onMind={setupMind}
            onKovetkezo={setupKovetkezo}
            onNincs={setupNincs}
            onUjraVizsgalat={ujraVizsgalat}
            onKeziFelvitel={keziFelvitel}
            onUjKeszlet={() => setDialog('sajatKeszlet')}
            onKeszletTorles={(id) => void removeCustomTheme(id)}
            onTovabb={() => void setupTovabb()}
          />
        </div>
      )}

      {doc && fazis === 'munka' && analysis && (
        <div className="workspace">
          <div className="docarea">
            {/*
              Előnézet: eddig a szövegnézet az EREDETIT mutatta kiemelésekkel, és
              a felhasználó a mentés pillanatáig nem látta, mi lesz a kimenet.
            */}
            <div className="viewtabs">
              {/* A FÁJLNÉV ITT ÁLL, nem a programfejlécben: az irat neve oda
                  tartozik, ahol maga az irat van. A beállító lap bal panelének
                  fejlécén ugyanígy szerepel. */}
              <div className="docname" title={doc.path}>
                <b>{doc.fileName}</b>
                <span>
                  {doc.format.toUpperCase()} · {doc.pageCount} oldal
                </span>
              </div>
              <div className="seg">
                <button
                  className={`segbtn${view === 'source' ? ' active' : ''}`}
                  onClick={() => setView('source')}
                >
                  Eredeti — kiemelve
                </button>
                <button
                  className={`segbtn${view === 'preview' ? ' active' : ''}`}
                  onClick={() => setView('preview')}
                >
                  Előnézet — ez kerül a fájlba
                </button>
              </div>
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => void doPrint()} title="Ctrl+P">
                Nyomtatás…
              </button>
            </div>
            {/* Külön sorban, teljes szélességben: a nézetváltó mellé zsúfolva
                keskeny ablakon négy sorba tört, és feltolta a fejlécet. */}
            {view === 'preview' && analysis.doc.format === 'pdf' && (
              <div className="viewbanner">
                A PDF tördelését az előnézet nem mutatja, csak a szöveget — a mentett fájl az
                eredeti tördelést megtartja.
              </div>
            )}
            {view === 'source' ? (
              <DocumentView
                analysis={analysis}
                selected={selected}
                hivatalosIdk={hivatalosIdk}
                onSelect={setSelected}
              />
            ) : (
              <PreviewView analysis={analysis} text={preview} error={previewError} />
            )}
          </div>
          <CastPanel
            analysis={analysis}
            selected={selected}
            onSelect={setSelected}
            onDecide={decide}
            reviewFocus={reviewFocus}
          />
        </div>
      )}

      {/*
        ELEMZÉS NÉLKÜL NINCS CSERE — és ezt ki kell mondani.

        Ide akkor jutunk, ha a beállító lapról egyetlen név nélkül léptek
        tovább: a vizsgálat nem talált semmit, meg lett szakítva, vagy ki volt
        kapcsolva. A régi képernyő ilyenkor csak annyit kérdezett, hogy „ki
        szerepel az iratban?" — abból nem derült ki, hogy a mentés EBBEN A
        PILLANATBAN az érintetlen iratot vinné fájlba.
      */}
      {doc && fazis === 'munka' && !analysis && (
        <div className="welcome">
          <div className="welcome-card">
            <h1>Nincs mit lecserélni</h1>
            <p className="lead">
              Ebben az iratban egyetlen nevet sem jelöltünk cserére, tehát a mentés a szöveget
              változatlanul vinné tovább. Vagy vedd fel a neveket kézzel, vagy nézd át újra a
              beállításokat.
            </p>
            <div className="ds-acts" style={{ justifyContent: 'center' }}>
              <button className="btn ghost" onClick={() => setFazis('beallitas')}>
                Vissza a beállításokhoz
              </button>
              <button className="btn primary" onClick={keziFelvitel}>
                Nevet veszek fel kézzel
              </button>
            </div>
          </div>
        </div>
      )}

      {doc && fazis === 'munka' && analysis && (
        <footer className="statusbar">
          {/* A KIMENET SZÁMAI, nem a felismerés fokozatai: az állapotsor arra a
              kérdésre válaszol, hogy mi lesz az irattal. Régebbi motor
              (`outcomes` nélkül) esetén a fokozatokra esünk vissza — az kevesebbet
              mond, de nem hazudik. */}
          <span>
            <b>{analysis.outcomes?.csere ?? analysis.counts.auto}</b> lecserélve
          </span>
          <span className="sep" />
          {/* Kérdezés nélküli úton EGYETLEN találat sem vár átnézésre — azokat
              a program eldöntötte. A régi mondat itt azt állítaná, hogy a
              felhasználóra vár munka, holott a döntés már megtörtént, csak nem
              ő hozta. */}
          <span>
            {autoDecidedCount > 0 ? (
              <>
                <b>{autoDecidedCount}</b> találatról a program döntött
              </>
            ) : (
              <>
                <b>{analysis.outcomes?.bizonytalan ?? analysis.counts.review}</b> átnézésre vár
              </>
            )}
          </span>
          <span className="sep" />
          <span>
            <b>{analysis.outcomes?.nincs ?? analysis.counts.reject}</b> nincs csere
          </span>
          <span className="sep" />
          <span>
            {analysis.doc.charCount.toLocaleString('hu-HU')} karakter átvizsgálva
          </span>
          {analysis.doc.looksScanned && (
            <>
              <span className="sep" />
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                Szkennelt irat — a szöveg nem olvasható ki, OCR még nincs
              </span>
            </>
          )}
          {analysis.doc.format === 'docx' && (
            <>
              <span className="sep" />
              <span>{analysis.doc.pageCount} dokumentumrész átvizsgálva</span>
            </>
          )}
        </footer>
      )}

      {/*
        A FELEK-PÁRBESZÉD MÁR NEM A FOLYAMAT ÁLLOMÁSA, hanem kérésre nyíló
        eszköz: akkor jön elő, ha a felhasználó KÉZZEL akar nevet felvinni —
        mert a vizsgálat félbemaradt, hibára futott, vagy nem talált meg
        valakit. Automatikusan soha nem nyílik ki: azt a munkát a beállító lap
        „Mit cserélünk?" füle végzi el, kitöltve.
      */}
      {dialog === 'parties' && (
        <PartiesDialog
          parties={parties}
          identifiers={identifiers}
          detected={detected}
          detectError={detectError}
          onSave={saveParties}
          onClose={() => setDialog(null)}
          onOpenSettings={() => openSettings('models', 'parties')}
        />
      )}
      {/*
        A BEZÁRÁS KÉRDÉSE. A válasz MINDIG visszamegy a főfolyamatnak — az
        „Escape" és a fátyolra kattintás is —, különben ő az időzítőjéig várna,
        és utána a rendszerpárbeszéddel kérdezné meg ugyanazt másodszor.
      */}
      {dialog === 'exit' && (
        <ExitDialog
          onValaszt={(valasz) => {
            setDialog(null);
            void api.closeDecision?.(valasz)?.catch(() => {
              // Ha a híd nem ismeri, a főfolyamat időzítője úgyis átveszi.
            });
          }}
        />
      )}
      {dialog === 'revisions' && doc && (
        <RevisionsDialog
          count={doc.pendingRevisions}
          busy={busy !== null}
          onResolve={resolveRevisions}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'scanned' && doc && (
        <ScannedDialog
          fileName={doc.fileName}
          onContinue={() => {
            setDialog(null);
            void continueAfterOpen(doc);
          }}
          onOpenOther={() => {
            setDialog(null);
            void openDocument();
          }}
        />
      )}
      {dialog === 'loadWarnings' && doc && (
        <LoadWarningsDialog
          fileName={doc.fileName}
          warnings={doc.loadWarnings}
          onContinue={() => {
            setDialog(null);
            void startScan();
          }}
          onOpenOther={() => {
            setDialog(null);
            void openDocument();
          }}
        />
      )}
      {dialog === 'newCase' && (
        <NewCaseDialog onConfirm={startNewCase} onClose={() => setDialog(null)} />
      )}
      {dialog === 'openOther' && doc && (
        <OpenOtherDialog
          fileName={doc.fileName}
          onConfirm={() => {
            const p = pendingOpen?.path ?? null;
            setPendingOpen(null);
            setDialog(null);
            if (p) void openPath(p);
            else void openDocument();
          }}
          onClose={() => {
            setPendingOpen(null);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'sajatKeszlet' && (
        <SajatKeszletDialog
          // A gyártó modell letöltése a Beállításokban van; onnan IDE kell
          // visszatérni, különben a felhasználó a semmiben találja magát,
          // miután letöltötte azt, amiért odaküldtük.
          onOpenSettings={() => openSettings('models', 'sajatKeszlet')}
          onSaved={temaMentve}
          // Bezárva a beállító lap RÁCSA marad ott, ahonnan a gyártás indult:
          // az ablak mögött végig ott állt, tehát nincs hová visszavezetni.
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'update' && (
        <UpdateDialog vanMunka={hasWork} onClose={() => setDialog(null)} />
      )}
      {dialog === 'export' && (
        <ExportDialog
          pending={pendingCount}
          defaultKeepKey={keepKey}
          busy={busy !== null}
          result={exportResult}
          autoDecided={autoDecidedCount}
          // Csak akkor van visszaút, ha van miről visszatérni: átnézős úton a
          // gomb egy már megtett lépést kínálna újra.
          onReview={autoModeForDoc ? switchToReview : undefined}
          onExport={doExport}
          onReveal={(p) => void api.showItemInFolder(p)}
          onOpenKeyFile={(p) => {
            setKeyFilePath(p);
            setExportResult(null);
            setDialog('keyfile');
          }}
          onClose={() => {
            setDialog(null);
            setExportResult(null);
          }}
        />
      )}

      {dialog === 'keyfile' && (
        <KeyFileDialog initialPath={keyFilePath} onClose={() => setDialog(null)} />
      )}

      {dialog === 'autoReport' && (
        <AutoReportDialog
          rows={autoAccepted}
          onReview={switchToReview}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === "settings" && (
        <SettingsDialog
          initialTab={settingsTab}
          detected={detected}
          onClose={() => {
            setDialog(settingsBack);
            setSettingsBack(null);
            // A Beállításokban le lehetett tölteni vagy törölni a modellt: a
            // nyitóképernyő figyelmeztetése különben a régi állapotot mutatná,
            // vagyis épp azután állítana hiányt, hogy a felhasználó pótolta.
            void modellAllapotFrissit();
          }}
          /*
            CSAK A PROGRAMSZINTŰ ÉRTÉKET VESSZÜK ÁT.

            Az ablak a teljes beállításcsomagot adja vissza, benne az irat hat
            értékével is — azokat viszont SZÁNDÉKOSAN nem írjuk vissza. Az
            iratra a beállító lapon állított érték az érvényes, és ha ez az ág
            felülírná, a felhasználó a Beállítások becsukása után egy másik
            névkészlettel dolgozna tovább, mint amit a lapon látott. Ugyanaz a
            hiba, ami miatt a hat érték egyáltalán elköltözött innen.
          */
          onChanged={(s) => setAutoDetect(s.autoDetect)}
        />
      )}

      {busy && (
        <div className="busy">
          <div className="box">
            <span className="spinner" /> {busy}
          </div>
        </div>
      )}

      {error && (
        <div className="overlay" onMouseDown={() => setError(null)}>
          <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2>Hiba történt</h2>
            </div>
            <div className="dialog-body">
              <div className="note bad">{error}</div>
            </div>
            <div className="dialog-foot">
              <button className="btn primary" onClick={() => setError(null)}>
                Rendben
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── a vizsgálat képernyője ─────────────────────────── */

/**
 * A négy szakasz neve, sorrendben.
 *
 * NEM egy pörgő kör, mert a négy szakasz négy különböző okból tarthat sokáig: a
 * modell betöltése egyszeri, több száz megabájtos lemezművelet, a vizsgálat
 * viszont a szöveg hosszával nő. Aki látja, hogy „a nyelvi modell betöltése"
 * tart, tudja, hogy ez a rész a következő iratnál gyorsabb lesz; aki csak egy
 * mozdulatlan pörgőt lát, azt hiszi, megállt a program — és a tapasztalat
 * szerint ilyenkor lövi ki az egészet, a megnyitott irattal együtt.
 */
const SZAKASZOK: { id: DetectProgress['szakasz']; cim: string }[] = [
  { id: 'szoveg', cim: 'szöveg kiolvasása' },
  { id: 'modell', cim: 'modell betöltése' },
  { id: 'vizsgalat', cim: 'az irat átolvasása' },
  { id: 'osszesites', cim: 'összesítés' },
];

/**
 * A MEGNYITÁS UTÁNI VIZSGÁLAT KÉPERNYŐJE.
 *
 * Ez nem párbeszédablak: a folyamat állomása, ugyanabban a kártyában, mint a
 * beállító lap — a felhasználó lássa, hogy ugyanazon az úton halad, nem
 * ablakok közt ugrál.
 *
 * A KÉPERNYŐN MINDIG VAN KIÚT. Egy hosszú iraton a modell percekig dolgozhat, és
 * amíg a leállítás nem volt meg, a leggyakoribb reakció az volt, hogy a
 * felhasználó kilőtte az egész programot. A leállítás után viszont ugyanígy
 * zsákutca lenne egy üres lista: ezért a félbemaradt és a hibára futott
 * vizsgálat is három kattintható választ kap, nem egy tudomásulvételt.
 */
function VizsgalatKepernyo({
  fajlNev,
  kep,
  allapot,
  haladas,
  hiba,
  leallithato,
  valtozaskovetes,
  talalatok,
  onIndit,
  onValtozaskovetes,
  onLeallit,
  onKeziFelvitel,
  onTovabb,
}: {
  fajlNev: string;
  kep: VizsgalatKep;
  allapot: VizsgalatAllapot;
  haladas: DetectProgress | null;
  hiba: string | null;
  leallithato: boolean;
  /**
   * Hány feloldatlan változáskövetés van az iratban; 0, ha nincs.
   *
   * A vizsgálat ettől még lefut, a MENTÉS viszont nem — és ez az a képernyő,
   * ahova a felhasználó a válasz nélkül bezárt változáskövetés-kérdés után
   * érkezik. Ha itt hallgatnánk róla, a tény a mentés pillanatáig eltűnne, és
   * a felhasználó a teljes átnézés után szembesülne vele.
   */
  valtozaskovetes: number;
  /** Amennyit a szerkezeti felismerés a félbemaradt vizsgálatból is kihozott. */
  talalatok: number;
  onIndit: () => void;
  onValtozaskovetes: () => void;
  onLeallit: () => void;
  onKeziFelvitel: () => void;
  onTovabb: () => void;
}) {
  const megszakadt = allapot === 'megszakitva';

  /*
    AMÍG DOLGOZUNK, EGY CSENDES BETÖLTŐKÉPERNYŐ ÁLL ITT.

    Korábban ez is ugyanaz a kártya volt, mint a beállító lap: cím, bevezető
    mondat, magyarázó doboz, lábléc. Csakhogy ezen a képernyőn NINCS mit
    eldönteni — a felhasználó vár. Egy teleírt lap ilyenkor nem tájékoztat,
    hanem elolvasásra szólít fel olyasmit, amin úgysem tud változtatni, és
    közben elrejti azt az egy dolgot, ami számít: hogy halad-e a munka.

    Ami maradt: a fájl neve, egy folyamatjelző, a szakasz neve, és — hosszú
    iraton ez a lényeg — a leállítás. Semmi más.

    A MEGNYITÁS ÉS A VIZSGÁLAT UGYANEZ AZ EGY KÉPERNYŐ. A kettő között nincs
    átmenet, nincs villanás, nincs közbeiktatott „készen állunk” lap: a
    felhasználó egyetlen folyamatot lát a fájl megnyitásától a kész
    találatlistáig.
  */
  if (kep === 'nyit' || kep === 'fut') {
    const szakasz = SZAKASZOK.find((sz) => sz.id === haladas?.szakasz)?.cim;
    const arany = kep === 'fut' && haladas && haladas.arany !== null ? haladas.arany : null;
    return (
      <div className="loading">
        <div className="loading-in">
          {/* A jel forog: mozgás nélkül a képernyő megállt programnak látszik,
              és a felhasználó a leghosszabb szakasz közepén lövi ki. */}
          <img className="pulzus" src={markUrl} alt="" />
          <div className="fnev">{fajlNev}</div>
          <div className="mit">
            {kep === 'nyit' ? 'Megnyitás…' : (szakasz ?? 'Az irat átolvasása…')}
          </div>

          {/* HATÁROZOTT CSÍK CSAK MÉRHETŐ SZAKASZRA. A `null` arány nem nulla
              százalék: a nulla azt jelentené, hogy most kezdtük, a `null`
              viszont azt, hogy ebben a szakaszban nincs mit arányosítani. Egy
              kitalált százalékból a felhasználó rossz időt becsül. */}
          {arany === null ? (
            <div className="csik hatarozatlan">
              <div className="bar" />
            </div>
          ) : (
            <div className="progress">
              <div className="bar" style={{ width: `${Math.round(arany * 100)}%` }} />
              <span className="ptext">{Math.round(arany * 100)}%</span>
            </div>
          )}

          {/* A FELOLDATLAN VÁLTOZÁSKÖVETÉS ITT IS LÁTSZIK: a vizsgálat lefut
              tőle, a MENTÉS viszont nem — és ez az a képernyő, ahova a válasz
              nélkül bezárt kérdés után érkezünk. */}
          {valtozaskovetes > 0 && (
            <button className="ds-link" onClick={onValtozaskovetes}>
              {valtozaskovetes} feloldatlan módosítás — amíg ez fennáll, nem mentünk
            </button>
          )}

          {kep === 'fut' && leallithato && (
            <button className="btn ghost sm" onClick={onLeallit}>
              Leállítás
            </button>
          )}
        </div>
      </div>
    );
  }

  const cim =
    kep === 'var'
      ? 'Készen állunk a vizsgálatra'
      : megszakadt
        ? 'A vizsgálat félbemaradt'
        : 'A vizsgálat hibába futott';

  return (
    <div className="docsetup">
      <div className="ds-card">
        <div className="ds-head">
          <h2>{cim}</h2>
          <p>
            {kep === 'var' ? (
              <>
                Ez az irat van megnyitva: <b>{fajlNev}</b>. A vizsgálat magától indul, amint minden
                kérdésre megvan a válasz.
              </>
            ) : megszakadt ? (
              'Te állítottad le, ez rendben van. Csak azt kell tudni, hogy ami nem került elő, azt a program nem is cseréli le.'
            ) : (
              'A neveket ilyenkor kézzel kell felvinni — a keresés és a csere ugyanúgy működik utána.'
            )}
          </p>
        </div>

        <div className="ds-body">
          {valtozaskovetes > 0 && (
            <div className="note bad">
              <b>{valtozaskovetes} feloldatlan módosítás van az iratban.</b> A vizsgálat ettől még
              lefut, de amíg ez fennáll, <b>nem mentünk</b>: a törölt szöveg a fájlban szó szerint
              bent maradna.{' '}
              <button className="ds-link" onClick={onValtozaskovetes}>
                Feloldom most
              </button>
            </div>
          )}
          {/* A 'nyit' és a 'fut' ág INNEN KIKERÜLT: azokon nincs mit
              eldönteni, tehát nem kártya való nekik, hanem betöltőképernyő —
              lásd fentebb. Ez a kártya azé a két állapoté maradt, ahol a
              felhasználónak választania kell. */}
          {kep === 'var' && (
            <p className="hint">
              A vizsgálat a nyelvi modellel keresi meg a neveket az iratban. Ha egy kérdést válasz
              nélkül zártál be, innen indíthatod el.
            </p>
          )}

          {kep === 'allt' && (
            <>
              <div className={megszakadt ? 'note' : 'note bad'}>
                {megszakadt ? (
                  <>
                    <b>Ami a szerkezeti jelekből kiderült, megvan:</b> {talalatok} nevet és
                    azonosítót találtunk. Ami a folyó szövegben, szabadon említve szerepelt — egy
                    tanú neve egy mondat közepén —, azt a modell nem olvasta végig, tehát nem is
                    kerül a listára.
                  </>
                ) : (
                  <>
                    <b>A program nem tudta végigolvasni az iratot.</b>{' '}
                    {hiba ?? 'Ismeretlen hiba történt a felismerés közben.'}
                  </>
                )}
              </div>
              <p className="hint">
                Három út visz tovább, mindegyik egy kattintás: futtasd le újra a vizsgálatot, vedd
                fel kézzel a hiányzó neveket, vagy lépj tovább azzal, ami megvan.
              </p>
            </>
          )}
        </div>

        <div className="ds-foot">
          <div className="ds-sum">{talalatok} név és azonosító van eddig a listán.</div>
          <div className="ds-acts">
            {/* A „Másik iratot nyitok" gomb INNEN IS kikerült: a fejléc megnyitás
                ikonja végig ott van, ezen a képernyőn is, és ugyanoda vezet.
                Két gomb ugyanarra a műveletre azt kérdezteti meg, mi a
                különbség köztük. */}
            {kep === 'allt' && (
              <>
                <button className="btn ghost" onClick={onKeziFelvitel}>
                  Nevet veszek fel kézzel
                </button>
                <button className="btn ghost" onClick={onIndit}>
                  Vizsgálat újra
                </button>
                <button className="btn primary" onClick={onTovabb}>
                  Tovább a beállításokhoz
                </button>
              </>
            )}
            {kep === 'var' && (
              <button className="btn primary" onClick={onIndit}>
                Vizsgálat indítása
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A NYITÓKÉPERNYŐ HÁROM LÉPÉSÉNEK IKONJA — kézzel rajzolt SVG.
 *
 * Ugyanazért saját rajz, amiért a fejléc ikonjai (`FejlecIkon`): a program
 * offline fut, és három ábráért nem hozunk be sem hálózati betűkészletet, sem
 * több száz kilobájtnyi kötegelt ikoncsomagot. Emodzsi sem jó ide: azt a
 * rendszer betűkészlete rajzolja, gépenként másképp, és a színes emodzsi nem
 * veszi át a szöveg színét.
 *
 * `aria-hidden`: az ikon díszítés, a jelentést a mellette álló felirat
 * hordozza. Enélkül a képernyőolvasó a rajzot is bejelentené a szöveg mellé.
 */
function LepesIkon({ nev }: { nev: 'olvas' | 'keres' | 'cserel' }) {
  return (
    <svg
      className="lepesikon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {nev === 'olvas' ? (
        // Irat sorokkal: a program végigolvassa, amit kap.
        <>
          <path d="M5 2.75h6.4l3.85 3.85v10.65a.75.75 0 0 1-.75.75H5a.75.75 0 0 1-.75-.75V3.5A.75.75 0 0 1 5 2.75Z" />
          <path d="M11.2 2.9v3.8h3.8" />
          <path d="M6.9 10.2h6.2M6.9 13.1h6.2M6.9 15.9h3.6" />
        </>
      ) : nev === 'keres' ? (
        // Nagyító: a megtalálás lépése.
        <>
          <circle cx="8.9" cy="8.9" r="5.15" />
          <path d="m12.7 12.7 4 4" />
        </>
      ) : (
        // Két nyíl körben: a csere — az egyik alak helyére a másik kerül.
        <>
          <path d="M3.4 8.2a6.6 6.6 0 0 1 11.2-3.1l2 2" />
          <path d="M16.6 11.8a6.6 6.6 0 0 1-11.2 3.1l-2-2" />
          <path d="M13.2 7.1h3.4V3.7M6.8 12.9H3.4v3.4" />
        </>
      )}
    </svg>
  );
}

function Welcome({
  onOpen,
  onDropFiles,
  modellHiany,
  onOpenModels,
}: {
  onOpen: () => void;
  onDropFiles: (files: FileList | null) => void;
  /** `null`, amíg nem tudjuk; ilyenkor nem állítunk semmit. */
  modellHiany: { nev: string; hianyzik: boolean } | null;
  onOpenModels: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>
          {/* A mozaikos embléma a korábbi ♥ jel helyén. Ugyanaz a kép, ami a
              fejlécben és a tálcán — csak itt akkora (33px = 3 képpont
              kockánként), hogy a kitakarás maga is kivehető legyen. */}
          <img className="mark" src={markUrl} alt="" /> Szivecske
        </h1>
        {/*
          Tényközlés, nem ígéret. A „semmi nem megy fel az internetre” állítást
          a szerkezet tartja: a felületnek nincs hálózati hozzáférése, és az
          egész programban egyetlen kimenő hívás van, a modell letöltése.
        */}
        <p className="lead">
          Magyar jogi iratok álnevesítése a gépeden. A program egyetlen hálózati kérése a
          nyelvi modell letöltése, azt is te indítod.
        </p>

        {/*
          A MODELL HIÁNYA ITT MONDÓDIK KI, a nyitóképernyőn.

          A nyelvi modell nem a telepítővel érkezik: a felhasználó tölti le. Amíg
          nincs meg, a program elindul és dolgozik — de a neveket csak a
          szerkezeti jelekből találja meg, a folyó szövegben elszórtakra nem
          keres rá. Ezt a különbséget elhallgatni ugyanaz a hiba volna, mint
          fekete csíkot rajzolni egy PDF-re: a felhasználó abban a hitben adná
          ki az iratot, hogy átnézte a gép.
        */}
        {/*
          A MODELL HIÁNYA EGY SOR, NEM EGY BEKEZDÉS.

          Öt mondat állt itt arról, mit talál meg a program modell nélkül és mit
          nem — a nyitóképernyőn, ahol a felhasználó még egy iratot sem nyitott
          meg. Ami tény, az egy mondatba fér; ami magyarázat, az a
          buboréksúgóba való. A részletes változat ott is elolvasható, ahol
          számít: a csere lapján, a nyelvi modell sávjában, ahol a rövid lista
          mellett áll.
        */}
        {modellHiany?.hianyzik && (
          <div
            className="modellhiany"
            title={
              'A program modell nélkül csak a szerkezeti jelekre tud támaszkodni („Felperes:”, ' +
              '„anyja neve:”, cégforma). Ami a folyó szövegben, szabadon említve szerepel — egy ' +
              'tanú neve egy mondat közepén —, azt nem találja meg. Az irat így is feldolgozható, ' +
              'de a találatlistát tételesen át kell nézni. Egyszeri letöltés; utána a program ' +
              `végleg hálózat nélkül dolgozik. A modell neve: ${modellHiany.nev}.`
            }
          >
            <span>A nyelvi modell nincs letöltve — addig a felismerés hiányos.</span>
            <button className="btn primary sm" onClick={onOpenModels}>
              Letöltés
            </button>
          </div>
        )}

        <div
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            // Az ablakszintű kezelő ne nyissa meg másodszor ugyanazt a fájlt.
            e.stopPropagation();
            setOver(false);
            // Eddig itt a behúzott fájl elveszett, és csak a tallózó nyílt meg:
            // a felhasználó kétszer mutatta meg ugyanazt az iratot.
            onDropFiles(e.dataTransfer.files);
          }}
        >
          {/* Ugyanaz a rajz, mint az alsó három lépés elsőjén — és ugyanazért
              nem emodzsi: azt a rendszer betűkészlete rajzolja, gépenként
              másképp, és a színes emodzsi nem veszi át a felület színét. */}
          <LepesIkon nev="olvas" />
          <p>Húzz ide egy iratot, vagy tallózz rá.</p>
          <button className="btn primary" onClick={onOpen}>
            Irat megnyitása
          </button>
          <div className="formats">PDF · Word (.docx) · egyszerű szöveg</div>
        </div>

        {/*
          A HÁROM DOBOZ: A MUNKA HÁROM LÉPÉSE, IKONNAL.

          Korábban három, egymással össze nem függő tény állt itt, mindegyik két
          sorban. Ez a három viszont EGY folyamat — végigolvassa, megkeresi,
          lecseréli —, és a sorrendjük is ez. Ikonnal párosítva a szem
          végigfut rajtuk anélkül, hogy el kellene olvasnia mindet.

          A szöveg TÉNY marad: a „kitalálja a témát” a rovatok és az eljárási
          szerepek felismerése (»Felperes:«, »anyja neve:«, cégforma), az
          „intelligens” pedig itt a ragozást jelenti — a példa többet mond róla,
          mint a jelző.
        */}
        <div className="assurances">
          <div className="assurance">
            <LepesIkon nev="olvas" />
            <div className="t">Kiolvassa az iratot</div>
            <div className="s">Felismeri a rovatokat és az eljárási szerepeket.</div>
          </div>
          <div className="assurance">
            <LepesIkon nev="keres" />
            <div className="t">Megkeresi az adatokat</div>
            <div className="s">Neveket, címeket, azonosítókat, összegeket, dátumokat.</div>
          </div>
          <div className="assurance">
            <LepesIkon nev="cserel" />
            <div className="t">Ragozva cserél</div>
            <div className="s">„Kovács Jánossal” → „Kovakövi Frédivel”.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { emptyParty };
