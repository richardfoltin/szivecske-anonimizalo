/**
 * A modell letöltése a közzétett tárolóból — VALÓDI hálózattal.
 *
 * Nem azt méri, hogy a nyilvántartásban jó cím áll (azt a fordítás is látná),
 * hanem hogy a fájlok TÉNYLEG ott vannak, token nélkül elérhetők, és a
 * bájtjaik megegyeznek azzal, amit a programmal együtt mértünk. Egy elgépelt
 * tárolónév vagy egy privátra állított tároló ugyanúgy fordul — csak a
 * felhasználó gépén derülne ki, első indításkor.
 *
 * A 440 MB-os hálófájlt nem töltjük le: elég a fejlécéből a méret. A kis
 * fájlokat viszont teljesen leszedjük és összevetjük a helyi példánnyal.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MODEL_REGISTRY } from '../src/app/models.js';

const ROOT = process.cwd();
const spec = MODEL_REGISTRY.find((m) => m.id === 'nytk-nerkor-hubert')!;

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

const url = (f: string): string => `https://huggingface.co/${spec.repo}/resolve/main/${f}`;

console.log('');
console.log(`tároló: ${spec.repo}`);
console.log(`forrás: ${spec.source}`);
console.log('');

check('a nyilvántartás letölthetőnek jelöli', spec.source === 'hub', spec.source);

// A hálófájl: elég a fejléc, a 440 MB letöltése itt fölösleges volna.
try {
  const fej = await fetch(url('model.onnx'), { method: 'HEAD', redirect: 'follow' });
  const meret = Number(fej.headers.get('content-length') ?? 0);
  const vart = spec.files.find((f) => f.path === 'model.onnx')?.bytes ?? -1;
  check('a hálófájl token nélkül elérhető', fej.ok, `HTTP ${fej.status}`);
  check('a mérete egyezik a nyilvántartással', meret === vart, `${meret} vs ${vart}`);
} catch (e) {
  check('a hálófájl token nélkül elérhető', false, (e as Error).message);
}

// A kis fájlok: teljesen leszedjük, és bájtra összevetjük a helyivel.
const dir = join(ROOT, '.modellek', ...spec.repo.split('/'));
for (const nev of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
  try {
    const r = await fetch(url(nev), { redirect: 'follow' });
    if (!r.ok) {
      check(`letölthető: ${nev}`, false, `HTTP ${r.status}`);
      continue;
    }
    const tavoli = Buffer.from(await r.arrayBuffer());
    check(`letölthető: ${nev}`, true);

    const helyiUt = join(dir, nev);
    if (!existsSync(helyiUt)) {
      console.log(`     (helyi példány nincs, az összevetés kimarad)`);
      continue;
    }
    const helyi = readFileSync(helyiUt);
    const a = createHash('sha256').update(tavoli).digest('hex');
    const b = createHash('sha256').update(helyi).digest('hex');
    check(`bájtra azonos a helyivel: ${nev}`, a === b, `${a.slice(0, 12)} vs ${b.slice(0, 12)}`);
  } catch (e) {
    check(`letölthető: ${nev}`, false, (e as Error).message);
  }
}

// A telepítő már NEM viszi a modellt — ha mégis, a 440 MB fölöslegesen ott van.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  build?: { extraResources?: { from: string }[] };
};
check(
  'a telepítő nem viszi magával a modellt',
  !(pkg.build?.extraResources ?? []).some((x) => x.from === '.modellek'),
);

console.log(`\nModell letöltése: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
