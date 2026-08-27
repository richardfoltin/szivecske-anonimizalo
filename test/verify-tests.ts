/**
 * Az ellenőrző kör mérése.
 *
 * Ez az utolsó védvonal a kész irat és a kiadás között, ezért itt nem a
 * lefedettséget mérjük, hanem konkrét, korábban elkövetett hibákat zárunk ki:
 * a számformátumú azonosítók vaksága, a megtartandó névlista némán ható
 * szűrője, a jelentés némán levágott vége, és a „dr." utáni pont, amit a
 * mondatkezdet-heurisztika mondatvégnek nézett.
 *
 *   npx tsx test/verify-tests.ts
 */

import {
  BUILTIN_NUMERIC_PATTERNS,
  findNumericIdentifiers,
  verifyOutput,
  type Leak,
  type NumericPattern,
  type VerifyOptions,
} from '../src/verify.js';
import type { SeedEntity } from '../src/hu/names.js';

let pass = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/** Az iratban szereplő felek; a célzott keresés ezeket ismeri. */
const PARTIES: SeedEntity[] = [
  { kind: 'person', id: 'p1', surname: 'Kovács', given: 'János', gender: 'M', role: 'felperes' },
  { kind: 'person', id: 'p2', surname: 'Nagy', given: 'Péter', gender: 'M', role: 'I. r. alperes' },
];

/** Teljes ellenőrzés, a felek célzott keresésével együtt. */
function run(output: string, opts: Partial<VerifyOptions> = {}) {
  return verifyOutput(output, PARTIES, { pseudonyms: [], ...opts });
}

/** Csak a söprő és a számkör érdekel: fél nélkül futtatunk. */
function sweep(output: string, opts: Partial<VerifyOptions> = {}) {
  return verifyOutput(output, [], { pseudonyms: [], ...opts });
}

function surfaces(list: Leak[]): string[] {
  return list.map((l) => l.surface);
}

function labels(list: Leak[]): string[] {
  return list.map((l) => l.label ?? '');
}

console.log('');

// ─── A) Az ellenőrző kör lássa a számformátumú azonosítókat ────────────────
//
// A söprő minta nagybetűs SZAVAKRA illeszkedik, a betűosztályában nincs
// számjegy. Emiatt egy bent maradt adóazonosító nem is jelöltként bukott el:
// soha nem került a keresés látókörébe, és a jegyzőkönyv „tiszta" minősítést
// írt egy olyan iratra, amiben ott állt a felperes adóazonosító jele.

{
  const r = sweep('A felperes adóazonosító jele: 8442130976, ezt a bíróság ellenőrizte.');
  check('adóazonosító a látókörbe kerül', r.residualTotal === 1, `${r.residualTotal} maradvány`);
  check('adóazonosító megnevezve', labels(r.residual)[0] === 'adóazonosító jel', labels(r.residual).join('|'));
}

{
  const r = sweep('TAJ szám: 041 273 856; a szolgáltató nyilvántartása szerint.');
  check('tagolt TAJ-szám megvan', surfaces(r.residual).includes('041 273 856'), surfaces(r.residual).join('|'));
}

{
  const r = sweep('A vételár a 10402142-49575354-56561008 számú bankszámlára érkezett.');
  check('8-8-8 bankszámlaszám egészben', surfaces(r.residual)[0] === '10402142-49575354-56561008', surfaces(r.residual).join('|'));
  check('a bankszámlaszám nem esik darabokra', r.residualTotal === 1, `${r.residualTotal} db`);
}

{
  const r = sweep('IBAN: HU42 1040 2142 4957 5354 5656 1008 (a kölcsönadó számlája).');
  check('IBAN megvan', surfaces(r.residual).includes('HU42 1040 2142 4957 5354 5656 1008'), surfaces(r.residual).join('|'));
}

{
  const r = sweep('Az Aranykalász Agrár Kft. adószáma: 24817350-2-13.');
  check('adószám megvan', surfaces(r.residual).includes('24817350-2-13'), surfaces(r.residual).join('|'));
}

// A szóhatárt számjegy-szomszédosság dönti el, nem betűosztály: egy 16 jegyű
// kártyaszámból nem hasíthatunk ki 10 jegyű „adóazonosítót".
{
  const r = sweep('A kártya száma 4263982640269299, ez nem azonosító jel.');
  check(
    'hosszabb számsorból nem hasítunk ki azonosítót',
    !r.residual.some((l) => l.label === 'adóazonosító jel'),
    surfaces(r.residual).join('|'),
  );
}

// A jogi iratok tele vannak tagolt összegekkel; azoktól nem szabad zajossá válni.
{
  const r = sweep('A kártérítés összege 123 456 789 Ft, amit meg kell fizetni.');
  check('a tagolt összeg nem azonosító', r.residualTotal === 0, surfaces(r.residual).join('|'));
}

// A hívó által ismert, EREDETI azonosító nem gyanú, hanem biztos szivárgás.
{
  const r = sweep('adóazonosító jel: 8442130976', { numericLiterals: ['8442130976'] });
  check('ismert azonosító szivárgás', r.leaks.length === 1, `${r.leaks.length} db`);
  check('ismert azonosító tiltja az exportot', r.ok === false);
  check('a szivárgás nem duplázódik a maradványok közé', r.residualTotal === 0, `${r.residualTotal} db`);
}

// Ugyanaz az azonosító az irat két pontján más tagolással is szerepelhet.
{
  const r = sweep('a nyilvántartott adóazonosító: 8442 130 976.', { numericLiterals: ['8442130976'] });
  check('a tagolás nem rejti el az azonosítót', r.leaks.length === 1, surfaces(r.leaks).join('|'));
}

// Amit a hívó bent hagyhatónak jelöl, az nem kerül a listára.
{
  const r = sweep('A bíróság ügyszáma: 10402142-49575354-56561008.', {
    keepNumbers: ['10402142-49575354-56561008'],
  });
  check('a megtartandó szám nem maradvány', r.residualTotal === 0, surfaces(r.residual).join('|'));
}

// A hívó saját mintát is adhat: ezt a fájlt nem kell hozzáigazítani egy külön
// felismerő modulhoz.
{
  const ugyszam: NumericPattern = { label: 'ügyszám', pattern: /\d{1,3}\.[A-ZÁÉÍÓÖŐÚÜŰ]\.\d{2}\.\d{3}\/\d{4}\/\d{1,3}/g };
  const r = sweep('Az ügy száma 12.P.20.345/2023/8. szám alatt van folyamatban.', {
    numericPatterns: [ugyszam],
  });
  check('átadott minta fut', labels(r.residual).includes('ügyszám'), labels(r.residual).join('|'));
}

// Nem globális mintát is át lehet adni; ettől nem szabad végtelen ciklusba esni.
{
  const r = findNumericIdentifiers('adószám: 24817350-2-13', [
    { label: 'adószám', pattern: /\d{8}-\d-\d{2}/ },
  ]);
  check('nem globális minta is lefut', r.length === 1, `${r.length} db`);
}

// A beépített készlet kikapcsolható, ha a hívó teljesen sajátot használ.
{
  const r = sweep('adóazonosító jel: 8442130976', { builtinNumericPatterns: false });
  check('a beépített készlet kikapcsolható', r.residualTotal === 0, `${r.residualTotal} db`);
  check('a beépített készlet nem üres', BUILTIN_NUMERIC_PATTERNS.length >= 5);
}

// ─── B) A megtartandó névlista tényleg szűrjön ─────────────────────────────
//
// Az eljáró ügyvéd és bíró neve a Bszi. 166. § (2) szerint jogszerűen marad az
// iratban. Ha ezek riasztásként jelennek meg, a felhasználó a zaj miatt a
// valódi találatokat is átugorja.

{
  const text = 'Az ítéletet a bíróság nevében dr. Sárközi Tamás bíró hirdette ki.';
  const nincs = sweep(text);
  const van = sweep(text, { keepList: ['dr. Sárközi Tamás'] });
  check('lista nélkül riaszt az eljáró neve', nincs.residualTotal > 0, `${nincs.residualTotal} db`);
  check('a keepList elnémítja az eljáró nevét', van.residualTotal === 0, surfaces(van.residual).join('|'));
}

// A megtartandó név ragozva is szerepelhet: „Sárközi Tamásnak", „Sárközivel".
{
  const r = sweep('A tárgyaláson dr. Sárközivel és Illés Katalinnal egyeztetett.', {
    keepList: ['dr. Sárközi Tamás', 'dr. Illés Katalin'],
  });
  check('a ragozott megtartandó név is néma', r.residualTotal === 0, surfaces(r.residual).join('|'));
}

// A biztonságos szavak korábban MÁS alakra normalizálva kerültek a szűrőbe,
// mint amire a keresés hasonlított: a hatnál hosszabbak („Törvényszék",
// „Alkotmánybíróság", „Szeptember") soha nem illeszkedtek.
{
  const r = sweep('A per során a Törvényszék, az Alkotmánybíróság és a Kúria is eljárt Szeptember hónapban.');
  check(
    'a hosszú biztonságos szavak tényleg némák',
    r.residualTotal === 0,
    surfaces(r.residual).join('|'),
  );
}

{
  const r = sweep('A felek az Egyeztetőtestület elé vitték az ügyet.', { safeWords: ['Egyeztetőtestület'] });
  check('átadott biztonságos szó is néma', r.residualTotal === 0, surfaces(r.residual).join('|'));
}

// Az álnév a kimenet jogos része, ragozva is.
{
  const r = sweep('A Kőszikla Ottónak fizetendő összeget a Kőszikla nem vette át.', {
    pseudonyms: ['Kőszikla Ottó'],
  });
  check('az álnév nem maradvány', r.residualTotal === 0, surfaces(r.residual).join('|'));
}

// A célzott kör ettől függetlenül biztos szivárgásként jelenti a fél nevét.
{
  const r = run('A szerződést Kovács János írta alá.', { pseudonyms: ['Kőszikla Ottó'] });
  check('a bent maradt fél neve szivárgás', r.leaks.length > 0, `${r.leaks.length} db`);
  check('szivárgásnál nem tiszta a jegyzőkönyv', r.ok === false);
}

// ─── C) A levágott lista mellett legyen ott a teljes darabszám ─────────────
//
// A felületen látható szám korábban a levágás UTÁN keletkezett, ezért maga a
// csonkolás sem derült ki: 137 maradványból 40 látszott, és a képernyőn a
// „40" szám állt.

{
  const sok = Array.from({ length: 60 }, (_, i) => `a per során Zsombor${'x'.repeat(i % 3)} tanú`).join(', ');
  const r = sweep(sok);
  check('a lista levágódik', r.residual.length === 40, `${r.residual.length} db`);
  check('a teljes szám megmarad', r.residualTotal > r.residual.length, `${r.residualTotal} vs ${r.residual.length}`);
}

{
  const sok = Array.from({ length: 12 }, () => 'a per során Zsombor tanú').join(', ');
  const r = sweep(sok, { residualLimit: 5 });
  check('a levágás mértéke állítható', r.residual.length === 5, `${r.residual.length} db`);
  check('a teljes szám a levágás előtti', r.residualTotal === 12, `${r.residualTotal} db`);
}

// Levágásnál a nagyobb kockázatú számformátumú tételek maradjanak bent.
{
  const zaj = Array.from({ length: 10 }, () => 'a per során Zsombor tanú').join(', ');
  const r = sweep(`${zaj}, adóazonosító jel: 8442130976`, { residualLimit: 3 });
  check(
    'a számformátumú maradvány túléli a levágást',
    r.residual[0]?.label === 'adóazonosító jel',
    `${r.residual[0]?.surface ?? '—'}`,
  );
}

// ─── D) A rövidítés utáni pont nem mondatvég ───────────────────────────────
//
// A „dr." utáni pontot a heurisztika mondatvégnek nézte, ezért a bíró
// VEZETÉKNEVÉT mondatkezdőként átugrotta, a keresztnevét viszont maradványként
// jelentette: ugyanaz a név egyszerre volt láthatatlan és zajos.

{
  const r = sweep('Az ügyben eljárt dr. Sárközi Tamás bíró.');
  check('a „dr." utáni vezetéknév is látszik', surfaces(r.residual).includes('Sárközi'), surfaces(r.residual).join('|'));
  check('a keresztnév is látszik', surfaces(r.residual).includes('Tamás'), surfaces(r.residual).join('|'));
}

for (const rov of ['ifj.', 'id.', 'özv.', 'stb.', 'ill.', 'pl.', 'prof.']) {
  const r = sweep(`A tanú ${rov} Zsombor nevű személy volt.`);
  check(`a(z) „${rov}" utáni szó látszik`, surfaces(r.residual).includes('Zsombor'), surfaces(r.residual).join('|'));
}

// A valódi mondatvég viszont maradjon mondatvég.
{
  const r = sweep('A bíróság a keresetet elutasította. Zsombor tanú vallomását nem fogadta el.');
  check('a valódi mondatkezdet néma', !surfaces(r.residual).includes('Zsombor'), surfaces(r.residual).join('|'));
}

// PDF-ből kinyert szövegben a többszörös szóköz mindennapos; korábban három
// szóköz önmagában mondatkezdetnek számított, és elrejtette a mögötte álló nevet.
{
  const r = sweep('A per során   Zsombor tanú vallomást tett.');
  check('a többszörös szóköz nem mondatkezdet', surfaces(r.residual).includes('Zsombor'), surfaces(r.residual).join('|'));
}

// A saját címkéinket nem jelentjük magunk ellen.
{
  const r = sweep('A felperes lakcíme [lakcím], a neve [NÉV-1] a szerződésben.');
  check('a saját címke nem maradvány', r.residualTotal === 0, surfaces(r.residual).join('|'));
}

console.log('');
if (failures.length) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
}
console.log(`Ellenőrző kör: ${pass}/${pass + failures.length} ellenőrzés rendben`);
console.log('');
process.exit(failures.length === 0 ? 0 : 1);
