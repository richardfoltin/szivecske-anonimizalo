/**
 * A toldalékoló motor mérése a generált, majd anyanyelvi szinten átnézett
 * arany-készleten (test/gold-morphology.json).
 *
 *   npm test
 *
 * A készlet szándékosan tartalmazza a nehéz eseteket: kétjegyű mássalhangzók
 * kettőzését (-val/-vel), eleve kettőzött mássalhangzóra végződő neveket,
 * kötőhangzós tárgyesetet, szóvégi a/e nyúlását, vegyes hangrendet és idegen
 * neveket, ahol a kiejtés dönt.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type CaseTag, type NameOverrides, inflectName, inflectWord } from '../src/hu/inflect.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface GoldPair {
  lemma: string;
  case_tag: string;
  surface: string;
  why: string;
}

interface Gold {
  rules: { id: string; name: string; statement: string; examples: string[] }[];
  cases: { tag: string; name_hu: string; variants: string[]; notes: string }[];
  test_pairs: GoldPair[];
  uncertain: string[];
}

/** Az arany-készlet címkéi és a motor címkéi közti leképezés. */
const TAG_MAP: Record<string, CaseTag[]> = {
  NOM: ['NOM'],
  ACC: ['ACC'],
  DAT: ['DAT'],
  INS: ['INS'],
  INE: ['INE'],
  ILL: ['ILL'],
  ELA: ['ELA'],
  SUP: ['SUP'],
  SUB: ['SUB'],
  DEL: ['DEL'],
  ADE: ['ADE'],
  ALL: ['ALL'],
  ABL: ['ABL'],
  TER: ['TER'],
  CAU: ['CAU'],
  FOR: ['FOR'],
  ESS_FOR: ['FOR'],
  TRANS: ['TRANS'],
  POSS: ['POSS'],
  PL: ['PL'],
  FAM: ['FAM'],
  WIFE: ['WIFE'],
  // Összetett címkék: előbb a képző, aztán a rag. "Kovácsék" + -nak.
  FAM_DAT: ['FAM', 'DAT'],
  FAM_INS: ['FAM', 'INS'],
  FAM_ADE: ['FAM', 'ADE'],
  FAM_ALL: ['FAM', 'ALL'],
  FAM_ACC: ['FAM', 'ACC'],
  WIFE_DAT: ['WIFE', 'DAT'],
  WIFE_ACC: ['WIFE', 'ACC'],
  WIFE_INS: ['WIFE', 'INS'],
};

/**
 * Kiejtésfüggő névkivételek. A motor ezeket ADATKÉNT kapja — pontosan úgy,
 * ahogy a szállított témacsomagok és a felhasználó saját névlistája is
 * hordozza őket. Nincs olyan szabály, ami ezeket kitalálná.
 */
const OVERRIDES = (
  JSON.parse(readFileSync(join(HERE, '..', 'data', 'name-overrides.json'), 'utf8')) as {
    names: Record<string, NameOverrides & { note?: string }>;
  }
).names;

function applyChain(lemma: string, tags: CaseTag[]): string {
  const ov = OVERRIDES[lemma] ?? {};
  let cur = lemma;
  for (const [i, t] of tags.entries()) {
    // A kivétel csak az ELSŐ lépésre vonatkozik: "Kovácsék" után már a
    // képzett tő ragozódik szabályosan.
    const o = i === 0 ? ov : {};
    cur = lemma.includes(' ') ? inflectName(cur, t, o) : inflectWord(cur, t, o);
  }
  return cur;
}

function main(): void {
  const gold = JSON.parse(readFileSync(join(HERE, 'gold-morphology.json'), 'utf8')) as Gold;

  let pass = 0;
  let unsupported = 0;
  const failures: { pair: GoldPair; got: string }[] = [];

  for (const pair of gold.test_pairs) {
    const tags = TAG_MAP[pair.case_tag];
    if (!tags) {
      unsupported++;
      continue;
    }
    const got = applyChain(pair.lemma, tags);
    if (got === pair.surface) pass++;
    else failures.push({ pair, got });
  }

  const tested = gold.test_pairs.length - unsupported;
  console.log(`\nMorfológiai arany-készlet: ${pass}/${tested} (${((pass / tested) * 100).toFixed(1)}%)`);
  if (unsupported > 0) console.log(`Nem támogatott címke: ${unsupported}`);

  if (failures.length > 0) {
    // Hibatípusonként csoportosítva, hogy a mintázat látszódjon.
    const byTag = new Map<string, { pair: GoldPair; got: string }[]>();
    for (const f of failures) {
      const list = byTag.get(f.pair.case_tag) ?? [];
      list.push(f);
      byTag.set(f.pair.case_tag, list);
    }
    console.log(`\nELTÉRÉSEK (${failures.length}):`);
    for (const [tag, list] of [...byTag.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  [${tag}] — ${list.length} db`);
      for (const f of list) {
        console.log(`    ${f.pair.lemma.padEnd(18)} → "${f.got}"   arany: "${f.pair.surface}"`);
        console.log(`      ${f.pair.why}`);
      }
    }
  }

  if (gold.uncertain.length > 0) {
    console.log(`\nAz arany-készlet ${gold.uncertain.length} pontot maga is bizonytalannak jelölt;`);
    console.log('ezek nem szerepelnek a mérésben (lásd test/gold-morphology.json → uncertain).');
  }

  console.log('');
  process.exit(failures.length === 0 ? 0 : 1);
}

main();
