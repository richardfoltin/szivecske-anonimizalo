/**
 * A CÍMKÉK ANGOL VÁLTOZATA ÉS A HIVATALOS SZEREPLŐK CSERÉJE — VALÓDI IRATON.
 *
 *   npx tsx test/cimke-nyelv-es-hivatalos.ts
 *
 * Két új képesség, és mindkettőnél UGYANAZ a hibamód fenyeget: a kapcsoló ott
 * áll a képernyőn, a motor viszont nem tud róla, tehát a felhasználó abban a
 * hitben adja ki az iratot, hogy beállított valamit. Ez a projektben már
 * megtörtént — kész motor hívó nélkül, kapcsoló olvasó nélkül —, ezért itt nem
 * a függvényeket kérdezzük meg külön, hanem a KÉSZ ELEMZÉSBŐL olvassuk vissza,
 * mi került volna az iratba.
 *
 *   1. CÍMKENYELV. A szerep-, adatfajta- és számozott mód címkéi angolul is
 *      kérhetők (`AnalyzeInput.labelLang`). Amit mérünk: a kimenetben tényleg
 *      az angol címke áll, a magyar mondat toldaléka pedig KÖTŐJELLEL
 *      kapcsolódik hozzá — az idegen szó magyar helyesírás szerinti ragozása.
 *
 *   2. HIVATALOS SZEREPLŐK. Az eljáró bíró és ügyvéd neve a Bszi. 166. § (2)
 *      szerint bent marad; a felismerés viszont ma már KÉSZ FÉLKÉNT is
 *      visszaadja őket (`DetectionResult.officials`), hogy a felhasználó —
 *      kimondott figyelmeztetés mellett — mégis lecseréltethesse. Amit mérünk:
 *      a lista nem üres, a nemet is tartalmazza, és a felekhez adva a bíró
 *      neve TÉNYLEG eltűnik a kimenetből.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import { detectByStructure } from '../src/app/detect.js';
import type { PartyInput } from '../src/app/types.js';
import { angolRagHianyok, type Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();

const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));
const kokorszak = JSON.parse(
  readFileSync(join(ROOT, 'data/themes/kokorszak.json'), 'utf8'),
) as Theme;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ell(ok: boolean, nev: string, reszlet = ''): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${nev}${reszlet ? ` — ${reszlet}` : ''}`);
  }
}

/*
  AZ IRAT SZÁNDÉKOSAN RÖVID, DE MINDEN RÉSZE SZÜKSÉGES.

  Van benne eljáró bíró aláírással („s. k. bíró”) és eljáró ügyvéd, mert a
  hivatalos szereplők felismerése ezekre a szerkezeti jelekre épül. Van benne
  ragozott felperesnév is: a címkenyelv mérése azon áll vagy bukik, hogy a
  toldalék hogyan kapcsolódik az angol címkéhez.
*/
const dir = mkdtempSync(join(tmpdir(), 'szivecske-cimke-'));
const iratUt = join(dir, 'itelet.txt');
const SZOVEG = [
  'Szentendrei Járásbíróság',
  '12.P.20.845/2026/8.',
  '',
  'Kovács János felperes keresetet nyújtott be Nagy Péter I. r. alperes ellen.',
  'A bíróság kötelezi Nagy Pétert, hogy fizessen Kovács Jánosnak.',
  'A felperes jogi képviselője dr. Sárközi Tamás ügyvéd.',
  '',
  'Szentendre, 2026. március 3.',
  '',
  'dr. Bach Tivadar s. k. bíró',
  '',
].join('\n');
writeFileSync(iratUt, SZOVEG, 'utf8');

const FELEK: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
];

const session = await DocumentSession.open(iratUt, homonyms);

/** A KÉSZ SZÖVEG, ahogy a mentés írná — nem a szereplap, hanem a kimenet. */
function kimenet(input: Parameters<DocumentSession['analyze']>[0]): string {
  session.analyze(input, kokorszak, homonyms);
  return session.anonymizedText();
}

/* ================================================================== *
 *  1. A CÍMKÉK NYELVE
 * ================================================================== */

console.log('');
console.log('A CÍMKÉK NYELVE');
console.log('');

/*
  A NÉVELŐ NEM RÉSZE A CSERESZÖVEGNEK.

  A kártyán „a felperes" áll, mert az irat mondatában így olvasható — a
  határozott névelőt viszont a program nem ÍRJA, hanem JAVÍTJA a csere után
  (`fixDefiniteArticle`): ahol az eredetiben volt névelő, ott marad, ahol nem,
  ott nem születik. Ezért a mérés a puszta címkére kérdez.
*/
/*
  TELJES MONDATRÉSZRE MÉRÜNK, nem puszta szóra.

  A „felperes” szó AZ EREDETI IRATBAN is szerepel („Kovács János felperes
  keresetet…”) — arra kérdezve a mérés akkor is találatot adna, ha a csere el
  sem indult volna. A részes esetű alak („fizessen felperesnek”) viszont csak a
  cseréből születhet: az eredetiben ott a valódi név állt.
*/
for (const [mode, magyar, angol] of [
  ['role', 'fizessen felperesnek', 'fizessen the plaintiff-nek'],
  ['type', 'fizessen [név]-nek', 'fizessen [name]-nek'],
  ['numbered', 'fizessen [NÉV-1]-nek', 'fizessen [NAME-1]-nek'],
] as const) {
  const hu = kimenet({
    parties: FELEK,
    themeId: kokorszak.id,
    mode,
    caseSecret: 'cimke-nyelv',
    acceptReview: true,
    labelLang: 'hu',
  });
  const en = kimenet({
    parties: FELEK,
    themeId: kokorszak.id,
    mode,
    caseSecret: 'cimke-nyelv',
    acceptReview: true,
    labelLang: 'en',
  });

  ell(hu.includes(magyar), `${mode}: magyarul a magyar címke kerül az iratba („${magyar}”)`);
  ell(en.includes(angol), `${mode}: angolul az angol címke kerül az iratba („${angol}”)`);
  /*
    A LEGFONTOSABB MÉRÉS: az angol változat NEM hagyja bent a magyar címkét.

    Ez az a hibamód, amit egy „működik” pillantás nem vesz észre: ha a
    `labelLang` valahol az úton elveszne, a kimenet változatlanul magyar
    címkékkel készülne el, a kártyán viszont az „angol” gomb állna bekapcsolva.
  */
  ell(!en.includes(magyar), `${mode}: angolul NEM marad bent a magyar címke`, en.slice(0, 160));
  ell(!hu.includes(angol), `${mode}: magyarul NEM szivárog be az angol címke`);

  // A VALÓDI NÉV egyik nyelven sem maradhat bent.
  ell(!hu.includes('Kovács') && !en.includes('Kovács'), `${mode}: a felperes neve mindkét nyelven eltűnt`);
}

/*
  AZ IDEGEN SZÓ RAGOZÁSA: KÖTŐJELLEL.

  A magyar helyesírás az idegen írásképű szavak toldalékát kötőjellel kapcsolja.
  Enélkül a kimenetben „the plaintiffnak” állna — az olvasó számára az nem
  címke, hanem elrontott szó. A mondat, amiben mérjük: „fizessen Kovács
  Jánosnak”.
*/
{
  const en = kimenet({
    parties: FELEK,
    themeId: kokorszak.id,
    mode: 'role',
    caseSecret: 'cimke-nyelv',
    acceptReview: true,
    labelLang: 'en',
  });
  const ragos = /the plaintiff-nek/.test(en);
  ell(ragos, 'szerep-mód angolul: a részes eset KÖTŐJELLEL kapcsolódik', en.slice(0, 200));

  const enType = kimenet({
    parties: FELEK,
    themeId: kokorszak.id,
    mode: 'type',
    caseSecret: 'cimke-nyelv',
    acceptReview: true,
    labelLang: 'en',
  });
  ell(/\[name\]-n[ae]k/.test(enType), 'adatfajta angolul: a címke ragja is kötőjeles', enType.slice(0, 200));
}

/*
  A TÁBLA TELJESSÉGE — ez a mérés lényege.

  Az angol címke magyar toldaléka a KIEJTÉST követi, nem az írásképet
  („plaintiff" = „plentif", tehát magas). A program ezt nem tudja kiszámolni,
  csak táblázatból tudhatja (`ANGOL_HANGREND`, src/pseudonym.ts). Ha új angol
  címke kerül a táblákba, és nincs hozzá ragozási adat, a kimenet CSENDBEN
  romlik el: a rag az írásképből születik, és senki nem veszi észre. Ezért ez
  a sor nem stílusellenőrzés, hanem kapu.
*/
{
  const hianyok = angolRagHianyok();
  ell(
    hianyok.length === 0,
    'minden angol címke utolsó szavának van kiejtés szerinti hangrendje',
    hianyok.join(', '),
  );
}

/* ================================================================== *
 *  2. A HIVATALOS SZEREPLŐK
 * ================================================================== */

console.log('');
console.log('A HIVATALOS SZEREPLŐK CSERÉJE');
console.log('');

const felismeres = detectByStructure(SZOVEG);

ell(felismeres.keepList.length > 0, 'a felismerés megtalálja a megtartandó neveket');
ell(
  felismeres.officials.length === felismeres.keepList.length,
  'minden megtartandó névhez tartozik kész fél is',
  `${felismeres.officials.length} fél / ${felismeres.keepList.length} név`,
);

const biro = felismeres.officials.find((o) => o.fullName.includes('Bach Tivadar'));
ell(biro !== undefined, 'az eljáró bíró kész félként is megvan');
ell(biro?.kind === 'person', 'az eljáró bíró SZEMÉLY, nem szervezet', String(biro?.kind));
/*
  A NEM AZÉRT SZÁMÍT, mert a kiosztó nem szerint egyeztet: enélkül a bírónő
  férfinevet kapna. A felület ezt nem tudná kitalálni — a felismerés viszont a
  keresztnévből meg tudja mondani —, ezért kell a listának hordoznia.
*/
ell(biro?.gender === 'M', 'az eljáró bíró neme is meg van állapítva', String(biro?.gender));
ell((biro?.occurrences ?? 0) > 0, 'az előfordulásszám is ki van töltve', String(biro?.occurrences));

const birosag = felismeres.officials.find((o) => o.fullName.includes('Járásbíróság'));
ell(birosag?.kind === 'org', 'a bíróság SZERVEZETKÉNT szerepel a listán', String(birosag?.kind));

/*
  ALAPÁLLÁS: a bíró neve BENT MARAD.

  Ez a törvény szerinti működés, és ha elromlana, a program a felhasználó
  tudta nélkül sértene jogszabályt — ezért mérjük külön, nem csak a
  bekapcsolt esetet.
*/
{
  const alap = kimenet({
    parties: FELEK,
    themeId: kokorszak.id,
    mode: 'theme',
    caseSecret: 'hivatalos',
    acceptReview: true,
    keepList: felismeres.keepList.map((k) => k.name),
  });
  ell(alap.includes('Bach Tivadar'), 'alapból az eljáró bíró neve bent marad az iratban');
  ell(alap.includes('Sárközi Tamás'), 'alapból az eljáró ügyvéd neve is bent marad');
}

/*
  BEKAPCSOLVA: a bíró neve ELTŰNIK.

  Pontosan úgy adjuk át, ahogy a felület teszi (`runAnalysis`, ui/src/App.tsx):
  a hivatalos szereplők a felek listájához fűződnek, a megtartandó lista pedig
  ÜRESRE vált. Ha csak az egyiket tennénk meg, a kimenet vagy változatlan
  maradna, vagy az ellenőrző kör hagyná jóvá a bent maradt nevet.
*/
{
  const hivatalosFelek: PartyInput[] = felismeres.officials.map((o) => ({
    id: o.id,
    kind: o.kind,
    fullName: o.fullName,
    gender: o.gender,
    role: o.role,
  }));
  const csere = kimenet({
    parties: [...FELEK, ...hivatalosFelek],
    themeId: kokorszak.id,
    mode: 'theme',
    caseSecret: 'hivatalos',
    acceptReview: true,
    keepList: [],
  });
  ell(!csere.includes('Bach Tivadar'), 'bekapcsolva az eljáró bíró neve eltűnik', csere.slice(0, 220));
  ell(!csere.includes('Sárközi Tamás'), 'bekapcsolva az eljáró ügyvéd neve is eltűnik');
  // A felek cseréje ettől nem romolhat el.
  ell(!csere.includes('Kovács') && !csere.includes('Nagy Péter'), 'a felek cseréje változatlanul működik');
}

rmSync(dir, { recursive: true, force: true });

console.log('');
if (failures.length > 0) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
console.log(`Címkenyelv és hivatalos szereplők: ${pass}/${pass + fail} ellenőrzés rendben`);
if (fail > 0) process.exit(1);
