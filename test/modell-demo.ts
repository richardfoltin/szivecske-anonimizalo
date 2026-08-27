/**
 * A modell útja egy mondaton, lépésről lépésre.
 *
 * Nem teszt, hanem szemléltetés: megmutatja, mi történik a nyers szöveggel a
 * tokenizálástól a kész tartományokig, és külön kiírja azt a két pontot, ahol
 * a kézenfekvő megoldás elromlana.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WordPieceTokenizer, slidingWindows } from '../src/ai/wordpiece.js';
import { HubertNer } from '../src/ai/hubertNer.js';

const ROOT = process.cwd();
const DIR = join(ROOT, '.modellek/foltin/nerkor-hubert-hungarian-onnx');

const MONDAT =
  'Nagy a kockázat, ezért Kovács Jánosné és Szabóval szemben a Szentendrei Járásbíróság előtt Nagy Péter pert indított.';

console.log('\n══ BEMENET ══════════════════════════════════════════════════');
console.log(MONDAT);
console.log(`(${MONDAT.length} karakter)`);

// ── 1. Tokenizálás ────────────────────────────────────────────────────────
const { tokenizer } = WordPieceTokenizer.fromTokenizerJson(
  readFileSync(join(DIR, 'tokenizer.json'), 'utf8'),
);
const tokens = tokenizer.tokenize(MONDAT);

console.log('\n══ 1. TOKENIZÁLÁS ═══════════════════════════════════════════');
console.log(`${MONDAT.split(/\s+/).length} szó → ${tokens.length} token`);
console.log('\n  token          szó#  szókezdet  karakterpozíció');
for (const t of tokens.slice(0, 14)) {
  console.log(
    `  ${t.text.padEnd(14)} ${String(t.wordIndex).padStart(3)}   ${t.isWordStart ? 'IGEN ' : ' nem '}    ${String(t.start).padStart(3)}..${String(t.end).padEnd(3)}  „${MONDAT.slice(t.start, t.end)}”`,
  );
}
console.log('  …');

// ── 2. Ablakolás ──────────────────────────────────────────────────────────
const windows = slidingWindows(tokens, tokenizer.clsId, tokenizer.sepId, 512, 128);
console.log('\n══ 2. ABLAKOLÁS ═════════════════════════════════════════════');
console.log(`${tokens.length} token → ${windows.length} ablak (512 hosszú, 128 átfedés)`);

// ── 3. A háló nyers ítélete tokenenként ──────────────────────────────────
const ort = (await import('onnxruntime-node')) as unknown as {
  InferenceSession: { create(p: string, o: Record<string, unknown>): Promise<OrtSession> };
  Tensor: new (t: string, d: BigInt64Array, dims: number[]) => unknown;
};
interface OrtSession {
  run(f: Record<string, unknown>): Promise<Record<string, { data: Float32Array; dims: readonly number[] }>>;
  inputNames: string[];
  release?(): Promise<void>;
}

const cfg = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8')) as {
  id2label: Record<string, string>;
};
const session = await ort.InferenceSession.create(join(DIR, 'model.onnx'), {
  executionProviders: ['cpu'],
  graphOptimizationLevel: 'all',
});

const w = windows[0]!;
const len = w.ids.length;
const feeds: Record<string, unknown> = {
  input_ids: new ort.Tensor('int64', BigInt64Array.from(w.ids.map(BigInt)), [1, len]),
  attention_mask: new ort.Tensor('int64', BigInt64Array.from(w.ids.map(() => 1n)), [1, len]),
};
if (session.inputNames.includes('token_type_ids')) {
  feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(len), [1, len]);
}
const out = await session.run(feeds);
const logits = out.logits ?? Object.values(out)[0]!;
const nLab = logits.dims[2] as number;

console.log('\n══ 3. A HÁLÓ ÍTÉLETE TOKENENKÉNT ════════════════════════════');
console.log(`  a háló ${nLab} osztályra ad pontszámot: ${Object.values(cfg.id2label).join(', ')}`);
console.log('\n  token          szókezdet  címke    valószínűség   megjegyzés');

for (let i = 0; i < len; i++) {
  const tok = w.tokens[i];
  if (!tok) continue;
  let best = 0;
  let bv = -Infinity;
  for (let k = 0; k < nLab; k++) {
    const v = logits.data[i * nLab + k]!;
    if (v > bv) { bv = v; best = k; }
  }
  let sum = 0;
  for (let k = 0; k < nLab; k++) sum += Math.exp(logits.data[i * nLab + k]! - bv);
  const p = 1 / sum;
  const label = cfg.id2label[String(best)] ?? 'O';

  // Csak az érdekes tokeneket írjuk ki: a névhez tartozókat és a csapdákat.
  const erdekes =
    /Nagy|Kov|János|##né|Szabó|##val|Szent|Jár|Péter|kockázat/.test(tok.text) || label !== 'O';
  if (!erdekes) continue;

  let megj = '';
  if (!tok.isWordStart) megj = `KIHAGYVA — betanítatlan folytatás`;
  if (tok.text === '##né' || tok.text === '##val') megj = `KIHAGYVA — ha nem lenne, „${tok.text.slice(2)}” bent maradna!`;
  if (tok.text === 'Nagy' && tok.start === 0) megj = 'a mondat eleji köznév';

  console.log(
    `  ${tok.text.padEnd(14)} ${tok.isWordStart ? 'IGEN ' : ' nem '}     ${label.padEnd(7)}  ${p.toFixed(4)}       ${megj}`,
  );
}
await session.release?.();

// ── 4. A kész tartományok ────────────────────────────────────────────────
const ner = new HubertNer({
  modelId: 'nytk',
  repo: 'foltin/nerkor-hubert-hungarian-onnx',
  cacheDir: join(ROOT, '.modellek'),
  labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
});
await ner.load();
const t0 = Date.now();
const ents = await ner.extract(MONDAT);
const ms = Date.now() - t0;

console.log('\n══ 4. A KÉSZ TARTOMÁNYOK ════════════════════════════════════');
console.log(`  ${ms} ms\n`);
for (const e of ents) {
  const vissza = MONDAT.slice(e.start, e.end);
  console.log(
    `  ${String(e.start).padStart(3)}..${String(e.end).padEnd(3)} ${e.label.padEnd(7)} ${e.score.toFixed(4)}  „${e.text}”` +
      `${vissza === e.text ? '' : '  ← ELCSÚSZOTT'}`,
  );
}

const kozNev = ents.find((e) => e.start === 0);
console.log(`\n  a mondat eleji „Nagy” köznév névnek jelölve? ${kozNev ? 'IGEN — HIBA' : 'nem'}`);
const nevJ = ents.find((e) => e.text.includes('Jánosné'));
console.log(`  a „Kovács Jánosné” egyben van? ${nevJ ? `igen: „${nevJ.text}”` : 'NINCS — HIBA'}`);

await ner.dispose();
console.log('');
