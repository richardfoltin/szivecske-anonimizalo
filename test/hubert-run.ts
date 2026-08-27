/**
 * A magyar huBERT NER-modell mérése — ugyanazon a szövegen, ugyanazokkal a
 * csapdákkal, mint a másik modell, hogy az összevetés érvényes legyen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HubertNer } from '../src/ai/hubertNer.js';
import { detectParties } from '../src/app/detect.js';

const ROOT = process.cwd();
const out: string[] = [];
const say = (s: string): void => { out.push(s); console.log(s); };

const ner = new HubertNer({
  modelId: 'nytk-hubert',
  repo: 'foltin/nerkor-hubert-hungarian-onnx',
  cacheDir: join(ROOT, '.modellek'),
  labelMap: { PER: 'person', ORG: 'org', LOC: 'place', MISC: 'other' },
});

const info = await ner.load();
say(`Betöltés: ${info.loadMs} ms, pozíciók: ${info.offsets}`);

const sample = JSON.parse(readFileSync(join(ROOT, 'samples/itelet.json'), 'utf8')) as {
  text: string; parties: { canonical: string }[];
};

const t = Date.now();
const ents = await ner.extract(sample.text);
const ms = Date.now() - t;
const rss = Math.round(process.memoryUsage().rss / (1024 * 1024));
say(`Futtatás: ${sample.text.length} karakter, ${ms} ms (${Math.round(sample.text.length / (ms / 1000))} kar/s), RSS ${rss} MB`);
say(`Találat: ${ents.length}`);

const bad = ents.filter((e) => sample.text.slice(e.start, e.end) !== e.text);
say(`Elcsúszott pozíció: ${bad.length} / ${ents.length}`);

for (const label of ['person', 'org', 'place'] as const) {
  const uniq = [...new Set(ents.filter((e) => e.label === label).map((e) => e.text))];
  say(`\n  ${label} (${uniq.length}):\n    ${uniq.slice(0, 22).join(' | ')}`);
}

// A csapda: köznévi melléknév nem lehet személynév.
const traps = ['Nagy a kockázat', 'Kis összegű'];
say('\nCSAPDÁK:');
for (const trap of traps) {
  const pos = sample.text.indexOf(trap);
  if (pos < 0) { say(`  "${trap}" — nincs a szövegben`); continue; }
  const hit = ents.find((e) => e.label === 'person' && e.start >= pos && e.start < pos + trap.length);
  say(`  "${trap}" → ${hit ? `HIBA: "${hit.text}" névnek jelölve (${hit.score.toFixed(4)})` : 'RENDBEN, nem név'}`);
}

const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[]; given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));
const merged = detectParties(sample.text, { modelEntities: ents, homonyms });

const norm = (x: string): string => x.replace(/^((?:dr\.|ifj\.|id\.|özv\.)\s*)+/i, '').toLowerCase().trim();
const expected = sample.parties.map((p) => norm(p.canonical));
const found = merged.parties.map((p) => norm(p.fullName));
const hits = expected.filter((e) => found.some((f) => f === e || f.includes(e) || e.includes(f)));
say(`\n─── MODELL + SZERKEZET ───\n${merged.parties.length} fél, lefedettség ${hits.length}/${expected.length}`);
for (const p of merged.parties.slice(0, 16)) {
  say(`  ${p.confidence.toFixed(2)} ${p.fullName.padEnd(30)} ${p.kind.padEnd(7)} ${p.role.padEnd(15)} ${p.occurrences}×`);
}
const missed = expected.filter((e) => !found.some((f) => f === e || f.includes(e) || e.includes(f)));
if (missed.length) say(`KIMARADT: ${missed.join(' | ')}`);
say(`MEGTARTANDÓ: ${merged.keepList.map((k) => k.name).join(' | ')}`);

await ner.dispose();
writeFileSync('hubert-run.out.txt', out.join('\n'), 'utf8');
