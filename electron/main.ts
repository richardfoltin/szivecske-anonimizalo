/**
 * Az alkalmazás főfolyamata.
 *
 * Itt fut minden, ami a dokumentumhoz nyúl: a fájlbeolvasás, a keresés, a csere
 * és a mentés. A felület soha nem lát fájlt, és nincs hálózati hozzáférése —
 * ez az, amitől bizonyíthatóan nem megy ki adat a gépből.
 */

import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
/*
  ÁTNEVEZVE, ÉS EZ KÖTELEZŐ.

  A `build:electron` lépés egy előtétsorral indítja a köteget, amiben már áll
  egy `const require = createRequire(import.meta.url)` — vagyis a
  》createRequire《 név a modul hatókörében FOGLALT. Ugyanazt a nevet másodszor
  behozva a kimenet szintaktikai hibával áll meg, és a főfolyamat el sem
  indul. Kimérve: a köteg első sora és ez az import ütközött.
*/
import { createRequire as igenylotKeszit } from 'node:module';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DocumentSession, type AnalyzeInput } from '../src/app/session.js';
import { detectParties, type DetectionResult } from '../src/app/detect.js';
import { readKeyFile } from '../src/app/keyfile.js';
import {
  MODEL_REGISTRY,
  ModelStore,
  formatBytes,
  namegenModel,
  type DownloadProgress,
  type ModelSpec,
} from '../src/app/models.js';
import { SettingsStore, type Settings } from '../src/app/settings.js';
import {
  epitsdAJavaslatKerest,
  keszitsTemat,
  olvasdAJavaslatot,
  type JavaslatCsoport,
  type NevJavaslat,
  type TemaBemenet,
  type TemaEredmeny,
} from '../src/app/temagyar.js';
import { ModelClient, megszakitasHiba, type AblakHaladas } from '../src/ai/client.js';
/*
  A `ModelStatus` NÉV ÜTKÖZIK, ezért hozzuk be átnevezve: a `models.ts`-ben
  ugyanez a név a LETÖLTÉS állapotát jelenti ('missing' | 'partial' |
  'installed'), itt viszont a FUTÁSÉ ('ok' | 'off' | 'missing' | 'failed'). A
  kettő két különböző kérdésre válaszol — a 'missing' az egyikben azt jelenti,
  hogy nincs a lemezen, a másikban azt, hogy emiatt nem is olvasta az iratot.
*/
import type {
  AnalysisResult,
  AutoDecisionRow,
  CastRow,
  DocSection,
  DocumentInfo,
  ExportFileResult,
  ExportOptions,
  ExportResult,
  MatchRow,
  ModelStatus as ModelRunStatus,
  PreviewPages,
  ThemeSummary,
} from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';
import type {
  AppInfo,
  DetectProgress,
  FelismeresSzakasz,
  IratBeallitas,
  KeyEntry,
  MenuAction,
  TemaGenStatus,
  UiState,
  UpdatePhase,
  UpdateProgress,
  UpdateState,
} from './preload.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.SZIVECSKE_DEV_URL;

/**
 * A Windows-nak szóló alkalmazásazonosító.
 *
 * EGYEZNIE KELL a package.json `build.appId` értékével: Windows ezen keresztül
 * köti össze a futó ablakot a Start menü parancsikonjával. E nélkül a tálcán az
 * általános Electron-ikon jelenik meg a szivecskés helyett, és az ablak külön
 * csoportba kerül a parancsikontól.
 */
const APP_ID = 'hu.szivecske.anonimizalo';

/** Az alkalmazás ikonja fejlesztéskor és telepítve is. */
function appIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? '', 'build', 'icon.ico'),
    join(HERE, '..', 'build', 'icon.ico'),
    join(HERE, '..', '..', 'build', 'icon.ico'),
  ];
  return candidates.find((c) => existsSync(c));
}

/** Az adatfájlok helye fejlesztéskor és telepített állapotban is. */
function dataDir(): string {
  const candidates = [
    join(process.resourcesPath ?? '', 'data'),
    join(HERE, '..', 'data'),
    join(HERE, '..', '..', 'data'),
  ];
  return candidates.find((c) => existsSync(c)) ?? join(HERE, '..', 'data');
}

/**
 * A programmal szállított modellek mappája.
 *
 * Fejlesztéskor a projekt `.modellek` könyvtára, telepítve a program melletti
 * `modellek`. A magyar modell azért lakik itt és nem a letöltöttek közt, mert a
 * tárolója csak PyTorch-súlyt közöl; a futtatható hálót építéskor mi állítjuk
 * elő, a felhasználó gépén pedig nincs se Python, se PyTorch.
 */
function bundledModelDir(): string | undefined {
  const candidates = [
    join(process.resourcesPath ?? HERE, 'modellek'),
    join(HERE, '..', 'modellek'),
    join(HERE, '..', '..', '.modellek'),
    join(HERE, '..', '.modellek'),
  ];
  return candidates.find((c) => existsSync(c));
}

/**
 * A FELÜLET EMLÉKEZETE — külön fájl, szándékosan nem a beállítások közt.
 *
 * A `SettingsStore` (src/app/settings.ts) kimondottan csak olyat tárol, amit a
 * felhasználó ELDÖNTHET, és az ismeretlen kulcsokat eldobja. A „megkérdeztük-e
 * már" nem döntés, hanem a felület emlékezete: nincs mit beállítani rajta, a
 * Beállításokban nem is volna hol megjeleníteni, és egy elrontott értéke nem
 * ronthatja el a cserét. Ezért lakik külön fájlban.
 *
 * Miért kell egyáltalán: az irat feldolgozásának módját (kérdezés nélkül vagy
 * együtt) az ELSŐ megnyitáskor kérdezzük meg. E nélkül a mező nélkül vagy
 * minden megnyitásnál újra kérdeznénk, vagy soha — az előbbi bosszantó, az
 * utóbbi azt jelenti, hogy a program az első iratnál szó nélkül dönt a
 * felhasználó helyett.
 */
interface FeluletAllapot {
  /** Megkérdeztük-e már, hogy kérdezés nélkül vagy együtt menjünk végig. */
  modeAsked: boolean;
  /*
    A BEÁLLÍTÓ OLDAL ÉRTÉKEI SZÁNDÉKOSAN NINCSENEK ITT.

    A névkészlet, a csere-mód, a küszöb, a kulcsfájl, az összegek és a dátumok
    a beállító OLDALON állnak — de attól még a felhasználó döntései, tehát a
    `beallitasok.json`-ba valók. A `ui:getState` onnan olvassa ki őket, a
    `ui:setState` oda írja vissza. Egy második példány itt garantáltan
    elcsúszna az elsőtől, és a felhasználó azt hinné, azzal a névkészlettel
    dolgozik, amit a képernyőn lát.
  */
}

const FELULET_ALAP: FeluletAllapot = { modeAsked: false };

/**
 * A FRISSÍTÉSI CSATORNA — külön fájl, szándékosan nem a beállítások közt.
 *
 * Ez az EGYETLEN érték a programban, ami megmondja, hova csatlakozzon. A
 * `beallitasok.json`-t a csere motorja olvassa (küszöb, mód, névkészlet); ha a
 * hálózati cím is ott lakna, egy elrontott vagy kívülről átírt beállításfájl
 * egyszerre érintené a kitakarást és azt, honnan tölt le a program futtatható
 * kódot. A kettőt elválasztjuk.
 *
 * A második ok gyakorlati: így a cím a felhasználói mappában egyetlen, kézzel
 * is olvasható soros fájl — átadható a felhasználónak, mielőtt először
 * elindítja a programot.
 */
interface FrissitesBeallitas {
  /** A frissítési csatorna címe; üres, ha a frissítés nincs bekapcsolva. */
  feedUrl: string;
}

const FRISSITES_ALAP: FrissitesBeallitas = { feedUrl: '' };

let themes: Theme[] = [];
/**
 * A SAJÁT készletek azonosítói.
 *
 * A `themes` tömbben a szállított és a saját csomagok együtt állnak — a
 * kiosztónak mindegy, honnan jött. A felületnek NEM mindegy: csak a sajátot
 * szabad törölni tudnia, és a felhasználónak látnia kell, mikor dolgozik
 * géppel javasolt nevekkel. A halmaz betöltéskor és mentéskor íródik.
 */
let sajatTemak = new Set<string>();
let homonyms = new Set<string>();
/**
 * A BETÖLTÖTT IRATOK — egy ügy, több irat.
 *
 * Korábban egyetlen `session` állt itt. Az ügyek viszont ritkán állnak egy
 * iratból: egy perhez tartozik a keresetlevél, az ellenkérelem és az ítélet,
 * és MINDHÁROMBAN ugyanannak a névnek ugyanazt a fedőnevet kell kapnia,
 * különben a kimenetek nem olvashatók együtt.
 *
 * Ezt eddig egy „ügy-titok" (`caseSecret`) tartotta össze a felületen: a
 * felhasználónak kellett tudnia, hogy a következő irat megnyitása MEGTARTJA a
 * kiosztást, az „Új ügy" pedig eldobja. Ez a különbség nem volt kitalálható —
 * a felhasználó jelezte is. Innentől nincs mit kitalálni: ami egyszerre van
 * betöltve, az egy ügy, és egyetlen elemzés fut rájuk.
 *
 * A SORREND A BETÖLTÉSÉ, és ez nem közömbös: a találatok azonosítója ebből a
 * sorrendből származik (`ID_LEPES`), és az álnév-kiosztás is a megjelenési
 * sorrendet nézi.
 */
let sessions: DocumentSession[] = [];

/**
 * Az első irat — a régi, egy iratra írt utak innen dolgoznak tovább.
 *
 * Nem „aktív irat": melyik látszik éppen, az a FELÜLET dolga, és ő az egész
 * listát megkapja. A főfolyamatnak nincs szüksége rá, hogy tudja.
 */
function elsoSession(): DocumentSession | null {
  return sessions[0] ?? null;
}

/**
 * A TALÁLAT-AZONOSÍTÓK IRATONKÉNTI ELTOLÁSA.
 *
 * Minden munkamenet nulláról számozza a saját találatait. Egyetlen listába
 * fűzve az azonosítók ütköznének, és a `decisions` tároló — ami azonosító
 * szerint kulcsolt — a MÁSIK irat egy találatára írná a felhasználó döntését.
 * Néma hiba volna, és pont a legdrágább fajta: egy kimondott „ne cseréld"
 * másik szóra csúszna át.
 *
 * Az eltolás iratonként egymillió. Ennél több találat egyetlen iratban nem
 * fordul elő (a leghosszabb mért iratunk néhány ezret adott), és az
 * osztás/maradék visszabontás így egyértelmű marad.
 */
const ID_LEPES = 1_000_000;
let models: ModelStore;
let settings: SettingsStore;
let feluletFajl = '';
let felulet: FeluletAllapot = { ...FELULET_ALAP };
let frissitesFajl = '';
let frissites: FrissitesBeallitas = { ...FRISSITES_ALAP };
let downloadAbort: AbortController | null = null;
let modelClient: ModelClient | null = null;

/**
 * Fut-e ÉPPEN felismerés — vagyis van-e mit leállítani.
 *
 * A `doc:cancelDetect` enélkül nem tudná megkülönböztetni a két esetet: „most
 * állítottam le” és „közben magától befejeződött”. A kettő ugyanúgy néz ki
 * kívülről, de a felületnek mást kell mutatnia — az egyik után megszakított
 * eredmény jön, a másik után teljes.
 */
let felismeresFut = false;

/**
 * Kérte-e a felhasználó a futó felismerés leállítását.
 *
 * MIÉRT KELL A KLIENS `cancel()`-JE MELLÉ: a felismerés nem csak a modellben
 * tölt időt. A modell letöltési állapotának lekérdezése (`models.list`) és a
 * szöveg kinyerése előtt még nem is létezik modell-folyamat, amit ki lehetne
 * lőni — ha a felhasználó ebben a résben nyomja meg a Leállítást, a `cancel()`
 * nem talál semmit, és a vizsgálat menne tovább. Ez a jelző a két hosszú lépés
 * között is megállítja.
 */
let felismerestMegszakitottak = false;

/**
 * Ahova a futó felismerés ablakonkénti haladása megy.
 *
 * A modell futtatója a kliensnek jelez (`ModelClientOptions.onProgress`), a
 * kliens viszont a felismeréstől függetlenül, egyszer jön létre — nem tudja,
 * melyik ablak felületére kell küldeni. Ez a mező köti össze a kettőt: a
 * felismerés kezelője beállítja magára, és a végén el is engedi, hogy egy
 * bezárt ablak felületére ne próbáljunk üzenni.
 */
let haladasCel: ((h: AblakHaladas) => void) | null = null;

/** A saját névkészletek mappája a felhasználói profilban. */
let sajatTemaMappa = '';

/**
 * A LEGUTÓBB LEGYÁRTOTT névkészlet — jóváhagyásra várva.
 *
 * A felület nem küldhet vissza kész témát, csak rábólinthat erre. Egy
 * felületről érkező témaobjektum megkerülné az ellenőrzést (`keszitsTemat`),
 * és onnantól ragozhatatlan vagy valódi magyar névvel ütköző álnevek
 * kerülnének az iratba — épp az, amit az ellenőrzés kiszűr.
 */
let utolsoGyartott: TemaEredmeny | null = null;

/**
 * A kézzel ellenőrzött ragozási kivételek (`data/name-overrides.json`).
 *
 * A gyártásnál adjuk át: ha a modell véletlenül olyan nevet javasol, ami már
 * szerepel benne (Bach, Madách), az emberi kézzel ellenőrzött alakot vesszük
 * át — az biztosan jobb, mint amit a szabályokból kikövetkeztetnénk.
 */
let nevKivetelek: TemaBemenet['nevKivetelek'] = {};

/**
 * A nyelvi modell futásának állapota AZ ÉPPEN NYITOTT IRATON.
 *
 * MIÉRT KELL MEGJEGYEZNI: a modell a FELISMERÉSKOR fut (`doc:detectParties`),
 * a jegyzőkönyv viszont a MENTÉSKOR készül. A kettő között a felület sok hívást
 * intéz, és ami a futásról tudható — lefutott-e, elszállt-e, hány címkéjét nem
 * értettük —, az addigra nyomtalanul elveszne. Amíg ez a mező nem volt meg, a
 * `doc:analyze` üres `model` mezőt adott a motornak, az pedig a legóvatosabb
 * olvasatra esik vissza: a jegyzőkönyv MINDEN iratra azt írta, hogy a modell
 * ki van kapcsolva — akkor is, ha lefutott és megtalálta a neveket.
 *
 * `null`: ezen az iraton még nem futott felismerés. Ilyenkor a beállításokból
 * következtetünk (`modellAllapotBeallitasbol`), mert az irat kimehet felismerés
 * nélkül is: a felhasználó kézzel is felviheti a feleket.
 */
let utolsoModellAllapot: ModelRunStatus | null = null;

/**
 * Ablakonként: van-e elveszíthető munka.
 *
 * A felület jelzi az `app:setDirty` hívással, mi pedig ezen döntjük el, hogy a
 * bezárás megálljon-e kérdezni. Ablakonként tartjuk, mert az `activate` új
 * ablakot nyithat, és a másik ablak állapota nem tartozik rá.
 */
const piszkos = new Map<number, boolean>();

/** Ablakok, amelyeknél a felhasználó már rábólintott a mentés nélküli kilépésre. */
const zarhato = new Set<number>();

/**
 * A FOLYAMATBAN LÉVŐ BEZÁRÁSI KÉRDÉS, ablakonként.
 *
 * Az érték a tartalék-időzítő — vagy `null`, ha a felület már VISSZASZÓLT,
 * hogy megkapta és kirajzolta a kérdést.
 *
 * MIÉRT KELL A KÉT ÁLLAPOT. A kérdést a felület rajzolja ki a saját
 * ablakában, tehát a bezárás sorsa egy IPC-váltáson múlik. Ha a felület nem
 * felel — összeomlott, kifagyott, épp újratöltődik —, az ablak
 * bezárhatatlanná válna; ezért van tartalék.
 *
 * A tartalék viszont eddig ROSSZ KÉRDÉST MÉRT. Azt nézte, döntött-e a
 * FELHASZNÁLÓ négy másodpercen belül — márpedig ő olvas, mérlegel, és joga
 * van tovább gondolkodni. Négy másodperc után a rendszerpárbeszéd ráült a
 * saját kérdésünk tetejére, és ugyanazt kérdezte meg másodszor: két ablak,
 * két gombsor, ugyanarról. A felhasználó pontosan ezt látta.
 *
 * Amit mérni KELL: megkapta-e a felület a kérdést, és ki tudta-e rajzolni.
 * Erre a felület nyugtája felel (`app:closeAsked`); az érkezése után az
 * időzítőnek nincs több dolga, és az érték `null`-ra vált. Innentől a
 * felhasználó annyi ideig gondolkodik, amennyi neki kell.
 *
 * A kifagyás sem marad kezeletlen: arra a `webContents` `unresponsive`
 * jelzése való — lásd a `close` esemény mellett.
 */
const zarasKerdes = new Map<number, NodeJS.Timeout | null>();

/**
 * Ennyit várunk a felület NYUGTÁJÁRA — nem a felhasználó válaszára.
 *
 * Egy élő felület ezt ezredmásodpercek alatt megküldi: a `close` eseményből
 * egy IPC-üzenet megy oda, és a React következő képkockájában már jön is
 * vissza. Ha ennyi idő alatt sincs nyugta, akkor a lap nem lassú, hanem NEM
 * ÉL — és pont ilyenkor kell a rendszerpárbeszéd, hogy a programból ki
 * lehessen lépni.
 */
const VALASZ_HATARIDO = 1200;

/** A mentés nélküli kilépés végrehajtása — a kérdés mindkét útjáról ide fut be. */
function zarasEngedve(win: BrowserWindow, id: number): void {
  zarhato.add(id);
  piszkos.set(id, false);
  if (!win.isDestroyed()) win.close();
}

/**
 * A RENDSZERPÁRBESZÉD — csak akkor, ha a felület NEM ÉL.
 *
 * Ez a tartalék, nem az alapút: a kérdést a program saját ablaka teszi fel.
 * Ide két úton jutunk el, és mindkettő ugyanazt jelenti — a lap nem tud
 * válaszolni: vagy meg sem érkezett hozzá a kérdés (`VALASZ_HATARIDO` letelt
 * nyugta nélkül), vagy a kirajzolás után fagyott ki (`unresponsive`).
 *
 * Amíg a felület él, ez a párbeszéd NEM jelenhet meg. Két kérdés ugyanarról,
 * egymás tetején, nem biztonsági háló, hanem hiba.
 */
function rendszerKerdes(win: BrowserWindow, id: number): void {
  zarasKerdes.delete(id);
  if (win.isDestroyed()) return;
  const valasz = dialog.showMessageBoxSync(win, {
    type: 'warning',
    noLink: true,
    title: 'Szivecske Anonimizáló',
    message: 'Van el nem mentett munka.',
    detail:
      'A megnyitott irat, a felvitt felek és az egyenkénti döntések elvesznek, ha most ' +
      'bezárod a programot.',
    buttons: ['Mentés másként', 'Kilépés mentés nélkül', 'Mégse'],
    defaultId: 0,
    cancelId: 2,
  });
  if (valasz === 0) sendMenu('save', win);
  else if (valasz === 1) zarasEngedve(win, id);
}

/**
 * A modell futtatója. KÜLÖN FOLYAMATBAN indul, és a munka végén elengedjük —
 * így a modell ~650 MB-ja nem marad a program nyakán két irat között.
 */
function getModelClient(): ModelClient | null {
  const s = settings.get();
  const spec = MODEL_REGISTRY.find((x) => x.id === s.modelId);
  if (!spec) return null;
  if (modelClient) return modelClient;
  modelClient = new ModelClient({
    workerPath: join(HERE, 'ai-worker.cjs'),
    config: {
      modelId: spec.id,
      repo: spec.repo,
      // Nem a letöltési mappát adjuk át vakon: a magyar modell a programmal
      // érkezik, és a program melletti mappában lakik. A tár megmondja, hol
      // találta meg.
      cacheDir: models.rootFor(spec),
      labelMap: spec.labelMap,
      engine: spec.engine,
      dtype: 'q8',
    },
    // A haladás nem közvetlenül a felületre megy: a kliens hosszabb életű, mint
    // egy felismerés, ezért a célt a futó kezelő állítja be — lásd `haladasCel`.
    onProgress: (h) => haladasCel?.(h),
  });
  return modelClient;
}

/**
 * A modell állapota FELISMERÉS NÉLKÜL — a beállításokból és a lemezről.
 *
 * Akkor kell, ha ezen az iraton nem futott felismerés: az automatikus
 * felismerés ki van kapcsolva, vagy a felhasználó kézzel vitte fel a feleket.
 * A négy állapotból ilyenkor kettő jöhet szóba, és a kettő MÁS teendőt jelent
 * a felhasználónak: a modell nincs a gépen ('missing' → le kell tölteni), vagy
 * megvan, csak ezt az iratot nem olvasta el ('off').
 *
 * Az 'ok' szándékosan nem szerepel: azt KIZÁRÓLAG egy tényleges futás
 * igazolhatja. Ha innen is adhatnánk, a jegyzőkönyv a beállítás alapján
 * állítaná, hogy a modell dolgozott — pontosan a fordítottja annak a hibának,
 * amit ez a mező orvosol.
 */
async function modellAllapotBeallitasbol(): Promise<ModelRunStatus> {
  const s = settings.get();
  if (!s.useModel || !s.autoDetect) return { state: 'off' };
  const telepitve = (await models.list()).find((x) => x.id === s.modelId)?.state === 'installed';
  return telepitve ? { state: 'off' } : { state: 'missing' };
}

/**
 * A `doc:detectParties` válasza.
 *
 * A felismerés teljes eredménye (felek, megtartandók, AZONOSÍTÓK, modellállapot)
 * plusz a felületnek szóló két összefoglaló mező. A `ui/src/api.ts`
 * `DetectionResult` típusa ugyanezt az alakot írja le — ha itt bővítesz, ott is
 * bővítsd, különben a mező átjön a hídon, és a felület nem tud róla.
 */
interface FelismeresValasz extends DetectionResult {
  /** Ténylegesen olvasott-e a modell — ezen dönt a felület jelzése. */
  modelUsed: boolean;
  /** Egy magyar mondat a modellről, a felismerő ablakba. */
  modelNote: string;
  /**
   * Leállította-e a felhasználó a vizsgálatot.
   *
   * A megszakítás NEM HIBA, ezért nem kivétellel jelezzük: a válasz rendben
   * megérkezik, csak kevesebbet tud. A szerkezeti felismerés ilyenkor is
   * lefut — az azonnali, és a rovatokból („Felperes:”) így is előkerülnek a
   * felek —, tehát a felhasználó nem üres lappal marad. Ha ezt kivételként
   * dobnánk, a felület a piros hibasávot mutatná, és eldobná azt a keveset is,
   * amit addig összeszedtünk.
   */
  megszakitva: boolean;
}

/**
 * A felismerés szakaszainak magyar mondatai.
 *
 * Egy helyen, mert a felület KÉT csatornán kapja meg ugyanezt (`doc:detectStatus`
 * és `doc:detectProgress`), és a kettőnek szó szerint egyezni kell — különben az
 * elfoglaltság-sor mást mondana, mint a folyamatjelző felirata.
 */
const SZAKASZ_MONDAT: Record<FelismeresSzakasz, string> = {
  szoveg: 'Az irat szövegének beolvasása…',
  modell: 'A nyelvi modell betöltése…',
  vizsgalat: 'A nyelvi modell olvassa az iratot…',
  osszesites: 'A találatok összesítése…',
  kesz: 'A vizsgálat kész.',
  megszakitva: 'A vizsgálatot megszakítottad.',
};

/**
 * A haladás kiküldése a felületnek.
 *
 * KÉT CSATORNÁN, ugyanabban a pillanatban: a régebbi `doc:detectStatus` egyetlen
 * mondatot visz (a munkalap elfoglaltság-sora ennyit tud kiírni), az újabb
 * `doc:detectProgress` a szakaszt és — ha van — az arányt. Nem két igazság: a
 * mondat itt készül el egyszer, és mindkét csatorna ugyanazt kapja.
 *
 * Az arányt CSAK akkor töltjük ki, ha tényleg tudjuk. A „rész” szó szándékosan
 * nem „ablak”: a felhasználó jogász, a modell csúszóablakairól semmit nem kell
 * tudnia ahhoz, hogy lássa, tizennégyből hétnél tart.
 */
function jelezdAHaladast(
  e: IpcMainInvokeEvent,
  szakasz: FelismeresSzakasz,
  h?: AblakHaladas,
): void {
  const meronyi = h !== undefined && h.ablakok > 0;
  const uzenet = meronyi
    ? `${SZAKASZ_MONDAT[szakasz]} (${h.ablak}/${h.ablakok} rész)`
    : SZAKASZ_MONDAT[szakasz];
  const p: DetectProgress = {
    szakasz,
    uzenet,
    ablak: h?.ablak ?? 0,
    ablakok: h?.ablakok ?? 0,
    arany: meronyi ? Math.max(0, Math.min(1, h.ablak / h.ablakok)) : null,
  };
  e.sender.send('doc:detectProgress', p);
  e.sender.send('doc:detectStatus', uzenet);
}

/**
 * Megszakították-e a vizsgálatot két hosszú lépés között.
 *
 * A modell folyamatának kilövése (`ModelClient.cancel`) csak akkor hat, ha van
 * mit kilőni. Ez a kapu a köztes pillanatokra való — ott dobunk, ahol a
 * felhasználó kérése egyébként észrevétlen maradna.
 */
function megszakitottakE(): void {
  if (felismerestMegszakitottak) throw megszakitasHiba();
}

let lastAnalysis: AnalysisResult | null = null;
let lastInput: AnalyzeInput | null = null;

function loadData(): void {
  const dir = dataDir();
  const themeDir = join(dir, 'themes');
  themes = existsSync(themeDir)
    ? readdirSync(themeDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(themeDir, f), 'utf8')) as Theme)
    : [];

  const homPath = join(dir, 'homonyms.json');
  if (existsSync(homPath)) {
    const h = JSON.parse(readFileSync(homPath, 'utf8')) as {
      surnames: { form: string }[];
      given_names: { form: string }[];
    };
    homonyms = new Set([...h.surnames, ...h.given_names].map((x) => x.form.toLowerCase()));
  }

  const ovPath = join(dir, 'name-overrides.json');
  if (existsSync(ovPath)) {
    try {
      const raw = JSON.parse(readFileSync(ovPath, 'utf8')) as {
        names?: TemaBemenet['nevKivetelek'];
      };
      nevKivetelek = raw.names ?? {};
    } catch {
      // A kivételek hiánya nem állítja meg a gyártást: a ragozó motor a
      // szabályaival dolgozik tovább, csak néhány idegen névnél tippel.
      nevKivetelek = {};
    }
  }

  sajatTemakatBetolt();
}

/**
 * A felhasználó saját névkészletei.
 *
 * KÜLÖN MAPPÁBAN, a felhasználói profilban: a szállított csomagok a program
 * mellett laknak, és azokat egy újratelepítés felülírja. Ami a felhasználóé,
 * azt nem szabad egy frissítéssel elveszíteni.
 *
 * Egy sérült vagy hiányos fájl NEM állítja meg a betöltést: átugorjuk, és a
 * többi készlet ugyanúgy használható marad. A hiba a névkészlet-választóban
 * úgy jelenik meg, hogy a készlet nincs a listában — ez látható, míg egy
 * indulásnál eldobott kivétel csak egy meg nem nyíló programot jelentene.
 */
function sajatTemakatBetolt(): void {
  sajatTemak = new Set();
  if (!sajatTemaMappa || !existsSync(sajatTemaMappa)) return;
  for (const f of readdirSync(sajatTemaMappa).filter((x) => x.endsWith('.json'))) {
    try {
      const t = JSON.parse(readFileSync(join(sajatTemaMappa, f), 'utf8')) as Theme;
      if (!t?.id || !Array.isArray(t.given_names) || !Array.isArray(t.surnames)) continue;
      // Egy saját készlet SOHA nem írhat felül szállítottat. A `temaAzonosito`
      // ezért ad 》sajat_《 előtagot, de a fájl kézzel is átírható — ezért itt
      // is megnézzük, nem csak a gyártáskor.
      if (themes.some((x) => x.id === t.id)) continue;
      themes.push(t);
      sajatTemak.add(t.id);
    } catch {
      // Lásd fent: az olvashatatlan fájlt átugorjuk.
    }
  }
}

/**
 * Egy névkészlet összefoglalója a felületnek.
 *
 * A `sajat` mező a `ThemeSummary`-n felül áll: a motornak mindegy, honnan jött
 * a készlet, a felhasználónak nem. A szállított négyet ember állította össze,
 * a sajátot egy nyelvi modell javasolta — és csak a sajátot szabad törölni.
 */
interface TemaOsszefoglalo extends ThemeSummary {
  sajat: boolean;
}

function themeSummaries(): TemaOsszefoglalo[] {
  return themes.map((t) => ({
    id: t.id,
    name: t.name_hu,
    description: t.description_hu,
    licenseNote: t.license_note,
    givenCount: t.given_names.length,
    surnameCount: t.surnames.length,
    sample: t.surnames.slice(0, 3).map((s, i) => `${s.form} ${t.given_names[i]?.form ?? ''}`.trim()),
    sajat: sajatTemak.has(t.id),
  }));
}

// ─────────────────────────── magyar hibaszöveg ───────────────────────────

/**
 * Megszakítás-e a hiba.
 *
 * A letöltés lemondása szándékos felhasználói művelet: annak nincs helye a
 * hibasávban.
 */
function megszakitas(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return e?.name === 'AbortError' || /The operation was aborted|AbortError|aborted/i.test(e?.message ?? '');
}

interface HibaMinta {
  minta: RegExp;
  /** A felhasználónak szóló mondat; a `$1`… a mintából jön. */
  mondat: string;
}

/**
 * Nyers hibaüzenet → a felhasználónak szóló magyar mondat.
 *
 * A könyvtárak angolul hibáznak (pdf-lib, fetch, Node hibakódok), a saját belső
 * ellenőrzéseink pedig fejlesztőnek szólnak: `<w:del>` blokkokat és
 * `resolveRevisions()` hívást emlegetnek. Egyik sem való a felület
 * hibasávjába — abból a felhasználó nem tudja meg, mit tegyen. A sorrend
 * számít: a fentebbi minta nyer.
 */
const HIBA_MINTAK: HibaMinta[] = [
  {
    minta: /is encrypted|ignoreEncryption|password.?protected/i,
    mondat:
      'Ez a PDF jelszóval védett, ezért nem tudjuk megnyitni. Nyisd meg a jelszavával, mentsd ' +
      'el védelem nélkül, és próbáld újra.',
  },
  {
    minta: /<w:del>|feloldatlan változáskövetés|resolveRevisions/i,
    mondat:
      'A dokumentumban feloldatlan változáskövetés (korrektúra) van. A törölt szöveg ilyenkor ' +
      'szó szerint benne marad a fájlban, akkor is, ha a Wordben nem látszik — ezért előbb el ' +
      'kell fogadni vagy el kell vetni a változásokat.',
  },
  {
    minta: /Az eredeti adat megmaradt a kimenetben/,
    mondat:
      'Az ellenőrzés az eredeti adatot megtalálta a kész fájlban, ezért a mentés leállt. Így ' +
      'nem kerülhet ki hiányosan álnevesített irat. Jelezd a hibát, és addig ne add ki a fájlt.',
  },
  {
    minta: /szerkezeti ellenőrzése elbukott|Átfedő csere/,
    mondat:
      'A kész fájl ellenőrzése nem sikerült, ezért nem mentettük ki — így nem keletkezik sérült ' +
      'dokumentum. Próbáld meg kevesebb kézi felülírással, vagy jelezd a hibát.',
  },
  {
    minta: /Nem ZIP-csomag|ZIP64|Sérült központi könyvtár|Sérült helyi fejléc|Content_Types|word\/document\.xml/,
    mondat:
      'Ezt a fájlt nem tudjuk Word-dokumentumként megnyitni: vagy sérült, vagy nem .docx. Ha ' +
      'régi .doc vagy .odt fájlról van szó, előbb mentsd el .docx formátumban.',
  },
  {
    minta: /unable to authenticate|Unsupported state|bad decrypt|wrong final block/i,
    mondat:
      'Hibás jelszó, vagy a kulcsfájl megsérült. Írd be újra a jelszót pontosan úgy, ahogy a ' +
      'mentéskor megadtad — a kis- és nagybetű is számít.',
  },
  {
    minta: /HTTP (\d{3})/,
    mondat: 'A letöltő kiszolgáló nem adta ki a fájlt (HTTP $1). Próbáld meg később.',
  },
  {
    minta: /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR|certificate/i,
    mondat:
      'Nem sikerült elérni a letöltő kiszolgálót. Ellenőrizd az internetkapcsolatot, és próbáld ' +
      'újra. (A program csak a modell letöltésekor használ hálózatot.)',
  },
  {
    minta: /ENOSPC/,
    mondat: 'Betelt a lemez, ezért nem tudtuk kiírni a fájlt. Szabadíts fel helyet, és próbáld újra.',
  },
  {
    minta: /EBUSY|EPERM|EACCES/,
    mondat:
      'A fájlhoz nem fértünk hozzá. Lehet, hogy egy másik program (például a Word) éppen nyitva ' +
      'tartja, vagy nincs hozzá jogosultságod. Zárd be, és próbáld újra.',
  },
  {
    minta: /ENOENT/,
    mondat: 'A fájl nem található ezen az útvonalon. Lehet, hogy időközben áthelyezték vagy törölték.',
  },
  {
    minta: /A modell nem válaszolt időben/,
    mondat:
      'A nyelvi modell nem válaszolt időben, ezért leállítottuk. A felismerés a szerkezeti ' +
      'mintákkal fut tovább; hosszú iratnál érdemes újrapróbálni.',
  },
  {
    minta: /modell-folyamat|A modell nincs betöltve/,
    mondat:
      'A nyelvi modell nem indult el, ezért csak a szerkezeti felismerés futott. A modell ' +
      'állapotát a Beállítások → Nyelvi modellek lapon nézheted meg.',
  },
  {
    minta: /is not valid JSON|Unexpected token|JSON at position/i,
    mondat: 'A fájl tartalma sérült, vagy nem az a formátum, amit vártunk.',
  },
];

/** Fejlesztőnek szóló nyomok: ilyen szöveg nem mehet ki a felületre. */
const FEJLESZTOI_JEL = /[<>{}]|\(\)|::|\.ts:|[A-Za-z]+Error:|node_modules/;

/**
 * Magyar-e a mondat — vagyis a saját, felhasználónak szánt üzenetünk-e.
 *
 * Az ékezet önmagában nem elég: a „Nincs megnyitott irat." egyetlen ékezetes
 * betűt sem tartalmaz, mégis kész magyar mondat. Ezért néhány jellegzetes
 * magyar szót is keresünk. A szóhatár szándékosan nem `\b`: az ASCII-alapú
 * szóhatár az ékezetes betűkön csendben elromlik.
 */
const MAGYAR_JEL =
  /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]|(?:^|[^A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű])(?:nem|nincs|van|hogy|kell|ez|ezt|meg|csak|minden)(?![A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű])/i;

/**
 * A hibából a felhasználónak szóló magyar mondat.
 *
 * Ha a saját, már magyarul megfogalmazott üzenetünkről van szó, változatlanul
 * átengedjük. Amit nem ismerünk fel, azt semleges mondattal adjuk ki, de a
 * nyers szöveget hozzáfűzzük: hibabejelentéskor ez az egyetlen fogódzó.
 */
function magyarHiba(err: unknown): string {
  const nyers = err instanceof Error ? err.message : String(err);
  if (megszakitas(err)) return 'A művelet megszakítva.';

  for (const { minta, mondat } of HIBA_MINTAK) {
    const talalat = minta.exec(nyers);
    if (talalat) return mondat.replace(/\$(\d)/g, (_, i: string) => talalat[Number(i)] ?? '');
  }

  if (MAGYAR_JEL.test(nyers) && !FEJLESZTOI_JEL.test(nyers)) return nyers;
  return `A művelet nem sikerült. Ha újra előfordul, ez a részlet segít a hibakeresésben: ${nyers}`;
}

/**
 * Minden IPC-hívás ezen keresztül regisztrálódik.
 *
 * Az Electron a főfolyamatban dobott hibát nyers `Error.message`-ként adja át a
 * felületnek. Itt fordítjuk le, mielőtt a felhasználó elé kerülne.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<R> => {
    try {
      return await fn(event, ...(args as A));
    } catch (err) {
      throw new Error(magyarHiba(err));
    }
  });
}

// ─────────────────────────── menü és ablak ───────────────────────────

/** A menüakció a fókuszált ablak felületére megy — az dönti el, mit jelent. */
function sendMenu(action: MenuAction, win?: BrowserWindow | null): void {
  const cel = win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  cel?.webContents.send('app:menu', action);
}

/**
 * A magyar menüsor.
 *
 * Menü nélkül az angol Electron-alapmenü gyorsbillentyűi élnének, és a Ctrl+R
 * újratöltené a felületet: a megnyitott irat, a felvitt felek és minden
 * egyenkénti döntés nyomtalanul elveszne. A menüpontok maguk nem dolgoznak,
 * csak jelzik a felületnek, hogy a felhasználó mit kért.
 */
function menuTemplate(): MenuItemConstructorOptions[] {
  const fejlesztoi: MenuItemConstructorOptions[] = DEV_URL
    ? [{ type: 'separator' }, { label: 'Fejlesztői eszközök', role: 'toggleDevTools' }]
    : [];

  return [
    {
      label: 'Fájl',
      submenu: [
        { label: 'Irat megnyitása…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { label: 'Mentés másként…', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Nyomtatás…', accelerator: 'CmdOrCtrl+P', click: () => sendMenu('print') },
        { label: 'Kulcsfájl megnyitása…', click: () => sendMenu('keyfile') },
        { label: 'Új ügy', click: () => sendMenu('newCase') },
        { label: 'Beállítások…', click: () => sendMenu('settings') },
        { type: 'separator' },
        { label: 'Kilépés', role: 'quit' },
      ],
    },
    {
      label: 'Szerkesztés',
      submenu: [
        { label: 'Visszavonás', role: 'undo' },
        { label: 'Újra', role: 'redo' },
        { type: 'separator' },
        { label: 'Kivágás', role: 'cut' },
        { label: 'Másolás', role: 'copy' },
        { label: 'Beillesztés', role: 'paste' },
        { label: 'Törlés', role: 'delete' },
        { type: 'separator' },
        { label: 'Az összes kijelölése', role: 'selectAll' },
      ],
    },
    {
      label: 'Nézet',
      submenu: [
        // Az „Újratöltés" és a „Kényszerített újratöltés" SZÁNDÉKOSAN hiányzik:
        // velük együtt tűnik el a Ctrl+R, ami eldobná a megnyitott iratot.
        { label: 'Nagyítás', role: 'zoomIn' },
        { label: 'Kicsinyítés', role: 'zoomOut' },
        { label: 'Eredeti méret', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Teljes képernyő', role: 'togglefullscreen' },
        ...fejlesztoi,
      ],
    },
    {
      label: 'Súgó',
      submenu: [
        /*
          A MENÜPONT MINDIG OTT VAN, akkor is, ha a frissítés nincs beállítva.

          Az elrejtett menüpont ugyanazt üzeni, mint egy néma gomb: hogy a
          program nem tud frissülni. A felhasználó kérése épp az volt, hogy
          tudjon — a beállítatlanság pedig egy elvégezhető lépés, nem a
          funkció hiánya. Ezért a pont látszik, és a mögötte nyíló ablak
          megmondja magyarul, hogy mi hiányzik, és ott is állítható be.
        */
        { label: 'Frissítés keresése…', click: () => sendMenu('update') },
        { type: 'separator' },
        { label: 'A programról', click: () => sendMenu('about') },
      ],
    },
  ];
}

/** Ugyanaz a lap-e — fejlesztéskor a HMR teljes újratöltése is ide esik. */
function sajatOldal(url: string, sajat: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(sajat);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/* ──────────────── a natív ablakgombok sávja ──────────────── */

/**
 * A felület két témája. A főfolyamat NEM tippelhet: nem látja a lapot, és egy
 * rossz tipp itt épp az ellenkező színt égetné a jobb felső sarokba. Ezért az
 * érték a felülettől jön, minden hívásban.
 */
type FeluletTema = 'vilagos' | 'sotet';

/** A gombsáv magassága; a felületi fejléc (`.titlebar`) magasságával EGYEZIK. */
const KERET_MAGASSAG = 46;

/**
 * A KICSINYÍTÉS / TELJES MÉRET / BEZÁRÁS gomb színe témánként.
 *
 * MIÉRT ITT ÉS NEM A CSS-BEN: ezt a három gombot nem a mi HTML-ünk rajzolja,
 * hanem az Electron a `titleBarOverlay` sávjában, a lap FÖLÖTT. CSS-sel se
 * átszínezni, se letakarni nem lehet — az egyetlen fogás rajtuk ez a tábla és
 * a `setTitleBarOverlay` hívás.
 *
 * A `hatter` a felületi fejléc háttere, a `jel` a fejlécben álló szöveg színe.
 * Ha a kettő elcsúszik a stíluslaptól, a sáv jobb széle más árnyalatú csíkként
 * válik le a fejléc többi részéről — vagyis ugyanaz a hiba jön elő, csak
 * halványítás nélkül is.
 */
const KERET_SZINEK: Record<FeluletTema, { hatter: string; jel: string }> = {
  vilagos: { hatter: '#FFFFFF', jel: '#4A3C4D' },
  sotet: { hatter: '#241B27', jel: '#D8CBDC' },
};

/**
 * A párbeszéd mögé húzott FÁTYOL — ugyanaz, amit a felület az `.overlay`-re
 * tesz (ui/src/styles.css).
 *
 * A fátyol a lapra kerül, a gombsáv pedig a lap fölött van: letakarni tehát
 * nem tudja. Ezért nem letakarjuk a sávot, hanem KISZÁMOLJUK, milyen színt ad
 * ki a fátyol a fejlécen, és a gombokat közvetlenül arra a színre festjük.
 */
const KERET_FATYOL: Record<FeluletTema, { szin: string; fedes: number }> = {
  vilagos: { szin: '#2E2130', fedes: 0.32 },
  sotet: { szin: '#120C14', fedes: 0.46 },
};

/*
  A TÜRELMI IDŐ INNEN KIKERÜLT — 140 ezredmásodperc állt itt.

  A szándéka jó volt: két egymás után nyíló párbeszéd között a gombok ne
  villanjanak fel. Csakhogy a felület EGYETLEN `dialog` állapotban tartja,
  melyik párbeszéd áll nyitva (ui/src/App.tsx) — átváltáskor tehát nincs
  közbülső „nincs párbeszéd” képkocka, amit el kellene nyelni. Ahol mégis van
  ilyen szünet (a fejlesztői `?dev=` útvonal késleltetett nyitása), az 400 ms,
  vagyis ez a türelmi idő ott sem fogta volna át.

  Amit viszont OKOZOTT, azt látni lehetett: a párbeszéd bezárásakor a lap
  azonnal visszavilágosodott, a jobb felső sarokban álló három gomb pedig még
  nyolc-tíz képkockán át sötét maradt. A halványodás nem egyszerre ment vissza,
  hanem két lépésben — előbb a lap, aztán a sarok.

  Ezért a visszaállítás mostantól ugyanúgy azonnal megy, mint a halványítás:
  egy állapot, egy pillanat. A fölös átfestéseket továbbra is a `keretAllapot`
  kulcsa szűri, tehát ettől nem lett több hívás.
*/

/**
 * Ablakonként: milyen színnel és milyen állapotban áll ÉPPEN a gombsáv.
 *
 * A `kulcs` a fölös hívásokat szűri: a `setTitleBarOverlay` minden hívása
 * újrarajzoltatja a sávot, akkor is, ha a szín ugyanaz — a felület viszont
 * minden párbeszédnyitásnál és -zárásnál szól.
 *
 * A `halvany` azt dönti el, kell-e türelmi idő. Csak a VISSZAÁLLÍTÁS várhat;
 * ha a sáv eleve világos volt, és csak a téma váltott, a késleltetés látható
 * hiba lenne — sötét témával indulva egy pillanatra fehér csík maradna a jobb
 * felső sarokban.
 */
const keretAllapot = new Map<number, { kulcs: string; halvany: boolean }>();

/** Egy „#rrggbb” alak három összetevője. */
function szinBont(szin: string): [number, number, number] {
  const jegyek = szin.startsWith('#') ? szin.slice(1) : szin;
  return [
    parseInt(jegyek.slice(0, 2), 16),
    parseInt(jegyek.slice(2, 4), 16),
    parseInt(jegyek.slice(4, 6), 16),
  ];
}

/**
 * A fátyol alatti szín: a `felul` a `fedes` arányában takarja az `alul`-t.
 *
 * Azért SZÁMOLJUK, és nem táblázatból vesszük: a fejléc színe és a fátyol
 * külön-külön változhat, két helyen tárolt kész érték pedig előbb-utóbb
 * elcsúszik — és az elcsúszás pont az a világos folt volna a sarokban, amit
 * javítunk.
 */
function fatyolAlatt(alul: string, felul: string, fedes: number): string {
  const [ar, ag, ab] = szinBont(alul);
  const [fr, fg, fb] = szinBont(felul);
  const olvaszt = (a: number, f: number): string =>
    Math.round(a * (1 - fedes) + f * fedes)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${olvaszt(ar, fr)}${olvaszt(ag, fg)}${olvaszt(ab, fb)}`;
}

/** A két szín egyetlen összehasonlítható értékké — ezen múlik a fölös hívás. */
function keretKulcs(hatter: string, jel: string): string {
  return `${hatter} ${jel}`;
}

/** A sáv tényleges átfestése. Csak akkor hív, ha a szín valóban változik. */
function keretetFest(win: BrowserWindow, tema: FeluletTema, halvanyitva: boolean): void {
  if (win.isDestroyed()) return;

  const alap = KERET_SZINEK[tema];
  const fatyol = KERET_FATYOL[tema];
  const color = halvanyitva ? fatyolAlatt(alap.hatter, fatyol.szin, fatyol.fedes) : alap.hatter;
  const symbolColor = halvanyitva ? fatyolAlatt(alap.jel, fatyol.szin, fatyol.fedes) : alap.jel;

  const kulcs = keretKulcs(color, symbolColor);
  if (keretAllapot.get(win.id)?.kulcs === kulcs) return;
  // A jegyzés a hívás ELŐTT történik: ha a hívás nem támogatott, így egyetlen
  // sikertelen kísérlet lesz belőle, nem minden párbeszédnyitásnál egy újabb.
  keretAllapot.set(win.id, { kulcs, halvany: halvanyitva });

  try {
    win.setTitleBarOverlay({ color, symbolColor, height: KERET_MAGASSAG });
  } catch {
    /*
      A sáv csak Windowson létezik; máshol a hívás hiányzik vagy kivételt dob.
      Ez NEM hiba: ott a keretet a rendszer rajzolja, a mi dolgunk pedig innen
      véget is ér. A program semmiképp nem állhat meg attól, hogy kinyílt egy
      párbeszédablak.
    */
  }
}

/**
 * A felület jelezte, hogy párbeszéd nyílt vagy zárult.
 *
 * MINDKÉT IRÁNY AZONNAL MEGY. A halványítást a felhasználó a párbeszéddel
 * együtt látja megjelenni, a visszaállítást a párbeszéddel együtt eltűnni —
 * bármelyiket késleltetve a lap és a sarok két külön pillanatban mozdulna.
 * Hogy miért állt itt korábban türelmi idő, és mi lett belőle, azt a
 * `keretAllapot` fölötti bekezdés mondja el.
 */
function keretetIgazit(win: BrowserWindow, tema: FeluletTema, halvanyitva: boolean): void {
  keretetFest(win, tema, halvanyitva);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#FBF7F8',
    title: 'Szivecske Anonimizáló',
    autoHideMenuBar: true,
    ...(appIcon() ? { icon: appIcon() } : {}),
    // Saját fejléc: a bal oldal a mi sávunk (embléma, iratnév, gombok), a jobb
    // oldalon a natív ablakgombok maradnak — így Windowson otthonos, de a fejléc
    // a programé, nem egy szürke csík fölötte.
    titleBarStyle: 'hidden',
    /*
      Az itteni szín csak az INDULÁSÉ: az ablak előbb áll fel, mint ahogy a
      felület betölt, tehát ilyenkor még nincs kitől megkérdezni, melyik téma
      van érvényben. A felület az első képkockájában szól (`ui:ablakkeret`), és
      onnantól ő igazítja a sávot — halványításkor is.
    */
    titleBarOverlay: {
      color: KERET_SZINEK.vilagos.hatter,
      symbolColor: KERET_SZINEK.vilagos.jel,
      height: KERET_MAGASSAG,
    },
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Az ablak azonosítóját külön eltesszük: a bezárás után a `win.id`
  // lekérdezése már megsemmisített objektumra futna.
  const id = win.id;

  // Az indulási keretszínt jegyezzük: enélkül a felület első jelentkezése
  // fölöslegesen újrafestené a sávot — vagyis pont azzal a villanással
  // indulna a program, amit el akarunk kerülni.
  keretAllapot.set(id, {
    kulcs: keretKulcs(KERET_SZINEK.vilagos.hatter, KERET_SZINEK.vilagos.jel),
    halvany: false,
  });

  const sajatCim = DEV_URL ?? pathToFileURL(join(HERE, '..', 'dist', 'ui', 'index.html')).toString();

  // Minden külső hivatkozást a rendszerböngészőnek adunk át, hogy az
  // alkalmazás ablakában soha ne töltődjön be idegen tartalom. Csak valódi
  // webcímet: egy ablakra ejtett fájl `file://` címe nem indíthat el semmit.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Fájlt ejtve az ablakra — a kijelölt mezőn kívül — a Chromium elnavigálna a
  // `file://` címre: a felület eltűnne, és vele a megnyitott irat, a felek és
  // minden döntés. Menü híján onnan nincs visszaút, ezért az ablak EGYETLEN
  // dolgot tölthet be: a saját felületét.
  win.webContents.on('will-navigate', (e, url) => {
    if (sajatOldal(url, sajatCim)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  /*
    A BEZÁRÁS KÉRDÉSE A PROGRAM SAJÁT ABLAKÁBAN JELENIK MEG.

    Eddig a Windows rendszerpárbeszéde volt (`dialog.showMessageBoxSync`). Nem
    csak azért baj, mert idegen a program többi ablakától: a rendszerpárbeszéd
    gombjai a Windows sorrendjét követik, a szövege nem tördelhető, és nem
    fér el benne az, amit itt el KELL mondani — hogy a mentés új fájlba megy,
    és hogy pontosan mi vész el.

    A CSERE ÁRA egy kockázat, amit kezelni kell: ha a felület nem válaszol
    (összeomlott, kifagyott), az ablak bezárhatatlanná válna. Ezért a
    tartalék — de az a lap ÉLETÉT méri, nem a felhasználó gondolkodási idejét:
    a nyugta megérkezése után a rendszerpárbeszéd már nem szólal meg. Lásd
    `zarasKerdes`.
  */
  win.on('close', (e) => {
    if (zarhato.has(id) || !piszkos.get(id)) return;
    e.preventDefault();
    /*
      MÁR FUT EGY KÉRDÉS: a második bezárási kísérlet ne nyisson másodikat.

      Ilyenkor a felhasználó a saját ablakunkban álló kérdést látja — csak épp
      a bezárógombra kattint mellette. A helyes válasz nem egy MÁSODIK kérdés,
      hanem az, hogy előhozzuk azt, amelyik már ott áll.
    */
    if (zarasKerdes.has(id)) {
      if (!win.isDestroyed()) win.focus();
      return;
    }

    zarasKerdes.set(
      id,
      setTimeout(() => rendszerKerdes(win, id), VALASZ_HATARIDO),
    );
    win.webContents.send('app:confirmClose');
  });

  /*
    A FELÜLET A KÉRDÉS KÖZBEN FAGYOTT KI.

    A nyugta után a tartalék-időzítőt leállítjuk, mert a felhasználónak joga
    van gondolkodni. Ha viszont a lap EZUTÁN áll meg, az ablakban ott marad egy
    kérdés, amire nem lehet válaszolni — és a bezárógomb sem segít, hiszen a
    `close` esemény látja, hogy már fut kérdés.

    Erre való ez a jelzés: az Electron maga szól, ha a lap nem dolgozza fel az
    eseményeit. Ilyenkor — és CSAK ilyenkor — veszi át a rendszerpárbeszéd.
  */
  win.webContents.on('unresponsive', () => {
    if (!zarasKerdes.has(id)) return;
    const varakozo = zarasKerdes.get(id);
    if (varakozo) clearTimeout(varakozo);
    rendszerKerdes(win, id);
  });

  win.on('closed', () => {
    piszkos.delete(id);
    zarhato.delete(id);
    // A tartalék-időzítő megsemmisült ablakra nyitna párbeszédet.
    const kerdes = zarasKerdes.get(id);
    if (kerdes) clearTimeout(kerdes);
    zarasKerdes.delete(id);
    keretAllapot.delete(id);
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(join(HERE, '..', 'dist', 'ui', 'index.html'));
}

// Két példány ugyanabba a beállításfájlba ír, és az utolsó mentés csendben
// felülírja a másikét. Ezért csak egy futhat: a második indítás előhozza az
// elsőt, és kilép.
if (!app.requestSingleInstanceLock()) app.quit();
else bootstrap();

function bootstrap(): void {
  app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  void app.whenReady().then(() => {
    // A saját készletek mappáját a betöltés ELŐTT kell tudni: a `loadData` a
    // szállított csomagok mellé ezeket is beolvassa.
    sajatTemaMappa = join(app.getPath('userData'), 'sajat-nevkeszletek');
    loadData();
    models = new ModelStore(join(app.getPath('userData'), 'modellek'), bundledModelDir());
    settings = new SettingsStore(join(app.getPath('userData'), 'beallitasok.json'));
    feluletFajl = join(app.getPath('userData'), 'felulet.json');
    felulet = feluletetOlvas();
    frissitesFajl = join(app.getPath('userData'), 'frissites.json');
    frissites = frissitestOlvas();
    registerHandlers();
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/**
 * A felület emlékezetének beolvasása.
 *
 * Sérült vagy régi fájlnál az alapállásra esünk vissza, és NEM dobunk hibát: a
 * legrosszabb, ami történhet, hogy a program egyszer újra megkérdezi, melyik
 * úton menjen. Egy megnyithatatlan emlékeztető miatt nem állhat meg a munka.
 */
function feluletetOlvas(): FeluletAllapot {
  if (!existsSync(feluletFajl)) return { ...FELULET_ALAP };
  try {
    const raw = JSON.parse(readFileSync(feluletFajl, 'utf8')) as Partial<FeluletAllapot>;
    return { ...FELULET_ALAP, ...(typeof raw.modeAsked === 'boolean' ? { modeAsked: raw.modeAsked } : {}) };
  } catch {
    return { ...FELULET_ALAP };
  }
}

/**
 * Amit a beállító oldal a megnyitáskor lát.
 *
 * Az `iratBeallitas` MINDIG a beállításfájl mai állásából készül, nem egy
 * megjegyzett másolatból. Ettől lesz igaz a „legutóbb használt értékekkel
 * nyílik meg" ígéret akkor is, ha a felhasználó közben másik ablakban dolgozott
 * vagy két iratot vitt végig egymás után: a mentés ugyanabba a fájlba írt, tehát
 * a következő megnyitás azt olvassa vissza.
 */
function feluletValasz(): UiState {
  const s = settings.get();
  return {
    modeAsked: felulet.modeAsked,
    iratBeallitas: {
      themeId: s.themeId,
      mode: s.mode,
      keepKey: s.keepKey,
      autoThreshold: s.autoThreshold,
      replaceAmounts: s.replaceAmounts,
      shiftDates: s.shiftDates,
      labelLang: s.labelLang,
    },
  };
}

/**
 * A frissítési csatorna beolvasása.
 *
 * Sérült fájlnál nem dobunk hibát: a frissítés kikapcsolt állapotba kerül, és
 * a menüpont ezt ki is mondja. Egy megnyithatatlan beállítás miatt nem állhat
 * meg egy program, aminek a fő dolga az iratok álnevesítése.
 */
function frissitestOlvas(): FrissitesBeallitas {
  if (!existsSync(frissitesFajl)) return { ...FRISSITES_ALAP };
  try {
    const raw = JSON.parse(readFileSync(frissitesFajl, 'utf8')) as Partial<FrissitesBeallitas>;
    return { feedUrl: ervenyesCsatorna(raw.feedUrl ?? '') };
  } catch {
    return { ...FRISSITES_ALAP };
  }
}

/**
 * A frissítési cím elfogadása — CSAK `https://`.
 *
 * Nem formaság: ezen a címen keresztül futtatható kód érkezik a felhasználó
 * gépére. Titkosítatlan `http://` fölött bárki, aki a hálózaton közbeékelődik,
 * kicserélheti a telepítőt — és a program azt indítaná el. Ami nem megy át
 * ezen, azt üresnek tekintjük: a frissítés inkább legyen kikapcsolva, mint
 * megbízhatatlan csatornán bekapcsolva.
 */
function ervenyesCsatorna(nyers: string): string {
  const t = (nyers ?? '').trim();
  if (t === '') return '';
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:') return '';
    return t.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** A futtató neve, ahogy a felhasználónak megmutatjuk. */
const MOTOR_NEVE: Record<ModelSpec['engine'], string> = {
  onnx: 'ONNX Runtime',
  transformers: 'Transformers.js',
};

/**
 * A ténylegesen betöltendő hálófájl neve.
 *
 * A betöltő a pontos, lebegőpontos háló hiányában SZÓ NÉLKÜL a 8 bitesre vált
 * (lásd `HubertNer.netFile`). A mérés szerint a 8 bites elveszít egy csupa
 * nagybetűs aláírásban álló személynevet — egy kitakaró programban ez
 * kiszivárgott személyazonosság. Ezért nem mindegy, melyik fut, és ezért látja
 * a felhasználó a fájl nevét.
 */
function halofajl(spec: ModelSpec): string {
  const dir = models.dirFor(spec);
  if (spec.engine === 'onnx') {
    if (existsSync(join(dir, 'model.onnx'))) return 'model.onnx';
    if (existsSync(join(dir, 'model.int8.onnx'))) return 'model.int8.onnx';
    // Egyik sincs meg: a modell hiányzik, ezt a `modelState` mondja meg.
    return 'model.onnx';
  }
  return spec.files.find((f) => f.path.endsWith('.onnx'))?.path ?? '';
}

/**
 * Személy vagy szervezet.
 *
 * A kulcsfájl nem jegyzi fel a bejegyzés fajtáját (`writeKeyFile`, keyfile.ts),
 * ezért a cégformából következtetünk rá. Csak a lista áttekinthetőségét
 * szolgálja, cserét nem befolyásol.
 */
const CEGFORMA =
  /(?:^|[ .\-])(kft|bt|zrt|nyrt|kkt|rt|kht|szövetkezet|egyesület|alapítvány|önkormányzat|hivatal|bíróság|ügyészség)\.?$/i;

function kulcsFajta(original: string): string {
  return CEGFORMA.test(original.trim()) ? 'szervezet' : 'személy';
}

/* ─────────────────────────── saját névkészlet ─────────────────────────── */

/**
 * A gyártás CSOPORTONKÉNT megy, nem egy kéréssel.
 *
 * Egy négymilliárd paraméteres modell a hetven tételes JSON-t gyakran elrontja
 * a végén: levágja, elfelejti a zárójelet. Négy rövid kérés négy rövid válasza
 * megbízhatóbb — és mellékesen ez az, amiből a felhasználó látja, hogy halad
 * valami, mert egy csoport processzoron percekbe telik.
 *
 * A megnevezés magyarul áll, mert a felhasználó ezt olvassa a folyamatjelzőn.
 */
const GYARTASI_CSOPORTOK: readonly { csoport: JavaslatCsoport; nev: string }[] = [
  { csoport: 'given', nev: 'utóneveket' },
  { csoport: 'surname', nev: 'vezetékneveket' },
  { csoport: 'org', nev: 'cégnév-előtagokat' },
  { csoport: 'place', nev: 'helységneveket' },
];

/**
 * Amit a névkészlet-gyártáshoz a modell futtatójától várunk.
 *
 * A meglévő futtató (`ModelClient`, src/ai/client.ts) ma CÍMKÉZ: szöveget kap,
 * entitásokat ad vissza. A gyártáshoz szövegre van szükség, és ezt a kérést a
 * munkafolyamat (`src/ai/worker.ts`) ismeri majd — a kettő ugyanaz a folyamat,
 * csak másik kérésfajta. Amíg a futtató ezt nem tudja, a `generate` egyszerűen
 * nincs meg, és a felhasználó erről KAP ÜZENETET, nem egy néma hibát.
 */
interface Szoveggyarto {
  generate(kerdes: string, maxUjToken?: number): Promise<string>;
}

/**
 * A saját névkészlet legyártása: téma → nyers javaslatok → ellenőrzött készlet.
 *
 * A MUNKAMEGOSZTÁS itt látszik a legjobban: a modell csak JAVASOL, a magyar
 * ragozást a program saját, mért motorja adja hozzá, és a program ellenőriz.
 * Ez a függvény a három lépés összekötése — a döntéseket a `temagyar.ts` hozza.
 *
 * A modell a végén MINDIG elengedjük: a gyártó háló 2,9 GB, és egy 16 GB-os
 * gépen nem maradhat bent azért, mert a felhasználó egyszer kipróbált egy témát.
 */
async function nevkeszletetGyart(
  temaSzoveg: string,
  jelez: (s: TemaGenStatus) => void,
): Promise<TemaEredmeny> {
  const tema = (temaSzoveg ?? '').trim().replace(/\s+/g, ' ');
  if (tema.length < 3) {
    throw new Error(
      'Írd be, milyen témájú neveket szeretnél — például „görög mitológia" vagy „csillagképek". ' +
        'Egy-két betűből a modell nem tud készletet összeállítani.',
    );
  }

  const spec = namegenModel();
  if (!spec) {
    throw new Error('A nyilvántartásban nincs névkészlet-gyártó modell, ezért nincs mivel gyártani.');
  }

  const allapot = (await models.list()).find((x) => x.id === spec.id);
  if (allapot?.state !== 'installed') {
    // A felület ezt az ágat rendes esetben megelőzi: a párbeszéd a modell
    // állapotát MEGNÉZI, mielőtt a témát elkérné. Ez itt a versenyhelyzet
    // elleni kapu — ha a modellt közben törölték, ne rejtélyes hiba jöjjön.
    throw new Error(
      `A(z) „${spec.name}" nincs letöltve, ezért saját névkészletet most nem tudunk gyártani. ` +
        'Nyisd meg a Beállítások → Nyelvi modellek lapot, és töltsd le.',
    );
  }

  const kliens = new ModelClient({
    workerPath: join(HERE, 'ai-worker.cjs'),
    config: {
      modelId: spec.id,
      repo: spec.repo,
      cacheDir: models.rootFor(spec),
      labelMap: spec.labelMap,
      engine: spec.engine,
      // A nyilvántartás a 4 bites hálót szállítja (lásd a `files` listát): a
      // fp16 8,1 GB-os változat nem fér el egy 16 GB-os gépen a program mellett.
      dtype: 'q4',
    },
    // Gondolkodó modell: mielőtt válaszol, magában végigfut a feladaton.
    // Processzoron egy csoport percekbe telik, a felismerés 3 perces korlátja
    // ide kevés lenne — és a lejárt idő itt elveszett munkát jelentene.
    timeoutMs: 900_000,
  });

  const gyarto = kliens as unknown as Partial<Szoveggyarto>;
  const generalj = gyarto.generate?.bind(kliens);
  if (typeof generalj !== 'function') {
    await kliens.dispose().catch(() => undefined);
    throw new Error(
      `A(z) „${spec.name}" le van töltve, de a programnak ez a változata még nem tudja ` +
        'futtatni: hiányzik hozzá a szöveggyártó rész. Jelezd a program készítőjének — addig ' +
        'a programmal szállított névkészletekből tudsz választani.',
    );
  }

  const javaslatok: NevJavaslat[] = [];
  try {
    for (let i = 0; i < GYARTASI_CSOPORTOK.length; i++) {
      const cs = GYARTASI_CSOPORTOK[i]!;
      jelez({
        uzenet: `A modell ${cs.nev} javasol a(z) „${tema}" témához…`,
        lepes: i + 1,
        lepesek: GYARTASI_CSOPORTOK.length,
      });
      const valasz = await generalj(epitsdAJavaslatKerest(tema, cs.csoport));
      // A csoportot alapértelmezésként is átadjuk: ha a modell elhagyta a
      // "kind" mezőt, a javaslat így sem vész el.
      javaslatok.push(...olvasdAJavaslatot(valasz, cs.csoport));
    }
  } finally {
    // A memóriát AKKOR IS visszaadjuk, ha a gyártás félbeszakadt.
    await kliens.dispose().catch(() => undefined);
  }

  jelez({
    uzenet: 'A javaslatok ellenőrzése és ragozása…',
    lepes: GYARTASI_CSOPORTOK.length,
    lepesek: GYARTASI_CSOPORTOK.length,
  });
  return keszitsTemat({ temaSzoveg: tema, javaslatok, homonimak: homonyms, nevKivetelek });
}

/* ─────────────────────────── frissítés ─────────────────────────── */

/**
 * Amit az `electron-updater`-ből használunk.
 *
 * Azért írjuk ki, és nem a csomag saját típusát vesszük át, mert a csomagot
 * FUTÁSIDŐBEN töltjük be (lásd `frissito()`), tehát fordításkor nincs is jelen.
 * Ez a néhány sor pontosan megmondja, mit várunk tőle.
 */
interface Frissito {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(o: { provider: 'generic'; url: string }): void;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string; releaseNotes?: unknown } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void;
  on(esemeny: string, cb: (adat: unknown) => void): void;
  removeAllListeners(esemeny: string): void;
}

/**
 * A csomag neve VÁLTOZÓBAN, és ez nem stílus.
 *
 * A főfolyamatot az esbuild EGYETLEN fájlba köti (`npm run build:electron`).
 * Egy kiírt `import`-ot vagy szó szerinti `require('electron-updater')`-t a
 * kötegelő MAGÁBA HÚZNA — az `electron-updater` viszont futásidőben, a saját
 * mappájából tölt be dolgokat, és becsomagolva elromlik. Változóból képzett
 * névvel a kötegelő érintetlenül hagyja, és a csomag onnan töltődik be, ahova
 * az `electron-builder` a `dependencies` fát kicsomagolta — így a
 * `build:electron` parancsot sem kell `--external`-lal bővíteni.
 */
const FRISSITO_CSOMAG = 'electron' + '-updater';

const igenyel = igenylotKeszit(import.meta.url);

let frissitoPeldany: Frissito | null = null;

/**
 * A frissítő betöltése, ha egyáltalán lehetséges.
 *
 * Két külön ok van, amiért nem: fejlesztői indításnál a program nincs
 * telepítve, tehát nincs mit lecserélni; kiadott programban pedig hiányozhat a
 * frissítő összetevő, ha a csomag nem került be a telepítőbe. A kettőt külön
 * mondjuk el, mert a teendő is más — az egyikkel a felhasználónak nincs dolga,
 * a másikat jelentenie kell.
 *
 * @returns a frissítő, vagy a magyar mondat, ami megmondja, miért nincs
 */
function frissito(): Frissito | string {
  if (!app.isPackaged) {
    return (
      'A frissítés csak a telepített programban működik. Most fejlesztői indításból fut, ' +
      'ilyenkor nincs mit lecserélni.'
    );
  }
  if (frissitoPeldany) return frissitoPeldany;
  try {
    const modul = igenyel(FRISSITO_CSOMAG) as { autoUpdater?: Frissito };
    if (!modul?.autoUpdater) throw new Error('Nincs autoUpdater a csomagban.');
    frissitoPeldany = modul.autoUpdater;
    // A letöltést a FELHASZNÁLÓ indítja, nem a keresés. Enélkül a keresés
    // magától lehúzna több száz megabájtot annak, aki csak megnézte, van-e új.
    frissitoPeldany.autoDownload = false;
    // Kilépéskor sem telepítünk magunktól: a program bezárása után elinduló
    // telepítő pontosan az a meglepetés, amit egy jogi iratokkal dolgozó
    // gépen senki nem kér.
    frissitoPeldany.autoInstallOnAppQuit = false;
    return frissitoPeldany;
  } catch {
    return (
      'Ebbe a telepítésbe nem került bele a frissítő összetevő, ezért a program magát nem ' +
      'tudja lecserélni. Az új változatot addig a szokásos módon, telepítővel kell felrakni.'
    );
  }
}

/**
 * Újabb-e a talált verzió a mostaninál.
 *
 * CSAK A SZÁMOKAT hasonlítjuk össze, szakaszonként („0.2.0" > „0.1.9"). A
 * kiadás előtti címkék (»-beta«) figyelmen kívül maradnak: ezen a csatornán
 * ilyen nem jelenik meg, és egy félreértelmezett címke miatt sem felkínálni,
 * sem elhallgatni nem szabad egy frissítést. A szétvágás kiírt számosztályon
 * megy, nem `\w`-n — az ASCII-alapú osztályok magyar szövegen csendben
 * elromlanak, és ez a projekt ezt már megfizette egyszer.
 */
function ujabbVerzio(uj: string, mostani: string): boolean {
  const bont = (v: string): number[] =>
    v
      .split(/[^0-9]+/)
      .filter((x) => x !== '')
      .map((x) => Number(x));
  const a = bont(uj);
  const b = bont(mostani);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * A kiadási jegyzet emberi alakja.
 *
 * Az `electron-updater` háromféle alakban adhatja: szövegként, HTML-ként, vagy
 * verziónkénti tömbként. A HTML-jelöléseket kiszedjük — a felület sima
 * szövegként rajzolja ki, tehát a jelölések ott nyersen látszanának.
 */
function kiadasiJegyzet(nyers: unknown): string {
  const szoveg = Array.isArray(nyers)
    ? nyers
        .map((x) => (typeof x === 'string' ? x : ((x as { note?: string })?.note ?? '')))
        .join('\n')
    : typeof nyers === 'string'
      ? nyers
      : '';
  return szoveg
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 1200);
}

/** A frissítés állapota, ahogy a felületnek átadjuk. */
let frissitesAllapot: { phase: UpdatePhase; newVersion: string; notes: string; uzenet: string } = {
  phase: 'idle',
  newVersion: '',
  notes: '',
  uzenet: '',
};

/**
 * Az állapot összeállítása.
 *
 * A beállítatlan csatorna MINDIG felülírja a megjegyzett fázist: ha a
 * felhasználó időközben kitörölte a címet, a képernyőn nem maradhat ott egy
 * korábbi keresés eredménye — abból azt hinné, hogy a frissítés be van
 * kapcsolva.
 */
function frissitesValasz(): UpdateState {
  const alap = {
    feedUrl: frissites.feedUrl,
    currentVersion: app.getVersion(),
  };
  if (frissites.feedUrl === '') {
    return {
      ...alap,
      phase: 'off',
      newVersion: '',
      notes: '',
      uzenet:
        'A frissítés még nincs bekapcsolva: nincs megadva, honnan töltse le a program az új ' +
        'változatot. Írd be alább a frissítési címet — ezt attól kérdezd meg, akitől a ' +
        'programot kaptad.',
    };
  }
  // A beállított, de még meg nem kérdezett csatorna sem maradhat mondat nélkül:
  // az ablak különben csak egy gombot mutatna, magyarázat nélkül.
  if (frissitesAllapot.phase === 'idle' && frissitesAllapot.uzenet === '') {
    return {
      ...alap,
      ...frissitesAllapot,
      uzenet:
        'A frissítési cím be van állítva. A program magától soha nem keres frissítést — ' +
        'kattints a keresésre, ha meg akarod nézni, van-e újabb változat.',
    };
  }
  return { ...alap, ...frissitesAllapot };
}

function registerHandlers(): void {
  handle('themes:list', () => themeSummaries());

  handle('settings:get', () => settings.get());
  handle('settings:set', (_e, p: Partial<Settings>) => settings.set(p));

  /*
    A BEÁLLÍTÓ OLDAL EGYETLEN BEJÁRATA.

    Kétféle adat jön ki rajta, és a kettő MÁS FÁJLBAN lakik. A `modeAsked` a
    program emlékezete (megkérdeztük-e már, melyik úton menjünk végig) — az a
    `felulet.json`-ban, mert nem a felhasználó döntése. Az `iratBeallitas` a
    LEGUTÓBB HASZNÁLT iratonkénti értékeket adja vissza, és az a rendes
    beállításfájlból jön: azok igenis a felhasználó döntései, csak épp a
    beállító oldalon szerkeszti őket, nem a Beállítások ablakban.

    Miért EGY hívás a kettőre: a beállító oldalnak pontosan azt a hatot kell
    megkapnia, ami rajta állítható. Ha a felület a tíz beállításból magának
    válogatná ki őket, a hetedik érték hozzáadásakor a lista csendben hiányos
    maradna — és a felhasználó egy olyan képernyőt látna, ami nem mindent mutat,
    amit ténylegesen alkalmazunk.

    Az írás hibáját elnyeljük: ha a felhasználói mappa írásvédett, attól még
    ugyanúgy végig lehet vinni az iratot, csak a következő indításnál a program
    újra megkérdezi az utat. Egy hibaüzenet itt többet ártana, mint a kérdés
    megismétlése.
  */
  handle('ui:getState', (): UiState => feluletValasz());

  handle(
    'ui:setState',
    (_e, p: { modeAsked?: boolean; iratBeallitas?: Partial<IratBeallitas> }): UiState => {
      if (typeof p?.modeAsked === 'boolean') {
        felulet = { ...felulet, modeAsked: p.modeAsked };
        try {
          mkdirSync(dirname(feluletFajl), { recursive: true });
          writeFileSync(feluletFajl, JSON.stringify(felulet, null, 1), 'utf8');
        } catch {
          // Lásd fent: a nem megjegyzett válasz nem hiba, csak egy újabb kérdés.
        }
      }
      /*
        AZ IRATONKÉNTI ÉRTÉKEK A BEÁLLÍTÁSFÁJLBA MENNEK, nem ide.

        Kísértés volna a felület emlékezetébe tenni őket, hiszen a beállító
        oldalon állnak, nem a Beállítások ablakban. De az a hely csak a
        SZERKESZTÉS helye; maga az érték attól még a felhasználó döntése, és
        egy döntésnek egy tárolója lehet. Két példányból előbb-utóbb kettő
        LESZ: az egyik szerint kőkorszaki nevekkel dolgozunk, a másik szerint
        ásványokkal — és a felhasználó azt hiszi, azt választotta, amit a
        képernyőn lát.

        A `SettingsStore.set` ellenőriz is (`pick`, src/app/settings.ts): az
        ismeretlen csere-módot és a tartományon kívüli küszöböt eldobja, tehát
        egy elrontott hívás nem tudja használhatatlanná tenni a cserét.
      */
      if (p?.iratBeallitas) settings.set(p.iratBeallitas);
      return feluletValasz();
    },
  );

  /* ──────────────────── saját névkészlet ──────────────────── */

  handle('themes:generate', async (e, temaSzoveg: string): Promise<TemaEredmeny> => {
    const eredmeny = await nevkeszletetGyart(temaSzoveg, (s) => e.sender.send('themes:genStatus', s));
    // Csak a JÓVÁHAGYÁSRA váró készletet tesszük el. A felület nem küldhet
    // vissza kész témát, csak erre bólinthat rá — lásd `utolsoGyartott`.
    utolsoGyartott = eredmeny;
    return eredmeny;
  });

  handle('themes:saveGenerated', () => {
    const kesz = utolsoGyartott;
    if (!kesz?.theme) {
      throw new Error(
        'Nincs elmenthető névkészlet: az utolsó gyártásból nem lett használható csomag. ' +
          'Add meg újra a témát, és próbáld meg egy bővebb megfogalmazással.',
      );
    }
    mkdirSync(sajatTemaMappa, { recursive: true });
    // A fájlnév az azonosítóból jön, tehát az ismételt mentés ugyanazt a
    // készletet frissíti, nem szaporítja. A 》sajat_《 előtag (temaAzonosito)
    // zárja ki, hogy egy szállított csomag nevére írjunk.
    writeFileSync(
      join(sajatTemaMappa, `${kesz.theme.id}.json`),
      JSON.stringify(kesz.theme, null, 1),
      'utf8',
    );
    // Az egész listát újraolvassuk, nem toldjuk hozzá: így a memóriában lévő
    // állapot biztosan azt tükrözi, ami a lemezen van.
    loadData();
    return themeSummaries();
  });

  handle('themes:removeCustom', (_e, id: string) => {
    // CSAK SAJÁT KÉSZLET törölhető. A szállított négy a program mellett lakik;
    // egy ide tévedt azonosítóval a felület a telepítés fájljait törölhetné.
    if (!sajatTemak.has(id)) {
      throw new Error('Ez a névkészlet a programmal érkezett, ezért nem törölhető.');
    }
    rmSync(join(sajatTemaMappa, `${id}.json`), { force: true });
    if (utolsoGyartott?.theme?.id === id) utolsoGyartott = null;
    loadData();
    return themeSummaries();
  });

  /* ──────────────────── frissítés ──────────────────── */

  handle('update:state', (): UpdateState => frissitesValasz());

  handle('update:setFeed', (_e, url: string): UpdateState => {
    const tiszta = ervenyesCsatorna(url);
    if (url.trim() !== '' && tiszta === '') {
      throw new Error(
        'Ez a cím nem használható frissítésre. Teljes, https://-sel kezdődő webcím kell — ezen ' +
          'a csatornán futtatható program érkezik a gépedre, titkosítatlan kapcsolaton pedig ' +
          'bárki kicserélhetné a hálózaton.',
      );
    }
    frissites = { feedUrl: tiszta };
    try {
      mkdirSync(dirname(frissitesFajl), { recursive: true });
      writeFileSync(frissitesFajl, JSON.stringify(frissites, null, 1), 'utf8');
    } catch {
      // Az írás hibája nem tiltja meg a frissítést ebben a munkamenetben: a
      // cím érvényes marad, csak a következő indításnál kell újra beírni.
    }
    // A cím megváltozásával a korábbi keresés eredménye érvénytelen: másik
    // csatornán másik verzió állhat.
    frissitesAllapot = { phase: 'idle', newVersion: '', notes: '', uzenet: '' };
    frissitoPeldany = null;
    return frissitesValasz();
  });

  handle('update:check', async (): Promise<UpdateState> => {
    if (frissites.feedUrl === '') return frissitesValasz();
    const fr = frissito();
    if (typeof fr === 'string') {
      frissitesAllapot = { phase: 'unsupported', newVersion: '', notes: '', uzenet: fr };
      return frissitesValasz();
    }
    try {
      fr.setFeedURL({ provider: 'generic', url: frissites.feedUrl });
      const res = await fr.checkForUpdates();
      const talalt = res?.updateInfo?.version ?? '';
      const mostani = app.getVersion();
      if (talalt === '') {
        frissitesAllapot = {
          phase: 'failed',
          newVersion: '',
          notes: '',
          uzenet:
            'A frissítési cím elérhető, de nem közölt verziószámot. Lehet, hogy a cím egy ' +
            'mappára mutat, amiben még nincs kiadás.',
        };
        return frissitesValasz();
      }
      if (!ujabbVerzio(talalt, mostani)) {
        frissitesAllapot = {
          phase: 'current',
          newVersion: talalt,
          notes: '',
          uzenet: `A program naprakész: a ${mostani} verzió fut, és a csatornán sincs újabb.`,
        };
        return frissitesValasz();
      }
      frissitesAllapot = {
        phase: 'available',
        newVersion: talalt,
        notes: kiadasiJegyzet(res?.updateInfo?.releaseNotes),
        uzenet: `Új verzió érhető el: ${talalt}. A most futó a ${mostani}.`,
      };
      return frissitesValasz();
    } catch (err) {
      frissitesAllapot = {
        phase: 'failed',
        newVersion: '',
        notes: '',
        uzenet: magyarHiba(err),
      };
      return frissitesValasz();
    }
  });

  handle('update:download', async (e): Promise<UpdateState> => {
    if (frissites.feedUrl === '') return frissitesValasz();
    const fr = frissito();
    if (typeof fr === 'string') {
      frissitesAllapot = { phase: 'unsupported', newVersion: '', notes: '', uzenet: fr };
      return frissitesValasz();
    }
    const verzio = frissitesAllapot.newVersion;
    frissitesAllapot = { ...frissitesAllapot, phase: 'downloading', uzenet: 'A letöltés folyamatban…' };

    // A régi feliratkozásokat mindig eldobjuk: egy megszakadt és újraindított
    // letöltés különben kétszer küldené ugyanazt a haladást, és a folyamatjelző
    // ugrálna.
    fr.removeAllListeners('download-progress');
    fr.on('download-progress', (adat: unknown) => {
      const p = adat as { transferred?: number; total?: number; percent?: number; bytesPerSecond?: number };
      const arany = typeof p.percent === 'number' ? p.percent / 100 : 0;
      const uzenet: UpdateProgress = {
        receivedBytes: p.transferred ?? 0,
        totalBytes: p.total ?? 0,
        ratio: Math.max(0, Math.min(1, arany)),
        bytesPerSecond: p.bytesPerSecond ?? 0,
      };
      e.sender.send('update:progress', uzenet);
    });

    try {
      await fr.downloadUpdate();
      frissitesAllapot = {
        phase: 'ready',
        newVersion: verzio,
        notes: frissitesAllapot.notes,
        uzenet:
          `A ${verzio} verzió letöltve. A telepítéshez a program bezárul, és a telepítő ` +
          'elindul — a megnyitott iratot ezért előbb mentsd el.',
      };
    } catch (err) {
      frissitesAllapot = {
        phase: 'failed',
        newVersion: verzio,
        notes: '',
        uzenet: magyarHiba(err),
      };
    } finally {
      fr.removeAllListeners('download-progress');
    }
    return frissitesValasz();
  });

  handle('update:install', () => {
    const fr = frissito();
    if (typeof fr === 'string') throw new Error(fr);
    if (frissitesAllapot.phase !== 'ready') {
      throw new Error('Nincs letöltött frissítés, amit telepíteni lehetne.');
    }
    // Az `isSilent = false`: a magyar nyelvű telepítővarázsló jöjjön elő,
    // ugyanaz, amit az első telepítéskor látott. A `forceRunAfter` indítja
    // újra a programot, amikor kész.
    fr.quitAndInstall(false, true);
  });

  /**
   * A programról szóló adatok. A hálófájl neve azért van benne, mert a betöltő
   * csendben a 8 bites változatra esik vissza, ha a pontos nincs a gépen — ezt
   * a felhasználónak látnia kell, mielőtt egy iratot kiad a kezéből.
   */
  handle('app:info', async (): Promise<AppInfo> => {
    const s = settings.get();
    const spec = MODEL_REGISTRY.find((x) => x.id === s.modelId);
    const status = (await models.list()).find((x) => x.id === s.modelId);
    return {
      version: app.getVersion(),
      modelId: s.modelId,
      modelName: spec?.name ?? s.modelId,
      modelState: status?.state ?? 'missing',
      modelFile: spec ? halofajl(spec) : '',
      engine: spec ? MOTOR_NEVE[spec.engine] : '',
    };
  });

  handle('app:setDirty', (e, dirty: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) piszkos.set(win.id, dirty);
  });

  /**
   * A BEZÁRÁSI KÉRDÉS VÁLASZA a felület saját ablakából.
   *
   * Három válasz, három út, és mindhárom ITT ér véget — nem a felületen.
   * A felület nem tudja bezárni az ablakot, és nem is szabad tudnia: a
   * bezárás a főfolyamaté, ő tartja számon, melyik ablakon bólintottak rá a
   * mentés nélküli kilépésre.
   *
   * A mentést viszont a FELÜLET intézi, mert csak ő tudja, mi a kimenet neve
   * és formátuma — ezért abból az ágból csak a menüparancs megy vissza neki,
   * és az ablak nyitva marad.
   */
  /**
   * A FELÜLET NYUGTÁJA: megkaptam a bezárási kérdést, ki is rajzoltam.
   *
   * Ettől a ponttól a felhasználó annyit gondolkodik, amennyit akar — a
   * tartalék-időzítő leáll. A bejegyzés viszont MEGMARAD (`null` értékkel),
   * mert a kérdés ettől még fut: a második bezárási kísérlet ne nyisson
   * másodikat, és a kifagyás-jelzés is ebből tudja, hogy van mit átvennie.
   *
   * Ismeretlen ablak vagy már lezárult kérdés esetén nincs teendő: egy késve
   * érkező nyugta nem támaszthat fel egy befejezett bezárást.
   */
  handle('app:closeAsked', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !zarasKerdes.has(win.id)) return;
    const varakozo = zarasKerdes.get(win.id);
    if (varakozo) clearTimeout(varakozo);
    zarasKerdes.set(win.id, null);
  });

  handle('app:closeDecision', (e, valasz: 'save' | 'discard' | 'cancel') => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    // A tartalék-időzítőt MINDHÁROM ágon leállítjuk: válasz után a
    // rendszerpárbeszéd fölöslegesen, másodszor kérdezné meg ugyanazt.
    // (Nyugta után `null` áll itt — akkor nincs mit leállítani, csak törölni.)
    const kerdes = zarasKerdes.get(win.id);
    if (kerdes) clearTimeout(kerdes);
    zarasKerdes.delete(win.id);
    if (valasz === 'save') sendMenu('save', win);
    else if (valasz === 'discard') zarasEngedve(win, win.id);
  });

  /**
   * A NATÍV ABLAKGOMBOK IGAZÍTÁSA a felület állapotához.
   *
   * A kicsinyítés / teljes méret / bezárás gombot nem a felület rajzolja,
   * hanem az Electron a lap FÖLÖTT. A párbeszédek mögé húzott fátyol ezért nem
   * ér el odáig: a felület elhalványult, a három gomb viszont világosan
   * kirítt a jobb felső sarokban. Itt festjük őket ugyanarra a színre, amit a
   * fátyol ad ki a fejlécen.
   *
   * A témát a felület mondja meg — lásd `FeluletTema`. Ismeretlen értéknél a
   * világosra esünk vissza: azzal indul az ablak is, tehát abból legfeljebb
   * annyi lesz, hogy a sáv nem halványul — nem pedig egy vakító csík a sötét
   * fejléc szélén.
   */
  handle('ui:ablakkeret', (e, allapot: { halvanyitva: boolean; tema: FeluletTema }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    const tema: FeluletTema = allapot?.tema === 'sotet' ? 'sotet' : 'vilagos';
    keretetIgazit(win, tema, allapot?.halvanyitva === true);
  });

  handle('app:print', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return;
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false }, (success, reason) => {
        // A lemondott nyomtatás nem hiba: a felhasználó zárta be a párbeszédet.
        if (success || /cancel/i.test(reason)) resolve();
        else reject(new Error('A nyomtatás nem indult el. Ellenőrizd, hogy van-e beállított nyomtató.'));
      });
    });
  });

  handle('key:choose', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Kulcsfájl megnyitása',
      properties: ['openFile'],
      filters: [
        { name: 'Szivecske kulcsfájl', extensions: ['szkulcs'] },
        { name: 'Minden fájl', extensions: ['*'] },
      ],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  /**
   * A kulcsfájl visszafejtése. A jelszó csak ezen a hívási határon megy át, és
   * sehol nem marad meg: a kimenet a leképezési tábla, nem a jelszó.
   */
  handle('key:read', (_e, path: string, passphrase: string): KeyEntry[] => {
    const payload = readKeyFile(path, passphrase);
    return payload.entries.map((x) => ({
      original: x.original,
      pseudonym: x.replacement,
      kind: kulcsFajta(x.original),
    }));
  });

  handle('models:list', async () => {
    const list = await models.list();
    const usage = await models.diskUsage();
    return { models: list, diskUsage: usage, diskUsageLabel: formatBytes(usage) };
  });

  handle('models:download', async (e, modelId: string) => {
    downloadAbort?.abort();
    downloadAbort = new AbortController();
    try {
      await models.download(
        modelId,
        (p: DownloadProgress) => e.sender.send('models:progress', p),
        downloadAbort.signal,
      );
    } catch (err) {
      // A megszakítás a felhasználó döntése volt, nem hiba. A félbehagyott
      // fájl „részleges" állapotként jelenik meg a visszaadott listában.
      if (!megszakitas(err)) throw err;
    } finally {
      downloadAbort = null;
    }
    return models.list();
  });

  handle('models:cancel', () => {
    downloadAbort?.abort();
    downloadAbort = null;
  });

  handle('models:remove', async (_e, modelId: string) => {
    await models.remove(modelId);
    return models.list();
  });

  handle('doc:choose', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Irat megnyitása',
      properties: ['openFile'],
      filters: [
        { name: 'Támogatott iratok', extensions: ['pdf', 'docx', 'txt'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx'] },
        { name: 'Szöveg', extensions: ['txt'] },
      ],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });

  /**
   * IRAT MEGNYITÁSA — hozzáadva a mostaniakhoz, vagy helyettük.
   *
   * @param hozzaad ha igaz, a meglévő iratok MELLÉ kerül (ugyanaz az ügy);
   *                egyébként lecseréli az egészet (új ügy kezdése).
   * @returns minden betöltött irat leírója, betöltési sorrendben
   */
  handle('doc:open', async (_e, path: string, hozzaad?: boolean): Promise<DocumentInfo[]> => {
    const uj = await DocumentSession.open(path, homonyms);
    if (hozzaad === true) {
      /*
        UGYANAZT AZ IRATOT NEM VESSZÜK FEL KÉTSZER.

        A kétszer felvett irat kétszer is mentődne — ugyanarra a kimeneti
        névre —, és a találatlistán minden neve duplán állna. A második
        megnyitás ezért a MEGLÉVŐT frissíti a helyén: ha a fájl közben
        megváltozott, a friss tartalom számít.
      */
      const meglevo = sessions.findIndex((x) => x.info.path === uj.info.path);
      if (meglevo >= 0) sessions[meglevo] = uj;
      else sessions.push(uj);
    } else {
      sessions = [uj];
    }
    lastAnalysis = null;
    // Az ELŐZŐ irat modell-állapota nem örökölhető. Ha itt bent maradna, egy
    // sikeres futás után megnyitott következő irat jegyzőkönyvébe az kerülne,
    // hogy a modell lefutott — pedig ezt az iratot el sem olvasta.
    utolsoModellAllapot = null;
    return sessions.map((x) => x.info);
  });

  /** Egy irat kivétele a listából. A visszatérés a maradék. */
  handle('doc:close', (_e, path: string): DocumentInfo[] => {
    sessions = sessions.filter((x) => x.info.path !== path);
    lastAnalysis = null;
    return sessions.map((x) => x.info);
  });

  /** A betöltött iratok leírói — a felület induláskor ebből épül fel. */
  handle('doc:list', (): DocumentInfo[] => sessions.map((x) => x.info));

  /**
   * A felek felismerése: a nyelvi modell olvassa az iratot, a szerkezeti
   * minták adják hozzá a szerepet és a megtartandó neveket. A felhasználónak
   * nem kell neveket gépelnie — csak átnéznie, amit találtunk.
   */
  /**
   * A FUTÓ VIZSGÁLAT LEÁLLÍTÁSA.
   *
   * Két dolgot tesz, és mindkettőre szükség van. A jelző a köztes lépéseket
   * állítja meg (a modell állapotának lekérdezése, a szöveg kinyerése), a
   * kliens `cancel()`-je pedig a modell folyamatát engedi el — az utóbbi az
   * egyetlen megbízható mód, mert a modell natív kódban, egyetlen hívás
   * belsejében tölti az idő nagy részét, ahova nem lehet „állj” jelzést küldeni.
   *
   * A leállítás után a program HASZNÁLHATÓ MARAD: a felhasználó kézzel is
   * felviheti a feleket, vagy indíthat új vizsgálatot — az új kérés magától új
   * modell-folyamatot indít.
   *
   * @returns volt-e mit leállítani; a hamis érték nem hiba
   */
  handle('doc:cancelDetect', (): boolean => {
    if (!felismeresFut) return false;
    felismerestMegszakitottak = true;
    modelClient?.cancel();
    return true;
  });

  handle('doc:detectParties', async (e): Promise<FelismeresValasz> => {
    if (sessions.length === 0) throw new Error('Nincs megnyitott irat.');
    const s = settings.get();
    if (!s.autoDetect) {
      // Felismerés nélkül a modell definíció szerint nem olvasott. A választ
      // TELJES alakban adjuk vissza — üres azonosítólistával és kitöltött
      // állapottal —, mert a felület egyetlen ágon dolgozza fel: egy hiányzó
      // mező itt csendes `undefined`-ként érkezne meg, és a hiányt csak a
      // képernyőn, üres rovat formájában lehetne észrevenni.
      utolsoModellAllapot = { state: 'off' };
      return {
        parties: [],
        keepList: [],
        officials: [],
        identifiers: [],
        model: utolsoModellAllapot,
        modelUsed: false,
        modelNote: '',
        megszakitva: false,
      };
    }

    // Innentől van mit leállítani: a `doc:cancelDetect` ettől a pillanattól
    // hat. A jelzőt minden induláskor törölni kell, különben egy korábbi
    // megszakítás az ÚJ vizsgálatot állítaná meg, még mielőtt elindulna.
    felismeresFut = true;
    felismerestMegszakitottak = false;
    let megszakitva = false;

    try {
      jelezdAHaladast(e, 'szoveg');
      /*
        A FELISMERÉS AZ ÖSSZES BETÖLTÖTT IRATOT OLVASSA.

        Egy ügy iratai nem ugyanazokat a neveket említik: a tanú nevét gyakran
        csak a jegyzőkönyv tartalmazza, a kezesét csak a szerződés. Iratonként
        külön felismerve mindegyik lista hiányos volna — és a hiányzó név
        pontosan az, ami bent marad a kimenetben.

        Az iratok közé ÜRES SOR kerül, nem puszta összefűzés: enélkül az egyik
        irat utolsó szava összeragadna a következő elsőjével, és a szerkezeti
        felismerés egy nem létező összetett nevet látna a határon.
      */
      const text = sessions.map((x) => x.fullText()).join('\n\n');
      let modelEntities: Awaited<ReturnType<ModelClient['extract']>>['entities'] | undefined;
      let modelNote = '';
      /*
        Amit a FŐFOLYAMAT tud a modellről, és a felismerő nem tudhat: van-e
        telepítve, elindult-e, elszállt-e. A `detectParties` ezt kiegészíti a
        darabszámokkal (hány entitás, hány nem értelmezett címke), és a
        `DetectionResult.model` mezőben adja vissza — onnan megy tovább a
        jegyzőkönyvbe és a felületre.
      */
      let allapot: ModelRunStatus = { state: 'off' };

      if (s.useModel) {
        const installed =
          (await models.list()).find((x) => x.id === s.modelId)?.state === 'installed';
        const client = installed ? getModelClient() : null;
        if (!client) {
          allapot = { state: 'missing' };
          modelNote =
            'A nyelvi modell nincs letöltve, ezért csak a szerkezeti felismerés futott. ' +
            'Beállítások → Nyelvi modellek.';
        } else {
          try {
            // A lemezes lekérdezés alatt is nyomhatták a Leállítást, és ott még
            // nem volt folyamat, amit ki lehetett volna lőni.
            megszakitottakE();

            /*
              A BETÖLTÉST KÜLÖN KÉRJÜK, pedig az `extract` magától is megtenné.

              Így válik láthatóvá a felismerés két, MERŐBEN MÁS hosszúságú
              szakasza: a modell betöltése egyszeri, ~650 MB-os lemezművelet, a
              vizsgálat pedig a szöveg hosszával nő. Egyben ez a kettő olyan
              volt, mint egy néma szünet — a felhasználó nem tudta, mire vár.
            */
            jelezdAHaladast(e, 'modell');
            await client.load();
            megszakitottakE();

            haladasCel = (h) => jelezdAHaladast(e, 'vizsgalat', h);
            jelezdAHaladast(e, 'vizsgalat');
            const r = await client.extract(text);
            modelEntities = r.entities;
            // A nem értelmezett címkék CSAK ITT szerezhetők meg: a futtató
            // folyamat számolja őket, és a válasszal adja vissza. Ha nem tennénk
            // át az állapotba, a program pont arról hallgatna, amit nem értett.
            allapot = { state: 'ok', unmappedByLabel: r.unmapped };
            modelNote = `A nyelvi modell ${r.entities.length} entitást talált ${r.ms} ms alatt.`;
          } catch (err) {
            if (megszakitas(err)) {
              /*
                A LEÁLLÍTÁS NEM HIBA — az állapot ezért 'off', nem 'failed'.

                Az 'off' azt jelenti: a modell nem olvasta ezt az iratot. Ez a
                megszakítás után SZÓ SZERINT IGAZ, és pontosan ez kerül majd a
                mentéskori jegyzőkönyvbe is. A 'failed' azt állítaná, hogy
                elromlott valami — miközben a program azt tette, amit kértek
                tőle.
              */
              megszakitva = true;
              allapot = { state: 'off' };
              modelNote =
                'A vizsgálatot leállítottad, ezért a nyelvi modell nem olvasta végig az iratot. ' +
                'Ami a rovatokból és a szerkezeti mintákból kiderült, azt alább látod — a ' +
                'hiányzó feleket kézzel is felviheted, vagy indíthatsz új vizsgálatot.';
            } else {
              // A modell kiesése nem állítja meg a munkát, ezért itt nem dobunk
              // tovább. A magyar mondat KÉT helyre kell: a jegyzet a felismerő
              // ablakban látszik MOST, az állapot pedig a mentéskori jegyzőkönyvbe
              // kerül bele — a kettő között a hiba ténye különben elveszne.
              modelNote = magyarHiba(err);
              allapot = { state: 'failed', message: modelNote };
            }
          } finally {
            haladasCel = null;
            // A memóriát azonnal visszaadjuk; a következő iratnál újraindul.
            // Megszakítás után ez már nem talál folyamatot: a `cancel()` azt
            // elengedte, tehát a `dispose` szó nélkül visszatér.
            await modelClient?.dispose().catch(() => undefined);
            modelClient = null;
          }
        }
      }

      /*
        A SZERKEZETI FELISMERÉS LEÁLLÍTÁS UTÁN IS LEFUT.

        Nem udvariasságból: ez a rész mintaillesztés, ezredmásodpercek alatt kész,
        és pont azt adja vissza, amit a rovatok kimondanak („Felperes:”,
        „I. rendű alperes:”), plusz az azonosítókat. Ha a megszakítás után üres
        listát adnánk, a felhasználó azt látná, hogy a leállítással MINDENT
        elvesztett — pedig a munka nagyobbik fele meglett.
      */
      jelezdAHaladast(e, 'osszesites');
      const result = detectParties(text, { modelEntities, homonyms, model: allapot });
      // A felismerő a darabszámokkal KIEGÉSZÍTVE adja vissza az állapotot, ezért
      // az övét jegyezzük meg, nem a saját nyers `allapot`-unkat.
      utolsoModellAllapot = result.model;
      jelezdAHaladast(e, megszakitva ? 'megszakitva' : 'kesz');
      return { ...result, modelUsed: result.model.state === 'ok', modelNote, megszakitva };
    } finally {
      // Akkor is elengedjük, ha kivétel repült ki: egy bent ragadt „fut még”
      // jelzőtől a Leállítás gomb egy soha véget nem érő vizsgálatot próbálna
      // megállítani, a haladás célja pedig egy bezárt ablakra mutatna.
      felismeresFut = false;
      felismerestMegszakitottak = false;
      haladasCel = null;
    }
  });

  handle('doc:resolveRevisions', async (_e, mode: 'accept' | 'reject'): Promise<DocumentInfo[]> => {
    if (sessions.length === 0) throw new Error('Nincs megnyitott irat.');
    /*
      MINDEN ÉRINTETT IRATBAN FELOLDJUK, nem csak az elsőben.

      A mentést bármelyik irat feloldatlan változáskövetése blokkolja — a
      törölt szöveg a fájlban szó szerint bent maradna. Ha csak az elsőt
      oldanánk fel, a felhasználó a „Feloldom most" után is blokkolt mentést
      kapna, és semmi nem mondaná meg, miért.

      A feloldott dokumentumot memóriában nyitjuk újra: az eredeti fájl
      változatlan marad, és a szöveg nem kerül ideiglenes fájlba.
    */
    const ujak: DocumentSession[] = [];
    for (const sess of sessions) {
      if (sess.info.pendingRevisions === 0) {
        ujak.push(sess);
        continue;
      }
      const resolved = await sess.resolveRevisions(mode);
      ujak.push(await DocumentSession.fromBytes(sess.info.path, resolved, homonyms));
    }
    sessions = ujak;
    lastAnalysis = null;
    // A változáskövetés feloldásával MEGVÁLTOZOTT a szöveg: a korábbi futás
    // már nem erről az iratról szól, tehát nem is állíthatjuk róla.
    utolsoModellAllapot = null;
    return sessions.map((x) => x.info);
  });

  handle('doc:analyze', async (_e, input: AnalyzeInput): Promise<AnalysisResult> => {
    if (sessions.length === 0) throw new Error('Nincs megnyitott irat.');
    const theme = themes.find((t) => t.id === input.themeId) ?? themes[0];
    if (!theme) throw new Error('Nincs telepített témacsomag.');

    /*
      A MODELL ÁLLAPOTÁT A FŐFOLYAMAT TÖLTI KI, NEM A FELÜLET.

      A felület nem tudhatja, mi történt a modellel: a futtató külön
      folyamatban él, a hibája itt keletkezik, és itt is kell elkapni. Amíg ez
      a sor nem volt meg, a mezőnek volt OLVASÓJA — a jegyzőkönyv
      »Nyelvi modell:« sora és az elemzés figyelmeztetései a `session.ts`-ben —,
      de nem volt ÍRÓJA. A motor hiány esetén a legóvatosabb olvasatra esik
      vissza, ezért minden iratra azt írta a jegyzőkönyvbe, hogy a modell ki van
      kapcsolva, akkor is, ha lefutott.

      A hívó által megadott érték erősebb: a tesztek és a parancssori futtatók
      így tudják kívülről beállítani, mit lásson a motor.
    */
    const model = input.model ?? utolsoModellAllapot ?? (await modellAllapotBeallitasbol());
    const teljes: AnalyzeInput = { ...input, model };

    lastInput = teljes;
    lastAnalysis = mindenIratotElemez(teljes, theme);
    return lastAnalysis;
  });

  /** Az álnevesített szöveg — annak az iratnak, amelyiket a felület mutatja. */
  handle('doc:previewText', (_e, path?: string) => {
    const s = path === undefined ? elsoSession() : sessions.find((x) => x.info.path === path);
    if (!s) throw new Error('Nincs megnyitott irat.');
    return s.anonymizedText();
  });

  /**
   * AZ ÁLNEVESÍTETT IRAT LAPKÉPEI — a PDF-előnézet.
   *
   * A KIEMELÉSEK AZONOSÍTÓJÁT ITT KELL ELTOLNI, ugyanazzal az `ID_LEPES`
   * lépéssel, amivel az elemzés a találatokét (lásd `mindenIratotElemez`). A
   * munkamenetek mind a saját, nulláról induló számozásukat ismerik; eltolás
   * nélkül a második irat előnézetén minden kiemelés az ELSŐ irat találatait
   * keresné meg — rossz szín, rossz buboréksúgó, néma hiba.
   */
  handle('doc:previewPages', async (_e, path?: string): Promise<PreviewPages> => {
    const i = path === undefined ? 0 : sessions.findIndex((x) => x.info.path === path);
    const s = sessions[i < 0 ? 0 : i];
    if (!s) throw new Error('Nincs megnyitott irat.');
    const eltolas = (i < 0 ? 0 : i) * ID_LEPES;
    const res = await s.anonymizedPages();
    return {
      pages: res.pages,
      highlights: res.highlights.map((h) => ({ ...h, matchId: h.matchId + eltolas })),
    };
  });

  /**
   * MINDEN BETÖLTÖTT IRAT ELEMZÉSE, EGY EREDMÉNYBE FŰZVE.
   *
   * Ami KÖZÖS, az a felek listája és a döntések: ugyanaz a bemenet megy
   * mindegyik iratra, tehát ugyanaz a valódi név mindegyikben ugyanazt a
   * fedőnevet kapja. Ez a többiratos működés egész lényege.
   *
   * Ami IRATONKÉNT MÁS, az a lapkép, a kiemelés helye és a szöveg — az a
   * `docs` tömbbe kerül, iratonként egy szakaszba.
   *
   * A DÖNTÉSEK SZÉTOSZTÁSA a kényes rész. A felület egyetlen kulcstérben
   * tartja őket (eltolt azonosítókkal), a munkamenetek viszont mind a saját,
   * nulláról induló számozásukat ismerik. Ezért minden iratnak a SAJÁT
   * tartományából visszafordított térképet adjuk át — enélkül a második irat
   * megkapná az elsőnek szánt döntéseket, és néma cserehibát okozna.
   */
  function mindenIratotElemez(input: AnalyzeInput, theme: Theme): AnalysisResult {
    const szakaszok: DocSection[] = [];
    const matches: MatchRow[] = [];
    const autoAccepted: AutoDecisionRow[] = [];
    const warnings: string[] = [];
    const counts = { auto: 0, review: 0, reject: 0 };
    const outcomes = { csere: 0, bizonytalan: 0, nincs: 0 };
    /** entityId → összefűzött szereplősor; a darabszámok összeadódnak. */
    const cast = new Map<string, CastRow>();
    let elso: AnalysisResult | null = null;

    /*
      EGYETLEN MEGJELENÉSI SORREND AZ EGÉSZ ÜGYRE.

      Az álnév-kiosztás ebből dönti el, ki kapja a névsor élén álló,
      legjellemzőbb fedőnevet. Iratonként külön számolva a keresetlevélben a
      felperes állna elöl, az ítéletben a bíróság — vagyis UGYANAZ A VALÓDI NÉV
      IRATONKÉNT MÁS FEDŐNEVET KAPNA. Az ügy iratai így nem volnának együtt
      olvashatók, és a felhasználó a kimenetekből nem tudná összerakni, ki
      kicsoda: pont az veszne el, amiért egyszerre vannak betöltve.

      A sorrend az ELSŐ iratból jön: azt elemezzük először, a saját sorrendjével,
      és a többi ugyanazt kapja. Aki csak egy későbbi iratban szerepel, annak
      nincs helye a listán — ő a kulcsból számolt nevet kapja, ugyanúgy minden
      iratban, mert a lista mindegyiknél azonos.
    */
    const nevFelek = new Set(
      input.parties.filter((p) => p.kind !== 'identifier').map((p) => p.id),
    );
    let kozosSorrend: string[] | null = null;

    sessions.forEach((sess, i) => {
      const eltolas = i * ID_LEPES;
      // A döntések visszabontása erre az iratra: csak a SAJÁT tartománya, és
      // a helyi számozásra visszafordítva.
      const sajatDontesek: Record<number, 'accept' | 'skip'> = {};
      for (const [kulcs, ertek] of Object.entries(input.decisions ?? {})) {
        const globalis = Number(kulcs);
        if (globalis < eltolas || globalis >= eltolas + ID_LEPES) continue;
        sajatDontesek[globalis - eltolas] = ertek;
      }
      const res = sess.analyze(
        {
          ...input,
          decisions: sajatDontesek,
          ...(kozosSorrend === null ? {} : { appearanceOrder: kozosSorrend }),
        },
        theme,
        homonyms,
      );
      if (i === 0) {
        elso = res;
        /*
          A SORRENDET AZ ELSŐ IRAT TALÁLATAIBÓL OLVASSUK KI. A találatok az irat
          sorrendjében állnak, tehát az entitások első előfordulása megadja a
          sorrendet. Az azonosítók (lakcím, adószám) kimaradnak: nekik nincs
          álnevük, csak adatfajta-megjelölésük, tehát a prioritási listán nincs
          keresnivalójuk.
        */
        const latott = new Set<string>();
        const sorrend: string[] = [];
        for (const m of res.matches) {
          if (!nevFelek.has(m.entityId) || latott.has(m.entityId)) continue;
          latott.add(m.entityId);
          sorrend.push(m.entityId);
        }
        kozosSorrend = sorrend;
      }

      szakaszok.push({
        doc: res.doc,
        pages: res.pages,
        highlights: res.highlights.map((h) => ({ ...h, matchId: h.matchId + eltolas })),
        previewText: res.previewText,
        matchIdTol: eltolas,
        matchIdIg: eltolas + ID_LEPES - 1,
      });

      for (const m of res.matches) matches.push({ ...m, id: m.id + eltolas });
      for (const a of res.autoAccepted ?? []) {
        autoAccepted.push({ ...a, matchId: a.matchId + eltolas });
      }
      /*
        A FIGYELMEZTETÉS MEGMONDJA, MELYIK IRATRÓL SZÓL. Több irat mellett egy
        cím nélküli „A 2. oldalon nincs használható ToUnicode tábla" mondat
        megválaszolhatatlan kérdés: melyik irat második oldalán?
      */
      for (const w of res.warnings) {
        warnings.push(sessions.length > 1 ? `${res.doc.fileName}: ${w}` : w);
      }
      counts.auto += res.counts.auto;
      counts.review += res.counts.review;
      counts.reject += res.counts.reject;
      if (res.outcomes) {
        outcomes.csere += res.outcomes.csere;
        outcomes.bizonytalan += res.outcomes.bizonytalan;
        outcomes.nincs += res.outcomes.nincs;
      }
      for (const c of res.cast) {
        const meglevo = cast.get(c.entityId);
        if (meglevo === undefined) {
          cast.set(c.entityId, { ...c });
          continue;
        }
        /*
          UGYANAZ A SZEREPLŐ, TÖBB IRATBAN. A csereszöveg és a szerep azonos
          (ugyanaz a bemenet, ugyanaz a kiosztás) — a DARABSZÁMOK viszont
          iratonként keletkeznek, tehát összeadódnak. Enélkül a lista az
          ELSŐ irat előfordulásait mutatná az egész ügyre.
        */
        meglevo.occurrences += c.occurrences;
        meglevo.pendingCount += c.pendingCount;
      }
    });

    const fo = elso as AnalysisResult | null;
    if (!fo) throw new Error('Nincs megnyitott irat.');
    const elsoSzakasz = szakaszok[0]!;
    return {
      ...fo,
      doc: elsoSzakasz.doc,
      pages: elsoSzakasz.pages,
      previewText: elsoSzakasz.previewText,
      highlights: elsoSzakasz.highlights,
      docs: szakaszok,
      cast: [...cast.values()],
      matches,
      warnings,
      counts,
      outcomes,
      autoAccepted,
    };
  }

  handle('doc:chooseSaveTarget', async (_e, suggested: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Álnevesített irat mentése',
      defaultPath: suggested,
    });
    return res.canceled ? null : (res.filePath ?? null);
  });

  handle('doc:export', async (_e, opts: ExportOptions): Promise<ExportResult> => {
    if (sessions.length === 0) throw new Error('Nincs megnyitott irat.');
    // A jegyzőkönyvet A MUNKAMENET írja ki, nem ez a kezelő. Itt korábban egy
    // sajátkezű `writeFileSync` állt, és az két ígéretet is megszegett:
    //
    //  1. „Szivárgásnál egyetlen fájl sem készül el" — a `session.export`
    //     tényleg nem ír ki semmit, ha maradt bent eredeti név, ez a sor
    //     viszont FELTÉTEL NÉLKÜL futott. A blokkolt mentés után is ott feküdt
    //     egy jegyzőkönyv a kimenet mellett, miközben a felület épp azt
    //     mondta a felhasználónak, hogy nem keletkezett fájl.
    //  2. „Idegen fájlt nem írunk felül" — a jegyzőkönyv neve származtatott,
    //     arra soha senki nem kérdezett rá. A `session.writeCertificate`
    //     ezért sorszámoz, ha a néven MÁS fájl van; ez a sor viszont a
    //     kiszámolt útvonalra vakon írt, és egy korábbi ügy jegyzőkönyvét
    //     (vagy bármi mást azon a néven) némán megsemmisítette.
    //
    // A visszaadott `certificate` szöveg megmarad — a felület abból dolgozik.

    /*
      A KÖTEG: MINDEN BETÖLTÖTT IRAT MENTÉSE, IRATONKÉNT ZÁRÓ KAPUVAL.

      A szivárgási kapu (`session.export`) iratonként dönt: ha egy iratban
      bent maradt egy eredeti név, abból NEM keletkezik fájl. A kötegre ezt
      kétféleképp lehetne kiterjeszteni, és csak az egyik helyes:

        – Az egész köteget eldobni egy bukott irat miatt: kilenc rendben lévő
          irat munkája veszne el a tizedik miatt, és a felhasználó semmit nem
          kapna a kezébe.
        – A rendben lévőket kiírni, a bukottat nem — ÉS TÉTELESEN MEGMONDANI,
          melyik nem készült el, és miért.

      A második a helyes: a védendő tulajdonság az, hogy SZIVÁRGÓ FÁJL SOSEM
      keletkezik — nem az, hogy hiba esetén semmi sem.

      A KULCSFÁJL EGYSZER KÉSZÜL. A leképezés mindegyik iratban ugyanaz (közös
      kiosztás), tehát iratonként egy-egy kulcsfájl ugyanannak a táblázatnak N
      másolata volna — mindegyik ugyanazzal a jelszóval, N helyen szórva.
    */
    const files: ExportFileResult[] = [];
    let fo: ExportResult | null = null;
    let keyPath: string | null = null;

    for (const [i, sess] of sessions.entries()) {
      const cel =
        sessions.length === 1
          ? opts.outputPath
          : join(dirname(opts.outputPath), kimenetiNev(sess.info.path, opts.mode));
      const r = await sess.export({ ...opts, outputPath: cel, keepKey: opts.keepKey && i === 0 });
      if (r.keyPath) keyPath = r.keyPath;
      files.push({
        fileName: sess.info.fileName,
        outputPath: r.outputPath,
        report: r.report,
        certificatePath: r.certificatePath ?? null,
        warnings: r.warnings,
      });
      if (i === 0) fo = r;
    }
    if (!fo) throw new Error('Nincs megnyitott irat.');
    return { ...fo, keyPath, files };
  });

  /** A kimeneti fájlnév egy irathoz: az eredeti neve, a mód utótagjával. */
  function kimenetiNev(path: string, mode: string): string {
    const ext = extname(path);
    const stem = basename(path, ext);
    const suffix = mode === 'role' ? 'obh' : 'alnevesitett';
    return `${stem}-${suffix}${ext}`;
  }

  handle('doc:suggestOutputPath', (_e, mode: string) => {
    const s0 = elsoSession();
    if (!s0) return '';
    return join(dirname(s0.info.path), kimenetiNev(s0.info.path, mode));
  });

  handle('shell:showItem', (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  // A megnyitott irat és a hozzá tartozó utolsó elemzés a munkamenet állapota.
  // Amíg nincs, aki lekérdezze, a fordítónak jelezzük, hogy szándékosan él.
  void lastInput;
  void lastAnalysis;
}
