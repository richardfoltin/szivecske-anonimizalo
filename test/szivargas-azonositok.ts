/**
 * A kész fájlban egyetlen azonosító sem maradhat bent.
 *
 * Ez nem a felismerőt méri (azt a `test/azonosito-tests.ts` teszi), hanem a
 * LÁNC VÉGÉT: azt, hogy a felismert azonosító tényleg eltűnik a lemezre írt
 * iratból. A kettő nem ugyanaz — a program egy ideig hibátlanul felismerte az
 * azonosítókat, majd külön listában adta vissza őket, amit a csere sosem
 * kapott meg. A felismerő tesztje közben végig zöld volt.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentSession } from '../src/app/session.js';
import type { PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/kokorszak.json'), 'utf8')) as Theme;
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

const parties: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  { id: 'p1n', kind: 'person', fullName: 'Kovács Jánosné', gender: 'F', role: 'egyéb' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
  { id: 'p3', kind: 'person', fullName: 'Szabó Márton', gender: 'M', role: 'II. r. alperes' },
  { id: 'p4', kind: 'person', fullName: 'Kiss Erika', gender: 'F', role: 'tanú' },
  { id: 'p5', kind: 'person', fullName: 'özv. Baloghné Fehér Ilona', gender: 'F', role: 'tanú' },
  { id: 'p6', kind: 'person', fullName: 'ifj. Balogh Gábor', gender: 'M', role: 'tanú' },
  { id: 'p7', kind: 'person', fullName: 'dr. Bach Tivadar', gender: 'M', role: 'egyéb' },
  { id: 'p8', kind: 'org', fullName: 'Aranykalász Agrár Kft.', gender: 'N', role: 'egyéb' },
  { id: 'p9', kind: 'org', fullName: 'Hármashatár Ingatlanforgalmazó Zrt.', gender: 'N', role: 'egyéb' },
];

/** Az az adat, amit a kimenetben MEGTALÁLNI hiba. */
const TILTOTT: [string, string][] = [
  ['e-mail cím', 'kovacs.janos58@freemail.hu'],
  ['TAJ-szám', '111 111 110'],
  ['adóazonosító jel', '8442130976'],
  ['bankszámlaszám', '10402142-49575354-56561008'],
  ['lakcím', 'Bükkös part 14.'],
  ['telefonszám', '+36 30 412 7758'],
];

const out = join(ROOT, 'spike/out/szivargas-azonositok.pdf');
rmSync(out, { force: true });

const s = await DocumentSession.open(join(ROOT, 'spike/out/keresetlevel.pdf'), homonyms);
const forras = s.fullText();

const a = s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt' }, theme, homonyms);
// Az átnézésre váró találatokat elfogadjuk: a jogász is ezt tenné, és minket
// most a lánc vége érdekel, nem a küszöbölés.
const decisions: Record<number, 'accept' | 'skip'> = {};
for (const m of a.matches) if (m.disposition === 'review') decisions[m.id] = 'accept';
s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt', decisions }, theme, homonyms);

const r = await s.export({ mode: 'theme', keepKey: false, outputPath: out });
const kimenet = s.anonymizedText();

console.log('');
console.log(`Mentés: ${r.report.ok ? 'tiszta' : `${r.report.leaks.length} bennmaradt név`}`);

let pass = 0;
let fail = 0;
for (const [cimke, ertek] of TILTOTT) {
  // Csak azt kérjük számon, ami a FORRÁSBAN tényleg benne van.
  if (!forras.includes(ertek)) {
    console.log(`  (kihagyva: „${ertek}" nincs a forrásban)`);
    continue;
  }
  const bent = kimenet.includes(ertek);
  if (bent) {
    fail++;
    console.log(`  SZIVÁRGÁS — ${cimke}: „${ertek}" bent maradt a kimenetben`);
  } else {
    pass++;
    console.log(`  rendben — ${cimke}: eltűnt`);
  }
}

rmSync(out, { force: true });
console.log(`\nAzonosítók a kimenetben: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
