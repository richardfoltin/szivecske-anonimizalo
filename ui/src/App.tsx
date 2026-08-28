import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  // Ugyanazok a függvények, amikkel a motor a `outcomes` számhármast számolja
  // és a bal oldali nézet színez: a listán álló „mind / részben / nincs csere”
  // állapot és a jelmagyarázat ebből következik, nem külön tárolt adatból.
  matchKind,
  matchOutcome,
  AMOUNT_ENTITY_ID,
  DATE_ENTITY_ID,
  // A motor szótára az azonosítófajtákhoz — a jobb gombos menü ebből épül.
  AZONOSITO_NEV,
  type AnalysisResult,
  type CastRow,
  type MatchKind,
  type MatchOutcome,
  type MatchRow,
  type AppSettings,
  type DetectProgress,
  type DocumentInfo,
  type ExportResult,
  type IratBeallitas,
  type AzonositoKind,
  type EntityKind,
  type FeluletTema,
  type PartyInput,
  type PreviewPages,
  type DetectionResult,
  type ReplacementMode,
  type ThemeSummaryUi,
} from './api';
import {
  DocumentView,
  FAJTA_CIMKE,
  KIMENET_CIMKE,
  OsszegzoLap,
  OsszevetesView,
  PreviewView,
} from './panels';
import { KontextMenu, type MenuAllas, type MenuTetel } from './kontextmenu';
import { ROLES } from './dialogs';
import {
  DocumentSetup,
  MODE_LABEL,
  type Ful,
  type DokumentumBeallitasok,
  type LepesAllas,
  type TalaltTetel,
  type VizsgalatAllapot,
} from './documentSetup';
import {
  AutoDecisionReport,
  AutoReportDialog,
  ExitDialog,
  ExportDialog,
  KeyFileDialog,
  LoadWarningsDialog,
  NewCaseDialog,
  OpenOtherDialog,
  Overlay,
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
/**
 * MELYIK NÉZET ÁLL A BAL PANELEN.
 *
 *  'source'    — az eredeti irat, a megtalált nevekkel kiemelve,
 *  'valtozas'  — a régi áthúzva, mellette az új; erre a kérdésre válaszol:
 *                „mi változik?",
 *  'preview'   — az álnevesített irat, ahogy a fájlba kerül.
 *
 * A SORREND A KÉRDÉSEK SORRENDJE: mi van most → mi változik → mi lesz. Ezért
 * áll az összevetés a másik kettő KÖZÖTT a váltón is.
 */
type View = 'source' | 'valtozas' | 'preview';

/**
 * A FŐ KÉPERNYŐ ÁLLOMÁSAI — megnyitás után.
 *
 * KETTŐ VAN, nem három. A régi harmadik („munka") külön képernyő volt, ahova
 * egy fejléc-ikon vitt oda-vissza — pedig ugyanúgy nézett ki, mint a beállító
 * lap (balra az irat, jobbra egy panel), és a folyamat harmadik állomása volt.
 * Ma az a lap HARMADIK FÜL a beállító lapon („Ellenőrzés és mentés"), a másik
 * kettő mellett: egy fülsor, három lépés, olvasható sorrendben.
 *
 * Azért állapot és nem levezetett érték (pl. „van-e elemzés"), mert a beállító
 * lap már a vizsgálat alatt is számol, hogy a „Mit cserélünk?" fülnek legyen
 * mit mutatnia — levezetve a felhasználó az első újraszámolás pillanatában
 * átugrana.
 */
type Fazis = 'vizsgalat' | 'beallitas';

/**
 * A vizsgálat képernyőjének három állása.
 *
 *  - 'nyit' a fájl beolvasása még tart — ez az ELSŐ dolog, amit a felhasználó
 *           lát a megnyitás után. Régen a helyén egy teljes képernyős „elfoglalt"
 *           réteg állt, majd eltűnt, és a helyére ez a képernyő lépett a saját
 *           folyamatjelzőjével: a felhasználó két külön betöltést látott egymás
 *           után ugyanarra az egy műveletre. Egy képernyő, két szakasszal —
 *           és a két szakasz EGYSZERRE látszik rajta, nem egymást váltva.
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

/*
  A MODE_LABEL INNEN KIKERÜLT: a documentSetup exportálja. Két példány már el
  is csúszott egymástól („Hivatalos (OBH)" állt itt, „Hivatalos (OBH) —
  eljárási szerep" ott) — ugyanaz a mód két néven a felület két pontján.
*/

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
      t: 'Modell: kikapcsolva',
      title:
        'A nyelvi modell ki van kapcsolva, ezért csak a szerkezeti minták találtak feleket: a folyó szövegben elszórt nevekre nem kerestünk rá. Kattints: itt olvasható, mit jelent ez, és mit tehetsz.',
      loud: false,
    },
    missing: {
      t: 'Modell: hiányzik',
      title:
        'A nyelvi modell nincs telepítve, ezért csak a szerkezeti minták találtak feleket: a folyó szövegben elszórt nevekre nem kerestünk rá. Kattints: itt lehet letölteni.',
      loud: false,
    },
    failed: {
      t: 'Modell: hiba',
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
  | 'nyomtatas'
  | 'tordeles'
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
  // tabler: text-wrap — a szöveg a következő sorba csordul: ez a bekezdésenkénti tördelés
  tordeles: [
    'M4 6l16 0',
    'M4 12l13 0a3 3 0 0 1 0 6h-4l2 -2m0 4l-2 -2',
    'M4 18l3 0',
  ],
  // tabler: printer
  nyomtatas: [
    'M17 17h2a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2',
    'M17 9v-4a2 2 0 0 0 -2 -2h-6a2 2 0 0 0 -2 2v4',
    'M7 13m0 2a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z',
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
  /**
   * A BETÖLTÖTT IRATOK — egy ügy, több irat.
   *
   * Egy per iratai (keresetlevél, ellenkérelem, ítélet) egyszerre vannak
   * nyitva, és EGYETLEN elemzés fut rájuk: ugyanaz a valódi név mindegyikben
   * ugyanazt a fedőnevet kapja. Ez váltotta ki az „Új ügy" gombot, amiről a
   * felhasználó joggal mondta, hogy nem érti: ami egyszerre van betöltve, az
   * egy ügy — nincs mit kitalálni hozzá.
   */
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  /** Melyik irat látszik a bal panelen. A jobb oldali panel MINDEGYIKRE szól. */
  const [aktivDoc, setAktivDoc] = useState(0);
  /*
    A `doc` LEVEZETETT ÉRTÉK MARADT, nem külön állapot.

    Az egy iratra írt utak (a fájlnév kiírása, a szkennelt irat kérdése, a
    vizsgálat képernyője) így változatlanul működnek, és nincs két igazság
    arról, melyik irat van nyitva. Ami az EGÉSZ ügyre szól — a változáskövetés
    blokkolása, a mentés —, az a `docs` listából dolgozik.
  */
  const doc: DocumentInfo | null = docs[aktivDoc] ?? docs[0] ?? null;
  const [parties, setParties] = useState<PartyInput[]>([]);
  const [themeId, setThemeId] = useState(DEFAULT_THEME);
  const [mode, setMode] = useState<ReplacementMode>('theme');
  /**
   * Készüljön-e visszafejtő kulcsfájl EBBEN AZ IRATBAN.
   *
   * Korábban „alapértelmezés" volt a Beállításokból; ma a beállító lap egyik
   * kapcsolója. A mentés ablaka ezt az értéket kapja induló állásnak.
   */
  /*
    A KULCSFÁJL ALAPBÓL NEM KÉSZÜL — a szigorúbb állapot az alapértelmezés.

    Amíg a kulcs létezik, a kimenet a GDPR szerint továbbra is személyes adat:
    az irat álnevesített, nem anonimizált. Aki vissza akarja nézni, ki kicsoda
    volt, az egy kapcsolóval kéri — és akkor tudatosan vállalja is.

    (A beállításokban felülírható, `Settings.keepKey`; ez csak a kiindulás,
    amíg a mentett beállítás be nem töltődik.)
  */
  const [keepKey, setKeepKey] = useState(false);
  const [autoDetect, setAutoDetect] = useState(true);
  const [decisions, setDecisions] = useState<Record<number, 'accept' | 'skip'>>({});
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [dialog, setDialogNyers] = useState<Dialog>(null);
  /**
   * A BEZÁRÁSI KÉRDÉST SEMMI NEM ÍRHATJA FELÜL.
   *
   * A kérdést a főfolyamat teszi fel, és a válaszunkra vár. Ha egy közben
   * megnyíló másik ablak (egy kései hibaüzenet, egy letöltés vége) simán a
   * `dialog` állapotba írna, a kérdés némán eltűnne — a főfolyamat pedig
   * hiába várna, majd a tartalékkal kérdezné meg ugyanazt. A bezárás
   * (`null`) és maga az exit szabad; minden más várjon sorára.
   */
  const setDialog = useCallback((d: Dialog): void => {
    setDialogNyers((elozo) => (elozo === 'exit' && d !== null && d !== 'exit' ? elozo : d));
  }, []);
  /**
   * Hol tart a folyamat. Csak megnyitott irat mellett számít; irat nélkül a
   * nyitóképernyő áll a helyén.
   *
   * A kezdőérték azért 'munka', mert a fejlesztői belépő (`?dev=…`) kész
   * elemzéssel indít: ha 'vizsgalat'-ról indulnánk, a felület átnézése előtt
   * végig kellene nézni egy vizsgálatot, ami el sem indult.
   */
  const [fazis, setFazis] = useState<Fazis>('beallitas');
  /**
   * A beállító lap nyitott füle — a folyamat három állomása.
   *
   * Azért itt lakik, és nem a lapon belül, mert a lépéseket a folyamat
   * mozgatja: a „Mehet a csere" a harmadikra visz, a mentés utáni „nézzük át"
   * út a másodikra hoz vissza, új irat pedig az elsőn indul.
   */
  const [setupFul, setSetupFul] = useState<Ful>('mire');
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
  /**
   * A FELÜLET TÉMÁJA — a WINDOWS beállítása szerint.
   *
   * Nincs hozzá kapcsoló a programban, és szándékosan: egy irodai
   * alkalmazástól azt várja az ember, hogy úgy nézzen ki, mint a többi ablak
   * a képernyőn. A rendszer menet közbeni váltását is követjük (naplemente,
   * kézi átbillentés) — enélkül a program a régi palettán ragadna, amíg újra
   * nem indítják, és pont az volna a benyomás, hogy nem követi a rendszert.
   */
  const [rendszerTema, setRendszerTema] = useState<FeluletTema>('vilagos');
  /**
   * A FELHASZNÁLÓ VÁLASZTÁSA: kövesse a rendszert, vagy rögzítse valamelyikre.
   *
   * A tényleges téma ebből és a rendszer állásából adódik. Két külön állapot,
   * mert két külön dolog: a rendszer változhat menet közben is, a választás
   * viszont a felhasználóé, és a beállításfájlban él tovább.
   */
  const [temaValasztas, setTemaValasztas] = useState<'auto' | 'vilagos' | 'sotet'>('auto');
  const tema: FeluletTema = temaValasztas === 'auto' ? rendszerTema : temaValasztas;
  const [view, setView] = useState<View>('source');
  /**
   * A JOBB GOMBOS MENÜ ÁLLÁSA — hol áll, és mi van benne.
   *
   * A tartalom a MEGNYITÁS pillanatában készül el (`iratContext`), nem
   * kirajzoláskor: a menü arról a találatról szól, amelyikre a kattintás
   * esett, és arról a kijelölésről, ami akkor állt fenn. Élő számításból a
   * menü a háttérben futó újraelemzéstől a kezünk alatt változna meg.
   */
  const [menu, setMenu] = useState<MenuAllas | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /**
   * AZ ÁLNEVESÍTETT IRAT LAPKÉPEI — PDF-en ez az előnézet.
   *
   * Külön állapot a szöveg mellett, mert a kettő KIZÁRJA egymást: ha lapkép
   * van, a szöveget le sem kérjük. Mindkettő ugyanakkor esik el (a `null`
   * jelenti azt, hogy „ezt még elő kell állítani"), különben az előnézet a
   * döntés előtti kimenetet mutatná a friss elemzés alatt.
   */
  const [previewPages, setPreviewPages] = useState<PreviewPages | null>(null);
  /**
   * AZ ÖSSZEVETÉS LAPKÉPEI — a régi alak áthúzva, mellette az új.
   *
   * Külön az előnézetétől, mert MÁS rajz: ugyanabból a bekezdéskezelésből,
   * de a régi szöveggel együtt. Két külön gyorsítótár, mert a felhasználó
   * oda-vissza vált a két nézet között, és egyiket sem szabad újrarajzolni
   * csak azért, mert a másikat megnézte.
   */
  const [valtozasPages, setValtozasPages] = useState<PreviewPages | null>(null);
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
  /**
   * BEKEZDÉSENKÉNTI ÚJRATÖRDELÉS a kimeneti PDF-ben — alapból BE.
   *
   * A PDF-ben nincs bekezdés, csak sorok. Soronként újrarajzolva a csere
   * elveszi a sorkizárást (a mi sorunk normál szóközökkel áll, tehát csipkés
   * lesz a jobb széle), egy hosszabb álnév pedig egyszerűen kifut a margóból —
   * a szöveg nem tud a következő sorba csordulni, mert a sor a fájlban egy
   * önálló utasítás.
   *
   * Bekapcsolva a bekezdés EGÉSZ szövegét tördeljük újra a saját szélességére.
   * Ez az alapállás, mert ez ad iratszerű kimenetet; a kikapcsolás annak való,
   * aki a lehető legkevesebb bájtot akarja megváltoztatni a fájlban.
   */
  const [paragraphReflow, setParagraphReflow] = useState(true);
  /**
   * KÉZI SZORZÓ ÉS ELTOLÁS — ha a felhasználó megadta.
   *
   * `undefined`: a motor az ügy kulcsából számol, ami kiszámíthatatlan, de
   * ügyön belül állandó. A kézi érték annak való, akinek KEREK mérték kell,
   * mert az iratot valakinek el kell magyaráznia.
   */
  const [amountFactor, setAmountFactor] = useState<number | undefined>(undefined);
  const [dateShiftDays, setDateShiftDays] = useState<number | undefined>(undefined);
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

  /** Az elemzések sorszámozása — lásd az elavulás-őrt a `runAnalysis`-ban. */
  const elemzesSzamRef = useRef(0);

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
        ELAVULÁS-ŐR. Két elemzés átfedésben futhat (a csendes újraszámolás és
        egy kifejezett kérés), és a motor nem ígér sorrendet: a korábban
        indított később is visszaérhet. Őr nélkül a régebbi eredmény írná
        felül a frissebbet, és a képernyő a döntés ELŐTTI állapotot mutatná —
        pont azt, amit a felhasználó az imént megváltoztatott.
      */
      const sorszam = ++elemzesSzamRef.current;
      const elavult = (): boolean => elemzesSzamRef.current !== sorszam;
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
          paragraphReflow,
          ...(amountFactor !== undefined ? { amountFactor } : {}),
          ...(dateShiftDays !== undefined ? { dateShiftDays } : {}),
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
        // Elavult válasz: közben újabb elemzés indult, az övé a képernyő.
        if (elavult()) return null;
        setAnalysis(res);
        // Az előnézet az ELŐZŐ elemzésé volt: eldobjuk. Nem az `analysis`
        // változására figyelünk, mert az azonosság szerint dönt — egy
        // változatlan eredményobjektum mellett a képernyőn a döntés előtti
        // kimenet maradna, és a felhasználó azt hinné, hogy a döntése nem
        // érvényesült.
        setPreview(null);
        setPreviewPages(null);
        setValtozasPages(null);
        setPreviewError(null);
        return res;
      } catch (e) {
        if (!elavult()) setError((e as Error).message);
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
      paragraphReflow,
      amountFactor,
      dateShiftDays,
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
      /*
        A VIZSGÁLAT NEM RÁNTJA EL A LAPOT, HA MÁR VAN MIT MUTATNI.

        Eddig minden vizsgálat teljes képernyős betöltőlapra váltott — az
        „Vizsgálat újra" gombra tehát eltűnt az egész felület, majd
        visszajött. Egy villanás, aminek semmi haszna: az iratsáv, a
        jelmagyarázat, a jobb oldali beállítások mind ugyanazok maradnak, csak
        a TALÁLATOK számolódnak újra. Ami újratöltődik, az egyedül a
        dokumentum tartalma — a betöltésnek is ott a helye.

        Csak akkor vesszük át az egész képernyőt, ha tényleg nincs mit
        mutatni: az első irat megnyitásakor. Ott a betöltőlap nem villanás,
        hanem az egyetlen tartalom.
      */
      if (!(fazis === 'beallitas' && docs.length > 0)) setFazis('vizsgalat');

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
        /*
          A KÉZZEL FELVITT NEVEK A HIBAÁGON IS VISSZAKERÜLNEK. Az újraindítás
          előtt a hívó a keziekRef-be tette őket; ha itt üres listát írnánk, a
          FELISMERÉS hibája a FELHASZNÁLÓ munkáját törölné — és a következő
          „Vizsgálat újra" már az üres listából stashelne, vagyis a nevek
          véglegesen elvesznének.
        */
        setParties(keziekRef.current);
        keziekRef.current = [];
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
    [autoDetect, autoModeForDoc, mode, runAnalysis, themeId, fazis, docs.length],
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
    async (path: string, hozzaad = false) => {
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
      /*
        A HIBAÁG VISSZAÚTJÁHOZ. A fázist a megnyitás ELŐTT váltjuk át (a
        betöltőképernyő az első pillanattól látszik), de ha a megnyitás
        elhasal, a RÉGI irat még megvan — az elemzésével és az összes
        döntésével együtt. Ezeket az értékeket azért jegyezzük meg, hogy a
        hibaüzenet után a felhasználó OTT folytassa, ahol volt, ne egy
        „készen állunk" képernyőn ragadjon, ahonnan csak a döntéseit törlő
        újravizsgálat vezet ki.
      */
      const elozoFazis = fazis;
      const elozoKep = vizsgalatKep;
      const voltIrat = docs.length > 0;
      setVizsgalat('kihagyva');
      setVizsgalatKep('nyit');
      setHaladas(null);
      /*
        AZ ÜGYHÖZ ADOTT IRAT NEM RÁNTJA EL A LAPOT.

        Ilyenkor van mit mutatni: az iratsáv, a jelmagyarázat és a jobb oldali
        beállítások a helyükön maradnak, a betöltés pedig a dokumentum helyén
        jelenik meg. Az ELSŐ irat megnyitásakor viszont nincs mit megőrizni —
        ott a betöltőlap nem villanás, hanem az egyetlen tartalom.
      */
      if (!(hozzaad && voltIrat)) setFazis('vizsgalat');
      try {
        const lista = await api.openDocument(path, hozzaad);
        setDocs(lista);
        // Az ÚJONNAN betöltött iratra állunk: azt akarta megnézni, aki
        // megnyitotta. Hozzáadásnál ez a lista vége, cserénél az egyetlen.
        setAktivDoc(Math.max(0, lista.length - 1));
        const info = lista[lista.length - 1];
        if (!info) throw new Error('Az irat megnyitása nem adott vissza semmit.');
        /*
          HOZZÁADÁSKOR A MUNKA MEGMARAD — CSAK A SORONKÉNTI DÖNTÉSEK NEM.

          A hozzáadás ugyanahhoz az ÜGYHÖZ tesz még egy iratot: a felek, az
          azonosítók és a felismerés eredménye ugyanazokra a személyekre
          vonatkozik, tehát eldobni őket értelmetlen veszteség volna. (Az első
          próbán pontosan ez történt: a „+ Dokumentum" végigment a teljes
          megnyitási úton, és letörölte a felvitt feleket — vagyis az
          ellenkezőjét annak, amit a gomb ígér.)

          A DÖNTÉSEKET VISZONT NEM LEHET MEGTARTANI, és ez nem óvatoskodás. Az
          új irat neveit meg kell keresni, tehát a felismerés újra lefut; az
          új felek pedig új találatokat szúrnak be a MEGLÉVŐ iratokba is,
          amitől a találatok azonosítója elcsúszik. A megőrzött döntések ezután
          MÁS SZAVAKRA vonatkoznának — épp arra a kimondott „ne cseréld"-re,
          amivel a felhasználó egy nevet bent akart hagyni. Ugyanaz a
          megfontolás, mint a hivatalos szereplők kapcsolójánál.
        */
        setDecisions({});
        setSelected(null);
        setExportResult(null);
        if (!hozzaad) {
          // Az előző ÜGY felei nem jöhetnek át: a beállító lap különben a MÁSIK
          // ügy valódi neveivel nyílna meg, és a felhasználó azokat mentené el ide.
          setParties([]);
          setDetected(null);
          setIdentifiers([]);
          setDetectError(null);
          setAnalysis(null);
          // A hivatalos szereplők cseréje MINDEN új ügynél kikapcsolva indul: egy
          // jogszabályi következménnyel járó kapcsolót nem szabad csendben
          // átvinni a következő ügyre (lásd `replaceOfficials`).
          setReplaceOfficials(false);
          keziekRef.current = [];
        } else {
          /*
            A KÉZZEL FELVITT NEVEK ÁTMENTÉSE az újrafutó felismerésen.

            A `startScan` a friss felismerés listájával írja felül a feleket, és
            csak azt fésüli vissza, ami a `keziekRef`-ben van. Enélkül a
            hozzáadás elnyelné mindazt, amit a felhasználó kézzel vitt fel — a
            felismerés ugyanis azokat nem találja meg (épp ezért vitte fel).
          */
          const felismertek = new Set((detected?.parties ?? []).map((d) => d.id));
          keziekRef.current = parties.filter((p) => !felismertek.has(p.id));
        }
        // Ha egy korábbi irat vizsgálata még fut, az eredménye már nem ide
        // tartozik: a sorszám léptetésével eldobjuk.
        vizsgalatSzamRef.current += 1;
        // Új ÜGY: a felhasználó még semmihez nem nyúlt, tehát nincs mit
        // elveszíteni — a következő megnyitásnál ne kérdezzünk fölöslegesen.
        // Hozzáadásnál viszont a korábbi munka megmaradt, tehát a jelzés is.
        if (!hozzaad) setSajatDontes(false);
        // Az előnézet az ELŐZŐ iratról szólt: eldobjuk, és az eredetivel
        // indulunk, hogy a felhasználó ne a régi kimenetet lássa új irat alatt.
        setPreview(null);
        setPreviewPages(null);
        setValtozasPages(null);
        setPreviewError(null);
        setView('source');
        setHasWork(true);
        // Minden új irat a BEÁLLÍTOTT úton indul. A `switchToReview` csak erre
        // az egy iratra kapcsol vissza átnézősre — azt a következő megnyitás
        // nem örökölheti, különben a felhasználó beállítása csendben elveszne.
        setAutoModeForDoc(autoMode);
        // Új ÜGY: a folyamat elejéről indul. Hozzáadásnál a felhasználó ott
        // folytatja, ahol tartott — a fület nem rántjuk vissza alóla.
        if (!hozzaad) setSetupFul('mire');
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
        setError((e as Error).message);
        setNyitandoNev(null);
        if (voltIrat) {
          // A RÉGI irat érintetlen: oda esünk vissza, ahol a felhasználó a
          // megnyitás előtt állt — a munkája (elemzés, döntések) megvan.
          setFazis(elozoFazis);
          setVizsgalatKep(elozoKep);
        } else {
          // Nincs korábbi irat: a nyitóképernyőre esünk vissza — ott van a
          // következő mozdulat.
          setVizsgalatKep('var');
        }
      }
    },
    [autoMode, continueAfterOpen, fazis, vizsgalatKep, docs.length, detected, parties],
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
      let resolved: DocumentInfo[] | null = null;
      try {
        const lista = await api.resolveRevisions(m);
        setDocs(lista);
        setAnalysis(null);
        resolved = lista;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
      if (!resolved) return;
      // A változáskövetés-kapun átjutva a betöltési figyelmeztetés kapuja
      // következik: a `continueAfterOpen` itt újra a változáskövetést kérdezné
      // (a feloldott iratban már nincs), ezért a második kaput hívjuk közvetlenül.
      // BÁRMELYIK iratban maradt betöltési figyelmeztetés: a kapu ugyanúgy
      // megáll, mint egy irat esetén — a hiányos kiolvasás ott is szivárgás.
      if (resolved.some((d) => d.loadWarnings.length > 0)) {
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
    A `decide` INNEN KIKERÜLT a munkalap találatlistájával együtt.

    A találatonkénti döntés helye a BEÁLLÍTÓ LAP lett: ott áll az irat a
    kiemelésekkel, és ott van a soronkénti lépegetés (`lepesDontes`), ami
    ugyanezt tudta — csak a szövegkörnyezettel EGYÜTT mutatva. Két külön
    képernyő ugyanarra a döntésre azt tanította a felhasználónak, hogy két
    különböző dologról van szó.
  */

  const startNewCase = useCallback(() => {
    setCaseSecret(newCaseSecret());
    setDocs([]);
    setAktivDoc(0);
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
    setPreviewPages(null);
    setValtozasPages(null);
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
    if (docs.length > 0 || parties.length > 0) setDialog('newCase');
    else startNewCase();
  }, [docs.length, parties.length, startNewCase]);

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
      // A gomb „Mentés", a fátyol felirata is az: az ellenőrző kör a mentés
      // része, nem külön művelet, amiről a felhasználónak tudnia kellene.
      setBusy('Mentés…');
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
  /*
    BÁRMELYIK IRAT feloldatlan változáskövetése blokkol. A mentés kötegben megy,
    és egyetlen irat <w:del> eleme is szó szerint őrzi az eredeti szöveget —
    ha csak az éppen NÉZETT iratot vizsgálnánk, a felhasználó a másikban
    maradt módosítás miatt kapna érthetetlen elakadást.
  */
  const revisionsBlocked = docs.some((d) => d.pendingRevisions > 0);
  /** Hány feloldatlan módosítás van összesen — a fejléc jelzéséhez. */
  const revisionsDb = docs.reduce((n, d) => n + d.pendingRevisions, 0);

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
  /**
   * AZ ELŐNÉZET LEKÉRÉSE — PDF-en lapkép, egyébként szöveg.
   *
   * A KÉT ÚT KIZÁRJA EGYMÁST, és a sorrend nem mindegy: PDF-en előbb a
   * lapképet kérjük (az a valódi kimenet kirajzolva), és csak akkor esünk
   * vissza a szövegre, ha nem lett lapkép — nincs natív rajzoló, régebbi híd,
   * vagy nem is PDF az irat. Enélkül a felhasználó a mentés pillanatáig nem
   * látta, hogyan fog kinézni az irat: az előnézet a lapról leszedett szöveget
   * mutatta egyetlen folyó bekezdésben.
   *
   * Ígéret helyett igazság: ha a lapkép nem jön össze, a szöveges nézet áll
   * be, és a fejléc sávja MEGMONDJA, hogy ilyenkor a tördelést nem látni.
   */
  /**
   * AZ ÖSSZEVETÉS LAPKÉPEINEK LEKÉRÉSE — PDF-en.
   *
   * Ugyanaz a rajzolás, mint az előnézeté, csak a régi alakokkal együtt.
   * Nem PDF-en (vagy natív rajzoló híján) üresen marad, és a nézet a
   * megszedett szöveges összevetésre esik vissza — az minden formátumon
   * működik.
   */
  const valtozasKer = useCallback(async (): Promise<void> => {
    if (doc?.format !== 'pdf' || api.previewPages === undefined) return;
    const res = await api.previewPages(doc?.path, true);
    if (res.pages.length > 0) setValtozasPages(res);
  }, [doc?.format, doc?.path]);

  useEffect(() => {
    if (view !== 'valtozas' || !analysis || valtozasPages !== null) return;
    let el = true;
    void valtozasKer().catch(() => {
      // A lapkép hiánya nem hiba: a szöveges összevetés áll be helyette.
      if (el) setValtozasPages(null);
    });
    return () => {
      el = false;
    };
  }, [view, analysis, valtozasPages, valtozasKer]);

  const elonezetKer = useCallback(async (): Promise<void> => {
    const kepesUt = doc?.format === 'pdf' && api.previewPages !== undefined;
    if (kepesUt) {
      // A MEGJELENÍTETT irat lapképei — több irat mellett a főfolyamat
      // különben az elsőét adná vissza, akármelyiket is nézzük.
      const res = await api.previewPages!(doc?.path);
      if (res.pages.length > 0) {
        setPreviewPages(res);
        setPreviewError(null);
        return;
      }
    }
    const t = await api.previewText(doc?.path);
    setPreview(t);
    setPreviewError(null);
  }, [doc?.format, doc?.path]);

  useEffect(() => {
    // Csak akkor kérjük le, ha tényleg az előnézet látszik: az előállítás az
    // egész iraton végigmegy — PDF-en a kész kimenetet is megrajzolja.
    if (view !== 'preview' || !analysis) return;
    if (preview !== null || previewPages !== null || previewError !== null) return;
    let el = true;
    void elonezetKer().catch((e: Error) => {
      if (el) setPreviewError(e.message);
    });
    return () => {
      el = false;
    };
  }, [view, analysis, preview, previewPages, previewError, elonezetKer]);

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
  /*
    A TÉMA A GYÖKÉR ELEMRE KERÜL, nem egy React-osztályra.

    A stíluslap `:root[data-theme='dark']` alatt írja felül a színtokeneket —
    így minden szabály egyetlen helyről vált át, és nincs olyan komponens,
    ami kimaradhat. A `<html>` azért kell, és nem a `<body>`: a `:root`
    magassága és háttere is innen származik.
  */
  useEffect(() => {
    document.documentElement.dataset.theme = tema === 'sotet' ? 'dark' : 'light';
  }, [tema]);

  useEffect(() => {
    let el = true;
    void api.rendszerTema?.().then((t) => {
      if (el && (t === 'sotet' || t === 'vilagos')) setRendszerTema(t);
    });
    const le = api.onTemaValtozott?.((t) => setRendszerTema(t));
    return () => {
      el = false;
      le?.();
    };
  }, []);

  const doPrint = useCallback(async () => {
    /*
      A NYOMTATÁS A KÉPERNYŐ TARTALMÁT VISZI PAPÍRRA, tehát csak ott van
      értelme, ahol az álnevesített szöveg látszik. A vizsgálat és a beállító
      lap alatt a nyomtatás a beállítások képét adná ki — a felhasználó pedig
      abban a hitben venné el a papírt, hogy az iratot nyomtatta ki.
    */
    if (!analysis || fazis !== 'beallitas') {
      setError(
        'Nincs mit nyomtatni: előbb végig kell futnia a vizsgálatnak, hogy elkészüljön az álnevesített szöveg.',
      );
      return;
    }
    setView('preview');
    // A fátyol csak akkor jár, ha tényleg várni kell rá: kész előnézetnél a
    // felvillanó jelzés hazudna.
    const kesz = preview !== null || previewPages !== null;
    if (!kesz) setBusy('Az álnevesített irat előállítása…');
    try {
      // UGYANAZ AZ ÚT, mint a nézetváltásnál. Külön ág itt azt jelentené, hogy
      // a nyomtatás más képet visz papírra, mint amit a képernyő mutat — PDF-en
      // épp a tördelést, vagyis a lényeget hagyná el.
      if (!kesz) await elonezetKer();
      setBusy(null);
      await kovetkezoKep();
      await api.print();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [analysis, fazis, preview, previewPages, elonezetKer]);

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
    /*
      A BEÁLLÍTÓ LAPRA — nem egy külön átnéző képernyőre.

      Az átnézés helye a beállító lap lett: ott áll az irat a kiemelésekkel,
      a lista a kapcsolókkal és a lépegetéssel. Az `autoModeForDoc` lekapcsolása
      után az újraszámolás a program által eldöntött találatokat visszaadja
      emberi döntésre — azok borostyán pöttyel és kiemeléssel jelennek meg.
    */
    setFazis('beallitas');
    // A MÁSODIK FÜLRE, mert ott van a döntés: a lista a kapcsolókkal és a
    // lépegetéssel. Az ellenőrzés füle csak összegzést mutat.
    setSetupFul('csere');
    setView('source');
    // A mentés után a jelzést töröltük; ha innen visszalép, megint van
    // elveszíthető munka, és a bezárásnak megint kérdeznie kell.
    setHasWork(true);
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
          /*
            A HARMADIK FÜLÖN A CSERE MÁR LEFUTOTT, tehát a mentés mehet
            egyenesen. Az első kettőn viszont a lapon állított beállítások
            még nincsenek lemezen, és a csere sem futott le velük biztosan —
            ott a parancs TOVÁBBLÉPÉST jelent, és a mentés utána nyílik.
          */
          if (setupFul === 'kesz') requestExport();
          else void setupTovabb(true);
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
    [doPrint, setupFul, openSettings, requestExport, requestNewCase, requestOpen],
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
  /*
    A BEZÁRÁSI KÉRDÉS — ÉS A NYUGTA RÓLA.

    A nyugta nem udvariasság: a főfolyamat ebből tudja meg, hogy a lap él, és
    a kérdés tényleg ott áll a képernyőn. Enélkül a tartalék-időzítője
    lejárt, és a rendszerpárbeszéd ráült a saját kérdésünkre — a felhasználó
    két ablakot kapott ugyanarról, egymás tetején.

    Azért itt megy el, és nem a párbeszéd `useEffect`-jéből: a fázisváltás és
    a párbeszéd kirajzolása ugyanabban a React-körben történik, tehát ennél
    hamarabb úgysem lehetne szólni — a késleltetés pedig pont az, amit el
    akarunk kerülni.
  */
  useEffect(
    () =>
      api.onConfirmClose?.(() => {
        setDialog('exit');
        void api.closeAsked?.()?.catch(() => {
          // Ha a híd nem ismeri, a főfolyamat időzítője veszi át — a program
          // ettől még bezárható, csak a kérdés lesz a rendszeré.
        });
      }),
    [],
  );

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
  /*
    LAYOUT-HATÁS, NEM SIMA HATÁS — egy képkockányi különbség, de az látszik.

    A `useEffect` a KIRAJZOLÁS UTÁN fut le: a lap már fátyol nélkül van a
    képernyőn, amikor az üzenet elindul a főfolyamat felé. A `useLayoutEffect`
    a DOM módosítása után, de még a rajzolás előtt fut — az üzenet tehát
    ugyanabban a pillanatban indul, amikor a fátyol eltűnik.

    A halványodás így egyszerre megy vissza a lapon és a jobb felső sarokban.
    A hívás maga aszinkron (`invoke`), tehát a rajzolást nem tartja fel: itt
    csak az elindítása kerül előbbre.
  */
  useLayoutEffect(() => {
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
      // A keret a VALÓDI témát kapja: a natív ablakgombok különben fehér sávon
      // ülnének egy sötét felület tetején.
      api.ablakkeretetIgazit?.({ halvanyitva: dialog !== null, tema, valasztas: temaValasztas }),
    ).catch(() => {
      // Az elutasítást elnyeljük: a keret színe díszítés, a munka nem áll meg tőle.
    });
    /*
      A TÉMA IS FÜGGŐSÉG — ezen csúszott el.

      A hatás eddig CSAK a párbeszéd nyitására-zárására futott le. A rendszer
      témája viszont a betöltés után, egy hídhívásból érkezik: mire megjött, a
      hatás már lefutott, és a natív ablakgombok a világos sávon maradtak egy
      sötét felület tetején. Egészen addig, amíg a felhasználó ki nem nyitott
      egy párbeszédet — akkor „magától" átváltottak, ami a hibát még
      rejtélyesebbé tette.
    */
  }, [dialog, tema, temaValasztas]);

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
        // A téma választása: hiányzó mezőnél a rendszert követjük — ez az
        // alapállás, és egy régi beállításfájlban nincs is benne.
        if (saved.uiTheme === 'vilagos' || saved.uiTheme === 'sotet' || saved.uiTheme === 'auto') {
          setTemaValasztas(saved.uiTheme);
        }
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
      setDocs([preset.doc]);
      setAktivDoc(0);
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
    ? analysis.matches.filter((m) => {
        // A friss döntésekkel felülírva, a motor saját kimenet-fogalmával: a
        // kimondott „maradjon" döntés és a kikapcsolt osztály NEM eldöntetlen.
        const d = decisions[m.id];
        return matchOutcome(d === undefined ? m : { ...m, decision: d }) === 'bizonytalan';
      }).length
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
    ...(amountFactor !== undefined ? { amountFactor } : {}),
    ...(dateShiftDays !== undefined ? { dateShiftDays } : {}),
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
  /**
   * EGY TALÁLAT KIMENETE A FRISS DÖNTÉSEKKEL — az elemzés bevárása nélkül.
   *
   * A kattintás a `decisions` tárolóba ír, az új elemzés viszont csak egy
   * rövid szünet után fut le. A számlálók és a lista eddig a RÉGI elemzésből
   * számoltak: a felhasználó kikapcsolt egy csoportot, és a lap tetején álló
   * szám negyed másodpercig mást mondott, mint amit az imént tett. Ugyanaz a
   * felülírás, amit a dokumentumnézet `frissSor`-ja csinál — a következő
   * elemzés pontosan ezt igazolja vissza.
   */
  const kimenetMost = useCallback(
    (m: MatchRow): MatchOutcome => {
      const d = decisions[m.id];
      return matchOutcome(d === undefined ? m : { ...m, decision: d });
    },
    [decisions],
  );

  /**
   * A HÁROM KIMENET SZÁMA MOST — az állapotsor számaihoz.
   *
   * A friss döntéssel, nem a legutóbbi elemzés `outcomes` hármasából: a
   * kattintás után az elemzés csak egy rövid szünettel fut újra, és addig az
   * állapotsor a kattintás ELŐTTI állást mutatta. A `matchOutcome` ugyanaz a
   * függvény, amiből a motor is számol, tehát a következő elemzés pontosan
   * ezt igazolja vissza.
   *
   * EGYÜTT SZÁMOLJUK MIND A HÁRMAT. Amíg csak a „cserélődik" volt friss (a
   * lap tetején), a másik kettő pedig a régi elemzésből jött (az
   * állapotsorban), a három szám egy fél másodpercig nem adta ki a találatok
   * számát — a felhasználó a különbséget hiányzó tételnek olvassa.
   */
  const kimenetSzamok = useMemo(() => {
    const t = { csere: 0, bizonytalan: 0, nincs: 0 };
    for (const m of analysis?.matches ?? []) t[kimenetMost(m)]++;
    return t;
  }, [analysis, kimenetMost]);

  const jelmagyarazat = useMemo(() => {
    if (!analysis) return [];
    const cserelodo = analysis.matches.filter((m) => kimenetMost(m) === 'csere');
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
        db: kimenetSzamok.bizonytalan,
        sugo: 'A program bizonytalan benne, és még senki nem döntött róla.',
      },
      {
        kulcs: 'nincs',
        osztaly: 'nincs',
        cimke: KIMENET_CIMKE.nincs,
        db: kimenetSzamok.nincs,
        sugo: 'Nem cserélődik: az eredeti szöveg marad. Kattints rá az iraton, ha mégis kell.',
      },
    ].filter((j) => j.db > 0);
  }, [analysis, hivatalosIdk, kimenetMost, kimenetSzamok]);

  /**
   * A HIVATALOS SZEREPLŐK NEVE, ahogy a felismerés adta.
   *
   * A kikapcsolt szakasz a `keepList` teljes megnevezését mutatja („dr. Bach
   * Tivadar"), a bekapcsolt viszont a `cast` nevét — abból a motor a címet
   * („dr.") már levette, mert ahhoz nem nyúl. A képernyőn ettől a kapcsoló
   * átbillentésekor maga a NÉV is megváltozott, ami adatvesztésnek látszik.
   * A két állapot innentől ugyanabból az egy listából veszi a nevet.
   */
  const hivatalosNevek = useMemo(
    () => new Map((detected?.officials ?? []).map((o) => [o.id, o.fullName])),
    [detected],
  );

  /**
   * A MEGJELENÍTETT IRAT SZAKASZA az elemzésben.
   *
   * A bal panel egyszerre egy iratot mutat; a jobb oldali lista viszont az
   * egész ügyre szól. A szakasz adja a lapképeket, a kiemelés helyét és a
   * szöveget — ha a motor még nem ad `docs` tömböt (régebbi híd, fejlesztői
   * álkimenet), akkor `undefined`, és a nézetek az elemzés gyökeréből
   * dolgoznak, ahogy eddig.
   */
  const aktivSzakasz = analysis?.docs?.[aktivDoc] ?? analysis?.docs?.[0];

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
      // A friss döntésekkel felülírva (`kimenetMost`): a kapcsoló átbillentése
      // AZONNAL látszik a soron, nem az újraelemzés után negyed másodperccel.
      const cserelodik = lista.filter((m) => kimenetMost(m) === 'csere').length;
      const bizonytalanDb = lista.filter((m) => kimenetMost(m) === 'bizonytalan').length;
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
        eredeti: hivatalosNevek.get(c.entityId) ?? c.original,
        szerep: c.role,
        elofordulas: a.elofordulas,
        cserelodik: a.cserelodik,
        bizonytalanDb: a.bizonytalanDb,
        vanKovetkezo: a.vanKovetkezo,
        csere: alapCsereRef.current.get(c.entityId) ?? c.replacement,
        ...(sajat === '' ? {} : { sajatCsere: sajat }),
        ...(keziIdk.has(c.entityId) ? { kezi: true } : {}),
        /*
          A „PROGRAM DÖNTÖTT" PÖTTY CSAK A TÉNYLEGES PROGRAMDÖNTÉSÉ. Korábban
          az eldöntetlen (`pendingCount > 0`) sorok is megkapták a jelvényt —
          a program a saját tétlenségét mutatta be döntésként. A döntésre váró
          sort a `bizonytalanDb` jelzi, a maga pöttyével.
        */
        ...(bizonytalanok.has(c.entityId) ? { programDontott: true } : {}),
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
    /*
      MINDEN ÉRTÉK KÜLÖN SOR — nem egyetlen, összevont tétel.

      Korábban mind a tizenhárom dátum EGY sorba került, és a listán az első
      értéke állt („1968. április 3. → 1967. szeptember 15."), mellette hogy
      „13 helyen". A felhasználó tehát nem látta, milyen dátumok vannak az
      iratban, és egyenként dönteni sem tudott róluk — pedig egy iratban a
      születési dátum és a teljesítési határidő két külön kérdés, és lehet,
      hogy az egyiket el akarja tolni, a másikat nem.

      A CSOPORT MARAD: a „cseréljük-e egyáltalán az összegeket" kérdés
      továbbra is egy kapcsoló a csoport fejlécén.
    */
    for (const [entityId, fajta] of [
      [AMOUNT_ENTITY_ID, 'amount'],
      [DATE_ENTITY_ID, 'date'],
    ] as const) {
      const ertekenkent = new Map<string, typeof analysis.matches>();
      for (const m of talalatok.get(entityId) ?? []) {
        const lista = ertekenkent.get(m.surface) ?? [];
        lista.push(m);
        ertekenkent.set(m.surface, lista);
      }
      for (const [ertek, lista] of ertekenkent) {
        const cserelodik = lista.filter((m) => kimenetMost(m) === 'csere').length;
        const bizonytalanDb = lista.filter((m) => kimenetMost(m) === 'bizonytalan').length;
        const id = `${entityId}|${ertek}`;
        sorok.set(id, {
          id,
          fajta,
          eredeti: ertek,
          szerep: fajta === 'amount' ? 'összeg' : 'dátum',
          elofordulas: lista.length,
          cserelodik,
          bizonytalanDb,
          vanKovetkezo: cserelodik < lista.length,
          csere: lista[0]?.replacement ?? '—',
        });
      }
    }

    return [...sorok.values()];
  }, [analysis, parties, identifiers, keziIdk, hivatalosIdk, hivatalosNevek, kimenetMost]);

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

  /* ─────────── a sor kapcsolója és a lépegetés ─────────── */

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
  /**
   * EGY TALÁLAT SORAZONOSÍTÓJA A LISTÁN.
   *
   * A neveknél ez a fél azonosítója: egy név egy sor, akárhány alakban
   * szerepel. Az ÖSSZEGEK és a DÁTUMOK viszont nem felek, hanem az iratban
   * megtalált ÉRTÉKEK — ott az érték maga a tétel.
   *
   * Korábban mind a tizenhárom dátum egyetlen sorba került, és a listán az
   * ELSŐ értéke állt („1968. április 3. → 1967. szeptember 15."), mellette
   * hogy „13 helyen". A felhasználó tehát nem látta, milyen dátumok vannak az
   * iratban, és egyenként dönteni sem tudott róluk — pedig egy iratban a
   * születési dátum és a teljesítési határidő két külön kérdés.
   */
  const sorAzonosito = (m: MatchRow): string =>
    m.entityId === AMOUNT_ENTITY_ID || m.entityId === DATE_ENTITY_ID
      ? `${m.entityId}|${m.surface}`
      : m.entityId;

  const dontesekre = (id: string, valtozas: (matchId: number) => 'accept' | 'skip' | null): void => {
    if (!analysis) return;
    const next = { ...decisions };
    for (const m of analysis.matches) {
      if (sorAzonosito(m) !== id) continue;
      const d = valtozas(m.id);
      if (d === null) continue;
      next[m.id] = d;
    }
    setDecisions(next);
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  /**
   * A SOR KAPCSOLÓJA: cserélődjön-e ez a tétel. A régi „Mind" és „Nincs
   * csere" gomb egyetlen kapcsolóban — be = minden előfordulás cserélődik,
   * ki = egyik sem.
   */
  const sorKapcsol = (id: string, be: boolean): void => {
    /*
      A SOR CSAK A SAJÁT ÉRTÉKÉRE HAT.

      Az összegek és a dátumok soronként külön tételek („3 550 000 Ft",
      „2025. március 14."), tehát egy sor átbillentése CSAK annak az egy
      értéknek az előfordulásait érinti. A fajta egészét a csoport fejlécének
      kapcsolója állítja (`setupCsoport`) — ott van a helye, mert ott látszik
      is, hogy az egész csoportról szól.
    */
    dontesekre(id, () => (be ? 'accept' : 'skip'));
  };

  /**
   * EGY EGÉSZ CSOPORT KI- VAGY BEKAPCSOLÁSA a fejlécéből.
   *
   * Húsz név mellett a soronkénti döntés húsz kattintás; ez egy. A művelet
   * ugyanaz, amit a sorok „Mind" és „Nincs csere" gombja tesz, csak a csoport
   * minden tételére — tehát ugyanabba a tárolóba (`decisions`) ír, és a
   * képernyő ugyanúgy tükrözi vissza.
   *
   * A hivatalos szereplők NEM ezen az úton mennek: nekik saját kapcsolójuk van
   * (`replaceOfficials`), ami nem a cserét állítja, hanem azt, hogy egyáltalán
   * a felek közé kerüljenek-e.
   */
  const setupCsoport = (fajta: TalaltTetel['fajta'], be: boolean): void => {
    if (!analysis) return;
    const idk = new Set(tetelek.filter((t) => t.fajta === fajta).map((t) => t.id));
    if (idk.size === 0) return;
    /*
      A FAJTAKAPCSOLÓ A CSOPORT FEJLÉCÉN ÁLL, és az egész fajtára szól: az
      összegek és a dátumok soronként külön tételek, de a „cseréljük-e
      egyáltalán" kérdés közös. Enélkül a fejléc kapcsolója némán csak azokra
      a sorokra hatna, amelyek épp a listán állnak.
    */
    if (fajta === 'amount') setReplaceAmounts(be);
    if (fajta === 'date') setShiftDates(be);
    const next = { ...decisions };
    for (const m of analysis.matches) {
      if (!idk.has(sorAzonosito(m))) continue;
      next[m.id] = be ? 'accept' : 'skip';
    }
    setDecisions(next);
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  /** Egy tétel találatai az IRATBELI sorrendjükben — a lépegetés pályája. */
  const entitasSorrend = useCallback(
    (id: string): MatchRow[] =>
      analysis ? analysis.matches.filter((m) => sorAzonosito(m) === id) : [],
    [analysis],
  );

  /**
   * A LÉPEGETÉS ÁLLÁSA — a dokumentum kijelöléséből SZÁRMAZTATVA.
   *
   * Nem külön állapot: a lépegetés és az iratra kattintás ugyanazt a
   * kijelölést (`selected`) mozgatja, tehát a kettő nem tud széttartani. Az
   * iraton megjelölt előfordulásnál a lista sora is kinyitja a lépegetőt,
   * a megfelelő pozíción.
   */
  const lepes: LepesAllas | null = useMemo(() => {
    if (selected === null || !analysis) return null;
    const m = analysis.matches.find((x) => x.id === selected);
    if (!m) return null;
    const lista = analysis.matches.filter((x) => sorAzonosito(x) === sorAzonosito(m));
    return {
      entityId: m.entityId,
      index: lista.findIndex((x) => x.id === selected),
      osszes: lista.length,
      cserelodik: kimenetMost(m) === 'csere',
    };
  }, [selected, analysis, kimenetMost]);

  /**
   * Lépegetés indítása: az első DÖNTÉSRE VÁRÓ előfordulásra ugrik, ha van —
   * aki végig akar menni, jellemzően a bizonytalanok miatt teszi. Ha nincs
   * ilyen, az elsőre.
   */
  const lepesKezd = (id: string): void => {
    const lista = entitasSorrend(id);
    const cel = lista.find((m) => kimenetMost(m) === 'bizonytalan') ?? lista[0];
    if (cel) setSelected(cel.id);
  };

  /** Előző/következő előfordulás — döntés nélkül. Az irat odagörög. */
  const lepesMozog = (id: string, irany: 1 | -1): void => {
    const lista = entitasSorrend(id);
    const most = lista.findIndex((m) => m.id === selected);
    const cel = most === -1 ? lista[0] : lista[most + irany];
    if (cel) setSelected(cel.id);
  };

  /**
   * DÖNTÉS A MOSTANI ELŐFORDULÁSRÓL, aztán ugrás a következőre — a Word
   * Csere párbeszédének mozdulata. Ugyanabba a tárolóba ír, mint az iratra
   * kattintás (`iratKattintas`), tehát a „Kihagy" tényleg ugyanaz a művelet.
   */
  const lepesDontes = (id: string, dontes: 'accept' | 'skip'): void => {
    if (selected === null) return;
    const lista = entitasSorrend(id);
    const most = lista.findIndex((m) => m.id === selected);
    if (most === -1) return;
    setDecisions({ ...decisions, [selected]: dontes });
    setHasWork(true);
    setSajatDontes(true);
    const kovetkezo = lista[most + 1];
    if (kovetkezo) setSelected(kovetkezo.id);
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
    /*
      A MOSTANI ÁLLAPOTBÓL BILLENTÜNK, nem az elemzésből olvasottból.

      Két gyors kattintás között az elemzés még nem futott le, tehát az
      `analysis` sora a RÉGI döntést hordozza — abból számolva a második
      kattintás ugyanoda állítaná, ahova az első, és a felhasználó azt látná,
      hogy a program nem reagál. A `decisions` friss értéke viszont már
      megvan.
    */
    const most = decisions[matchId] ?? m.decision;
    const cserelodik = matchOutcome({ ...m, ...(most ? { decision: most } : {}) }) === 'csere';
    setDecisions({ ...decisions, [matchId]: cserelodik ? 'skip' : 'accept' });
    setHasWork(true);
    setSajatDontes(true);
    ujraKert();
  };

  /* ─────────────── jobb gombos menü az iraton ─────────────── */

  /**
   * ÚJ FÉLLISTA ÉRVÉNYRE JUTTATÁSA — a menü minden művelete ezen megy át.
   *
   * A DÖNTÉSEKET EL KELL DOBNI, és ez nem óvatoskodás. A találat azonosítója
   * az iratbeli SORRENDJE (`addRow`, src/app/session.ts): egy név felvételével
   * vagy kivételével a mögötte állók azonosítója elcsúszik, a `decisions`
   * viszont erre az azonosítóra hivatkozik. A megőrzött döntések tehát MÁS
   * SZAVAKRA vonatkoznának — épp arra a kimondott „ne cseréld"-re, amivel a
   * felhasználó egy nevet bent akart hagyni. Ugyanez a megfontolás áll a
   * hivatalos szereplők kapcsolója mögött is (`setupBeallitas`).
   */
  const felekFrissit = (ujFelek: PartyInput[], ujAzonositok: PartyInput[]): void => {
    setParties(ujFelek);
    setIdentifiers(ujAzonositok);
    setDecisions({});
    setSelected(null);
    setHasWork(true);
    setSajatDontes(true);
    void runAnalysis(ujFelek, themeId, mode, {}, ujAzonositok);
  };

  /**
   * EGY ÚJ FÉL A KIJELÖLT SZÖVEGBŐL.
   *
   * A pozíciót nem adjuk át, és nem is kell: a motor a felszíni alakot KERESI
   * meg az iratban (`SeedMatcher`), tehát a kijelölés minden előfordulása
   * megkapja a jelölést — nem csak az, amelyikre a felhasználó rákattintott.
   * Ez a helyes viselkedés: aki azt mondja, hogy „a Szikla Agrár Kft. egy
   * szervezet", nem egyetlen mondatról beszél.
   */
  const kijelolesFelvesz = (
    szoveg: string,
    kind: EntityKind,
    role: string,
    identifierKind?: AzonositoKind,
  ): void => {
    const uj: PartyInput = {
      id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind,
      fullName: szoveg,
      // A nemet nem találgatjuk a felületen: ahhoz a szöveg kell, az pedig
      // sosem hagyja el a főfolyamatot. Az „N" a kézi felvitel alapállása is.
      gender: 'N',
      role,
      ...(identifierKind ? { identifierKind } : {}),
    };
    if (kind === 'identifier') felekFrissit(parties, [...identifiers, uj]);
    else felekFrissit([...parties, uj], identifiers);
  };

  /** A találathoz tartozó fél — akár a felek, akár az azonosítók közül. */
  const felhezTartozo = (entityId: string): PartyInput | null =>
    parties.find((p) => p.id === entityId) ?? identifiers.find((p) => p.id === entityId) ?? null;

  /** A fél kivétele a listából — az aláhúzás ettől mindenhol eltűnik. */
  const felTorles = (entityId: string): void => {
    felekFrissit(
      parties.filter((p) => p.id !== entityId),
      identifiers.filter((p) => p.id !== entityId),
    );
  };

  /**
   * ÁTÉRTELMEZÉS: ugyanaz a szöveg, más fajta.
   *
   * A fél átkerülhet a két lista között (egy tévesen névnek nézett számsor
   * azonosító lesz, és fordítva), ezért mindkettőből kivesszük, és a fajtának
   * megfelelőbe tesszük vissza — UGYANAZZAL az azonosítóval, hogy a kézzel
   * megadott álnév (`manualReplacement`) se vesszen el.
   */
  const felAtertelmez = (
    entityId: string,
    kind: EntityKind,
    role: string,
    identifierKind?: AzonositoKind,
  ): void => {
    const regi = felhezTartozo(entityId);
    if (!regi) return;
    const uj: PartyInput = { ...regi, kind, role, ...(identifierKind ? { identifierKind } : {}) };
    if (kind !== 'identifier') delete uj.identifierKind;
    const maradekFelek = parties.filter((p) => p.id !== entityId);
    const maradekAzon = identifiers.filter((p) => p.id !== entityId);
    if (kind === 'identifier') felekFrissit(maradekFelek, [...maradekAzon, uj]);
    else felekFrissit([...maradekFelek, uj], maradekAzon);
  };

  /**
   * EGY SZÖVEG HOZZÁKÖTÉSE EGY MÁR MEGLÉVŐ SZEREPLŐHÖZ.
   *
   * Ez a menü fő művelete, és nem véletlenül: az iratban ugyanaz az ember
   * tucatnyi alakban szerepel („Kovács János", „Kovácsné", „K. J.",
   * „a felperes"), és amit a program nem ismert fel, arról a felhasználó nem
   * azt akarja megmondani, hogy MILYEN SZEREPBEN áll — hanem hogy KI AZ.
   *
   * A megoldás egy második, „kézi" alak felvétele UGYANAZZAL a fedőnévvel: a
   * fél saját álneve kézi csereszövegként kerül rá, tehát a kimenetben
   * ugyanaz áll majd, mint az eredeti alakjainál. Így a két előfordulás
   * összeér, és a kulcsfájlban is egy szereplőként látszik.
   */
  const szereplohozKot = (szoveg: string, cel: CastRow): void => {
    const forras = felhezTartozo(cel.entityId);
    const uj: PartyInput = {
      id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind: forras?.kind ?? 'person',
      fullName: szoveg,
      gender: forras?.gender ?? 'N',
      role: forras?.role ?? cel.role,
      // A CÉL ÁLNEVE, kézi csereszövegként: ettől lesz a kimenetben ugyanaz.
      manualReplacement: cel.replacement,
    };
    felekFrissit([...parties, uj], identifiers);
  };

  /** Egy MEGLÉVŐ találat átirányítása másik szereplőre. */
  const talalatAtiranyit = (m: MatchRow, cel: CastRow): void => {
    if (m.entityId === cel.entityId) return;
    szereplohozKot(m.surface, cel);
  };

  /**
   * A VÁLASZTHATÓ SZEREPLŐK — akiket a program már ismer, az álnevükkel.
   *
   * A menü ebből épül: nem eljárási szerepeket kínál („felperes", „tanú"),
   * hanem azt, hogy a kijelölt szöveg KIT jelent. A szerep a szereplőé, nem
   * ezé az egy előfordulásé.
   */
  const valaszthatoSzereplok = useMemo(
    () =>
      (analysis?.cast ?? [])
        .filter((c) => c.kind !== 'identifier' && !c.skipped && c.replacement)
        .filter((c) => c.replacement !== '(nem cseréljük)'),
    [analysis],
  );

  /**
   * A „MINEK ÉRTELMEZZE" ÁGAK — ugyanaz a szerkezet felvételnél és
   * átértelmezésnél.
   *
   * Egyetlen helyen áll, mert a két menü ugyanazt a kérdést teszi fel, csak
   * más következménnyel. Két külön felsorolásból az egyik előbb-utóbb lemaradna
   * egy fajtáról, és a felhasználó azt hinné, hogy egy szó nem lehet az, ami.
   */
  const fajtaAgak = (
    valaszt: (kind: EntityKind, role: string, ik?: AzonositoKind) => void,
  ): MenuTetel[] => [
    {
      fajta: 'almenu',
      cimke: 'Személy',
      sugo: 'Fedőnevet kap. Az eljárási szerep abban segít, hogy a program a megfelelő alakot adja neki.',
      tetelek: ROLES.map((r) => ({
        fajta: 'gomb' as const,
        cimke: r,
        onValaszt: () => valaszt('person', r),
      })),
    },
    {
      fajta: 'almenu',
      cimke: 'Szervezet',
      sugo: 'Cég, hivatal, intézmény — kitalált cégnevet kap, a cégforma megmarad.',
      tetelek: [
        { fajta: 'gomb', cimke: 'szervezet', onValaszt: () => valaszt('org', 'szervezet') },
        { fajta: 'gomb', cimke: 'felperes', onValaszt: () => valaszt('org', 'felperes') },
        { fajta: 'gomb', cimke: 'alperes', onValaszt: () => valaszt('org', 'alperes') },
        { fajta: 'gomb', cimke: 'hitelező', onValaszt: () => valaszt('org', 'hitelező') },
        { fajta: 'gomb', cimke: 'egyéb', onValaszt: () => valaszt('org', 'egyéb') },
      ],
    },
    {
      fajta: 'gomb',
      cimke: 'Hely',
      sugo: 'Település, közterület — kitalált helynevet kap.',
      onValaszt: () => valaszt('place', 'egyéb'),
    },
    {
      fajta: 'almenu',
      cimke: 'Azonosító',
      sugo: 'Számsor vagy cím: nem fedőnevet kap, hanem az adatfajta megnevezését — „[adószám]".',
      tetelek: (Object.keys(AZONOSITO_NEV) as AzonositoKind[]).map((k) => ({
        fajta: 'gomb' as const,
        cimke: AZONOSITO_NEV[k],
        onValaszt: () => valaszt('identifier', AZONOSITO_NEV[k], k),
      })),
    },
  ];

  /**
   * A KIJELÖLT SZÖVEG — DE CSAK AKKOR, HA A KATTINTÁS RAJTA VAN.
   *
   * EZ VOLT AZ A HIBA, AMITŐL A MENÜ MÁS SZÖVEGET MUTATOTT, mint ami a
   * kurzor alatt állt. A kijelölés ugyanis MEGMARAD azután is, hogy a
   * felhasználó másfelé kattint: aki kijelölt valamit, majd az irat egy másik
   * pontján nyitott jobb gombos menüt, a RÉGI kijelölésről kapott menüt — és
   * ha rábólint, egy olyan szót vesz fel félként, amire rá sem nézett.
   *
   * A kattintás helyét ezért összevetjük a kijelölés téglalapjaival. Ami nem
   * a kurzor alatt van, az nem a kérdés tárgya.
   */
  const kijelolesAPont = (x: number, y: number): string => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
    const tures = 2;
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const r of sel.getRangeAt(i).getClientRects()) {
        if (
          x >= r.left - tures &&
          x <= r.right + tures &&
          y >= r.top - tures &&
          y <= r.bottom + tures
        ) {
          return sel.toString();
        }
      }
    }
    return '';
  };

  /** Rövidítve, hogy a menü fejléce ne nőjön az irat szélességére. */
  const rovidit = (t: string, max = 42): string =>
    t.length <= max ? t : `${t.slice(0, max - 1)}…`;

  /** Jelölésre kattintva: kikapcsolás, aláhúzás törlése, átértelmezés. */
  const talalatMenu = (m: MatchRow): MenuTetel[] => {
    const most = decisions[m.id] ?? m.decision;
    const cserelodik = matchOutcome({ ...m, ...(most ? { decision: most } : {}) }) === 'csere';
    const fajta = matchKind(m, hivatalosIdk);
    const fel = felhezTartozo(m.entityId);

    const tetelek: MenuTetel[] = [
      {
        fajta: 'cim',
        szoveg: rovidit(m.surface),
        also: cserelodik
          ? `${FAJTA_CIMKE[fajta]} — lecserélve erre: ${m.replacement ?? '—'}`
          : `${FAJTA_CIMKE[fajta]} — most nem cserélődik`,
      },
      { fajta: 'valaszto' },
      {
        fajta: 'gomb',
        cimke: cserelodik ? 'Ezt az előfordulást ne cserélje' : 'Ezt az előfordulást cserélje',
        sugo: 'Csak ez az egy hely — a szó többi előfordulása nem változik. Ugyanaz, mint balra rákattintani.',
        onValaszt: () => iratKattintas(m.id),
      },
    ];

    /*
      AZ ALÁHÚZÁS TÖRLÉSE CSAK OTT, AHOL VAN MIT TÖRÖLNI.

      Az összeg és a dátum nem „fél": nincs listasoruk, amit ki lehetne venni —
      őket a beállító lap fajtakapcsolója kapcsolja ki, egyben. Egy itt
      felkínált „vedd ki a listából" ezeknél némán nem csinálna semmit, ami
      rosszabb, mint a hiánya.
    */
    if (fel) {
      tetelek.push(
        /*
          A „VEDD LE RÓLA AZ ALÁHÚZÁST" SOR INNEN KIKERÜLT.

          Ugyanazt tette, amit a beállító lap sorának kapcsolója, csak más
          szavakkal — és a menü első két sora így két hasonló, de nem azonos
          műveletet kínált egymás alatt („ne cserélje" / „vedd le róla"),
          amiről kattintás előtt nem derült ki, miben térnek el.
        */
        { fajta: 'valaszto' },
        {
          fajta: 'almenu',
          cimke: 'Ugyanaz, mint…',
          tetelek: valaszthatoSzereplok
            .filter((c) => c.entityId !== m.entityId)
            .map((c) => ({
              fajta: 'gomb' as const,
              cimke: `${c.original} → ${c.replacement}`,
              onValaszt: () => talalatAtiranyit(m, c),
            })),
        },
        {
          fajta: 'almenu',
          cimke: 'Más fajta…',
          tetelek: fajtaAgak((kind, role, ik) => felAtertelmez(m.entityId, kind, role, ik)),
        },
      );
    }
    return tetelek;
  };

  /** Kijelölésre: vegyük fel új félként, a választott fajtával. */
  const kijelolesMenu = (x: number, y: number): MenuTetel[] => {
    /*
      A SORTÖRÉS SZÓKÖZZÉ VÁLIK. A PDF-ben a sortörés fizikai: egy két sorba
      tört cégnév kijelölve sortöréssel érkezne, a motor pedig pontosan azt a
      karakterláncot keresné — és sosem találná meg. Az iratbeli szöveg
      ugyanezen a normalizáláson megy át (`buildPageText`).
    */
    const szoveg = kijelolesAPont(x, y).replace(/\s+/g, ' ').trim();
    if (szoveg.length === 0) {
      return [
        {
          fajta: 'cim',
          szoveg: 'Nincs kijelölve semmi',
          also:
            'Jelöld ki a szöveget az iraton, és kattints rá jobb gombbal — akkor megmondhatod, ' +
            'minek értelmezze a program. Egy már aláhúzott szón a jobb kattintás a jelölést javítja.',
        },
      ];
    }
    return [
      {
        fajta: 'cim',
        szoveg: rovidit(szoveg),
        also: 'Kire vonatkozik? Minden előfordulása megjelölődik.',
      },
      { fajta: 'valaszto' },
      /*
        ELÖL A MEGLÉVŐ SZEREPLŐK — ez a gyakori eset.

        Amit a program nem ismert fel, az többnyire egy MÁR ISMERT szereplő
        másik alakja („Kovácsné", „a felperes úr", egy elgépelt név). Ilyenkor
        a kérdés nem az, hogy milyen fajta, hanem hogy KI AZ — és a válasz a
        listán ott áll, a fedőnevével együtt.
      */
      ...(valaszthatoSzereplok.length > 0
        ? ([
            {
              fajta: 'almenu',
              cimke: 'Ugyanaz, mint…',
              tetelek: valaszthatoSzereplok.map((c) => ({
                fajta: 'gomb' as const,
                cimke: `${c.original} → ${c.replacement}`,
                onValaszt: () => szereplohozKot(szoveg, c),
              })),
            },
            { fajta: 'valaszto' },
          ] as MenuTetel[])
        : []),
      { fajta: 'cim', szoveg: 'Vagy új szereplő:', also: '' },
      ...fajtaAgak((kind, role, ik) => kijelolesFelvesz(szoveg, kind, role, ik)),
    ];
  };

  /**
   * A MENÜ ÖSSZEÁLLÍTÁSA — két eset, egy belépési pont.
   *
   * Ha a kattintás JELÖLÉSRE esett, arról a találatról szól; egyébként a
   * kijelölt szövegről. A sorrend nem véletlen: aki egy aláhúzott szóra kattint
   * jobb gombbal, a jelölésről kérdez — akkor is, ha korábban kijelölt valamit
   * máshol, és a kijelölés még ott áll.
   */
  const iratContext = (e: React.MouseEvent, matchId: number | null): void => {
    if (!analysis) return;
    const m = matchId === null ? undefined : analysis.matches.find((x) => x.id === matchId);
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      tetelek: m ? talalatMenu(m) : kijelolesMenu(e.clientX, e.clientY),
    });
  };

  const setupBeallitas = (valtozas: Partial<DokumentumBeallitasok>): void => {
    if (valtozas.mode !== undefined) setMode(valtozas.mode);
    if (valtozas.themeId !== undefined) setThemeId(valtozas.themeId);
    if (valtozas.labelLang !== undefined) setLabelLang(valtozas.labelLang);
    if (valtozas.autoThreshold !== undefined) setAutoThreshold(valtozas.autoThreshold);
    if (valtozas.keepKey !== undefined) setKeepKey(valtozas.keepKey);
    if (valtozas.replaceAmounts !== undefined) setReplaceAmounts(valtozas.replaceAmounts);
    // A `hasOwnProperty` kell, nem az `!== undefined`: a mező KIÜRÍTÉSE is
    // érvényes válasz („számold a kulcsból"), és azt `undefined` jelenti.
    if (Object.prototype.hasOwnProperty.call(valtozas, 'amountFactor')) {
      setAmountFactor(valtozas.amountFactor);
    }
    if (Object.prototype.hasOwnProperty.call(valtozas, 'dateShiftDays')) {
      setDateShiftDays(valtozas.dateShiftDays);
    }
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

  /**
   * IRATVÁLTÁS a bal panelen.
   *
   * Az előnézetet el KELL dobni: az a MÁSIK irat álnevesített szövege volt, és
   * a képernyőn maradva úgy nézne ki, mintha az újonnan választott irat
   * tartalma volna. A kijelölés is elmegy, mert az egy másik irat találatára
   * mutatott — ott a görgetés a semmibe vinne.
   */
  const iratValt = (index: number): void => {
    if (index === aktivDoc) return;
    setAktivDoc(index);
    setPreview(null);
    setPreviewPages(null);
    setValtozasPages(null);
    setPreviewError(null);
    setSelected(null);
  };

  /**
   * IRAT HOZZÁADÁSA AZ ÜGYHÖZ.
   *
   * Nem kérdez rá semmire, és ez szándékos: a hozzáadás NEM VESZÍT EL semmit —
   * a meglévő iratok, a felek és a döntések a helyükön maradnak. Ettől lett
   * érthető az, ami az „Új ügy" gombbal nem volt: ami egyszerre van betöltve,
   * az egy ügy, közös álnév-kiosztással.
   */
  const iratHozzaad = useCallback(async () => {
    const path = await api.chooseDocument();
    if (!path) return;
    await openPath(path, true);
  }, [openPath]);

  /** Nevet veszek fel kézzel — a Felek-párbeszéd, most már kérésre. */
  const keziFelvitel = (): void => setDialog('parties');

  /**
   * IRAT KIVÉTELE AZ ÜGYBŐL.
   *
   * A döntéseket EL KELL DOBNI. A találatok azonosítója az irat betöltési
   * sorrendjéből származik (a főfolyamat iratonként eltolja); egy irat
   * kivételével a mögötte állók azonosítója elcsúszik, a megőrzött döntések
   * tehát MÁS SZAVAKRA vonatkoznának. Egy elveszett kattintás bosszantó, egy
   * átcsúszott „ne cseréld" néma hiba a kész iratban.
   */
  const iratBezar = useCallback(
    async (path: string) => {
      try {
        const lista = (await api.closeDocument?.(path)) ?? [];
        setDocs(lista);
        setAktivDoc(0);
        setDecisions({});
        setSelected(null);
        setPreview(null);
        setPreviewPages(null);
        setValtozasPages(null);
        setPreviewError(null);
        if (lista.length === 0) {
          setAnalysis(null);
          setFazis('beallitas');
        } else {
          ujraKert();
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ujraKert],
  );

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
    // A folyamat harmadik állomása: az ellenőrzés és a mentés füle.
    setSetupFul('kesz');

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

      Innentől a csere után az ELLENŐRZÉS FÜLE jön: ott áll az összegzés arról,
      mi cserélődött, és ott a mentés gombja. Menteni egy kattintás — de a
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

          MINDHÁROM GOMB A MENÜ ÚTJÁT HÍVJA (`handleMenu`), nem egy másolt
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
              aria-label="Mentés másként"
            >
              <FejlecIkon nev="mentes" />
            </button>
            {/*
              NYOMTATÁS — a bal panel fejlécéből ide.

              Ott egy egész sort foglalt a nézetváltó mellett; itt a másik két
              művelet mellé kerül, amelyek szintén a KÉSZ irattal csinálnak
              valamit. A gomb csak akkor él, ha van mit papírra vinni: a
              nyomtatás a képernyő tartalmát viszi, tehát a vizsgálat alatt a
              beállítások képét adná ki — a felhasználó pedig abban a hitben
              venné el a papírt, hogy az iratot nyomtatta ki. A `doPrint` ezt
              eddig is elutasította, csak hibaüzenettel; a letiltott gomb
              hamarabb szól, és nem üzenettel bünteti a kattintást.
            */}
            <button
              className="btn ghost icon"
              disabled={!analysis || fazis !== 'beallitas'}
              onClick={() => handleMenu('print')}
              aria-label="Nyomtatás"
            >
              <FejlecIkon nev="nyomtatas" />
            </button>

            {/*
              A „BEÁLLÍTÁSOK ÉS TALÁLATOK" IKON INNEN KIKERÜLT.

              A folyamat harmadik állomása (az ellenőrzés) külön képernyő volt,
              és ez az ikon vitt oda-vissza közte és a beállító lap közt. Ma az
              az állomás a beállító lap HARMADIK FÜLE, a másik kettő mellett —
              a fülsor pedig kimondja a sorrendet is, amit ez az ikon nem
              tudott.

              AZ „ÚJ ÜGY" IKON IS KIKERÜLT.

              Nem volt kitalálható, mit csinál: a felhasználó szerint ugyanaz,
              mint a megnyitás. Majdnem: a különbség egyedül az álnév-kiosztás
              sorsa — új ügyben ugyanaz a valódi név MÁS fedőnevet kap, tehát a
              két ügy kimenete nem köthető össze. Ez a kérdés viszont pontosan
              akkor merül fel, amikor a KÖVETKEZŐ iratot nyitjuk meg — ott is
              kérdezzük meg (`OpenOtherDialog`), ahol a felhasználó a
              következményét is érti. A Fájl menüben megmarad külön parancsként.
            */}
          </div>
        )}

        {/*
          AMIT A PROGRAM DÖNTÖTT EMBER HELYETT — a jelzés a mentésig kint marad.

          A lista a mentés utáni ablakban is előjön, de aki a mentést
          megszakítja, ugyanígy ott áll egy irattal, amiben döntöttek helyette —
          akkor sem szabad, hogy ez a tény eltűnjön a képernyőről.
        */}
        {/*
          A „N× DÖNTÖTTÜNK HELYETTED" GOMB INNEN KIKERÜLT.

          Ablakot nyitott ugyanarra a listára, ami MA már kibontva ott áll az
          „Ellenőrzés és mentés" fülön — az a lap gyakorlatilag ebből áll. Egy
          fejlécgomb, ami egy máshol amúgy is látható listát nyit ki
          párbeszédben, nem figyelmeztetés többé, csak egy második út
          ugyanoda.
        */}

        {/* A blokkoló állapot LÁTSZIK is, nemcsak tilt: a letiltott mentés
            gomb magában csak annyit üzen, hogy „valamiért nem lehet". */}
        {doc && revisionsBlocked && (
          <button
            className="btn ghost sm jelzes gond"
            onClick={() => setDialog('revisions')}
          >
            <FejlecIkon nev="figyelem" />
            <span className="btnszo">{revisionsDb} feloldatlan módosítás</span>
          </button>
        )}
        {/*
          A MODELL HIÁNYA MINDHÁROM ÁLLOMÁSON LÁTSZIK.

          Eddig a lépéssávban állt, vagyis csak a munkalapon — aki a beállító
          lapon nézte át a találatokat, semmit nem tudott arról, hogy a lista
          azért ilyen rövid, mert a nyelvi modell el sem indult. A fejléc végig
          ott van, ezért a jelzés innentől a mentésig kint marad.
        */}
        {/* A beállító lapon NEM: ott a modellsáv áll, saját letöltővel — két
            vezérlő két különböző úttal ugyanarra a tényre. */}
        {detected && detected.model.state !== 'ok' && fazis !== 'beallitas' && (
          <button
            className="btn ghost sm"
            style={MODEL_CHIP[detected.model.state].loud ? { color: 'var(--amber)' } : undefined}
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
          valtozaskovetes={revisionsDb}
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
            {/*
              AZ IRATSÁV — az ügy összes irata egy sorban.

              Ez váltotta ki az „Új ügy" gombot. Amíg egyszerre csak egy irat
              lehetett nyitva, a felhasználónak fejben kellett tartania, hogy a
              következő megnyitás MEGTARTJA az álnév-kiosztást, az „Új ügy"
              pedig eldobja — és a különbség sehol nem látszott. Itt viszont
              látszik: ami ebben a sorban áll, az egy ügy, és egyetlen elemzés
              fut rájuk. Hozzáadni egy kattintás, kivenni egy másik.

              Egy iratnál is kint van a sáv: a „+" fül így nem bukkan elő a
              semmiből a második iratnál, hanem végig ott áll.

              A KIVÉTEL MOSTANTÓL A FÜLÖN VAN, nem a sáv végén.

              Régen egyetlen „Kivétel" gomb állt a fülek után, és az mindig az
              ÉPPEN NÉZETT iratra vonatkozott: amit ki akartál venni, arra
              előbb át kellett váltani. A fülön ülő × arra az iratra mutat,
              amelyiken ül — ez az, amit egy fülsortól bárki elvár. Hogy ne
              gomb legyen a gombban (érvénytelen HTML, és a képernyőolvasó sem
              tud vele mit kezdeni), a fül maga sávvá lett: benne KÉT gomb, a
              névé és a bezárásé.
            */}
            <div className="iratsav">
              {docs.map((d, i) => (
                <div
                  key={d.path}
                  className={`iratful${i === aktivDoc ? ' active' : ''}`}
                >
                  <button className="ful-nev" onClick={() => iratValt(i)}>
                    {d.fileName}
                  </button>
                  {/* Egyetlen iratnál nincs ×: az ügy utolsó iratát kivenni
                      annyi, mint félúton bezárni a programot. */}
                  {docs.length > 1 && (
                    <button
                      className="ful-x"
                      aria-label={`${d.fileName} kivétele az ügyből`}
                      onClick={() => void iratBezar(d.path)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {/* A HOZZÁADÁS IS FÜL, csak jel van rajta felirat helyett: a
                  helye mondja meg, mit csinál — ide kerül a következő irat. A
                  teljes mondat a buboréksúgóban áll. */}
              <button
                className="iratplusz"
                aria-label="Irat hozzáadása az ügyhöz"
                onClick={() => void iratHozzaad()}
              >
                +
              </button>
              <div className="spacer" />
            </div>
            {/*
              A DOKUMENTUM SÁVJA: mit lát a szemem, és mit nézek belőle.

              HÁROM SORBÓL LETT KETTŐ. A fájlnév innen kikerült — egy sorral
              feljebb, a fülön ott áll —, a „100 cserélődik · 101 találat"
              pedig az állapotsorba, ahol a többi szám is lakik: ugyanaz az
              adat két helyen csak azt kérdezteti meg, melyik az igazi.

              Ami maradt, az a KÉT teherhordó dolog: balra a jelmagyarázat
              (mit jelentenek a színek az iraton, és melyikből mennyi van),
              jobbra a nézetváltó — az irat fölött, mert az iratról szól.
            */}
            <div className="setupdoc-head">
              {analysis ? (
                <>
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
                      <span key={j.kulcs} className={`jel ${j.osztaly}`}>
                        {j.cimke} · {j.db}
                      </span>
                    ))}
                  </span>
                </>
              ) : null}
              <span className="spacer" />
              {/*
                A NÉZETVÁLTÓ — két szó, magyarázat nélkül.

                Régen egy egész sort kapott, és a feliratai mondatok voltak
                („Eredeti — kiemelve", „Előnézet — ez kerül a fájlba"). A
                magyarázat egyszer hasznos, utána minden megnyitásnál ott
                zsúfolódik. Ami a kettő közti különbségből tényleg számít, azt
                a NÉZET maga mondja el: az egyiken valódi nevek állnak, a
                másikon álnevek.

                KÉT SZAKASZ, NEM EGY ÁTBILLENŐ GOMB. Egy „Előnézet" feliratú
                gombról nem derül ki, hogy azt MUTATJA-e éppen, vagy oda
                visz; ezen az egy helyen ez a félreértés drága, mert a
                nyomtatás a képernyő tartalmát viszi papírra.
              */}
              {/*
                A TÖRDELÉS KAPCSOLÓJA — csak az előnézeten van értelme.

                Az EREDETI nézeten nincs mit tördelni: az az irat, ahogy
                érkezett. A kapcsoló ezért az előnézettel együtt jelenik meg,
                közvetlenül a nézetváltó mellett — ott, ahol a hatása látszik.

                A FÁJLRA IS HAT, nem csak a képre: a lapkép a kész kimeneti
                bájtokból készül. Ezért nem „megjelenítés" a felirata, hanem
                az, amit tesz.
              */}
              {analysis && view === 'preview' && doc.format === 'pdf' && (
                <button
                  /* NEM `ghost`: az átlátszóra állítja a hátteret és a keretet (`.btn.ghost`,
                     nagyobb fajsúllyal, mint a mi szabályunk), és a kikapcsolt állapot
                     keret nélkül nem néz ki kapcsolónak — a felhasználó nem is
                     sejtené, hogy rá lehet kattintani. */
                  className={`btn sm tordeleskapcs${paragraphReflow ? ' be' : ''}`}
                  aria-pressed={paragraphReflow}
                  aria-label={
                    paragraphReflow
                      ? 'Bekezdésenkénti tördelés bekapcsolva'
                      : 'Bekezdésenkénti tördelés kikapcsolva — soronkénti csere'
                  }
                  onClick={() => {
                    setParagraphReflow(!paragraphReflow);
                    setHasWork(true);
                    ujraKert();
                  }}
                >
                  {/*
                    VALÓDI IKON, nem betűjel. A ¶ egy BETŰ: a saját
                    alapvonalához igazodik, alálógó szárral, tehát egy
                    négyzetes gombban sosem ül pontosan középen — hiába
                    középre igazítottuk a dobozát. Egy rajzolt ikon a
                    négyzetéhez igazodik, és a program többi ikonjával is
                    egy család (`FejlecIkon`).

                    Az ikon a szöveg sorba csordulását mutatja — pontosan azt,
                    amit a kapcsoló csinál.
                  */}
                  <FejlecIkon nev="tordeles" />
                </button>
              )}
              {/* Elemzés nélkül nincs mire váltani: az előnézet az elemzésből
                  áll elő. Egy ilyenkor is kint álló váltó azt ígérné, hogy van
                  már kimenet — a kattintás után pedig ugyanaz az üres nézet
                  maradna, csak a gomb billenne át. */}
              {analysis && (
                <div className="seg sm nezetvalto">
                  <button
                    className={`segbtn${view === 'source' ? ' active' : ''}`}
                    onClick={() => setView('source')}
                  >
                    Eredeti
                  </button>
                  {/*
                    A HARMADIK ÁLLÁS A KETTŐ KÖZÖTT — mert a kérdése is köztük van.

                    Az eredeti azt mutatja, mi van most; az előnézet azt, mi
                    lesz. A kettő közti ELTÉRÉST eddig fejben kellett
                    összerakni, a két fül közt oda-vissza kapcsolgatva. Itt a
                    régi áthúzva áll, közvetlenül mellette az új.
                  */}
                  <button
                    className={`segbtn${view === 'valtozas' ? ' active' : ''}`}
                    onClick={() => setView('valtozas')}
                  >
                    Változás
                  </button>
                  <button
                    className={`segbtn${view === 'preview' ? ' active' : ''}`}
                    onClick={() => setView('preview')}
                  >
                    Előnézet
                  </button>
                </div>
              )}
            </div>
            {/*
              A SÁV MOSTANTÓL CSAK AKKOR SZÓLAL MEG, HA VAN MIT BEVALLANI.

              Régen feltétel nélkül kiírta PDF-en, hogy „a tördelést az
              előnézet nem mutatja" — ez ma már nem igaz: a lapképes előnézet a
              KÉSZ kimeneti bájtokat rajzolja ki. Igaz viszont akkor maradt, ha
              a lapkép nem jött össze (hiányzó natív rajzoló, régebbi híd), és
              a szöveges nézetre estünk vissza. A mondat ezért a tényleges
              állapothoz tartozik, nem a formátumhoz.
            */}
            {view === 'preview' &&
              analysis &&
              doc.format === 'pdf' &&
              previewPages === null &&
              preview !== null && (
                <div className="viewbanner">
                  A lapképet nem tudtuk elkészíteni, ezért az előnézet csak a szöveget mutatja, a
                  tördelését nem — a mentett fájl az eredeti tördelést megtartja.
                </div>
              )}
            {/*
              A BETÖLTÉS A DOKUMENTUM HELYÉN — nem az egész képernyőn.

              A vizsgálat alatt a lap többi része a helyén marad: az iratsáv, a
              jelmagyarázat, a jobb oldali beállítások. Ami tényleg
              újraszámolódik, az a találatok listája és az iraton lévő
              kiemelés — tehát a várakozás jele is oda való, ahol a változás
              lesz.

              A RÉGI TARTALMAT NEM DOBJUK EL. A `viewport` alatta marad, a
              betöltés csak ráfekszik: aki eddig egy bekezdést olvasott, az a
              vizsgálat után ugyanott találja magát, nem egy üres lapon.
            */}
            {vizsgalatKep !== 'var' && doc && (
              <div className="iratbetoltes" role="status">
                <div className="ibdoboz">
                  <img className="pulzus" src={markUrl} alt="" />
                  <div className="ibcim">
                    {vizsgalatKep === 'nyit' ? 'Az irat megnyitása' : 'A nevek megkeresése'}
                  </div>
                  <div className="csik hatarozatlan">
                    <div className="bar" />
                  </div>
                </div>
              </div>
            )}
            {analysis && view === 'valtozas' && valtozasPages !== null ? (
              /*
                A LAPKÉPES ÖSSZEVETÉS: ugyanaz az irat, ahogy a fájlba kerül,
                de a lecserélt alakok áthúzva ott állnak az új mellett. A
                bekezdés a helyén marad — a hosszabb szöveg a saját
                függőleges sávjában fér el, sűrűbben szedve.
              */
              <PreviewView
                analysis={analysis}
                text={null}
                lapok={valtozasPages}
                error={null}
                hivatalosIdk={hivatalosIdk}
              />
            ) : analysis && view === 'valtozas' ? (
              <OsszevetesView
                analysis={analysis}
                {...(aktivSzakasz ? { szakasz: aktivSzakasz } : {})}
                hivatalosIdk={hivatalosIdk}
                dontesek={decisions}
                selected={selected}
                onSelect={setSelected}
              />
            ) : analysis && view === 'preview' ? (
              <PreviewView
                analysis={analysis}
                text={preview}
                lapok={previewPages}
                error={previewError}
                hivatalosIdk={hivatalosIdk}
              />
            ) : analysis ? (
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
                {...(aktivSzakasz ? { szakasz: aktivSzakasz } : {})}
                selected={selected}
                hivatalosIdk={hivatalosIdk}
                dontesek={decisions}
                onSelect={setSelected}
                onToggle={iratKattintas}
                onContext={iratContext}
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
            onKapcsol={sorKapcsol}
            lepes={lepes}
            onLepesKezd={lepesKezd}
            onLepesMozog={lepesMozog}
            onLepesDontes={lepesDontes}
            onCsoport={setupCsoport}
            onUjraVizsgalat={ujraVizsgalat}
            onKeziFelvitel={keziFelvitel}
            {...(api.reassignNames
              ? {
                  onUjraOsztas: () => {
                    /*
                      A NYILVÁNTARTÁS ELDOBÁSA, AZTÁN ÚJRASZÁMOLÁS.

                      A sorrend kötött: ha előbb kérnénk elemzést, az még a
                      régi kiosztást kapná meg, és a gomb látszólag nem
                      csinálna semmit.

                      A DÖNTÉSEK ELVESZNEK, mint minden olyan lépésnél, ami a
                      féllistát átrendezi: a találat azonosítója az iratbeli
                      sorrendjéből származik, tehát a megőrzött döntések más
                      szavakra vonatkoznának.
                    */
                    void api.reassignNames!().then(() => {
                      setDecisions({});
                      setSelected(null);
                      setHasWork(true);
                      ujraKert();
                    });
                  },
                }
              : {})}
            onUjKeszlet={() => setDialog('sajatKeszlet')}
            onKeszletTorles={(id) => void removeCustomTheme(id)}
            ful={setupFul}
            onFul={setSetupFul}
            mentesAkadaly={mentesAkadaly}
            onMentes={requestExport}
            keszLap={
              analysis ? (
                <OsszegzoLap
                  analysis={analysis}
                  /*
                    A JELENTÉS MAGA MEGY ÁT, NEM EGY GOMB HOZZÁ.

                    Ugyanaz a `AutoDecisionReport`, amit a mentés utáni ablak
                    is kirajzol — nem másolat: két külön lista előbb-utóbb két
                    különbözőt mondana ugyanarról a tíz találatról. A
                    `panels.tsx` nem tudja maga meghívni (a `dialogs.tsx` már
                    onnan importál, a kör oda-vissza nem mehet), ezért itt
                    állítjuk elő, ahol mindkettő látszik.
                  */
                  autoJelentes={
                    autoDecidedCount > 0 ? (
                      <AutoDecisionReport
                        rows={autoAccepted}
                        /* „Nézzük át együtt" = ÁTVÁLTÁS AZ ÁTNÉZŐS ÚTRA
                           (`switchToReview`), nem fülváltás: a program
                           döntéseit csak úgy lehet felülbírálni, ha az irat
                           újra kérdezős módban fut le. */
                        onReview={switchToReview}
                        saved={false}
                      />
                    ) : null
                  }
                  mentesAkadaly={mentesAkadaly}
                  onVissza={() => setSetupFul('csere')}
                />
              ) : (
                /*
                  ELEMZÉS NÉLKÜL NINCS MIT ELLENŐRIZNI — és ezt ki kell mondani.

                  Ide akkor jutunk, ha a vizsgálat nem talált semmit, meg lett
                  szakítva, vagy ki volt kapcsolva. Korábban ez egy külön,
                  teljes képernyős lap volt („Nincs mit lecserélni"); ma a
                  harmadik fül tartalma, mert pontosan ugyanarra a kérdésre
                  válaszol: mi lesz az irattal, ha most mentek.
                */
                <div className="empty">
                  <div className="big">◌</div>
                  <p>
                    Ebben az iratban <b>egyetlen nevet sem jelöltünk cserére</b>, tehát a mentés a
                    szöveget változatlanul vinné tovább. Vedd fel a neveket kézzel, vagy indítsd
                    újra a vizsgálatot a „Mit cserélünk?" fülön.
                  </p>
                </div>
              )
            }
            onTovabb={() => void setupTovabb()}
          />
        </div>
      )}

      {/*
        A MUNKALAP ÉS A „NINCS MIT LECSERÉLNI" LAP INNEN KIKERÜLT.

        Mindkettő a beállító lap harmadik fülébe költözött („Ellenőrzés és
        mentés"). A munkalap ugyanúgy nézett ki, mint a beállító lap — balra
        az irat, jobbra egy panel —, tehát a köztük való váltás nem látszott
        váltásnak; a hozzá tartozó fejléc-ikon pedig a folyamat harmadik
        állomását rejtette el, miközben az első kettő fülként állt egymás
        mellett. A nézetváltó (Eredeti / Előnézet) a bal panel fejlécébe
        került, ahol az irat maga is van; a nyomtatás a programfejléc műveleti
        gombjai közé, a megnyitás és a mentés mellé — az is a kész iratból
        csinál valamit.
      */}

      {doc && fazis === 'beallitas' && analysis && (
        <footer className="statusbar">
          {/*
            A KIMENET SZÁMAI, nem a felismerés fokozatai: az állapotsor arra a
            kérdésre válaszol, hogy mi lesz az irattal.

            ITT JÖTT ÖSSZE A KÉT HELYEN ÁLLÓ SZÁM. A bal panel fejlécében
            ugyanez állt még egyszer („100 cserélődik · 101 találat”), csak
            durvábban: a hármas bontás nélkül. Két helyen mutatott számokból a
            felhasználó előbb-utóbb azt kérdezi, melyik az igazi — pedig
            ugyanaz volt, más felbontásban.

            A számok a FRISS döntéseket számolják (`kimenetSzamok`), nem a
            legutóbbi elemzés `outcomes` hármasát: kattintás után az elemzés
            csak egy rövid szünettel fut újra, és addig ez a sáv a kattintás
            előtti állást mutatta.
          */}
          <span>
            <b>{kimenetSzamok.csere}</b> {KIMENET_CIMKE.csere}
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
                {/* Ugyanaz a szó, mint a jelmagyarázatban és a pöttyön: az
                    „átnézésre vár" harmadik névként keringett ugyanarra. */}
                <b>{kimenetSzamok.bizonytalan}</b> {KIMENET_CIMKE.bizonytalan}
              </>
            )}
          </span>
          <span className="sep" />
          <span>
            <b>{kimenetSzamok.nincs}</b> {KIMENET_CIMKE.nincs}
          </span>
          <span className="sep" />
          {/* A HÁROM SZÁM ÖSSZEGE — a bal panel fejlécéből költözött ide.
              Nem dísz: ez mondja meg, hogy a fenti hármat teljesnek lehet-e
              olvasni, vagy hiányzik belőle valami. */}
          <span>{analysis.matches.length} találat</span>
          <span className="sep" />
          {/*
            AZ IRAT FAJTÁJA ÉS TERJEDELME — a dokumentumpanel fejlécéből ide.

            Ott a jelmagyarázat és a nézetváltó közé ékelődött, pedig egyik
            kérdésre sem válaszol: nem azt mondja meg, mi lesz az irattal, és
            nem is vezérlő. Adat az iratról — ugyanaz a fajta, mint a
            karakterszám mellette.

            A MEGJELENÍTETT iratról szól, nem az összesről; több irat mellett
            a füleken látszik, melyiken állunk, a buboréksúgó pedig kiírja a
            nevét is.
          */}
          <span>
            {doc.format.toUpperCase()} · {doc.pageCount}{' '}
            {doc.format === 'docx' ? 'dokumentumrész' : 'oldal'}
          </span>
          <span className="sep" />
          <span>
            {/* MINDEN betöltött irat együtt: a jobb oldali lista is az egészre
                szól, tehát az állapotsor sem szólhat csak az elsőről. */}
            {docs.reduce((n, d) => n + d.charCount, 0).toLocaleString('hu-HU')} karakter
            átvizsgálva
            {docs.length > 1 && ` · ${docs.length} irat`}
          </span>
          {docs.some((d) => d.looksScanned) && (
            <>
              <span className="sep" />
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                Szkennelt irat — a szöveg nem olvasható ki, OCR még nincs
              </span>
            </>
          )}
          {docs.some((d) => d.format === 'docx') && (
            <>
              <span className="sep" />
              <span>
                {docs.filter((d) => d.format === 'docx').reduce((n, d) => n + d.pageCount, 0)}{' '}
                dokumentumrész átvizsgálva
              </span>
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
          count={revisionsDb}
          busy={busy !== null}
          onResolve={resolveRevisions}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'scanned' && doc && (
        <ScannedDialog
          fileName={doc.fileName}
          onClose={() => setDialog(null)}
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
          onClose={() => setDialog(null)}
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
            /*
              ÚJ ÜGY: a mostani iratok helyére. A fedőnevek újrasorsolódnak
              (`caseSecret`), különben a másik ügyfél iratában ugyanaz a valódi
              név ugyanazt a fedőnevet kapná, és a két kimenet összeköthető
              volna. A kulcsfájl útvonala is az előző ügyé volt.
            */
            const p = pendingOpen?.path ?? null;
            setPendingOpen(null);
            setDialog(null);
            setCaseSecret(newCaseSecret());
            setKeyFilePath(null);
            if (p) void openPath(p);
            else void openDocument();
          }}
          onHozzaad={() => {
            /*
              HOZZÁADÁS: SEMMI NEM VÉSZ EL. A meglévő iratok, a felek és a
              döntések a helyükön maradnak — az új irat melléjük kerül, és a
              következő elemzés már mindegyikre fut.
            */
            const p = pendingOpen?.path ?? null;
            setPendingOpen(null);
            setDialog(null);
            if (p) void openPath(p, true);
            else void iratHozzaad();
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

      {/*
        A JOBB GOMBOS MENÜ A LAP FÖLÖTT ÁLL, nem a nézeten belül.

        A dokumentumpanel saját görgetősávot kap (`overflow: auto`), és egy
        azon belül kirajzolt menü a panel szélénél levágódna — épp a hosszú
        almenük (az eljárási szerepek, az azonosítófajták) tűnnének el belőle.
        A képernyőponthoz kötött, legfelső szintű menü ettől szabad.
      */}
      {menu !== null && <KontextMenu allas={menu} onClose={() => setMenu(null)} />}

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
          onChanged={(s) => {
            setAutoDetect(s.autoDetect);
            // A téma AZONNAL érvényre jut, nem a következő indításkor: a
            // Beállításokban választani és nem látni a hatását ugyanolyan
            // néma hiba, mint amikor a kapcsoló nem ér el a motorig.
            if (s.uiTheme === 'auto' || s.uiTheme === 'vilagos' || s.uiTheme === 'sotet') {
              setTemaValasztas(s.uiTheme);
            }
          }}
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
        <Overlay onClose={() => setError(null)}>
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
        </Overlay>
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
 * A BETÖLTÉS EGY SZAKASZA: megnevezés, állapot, csík.
 *
 * MIÉRT NEM VÁLTAKOZIK A KÉT SZAKASZ EGYMÁS UTÁN. Eddig egyetlen felirat és
 * egyetlen csík állt a képernyőn, és a megnyitásról az átolvasásra váltáskor
 * mindkettő kicserélődött — a felhasználó tehát két külön betöltőképernyőt
 * látott egymás után ugyanarra az egy mozdulatra. A második azt üzente, hogy
 * az első nem sikerült, vagy hogy elölről kezdődik valami.
 *
 * Innentől mindkét szakasz VÉGIG a képernyőn áll, a saját csíkjával. Ami
 * változik, az az állapotuk: a felső elkészül, az alsó elindul. A képernyő nem
 * cserélődik ki, csak halad — és a felhasználó látja, hány lépésből áll az
 * egész, már az első pillanatban.
 *
 * A HÁROM ÁLLAPOT:
 *  - 'var'  még nem került rá sor: üres csík, halvány felirat
 *  - 'fut'  ez megy éppen: mozgó vagy százalékos csík
 *  - 'kesz' megvolt: tele csík, „kész" felirat
 */
function BetoltoLepes({
  cim,
  allapot,
  arany,
  reszlet,
}: {
  cim: string;
  allapot: 'var' | 'fut' | 'kesz';
  /**
   * A szakasz készültsége 0 és 1 között, vagy `null`.
   *
   * A `null` NEM nulla százalék. A nulla azt jelentené, hogy most kezdtük, a
   * `null` viszont azt, hogy ebben a szakaszban nincs mit arányosítani — egy
   * kitalált százalékból a felhasználó rossz időt becsül. Ilyenkor mozgó csík
   * jár, ami annyit állít, amennyit tudunk: dolgozunk.
   */
  arany: number | null;
  /** A szakaszon belüli lépés neve, ha van ilyen (»modell betöltése«). */
  reszlet?: string | null;
}) {
  const szazalek = arany === null ? null : Math.round(arany * 100);
  const jel = allapot === 'kesz' ? 'kész' : allapot === 'var' ? 'vár' : (szazalek === null ? '' : `${szazalek}%`);
  return (
    <div className={`blepes ${allapot}`}>
      <div className="blfej">
        <span className="blcim">{cim}</span>
        <span className="bljel">{jel}</span>
      </div>
      {allapot === 'fut' && szazalek === null ? (
        <div className="csik hatarozatlan">
          <div className="bar" />
        </div>
      ) : (
        <div className="csik">
          <div
            className="bar"
            style={{ width: allapot === 'kesz' ? '100%' : `${szazalek ?? 0}%` }}
          />
        </div>
      )}
      {/*
        A RÉSZLET HELYE MINDIG MEGVAN — akkor is, ha nincs mit kiírni.

        Korábban csak a FUTÓ szakasz alatt jelent meg az eleme. Amikor a
        megnyitás elkészült és a keresés indult, a sor átugrott az egyik
        szakasz alól a másik alá: a képernyő magassága nem változott ugyan, de
        a szakaszváltás pillanatában igen — a középre igazított tartalom pedig
        ilyenkor elmozdult, és vele a jel is. Üresen kirajzolva a hely fenn van
        tartva, és semmi nem mozdul.
      */}
      <div className="blreszlet">{allapot === 'fut' ? (reszlet ?? '') : ''}</div>
    </div>
  );
}

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
    A CSÍK NEM MEGY VISSZA.

    A vizsgálat négy szakaszból áll, és nem mindegyik mérhető: az irat
    átolvasása százalékot ad, az utolsó szakasz (»összesítés«) nem. Amíg a
    képernyőn egyszerre csak EGY csík állt, ez nem tűnt fel — most viszont
    látszott volna, ahogy a nyolcvan százaléknál tartó csík visszaesik egy
    oda-vissza futó darabra. A felhasználó ebből azt olvassa ki, hogy elölről
    kezdődik valami.

    Ezért a mért érték MEGMARAD: ha egy szakasz nem tud százalékot mondani, az
    utolsó ismert állás marad a csíkon. Nem találunk ki új számot — azt a
    lentebbi `arany === null` ág tiltja —, csak nem dobjuk el azt, amit már
    tudunk. Új irat megnyitásakor (`'nyit'`) nullázódik.
  */
  const utolsoArany = useRef<number | null>(null);

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

    ÉS MINDKÉT SZAKASZ VÉGIG LÁTSZIK. Korábban a felirat és a csík
    kicserélődött a megnyitásról az átolvasásra váltáskor: ugyanaz az egy
    képernyő volt, de két különböző tartalommal, ami két külön betöltésnek
    látszott. Most a két szakasz egymás alatt áll, a sajátjával — a felső
    elkészül, az alsó elindul. Lásd `BetoltoLepes`.
  */
  if (kep === 'nyit' || kep === 'fut') {
    const szakasz = SZAKASZOK.find((sz) => sz.id === haladas?.szakasz)?.cim;
    const mert = kep === 'fut' && haladas && haladas.arany !== null ? haladas.arany : null;
    if (kep === 'nyit') utolsoArany.current = null;
    else if (mert !== null) utolsoArany.current = mert;
    const arany = mert ?? utolsoArany.current;
    return (
      <div className="loading">
        <div className="loading-in">
          {/* A jel forog: mozgás nélkül a képernyő megállt programnak látszik,
              és a felhasználó a leghosszabb szakasz közepén lövi ki. */}
          <img className="pulzus" src={markUrl} alt="" />
          <div className="fnev">{fajlNev}</div>

          <div className="blepesek">
            <BetoltoLepes
              cim="Az irat megnyitása"
              allapot={kep === 'nyit' ? 'fut' : 'kesz'}
              arany={null}
            />
            <BetoltoLepes
              cim="A nevek megkeresése"
              allapot={kep === 'nyit' ? 'var' : 'fut'}
              arany={arany}
              reszlet={kep === 'fut' ? (szakasz ?? 'az irat átolvasása') : null}
            />
          </div>

          {/*
            A LAP ALJA MINDIG UGYANAKKORA — akkor is, ha épp üres.

            A „Leállítás" gomb csak a vizsgálat alatt jelenik meg, a
            változáskövetés jelzése pedig csak néha. Mindkettő NÖVELTE a lap
            magasságát, a tartalom viszont függőlegesen középre van igazítva:
            a megjelenésük pillanatában az egész blokk feljebb csúszott, és
            vele a jel is — a betöltés közepén, amikor a felhasználó épp azt
            nézi, hogy halad-e valami. A hely ezért fenn van tartva.
          */}
          <div className="bactions">
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
