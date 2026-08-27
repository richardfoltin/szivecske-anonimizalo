/**
 * Magyar NER-modell futtatása ONNX Runtime-mal, közvetlenül.
 *
 * Miért nem a Transformers.js: a token-osztályozó folyamata nem ad vissza
 * karakterpozíciót (a forrásában ott a nyitott TODO, és a javító beolvasztás
 * elutasítva). Egy kitakaró programnak viszont a pozíció az egyetlen igazán
 * fontos kimenet. Itt a tokenizálást magunk végezzük (`wordpiece.ts`), így a
 * pozíció NEM visszaállított becslés, hanem a tokenizálás közvetlen eredménye.
 *
 * A modell magyar korpuszon tanult magyar kódoló (huBERT). A mérés szerint a
 * legfontosabb magyar buktatót helyesen kezeli: a „Nagy a kockázat" mondatban a
 * „Nagy" köznév, a „Nagy Péter"-ben pedig személynév — ugyanabban az iratban.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityExtractor, EntityLabel, ExtractOptions, ExtractedEntity, ExtractorInfo } from './types.js';
import { WordPieceTokenizer, slidingWindows } from './wordpiece.js';

export interface HubertNerConfig {
  modelId: string;
  repo: string;
  /** A modelltár gyökere; a tároló útvonalát tükrözzük alatta. */
  cacheDir: string;
  labelMap: Record<string, EntityLabel>;
  /** Ennyi szálon fusson a számítás; a maradékot a felület kapja. */
  threads?: number;
  /** Melyik hálófájlt töltse be; alapból a 8 bites, ha megvan. */
  fileName?: string;
}

interface OrtLike {
  InferenceSession: {
    create(path: string, opts: Record<string, unknown>): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown;
  env: { logLevel?: string };
}

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
  release?(): Promise<void>;
  inputNames: string[];
}

/**
 * A tartomány széléről leszedjük a nem-betű karaktereket.
 *
 * A modell néha a bevezető pontot is a névhez sorolja („özv." után), és egy
 * ponttal kezdődő fedőnév-csere elrontaná a mondatot. A név BELSEJÉBEN lévő
 * pontot és kötőjelet viszont meg kell tartani: „dr. Bach Tivadar",
 * „Kiss-Nagy Éva".
 */
function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  const isEdge = (ch: string): boolean => !/[\p{L}\p{N}]/u.test(ch);
  let s = start;
  let e = end;
  while (s < e && isEdge(text[s]!)) s++;
  while (e > s && isEdge(text[e - 1]!)) e--;
  return e > s ? { start: s, end: e } : null;
}

export class HubertNer implements EntityExtractor {
  private session: OrtSession | null = null;
  private tokenizer: WordPieceTokenizer | null = null;
  private id2label: Record<string, string> = {};
  private ort: OrtLike | null = null;
  /**
   * Amit a modell megtalált, de a címketérképünk nem ismert — nyers címke
   * szerint. Eddig ezek némán estek ki: a `flush()` feltétele hamis volt, és
   * senki nem tudta meg, hogy a modell mondott valamit, amit nem értettünk.
   */
  private readonly unmapped = new Map<string, number>();

  constructor(private readonly cfg: HubertNerConfig) {}

  /**
   * A nem értelmezett találatok fajtánként, a LEGUTÓBBI `extract()` hívásból.
   *
   * A hívónak (`worker.ts` → `client.ts` → `electron/main.ts`) tovább kell
   * adnia a `ModelStatus.unmappedByLabel` mezőbe: onnan jut el a
   * jegyzőkönyvbe és a felületre.
   */
  get unmappedLabels(): Record<string, number> {
    return Object.fromEntries(this.unmapped);
  }

  /** A nem értelmezett találatok összesen — a jegyzőkönyv ezt írja ki. */
  get unmappedLabelCount(): number {
    let n = 0;
    for (const v of this.unmapped.values()) n += v;
    return n;
  }

  get modelDir(): string {
    return join(this.cfg.cacheDir, ...this.cfg.repo.split('/'));
  }

  /**
   * A betöltendő hálófájl.
   *
   * Alapból a PONTOS, lebegőpontos változat. Van 8 bites is — negyedakkora és
   * 1,7-szer gyorsabb —, de a mérés szerint elveszít egy csupa nagybetűs
   * aláírásban álló személynevet (`test/quant-compare.ts`). Egy kitakaró
   * programban a kimaradt név kiszivárgott személyazonosság, ezért a kisebb
   * fájl nem elég ok rá. A 8 bites változat így csak akkor jön szóba, ha a
   * pontos nincs a gépen, vagy ha valaki kifejezetten azt kéri.
   */
  private netFile(): string {
    if (this.cfg.fileName) return join(this.modelDir, this.cfg.fileName);
    const full = join(this.modelDir, 'model.onnx');
    return existsSync(full) ? full : join(this.modelDir, 'model.int8.onnx');
  }

  isInstalled(): boolean {
    return existsSync(this.netFile()) && existsSync(join(this.modelDir, 'tokenizer.json'));
  }

  async load(): Promise<ExtractorInfo> {
    const t0 = Date.now();
    const dir = this.modelDir;
    if (!this.isInstalled()) {
      throw new Error('A magyar NER-modell nincs telepítve. Beállítások → Nyelvi modellek.');
    }

    // A HÁLÓ ÉPSÉGE, mielőtt bármit hinnénk el neki. A 440 MB-os fájl
    // félbemásolva vagy sérülten is betöltődik, csak épp csendben rosszabb
    // eredményt ad — egy kitakaró programban ez kimaradt név, vagyis
    // kiszivárgott személyazonosság. Eltérésnél magyar üzenettel megállunk.
    // A költség egyszeri: a `verifyModelChecksums` folyamaton belül gyorstáraz.
    const { verifyModelChecksums } = await import('../app/models.js');
    await verifyModelChecksums(dir);

    const cfgJson = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as {
      id2label?: Record<string, string>;
    };
    this.id2label = cfgJson.id2label ?? {};

    // Magyarul az ékezet jelentést hordoz, és ez a modell ékezetes szótárral
    // tanult: a „Kovács" egyetlen szótári elem. A tokenizer.json maga mondja
    // meg, hogy nem kell kisbetűsíteni és nem szabad ékezetet levenni — ha egy
    // későbbi modellnél ez másképp lenne, a betöltés hangosan elszáll.
    this.tokenizer = WordPieceTokenizer.fromTokenizerJson(
      readFileSync(join(dir, 'tokenizer.json'), 'utf8'),
    ).tokenizer;

    const ort = (await import('onnxruntime-node')) as unknown as OrtLike;
    this.ort = ort;
    if (ort.env) ort.env.logLevel = 'error';

    const cpus = (await import('node:os')).availableParallelism?.() ?? 4;
    this.session = await ort.InferenceSession.create(this.netFile(), {
      executionProviders: ['cpu'],
      // Két magot meghagyunk a felületnek, hogy ne akadjon meg a program.
      intraOpNumThreads: this.cfg.threads ?? Math.max(1, cpus - 2),
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
    });

    return { modelId: this.cfg.modelId, repo: this.cfg.repo, offsets: 'native', loadMs: Date.now() - t0 };
  }

  async extract(text: string, opts: ExtractOptions = {}): Promise<ExtractedEntity[]> {
    if (!this.session || !this.tokenizer) await this.load();
    const session = this.session!;
    const tokenizer = this.tokenizer!;
    const ort = this.ort!;
    const minScore = opts.minScore ?? 0.5;
    // A számláló IRATONKÉNT érvényes: a jegyzőkönyv erről az iratról állít
    // valamit, nem a folyamat egész életéről.
    this.unmapped.clear();

    const tokens = tokenizer.tokenize(text);
    const windows = slidingWindows(tokens, tokenizer.clsId, tokenizer.sepId, 512, 128);

    // SZÓ → (címke, valószínűség), nem token → címke. A modell csak a szó első
    // darabjára kapott tanítást; a folytatásokon a jóslata zaj.
    // Az átfedő ablakok miatt egy szót többször is látunk — a magabiztosabb
    // ítéletet tartjuk meg.
    const perWord = new Map<number, { start: number; end: number; label: string; score: number }>();

    let keszAblak = 0;
    for (const w of windows) {
      const len = w.ids.length;
      const ids = BigInt64Array.from(w.ids.map((n) => BigInt(n)));
      const mask = BigInt64Array.from(new Array<number>(len).fill(1).map((n) => BigInt(n)));
      const types = new BigInt64Array(len);

      const feeds: Record<string, unknown> = {
        input_ids: new ort.Tensor('int64', ids, [1, len]),
        attention_mask: new ort.Tensor('int64', mask, [1, len]),
      };
      if (session.inputNames.includes('token_type_ids')) {
        feeds.token_type_ids = new ort.Tensor('int64', types, [1, len]);
      }

      const out = await session.run(feeds);
      const logits = out.logits ?? Object.values(out)[0]!;
      const numLabels = logits.dims[2] as number;
      const data = logits.data;

      for (let i = 0; i < len; i++) {
        const tok = w.tokens[i];
        if (!tok) continue; // [CLS] / [SEP]
        if (!tok.isWordStart) continue; // betanítatlan folytatás — ki kell hagyni
        let best = 0;
        let bestVal = -Infinity;
        for (let k = 0; k < numLabels; k++) {
          const v = data[i * numLabels + k]!;
          if (v > bestVal) {
            bestVal = v;
            best = k;
          }
        }
        let sum = 0;
        for (let k = 0; k < numLabels; k++) sum += Math.exp(data[i * numLabels + k]! - bestVal);
        const score = 1 / sum;
        const label = this.id2label[String(best)] ?? 'O';

        const prev = perWord.get(tok.wordIndex);
        if (!prev || score > prev.score) {
          // A tartomány az EGÉSZ szó, nem csak az első darabja — különben
          // „Szentendrei"-ből „Szentend" lenne.
          perWord.set(tok.wordIndex, { start: tok.wordStart, end: tok.wordEnd, label, score });
        }
      }

      // A ciklus VÉGÉN jelzünk, nem az elején: a felhasználónak az számít, mi
      // van KÉSZ, nem az, mi kezdődött el. Az ablakok száma előre ismert, és
      // mindegyik nagyjából ugyanannyi ideig tart — ezért ebből lesz az egyetlen
      // olyan arány a felismerésben, ami nem kitalált.
      opts.onWindow?.({ ablak: ++keszAblak, ablakok: windows.length });
    }

    const words = [...perWord.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wordIndex, v]) => ({ wordIndex, ...v }));
    return this.groupSpans(words, text, minScore);
  }

  /**
   * BIO-címkék összefűzése tartományokká, KARAKTERPOZÍCIÓ alapján.
   *
   * A tartomány magabiztossága a leggyengébb tokené — nem az átlag. Az átlag
   * elrejtene egy bizonytalan tokent, márpedig épp ott van a hiba.
   */
  private groupSpans(
    words: { wordIndex: number; start: number; end: number; label: string; score: number }[],
    text: string,
    minScore: number,
  ): ExtractedEntity[] {
    const out: ExtractedEntity[] = [];
    let cur: { start: number; end: number; type: string; score: number; lastWord: number } | null = null;

    const flush = (): void => {
      if (!cur) return;
      const label = this.cfg.labelMap[cur.type];
      const trimmed = trimSpan(text, cur.start, cur.end);
      // A NEM ÉRTELMEZETT címke megszámolása. Csak az számít bele, amit
      // egyébként HASZNÁLTUNK VOLNA: van szövege és elég magabiztos. Így a
      // szám azt mondja meg, hány valódi találatot ejtettünk el azért, mert a
      // címketérképünkben nincs bejegyzés a modell nyers címkéjéhez.
      if (!label && trimmed && cur.score >= minScore) {
        this.unmapped.set(cur.type, (this.unmapped.get(cur.type) ?? 0) + 1);
      }
      if (label && trimmed && cur.score >= minScore) {
        out.push({
          start: trimmed.start,
          end: trimmed.end,
          text: text.slice(trimmed.start, trimmed.end),
          label,
          rawLabel: cur.type,
          score: cur.score,
        });
      }
      cur = null;
    };

    for (const w of words) {
      if (w.label === 'O') {
        flush();
        continue;
      }
      const type = w.label.replace(/^[BI]-/, '');
      const isBegin = w.label.startsWith('B-');

      // Csak SZOMSZÉDOS szó folytathat egy nevet. Sorvég vagy közbeékelt szó
      // után új név kezdődik, még ha a címke „I-" is — az átfedő ablakok
      // határán ez különben két távoli nevet ragasztana össze.
      const contiguous = cur !== null && w.wordIndex === cur.lastWord + 1;
      const separator = cur !== null ? text.slice(cur.end, w.start) : '';
      const sameLine = !separator.includes('\n');

      if (cur && cur.type === type && !isBegin && contiguous && sameLine) {
        cur.end = w.end;
        cur.lastWord = w.wordIndex;
        cur.score = Math.min(cur.score, w.score);
        continue;
      }
      flush();
      cur = { start: w.start, end: w.end, type, score: w.score, lastWord: w.wordIndex };
    }
    flush();
    return out;
  }

  async dispose(): Promise<void> {
    await this.session?.release?.();
    this.session = null;
    this.tokenizer = null;
    this.ort = null;
  }
}
