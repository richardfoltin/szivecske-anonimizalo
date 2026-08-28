/**
 * Híd a felület és a főfolyamat között.
 *
 * A felület CSAK ezeket a hívásokat érheti el — nincs fájlrendszer, nincs
 * hálózat, nincs Node. Ez zárja ki, hogy a dokumentum tartalma bárhová
 * kikerüljön a felület kódján keresztül.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';

/*
  CSAK TÍPUS jön be a motorból, futó kód nem. A `import type` a fordításkor
  nyomtalanul eltűnik, tehát a hídba nem kerül bele a motor egyetlen sora sem —
  a felület továbbra sem lát fájlrendszert. A csere-mód négy értékét azért nem
  írjuk ki ide másodszor, mert egy lemásolt unió némán elcsúszik az eredetitől,
  és a felület olyan módot ajánlana fel, amit a motor nem ismer.
*/
import type { ReplacementMode } from '../src/app/types.js';

/** A menüsor egy pontjára kattintottak; a felület dönti el, mit jelent. */
export type MenuAction =
  | 'open'
  | 'save'
  | 'print'
  | 'settings'
  | 'newCase'
  | 'keyfile'
  | 'about'
  | 'update';

/** A „A programról" ablak adatai. */
export interface AppInfo {
  version: string;
  modelId: string;
  modelName: string;
  modelState: 'missing' | 'partial' | 'installed';
  /**
   * A ténylegesen betöltendő hálófájl neve — nem a beállított, hanem az, ami
   * tényleg futni fog. A betöltő szó nélkül a 8 bitesre vált, ha a pontos nincs
   * a gépen, és a kettő nem egyformán pontos.
   */
  modelFile: string;
  engine: string;
}

/** Egy sor a visszafejtett kulcsfájlból. */
export interface KeyEntry {
  original: string;
  pseudonym: string;
  kind: string;
}

/**
 * A frissítés állapota. A kilenc eset kilencféle teendő — ezért nincs
 * összevonva „megy / nem megy" párra.
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
  feedUrl: string;
  currentVersion: string;
  newVersion: string;
  notes: string;
  /** Magyar mondat: mi a helyzet, vagy mi a hiba. Mindig ki van töltve. */
  uzenet: string;
}

export interface UpdateProgress {
  receivedBytes: number;
  totalBytes: number;
  ratio: number;
  bytesPerSecond: number;
}

/** Hol tart a saját névkészlet gyártása. */
export interface TemaGenStatus {
  uzenet: string;
  lepes: number;
  lepesek: number;
}

/**
 * A felismerés szakaszai — négy valódi lépés és két végállapot.
 *
 * MIÉRT NEM ELÉG EGY PÖRGŐ KÖR: a négy szakasz négy különböző okból tarthat
 * sokáig, és a felhasználó teendője is más. A modell betöltése egyszeri
 * lemezművelet (~650 MB), a vizsgálat a szöveg hosszával nő. Aki látja, hogy
 * „a modell betöltése” tart percekig, tudja, hogy a következő iratnál ez a rész
 * gyorsabb lesz; aki csak egy pörgő kört lát, azt hiszi, megállt a program — és
 * a tapasztalat szerint ilyenkor lövi ki az egészet.
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
  /** Hányadik ablakkal végzett a modell; 0, ha még nem tart sehol. */
  ablak: number;
  /** Hány ablak lesz összesen; 0, ha nem tudjuk. */
  ablakok: number;
  /**
   * 0..1, VAGY `null`, ha nem tudjuk.
   *
   * A `null` szándékosan külön eset, nem 0: a nulla azt jelentené, hogy éppen
   * most kezdtük, a `null` viszont azt, hogy ebben a szakaszban nincs mit
   * arányosítani. A kettőt a felület máshogy rajzolja — határozott csíkkal,
   * illetve határozatlan sávval —, és egy kitalált százalék rosszabb, mint a
   * bevallott bizonytalanság: abból a felhasználó rossz időt becsül, és
   * pontosan akkor lövi ki a programot, amikor a végén tartana.
   */
  arany: number | null;
}

/**
 * Az IRATONKÉNT állítható értékek.
 *
 * Ezek a beállító oldalon állnak, nem a Beállítások ablakban: ügyenként más
 * lehet, melyik névkészlettel dolgozunk, milyen küszöbtől cserél magától a
 * program, és kell-e visszafejtő kulcsfájl. A LEGUTÓBBI értékekkel kell
 * megnyílnia, hogy aki mindig ugyanúgy dolgozik, ne állítgasson újra semmit.
 *
 * Ami itt NINCS: a modell azonosítója, az automatikus felismerés és a modell
 * használatának kapcsolója. Azok a programra vonatkoznak, nem az iratra —
 * azoknak a Beállításokban van a helyük.
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
   * Opcionális, mert egy RÉGEBBI beállításfájlban nincs benne, és a hiány nem
   * választás: olyankor a magyar marad érvényben.
   */
  labelLang?: 'hu' | 'en';
}

/**
 * A felület emlékezete — amit a program jegyez meg magáról.
 *
 * Az `iratBeallitas` a LEGUTÓBB HASZNÁLT értékeket adja vissza. Nem külön
 * másolat: ugyanabból a beállításfájlból olvassuk, amibe a mentés is ír — lásd
 * az `ui:getState` kezelőjét (electron/main.ts). Két helyen tárolva ugyanaz az
 * érték előbb-utóbb elcsúszna, és a felhasználó azt hinné, egy készlettel
 * dolgozik, miközben a motor másikkal.
 */
export interface UiState {
  modeAsked: boolean;
  iratBeallitas: IratBeallitas;
}

/**
 * Melyik téma van érvényben a felületen. A főfolyamat nem látja a lapot, tehát
 * nem tippelhet — az érték minden hívásban vele megy.
 */
export type FeluletTema = 'vilagos' | 'sotet';

/**
 * A NATÍV ABLAKGOMBOK állapota: a kicsinyítés / teljes méret / bezárás gomb.
 *
 * Ezt a hármat nem a felület rajzolja, hanem az Electron a lap FÖLÖTT — a
 * párbeszédek mögé húzott fátyol ezért nem ér el odáig, és a gombok világosan
 * kirínak a halványított felületből. A főfolyamat csak úgy tudja őket
 * hozzáigazítani, ha megmondjuk neki, mikor van nyitva párbeszéd.
 */
export interface AblakkeretAllapot {
  /** Van-e ÉPPEN nyitva modális párbeszéd — vagyis fátyol alatt van-e a lap. */
  halvanyitva: boolean;
  tema: FeluletTema;
}

const api = {
  listThemes: () => ipcRenderer.invoke('themes:list'),
  chooseDocument: () => ipcRenderer.invoke('doc:choose'),
  /**
   * IRAT MEGNYITÁSA. A `hozzaad` igaz értékére a meglévők MELLÉ kerül —
   * ugyanaz az ügy, közös álnév-kiosztással —, egyébként lecseréli az egészet.
   * A visszatérés MINDEN betöltött irat leírója, betöltési sorrendben.
   */
  openDocument: (path: string, hozzaad?: boolean) =>
    ipcRenderer.invoke('doc:open', path, hozzaad),
  /** Egy irat kivétele a listából; a visszatérés a maradék. */
  closeDocument: (path: string) => ipcRenderer.invoke('doc:close', path),
  /** A betöltött iratok leírói. */
  listDocuments: () => ipcRenderer.invoke('doc:list'),
  resolveRevisions: (mode: 'accept' | 'reject') => ipcRenderer.invoke('doc:resolveRevisions', mode),
  detectParties: () => ipcRenderer.invoke('doc:detectParties'),

  /**
   * A FUTÓ VIZSGÁLAT LEÁLLÍTÁSA.
   *
   * Egy hosszú iraton a modell percekig dolgozhat. Amíg ez a hívás nem volt
   * meg, a felhasználó ez alatt tehetetlen volt — és a leggyakoribb reakciója
   * az volt, hogy kilőtte az egész programot, a megnyitott irattal együtt.
   *
   * @returns volt-e egyáltalán mit leállítani. Hamis érték nem hiba: azt
   * jelenti, hogy a vizsgálat közben magától befejeződött.
   */
  cancelDetect: () => ipcRenderer.invoke('doc:cancelDetect'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),

  /**
   * A felület emlékezete, KÉT különböző fajta adattal.
   *
   * `modeAsked`: megkérdeztük-e már, melyik úton menjünk végig az iraton. Ez
   * nem a felhasználó döntése, hanem a programé, ezért külön fájlban lakik.
   *
   * `iratBeallitas`: a LEGUTÓBB HASZNÁLT iratonkénti értékek — ezek viszont a
   * felhasználó döntései, és a rendes beállításfájlba mennek. Azért itt jönnek
   * ki mégis, mert a beállító oldalnak EGY hívásból kell megkapnia pontosan
   * azt a hatot, ami rajta állítható; a felületnek nem dolga fejben tartani,
   * hogy a tíz beállításból melyik vonatkozik az iratra.
   */
  getUiState: () => ipcRenderer.invoke('ui:getState'),
  setUiState: (patch: unknown) => ipcRenderer.invoke('ui:setState', patch),
  listModels: () => ipcRenderer.invoke('models:list'),
  downloadModel: (id: string) => ipcRenderer.invoke('models:download', id),
  cancelDownload: () => ipcRenderer.invoke('models:cancel'),
  removeModel: (id: string) => ipcRenderer.invoke('models:remove', id),
  onDownloadProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown): void => cb(p);
    ipcRenderer.on('models:progress', h);
    return () => ipcRenderer.removeListener('models:progress', h);
  },
  /**
   * A felismerés haladása, EGYETLEN MONDATBAN.
   *
   * A szűkebb nézet: pontosan a `DetectProgress.uzenet` mezője, semmi több.
   * Azért marad meg, mert a munkalap tetején álló „elfoglalt” sor csak egy
   * mondatot tud kiírni, és annak nem kell tudnia a szakaszokról. Aki
   * folyamatjelzőt rajzol, az `onDetectProgress`-t vegye — a kettő ugyanabból
   * a forrásból, ugyanabban a pillanatban megy ki, tehát nem csúszhatnak szét.
   */
  onDetectStatus: (cb: (s: string) => void) => {
    const h = (_e: unknown, s: string): void => cb(s);
    ipcRenderer.on('doc:detectStatus', h);
    return () => ipcRenderer.removeListener('doc:detectStatus', h);
  },

  /** Ugyanaz, szakasszal és — ha értelmezhető — aránnyal. */
  onDetectProgress: (cb: (p: DetectProgress) => void) => {
    const h = (_e: unknown, p: DetectProgress): void => cb(p);
    ipcRenderer.on('doc:detectProgress', h);
    return () => ipcRenderer.removeListener('doc:detectProgress', h);
  },

  /*
    SAJÁT NÉVKÉSZLET.

    A mentésnek nincs paramétere, és ez szándékos: a felület nem adhat át kész
    témaobjektumot, csak jóváhagyhatja azt, amit a főfolyamat maga gyártott és
    maga ellenőrzött. Egy felületről érkező téma megkerülné az ellenőrzést, és
    onnantól ragozhatatlan vagy valódi magyar névvel ütköző álnevek kerülnének
    az iratba.
  */
  generateTheme: (temaSzoveg: string) => ipcRenderer.invoke('themes:generate', temaSzoveg),
  saveGeneratedTheme: () => ipcRenderer.invoke('themes:saveGenerated'),
  removeCustomTheme: (id: string) => ipcRenderer.invoke('themes:removeCustom', id),
  onThemeGenStatus: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown): void => cb(s);
    ipcRenderer.on('themes:genStatus', h);
    return () => ipcRenderer.removeListener('themes:genStatus', h);
  },

  /*
    FRISSÍTÉS.

    A csatorna címe ITT megy át, és sehol máshol: ez az egyetlen érték a
    programban, ami megmondja, hova csatlakozzon. A felület beállíthatja és
    elindíthatja a keresést, de magát a letöltést nem ő végzi — a hídon egy
    URL megy át, nem egy fájl.
  */
  updateState: () => ipcRenderer.invoke('update:state'),
  setUpdateFeed: (url: string) => ipcRenderer.invoke('update:setFeed', url),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (cb: (p: unknown) => void) => {
    const h = (_e: unknown, p: unknown): void => cb(p);
    ipcRenderer.on('update:progress', h);
    return () => ipcRenderer.removeListener('update:progress', h);
  },
  analyze: (input: unknown) => ipcRenderer.invoke('doc:analyze', input),
  /** Az álnevesített szöveg; útvonal nélkül az első betöltött iraté. */
  previewText: (path?: string) => ipcRenderer.invoke('doc:previewText', path),
  /** Az álnevesített irat LAPKÉPEI (PDF); útvonal nélkül az első betöltött iraté. */
  previewPages: (path?: string) => ipcRenderer.invoke('doc:previewPages', path),
  /** Az ügy álnév-kiosztásának eldobása — a következő elemzés újraosztja. */
  reassignNames: () => ipcRenderer.invoke('doc:reassignNames'),
  /**
   * A RENDSZER TÉMÁJA, és értesítés a változásáról.
   *
   * A program a Windows beállítását követi; saját kapcsoló nincs hozzá. A
   * `figyel` visszatérése leiratkoztat — enélkül minden ablaknyitás új
   * figyelőt hagyna maga után.
   */
  rendszerTema: () => ipcRenderer.invoke('ui:rendszerTema'),
  onTemaValtozott: (cb: (tema: 'vilagos' | 'sotet') => void) => {
    const h = (_e: unknown, tema: 'vilagos' | 'sotet'): void => cb(tema);
    ipcRenderer.on('ui:temaValtozott', h);
    return () => ipcRenderer.removeListener('ui:temaValtozott', h);
  },
  suggestOutputPath: (mode: string) => ipcRenderer.invoke('doc:suggestOutputPath', mode),
  chooseSaveTarget: (suggested: string) => ipcRenderer.invoke('doc:chooseSaveTarget', suggested),
  exportDocument: (opts: unknown) => ipcRenderer.invoke('doc:export', opts),
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItem', path),

  /**
   * A ráhúzott fájl útvonala.
   *
   * Az Electron 32 óta a felület `File` objektuma NEM hordozza az útvonalat —
   * a régi `file.path` mező eltűnt. Enélkül a ráejtett irat nem nyílik meg, a
   * program csendben visszalép a tallózásra, és a felhasználó másodszor is
   * megmutatja ugyanazt a fájlt. Az útvonalat csak itt, a hídon lehet
   * megkérdezni; a felület továbbra sem lát fájlrendszert, csak ezt az egy
   * karakterláncot kapja meg arról a fájlról, amit ő maga húzott be.
   */
  pathForFile: (file: File): string | null => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      // Böngészőből származó vagy virtuális elem: nincs lemezes útvonala.
      return null;
    }
  },

  /** Van-e elveszíthető munka: ettől kérdez rá a bezárás. */
  setDirty: (dirty: boolean) => ipcRenderer.invoke('app:setDirty', dirty),

  /**
   * A NATÍV ABLAKGOMBOK IGAZÍTÁSA a felület állapotához.
   *
   * A felület minden párbeszédnyitásnál és -zárásnál szóljon; a színeket a
   * főfolyamat számolja ki (electron/main.ts, `KERET_SZINEK` és
   * `KERET_FATYOL`). Szándékosan nem a felület küldi a színt: a keretnek a
   * fejléccel EGYÜTT kell mozdulnia, és két helyen tartott színtábla
   * előbb-utóbb elcsúszik.
   *
   * Egymás után nyíló párbeszédeknél nem kell számolgatni: a rövid „nincs
   * párbeszéd” pillanatokat a főfolyamat nyeli el, tehát a gombok nem
   * villannak fel közben.
   */
  ablakkeretetIgazit: (allapot: AblakkeretAllapot) => ipcRenderer.invoke('ui:ablakkeret', allapot),
  appInfo: () => ipcRenderer.invoke('app:info'),
  chooseKeyFile: () => ipcRenderer.invoke('key:choose'),
  readKeyFile: (path: string, passphrase: string) => ipcRenderer.invoke('key:read', path, passphrase),
  print: () => ipcRenderer.invoke('app:print'),
  onMenu: (cb: (action: MenuAction) => void) => {
    const h = (_e: unknown, action: MenuAction): void => cb(action);
    ipcRenderer.on('app:menu', h);
    return () => ipcRenderer.removeListener('app:menu', h);
  },
  /**
   * A BEZÁRÁS MEGERŐSÍTÉSE — a főfolyamat kérdez, a felület válaszol.
   *
   * A kérdést nem a Windows rendszerpárbeszéde teszi fel többé, hanem a
   * program saját ablaka. A bezárás viszont a főfolyamaté marad: a felület
   * csak a választ küldi vissza (`closeDecision`), az ablakot nem ő zárja be.
   *
   * A főfolyamat időzítőt tesz a kérdés mellé: ha a felület a NYUGTÁT sem
   * küldi meg (`closeAsked`), visszaesik a rendszerpárbeszédre, hogy a
   * programból ki lehessen lépni akkor is, ha a lap kifagyott.
   */
  onConfirmClose: (cb: () => void) => {
    const h = (): void => cb();
    ipcRenderer.on('app:confirmClose', h);
    return () => ipcRenderer.removeListener('app:confirmClose', h);
  },
  /**
   * NYUGTA: megkaptam a kérdést, ki is rajzoltam.
   *
   * Ez NEM a válasz — az a `closeDecision`. Ez csak annyit mond, hogy a lap
   * él, és a kérdés ott áll a képernyőn. A főfolyamat ettől állítja le a
   * tartalék-időzítőt: enélkül a rendszerpárbeszéd pár másodperc múlva
   * ráült a saját kérdésünkre, és ugyanazt kérdezte meg másodszor.
   */
  closeAsked: () => ipcRenderer.invoke('app:closeAsked'),
  closeDecision: (valasz: 'save' | 'discard' | 'cancel') =>
    ipcRenderer.invoke('app:closeDecision', valasz),
};

contextBridge.exposeInMainWorld('szivecske', api);

export type SzivecskeApi = typeof api;
