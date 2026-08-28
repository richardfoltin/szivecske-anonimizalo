/**
 * BEKEZDÉSEK ÉS ÚJRATÖRDELÉS — a kimenet tipográfiája.
 *
 *   npx tsx test/bekezdes-tests.ts
 *
 * Két része van, és a második a fontosabb.
 *
 * A GYÁRTOTT MINTA azért kell, mert a szabályokat pontosan kimért sorokon
 * lehet számonkérni: itt TUDJUK, hol van a bekezdéshatár, mekkora a sorköz, és
 * mi a helyes eredmény. A mérés mértékegysége szándékosan olyan, hogy fejben
 * is követhető legyen: egy karakter 10 pont széles.
 *
 * A VALÓDI IRAT a másik fele. Egy szabály, ami csak a gyártott mintán áll meg,
 * semmit nem mond a bíróságra menő iratról — a keresetlevélen az derül ki,
 * hogy a bekezdéshatárokat tényleg ott találjuk-e meg, ahol egy ember is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bekezdesekre, ujratordel } from '../src/pdf/bekezdes.js';
import type { TextSegment } from '../src/pdf/textRuns.js';
import { DocumentSession } from '../src/app/session.js';
import type { PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Egy karakter 10 pont — így a szélességek fejben is ellenőrizhetők. */
const mer = (t: string): number => t.length * 10;

function sor(text: string, x: number, y: number, width: number, fontSize = 12): TextSegment {
  return { text, x, y, fontSize, fontKey: 'F1', streamId: 'root', opRanges: [], width, runs: [] };
}

console.log('\nBEKEZDÉSHATÁROK\n');

{
  // Két bekezdés: 17 pontos sorközzel, közöttük 27 pontos ugrással.
  const segs = [
    sor('elso sor', 63, 700, 400),
    sor('masodik sor', 63, 683, 400),
    sor('harmadik rovid', 63, 666, 150),
    sor('uj bekezdes', 63, 639, 400),
    sor('folytatas', 63, 622, 120),
  ];
  const b = bekezdesekre(segs);
  check('a nagyobb sorköz bekezdést zár', b.length === 2, `${b.length} bekezdés`);
  check('az első bekezdés három soros', b[0]?.sorok.length === 3);
  check('a második bekezdés két soros', b[1]?.sorok.length === 2);
}

{
  // Középre zárt cím: MÁS a bal margó, tehát nem folytatás.
  const segs = [
    sor('torzsszoveg', 63, 700, 400),
    sor('KOZEPRE ZART CIM', 240, 683, 120),
    sor('torzsszoveg megint', 63, 666, 400),
  ];
  check('a más bal margó elválaszt', bekezdesekre(segs).length === 3);
}

{
  // Más betűméret: cím vagy lábjegyzet, nem ugyanaz a bekezdés.
  const segs = [sor('torzs', 63, 700, 400), sor('labjegyzet', 63, 683, 400, 8)];
  check('a más betűméret elválaszt', bekezdesekre(segs).length === 2);
}

{
  // Form XObjectből érkező sor (fejléc): sosem a lap törzsszövege.
  const a = sor('lap torzse', 63, 700, 400);
  const b = { ...sor('fejlecbol', 63, 683, 400), streamId: 'xobj:Fm0' };
  check('a másik tartalomfolyam elválaszt', bekezdesekre([a, b]).length === 2);
}

console.log('\nSORKIZÁRÁS FELISMERÉSE\n');

{
  // Kizárt: a teljes sorok jobb széle egy vonalban (63+400 = 463), az utolsó rövid.
  const kizart = bekezdesekre([
    sor('a', 63, 700, 400),
    sor('b', 63, 683, 400),
    sor('c', 63, 666, 120),
  ])[0]!;
  check('a kizárt bekezdést felismeri', kizart.sorkizart);
  check('a jobb margó a teljes sorokból jön', kizart.jobbSzel === 463, `${kizart.jobbSzel}`);

  // Balra zárt: a sorok jobb széle szóródik.
  const balra = bekezdesekre([
    sor('a', 63, 700, 400),
    sor('b', 63, 683, 330),
    sor('c', 63, 666, 120),
  ])[0]!;
  check('a balra zárt bekezdést nem nézi kizártnak', !balra.sorkizart);
}

console.log('\nÚJRATÖRDELÉS\n');

{
  const b = bekezdesekre([
    sor('a', 63, 700, 400),
    sor('b', 63, 683, 400),
    sor('c', 63, 666, 120),
  ])[0]!;
  // 400 pont széles sáv, 10 pont/karakter → 40 karakter fér egy sorba.
  const t = ujratordel(b, 'egy ket harom negy ot hat het nyolc kilenc tiz', mer)!;
  check('a tördelés megtörtént', t !== null && t.length > 0, `${t?.length} sor`);
  check(
    'egyik sor sem lóg ki a jobb margón',
    t.every((s) => {
      const u = s.szavak[s.szavak.length - 1]!;
      return u.x + u.szelesseg <= b.jobbSzel + 0.01;
    }),
  );
  check(
    'a sorok az eredeti sorhelyekre kerültek',
    t.every((s, i) => s.y === b.sorok[i]!.y),
  );

  /*
    A KIZÁRÁS AZ UTOLSÓ SORRA NEM VONATKOZIK. Egy kizárt utolsó sor a
    legárulkodóbb tipográfiai hiba: két szó a lap két szélére feszülne.
  */
  const utolso = t[t.length - 1]!;
  const utolsoVege = utolso.szavak[utolso.szavak.length - 1]!;
  check(
    'az utolsó sor balra zárt marad',
    utolsoVege.x + utolsoVege.szelesseg < b.jobbSzel - 1,
    `${Math.round(utolsoVege.x + utolsoVege.szelesseg)} < ${b.jobbSzel}`,
  );

  // A nem utolsó sorok viszont pontosan a margóig érnek.
  const nemUtolso = t.slice(0, -1).filter((s) => s.szavak.length > 1);
  check(
    'a kizárt sorok a jobb margóig érnek',
    nemUtolso.every((s) => {
      const u = s.szavak[s.szavak.length - 1]!;
      return Math.abs(u.x + u.szelesseg - b.jobbSzel) < 0.01;
    }),
    `${nemUtolso.length} kizárt sor`,
  );

  // A szavak sorrendje és tartalma nem változhat: ez a szöveg maga.
  check(
    'a szöveg szavai hiánytalanul, sorrendben megvannak',
    t.flatMap((s) => s.szavak.map((w) => w.szoveg)).join(' ') ===
      'egy ket harom negy ot hat het nyolc kilenc tiz',
  );
}

{
  /*
    AMI NEM FÉR EL, AHHOZ NEM NYÚLUNK. A bekezdés alatt másik bekezdés áll:
    egy negyedik sor ráfutna. A `null` a hívónak szól, hogy essen vissza a
    soronkénti útra — ez jobb, mint két egymásra csúszott bekezdés, ami a
    fájlban némán keletkezne.
  */
  const b = bekezdesekre([sor('a', 63, 700, 200), sor('b', 63, 683, 80)])[0]!;
  const tul = ujratordel(b, 'egy ket harom negy ot hat het nyolc kilenc tiz tizenegy', mer);
  check('ami nem fér el, azt nem tördeljük', tul === null);
}

console.log('\nA VALÓDI IRATON\n');

const ROOT = process.cwd();
const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/asvanyok.json'), 'utf8')) as Theme;
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));
const parties: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
];

const s = await DocumentSession.open(join(ROOT, 'spike/out/keresetlevel.pdf'), homonyms);
s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 't' }, theme, homonyms);
const units = (s as unknown as { units: { pdf?: { pageText: { spans: { segment: TextSegment }[] } } }[] }).units;
const oldal2 = units[1]?.pdf?.pageText.spans.map((x) => x.segment) ?? [];
const b2 = bekezdesekre(oldal2);

console.log(`  a 2. oldal ${oldal2.length} sora ${b2.length} bekezdésbe rendeződött`);
check('a valódi oldal bekezdésekre bomlik', b2.length >= 8 && b2.length <= 14, `${b2.length} bekezdés`);
check(
  'a törzsszöveg bekezdései sorkizártak',
  b2.filter((b) => b.sorok.length > 2).every((b) => b.sorkizart),
  `${b2.filter((b) => b.sorok.length > 2).length} többsoros bekezdésből ${
    b2.filter((b) => b.sorok.length > 2 && b.sorkizart).length
  } kizárt`,
);
check(
  'a középre zárt címek külön bekezdésbe kerültek',
  b2.some((b) => b.sorok.length === 1 && /TÉNYÁLLÁS|INDOKOLÁS/.test(b.sorok[0]!.text)),
);

console.log(`\n${checks - failures}/${checks} rendben`);
process.exit(failures === 0 ? 0 : 1);
