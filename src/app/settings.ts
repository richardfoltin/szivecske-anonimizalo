/**
 * Beállítások: egyetlen JSON a felhasználói mappában.
 *
 * Csak olyasmi kerül ide, amit a felhasználó tényleg eldönthet. Ami a helyes
 * működéshez kell (ellenőrző kör, változáskövetés-kapu, valódi betűtörlés),
 * az nem beállítás, mert azt nem szabad kikapcsolni.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ReplacementMode } from './types.js';

export interface Settings {
  /** Alapértelmezett névkészlet. */
  themeId: string;
  /** Alapértelmezett csere-mód. */
  mode: ReplacementMode;
  /** Készüljön-e alapból visszafejtő kulcsfájl. */
  keepKey: boolean;
  /** Fusson-e a felek automatikus felismerése megnyitáskor. */
  autoDetect: boolean;
  /**
   * Fusson-e a nyelvi modell is a szerkezeti felismerés után. Csak akkor van
   * hatása, ha a modell le van töltve.
   */
  useModel: boolean;
  /** Melyik modellt használjuk. */
  modelId: string;
  /**
   * E fölött cserélünk automatikusan. Alacsonyabb érték = több automatikus
   * csere, de több hibalehetőség; magasabb = több kézi átnézés.
   */
  autoThreshold: number;
  /** Az összegek átírása. Alapból NEM, mert szétveri a végösszegeket. */
  replaceAmounts: boolean;
  /** A dátumok egységes eltolása ügyenként. */
  shiftDates: boolean;
  /**
   * „Csak csináld": a program EGYETLEN kérdés nélkül megy végig a munkán —
   * megnyitás → felismerés → csere → mentés.
   *
   * Nem a Felek-párbeszéd elrejtéséről szól, hanem arról, hogy nem kell
   * végigdönteni a bizonytalan találatokat: az átnézésre várókat a program is
   * elfogadja (`AnalyzeInput.acceptReview`). A mérés szerint ez visz 35
   * bennmaradt névről 1-re, 4 fölösleges csere áráért.
   *
   * Amit NEM kapcsol ki: az ellenőrző kört. Ha a kész fájlban eredeti adat
   * marad, automatikus módban SEM keletkezik fájl. Ez a mód a kérdezést hagyja
   * el, nem a biztonságot.
   */
  autoMode: boolean;
  /**
   * A CÍMKÉK NYELVE a szerep-, adatfajta- és számozott módban.
   *
   * A fedőnév-módra nincs hatása: ott a névkészlet dönti el, milyen nyelvűek a
   * nevek. A felületen a három címkés mód kártyáján áll a nyelvkapcsoló,
   * ugyanúgy, mint a névkészletekén.
   */
  labelLang: 'hu' | 'en';
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: 'kokorszak',
  mode: 'theme',
  keepKey: true,
  autoDetect: true,
  useModel: true,
  // A magyar modell az alapértelmezés: magyar iraton mérve ez a legpontosabb,
  // és nagyságrenddel gyorsabb a többinél. Angol irathoz a Beállításokban
  // átváltható a többnyelvűre.
  modelId: 'nytk-nerkor-hubert',
  autoThreshold: 0.8,
  replaceAmounts: false,
  shiftDates: false,
  // ALAPBÓL BE. A méréssel eldöntött kérdés: az óvatoskodás okozza a szivárgás
  // nagy részét, nem az emberi döntés hiánya. Aki mégis végig akar dönteni
  // minden bizonytalan találatot, a Beállításokban kikapcsolhatja — de az
  // alapértelmezés az, ami átlagosan kevesebb nevet hagy bent az iratban.
  autoMode: true,
  labelLang: 'hu',
};

export class SettingsStore {
  private current: Settings;

  constructor(private readonly path: string) {
    this.current = { ...DEFAULT_SETTINGS };
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Settings>;
      // Ismeretlen kulcsokat eldobunk, hiányzókat alapértelmezéssel pótolunk:
      // egy régi vagy sérült beállításfájl nem akaszthatja meg a programot.
      this.current = { ...DEFAULT_SETTINGS, ...pick(raw) };
    } catch {
      this.current = { ...DEFAULT_SETTINGS };
    }
  }

  get(): Settings {
    return { ...this.current };
  }

  set(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...pick(patch) };
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.current, null, 1), 'utf8');
    return this.get();
  }
}

function pick(raw: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof raw.themeId === 'string') out.themeId = raw.themeId;
  if (raw.mode === 'theme' || raw.mode === 'role' || raw.mode === 'type' || raw.mode === 'numbered') {
    out.mode = raw.mode;
  }
  if (typeof raw.keepKey === 'boolean') out.keepKey = raw.keepKey;
  if (typeof raw.autoDetect === 'boolean') out.autoDetect = raw.autoDetect;
  if (typeof raw.useModel === 'boolean') out.useModel = raw.useModel;
  if (typeof raw.modelId === 'string') out.modelId = raw.modelId;
  if (typeof raw.autoThreshold === 'number' && raw.autoThreshold >= 0.5 && raw.autoThreshold <= 1) {
    out.autoThreshold = raw.autoThreshold;
  }
  if (typeof raw.replaceAmounts === 'boolean') out.replaceAmounts = raw.replaceAmounts;
  if (typeof raw.shiftDates === 'boolean') out.shiftDates = raw.shiftDates;
  if (typeof raw.autoMode === 'boolean') out.autoMode = raw.autoMode;
  if (raw.labelLang === 'hu' || raw.labelLang === 'en') out.labelLang = raw.labelLang;
  return out;
}
