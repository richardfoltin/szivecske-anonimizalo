/**
 * A modell KÜLÖN FOLYAMATBAN fut.
 *
 * Mérés szerint a modell csúcson ~650 MB memóriát tart. Ha ez a főfolyamatban
 * lenne, egy 16 GB-os laptopon a program a Word és a böngésző mellett elkezdene
 * lapozni, és a felhasználó azt látná, hogy „lassú". Külön folyamatban viszont
 * a memória a modellel együtt eltűnik, amint már nincs rá szükség.
 *
 * A folyamat semmit nem ír lemezre és nem nyit hálózatot: szöveget kap,
 * entitásokat ad vissza.
 */

import type { EntityExtractor, ExtractOptions, ExtractedEntity, ExtractorInfo } from './types.js';
import { TokenClassifier, type TokenClassifierConfig } from './tokenClassifier.js';
import { HubertNer } from './hubertNer.js';
import { TextGenerator } from './generator.js';

/**
 * Melyik futtatóval megy a modell.
 *
 * 》onnx《: saját ONNX Runtime-futtatás a vendégelt tokenizálóval. A
 * karakterpozíciót közvetlenül a tokenizálás adja, nem visszaállított becslés.
 * Magyar modellhez ez kell.
 *
 * 》transformers《: a Transformers.js folyamata. Több tárolóformátumot elfogad,
 * de pozíciót nem ad — azt utólag kell helyreállítani.
 */
export type EngineKind = 'onnx' | 'transformers';

/**
 * MIT CSINÁL EZ A MODELL: címkéz vagy ír.
 *
 * Nem elhagyható részlet: a két útnak MÁS a betöltője (`TokenClassifier` és
 * `HubertNer` szemben a `TextGenerator`-ral), és más a kérése is. Enélkül a
 * futtató a tároló nevéből találgatna — a névkészlet-gyártót pedig épp az
 * választja el a felismerőktől, hogy iratot soha nem lát.
 */
export type ModelTask = 'ner' | 'generate';

export type LoadConfig = TokenClassifierConfig & {
  engine?: EngineKind;
  fileName?: string;
  task?: ModelTask;
};

/**
 * A haladás típusa a KÖZÖS felülettől jön (src/ai/types.ts), és innen csak
 * továbbadjuk — a `client.ts` és a főfolyamat innen importálja.
 *
 * Korábban itt állt egy saját `HaladoExtractOptions` azzal az indoklással, hogy
 * a visszajelzés a folyamat belügye. Ez tévedés volt: a felület a KÖZÖS
 * felületen át kapja a modellt, és egy folyamatjelző, ami csak az egyik
 * futtatónál működik, rosszabb a semminél — a felhasználó nem tudja, mikor
 * higgyen neki. Amelyik futtató nem tud ablakokban gondolkodni, az egyszerűen
 * nem hívja meg a függvényt.
 */
export type { AblakHaladas } from './types.js';

export type WorkerRequest =
  | { type: 'load'; id: number; config: LoadConfig }
  | { type: 'extract'; id: number; text: string; minScore?: number }
  /**
   * SZÖVEGKÉRÉS — csak a névkészlet-gyártó ismeri.
   *
   * Ugyanaz a folyamat, másik kérésfajta: a modellt külön folyamatban futtatni
   * ugyanúgy kell (a gyártó háló 2,9 GB), és a megszakítás is ugyanúgy a
   * folyamat elengedésével megy.
   */
  | { type: 'generate'; id: number; prompt: string; maxNewTokens?: number; thinkBudget?: number }
  | { type: 'dispose'; id: number };

export type WorkerResponse =
  | { type: 'loaded'; id: number; info: ExtractorInfo }
  | {
      type: 'entities';
      id: number;
      entities: ExtractedEntity[];
      ms: number;
      /**
       * Amit a modell talált, de a címketérképünk nem ismert — nyers címke
       * szerint. Enélkül a számláló megvan a futtatóban, és soha nem jut ki
       * belőle: a program pont arról hallgatna, amit nem értett.
       */
      unmapped?: Record<string, number>;
    }
  /**
   * KÖZBENSŐ üzenet: a kérés ettől még nyitva marad.
   *
   * Ugyanazt az azonosítót viseli, mint a kérés, amihez tartozik — a kliens
   * ebből tudja, melyik várakozó hívás óráját kell újraindítania. Ha ez
   * végleges válasznak számítana, az első ablakjelentés után a tényleges
   * eredmény már nem találna vissza a hívóhoz.
   */
  | { type: 'progress'; id: number; ablak: number; ablakok: number }
  | { type: 'text'; id: number; text: string; ms: number }
  /**
   * KÖZBENSŐ üzenet a szövegíráshoz — a `progress` párja.
   *
   * Ugyanúgy nyitva hagyja a kérést, és ugyanúgy újraindítja a hívó óráját.
   * Külön fajta, mert mást számol: itt nincsenek ablakok, hanem szavak.
   */
  | { type: 'gen'; id: number; kesz: number; keret: number }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; message: string };

interface Installable extends EntityExtractor {
  isInstalled(): boolean;
  /** Mindkét futtató vezeti; a felület és a jegyzőkönyv ezt írja ki. */
  readonly unmappedLabels?: Record<string, number>;
}

let extractor: Installable | null = null;
let generator: TextGenerator | null = null;

function buildExtractor(cfg: LoadConfig): Installable {
  if (cfg.engine === 'onnx') {
    return new HubertNer({
      modelId: cfg.modelId,
      repo: cfg.repo,
      cacheDir: cfg.cacheDir,
      labelMap: cfg.labelMap,
      fileName: cfg.fileName,
    });
  }
  return new TokenClassifier(cfg);
}

function send(msg: WorkerResponse): void {
  process.send?.(msg);
}

process.on('message', (raw: WorkerRequest) => {
  void handle(raw).catch((e: unknown) => {
    send({ type: 'error', id: raw.id, message: e instanceof Error ? e.message : String(e) });
  });
});

async function handle(req: WorkerRequest): Promise<void> {
  if (req.type === 'load') {
    /*
      A SZÖVEGÍRÓ ÚT ITT VÁLIK EL, a betöltésnél.

      Nem duplikáció: a két modellfajta ugyanabban a folyamatban fut (ugyanaz a
      memóriaszempont, ugyanaz a megszakítás), de a betöltőjük és a kérésük más.
      A `task` a nyilvántartásból jön (`purpose: 'namegen'`), tehát nem a
      futtató találgat a tároló nevéből.
    */
    if (req.config.task === 'generate') {
      generator = new TextGenerator({
        modelId: req.config.modelId,
        repo: req.config.repo,
        cacheDir: req.config.cacheDir,
        ...(req.config.dtype ? { dtype: req.config.dtype } : {}),
      });
      if (!generator.isInstalled()) {
        throw new Error('A modell nincs letöltve. Nyisd meg a Beállítások → Nyelvi modellek lapot.');
      }
      const genInfo = await generator.load();
      send({ type: 'loaded', id: req.id, info: genInfo });
      return;
    }

    extractor = buildExtractor(req.config);
    if (!extractor.isInstalled()) {
      throw new Error('A modell nincs letöltve. Nyisd meg a Beállítások → Nyelvi modellek lapot.');
    }
    const info = await extractor.load();
    send({ type: 'loaded', id: req.id, info });
    return;
  }

  if (req.type === 'extract') {
    if (!extractor) throw new Error('A modell nincs betöltve.');
    const t0 = Date.now();
    /*
      Az `onWindow` mostantól a KÖZÖS `ExtractOptions` mezője, tehát nem kell
      trükközni vele. Amelyik futtató nem tud ablakokban gondolkodni, az
      egyszerűen nem hívja meg — a felület olyankor a szakasz nevét mutatja
      arány nélkül. Ez becsületesebb, mint egy kitalált százalék.
    */
    const opts: ExtractOptions = {
      minScore: req.minScore,
      onWindow: (h) => send({ type: 'progress', id: req.id, ablak: h.ablak, ablakok: h.ablakok }),
    };
    const entities = await extractor.extract(req.text, opts);
    send({
      type: 'entities',
      id: req.id,
      entities,
      ms: Date.now() - t0,
      unmapped: extractor.unmappedLabels ?? {},
    });
    return;
  }

  if (req.type === 'generate') {
    if (!generator) throw new Error('A szöveggyártó modell nincs betöltve.');
    const t0 = Date.now();
    const text = await generator.generate(req.prompt, {
      ...(req.maxNewTokens !== undefined ? { maxNewTokens: req.maxNewTokens } : {}),
      ...(req.thinkBudget !== undefined ? { thinkBudget: req.thinkBudget } : {}),
      onToken: (kesz, keret) => send({ type: 'gen', id: req.id, kesz, keret }),
    });
    send({ type: 'text', id: req.id, text, ms: Date.now() - t0 });
    return;
  }

  if (req.type === 'dispose') {
    await extractor?.dispose();
    await generator?.dispose();
    extractor = null;
    generator = null;
    send({ type: 'disposed', id: req.id });
    // A memória csak a folyamat kilépésével adódik vissza teljesen.
    setTimeout(() => process.exit(0), 50);
  }
}

// Ha a szülő elengedi, nem maradunk életben árván.
process.on('disconnect', () => process.exit(0));
