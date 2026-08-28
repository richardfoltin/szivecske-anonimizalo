/**
 * SZÖVEGET ÍRÓ MODELL futtatása — kizárólag a névkészlet-gyártáshoz.
 *
 * A program többi modellje CÍMKÉZ: szöveget kap, és megjelölt entitásokat ad
 * vissza (`tokenClassifier.ts`, `hubertNer.ts`). Ez az egy modell ír. Iratot
 * SOHA nem lát: a bemenete a felhasználó által beírt téma („görög mitológia”),
 * a kimenete néhány tucat javasolt név. Ezért van külön fájlban — hogy a
 * felismerő úton egyetlen sor se hivatkozzon rá, és fordítva.
 *
 * MIÉRT KÉT MENETBEN GENERÁLUNK (lásd `generate` alább): a nyilvántartásba vett
 * gyártó egy 》gondolkodó《 modell. A csevegő sablonja `<think>`-kel nyit, és a
 * modell magától addig gondolkodik, ameddig jónak látja — közben egy szót sem ír
 * a válaszból. Mérés ezen a gépen: 4,35 token másodpercenként. Ha egyetlen
 * generálásra bíznánk a keretet, a modell elgondolkodhatná az egészet, és a
 * felhasználó tíz perc után ÜRES eredményt kapna. Ezért a gondolkodásnak külön,
 * szűkebb kerete van, és ha kifut belőle, mi zárjuk le helyette a `</think>`
 * jellel. A válasz kerete ennél bőkezűbb lehet: a modell a lista végén magától
 * megáll, tehát a nagyobb keret nem kerül időbe.
 */

import { existsSync } from 'node:fs';
import type { ExtractorInfo } from './types.js';

export interface TextGeneratorConfig {
  modelId: string;
  repo: string;
  /** A modelltár gyökere; a tároló útvonalát tükrözzük alatta. */
  cacheDir: string;
  /** A nyilvántartás a 4 bites hálót szállítja; a fp16 nem fér el 16 GB-ban. */
  dtype?: 'q8' | 'fp32' | 'fp16' | 'q4';
}

export interface GenerateOptions {
  /** Legfeljebb ennyi tokent írhat a VÁLASZ. A modell hamarabb is megállhat. */
  maxNewTokens?: number;
  /** Legfeljebb ennyi tokent gondolkodhat, mielőtt válaszolni kezd. */
  thinkBudget?: number;
  /**
   * Hány szó kész, és mennyi a keret.
   *
   * Nem díszítés: a gyártás percekbe telik, és a hívó órája ettől indul újra
   * (`client.ts`). Enélkül egy lassú gépen a saját időkorlátunk lőné ki a
   * modellt, miközben az rendben dolgozik.
   */
  onToken?: (kesz: number, keret: number) => void;
}

/** Ennyit gondolkodhat alapból. Egy névsorhoz ennyi bőven elég. */
const ALAP_GONDOLKODAS = 320;

/** Ennyit írhat alapból. A lista végén a modell úgyis hamarabb megáll. */
const ALAP_VALASZ = 1200;

export class TextGenerator {
  private tokenizer: TokenizerLike | null = null;
  private model: CausalModelLike | null = null;
  private tf: TransformersModule | null = null;
  /** A `</think>` token azonosítója, a tokenizálótól kérdezve — nem beégetve. */
  private zaroGondolat: number | null = null;

  constructor(private readonly cfg: TextGeneratorConfig) {}

  /** A modell könyvtára a lemezen. */
  get modelDir(): string {
    return [this.cfg.cacheDir, ...this.cfg.repo.split('/')].join('/');
  }

  isInstalled(): boolean {
    return existsSync(`${this.modelDir}/config.json`);
  }

  async load(): Promise<ExtractorInfo> {
    const t0 = Date.now();

    // A HÁLÓ ÉPSÉGE, mielőtt bármit hinnénk el neki — ugyanaz az ellenőrzés,
    // mint a felismerő modelleknél. Egy félbemásolt súly betöltődik, csak épp
    // értelmetlen szöveget ír, és a felhasználó a saját témájában keresné a hibát.
    const { verifyModelChecksums } = await import('../app/models.js');
    await verifyModelChecksums(this.modelDir);

    const tf = (await import('@huggingface/transformers')) as unknown as TransformersModule;
    // Ez a két sor a lényeg: a modelltár a MI mappánk, és a betöltés SOHA nem
    // megy hálózatra. A letöltés külön, kifejezett felhasználói művelet.
    tf.env.cacheDir = this.cfg.cacheDir;
    tf.env.allowRemoteModels = false;
    this.tf = tf;

    this.tokenizer = (await tf.AutoTokenizer.from_pretrained(this.cfg.repo)) as TokenizerLike;
    this.model = (await tf.AutoModelForCausalLM.from_pretrained(this.cfg.repo, {
      dtype: this.cfg.dtype ?? 'q4',
      device: 'cpu',
    })) as CausalModelLike;

    this.zaroGondolat = this.zaroGondolatAzonosito(this.tokenizer);

    return {
      modelId: this.cfg.modelId,
      repo: this.cfg.repo,
      // A mező a felismerő úton azt mondja meg, honnan jönnek a karakterhatárok.
      // Itt nincsenek karakterhatárok: ez a modell nem jelöl meg semmit az
      // iratban. A közös alak miatt kell kitölteni.
      offsets: 'reconstructed',
      loadMs: Date.now() - t0,
    };
  }

  /**
   * A `</think>` token azonosítója — a tokenizálótól, nem emlékezetből.
   *
   * Ha a modell nem gondolkodó fajta (nincs ilyen tokenje), vagy több tokenre
   * esik szét, `null`-t adunk: olyankor a gondolkodási keret nem tud korán
   * megállni, a program pedig ettől még működik. Egy beégetett azonosító
   * viszont modellcserekor NÉMÁN mutatna rossz helyre.
   */
  private zaroGondolatAzonosito(tok: TokenizerLike): number | null {
    try {
      const ids = tok.encode('</think>', { add_special_tokens: false });
      return ids.length === 1 ? Number(ids[0]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Egy kérdés, egy válasz.
   *
   * @returns a modell válasza a gondolatmenettel EGYÜTT — a levágás a hívó
   *          dolga (`temagyar.ts`, `olvasdAJavaslatot`), mert a gondolatmenet
   *          a hibakereséshez néha kell.
   */
  async generate(kerdes: string, opts: GenerateOptions = {}): Promise<string> {
    if (!this.model || !this.tokenizer || !this.tf) await this.load();
    const tok = this.tokenizer;
    const model = this.model;
    const tf = this.tf;
    if (!tok || !model || !tf) throw new Error('A szöveggyártó modell nincs betöltve.');

    const gondolatKeret = opts.thinkBudget ?? ALAP_GONDOLKODAS;
    const valaszKeret = opts.maxNewTokens ?? ALAP_VALASZ;
    const keret = gondolatKeret + valaszKeret;
    let kesz = 0;
    const streamer = new tf.TextStreamer(tok, {
      skip_prompt: true,
      skip_special_tokens: false,
      // A darabolás szavanként érkezik, nem tokenenként; a folyamatjelzőhöz ez
      // untig elég, és a token szerinti visszahívás sem pontosabb annyival,
      // hogy megérje két számlálót vezetni.
      callback_function: () => {
        kesz++;
        opts.onToken?.(Math.min(kesz, keret), keret);
      },
    });

    // 1. MENET: a gondolkodás. A csevegő sablon `<think>`-kel nyit, tehát a
    // modell itt még biztosan nem a választ írja.
    const eleje = tok.apply_chat_template([{ role: 'user', content: kerdes }], {
      tokenize: false,
      add_generation_prompt: true,
    }) as string;

    const gondolat = await this.futtat(model, tok, streamer, eleje, gondolatKeret, true);

    // 2. MENET: a válasz. Ha a modell nem fejezte be a gondolkodást, MI zárjuk
    // le — így a keret nem elveszett idő, hanem egy rövidebb gondolatmenet.
    const lezart = gondolat.includes('</think>') ? gondolat : `${gondolat}\n</think>\n\n`;
    const valasz = await this.futtat(model, tok, streamer, eleje + lezart, valaszKeret, false);

    return lezart + valasz;
  }

  /**
   * Egy generálás: szövegből szöveg.
   *
   * @param zarasnalAllj a gondolkodás menetében igaz — ilyenkor a `</think>`
   *                     megjelenésekor azonnal megállunk, mert onnantól a válasz
   *                     jön, azt viszont a 2. menet írja, a saját keretéből.
   */
  private async futtat(
    model: CausalModelLike,
    tok: TokenizerLike,
    streamer: unknown,
    szoveg: string,
    keret: number,
    zarasnalAllj: boolean,
  ): Promise<string> {
    const inputs = await tok(szoveg);
    const bemenetHossza = inputs.input_ids.dims[1] ?? 0;

    const megallok: ((ids: (number | bigint)[][]) => boolean[])[] = [];
    if (zarasnalAllj && this.zaroGondolat !== null) {
      const zaro = this.zaroGondolat;
      // Szándékosan `==`, nem `===`: a futtató bigint tömböt ad, az azonosító
      // szám. A könyvtár saját feltételei is így hasonlítanak (EosTokenCriteria).
      megallok.push((ids) => ids.map((sor) => sor.at(-1) == zaro));
    }

    const out = await model.generate({
      ...inputs,
      max_new_tokens: keret,
      // A gyártó saját `generation_config.json`-jából vett értékek. Nem
      // találgatás: a modell készítője ezekkel mérte be.
      do_sample: true,
      temperature: 0.6,
      top_p: 0.95,
      top_k: 20,
      streamer,
      ...(megallok.length > 0 ? { stopping_criteria: megallok } : {}),
    });

    const teljes = out.tolist()[0] ?? [];
    const ujak = teljes.slice(bemenetHossza);
    if (ujak.length === 0) return '';
    // A speciális jeleket ELDOBJUK: a szövegbe csak a `</think>` kell vissza, azt
    // pedig a hívó menet maga teszi oda, ha kell.
    return tok.decode(ujak, { skip_special_tokens: true });
  }

  async dispose(): Promise<void> {
    const m = this.model as { dispose?: () => Promise<void> } | null;
    try {
      await m?.dispose?.();
    } catch {
      // A memóriát a folyamat kilépése úgyis visszaadja.
    }
    this.model = null;
    this.tokenizer = null;
    this.tf = null;
  }
}

/* ─────────────────────── amit a könyvtárból használunk ─────────────────────── */

interface TransformersModule {
  env: { cacheDir: string; allowRemoteModels: boolean };
  AutoTokenizer: { from_pretrained(repo: string): Promise<unknown> };
  AutoModelForCausalLM: {
    from_pretrained(repo: string, opts: { dtype: string; device: string }): Promise<unknown>;
  };
  TextStreamer: new (tok: unknown, opts: Record<string, unknown>) => unknown;
}

interface TokenizerLike {
  (text: string): Promise<{ input_ids: { dims: number[] } }>;
  encode(text: string, opts: { add_special_tokens: boolean }): (number | bigint)[];
  decode(ids: (number | bigint)[], opts: { skip_special_tokens: boolean }): string;
  apply_chat_template(
    messages: { role: string; content: string }[],
    opts: { tokenize: boolean; add_generation_prompt: boolean },
  ): unknown;
}

interface CausalModelLike {
  generate(opts: Record<string, unknown>): Promise<{ tolist(): (number | bigint)[][] }>;
}
