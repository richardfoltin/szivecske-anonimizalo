/**
 * A KIJELÖLHETŐ SZÖVEGRÉTEG — rajta van-e a lapon, és rajta van-e a betűkön?
 *
 *   npx tsx test/szovegreteg.ts
 *
 * A PDF a felületen kép: a jobb gombos „jelöld ki, és mondd meg, minek
 * értelmezze" ezen a formátumon csak akkor működik, ha a kép fölé átlátszó,
 * kijelölhető szöveget fektetünk. A réteg csendben tud elromlani: ha a
 * geometria elcsúszik, a program továbbra is működőnek LÁTSZIK — csak épp a
 * felhasználó mást jelöl ki, mint amit a képen lát, és rossz szót vesz fel
 * félként.
 *
 * Ezért itt nem az a kérdés, hogy KELETKEZETT-E réteg, hanem hogy a
 * szakaszai a lapon belül vannak-e, van-e valódi szélességük, és hogy a
 * réteg a lap TELJES szövegét lefedi-e — egy kimaradt szakasz olyan mondat,
 * amit nem lehet kijelölni, és semmi nem szól róla.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentSession } from '../src/app/session.js';
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
];

let checks = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const s = await DocumentSession.open(join(ROOT, 'spike/out/keresetlevel.pdf'), homonyms);
const a = s.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt' }, theme, homonyms);
console.log(`Megnyitva: ${s.info.fileName} — ${s.info.pageCount} oldal`);

if (a.pages.length === 0) {
  console.log('\nNincs natív rajzoló, lapkép nélkül a réteg sem készül — a mérés kimarad.');
  process.exit(0);
}

const spans = a.textSpans ?? [];
check('készült szövegréteg', spans.length > 0, `${spans.length} szakasz`);

/*
  A RÉTEG A LAPON BELÜL VAN. Egy lapon kívülre csúszott szakasz a képernyőn
  NÉMÁN eltűnik (a `.page` levágja): a mondatot nem lehet kijelölni, és semmi
  nem árulja el, hogy ott volt.
*/
const kilog = spans.filter(
  (t) =>
    t.left < 0 ||
    t.top < 0 ||
    t.width <= 0 ||
    t.height <= 0 ||
    t.left + t.width > 1.02 ||
    t.top + t.height > 1.02,
);
check('minden szakasz a lapon belül van', kilog.length === 0, `${kilog.length} lóg ki`);

check(
  'minden szakasznak van szövege és betűmérete',
  spans.every((t) => t.text.trim().length > 0 && t.fontSize > 0),
);

const rosszOldal = spans.filter((t) => t.page < 0 || t.page >= a.pages.length);
check('minden szakasz létező oldalra mutat', rosszOldal.length === 0, `${rosszOldal.length} rossz`);

/*
  A RÉTEG A LAP TELJES SZÖVEGÉT LEFEDI.

  Ez a mérés lelke. A `previewText` a lapokból összefűzött szöveg; ha a
  rétegből kimaradna egy szakasz (mert például nulla szélességűnek számoltuk),
  a felhasználó azt a mondatot nem tudná kijelölni — és a hiányra semmi nem
  figyelmeztetne, hiszen a kép változatlanul mutatja.
*/
const retegben = spans.map((t) => t.text).join(' ');
const hianyzo = a.previewText
  .split(/\s{2,}|\n+/)
  .map((r) => r.trim())
  .filter((r) => r.length > 12)
  .filter((r) => !retegben.includes(r));
check('a réteg lefedi a lap szövegét', hianyzo.length === 0, `${hianyzo.length} kimaradt részlet`);
for (const h of hianyzo.slice(0, 3)) console.log(`      kimaradt: „${h.slice(0, 60)}"`);

/*
  A RÉTEG ÉS A KIEMELÉS UGYANARRÓL A SZÓRÓL UGYANAZT MONDJA.

  A kettő két külön számításból származik (`highlightFor` és `textSpans`), de
  ugyanabból a geometriából — ha elcsúsznak, a felhasználó a kiemelés mellé
  jelöl ki. Minden kiemeléshez kell lennie egy rétegszakasznak, ami ugyanazon a
  soron, függőlegesen átfedésben áll vele.
*/
const parositlan = a.highlights.filter(
  (h) =>
    !spans.some(
      (t) =>
        t.page === h.page &&
        t.top < h.top + h.height + 0.002 &&
        h.top < t.top + t.height + 0.002 &&
        t.left <= h.left + 0.01 &&
        h.left <= t.left + t.width + 0.01,
    ),
);
check(
  'minden kiemelés alatt van rétegszakasz',
  parositlan.length === 0,
  `${a.highlights.length} kiemelésből ${parositlan.length} párosítatlan`,
);

/* DOCX-en nincs lapkép, tehát réteg sem kell: ott a nézet magát a szöveget rajzolja. */
const d = await DocumentSession.open(join(ROOT, 'spike/out/keresetlevel.docx'), homonyms);
const da = d.analyze({ parties, themeId: theme.id, mode: 'theme', caseSecret: 'teszt' }, theme, homonyms);
check('DOCX-en nincs fölösleges réteg', (da.textSpans ?? []).length === 0);

console.log(`\n${checks - failures}/${checks} rendben`);
process.exit(failures === 0 ? 0 : 1);
