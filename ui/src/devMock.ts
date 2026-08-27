/**
 * Fejlesztői helyettesítő adat.
 *
 * Csak akkor lép életbe, ha a felület NEM az alkalmazásban fut (böngészőben,
 * `vite` alatt). Így a formanyelvet és az elrendezést lehet nézegetni anélkül,
 * hogy az egész programot el kellene indítani. Az alkalmazásban ez a kód soha
 * nem fut le, mert ott a hidat a főfolyamat adja.
 */

import type {
  AnalysisResult,
  DocumentInfo,
  ExportResult,
  PartyInput,
} from '../../src/app/types.js';
import type {
  AblakkeretAllapot,
  DetectProgress,
  DetectionResult,
  EllenorzottNev,
  FelismeresSzakasz,
  IratBeallitas,
  MenuAction,
  DownloadProgress,
  ModelStatus,
  MutatvanyAlak,
  TemaEredmeny,
  TemaGenStatus,
  ThemeSummaryUi,
  UiState,
  UpdateProgress,
  UpdateState,
} from './api';

/**
 * A menü gyorsbillentyűi, ahogy az alkalmazásban is szólnak.
 *
 * A frissítés és a „A programról" szándékosan nincs köztük: azoknak az
 * alkalmazásban sincs gyorsbillentyűjük, a menüsor pedig böngészőben nincs.
 * A `?dev=update` viszont közvetlenül megnyitja az ablakot — lásd `devPreset`.
 */
const MENU_KEYS: Record<string, MenuAction> = { o: 'open', s: 'save', p: 'print' };

/*
  A SZÁLLÍTOTT NÉVKÉSZLETEK, ahogy a motor összefoglalója adja őket.

  A sorok a `data/themes/*.json` fájlokból származnak, ugyanazzal a
  számítással, amit az `electron/main.ts` `themeSummaries()` függvénye végez
  — a `sample` tehát vezetéknév + utónév párokból áll, az első háromból.

  MIND A NYOLC BENNE VAN, a négy angol kiadás is. A kártya nyelvkapcsolója
  abból lesz, hogy egy témának két nyelvi változata van; ha innen kimaradnának
  az `_en` készletek, a böngészős előnézetben a kapcsoló meg sem jelenne, és
  pont az az ág maradna kipróbálatlan, ami a legfrissebb.
*/
const THEMES: ThemeSummaryUi[] = [
  {
    id: 'asvanyok',
    name: 'Kövek és ásványok',
    description:
      'Ásvány-, kőzet- és drágakőnevek magyar névsorrendbe rendezve: az utónevek maguk az ásványnevek (Bazalt, Gránit, Ametiszt, Borostyán), a vezetéknevek pedig belőlük képzett, magyaros -s és -i képzős, illetve összetett alakok (Kvarcos, Mészpáti, Csillámkő). Komoly, szikár hangzású csomag, amely peres iratban is jól olvasható, mégis azonnal látszik róla, hogy álnév.',
    licenseNote: 'Ásvány-, kőzet- és drágakőnevek: köznyelvi szakszavak, nem állnak szerzői jogi vagy védjegyoltalom alatt, semmilyen franchise-hoz nem kötődnek. A vezetéknevek saját képzésűek (-s, -i, -kő utótag), nem valós magyar cégnevek másolatai. A gyakori valós magyar vezetéknévvé vált alakokat (Gyöngyösi, Kőbányai) szándékosan kihagytuk, hogy a pszeudonim ne ütközzön valós féllel vagy létező céggel.',
    givenCount: 26,
    surnameCount: 29,
    sample: ['Kvarcos Bazalt', 'Palás Gránit', 'Márványi Obszidián'],
  },
  {
    id: 'asvanyok_en',
    name: 'Kövek és ásványok – angol nevek',
    description:
      'A „Kövek és ásványok” készlet angol névsora. Az utónevek angol ásvány- és drágakőnevek (Flint, Jasper, Amber, Jade), a vezetéknevek belőlük épített, angolosan hangzó összetételek (Flintwood, Cragmoor, Stonehill). Magyar iratba való: minden név magyar toldalékot kap, a KIEJTÉSE szerint — Flinttel, Onyxszal, Jade-del, Willow-val.',
    licenseNote: 'Az utónevek angol köznyelvi szavak és anyakönyvezhető angol utónevek, a vezetéknevek és a helységnevek saját képzésű összetételek az angol névadás szokásos utótagjaiból (-ford, -wood, -wick, -moor). Egyik sem valós, azonosítható személy neve, és egyik sem védjegy. A cégformák (Kft., Zrt., Bt.) és az intézménymegjelölések magyarok, mert a pszeudonim magyar iratba kerül. A ragozási kivételeket — kiejtés szerinti hangrend, néma véghangzó, kötőjeles kapcsolás — alakonként ember ellenőrizte a program ragozó motorjával.',
    givenCount: 20,
    surnameCount: 18,
    sample: ['Flintwood Flint', 'Stonebrook Jasper', 'Quarrington Garnet'],
  },
  {
    id: 'kokorszak',
    name: 'Kőkorszak',
    description:
      'A „Frédi és Béni, avagy a két kőkorszaki szaki” szereplőinek HIVATALOS magyar szinkronnevei: Kovakövi Frédi, Kavicsi Béni, Kőkobaki, Márga, Bazalt, Borzadály. A nevek az MTV 1969-es (magyar szöveg: Romhányi József) és a 2004–2006-os (Speier Dávid) sorozatszinkronjából valók; az 1994-es élőszereplős film („Flintstone Frédi”, „Dorongi Béni”) és a Kőkorszaki buli eltérő névkészletéből szándékosan nincs benne semmi, mert ott más a vezetéknév. 16 vezetéknév × 23 utónév = 368 teljes névpár, ezért egy sokszereplős iratban sem kell számozott utótaghoz nyúlni. Minden név magyar toldalékot kap; a hangrend és a rendhagyó alakok (Kőfejet, Stupidill-lal, Borzadállyal, Daisyvel) előre ki vannak töltve, futásidőben nincs találgatás.',
    licenseNote: 'A NEVEK VÉDJEGYZETT MŰBŐL SZÁRMAZNAK — ez nem tiltás, hanem tény, hogy később se érje meglepetés azt, aki a csomagot továbbadja. A The Flintstones (magyarul „Frédi és Béni, avagy a két kőkorszaki szaki”) a Hanna-Barbera, ma a Warner Bros. Discovery műve; a cím, a szereplőnevek és a figurák védjegy- és szerzői jogi oltalom alatt állnak, a magyar szöveg Romhányi József, illetve Speier Dávid műfordítói teljesítménye. Saját, belső anonimizáláshoz ez a névhasználat rendszerint nem kifogásolható; nyilvánosan terjesztett vagy értékesített termékben a jogosult engedélye nélkül igen. Ha ez kockázat, a másik három szállított készlet (Ásványok, Növények, Semleges magyar) egyetlen védett nevet sem tartalmaz. Amit a forráskutatás BIZONYTALANNAK jelölt — a Kőkalap- és Borzadály-család egyes tagjainak magyar neve, a város magyar neve („Alapkő”, „Kőlapály”), a cégnevek magyar alakja —, az szándékosan kimaradt. A cég- és intézménynevek megkülönböztető előtagja hivatalos szereplőnév; az egyetlen adatolt magyar szervezetnév az „Ökör-kör” (két magyar epizódcímből). A cégforma (Kft., Zrt., Bt.) és az intézménymegjelölés magyar, mert az álnév magyar iratba kerül. A helységnevek közül csak a „Bedrock” adatolt, a többi a hivatalos szereplőnevekből képzett, kitalált alak. FIGYELEM: az utónevek java része (Vilma, Irma, Béla, Dénes, Oszkár, Anna) hétköznapi magyar keresztnév — a régi, kitalált készlettel ellentétben ez a csomag nem garantálja, hogy az álnév első pillantásra felismerhetően kitalált.',
    givenCount: 23,
    surnameCount: 16,
    sample: ['Kovakövi Frédi', 'Kavicsi Béni', 'Kőkobaki Benő'],
  },
  {
    id: 'kokorszak_en',
    name: 'Kőkorszak – angol nevek',
    description:
      'A „Kőkorszak” készlet angol névsora: a The Flintstones EREDETI, angol szereplőnevei — Flintstone, Rubble, Slate, Rockhead, Hatrock, Slaghoople, Quartz. 19 vezetéknév × 25 utónév = 475 teljes névpár. Magyar iratba való: minden név magyar toldalékot kap, a KIEJTÉSE szerint, nem az írásképe szerint — Flintstone-nal, Rubble-lal, Slate-tel, Quartzcal, Bettyvel, Pebblesszel.',
    licenseNote: 'A NEVEK VÉDJEGYZETT MŰBŐL SZÁRMAZNAK — ez nem tiltás, hanem tény, hogy később se érje meglepetés azt, aki a csomagot továbbadja. A The Flintstones a Hanna-Barbera, ma a Warner Bros. Discovery műve; a cím, a szereplőnevek és a figurák védjegy- és szerzői jogi oltalom alatt állnak. Saját, belső anonimizáláshoz ez a névhasználat rendszerint nem kifogásolható; nyilvánosan terjesztett vagy értékesített termékben a jogosult engedélye nélkül igen. Ha ez kockázat, a másik három szállított készlet (Ásványok, Növények, Semleges magyar) egyetlen védett nevet sem tartalmaz. Az 1994-es élőszereplős film külön névkészletéből (Vandercave, Dictabird) nincs benne semmi. A cégformák (Kft., Zrt., Bt.) és az intézménymegjelölések magyarok, mert a pszeudonim magyar iratba kerül; a megkülönböztető előtagok a sorozat angolul dokumentált cég-, intézmény- és helynevei. A ragozási kivételeket — kiejtés szerinti hangrend, néma szó végi e, kötőjeles kapcsolás, az x/tz/y hangértéke — alakonként ember ellenőrizte a program ragozó motorjával.',
    givenCount: 25,
    surnameCount: 19,
    sample: ['Flintstone Fred', 'Rubble Barney', 'Slate Bamm-Bamm'],
  },
  {
    id: 'novenyek',
    name: 'Növények',
    description:
      'Növénynevekből épített névcsomag: az utónevek fűszer-, cserje- és virágnevek (Zsálya, Boróka, Bors, Kőris, Pipacs), a vezetéknevek pedig magyaros képzésű, létező mintát követő alakok (Kökényes, Somfai, Borókás, Bükkfai). Lágy, semleges hangulatú, ezért hosszú, sok szereplős iratban is kellemesen olvasható, miközben a növény-vezetéknév + növény-utónév párosítás azonnal elárulja, hogy álnévről van szó.',
    licenseNote: 'Növény-, fa- és fűszernevek: köznyelvi magyar szavak, nem védettek, nem franchise-eredetűek. A vezetéknevek magunk képezte alakok a szokásos magyar vezetéknévképzőkkel (-s, -i, -falvi, -fai). A Kandelábert szándékosan kihagytuk: nem növény, hanem kandeláber (utcai lámpaoszlop), és a csomagban zavaró lenne. A valóban gyakori növényi eredetű magyar vezetékneveket (Rózsa, Virág, Fenyő) kerültük, hogy a pszeudonim ne ütközzön valós féllel.',
    givenCount: 24,
    surnameCount: 29,
    sample: ['Somfa Ciprus', 'Somfai Som', 'Borókás Tárnics'],
  },
  {
    id: 'novenyek_en',
    name: 'Növények – angol nevek',
    description:
      'A „Növények” készlet angol névsora. Az utónevek angol fa-, fűszer- és virágnevek (Hazel, Willow, Juniper, Saffron), a vezetéknevek belőlük épített, angolosan hangzó összetételek (Willowbrook, Nettleford, Birchwood). Magyar iratba való: minden név magyar toldalékot kap, a KIEJTÉSE szerint — Birchcsel, Hollyval, Willow-val.',
    licenseNote: 'Az utónevek angol köznyelvi szavak és anyakönyvezhető angol utónevek, a vezetéknevek és a helységnevek saját képzésű összetételek az angol névadás szokásos utótagjaiból (-ford, -wood, -wick, -moor). Egyik sem valós, azonosítható személy neve, és egyik sem védjegy. A cégformák (Kft., Zrt., Bt.) és az intézménymegjelölések magyarok, mert a pszeudonim magyar iratba kerül. A ragozási kivételeket — kiejtés szerinti hangrend, néma véghangzó, kötőjeles kapcsolás — alakonként ember ellenőrizte a program ragozó motorjával.',
    givenCount: 20,
    surnameCount: 16,
    sample: ['Thornfield Sorrel', 'Willowbrook Juniper', 'Elmsford Alder'],
  },
  {
    id: 'semleges_magyar',
    name: 'Semleges magyar nevek',
    description:
      'Hétköznapi, feltűnésmentes magyar nevek: olyan iratokhoz, amelyeknek anonimizálás után is teljesen normálisan kell olvasódniuk (bírósági beadvány, szerződéstervezet, oktatási anyag). Szándékosan unalmas. A vezetéknevek a leggyakoribb harminc magyar családnéven kívülről valók (nincs Nagy, Kovács, Tóth, Szabó, Horváth), az utónevek pedig a ma leggyakoribb utónevek listáján kívüli, mégis teljesen szokványos nevek – így kicsi az esélye, hogy az álnév véletlenül egybeessen az irat valamelyik valós szereplőjével.',
    licenseNote: 'Puszta magyar utó- és vezetéknevek: nevek önmagukban nem állnak szerzői jogi vagy védjegyoltalom alatt, szabadon használhatók. A csomagból tudatosan kimaradtak a leggyakoribb családnevek (ütközési kockázat) és a közismert személyekhez erősen kötődő nevek (pl. Illyés, Egressy, Balassa). Fontos korlát: mivel ezek valós magyar nevek, egy adott néven létezhet valós személy – ez a csomag statisztikai ütközéscsökkentést ad, nem garanciát; ahol az irat olvasójának biztosan látnia kell, hogy álnévről van szó, a másik három csomag ajánlott.',
    givenCount: 25,
    surnameCount: 28,
    sample: ['Aranyi Bertalan', 'Dobrai Kálmán', 'Csanádi Tivadar'],
  },
  {
    id: 'semleges_magyar_en',
    name: 'Semleges angol nevek',
    description:
      'A „Semleges magyar nevek” készlet angol párja: hétköznapi, feltűnésmentes angol nevek olyan iratokhoz, amelyeknek anonimizálás után is normálisan kell olvasódniuk. Szándékosan unalmas. Magyar iratba való: minden név magyar toldalékot kap, a KIEJTÉSE szerint — Bruce-szal, Wrighttal, Meredithtel, Barlow-val.',
    licenseNote: 'Az utónevek angol köznyelvi szavak és anyakönyvezhető angol utónevek, a vezetéknevek és a helységnevek saját képzésű összetételek az angol névadás szokásos utótagjaiból (-ford, -wood, -wick, -moor). Egyik sem valós, azonosítható személy neve, és egyik sem védjegy. A cégformák (Kft., Zrt., Bt.) és az intézménymegjelölések magyarok, mert a pszeudonim magyar iratba kerül. A ragozási kivételeket — kiejtés szerinti hangrend, néma véghangzó, kötőjeles kapcsolás — alakonként ember ellenőrizte a program ragozó motorjával.',
    givenCount: 20,
    surnameCount: 19,
    sample: ['Wright Bruce', 'Ashford Edwin', 'Barlow Gordon'],
  },
];

const DOC: DocumentInfo = {
  path: 'C:\\Iratok\\keresetlevel.pdf',
  fileName: 'keresetlevel.pdf',
  format: 'pdf',
  pageCount: 3,
  charCount: 5559,
  looksScanned: false,
  pendingRevisions: 0,
  /*
    SZÁNDÉKOSAN NEM ÜRES. Ez a mező a motorban régóta megvan, de üresen sosem
    látszott a felületen — pedig épp ez az a mondat, amitől a „nem találtam
    nevet" és a „nem is láttam a szöveget" különbsége kiderül. Ha itt üres lista
    állna, a felület legfontosabb figyelmeztetése böngészőben sosem jelenne meg,
    és a következő fejlesztő nem tudná, hogy meg kell jelenítenie.
  */
  loadWarnings: [
    'A 2. oldalon 1 betűkészlethez nincs használható ToUnicode tábla, ezért 214 karaktert nem ' +
      'tudtunk elolvasni. Az ezekkel szedett szöveget a program NEM LÁTJA: ha név van benne, nem ' +
      'talál rá és nem is cseréli ki. Érintett betűkészlet: ABCDEE+TimesNewRoman.',
    'A 3. oldalon 1 beágyazott tartalomrészt (Form XObject) kihagytunk — körkörös vagy túl mély ' +
      'hivatkozás. Az ezekben lévő szöveget nem néztük át.',
  ],
};

/*
  KÉT SZÖVEG, MERT KÉT KÜLÖNBÖZŐ DOLOGRÓL VAN SZÓ.

  Az `AnalysisResult.previewText` az EREDETI irat szövege — ezen áll a bal
  oldali nézet, ezen ülnek a találatok, és ebben a szövegben még a VALÓDI nevek
  szerepelnek. A híd `previewText()` pontja ezzel szemben az ÁLNEVESÍTETT
  szöveget adja: azt, ami a fájlba kerül.

  Az álkimenet eddig ugyanazt az egy (álnevesített) szöveget adta mindkettőre.
  Ettől a fejlesztői belépőn a „Eredeti — kiemelve" nézet is a kész álneveket
  mutatta, a találatok felszíni alakja pedig sehol nem szerepelt benne — vagyis
  pont az nem látszott, amit a felület átnézésekor nézni akarunk.
*/
const TEXT = `Szentendrei Járásbíróság
12.P.20.845/2026/8.

Tárgy: keresetlevél kölcsön visszafizetése iránt

Alulírott dr. Sárközi Tamás ügyvéd mint Kovács János felperes meghatalmazott jogi képviselője a Pp. 170. §-a alapján az alábbi keresetlevelet terjesztem elő Nagy Péter I. rendű alperessel és Szabó Márton II. rendű alperessel szemben.

Felperes: Kovács János
lakcím: 2000 Szentendre, Bükkös part 14.
e-mail: kovacs.janos58@freemail.hu

I. rendű alperes: Nagy Péter
anyja neve: Fehér Ilona

Kérem a Tisztelt Bíróságot, hogy kötelezze Nagy Pétert és Szabó Mártont egyetemlegesen 3 550 000 Ft tőke megfizetésére.

Nagy összegű, több évre szóló beruházásról volt szó, ezért a felek külön is rögzítették a részleteket.

A felek 2025. március 14. napján Szentendrén kölcsönszerződést kötöttek. A felperes Szabóval korábban is állt üzleti kapcsolatban. A banki kivonat közlemény rovatában rendre „K. J. kölcsön" megjelölés szerepelt.

A szerződést Szabó ellenjegyezte, majd átadta a feleknek. A kölcsön összegét Szabónak utalta át a felperes. Tanúként Kiss Erika és ifj. Kőpát Bazalt írta alá.

dr. Bach Tivadar s. k. bíró`;

/** UGYANEZ ÁLNEVESÍTVE — ezt adja a híd `previewText()` pontja. */
const ANON_TEXT = `Szentendrei Járásbíróság
12.P.20.845/2026/8.

Tárgy: keresetlevél kölcsön visszafizetése iránt

Alulírott dr. Sárközi Tamás ügyvéd mint Kvarcos Tűzkő felperes meghatalmazott jogi képviselője a Pp. 170. §-a alapján az alábbi keresetlevelet terjesztem elő Palás Jáspis I. rendű alperessel és Ónixos Opál II. rendű alperessel szemben.

Felperes: Kvarcos Tűzkő
lakcím: 2000 Szentendre, Bükkös part 14.
e-mail: kvarcos.tuzko58@freemail.hu

I. rendű alperes: Palás Jáspis
anyja neve: Csillámos Kalcit

Kérem a Tisztelt Bíróságot, hogy kötelezze Palás Jáspist és Ónixos Opált egyetemlegesen 3 550 000 Ft tőke megfizetésére.

A felek 2025. március 14. napján Szentendrén kölcsönszerződést kötöttek. Kvarcos Tűzkő 4 800 000 Ft kölcsönt adott Palás Jáspisnak. A szerződést készfizető kezesként Ónixos Opál írta alá, tanúként Kőzeti Korall és ifj. Kőpát Bazalt.`;

const CAST: AnalysisResult['cast'] = [
  { entityId: 'p1', original: 'Kovács János', replacement: 'Kvarcos Tűzkő', kind: 'person', role: 'felperes', gender: 'M', occurrences: 14, pendingCount: 0, manual: false, skipped: false },
  { entityId: 'p2', original: 'Nagy Péter', replacement: 'Palás Jáspis', kind: 'person', role: 'I. r. alperes', gender: 'M', occurrences: 16, pendingCount: 2, manual: false, skipped: false },
  { entityId: 'p3', original: 'Szabó Márton', replacement: 'Ónixos Opál', kind: 'person', role: 'II. r. alperes', gender: 'M', occurrences: 9, pendingCount: 1, manual: false, skipped: false },
  { entityId: 'p4', original: 'Kiss Erika', replacement: 'Kőzeti Korall', kind: 'person', role: 'tanú', gender: 'F', occurrences: 6, pendingCount: 0, manual: false, skipped: false },
  { entityId: 'p5', original: 'Baloghné Fehér Ilona', replacement: 'Mészpátiné Csillámos Kalcit', kind: 'person', role: 'tanú', gender: 'F', occurrences: 4, pendingCount: 0, manual: false, skipped: false },
  { entityId: 'p6', original: 'Aranykalász Agrár Kft.', replacement: 'Obszidián Agrár Kft.', kind: 'org', role: 'alperes társasága', gender: 'N', occurrences: 3, pendingCount: 0, manual: false, skipped: false },
];

/**
 * A TALÁLAT HELYE AZ ÁLKIMENET SZÖVEGÉBEN.
 *
 * A motor a pozíciót mérésből ismeri (`MatchRow.previewStart`); itt ki kell
 * számolni, különben a szöveges nézet — ami épp ezekre a pozíciókra épül — a
 * fejlesztői belépőn üresen maradna, és a felület átnézésekor pont az nem
 * látszana, amit átnézni akarunk. A sokadik előfordulást is meg tudjuk adni:
 * ugyanaz a vezetéknév több helyen is találat.
 */
function hol(kereses: string, jelolt: string = kereses): { previewStart: number; previewEnd: number } {
  // A KERESETT és a MEGJELÖLT szöveg elválik, ahol a felszíni alak önmagában
  // sokszor előfordul: a „Nagy" vezetéknevet a „Nagy összegű" szókapcsolattal
  // találjuk meg, de csak a nevet jelöljük meg belőle.
  const poz = TEXT.indexOf(kereses);
  // A -1 (nincs a szövegben) érvénytelen tartomány: a nézet eldobja, nem
  // jelöl meg vele egy véletlen szövegdarabot a fájl elején.
  return { previewStart: poz, previewEnd: poz < 0 ? -1 : poz + jelolt.length };
}

const MATCHES: AnalysisResult['matches'] = [
  { id: 0, entityId: 'p1', surface: 'Kovács János', replacement: 'Kvarcos Tűzkő', reason: 'teljes név', confidence: 1, disposition: 'auto', page: 0, context: '…mint ⟦Kovács János⟧ felperes meghatalmazott jogi…', ...hol('Kovács János') },
  { id: 1, entityId: 'p2', surface: 'Nagy Pétert', replacement: 'Palás Jáspist', reason: 'teljes név, tárgyeset', confidence: 1, disposition: 'auto', page: 0, context: '…kötelezze ⟦Nagy Pétert⟧ és Szabó Mártont egyetemlegesen…', ...hol('Nagy Pétert') },
  { id: 2, entityId: 'p1', surface: 'kovacs.janos58@freemail.hu', replacement: 'kvarcos.tuzko58@freemail.hu', reason: 'névrészlet azonosítóba ágyazva (surname, given)', confidence: 0.9, disposition: 'auto', page: 0, context: '…e-mail: ⟦kovacs.janos58@freemail.hu⟧…', ...hol('kovacs.janos58@freemail.hu') },
  { id: 3, entityId: 'p2', surface: 'Nagy', replacement: 'Palás', reason: 'csak vezetéknév — köznévvel azonos alakú — mondat elején, kisbetűs szó követi — valószínűleg köznév', confidence: 0.1, disposition: 'reject', page: 0, context: '…⟦Nagy⟧ összegű, több évre szóló beruházásról volt szó…', ...hol('Nagy összegű', 'Nagy') },
  { id: 4, entityId: 'p3', surface: 'Szabóval', replacement: 'Ónixossal', reason: 'csak vezetéknév — köznévvel azonos alakú — a fél teljes neve korábban már szerepelt', confidence: 0.75, disposition: 'review', page: 1, context: '…A felperes ⟦Szabóval⟧ korábban is állt üzleti kapcsolatban…', ...hol('Szabóval') },
  { id: 5, entityId: 'p2', surface: 'K. J.', replacement: 'K. T.', reason: 'monogram', confidence: 0.6, disposition: 'review', page: 1, context: '…a közlemény rovatban rendre „⟦K. J.⟧ kölcsön" megjelölés szerepelt…', ...hol('K. J.') },
  /*
    UGYANANNAK A FÉLNEK HÁROM KÜLÖNBÖZŐ KÖZNÉVI ALAKJA (id 4, 6, 7).

    Nem díszlet: a mentés utáni jelentés ezeket VONJA ÖSSZE egyetlen sorrá („a
    »Szabó« alakot 3 helyen is lecseréltük"). Egyetlen tétellel az összevonás
    nem látszana, két különböző féllel pedig a csoportosítás hibája sem derülne
    ki — a ragozott alakok („Szabóval", „Szabónak") pont attól tanulságosak,
    hogy a köznévi lista sosem tartalmazza őket.
  */
  { id: 6, entityId: 'p3', surface: 'Szabó', replacement: 'Ónixos', reason: 'csak vezetéknév — köznévvel azonos alakú — a fél teljes neve korábban már szerepelt', confidence: 0.72, disposition: 'review', page: 1, context: '…a szerződést ⟦Szabó⟧ ellenjegyezte, majd átadta…', ...hol('Szabó ellenjegyezte', 'Szabó') },
  { id: 7, entityId: 'p3', surface: 'Szabónak', replacement: 'Ónixosnak', reason: 'csak vezetéknév — köznévvel azonos alakú, részes eset', confidence: 0.7, disposition: 'review', page: 2, context: '…a kölcsön összegét ⟦Szabónak⟧ utalta át a felperes…', ...hol('Szabónak') },
  /*
    ÖSSZEG ÉS DÁTUM — KIKAPCSOLT CSERÉVEL.

    A motor ezeket akkor is megkeresi, ha nem cseréljük (`analyze`,
    src/app/session.ts): a kikapcsolt kapcsoló nem a keresést állítja le, hanem
    a találatok alapértelmezett döntését adja („skip”). A felületnek épp ezt az
    állapotot kell tudnia megmutatni — az iraton meg vannak jelölve, de szín
    nélkül, és egy kattintással egyenként is bekapcsolhatók.
  */
  { id: 8, entityId: '#osszeg', surface: '3 550 000 Ft', replacement: '4 118 000 Ft', reason: 'összeg pénznemmel; az ügyre állandó szorzó', confidence: 0.99, disposition: 'auto', decision: 'skip', page: 0, context: '…egyetemlegesen ⟦3 550 000 Ft⟧ tőke megfizetésére…', ...hol('3 550 000 Ft') },
  { id: 9, entityId: '#datum', surface: '2025. március 14.', replacement: '2025. június 2.', reason: 'dátum; az ügyre állandó eltolás', confidence: 0.99, disposition: 'auto', decision: 'skip', page: 0, context: '…A felek ⟦2025. március 14.⟧ napján Szentendrén…', ...hol('2025. március 14.') },
];

/*
  A HIVATALOS SZEREPLŐK — CSAK BEKAPCSOLT CSERE MELLETT.

  A Bszi. 166. § (2) szerint az eljáró bíró, az ügyvéd és a bíróság neve bent
  marad; a felhasználó viszont — kimondott figyelmeztetés mellett — kérheti a
  cseréjüket is. Az álkimenetnek mindkét állapotot tudnia kell mutatni,
  különben a felület egyik ága sem járható végig böngészőben: kikapcsolva a
  törvény szerinti lista áll a szakaszban, bekapcsolva ugyanolyan sorok, mint
  a feleknél.

  A találatazonosítók a 10-től indulnak: a fenti lista 0..9-et használ, és két
  azonos azonosító alatt a találatonkénti döntések egymásra íródnának.
*/
const HIVATALOS_CAST: AnalysisResult['cast'] = [
  { entityId: 'k1', original: 'dr. Sárközi Tamás', replacement: 'dr. Kőpáti Ottó', kind: 'person', role: 'egyéb', gender: 'M', occurrences: 1, pendingCount: 0, manual: false, skipped: false },
  { entityId: 'k2', original: 'dr. Bach Tivadar', replacement: 'dr. Gránitos Elemér', kind: 'person', role: 'egyéb', gender: 'M', occurrences: 1, pendingCount: 0, manual: false, skipped: false },
  { entityId: 'k3', original: 'Szentendrei Járásbíróság', replacement: 'Kőhalmi Járásbíróság', kind: 'org', role: 'szervezet', gender: 'N', occurrences: 1, pendingCount: 0, manual: false, skipped: false },
];

const HIVATALOS_MATCHES: AnalysisResult['matches'] = [
  { id: 10, entityId: 'k1', surface: 'dr. Sárközi Tamás', replacement: 'dr. Kőpáti Ottó', reason: 'eljáró ügyvéd — a felhasználó kérésére cserélve', confidence: 1, disposition: 'auto', page: 0, context: '…Alulírott ⟦dr. Sárközi Tamás⟧ ügyvéd mint…', ...hol('dr. Sárközi Tamás') },
  { id: 11, entityId: 'k2', surface: 'dr. Bach Tivadar', replacement: 'dr. Gránitos Elemér', reason: 'eljáró bíró — a felhasználó kérésére cserélve', confidence: 1, disposition: 'auto', page: 0, context: '…⟦dr. Bach Tivadar⟧ s. k. bíró…', ...hol('dr. Bach Tivadar') },
  { id: 12, entityId: 'k3', surface: 'Szentendrei Járásbíróság', replacement: 'Kőhalmi Járásbíróság', reason: 'eljáró bíróság — a felhasználó kérésére cserélve', confidence: 1, disposition: 'auto', page: 0, context: '⟦Szentendrei Járásbíróság⟧…', ...hol('Szentendrei Járásbíróság') },
];

/**
 * Amiről a program döntött EMBER HELYETT — a kérdezés nélküli út ára.
 *
 * A motor a lecserélt tételeket sorolja fel, a bent hagyott elutasítottakat nem
 * (`autoAccepted`, src/app/session.ts): ez a lista arról szól, mi VÁLTOZOTT
 * meg az iratban emberi döntés nélkül. A `commonWord` jelöli a valószínű
 * fölösleges cseréket — ezek adják a jelentés kiemelt rovatát.
 */
const AUTO_ACCEPTED: NonNullable<AnalysisResult['autoAccepted']> = [
  { matchId: 4, entityId: 'p3', surface: 'Szabóval', context: MATCHES[4]!.context, reason: MATCHES[4]!.reason, confidence: 0.75, page: 1, replacement: 'Ónixossal', commonWord: true },
  { matchId: 5, entityId: 'p2', surface: 'K. J.', context: MATCHES[5]!.context, reason: MATCHES[5]!.reason, confidence: 0.6, page: 1, replacement: 'K. T.', commonWord: false },
  { matchId: 6, entityId: 'p3', surface: 'Szabó', context: MATCHES[6]!.context, reason: MATCHES[6]!.reason, confidence: 0.72, page: 1, replacement: 'Ónixos', commonWord: true },
  { matchId: 7, entityId: 'p3', surface: 'Szabónak', context: MATCHES[7]!.context, reason: MATCHES[7]!.reason, confidence: 0.7, page: 2, replacement: 'Ónixosnak', commonWord: true },
];

const ANALYSIS: AnalysisResult = {
  doc: DOC,
  pages: [],
  cast: CAST,
  matches: MATCHES,
  highlights: [],
  /*
    A motor ide HÁROM forrásból gyűjt: a modell állapotából, az elemzés saját
    észrevételeiből és a betöltés figyelmeztetéseiből (`AnalysisResult.warnings`,
    src/app/session.ts). A helyettesítő adat mindhármat hozza, különben a felület
    csak az egyik fajtára készülne fel.
  */
  warnings: [
    'A modell 3 találatát nem tudtuk értelmezni (MISC: 2, DATE: 1): a nyers címkéjükhöz nincs ' +
      'bejegyzés a címketérképben, ezért nem kerültek a felek közé. Ha az iratban idegen nyelvű ' +
      'vagy szokatlan névformák vannak, ezeket kézzel kell felvenni.',
    'A(z) "tanú (az Aranykalász Agrár Kft. ügyvezetője)" szerepleírás egy fél nevét tartalmazta; a zárójeles rész elhagyva: "tanú".',
    ...DOC.loadWarnings,
  ],
  counts: { auto: 5, review: 4, reject: 1 },
  /*
    A KIMENET SZÁMAI — nem a felismerés fokozatai.

    A `counts` azt méri, mennyire voltunk biztosak; ez azt, mi fog történni. A
    kettő szándékosan tér el: a két összeg-/dátumtalálat magabiztos (`auto`),
    mégsem cserélődik, mert a fajtájuk ki van kapcsolva. Ha a felület csak a
    `counts`-ot ismerné, a jelmagyarázat két lecserélendő tételt írna ki olyan
    értékekre, amikhez nem nyúlunk.
  */
  outcomes: { csere: 3, bizonytalan: 4, nincs: 3 },
  previewText: TEXT,
};

/**
 * UGYANAZ AZ IRAT, KÉRDEZÉS NÉLKÜLI ÚTON.
 *
 * A két út nem ugyanazt az elemzést adja, és pont a különbség a lényeg: itt
 * minden bizonytalan találat DÖNTÉST kap, és a döntés forrása is oda van írva
 * (`autoDecided`). Ha a helyettesítő adat mindkét útra ugyanazt adná vissza, a
 * felület kérdezés nélküli ága böngészőben sosem volna végignézhető — se a
 * szereplap „a program cserélte" felirata, se a mentés utáni jelentés.
 */
const ANALYSIS_AUTO: AnalysisResult = {
  ...ANALYSIS,
  // Kérdezés nélküli úton EGYETLEN találat sem marad eldöntetlen, tehát a
  // szereplap „2 eldöntetlen" jelzése sem maradhat ott: a motor ezt a számot a
  // döntés nélküli találatokból számolja (`isUndecided`, src/app/session.ts).
  cast: CAST.map((c) => ({ ...c, pendingCount: 0 })),
  matches: MATCHES.map((m) =>
    m.disposition === 'auto'
      ? m
      : { ...m, decision: m.disposition === 'review' ? ('accept' as const) : ('skip' as const), autoDecided: true },
  ),
  autoAccepted: AUTO_ACCEPTED,
};

const EXPORT: ExportResult = {
  outputPath: 'C:\\Iratok\\keresetlevel-alnevesitett.pdf',
  keyPath: 'C:\\Iratok\\keresetlevel-alnevesitett.szkulcs',
  report: {
    ok: true,
    leaks: [],
    /*
      A maradványlista SZÁNDÉKOSAN rövidebb, mint a teljes szám: a csonkolás
      kiírását („40 látszik a 137 maradványból”) csak így lehet böngészőben
      végignézni. Ha itt üres lista állna, a felület legfontosabb új listája
      sosem jelenne meg az átnézésen.
    */
    residual: [
      { surface: 'Kovácsné', detail: '4. oldal — a lecserélt vezetéknévhez hasonló alak, egyik félhez sem sikerült kötni' },
      { surface: 'K. J.', detail: '2. oldal — monogram, a felhasználó eldöntetlenül hagyta' },
      { surface: 'Aranykalász', detail: '5. oldal — a cégnév egy szava önmagában, cégforma nélkül' },
    ],
    residualTotal: 7,
    replaced: 52,
    pending: 3,
    checkedChars: 5697,
  },
  /*
    A jegyzőkönyv SZÖVEGE. Üresen hagyva a felület jegyzőkönyv-nézete
    böngészőben egy üres dobozként látszana, és semmi nem mutatná meg, milyen
    széles az igazi tartalom — pedig ez a fájl kerül ki az irat mellé.
    A sorok szó szerint a motor alakját követik (`certificate()`,
    src/app/session.ts): fix szélességű rovatnevek, majd a rovatok.
  */
  certificate: [
    'ANONIMIZÁLÁSI JEGYZŐKÖNYV',
    '',
    'Forrásfájl:            keresetlevel.pdf',
    'Formátum:              PDF, 3 oldal, 5559 karakter',
    'Csere módja:           témás álnevek',
    'Kulcsfájl:             készült (álnevesítés — a kimenet továbbra is személyes adat)',
    'Nyelvi modell:         futott (34 találat); 3 találatát nem tudtuk értelmezni (MISC: 2, DATE: 1)',
    '',
    'Lecserélt előfordulás: 52',
    'Eldöntetlen találat:   3',
    'Ellenőrzött karakter:  5697',
    'Gyanús maradvány:      7 (emberi átnézésre)',
    'Ellenőrző kör:         a KÉSZ FÁJL visszaolvasva tiszta — eredeti név nem maradt benne',
    '',
    'MIT CSERÉLTÜNK (fajtánként)',
    '  személy:    5 fél, 49 előfordulás',
    '  szervezet:  1 fél, 3 előfordulás',
    '  azonosító:  5 adat, 7 előfordulás',
    '',
    'FIGYELMEZTETÉSEK',
    '  - A modell 3 találatát nem tudtuk értelmezni (MISC: 2, DATE: 1): a nyers címkéjükhöz nincs',
    '    bejegyzés a címketérképben, ezért nem kerültek a felek közé.',
    '  - A 2. oldalon 1 betűkészlethez nincs használható ToUnicode tábla, ezért 214 karaktert nem',
    '    tudtunk elolvasni. Az ezekkel szedett szöveget a program NEM LÁTJA.',
    '  - A PDF XMP-metaadatcsomagját (szerző, készítő program, eredeti fájlútvonal) töröltük.',
    '',
    'A ki-kicsoda megfeleltetést ez a jegyzőkönyv SZÁNDÉKOSAN nem tartalmazza: az a',
    'titkosított kulcsfájlba (.szkulcs) kerül, jelszóval védve.',
    '',
    'A kimenet álnevesített, nem anonimizált, amennyiben a kulcsfájl fennmarad.',
    'A kulcsfájl önmagában is személyes adat: külön, titkosítva kell tárolni.',
    '',
    'Készült: 2026-08-25 10:42:11',
  ].join('\n'),
  /*
    A MENTÉS figyelmeztetései. Nem ugyanaz, mint az elemzésé: egy részük CSAK a
    kiírás közben derül ki (a PDF-metaadat kitakarítása, az űrlapmezők
    eltávolítása), tehát az elemzés eredményében még nem szerepelhettek. A
    felhasználó ezeket csak akkor látná, ha a mentés UTÁN újra végigfuttatna
    mindent — vagyis a gyakorlatban soha.
  */
  warnings: [
    'A modell 3 találatát nem tudtuk értelmezni (MISC: 2, DATE: 1): a nyers címkéjükhöz nincs ' +
      'bejegyzés a címketérképben, ezért nem kerültek a felek közé. Ha az iratban idegen nyelvű ' +
      'vagy szokatlan névformák vannak, ezeket kézzel kell felvenni.',
    ...DOC.loadWarnings,
    'A PDF XMP-metaadatcsomagját (szerző, készítő program, eredeti fájlútvonal) töröltük.',
    'Az űrlapmezőket (AcroForm) eltávolítottuk: a kitöltött értékük nem cserélhető ki a helyén.',
  ],
  /*
    A jegyzőkönyv ÚTVONALA. Az irat mellé egy HARMADIK fájl is kikerül a
    lemezre, ráadásul származtatott néven — erről a felhasználó eddig sehol nem
    értesült, tehát azt sem tudta, hogy a mappa kiküldésével a jegyzőkönyvet is
    kiküldi. A felületen ennek látszania kell, „mappa megnyitása" lehetőséggel.
  */
  certificatePath: 'C:\\Iratok\\keresetlevel-alnevesitett-jegyzokonyv.txt',
};

/**
 * Fejlesztői belépő a munkaterületre: `?dev=workspace` esetén előre kitöltött
 * felekkel indul, hogy az elrendezést ne kelljen minden alkalommal végigkattintani.
 */
/**
 * A fejlesztői belépő kiindulóállapota.
 *
 * A FELISMERÉS EREDMÉNYE IS BENNE VAN (`detected`). Enélkül a felület úgy
 * látta, hogy egyetlen fél sem a vizsgálatból származik — vagyis MINDEN sor
 * „kézzel felvéve” jelvényt kapott —, és a törvény szerint bent maradó nevek
 * szakasza meg sem jelent. Éppen az a két ág maradt kipróbálatlan, amit a
 * belépő miatt nézni akarunk.
 */
export function devPreset():
  | { doc: DocumentInfo; parties: PartyInput[]; detected: DetectionResult }
  | null {
  if (typeof window === 'undefined') return null;
  if (!new URLSearchParams(window.location.search).get('dev')) return null;
  return {
    doc: DOC,
    detected: DETECTION,
    parties: [
      { id: 'p1', kind: 'person', fullName: 'Kovács János', gender: 'M', role: 'felperes' },
      { id: 'p2', kind: 'person', fullName: 'Nagy Péter', gender: 'M', role: 'I. r. alperes' },
      { id: 'p3', kind: 'person', fullName: 'Szabó Márton', gender: 'M', role: 'II. r. alperes' },
      { id: 'p4', kind: 'person', fullName: 'Kiss Erika', gender: 'F', role: 'tanú' },
      { id: 'p5', kind: 'person', fullName: 'Baloghné Fehér Ilona', gender: 'F', role: 'tanú' },
      { id: 'p6', kind: 'org', fullName: 'Aranykalász Agrár Kft.', gender: 'N', role: 'egyéb' },
    ],
  };
}

const SETTINGS = {
  themeId: 'kokorszak',
  mode: 'theme' as const,
  keepKey: true,
  autoDetect: true,
  useModel: true,
  modelId: 'nytk-nerkor-hubert',
  autoThreshold: 0.8,
  replaceAmounts: false,
  shiftDates: false,
  autoMode: true,
};

/**
 * A beállító oldal kiindulóértékei.
 *
 * `modeAsked: false`, hogy a böngészőben MINDIG az első megnyitás képe jöjjön
 * elő: az útválasztó kérdés a program életében egyetlen egyszer jelenik meg, és
 * ha itt „már megkérdeztük” állna, ez a párbeszéd fejlesztés közben soha nem
 * volna végignézhető.
 *
 * Az `iratBeallitas` a `SETTINGS`-ből olvas ki hatot, és a `setUiState` oda is
 * ír vissza — pontosan úgy, ahogy a valódi program a beállításfájllal teszi.
 * Ha itt külön másolat állna, a helyettesítő adaton működne az a hiba, amit a
 * valódi tárolás kizár: a beállító oldal mást mutatna, mint amivel az elemzés
 * fut.
 */
const UI_STATE = { modeAsked: false };

function iratBeallitas(): IratBeallitas {
  return {
    themeId: SETTINGS.themeId,
    mode: SETTINGS.mode,
    keepKey: SETTINGS.keepKey,
    autoThreshold: SETTINGS.autoThreshold,
    replaceAmounts: SETTINGS.replaceAmounts,
    shiftDates: SETTINGS.shiftDates,
  };
}

function uiAllapot(): UiState {
  return { modeAsked: UI_STATE.modeAsked, iratBeallitas: iratBeallitas() };
}

/*
  AZ ALKALMAZÁS ADATAI — A MODELLLISTÁBÓL SZÁRMAZTATVA, nem külön beírva.

  Korábban itt egy rögzített bejegyzés állt, és néma ellentmondásba került a
  többi álkimenettel: a beállítás a magyar modellt nevezte meg, ez a
  többnyelvűt, a modellista szerint az egyik telepítve volt, ez szerint
  hiányzott. A felület pedig mindkettőt kirajzolta, egymás mellett.

  Ugyanaz a hiba, ami ellen az egész program készült — két másolat ugyanarról
  az adatról —, csak épp a fejlesztői álkimenetben. Ezért innentől számolt:
  a beállított modellt keresi ki a listából, és annak az állapotát adja vissza.

  A „nincs letöltve” ág megnézéséhez a `MODELS` magyar bejegyzésén írd át a
  `state`-et 'missing'-re — a nyitóképernyő sávja és a csere lapjának
  modellsávja EGYSZERRE vált át vele, ahogy a valódi programban is.
*/
const APP_INFO = {
  version: '0.1.0',
  get modelId(): string {
    return SETTINGS.modelId;
  },
  get modelName(): string {
    return MODELS.find((m) => m.id === SETTINGS.modelId)?.name ?? 'ismeretlen modell';
  },
  get modelState(): 'missing' | 'partial' | 'installed' {
    return MODELS.find((m) => m.id === SETTINGS.modelId)?.state ?? 'missing';
  },
  modelFile: 'model.onnx',
  engine: 'ONNX Runtime',
};

const KEY_ENTRIES = [
  { original: 'Kovács János', pseudonym: 'Kvarcos Tűzkő', kind: 'személy' },
  { original: 'Nagy Péter', pseudonym: 'Palás Jáspis', kind: 'személy' },
  { original: 'Szabó Márton', pseudonym: 'Ónixos Opál', kind: 'személy' },
  { original: 'Aranykalász Agrár Kft.', pseudonym: 'Obszidián Agrár Kft.', kind: 'szervezet' },
];

/*
  A TÍPUS SZÁNDÉKOSAN KI VAN ÍRVA — ugyanabból az okból, mint a `DETECTION`-nél:
  ha a hídra új mező kerül, és ide nem, akkor pont az az ág marad
  kipróbálatlan, ami a legfrissebb. A `purpose` mező például épp ilyen: ezen
  dől el, hogy a Beállítások melyik listába teszi a modellt, és hogy a saját
  névkészlet ablaka talál-e gyártót.
*/
const MODELS: ModelStatus[] = [
  /*
    A MAGYAR FELISMERŐ — TELEPÍTVE, ez az alapértelmezés.

    Két felismerő modell kell az álkimenetbe, mert a csere lapján a nyelvi sáv
    KÖZÖTTÜK választat: „magyar irat” / „más nyelvű irat”. Egyetlen bejegyzéssel
    a választó egygombos lenne, és épp az az ág maradna kipróbálatlan, amiért a
    sáv készült. A telepített és a hiányzó állapot is szerepel, mert a sáv
    kinézete és gombjai a kettőn különböznek.
  */
  {
    id: 'nytk-nerkor-hubert',
    name: 'Magyar névfelismerő (huBERT / NerKor)',
    repo: 'foltin/nerkor-hubert-hungarian-onnx',
    license: 'Apache-2.0',
    mi: 'huBERT alapú kódoló a Nyelvtudományi Kutatóközponttól, ONNX formátumban. 12 réteg, 110 millió paraméter, 32 001 elemű ékezetes szótár.',
    mit: 'Megjelöli a tulajdonneveket, karakterpontos pozícióval. Mérés a 7 161 karakteres mintaítéleten: 92 találat, 902 ms, 0 elcsúszott pozíció.',
    languages: ['hu'],
    recommended: true,
    purpose: 'detect',
    source: 'hub',
    state: 'installed',
    bytesOnDisk: 441119770,
    totalBytes: 441119770,
  },
  {
    id: 'eu-pii-multilang',
    name: 'Európai PII-felismerő (többnyelvű)',
    repo: 'bardsai/eu-pii-anonimization-multilang',
    license: 'Apache-2.0',
    mi: 'XLM-RoBERTa alapú kódoló, 24 európai nyelven tanítva, 8 bites ONNX formátumban. Hét címkét vesz át: személynév, álnév, tulajdonnév, szervezet, helyszín, földrajzi hely, postai cím.',
    mit: 'Megjelöli a tulajdonneveket. A karakterpozíciókat a program állítja helyre. Mérés a 7 161 karakteres mintaítéleten: 54 találat, 489 ms, 0 elcsúszott pozíció.',
    languages: ['hu', 'en', 'de', 'fr', 'it', 'es', 'pl', '+18'],
    recommended: true,
    purpose: 'detect',
    source: 'hub',
    state: 'missing',
    bytesOnDisk: 0,
    totalBytes: 295523237,
  },
  /*
    A NÉVKÉSZLET-GYÁRTÓ 》missing《 állapotban áll, és ez szándékos: ez az az
    állapot, amit a felhasználó ma tényleg lát, és ez az az ág, amit a
    „Saját készlet…" ablakban végig kell tudni nézni — a letöltésre vezető
    útmutatás. A telepített ág kipróbálásához írd át 'installed'-re.
  */
  {
    id: 'qwen3-4b-thinking-namegen',
    name: 'Névkészlet-gyártó (Qwen3-4B Thinking)',
    repo: 'onnx-community/Qwen3-4B-Thinking-2507-ONNX',
    license: 'Apache-2.0',
    mi: 'Qwen3-4B Thinking, generatív modell ONNX formátumban. Gondolkodó modell: válasz előtt magában végigfut a feladaton. Szerepe a névkészlet-gyártás.',
    mit: 'A beírt téma alapján neveket javasol a saját névkészlethez. A javaslatot a program ragozó motorja veszi át, és kidobja azt, ami nem ragozható vagy valódi magyar névvel ütközik.',
    languages: ['hu', 'en', '+100'],
    recommended: false,
    purpose: 'namegen',
    source: 'hub',
    state: 'missing',
    bytesOnDisk: 0,
    totalBytes: 2906594331,
  },
];

/* ──────────────────── saját névkészlet (helyettesítő) ──────────────────── */

/**
 * A 21 eset kitöltése.
 *
 * A felület a `mutatvany` mezőt rajzolja ki, a teljes paradigmát nem — az a
 * motoré. Itt mégis ki kell töltenünk, mert a típus megköveteli, és épp ez a
 * lényege: ha egy nap a felület elkezdi használni, a helyettesítő adat nem
 * fog néma `undefined`-eket adni.
 */
type Eset = MutatvanyAlak['eset'];
const ESETEK: readonly Eset[] = [
  'NOM', 'ACC', 'DAT', 'INS', 'INE', 'ILL', 'ELA', 'SUP', 'SUB', 'DEL',
  'ADE', 'ALL', 'ABL', 'TER', 'CAU', 'FOR', 'TRANS', 'POSS', 'FAM', 'PL', 'WIFE',
];

function teljesParadigma(form: string): EllenorzottNev['paradigma'] {
  const out = {} as EllenorzottNev['paradigma'];
  for (const e of ESETEK) out[e] = form;
  return out;
}

/** Az öt megmutatott eset címkéje, ahogy a motor is adja. */
const ESET_CIMKE: Partial<Record<Eset, string>> = {
  ACC: 'tárgyeset (-t)',
  DAT: 'részes eset (-nak/-nek)',
  INS: 'eszközhatározó (-val/-vel)',
  SUP: 'felszíni (-on/-en/-ön)',
  ALL: 'felé (-hoz/-hez/-höz)',
  WIFE: 'asszonynév (-né)',
};

function nev(
  form: string,
  csoport: EllenorzottNev['csoport'],
  alakok: [Eset, string][],
  gender?: EllenorzottNev['gender'],
  jegyzet = '',
): EllenorzottNev {
  return {
    form,
    csoport,
    ...(gender ? { gender } : {}),
    harmony: 'back',
    overrides: {},
    paradigma: teljesParadigma(form),
    mutatvany: alakok.map(([eset, alak]) => ({ eset, cimke: ESET_CIMKE[eset] ?? eset, alak })),
    kiejtesFuggo: jegyzet !== '',
    notes: jegyzet,
  };
}

/*
  A HELYETTESÍTŐ KÉSZLET SZÁNDÉKOSAN KISEBB a valódi küszöböknél (8 utónév
  nemenként, 12 vezetéknév): a fájl így olvasható marad. A felület nem számolja
  újra a küszöböket, hanem a `hasznalhato` jelzőt olvassa — a jóváhagyó képernyő
  tehát ugyanúgy végigjárható. A tiltott ág kipróbálásához állítsd `false`-ra.
*/
const GYARTOTT: TemaEredmeny = {
  theme: {
    id: 'sajat_gorog_mitologia',
    name_hu: 'Görög mitológia',
    description_hu: 'Saját névkészlet, nyelvi modell javaslatából.',
    license_note: '',
    given_names: [],
    surnames: [],
    org_parts: [],
    place_names: [],
  },
  jelentes: {
    temaSzoveg: 'görög mitológia',
    javaslatokSzama: 82,
    hasznalhato: true,
    elfogadva: [
      nev('Akhilleusz', 'given', [
        ['ACC', 'Akhilleuszt'], ['DAT', 'Akhilleusznak'], ['INS', 'Akhilleusszal'],
        ['SUP', 'Akhilleuszon'], ['ALL', 'Akhilleuszhoz'],
      ], 'M'),
      nev('Poszeidón', 'given', [
        ['ACC', 'Poszeidónt'], ['DAT', 'Poszeidónnak'], ['INS', 'Poszeidónnal'],
        ['SUP', 'Poszeidónon'], ['ALL', 'Poszeidónhoz'],
      ], 'M'),
      nev('Prométheusz', 'given', [
        ['ACC', 'Prométheuszt'], ['DAT', 'Prométheusznak'], ['INS', 'Prométheusszal'],
        ['SUP', 'Prométheuszon'], ['ALL', 'Prométheuszhoz'],
      ], 'M'),
      nev('Kasszandra', 'given', [
        ['ACC', 'Kasszandrát'], ['DAT', 'Kasszandrának'], ['INS', 'Kasszandrával'],
        ['SUP', 'Kasszandrán'], ['ALL', 'Kasszandrához'],
      ], 'F'),
      nev('Ariadné', 'given', [
        ['ACC', 'Ariadnét'], ['DAT', 'Ariadnénak'], ['INS', 'Ariadnéval'],
        ['SUP', 'Ariadnén'], ['ALL', 'Ariadnéhoz'],
      ], 'F'),
      nev('Alkésztisz', 'given', [
        ['ACC', 'Alkésztiszt'], ['DAT', 'Alkésztisznak'], ['INS', 'Alkésztisszel'],
        ['SUP', 'Alkésztiszen'], ['ALL', 'Alkésztiszhez'],
      ], 'F', 'A szó vége [sz]: a hangrend a kiejtésen múlik, a program a mély hangrendet választotta.'),
      nev('Olümposzi', 'surname', [
        ['ACC', 'Olümposzit'], ['DAT', 'Olümposzinak'], ['INS', 'Olümposzival'],
        ['WIFE', 'Olümposziné'],
      ]),
      nev('Argoszi', 'surname', [
        ['ACC', 'Argoszit'], ['DAT', 'Argoszinak'], ['INS', 'Argoszival'],
        ['WIFE', 'Argosziné'],
      ]),
      nev('Thébai', 'surname', [
        ['ACC', 'Thébait'], ['DAT', 'Thébainak'], ['INS', 'Thébaival'],
        ['WIFE', 'Thébainé'],
      ]),
      nev('Krétai', 'surname', [
        ['ACC', 'Krétait'], ['DAT', 'Krétainak'], ['INS', 'Krétaival'],
        ['WIFE', 'Krétainé'],
      ]),
      nev('Aigisz', 'org', [
        ['ACC', 'Aigiszt'], ['DAT', 'Aigisznak'], ['INS', 'Aigisszal'],
      ]),
      nev('Pegazus', 'org', [
        ['ACC', 'Pegazust'], ['DAT', 'Pegazusnak'], ['INS', 'Pegazussal'],
      ]),
      nev('Olümposzfalva', 'place', [
        ['ACC', 'Olümposzfalvát'], ['DAT', 'Olümposzfalvának'], ['INS', 'Olümposzfalvával'],
        ['SUP', 'Olümposzfalván'], ['ALL', 'Olümposzfalvához'],
      ], undefined, 'Helységnév: a program -n ragot ad, de a magyar helynevek egy része -ban/-ben ragot kap. Ellenőrizd.'),
      nev('Thébavár', 'place', [
        ['ACC', 'Thébavárt'], ['DAT', 'Thébavárnak'], ['INS', 'Thébavárral'],
        ['SUP', 'Thébaváron'], ['ALL', 'Thébavárhoz'],
      ], undefined, 'Helységnév: a program -n ragot ad, de a magyar helynevek egy része -ban/-ben ragot kap. Ellenőrizd.'),
    ],
    elutasitva: [
      {
        form: 'Zeusz',
        csoport: 'given',
        ok: 'ismetlodes',
        indoklas: 'A „Zeusz” már szerepel a készletben, ezért másodszor kimaradt.',
      },
      {
        form: 'Hektor',
        csoport: 'given',
        ok: 'valodi_nev',
        indoklas:
          'A „Hektor” valódi, gyakori magyar név vagy köznév. Fedőnévnek nem jó: az olvasó valódi személyre gondolna.',
      },
      {
        form: 'Xerxész',
        csoport: 'surname',
        ok: 'nem_magyar_betuk',
        indoklas: 'A „Xerxész” a magyar ábécében nem szereplő betűt tartalmaz (x), ezért kimaradt.',
      },
    ],
    atnezendo: [],
    hianyok: [
      {
        csoport: 'org',
        van: 2,
        kell: 6,
        kotelezo: false,
        uzenet:
          'Kevés a cégnév-előtag (2 db). Enélkül is működik a készlet, de a program ilyenkor a vezetéknevekből dolgozik, ami elüt a témától.',
      },
    ],
    figyelmeztetesek: [
      'A neveket nyelvi modell javasolta, a ragozást viszont a program saját motorja készítette. A készletet HASZNÁLAT ELŐTT nézd át: a ragozott alakokat a lista mutatja.',
      '2 névnél a helyes ragozás a KIEJTÉSEN múlik, amit a helyesírásból nem lehet levezetni („Alkésztisz”, „Olümposzfalva”). Ezeknél a program a gyakoribb alakot választotta, de tévedhet.',
      'A program azt NEM tudja megnézni, hogy egy javasolt név védjegy vagy szerzői jogi oltalom alatt álló műből származik-e.',
    ],
  },
};

// A jóváhagyó képernyő kiemelt rovata: ahol a ragozás tippen alapul.
GYARTOTT.jelentes.atnezendo = GYARTOTT.jelentes.elfogadva.filter((n) => n.kiejtesFuggo);

/* ──────────────────── frissítés (helyettesítő) ──────────────────── */

/**
 * A frissítés BEÁLLÍTATLAN állapotból indul, és ez szándékos: ma pontosan ezt
 * látja a felhasználó, és ez az az ág, amit végig kell tudni nézni — az, ahol
 * az ablak megmondja, hogy a frissítés még nincs bekapcsolva, és ott is
 * bekapcsolható.
 */
const UPDATE: UpdateState = {
  phase: 'off',
  feedUrl: '',
  currentVersion: '0.1.0',
  newVersion: '',
  notes: '',
  uzenet:
    'A frissítés még nincs bekapcsolva: nincs megadva, honnan töltse le a program az új ' +
    'változatot. Írd be alább a frissítési címet — ezt attól kérdezd meg, akitől a programot kaptad.',
};

/**
 * A felismerés helyettesítő eredménye.
 *
 * A felület HÁROM rovatot épít belőle, és mindhármat ki kell tölteni, különben
 * böngészőben nem lehet végignézni: a felek, a jogszerűen BENT MARADÓ nevek, és
 * — ez a legújabb — a hivatalos AZONOSÍTÓK. Az azonosítók külön listán jönnek,
 * mert nem felek: nincs nemük és nincs eljárási szerepük, a `role` helyén az
 * adatfajta neve áll, és a kimenetben nem témás fedőnevet, hanem
 * adatfajta-megjelölést kapnak.
 */
/*
  A TÍPUS SZÁNDÉKOSAN KI VAN ÍRVA. Ez a helyettesítő adat egyetlen dolog miatt
  létezik: hogy a felület böngészőben is végignézhető legyen. Ha egy új mező
  bekerül a válaszba, és ide nem, akkor pont az az ág marad kipróbálatlan, ami
  a legfrissebb — ezért a hiányzó mező itt fordítási hiba legyen, ne néma üres
  rovat a képernyőn.
*/
const DETECTION: DetectionResult = {
  parties: [
    {
      id: 'p1',
      kind: 'person',
      fullName: 'Kovács János',
      gender: 'M',
      role: 'felperes',
      confidence: 0.97,
      evidence: '„Felperes:” rovat',
      occurrences: 15,
    },
    {
      id: 'p2',
      kind: 'person',
      fullName: 'Nagy Péter',
      gender: 'M',
      role: 'I. r. alperes',
      confidence: 0.94,
      evidence: '„I. rendű alperes:” rovat, és a nyelvi modell is megtalálta',
      occurrences: 16,
    },
    {
      id: 'p5',
      kind: 'person',
      fullName: 'Baloghné Fehér Ilona',
      gender: 'F',
      role: 'tanú',
      confidence: 0.71,
      evidence: 'a nyelvi modell találta (4×)',
      occurrences: 4,
    },
    {
      id: 'p6',
      kind: 'org',
      fullName: 'Aranykalász Agrár Kft.',
      gender: 'N',
      role: 'szervezet',
      confidence: 0.88,
      evidence: 'cégforma a név végén („Kft.”)',
      occurrences: 3,
    },
  ],
  keepList: [
    { name: 'dr. Sárközi Tamás', why: 'eljáró ügyvéd' },
    { name: 'dr. Bach Tivadar', why: 'eljáró bíró' },
    { name: 'Szentendrei Járásbíróság', why: 'eljáró bíróság' },
  ],
  /*
    UGYANEZEK KÉSZ FÉLKÉNT — ettől jelenik meg a „Ezeket is cseréljük le”
    kapcsoló a beállító lapon. A motor is így adja őket (`detectByStructure`,
    src/app/detect.ts): a nem és az előfordulásszám a szövegből származik, mert
    a felület azt nem tudná kitalálni.
  */
  officials: [
    {
      id: 'k1',
      kind: 'person',
      fullName: 'dr. Sárközi Tamás',
      gender: 'M',
      role: 'egyéb',
      confidence: 1,
      evidence: 'eljáró ügyvéd — a törvény szerint a neve bent marad',
      occurrences: 2,
    },
    {
      id: 'k2',
      kind: 'person',
      fullName: 'dr. Bach Tivadar',
      gender: 'M',
      role: 'egyéb',
      confidence: 1,
      evidence: 'eljáró bíró — a törvény szerint a neve bent marad',
      occurrences: 1,
    },
    {
      id: 'k3',
      kind: 'org',
      fullName: 'Szentendrei Járásbíróság',
      gender: 'N',
      role: 'szervezet',
      confidence: 1,
      evidence: 'hatóság vagy bíróság — a törvény szerint nem anonimizálandó',
      occurrences: 3,
    },
  ],
  identifiers: [
    {
      id: 'a1',
      kind: 'identifier',
      fullName: '2013 Pomáz, Mártírok útja 12.',
      gender: 'N',
      role: 'cím',
      identifierKind: 'cim',
      confidence: 0.95,
      evidence: 'cím mintája illeszkedik; címke a szövegben: „lakcím”',
      occurrences: 2,
    },
    {
      id: 'a2',
      kind: 'identifier',
      fullName: 'kovacs.janos58@freemail.hu',
      gender: 'N',
      role: 'e-mail cím',
      identifierKind: 'email',
      confidence: 0.99,
      evidence: 'e-mail cím mintája illeszkedik; a helyi rész névtöredéket tartalmaz (vezetéknév, keresztnév)',
      occurrences: 1,
    },
    {
      id: 'a3',
      kind: 'identifier',
      fullName: '123 456 782',
      gender: 'N',
      role: 'TAJ-szám',
      identifierKind: 'taj',
      confidence: 0.92,
      evidence: 'TAJ-szám mintája illeszkedik; címke a szövegben: „TAJ”; az ellenőrzőszám érvényes',
      occurrences: 1,
    },
    {
      id: 'a4',
      kind: 'identifier',
      fullName: '11773016-11111018-00000000',
      gender: 'N',
      role: 'bankszámlaszám',
      identifierKind: 'bankszamlaszam',
      confidence: 0.9,
      evidence: 'bankszámlaszám mintája illeszkedik; az ellenőrzőszám érvényes',
      occurrences: 2,
    },
    {
      id: 'a5',
      kind: 'identifier',
      fullName: '18-09-104725',
      gender: 'N',
      role: 'cégjegyzékszám',
      identifierKind: 'cegjegyzekszam',
      /*
        SZÁNDÉKOSAN alacsony a magabiztosság, és szándékosan van benne
        „átnézendő" indoklás: a felületnek a bizonytalan azonosítót másképp kell
        mutatnia, mint a biztosat. Ha itt minden sor 0,9 fölött állna, ez az ág
        böngészőben sosem látszana.
      */
      confidence: 0.55,
      evidence: 'cégjegyzékszám mintája illeszkedik; a megyekód a szokásos tartományon kívül esik',
      occurrences: 1,
    },
  ],
  /*
    A modell FUTÁSÁNAK állapota. A négy állapot négy külön teendő a
    felhasználónak; itt az 'ok' áll, mert így a nem értelmezett címkék ága is
    végignézhető. A másik hármat átmenetileg ide írva lehet megnézni:
      { state: 'off' }
      { state: 'missing' }
      { state: 'failed', message: 'A modell-folyamat leállt (kód: 1).' }
  */
  model: {
    state: 'ok',
    entityCount: 34,
    unmappedLabels: 3,
    unmappedByLabel: { MISC: 2, DATE: 1 },
  },
  modelUsed: true,
  modelNote: 'A nyelvi modell 34 entitást talált 1412 ms alatt.',
  megszakitva: false,
};

/**
 * A LEÁLLÍTOTT vizsgálat eredménye.
 *
 * Nem üres lista, és ez a lényeg: a szerkezeti felismerés a valódi programban
 * is lefut leállítás után, mert az mintaillesztés, ezredmásodpercek alatt kész.
 * Ami kiesik, az kizárólag a nyelvi modell saját találata — itt a tanú, akit
 * egyetlen rovat sem nevez meg. Enélkül a helyettesítő adat azt sugallná, hogy
 * a Leállítás mindent eldob, és a felület ehhez a téves képhez igazodna.
 */
const DETECTION_MEGSZAKITVA: DetectionResult = {
  ...DETECTION,
  parties: DETECTION.parties.filter((p) => !p.evidence.includes('a nyelvi modell találta')),
  model: { state: 'off' },
  modelUsed: false,
  modelNote:
    'A vizsgálatot leállítottad, ezért a nyelvi modell nem olvasta végig az iratot. Ami a ' +
    'rovatokból és a szerkezeti mintákból kiderült, azt alább látod — a hiányzó feleket kézzel ' +
    'is felviheted, vagy indíthatsz új vizsgálatot.',
  megszakitva: true,
};

/**
 * A szimulált vizsgálat hossza — SZÁNDÉKOSAN LASSÚ.
 *
 * Böngészőben minden azonnal visszatér, és egy azonnal kész vizsgálaton nem
 * lehet kipróbálni sem a folyamatjelzőt, sem a Leállítás gombot. A valódi
 * futás egy hosszú iraton percekbe telik; ez a néhány másodperc annyit ad
 * vissza belőle, hogy a felület mindkét ága végigjárható legyen.
 */
const SZIMULALT_RESZEK = 14;
const SZIMULALT_RESZ_MS = 260;

export function installDevMock(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { szivecske?: unknown };
  if (w.szivecske) return;
  const wait = <T,>(v: T, ms = 380): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));
  const parties: PartyInput[] = [];
  /*
    A legutóbbi elemzés útja. A MENTÉS eredményének ugyanazt kell mondania,
    mint az elemzésnek: ha a mentés mindig hozná a program döntéseinek listáját,
    a jelentés az átnézős úton is megjelenne — ott pedig nincs mit jelenteni,
    mert minden döntést a felhasználó hozott.
  */
  let kerdezesNelkul = false;
  /* Az álkimenet is kövesse az összeg/dátum kapcsolót: az előnézet a valódi
     motornál a friss beállításokkal készül, a mocknak sem szabad a kapcsoló
     ellenére az eredeti értékeket mutatnia. */
  let osszegCsere = false;
  let datumTolas = false;
  /** A letöltés haladásának feliratkozója és a megszakítás jelzése. */
  let downloadProgress: ((p: DownloadProgress) => void) | null = null;
  let letoltesMegszakitva = false;
  /*
    A FELIRATKOZOTT VISSZAHÍVÁSOK. Az alkalmazásban ezeket a főfolyamat üzenetei
    hívják; itt a helyettesítő hívja őket magától, hogy a folyamatjelzők
    (névkészlet-gyártás, frissítés letöltése) böngészőben is mozogjanak.
  */
  let genStatus: ((s: TemaGenStatus) => void) | null = null;
  let updateProgress: ((p: UpdateProgress) => void) | null = null;
  let detectStatus: ((s: string) => void) | null = null;
  let detectProgress: ((p: DetectProgress) => void) | null = null;

  /*
    A SZIMULÁLT VIZSGÁLAT ÁLLAPOTA.

    `fut`: van-e mit leállítani — a `cancelDetect` ebből adja vissza, hogy volt-e
    értelme a kattintásnak. `megszakitva`: megkérték-e a leállítást; a szimulált
    lépések ezt nézik két várakozás között, ahogy a valódi főfolyamat is
    (`felismerestMegszakitottak`, electron/main.ts).
  */
  let vizsgalatFut = false;
  let vizsgalatMegszakitva = false;

  /** A haladás KÉT csatornán megy ki, ugyanabban a pillanatban — mint a valódiban. */
  const jelezd = (szakasz: FelismeresSzakasz, ablak = 0, ablakok = 0): void => {
    const merheto = ablakok > 0;
    const mondat: Record<FelismeresSzakasz, string> = {
      szoveg: 'Az irat szövegének beolvasása…',
      modell: 'A nyelvi modell betöltése…',
      vizsgalat: 'A nyelvi modell olvassa az iratot…',
      osszesites: 'A találatok összesítése…',
      kesz: 'A vizsgálat kész.',
      megszakitva: 'A vizsgálatot megszakítottad.',
    };
    const uzenet = merheto ? `${mondat[szakasz]} (${ablak}/${ablakok} rész)` : mondat[szakasz];
    detectProgress?.({
      szakasz,
      uzenet,
      ablak,
      ablakok,
      arany: merheto ? ablak / ablakok : null,
    });
    detectStatus?.(uzenet);
  };
  w.szivecske = {
    listThemes: () => wait(THEMES, 0),
    chooseDocument: () => wait(DOC.path),
    openDocument: () => wait(DOC),
    resolveRevisions: () => wait(DOC),
    /*
      A VIZSGÁLAT LASSÍTVA ÉS MEGSZAKÍTHATÓAN.

      Négy szakaszon megy végig, a harmadikat részekre bontva — ugyanaz a négy
      szakasz, amit a főfolyamat jelez. Enélkül a Leállítás gomb és a
      folyamatjelző böngészőben kipróbálhatatlan volna: egy azonnal visszatérő
      helyettesítőn a gomb sosem látszik, tehát a felület fejlesztője nem tudja
      megnézni, hogy mi történik utána.
    */
    detectParties: async () => {
      vizsgalatFut = true;
      vizsgalatMegszakitva = false;
      // A leállított vizsgálat NEM üres kézzel tér vissza: a szerkezeti
      // felismerés a valódi programban is lefut — lásd `DETECTION_MEGSZAKITVA`.
      const felad = (): DetectionResult => {
        jelezd('megszakitva');
        return DETECTION_MEGSZAKITVA;
      };
      try {
        jelezd('szoveg');
        await wait(undefined, 400);
        if (vizsgalatMegszakitva) return felad();

        jelezd('modell');
        await wait(undefined, 900);
        if (vizsgalatMegszakitva) return felad();

        for (let i = 1; i <= SZIMULALT_RESZEK; i++) {
          jelezd('vizsgalat', i, SZIMULALT_RESZEK);
          await wait(undefined, SZIMULALT_RESZ_MS);
          if (vizsgalatMegszakitva) return felad();
        }

        jelezd('osszesites');
        await wait(undefined, 300);
        jelezd('kesz');
        return DETECTION;
      } finally {
        vizsgalatFut = false;
      }
    },
    cancelDetect: () => {
      if (!vizsgalatFut) return wait(false, 0);
      vizsgalatMegszakitva = true;
      return wait(true, 0);
    },
    getSettings: () => wait(SETTINGS, 0),
    setSettings: (p: unknown) => wait(Object.assign(SETTINGS, p), 0),
    /*
      AZ IRATONKÉNTI ÉRTÉKEK UGYANOTT LAKNAK, mint a többi beállítás — a
      `SETTINGS` objektumban. Így a helyettesítőn is igaz, ami a valódi
      programban: a beállító oldalon állított névkészlet ugyanaz, amivel az
      elemzés fut, és a következő megnyitáskor ugyanazzal jön elő.
    */
    getUiState: () => wait(uiAllapot(), 0),
    setUiState: (p: unknown) => {
      const patch = p as { modeAsked?: boolean; iratBeallitas?: Partial<IratBeallitas> };
      if (typeof patch?.modeAsked === 'boolean') UI_STATE.modeAsked = patch.modeAsked;
      if (patch?.iratBeallitas) Object.assign(SETTINGS, patch.iratBeallitas);
      return wait(uiAllapot(), 0);
    },
    listModels: () => wait({ models: MODELS, diskUsage: 0, diskUsageLabel: "0 B" }, 0),
    /*
      A LETÖLTÉS HALADÁSSAL JÁR, nem egy csendes várakozással.

      Böngészőben eddig egyszerűen visszatért a lista, tehát a folyamatjelző, a
      Megszakítás gomb és a „letöltés kész” átmenet egyike sem volt
      kipróbálható — pedig a felület java része épp ezeken az állapotokon áll.
    */
    downloadModel: (id: string) =>
      new Promise((resolve, reject) => {
        letoltesMegszakitva = false;
        let lepes = 0;
        const modell = MODELS.find((m) => m.id === id);
        const osszes = modell?.totalBytes ?? 1;
        const idozito = setInterval(() => {
          if (letoltesMegszakitva) {
            clearInterval(idozito);
            downloadProgress?.({ modelId: id, file: '', receivedBytes: 0, totalBytes: osszes, ratio: 0, done: true });
            reject(new Error('A letöltést megszakítottad.'));
            return;
          }
          lepes += 1;
          const arany = Math.min(1, lepes / 12);
          downloadProgress?.({
            modelId: id,
            file: 'model.onnx',
            receivedBytes: Math.round(osszes * arany),
            totalBytes: osszes,
            ratio: arany,
            done: arany >= 1,
          });
          if (arany < 1) return;
          clearInterval(idozito);
          if (modell) {
            modell.state = 'installed';
            modell.bytesOnDisk = modell.totalBytes;
          }
          resolve(MODELS);
        }, 260);
      }),
    cancelDownload: () => {
      letoltesMegszakitva = true;
      return wait(undefined, 0);
    },
    removeModel: () => wait(MODELS, 0),
    onDownloadProgress: (cb: (p: DownloadProgress) => void) => {
      downloadProgress = cb;
      return () => {
        downloadProgress = null;
      };
    },
    onDetectStatus: (cb: (s: string) => void) => {
      detectStatus = cb;
      return () => {
        detectStatus = null;
      };
    },
    onDetectProgress: (cb: (p: DetectProgress) => void) => {
      detectProgress = cb;
      return () => {
        detectProgress = null;
      };
    },

    /*
      SAJÁT NÉVKÉSZLET.

      A gyártás lépésenként jelez, mert a valódi gyártás percekbe telik, és a
      folyamatjelző kipróbálhatatlan volna egy azonnal visszatérő
      helyettesítővel. A négy lépés itt gyorsított.
    */
    generateTheme: async (_temaSzoveg: string) => {
      for (let i = 1; i <= 4; i++) {
        genStatus?.({
          uzenet: `A modell javaslatokat készít (${i}. csoport)…`,
          lepes: i,
          lepesek: 4,
        });
        await wait(undefined, 500);
      }
      return GYARTOTT;
    },
    saveGeneratedTheme: () => {
      if (!THEMES.some((t) => t.id === 'sajat_gorog_mitologia')) {
        THEMES.push({
          id: 'sajat_gorog_mitologia',
          name: 'Görög mitológia',
          description: 'Saját névkészlet, nyelvi modell javaslatából, a program ragozó motorjával ellenőrizve.',
          licenseNote: '',
          givenCount: 6,
          surnameCount: 4,
          sample: ['Olümposzi Akhilleusz', 'Argoszi Kasszandra', 'Thébai Poszeidón'],
          sajat: true,
        });
      }
      return wait(THEMES, 200);
    },
    removeCustomTheme: (id: string) => {
      const i = THEMES.findIndex((t) => t.id === id);
      if (i >= 0) THEMES.splice(i, 1);
      return wait(THEMES, 120);
    },
    onThemeGenStatus: (cb: (s: TemaGenStatus) => void) => {
      genStatus = cb;
      return () => {
        genStatus = null;
      };
    },

    /*
      FRISSÍTÉS. A négy ág mind végigjárható: beállítatlan → beállítva és
      naprakész nincs (itt mindig van új) → letöltés folyamatjelzővel →
      újraindítás. A telepítés böngészőben nem tehet semmit, ezért csak szól.
    */
    /*
      MINDEN VÁLASZ MÁSOLAT, nem az `UPDATE` maga. A felület a kapott
      objektumot állapotba teszi; ugyanazt a hivatkozást visszaadva a React
      nem rajzolna újra, és a letöltés végét a képernyőn semmi nem jelezné —
      pontosan az a néma viselkedés, amit el akarunk kerülni.
    */
    updateState: () => wait({ ...UPDATE }, 0),
    setUpdateFeed: (url: string) => {
      const tiszta = url.trim();
      if (tiszta !== '' && !/^https:\/\//i.test(tiszta)) {
        return Promise.reject(
          new Error(
            'Ez a cím nem használható frissítésre. Teljes, https://-sel kezdődő webcím kell — ezen ' +
              'a csatornán futtatható program érkezik a gépedre.',
          ),
        );
      }
      UPDATE.feedUrl = tiszta;
      UPDATE.phase = tiszta === '' ? 'off' : 'idle';
      UPDATE.newVersion = '';
      UPDATE.notes = '';
      UPDATE.uzenet =
        tiszta === ''
          ? 'A frissítés még nincs bekapcsolva: nincs megadva, honnan töltse le a program az új változatot.'
          : 'A frissítési cím be van állítva. Kattints a keresésre.';
      return wait({ ...UPDATE }, 150);
    },
    checkUpdate: async () => {
      UPDATE.phase = 'checking';
      await wait(undefined, 700);
      UPDATE.phase = 'available';
      UPDATE.newVersion = '0.2.0';
      UPDATE.notes = 'Saját névkészletek, frissítés a menüből, új embléma.';
      UPDATE.uzenet = 'Új verzió érhető el: 0.2.0. A most futó a 0.1.0.';
      return { ...UPDATE };
    },
    downloadUpdate: async () => {
      UPDATE.phase = 'downloading';
      const total = 554_000_000;
      for (let i = 1; i <= 10; i++) {
        updateProgress?.({
          receivedBytes: Math.round((total * i) / 10),
          totalBytes: total,
          ratio: i / 10,
          bytesPerSecond: 4_200_000,
        });
        await wait(undefined, 220);
      }
      UPDATE.phase = 'ready';
      UPDATE.uzenet =
        'A 0.2.0 verzió letöltve. A telepítéshez a program bezárul, és a telepítő elindul — ' +
        'a megnyitott iratot ezért előbb mentsd el.';
      return { ...UPDATE };
    },
    installUpdate: () => {
      // eslint-disable-next-line no-console
      console.info('Szivecske: itt indulna a telepítő, és a program bezárulna.');
      return wait(undefined, 0);
    },
    onUpdateProgress: (cb: (p: UpdateProgress) => void) => {
      updateProgress = cb;
      return () => {
        updateProgress = null;
      };
    },
    /*
      AZ ÁLKIMENET IS ELVÉGZI A DÖNTÉSEKET.

      Régen ez a pont egy RÖGZÍTETT elemzést adott vissza, akármit kapott: a
      felületen minden gomb megnyomható volt, de semmi nem változott tőle.
      Ezzel épp az nem volt kipróbálható, ami a beállító lap lényege — hogy a
      sor gombjai, az iratra kattintás és a „Mindent cserélünk” mind ugyanabba
      a tárolóba írnak, és a képernyő ezt azonnal visszatükrözi.

      A számítás UGYANAZ, mint a motoré (`decideFor`, src/app/session.ts): az
      egyedi döntés a legerősebb, utána a fajtára szóló kapcsoló (összeg,
      dátum), végül — kérdezés nélküli módban — a felismerés fokozata.
    */
    analyze: (input: unknown) => {
      const i = input as {
        parties: PartyInput[];
        acceptReview?: boolean;
        decisions?: Record<number, 'accept' | 'skip'>;
        replaceAmounts?: boolean;
        shiftDates?: boolean;
      };
      parties.splice(0, parties.length, ...i.parties);
      kerdezesNelkul = i.acceptReview === true;
      osszegCsere = i.replaceAmounts === true;
      datumTolas = i.shiftDates === true;

      const osztaly = (entityId: string): 'skip' | undefined => {
        if (entityId === '#osszeg') return i.replaceAmounts === true ? undefined : 'skip';
        if (entityId === '#datum') return i.shiftDates === true ? undefined : 'skip';
        return undefined;
      };
      /*
        A HIVATALOS SZEREPLŐK AKKOR VANNAK BENT, HA A HÍVÓ ÁTADTA ŐKET.

        Pontosan úgy, ahogy a motor is dönt: a felület a kapcsoló
        bekapcsolásakor fűzi be őket a felek listájába (`runAnalysis`,
        ui/src/App.tsx). Külön kapcsolót figyelve az álkimenet és a felület
        szétcsúszhatna — így viszont a mock ugyanabból az egy jelből dolgozik,
        amiből a valódi motor.
      */
      const hivatalosBe = i.parties.some((p) => HIVATALOS_CAST.some((c) => c.entityId === p.id));
      const alapMatches = hivatalosBe ? [...MATCHES, ...HIVATALOS_MATCHES] : MATCHES;

      const matches: AnalysisResult['matches'] = alapMatches.map((m) => {
        const { decision, autoDecided, ...alap } = m;
        void decision;
        void autoDecided;
        const egyedi = i.decisions?.[m.id];
        if (egyedi !== undefined) return { ...alap, decision: egyedi };
        const fajta = osztaly(m.entityId);
        if (fajta !== undefined) return { ...alap, decision: fajta };
        if (!kerdezesNelkul || m.disposition === 'auto') return alap;
        return {
          ...alap,
          decision: (m.disposition === 'review' ? 'accept' : 'skip') as 'accept' | 'skip',
          autoDecided: true,
        };
      });

      const kimenet = (m: AnalysisResult['matches'][number]): 'csere' | 'bizonytalan' | 'nincs' => {
        if (m.decision === 'accept') return 'csere';
        if (m.decision === 'skip') return 'nincs';
        if (m.disposition === 'auto') return 'csere';
        if (m.disposition === 'review') return 'bizonytalan';
        return 'nincs';
      };
      const alap = kerdezesNelkul ? ANALYSIS_AUTO : ANALYSIS;
      return wait({
        ...alap,
        matches,
        outcomes: {
          csere: matches.filter((m) => kimenet(m) === 'csere').length,
          bizonytalan: matches.filter((m) => kimenet(m) === 'bizonytalan').length,
          nincs: matches.filter((m) => kimenet(m) === 'nincs').length,
        },
        // A szereplap „még döntésre vár" száma is a friss listából jön: enélkül
        // a sorok jelvénye és a lista állapota szétcsúszna.
        cast: [...alap.cast, ...(hivatalosBe ? HIVATALOS_CAST : [])].map((c) => ({
          ...c,
          pendingCount: matches.filter((m) => m.entityId === c.entityId && kimenet(m) === 'bizonytalan')
            .length,
        })),
      });
    },
    previewText: () => {
      let t = ANON_TEXT;
      if (osszegCsere) t = t.replace('3 550 000 Ft', '4 118 000 Ft');
      if (datumTolas) t = t.replace('2025. március 14.', '2025. június 2.');
      return wait(t, 0);
    },
    suggestOutputPath: () => wait(EXPORT.outputPath, 0),
    chooseSaveTarget: () => wait(EXPORT.outputPath),
    exportDocument: () =>
      wait(kerdezesNelkul ? { ...EXPORT, autoAccepted: AUTO_ACCEPTED } : EXPORT, 700),
    showItemInFolder: () => wait(undefined, 0),

    setDirty: (dirty: boolean) => {
      // Böngészőben ez a kilépés-védelem legközelebbi megfelelője: a lap
      // elhagyása előtt a böngésző kérdez rá, ahogy az alkalmazásban a
      // bezárás.
      window.onbeforeunload = dirty ? () => '' : null;
      return wait(undefined, 0);
    },
    /**
     * Böngészőben nincs natív ablakkeret, amit át lehetne színezni: a lap
     * fölött a böngésző saját sávja áll, ahhoz pedig nem nyúlhatunk. Ez a
     * hívás tehát böngészőben nem is FOG látszani — attól még itt kell lennie,
     * különben a párbeszédeket nyitó felületi kód a hiányzó hídponton állna
     * meg, és a fejlesztői mód épp azt az utat nem tudná megmutatni, ahol a
     * legtöbb párbeszéd van.
     *
     * Az állapotot mégis kiírjuk a gyökérelemre: a fejlesztői eszközökben így
     * ellenőrizhető, hogy a felület tényleg minden nyitáskor és záráskor szól-e
     * — a valódi hiba eddig épp az volt, hogy nem szólt senki.
     */
    ablakkeretetIgazit: (allapot: AblakkeretAllapot) => {
      document.documentElement.dataset.ablakkeret = allapot.halvanyitva
        ? `halvany-${allapot.tema}`
        : allapot.tema;
      return wait(undefined, 0);
    },
    appInfo: () => wait(APP_INFO, 0),
    /**
     * Böngészőben a behúzott fájlnak nincs útvonala, és nem is lehet: a lapnak
     * nincs fájlrendszere. A helyettesítő adat mégis ad egyet, hogy a ráejtés
     * útvonala — ejtés, megnyitás, felek — böngészőben is végigjárható legyen.
     */
    pathForFile: (_file: File) => DOC.path,
    chooseKeyFile: () => wait('C:\\Iratok\\keresetlevel-alnevesitett.szkulcs'),
    readKeyFile: (_path: string, passphrase: string) =>
      /*
        A hibás jelszó ága ugyanolyan fontos, mint a jó: a felület
        hibaüzenetét csak így lehet böngészőben végignézni. A felület 8
        karakter alatt el sem indítja a visszafejtést, ezért itt nem a
        rövidség a hiba, hanem az eltérés — a helyettesítő jelszó a
        „kulcsproba”. Az elutasítás szándékosan az OpenSSL angol mondatát adja
        vissza: a felületnek pontosan ezt kell magyarra fordítania.
      */
      passphrase !== 'kulcsproba'
        ? Promise.reject(new Error('Unsupported state or unable to authenticate data'))
        : wait(KEY_ENTRIES, 500),
    print: () => {
      window.print();
      return wait(undefined, 0);
    },
    onMenu: (cb: (action: MenuAction) => void) => {
      // A menüsor a böngészőben nincs meg, a gyorsbillentyűk viszont igen —
      // így a menühöz kötött útvonalak itt is végigjárhatók.
      const h = (e: KeyboardEvent): void => {
        if (!e.ctrlKey || e.altKey) return;
        const action = MENU_KEYS[e.key.toLowerCase()];
        if (!action) return;
        e.preventDefault();
        cb(action);
      };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    },
  };
  // eslint-disable-next-line no-console
  console.info('Szivecske: fejlesztői helyettesítő adat aktív (a program nem fut, csak a felület).');
}
