/**
 * AZ ÁLNÉV EGYSZER DŐL EL — és attól kezdve a félhez tapad.
 *
 *   npx tsx test/alnev-allandosag.ts
 *
 * A kiosztás sorrendfüggő: a felek a megjelenés sorrendjében húznak a névsor
 * elejéről, KÖZÖS készletből. Emiatt egyetlen új fél felvétele átrendezte az
 * egész névsort — a felperes, akit az ügyvéd már „Kovakövi Frédi"-ként
 * ismert, egy kapcsoló átbillentésétől „Kőfej Benő" lett.
 *
 * Ez a legrosszabb fajta hiba ebben a programban: nem áll meg semmi, nem jön
 * hibaüzenet, a program dolgozik tovább — csak épp az irat, amit a
 * felhasználó az imént átnézett, már MÁS nevekkel áll a képernyőn. Aki
 * közben a kimenetet olvasta, joggal hiszi, hogy elromlott valami.
 *
 * A mérés ezért nem azt kérdezi, hogy KAPTAK-E nevet, hanem hogy UGYANAZT
 * kapták-e — a lista bővítése után is.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import type { PartyInput } from '../src/app/types.js';
import type { Assignment, Theme } from '../src/pseudonym.js';

const ROOT = process.cwd();
const theme = JSON.parse(readFileSync(join(ROOT, 'data/themes/asvanyok.json'), 'utf8')) as Theme;
const masikTheme = JSON.parse(
  readFileSync(join(ROOT, 'data/themes/kokorszak.json'), 'utf8'),
) as Theme;
const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonyms = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const alap: PartyInput[] = [
  { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
  { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
  { id: 'p3', kind: 'person', fullName: 'Szabó Márton', gender: 'M', role: 'II. r. alperes' },
  { id: 'p4', kind: 'person', fullName: 'Kiss Erika', gender: 'F', role: 'tanú' },
  { id: 'p8', kind: 'org', fullName: 'Aranykalász Agrár Kft.', gender: 'N', role: 'egyéb' },
];

/** A hivatalos szereplők — ezeket kapcsolja be-ki a beállító lap. */
const hivatalosak: PartyInput[] = [
  { id: 'h1', kind: 'person', fullName: 'dr. Sárközi Tamás', gender: 'M', role: 'egyéb' },
  { id: 'h2', kind: 'org', fullName: 'Szentendrei Járásbíróság', gender: 'N', role: 'szervezet' },
];

const src = join(ROOT, 'spike/out/keresetlevel.pdf');
const kozos = { themeId: theme.id, mode: 'theme' as const, caseSecret: 'allandosag-teszt' };

/*
  AZ ÜGY KIOSZTÁSA — ugyanúgy, ahogy a főfolyamat vezeti (electron/main.ts).

  Szándékosan ITT tartjuk, nem a munkamentben: az álnév az ügyé, nem egyetlen
  iraté. A mérés így pontosan azt az utat járja, amit a program — nem egy
  kényelmesebb változatát, ami a valóságban nem is fut le.
*/
let ugyKiosztas = new Map<string, Assignment>();
function elemez(s: DocumentSession, parties: PartyInput[], t: Theme = theme) {
  const res = s.analyze(
    { parties, themeId: t.id, mode: 'theme', caseSecret: kozos.caseSecret, keep: ugyKiosztas },
    t,
    homonyms,
  );
  for (const [id, a] of s.assignments) ugyKiosztas.set(id, a);
  return res;
}

/**
 * entityId → csereszöveg, a szereplapról.
 *
 * AZ AZONOSÍTÓK KIMARADNAK. Ők nem álnevet kapnak, hanem az adatfajta
 * megnevezését („[lakcím]"), és ez SZÁNDÉKOSAN ismétlődik: három fél három
 * lakcíme mind ugyanazt a címkét viseli. Egy egyediségre menő mérés rajtuk
 * mindig elbukna, pedig épp jól működnek.
 */
function nevek(s: ReturnType<DocumentSession['analyze']>): Map<string, string> {
  return new Map(s.cast.filter((c) => c.kind !== 'identifier').map((c) => [c.entityId, c.replacement]));
}
function elteres(a: Map<string, string>, b: Map<string, string>): string[] {
  const ki: string[] = [];
  for (const [id, nev] of a) {
    const uj = b.get(id);
    if (uj !== undefined && uj !== nev) ki.push(`${id}: ${nev} → ${uj}`);
  }
  return ki;
}

const s = await DocumentSession.open(src, homonyms);

// ── 1. kör: alaplista ──────────────────────────────────────────────────────
const a1 = elemez(s, alap);
const n1 = nevek(a1);
console.log('Kiosztás az alaplistával:');
for (const [id, nev] of n1) console.log(`   ${id.padEnd(4)} → ${nev}`);

// ── 2. kör: a hivatalos szereplők BEKAPCSOLVA ─────────────────────────────
const a2 = elemez(s, [...alap, ...hivatalosak]);
const n2 = nevek(a2);
const valtozott = elteres(n1, n2);
console.log('\nA hivatalos szereplők bekapcsolása után:');
for (const v of valtozott) console.log(`   MEGVÁLTOZOTT ${v}`);
check(
  'a hivatalos szereplők bekapcsolása nem írja át a meglévő álneveket',
  valtozott.length === 0,
  `${valtozott.length} változott`,
);
check(
  'az új szereplők is kaptak nevet',
  hivatalosak.every((h) => (n2.get(h.id) ?? '').trim().length > 0),
);

/*
  KÉT SZEREPLŐ NEM VISELHETI UGYANAZT AZ ÁLNEVET. A megtartott nevet ki kell
  venni a készletből — enélkül az új fél ugyanazt húzná, és a kimenetből nem
  lehetne megállapítani, melyikükről van szó. Ez rosszabb volna minden
  átrendeződésnél.
*/
const mind = [...n2.values()].filter((x) => x.trim().length > 0 && x !== '(nem cseréljük)');
check('nincs két azonos álnév', new Set(mind).size === mind.length, `${mind.length} névből ${new Set(mind).size} egyedi`);

// ── 3. kör: KIKAPCSOLVA, vissza az alaplistára ────────────────────────────
const a3 = elemez(s, alap);
const vissza = elteres(n1, nevek(a3));
check('kikapcsolás után is ugyanaz marad', vissza.length === 0, `${vissza.length} változott`);

// ── 4. kör: egy KÉZZEL felvett fél (jobb gombos menü) ─────────────────────
const keziLista: PartyInput[] = [
  ...alap,
  { id: 'k1', kind: 'org', fullName: 'Hármashatár Ingatlanforgalmazó Zrt.', gender: 'N', role: 'egyéb' },
];
const kezi = elteres(n1, nevek(elemez(s, keziLista)));
check('kézzel felvett fél sem írja át a többit', kezi.length === 0, `${kezi.length} változott`);

// ── 5. kör: KÉSZLETVÁLTÁS — itt MUSZÁJ változnia ──────────────────────────
/*
  A megtartás nem lehet feltétlen. Új névkészlet mellett a régi nevek a RÉGI
  készletből valók: megtartva az irat két készlet neveit keverné, és a
  felhasználó választása némán csak az új felekre hatna.
*/
// A készletváltáskor a főfolyamat ÜRÍTI a nyilvántartást (a kulcs része a
// készlet azonosítója) — a mérés ezt is úgy csinálja, ahogy ő.
ugyKiosztas = new Map();
const keszletValtas = elteres(n1, nevek(elemez(s, alap, masikTheme)));
check(
  'készletváltáskor VISZONT új nevek jönnek',
  keszletValtas.length > 0,
  `${keszletValtas.length} változott (ez a helyes)`,
);

// ── 6. kör: a KÉZI átírás nem tapad rá a félre ────────────────────────────
/*
  A kézzel beírt név a felhasználó ELEVEN döntése, nem a program kiosztása. Ha
  a megtartás átvenné, a mező KIÜRÍTÉSE némán hatástalan volna: a program
  visszatenné a törölt nevet, és semmi nem árulná el, miért nem történt semmi.
*/
ugyKiosztas = new Map();
const alapNevek = nevek(elemez(s, alap));
const keziNev = 'Vasvári Kőbányai';
const keziAtirt: PartyInput[] = alap.map((p) =>
  p.id === 'p1' ? { ...p, manualReplacement: keziNev } : p,
);
const n6 = nevek(elemez(s, keziAtirt));
check('a kézi átírás érvényre jut', n6.get('p1') === keziNev, `p1 → ${n6.get('p1')}`);

// …és most töröljük a kézi nevet: vissza kell térnie a program saját nevének
const n7 = nevek(elemez(s, alap));
check(
  'a kézi név TÖRLÉSE után visszatér a program saját neve',
  n7.get('p1') === alapNevek.get('p1'),
  `p1 → ${n7.get('p1')} (várt: ${alapNevek.get('p1')})`,
);
check(
  'a kézi név a többi félre sem ragadt rá',
  elteres(alapNevek, n7).length === 0,
  `${elteres(alapNevek, n7).length} változott`,
);


console.log(`\n${checks - failures}/${checks} rendben`);
process.exit(failures === 0 ? 0 : 1);
