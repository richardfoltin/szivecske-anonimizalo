/**
 * A határozott névelő igazítása a csere után.
 *
 * Magyarul a névelő a KÖVETKEZŐ szó kezdőhangjától függ: „a Kovács", de „az
 * Aranyos". Ha a csere magánhangzóval kezdődő álnevet tesz egy mássalhangzóval
 * kezdődő név helyére, a mondat elé ragadt „a" hibás lesz — és fordítva.
 *
 * Ez nem szépséghiba: egy ügyvéd az első bekezdésben észreveszi, és onnantól
 * nem bízik a programban. Ráadásul árulkodó is — aki tudja, hogy a csere
 * gépi, a rossz névelőből meg tudja mondani, hol volt eredetileg név.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentSession } from '../src/app/session.js';
import type { PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));
const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/asvanyok.json'), 'utf8')) as Theme;

let pass = 0;
let fail = 0;

/** A szövegben nem maradhat magánhangzó előtt „a", mássalhangzó előtt „az". */
function nevelohibak(szoveg: string): string[] {
  const out: string[] = [];
  // Csak a felismerhetően névelős helyzeteket nézzük: névelő + nagybetűs szó.
  const re = /(^|[\s(„"])(a|az|A|Az)\s+([A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű-]+)/g;
  for (const m of szoveg.matchAll(re)) {
    const nevelo = (m[2] ?? '').toLowerCase();
    const szo = m[3] ?? '';
    const maganhangzoval = /^[AÁEÉIÍOÓÖŐUÚÜŰaáeéiíoóöőuúüű]/.test(szo);
    const kell = maganhangzoval ? 'az' : 'a';
    if (nevelo !== kell) out.push(`„${nevelo} ${szo}” — helyesen: „${kell} ${szo}”`);
  }
  return out;
}

const parties: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
  { id: 'p3', kind: 'person', fullName: 'Szabó Márton', gender: 'M', role: 'II. r. alperes' },
];

// Szándékosan olyan mondatok, ahol a névelő a névhez tapad.
const SZOVEG = [
  'A keresetlevelet a Kovács János nyújtotta be a bírósághoz.',
  'A tárgyaláson a Nagy Péter és a Szabó Márton is megjelent.',
  'A bíróság a Kovács János keresetét elutasította.',
].join('\n');

const s = await DocumentSession.fromBytes('nevelo.txt', new TextEncoder().encode(SZOVEG), homonyms);
const a = s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'nevelo' }, theme, homonyms);
const decisions: Record<number, 'accept' | 'skip'> = {};
for (const m of a.matches) if (m.disposition === 'review') decisions[m.id] = 'accept';
s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'nevelo', decisions }, theme, homonyms);

const kimenet = s.anonymizedText();

console.log('');
console.log('KIMENET:');
for (const sor of kimenet.split('\n')) console.log('  ' + sor);

const hibak = nevelohibak(kimenet);
console.log('');
if (hibak.length) {
  for (const h of hibak) console.log(`  NÉVELŐHIBA: ${h}`);
} else {
  console.log('  nincs névelőhiba');
}

if (hibak.length === 0) pass++;
else fail++;

// A bemenet maga legyen hibátlan — különben nem a cserét mérnénk.
const bemenetiHibak = nevelohibak(SZOVEG);
if (bemenetiHibak.length === 0) pass++;
else {
  fail++;
  console.log(`  A BEMENET is hibás: ${bemenetiHibak.join(' | ')}`);
}

console.log(`\nHatározott névelő: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
