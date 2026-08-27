/**
 * A PRIORITÁSI ÁLNÉVKIOSZTÁS ÉS A NEM SZERINTI EGYEZTETÉS MÉRÉSE.
 *
 *   npx tsx test/prioritas-tests.ts
 *
 * Két, egymástól független elvárást mérünk, mert a kettő ugyanabban a
 * függvényben dől el (`assignPseudonyms`, src/pseudonym.ts), és egymást is el
 * tudja rontani:
 *
 *   1. NEM SZERINTI EGYEZTETÉS — a nő női, a férfi férfi utónevet kap. Ez a
 *      szabály régóta megvan, de a láncon végig kellett érnie: a kiosztó
 *      szűrése hiába jó, ha a munkamenet (`session.ts`) más álnevet tesz a
 *      szereplapra vagy a kész iratba. Ezért nem elég a kiosztót megkérdezni,
 *      a kész elemzésből is visszaolvassuk.
 *
 *   2. PRIORITÁSI SORREND — a névsorok a téma legjellemzőbb neveivel kezdődnek,
 *      és az iratban ELSŐKÉNT megjelenő fél a lista első nevét kapja. Ez volt
 *      az a viselkedés, amit a kulcsból számolt (HMAC-es) kiosztás nem tudott:
 *      determinisztikus volt, de véletlenszerű, tehát a felperes a készlet
 *      közepéről kapott nevet.
 *
 * MIÉRT A KÉSZ SZÖVEGBŐL MÉRÜNK a 2. pontnál: a megjelenés sorrendjét a motor a
 * dokumentum szövegéből olvassa ki, nem a féllistából. Ha a teszt maga adná át
 * a sorrendet, pontosan azt hagyná ki, ami elromolhat — hogy a motor tényleg a
 * szöveget nézi-e. Ezért igazi munkamenetet nyitunk egy .txt iratra, és a
 * felek listáját SZÁNDÉKOSAN fordított sorrendben adjuk át.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import { epitsdAJavaslatKerest } from '../src/app/temagyar.js';
import type { PartyInput } from '../src/app/types.js';
import type { SeedOrganization, SeedPerson } from '../src/hu/names.js';
import { type AnonEntity, type Theme, assignPseudonyms } from '../src/pseudonym.js';

const ROOT = process.cwd();

const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

const temaFajlok = ['kokorszak', 'asvanyok', 'novenyek', 'semleges_magyar'];
const temak = temaFajlok.map(
  (id) => JSON.parse(readFileSync(join(ROOT, `data/themes/${id}.json`), 'utf8')) as Theme,
);
const kokorszak = temak[0]!;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ell(ok: boolean, nev: string, reszlet = ''): void {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push(`${nev}${reszlet ? ` — ${reszlet}` : ''}`);
  }
}

/** Az álnév vezetékneve és utóneve külön — a szereplapon ez a két szó áll. */
function ketto(display: string): { vezetek: string; utonev: string } {
  const szavak = display.split(' ');
  return { vezetek: szavak[0] ?? '', utonev: szavak.slice(1).join(' ') };
}

function elsoUtonev(tema: Theme, gender: 'M' | 'F'): string {
  return tema.given_names.find((g) => g.gender === gender)?.form ?? '';
}

/* ================================================================== *
 *  1. NEM SZERINTI EGYEZTETÉS A KIOSZTÓBAN
 * ================================================================== */

console.log('');
console.log('NEM SZERINTI EGYEZTETÉS');
console.log('');

for (const tema of temak) {
  const ferfiNevek = new Set(tema.given_names.filter((g) => g.gender === 'M').map((g) => g.form));
  const noiNevek = new Set(tema.given_names.filter((g) => g.gender === 'F').map((g) => g.form));

  // Váltakozva férfi és nő, hogy a sorrend se tudja összekeverni a két készletet.
  const felek: SeedPerson[] = [];
  for (let i = 0; i < 5; i++) {
    felek.push({ kind: 'person', id: `m${i}`, surname: `Teszt${i}`, given: `Elek${i}`, gender: 'M' });
    felek.push({ kind: 'person', id: `f${i}`, surname: `Proba${i}`, given: `Anna${i}`, gender: 'F' });
  }
  const kiosztas = assignPseudonyms(felek, tema, {
    caseSecret: 'prioritas-nem',
    appearanceOrder: felek.map((f) => f.id),
  });

  const rosszNemuek: string[] = [];
  for (const f of felek) {
    const { utonev } = ketto(kiosztas.get(f.id)?.display ?? '');
    const jo = f.gender === 'M' ? ferfiNevek.has(utonev) : noiNevek.has(utonev);
    if (!jo) rosszNemuek.push(`${f.id}: ${utonev}`);
  }
  ell(
    rosszNemuek.length === 0,
    `${tema.id}: mind a ${felek.length} fél a saját neméhez tartozó utónevet kapta`,
    rosszNemuek.join(', '),
  );
}

/*
  AZ ISMERETLEN NEM ('N').

  Nem hibaeset, hanem külön viselkedés: az ilyen fél a TELJES utónévkészletet
  látja. Így a névsor elejéről kap nevet, akármelyik nemhez tartozik is —
  bármelyik irányba tippelni rosszabb volna, mert a rossz tipp az iratban
  ténymegállapításnak látszik („a felperes asszony”), a semleges választás
  viszont csak esetlegesnek.

  Amit KÖVETELÜNK tőle: legyen érvényes álneve a készletből, és ne akadjon el.
  Egy álnév nélkül maradt fél ugyanis nem szépséghiba, hanem SZIVÁRGÁS: a
  valódi neve marad az iratban.
*/
{
  const mindenNev = new Set(kokorszak.given_names.map((g) => g.form));
  const felek: SeedPerson[] = [
    { kind: 'person', id: 'x1', surname: 'Ismeretlen', given: 'Szem', gender: 'N' },
    { kind: 'person', id: 'x2', surname: 'Kovács', given: 'János', gender: 'M' },
    { kind: 'person', id: 'x3', surname: 'Szabó', given: 'Erzsébet', gender: 'F' },
  ];
  const kiosztas = assignPseudonyms(felek, kokorszak, {
    caseSecret: 'prioritas-ismeretlen-nem',
    appearanceOrder: felek.map((f) => f.id),
  });

  const ismeretlen = ketto(kiosztas.get('x1')?.display ?? '');
  ell(
    mindenNev.has(ismeretlen.utonev),
    `az ismeretlen nemű fél is a készletből kap utónevet („${ismeretlen.utonev}”)`,
  );
  ell(
    kiosztas.size === 3 && [...kiosztas.values()].every((a) => a.display.trim().length > 0),
    'az ismeretlen nem nem akasztja meg a kiosztást — mindhárom félnek van álneve',
  );
  // A többiek neme ettől nem romolhat el: az ismeretlen nemű fél elvitte a
  // névsor elejét, de a nemek szerinti szűrés utána is érvényes.
  const ferfiNevek = new Set(kokorszak.given_names.filter((g) => g.gender === 'M').map((g) => g.form));
  const noiNevek = new Set(kokorszak.given_names.filter((g) => g.gender === 'F').map((g) => g.form));
  ell(
    ferfiNevek.has(ketto(kiosztas.get('x2')?.display ?? '').utonev),
    'az ismeretlen nemű fél mögött a férfi továbbra is férfi utónevet kap',
  );
  ell(
    noiNevek.has(ketto(kiosztas.get('x3')?.display ?? '').utonev),
    'az ismeretlen nemű fél mögött a nő továbbra is női utónevet kap',
  );
}

/* ================================================================== *
 *  2. A NÉVSOR ELEJE AZ ELSŐ FÉLÉ — ÉS A KÉT LISTA ELEJE PÁROSUL
 * ================================================================== */

console.log('A PRIORITÁSI SORREND');
console.log('');

for (const tema of temak) {
  const felek: SeedPerson[] = [
    { kind: 'person', id: 'a', surname: 'Kovács', given: 'János', gender: 'M', role: 'felperes' },
    { kind: 'person', id: 'b', surname: 'Nagy', given: 'Péter', gender: 'M', role: 'alperes' },
    { kind: 'person', id: 'c', surname: 'Szabó', given: 'Erzsébet', gender: 'F', role: 'tanú' },
  ];
  const kiosztas = assignPseudonyms(felek, tema, {
    caseSecret: 'prioritas-lista',
    appearanceOrder: ['a', 'b', 'c'],
  });

  const elso = kiosztas.get('a')?.display ?? '';
  const masodik = kiosztas.get('b')?.display ?? '';

  /*
    A TELJES PÁROS, nem csak a vezetéknév. A prioritási lista akkor ér valamit,
    ha az első vezetéknév az első utónévvel áll össze — a kőkorszaki készletből
    így jön ki a „Kovakövi Frédi”, a sorozat főszereplője. A vezetéknévre
    magára szűkített mérés pont azt hagyná ki, amiért az egészet csináljuk.
  */
  const vartElso = `${tema.surnames[0]?.form ?? ''} ${elsoUtonev(tema, 'M')}`;
  ell(elso === vartElso, `${tema.id}: az elsőként megjelenő fél a névsor elejét kapja`, `${elso} ≠ ${vartElso}`);

  /*
    A MÁSODIK FÉL: a lista ELŐRE HALAD.

    Itt szándékosan nem azt írjuk elő, hogy pontosan a második nevet kapja.
    Két szabály közbeszólhat, és MINDKETTŐ jogos: a már kiosztott névvel azonos
    tövű név kiesik (a „Somfa” után a „Somfai” — az irat két főszereplője nem
    különbözhet egy betűben), és a saját vezetéknevével azonos tövű utónév is.
    Ha a teszt a pontos indexet követelné, ezeket a szabályokat írná felül —
    vagyis a mérés kényszerítené ki a rosszabb kimenetet.

    Amit KÖVETELÜNK, az a prioritás lényege: a második fél neve a listában
    HÁTRÉBB áll, mint az elsőé, és nem ugrik el a lista végére.
  */
  const vezetekIdx = (nev: string): number => tema.surnames.findIndex((s) => s.form === nev);
  const elsoIdx = vezetekIdx(ketto(elso).vezetek);
  const masodikIdx = vezetekIdx(ketto(masodik).vezetek);
  ell(elsoIdx === 0, `${tema.id}: az első fél vezetékneve a lista 0. eleme`, `index: ${elsoIdx}`);
  ell(
    masodikIdx > elsoIdx && masodikIdx <= elsoIdx + 2,
    `${tema.id}: a második fél a lista elején, közvetlenül az első mögött kap nevet`,
    `${masodik} — index: ${masodikIdx}`,
  );

  // A nő a SAJÁT névsora elejéről kap nevet: a nemenkénti szűrés miatt a két
  // lista külön halad, nem a férfiak által elhasznált helyről folytatja.
  const harmadik = ketto(kiosztas.get('c')?.display ?? '');
  ell(
    harmadik.utonev === elsoUtonev(tema, 'F'),
    `${tema.id}: az első nő a NŐI névsor elejét kapja („${harmadik.utonev}”)`,
  );
}

/*
  A KÉSZLET ELEJE NEM RAGAD BE A TŐTILTÁSON.

  Az „azonos tövű pár” tiltása (Zsályás Zsálya) korábban a tő első öt betűjét
  hasonlította össze, és emiatt két KÜLÖNBÖZŐ szót is azonosnak látott, ha
  ugyanúgy kezdődtek: a „Flintwood”-ot és a „Flint”-et. Prioritási kiosztásnál
  ez pont az ELSŐ fél nevét rontotta volna el. Az angol készleteket is
  végigmérjük, mert a hiba ott jelentkezett.
*/
for (const id of ['kokorszak_en', 'asvanyok_en', 'novenyek_en', 'semleges_magyar_en']) {
  const tema = JSON.parse(readFileSync(join(ROOT, `data/themes/${id}.json`), 'utf8')) as Theme;
  const felek: SeedPerson[] = [
    { kind: 'person', id: 'a', surname: 'Kovács', given: 'János', gender: 'M', role: 'felperes' },
  ];
  const kiosztas = assignPseudonyms(felek, tema, {
    caseSecret: 'prioritas-tő',
    appearanceOrder: ['a'],
  });
  const vart = `${tema.surnames[0]?.form ?? ''} ${elsoUtonev(tema, 'M')}`;
  ell(
    (kiosztas.get('a')?.display ?? '') === vart,
    `${id}: a tőtiltás nem veszi el a névsor élén álló párost`,
    `${kiosztas.get('a')?.display} ≠ ${vart}`,
  );
}

/*
  A TŐTILTÁS VISZONT MŰKÖDIK. A könnyítés nem szüntethette meg a szabályt: a
  „Zsályás Zsálya” a képzős alakjából jön, azt továbbra is el kell kerülni.
*/
{
  const tema: Theme = {
    ...kokorszak,
    id: 'to-teszt',
    surnames: [{ form: 'Zsályás' }, { form: 'Kavicsos' }],
    given_names: [
      { form: 'Zsálya', gender: 'M' },
      { form: 'Bazalt', gender: 'M' },
    ],
  };
  const kiosztas = assignPseudonyms(
    [{ kind: 'person', id: 'a', surname: 'Kovács', given: 'János', gender: 'M' }],
    tema,
    { caseSecret: 'prioritas-tő-2', appearanceOrder: ['a'] },
  );
  ell(
    (kiosztas.get('a')?.display ?? '') === 'Zsályás Bazalt',
    'a képzős azonos tő tiltása megmaradt: nem lesz „Zsályás Zsálya”',
    kiosztas.get('a')?.display ?? '',
  );
}

/* ================================================================== *
 *  3. KÉT FÉL SOSEM KAP AZONOS ÁLNEVET
 * ================================================================== */

console.log('AZ ÜTKÖZÉSMENTESSÉG');
console.log('');

for (const tema of temak) {
  const felek: AnonEntity[] = [];
  for (let i = 0; i < 7; i++) {
    felek.push({ kind: 'person', id: `m${i}`, surname: `Teszt${i}`, given: `Elek${i}`, gender: 'M' });
    felek.push({ kind: 'person', id: `f${i}`, surname: `Proba${i}`, given: `Anna${i}`, gender: 'F' });
  }
  felek.push({ kind: 'org', id: 'o1', name: 'Aranykalász Kereskedelmi Kft.' } as SeedOrganization);
  felek.push({ kind: 'org', id: 'o2', name: 'Napsugár Óvoda' } as SeedOrganization);

  const kiosztas = assignPseudonyms(felek, tema, {
    caseSecret: 'prioritas-utkozes',
    appearanceOrder: felek.map((f) => f.id),
  });
  const nevek = [...kiosztas.values()].map((a) => a.display);
  ell(
    new Set(nevek).size === nevek.length,
    `${tema.id}: a ${felek.length} fél mind KÜLÖNBÖZŐ álnevet kapott`,
    nevek.join(', '),
  );
  // Vezetéknév-ütközés sincs a személyek között: a névsor elejéről mindenki a
  // következő szabad nevet kapja, nem ugyanazt.
  const vezeteknevek = felek
    .filter((f) => f.kind === 'person')
    .map((f) => ketto(kiosztas.get(f.id)?.display ?? '').vezetek);
  ell(
    new Set(vezeteknevek).size === vezeteknevek.length,
    `${tema.id}: a személyek vezetéknevei is mind különböznek`,
  );
}

/*
  A KÉSZLET KIFOGYÁSA. Ha kevesebb a név, mint a fél, a kiosztónak akkor is
  ütközésmentesnek kell maradnia — számozott utótaggal. Ez csúnya, de nem
  szivárgás; az ütközés viszont az volna: két különböző valódi személy egyetlen
  álnév mögé kerülne, és a leképezés visszafejthetetlenné válna.
*/
{
  const szuk: Theme = {
    ...kokorszak,
    id: 'szuk',
    surnames: [{ form: 'Kovakövi' }, { form: 'Kavicsi' }],
    given_names: [
      { form: 'Frédi', gender: 'M' },
      { form: 'Béni', gender: 'M' },
    ],
  };
  const felek: SeedPerson[] = [];
  for (let i = 0; i < 5; i++) {
    felek.push({ kind: 'person', id: `p${i}`, surname: `Teszt${i}`, given: `Elek${i}`, gender: 'M' });
  }
  const kiosztas = assignPseudonyms(felek, szuk, {
    caseSecret: 'prioritas-szuk',
    appearanceOrder: felek.map((f) => f.id),
  });
  const nevek = felek.map((f) => kiosztas.get(f.id)?.display ?? '');
  ell(new Set(nevek).size === 5, 'kifogyott készletnél is öt KÜLÖNBÖZŐ álnév', nevek.join(', '));
  ell(nevek[0] === 'Kovakövi Frédi', 'a kifogyás előtt is a névsor eleje az elsőé', nevek[0] ?? '');
}

/* ================================================================== *
 *  4. A LÁNC VÉGE: A MOTOR A SZÖVEGBŐL OLVASSA A SORRENDET
 * ================================================================== */

console.log('A TELJES LÁNC EGY IRATON');
console.log('');

const munkamappa = mkdtempSync(join(tmpdir(), 'szivecske-prioritas-'));
const iratUt = join(munkamappa, 'kereset.txt');

/*
  Az irat sorrendje SZÁNDÉKOSAN nem az, ami a féllistában áll: a szövegben
  Szabó Erzsébet a felperes és ő jelenik meg elsőként, a féllistát viszont
  fordítva adjuk át. Ha a motor a listát nézné a szöveg helyett, ez a mérés
  bukna — és pontosan ez a hiba nem látszana semmilyen más teszten.
*/
writeFileSync(
  iratUt,
  [
    'KERESETLEVÉL',
    '',
    'Szabó Erzsébet felperes keresetet nyújt be Nagy Péter I. r. alperes és',
    'Kovács János II. r. alperes ellen.',
    '',
    'A felperes előadja, hogy Szabó Erzsébet és Nagy Péter szerződést kötött.',
    'Kovács János a szerződést ellenjegyezte.',
    '',
  ].join('\n'),
  'utf8',
);

const felekFordítva: PartyInput[] = [
  { id: 'p3', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'II. r. alperes' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
  { id: 'p1', kind: 'person', fullName: 'Szabó Erzsébet', gender: 'F', role: 'felperes' },
];

const session = await DocumentSession.open(iratUt, homonyms);
const eredmeny = session.analyze(
  {
    parties: felekFordítva,
    themeId: kokorszak.id,
    mode: 'theme',
    caseSecret: 'prioritas-lanc',
    acceptReview: true,
  },
  kokorszak,
  homonyms,
);

const szereplap = new Map(eredmeny.cast.map((c) => [c.entityId, c]));

// A felperes jelenik meg elsőként a SZÖVEGBEN, tehát ő kapja a névsor elejét —
// noha a féllistában utolsó.
const felperes = szereplap.get('p1')?.replacement ?? '';
ell(
  ketto(felperes).vezetek === (kokorszak.surnames[0]?.form ?? ''),
  `a szövegben elsőként megjelenő fél kapja az első vezetéknevet („${felperes}”)`,
);
ell(
  ketto(felperes).utonev === elsoUtonev(kokorszak, 'F'),
  `a felperes nő, ezért a NŐI névsor elejét kapja („${felperes}”)`,
);

const alperes1 = szereplap.get('p2')?.replacement ?? '';
ell(
  ketto(alperes1).vezetek === (kokorszak.surnames[1]?.form ?? ''),
  `a másodikként megjelenő fél a második vezetéknevet kapja („${alperes1}”)`,
);
ell(
  ketto(alperes1).utonev === elsoUtonev(kokorszak, 'M'),
  `az első férfi fél a FÉRFI névsor elejét kapja („${alperes1}”)`,
);

const alperes2 = szereplap.get('p3')?.replacement ?? '';
ell(
  ketto(alperes2).vezetek === (kokorszak.surnames[2]?.form ?? ''),
  `a harmadikként megjelenő fél a harmadik vezetéknevet kapja („${alperes2}”)`,
);

const lancNevek = [felperes, alperes1, alperes2];
ell(new Set(lancNevek).size === 3, 'a láncon végig is három különböző álnév', lancNevek.join(', '));

// A cserélt szöveg is ezt tartalmazza: a szereplap nem mondhat mást, mint a
// kész irat. Enélkül a mérés csak a felület felé menő táblát igazolná vissza.
const cserelt = session.anonymizedText();
ell(
  cserelt.includes(felperes) && !cserelt.includes('Szabó Erzsébet'),
  'a kész szövegben a felperes álneve áll, az eredeti neve nem',
);

console.log('   a féllista sorrendje:  p3 (Kovács), p2 (Nagy), p1 (Szabó)');
console.log('   a szöveg sorrendje:    Szabó → Nagy → Kovács');
for (const id of ['p1', 'p2', 'p3']) {
  const c = szereplap.get(id);
  console.log(`     ${(c?.original ?? '').padEnd(18)} → ${c?.replacement ?? ''}`);
}
console.log('');

rmSync(munkamappa, { recursive: true, force: true });

/* ================================================================== *
 *  5. A GENERÁLÓ MODELL UTASÍTÁSA
 * ================================================================== */

console.log('A MODELLNEK SZÓLÓ KÉRÉS');
console.log('');

const keres = epitsdAJavaslatKerest('görög mitológia');
ell(keres.includes('PRIORITÁSI SORRENDBEN'), 'a kérés prioritási sorrendet kér a modelltől');
ell(
  keres.includes('LEGFONTOSABB') && keres.includes('ELEJÉRŐL'),
  'a kérés meg is MONDJA, miért: az irat legfontosabb szereplője a lista elejéről kap nevet',
);
ell(
  keres.includes('első vezetéknév') && keres.includes('első utónév'),
  'a kérés a két lista elejének a PÁROSÍTÁSÁT is kéri (ebből lesz a főszereplő teljes neve)',
);
ell(
  epitsdAJavaslatKerest('csillagképek', 'given').includes('sorrendje számít'),
  'csoportonkénti kérésnél is szól a sorrendről',
);

/* ================================================================== *
 *  ÖSSZEGZÉS
 * ================================================================== */

console.log('');
if (failures.length > 0) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
}
console.log(`Prioritás és nem szerinti egyeztetés: ${pass}/${pass + fail} ellenőrzés rendben`);
if (fail > 0) process.exit(1);
