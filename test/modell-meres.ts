/**
 * Friss mérés a nyilvántartásban szereplő felismerő modellekre.
 *
 * A modellkártyán tények állnak, tehát a számoknak MÉRTNEK kell lenniük, nem
 * emlékezetből valónak. Ez a futtatás adja azokat a számokat, amik a
 * `src/app/models.ts` leírásaiba kerülnek — ugyanazon a dokumentumon, hogy
 * összevethetők legyenek.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_REGISTRY } from '../src/app/models.js';
import { HubertNer } from '../src/ai/hubertNer.js';
import { TokenClassifier } from '../src/ai/tokenClassifier.js';
import type { EntityExtractor } from '../src/ai/types.js';

const ROOT = process.cwd();
const szoveg = readFileSync(join(ROOT, 'samples/itelet.txt'), 'utf8');

console.log('');
console.log(`mérés: samples/itelet.txt, ${szoveg.length} karakter`);
console.log('');

for (const spec of MODEL_REGISTRY.filter((m) => m.purpose === 'detect')) {
  const dir = join(ROOT, '.modellek', ...spec.repo.split('/'));
  if (!existsSync(dir)) {
    console.log(`${spec.id.padEnd(22)} nincs letöltve — kihagyva`);
    continue;
  }

  const kozos = {
    modelId: spec.id,
    repo: spec.repo,
    cacheDir: join(ROOT, '.modellek'),
    labelMap: spec.labelMap,
  };
  const ner: EntityExtractor =
    spec.engine === 'onnx' ? new HubertNer(kozos) : new TokenClassifier({ ...kozos, dtype: 'q8' });

  const info = await ner.load();
  const t = Date.now();
  const ents = await ner.extract(szoveg);
  const ms = Date.now() - t;
  const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));

  const elcsuszott = ents.filter((e) => szoveg.slice(e.start, e.end) !== e.text).length;
  const fajtank = new Map<string, number>();
  for (const e of ents) fajtank.set(e.label, (fajtank.get(e.label) ?? 0) + 1);

  console.log(`── ${spec.name}`);
  console.log(`   betöltés:   ${info.loadMs} ms`);
  console.log(`   futtatás:   ${ms} ms  (${Math.round(szoveg.length / (ms / 1000))} kar/s)`);
  console.log(`   memória:    ${rss} MB`);
  console.log(`   találat:    ${ents.length}  (${[...fajtank].map(([k, v]) => `${k}: ${v}`).join(', ')})`);
  console.log(`   pozíciók:   ${info.offsets}, elcsúszott: ${elcsuszott}`);
  const unmapped = (ner as { unmappedLabels?: Record<string, number> }).unmappedLabels ?? {};
  const uo = Object.values(unmapped).reduce((a, b) => a + b, 0);
  console.log(`   nem értelmezett címke: ${uo}${uo ? ` (${JSON.stringify(unmapped)})` : ''}`);
  console.log('');

  await ner.dispose();
}
