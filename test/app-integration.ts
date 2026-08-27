/**
 * Végponttól végpontig teszt arra az útvonalra, amit az alkalmazás használ:
 * megnyitás → keresés → csere → mentés → ellenőrzés. Ha ez zöld, a felület
 * mögötti gépezet működik.
 *
 * A teszt KÉT szakaszban fut, mert a gépezetnek része az emberi döntés is.
 * Korábban csak az első szakasz futott, és a végén a „tiszta" minősítést kérte
 * számon — olyan iraton, amin a jogász még egyetlen átnézendő találatot sem
 * döntött el. Így a `decisions` ág, vagyis a program legfontosabb kézi
 * vezérlője, egyáltalán nem volt tesztelve.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentSession } from '../src/app/session.js';
import type { PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/asvanyok.json'), 'utf8')) as Theme;
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[]; given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

const parties: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  // A feleség KÜLÖN szereplő. Amíg hiányzott a listáról, a „Kovács Jánosné"
  // alakból csak a „Kovács" cserélődött, és a „Jánosné" bent maradt — vagyis
  // az irat elárulta, hogy a felperes feleségéről van szó.
  { id: 'p1n', kind: 'person', fullName: 'Kovács Jánosné', gender: 'F', role: 'egyéb' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
  { id: 'p3', kind: 'person', fullName: 'Szabó Márton', gender: 'M', role: 'II. r. alperes' },
  { id: 'p4', kind: 'person', fullName: 'Kiss Erika', gender: 'F', role: 'tanú' },
  { id: 'p5', kind: 'person', fullName: 'özv. Baloghné Fehér Ilona', gender: 'F', role: 'tanú' },
  { id: 'p6', kind: 'person', fullName: 'ifj. Balogh Gábor', gender: 'M', role: 'tanú' },
  { id: 'p7', kind: 'person', fullName: 'dr. Bach Tivadar', gender: 'M', role: 'egyéb' },
  { id: 'p8', kind: 'org', fullName: 'Aranykalász Agrár Kft.', gender: 'N', role: 'egyéb' },
  { id: 'p9', kind: 'org', fullName: 'Hármashatár Ingatlanforgalmazó Zrt.', gender: 'N', role: 'egyéb' },
];

const which = process.argv[2] === 'docx' ? 'docx' : 'pdf';
const src = join(ROOT, `spike/out/keresetlevel.${which}`);
const out = join(ROOT, `spike/out/app-integration.${which}`);

const s = await DocumentSession.open(src, homonyms);
console.log(`Megnyitva: ${s.info.fileName} — ${s.info.pageCount} egység, ${s.info.charCount} karakter`);
if (s.info.pendingRevisions > 0) console.log(`Feloldatlan változáskövetés: ${s.info.pendingRevisions}`);
for (const w of s.info.loadWarnings) console.log(`  FIGYELEM: ${w}`);

const a = s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt' }, theme, homonyms);
console.log(`Találat: ${a.matches.length} (auto ${a.counts.auto}, átnézés ${a.counts.review}, elutasítva ${a.counts.reject})`);
console.log(`Lapkép: ${a.pages.length}, kiemelés: ${a.highlights.length}`);
console.log('Szereplap:');
for (const c of a.cast) console.log(`  ${c.original.padEnd(36)} → ${c.replacement.padEnd(30)} ${c.occurrences}×`);

// ── 1. szakasz: ELDÖNTETLEN állapot ─────────────────────────────────────────
//
// A mintairat szándékosan tele van köznévvel azonos alakú vezetéknevekkel:
// „Nagy összegű", „Szabó mesterségét", „Fehér színű". Ezek átnézésre várnak,
// tehát NEM cserélődnek le. Ilyenkor az iratot tilos tisztának minősíteni —
// a hallgatás nem jóváhagyás.
const undecided = await s.export({ mode: 'theme', keepKey: false, outputPath: out });
console.log(`\nEldöntetlenül: ${undecided.report.ok ? 'TISZTA' : `${undecided.report.leaks.length} BENNMARADT NÉV`}, függőben ${undecided.report.pending}`);
const undecidedFlagged = !undecided.report.ok && undecided.report.leaks.length === undecided.report.pending;
console.log(`  az eldöntetlen találatok jelentve: ${undecidedFlagged ? 'IGEN' : 'NEM'}`);

// ── 2. szakasz: a jogász végigdönti a találatokat ───────────────────────────
//
// Két alak valódi név („Szabóval" ragozva, „János" megszólításként), három
// pedig köznév. Pontosan ezt a döntést hozná meg a felületen.
const decisions: Record<number, 'accept' | 'skip'> = {};
const VALODI_NEV = new Set(['Szabóval', 'János']);
for (const m of a.matches) {
  if (m.disposition !== 'auto') decisions[m.id] = VALODI_NEV.has(m.surface) ? 'accept' : 'skip';
}
const a2 = s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt', decisions }, theme, homonyms);
const elfogadva = Object.values(decisions).filter((d) => d === 'accept').length;
const kihagyva = Object.values(decisions).filter((d) => d === 'skip').length;
console.log(`Döntés: ${Object.keys(decisions).length} találat (elfogadva ${elfogadva}, kihagyva ${kihagyva})`);

const r = await s.export({ mode: 'theme', keepKey: true, keyPassphrase: 'probajelszo123', outputPath: out });
console.log(`\nMentve: ${r.outputPath}`);
console.log(`Kulcsfájl: ${r.keyPath}`);
console.log(`Ellenőrzés: ${r.report.ok ? 'TISZTA' : `${r.report.leaks.length} BENNMARADT NÉV`}, lecserélve ${r.report.replaced}, függőben ${r.report.pending}`);
for (const l of r.report.leaks.slice(0, 5)) console.log(`  SZIVÁRGÁS: ${l.surface}`);
console.log(`Gyanús maradvány: ${r.report.residualTotal} (listázva ${r.report.residual.length})`);

// A kulcsfájl visszaolvasása is menjen.
const { readKeyFile } = await import('../src/app/keyfile.js');
const key = readKeyFile(r.keyPath!, 'probajelszo123');
console.log(`Kulcsfájl visszaolvasva: ${key.entries.length} bejegyzés`);

// A DOCX-nél nincs lapkép, ezért ott a kiemelést nem várjuk el.
const needHighlights = which === 'pdf';
const checks: [string, boolean][] = [
  ['az eldöntetlen találat nem minősül tisztának', undecidedFlagged],
  ['döntés után tiszta a jelentés', r.report.ok],
  ['a két valódi név lecserélődött', r.report.replaced > undecided.report.replaced],
  // A tudatosan bent hagyott alak nem tűnhet el némán: a maradványlistán a
  // helye — látható marad, csak nem tiltja az exportot.
  ['a bent hagyott alakok láthatók maradnak', r.report.residualTotal >= kihagyva],
  ['a lapkiemelés megvan', !needHighlights || a2.highlights.length > 0],
];
let bad = 0;
for (const [name, okCheck] of checks) {
  if (!okCheck) { bad++; console.log(`  BUKOTT: ${name}`); }
}
console.log(`\nVégponttól végpontig: ${checks.length - bad}/${checks.length} ellenőrzés rendben`);
process.exit(bad === 0 ? 0 : 1);
