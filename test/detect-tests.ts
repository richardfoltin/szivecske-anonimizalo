/**
 * A felek automatikus felismerésének ellenőrzése.
 *
 * Két dolgot mérünk. Az egyik a lefedettség: megtalálja-e a program mind a
 * felet, amit a mintairat aranykészlete felsorol. A másik — és ez a fontosabb —
 * hogy a felismert nevek NE mosódjanak össze. Egy anonimizálóban a hamis
 * összevonás a súlyosabb hiba: ha a „Kovács Jánosné" a férje bejegyzésébe
 * olvad, az asszony vagy a férje fedőnevét kapja, vagy a saját neve bent marad.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectByStructure, detectParties } from '../src/app/detect.js';

interface Sample {
  filename: string;
  text: string;
  parties: { canonical: string; type: string; role: string; gender: string }[];
  mentions?: { surface: string; canonical: string }[];
  must_keep?: string[];
}

const ROOT = process.cwd();
const SAMPLES = ['itelet', 'keresetlevel', 'kolcsonszerzodes'];

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

/** Névelőtag és kis-nagybetű nélkül; ezen a szinten vetjük össze a neveket. */
function norm(s: string): string {
  return s
    .replace(/^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai)\s*)+/i, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
}

function matches(found: string, expected: string): boolean {
  const f = norm(found);
  const e = norm(expected);
  return f === e || f.startsWith(e) || e.startsWith(f);
}

/**
 * Megtaláltuk-e a felet.
 *
 * A kanonikus névvel való összevetés önmagában nem elég: egy irat a személyt
 * más néven is említheti, mint amit az aranykészlet kanonikusnak tekint. A
 * kölcsönszerződésben például özv. Baloghné Fehér Ilona KIZÁRÓLAG leánykori
 * nevén, az „anyja neve" rovatban szerepel — „Fehér Ilona"-ként. Ilyenkor a
 * „Fehér Ilona" megtalálása a helyes eredmény, nem hiány. Ezért a mintafájl
 * saját említéslistáját is elfogadjuk.
 */
function isCovered(found: string[], canonical: string, sample: Sample): boolean {
  if (found.some((f) => matches(f, canonical))) return true;
  const aliases = (sample.mentions ?? [])
    .filter((m) => norm(m.canonical) === norm(canonical))
    .map((m) => m.surface);
  return aliases.some((a) => found.some((f) => matches(f, a)));
}

console.log('');

for (const id of SAMPLES) {
  const s = JSON.parse(readFileSync(join(ROOT, `samples/${id}.json`), 'utf8')) as Sample;
  const result = detectByStructure(s.text);
  const found = result.parties.map((p) => p.fullName);

  const covered = s.parties.filter((g) => isCovered(found, g.canonical, s));
  console.log(
    `${s.filename.padEnd(24)} szerkezetből: ${covered.length}/${s.parties.length} fél, ` +
      `${result.keepList.length} megtartandó`,
  );
  const missing = s.parties.filter((g) => !isCovered(found, g.canonical, s));
  if (missing.length) console.log(`  hiányzik: ${missing.map((m) => m.canonical).join(' | ')}`);

  // Egy felismert név sem szerepelhet kétszer — sem pontosan, sem ragozott
  // alakban. A duplikátum azt jelenti, hogy ugyanaz az ember két fedőnevet kap.
  const seen = new Set<string>();
  for (const f of found) {
    check(`${id}: nincs kétszer felvéve — ${f}`, !seen.has(norm(f)));
    seen.add(norm(f));
  }

  // A kanonikus alak legyen ragozatlan: ha egy név a másik ragozott alakja,
  // a listán csak a ragozatlannak szabad szerepelnie.
  for (const f of found) {
    const bare = norm(f);
    const shorter = found.find((o) => {
      const b = norm(o);
      return b !== bare && bare.startsWith(b) && bare.length - b.length <= 4 && !bare.slice(b.length).startsWith('né');
    });
    check(`${id}: ragozatlan alak szerepel — ${f}`, !shorter, shorter ? `„${shorter}" is a listán` : '');
  }

  // Amit a törvény szerint bent kell hagyni, az ne kerüljön a felek közé.
  for (const k of s.must_keep ?? []) {
    check(
      `${id}: megtartandó nem fél — ${k}`,
      !found.some((f) => matches(f, k)),
      found.find((f) => matches(f, k)) ?? '',
    );
  }
}

// ─── A férj és a feleség két külön ember ───────────────────────────────────
//
// Ez a rész külön áll, mert nem lefedettséget mér, hanem egy konkrét, korábban
// elkövetett hibát zár ki. A „-né" magyarul képző, nem rag: a „Kovács Jánosné"
// nem a „Kovács János" ragozott alakja, hanem másik személy. Egy betűszámláló
// összevonás („ha a többlet legfeljebb néhány kisbetű, ugyanaz") pontosan ezt
// rontotta el.
{
  const text = [
    'Kovács János felperes keresetet nyújtott be Nagy Péter I. rendű alperes ellen.',
    'Kovács Jánosné II. rendű alperes a tárgyaláson megjelent.',
    'A bíróság Kovács Jánost és Kovács Jánosnét is meghallgatta.',
    'Kovács Jánosnak és Kovács Jánosnéval szemben külön határozat született.',
  ].join('\n');

  const parties = detectByStructure(text).parties.map((p) => p.fullName);
  const hasHusband = parties.some((p) => norm(p) === 'kovács jános');
  const hasWife = parties.some((p) => norm(p) === 'kovács jánosné');

  check('férj külön félként szerepel', hasHusband, parties.join(' | '));
  check('feleség külön félként szerepel', hasWife, parties.join(' | '));

  // A ragozott alakok viszont NE legyenek külön felek.
  for (const inflected of ['kovács jánost', 'kovács jánosnak', 'kovács jánosnét', 'kovács jánosnéval']) {
    check(
      `ragozott alak nem külön fél — ${inflected}`,
      !parties.some((p) => norm(p) === inflected),
      parties.join(' | '),
    );
  }
}

// ─── A modellel együtt ────────────────────────────────────────────────────
//
// Ha a modell telepítve van, ugyanezeket a szabályokat a modell találataival
// együtt is megnézzük. A modell ragos alakokat is visszaad („Kovács Jánosnéval"),
// és épp az a kérdés, hogy azok a helyes bejegyzésbe kerülnek-e.
let ran = false;
try {
  const { HubertNer } = await import('../src/ai/hubertNer.js');
  const ner = new HubertNer({
    modelId: 'nytk-hubert',
    repo: 'foltin/nerkor-hubert-hungarian-onnx',
    cacheDir: join(ROOT, '.modellek'),
    labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
  });
  if (ner.isInstalled()) {
    await ner.load();
    const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
      surnames: { form: string }[];
      given_names: { form: string }[];
    };
    const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

    console.log('');
    for (const id of SAMPLES) {
      const s = JSON.parse(readFileSync(join(ROOT, `samples/${id}.json`), 'utf8')) as Sample;
      const ents = await ner.extract(s.text);

      // A pozíció a legfontosabb kimenet: ha elcsúszik, rossz helyen vágunk.
      const misaligned = ents.filter((e) => s.text.slice(e.start, e.end) !== e.text);
      check(`${id}: minden pozíció pontos`, misaligned.length === 0, `${misaligned.length} elcsúszott`);

      const det = detectParties(s.text, { modelEntities: ents, homonyms });
      const found = det.parties.map((p) => p.fullName);
      const covered = s.parties.filter((g) => isCovered(found, g.canonical, s));
      console.log(
        `${s.filename.padEnd(24)} modellel:    ${covered.length}/${s.parties.length} fél, ` +
          `${ents.length} találat`,
      );
      check(`${id}: modellel is teljes a lefedettség`, covered.length === s.parties.length,
        s.parties.filter((g) => !isCovered(found, g.canonical, s)).map((g) => g.canonical).join(' | '));

      const seen = new Set<string>();
      for (const f of found) {
        check(`${id}: modellel sincs kétszer — ${f}`, !seen.has(norm(f)));
        seen.add(norm(f));
      }
      for (const k of s.must_keep ?? []) {
        check(`${id}: modellel is megtartandó marad — ${k}`, !found.some((f) => matches(f, k)));
      }
    }
    await ner.dispose();
    ran = true;
  }
} catch (e) {
  console.log(`\nA modell nem futott: ${(e as Error).message}`);
}
if (!ran) console.log('\nA modell nincs telepítve — csak a szerkezeti részt mértük.');

console.log('');
if (failures.length) {
  console.log('HIBÁK:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}
console.log(`Felek felismerése: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
