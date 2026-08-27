/**
 * Karakterpozíciók visszaállítása a modell tokenjeiből.
 *
 * A Transformers.js jelenleg NEM ad vissza karakterpozíciót a
 * token-osztályozásnál (a forrásban ott áll a TODO). Egy kitakaró programnak
 * viszont pontosan erre van szüksége: ha nem tudjuk, hol van a név a
 * forrásszövegben, nem tudjuk kivágni a fájlból.
 *
 * Ezért a tokeneket magunk illesztjük vissza a szövegre. A SentencePiece a
 * szókezdetet U+2581-gyel jelöli, a WordPiece a folytatást "##"-tel; mindkettőt
 * kezeljük. Az illesztés balról jobbra halad, és soha nem lép vissza — így egy
 * ismétlődő szó sem csúsztatja el a többit.
 */

const SPECIAL = new Set(['<s>', '</s>', '<pad>', '<unk>', '<mask>', '[CLS]', '[SEP]', '[PAD]', '[UNK]', '[MASK]']);

/** A token nyers szövege, a tokenizáló jelöléseitől megtisztítva. */
export function tokenSurface(token: string): string {
  return token
    .replace(/▁/g, ' ') // SentencePiece szókezdet
    .replace(/^##/, '') // WordPiece folytatás
    .replace(/^Ġ/, ' ') // BPE szókezdet
    .replace(/^Ċ/, '\n');
}

export interface TokenSpan {
  start: number;
  end: number;
}

/**
 * Tokenek → karaktertartományok az eredeti szövegben.
 * A nem illeszthető tokenek helyén null áll; ezek kimaradnak a csoportosításból.
 */
export function alignTokens(text: string, tokens: string[]): (TokenSpan | null)[] {
  const out: (TokenSpan | null)[] = new Array(tokens.length).fill(null);
  const lower = text.toLowerCase();
  let pos = 0;

  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    if (SPECIAL.has(raw)) continue;
    const piece = tokenSurface(raw).trim();
    if (!piece) continue;
    const needle = piece.toLowerCase();

    // Fehér karakterek átugrása: a tokenizáló nem adja vissza őket.
    while (pos < text.length && /\s/.test(text[pos] ?? '')) pos++;

    // A HORGONY a jelenlegi pozíció. Ez a lényeg: nem keresünk a szövegben,
    // hanem a következő karakternél várjuk a tokent. Enélkül egy ismétlődő
    // szótöredék elrántja a kurzort, és onnantól minden pozíció csúszik —
    // ettől lettek a nevek csonkák („Balo", „Bach Tivad").
    if (lower.startsWith(needle, pos)) {
      out[i] = { start: pos, end: pos + piece.length };
      pos += piece.length;
      continue;
    }

    // Ha mégsem illik (a tokenizáló normalizált valamit), szűk ablakban
    // keresünk előre — de csak néhány karaktert, hogy ne ugorjunk el.
    const window = lower.slice(pos, pos + 40);
    const rel = window.indexOf(needle);
    if (rel >= 0) {
      out[i] = { start: pos + rel, end: pos + rel + piece.length };
      pos = pos + rel + piece.length;
      continue;
    }

    // Nem illeszthető token: kihagyjuk, de a kurzort NEM mozdítjuk.
  }
  return out;
}

export interface RawPrediction {
  /** Token index. */
  index: number;
  /** BIO címke, pl. "B-PERSON_NAME". */
  label: string;
  score: number;
}

export interface GroupedSpan {
  start: number;
  end: number;
  label: string;
  score: number;
}

/**
 * BIO-címkék összefűzése összefüggő tartományokká.
 *
 * A szomszédos, azonos címkéjű tartományokat összevonjuk akkor is, ha a modell
 * két darabra vágta őket — ez valódi, mért hiba: a „Szabó és Társai Ügyvédi
 * Iroda" néven a modell „S" + „zabó és Társai…" alakban adott vissza két
 * szomszédos találatot.
 */
export function groupBio(predictions: RawPrediction[], spans: (TokenSpan | null)[]): GroupedSpan[] {
  const out: GroupedSpan[] = [];
  let current: (GroupedSpan & { count: number }) | null = null;

  const flush = (): void => {
    if (current) out.push({ start: current.start, end: current.end, label: current.label, score: current.score / current.count });
    current = null;
  };

  for (const p of predictions) {
    const span = spans[p.index];
    if (!span) continue;
    if (p.label === 'O' || !p.label) {
      flush();
      continue;
    }
    const isBegin = p.label.startsWith('B-');
    const type = p.label.replace(/^[BIES]-/, '');

    if (current && current.label === type && !isBegin) {
      current.end = Math.max(current.end, span.end);
      current.score += p.score;
      current.count++;
      continue;
    }
    // Új tartomány — de ha közvetlenül az előzőhöz tapad és azonos a címke,
    // akkor az egy szétvágott név, és összetartozik.
    if (current && current.label === type && span.start <= current.end + 1) {
      current.end = Math.max(current.end, span.end);
      current.score += p.score;
      current.count++;
      continue;
    }
    flush();
    current = { start: span.start, end: span.end, label: type, score: p.score, count: 1 };
  }
  flush();

  return mergeAdjacent(out);
}

/** Egymáshoz tapadó, azonos címkéjű tartományok összevonása. */
function mergeAdjacent(spans: GroupedSpan[]): GroupedSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: GroupedSpan[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.label === s.label && s.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, s.end);
      prev.score = Math.min(prev.score, s.score);
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/**
 * A tartomány kiigazítása szóhatárra: a modell néha a rag közepén vág
 * („Kovács János|nak"), és a névhez tapadó írásjeleket is bevonja.
 */
export function trimSpan(text: string, span: GroupedSpan): GroupedSpan {
  let { start, end } = span;
  while (start < end && /[\s.,;:()"„”»«\-–—]/.test(text[start] ?? '')) start++;
  while (end > start && /[\s.,;:()"„”»«\-–—]/.test(text[end - 1] ?? '')) end--;
  return { ...span, start, end };
}
