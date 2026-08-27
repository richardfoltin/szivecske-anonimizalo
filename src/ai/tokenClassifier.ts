/**
 * Token-osztályozó modell futtatása ONNX-en, Node-ból.
 *
 * Miért nem a kényelmes `pipeline('token-classification')`: az nem ad vissza
 * karakterpozíciót, márpedig egy kitakaró programnak pontosan az kell. Ezért a
 * modellt magunk hívjuk, a tokeneket magunk illesztjük vissza a szövegre
 * (`offsets.ts`), és a BIO-címkéket magunk fűzzük össze.
 *
 * A hosszú iratot átfedő darabokra vágjuk, mert a kódolóknak véges az
 * ablakuk — az átfedés miatt a darabhatárra eső név sem vész el.
 */

import { existsSync } from 'node:fs';
import type { EntityExtractor, EntityLabel, ExtractOptions, ExtractedEntity, ExtractorInfo } from './types.js';
import { alignTokens, groupBio, trimSpan, type RawPrediction } from './offsets.js';

export interface TokenClassifierConfig {
  modelId: string;
  repo: string;
  /** A modelltár gyökere; a tároló útvonalát tükrözzük alatta. */
  cacheDir: string;
  /** Melyik nyers címke mit jelent nálunk. Ami nincs benne, azt eldobjuk. */
  labelMap: Record<string, EntityLabel>;
  /** Kvantálás: a szállított modelleknél 'q8'. */
  dtype?: 'q8' | 'fp32' | 'fp16' | 'q4';
}

const DEFAULTS: Required<Pick<ExtractOptions, 'chunkChars' | 'overlapChars' | 'minScore'>> = {
  // A kódolók ablaka ~512 alszó; magyarul egy szó átlagosan 3 alszó, ezért a
  // karakterhatárt óvatosan állítjuk be.
  // Magyarul egy szó ~3 alszó, a kódoló ablaka 512 — ezért óvatos a darabméret.
  chunkChars: 700,
  overlapChars: 150,
  minScore: 0.5,
};

export class TokenClassifier implements EntityExtractor {
  private tokenizer: unknown = null;
  private model: unknown = null;
  private id2label: Record<string, string> = {};
  private loaded = false;
  /**
   * Amit a modell megtalált, de a címketérképünk nem ismert — nyers címke
   * szerint. Eddig ezek némán estek ki (`if (!label) continue;`), vagyis a
   * program pont arról hallgatott, amit nem értett. A többnyelvű modell
   * címketérképe hét név-jellegű címkét ismer; ami ezen kívül jön, az itt
   * legalább MEGSZÁMOLVA vész el.
   */
  private readonly unmapped = new Map<string, number>();

  constructor(private readonly cfg: TokenClassifierConfig) {}

  /**
   * A nem értelmezett találatok fajtánként, a LEGUTÓBBI `extract()` hívásból.
   *
   * A hívónak (`worker.ts` → `client.ts` → `electron/main.ts`) tovább kell
   * adnia a `ModelStatus.unmappedByLabel` mezőbe.
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

  /** A modell könyvtára a lemezen. */
  get modelDir(): string {
    return [this.cfg.cacheDir, ...this.cfg.repo.split('/')].join('/');
  }

  isInstalled(): boolean {
    return existsSync(`${this.modelDir}/config.json`);
  }

  async load(): Promise<ExtractorInfo> {
    const t0 = Date.now();

    // A HÁLÓ ÉPSÉGE, mielőtt bármit hinnénk el neki. Egy félbemásolt vagy
    // sérült hálófájl betöltődik, csak épp csendben rosszabb eredményt ad —
    // egy kitakaró programban ez kimaradt név. Ha a modell mellett nincs
    // ellenőrzőösszeg (a letöltött modelleknél nincs), a betöltés zavartalanul
    // megy tovább: a hiány nem bizonyíték sérülésre.
    const { verifyModelChecksums } = await import('../app/models.js');
    await verifyModelChecksums(this.modelDir);

    const tf = (await import('@huggingface/transformers')) as unknown as TransformersModule;

    // Ez a két sor a lényeg: a modelltár a MI mappánk, és a betöltés SOHA nem
    // megy hálózatra. A letöltés külön, kifejezett felhasználói művelet.
    tf.env.cacheDir = this.cfg.cacheDir;
    tf.env.allowRemoteModels = false;
    if (tf.env.backends?.onnx?.wasm) tf.env.backends.onnx.wasm.numThreads = 1;

    this.tokenizer = await tf.AutoTokenizer.from_pretrained(this.cfg.repo);
    this.model = await tf.AutoModelForTokenClassification.from_pretrained(this.cfg.repo, {
      dtype: this.cfg.dtype ?? 'q8',
      device: 'cpu',
    });

    const cfg = (this.model as { config?: { id2label?: Record<string, string> } }).config;
    this.id2label = cfg?.id2label ?? {};
    this.loaded = true;

    return {
      modelId: this.cfg.modelId,
      repo: this.cfg.repo,
      offsets: 'reconstructed',
      loadMs: Date.now() - t0,
    };
  }

  async extract(text: string, opts: ExtractOptions = {}): Promise<ExtractedEntity[]> {
    if (!this.loaded) await this.load();
    const o = { ...DEFAULTS, ...opts };
    // A számláló IRATONKÉNT érvényes: a jegyzőkönyv erről az iratról állít
    // valamit, nem a folyamat egész életéről.
    this.unmapped.clear();

    const out: ExtractedEntity[] = [];
    for (const chunk of chunkText(text, o.chunkChars, o.overlapChars)) {
      const found = await this.extractChunk(chunk.text, o.minScore);
      for (const e of found) {
        out.push({ ...e, start: e.start + chunk.offset, end: e.end + chunk.offset });
      }
    }
    return dedupeSpans(out, text);
  }

  private async extractChunk(text: string, minScore: number): Promise<ExtractedEntity[]> {
    const tokenizer = this.tokenizer as TokenizerLike;
    const model = this.model as ModelLike;

    const encoded = await tokenizer(text, { truncation: true, return_tensors: 'js' });
    const output = await model(encoded);
    const logits = output.logits;
    const [, seqLen, numLabels] = logits.dims as [number, number, number];
    const data = logits.data as Float32Array;

    // A tokenek szöveges alakja az illesztéshez.
    // A tokenek SZÖVEGES alakja kell, a szókezdet-jelölővel (▁) együtt.
    //
    // A `decode([id])` NEM jó erre: eldobja a jelölőt, ezért a „▁Balo" + „gh"
    // párból két külön szókezdet lesz, és a név csonkán illeszkedik vissza a
    // szövegre. A `tokenize()` megtartja a jelölőt — csak a különleges
    // tokeneket kell magunknak visszatenni, mert azokat nem adja vissza.
    const pieces = tokenizer.tokenize(text);
    const tokens = ['<s>', ...pieces, '</s>'].slice(0, seqLen);

    const predictions: RawPrediction[] = [];
    for (let i = 0; i < seqLen; i++) {
      let best = 0;
      let bestScore = -Infinity;
      let sum = 0;
      for (let k = 0; k < numLabels; k++) {
        const v = data[i * numLabels + k]!;
        if (v > bestScore) {
          bestScore = v;
          best = k;
        }
      }
      // Softmax csak a legjobbra: elég a megbízhatósági értékhez.
      for (let k = 0; k < numLabels; k++) sum += Math.exp(data[i * numLabels + k]! - bestScore);
      predictions.push({ index: i, label: this.id2label[String(best)] ?? 'O', score: 1 / sum });
    }

    const spans = alignTokens(text, tokens);
    const grouped = groupBio(predictions, spans);

    const out: ExtractedEntity[] = [];
    for (const g of grouped) {
      const t = trimSpan(text, g);
      if (t.end <= t.start) continue;
      if (t.score < minScore) continue;
      const label = this.cfg.labelMap[t.label];
      if (!label) {
        // Nem értjük a modell címkéjét — de legalább MEGSZÁMOLJUK. A néma
        // `continue` miatt eddig semmi nem árulta el, hogy a modell mondott
        // valamit, amit a program eldobott.
        this.unmapped.set(t.label, (this.unmapped.get(t.label) ?? 0) + 1);
        continue;
      }
      out.push({
        start: t.start,
        end: t.end,
        text: text.slice(t.start, t.end),
        label,
        rawLabel: t.label,
        score: t.score,
      });
    }
    return out;
  }

  async dispose(): Promise<void> {
    const model = this.model as { dispose?: () => Promise<void> } | null;
    await model?.dispose?.();
    this.model = null;
    this.tokenizer = null;
    this.loaded = false;
  }
}

/** Átfedő darabolás, lehetőleg mondathatáron. */
export function chunkText(text: string, size: number, overlap: number): { text: string; offset: number }[] {
  if (text.length <= size) return [{ text, offset: 0 }];
  const out: { text: string; offset: number }[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + size);
    if (end < text.length) {
      // Visszalépünk a legközelebbi mondat- vagy sorvégre, hogy ne vágjunk nevet ketté.
      const window = text.slice(Math.max(pos, end - 220), end);
      const m = /[.!?\n][^.!?\n]*$/.exec(window);
      if (m && m.index > 0) end = Math.max(pos, end - 220) + m.index + 1;
    }
    out.push({ text: text.slice(pos, end), offset: pos });
    if (end >= text.length) break;
    pos = Math.max(pos + 1, end - overlap);
  }
  return out;
}

/** Az átfedések miatt ugyanaz a név többször is előjöhet. */
function dedupeSpans(list: ExtractedEntity[], text: string): ExtractedEntity[] {
  const letter = /[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9]/;
  const byKey = new Map<string, ExtractedEntity>();

  for (const e of list) {
    if (text.slice(e.start, e.end) !== e.text) continue; // pozíció elcsúszott
    // Szó közepén kezdődő vagy végződő találat: a darabhatáron keletkezett
    // törmelék („Balo" az „ifj. Balogh Gábor"-ból). Ezek nem nevek.
    if (letter.test(text[e.start - 1] ?? '')) continue;
    if (letter.test(text[e.end] ?? '')) continue;

    const k = `${e.start}:${e.end}`;
    const prev = byKey.get(k);
    if (!prev || e.score > prev.score) byKey.set(k, e);
  }

  // A rövidebb, teljesen belefoglalt találatot eldobjuk a hosszabb javára.
  const all = [...byKey.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ExtractedEntity[] = [];
  for (const e of all) {
    const covered = out.some((k) => k.start <= e.start && e.end <= k.end && k.label === e.label);
    if (!covered) out.push(e);
  }
  return out;
}

/* ─── A Transformers.js szűk típusai; a könyvtár nem szállít pontosat ─── */

interface TransformersModule {
  env: {
    cacheDir: string;
    allowRemoteModels: boolean;
    backends?: { onnx?: { wasm?: { numThreads?: number } } };
  };
  AutoTokenizer: { from_pretrained(repo: string): Promise<unknown> };
  AutoModelForTokenClassification: {
    from_pretrained(repo: string, opts: { dtype: string; device: string }): Promise<unknown>;
  };
}

interface TokenizerLike {
  (text: string, opts: Record<string, unknown>): Promise<{
    input_ids: { data: BigInt64Array | Int32Array };
  }>;
  /** A darabolt tokenek szöveges alakja, a szókezdet-jelölővel együtt. */
  tokenize(text: string): string[];
}

interface ModelLike {
  (encoded: unknown): Promise<{ logits: { dims: number[]; data: Float32Array } }>;
}
