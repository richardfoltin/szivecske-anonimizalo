/**
 * A magyar azonosító-felismerő mérése a három mintairaton.
 *
 *   npx tsx test/azonosito-tests.ts
 *
 * Két dolgot mérünk. Az egyik a lefedettség: megtalálja-e a program mind a
 * tizenhárom azonosítófajtát, pontosan azzal a felszíni alakkal, ahogy az
 * iratban áll. A másik — és ez a fontosabb — hogy a HIBÁS ELLENŐRZŐSZÁMÚ
 * azonosítók is BENT MARADJANAK a találatok között.
 *
 * A mintairataink ugyanis a valóságra hasonlítanak, nem a tankönyvre: a három
 * adóazonosító jelből csak egy érvényes, a bankszámlaszámoknál csak az első
 * nyolcas blokk jó, az IBAN ellenőrzőszáma pedig hibás. Kemény ellenőrzőszám-
 * kapuval a program a saját tesztadatai többségét nem találná meg. Ezért itt
 * külön ellenőrizzük, hogy az érvénytelen ellenőrzőszám ne kiejtse, hanem
 * ÁTNÉZÉSRE küldje a találatot.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AzonositoKind,
  type AzonositoMatch,
  type ChecksumState,
  AZONOSITO_NEV,
  adoazonositoOk,
  asEntityShape,
  findAzonositok,
  ibanOk,
  nyolcasBlokkOk,
  resolveOverlaps,
  sortForCoverage,
  tajOk,
} from '../src/hu/azonositok.js';
import { buildFragments, findIdentifierTokens, findIdentifiersWithNames } from '../src/hu/identifiers.js';

const ROOT = process.cwd();
const SAMPLES = ['keresetlevel', 'itelet', 'kolcsonszerzodes'] as const;

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

interface Elvart {
  kind: AzonositoKind;
  /** A felszíni alak pontosan úgy, ahogy az iratban áll. */
  text: string;
  checksum?: ChecksumState;
  disposition?: 'auto' | 'review';
}

/**
 * Amit a három iratban meg kell találni.
 *
 * Az irányítószám szándékosan nincs külön felsorolva minden címnél: a teljes
 * cím elnyeli, és a feloldás után nem is szabad külön látszania. A puszta
 * irányítószám meglétét külön blokkban mérjük.
 */
const ELVART: Record<(typeof SAMPLES)[number], Elvart[]> = {
  keresetlevel: [
    { kind: 'cim', text: '2000 Szentendre, Dózsa György út 2.', disposition: 'review' },
    { kind: 'cim', text: '1052 Budapest, Városház utca 12.', disposition: 'review' },
    { kind: 'cim', text: '2000 Szentendre, Bükkös part 14.', disposition: 'auto' },
    { kind: 'cim', text: '2011 Budakalász, Szentendrei út 78/B. II. em. 5.', disposition: 'auto' },
    { kind: 'cim', text: '2000 Szentendre, Kőzúzó utca 3.', disposition: 'auto' },
    { kind: 'ado_azonosito_jel', text: '8442130976', checksum: 'invalid', disposition: 'review' },
    { kind: 'ado_azonosito_jel', text: '8391764205', checksum: 'invalid', disposition: 'review' },
    { kind: 'ado_azonosito_jel', text: '8000000008', checksum: 'valid', disposition: 'auto' },
    { kind: 'taj', text: '111 111 110', checksum: 'valid', disposition: 'auto' },
    { kind: 'telefonszam', text: '+36 30 412 7758', disposition: 'auto' },
    { kind: 'email', text: 'kovacs.janos58@freemail.hu', disposition: 'auto' },
    { kind: 'helyrajzi_szam', text: 'Szentendre belterület 4127/8. hrsz.', disposition: 'auto' },
    { kind: 'bankszamlaszam', text: '10402142-49575354-56561008', checksum: 'invalid', disposition: 'review' },
    { kind: 'iban', text: 'HU42 1040 2142 4957 5354 5656 1008', checksum: 'invalid', disposition: 'review' },
  ],
  itelet: [
    { kind: 'birosagi_ugyszam', text: '12.P.20.845/2026/8', disposition: 'auto' },
    { kind: 'cim', text: '1052 Budapest, Városház utca 12.', disposition: 'review' },
    { kind: 'cim', text: '2000 Szentendre, Bükkös part 14.', disposition: 'auto' },
    // Az ügyvédi iroda címe átnézendő marad: nem fél, hanem eljáró képviselő.
    { kind: 'cim', text: '2000 Szentendre, Dumtsa Jenő utca 5.', disposition: 'review' },
    { kind: 'cim', text: '2011 Budakalász, Szentendrei út 78/B. II. em. 5.', disposition: 'auto' },
    { kind: 'cim', text: '2000 Szentendre, Kőzúzó utca 3.', disposition: 'auto' },
    { kind: 'ado_azonosito_jel', text: '8442130976', checksum: 'invalid', disposition: 'review' },
    { kind: 'taj', text: '111 111 110', checksum: 'valid', disposition: 'auto' },
    { kind: 'helyrajzi_szam', text: 'Szentendre belterület 4127/8. hrsz.', disposition: 'auto' },
    { kind: 'bankszamlaszam', text: '10402142-49575354-56561008', checksum: 'invalid', disposition: 'review' },
    { kind: 'cegjegyzekszam', text: '13-09-184627', checksum: 'not_applicable', disposition: 'auto' },
    { kind: 'adoszam', text: '24817350-2-13', checksum: 'valid', disposition: 'auto' },
  ],
  kolcsonszerzodes: [
    { kind: 'cim', text: '2000 Szentendre, Bükkös part 14.', disposition: 'auto' },
    { kind: 'cim', text: '2011 Budakalász, Szentendrei út 78/B. II. em. 5.', disposition: 'auto' },
    { kind: 'cim', text: '2000 Szentendre, Kőzúzó utca 3.', disposition: 'auto' },
    { kind: 'cim', text: '2011 Budakalász, Malom köz 6.', disposition: 'auto' },
    { kind: 'ado_azonosito_jel', text: '8442130976', checksum: 'invalid', disposition: 'review' },
    { kind: 'ado_azonosito_jel', text: '8391764205', checksum: 'invalid', disposition: 'review' },
    { kind: 'ado_azonosito_jel', text: '8000000008', checksum: 'valid', disposition: 'auto' },
    { kind: 'taj', text: '111 111 110', checksum: 'valid', disposition: 'auto' },
    { kind: 'adoszam', text: '24817350-2-13', checksum: 'valid', disposition: 'auto' },
    { kind: 'cegjegyzekszam', text: '13-09-184627', checksum: 'not_applicable', disposition: 'auto' },
    { kind: 'bankszamlaszam', text: '10402142-49575354-56561008', checksum: 'invalid', disposition: 'review' },
    { kind: 'bankszamlaszam', text: '10300002-10517493-49020015', checksum: 'invalid', disposition: 'review' },
    { kind: 'iban', text: 'HU42 1040 2142 4957 5354 5656 1008', checksum: 'invalid', disposition: 'review' },
    { kind: 'telefonszam', text: '+36 30 412 7758', disposition: 'auto' },
    { kind: 'telefonszam', text: '+36 20 336 4471', disposition: 'auto' },
    { kind: 'email', text: 'kovacs.janos58@freemail.hu', disposition: 'auto' },
    { kind: 'email', text: 'nagy.peter@aranykalasz.hu', disposition: 'auto' },
    { kind: 'helyrajzi_szam', text: 'Budakalász belterület 2318/4. hrsz.', disposition: 'auto' },
    { kind: 'szemelyazonosito_igazolvany', text: '356214KA', disposition: 'auto' },
    { kind: 'szemelyazonosito_igazolvany', text: '481029ZE', disposition: 'auto' },
  ],
};

console.log('');
console.log('AZONOSÍTÓK A MINTAIRATOKON');
console.log('');

const foundKinds = new Set<AzonositoKind>();
const perSample = new Map<string, AzonositoMatch[]>();

for (const id of SAMPLES) {
  const text = readFileSync(join(ROOT, `samples/${id}.txt`), 'utf8');
  const hits = findAzonositok(text);
  perSample.set(id, hits);
  for (const h of hits) foundKinds.add(h.kind);

  // A pozíció a legfontosabb kimenet: ha elcsúszik, rossz helyen cserélünk.
  const misaligned = hits.filter((h) => text.slice(h.start, h.end) !== h.text);
  check(`${id}: minden pozíció pontos`, misaligned.length === 0, `${misaligned.length} elcsúszott`);

  const expected = ELVART[id];
  let hit = 0;
  for (const e of expected) {
    const m = hits.find((h) => h.kind === e.kind && h.text === e.text);
    check(`${id}: ${AZONOSITO_NEV[e.kind]} — „${e.text}"`, m !== undefined, 'nincs meg');
    if (!m) continue;
    hit++;
    if (e.checksum !== undefined) {
      check(
        `${id}: „${e.text}" ellenőrzőszáma ${e.checksum}`,
        m.checksum === e.checksum,
        `kapott: ${m.checksum}`,
      );
    }
    if (e.disposition !== undefined) {
      check(
        `${id}: „${e.text}" besorolása ${e.disposition}`,
        m.disposition === e.disposition,
        `kapott: ${m.disposition} (${m.confidence.toFixed(2)})`,
      );
    }
  }

  const feloldva = resolveOverlaps(hits);
  console.log(
    `${(id + '.txt').padEnd(24)} ${String(hit).padStart(2)}/${expected.length} elvárt azonosító, ` +
      `${hits.length} nyers → ${feloldva.length} találat átfedés nélkül`,
  );
}

const MIND: AzonositoKind[] = [
  'ado_azonosito_jel', 'taj', 'adoszam', 'cegjegyzekszam', 'bankszamlaszam', 'iban',
  'helyrajzi_szam', 'iranyitoszam', 'telefonszam', 'szemelyazonosito_igazolvany',
  'birosagi_ugyszam', 'email', 'cim',
];
for (const k of MIND) {
  check(`a ${AZONOSITO_NEV[k]} fajta előkerült valamelyik iratban`, foundKinds.has(k));
}

/* ------------------------------------------------------------------ *
 *  A MÉRT ELLENŐRZŐSZÁM-EREDMÉNYEK
 * ------------------------------------------------------------------ */

console.log('');
console.log('MÉRT ELLENŐRZŐSZÁMOK');
console.log('');

const CHECKSUM_TENYEK: { nev: string; ok: boolean; vart: boolean }[] = [
  { nev: 'adóazonosító 8000000008', ok: adoazonositoOk('8000000008'), vart: true },
  { nev: 'adóazonosító 8442130976', ok: adoazonositoOk('8442130976'), vart: false },
  { nev: 'adóazonosító 8391764205', ok: adoazonositoOk('8391764205'), vart: false },
  { nev: 'TAJ 111111110', ok: tajOk('111111110'), vart: true },
  { nev: 'adószám törzsszáma 24817350', ok: nyolcasBlokkOk('24817350'), vart: true },
  { nev: '1. bankszámla 1. blokk 10402142', ok: nyolcasBlokkOk('10402142'), vart: true },
  { nev: '1. bankszámla 2. blokk 49575354', ok: nyolcasBlokkOk('49575354'), vart: false },
  { nev: '1. bankszámla 3. blokk 56561008', ok: nyolcasBlokkOk('56561008'), vart: false },
  { nev: '2. bankszámla 1. blokk 10300002', ok: nyolcasBlokkOk('10300002'), vart: true },
  { nev: '2. bankszámla 2. blokk 10517493', ok: nyolcasBlokkOk('10517493'), vart: false },
  { nev: '2. bankszámla 3. blokk 49020015', ok: nyolcasBlokkOk('49020015'), vart: false },
  { nev: 'IBAN HU42 1040 2142 4957 5354 5656 1008', ok: ibanOk('HU42 1040 2142 4957 5354 5656 1008'), vart: false },
];

for (const t of CHECKSUM_TENYEK) {
  check(`${t.nev}: ${t.vart ? 'érvényes' : 'ÉRVÉNYTELEN'}`, t.ok === t.vart, `kapott: ${t.ok}`);
  console.log(`  ${t.ok === t.vart ? '✓' : '✗'} ${t.nev.padEnd(42)} ${t.ok ? 'érvényes' : 'érvénytelen'}`);
}

// Az IBAN szóköz nélkül írva ugyanazt az eredményt kell adja.
check(
  'az IBAN szóköz nélkül is ugyanúgy értékelődik',
  ibanOk('HU42104021424957535456561008') === ibanOk('HU42 1040 2142 4957 5354 5656 1008'),
);
// Egy javított ellenőrzőjegyű IBAN-nak viszont át kell mennie, különben nem a
// mod-97-et mérnénk, hanem csak azt, hogy mindig hamisat mondunk.
check('helyes ellenőrzőjegyű IBAN érvényes', ibanOk('HU93 1160 0006 0000 0000 1234 5676'));

/* ------------------------------------------------------------------ *
 *  AZ ELLENŐRZŐSZÁM NEM KAPU, CSAK PONT
 * ------------------------------------------------------------------ */

console.log('');
console.log('AZ ELLENŐRZŐSZÁM NEM KAPU');
console.log('');

const kolcson = perSample.get('kolcsonszerzodes')!;
const rosszAdo = kolcson.filter((m) => m.kind === 'ado_azonosito_jel' && m.checksum === 'invalid');
const joAdo = kolcson.filter((m) => m.kind === 'ado_azonosito_jel' && m.checksum === 'valid');

check('a hibás ellenőrzőszámú adóazonosítók is találatok', rosszAdo.length === 2, `${rosszAdo.length} db`);
check('a hibás ellenőrzőszámú adóazonosító mind átnézésre kerül', rosszAdo.every((m) => m.disposition === 'review'));
check('a hibás ellenőrzőszámú adóazonosító megbízhatósága nem nulla', rosszAdo.every((m) => m.confidence > 0.5));
check('az érvényes ellenőrzőszámú adóazonosító automatikusan cserélhető', joAdo.every((m) => m.disposition === 'auto'));
check(
  'az érvényes ellenőrzőszám magasabb megbízhatóságot ad',
  joAdo.every((j) => rosszAdo.every((r) => j.confidence > r.confidence)),
);

// A címke erősebb jel az ellenőrzőszámnál: címke NÉLKÜL, hibás ellenőrzőszámmal
// ugyanaz a szám alacsonyabb megbízhatóságot kap, mint címkével.
const cimkeNelkul = findAzonositok('A hivatkozott szám: 8442130976 volt.').find((m) => m.kind === 'ado_azonosito_jel');
const cimkevel = findAzonositok('adóazonosító jel: 8442130976').find((m) => m.kind === 'ado_azonosito_jel');
check('címke nélkül is találat a hibás adóazonosító', cimkeNelkul !== undefined);
check(
  'a címke emeli a megbízhatóságot',
  cimkevel !== undefined && cimkeNelkul !== undefined && cimkevel.confidence > cimkeNelkul.confidence,
);
check('a címke a találat mellé kerül', cimkevel?.label !== null && cimkevel?.label !== undefined);

// A cégjegyzékszámnak nincs ellenőrzőszáma — ez nem gyanújel.
const cegj = perSample.get('itelet')!.find((m) => m.kind === 'cegjegyzekszam');
check('a cégjegyzékszám ellenőrzőszáma nem értelmezhető', cegj?.checksum === 'not_applicable');
check('a cégjegyzékszám a hiányzó ellenőrzőszám ellenére sem esik vissza', cegj?.disposition === 'auto');

/* ------------------------------------------------------------------ *
 *  ÁTFEDÉSEK
 * ------------------------------------------------------------------ */

console.log('');
console.log('ÁTFEDÉSEK FELOLDÁSA');
console.log('');

for (const id of SAMPLES) {
  const feloldva = resolveOverlaps(perSample.get(id)!);
  const atfedes = feloldva.filter((a, i) => feloldva.some((b, j) => i !== j && a.start < b.end && b.start < a.end));
  check(`${id}: a feloldás után nincs átfedés`, atfedes.length === 0, `${atfedes.length} maradt`);

  // A teljes cím nyer a puszta irányítószám felett: az irányítószám nem
  // alternatívája a címnek, hanem a DARABJA.
  const maradtIrsz = feloldva.filter((m) => m.kind === 'iranyitoszam');
  const nyeloCim = feloldva.filter((m) => m.kind === 'cim');
  check(
    `${id}: a teljes cím elnyelte a benne álló irányítószámot`,
    maradtIrsz.every((i) => !nyeloCim.some((c) => c.start === i.start)),
  );
}

// A puszta irányítószám azért felismerhető marad, ha nincs mögötte teljes cím.
const csakIrsz = findAzonositok('Levelezési hely: 2000 Szentendre.');
check('a puszta irányítószám önmagában is találat', csakIrsz.some((m) => m.kind === 'iranyitoszam'));

// A nyers listában viszont MINDKETTŐ ott van, mert a hívó dolga eldönteni.
const nyersIrsz = perSample.get('kolcsonszerzodes')!.filter((m) => m.kind === 'iranyitoszam');
check('a nyers lista az irányítószámot is tartalmazza', nyersIrsz.length > 0);

// A helyrajzi szám a településnévvel EGYBEN áll, és a lefedettségi sorrendben elöl.
const hrsz = perSample.get('kolcsonszerzodes')!.find((m) => m.kind === 'helyrajzi_szam');
check('a helyrajzi szám a településnevet is magába foglalja', hrsz?.text.startsWith('Budakalász') === true, hrsz?.text);
const sorrend = sortForCoverage(perSample.get('kolcsonszerzodes')!);
const elsoNemOsszetett = sorrend.findIndex((m) => m.kind !== 'cim' && m.kind !== 'helyrajzi_szam' && m.kind !== 'iranyitoszam');
const utolsoOsszetett = sorrend.map((m) => m.kind).lastIndexOf('helyrajzi_szam');
check(
  'a helynevet tartalmazó azonosítók a lefedettségi sorrend elején állnak',
  utolsoOsszetett < elsoNemOsszetett,
  `hrsz a ${utolsoOsszetett}., első egyszerű a ${elsoNemOsszetett}. helyen`,
);

/* ------------------------------------------------------------------ *
 *  ÍRÁSVÁLTOZATOK, AMIK A MINTAIRATOKBAN NEM SZEREPELNEK
 * ------------------------------------------------------------------ */

console.log('');
console.log('ÍRÁSVÁLTOZATOK');
console.log('');

const VALTOZATOK: { szoveg: string; kind: AzonositoKind; talalat: string }[] = [
  // A régi, két betű + hat számjegy alakú személyazonosító igazolvány.
  { szoveg: 'személyazonosító igazolvány száma: AB123456', kind: 'szemelyazonosito_igazolvany', talalat: 'AB123456' },
  { szoveg: 'szig.: 356214 KA', kind: 'szemelyazonosito_igazolvany', talalat: '356214 KA' },
  // A helyrajzi szám mindhárom alakja, és a címke a szám előtt is állhat.
  { szoveg: 'hrsz.: 1234/5/A', kind: 'helyrajzi_szam', talalat: 'hrsz.: 1234/5/A' },
  { szoveg: 'helyrajzi szám: 1234/5', kind: 'helyrajzi_szam', talalat: 'helyrajzi szám: 1234/5' },
  { szoveg: 'Szentendre, 4231/2 hrsz. alatti ingatlan', kind: 'helyrajzi_szam', talalat: 'Szentendre, 4231/2 hrsz.' },
  // Telefonszám 06-tal, mindhárom tagolással, és a hatjegyű vidéki vezetékes.
  { szoveg: 'telefonszám: 06 30 412 7758', kind: 'telefonszam', talalat: '06 30 412 7758' },
  { szoveg: 'telefon: 06-30-412-7758', kind: 'telefonszam', talalat: '06-30-412-7758' },
  { szoveg: 'tel.: 06/26/312-345', kind: 'telefonszam', talalat: '06/26/312-345' },
  { szoveg: 'mobil: +36301234567', kind: 'telefonszam', talalat: '+36301234567' },
  { szoveg: 'Az ügy száma 5.P.20.123/2025/8. volt.', kind: 'birosagi_ugyszam', talalat: '5.P.20.123/2025/8' },
  { szoveg: 'TAJ szám: 111-111-110', kind: 'taj', talalat: '111-111-110' },
  { szoveg: 'IBAN: HU42104021424957535456561008', kind: 'iban', talalat: 'HU42104021424957535456561008' },
  {
    szoveg: 'székhely: 1052 Budapest, Városház krt. 12/A. 3. em. 4.',
    kind: 'cim',
    talalat: '1052 Budapest, Városház krt. 12/A. 3. em. 4.',
  },
];

for (const v of VALTOZATOK) {
  const hits = findAzonositok(v.szoveg);
  const m = hits.find((h) => h.kind === v.kind);
  check(`írásváltozat — „${v.szoveg}"`, m?.text === v.talalat, `kapott: ${m ? `„${m.text}"` : 'semmi'}`);
}
console.log(`  ${VALTOZATOK.length} írásváltozat ellenőrizve`);

/* ------------------------------------------------------------------ *
 *  RENDSZÁM — SZINTETIKUS PÉLDÁKKAL
 * ------------------------------------------------------------------ */

/*
  A három mintairatban nincs gépjármű, tehát rendszám sem. Ez a felismerő
  tisztán JÖVŐBELI lefedettség: kártérítési és biztosítási iratban a rendszám
  ugyanúgy azonosít, mint a lakcím. Mérni ezért csak szintetikus példával
  lehet — de mérni kell, különben ugyanaz lenne a helyzet, mint az azonosítók
  cseréjével: a felismerő megvan, és soha senki nem futtatja.
*/

console.log('');
console.log('RENDSZÁM (szintetikus példák)');
console.log('');

const RENDSZAM: { szoveg: string; talalat: string; disposition: 'auto' | 'review' }[] = [
  // A három magyar alak.
  { szoveg: 'a gépjármű rendszáma: ABC-123', talalat: 'ABC-123', disposition: 'auto' },
  { szoveg: 'forgalmi rendszám: AA-BB-123', talalat: 'AA-BB-123', disposition: 'auto' },
  { szoveg: 'frsz.: AABB-123', talalat: 'AABB-123', disposition: 'auto' },
  // A leggyakoribb magyar szórend: a címke a szám UTÁN áll, jelzős szerkezetben.
  {
    szoveg: 'az alperes az XYZ-987 forgalmi rendszámú gépjárművel okozta a kárt',
    talalat: 'XYZ-987',
    disposition: 'auto',
  },
  // Címke nélkül a találat megmarad, de emberi átnézésre vár.
  { szoveg: 'a parkolóban álló PQR-456 gépkocsi', talalat: 'PQR-456', disposition: 'review' },
];

for (const r of RENDSZAM) {
  const m = findAzonositok(r.szoveg).find((h) => h.kind === 'rendszam');
  check(`rendszám — „${r.szoveg}"`, m?.text === r.talalat, `kapott: ${m ? `„${m.text}"` : 'semmi'}`);
  if (m) {
    check(
      `rendszám besorolása ${r.disposition} — „${r.talalat}"`,
      m.disposition === r.disposition,
      `kapott: ${m.disposition} (${m.confidence.toFixed(2)})`,
    );
  }
}

// Amire NEM szabad illeszkednie. A magyar rendszámtábla ékezetet és kisbetűt
// nem visel, a szabvány- és típusjelölések viszont pont ilyen alakúak.
const NEM_RENDSZAM = [
  'az ISO-9001 szabvány szerint',
  'a COVID-19 járvány idején',
  'a MÁV-101 sorozatú mozdony',
  'az abc-123 azonosítójú tétel',
  'a IV-12. pont alapján',
];
for (const t of NEM_RENDSZAM) {
  const hits = findAzonositok(t).filter((h) => h.kind === 'rendszam');
  check(`nem rendszám: „${t}"`, hits.length === 0, hits.map((h) => `„${h.text}"`).join(', '));
}
console.log(`  ${RENDSZAM.length} rendszám-alak és ${NEM_RENDSZAM.length} téves alak ellenőrizve`);

/* ------------------------------------------------------------------ *
 *  TÉVES ILLESZKEDÉS
 * ------------------------------------------------------------------ */

console.log('');
console.log('TÉVES ILLESZKEDÉS ELKERÜLÉSE');
console.log('');

const TEVES: string[] = [
  'A bíróság kötelezi az alperest 3 550 000 Ft, azaz hárommillió-ötszázötvenezer forint megfizetésére.',
  'A perköltség 213.000,- Ft eljárási illeték és 320.000,- Ft + áfa ügyvédi munkadíj, összesen 1 250 000 Ft.',
  'A polgári perrendtartásról szóló 2016. évi CXXX. törvény 170. §-a alapján, 2025. december 31. napjáig.',
  'A tárgyalást 2026. május 6. napjára tűzte ki, majd 2019 óta először 2025 februárjában járt el.',
  'Az irataiban és a mellékleteiben foglaltak szerint a teljesítés 2025 júniusa és szeptembere között történt.',
  'KASZ: 36114927, valamint a Ptk. 6:383. §-a és a Pp. 25. §-a irányadó.',
  'Nagy Péter 1 800 000 Ft-ot utalt át, a maradék 3 000 000 Ft készpénzben került átadásra.',
  'A II. rendű alperes a IV. fejezet 12. pontja szerint járt el, lásd a X. mellékletet.',
];
for (const t of TEVES) {
  const hits = findAzonositok(t);
  check(`nincs téves találat: „${t.slice(0, 46)}…"`, hits.length === 0, hits.map((h) => `${h.kind}:"${h.text}"`).join(', '));
}
console.log(`  ${TEVES.length} kockázatos mondat, egyikben sincs azonosító`);

/* ------------------------------------------------------------------ *
 *  AZ E-MAIL ÖNÁLLÓ AZONOSÍTÓ, ÉS A HÁROM BETŰS VEZETÉKNEVEK
 * ------------------------------------------------------------------ */

console.log('');
console.log('E-MAIL ÉS NÉVTÖREDÉKEK (src/hu/identifiers.ts)');
console.log('');

// Korábban az e-mail cím CSAK akkor került elő, ha egy fél neve benne volt.
// Az irodai és a harmadik személyes címek így érintetlenül átmentek.
const irodai = 'Kapcsolat: iroda@sarkozi.hu, ügyintéző: titkarsag@illesestarsa.hu';
const irodaiHits = findAzonositok(irodai).filter((m) => m.kind === 'email');
check('az irodai e-mail cím önállóan is azonosító', irodaiHits.length === 2, `${irodaiHits.length} db`);
check('az önálló e-mail cím automatikusan cserélhető', irodaiHits.every((m) => m.disposition === 'auto'));

check(
  'a findIdentifierTokens az e-mailt és az URL-t is visszaadja',
  findIdentifierTokens('írj a iroda@sarkozi.hu címre vagy nézd a www.sarkozi.hu oldalt.').map((t) => t.kind).join(',') ===
    'email,url',
);

// A három betűs magyar vezetéknevek eddig soha nem kerültek a töredéklistába.
for (const vezeteknev of ['Kis', 'Tar', 'Bán', 'Vas', 'Tót', 'Kun']) {
  const frags = buildFragments('e1', { surname: vezeteknev, given: 'Erika' });
  check(
    `a három betűs „${vezeteknev}" bekerül a töredéklistába`,
    frags.some((f) => f.needle.length === 3),
    frags.map((f) => f.needle).join(','),
  );
}

const vasFrags = buildFragments('e1', { surname: 'Vas', given: 'Erika' });
check(
  'a három betűs töredék megtalálja a nevet az e-mailben',
  findIdentifiersWithNames('vas.erika@pelda.hu', vasFrags).length === 1,
);
check(
  'a három betűs töredék NEM illeszkedik szó belsejébe',
  findIdentifiersWithNames('vasarnap@pelda.hu', vasFrags).length === 0,
);
check(
  'a három betűs töredék NEM illeszkedik idegen domainbe',
  findIdentifiersWithNames('iroda@vaskohaszat.hu', vasFrags).length === 0,
);

// A hosszabb töredéknél viszont nem szabad betűhatárt követelni.
const kovacsFrags = buildFragments('e1', { surname: 'Kovács', given: 'János' });
check(
  'a hosszabb töredék betűhatár nélkül is illeszkedik',
  findIdentifiersWithNames('kovacsjanos58@freemail.hu', kovacsFrags).length === 1,
);

/* ------------------------------------------------------------------ *
 *  ILLESZKEDÉS AZ ExtractedEntity ALAKHOZ
 * ------------------------------------------------------------------ */

const minta = perSample.get('kolcsonszerzodes')!;
const shape = asEntityShape(minta[0]!);
check('az entitás-alak megőrzi a pozíciót', shape.start === minta[0]!.start && shape.end === minta[0]!.end);
check('az entitás-alak a fajtát a rawLabel-be teszi', shape.rawLabel.startsWith('AZONOSITO:'));
check('az entitás-alak pontszáma a megbízhatóság', shape.score === minta[0]!.confidence);
const emailShape = asEntityShape(minta.find((m) => m.kind === 'email')!);
check('az e-mail címke „other"', emailShape.label === 'other');
const cimShape = asEntityShape(minta.find((m) => m.kind === 'cim')!);
check('a cím címkéje „place"', cimShape.label === 'place');

/* ------------------------------------------------------------------ *
 *  EMELET ÉS AJTÓ — a cím végéig kell érnie
 *
 *  A találat sokáig csak a házszámig tartott, mert az emelet-minta a kiírt
 *  „em."/„emelet" szót követelte. A „12. 2/4." alakból így „[lakcím] 2/4."
 *  lett a kimenetben — egy társasházban az emelet és az ajtó gyakran elég az
 *  azonosításhoz, tehát ez szivárgás volt, nem szépséghiba.
 *
 *  A második lista legalább annyira fontos: a jogi iratban a cím után rendszerint
 *  „I. r. alperes" vagy „II. fejezet" következik, és ezeket a címnek NEM szabad
 *  elnyelnie. Ezért kötelező az ajtószám a puszta római számos alaknál.
 * ------------------------------------------------------------------ */

const CIM_TORZS = '1085 Budapest, Baross u. 12.';

function cimTalalat(szoveg: string): string {
  const r = findAzonositok(szoveg).filter((x) => x.kind === 'cim');
  return r[0]?.text ?? '(nincs)';
}

for (const veg of ['2/4.', 'II/4.', '2. em. 4.', '2. emelet 4. ajtó', 'fszt. 3.', 'földszint 3.', 'III. 12.']) {
  const teljes = `${CIM_TORZS} ${veg}`;
  check(`a cím az emeletig ér — „${veg}"`, cimTalalat(`Lakcíme: ${teljes}`) === teljes, cimTalalat(`Lakcíme: ${teljes}`));
}

// A házszám maga is tartalmazhat perjelet: a két minta versenyezhet.
check(
  'a perjeles házszám után is elfogy az emelet',
  cimTalalat('Lakcíme: 1085 Budapest, Baross u. 12/A. 2/4.') === '1085 Budapest, Baross u. 12/A. 2/4.',
  cimTalalat('Lakcíme: 1085 Budapest, Baross u. 12/A. 2/4.'),
);

for (const utana of [
  'I. r. alperes ellen',
  'II. fejezet szerint',
  'A tanú elmondta.',
  'C épület',
  '5/2015. (XII. 1.) NGM rendelet',
  '2003. évi CXXIX. törvény',
]) {
  const kapott = cimTalalat(`Lakcíme: ${CIM_TORZS} ${utana}`);
  check(`a cím nem nyúlik túl — „${utana}"`, kapott === CIM_TORZS, kapott);
}

/* ------------------------------------------------------------------ *
 *  ÖSSZEGZÉS
 * ------------------------------------------------------------------ */

console.log('');
if (failures.length) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
}
console.log(`Azonosítók felismerése: ${pass}/${pass + fail} ellenőrzés rendben`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
