/**
 * Spike 1 — magyar név-illesztés és ragozás.
 *
 * Ez a spike egyetlen kérdést válaszol meg: ha az ügyvéd megadja a feleket,
 * megtaláljuk-e ÖSSZES ragozott alakjukat, és tudunk-e a helyükre helyes magyar
 * álnevet írni? A döntési szabály: ha a lefedettség nem gyakorlatilag 100%, és a
 * kimenet nem olvasható tiszta magyarként, nincs értelme továbbmenni.
 *
 *   npm run spike1
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SeedMatcher, type Match } from '../src/hu/matcher.js';
import type { Gender, SeedEntity } from '../src/hu/names.js';
import { assignPseudonyms, buildContext, substitute, type ReplacementMode, type Theme } from '../src/pseudonym.js';
import { verifyOutput } from '../src/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

interface SampleParty {
  canonical: string;
  type: 'PERSON' | 'ORG' | 'LOC';
  role: string;
  gender: Gender;
}

interface SampleMention {
  surface: string;
  canonical: string;
  form: string;
  note: string;
}

interface Sample {
  filename: string;
  kind: string;
  text: string;
  parties: SampleParty[];
  mentions: SampleMention[];
  must_keep: string[];
  traps?: { text: string; why: string }[];
}

/**
 * Köznévként is előforduló magyar vezetéknevek és keresztnevek. Ez a lista dönti
 * el, hogy a puszta "Nagy" névnek vagy melléknévnek számít-e — a magyar szöveg
 * egyik legnagyobb hibaforrása.
 */
interface HomonymData {
  surnames: { form: string; common_meaning: string; part_of_speech: string; risk: string }[];
  given_names: { form: string; common_meaning: string; risk: string }[];
  context_cues: string[];
}

function loadHomonyms(): { surnames: Set<string>; given: Set<string>; highRisk: number } {
  const d = JSON.parse(readFileSync(join(ROOT, 'data', 'homonyms.json'), 'utf8')) as HomonymData;
  return {
    surnames: new Set(d.surnames.map((x) => x.form.toLowerCase())),
    given: new Set(d.given_names.map((x) => x.form.toLowerCase())),
    highRisk: d.surnames.filter((x) => x.risk === 'high').length,
  };
}

function loadThemes(): Theme[] {
  const dir = join(ROOT, 'data', 'themes');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Theme);
}

function loadSamples(): Sample[] {
  const dir = join(ROOT, 'samples');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Sample);
}

/**
 * Névelőtagok, amelyeket le kell választani a névről. Nem részei a névnek, de
 * az ügyvéd rendszerint velük együtt írja be: "dr. Bach Tivadar",
 * "ifj. Balogh Gábor", "özv. Baloghné Fehér Ilona".
 */
const TITLE_PREFIX = /^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai|prof\.)\s*)+/i;

/** A minta feleiből építi az entitáslistát — ezt írná be az ügyvéd. */
function toEntities(parties: SampleParty[]): SeedEntity[] {
  const out: SeedEntity[] = [];
  let n = 0;
  for (const p of parties) {
    const id = `E${++n}`;
    if (p.type === 'ORG') {
      out.push({ kind: 'org', id, name: p.canonical, role: p.role });
      continue;
    }
    if (p.type === 'LOC') {
      out.push({ kind: 'place', id, name: p.canonical });
      continue;
    }

    const bare = p.canonical.trim().replace(TITLE_PREFIX, '').trim();
    const parts = bare.split(/\s+/);

    // "Baloghné Fehér Ilona": férj vezetékneve + -né, leánykori vezetéknév, keresztnév.
    const marriedWithMaiden = /^(.+?)né$/.exec(parts[0] ?? '');
    if (marriedWithMaiden && parts.length >= 3 && p.gender === 'F') {
      out.push({
        kind: 'person',
        id,
        surname: marriedWithMaiden[1]!,
        given: parts[parts.length - 1]!,
        maidenSurname: parts.slice(1, -1).join(' '),
        wifeOf: marriedWithMaiden[1]!,
        gender: 'F',
        role: p.role,
      });
      continue;
    }

    // "Kovács Jánosné": a férj teljes nevéből képzett asszonynév.
    const marriedFull = /^(.*?)né$/.exec(bare);
    if (marriedFull && p.gender === 'F' && parts.length >= 2) {
      const husband = marriedFull[1]!.trim();
      const hp = husband.split(/\s+/);
      out.push({
        kind: 'person',
        id,
        surname: hp[0] ?? husband,
        given: hp.slice(1).join(' ') || husband,
        wifeOf: husband,
        gender: 'F',
        role: p.role,
      });
      continue;
    }

    out.push({
      kind: 'person',
      id,
      surname: parts[0] ?? bare,
      given: parts.slice(1).join(' '),
      gender: p.gender,
      role: p.role,
    });
  }
  return out;
}

/** Melyik keresztnév fordul elő több félnél is. */
function ambiguousGivenNames(entities: SeedEntity[]): Set<string> {
  const counts = new Map<string, number>();
  for (const e of entities) {
    if (e.kind !== 'person') continue;
    const k = e.given.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
}

interface Coverage {
  expected: number;
  found: number;
  missing: SampleMention[];
  falsePositives: Match[];
}

/**
 * Lefedettség: a minta minden annotált említését megtaláltuk-e.
 *
 * Az annotációk a szövegben való előfordulás sorrendjében állnak, ezért
 * kurzorral haladunk végig rajtuk: minden említést az előző UTÁN keresünk meg.
 * Így a pozíciók pontosak, és egy hosszabb találat nem "nyeli el" egy másik
 * említés helyét.
 */
function measureCoverage(sample: Sample, matches: Match[]): Coverage {
  const missing: SampleMention[] = [];
  const spans: [number, number][] = [];

  let cursor = 0;
  for (const mention of sample.mentions) {
    const pos = sample.text.indexOf(mention.surface, cursor);
    if (pos === -1) {
      // Az annotáció felszíni alakja nincs a szövegben (vagy már elhaladtunk
      // mellette) — ez az annotáció hibája, jelezzük külön.
      missing.push({ ...mention, note: `${mention.note} [az annotáció nem illeszkedik a szövegre]` });
      continue;
    }
    const endPos = pos + mention.surface.length;
    spans.push([pos, endPos]);
    cursor = endPos;

    const covered = matches.some((m) => m.start <= pos && m.end >= endPos);
    if (!covered) missing.push(mention);
  }

  // Hamis pozitív: automatikusan cserélne olyat, amit az annotáció nem jelöl.
  const falsePositives = matches.filter(
    (m) => m.autoReplaceable && !spans.some(([a, b]) => m.start >= a && m.end <= b),
  );

  return {
    expected: sample.mentions.length,
    found: sample.mentions.length - missing.length,
    missing,
    falsePositives,
  };
}

function pct(a: number, b: number): string {
  if (b === 0) return '—';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function bar(label: string): string {
  return `\n${'─'.repeat(78)}\n${label}\n${'─'.repeat(78)}`;
}

function main(): void {
  const themes = loadThemes();
  const samples = loadSamples();
  const homonyms = loadHomonyms();
  const theme = themes[0];
  if (!theme) {
    console.error('Nincs témacsomag a data/themes mappában.');
    process.exit(1);
  }

  console.log(bar('SPIKE 1 — magyar név-illesztés és ragozás'));
  console.log(`Témacsomag: ${theme.name_hu} (${theme.given_names.length} keresztnév, ${theme.surnames.length} vezetéknév)`);
  console.log(`Minták: ${samples.length} db\n`);

  const outDir = join(ROOT, 'spike', 'out');
  mkdirSync(outDir, { recursive: true });

  let totalExpected = 0;
  let totalFound = 0;
  let totalLeaks = 0;

  for (const sample of samples) {
    const entities = toEntities(sample.parties);
    const byId = new Map(entities.map((e) => [e.id, e]));
    const canonicalToId = new Map<string, string>();
    sample.parties.forEach((p, i) => canonicalToId.set(p.canonical, `E${i + 1}`));

    const matcher = new SeedMatcher(entities, {
      homonyms: homonyms.surnames,
      ambiguousGivenNames: new Set([...ambiguousGivenNames(entities), ...homonyms.given]),
    });
    const matches = matcher.find(sample.text);
    const coverage = measureCoverage(sample, matches);

    console.log(bar(`${sample.filename} — ${sample.kind}`));
    console.log(`Felek: ${entities.length} | legyártott felszíni alak: ${matcher.variantCount}`);
    console.log(
      `Lefedettség: ${coverage.found}/${coverage.expected} annotált említés (${pct(coverage.found, coverage.expected)})`,
    );
    console.log(`Összes találat: ${matches.length}  (automatikusan cserélhető: ${matches.filter((m) => m.autoReplaceable).length})`);

    if (coverage.missing.length > 0) {
      console.log('\n  NEM TALÁLT EMLÍTÉSEK:');
      for (const m of coverage.missing) {
        console.log(`    "${m.surface}"  (${m.form}) ${m.note ? `— ${m.note}` : ''}`);
      }
    }

    if (coverage.falsePositives.length > 0) {
      console.log('\n  LEHETSÉGES HAMIS TALÁLATOK (automatikusan cserélne, de nincs annotálva):');
      for (const m of coverage.falsePositives) {
        console.log(`    "${m.surface}" @${m.start}  ${m.reason}  [${m.confidence.toFixed(2)}]`);
      }
    }

    const review = matches.filter((m) => !m.autoReplaceable);
    if (review.length > 0) {
      console.log('\n  ÁTNÉZÉSRE VÁR (nem cserélődik automatikusan):');
      for (const m of review) {
        console.log(`    "${m.surface}" @${m.start}  ${m.reason}  [${m.confidence.toFixed(2)}]`);
      }
    }

    // Csapdák: olyan szövegrészek, amiket NEM szabad lecserélni.
    for (const trap of sample.traps ?? []) {
      const pos = sample.text.indexOf(trap.text);
      if (pos === -1) continue;
      const caught = matches.filter(
        (m) => m.autoReplaceable && m.start >= pos && m.end <= pos + trap.text.length,
      );
      const verdict = caught.length === 0 ? 'RENDBEN' : `HIBA — lecserélné: ${caught.map((c) => `"${c.surface}"`).join(', ')}`;
      console.log(`\n  Csapda: "${trap.text}" → ${verdict}\n    (${trap.why})`);
    }

    // --- csere és ellenőrzés minden módban ---
    const assignments = assignPseudonyms(entities, theme, { caseSecret: 'spike-teszt-kulcs', preferSimilarLength: true });

    console.log('\n  SZEREPLAP:');
    for (const e of entities) {
      const a = assignments.get(e.id);
      if (!a) continue;
      const count = matches.filter((m) => m.entityId === e.id).length;
      console.log(`    ${a.original.padEnd(30)} → ${a.display.padEnd(28)} ${String(count).padStart(3)} előfordulás`);
    }

    // Két menet minden módban:
    //  (a) csak az automatikus csere — ezt kapná a felhasználó azonnal,
    //  (b) minden megtalált találat jóváhagyva — ezt kapja, miután végigment a
    //      szereplapon. A termék ígérete a (b) menetre vonatkozik.
    for (const mode of ['theme', 'role', 'numbered'] as ReplacementMode[]) {
      const ctx = buildContext(mode, entities, assignments);
      const pseudonyms = [...assignments.values()].map((a) => a.display);
      for (const w of ctx.warnings) console.log(`
  FIGYELMEZTETÉS [${mode}]: ${w}`);

      const auto = substitute(sample.text, matches, byId, ctx);
      const autoReport = verifyOutput(auto.text, entities, { pseudonyms, keepList: sample.must_keep });

      const approved = substitute(sample.text, matches, byId, ctx, { approveAll: true });
      const approvedReport = verifyOutput(approved.text, entities, { pseudonyms, keepList: sample.must_keep });

      // A csapdák szándékosan bennmaradnak: ott a rendszer helyesen ítélte
      // köznévnek a szót. Az ellenőrző kör ezeket is jelzi (jól teszi), de a
      // spike értékelésénél nem számítanak szivárgásnak.
      const trapTexts = (sample.traps ?? []).map((t) => t.text);
      const realLeaks = approvedReport.leaks.filter(
        (l) => !trapTexts.some((t) => {
          const pos = approved.text.indexOf(t);
          return pos !== -1 && l.start >= pos && l.end <= pos + t.length;
        }),
      );
      const trapLeaks = approvedReport.leaks.length - realLeaks.length;
      totalLeaks += realLeaks.length;

      console.log(
        `\n  [${mode}]  automatikus: ${auto.replaced} csere, ${auto.pending.length} függőben, ` +
          `${autoReport.leaks.length} bennmaradt név` +
          `\n         jóváhagyva:   ${approved.replaced} csere, ${approved.pending.length} függőben, ` +
          `${realLeaks.length} bennmaradt név (+${trapLeaks} tudatosan meghagyott köznév), ` +
          `${approvedReport.residual.length} gyanús maradvány` +
          `\n         névelő javítva: ${approved.articlesFixed}`,
      );
      if (realLeaks.length > 0) {
        for (const l of realLeaks.slice(0, 8)) {
          console.log(`      SZIVÁRGÁS: "${l.surface}" @${l.start} — ${l.detail}`);
        }
      }
      if (approved.pending.length > 0) {
        for (const p of approved.pending.slice(0, 8)) {
          console.log(`      NEM CSERÉLHETŐ: "${p.surface}" @${p.start} — ${p.reason}`);
        }
      }

      writeFileSync(join(outDir, `${sample.filename.replace(/\.\w+$/, '')}.${mode}.txt`), approved.text, 'utf8');
    }

    // A jóváhagyott témás kimenet kiírása, hogy magyarul elolvasható legyen.
    const themeCtx = buildContext('theme', entities, assignments);
    const themed = substitute(sample.text, matches, byId, themeCtx, { approveAll: true });
    console.log('\n  TÉMÁS KIMENET (minden találat jóváhagyva):\n');
    console.log(
      themed.text
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );

    totalExpected += coverage.expected;
    totalFound += coverage.found;
  }

  console.log(bar('ÖSSZESÍTÉS'));
  console.log(`Lefedettség: ${totalFound}/${totalExpected} (${pct(totalFound, totalExpected)})`);
  console.log(`Szivárgás a kimenetekben: ${totalLeaks}`);
  console.log(`\nA kimenetek: spike/out/\n`);

  const passed = totalExpected > 0 && totalFound === totalExpected && totalLeaks === 0;
  console.log(passed ? 'DÖNTÉS: a spike ÁTMENT.' : 'DÖNTÉS: még nem megy át — lásd a hiányzó említéseket fent.');
  process.exit(passed ? 0 : 1);
}

main();
