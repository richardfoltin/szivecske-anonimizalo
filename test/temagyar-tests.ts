/**
 * SAJÁT NÉVKÉSZLET — az ellenőrző és a ragozó rész tesztje.
 *
 * A teszt a 2,7 GB-os névkészlet-gyártó modell NÉLKÜL fut. Nem kényelmi
 * döntés: a modell szerepe itt az, hogy neveket MOND, és pont ez az a rész,
 * amit nem tudunk számon kérni rajta — ugyanarra a témára holnap mást javasol.
 * Amit számon KELL kérni, az a program viselkedése a javaslattal: a rosszat
 * dobja ki, a jót ragozza végig, és mondja meg, hol tippelt.
 *
 * Ezért a bemenet egy BEÉGETETT, „modell által javasolt” válasz — a nyers
 * alakjában, gondolatmenettel és kódkerítéssel együtt, ahogy a gondolkodó
 * modelltől érkezne —, benne szándékos hibákkal. A teszt azt méri, hogy
 * mindegyik hibát a HELYES indokkal veti el.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIN_UTONEV_NEMENKENT,
  MIN_VEZETEKNEV,
  type ElutasitasOka,
  type NevJavaslat,
  ellenorizdAJavaslatokat,
  epitsdAJavaslatKerest,
  keszitsTemat,
  olvasdAJavaslatot,
  temaAzonosito,
} from '../src/app/temagyar.js';
import { ALL_CASES, type NameOverrides } from '../src/hu/inflect.js';
import type { SeedPerson } from '../src/hu/names.js';
import { type Theme, assignPseudonyms } from '../src/pseudonym.js';

const ROOT = process.cwd();

const hom = JSON.parse(readFileSync(join(ROOT, 'data/homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonimak = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

const nevKivetelek = (
  JSON.parse(readFileSync(join(ROOT, 'data/name-overrides.json'), 'utf8')) as {
    names: Record<string, NameOverrides>;
  }
).names;

let pass = 0;
const hibak: string[] = [];

function ell(felteves: boolean, leiras: string): void {
  if (felteves) pass++;
  else hibak.push(`  ${leiras}`);
}

/* ------------------------------------------------------------------ *
 *  A BEÉGETETT „MODELLVÁLASZ”
 * ------------------------------------------------------------------ */

/*
  A gondolatmenetben SZÁNDÉKOSAN van egy JSON tömb. Egy gondolkodó modell
  ilyet valóban ír — próbálgatja a formátumot —, és ha az értelmező az elsőre
  ülne rá, egyetlen név kerülne a készletbe. A teszt ezt is méri.
*/
const MODELLVALASZ = `<think>
A felhasználó görög mitológiát kért. Először kipróbálom a formátumot:
[{"form": "Nemez", "kind": "given", "gender": "F"}]
Ez így jó lesz. Most összeállítom a teljes listát.
</think>

Íme a névkészlet a megadott témához:

\`\`\`json
[
  {"form": "Akhilleusz", "kind": "given", "gender": "M"},
  {"form": "Poszeidón", "kind": "given", "gender": "M"},
  {"form": "Odüsszeusz", "kind": "given", "gender": "M"},
  {"form": "Perszeusz", "kind": "given", "gender": "M"},
  {"form": "Thészeusz", "kind": "given", "gender": "M"},
  {"form": "Menelaosz", "kind": "given", "gender": "M"},
  {"form": "Agamemnón", "kind": "given", "gender": "M"},
  {"form": "Prométheusz", "kind": "given", "gender": "M"},
  {"form": "Hüperión", "kind": "given", "gender": "M"},
  {"form": "Triton", "kind": "given", "gender": "M"},
  {"form": "Héraklész", "kind": "given", "gender": "M"},
  {"form": "Achilles", "kind": "given", "gender": "M"},
  {"form": "Kasszandra", "kind": "given", "gender": "F"},
  {"form": "Andromakhé", "kind": "given", "gender": "F"},
  {"form": "Perszephoné", "kind": "given", "gender": "F"},
  {"form": "Kalliopé", "kind": "given", "gender": "F"},
  {"form": "Euterpé", "kind": "given", "gender": "F"},
  {"form": "Melpomené", "kind": "given", "gender": "F"},
  {"form": "Néreisz", "kind": "given", "gender": "F"},
  {"form": "Galatea", "kind": "given", "gender": "F"},
  {"form": "Nauszikaa", "kind": "given", "gender": "F"},
  {"form": "Klütaimnésztra", "kind": "given", "gender": "F"},
  {"form": "Nüx", "kind": "given", "gender": "F"},

  {"form": "Olümposzi", "kind": "surname"},
  {"form": "Thébai", "kind": "surname"},
  {"form": "Argoszi", "kind": "surname"},
  {"form": "Ithakai", "kind": "surname"},
  {"form": "Mükénei", "kind": "surname"},
  {"form": "Spártai", "kind": "surname"},
  {"form": "Krétai", "kind": "surname"},
  {"form": "Trójai", "kind": "surname"},
  {"form": "Korinthoszi", "kind": "surname"},
  {"form": "Léthei", "kind": "surname"},
  {"form": "Sztüxi", "kind": "surname"},
  {"form": "Erebosz", "kind": "surname"},
  {"form": "Tartaroszi", "kind": "surname"},
  {"form": "Aigeuszi", "kind": "surname"},

  {"form": "Olümposz", "kind": "org"},
  {"form": "Delphoi", "kind": "org"},
  {"form": "Argosz", "kind": "org"},
  {"form": "Mükéné", "kind": "org"},
  {"form": "Ithaka", "kind": "org"},
  {"form": "Trója", "kind": "org"},
  {"form": "Korinthosz", "kind": "org"},

  {"form": "Olümposzfalva", "kind": "place"},
  {"form": "Thébahalom", "kind": "place"},
  {"form": "Argoszvár", "kind": "place"},
  {"form": "Ithakaszállás", "kind": "place"},
  {"form": "Mükénekő", "kind": "place"},

  {"form": "Kovács", "kind": "surname"},
  {"form": "János", "kind": "given", "gender": "M"},
  {"form": "Hádész (alvilág)", "kind": "given", "gender": "M"},
  {"form": "olümposzi", "kind": "surname"},
  {"form": "Ré", "kind": "given", "gender": "M"},
  {"form": "Khthonioszmegalopoliszi", "kind": "surname"},
  {"form": "Akhilleusz", "kind": "given", "gender": "M"},
  {"form": "Kasszandra", "kind": "surname"},
  {"form": "Hermész", "kind": "given"},
  {"form": "Nüx", "kind": "given", "gender": "M"},
  {"form": "Grrr", "kind": "org"}
]
\`\`\`

Remélem, megfelel a kérésnek.`;

/* ------------------------------------------------------------------ *
 *  1. A KÉRÉS ÉS A VÁLASZ ÉRTELMEZÉSE
 * ------------------------------------------------------------------ */

console.log('1. A modellnek szóló kérés és a válasz értelmezése');

const keres = epitsdAJavaslatKerest('görög mitológia');
ell(keres.includes('görög mitológia'), 'a kérésben benne van a beírt téma');
ell(keres.includes('MAGYAR HELYESÍRÁSSAL'), 'a kérés magyar helyesírást kér (Akhilleusz, nem Achilles)');
ell(
  epitsdAJavaslatKerest('csillagképek', 'given').includes('"given"'),
  'csoportonként is lehet kérni (rövidebb válasz, kevesebb elrontott JSON)',
);

const javaslatok = olvasdAJavaslatot(MODELLVALASZ);
console.log(`   ${javaslatok.length} javaslat olvasva ki a modell válaszából`);
ell(javaslatok.length > 50, `a teljes lista kiolvasva (${javaslatok.length} tétel)`);
ell(
  !javaslatok.some((j) => j.form === 'Nemez'),
  'a gondolatmenetbe ($<think>) írt próbatömb NEM került be a javaslatok közé',
);
ell(
  javaslatok.some((j) => j.form === 'Akhilleusz' && j.csoport === 'given' && j.gender === 'M'),
  'a mezők (form, kind, gender) helyesen olvasódtak ki',
);

// Magyarul megnevezett mezők és magyarul megadott nem: egy magyar kérésre a
// modell rendszeresen magyarul is felel.
const magyarMezok = olvasdAJavaslatot('[{"nev": "Szeleimosz", "fajta": "utónév", "nem": "férfi"}]');
ell(
  magyarMezok.length === 1 && magyarMezok[0]?.csoport === 'given' && magyarMezok[0]?.gender === 'M',
  'a magyarul megnevezett mezőket (nev/fajta/nem) is érti',
);
ell(
  olvasdAJavaslatot('[{"form": "Aphrodité", "kind": "given", "gender": "female"}]')[0]?.gender === 'F',
  'a „female” nem lesz férfi (mindkettő f-fel kezdődik)',
);
ell(
  olvasdAJavaslatot('Sajnálom, nem tudok segíteni.').length === 0,
  'a formátlan válaszból üres lista lesz, nem félreolvasott nevek',
);

/* ------------------------------------------------------------------ *
 *  2. A ROSSZ JAVASLATOK KIDOBÁSA
 * ------------------------------------------------------------------ */

console.log('\n2. Az ellenőrzés: melyik javaslat miért nem jó');

const eredmeny = keszitsTemat({
  temaSzoveg: 'görög mitológia',
  javaslatok,
  homonimak,
  nevKivetelek,
});
const jelentes = eredmeny.jelentes;

function elutasitasOka(form: string): ElutasitasOka | undefined {
  return jelentes.elutasitva.find((e) => e.form === form)?.ok;
}

const VART_ELUTASITAS: { form: string; ok: ElutasitasOka; miert: string }[] = [
  { form: 'Kovács', ok: 'valodi_nev', miert: 'Magyarország egyik leggyakoribb vezetékneve' },
  { form: 'János', ok: 'valodi_nev', miert: 'gyakori magyar utónév, nem köznév — a homonimafájlban nincs benne' },
  { form: 'Hádész (alvilág)', ok: 'nem_magyar_betuk', miert: 'zárójeles magyarázat ragadt a névhez' },
  { form: 'olümposzi', ok: 'nem_magyar_betuk', miert: 'kisbetűvel kezdődik' },
  { form: 'Ré', ok: 'tul_rovid', miert: 'két betű' },
  { form: 'Khthonioszmegalopoliszi', ok: 'tul_hosszu', miert: 'a szereplapon sem fér el' },
  { form: 'Akhilleusz', ok: 'ismetlodes', miert: 'másodszor is megérkezett' },
  { form: 'Kasszandra', ok: 'utonev_es_vezeteknev', miert: 'utónévként már szerepel' },
  { form: 'Hermész', ok: 'nem_nelkul', miert: 'utónév nem szerinti besorolás nélkül' },
  { form: 'Nüx', ok: 'ket_nemben', miert: 'egyszer női, egyszer férfi utónévként érkezett' },
  { form: 'Grrr', ok: 'nincs_maganhangzo', miert: 'magánhangzó nélkül nincs hangrend' },
];

for (const v of VART_ELUTASITAS) {
  const kapott = elutasitasOka(v.form);
  ell(kapott === v.ok, `„${v.form}” elutasítva mint ${v.ok} (${v.miert}) — kapott: ${kapott ?? 'ELFOGADVA'}`);
}

// Az üres nevet az értelmező már kiszűri, ezért közvetlenül adjuk be.
const uresProba = ellenorizdAJavaslatokat([{ form: '   ', csoport: 'org' }], homonimak);
ell(uresProba.elutasitva[0]?.ok === 'ures', 'az üres név elutasítva');

// Az indoklás magyar mondat, nem kód: a felhasználó ezt olvassa el.
ell(
  jelentes.elutasitva.every((e) => e.indoklas.length > 20 && e.indoklas.includes(' ')),
  'minden elutasításhoz magyar indoklás tartozik',
);

// A jót nem dobjuk ki: ez a másik hibafajta, és legalább ilyen fontos.
for (const jo of ['Akhilleusz', 'Kasszandra', 'Olümposzi', 'Olümposzfalva']) {
  ell(
    jelentes.elfogadva.some((n) => n.form === jo),
    `„${jo}” átment az ellenőrzésen`,
  );
}

console.log(
  `   ${jelentes.elfogadva.length} elfogadva, ${jelentes.elutasitva.length} elutasítva ` +
    `(${jelentes.javaslatokSzama} javaslatból)`,
);

/* ------------------------------------------------------------------ *
 *  3. A RAGOZÁS: MIND A 21 ALAK
 * ------------------------------------------------------------------ */

console.log('\n3. A ragozó motor: mind a 21 alak, névenként');

let teljesParadigma = 0;
for (const n of jelentes.elfogadva) {
  const hianyzo = ALL_CASES.filter((t) => !n.paradigma[t] || n.paradigma[t].length === 0);
  const nemRagozott = ALL_CASES.filter((t) => t !== 'NOM' && n.paradigma[t] === n.form);
  if (hianyzo.length === 0 && nemRagozott.length === 0) teljesParadigma++;
  else hibak.push(`  „${n.form}”: hiányzó alak ${hianyzo.join(',')} / ragozatlan ${nemRagozott.join(',')}`);
}
ell(
  teljesParadigma === jelentes.elfogadva.length,
  `mind a ${jelentes.elfogadva.length} elfogadott névnek megvan mind a 21 alakja`,
);

const akhilleusz = jelentes.elfogadva.find((n) => n.form === 'Akhilleusz');
ell(akhilleusz?.paradigma.INS === 'Akhilleusszal', `Akhilleusz + -val → ${akhilleusz?.paradigma.INS}`);
ell(akhilleusz?.paradigma.DAT === 'Akhilleusznak', `Akhilleusz + -nak → ${akhilleusz?.paradigma.DAT}`);
ell(akhilleusz?.mutatvany.length === 5, 'a felületnek szánt mutatvány öt jellemző alakot ad');
ell(
  akhilleusz?.mutatvany.every((m) => m.cimke.length > 0 && m.alak.length > 0) === true,
  'a mutatvány minden alakjához magyar megnevezés tartozik',
);

const olumposzi = jelentes.elfogadva.find((n) => n.form === 'Olümposzi');
ell(
  olumposzi?.mutatvany.some((m) => m.eset === 'WIFE') === true,
  'a vezetéknévnél az asszonynév (-né) is látszik: ebből lesz a fedőnév asszonyneve',
);

/* ------------------------------------------------------------------ *
 *  4. A HATÁR: HOL TIPPEL A PROGRAM
 * ------------------------------------------------------------------ */

console.log('\n4. Amit ki kell mondani: hol tippel a program');

function atnezendo(form: string): boolean {
  return jelentes.atnezendo.some((n) => n.form === form);
}

// „Héraklész”: a program mély toldalékot ad („Héraklésznak”), a helyes alak
// „Héraklésznek”. A név attól még jó — a felhasználónak kell látnia.
const heraklesz = jelentes.elfogadva.find((n) => n.form === 'Héraklész');
ell(heraklesz?.paradigma.DAT === 'Héraklésznak', `a motor mélyen ragoz: ${heraklesz?.paradigma.DAT}`);
ell(atnezendo('Héraklész'), '„Héraklész” átnézendőként jelölve (é-re végződő mély szó)');
ell(atnezendo('Andromakhé'), '„Andromakhé” átnézendőként jelölve');
ell(atnezendo('Nüx'), '„Nüx” átnézendőként jelölve (x: a kiejtett véghang dönt)');
ell(atnezendo('Achilles'), '„Achilles” átnézendőként jelölve (a ch kiejtése kétféle)');
ell(atnezendo('Olümposzfalva'), 'minden helységnév átnézendő (-on vagy -ban: lexikális)');

// A jól viselkedő neveket viszont NEM zavarjuk meg: ha mindenre figyelmeztetne,
// a figyelmeztetés semmit nem érne.
ell(!atnezendo('Akhilleusz'), '„Akhilleusz” nincs megjelölve — a ragozása szabályból következik');
ell(!atnezendo('Kasszandra'), '„Kasszandra” nincs megjelölve');
ell(
  !atnezendo('Olümposzi'),
  '„Olümposzi” nincs megjelölve — az i-re végződő mély szó a magyar szabály szerint mély marad',
);
ell(
  jelentes.elfogadva.find((n) => n.form === 'Olümposzi')?.notes.includes('semleges i') === true,
  '„Olümposzi” viszont kap megjegyzést a semleges i-ről (mint a szállított csomagokban)',
);

ell(jelentes.atnezendo.length > 0, `${jelentes.atnezendo.length} név vár átnézésre`);

// Ez az a kép, amit a felületnek ki kell raknia: név → ragozott alakok →
// magyar mondat arról, mit kell megnézni rajta.
console.log('   így néz ki, amit a felhasználó elé teszünk:');
for (const n of jelentes.atnezendo.filter((x) => x.csoport !== 'place').slice(0, 3)) {
  console.log(`     ${n.form}: ${n.mutatvany.map((m) => m.alak).join(', ')}`);
  console.log(`       ${n.notes}`);
}
ell(
  jelentes.figyelmeztetesek.some((f) => f.includes('KIEJTÉSEN')),
  'a figyelmeztetések kimondják, hogy a ragozás a kiejtésen múlhat',
);
ell(
  jelentes.figyelmeztetesek.some((f) => f.includes('védjegy')),
  'a figyelmeztetések kimondják, hogy a védjegyet a program nem tudja ellenőrizni',
);

/* ------------------------------------------------------------------ *
 *  5. A KÉSZ TÉMA: UGYANAZ A SZERKEZET, MINT A SZÁLLÍTOTTAKÉ
 * ------------------------------------------------------------------ */

console.log('\n5. A kész téma szerkezete és használhatósága');

const szallitott = JSON.parse(
  readFileSync(join(ROOT, 'data/themes/asvanyok.json'), 'utf8'),
) as Theme;

const tema = eredmeny.theme;
ell(tema !== null, 'a készlet használható, tehát elkészült a téma');

if (tema) {
  /*
    KULCSAZONOSSÁG HELYETT TARTALMAZÁS.

    A szállított csomagok azóta OPCIONÁLIS mezőket is hordoznak: `lang` és
    `family` (a magyar és az angol névsor összekapcsolásához), valamint
    `org_names` (kész cég- és intézménynevek a ragozási adatukkal). Ezeket a
    nyelvi modellből gyártott készlet nem tartalmazza, és nem is kell neki: a
    kiosztó mindhárom nélkül működik.

    Amit viszont továbbra is meg kell követelni — és ez a mérés valódi
    tartalma —, két dolog: a gyártott témában ott van minden KÖTELEZŐ mező,
    és nem hoz olyan mezőt, amit a szállított csomagok nem ismernek.
  */
  const KOTELEZO_MEZOK = [
    'id', 'name_hu', 'description_hu', 'license_note',
    'given_names', 'surnames', 'org_parts', 'place_names',
  ];
  const sajatKulcsok = Object.keys(tema).sort();
  const szallitottKulcsok = Object.keys(szallitott);
  const hianyzo = KOTELEZO_MEZOK.filter((k) => !sajatKulcsok.includes(k));
  ell(hianyzo.length === 0, `a téma minden kötelező mezője megvan (${sajatKulcsok.join(',')})`);
  const ismeretlen = sajatKulcsok.filter((k) => !szallitottKulcsok.includes(k));
  ell(ismeretlen.length === 0, `a téma nem hoz a szállítottakban ismeretlen mezőt (${ismeretlen.join(',')})`);

  ell(tema.id === 'sajat_gorog_mitologia', `az azonosító ékezet nélküli: ${tema.id}`);
  ell(tema.name_hu === 'Görög mitológia', `a megjelenített cím: ${tema.name_hu}`);
  ell(tema.license_note.length > 100, 'a licencmegjegyzés kitöltve és őszinte');

  const ferfi = tema.given_names.filter((g) => g.gender === 'M').length;
  const noi = tema.given_names.filter((g) => g.gender === 'F').length;
  ell(ferfi >= MIN_UTONEV_NEMENKENT, `${ferfi} férfi utónév (kell: ${MIN_UTONEV_NEMENKENT})`);
  ell(noi >= MIN_UTONEV_NEMENKENT, `${noi} női utónév (kell: ${MIN_UTONEV_NEMENKENT})`);
  ell(tema.surnames.length >= MIN_VEZETEKNEV, `${tema.surnames.length} vezetéknév (kell: ${MIN_VEZETEKNEV})`);
  ell(
    tema.given_names.every((g) => g.harmony !== undefined),
    'minden bejegyzésben ott a hangrend — futásidőben nincs találgatás',
  );
  ell(
    tema.place_names.every((p) => p.locative === 'sup'),
    'a helynevek alapértelmezett helyhatározót kapnak (-n)',
  );

  /*
    A LEGERŐSEBB MÉRÉS: a legyártott készletet ugyanaz a kiosztó kapja meg, ami
    a szállítottakat. Ha itt bármi nem stimmel a szerkezetben, ez az ág elszáll
    vagy üres álnevet ad — a fordító ezt nem venné észre.
  */
  const felek: SeedPerson[] = [
    { kind: 'person', id: 'p1', surname: 'Kovács', given: 'János', gender: 'M', role: 'felperes' },
    { kind: 'person', id: 'p2', surname: 'Szabó', given: 'Erzsébet', gender: 'F', role: 'alperes' },
    { kind: 'person', id: 'p3', surname: 'Nagy', given: 'Péter', gender: 'M', role: 'tanú' },
  ];
  const kiosztas = assignPseudonyms(felek, tema, { caseSecret: 'temagyar-teszt' });
  ell(kiosztas.size === 3, 'a kiosztó mindhárom félnek adott álnevet a saját készletből');

  const alnevek = felek.map((f) => kiosztas.get(f.id)?.display ?? '');
  console.log('   kiosztott álnevek:');
  for (let i = 0; i < felek.length; i++) {
    console.log(`     ${felek[i]?.surname} ${felek[i]?.given}  →  ${alnevek[i]}`);
  }

  const vezeteknevek = new Set(tema.surnames.map((s) => s.form));
  ell(
    alnevek.every((a) => a.length > 0 && vezeteknevek.has(a.split(' ')[0] ?? '')),
    'minden álnév vezetékneve a legyártott készletből való',
  );
  ell(new Set(alnevek).size === 3, 'a három fél három különböző álnevet kapott');

  // A nő női utónevet kap: ezért kellett a nemek elkülönülése.
  const noiNevek = new Set(tema.given_names.filter((g) => g.gender === 'F').map((g) => g.form));
  ell(
    noiNevek.has((alnevek[1] ?? '').split(' ')[1] ?? ''),
    `a női félnek női utónév jutott: ${alnevek[1]}`,
  );
}

/* ------------------------------------------------------------------ *
 *  6. A KEVÉS NÉV: NINCS FÉLKÉSZ KÉSZLET
 * ------------------------------------------------------------------ */

console.log('\n6. Ha kevés a név: nincs félkész készlet');

const keves: NevJavaslat[] = [
  { form: 'Akhilleusz', csoport: 'given', gender: 'M' },
  { form: 'Kasszandra', csoport: 'given', gender: 'F' },
  { form: 'Olümposzi', csoport: 'surname' },
];
const kevesEredmeny = keszitsTemat({ temaSzoveg: 'görög mitológia', javaslatok: keves, homonimak });
ell(kevesEredmeny.theme === null, 'kevés névből nem születik téma');
ell(!kevesEredmeny.jelentes.hasznalhato, 'a jelentés kimondja, hogy nem használható');
ell(
  kevesEredmeny.jelentes.hianyok.some((h) => h.kotelezo && h.csoport === 'surname'),
  'a jelentés megmondja, miből mennyi hiányzik',
);
ell(
  kevesEredmeny.jelentes.hianyok.every((h) => h.uzenet.length > 20),
  'a hiányokhoz magyar mondat tartozik, nem csak szám',
);

// A cégnév-előtag és a helységnév hiánya viszont nem végzetes: a kiosztónak van
// tartaléka mindkettőre.
ell(
  kevesEredmeny.jelentes.hianyok.some((h) => h.csoport === 'org' && !h.kotelezo),
  'a cégnév-előtag hiánya csak figyelmeztetés, nem akadály',
);

ell(temaAzonosito('  Csillagképek  ') === 'sajat_csillagkepek', 'az azonosító ékezet és szóköz nélküli');
ell(temaAzonosito('!!!') === 'sajat_nevkeszlet', 'értelmezhetetlen témából is lesz érvényes azonosító');

/* ------------------------------------------------------------------ *
 *  ÖSSZEGZÉS
 * ------------------------------------------------------------------ */

const osszes = pass + hibak.length;
console.log('');
if (hibak.length > 0) {
  console.log('HIBÁK:');
  for (const h of hibak) console.log(h);
  console.log('');
}
console.log(`Saját névkészlet: ${pass}/${osszes} ellenőrzés rendben`);
process.exit(hibak.length === 0 ? 0 : 1);
