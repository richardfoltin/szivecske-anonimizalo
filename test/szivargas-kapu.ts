/**
 * A legfontosabb biztonsági tulajdonság: SZIVÁRGÁSNÁL NE KELETKEZZEN FÁJL.
 *
 * Korábban a kiírás az ellenőrzés ELŐTT futott, tehát a program akkor is a
 * lemezen hagyta a kimenetet, ha az ellenőrzés eredeti nevet talált benne — és
 * közben a felületen az állt, hogy visszaolvastuk a mentett fájlt, és tiszta.
 * A felhasználó egy olyan fájlt kapott a kezébe, amiről azt hitte, kitakart.
 *
 * Ez a teszt szándékosan HIÁNYOS félsorral futtat: a „Nagy Péter" nincs a felek
 * között, tehát a neve bent marad. Ilyenkor a mentésnek meg kell tagadnia a
 * fájlt.
 */

import { existsSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
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

// Szándékosan HIÁNYOS: a „Nagy Péter" kimarad, tehát a neve bent marad.
const parties: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
];

const src = join(ROOT, 'spike/out/keresetlevel.pdf');
const out = join(ROOT, 'spike/out/szivargas-kapu.pdf');
rmSync(out, { force: true });

const s = await DocumentSession.open(src, homonyms);
s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt' }, theme, homonyms);

let dobott = false;
let uzenet = '';
let report: { ok: boolean; leaks: { surface: string }[] } | null = null;
try {
  const r = await s.export({ mode: 'theme', keepKey: false, outputPath: out });
  report = r.report;
} catch (e) {
  dobott = true;
  uzenet = (e as Error).message;
}

const fajlVan = existsSync(out);

console.log('');
console.log(`A mentés megtagadta magát:  ${dobott ? 'IGEN' : 'NEM'}`);
if (dobott) console.log(`  üzenet: ${uzenet.slice(0, 110)}`);
if (report) console.log(`  jelentés: ok=${report.ok}, ${report.leaks.length} bennmaradt név`);
console.log(`Keletkezett kimeneti fájl:  ${fajlVan ? 'IGEN — EZ HIBA' : 'nem'}`);

const checks: [string, boolean][] = [
  // Vagy dob, vagy tisztán jelenti a szivárgást — de a fájl semmiképp nem
  // maradhat a lemezen, mert azt a felhasználó kitakartnak hinné.
  ['szivárgásnál nem keletkezik kimeneti fájl', !fajlVan],
  ['a szivárgás nem marad néma', dobott || (report !== null && !report.ok)],
];

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    bad++;
    console.log(`  BUKOTT: ${name}`);
  }
}
rmSync(out, { force: true });
console.log(`\nSzivárgás-kapu: ${checks.length - bad}/${checks.length} ellenőrzés rendben`);
process.exit(bad === 0 ? 0 : 1);
