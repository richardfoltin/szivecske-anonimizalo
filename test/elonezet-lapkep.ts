/**
 * AZ ELŐNÉZET LAPKÉPE — tényleg az ÁLNEVESÍTETT iratot rajzoljuk-e ki?
 *
 *   npx tsx test/elonezet-lapkep.ts
 *
 * Ez a mérés egyetlen csendes hibára van kihegyezve, arra, ami ebben a
 * programban a leggyakoribb: a motor elkészül, a hívó viszont a RÉGI adatot
 * mutatja tovább, és semmi nem jelzi. Ha az `anonymizedPages` véletlenül az
 * eredeti bájtokat rajzolná ki (mert a `renderPdfPages` a `this.bytes`-ot
 * kapja, nem a kimenetét), a képernyőn minden rendben volna — csak épp a
 * valódi nevek néznének vissza a felhasználóra az „Előnézet — ez kerül a
 * fájlba" felirat alatt. Ezért a döntő ellenőrzés nem az, hogy KELETKEZETT-E
 * lapkép, hanem hogy MÁS-E, mint az eredetié.
 *
 * A kiemelések geometriáját is itt mérjük: a lapon kívülre csúszó téglalap a
 * képernyőn néma marad (a `.page` levágja), tehát csak számban látszana.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
import { matchOutcome } from '../src/app/types.js';
import type { PartyInput } from '../src/app/types.js';
import type { Theme } from '../src/pseudonym.js';

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
  { id: 'p3', kind: 'person', fullName: 'Szabó Márton', gender: 'M', role: 'II. r. alperes' },
  { id: 'p4', kind: 'person', fullName: 'Kiss Erika', gender: 'F', role: 'tanú' },
  { id: 'p8', kind: 'org', fullName: 'Aranykalász Agrár Kft.', gender: 'N', role: 'egyéb' },
];

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const src = join(ROOT, 'spike/out/keresetlevel.pdf');
const s = await DocumentSession.open(src, homonyms);
const a = s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt' }, theme, homonyms);
console.log(`Megnyitva: ${s.info.fileName} — ${s.info.pageCount} oldal, ${a.matches.length} találat`);

// A lapkép a natív rajzolón múlik. Ha az hiányzik, a felület a szöveges
// előnézetre esik vissza — ilyenkor ez a mérés nem tud mit mondani, és ezt ki
// is mondja, ahelyett hogy zöldre váltana.
if (a.pages.length === 0) {
  console.log('\nNincs natív rajzoló (pdf-to-img), a lapkép nem készül el — a mérés kimarad.');
  process.exit(0);
}

const elonezet = await s.anonymizedPages();

check('készült lapkép az előnézethez', elonezet.pages.length > 0, `${elonezet.pages.length} oldal`);
check(
  'annyi oldal, mint az eredetiben',
  elonezet.pages.length === a.pages.length,
  `${elonezet.pages.length} / ${a.pages.length}`,
);

/*
  A DÖNTŐ ELLENŐRZÉS: az első oldal képe MÁS, mint az eredetié.

  A keresetlevél első oldalán a felperes neve áll, tehát ott biztosan van
  csere — ha a két kép bájtra azonos, akkor az „álnevesített előnézet" az
  eredeti iratot mutatja.
*/
const elsoEredeti = a.pages[0]?.dataUrl ?? '';
const elsoElonezet = elonezet.pages[0]?.dataUrl ?? '';
check(
  'az első oldal képe eltér az eredetiétől',
  elsoElonezet.length > 0 && elsoElonezet !== elsoEredeti,
  `eredeti ${elsoEredeti.length} b, előnézet ${elsoElonezet.length} b`,
);

// Kiemelés: minden lecserélt találatra jusson jelölés, és mind a lapon belül.
// A CSERE FOGALMÁT A MOTORTÓL KÉRDEZZÜK. A `decision === 'accept'` csak a
// kézi döntést jelenti; az automatikusan elfogadott találat mezője üres, és
// egy ilyen összeszámolás nullát adna egy 45 cserét tartalmazó iraton.
const csereDb = a.matches.filter((m) => matchOutcome(m) === 'csere' && m.replacement).length;
check('van kiemelés az előnézeten', elonezet.highlights.length > 0, `${elonezet.highlights.length} db`);
check(
  'nem több kiemelés, mint amennyi csere',
  elonezet.highlights.length <= csereDb,
  `${elonezet.highlights.length} kiemelés / ${csereDb} csere`,
);

const kilog = elonezet.highlights.filter(
  (h) =>
    h.left < 0 ||
    h.top < 0 ||
    h.width <= 0 ||
    h.height <= 0 ||
    h.left + h.width > 1.001 ||
    h.top + h.height > 1.001,
);
check('minden kiemelés a lapon belül van', kilog.length === 0, `${kilog.length} lóg ki`);

const idk = new Set(a.matches.map((m) => m.id));
const arva = elonezet.highlights.filter((h) => !idk.has(h.matchId));
check('minden kiemelés létező találatra mutat', arva.length === 0, `${arva.length} árva`);

// Az oldalszám a lapok tartományában marad — különben a jelölés olyan oldalra
// kerülne, ami nincs, és némán eltűnne.
const rosszOldal = elonezet.highlights.filter(
  (h) => h.page < 0 || h.page >= elonezet.pages.length,
);
check('minden kiemelés létező oldalra mutat', rosszOldal.length === 0, `${rosszOldal.length} rossz`);

/*
  AZ ELŐNÉZET NEM ÍR LEMEZRE. A mentés külön út, saját ellenőrző körrel; ha az
  előnézet mellékesen fájlt hagyna maga után, az a kör kimaradna belőle.
*/
const { existsSync } = await import('node:fs');
const nemVartFajl = join(ROOT, 'spike/out/keresetlevel-elonezet.pdf');
check('az előnézet nem hagyott fájlt a lemezen', !existsSync(nemVartFajl));

console.log(`\n${checks - failures}/${checks} rendben`);
process.exit(failures === 0 ? 0 : 1);
