/**
 * TÖBB IRAT EGY ÜGYBEN — a közös álnév-kiosztás bizonyítéka.
 *
 * A program egyszerre több iratot tart nyitva, és egyetlen elemzés fut rájuk.
 * Ennek EGY ígérete van, és minden más ebből következik: ugyanaz a valódi név
 * MINDEGYIK iratban ugyanazt a fedőnevet kapja. Enélkül a kimenetek nem
 * olvashatók együtt — az ügyvéd három álnevesített iratot kapna, amikből nem
 * derül ki, hogy ugyanarról a felperesről szólnak.
 *
 * A KOCKÁZAT VALÓS, és pont itt van. Az álnév-kiosztás a MEGJELENÉS SORRENDJÉT
 * nézi (`AssignOptions.appearanceOrder`): aki előbb kerül szóba, az kapja a
 * névsor élén álló, legjellemzőbb fedőnevet. Csakhogy minden irat más
 * sorrendben említi a feleket — a keresetlevélben a felperes áll elöl, az
 * ítéletben a bíróság. Iratonként külön számolva tehát ugyanaz a név
 * iratonként MÁS nevet kapna, és semmi nem szólna róla: a képernyőn mindkét
 * irat rendben nézne ki.
 *
 * Ezért méri ez a teszt azt, amit a főfolyamat csinál: egyetlen sorrendet
 * állapít meg az ügyre (az első iratból), és azt adja át mindegyik iratnak.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import type { AnalyzeInput, PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));
const theme = JSON.parse(
  readFileSync(join(ROOT, 'data/themes/kokorszak.json'), 'utf8'),
) as Theme;

let hibak = 0;
let ellenorzesek = 0;

function ok(allitas: boolean, mit: string): void {
  ellenorzesek++;
  if (allitas) return;
  hibak++;
  console.error(`  ✗ ${mit}`);
}

/*
  A KÉT IRAT SZÁNDÉKOSAN FORDÍTOTT SORRENDBEN EMLÍTI A FELEKET.

  Ez a teszt lelke: ha a sorrend mindkettőben azonos volna, a hiba akkor sem
  jönne elő, ha a kiosztás iratonként futna — a teszt zölden hazudna.
*/
const IRAT_A = [
  'Szentendrei Járásbíróság',
  '',
  'Alulírott Kovács János felperes keresetet terjesztek elő Nagy Péter alperes ellen.',
  'Kovács János a szerződést 2024-ben kötötte. Nagy Péter nem fizetett.',
].join('\n');

const IRAT_B = [
  'Szentendrei Járásbíróság',
  '',
  'Nagy Péter alperes ellenkérelme: Nagy Péter vitatja a követelést.',
  'Kovács János felperes állítása nem helytálló.',
].join('\n');

const FELEK: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'alperes' },
];

/** Az entitás azonosítója → a rá kiosztott csereszöveg. */
function kiosztas(res: { cast: { entityId: string; replacement: string }[] }): Map<string, string> {
  return new Map(res.cast.map((c) => [c.entityId, c.replacement]));
}

async function fut(): Promise<void> {
  const konyvtar = mkdtempSync(join(tmpdir(), 'szivecske-tobbirat-'));
  try {
    const utA = join(konyvtar, 'keresetlevel.txt');
    const utB = join(konyvtar, 'ellenkerelem.txt');
    writeFileSync(utA, IRAT_A, 'utf8');
    writeFileSync(utB, IRAT_B, 'utf8');

    const sessA = await DocumentSession.open(utA, homonyms);
    const sessB = await DocumentSession.open(utB, homonyms);

    const alap: AnalyzeInput = {
      parties: FELEK,
      themeId: theme.id,
      mode: 'theme',
      caseSecret: 'teszt-ugy-titok',
    };

    console.log('\n── A HIBA, AMIT MEGELŐZÜNK ────────────────────────────────');
    /*
      ELŐBB MEGMUTATJUK, HOGY A VESZÉLY VALÓS. Ha mindkét irat a saját
      sorrendjéből dolgozik, a kiosztás széttarthat. Ez az ág nem azt méri,
      hogy a program rosszul működik — azt méri, hogy a teszt VALÓDI kockázatot
      fog meg. Ha ez az állítás egyszer megbukik (a két irat magától is azonos
      kiosztást adna), a teszt alsó fele elveszti a bizonyító erejét, és a
      figyelmeztetés erre szól.
    */
    const kulonA = kiosztas(sessA.analyze(alap, theme, homonyms));
    const kulonB = kiosztas(sessB.analyze(alap, theme, homonyms));
    const szettart = FELEK.some((p) => kulonA.get(p.id) !== kulonB.get(p.id));
    if (!szettart) {
      console.warn(
        '  ! FIGYELEM: a két irat külön elemezve is azonos kiosztást adott.\n' +
          '    A teszt így nem bizonyít semmit — a mintaszövegeket úgy kell\n' +
          '    átírni, hogy a felek megjelenési sorrendje tényleg eltérjen.',
      );
    } else {
      console.log(
        `  Külön elemezve széttart, ahogy vártuk: ${kulonA.get('p1')} ↔ ${kulonB.get('p1')}`,
      );
    }

    console.log('\n── A KÖZÖS SORREND ────────────────────────────────────────');
    /*
      AMIT A FŐFOLYAMAT CSINÁL (`mindenIratotElemez`, electron/main.ts): az
      első iratot a saját sorrendjével elemzi, a sorrendet kiolvassa a
      találataiból, és a többi iratnak AZT adja át.
    */
    const resA = sessA.analyze(alap, theme, homonyms);
    const latott = new Set<string>();
    const kozosSorrend: string[] = [];
    for (const m of resA.matches) {
      if (!FELEK.some((p) => p.id === m.entityId) || latott.has(m.entityId)) continue;
      latott.add(m.entityId);
      kozosSorrend.push(m.entityId);
    }
    const resB = sessB.analyze({ ...alap, appearanceOrder: kozosSorrend }, theme, homonyms);

    const kA = kiosztas(resA);
    const kB = kiosztas(resB);
    for (const p of FELEK) {
      const a = kA.get(p.id);
      const b = kB.get(p.id);
      console.log(`  ${p.fullName.padEnd(14)} → ${a} | ${b}`);
      ok(
        a !== undefined && a === b,
        `„${p.fullName}" fedőneve eltér a két iratban: „${a}" ≠ „${b}"`,
      );
    }

    console.log('\n── A SORREND ÖNMAGÁBAN IS ÁTADHATÓ ────────────────────────');
    /*
      A megfordított sorrend MÁS kiosztást ad — ez bizonyítja, hogy a mező
      tényleg hat. Enélkül a fenti egyezés attól is jöhetne, hogy a program
      figyelmen kívül hagyja a paramétert, és mindig ugyanazt számolja.
    */
    const forditott = [...kozosSorrend].reverse();
    const resFordit = kiosztas(sessB.analyze({ ...alap, appearanceOrder: forditott }, theme, homonyms));
    const valtozott = FELEK.some((p) => resFordit.get(p.id) !== kB.get(p.id));
    ok(valtozott, 'a megadott sorrend nem hatott a kiosztásra — a mezőt valaki elnyeli');
    console.log(`  Fordított sorrenddel: ${resFordit.get('p1')} (előtte: ${kB.get('p1')})`);

    console.log('\n── MINDKÉT IRAT MEGKAPJA A MAGA TALÁLATAIT ────────────────');
    ok(resA.matches.length > 0, 'az első iratban nincs találat');
    ok(resB.matches.length > 0, 'a második iratban nincs találat');
    /*
      A TALÁLATOK POZÍCIÓJA IRATONKÉNT NULLÁRÓL INDUL. A felület ezért szűri a
      szakasz azonosító-tartományára, mielőtt a szövegre rajzolná őket — ha ez
      elromlik, a jelölés a másik irat szavaira kerül.
    */
    const bTul = resB.matches.filter(
      (m) => (m.previewEnd ?? 0) > resB.previewText.length,
    ).length;
    ok(bTul === 0, `${bTul} találat pozíciója túlmutat a saját iratának szövegén`);
    console.log(`  ${resA.matches.length} + ${resB.matches.length} találat, pozíciók rendben`);
  } finally {
    rmSync(konyvtar, { recursive: true, force: true });
  }
}

await fut();

console.log('');
if (hibak > 0) {
  console.error(`Több irat egy ügyben: ${hibak} hiba ${ellenorzesek} ellenőrzésből`);
  process.exit(1);
}
console.log(`Több irat egy ügyben: ${ellenorzesek}/${ellenorzesek} ellenőrzés rendben`);
