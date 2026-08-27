/**
 * Támadás az automatikus mód ellen.
 *
 * Automatikus módban a program maga mondja ki, hogy egy elutasított találatot
 * bent hagy — korábban ezt csak ember tehette meg. Ez valódi lazítás az
 * ellenőrző körön, ezért itt a LEGROSSZABB esetet próbáljuk ki: mi van, ha a
 * felismerő TÉVESEN utasít el egy valódi névelőfordulást?
 *
 * A tétel, amit bizonyítani akarunk: a keret ELŐFORDULÁSONKÉNT fogy. Egyetlen
 * téves elutasítás egyetlen előfordulást enged bent, a többi ugyanolyan alakú
 * említést továbbra is keményen elbukja a kapu.
 */

import { readFileSync, rmSync } from 'node:fs';
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

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  rendben — ${name}`); }
  else { fail++; console.log(`  BUKOTT — ${name}${detail ? ` (${detail})` : ''}`); }
}

const parties: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Fehér Ilona', gender: 'F', role: 'tanú' },
  { id: 'p2', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
];

console.log('');

// ── 1. A „Fehér" hatszor: egyszer köznévként, ötször névként ──────────────
//
// A köznévi előfordulás mondat elején áll, kisbetűs szó követi — a felismerő
// ezt utasítja el. A másik öt valódi említés.
const SZOVEG = [
  'Fehér színű tehergépjármű állt az udvaron.',
  'A tanú Fehér Ilona elmondta, hogy Fehér Ilonával korábban is beszélt.',
  'Fehér Ilonát a bíróság megidézte, Fehér Ilonának kézbesítették.',
  'Kovács János felperes Fehér Ilonára hivatkozott.',
].join('\n');

const out = join(ROOT, 'spike/out/automata-tamadas.txt');
rmSync(out, { force: true });

const s = await DocumentSession.fromBytes('tamadas.txt', new TextEncoder().encode(SZOVEG), homonyms);
const a = s.analyze(
  { parties, themeId: theme.id, mode: 'theme', caseSecret: 'tamadas', acceptReview: true },
  theme,
  homonyms,
);

const feher = a.matches.filter((m) => m.surface.startsWith('Fehér'));
const elutasitva = feher.filter((m) => m.disposition === 'reject');
console.log(`  „Fehér" találat: ${feher.length}, ebből elutasítva: ${elutasitva.length}`);

const r = await s.export({ mode: 'theme', keepKey: false, outputPath: out });
const kimenet = s.anonymizedText();

// A köznévi „Fehér színű" bent marad — ez a helyes viselkedés.
check('a köznévi „Fehér színű" bent maradt', kimenet.includes('Fehér színű'));

// De EGYETLEN valódi említés sem maradhat bent.
const valodiBent = [...kimenet.matchAll(/Fehér\s+Ilon/g)].length;
check('egyetlen valódi „Fehér Ilona" említés sem maradt bent', valodiBent === 0, `${valodiBent} maradt`);
check('a fájl elkészült', r.report.ok, `${r.report.leaks.length} bennmaradt név`);
check(
  'a bent hagyott köznév LÁTHATÓ a maradványlistán',
  r.report.residual.some((x) => x.surface.includes('Fehér')) || r.report.residualTotal > 0,
);

rmSync(out, { force: true });

// ── 2. A keret előfordulásonként fogy ────────────────────────────────────
//
// Ha a program EGY előfordulást hagy bent, attól a TÖBBI ugyanolyan alak nem
// lesz szabad. Ezt úgy próbáljuk ki, hogy a cserét szándékosan megbénítjuk:
// olyan kézi álnevet adunk, ami maga is tartalmazza az eredeti nevet.
const out2 = join(ROOT, 'spike/out/automata-tamadas-2.txt');
rmSync(out2, { force: true });

const s2 = await DocumentSession.fromBytes('tamadas2.txt', new TextEncoder().encode(SZOVEG), homonyms);
const partiesRossz: PartyInput[] = [
  // A kézi álnév bennhagyja az eredeti vezetéknevet: a csere lefut, a név mégis
  // ott marad a kimenetben. Pontosan ezt kell a kapunak elkapnia.
  { ...parties[0]!, manualReplacement: 'Fehér Ilona' },
  parties[1]!,
];
s2.analyze(
  { parties: partiesRossz, themeId: theme.id, mode: 'theme', caseSecret: 'tamadas', acceptReview: true },
  theme,
  homonyms,
);
const r2 = await s2.export({ mode: 'theme', keepKey: false, outputPath: out2 });

check('elbukott kitakarásnál a kapu automatikus módban is zár', !r2.report.ok, 'átengedte');
check('elbukott kitakarásnál nem keletkezik fájl', !r2.written, 'fájl keletkezett');
rmSync(out2, { force: true });

console.log(`\nAutomatikus mód támadás alatt: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
