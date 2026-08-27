/**
 * A nyelvi modell tényleges lefuttatása magyar jogi szövegen.
 *
 * Ez a próba dönti el, hogy a modell-út működik-e: letölt, betölt, futtat,
 * és — ami egy kitakaró programnál a lényeg — visszaadja-e a pontos
 * karakterpozíciókat.
 *
 *   npx tsx test/model-run.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_REGISTRY, ModelStore, formatBytes } from '../src/app/models.js';
import { TokenClassifier } from '../src/ai/tokenClassifier.js';
import { detectParties } from '../src/app/detect.js';

const ROOT = process.cwd();
const CACHE = join(ROOT, '.modellek');
const out: string[] = [];
const say = (s: string): void => {
  out.push(s);
  console.log(s);
};

const spec = MODEL_REGISTRY[0]!;
const store = new ModelStore(CACHE);

const status = (await store.list()).find((m) => m.id === spec.id)!;
say(`Modell: ${spec.name}`);
say(`Tároló: ${spec.repo} — ${spec.license} — ${formatBytes(status.totalBytes)}`);
say(`Állapot: ${status.state}`);

if (status.state !== 'installed') {
  say('\nLetöltés…');
  let last = -1;
  await store.download(spec.id, (p) => {
    const pct = Math.round(p.ratio * 100);
    if (pct !== last && pct % 10 === 0) {
      last = pct;
      process.stdout.write(`  ${pct}% (${formatBytes(p.receivedBytes)})\n`);
    }
  });
  say('Letöltés kész.');
}

const clf = new TokenClassifier({
  modelId: spec.id,
  repo: spec.repo,
  cacheDir: CACHE,
  labelMap: spec.labelMap,
  dtype: 'q8',
});

const t0 = Date.now();
const info = await clf.load();
say(`\nBetöltés: ${info.loadMs} ms, pozíciók: ${info.offsets}`);

const sample = JSON.parse(readFileSync(join(ROOT, 'samples/itelet.json'), 'utf8')) as {
  text: string;
  parties: { canonical: string }[];
};

const t1 = Date.now();
const entities = await clf.extract(sample.text);
const ms = Date.now() - t1;
const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));

say(`\nFuttatás: ${sample.text.length} karakter, ${ms} ms, csúcsmemória ${rss} MB`);
say(`Találat: ${entities.length} entitás`);

// A legfontosabb ellenőrzés: a visszaadott pozíció tényleg a nevet jelöli-e.
const misaligned = entities.filter((e) => sample.text.slice(e.start, e.end) !== e.text);
say(`Elcsúszott pozíció: ${misaligned.length} / ${entities.length}`);

const byLabel = new Map<string, string[]>();
for (const e of entities) {
  const list = byLabel.get(e.label) ?? [];
  list.push(e.text);
  byLabel.set(e.label, list);
}
for (const [label, list] of byLabel) {
  const uniq = [...new Set(list)];
  say(`\n  ${label} (${list.length} találat, ${uniq.length} különböző):`);
  say(`    ${uniq.slice(0, 25).join(' | ')}`);
}

// Csapda: a „Nagy a kockázatot vállalta" melléknév nem lehet személynév.
const trap = entities.filter(
  (e) => e.label === 'person' && /^(Nagy|Kis|Fehér|Fekete)$/.test(e.text.trim()),
);
say(`\nCsapda (köznévi melléknév személynévként): ${trap.length} találat`);
for (const t of trap) {
  const ctx = sample.text.slice(Math.max(0, t.start - 30), t.end + 30).replace(/\s+/g, ' ');
  say(`   "${t.text}" @${t.start} (${t.score.toFixed(3)}) — …${ctx}…`);
}

// A teljes folyamat: modell + szerkezet együtt.
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

const merged = detectParties(sample.text, { modelEntities: entities, homonyms });
say(`\n─── MODELL + SZERKEZET ───`);
say(`${merged.parties.length} fél, ${merged.keepList.length} megtartandó név`);
for (const p of merged.parties) {
  say(`  ${p.confidence.toFixed(2)} ${p.fullName.padEnd(32)} ${p.kind.padEnd(7)} ${p.role.padEnd(16)} ${p.occurrences}× — ${p.evidence}`);
}
say(`  MEGTARTANDÓ: ${merged.keepList.map((k) => k.name).join(' | ')}`);

const norm = (x: string): string =>
  x.replace(/^((?:dr\.|ifj\.|id\.|özv\.)\s*)+/i, '').toLowerCase().trim();
const expected = sample.parties.map((p) => norm(p.canonical));
const found = merged.parties.map((p) => norm(p.fullName));
const hits = expected.filter((e) => found.some((f) => f === e || f.includes(e) || e.includes(f)));
say(`\nLefedettség: ${hits.length}/${expected.length} annotált fél`);
const missed = expected.filter((e) => !found.some((f) => f === e || f.includes(e) || e.includes(f)));
if (missed.length) say(`KIMARADT: ${missed.join(' | ')}`);

await clf.dispose();
say(`\nÖsszidő: ${Date.now() - t0} ms`);
writeFileSync(join(ROOT, 'model-run.out.txt'), out.join('\n'), 'utf8');
