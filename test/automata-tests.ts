/**
 * AUTOMATIKUS MÓD („Csak csináld"): mit ér a program, ha SENKI NEM KATTINT?
 *
 *   npx tsx test/automata-tests.ts
 *
 * A felhasználó kérése az volt, hogy a modell találja meg a neveket, a program
 * pedig cserélje ki őket — kézi begépelés és végigkattintás nélkül. A
 * felismerés régóta automatikus; ami maradt, az a bizonytalan találatok
 * végigdöntése. Ez a teszt azt méri, mi történik, ha ezt a lépést is a program
 * vállalja magára (`AnalyzeInput.acceptReview`).
 *
 * A MÉRÉS ELŐZMÉNYE (`test/nulla-kattintas.ts`, valódi modellel):
 *   bennmaradt név, ha csak az automatikus találatok cserélnek:  35
 *   bennmaradt név, ha az átnézésre várókat is elfogadjuk:         1
 *   ára: 4 fölösleges csere köznéven (Nagy, Szabó, Fehér)
 *
 * A tanulság ellentmond a józan észnek: nem az emberi döntés teszi pontossá a
 * programot, az ÓVATOSKODÁS okozza a szivárgás nagy részét. A két hibafajta
 * ugyanis nem egyenrangú — a kimaradt név szivárgás és láthatatlan, a
 * fölösleges csere viszont ott áll az olvasó szeme előtt („Kőszikla a
 * kockázat"), és nem árul el senkit.
 *
 * Amit a teszt EZEN FELÜL is őriz, mert a mód ára nem lehet a biztonság:
 *   - az „elutasítva" fokozat elutasítva marad (azok bizonyítottan nem nevek),
 *   - a Bszi. 166. § (2) szerint megtartandó nevek (eljáró bíró, ügyvéd, a
 *     bíróság) automatikus módban SEM cserélődnek,
 *   - a szivárgás-kapu változatlanul zár: ha a kész fájlban eredeti adat marad,
 *     nem keletkezik fájl.
 *
 * A MODELL nélkül is lefut: a szerkezeti felismerés ezeken a mintairatokon
 * magától is megtalálja mind a nyolc-tíz felet, a modell a bizonytalan
 * találatok számán változtat. Amelyik gépen a modell nincs telepítve, ott a
 * teszt ezt kiírja, és a szerkezeti résszel mér.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import { detectParties } from '../src/app/detect.js';
import type { AutoDecisionRow, PartyInput } from '../src/app/types.js';
import type { ExtractedEntity } from '../src/ai/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const SAMPLES = ['itelet', 'keresetlevel', 'kolcsonszerzodes'];
const OUT_DIR = join(ROOT, 'spike/out');

const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/kokorszak.json'), 'utf8')) as Theme;
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

/** Névelőtag és kis-nagybetű nélküli összevetés — az aranykészlethez. */
const norm = (s: string): string =>
  s.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').toLowerCase().trim();

interface Minta {
  filename: string;
  text: string;
  parties: { canonical: string }[];
  mentions?: { surface: string; canonical: string }[];
}

// ── A nyelvi modell, ha van ────────────────────────────────────────────────
//
// A modell BETÖLTÉSE a lassú lépés, ezért egyszer töltjük be, és mind a három
// iratra ugyanazt a példányt használjuk.
let ner: { extract(text: string): Promise<ExtractedEntity[]>; dispose(): Promise<void> } | null = null;
try {
  const { HubertNer } = await import('../src/ai/hubertNer.js');
  const n = new HubertNer({
    modelId: 'nytk',
    repo: 'foltin/nerkor-hubert-hungarian-onnx',
    cacheDir: join(ROOT, '.modellek'),
    labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
  });
  await n.load();
  ner = n;
} catch (e) {
  console.log(`A modell nem futott: ${(e as Error).message}`);
}
console.log(
  ner
    ? '\nA nyelvi modell FUT — a mérés a valódi felismeréssel készül.'
    : '\nA modell nincs telepítve — a mérés a szerkezeti felismeréssel készül.',
);

interface Sor {
  irat: string;
  felek: number;
  kimaradtFel: string[];
  atnezes: number;
  programDontotte: number;
  koznev: number;
  eldontetlen: number;
  bennmaradt: number;
  keletkezett: boolean;
}

const sorok: Sor[] = [];
mkdirSync(OUT_DIR, { recursive: true });

for (const id of SAMPLES) {
  const s = JSON.parse(readFileSync(join(ROOT, `samples/${id}.json`), 'utf8')) as Minta;

  // ── NULLA emberi döntés: a felismerés eredményét változtatás nélkül vesszük.
  const modelEntities = ner ? await ner.extract(s.text) : undefined;
  const det = detectParties(s.text, {
    homonyms,
    ...(modelEntities === undefined ? {} : { modelEntities }),
  });
  const felek: PartyInput[] = [...det.parties, ...det.identifiers].map((p) => ({
    id: p.id,
    kind: p.kind,
    fullName: p.fullName,
    gender: p.gender,
    role: p.role,
    identifierKind: p.identifierKind,
  }));

  const doc = await DocumentSession.fromBytes(
    `${id}.txt`,
    new TextEncoder().encode(s.text),
    homonyms,
  );

  // EZ a „Csak csináld" mód motoroldali alakja: `acceptReview`, és SEMMILYEN
  // `decisions` mező — pontosan az a bemenet, amit a felület akkor küld, ha a
  // felhasználó egyetlen gombot sem nyomott meg.
  const a = doc.analyze(
    {
      parties: felek,
      themeId: theme.id,
      mode: 'theme',
      caseSecret: id,
      acceptReview: true,
      keepList: det.keepList.map((k) => k.name),
      model: det.model,
    },
    theme,
    homonyms,
  );

  const out = join(OUT_DIR, `automata-${id}.txt`);
  const cert = out.replace(/\.txt$/, '-jegyzokonyv.txt');
  rmSync(out, { force: true });
  rmSync(cert, { force: true });
  const r = await doc.export({ mode: 'theme', keepKey: false, outputPath: out });

  // ── 1. KIMARADT FÉL: aranykészletbeli fél, akit a felismerés nem talált meg.
  //     Ez SZIVÁRGÁS, és láthatatlan: aki kimaradt a listáról, annak a nevét
  //     senki nem keresi a szövegben.
  const nevek = felek.map((f) => norm(f.fullName));
  const alias = (kanon: string): string[] =>
    (s.mentions ?? []).filter((m) => norm(m.canonical) === norm(kanon)).map((m) => norm(m.surface));
  const kimaradtFel = s.parties
    .filter((g) => {
      const jeloltek = [norm(g.canonical), ...alias(g.canonical)];
      return !nevek.some((n) => jeloltek.some((j) => n === j || n.startsWith(j) || j.startsWith(n)));
    })
    .map((g) => g.canonical);

  check(`${id}: minden aranykészletbeli fél felkerült a listára`, kimaradtFel.length === 0,
    kimaradtFel.join(' | '));

  // ── 2. NULLA KÉRDÉS: automatikus módban nem marad eldöntendő találat.
  check(`${id}: nem marad eldöntendő találat`, r.report.pending === 0,
    `${r.report.pending} eldöntetlen`);

  // ── 3. BENNMARADT NÉV a kész fájlban, és keletkezett-e egyáltalán fájl.
  //
  //     A kettőt EGYÜTT kell nézni, mert külön-külön mindkettő olcsón
  //     teljesíthető: „nulla szivárgás" úgy is kijön, ha a mentés soha nem
  //     sikerül, „mindig van fájl" pedig úgy, ha kikapcsoljuk az ellenőrzést.
  //     Ez a feltétel egyszerre zárja ki a kettőt, és a modelltől függetlenül
  //     igaznak kell lennie.
  check(
    `${id}: vagy tiszta fájl készül, vagy semmilyen`,
    (r.written && r.report.leaks.length === 0 && existsSync(out)) ||
      (!r.written && !existsSync(out)),
    `written=${r.written}, ${r.report.leaks.length} bennmaradt név`,
  );

  //     A NULLA BENNMARADT NÉV viszont a MODELLTŐL függ, ezért csak akkor
  //     mérjük, ha a modell futott — ez a mérés alapja. Modell nélkül a
  //     szerkezeti felismerés az ítéletben és a keresetlevélben ma bennhagyja a
  //     „Jánosné" alakot: a kapu ilyenkor helyesen NEM ad fájlt, de ez nem
  //     ugyanaz a mérés, és nem is szabad zöldnek mutatni.
  if (ner) {
    check(`${id}: a visszaolvasott fájlban nem maradt eredeti név`, r.report.leaks.length === 0,
      r.report.leaks.map((l) => l.surface).join(' | '));
    check(`${id}: elkészült a kimeneti fájl`, r.written && existsSync(out));
  }

  // ── 4. AZ ELUTASÍTOTT MARAD ELUTASÍTVA. Ezek bizonyítottan nem nevek
  //     („Fehér színű tehergépjármű"), a lecserélésük tiszta kár. A döntést
  //     viszont a program KIMONDJA: enélkül az ellenőrző kör hallgatásnak
  //     venné, és automatikus módban nem keletkezne fájl.
  const elutasitott = a.matches.filter((m) => m.disposition === 'reject');
  const kimondott = elutasitott.every((m) => m.decision === 'skip' && m.autoDecided === true);
  check(`${id}: az elutasított találat elutasítva marad, kimondva`, kimondott);
  // A KÉSZ FÁJLBÓL olvasunk vissza, nem a szándékszövegből: az utóbbi azt
  // tartalmazza, amit MI állítottunk elő, tehát önmagát igazolná vissza. Ha a
  // kapu nem adott fájlt, ezek a mérések ebben a futásban nem értelmesek.
  const szoveg = r.written ? readFileSync(out, 'utf8') : null;
  if (szoveg !== null) {
    for (const m of elutasitott) {
      check(`${id}: az elutasított "${m.surface}" nem cserélődött le`, szoveg.includes(m.surface));
      // …és nem is tűnik el szó nélkül: a bent hagyott alak a MARADVÁNYLISTÁN
      // marad látható. A kimondott döntés arra jó, hogy ne blokkolja a mentést,
      // nem arra, hogy elhallgassa a tételt.
      check(
        `${id}: a bent hagyott "${m.surface}" látszik a maradványlistán`,
        r.report.residual.some((x) => x.surface === m.surface),
      );
    }

    // ── 5. A TÖRVÉNY SZERINT MEGTARTANDÓ NEVEK: az eljáró bíró, ügyvéd, védő
    //     és a bíróság neve a Bszi. 166. § (2) szerint nem anonimizálható. Ezen
    //     az automatikus módnak nincs hatalma.
    for (const k of det.keepList) {
      check(`${id}: megtartandó név a kimenetben is megvan — ${k.name}`, szoveg.includes(k.name));
    }
  }

  // ── 6. A PROGRAM MEGMONDJA, MIT DÖNTÖTT HELYETTED.
  const auto: AutoDecisionRow[] = a.autoAccepted ?? [];
  /*
    A MÉRCE A DÖNTETLENSÉG, NEM A DARABSZÁM.

    Régen ez a sor az `a.counts.review` értékével hasonlított, mert a kettő
    egybeesett: minden átnézésre váró találatról az automatikus mód döntött.
    Azóta az összegeket és a dátumokat a program akkor is MEGKERESI, ha nem
    cseréli — a kikapcsolt kapcsoló pedig maga a döntés, nem programdöntés.
    Ezek a találatok tehát benne vannak a `counts.review` fokozatban, de
    jogosan hiányoznak a „döntöttünk helyetted" listáról.

    Amit mérni akarunk, az változatlan: az automatikus mód után NE MARADJON
    egyetlen találat sem, amiről senki nem döntött. Ez erősebb állítás a régi
    darabszám-egyezésnél, mert a hiányt is elkapja, és a néma bent hagyást is.
  */
  const eldontetlen = a.matches.filter((m) => m.decision === undefined && m.disposition !== 'auto');
  check(`${id}: automatikus mód után nem marad eldöntetlen találat`, eldontetlen.length === 0,
    `${eldontetlen.length} maradt: ${eldontetlen.slice(0, 3).map((m) => m.surface).join(', ')}`);
  const programe = a.matches.filter((m) => m.autoDecided === true && m.decision === 'accept');
  check(`${id}: amit a program elfogadott, az mind a listán van`, auto.length === programe.length,
    `${auto.length} tétel, ${programe.length} programdöntés`);
  check(`${id}: az elemzés és a mentés ugyanazt a listát adja`,
    (r.autoAccepted ?? []).length === auto.length);
  check(`${id}: minden tétel hordozza a környezetét és az indoklását`,
    auto.every((x) => x.context.length > 0 && x.reason.length > 0));
  if (r.written && auto.length > 0) {
    const jkv = readFileSync(r.certificatePath!, 'utf8');
    check(`${id}: a jegyzőkönyv is tartalmazza, miről döntött a program`,
      jkv.includes('AMIRŐL A PROGRAM DÖNTÖTT EMBER HELYETT') &&
        auto.every((x) => jkv.includes(x.surface)));
  }

  sorok.push({
    irat: s.filename,
    felek: felek.length,
    kimaradtFel,
    atnezes: a.counts.review,
    programDontotte: auto.length,
    koznev: auto.filter((x) => x.commonWord).length,
    eldontetlen: r.report.pending,
    bennmaradt: r.report.leaks.length,
    keletkezett: r.written,
  });

  rmSync(out, { force: true });
  rmSync(cert, { force: true });
}

// ── 7. A SZIVÁRGÁS-KAPU AUTOMATIKUS MÓDBAN IS ZÁR ──────────────────────────
//
// A mód a KÉRDEZÉST hagyja el, nem a biztonságot: ha az ellenőrző kör eredeti
// adatot talál a KÉSZ fájlban, nem keletkezik fájl — akkor sem, ha a
// felhasználó épp azt kérte, hogy a program ne kérdezzen semmit.
//
// A próba olyan hibát állít elő, amit az automatikus mód nem tud megjavítani:
// a felhasználó saját kezűleg adott álnevet, amiben BENNE MARADT az eredeti
// vezetéknév. Ez valódi út, nem laborhelyzet — a „Kovács János" helyett írt
// „Kovács Bertalan" első ránézésre álnévnek látszik, közben az irat továbbra is
// a Kovács családról szól.
{
  const doc = await DocumentSession.fromBytes(
    'kapu.txt',
    new TextEncoder().encode(
      'Kovács János felperes keresetet nyújtott be. A bíróság Kovács Jánosnak adott igazat.',
    ),
    homonyms,
  );
  const felek: PartyInput[] = [
    {
      id: 'p1',
      kind: 'person',
      fullName: 'Kovács János',
      gender: 'M',
      role: 'felperes',
      manualReplacement: 'Kovács Bertalan',
    },
  ];
  doc.analyze(
    { parties: felek, themeId: theme.id, mode: 'theme', caseSecret: 'kapu', acceptReview: true },
    theme,
    homonyms,
  );
  const out = join(OUT_DIR, 'automata-kapu.txt');
  rmSync(out, { force: true });
  let dobott = false;
  let ok = true;
  let leaks = 0;
  try {
    const r = await doc.export({ mode: 'theme', keepKey: false, outputPath: out });
    ok = r.report.ok;
    leaks = r.report.leaks.length;
  } catch {
    dobott = true;
  }
  console.log(
    `\nSzivárgás-kapu automatikus módban: ${dobott ? 'kivétellel megtagadva' : `${leaks} bennmaradt név`}`,
  );
  check('automatikus módban is szivárgás a kimenetben maradt eredeti név', dobott || !ok);
  check('automatikus módban sem keletkezik fájl szivárgásnál', !existsSync(out));
  // A jegyzőkönyvet is takarítjuk: szivárgásnál nem keletkezik, de ha valaha
  // mégis, azt a következő futás ne örökölje meg csendben.
  rmSync(out, { force: true });
  rmSync(out.replace(/\.txt$/, '-jegyzokonyv.txt'), { force: true });
}

if (ner) await ner.dispose();

// ── Mérés ──────────────────────────────────────────────────────────────────

console.log('\n══ AUTOMATIKUS MÓD — EGYETLEN KATTINTÁS NÉLKÜL ═══════════════');
console.log('irat                  felek  átnéz  progr  köznév  eldönt  bennm  fájl');
for (const r of sorok) {
  console.log(
    `${r.irat.padEnd(22)}${String(r.felek).padStart(4)}${String(r.atnezes).padStart(7)}` +
      `${String(r.programDontotte).padStart(7)}${String(r.koznev).padStart(8)}` +
      `${String(r.eldontetlen).padStart(8)}${String(r.bennmaradt).padStart(7)}` +
      `${(r.keletkezett ? 'kész' : 'NINCS').padStart(7)}`,
  );
}

const kimaradt = sorok.reduce((a, r) => a + r.kimaradtFel.length, 0);
const bennmaradt = sorok.reduce((a, r) => a + r.bennmaradt, 0);
const koznev = sorok.reduce((a, r) => a + r.koznev, 0);

console.log('\n  kimaradt fél (szivárgás, láthatatlan):        ' + kimaradt);
console.log('  bennmaradt név a kész fájlokban:              ' + bennmaradt);
console.log('  fölösleges csere köznéven (látható, de nem szivárgás): ' + koznev);

/*
  A FÖLÖSLEGES CSERE a mód ára, nem a hibája: ettől lesz „Nagy a kockázat"-ból
  „Kőszikla a kockázat". Csúnya, de látható, és senkit nem árul el — ezért nem
  nullát várunk el, hanem FELSŐ KORLÁTOT. Mérve a három iraton: modellel 9,
  modell nélkül 16 ilyen tétel. A korlát azt fogja meg, ha a program egyszer
  csak minden köznévnek látszó alakot cserélni kezdene — az ugyanis már nem ár,
  hanem olvashatatlan irat.
*/
check('a fölösleges cserék száma nem szaladt el', koznev <= 20, `${koznev} tétel`);

console.log('');
if (failures.length > 0) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
console.log(`Automatikus mód: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
