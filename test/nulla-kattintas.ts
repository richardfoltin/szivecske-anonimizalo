/**
 * Mi történne, ha a program EGYETLEN emberi döntés nélkül dolgozna?
 *
 * A kérdés nem elméleti: a felhasználó azt szeretné, hogy a modell találja meg
 * a neveket, a program pedig cserélje ki őket — kérdezés nélkül. Ennek az ára
 * mérhető, és két külön tételből áll:
 *
 *   1. KIMARADT NÉV — a program nem cserélte le, pedig kellett volna. Ez
 *      SZIVÁRGÁS: láthatatlan hiba, a felhasználó nem tud róla.
 *   2. FÖLÖSLEGES CSERE — a program lecserélt valamit, ami nem név („Nagy a
 *      kockázat"). Ez LÁTHATÓ hiba: rontja az olvashatóságot, de nem árul el
 *      senkit.
 *
 * A kettő nem egyenrangú. Ez a mérés adja meg, melyikből mennyi van.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentSession } from '../src/app/session.js';
import { detectParties } from '../src/app/detect.js';
import { HubertNer } from '../src/ai/hubertNer.js';
import type { PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const SAMPLES = ['itelet', 'keresetlevel', 'kolcsonszerzodes'];

const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/kokorszak.json'), 'utf8')) as Theme;
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

const ner = new HubertNer({
  modelId: 'nytk',
  repo: 'foltin/nerkor-hubert-hungarian-onnx',
  cacheDir: join(ROOT, '.modellek'),
  labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
});
await ner.load();

/** Névelőtag és kis-nagybetű nélküli összevetés. */
const norm = (s: string): string =>
  s.replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '').toLowerCase().trim();

interface Sor {
  irat: string;
  felek: number;
  arany: number;
  auto: number;
  atnezes: number;
  elutasitva: number;
  /** Az aranykészlet felei, akik NEM kerültek a listára. */
  kimaradtFel: string[];
  /** Csak automatikus cserével bennmaradt nevek. */
  szivargasOvatos: number;
  /** Mindent elfogadva bennmaradt nevek. */
  szivargasBator: number;
  /** Mindent elfogadva a köznévi találatok, amik fölöslegesen cserélődnek. */
  foloslegesek: string[];
  maradek: string[];
}

const sorok: Sor[] = [];

for (const id of SAMPLES) {
  const s = JSON.parse(readFileSync(join(ROOT, `samples/${id}.json`), 'utf8')) as {
    filename: string;
    text: string;
    parties: { canonical: string }[];
    mentions?: { surface: string; canonical: string }[];
  };

  // ── NULLA emberi döntés: a felismerés eredményét változtatás nélkül vesszük.
  const ents = await ner.extract(s.text);
  const det = detectParties(s.text, { modelEntities: ents, homonyms });
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
  const bemenet = { parties: felek, themeId: theme.id, mode: 'theme' as const, caseSecret: id };

  // (a) ÓVATOS: csak az automatikus találatok cserélődnek.
  const ovatos = doc.analyze(bemenet, theme, homonyms);
  const outA = join(ROOT, `spike/out/nulla-${id}-a.txt`);
  const rOvatos = await doc.export({ mode: 'theme', keepKey: false, outputPath: outA });

  // (b) BÁTOR: az átnézésre váró találatokat is elfogadjuk.
  const decisions: Record<number, 'accept' | 'skip'> = {};
  for (const m of ovatos.matches) if (m.disposition === 'review') decisions[m.id] = 'accept';
  doc.analyze({ ...bemenet, decisions }, theme, homonyms);
  const outB = join(ROOT, `spike/out/nulla-${id}-b.txt`);
  const rBator = await doc.export({ mode: 'theme', keepKey: false, outputPath: outB });

  // Mely aranykészletbeli fél maradt ki a listáról?
  const nevek = felek.map((f) => norm(f.fullName));
  const alias = (kanon: string): string[] =>
    (s.mentions ?? []).filter((m) => norm(m.canonical) === norm(kanon)).map((m) => norm(m.surface));
  const kimaradtFel = s.parties
    .filter((g) => {
      const jeloltek = [norm(g.canonical), ...alias(g.canonical)];
      return !nevek.some((n) => jeloltek.some((j) => n === j || n.startsWith(j) || j.startsWith(n)));
    })
    .map((g) => g.canonical);

  // A köznévi találatok: amit a homonima-lista is köznévnek ismer.
  const foloslegesek = [
    ...new Set(
      ovatos.matches
        .filter((m) => m.disposition === 'review' && homonyms.has(m.surface.toLowerCase()))
        .map((m) => m.surface),
    ),
  ];

  sorok.push({
    irat: s.filename,
    felek: felek.length,
    arany: s.parties.length,
    auto: ovatos.counts.auto,
    atnezes: ovatos.counts.review,
    elutasitva: ovatos.counts.reject,
    kimaradtFel,
    szivargasOvatos: rOvatos.report.leaks.length,
    szivargasBator: rBator.report.leaks.length,
    maradek: rBator.report.leaks.map((l) => `${l.surface} — ${l.detail ?? ''}`),
    foloslegesek,
  });
}

for (const id of SAMPLES) for (const v of ['a','b'])
  rmSync(join(ROOT, `spike/out/nulla-${id}-${v}.txt`), { force: true });
for (const id of SAMPLES) for (const v of ['a','b'])
  rmSync(join(ROOT, `spike/out/nulla-${id}-${v}-jegyzokonyv.txt`), { force: true });

await ner.dispose();

console.log('\n══ NULLA EMBERI DÖNTÉS ═══════════════════════════════════════\n');
console.log('irat                  felek  arany   auto  átnéz  elutas');
for (const r of sorok) {
  console.log(
    `${r.irat.padEnd(22)}${String(r.felek).padStart(4)}${String(r.arany).padStart(7)}` +
      `${String(r.auto).padStart(7)}${String(r.atnezes).padStart(7)}${String(r.elutasitva).padStart(8)}`,
  );
}

console.log('\n── 1. KIMARADT FÉL (szivárgás, láthatatlan) ──────────────────');
let kimaradtOsszes = 0;
for (const r of sorok) {
  kimaradtOsszes += r.kimaradtFel.length;
  console.log(
    `  ${r.irat.padEnd(22)} ${r.kimaradtFel.length === 0 ? 'egy sem' : r.kimaradtFel.join(' | ')}`,
  );
}

console.log('\n── 2. BENNMARADT NÉV a kimenetben ────────────────────────────');
console.log('  irat                  csak-auto   mindent-elfogad');
for (const r of sorok) {
  console.log(
    `  ${r.irat.padEnd(22)}${String(r.szivargasOvatos).padStart(9)}${String(r.szivargasBator).padStart(18)}`,
  );
}

console.log('\n── 3. FÖLÖSLEGES CSERE (látható, de nem szivárgás) ───────────');
for (const r of sorok) {
  console.log(
    `  ${r.irat.padEnd(22)} ${r.foloslegesek.length === 0 ? 'egy sem' : r.foloslegesek.join(' | ')}`,
  );
}

const bator = sorok.reduce((a, r) => a + r.szivargasBator, 0);
const ovatosSzum = sorok.reduce((a, r) => a + r.szivargasOvatos, 0);

console.log('\n══ ÖSSZEGZÉS ════════════════════════════════════════════════');
console.log(`  aranykészletbeli fél, aki kimaradt a listáról:  ${kimaradtOsszes}`);
console.log(`  bennmaradt név, ha csak az automatikus cserél:  ${ovatosSzum}`);
console.log(`  bennmaradt név, ha mindent elfogadunk:          ${bator}`);
console.log('');
