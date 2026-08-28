/**
 * A NÉVKÉSZLET-GYÁRTÁS VALÓDI ÚTJA — a modelltől a kész javaslatokig.
 *
 * MIÉRT NEM ELÉG ITT AZ ÁLMODELL: ez a teszt pontosan azért született, mert a
 * program egyszer már „kész” volt úgy, hogy a gyártás soha nem futott le. A
 * párbeszéd megvolt, a kérésszöveg megvolt, a válaszelemző megvolt, a modell
 * letölthető volt — csak épp a futtatóban nem létezett a szöveggyártó kérés, és
 * ez EGYETLEN teszten sem bukott meg. Egy álmodell most is átengedné.
 *
 * Ezért ez a teszt a TÉNYLEGES úton megy végig: a lefordított munkafolyamatot
 * indítja el (`dist-electron/ai-worker.cjs`), a valódi, letöltött hálót tölti
 * be, a valódi kérésszöveget küldi el (`epitsdAJavaslatKerest`), és a valódi
 * elemzővel olvassa vissza (`olvasdAJavaslatot`). Ha a modell nincs a gépen,
 * a teszt KIHAGYJA magát — de a kihagyást kiírja, hogy a zöld sor ne állítson
 * többet, mint amennyi történt.
 *
 * A gyártás processzoron percekbe telik, ezért alapból csak a legkisebb
 * csoportot kérjük le (cégnév-előtagok). A többi csoport is kipróbálható:
 *
 *     SZIVECSKE_CSOPORT=given npm run test:gyartas
 *
 * Az utónév azért érdekes külön, mert egyedül ott kérünk mezős alakot (a nem
 * nélkül a javaslat kiesik) — a másik három sima szöveglistát ad vissza.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, homedir } from 'node:os';
import { ModelClient } from '../src/ai/client.js';
import { namegenModel } from '../src/app/models.js';
import {
  epitsdAJavaslatKerest,
  olvasdAJavaslatot,
  type JavaslatCsoport,
} from '../src/app/temagyar.js';

const MUNKAFOLYAMAT = join(process.cwd(), 'dist-electron/ai-worker.cjs');

/**
 * Hol keressük a hálót.
 *
 * Kettőn is: a tárban lévő fejlesztői mappában, és ott, ahová a telepített
 * program tölti (`app.getPath('userData')/modellek`). A teszt Electronon
 * kívül fut, tehát az utóbbit kézzel kell összeraknunk.
 */
function modellGyoker(repo: string): string | null {
  const jeloltek = [
    join(process.cwd(), '.modellek'),
    join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'szivecske-anonymizer/modellek'),
  ];
  for (const gy of jeloltek) {
    if (existsSync(join(gy, ...repo.split('/'), 'config.json'))) return gy;  // eslint-disable-line
  }
  return null;
}

let hibak = 0;
function all(felteves: boolean, mit: string): void {
  if (felteves) {
    console.log(`  ✓ ${mit}`);
  } else {
    console.log(`  ✗ ${mit}`);
    hibak++;
  }
}

const spec = namegenModel();
if (!spec) {
  console.log('KIHAGYVA: a nyilvántartásban nincs névkészlet-gyártó modell.');
  process.exit(0);
}

/*
  MÁSIK MODELL KIPRÓBÁLÁSA — összehasonlításhoz.

  A gyártó modell megválasztása mérés kérdése (sebesség és minőség), és a
  mérést ugyanezen az úton kell végezni, nem külön kis programmal. A
  nyilvántartásba csak az kerülhet, ami itt megmérve megállt.

      SZIVECSKE_MODELL=onnx-community/Qwen3-0.6B-ONNX
      SZIVECSKE_MODELLTAR=…/valamelyik/mappa
*/
const repo = process.env.SZIVECSKE_MODELL ?? spec.repo;
const gyoker = process.env.SZIVECSKE_MODELLTAR ?? modellGyoker(repo);
if (!gyoker) {
  console.log(`KIHAGYVA: a(z) „${repo}” nincs letöltve ezen a gépen.`);
  console.log('  A gyártás útja így nincs bizonyítva — a modellel együtt futtasd újra.');
  process.exit(0);
}
if (!existsSync(MUNKAFOLYAMAT)) {
  console.log('HIBA: nincs lefordítva a munkafolyamat. Futtasd: npm run build:aiworker');
  process.exit(1);
}

console.log('\n══ NÉVKÉSZLET-GYÁRTÁS, VALÓDI MODELLEL ══════════════════════');
console.log(`  modell: ${spec.name}`);
console.log(`  mappa:  ${gyoker}`);

let jelentesek = 0;
const kliens = new ModelClient({
  workerPath: MUNKAFOLYAMAT,
  // UGYANANNYI SZÁL, mint élesben (electron/main.ts): különben a teszt egy
  // olyan sebességet mérne, amit a felhasználó soha nem lát.
  szalak: Math.max(2, cpus().length - 2),
  onGenProgress: ({ kesz, keret }) => {
    jelentesek++;
    if (jelentesek % 25 === 0) console.log(`    … ${kesz}/${keret}`);
  },
  config: {
    modelId: spec.id,
    repo,
    cacheDir: gyoker,
    labelMap: spec.labelMap,
    engine: spec.engine,
    task: 'generate',
    dtype: 'q4',
  },
  timeoutMs: 900_000,
});

/**
 * MELYIK CSOPORTOT KÉRJÜK. Alapból a legkisebbet, hogy a teszt ne tartson
 * negyedóráig; a többi a környezeti változóval kérhető.
 */
const csoport = ((): JavaslatCsoport => {
  const k = (process.env.SZIVECSKE_CSOPORT ?? 'org').trim();
  const ismert: JavaslatCsoport[] = ['given', 'surname', 'org', 'place'];
  const talalt = ismert.find((x) => x === k);
  if (!talalt) {
    console.log(`  (ismeretlen csoport: „${k}” — marad az „org”)`);
    return 'org';
  }
  return talalt;
})();
console.log(`  csoport: ${csoport}`);

const t0 = Date.now();
try {
  const info = await kliens.load();
  console.log(`\n  betöltés: ${(info.loadMs / 1000).toFixed(1)} s`);

  const kerdes = epitsdAJavaslatKerest('görög mitológia', csoport);
  const t1 = Date.now();
  // Keret nélkül: pontosan úgy, ahogy a főfolyamat kéri. A teszt attól ér
  // valamit, hogy azt méri, amit a felhasználó kap.
  const gondolkodas = process.env.SZIVECSKE_GONDOLKODAS;
  const valasz = await kliens.generate(
    kerdes,
    gondolkodas === undefined ? {} : { thinkBudget: Number(gondolkodas) },
  );
  const mp = (Date.now() - t1) / 1000;
  console.log(`  gyártás:  ${mp.toFixed(1)} s`);

  const javaslatok = olvasdAJavaslatot(valasz, csoport);
  console.log(`  javaslat: ${javaslatok.length} darab`);
  if (javaslatok.length === 0) {
    // A BUKÁS MUTASSA MEG, MIT LÁTOTT. Egy „0 javaslat” sorból nem derül ki,
    // hogy a modell hallgatott, prózát írt, vagy elrontotta a JSON-t — pedig
    // a három egészen más teendő.
    console.log(`  a válasz ${valasz.length} karakter, a vége:`);
    console.log('  …' + valasz.slice(-400).split('\n').join('\n  '));
  }
  console.log(`    ${javaslatok.slice(0, 8).map((j) => j.form).join(', ')}`);

  console.log('');
  all(valasz.length > 0, 'a modell válaszolt');
  all(jelentesek > 0, 'a haladás kijutott a futtatóból (a hívó órája újraindul)');
  all(valasz.includes('</think>'), 'a gondolatmenet le van zárva (a keret működik)');
  all(javaslatok.length > 0, 'a válaszból lett értelmezhető javaslat');
  all(
    javaslatok.every((j) => j.csoport === csoport),
    'minden javaslat a kért csoportba került',
  );
  if (csoport === 'given') {
    // Az utónévnél a nem nem elhagyható: enélkül a `keszitsTemat` kidobja a
    // javaslatot ('nem_nelkul'). Ez az egyetlen csoport, ahol mezős alakot
    // kérünk — itt derül ki, hogy a modell meg is adja.
    all(
      javaslatok.filter((j) => j.gender === 'M' || j.gender === 'F').length > 0,
      'az utóneveknél a modell megadta a nemet is',
    );
  }
  all(
    javaslatok.every((j) => j.form.trim().length > 0),
    'egyetlen üres név sincs a javaslatok között',
  );
} finally {
  await kliens.dispose().catch(() => undefined);
}

/* ─────────────────────────── a leállítás ─────────────────────────── */

/*
  A MEGSZAKÍTÁS KÜLÖN BIZONYÍTÁST KÍVÁN.

  A gyártás negyedóra nagyságrend, tehát a meggondolás valódi eset. A
  párbeszéd bezárása magában nem elég: a modell a főfolyamatban fut. Ez a
  szakasz azt méri, amit a felhasználó a „Leállítom” gombbal indít el —
  ugyanaz a `cancel()`, amit a főfolyamat hív (`themes:cancelGenerate`).

  Ehhez nem kell megvárni a végét: elindítjuk, hagyjuk dolgozni pár
  másodpercet, és leállítjuk.
*/
console.log('\n══ A GYÁRTÁS LEÁLLÍTÁSA ═════════════════════════════════════');
const masodik = new ModelClient({
  workerPath: MUNKAFOLYAMAT,
  szalak: Math.max(2, cpus().length - 2),
  config: {
    modelId: spec.id,
    repo,
    cacheDir: gyoker,
    labelMap: spec.labelMap,
    engine: spec.engine,
    task: 'generate',
    dtype: 'q4',
  },
  timeoutMs: 900_000,
});

try {
  await masodik.load();
  const fut = masodik.generate(epitsdAJavaslatKerest('görög mitológia', 'place'));
  let hiba: Error | null = null;
  fut.catch((e: Error) => {
    hiba = e;
  });
  await new Promise((r) => setTimeout(r, 5000));

  const voltMit = masodik.cancel();
  await new Promise((r) => setTimeout(r, 500));

  all(voltMit, 'a leállítás talált futó munkát');
  all(!masodik.running, 'a modell-folyamat leállt (a memória visszakerül a géphez)');
  all((hiba as Error | null)?.name === 'AbortError', 'a hívó megszakításként kapja vissza, nem hibaként');
} finally {
  await masodik.dispose().catch(() => undefined);
}

console.log(`\n  összesen: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (hibak > 0) {
  console.log(`\n✗ ${hibak} hiba\n`);
  process.exit(1);
}
console.log('\n✓ a névkészlet-gyártás útja végig működik\n');
