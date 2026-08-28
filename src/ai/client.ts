/**
 * A modell-folyamat kliense.
 *
 * Elindítja, kérdez tőle, és — ez a fontos — el is engedi. A modell csak addig
 * él, amíg dolgozunk vele; utána a folyamat kilép, és a memória visszakerül a
 * géphez. Ha a modell nincs letöltve vagy elszáll, a program attól még működik:
 * a hívó `null`-t kap, és megy tovább a szabályalapú felismeréssel.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ExtractedEntity, ExtractorInfo } from './types.js';
import type { AblakHaladas, LoadConfig, WorkerRequest, WorkerResponse } from './worker.js';

export type { AblakHaladas };

/**
 * A MEGSZAKÍTÁS HIBÁJA — egyetlen helyen megfogalmazva.
 *
 * A név szándékosan `AbortError`: a főfolyamat `megszakitas()` segédfüggvénye
 * (electron/main.ts) ezt keresi, ugyanaz, amelyik a modell letöltésének
 * lemondását ismeri fel. Így a felhasználó szándékos leállítása ugyanazon az
 * ágon megy tovább, mint a letöltésé — vagyis NEM piros hibadobozként jelenik
 * meg. Ha itt egy hétköznapi `Error` állna, a megszakítás hibaüzenetként
 * csapódna ki a felületen, és a felhasználó azt hinné, elromlott valami.
 */
export function megszakitasHiba(): Error {
  const e = new Error('A vizsgálatot megszakítottuk.');
  e.name = 'AbortError';
  return e;
}

export interface ModelClientOptions {
  /** A lefordított munkafolyamat-fájl helye. */
  workerPath: string;
  config: LoadConfig;
  /** Ennyi ideig várunk egy válaszra, utána feladjuk. */
  timeoutMs?: number;
  /**
   * HÁNY SZÁLON SZÁMOLHAT A MODELL. Alapból kettőn.
   *
   * A felismerő modell (110M paraméter) a háttérben fut, MIKÖZBEN a felhasználó
   * az iratot nézi — ott a két szál tudatos önmérséklet: a gép maradjon
   * használható. A névkészlet-gyártó (4 milliárd paraméter) viszont pont
   * fordítva működik: a felhasználó beírja a témát, és semmi mást nem tud
   * csinálni, amíg a készlet el nem készül.
   *
   * MÉRVE ezen a gépen (20 szál), ugyanazzal a rövid kérdéssel: két szálon 0,86
   * token/másodperc, hat, tíz és tizennyolc szálon egyaránt 4,3 — ÖTSZÖRÖS
   * különbség, és a kettőn felül a szálszám már nem számít. (A gyártás valódi,
   * hosszú kérésén ugyanez 1,4 token/másodperc: ott a szövegkörnyezet hossza a
   * szűk keresztmetszet, nem a szálak száma.)
   *
   * Ez nem hangolási finomság: ezen múlik, hogy a funkció használható-e.
   */
  szalak?: number;
  /**
   * Hol tart a modell az iraton belül.
   *
   * A hosszú irat átolvasása percekbe telhet, és eddig ez alatt SEMMI nem
   * látszott: a felhasználó egy mozdulatlan képernyőt nézett, és a leggyakoribb
   * reakciója az volt, hogy kilőtte a programot. A futtató folyamat ablakonként
   * dolgozik, tehát van mit számolni — ez a visszahívás viszi ki a felületig.
   */
  onProgress?: (h: AblakHaladas) => void;
  /**
   * Hol tart a SZÖVEGÍRÁS — a névkészlet-gyártáshoz.
   *
   * Ugyanaz a gond, mint a hosszú iratnál, csak rosszabb: egy csoport
   * legyártása processzoron percekbe telik, és eddig ez alatt semmi nem
   * látszott. A `kesz`/`keret` szavakban értendő, nem tokenekben — a
   * folyamatjelzőnek ez épp elég, és nem állítunk vele többet, mint amit
   * tudunk.
   */
  onGenProgress?: (h: { kesz: number; keret: number }) => void;
}

export class ModelClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; ujraIndit: () => void }
  >();
  private info: ExtractorInfo | null = null;

  constructor(private readonly opts: ModelClientOptions) {}

  get loadedInfo(): ExtractorInfo | null {
    return this.info;
  }

  get running(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /**
   * A folyamat állapotának eldobása, a függőben lévő kérésekkel együtt.
   *
   * Külön metódus, mert HÁROM helyről kell: a folyamat magától kilépett,
   * hibázott, vagy mi lőttük ki (`cancel`). Mindhárom esetben ugyanaz a teendő,
   * csak a hívónak átadott hiba más.
   */
  private elenged(hiba: Error): void {
    for (const [, p] of this.pending) p.reject(hiba);
    this.pending.clear();
    this.child = null;
    this.info = null;
  }

  private start(): ChildProcess {
    if (this.child && !this.child.killed) return this.child;
    if (!existsSync(this.opts.workerPath)) {
      throw new Error(`Hiányzik a modell-folyamat: ${this.opts.workerPath}`);
    }
    const szalak = String(Math.max(1, Math.floor(this.opts.szalak ?? 2)));
    const child = fork(this.opts.workerPath, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      // A modell számítási szálai ne éheztessék ki a felületet — lásd `szalak`.
      env: { ...process.env, OMP_NUM_THREADS: szalak, ORT_NUM_THREADS: szalak },
    });

    child.on('message', (msg: WorkerResponse) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      /*
        A HALADÁS NEM VÁLASZ: a kérés függőben marad utána.

        Ha itt is törölnénk a bejegyzést, az első ablak jelentése után a
        tényleges eredmény már senkihez nem találna vissza — a felismerés némán
        kifutna az időből. Az órát viszont újraindítjuk: az időkorlát arra való,
        hogy a BEFAGYOTT modellt kilőjük, nem arra, hogy a hosszú iratot
        megbüntessük. Amíg jönnek az ablakjelentések, a modell bizonyítottan
        dolgozik.
      */
      if (msg.type === 'progress') {
        p.ujraIndit();
        this.opts.onProgress?.({ ablak: msg.ablak, ablakok: msg.ablakok });
        return;
      }
      // A szövegírás haladása UGYANÍGY közbenső: az óra újraindul, a kérés
      // nyitva marad. Ha ez kimaradna, egy lassú gépen a saját időkorlátunk
      // lőné ki a modellt, miközben az rendben dolgozik.
      if (msg.type === 'gen') {
        p.ujraIndit();
        this.opts.onGenProgress?.({ kesz: msg.kesz, keret: msg.keret });
        return;
      }
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    });

    /*
      CSAK A MOST KILÉPETT folyamat állapotát dobjuk el.

      A megszakítás után a felhasználó azonnal indíthat új vizsgálatot, és a
      kilőtt folyamat 'exit' eseménye ilyenkor KÉSŐBB érkezik, mint az új
      folyamat indulása. Enélkül az összehasonlítás nélkül a régi folyamat
      halála nullázná ki az újat, és a friss vizsgálat rögtön el is szállna.
    */
    const vege = (hiba: Error): void => {
      if (this.child !== child) return;
      this.elenged(hiba);
    };
    child.on('exit', (code) => vege(new Error(`A modell-folyamat leállt (kód: ${code}).`)));
    child.on('error', (e) => vege(new Error(`A modell-folyamat hibája: ${e.message}`)));

    this.child = child;
    return child;
  }

  /** `Omit` egy unióra nem működik jól, ezért tagonként vesszük ki az azonosítót. */
  private request(
    req:
      | Omit<Extract<WorkerRequest, { type: 'load' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'extract' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'generate' }>, 'id'>
      | Omit<Extract<WorkerRequest, { type: 'dispose' }>, 'id'>,
  ): Promise<WorkerResponse> {
    const child = this.start();
    const id = this.nextId++;
    const full = { ...req, id } as WorkerRequest;

    return new Promise<WorkerResponse>((resolve, reject) => {
      let ora: ReturnType<typeof setTimeout> | null = null;
      const oratIndit = (): void => {
        ora = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('A modell nem válaszolt időben.'));
        }, this.opts.timeoutMs ?? 180_000);
      };
      const oratLeall = (): void => {
        if (ora !== null) clearTimeout(ora);
        ora = null;
      };
      oratIndit();

      this.pending.set(id, {
        resolve: (r) => {
          oratLeall();
          resolve(r);
        },
        reject: (e) => {
          oratLeall();
          reject(e);
        },
        ujraIndit: () => {
          oratLeall();
          oratIndit();
        },
      });
      child.send(full);
    });
  }

  async load(): Promise<ExtractorInfo> {
    const r = await this.request({ type: 'load', config: this.opts.config });
    if (r.type !== 'loaded') throw new Error('Váratlan válasz a modelltől.');
    this.info = r.info;
    return r.info;
  }

  /**
   * @returns az entitások, a futásidő, és — ami eddig kiesett — hogy hány
   * találatot NEM tudtunk értelmezni, nyers címke szerint. A hívónak ezt a
   * `ModelStatus.unmappedByLabel` mezőbe kell tennie, hogy a jegyzőkönyvbe és
   * a felületre is kijusson.
   */
  async extract(
    text: string,
    minScore?: number,
  ): Promise<{ entities: ExtractedEntity[]; ms: number; unmapped: Record<string, number> }> {
    if (!this.info) await this.load();
    const r = await this.request({ type: 'extract', text, minScore });
    if (r.type !== 'entities') throw new Error('Váratlan válasz a modelltől.');
    return { entities: r.entities, ms: r.ms, unmapped: r.unmapped ?? {} };
  }

  /**
   * SZÖVEG ÍRATÁSA a modellel — a névkészlet-gyártás egyetlen kérése.
   *
   * Nem a felismerő úton van: ez a hívás iratot nem lát, és a felismerő
   * modellek nem is tudják teljesíteni. Amelyik modell nem szöveggyártónak
   * indult (`task: 'generate'`), annál a folyamat magyarul megmondja, hogy
   * nincs betöltve gyártó — nem néma üres választ ad.
   *
   * @param kerdes a modellnek szóló kérés (`temagyar.ts` állítja össze)
   * @returns a modell válasza a gondolatmenettel együtt; a levágást a
   *          `olvasdAJavaslatot` végzi
   */
  async generate(
    kerdes: string,
    opts: { maxNewTokens?: number; thinkBudget?: number } = {},
  ): Promise<string> {
    if (!this.info) await this.load();
    const r = await this.request({
      type: 'generate',
      prompt: kerdes,
      ...(opts.maxNewTokens !== undefined ? { maxNewTokens: opts.maxNewTokens } : {}),
      ...(opts.thinkBudget !== undefined ? { thinkBudget: opts.thinkBudget } : {}),
    });
    if (r.type !== 'text') throw new Error('Váratlan válasz a modelltől.');
    return r.text;
  }

  /**
   * A FUTÓ MUNKA FÉLBESZAKÍTÁSA — a folyamat elengedésével.
   *
   * Nincs más megbízható mód. A modell egyetlen `session.run()` hívásban, natív
   * kódban tölti az idő nagy részét: oda nem lehet „állj” jelzést küldeni, és a
   * folyamat saját üzenetkezelője sem jut szóhoz, amíg az a hívás tart. A
   * folyamat kilövése viszont AZONNAL hat, és mellékesen a modell ~650 MB-ját is
   * visszaadja a gépnek — épp azt, amiért külön folyamatban fut (`worker.ts`).
   *
   * A hívó ugyanúgy használható marad utána: a következő kérés új folyamatot
   * indít (`start`), tehát a vizsgálat újraindítható. Ez NEM a `dispose`
   * párja — az megvárja, hogy a modell rendben elköszönjön; ide viszont épp
   * azért jutottunk, mert a felhasználó nem akar tovább várni.
   *
   * @returns volt-e egyáltalán mit leállítani
   */
  cancel(): boolean {
    const child = this.child;
    if (!child) return false;
    // A sorrend számít: előbb elfelejtjük a folyamatot, csak utána lőjük ki.
    // Így a később megérkező 'exit' esemény már nem a mi állapotunkra vonatkozik
    // (lásd `vege`), és nem nullázza ki egy időközben indult új vizsgálatot.
    this.elenged(megszakitasHiba());
    if (!child.killed) child.kill();
    return true;
  }

  /** A modell elengedése: a folyamat kilép, a memória visszakerül. */
  async dispose(): Promise<void> {
    if (!this.child || this.child.killed) return;
    try {
      await this.request({ type: 'dispose' });
    } catch {
      // Ha nem válaszol, kilőjük.
    }
    this.child?.kill();
    this.child = null;
    this.info = null;
  }
}
