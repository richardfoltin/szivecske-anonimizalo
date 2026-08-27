/**
 * A folyamatjelző aránya — végig a láncon.
 *
 * A vezeték sokáig típushelyesen kész volt, de egyetlen hívó hiányzott a
 * futtató ablakciklusából, ezért a felület mindig arány nélküli szakasznevet
 * kapott. Ez pont az a hibafajta, ami ebben a programban visszatér: a
 * fogadóoldal megépül, a termelő nem — és a fordítás nem szól érte.
 *
 * Ezért nem azt mérjük, hogy a mező LÉTEZIK, hanem hogy a jelzés MEGÉRKEZIK,
 * és hogy a számláló monoton nő az utolsó ablakig.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HubertNer } from '../src/ai/hubertNer.js';
import type { AblakHaladas } from '../src/ai/types.js';

const ROOT = process.cwd();
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  rendben — ${name}`);
  } else {
    fail++;
    console.log(`  BUKOTT — ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const ner = new HubertNer({
  modelId: 'nytk',
  repo: 'foltin/nerkor-hubert-hungarian-onnx',
  cacheDir: join(ROOT, '.modellek'),
  labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
});

console.log('');

if (!ner.isInstalled()) {
  console.log('A modell nincs telepítve — a mérés kihagyva.');
  console.log('\nFolyamatjelző: kihagyva (modell nélkül nem mérhető)');
  process.exit(0);
}

await ner.load();

// Elég hosszú szöveg ahhoz, hogy több ablakra essen: az ablak 512 token.
const sample = readFileSync(join(ROOT, 'samples/itelet.txt'), 'utf8');
const hosszu = `${sample}\n\n${sample}`;

const jelzesek: AblakHaladas[] = [];
const ents = await ner.extract(hosszu, { onWindow: (h) => jelzesek.push({ ...h }) });

console.log(`  ${hosszu.length} karakter → ${jelzesek.length} ablak, ${ents.length} találat`);
console.log('');

check('érkezett haladásjelzés', jelzesek.length > 0, 'egy sem');
check('több ablakra esett', jelzesek.length > 1, `${jelzesek.length} ablak`);

const elso = jelzesek[0];
const utolso = jelzesek[jelzesek.length - 1];

check('az első jelzés 1-től indul', elso?.ablak === 1, String(elso?.ablak));
check(
  'az utolsó jelzés eléri az összeset',
  utolso !== undefined && utolso.ablak === utolso.ablakok,
  `${utolso?.ablak}/${utolso?.ablakok}`,
);
check(
  'az ablakok száma végig ugyanaz',
  new Set(jelzesek.map((h) => h.ablakok)).size === 1,
  [...new Set(jelzesek.map((h) => h.ablakok))].join(','),
);
check(
  'a számláló monoton nő, egyesével',
  jelzesek.every((h, i) => h.ablak === i + 1),
  jelzesek.map((h) => h.ablak).join(','),
);
check(
  'a jelzések száma megegyezik az ablakok számával',
  jelzesek.length === (utolso?.ablakok ?? -1),
  `${jelzesek.length} vs ${utolso?.ablakok}`,
);

// Visszahívás nélkül is működnie kell — a jelzés nem lehet kötelező.
const nelkule = await ner.extract(hosszu);
check('visszahívás nélkül is lefut', nelkule.length === ents.length, `${nelkule.length} vs ${ents.length}`);

// Rövid szövegnél egyetlen ablak van, de akkor is jeleznie kell.
const rovid: AblakHaladas[] = [];
await ner.extract('Kovács János felperes.', { onWindow: (h) => rovid.push({ ...h }) });
check('egyetlen ablaknál is jelez', rovid.length === 1 && rovid[0]?.ablakok === 1, JSON.stringify(rovid));

await ner.dispose();

console.log(`\nFolyamatjelző: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
