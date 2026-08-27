/**
 * Nyelvi modellek: nyilvántartás, letöltés, törlés.
 *
 * A modell a felismerés MOTORJA: ő olvassa végig az iratot, és ő találja meg a
 * neveket. A szerkezeti minták (lásd `detect.ts`) a szerepet és a megtartandó
 * neveket adják hozzá, és tartalékként szolgálnak, ha a modell nem elérhető.
 *
 * A letöltés az EGYETLEN pont, ahol a program hálózatot használ, és csak akkor,
 * ha a felhasználó a Beállításokban rákattint. Utána örökre offline: a
 * betöltés kifejezetten tiltja a hálózatot (`allowRemoteModels = false`).
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ModelFile {
  /** Elérési út a tárolóban, pl. "onnx/model_quantized.onnx". */
  path: string;
  /** Várható méret bájtban — ebből számoljuk a folyamatjelzőt. */
  bytes: number;
}

export interface ModelSpec {
  id: string;
  name: string;
  /** Hugging Face tároló azonosítója. */
  repo: string;
  license: string;
  /**
   * MI EZ — felépítés, származás, címkék. Tények, nem méltatás.
   *
   * Korábban itt egy `description` és egy `caveat` állt, és a második
   * óhatatlanul arról szólt, amit a modell NEM tud. Egy modellkártyán ennek
   * nincs helye: a felhasználó azt akarja tudni, mi ez és mit csinál, nem azt,
   * mi nem. A korlátokat a szerkezet mondja el helyette — a `languages` mező a
   * nyelvet, a `purpose` a szerepet, a felület pedig aszerint rendez.
   */
  mi: string;
  /** MIT CSINÁL — MÉRT tények. Szám csak akkor kerül ide, ha lemértük. */
  mit: string;
  languages: string[];
  files: ModelFile[];
  /** Milyen címkéket ad, és mi lesz belőlük nálunk. */
  labelMap: Record<string, 'person' | 'org' | 'place' | 'other'>;
  /**
   * MIRE VALÓ a modell — és ez nem címke, hanem elválasztás.
   *
   * 》detect《: felismerő. Ez olvassa végig az iratot, és ez találja meg a
   * neveket. Ilyet lehet a Beállításokban aktívvá tenni.
   * 》namegen《: névkészlet-gyártó. Csak akkor fut, amikor a felhasználó saját
   * témát ír be, és nevekre van szükség hozzá. A KITAKARÁSHOZ SEMMI KÖZE.
   *
   * Azért kell külön mező, mert a kettő ugyanabban a listában lakik (mindkettőt
   * ugyanaz a letöltő hozza le, ugyanoda), a futtatásuk viszont
   * összeegyeztethetetlen: a felismerő út (`getModelClient`, electron/main.ts)
   * `TokenClassifier`-t épít, ami egy szöveggeneráló hálón értelmezhetetlen. Ha
   * a felhasználó véletlenül a gyártót tenné aktívvá, a felismerés nem
   * hibaüzenettel állna meg, hanem üres találatlistával — vagyis a program azt
   * mondaná, hogy nincs név az iratban. Ez a mező az, amiből a felület és a
   * főfolyamat meg tudja akadályozni ezt; lásd `detectionModels()` és
   * `assertDetectionModel()`.
   */
  purpose: 'detect' | 'namegen';
  /** Ajánlott-e ez az alapértelmezett. */
  recommended: boolean;
  /**
   * Melyik futtató viszi. Az 》onnx《 a saját ONNX Runtime-utunk a vendégelt
   * tokenizálóval — ez ad pontos karakterpozíciót. A 》transformers《 a
   * Transformers.js folyamata.
   */
  engine: 'onnx' | 'transformers';
  /**
   * Honnan jön a hálófájl.
   *
   * 》hub《: a tároló maga szállítja, letölthető.
   * 》converted《: a tároló csak PyTorch-súlyt közöl, az ONNX-et építéskor mi
   * állítjuk elő (`scripts/export-nytk.py`), és a programmal együtt adjuk.
   * Ez utóbbi nem kényelmetlenség, hanem következmény: a felhasználó gépén
   * nincs se Python, se PyTorch, és nem is akarunk odatenni.
   */
  source: 'hub' | 'converted';
}

/**
 * A szállított modellek.
 *
 * A listát ellenőrzött adatokból állítottuk össze: a licenc a tároló
 * metaadatából, a méretek a tároló fájllistájából. Csak olyan modell kerülhet
 * ide, ami kereskedelmi termékben is használható (MIT / Apache-2.0 / BSD).
 */
export const MODEL_REGISTRY: ModelSpec[] = [
  {
    id: 'nytk-nerkor-hubert',
    name: 'Magyar névfelismerő (huBERT / NerKor)',
    repo: 'foltin/nerkor-hubert-hungarian-onnx',
    license: 'Apache-2.0',
    mi:
      'huBERT alapú kódoló a Nyelvtudományi Kutatóközponttól, ONNX formátumban. 12 réteg, ' +
      '110 millió paraméter, 32 001 elemű ékezetes szótár. Kilenc címke BIO-jelöléssel: ' +
      'személy, szervezet, hely, egyéb.',
    mit:
      'Megjelöli a tulajdonneveket, karakterpontos pozícióval, és a ragozott alakot egyben ' +
      'adja vissza („Kováccsal”). A környezetből dönt: a „Nagy a kockázat” mondatban a „Nagy” ' +
      'köznév (1,0000), a „Nagy Péter”-ben személynév (0,9993) — ugyanabban az iratban. ' +
      'Mérés a 7 161 karakteres mintaítéleten: 92 találat, 902 ms, 0 elcsúszott pozíció. ' +
      'Szeged NER: 90,2 pont.',
    languages: ['hu'],
    files: [
      { path: 'config.json', bytes: 1186 },
      { path: 'tokenizer_config.json', bytes: 481 },
      { path: 'tokenizer.json', bytes: 775747 },
      { path: 'model.onnx', bytes: 440342356 },
    ],
    labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
    purpose: 'detect',
    recommended: true,
    engine: 'onnx',
    // LETÖLTHETŐ, pedig a súlyok az NYTK tárolójából valók.
    //
    // Az eredeti tároló csak `pytorch_model.bin`-t közöl, futtatható ONNX-et
    // nem, és senki más nem tett közzé belőle exportot. A felhasználó gépén
    // viszont nincs se Python, se PyTorch. Az átalakítást build-időben végezzük
    // (`scripts/export-nytk.py`), az eredményt pedig közzétettük — így a
    // program token nélkül letöltheti, a 440 MB nem terheli a telepítőt, és
    // másnak sem kell ugyanezt megcsinálnia. A licenc (Apache-2.0) a
    // továbbadást feltüntetéssel engedi; a modellkártya megnevezi az NYTK-t.
    source: 'hub',
  },
  {
    id: 'eu-pii-multilang',
    name: 'Európai PII-felismerő (többnyelvű)',
    repo: 'bardsai/eu-pii-anonimization-multilang',
    license: 'Apache-2.0',
    // A leírás CSAK azt ígéri, amit a lenti `labelMap` tényleg átvesz. Korábban
    // összegeket, dátumokat és azonosítókat is ígért, miközben a címketérkép hét
    // NÉV-jellegű címkéből áll: a modell ilyen találatait a program némán
    // eldobta. Az ígéret és a viselkedés eltérése itt nem stílushiba — a
    // felhasználó abban a hitben adta volna ki az iratot, hogy a modell az
    // azonosítókat is megnézte.
    //
    // MÉRT ADAT (samples/itelet.txt első 2500 karaktere, a szállított
    // címketérképpel): 30 átvett találat mellett 30 eldobott — FINANCIAL_AMOUNT
    // 9, PERSON_ROLE_OR_TITLE 7, ORGANIZATION_IDENTIFIER 6, PERSON_IDENTIFIER
    // 3, BANK_ACCOUNT_IDENTIFIER 2, DATE_OF_BIRTH 1, DOCUMENT_IDENTIFIER 1,
    // DOCUMENT_REFERENCE 1. A térkép szándékosan marad név-jellegű: az
    // összeget, a dátumot és a magyar azonosítókat a program saját felismerői
    // (`hu/osszegek.ts`, `hu/datumok.ts`, `hu/azonositok.ts`) találják meg,
    // pontosabban és modell nélkül is. Az eldobás viszont már nem néma: a
    // `TokenClassifier.unmappedLabels` megszámolja, és a jegyzőkönyvbe kerül.
    mi:
      'XLM-RoBERTa alapú kódoló, 24 európai nyelven tanítva, 8 bites ONNX formátumban. ' +
      'Hét címkét vesz át: személynév, álnév, tulajdonnév, szervezet, helyszín, földrajzi ' +
      'hely, postai cím.',
    mit:
      'Megjelöli a tulajdonneveket. A karakterpozíciókat a program állítja helyre, mert a ' +
      'modell nem ad vissza karakterhatárt. Mérés a 7 161 karakteres mintaítéleten: ' +
      '54 találat, 489 ms, 0 elcsúszott pozíció. Ugyanezen a szövegen 44 további találata ' +
      'szerepre, összegre és azonosítóra esett — ezeket a program saját magyar felismerői ' +
      'dolgozzák fel, és a jegyzőkönyv tételesen felsorolja őket.',
    languages: ['hu', 'en', 'de', 'fr', 'it', 'es', 'pl', '+18'],
    files: [
      { path: 'config.json', bytes: 4979 },
      { path: 'tokenizer_config.json', bytes: 314 },
      { path: 'tokenizer.json', bytes: 16781584 },
      { path: 'onnx/model_quantized.onnx', bytes: 278736360 },
    ],
    labelMap: {
      PERSON_NAME: 'person',
      PERSON_ALIAS: 'person',
      PROPER_NAME: 'person',
      ORGANIZATION_NAME: 'org',
      LOCATION: 'place',
      GEO_LOCATION: 'place',
      POSTAL_ADDRESS: 'place',
    },
    purpose: 'detect',
    recommended: false,
    engine: 'transformers',
    source: 'hub',
  },
  {
    /*
      A NÉVKÉSZLET-GYÁRTÓ.

      Ez az EGYETLEN bejegyzés, ami nem olvas iratot. Akkor és csak akkor fut,
      amikor a felhasználó beírja, milyen témájú álneveket szeretne („görög
      mitológia”, „csillagképek”), és javasolt nevekre van szükség hozzá. A
      javaslatból attól még nem lesz készlet: a magyar ragozást a saját motorunk
      adja hozzá, a rossz javaslatot pedig a `src/app/temagyar.ts` dobja ki.

      A LICENC ELLENŐRIZVE, nem emlékezetből: a Hugging Face modell-API
      (`/api/models/onnx-community/Qwen3-4B-Thinking-2507-ONNX`) `cardData.license`
      mezője „apache-2.0”, és a tároló címkéi közt ott a „license:apache-2.0”. Az
      eredeti súly (`Qwen/Qwen3-4B-Thinking-2507`) szintén Apache-2.0. Ez a projekt
      kötött szabályának (MIT / Apache-2.0 / BSD) megfelel.

      MIÉRT EZ, ÉS MIÉRT NEM AZ INSTRUCT VÁLTOZAT: az
      `onnx-community/Qwen3-4B-Instruct-2507-ONNX` tárolónak NINCS licencmezője és
      nincs licenccímkéje. Az eredeti Qwen-súly ugyan Apache-2.0, de a szabály úgy
      szól, hogy a licencet a tároló metaadatából igazoljuk — egy hiányzó mező nem
      igazolás. Ezért az Instruct kimaradt, noha q4-ben nagyobb is (3,96 GB a 2,91
      helyett), és gondolkodó előtag nélkül gyorsabban válaszolna.

      MIÉRT FÉR BELE 16 GB-BA: a `q4` háló súlyai ~2,9 GB-ot foglalnak, a rövid
      kérés-válaszhoz tartozó gyorsítótár ennek töredéke. A `fp16` változat 8,1
      GB, a `q4f16` pedig fél gigával kisebb ugyan, de a lebegőpontos felezett
      számábrázolást a processzoros futtató nem gyorsítja — az WebGPU-ra való.
      Ezért `q4`, és ezért csak a hozzá tartozó három fájl van a listában.
    */
    id: 'qwen3-4b-thinking-namegen',
    name: 'Névkészlet-gyártó (Qwen3-4B Thinking)',
    repo: 'onnx-community/Qwen3-4B-Thinking-2507-ONNX',
    license: 'Apache-2.0',
    mi:
      'Qwen3-4B Thinking, generatív modell ONNX formátumban. Gondolkodó modell: válasz előtt ' +
      'magában végigfut a feladaton. Szerepe a névkészlet-gyártás.',
    mit:
      'A beírt téma alapján („görög mitológia”, „csillagképek”) neveket javasol a saját ' +
      'névkészlethez. A javaslatot a program ragozó motorja veszi át: legyártja mind a 21 ' +
      'esetet, és kidobja azt, ami nem ragozható vagy valódi magyar névvel ütközik. A maradékot ' +
      'a ragozott alakokkal együtt mutatja meg jóváhagyásra. Egy készlet legyártása ' +
      'processzoron percekbe telik.',
    languages: ['hu', 'en', '+100'],
    files: [
      // Méretek a tároló fájllistájából (Hugging Face API, `?blobs=true`).
      { path: 'config.json', bytes: 1886 },
      { path: 'generation_config.json', bytes: 243 },
      { path: 'tokenizer.json', bytes: 9117036 },
      { path: 'tokenizer_config.json', bytes: 4897 },
      { path: 'onnx/model_q4.onnx', bytes: 477178 },
      /*
        A súly nem fér el egy fájlban: a 2 GB-os ONNX-korlát miatt a tároló
        külső adatfájlokba tördeli. A Transformers.js ezt magától megtalálja —
        a tároló `config.json`-jában ott a
        `transformers.js_config.use_external_data_format` térkép, ami kimondja,
        hogy a `model_q4.onnx` két darabból áll. A darabokat viszont NEKÜNK kell
        letöltenünk, ezért szerepelnek itt tételesen: enélkül a modell
        „telepítve” állapotba kerülne egy 477 kB-os vázzal, és csak a betöltésnél
        derülne ki, hogy a súlyok nincsenek meg.
      */
      { path: 'onnx/model_q4.onnx_data', bytes: 2094425088 },
      { path: 'onnx/model_q4.onnx_data_1', bytes: 811786240 },
    ],
    // Üres, és ez nem hiányosság: ez a modell nem címkéz szavakat, hanem szöveget
    // ír. Nincs mit leképezni. A mező azért van kitöltve, mert a nyilvántartás
    // egyetlen közös alakot használ; hogy melyik modell mit csinál, azt a
    // `purpose` mondja meg, nem ez.
    labelMap: {},
    purpose: 'namegen',
    recommended: false,
    engine: 'transformers',
    source: 'hub',
  },
];

/**
 * A FELISMERŐ modellek — csak ezek közül szabad aktívat választani.
 *
 * A Beállítások modell-listája és a főfolyamat modell-kliense ezt a listát
 * kérdezze, ne a teljes nyilvántartást. A letöltési lista viszont maradhat
 * teljes: a névkészlet-gyártót le KELL tudni tölteni, csak aktívvá tenni nem
 * szabad.
 */
export function detectionModels(): ModelSpec[] {
  return MODEL_REGISTRY.filter((m) => m.purpose === 'detect');
}

/** A névkészlet-gyártó, ha van ilyen a nyilvántartásban. */
export function namegenModel(): ModelSpec | undefined {
  return MODEL_REGISTRY.find((m) => m.purpose === 'namegen');
}

/**
 * Megállítja a felismerést, ha valaki nem felismerő modellt akar futtatni.
 *
 * MIÉRT DOB HIBÁT, ÉS MIÉRT NEM VÁLT CSENDBEN A JÓRA: a csendes visszaesés
 * pontosan az a hibafajta, ami ellen ez a program készült. A felhasználó abban
 * a hitben adná ki az iratot, hogy a beállított modell nézte át, közben egy
 * másik — vagy semmi.
 *
 * @throws Error magyar üzenettel, ha a modell nem felismerő
 */
export function assertDetectionModel(spec: ModelSpec): void {
  if (spec.purpose === 'detect') return;
  throw new Error(
    `A(z) „${spec.name}” nem névfelismerő modell, hanem névkészlet-gyártó: iratot nem olvas. ` +
      'Nyisd meg a Beállítások → Nyelvi modellek lapot, és válassz felismerő modellt.',
  );
}

export type ModelState = 'missing' | 'partial' | 'installed';

export interface ModelStatus extends ModelSpec {
  state: ModelState;
  /** Mennyi van meg a lemezen, bájtban. */
  bytesOnDisk: number;
  /** A teljes letöltés mérete. */
  totalBytes: number;
}

export interface DownloadProgress {
  modelId: string;
  /** Éppen melyik fájl. */
  file: string;
  receivedBytes: number;
  totalBytes: number;
  /** 0..1 */
  ratio: number;
  done: boolean;
}

export class ModelStore {
  /**
   * @param root      a felhasználói mappa modelltára — ide töltünk le
   * @param bundled   a programmal szállított modellek gyökere, ha van. A magyar
   *                  modell itt lakik: a tárolója nem közöl futtatható hálót,
   *                  azt építéskor mi állítjuk elő, és a telepítővel adjuk.
   */
  constructor(
    private readonly root: string,
    private readonly bundled?: string,
  ) {
    mkdirSync(root, { recursive: true });
  }

  /** A modelltár gyökere — a futtatónak is ez kell. */
  get dirRoot(): string {
    return this.root;
  }

  /**
   * A modell helye a lemezen: a tároló útvonalát tükrözzük.
   *
   * A szállított modellt előbb a program mellett keressük. A felhasználói mappa
   * mégis elsőbbséget élvez, ha ott is megvan — így egy frissebb vagy javított
   * változat kézzel odamásolható anélkül, hogy a programot újra kellene rakni.
   */
  dirFor(spec: ModelSpec): string {
    const rel = spec.repo.split('/');
    const inUser = join(this.root, ...rel);
    if (existsSync(inUser)) return inUser;
    if (this.bundled) {
      const inBundle = join(this.bundled, ...rel);
      if (existsSync(inBundle)) return inBundle;
    }
    return inUser;
  }

  /** Melyik gyökér alatt találtuk meg — a futtatónak ezt kell megkapnia. */
  rootFor(spec: ModelSpec): string {
    const rel = spec.repo.split('/');
    if (existsSync(join(this.root, ...rel))) return this.root;
    if (this.bundled && existsSync(join(this.bundled, ...rel))) return this.bundled;
    return this.root;
  }

  private fileOnDisk(spec: ModelSpec, f: ModelFile): string {
    return join(this.dirFor(spec), ...f.path.split('/'));
  }

  async list(): Promise<ModelStatus[]> {
    const out: ModelStatus[] = [];
    for (const spec of MODEL_REGISTRY) {
      let bytesOnDisk = 0;
      let present = 0;
      for (const f of spec.files) {
        const p = this.fileOnDisk(spec, f);
        if (!existsSync(p)) continue;
        try {
          const s = await stat(p);
          // A félbehagyott letöltést nem tekintjük meglévőnek.
          if (s.size >= f.bytes * 0.98) present++;
          bytesOnDisk += s.size;
        } catch {
          // olvashatatlan fájl: hiányzónak számít
        }
      }
      const totalBytes = spec.files.reduce((a, f) => a + f.bytes, 0);
      const state: ModelState =
        present === spec.files.length ? 'installed' : present > 0 ? 'partial' : 'missing';
      out.push({ ...spec, state, bytesOnDisk, totalBytes });
    }
    return out;
  }

  /**
   * Letöltés a Hugging Face-ről, fájlonként, folyamatjelzéssel.
   *
   * Szándékosan magunk töltjük le, nem könyvtárra bízzuk: így a felhasználó
   * látja, mi történik, meg tudja szakítani, és a félbemaradt fájl nem
   * hazudja azt, hogy a modell kész.
   */
  async download(
    modelId: string,
    onProgress: (p: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const spec = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!spec) throw new Error(`Ismeretlen modell: ${modelId}`);

    // A magyar modell tárolója csak PyTorch-súlyt közöl, futtatható hálót nem.
    // Azt mi állítjuk elő építéskor, és a programmal együtt adjuk — letölteni
    // tehát nincs mit. Ezt ki kell mondani, mert különben a letöltés a hiányzó
    // fájlon 404-gyel állna meg, és a felhasználó azt hinné, elromlott valami.
    if (spec.source === 'converted') {
      throw new Error(
        `A(z) „${spec.name}" a programmal együtt érkezik, nem kell letölteni. ` +
          'Ha mégis hiányzik, telepítsd újra a programot.',
      );
    }

    const totalBytes = spec.files.reduce((a, f) => a + f.bytes, 0);
    let received = 0;

    for (const f of spec.files) {
      const target = this.fileOnDisk(spec, f);
      if (existsSync(target) && statSync(target).size >= f.bytes * 0.98) {
        received += statSync(target).size;
        onProgress({ modelId, file: f.path, receivedBytes: received, totalBytes, ratio: received / totalBytes, done: false });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });

      const url = `https://huggingface.co/${spec.repo}/resolve/main/${f.path}`;
      const res = await fetch(url, { signal, redirect: 'follow' });
      if (!res.ok || !res.body) {
        throw new Error(`Nem sikerült letölteni: ${f.path} (HTTP ${res.status})`);
      }

      // Ideiglenes névre írunk, és csak a végén nevezzük át — így egy megszakadt
      // letöltés soha nem néz ki késznek.
      const tmp = `${target}.letoltes`;
      const fileStart = received;
      const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
      body.on('data', (chunk: Buffer) => {
        received += chunk.length;
        onProgress({
          modelId,
          file: f.path,
          receivedBytes: received,
          totalBytes,
          ratio: Math.min(1, received / totalBytes),
          done: false,
        });
      });
      await pipeline(body, createWriteStream(tmp));

      const written = statSync(tmp).size;
      // A közölt méret csak becslés; ha nagyon eltér, az hiba.
      if (f.bytes > 1000 && written < f.bytes * 0.5) {
        rmSync(tmp, { force: true });
        throw new Error(`Hiányos letöltés: ${f.path} (${written} bájt a várt ${f.bytes} helyett)`);
      }
      received = fileStart + written;
      const { rename } = await import('node:fs/promises');
      await rename(tmp, target);
    }

    onProgress({ modelId, file: '', receivedBytes: totalBytes, totalBytes, ratio: 1, done: true });
  }

  async remove(modelId: string): Promise<void> {
    const spec = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!spec) return;
    rmSync(this.dirFor(spec), { recursive: true, force: true });
  }

  /** A modelltár teljes mérete — a Beállításokban megmutatjuk. */
  async diskUsage(): Promise<number> {
    let total = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          try {
            total += (await stat(p)).size;
          } catch {
            // átugorjuk
          }
        }
      }
    };
    await walk(this.root);
    return total;
  }
}

/* ------------------------------------------------------------------ *
 *  A SZÁLLÍTOTT MODELL ÉPSÉGE
 * ------------------------------------------------------------------ */

/** A szállított modell mellé tett ellenőrzőösszeg-fájl neve. */
export const CHECKSUM_FILE = 'SHA256SUMS.json';

export interface ChecksumVerdict {
  /** Volt-e mihez hasonlítani: a modell mellett van-e ellenőrzőösszeg-fájl. */
  available: boolean;
  /** Hány fájlt hasonlítottunk össze ténylegesen. */
  checked: number;
  /** Mennyi ideig tartott, ezredmásodpercben — a mérés a naplóba való. */
  ms: number;
}

/**
 * Egy folyamaton belüli gyorsítótár: (fájlnév, méret, módosítás) → verdikt.
 *
 * A háló 440 MB, a végigolvasása másodperces nagyságrend. Egyszer meg kell
 * csinálni — de csak egyszer: ha ugyanaz a folyamat többször tölt be, a
 * második alkalommal már nem olvassuk végig újra. A kulcsban a méret és a
 * módosítás ideje is benne van, tehát egy kicserélt fájl NEM kapja meg a régi
 * verdiktet.
 */
const checksumCache = new Map<string, ChecksumVerdict>();

interface ChecksumEntry {
  sha256: string;
  bytes: number;
}

/**
 * A szállított modell fájljainak ELLENŐRZÉSE a mellé tett SHA256SUMS.json
 * alapján.
 *
 * MIÉRT KELL: a háló egyetlen 440 MB-os fájl. Ha a másolás félbeszakad, a
 * lemez hibázik, vagy a víruskereső belenyúl, a betöltés attól még sikerülhet
 * — az ONNX Runtime nem tudja, milyennek KELLENE lennie a súlyoknak. A modell
 * ilyenkor nem elszáll, hanem CSENDBEN rosszabb eredményt ad: kihagy neveket.
 * Egy kitakaró programban a kimaradt név kiszivárgott személyazonosság, ezért
 * itt megállunk, ahelyett hogy egy ismeretlen állapotú hálóval dolgoznánk.
 *
 * Amit NEM csinálunk: nem követeljük meg az ellenőrzőösszeg-fájlt. A letöltött
 * modellek mellett nincs ilyen (a tároló nem közöl), és a hiánya nem
 * bizonyíték sérülésre. Ilyenkor `available: false` a válasz, és a betöltés
 * megy tovább.
 *
 * @throws Error magyar üzenettel, ha egy fájl mérete vagy összege eltér
 */
export async function verifyModelChecksums(dir: string): Promise<ChecksumVerdict> {
  const sumsPath = join(dir, CHECKSUM_FILE);
  if (!existsSync(sumsPath)) return { available: false, checked: 0, ms: 0 };

  let sums: Record<string, ChecksumEntry>;
  try {
    sums = JSON.parse(readFileSync(sumsPath, 'utf8')) as Record<string, ChecksumEntry>;
  } catch {
    // Olvashatatlan összegfájl: ez magában nem a modell sérülése, és nem
    // akadályozhatja meg a munkát. Ellenőrizni viszont nincs mihez képest.
    return { available: false, checked: 0, ms: 0 };
  }

  const t0 = Date.now();
  const present: { name: string; path: string; entry: ChecksumEntry; size: number; mtimeMs: number }[] = [];
  for (const [name, entry] of Object.entries(sums)) {
    if (!entry || typeof entry.sha256 !== 'string') continue;
    const path = join(dir, ...name.split('/'));
    if (!existsSync(path)) continue; // hiányzó fájl: a telepítettség kérdése, nem az épségé
    const st = statSync(path);
    present.push({ name, path, entry, size: st.size, mtimeMs: st.mtimeMs });
  }
  if (present.length === 0) return { available: true, checked: 0, ms: 0 };

  const cacheKey = present.map((f) => `${f.path}|${f.size}|${f.mtimeMs}`).join('\n');
  const cached = checksumCache.get(cacheKey);
  if (cached) return cached;

  for (const f of present) {
    // A méret előbb: ez ingyen van, és a félbemásolt fájl itt már elbukik.
    if (typeof f.entry.bytes === 'number' && f.size !== f.entry.bytes) {
      throw new Error(csonkaFajlUzenet(f.name, f.size, f.entry.bytes));
    }
    const actual = await sha256File(f.path);
    if (actual !== f.entry.sha256.toLowerCase()) {
      throw new Error(serultFajlUzenet(f.name));
    }
  }

  const verdict: ChecksumVerdict = { available: true, checked: present.length, ms: Date.now() - t0 };
  checksumCache.set(cacheKey, verdict);
  return verdict;
}

function csonkaFajlUzenet(name: string, size: number, expected: number): string {
  /*
    A KEREKÍTETT MÉRET ÖNMAGÁBAN NEM ELÉG.

    A `formatBytes` egy tizedesjegyre kerekít, a hiány viszont lehet néhány
    kilobájt: egy 4 kB-bal rövidebb 440 MB-os hálóra a mondat úgy szólt, hogy
    „419.9 MB van meg a várt 419.9 MB helyett" — a felhasználó ugyanazt a két
    számot látta, és a mondat semmit nem árult el. Ezért a pontos bájtszám is
    benne van, és külön kimondjuk, MENNYI hiányzik (vagy mennyivel több).
  */
  const kulonbseg = expected - size;
  const eltero =
    kulonbseg > 0
      ? `${formatBytes(kulonbseg)} hiányzik a végéről`
      : `${formatBytes(-kulonbseg)}-tal több, mint amennyinek lennie kellene`;
  return (
    `A nyelvi modell „${basename(name)}" fájlja nem teljes: ${bajtokkal(size)} van meg a várt ` +
    `${bajtokkal(expected)} helyett — ${eltero}. A másolás valószínűleg félbeszakadt. Egy hiányos ` +
    'hálóval a felismerés csendben rosszabb lenne — kihagyna neveket —, ezért nem dolgozunk vele. ' +
    'Telepítsd újra a programot.'
  );
}

/** Kerekített méret ÉS pontos bájtszám: a kettő közül külön-külön egyik sem elég. */
function bajtokkal(n: number): string {
  if (n < 1024) return formatBytes(n);
  return `${formatBytes(n)} (${n.toLocaleString('hu-HU')} bájt)`;
}

function serultFajlUzenet(name: string): string {
  return (
    `A nyelvi modell „${basename(name)}" fájlja SÉRÜLT: az ellenőrzőösszege nem egyezik azzal, ` +
    'amit a programmal együtt szállítottunk. Egy sérült hálóval a felismerés csendben rosszul ' +
    'működne — kihagyna neveket —, ezért nem dolgozunk vele. Telepítsd újra a programot.'
  );
}

/** Egy fájl SHA-256 összege, folyamként — a 440 MB-os hálót nem olvassuk memóriába. */
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  // Nagyobb darabok: a lemezolvasás így kevesebb rendszerhívásból áll, és a
  // 440 MB-os fájl végigolvasása másodperc alatt megvan.
  await pipeline(createReadStream(path, { highWaterMark: 4 * 1024 * 1024 }), hash);
  return hash.digest('hex').toLowerCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
