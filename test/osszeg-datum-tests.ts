/**
 * Az összeg- és dátumcsere mérése a három mintairaton.
 *
 *   npx tsx test/osszeg-datum-tests.ts
 *
 * Négy dolgot mérünk, ebben a fontossági sorrendben.
 *
 * 1. AMIT NEM SZABAD BÁNTANI. Egy jogi iratban a legdrágább hiba nem az, ha
 *    egy összeg bent marad, hanem ha a program átír valamit, amit nem lett
 *    volna szabad: a „2016. évi CXXX. törvény” évszámát, a „Ptk. 6:383. §”
 *    szakaszszámát, az ügyszámot, a bankszámlaszámot vagy az irányítószámot.
 *    Az ilyen csere nem anonimizálás, hanem az irat meghamisítása. Ezért a
 *    tesztek jó része azt méri, hogy a kimenet ezeken a pontokon BETŰRE
 *    azonos a bemenettel.
 *
 * 2. A VÉGÖSSZEGEK. Az arányos eltolás azért arányos, hogy az összeadások
 *    megmaradjanak. Ha a kerekítés elrontja őket, azt a modulnak jeleznie
 *    kell — a néma hiba itt rosszabb, mint a hangos.
 *
 * 3. A MAGYAR ALAKTAN. A betűs összeg („négymillió-nyolcszázezer”) és a
 *    ragozott nap („20-án”, de „21-én”) helyessége nem stílus kérdése: egy
 *    rossz toldalék azonnal elárulja, hogy a szöveget gép írta át, és az
 *    egész anonimizálás hitelét viszi.
 *
 * 4. AZ IDŐKÖZÖK. A dátumeltolás egyetlen értelme, hogy a napok közti
 *    távolság ne változzon — erre épül a jogi érvelés fele.
 */

import { readFileSync } from 'node:fs';

import {
  type OsszegMatch,
  alkalmazCserek as alkalmazOsszegCserek,
  cimkeSzoveg,
  findOsszegek,
  formazSzam,
  kerekitesiLepes,
  olvasSzamnev,
  osszegSzorzo,
  szamBetuvel,
  tervezOsszegCsere,
} from '../src/hu/osszegek.js';
import {
  type DatumMatch,
  alkalmazCserek as alkalmazDatumCserek,
  datumEltolas,
  ertelmezNapToldalek,
  evToldalekFelszin,
  findDatumok,
  napToldalekFelszin,
  tervezDatumCsere,
  tolDatum,
} from '../src/hu/datumok.js';

const SAMPLES = ['kolcsonszerzodes', 'keresetlevel', 'itelet'] as const;
const TITOK = 'proba-ugy-2026-szivecske';

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

function egyenlo(name: string, kapott: unknown, vart: unknown): void {
  check(name, kapott === vart, `kapott: ${String(kapott)}, várt: ${String(vart)}`);
}

function olvas(nev: string): string {
  return readFileSync(`samples/${nev}.txt`, 'utf8');
}

/* ================================================================== *
 *  1. MAGYAR SZÁMNÉV — GENERÁLÁS
 * ================================================================== */

console.log('\n— Magyar számnév képzése —');

/**
 * A várt alakok a magyar helyesírásból jönnek, nem a kódból. A tagolás az
 * AkH. 289.: kétezerig egybeírás, fölötte kötőjel a hármas csoportok határán.
 */
const SZAMNEV_PROBAK: readonly [number, string][] = [
  [0, 'nulla'],
  [1, 'egy'],
  [2, 'kettő'],
  [3, 'három'],
  [7, 'hét'],
  [10, 'tíz'],
  [11, 'tizenegy'],
  [12, 'tizenkettő'],
  [19, 'tizenkilenc'],
  [20, 'húsz'],
  [21, 'huszonegy'],
  [30, 'harminc'],
  [40, 'negyven'],
  [90, 'kilencven'],
  [100, 'száz'],
  [101, 'százegy'],
  [200, 'kétszáz'],
  [212, 'kétszáztizenkettő'],
  [999, 'kilencszázkilencvenkilenc'],
  [1000, 'ezer'],
  [1001, 'ezeregy'],
  [1999, 'ezerkilencszázkilencvenkilenc'],
  [2000, 'kétezer'],
  [2001, 'kétezer-egy'],
  [2019, 'kétezer-tizenkilenc'],
  [12000, 'tizenkétezer'],
  [100000, 'százezer'],
  [1000000, 'egymillió'],
  [1250000, 'egymillió-kétszázötvenezer'],
  [3550000, 'hárommillió-ötszázötvenezer'],
  [4800000, 'négymillió-nyolcszázezer'],
  [1234567, 'egymillió-kétszázharmincnégyezer-ötszázhatvanhét'],
];

for (const [n, vart] of SZAMNEV_PROBAK) {
  egyenlo(`${n} betűvel`, szamBetuvel(n), vart);
}

check(
  'kétezerig nincs kötőjel',
  !szamBetuvel(1999).includes('-') && !szamBetuvel(2000).includes('-'),
);
check('kétezer fölött van kötőjel', szamBetuvel(2001).includes('-'));

/* ================================================================== *
 *  2. MAGYAR SZÁMNÉV — ÉRTELMEZÉS
 * ================================================================== */

console.log('— Magyar számnév értelmezése —');

// Oda-vissza: amit leírunk, azt vissza is kell tudni olvasni.
let odaVissza = 0;
for (const [n] of SZAMNEV_PROBAK) {
  const s = szamBetuvel(n);
  if (olvasSzamnev(s, 0, n) === s.length) odaVissza++;
}
egyenlo('minden képzett alak visszaolvasható', odaVissza, SZAMNEV_PROBAK.length);

check(
  'a betűs alak csak a keresett értékre illeszkedik',
  olvasSzamnev('négymillió-nyolcszázezer', 0, 4800001) === null,
);
// A betűs alaknak a pénznem előtt véget kell érnie: a mögötte álló „hét”
// időszakot jelent, nem hetes számjegyet.
egyenlo(
  'a „hét” mint időszak nem ragad bele az összegbe',
  olvasSzamnev('négymillió-nyolcszázezer forint hét napon belül', 0, 4800000),
  'négymillió-nyolcszázezer'.length,
);
check('szó közepén nem áll meg', olvasSzamnev('hatvanas évek', 0, 60) === null);

/* ================================================================== *
 *  3. ÖSSZEGEK FELISMERÉSE — ALAKOK
 * ================================================================== */

console.log('— Összegalakok felismerése —');

interface AlakProba {
  szoveg: string;
  ertek: number;
  /** A teljes felszín, ahogy a találatnak vissza kell adnia. */
  felszin: string;
  betuvel?: string;
}

const ALAK_PROBAK: readonly AlakProba[] = [
  { szoveg: '1 250 000 Ft', ertek: 1250000, felszin: '1 250 000 Ft' },
  { szoveg: '1.250.000,- Ft', ertek: 1250000, felszin: '1.250.000,- Ft' },
  { szoveg: '1250000 forint', ertek: 1250000, felszin: '1250000 forint' },
  { szoveg: '12 500 EUR', ertek: 12500, felszin: '12 500 EUR' },
  { szoveg: '3 000 000,- HUF', ertek: 3000000, felszin: '3 000 000,- HUF' },
  { szoveg: 'havi 85.000 Ft', ertek: 85000, felszin: '85.000 Ft' },
  {
    szoveg: '1 250 000 (egymillió-kétszázötvenezer) forint',
    ertek: 1250000,
    felszin: '1 250 000 (egymillió-kétszázötvenezer) forint',
    betuvel: 'egymillió-kétszázötvenezer',
  },
  {
    szoveg: '4 800 000 Ft, azaz négymillió-nyolcszázezer forint',
    ertek: 4800000,
    felszin: '4 800 000 Ft, azaz négymillió-nyolcszázezer forint',
    betuvel: 'négymillió-nyolcszázezer',
  },
];

for (const p of ALAK_PROBAK) {
  const ms = findOsszegek(p.szoveg);
  check(`egy találat: „${p.szoveg}”`, ms.length === 1, `kapott: ${ms.length}`);
  const m = ms[0];
  if (m === undefined) continue;
  egyenlo(`érték: „${p.szoveg}”`, m.ertek, p.ertek);
  egyenlo(`felszín: „${p.szoveg}”`, m.text, p.felszin);
  egyenlo(`betűs alak: „${p.szoveg}”`, m.betuvel?.text ?? null, p.betuvel ?? null);
}

/**
 * Ezek NEM összegek. Egyet is átírni közülük nem anonimizálás, hanem az irat
 * meghamisítása — más törvényre, más szakaszra, más ügyszámra hivatkozás.
 */
const NEM_OSSZEG: readonly string[] = [
  'a Ptk. 6:383. §-a alapján',
  '2016. évi CXXX. törvény 170. §-a',
  '12.P.20.845/2026/8.',
  '10402142-49575354-56561008 számú bankszámlájára',
  'adóazonosító jel: 8442130976',
  'TAJ szám: 111 111 110',
  '15 napon belül',
  'cégjegyzékszám: 13-09-184627',
  '2011 Budakalász, Szentendrei út 78/B. II. em. 5.',
];
for (const s of NEM_OSSZEG) {
  check(`nem összeg: „${s}”`, findOsszegek(s).length === 0, `talált: ${findOsszegek(s).length}`);
}

/* ================================================================== *
 *  4. ÖSSZEGEK A MINTAIRATOKON
 * ================================================================== */

console.log('— Összegek a mintairatokon —');

/** A darabszámok az iratokból számoltak, nem a kód kimenetéből. */
const VART_OSSZEG: Record<string, number> = {
  kolcsonszerzodes: 3,
  keresetlevel: 7,
  itelet: 8,
};

const osszegPerMinta = new Map<string, OsszegMatch[]>();
for (const nev of SAMPLES) {
  const szoveg = olvas(nev);
  const ms = findOsszegek(szoveg);
  osszegPerMinta.set(nev, ms);
  egyenlo(`${nev}: összegek száma`, ms.length, VART_OSSZEG[nev]);
  check(
    `${nev}: minden összegnek van pénzneme`,
    ms.every((m) => m.penznem === 'HUF'),
  );
  check(
    `${nev}: minden találat felszíne pontos`,
    ms.every((m) => szoveg.slice(m.start, m.end) === m.text),
  );
}

// A betűs alakot mindkét irat kiírja, ahol az irat is kiírta.
check(
  'a kölcsönszerződés betűs összege megvan',
  osszegPerMinta.get('kolcsonszerzodes')!.some((m) => m.betuvel?.text === 'négymillió-nyolcszázezer'),
);
check(
  'az ítélet betűs összege megvan',
  osszegPerMinta.get('itelet')!.some((m) => m.betuvel?.text === 'hárommillió-ötszázötvenezer'),
);

/* ================================================================== *
 *  5. ARÁNYOS ELTOLÁS
 * ================================================================== */

console.log('— Arányos összegeltolás —');

const szorzo = osszegSzorzo(TITOK);
check('a szorzó a 0,8–1,25 sávban van', szorzo >= 0.8 && szorzo <= 1.25, `szorzó: ${szorzo}`);
check(
  'a szorzó nem esik az 1 körüli holtsávba',
  szorzo <= 0.97 || szorzo >= 1.03,
  `szorzó: ${szorzo}`,
);
egyenlo('a szorzó ugyanarra a titokra ugyanaz', osszegSzorzo(TITOK), szorzo);
check('más titok más szorzót ad', osszegSzorzo(`${TITOK}-masik`) !== szorzo);

// A kerekítés az eredeti kerekségéhez igazodik: a kerek összeg maradjon kerek.
egyenlo('4 800 000 kerekítési lépése', kerekitesiLepes(4800000, 0), 100000);
egyenlo('619 400 kerekítési lépése', kerekitesiLepes(619400, 0), 100);
egyenlo('1 250 000 kerekítési lépése', kerekitesiLepes(1250000, 0), 10000);
egyenlo('tizedesnél a lépés a tizedes', kerekitesiLepes(1250.5, 2), 0.01);

for (const nev of SAMPLES) {
  const szoveg = olvas(nev);
  const ms = osszegPerMinta.get(nev)!;
  const terv = tervezOsszegCsere(ms, { caseSecret: TITOK, mod: 'aranyos' });
  const uj = alkalmazOsszegCserek(szoveg, terv.cserek);
  const ujMs = findOsszegek(uj);

  egyenlo(`${nev}: a csere után ugyanannyi összeg`, ujMs.length, ms.length);

  // Ez a modul lényege: az összeadások a csere UTÁN is stimmelnek.
  check(
    `${nev}: minden felismert összefüggés megmaradt`,
    terv.osszefuggesek.every((o) => o.megmaradt),
    terv.osszefuggesek
      .filter((o) => !o.megmaradt)
      .map((o) => `${o.ujA}+${o.ujB}!=${o.ujC}`)
      .join(', '),
  );
  check(
    `${nev}: ha elromlana egy végösszeg, figyelmeztetés jár érte`,
    terv.osszefuggesek.every((o) => o.megmaradt) ===
      !terv.figyelmeztetesek.some((f) => f.startsWith('Elromlott végösszeg')),
  );

  // Minden összeg tényleg megváltozott, és nem szaladt el a nagyságrend.
  const parok = ms.map((m, i) => [m.ertek, ujMs[i]?.ertek ?? 0] as const);
  check(
    `${nev}: minden összeg megváltozott`,
    parok.every(([regi, ujE]) => regi !== ujE),
    parok.filter(([r, u]) => r === u).map(([r]) => String(r)).join(', '),
  );
  check(
    `${nev}: az arány a szorzó közelében marad`,
    parok.every(([regi, ujE]) => ujE / regi > 0.75 && ujE / regi < 1.3),
  );

  // Ugyanaz az összeg mindenhol ugyanarra cserélődik.
  const leképezes = new Map<number, number>();
  let egyseges = true;
  for (const [regi, ujE] of parok) {
    const volt = leképezes.get(regi);
    if (volt !== undefined && volt !== ujE) egyseges = false;
    leképezes.set(regi, ujE);
  }
  check(`${nev}: azonos összeg azonos cserét kap`, egyseges);

  // A betűs alakot is átírtuk, méghozzá az ÚJ számra.
  for (const m of ujMs) {
    if (m.betuvel === null) continue;
    egyenlo(
      `${nev}: a betűs alak az új számot mondja`,
      m.betuvel.text,
      szamBetuvel(m.ertek),
    );
  }
  check(
    `${nev}: a régi betűs alak eltűnt`,
    !uj.includes('négymillió-nyolcszázezer') && !uj.includes('hárommillió-ötszázötvenezer'),
  );
}

/**
 * Egy ügy több iratában ugyanaz az összeg ugyanarra kell cserélődjön. Ha csak
 * a szorzó közös, az még kevés: a kerekítési rács iratonként más lehet, mert
 * más összegek adódnak össze benne. A `tovabbiErtekek` ezt hozza helyre — az
 * ügyvéd, aki a szerződést és az ítéletet egymás mellé teszi, különben azonnal
 * két különböző kölcsönösszeget látna.
 */
{
  const mindenErtek = SAMPLES.flatMap((nev) =>
    osszegPerMinta.get(nev)!.map((m) => ({ penznem: m.penznem, ertek: m.ertek, tizedesek: m.alak.tizedesek })),
  );
  const ujErtekPerMinta = new Map<string, Map<number, number>>();
  for (const nev of SAMPLES) {
    const ms = osszegPerMinta.get(nev)!;
    const terv = tervezOsszegCsere(ms, {
      caseSecret: TITOK,
      mod: 'aranyos',
      tovabbiErtekek: mindenErtek,
    });
    const uj = alkalmazOsszegCserek(olvas(nev), terv.cserek);
    const parok = new Map<number, number>();
    findOsszegek(uj).forEach((u, i) => parok.set(ms[i]!.ertek, u.ertek));
    ujErtekPerMinta.set(nev, parok);
    check(
      `${nev}: az ügyszintű rácson is megmaradnak az összefüggések`,
      terv.osszefuggesek.every((o) => o.megmaradt),
    );
  }
  let egyseges = true;
  const latott = new Map<number, number>();
  for (const parok of ujErtekPerMinta.values()) {
    for (const [regi, ujE] of parok) {
      const volt = latott.get(regi);
      if (volt !== undefined && volt !== ujE) egyseges = false;
      latott.set(regi, ujE);
    }
  }
  check('ugyanaz az összeg minden iratban ugyanarra cserélődik', egyseges);
}

/* ================================================================== *
 *  6. CÍMKÉS MÓD
 * ================================================================== */

console.log('— Címkés összegcsere —');

egyenlo('toldalék nélkül', cimkeSzoveg(null), '[összeg]');
// A „Ft-ot” kiejtve „forintot”; az „összeg” hangrendje viszont magas, ezért
// „összeget” a helyes alak — a toldalékot újraképezzük, nem lemásoljuk.
egyenlo('„Ft-ot” → tárgyeset', cimkeSzoveg('ot'), '[összeget]');
egyenlo('„Ft-ra” → -re', cimkeSzoveg('ra'), '[összegre]');
egyenlo('„Ft-tól” → -től', cimkeSzoveg('tól'), '[összegtől]');
egyenlo('ismeretlen toldalékot elhagyunk', cimkeSzoveg('xyz'), '[összeg]');

for (const nev of SAMPLES) {
  const szoveg = olvas(nev);
  const ms = osszegPerMinta.get(nev)!;
  const terv = tervezOsszegCsere(ms, { caseSecret: TITOK, mod: 'cimke' });
  const uj = alkalmazOsszegCserek(szoveg, terv.cserek);
  check(`${nev}: címkés módban nem marad összeg`, findOsszegek(uj).length === 0);
  check(`${nev}: a címkés mód figyelmeztet a szám elvesztéséről`, terv.figyelmeztetesek.length > 0);
  egyenlo(`${nev}: címkés módban nincs szorzó`, terv.szorzo, null);
}

/* ================================================================== *
 *  7. SZÁMFORMÁZÁS
 * ================================================================== */

console.log('— Számformázás —');

egyenlo(
  'szóközös tagolás megmarad',
  formazSzam(1250000, { elvalaszto: ' ', tizedesek: 0, vesszoKotojel: false }),
  '1 250 000',
);
egyenlo(
  'pontos tagolás és „,-” megmarad',
  formazSzam(1250000, { elvalaszto: '.', tizedesek: 0, vesszoKotojel: true }),
  '1.250.000,-',
);
egyenlo(
  'tagolatlan marad tagolatlan',
  formazSzam(1250000, { elvalaszto: null, tizedesek: 0, vesszoKotojel: false }),
  '1250000',
);
egyenlo(
  'a tizedesjegyek száma megmarad',
  formazSzam(1250.5, { elvalaszto: ' ', tizedesek: 2, vesszoKotojel: false }),
  '1 250,50',
);

/* ================================================================== *
 *  8. NAPTOLDALÉK
 * ================================================================== */

console.log('— A napok toldaléka —');

/**
 * A várt alakok a magyar kiejtésből jönnek: a toldalék a sorszámnév
 * hangrendjéhez igazodik, nem a leírt számjegyhez. Ezért „4-én”, de „5-én”;
 * „20-án”, de „21-én”. Az elseje kivétel: „1-jén”.
 */
const NAP_SUP: readonly [number, string][] = [
  [1, '1-jén'], [2, '2-án'], [3, '3-án'], [4, '4-én'], [5, '5-én'], [6, '6-án'],
  [7, '7-én'], [8, '8-án'], [9, '9-én'], [10, '10-én'], [11, '11-én'], [12, '12-én'],
  [13, '13-án'], [14, '14-én'], [15, '15-én'], [16, '16-án'], [17, '17-én'],
  [18, '18-án'], [19, '19-én'], [20, '20-án'], [21, '21-én'], [22, '22-én'],
  [23, '23-án'], [24, '24-én'], [25, '25-én'], [26, '26-án'], [27, '27-én'],
  [28, '28-án'], [29, '29-én'], [30, '30-án'], [31, '31-én'],
];

const supToldalek = ertelmezNapToldalek('én');
check('a „-én” toldalék felismerhető', supToldalek !== null);
if (supToldalek !== null) {
  for (const [nap, vart] of NAP_SUP) {
    egyenlo(`${nap}. felszíni határozóban`, `${nap}${napToldalekFelszin(nap, supToldalek)}`, vart);
  }
}

const ablToldalek = ertelmezNapToldalek('étől');
if (ablToldalek !== null) {
  egyenlo('1-jétől', `1${napToldalekFelszin(1, ablToldalek)}`, '1-jétől');
  egyenlo('20-ától', `20${napToldalekFelszin(20, ablToldalek)}`, '20-ától');
  egyenlo('24-étől', `24${napToldalekFelszin(24, ablToldalek)}`, '24-étől');
}

const kepzo = ertelmezNapToldalek('i');
if (kepzo !== null) {
  egyenlo('15-i', `15${napToldalekFelszin(15, kepzo)}`, '15-i');
  // Az elsejénél a képző is a kiejtett alakot követi: „elsejei”.
  egyenlo('1-jei', `1${napToldalekFelszin(1, kepzo)}`, '1-jei');
}

const rovidTer = ertelmezNapToldalek('ig');
if (rovidTer !== null) {
  // Ha az irat a rövid alakot írta, nem írjuk át a stílusát.
  egyenlo('24-ig marad rövid', `24${napToldalekFelszin(24, rovidTer)}`, '24-ig');
}
const hosszuTer = ertelmezNapToldalek('éig');
if (hosszuTer !== null) {
  egyenlo('24-éig marad hosszú', `24${napToldalekFelszin(24, hosszuTer)}`, '24-éig');
  egyenlo('20-áig mély hangrenddel', `20${napToldalekFelszin(20, hosszuTer)}`, '20-áig');
}

check('a nem-toldalék betűsort elutasítjuk', ertelmezNapToldalek('xyz') === null);

// Az évszám toldaléka az év KIEJTETT alakjához igazodik: „kétezer-tizenkilenc”
// magas, „kétezer-húsz” mély hangrendű, ezért „2019-ben”, de „2020-ban”.
egyenlo('2019-ben', `2019-${evToldalekFelszin(2019, 'INE')}`, '2019-ben');
egyenlo('2020-ban', `2020-${evToldalekFelszin(2020, 'INE')}`, '2020-ban');
egyenlo('1968-ban', `1968-${evToldalekFelszin(1968, 'INE')}`, '1968-ban');
egyenlo('2019-től', `2019-${evToldalekFelszin(2019, 'ABL')}`, '2019-től');
egyenlo('2020-tól', `2020-${evToldalekFelszin(2020, 'ABL')}`, '2020-tól');
// A tárgyesetet nem vállaljuk: ott a tő is változik („húsz” → „huszat”), és a
// toldalék levágásával csak hibás alak jönne ki.
egyenlo('a tárgyesetet nem képezzük évszámra', evToldalekFelszin(2020, 'ACC'), '');
egyenlo('a „2020-at” nem dátumtalálat', findDatumok('a 2020-at nézve').length, 0);

/* ================================================================== *
 *  9. DÁTUMALAKOK FELISMERÉSE
 * ================================================================== */

console.log('— Dátumalakok felismerése —');

interface DatumProba {
  szoveg: string;
  felszin: string;
  ev: number | null;
  honap: number | null;
  nap: number | null;
}

const DATUM_PROBAK: readonly DatumProba[] = [
  { szoveg: '2026. június 24.', felszin: '2026. június 24.', ev: 2026, honap: 6, nap: 24 },
  { szoveg: '2026.06.24.', felszin: '2026.06.24.', ev: 2026, honap: 6, nap: 24 },
  { szoveg: '2026. 06. 24.', felszin: '2026. 06. 24.', ev: 2026, honap: 6, nap: 24 },
  { szoveg: '2026. VI. 24.', felszin: '2026. VI. 24.', ev: 2026, honap: 6, nap: 24 },
  { szoveg: 'június 24-én', felszin: 'június 24-én', ev: null, honap: 6, nap: 24 },
  {
    szoveg: 'a 2026. június 24-i szerződés',
    felszin: '2026. június 24-i',
    ev: 2026,
    honap: 6,
    nap: 24,
  },
  { szoveg: '2025 februárjában', felszin: '2025 februárjában', ev: 2025, honap: 2, nap: null },
  { szoveg: 'júniusában', felszin: 'júniusában', ev: null, honap: 6, nap: null },
];

for (const p of DATUM_PROBAK) {
  const ms = findDatumok(p.szoveg);
  check(`egy dátum: „${p.szoveg}”`, ms.length === 1, `kapott: ${ms.length}`);
  const m = ms[0];
  if (m === undefined) continue;
  egyenlo(`dátum felszíne: „${p.szoveg}”`, m.text, p.felszin);
  egyenlo(`dátum éve: „${p.szoveg}”`, m.ev, p.ev);
  egyenlo(`dátum hónapja: „${p.szoveg}”`, m.honap, p.honap);
  egyenlo(`dátum napja: „${p.szoveg}”`, m.nap, p.nap);
}

// A ragozott nap a környezetből örökli a hónapot és az évet.
const tartomany = findDatumok('2025. június 20-ától 24-éig');
egyenlo('a tartomány két találat', tartomany.length, 2);
const orokolt = tartomany.find((m) => m.kind === 'nap');
check('a puszta nap találat lett', orokolt !== undefined);
if (orokolt !== undefined) {
  egyenlo('a puszta nap hónapot örökölt', orokolt.honap, 6);
  egyenlo('a puszta nap évet örökölt', orokolt.ev, 2025);
  egyenlo('a puszta nap átnézendő', orokolt.disposition, 'review');
}

// Az évet ki nem író hónap a szomszédos dátumból veszi.
const ketHonap = findDatumok('2025 júniusa és szeptembere között');
egyenlo('két hónaptalálat', ketHonap.length, 2);
egyenlo('a második hónap évet örökölt', ketHonap[1]?.ev, 2025);
check('az öröklés jelezve van', ketHonap[1]?.evOrokolt === true);

/**
 * Ezek NEM dátumok. A jogszabály-hivatkozás évszáma a törvény nevének része;
 * eltolva az irat MÁS TÖRVÉNYRE hivatkozna.
 */
const NEM_DATUM: readonly string[] = [
  '2016. évi CXXX. törvény 170. §-a',
  '12.P.20.845/2026/8.',
  '2000 Szentendre, Bükkös part 14.',
  '1052 Budapest, Városház utca 12.',
  'cégjegyzékszám: 13-09-184627',
  'a Ptk. 6:383. §-a alapján',
  'adóazonosító jel: 8442130976',
];
for (const s of NEM_DATUM) {
  check(`nem dátum: „${s}”`, findDatumok(s).length === 0, `talált: ${findDatumok(s).length}`);
}

/* ================================================================== *
 *  10. DÁTUMOK A MINTAIRATOKON
 * ================================================================== */

console.log('— Dátumok a mintairatokon —');

/** A darabszámok az iratokból számoltak, nem a kód kimenetéből. */
const VART_DATUM: Record<string, number> = {
  kolcsonszerzodes: 5,
  keresetlevel: 16,
  itelet: 13,
};

const datumPerMinta = new Map<string, DatumMatch[]>();
for (const nev of SAMPLES) {
  const szoveg = olvas(nev);
  const ms = findDatumok(szoveg);
  datumPerMinta.set(nev, ms);
  egyenlo(`${nev}: dátumok száma`, ms.length, VART_DATUM[nev]);
  check(
    `${nev}: minden találat felszíne pontos`,
    ms.every((m) => szoveg.slice(m.start, m.end) === m.text),
  );
  check(
    `${nev}: nincs átfedő dátumtalálat`,
    ms.every((m, i) => i === 0 || m.start >= (ms[i - 1]?.end ?? 0)),
  );
}

// A három születési dátum a legérzékenyebb adat az iratokban.
for (const nev of SAMPLES) {
  const ms = datumPerMinta.get(nev)!;
  if (!olvas(nev).includes('1968. április 3.')) continue;
  check(
    `${nev}: a születési dátum megvan`,
    ms.some((m) => m.text === '1968. április 3.' && m.disposition === 'auto'),
  );
}

/* ================================================================== *
 *  11. DÁTUMELTOLÁS
 * ================================================================== */

console.log('— Dátumeltolás —');

const eltolas = datumEltolas(TITOK);
check('az eltolás ±400 napon belül van', Math.abs(eltolas) <= 400, `eltolás: ${eltolas}`);
check('az eltolás legalább 30 nap', Math.abs(eltolas) >= 30, `eltolás: ${eltolas}`);
egyenlo('ugyanaz a titok ugyanazt az eltolást adja', datumEltolas(TITOK), eltolas);
check('más titok más eltolást ad', datumEltolas(`${TITOK}-masik`) !== eltolas);

const NAP_MS = 86_400_000;
function napokKozott(a: DatumMatch, b: DatumMatch): number | null {
  if (a.ev === null || a.honap === null || a.nap === null) return null;
  if (b.ev === null || b.honap === null || b.nap === null) return null;
  return (Date.UTC(b.ev, b.honap - 1, b.nap) - Date.UTC(a.ev, a.honap - 1, a.nap)) / NAP_MS;
}

for (const nev of SAMPLES) {
  const szoveg = olvas(nev);
  const ms = datumPerMinta.get(nev)!;
  const terv = tervezDatumCsere(ms, { caseSecret: TITOK, szoveg });
  const uj = alkalmazDatumCserek(szoveg, terv.cserek);
  const ujMs = findDatumok(uj);

  egyenlo(`${nev}: a csere után ugyanannyi dátum`, ujMs.length, ms.length);
  egyenlo(`${nev}: minden dátumra jutott csere`, terv.cserek.length, ms.length);

  // EZ A LÉNYEG: a napra pontos dátumok közti időköz nem változhat. A hónap-
  // vagy évpontosságú dátumoknál ez fogalmilag nem is kérhető: az irat maga
  // sem mondta meg a napot, ezért a horgonyra igazítás pár hetet csúszhat —
  // erről a modul külön figyelmeztet.
  const teljesek = ms
    .map((m, i) => ({ regi: m, uj: ujMs[i] }))
    .filter((p) => p.regi.kind === 'teljes_datum' && p.uj?.kind === 'teljes_datum');
  let idokozOk = true;
  let elteres = '';
  for (let i = 0; i + 1 < teljesek.length; i++) {
    const a = teljesek[i]!;
    const b = teljesek[i + 1]!;
    const regi = napokKozott(a.regi, b.regi);
    const ujTav = napokKozott(a.uj!, b.uj!);
    if (regi === null || ujTav === null) continue;
    if (regi !== ujTav) {
      idokozOk = false;
      elteres = `${a.regi.text}→${b.regi.text}: ${regi} helyett ${ujTav}`;
      break;
    }
  }
  check(`${nev}: a napra pontos dátumok időköze megmaradt`, idokozOk, elteres);
  check(
    `${nev}: a durva felbontású dátumokról figyelmeztetés szól`,
    ms.every((m) => m.kind === 'teljes_datum') ||
      terv.figyelmeztetesek.some((f) => f.includes('NAPRA PONTOS')),
  );

  // Minden nappal vagy hónappal megadott dátum eltolódott. A puszta évszám
  // kivétel: 2019 nyara plusz száz nap is 2019 — ez nem hiba, de akkor a
  // modulnak jeleznie kell, hogy az az adat bent maradt az iratban.
  check(
    `${nev}: minden nap/hónap dátum megváltozott`,
    ms.every((m, i) => m.kind === 'ev' || m.text !== ujMs[i]?.text),
    ms.filter((m, i) => m.kind !== 'ev' && m.text === ujMs[i]?.text).map((m) => m.text).join(', '),
  );
  const valtozatlanEv = ms.filter((m, i) => m.kind === 'ev' && m.text === ujMs[i]?.text);
  check(
    `${nev}: a változatlan évszámról figyelmeztetés szól`,
    valtozatlanEv.every((m) =>
      terv.figyelmeztetesek.some((f) => f.startsWith('Nem változott') && f.includes(m.text)),
    ),
  );

  // A ragozott alakok újraragozva, nem lemásolva.
  for (const m of ujMs) {
    if (m.alak.napToldalek === null || m.nap === null) continue;
    egyenlo(
      `${nev}: „${m.text}” toldaléka az új naphoz igazodik`,
      m.alak.napToldalek.felszin,
      napToldalekFelszin(m.nap, m.alak.napToldalek).replace(/^-/, ''),
    );
  }

  // A motornak jeleznie kell a határidő-csúszást, akkor is, ha a felület már
  // kiírta a beállításnál.
  check(
    `${nev}: figyelmeztet a határidő-csúszásra`,
    terv.figyelmeztetesek.some((f) => f.includes('HATÁRIDŐ-SZÁMÍTÁS')),
  );
}

// Az eltolás iránya és nagysága ugyanaz minden dátumra.
{
  const ms = datumPerMinta.get('itelet')!;
  const teljes = ms.filter((m) => m.ev !== null && m.honap !== null && m.nap !== null);
  const eltolt = teljes.map((m) => tolDatum(m.ev!, m.honap!, m.nap!, eltolas));
  check(
    'az eltolás minden dátumra ugyanannyi nap',
    eltolt.every((u, i) => {
      const m = teljes[i]!;
      const kulonbseg =
        (Date.UTC(u.ev, u.honap - 1, u.nap) - Date.UTC(m.ev!, m.honap! - 1, m.nap!)) / NAP_MS;
      return kulonbseg === eltolas;
    }),
  );
}

/* ================================================================== *
 *  12. AMIT NEM SZABAD BÁNTANI — A TELJES KIMENETEN
 * ================================================================== */

console.log('— Sérthetetlen részletek a kimenetben —');

/**
 * Ezek a részletek a csere UTÁN is betűre azonosak kell legyenek. Ha ezek
 * bármelyike megváltozik, az irat hamis: más jogszabályra, más ügyszámra,
 * más bankszámlára hivatkozik, mint az eredeti.
 */
const SERTHETETLEN: readonly string[] = [
  'Ptk. 6:383. §',
  'Ptk. 6:389. §',
  'Ptk. 6:419. §',
  'Ptk. 6:48. §',
  '2016. évi CXXX. törvény',
  '12.P.20.845/2026/8.',
  '10402142-49575354-56561008',
  '10300002-10517493-49020015',
  'HU42 1040 2142 4957 5354 5656 1008',
  '8442130976',
  '8391764205',
  '8000000008',
  '111 111 110',
  '13-09-184627',
  '24817350-2-13',
  '2000 Szentendre',
  '2011 Budakalász',
  '1052 Budapest',
  '78/B',
  '15 napon belül',
  '356214KA',
  '481029ZE',
  '+36 30 412 7758',
];

for (const nev of SAMPLES) {
  const szoveg = olvas(nev);
  const osszegTerv = tervezOsszegCsere(osszegPerMinta.get(nev)!, {
    caseSecret: TITOK,
    mod: 'aranyos',
  });
  const datumTerv = tervezDatumCsere(datumPerMinta.get(nev)!, { caseSecret: TITOK, szoveg });

  // A két tervet EGY listába fűzve kell alkalmazni. Két külön hívás a
  // másodikat már eltolódott pozíciókra tenné, mert a betűs összegalak cseréje
  // megváltoztatja a szöveg hosszát. Ehhez az kell, hogy a két terv
  // tartományai soha ne fedjenek át — ezt itt külön is megmérjük.
  const mind = [...osszegTerv.cserek, ...datumTerv.cserek].sort((a, b) => a.start - b.start);
  check(
    `${nev}: az összeg- és dátumcserék nem fednek át`,
    mind.every((c, i) => i === 0 || c.start >= (mind[i - 1]?.end ?? 0)),
  );

  const uj = alkalmazOsszegCserek(szoveg, mind);
  check(
    `${nev}: az összefűzött terv minden dátumot megőriz`,
    findDatumok(uj).length === datumPerMinta.get(nev)!.length,
  );
  check(
    `${nev}: az összefűzött terv minden összeget megőriz`,
    findOsszegek(uj).length === osszegPerMinta.get(nev)!.length,
  );
  for (const darab of SERTHETETLEN) {
    if (!szoveg.includes(darab)) continue;
    check(`${nev}: sértetlen „${darab}”`, uj.includes(darab));
  }

  // A csere nem eshet szét: a sorok száma és a bekezdésszerkezet marad.
  egyenlo(`${nev}: a sorok száma nem változott`, uj.split('\n').length, szoveg.split('\n').length);
}

/* ================================================================== *
 *  13. FIGYELMEZTETÉSEK
 * ================================================================== */

console.log('— Figyelmeztetések —');

// Szándékosan elrontható végösszeg: a részek durva rácson, a végösszeg finomon.
{
  const szoveg = '1 000 000 Ft és 1 000 001 Ft, összesen 2 000 001 Ft.';
  const ms = findOsszegek(szoveg);
  egyenlo('a mesterséges eset három összeget ad', ms.length, 3);
  const terv = tervezOsszegCsere(ms, { caseSecret: TITOK, mod: 'aranyos' });
  check('a mesterséges esetben van felismert összefüggés', terv.osszefuggesek.length > 0);
  const romlott = terv.osszefuggesek.filter((o) => !o.megmaradt);
  check(
    'ami elromlott, arról van figyelmeztetés',
    romlott.length === terv.figyelmeztetesek.filter((f) => f.startsWith('Elromlott végösszeg')).length,
  );
}

// Változatlanul maradó összeg: erről is szólni kell, mert NEM anonimizálódott.
{
  const ms = findOsszegek('12 Ft');
  const terv = tervezOsszegCsere(ms, { caseSecret: TITOK, mod: 'aranyos' });
  const valtozott = terv.cserek.some((c) => c.szoveg !== '12');
  check(
    'a változatlan összegről figyelmeztetés szól',
    valtozott || terv.figyelmeztetesek.some((f) => f.startsWith('Nem változott')),
  );
}

// A hét napjaira hivatkozó irat külön figyelmeztetést kap.
{
  const szoveg = 'A felek 2025. március 14. napján, pénteken írták alá a szerződést.';
  const terv = tervezDatumCsere(findDatumok(szoveg), { caseSecret: TITOK, szoveg });
  check(
    'a napnevekre külön figyelmeztetés jár',
    eltolas % 7 === 0 || terv.figyelmeztetesek.some((f) => f.includes('hét napjaira')),
  );
}

/* ================================================================== *
 *  ÖSSZEGZÉS
 * ================================================================== */

console.log('');
if (failures.length) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
}
console.log(`Összegek és dátumok: ${pass}/${pass + fail} ellenőrzés rendben`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
