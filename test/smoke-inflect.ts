/**
 * Gyors józansági teszt a toldalékoló motorra, kézzel ellenőrzött alakokkal.
 * A nagy, generált arany-készlet külön fut (test/run-tests.ts).
 */

import { type CaseTag, type NameOverrides, inflectName, inflectOrganization } from '../src/hu/inflect.js';
import { detectHarmony } from '../src/hu/phonology.js';

interface Case {
  lemma: string;
  tag: CaseTag;
  expect: string;
  ov?: NameOverrides;
  note: string;
}

const CASES: Case[] = [
  // --- magánhangzó-harmónia ---
  { lemma: 'Kovács', tag: 'DAT', expect: 'Kovácsnak', note: 'mély harmónia' },
  { lemma: 'Németh', tag: 'DAT', expect: 'Némethnek', note: 'magas harmónia' },
  { lemma: 'Ödön', tag: 'ALL', expect: 'Ödönhöz', note: 'ajakkerekítéses, három alakú rag' },
  { lemma: 'Fréd', tag: 'ALL', expect: 'Frédhez', note: 'ajakréses' },
  { lemma: 'Kovács', tag: 'ALL', expect: 'Kovácshoz', note: 'mély, három alakú rag' },
  { lemma: 'Gránit', tag: 'DAT', expect: 'Gránitnak', note: 'semleges í a mély után — mély marad' },
  { lemma: 'Kis', tag: 'DAT', expect: 'Kisnek', note: 'csak semleges magánhangzó → magas' },
  { lemma: 'József', tag: 'DAT', expect: 'Józsefnek', note: 'az e nem semleges: magasra vált' },
  { lemma: 'Kőszikla', tag: 'DAT', expect: 'Kősziklának', note: 'vegyes hangrend, az utolsó dönt' },

  // --- -val/-vel hasonulás ---
  { lemma: 'Fréd', tag: 'INS', expect: 'Fréddel', note: 'egyszerű mássalhangzó kettőződik' },
  { lemma: 'Kovács', tag: 'INS', expect: 'Kováccsal', note: 'kétjegyű: cs → ccs' },
  { lemma: 'Nagy', tag: 'INS', expect: 'Naggyal', note: 'kétjegyű: gy → ggy' },
  { lemma: 'Kodály', tag: 'INS', expect: 'Kodállyal', note: 'kétjegyű: ly → lly' },
  { lemma: 'Balázs', tag: 'INS', expect: 'Balázzsal', note: 'kétjegyű: zs → zzs' },
  { lemma: 'Kiss', tag: 'INS', expect: 'Kiss-sel', note: 'eleve kettőzött → kötőjel (AkH. 95.)' },
  { lemma: 'Papp', tag: 'INS', expect: 'Papp-pal', note: 'eleve kettőzött → kötőjel' },
  { lemma: 'Anna', tag: 'INS', expect: 'Annával', note: 'magánhangzó után nincs hasonulás, de nyúlik' },
  { lemma: 'Szabó', tag: 'INS', expect: 'Szabóval', note: 'magánhangzó után a v megmarad' },
  {
    lemma: 'Balzac',
    tag: 'INS',
    expect: 'Balzackal',
    ov: { ins: 'Balzackal', harmony: 'back' },
    note: 'idegen név: a kiejtés dönt, adatból jön',
  },

  // --- szóvégi a/e nyúlása ---
  { lemma: 'Anna', tag: 'DAT', expect: 'Annának', note: 'a → á' },
  { lemma: 'Anna', tag: 'ACC', expect: 'Annát', note: 'a → á tárgyesetben is' },
  { lemma: 'Tünde', tag: 'DAT', expect: 'Tündének', note: 'e → é' },
  { lemma: 'Tünde', tag: 'ALL', expect: 'Tündéhez', note: 'az utolsó magánhangzó ajakréses' },
  { lemma: 'Anna', tag: 'FOR', expect: 'Annaként', note: 'a -ként nem nyújt' },

  // --- tárgyeset ---
  { lemma: 'Kovács', tag: 'ACC', expect: 'Kovácsot', note: 'cs után kötőhangzó' },
  { lemma: 'Farkas', tag: 'ACC', expect: 'Farkast', note: 's után kötőhangzó nélkül' },
  { lemma: 'Molnár', tag: 'ACC', expect: 'Molnárt', note: 'r után kötőhangzó nélkül' },
  { lemma: 'János', tag: 'ACC', expect: 'Jánost', note: 's után kötőhangzó nélkül' },
  { lemma: 'Ödön', tag: 'ACC', expect: 'Ödönt', note: 'n után kötőhangzó nélkül' },
  { lemma: 'Fréd', tag: 'ACC', expect: 'Frédet', note: 'd után magas kötőhangzó' },
  { lemma: 'Nagy', tag: 'ACC', expect: 'Nagyot', note: 'gy után mély kötőhangzó' },
  { lemma: 'Erzsébet', tag: 'ACC', expect: 'Erzsébetet', note: 't után kötőhangzó' },

  // --- egyéb ragok ---
  { lemma: 'Kovács', tag: 'SUP', expect: 'Kovácson', note: 'mássalhangzó után kötőhangzó + n' },
  { lemma: 'Anna', tag: 'SUP', expect: 'Annán', note: 'magánhangzó után puszta -n' },
  { lemma: 'Kovács', tag: 'FAM', expect: 'Kovácsék', note: 'családi -ék' },
  { lemma: 'Kovács', tag: 'POSS', expect: 'Kovácsé', note: 'birtokjel' },
  { lemma: 'Kovács', tag: 'PL', expect: 'Kovácsok', note: 'többes szám kötőhangzóval' },

  // --- többtagú nevek: a rag az utolsó elemre kerül ---
  { lemma: 'Kovács János', tag: 'DAT', expect: 'Kovács Jánosnak', note: 'csak az utolsó elem kap ragot' },
  { lemma: 'Kovács János', tag: 'INS', expect: 'Kovács Jánossal', note: 's + val → ssal' },
  { lemma: 'Kovács János', tag: 'WIFE', expect: 'Kovács Jánosné', note: 'asszonynév' },
  { lemma: 'Kovács Jánosné', tag: 'ACC', expect: 'Kovács Jánosnét', note: 'asszonynév tárgyesete' },
  { lemma: 'Kovács Jánosné', tag: 'INS', expect: 'Kovács Jánosnéval', note: 'asszonynév eszközhatározója' },
  { lemma: 'Kovácsné Szabó Anna', tag: 'DAT', expect: 'Kovácsné Szabó Annának', note: 'leánykori névvel' },
];

const ORG_CASES: Case[] = [
  { lemma: 'Aranykalász Kft.', tag: 'DAT', expect: 'Aranykalász Kft.-nek', note: 'rövidítés: kötőjel, kiejtés szerinti harmónia' },
  { lemma: 'Aranykalász Kft.', tag: 'INS', expect: 'Aranykalász Kft.-vel', note: 'rövidítés után nincs hasonulás' },
  { lemma: 'Kovakő Zrt.', tag: 'ACC', expect: 'Kovakő Zrt.-t', note: 'rövidítés tárgyesete' },
];

let pass = 0;
const failures: string[] = [];

for (const c of CASES) {
  const got = inflectName(c.lemma, c.tag, c.ov ?? {});
  if (got === c.expect) pass++;
  else failures.push(`  ${c.lemma} [${c.tag}] → "${got}"  ELVÁRT: "${c.expect}"   (${c.note})`);
}
for (const c of ORG_CASES) {
  const got = inflectOrganization(c.lemma, c.tag, c.ov ?? {});
  if (got === c.expect) pass++;
  else failures.push(`  ${c.lemma} [${c.tag}] → "${got}"  ELVÁRT: "${c.expect}"   (${c.note})`);
}

const total = CASES.length + ORG_CASES.length;
console.log(`\nToldalékoló motor — józansági teszt`);
console.log(`${pass}/${total} rendben\n`);

if (failures.length) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(f);
  console.log('');
}

console.log('Harmónia-felismerés mintái:');
for (const w of ['Kovács', 'Németh', 'Ödön', 'Kis', 'Gránit', 'Kőszikla', 'József', 'Tünde', 'Tücsök', 'Bors']) {
  console.log(`  ${w.padEnd(10)} → ${detectHarmony(w)}`);
}

process.exit(failures.length ? 1 : 0);
