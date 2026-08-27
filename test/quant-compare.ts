/**
 * A 8 bites és a lebegőpontos modell összevetése.
 *
 * A tömörítés nincs ingyen: a súlyok 8 bitre kerekítve elveszítenek valamennyi
 * pontosságot. Egy kitakaró programnál ezt nem szabad elhinni, csak megmérni.
 * Ami itt számít, az nem az átlagos eltérés, hanem az, hogy VAN-E OLYAN NÉV,
 * amit a tömörített változat nem talál meg. Egy kimaradt név egy kiszivárgott
 * személyazonosság.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HubertNer, type HubertNerConfig } from '../src/ai/hubertNer.js';
import type { ExtractedEntity } from '../src/ai/types.js';

const ROOT = process.cwd();
const SAMPLES = ['itelet', 'keresetlevel', 'kolcsonszerzodes'];
const DIR = join(ROOT, '.modellek/foltin/nerkor-hubert-hungarian-onnx');

const base: Omit<HubertNerConfig, 'fileName'> = {
  modelId: 'nytk-hubert',
  repo: 'foltin/nerkor-hubert-hungarian-onnx',
  cacheDir: join(ROOT, '.modellek'),
  labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
};

const key = (e: ExtractedEntity): string => `${e.start}:${e.end}:${e.label}`;

async function runAll(fileName: string): Promise<{ ms: number; rss: number; byDoc: Map<string, ExtractedEntity[]> }> {
  const ner = new HubertNer({ ...base, fileName });
  await ner.load();
  const byDoc = new Map<string, ExtractedEntity[]>();
  const t0 = Date.now();
  for (const id of SAMPLES) {
    const s = JSON.parse(readFileSync(join(ROOT, `samples/${id}.json`), 'utf8')) as { text: string };
    byDoc.set(id, await ner.extract(s.text));
  }
  const ms = Date.now() - t0;
  const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
  await ner.dispose();
  return { ms, rss, byDoc };
}

const f32Size = statSync(join(DIR, 'model.onnx')).size;
const i8Size = statSync(join(DIR, 'model.int8.onnx')).size;

console.log('');
const f32 = await runAll('model.onnx');
console.log(`lebegőpontos: ${(f32Size / 1048576).toFixed(0)} MB, ${f32.ms} ms, RSS ${f32.rss} MB`);
const i8 = await runAll('model.int8.onnx');
console.log(`8 bites:      ${(i8Size / 1048576).toFixed(0)} MB, ${i8.ms} ms, RSS ${i8.rss} MB`);
console.log(
  `arány:        ${(f32Size / i8Size).toFixed(2)}× kisebb, ${(f32.ms / i8.ms).toFixed(2)}× gyorsabb`,
);

let missing = 0;
let extra = 0;
let total = 0;

console.log('');
for (const id of SAMPLES) {
  const a = f32.byDoc.get(id)!;
  const b = i8.byDoc.get(id)!;
  const aKeys = new Set(a.map(key));
  const bKeys = new Set(b.map(key));

  const lost = a.filter((e) => !bKeys.has(key(e)));
  const gained = b.filter((e) => !aKeys.has(key(e)));
  missing += lost.length;
  extra += gained.length;
  total += a.length;

  console.log(`${id.padEnd(18)} ${a.length} → ${b.length} találat, kimaradt ${lost.length}, új ${gained.length}`);
  for (const e of lost) console.log(`   KIMARADT: [${e.label}] „${e.text}" (${e.score.toFixed(3)})`);
  for (const e of gained) console.log(`   ÚJ:       [${e.label}] „${e.text}" (${e.score.toFixed(3)})`);
}

console.log('');
console.log(`Összesen ${total} találat: ${missing} kimaradt, ${extra} új.`);

// Egy kimaradt SZEMÉLYNÉV önmagában elegendő ok arra, hogy a tömörített
// változatot ne szállítsuk. A hely- és szervezetnevek eltérése enyhébb, de azt
// is látni akarjuk.
const lostPersons = SAMPLES.flatMap((id) => {
  const bKeys = new Set(i8.byDoc.get(id)!.map(key));
  return f32.byDoc.get(id)!.filter((e) => e.label === 'person' && !bKeys.has(key(e)));
});

console.log('');
if (lostPersons.length > 0) {
  console.log(`DÖNTÉS: a 8 bites változat NEM lehet az alapértelmezés.`);
  console.log(`Elveszít ${lostPersons.length} személynév-említést:`);
  for (const e of lostPersons) console.log(`  „${e.text}" (${e.score.toFixed(3)})`);
  console.log(
    'Cserébe negyedakkora és gyorsabb — de egy anonimizálóban a kimaradt név\n' +
      'kiszivárgott személyazonosság, ez pedig nem váltható meg lemezhellyel.',
  );
  process.exit(1);
}
console.log('DÖNTÉS: a 8 bites változat egyetlen személynevet sem veszít el, szállítható.');
