/**
 * A haladásjelzés a VALÓDI úton: a külön folyamaton át.
 *
 * A futtató önmagában már jelez (`test/haladas-tests.ts`), de a felület nem őt
 * hívja: a modell külön folyamatban fut, és a jelzésnek üzenetként kell
 * átjutnia. Ez a teszt azt a szakaszt méri, amit a másik nem lát.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { ModelClient, type AblakHaladas } from '../src/ai/client.js';
import { MODEL_REGISTRY } from '../src/app/models.js';

const ROOT = process.cwd();
const spec = MODEL_REGISTRY.find((m) => m.id === 'nytk-nerkor-hubert')!;
const dir = join(ROOT, '.modellek', ...spec.repo.split('/'));

console.log('');
if (!existsSync(join(dir, 'model.onnx')) || !existsSync(join(ROOT, 'dist-electron/ai-worker.cjs'))) {
  console.log('A modell vagy a lefordított munkafolyamat hiányzik — a mérés kihagyva.');
  console.log('\nFolyamatjelző a láncon: kihagyva');
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  rendben — ${name}`); }
  else { fail++; console.log(`  BUKOTT — ${name}${detail ? ` (${detail})` : ''}`); }
}

const jelzesek: AblakHaladas[] = [];
const client = new ModelClient({
  workerPath: join(ROOT, 'dist-electron/ai-worker.cjs'),
  config: {
    modelId: spec.id,
    repo: spec.repo,
    cacheDir: join(ROOT, '.modellek'),
    labelMap: spec.labelMap,
    engine: spec.engine,
    dtype: 'q8',
  },
  onProgress: (h) => jelzesek.push({ ...h }),
});

await client.load();
const sample = readFileSync(join(ROOT, 'samples/itelet.txt'), 'utf8');
const r = await client.extract(`${sample}\n\n${sample}`);

console.log(`  ${jelzesek.length} jelzés érkezett át a folyamathatáron, ${r.entities.length} találat`);
console.log('');

check('a jelzés átjut a folyamathatáron', jelzesek.length > 0, 'egy sem érkezett');
check('több ablakról is jelez', jelzesek.length > 1, `${jelzesek.length}`);
check('1-től indul', jelzesek[0]?.ablak === 1, String(jelzesek[0]?.ablak));

const utolso = jelzesek[jelzesek.length - 1];
check(
  'a végén teljes az arány',
  utolso !== undefined && utolso.ablak === utolso.ablakok,
  `${utolso?.ablak}/${utolso?.ablakok}`,
);
check('a sorrend nem keveredik össze', jelzesek.every((h, i) => h.ablak === i + 1));

await client.dispose();

console.log(`\nFolyamatjelző a láncon: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
