/**
 * A modell KÜLÖN FOLYAMATBAN futtatva — ugyanazon az úton, ahogy az
 * alkalmazás használja. Ez azt ellenőrzi, hogy a lefordított munkafolyamat
 * elindul, betölti a modellt, választ ad, és a végén tényleg elengedi a memóriát.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelClient } from '../src/ai/client.js';
import { MODEL_REGISTRY } from '../src/app/models.js';

const spec = MODEL_REGISTRY[0]!;
const text = readFileSync(join(process.cwd(), 'samples/itelet.txt'), 'utf8');

const client = new ModelClient({
  workerPath: join(process.cwd(), 'dist-electron/ai-worker.cjs'),
  config: {
    modelId: spec.id,
    repo: spec.repo,
    cacheDir: join(process.cwd(), '.modellek'),
    labelMap: spec.labelMap,
    engine: spec.engine,
    dtype: 'q8',
  },
});

const before = Math.round(process.memoryUsage().rss / (1024 * 1024));
const info = await client.load();
console.log(`Betöltve külön folyamatban: ${info.repo}, ${info.loadMs} ms, pozíciók: ${info.offsets}`);

const r = await client.extract(text);
console.log(`Futtatás: ${text.length} karakter → ${r.entities.length} entitás, ${r.ms} ms`);

const persons = [...new Set(r.entities.filter((e) => e.label === 'person').map((e) => e.text))];
console.log(`Személynevek (${persons.length}): ${persons.slice(0, 14).join(' | ')}`);

const bad = r.entities.filter((e) => text.slice(e.start, e.end) !== e.text);
console.log(`Elcsúszott pozíció: ${bad.length}`);

const parentRss = Math.round(process.memoryUsage().rss / (1024 * 1024));
console.log(`A SZÜLŐ folyamat memóriája: ${before} MB → ${parentRss} MB (a modell nem itt van)`);

await client.dispose();
console.log(`Elengedve. Fut még? ${client.running}`);
