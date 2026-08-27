/**
 * A LÁNC végigmérése: felismerés → elemzés → csere → mentés → jegyzőkönyv.
 *
 *   npx tsx test/lanc-tesztek.ts
 *
 * Ez a teszt egyetlen hibaosztályra készült, amiből a programban több példány
 * is volt: a FOGADÓOLDAL megvan (mező, magyar mondat, jegyzőkönyv-sor), a
 * TERMELŐ oldal viszont hiányzik, ezért a mező üresen érkezik, a kód olvasva
 * késznek látszik, és a funkció mégsem működik.
 *
 * Amit itt mérünk, azt kizárólag a KÉSZ KIMENETBŐL olvassuk vissza: a mentett
 * fájlt újra megnyitjuk, és abban keressük az eredeti azonosítókat. A
 * szándékszöveg erre nem alkalmas — az azt tartalmazza, amit MI állítottunk
 * elő, tehát önmagát igazolná vissza.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import { detectParties } from '../src/app/detect.js';
import type { PartyInput } from '../src/app/types.js';
import type { ExtractedEntity } from '../src/ai/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/asvanyok.json'), 'utf8')) as Theme;
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/*
  A felek listája SZÁNDÉKOSAN csak neveket tartalmaz — pontosan azt, amit a
  felület ma átad. Az azonosítókat (e-mail, lakcím, TAJ, bankszámla) senki nem
  teszi bele; ha a motor nem veszi fel őket magától, változatlanul bent
  maradnak a kimenetben.
*/
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

const src = join(ROOT, 'spike/out/keresetlevel.pdf');
const out = join(ROOT, 'spike/out/lanc-teszt.pdf');
const cert = join(ROOT, 'spike/out/lanc-teszt-jegyzokonyv.txt');
rmSync(out, { force: true });
rmSync(cert, { force: true });

/* ================================================================== *
 *  1. AZ AZONOSÍTÓK ELJUTNAK A CSERÉIG
 * ================================================================== */

console.log('');
console.log('AZONOSÍTÓK VÉGIG A LÁNCON');
console.log('');

const session = await DocumentSession.open(src, homonyms);
const first = session.analyze(
  { parties, themeId: theme.id, mode: 'theme', caseSecret: 'lanc-teszt' },
  theme,
  homonyms,
);

const azonositoSorok = first.cast.filter((c) => c.kind === 'identifier');
check('az azonosítók bekerülnek a szereplapra', azonositoSorok.length > 0, `${azonositoSorok.length} sor`);

// Az ügyvéd végigdönti az átnézésre váró találatokat: elfogad mindent, ahogy
// egy valódi kitakarásnál tenné.
const decisions: Record<number, 'accept' | 'skip'> = {};
for (const m of first.matches) {
  if (m.disposition !== 'auto') decisions[m.id] = 'accept';
}
session.analyze(
  { parties, themeId: theme.id, mode: 'theme', caseSecret: 'lanc-teszt', decisions },
  theme,
  homonyms,
);

const exported = await session.export({ mode: 'theme', keepKey: false, outputPath: out });
check('a mentés lefutott, a fájl elkészült', exported.written && existsSync(out));
check('az ellenőrző kör tiszta', exported.report.ok, exported.report.leaks.map((l) => l.surface).join(', '));

// A BIZONYÍTÉK: a KÉSZ FÁJLT olvassuk vissza, nem a szándékszöveget.
const readback = await DocumentSession.open(out, homonyms);
const kimenet = readback.fullText();

const EREDETI: { mit: string; alak: string; cimke: string }[] = [
  { mit: 'e-mail cím', alak: 'kovacs.janos58@freemail.hu', cimke: '[e-mail cím]' },
  { mit: 'lakcím', alak: '2000 Szentendre, Bükkös part 14.', cimke: '[lakcím]' },
  { mit: 'TAJ-szám', alak: '111 111 110', cimke: '[TAJ-szám]' },
  { mit: 'adóazonosító jel', alak: '8442130976', cimke: '[adóazonosító jel]' },
  { mit: 'bankszámlaszám', alak: '10402142-49575354-56561008', cimke: '[bankszámlaszám]' },
];

const forras = session.fullText();
for (const e of EREDETI) {
  // Előbb a kiindulás: ha a forrásban nincs benne, a teszt semmit nem mérne.
  check(`a forrásiratban ott van a(z) ${e.mit}`, forras.includes(e.alak));
  check(`a kimenetből ELTŰNT a(z) ${e.mit} („${e.alak}")`, !kimenet.includes(e.alak));
  check(`a kimenetben ott áll a(z) ${e.cimke} megjelölés`, kimenet.includes(e.cimke));
}

console.log(`  szereplap: ${azonositoSorok.length} azonosító`);
for (const c of azonositoSorok.slice(0, 5)) {
  console.log(`    ${c.original.padEnd(38)} → ${c.replacement}`);
}
console.log(`  a kész fájlban ellenőrizve: ${EREDETI.length} eredeti azonosító`);

/* ================================================================== *
 *  2. A MODELL ÁLLAPOTA ELJUT A JEGYZŐKÖNYVIG
 * ================================================================== */

console.log('');
console.log('A MODELL ÁLLAPOTA');
console.log('');

/**
 * A modell nyers találatai, ahogy a futtató (`ai/worker.ts`) visszaadja.
 * A harmadik szándékosan 'other' címkéjű: a program nem tud belőle felet
 * csinálni, tehát eldobja — de ezt KI KELL MONDANIA.
 */
const modelEntities: ExtractedEntity[] = [
  { start: forras.indexOf('Nagy Péter'), end: forras.indexOf('Nagy Péter') + 10, text: 'Nagy Péter', label: 'person', rawLabel: 'PER', score: 0.99 },
  { start: forras.indexOf('Kovács János'), end: forras.indexOf('Kovács János') + 12, text: 'Kovács János', label: 'person', rawLabel: 'PER', score: 0.99 },
  { start: 0, end: 5, text: 'Fővám', label: 'other', rawLabel: 'MISC', score: 0.91 },
  { start: 6, end: 11, text: 'Duna', label: 'other', rawLabel: 'MISC', score: 0.88 },
  { start: 12, end: 17, text: 'Tisza', label: 'other', rawLabel: 'DATE', score: 0.77 },
];

const felismert = detectParties(forras, { modelEntities, homonyms });
check('a felismerés kitölti a modell állapotát', felismert.model.state === 'ok', felismert.model.state);
check('a modell találatainak száma megvan', felismert.model.entityCount === modelEntities.length, String(felismert.model.entityCount));
check('a nem értelmezett találatokat megszámoltuk', felismert.model.unmappedLabels === 3, String(felismert.model.unmappedLabels));
check(
  'a nem értelmezett találatok FAJTÁNKÉNT is megvannak',
  felismert.model.unmappedByLabel?.MISC === 2 && felismert.model.unmappedByLabel?.DATE === 1,
  JSON.stringify(felismert.model.unmappedByLabel),
);

// A hívó által ismert ok (nincs telepítve) erősebb: azt nem írjuk felül.
const nincsTelepitve = detectParties(forras, { model: { state: 'missing' } });
check('a hívó által megadott állapot marad', nincsTelepitve.model.state === 'missing', nincsTelepitve.model.state);
const kikapcsolva = detectParties(forras, {});
check('modell-találat nélkül az állapot: kikapcsolva', kikapcsolva.model.state === 'off', kikapcsolva.model.state);

// És most a lényeg: eljut-e a JEGYZŐKÖNYVIG.
session.analyze(
  { parties, themeId: theme.id, mode: 'theme', caseSecret: 'lanc-teszt', decisions, model: felismert.model },
  theme,
  homonyms,
);
const modellel = await session.export({ mode: 'theme', keepKey: false, outputPath: out });
const modellSor = modellel.certificate.split('\n').find((l) => l.startsWith('Nyelvi modell:')) ?? '';
check('a jegyzőkönyv szerint a modell FUTOTT', modellSor.includes('futott (5 találat)'), modellSor);
check('a jegyzőkönyv kiírja a nem értelmezett találatokat', modellSor.includes('MISC: 2') && modellSor.includes('DATE: 1'), modellSor);
console.log(`  ${modellSor.trim()}`);

session.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'lanc-teszt', decisions }, theme, homonyms);
const modellNelkul = await session.export({ mode: 'theme', keepKey: false, outputPath: out });
const kikapcsoltSor = modellNelkul.certificate.split('\n').find((l) => l.startsWith('Nyelvi modell:')) ?? '';
check('modell nélkül a jegyzőkönyv ezt mondja ki', kikapcsoltSor.includes('NEM FUTOTT'), kikapcsoltSor);
console.log(`  ${kikapcsoltSor.trim()}`);

/* ================================================================== *
 *  3. AZ EXPORT FIGYELMEZTETÉSEI ÉS A JEGYZŐKÖNYV ÚTVONALA
 * ================================================================== */

console.log('');
console.log('AMI A MENTÉSSEL KELETKEZIK');
console.log('');

check('az export visszaadja a figyelmeztetéseket', Array.isArray(modellNelkul.warnings));
check('van is mit visszaadnia', modellNelkul.warnings.length > 0, `${modellNelkul.warnings.length} db`);

// A jegyzőkönyv FIGYELMEZTETÉSEK rovata és a felületre visszaadott lista
// ugyanaz — ha elcsúsznának, a felhasználó mást olvasna a képernyőn, mint a
// fájlban.
const jegyzokonyvSorok = modellNelkul.certificate
  .split('\n')
  .filter((l) => l.startsWith('  - '))
  .map((l) => l.slice(4));
check(
  'a jegyzőkönyv és a felület ugyanazt a listát kapja',
  jegyzokonyvSorok.length === modellNelkul.warnings.length,
  `jegyzőkönyv ${jegyzokonyvSorok.length}, felület ${modellNelkul.warnings.length}`,
);

check('az export megmondja a jegyzőkönyv útvonalát', modellNelkul.certificatePath !== null, String(modellNelkul.certificatePath));
check(
  'és a jegyzőkönyv tényleg ott van',
  modellNelkul.certificatePath !== null && existsSync(modellNelkul.certificatePath),
);
console.log(`  jegyzőkönyv: ${modellNelkul.certificatePath}`);
for (const w of modellNelkul.warnings.slice(0, 3)) console.log(`  figyelmeztetés: ${w.slice(0, 96)}`);

/* ================================================================== *
 *  4. A SZIGOR NEM FORDULHAT ÁT HAMIS RIASZTÁSBA
 * ================================================================== */

console.log('');
console.log('HAMIS RIASZTÁS ELKERÜLÉSE');
console.log('');

/*
  A bent maradt azonosítókra futó kör szóhatárt követel — ugyanazt a szabályt,
  amit a verify.ts használ. Enélkül a tízjegyű adóazonosítót kihasítanánk egy
  tizenegy jegyű számsor közepéből, a mentés elbukna, és a felhasználótól a
  SAJÁT ÓVATOSSÁGUNK venné el a kész iratot.
*/
const csapda =
  'Az alperes adóazonosító jele: 8000000008.\n' +
  'A könyvelés a 18000000008 tételszám alatt tartja nyilván.\n' +
  'Kovács János felperes keresetet nyújtott be.\n';
const csapdaOut = join(ROOT, 'spike/out/lanc-hatar.txt');
rmSync(csapdaOut, { force: true });

const csapdaSession = await DocumentSession.fromBytes(
  join(ROOT, 'spike/out/lanc-hatar-forras.txt'),
  Buffer.from(csapda, 'utf8'),
  homonyms,
);
const csapdaElemzes = csapdaSession.analyze(
  { parties: [parties[0]!], themeId: theme.id, mode: 'theme', caseSecret: 'hatar' },
  theme,
  homonyms,
);
const csapdaDontes: Record<number, 'accept' | 'skip'> = {};
for (const m of csapdaElemzes.matches) if (m.disposition !== 'auto') csapdaDontes[m.id] = 'accept';
csapdaSession.analyze(
  { parties: [parties[0]!], themeId: theme.id, mode: 'theme', caseSecret: 'hatar', decisions: csapdaDontes },
  theme,
  homonyms,
);
const csapdaMentes = await csapdaSession.export({ mode: 'theme', keepKey: false, outputPath: csapdaOut });
// Ha a szigor hamis riasztásba fordul, fájl sem keletkezik — akkor sem szabad
// kivétellel elszállni, mert a hibaüzenetből kell látszania, MI romlott el.
const csapdaSzoveg = existsSync(csapdaOut) ? readFileSync(csapdaOut, 'utf8') : '';

check(
  'a hosszabb számsor NEM minősül bennmaradt adóazonosítónak',
  csapdaMentes.report.ok,
  csapdaMentes.report.leaks.map((l) => `${l.surface}: ${l.detail}`).join(' | '),
);
check('az adóazonosító viszont eltűnt', !csapdaSzoveg.includes('8000000008.'), csapdaSzoveg);
check('a tételszám a helyén maradt', csapdaSzoveg.includes('18000000008'));
console.log(`  kimenet: ${csapdaSzoveg.split('\n')[1]}`);

rmSync(csapdaOut, { force: true });
rmSync(join(ROOT, 'spike/out/lanc-hatar-jegyzokonyv.txt'), { force: true });

/* ================================================================== *
 *  ÖSSZEGZÉS
 * ================================================================== */

rmSync(out, { force: true });
for (const p of [cert, join(ROOT, 'spike/out/lanc-teszt-jegyzokonyv-2.txt')]) rmSync(p, { force: true });

console.log('');
if (failures.length) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
}
console.log(`A lánc végig: ${pass}/${pass + fail} ellenőrzés rendben`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
