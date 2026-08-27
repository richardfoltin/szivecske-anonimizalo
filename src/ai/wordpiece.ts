/**
 * WordPiece-tokenizáló, karakterpozíciókkal.
 *
 * Miért saját: egy kitakaró programnak a pozíció az egyetlen igazán fontos
 * kimenet — ha nem tudjuk, hol van a név a forrásban, nem tudjuk kivágni a
 * fájlból. A Transformers.js token-osztályozója nem ad pozíciót (a forrásában
 * ott a nyitott TODO), a hivatalos `tokenizers` npm-csomagnak pedig nincs
 * Windows-x64 előre fordított változata. Ez a ~150 sor viszont pontosan azt
 * adja, ami kell, és nem hoz be függőséget.
 *
 * A BERT-féle tokenizálás két lépés:
 *  1. alaptagolás — szóközök és írásjelek mentén, a pozíciókat végig követve,
 *  2. alszavakra bontás — a leghosszabb illeszkedő szótári elem, a folytatást
 *     "##" jelöli.
 *
 * Magyar szempontból egy dolog kritikus: az ÉKEZETEKET NEM SZABAD LEVENNI.
 * A huBERT ékezetes szótárral tanult; ha „Kovács"-ból „Kovacs" lesz, a modell
 * más szót lát, és a pozíciók is elcsúsznak.
 */

export interface WordPieceToken {
  id: number;
  text: string;
  /** Karakterpozíció az EREDETI szövegben. */
  start: number;
  end: number;
  /**
   * Hányadik SZÓ-ból származik ez a darab. A NER-címkéket szó szinten kell
   * összefűzni, nem darab szinten — lásd `isWordStart`.
   */
  wordIndex: number;
  /** A teljes szó határai; minden darabja ugyanezt kapja. */
  wordStart: number;
  wordEnd: number;
  /**
   * Ez a szó ELSŐ darabja-e.
   *
   * Ez nem apróság: a BERT-féle névfelismerő tanításakor a címkét csak a szó
   * első darabja kapja meg, a folytatások ki vannak hagyva a veszteségből.
   * Ezért a modell jóslata a folytatásokon BETANÍTATLAN — ha figyelembe
   * vennénk, a „Szentendrei" szóból „Szentend" + „rei" lenne.
   */
  isWordStart: boolean;
}

export interface WordPieceOptions {
  lowercase?: boolean;
  unkToken?: string;
  clsToken?: string;
  sepToken?: string;
  /** A folytatást jelölő előtag; a BERT-nél „##". */
  subwordPrefix?: string;
  /** Ennél hosszabb szót nem bontunk, hanem ismeretlennek jelölünk. */
  maxCharsPerWord?: number;
}

interface Piece {
  text: string;
  start: number;
  end: number;
}

/** Vezérlőkarakter: a tokenizálás előtt kiesik. */
function isControl(ch: string): boolean {
  if (ch === '\t' || ch === '\n' || ch === '\r') return false;
  const c = ch.codePointAt(0) ?? 0;
  return c === 0 || c === 0xfffd || (c < 0x20) || (c >= 0x7f && c <= 0x9f);
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || /\s/.test(ch);
}

/**
 * Írásjel a BERT értelmezésében: minden nem betű-nem szám-nem szóköz ASCII jel,
 * plusz az Unicode írásjel-kategóriák.
 */
function isPunctuation(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) {
    return true;
  }
  return /[\p{P}\p{S}]/u.test(ch);
}

export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly lowercase: boolean;
  private readonly unk: string;
  private readonly cls: string;
  private readonly sep: string;
  private readonly prefix: string;
  private readonly maxChars: number;

  constructor(vocab: Map<string, number>, opts: WordPieceOptions = {}) {
    this.vocab = vocab;
    this.lowercase = opts.lowercase ?? false;
    this.unk = opts.unkToken ?? '[UNK]';
    this.cls = opts.clsToken ?? '[CLS]';
    this.sep = opts.sepToken ?? '[SEP]';
    this.prefix = opts.subwordPrefix ?? '##';
    this.maxChars = opts.maxCharsPerWord ?? 100;
  }

  /**
   * Szótár és beállítások a `tokenizer.json`-ból.
   *
   * Ez a hiteles forrás: a `vocab.txt` csak a szavakat tartalmazza, azt viszont
   * nem, hogy kisbetűsíteni kell-e és le kell-e venni az ékezetet. Magyarul épp
   * ez a két beállítás dönti el, hogy a modell egyáltalán a saját szótárát
   * látja-e — ezért nem tippelünk, hanem innen olvassuk ki.
   */
  static fromTokenizerJson(json: string): { tokenizer: WordPieceTokenizer; lowercase: boolean } {
    const t = JSON.parse(json) as {
      normalizer?: { lowercase?: boolean; strip_accents?: boolean | null };
      model?: { vocab?: Record<string, number>; unk_token?: string; continuing_subword_prefix?: string };
    };
    const rawVocab = t.model?.vocab;
    if (!rawVocab) throw new Error('A tokenizer.json nem tartalmaz szótárat.');

    const vocab = new Map<string, number>(Object.entries(rawVocab));
    const lowercase = t.normalizer?.lowercase === true;

    // A BERT alapértelmezése szerint az ékezetlevétel a kisbetűsítéshez van
    // kötve, hacsak külön nem rendelkeznek róla. Magyar modellnél az
    // ékezetlevétel végzetes: „Kovács" egyetlen szótári elem, „Kovacs" nem az.
    const stripAccents = t.normalizer?.strip_accents ?? lowercase;
    if (stripAccents) {
      throw new Error(
        'Ez a modell ékezet nélküli szótárral tanult, ezért magyar iratra nem alkalmas.',
      );
    }

    return {
      tokenizer: new WordPieceTokenizer(vocab, {
        lowercase,
        unkToken: t.model?.unk_token ?? '[UNK]',
        subwordPrefix: t.model?.continuing_subword_prefix ?? '##',
      }),
      lowercase,
    };
  }

  /** Szótár beolvasása a `vocab.txt` soronkénti formátumából. */
  static vocabFromText(text: string): Map<string, number> {
    const map = new Map<string, number>();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      if (t === undefined || t === '') continue;
      if (!map.has(t)) map.set(t, i);
    }
    return map;
  }

  get clsId(): number {
    return this.vocab.get(this.cls) ?? 0;
  }
  get sepId(): number {
    return this.vocab.get(this.sep) ?? 0;
  }

  /**
   * A szöveg tokenjei, pozícióval. A [CLS]/[SEP] NINCS benne — azokat a hívó
   * teszi hozzá, mert nekik nincs helyük a szövegben.
   */
  tokenize(text: string): WordPieceToken[] {
    const out: WordPieceToken[] = [];
    const words = this.basicTokenize(text);
    for (let w = 0; w < words.length; w++) {
      const word = words[w]!;
      const pieces = this.wordPiece(word);
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!;
        p.wordIndex = w;
        p.wordStart = word.start;
        p.wordEnd = word.end;
        p.isWordStart = i === 0;
        out.push(p);
      }
    }
    return out;
  }

  /** Szóközök és írásjelek mentén, a pozíciókat végig követve. */
  private basicTokenize(text: string): Piece[] {
    const out: Piece[] = [];
    let start = -1;

    const flush = (end: number): void => {
      if (start < 0) return;
      const t = text.slice(start, end);
      if (t) out.push({ text: t, start, end });
      start = -1;
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (isControl(ch)) {
        flush(i);
        continue;
      }
      if (isWhitespace(ch)) {
        flush(i);
        continue;
      }
      if (isPunctuation(ch)) {
        flush(i);
        out.push({ text: ch, start: i, end: i + 1 });
        continue;
      }
      if (start < 0) start = i;
    }
    flush(text.length);
    return out;
  }

  /** Egy szó alszavakra bontása, leghosszabb illeszkedés elöl. */
  private wordPiece(word: Piece): WordPieceToken[] {
    const blank = { wordIndex: 0, wordStart: word.start, wordEnd: word.end, isWordStart: false };
    const raw = this.lowercase ? word.text.toLowerCase() : word.text;
    if (raw.length > this.maxChars) {
      return [{ ...blank, id: this.vocab.get(this.unk) ?? 0, text: this.unk, start: word.start, end: word.end }];
    }

    const out: WordPieceToken[] = [];
    let pos = 0;
    while (pos < raw.length) {
      let end = raw.length;
      let found: string | null = null;
      while (end > pos) {
        const piece = pos === 0 ? raw.slice(pos, end) : this.prefix + raw.slice(pos, end);
        if (this.vocab.has(piece)) {
          found = piece;
          break;
        }
        end--;
      }
      if (found === null) {
        // Ha a szó bármely része ismeretlen, a BERT az EGÉSZ szót ismeretlennek
        // jelöli — a felezett kimenet félrevezetné a modellt.
        return [{ ...blank, id: this.vocab.get(this.unk) ?? 0, text: this.unk, start: word.start, end: word.end }];
      }
      out.push({
        ...blank,
        id: this.vocab.get(found)!,
        text: found,
        start: word.start + pos,
        end: word.start + end,
      });
      pos = end;
    }
    return out;
  }
}

export interface Window {
  /** A [CLS] és [SEP] tokenekkel együtt. */
  ids: number[];
  /** Ugyanannyi elem; a [CLS]/[SEP] helyén null, mert azok nincsenek a szövegben. */
  tokens: (WordPieceToken | null)[];
}

/**
 * Csúszóablakos darabolás átfedéssel.
 *
 * Az átfedés nem elhagyható: az ablakhatárra eső név egyébként elveszne, és a
 * mérés szerint a magyar toldalék is levágódik („Szabóval" → „Szabó"), ha az
 * ablak túl szűk.
 */
export function slidingWindows(
  tokens: WordPieceToken[],
  clsId: number,
  sepId: number,
  maxLen = 512,
  stride = 128,
): Window[] {
  const body = maxLen - 2;
  if (tokens.length === 0) return [];
  const windows: Window[] = [];
  let start = 0;

  while (start < tokens.length) {
    const slice = tokens.slice(start, start + body);
    windows.push({
      ids: [clsId, ...slice.map((t) => t.id), sepId],
      tokens: [null, ...slice, null],
    });
    if (start + body >= tokens.length) break;
    const next = start + body - stride;
    // Ha az átfedés nem visz előre, inkább csúszunk egy egész ablakot, mint hogy
    // végtelen ciklusba essünk egy rosszul megadott lépésköznél.
    start = next > start ? next : start + body;
  }
  return windows;
}
