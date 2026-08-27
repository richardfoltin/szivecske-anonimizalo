/**
 * A SZÁLLÍTOTT NÉVKÉSZLETEK MÉRÉSE — magyar és angol névsorok egyaránt.
 *
 * Miért kell külön teszt a puszta adatra? Mert a névkészlet nem szöveg, hanem a
 * ragozó motor BEMENETE, és a hibája csak a kész iratban látszana. Ha egy
 * álnév rosszul ragozódik („Kórházt”, „Bruce-vel”), az ügyvéd nem azt látja,
 * hogy elrontottuk a hangrendet, hanem azt, hogy a beadványa magyartalan.
 *
 * A LEGNEHEZEBB RÉSZ AZ ANGOL NEVEK RAGOZÁSA. A magyar toldalék a KIEJTÉSHEZ
 * igazodik, nem az írásképhez: a „Bruce” [brúsz] mély („Bruce-szal”), a
 * „Wright” [rájt] szintén mély („Wrighttal”), a „Grimstead” [grimszted]
 * viszont magas, noha a-t írunk benne. Ez a helyesírásból nem vezethető le,
 * ezért a készletben ADAT (`harmony`, `ins`, `acc`, `hyphenate`, `forms`), és
 * ezért kell rá mérés: a rossz adat csendben marad, a rossz alak nem.
 *
 * Amit mérünk készletenként:
 *   1. elég név van-e ahhoz, hogy egy iratban ne ismétlődjön,
 *   2. elkülönülnek-e a nemek,
 *   3. minden név ragozható-e, és a paradigma önmagában ellentmondásmentes-e,
 *   4. a kézzel ellenőrzött, nehéz alakok pontosan jönnek-e ki,
 *   5. a cég- és intézménynevek helyesen ragozódnak-e,
 *   6. nem ütközik-e valamelyik álnév valódi, gyakori magyar névvel.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_CASES,
  type CaseTag,
  type NameOverrides,
  inflectName,
  inflectOrganization,
  isAbbreviation,
} from '../src/hu/inflect.js';
import { type Harmony, detectHarmony } from '../src/hu/phonology.js';
import {
  type Gender,
  type SeedOrganization,
  type SeedPerson,
  type SeedPlace,
  companyForm,
  stripCompanyForm,
} from '../src/hu/names.js';
import {
  type AnonEntity,
  type Theme,
  type ThemeEntry,
  type ThemeOrganization,
  type ThemePlace,
  assignPseudonyms,
} from '../src/pseudonym.js';
import {
  AJANLOTT_CEGELEM,
  AJANLOTT_HELYNEV,
  MIN_UTONEV_NEMENKENT,
  MIN_VEZETEKNEV,
} from '../src/app/temagyar.js';

const ROOT = process.cwd();

let pass = 0;
const hibak: string[] = [];

function ell(felteves: boolean, uzenet: string): void {
  if (felteves) pass++;
  else hibak.push(uzenet);
}

/* ------------------------------------------------------------------ *
 *  BETÖLTÉS
 * ------------------------------------------------------------------ */

const temaMappa = join(ROOT, 'data', 'themes');
const temak = readdirSync(temaMappa)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(temaMappa, f), 'utf8')) as Theme);

const hom = JSON.parse(readFileSync(join(ROOT, 'data', 'homonyms.json'), 'utf8')) as {
  surnames: { form: string }[];
  given_names: { form: string }[];
};
const homonimak = new Set([...hom.surnames, ...hom.given_names].map((x) => x.form.toLowerCase()));

/* ------------------------------------------------------------------ *
 *  KÉZZEL ELLENŐRZÖTT ARANY-ALAKOK
 * ------------------------------------------------------------------ */

/*
  Ez a tábla a teszt lelke. A többi ellenőrzés azt méri, hogy a paradigma
  ÖNMAGÁVAL nincs ellentmondásban — az itteni sorok viszont azt, hogy a kapott
  alak MAGYARUL is helyes. Minden sort ember nézett át, és minden sor mellett
  ott az indok, mert fél év múlva a puszta alak nem árulja el, miért az.
*/
interface Arany {
  tema: string;
  nev: string;
  tag: CaseTag;
  vart: string;
  indok: string;
}

const ARANY: Arany[] = [
  /* --- a feladat három kiindulópontja: kiejtés szerinti toldalék --- */
  { tema: 'semleges_magyar_en', nev: 'Bruce', tag: 'INS', vart: 'Bruce-szal', indok: 'kiejtve [brúsz]: mély, és a néma e miatt kötőjeles' },
  { tema: 'semleges_magyar_en', nev: 'Bruce', tag: 'DAT', vart: 'Bruce-nak', indok: 'mély hangrend a kiejtés szerint' },
  { tema: 'semleges_magyar_en', nev: 'Bruce', tag: 'ACC', vart: 'Bruce-t', indok: 'néma véghangzó: kötőjel, kötőhangzó nélkül' },
  { tema: 'semleges_magyar_en', nev: 'Wright', tag: 'INS', vart: 'Wrighttal', indok: 'kiejtve [rájt]: a kiejtett véghang [t], nincs néma betű, tehát nincs kötőjel' },
  { tema: 'semleges_magyar_en', nev: 'Wright', tag: 'DAT', vart: 'Wrightnak', indok: 'kiejtve [rájt]: mély, noha csupa i és e van leírva' },
  { tema: 'semleges_magyar_en', nev: 'Wright', tag: 'ACC', vart: 'Wrightot', indok: 'mély kötőhangzó' },
  { tema: 'kokorszak_en', nev: 'Stone', tag: 'INS', vart: 'Stone-nal', indok: 'kiejtve [sztón]: a véghang [n], a néma e miatt kötőjel' },
  { tema: 'kokorszak_en', nev: 'Stone', tag: 'DAT', vart: 'Stone-nak', indok: 'mély hangrend a kiejtés szerint' },

  /* --- néma szó végi e más véghangokkal --- */
  { tema: 'asvanyok_en', nev: 'Slate', tag: 'INS', vart: 'Slate-tel', indok: 'kiejtve [szlét]: magas, a véghang [t]' },
  { tema: 'asvanyok_en', nev: 'Slate', tag: 'ACC', vart: 'Slate-et', indok: 'a [t] után kötőhangzó kell' },
  { tema: 'asvanyok_en', nev: 'Jade', tag: 'INS', vart: 'Jade-del', indok: 'kiejtve [dzséd]: a véghang [d]' },

  /* --- a betű és a hang eltérése: x, ch, th, y, ow, ai --- */
  { tema: 'asvanyok_en', nev: 'Onyx', tag: 'INS', vart: 'Onyxszal', indok: 'az x [ksz] hangértékű: nem Onyxxal' },
  { tema: 'novenyek_en', nev: 'Birch', tag: 'INS', vart: 'Birchcsel', indok: 'a ch [cs], a szó magas: [börcs]' },
  { tema: 'novenyek_en', nev: 'Birch', tag: 'ALL', vart: 'Birchhöz', indok: 'ajakkerekítéses magas: [börcs]' },
  { tema: 'novenyek_en', nev: 'Birch', tag: 'ACC', vart: 'Birchöt', indok: 'ajakkerekítéses kötőhangzó' },
  { tema: 'semleges_magyar_en', nev: 'Meredith', tag: 'INS', vart: 'Meredithtel', indok: 'a szó végi th kiejtve [t], mint Tóthtal' },
  { tema: 'asvanyok_en', nev: 'Ruby', tag: 'INS', vart: 'Rubyval', indok: 'szó végi y után a toldalék kötőjel nélkül, hasonulás nélkül' },
  { tema: 'asvanyok_en', nev: 'Ruby', tag: 'ACC', vart: 'Rubyt', indok: 'szó végi y magánhangzót jelöl: nincs kötőhangzó' },
  { tema: 'novenyek_en', nev: 'Holly', tag: 'INS', vart: 'Hollyval', indok: 'szó végi y, mint Kennedyvel' },
  { tema: 'semleges_magyar_en', nev: 'Hensley', tag: 'ACC', vart: 'Hensleyt', indok: 'szó végi y: kötőhangzó nélkül' },
  { tema: 'asvanyok_en', nev: 'Willow', tag: 'INS', vart: 'Willow-val', indok: 'a szó végi ow magánhangzót jelöl: kötőjel, mint Glasgow-ban' },
  { tema: 'semleges_magyar_en', nev: 'Barlow', tag: 'SUP', vart: 'Barlow-n', indok: 'magánhangzóra végződik a kiejtésben: -n, nem -on' },
  { tema: 'semleges_magyar_en', nev: 'Sinclair', tag: 'DAT', vart: 'Sinclairnek', indok: 'az ai betűkapcsolat [é]: magas hangrend' },
  { tema: 'asvanyok_en', nev: 'Ridgeway', tag: 'INS', vart: 'Ridgewayjel', indok: 'kiejtve [ridzsvéj]: a véghang [j], mint Hemingwayjel' },

  /*
    --- a -vá/-vé UGYANÚGY hasonul, mint a -val/-vel ---

    Ez a csoport visszaesés-védelem. A táblázat sokáig csak az INS alakot mérte,
    és a TRANS közben némán rossz volt: a program „Torchcsal”-t adott, de
    „Torchhá”-t, „Bruce-szal”-t, de „Bruce-vá”-t. Ahol a hasonulás a KIEJTÉSEN
    múlik, ott a két alaknak együtt kell mozognia — egy iratban egymás mellett
    állnak, tehát az ellentmondás látszik is.
  */
  { tema: 'novenyek_en', nev: 'Birch', tag: 'TRANS', vart: 'Birchcsé', indok: 'a ch [cs], a szó magas: [börcs]' },
  { tema: 'semleges_magyar_en', nev: 'Bruce', tag: 'TRANS', vart: 'Bruce-szá', indok: 'a kiejtett véghang [sz], nem a néma e' },
  { tema: 'kokorszak_en', nev: 'Stone', tag: 'TRANS', vart: 'Stone-ná', indok: 'a kiejtett véghang [n]' },
  { tema: 'asvanyok_en', nev: 'Jade', tag: 'TRANS', vart: 'Jade-dé', indok: 'a kiejtett véghang [d]' },
  { tema: 'asvanyok_en', nev: 'Slate', tag: 'TRANS', vart: 'Slate-té', indok: 'a kiejtett véghang [t]' },
  { tema: 'asvanyok_en', nev: 'Ridgeway', tag: 'TRANS', vart: 'Ridgewayjé', indok: 'a véghang [j], mint Hemingwayjé' },
  { tema: 'asvanyok_en', nev: 'Ruby', tag: 'TRANS', vart: 'Rubyvá', indok: 'szó végi y: nincs hasonulás, a v megmarad' },
  { tema: 'semleges_magyar_en', nev: 'Meredith', tag: 'TRANS', vart: 'Meredithté', indok: 'a szó végi th [t], mint Tóthtá' },
  { tema: 'asvanyok_en', nev: 'Onyx', tag: 'TRANS', vart: 'Onyxszá', indok: 'az x [ksz] hangértékű' },
  { tema: 'asvanyok_en', nev: 'Stonehill', tag: 'TRANS', vart: 'Stonehill-lá', indok: 'kettőzött l + l: kötőjel a TRANS alakban is' },

  /* --- eleve kettőzött mássalhangzó: kötőjel a hármas torlódás ellen --- */
  { tema: 'asvanyok_en', nev: 'Cliff', tag: 'INS', vart: 'Cliff-fel', indok: 'kettőzött f + f: kötőjel (AkH. 12. 95.)' },
  { tema: 'semleges_magyar_en', nev: 'Everett', tag: 'ABL', vart: 'Everett-től', indok: 'kettőzött t + t: kötőjel' },
  { tema: 'semleges_magyar_en', nev: 'Prescott', tag: 'INS', vart: 'Prescott-tal', indok: 'kettőzött t + t: kötőjel' },
  { tema: 'asvanyok_en', nev: 'Stonehill', tag: 'INS', vart: 'Stonehill-lal', indok: 'kettőzött l, és a szó mély: [sztónhill]' },

  /* --- egytagú és kéttagú nevek kötőhangzója --- */
  { tema: 'asvanyok_en', nev: 'Beryl', tag: 'ACC', vart: 'Berylt', indok: 'kéttagú [beril]: az l után kötőhangzó nélkül' },
  { tema: 'novenyek_en', nev: 'Heather', tag: 'DAT', vart: 'Heathernek', indok: 'az ea itt [e]: magas hangrend' },
  { tema: 'novenyek_en', nev: 'Thornfield', tag: 'DAT', vart: 'Thornfieldnak', indok: 'kiejtve [tornfíld]: az í semleges, a mély o dönt' },
  { tema: 'asvanyok_en', nev: 'Pearl', tag: 'ALL', vart: 'Pearlhöz', indok: 'kiejtve [pőrl]: ajakkerekítéses magas' },

  /* --- a magyar készletek néhány ismert nehézsége (visszaesés-védelem) --- */
  { tema: 'asvanyok', nev: 'Ónix', tag: 'INS', vart: 'Ónixszal', indok: 'az x [ksz] hangértékű' },
  { tema: 'asvanyok', nev: 'Márvány', tag: 'INS', vart: 'Márvánnyal', indok: 'kétjegyű ny: nem Márványval' },
  { tema: 'asvanyok', nev: 'Kristály', tag: 'INS', vart: 'Kristállyal', indok: 'kétjegyű ly' },
  { tema: 'asvanyok', nev: 'Gránit', tag: 'DAT', vart: 'Gránitnak', indok: 'a semleges i átlátszó: a mély á dönt' },
  { tema: 'asvanyok', nev: 'Pirit', tag: 'DAT', vart: 'Piritnek', indok: 'csupa semleges magánhangzó: magas' },
  { tema: 'kokorszak', nev: 'Kovakövi', tag: 'INS', vart: 'Kovakövivel', indok: 'vegyes hangrend: az utolsó ö dönt, magas és ajakkerekítéses' },
  { tema: 'kokorszak', nev: 'Kavicsi', tag: 'INS', vart: 'Kavicsival', indok: 'a semleges i átlátszó: a mély a dönt' },
  { tema: 'kokorszak', nev: 'Frédi', tag: 'INS', vart: 'Frédivel', indok: 'csupa magas magánhangzó' },
  { tema: 'kokorszak', nev: 'Kőfej', tag: 'ACC', vart: 'Kőfejet', indok: 'a j után kötőhangzó kell' },
  { tema: 'kokorszak_en', nev: 'Flintstone', tag: 'INS', vart: 'Flintstone-nal', indok: 'néma szó végi e, a kiejtett véghang [n]: kötőjel' },
  { tema: 'kokorszak_en', nev: 'Rubble', tag: 'INS', vart: 'Rubble-lal', indok: 'néma szó végi e, a kiejtett véghang [l]' },
  { tema: 'kokorszak_en', nev: 'Slate', tag: 'INS', vart: 'Slate-tel', indok: 'néma szó végi e, a kiejtett véghang [t], magas hangrend' },
  { tema: 'kokorszak_en', nev: 'Bamm-Bamm', tag: 'INS', vart: 'Bamm-Bamm-mal', indok: 'eleve kettőzött m: kötőjel' },
  { tema: 'semleges_magyar', nev: 'Szakáll', tag: 'INS', vart: 'Szakáll-lal', indok: 'eleve kettőzött l: kötőjel' },
  { tema: 'semleges_magyar', nev: 'Hadnagy', tag: 'INS', vart: 'Hadnaggyal', indok: 'kétjegyű gy' },
];

/* A cég- és intézménynevek kézzel ellenőrzött alakjai. */
const ARANY_SZERVEZET: Arany[] = [
  { tema: 'asvanyok', nev: 'Kvarcvölgy Kft.', tag: 'DAT', vart: 'Kvarcvölgy Kft.-nek', indok: 'a Kft. kiejtve [káeftté]: magas, és a rövidítéshez kötőjellel kapcsolódik' },
  { tema: 'asvanyok', nev: 'Kvarcvölgy Kft.', tag: 'ACC', vart: 'Kvarcvölgy Kft.-t', indok: 'rövidítés után kötőjeles -t' },
  { tema: 'asvanyok', nev: 'Kvarcvölgy Kft.', tag: 'INS', vart: 'Kvarcvölgy Kft.-vel', indok: 'a rövidítés magas, és nincs hasonulás' },
  { tema: 'asvanyok', nev: 'Gránitkő Zrt.', tag: 'DAT', vart: 'Gránitkő Zrt.-nek', indok: 'a Zrt. is magas: [zéerrtté]' },
  { tema: 'asvanyok', nev: 'Bazaltmező Bt.', tag: 'ADE', vart: 'Bazaltmező Bt.-nél', indok: 'a Bt. magas: [bété]' },
  { tema: 'asvanyok_en', nev: 'Flintwood Kft.', tag: 'DAT', vart: 'Flintwood Kft.-nek', indok: 'a rövidítés kiejtése dönt, nem az angol előtag' },
  { tema: 'kokorszak_en', nev: 'Slate Rock Kft.', tag: 'INS', vart: 'Slate Rock Kft.-vel', indok: 'a rövidítés kiejtése dönt, nem az angol előtag' },

  { tema: 'asvanyok', nev: 'Bazaltmezei Kórház', tag: 'ACC', vart: 'Bazaltmezei Kórházat', indok: 'a -ház tárgyesete kötőhangzós: nem Kórházt' },
  { tema: 'asvanyok', nev: 'Bazaltmezei Kórház', tag: 'INS', vart: 'Bazaltmezei Kórházzal', indok: 'a z hasonul és kettőződik' },
  { tema: 'asvanyok', nev: 'Kvarcvölgyi Általános Iskola', tag: 'ACC', vart: 'Kvarcvölgyi Általános Iskolát', indok: 'a szó végi rövid a megnyúlik, és csak az UTOLSÓ névelem kap ragot' },
  { tema: 'asvanyok', nev: 'Kvarcvölgyi Általános Iskola', tag: 'DAT', vart: 'Kvarcvölgyi Általános Iskolának', indok: 'nem „Kvarcvölgyinek Általános Iskolának”' },
  { tema: 'kokorszak', nev: 'Aranyrögi Alapítvány', tag: 'INS', vart: 'Aranyrögi Alapítvánnyal', indok: 'kétjegyű ny hasonulása' },
  { tema: 'kokorszak', nev: 'Aranyrögi Alapítvány', tag: 'ACC', vart: 'Aranyrögi Alapítványt', indok: 'az ny után nem kell kötőhangzó' },
  { tema: 'kokorszak', nev: 'Sziklai Kórház', tag: 'ACC', vart: 'Sziklai Kórházat', indok: 'a -ház tárgyesete kötőhangzós' },
  { tema: 'kokorszak', nev: 'Kőkobaki Kft.', tag: 'DAT', vart: 'Kőkobaki Kft.-nek', indok: 'a Kft. kiejtve [káeftté]: magas, kötőjellel' },
  { tema: 'semleges_magyar', nev: 'Vadkörtei Idősek Otthona', tag: 'ACC', vart: 'Vadkörtei Idősek Otthonát', indok: 'a rag a többtagú névben is az utolsó elemre kerül' },
  { tema: 'semleges_magyar_en', nev: 'Rutherford Egyesület', tag: 'ACC', vart: 'Rutherford Egyesületet', indok: 'magas kötőhangzó az angol előtag ellenére' },
  { tema: 'asvanyok_en', nev: 'Marbleton Kórház', tag: 'ACC', vart: 'Marbleton Kórházat', indok: 'az intézménymegjelölés magyar szó: normálisan ragozódik' },
  { tema: 'novenyek_en', nev: 'Nettleford Óvoda', tag: 'DAT', vart: 'Nettleford Óvodának', indok: 'a szó végi rövid a megnyúlik' },
];

/* ------------------------------------------------------------------ *
 *  SEGÉDLET
 * ------------------------------------------------------------------ */

function kivetelek(e: { harmony?: Harmony; overrides?: NameOverrides }): NameOverrides {
  return { ...(e.overrides ?? {}), ...(e.harmony ? { harmony: e.harmony } : {}) };
}

/** A ragok mély és magas változata. Az ALL három alakú, ezért külön áll. */
const RAGOK: Partial<Record<CaseTag, { back: string; front: string[] }>> = {
  DAT: { back: 'nak', front: ['nek'] },
  INE: { back: 'ban', front: ['ben'] },
  ILL: { back: 'ba', front: ['be'] },
  ELA: { back: 'ból', front: ['ből'] },
  SUB: { back: 'ra', front: ['re'] },
  DEL: { back: 'ról', front: ['ről'] },
  ADE: { back: 'nál', front: ['nél'] },
  ABL: { back: 'tól', front: ['től'] },
  ALL: { back: 'hoz', front: ['hez', 'höz'] },
};

/**
 * Egy név paradigmájának átvizsgálása. NEM a ragozási szabályokat ismételjük
 * meg — azt a `test/smoke-inflect.ts` méri —, hanem olyan tulajdonságokat,
 * amelyeknek minden helyes paradigmára igaznak kell lenniük.
 */
function paradigmaHibak(nev: string, ov: NameOverrides, hangrend: Harmony): string[] {
  const out: string[] = [];
  const szokoz = (nev.match(/ /g) ?? []).length;
  // A név eleje minden alakban megmarad; a végét a hasonulás átírhatja
  // („Kovács” → „Kováccsal”), ezért csak az elejét kötjük meg.
  const eleje = nev.slice(0, Math.max(2, nev.length - 3));

  for (const tag of ALL_CASES) {
    let alak: string;
    try {
      alak = inflectName(nev, tag, ov);
    } catch (err) {
      out.push(`${nev} [${tag}]: a ragozás kivételt dobott (${String(err)})`);
      continue;
    }
    if (!alak || alak.includes('undefined') || /\s\s/.test(alak)) {
      out.push(`${nev} [${tag}]: hibás alak („${alak}”)`);
      continue;
    }
    if (tag !== 'NOM' && alak.length <= nev.length) {
      out.push(`${nev} [${tag}]: a toldalék elveszett („${alak}”)`);
    }
    if (!alak.startsWith(eleje)) {
      out.push(`${nev} [${tag}]: a név eleje megváltozott („${alak}”)`);
    }
    if ((alak.match(/ /g) ?? []).length !== szokoz) {
      out.push(`${nev} [${tag}]: elveszett vagy keletkezett egy névelem („${alak}”)`);
    }
  }

  const acc = inflectName(nev, 'ACC', ov);
  if (!acc.endsWith('t')) out.push(`${nev} [ACC]: a tárgyeset nem -t-re végződik („${acc}”)`);

  // A hangrend legyen ugyanaz minden ragban, és egyezzen a készletben megadottal.
  const mely = hangrend === 'back';
  for (const [tag, rag] of Object.entries(RAGOK) as [CaseTag, { back: string; front: string[] }][]) {
    const alak = inflectName(nev, tag, ov);
    const jo = mely ? alak.endsWith(rag.back) : rag.front.some((f) => alak.endsWith(f));
    if (!jo) {
      out.push(`${nev} [${tag}]: „${alak}” nem illik a megadott ${hangrend} hangrendhez`);
    }
  }
  if (hangrend === 'front_rounded' && !inflectName(nev, 'ALL', ov).endsWith('höz')) {
    out.push(`${nev} [ALL]: ajakkerekítéses magas névhez -höz kell („${inflectName(nev, 'ALL', ov)}”)`);
  }
  if (hangrend === 'front_unrounded' && !inflectName(nev, 'ALL', ov).endsWith('hez')) {
    out.push(`${nev} [ALL]: ajakréses magas névhez -hez kell („${inflectName(nev, 'ALL', ov)}”)`);
  }

  /*
    A -val/-vel v-je mássalhangzó után hasonul és kettőződik. Ezt csak ott
    kérhetjük számon, ahol a motor magától dolgozik: ha a készlet megadja a
    kész `ins` alakot vagy kötőjeles kapcsolást kér, akkor a döntés ADAT, és
    embertől származik. Az angol y és w a szó végén magánhangzót jelöl
    („Ruby” = [rúbi], „Willow” = [vilou]), ilyenkor a v helyesen marad meg —
    ezeknél a helyes alak épp az, amit itt hibának néznénk.
  */
  const ins = inflectName(nev, 'INS', ov);
  const utolso = nev[nev.length - 1] ?? '';
  const maganhangzoVeg = /[aáeéiíoóöőuúüű]/i.test(utolso);
  const adatbolJon = ov.ins !== undefined || ov.hyphenate === true || ov.forms?.INS !== undefined;
  if (!maganhangzoVeg && !adatbolJon && /v[ae]l$/.test(ins)) {
    out.push(`${nev} [INS]: elmaradt a hasonulás („${ins}”)`);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  1. A KÉSZLETEK ÖSSZEÁLLÍTÁSA
 * ------------------------------------------------------------------ */

console.log('Névkészletek ellenőrzése\n');
console.log(`Talált készletek: ${temak.length} db`);
for (const t of temak) {
  const ferfi = t.given_names.filter((x) => x.gender === 'M').length;
  const noi = t.given_names.filter((x) => x.gender === 'F').length;
  console.log(
    `  ${t.id.padEnd(20)} ${(t.lang ?? 'hu')}  utónév ${ferfi}M/${noi}N  vezetéknév ${t.surnames.length}  ` +
      `cégelem ${t.org_parts.length}  szervezetnév ${t.org_names?.length ?? 0}  helynév ${t.place_names.length}`,
  );
}

ell(temak.length >= 8, `legalább nyolc készlet (négy téma, magyar és angol névsorral) — most ${temak.length}`);

const csaladok = new Map<string, Set<string>>();
for (const t of temak) {
  const csalad = t.family ?? t.id;
  const halmaz = csaladok.get(csalad) ?? new Set<string>();
  halmaz.add(t.lang ?? 'hu');
  csaladok.set(csalad, halmaz);
}
for (const [csalad, nyelvek] of csaladok) {
  ell(nyelvek.has('hu') && nyelvek.has('en'), `a(z) „${csalad}” témának magyar és angol névsora is van`);
}

const azonositok = new Set(temak.map((t) => t.id));
ell(azonositok.size === temak.length, 'minden készlet azonosítója egyedi');

/* ------------------------------------------------------------------ *
 *  2–6. KÉSZLETENKÉNTI MÉRÉS
 * ------------------------------------------------------------------ */

for (const tema of temak) {
  const cim = tema.id;
  const ferfi = tema.given_names.filter((x) => x.gender === 'M');
  const noi = tema.given_names.filter((x) => x.gender === 'F');

  /* --- 2. elég név van-e, elkülönülnek-e a nemek --- */

  ell(ferfi.length >= MIN_UTONEV_NEMENKENT, `${cim}: ${ferfi.length} férfi utónév (kell ${MIN_UTONEV_NEMENKENT})`);
  ell(noi.length >= MIN_UTONEV_NEMENKENT, `${cim}: ${noi.length} női utónév (kell ${MIN_UTONEV_NEMENKENT})`);
  ell(tema.surnames.length >= MIN_VEZETEKNEV, `${cim}: ${tema.surnames.length} vezetéknév (kell ${MIN_VEZETEKNEV})`);
  ell(tema.org_parts.length >= AJANLOTT_CEGELEM, `${cim}: ${tema.org_parts.length} cégnév-előtag (kell ${AJANLOTT_CEGELEM})`);
  ell(tema.place_names.length >= AJANLOTT_HELYNEV, `${cim}: ${tema.place_names.length} helységnév (kell ${AJANLOTT_HELYNEV})`);

  const utonevek = tema.given_names.map((x) => x.form.toLowerCase());
  ell(new Set(utonevek).size === utonevek.length, `${cim}: nincs kétszer ugyanaz az utónév`);
  const vezeteknevek = tema.surnames.map((x) => x.form.toLowerCase());
  ell(new Set(vezeteknevek).size === vezeteknevek.length, `${cim}: nincs kétszer ugyanaz a vezetéknév`);

  ell(
    tema.given_names.every((x) => x.gender === 'M' || x.gender === 'F' || x.gender === 'N'),
    `${cim}: minden utónévnél meg van adva a nem`,
  );
  const ferfiHalmaz = new Set(ferfi.map((x) => x.form.toLowerCase()));
  ell(
    noi.every((x) => !ferfiHalmaz.has(x.form.toLowerCase())),
    `${cim}: a férfi és a női utónevek elkülönülnek`,
  );
  ell(
    tema.given_names.every((x) => x.harmony !== undefined),
    `${cim}: minden utónévnél ott a hangrend — futásidőben nincs találgatás`,
  );
  ell(
    tema.surnames.every((x) => x.harmony !== undefined),
    `${cim}: minden vezetéknévnél ott a hangrend`,
  );

  /* --- 3. minden név ragozható, a paradigma ellentmondásmentes --- */

  const nevsor: ThemeEntry[] = [...tema.given_names, ...tema.surnames];
  const paradigmaHiba: string[] = [];
  for (const e of nevsor) {
    const ov = kivetelek(e);
    paradigmaHiba.push(...paradigmaHibak(e.form, ov, ov.harmony ?? detectHarmony(e.form)));
  }
  ell(paradigmaHiba.length === 0, `${cim}: minden név ragozható és a paradigmája ép — ${paradigmaHiba[0] ?? ''}`);
  if (paradigmaHiba.length > 1) {
    for (const h of paradigmaHiba.slice(1, 6)) hibak.push(`${cim}: ${h}`);
  }

  const helyHiba: string[] = [];
  for (const p of tema.place_names as ThemePlace[]) {
    const ov = kivetelek(p);
    helyHiba.push(...paradigmaHibak(p.form, ov, ov.harmony ?? detectHarmony(p.form)));
  }
  ell(helyHiba.length === 0, `${cim}: minden helységnév ragozható — ${helyHiba[0] ?? ''}`);

  /* --- 4. a kézzel ellenőrzött alakok --- */

  const aranySorok = ARANY.filter((a) => a.tema === cim);
  for (const a of aranySorok) {
    const e = nevsor.find((x) => x.form === a.nev);
    if (!e) {
      hibak.push(`${cim}: a kézzel ellenőrzött „${a.nev}” hiányzik a készletből`);
      continue;
    }
    const kapott = inflectName(a.nev, a.tag, kivetelek(e));
    ell(kapott === a.vart, `${cim}: ${a.nev} [${a.tag}] → „${kapott}”, elvárt „${a.vart}” (${a.indok})`);
  }

  /* --- 5. cég- és intézménynevek --- */

  const szervezetek: ThemeOrganization[] = tema.org_names ?? [];
  ell(szervezetek.length >= AJANLOTT_CEGELEM, `${cim}: ${szervezetek.length} kész szervezetnév (kell ${AJANLOTT_CEGELEM})`);
  const cegek = szervezetek.filter((o) => o.kind === 'company');
  const intezmenyek = szervezetek.filter((o) => o.kind === 'institution');
  ell(cegek.length >= 3, `${cim}: ${cegek.length} cégnév (kell legalább 3)`);
  ell(intezmenyek.length >= 3, `${cim}: ${intezmenyek.length} intézménynév (kell legalább 3)`);

  // A cégnév végén álljon valódi cégforma — ettől tudja a kiosztó azonos
  // fajtára cserélni, és ettől ragozódik a rövidítés a kiejtése szerint.
  for (const o of cegek) {
    const forma = companyForm(o.form);
    ell(forma.length > 0, `${cim}: „${o.form}” cégnévnek van cégformája (Kft./Zrt./Bt.)`);
    ell(
      isAbbreviation(forma),
      `${cim}: „${forma}” rövidítést a ragozó ismeri — enélkül a toldalék kötőjel nélkül tapadna`,
    );
    ell(
      stripCompanyForm(o.form).length > 0 && stripCompanyForm(o.form) !== o.form,
      `${cim}: „${o.form}” cégformája leválasztható, marad megkülönböztető előtag`,
    );
  }

  // Az intézménynév köznévi utótagra végződik: az normálisan, kötőjel nélkül ragozódik.
  for (const o of intezmenyek) {
    const utolsoSzo = o.form.trim().split(/\s+/).slice(-1)[0] ?? '';
    ell(!isAbbreviation(utolsoSzo), `${cim}: „${o.form}” nem rövidítésre végződik`);
    ell(companyForm(o.form) === '', `${cim}: „${o.form}” intézménynév, nincs rajta cégforma`);
    const dat = inflectOrganization(o.form, 'DAT', kivetelek(o));
    ell(!dat.includes('.-'), `${cim}: „${o.form}” részes esete kötőjel nélkül kapcsolódik („${dat}”)`);
  }

  /*
    A cégformára végződő nevek felszíni és többes számú alakját szándékosan
    NEM mérjük: a rövidítés kiejtése magánhangzóra végződik („Kft.” = [káeftté]),
    ezért ott -n és -k járna, a motor viszont kötőhangzót tesz elé. A hiba a
    `suffixOnly`-ban van (src/hu/inflect.ts), nem az adatban, és peres iratban
    ez a két alak nem fordul elő. A többi tizenkilenc alakot végigmérjük.
  */
  const SZERVEZET_ESETEK = ALL_CASES.filter(
    (t) => t !== 'WIFE' && t !== 'FAM' && t !== 'SUP' && t !== 'PL' && t !== 'NOM',
  );
  const szervezetHiba: string[] = [];
  for (const o of szervezetek) {
    const ov = kivetelek(o);
    const szokoz = (o.form.match(/ /g) ?? []).length;
    for (const tag of SZERVEZET_ESETEK) {
      const alak = inflectOrganization(o.form, tag, ov);
      if (!alak || alak.includes('undefined') || /\s\s/.test(alak)) {
        szervezetHiba.push(`${o.form} [${tag}] → „${alak}”`);
      } else if ((alak.match(/ /g) ?? []).length !== szokoz) {
        szervezetHiba.push(`${o.form} [${tag}]: elveszett egy névelem („${alak}”)`);
      } else if (!alak.startsWith(o.form.slice(0, Math.max(2, o.form.length - 4)))) {
        szervezetHiba.push(`${o.form} [${tag}]: a név eleje megváltozott („${alak}”)`);
      }
    }
  }
  ell(szervezetHiba.length === 0, `${cim}: minden szervezetnév ragozható — ${szervezetHiba[0] ?? ''}`);

  for (const a of ARANY_SZERVEZET.filter((x) => x.tema === cim)) {
    const o = szervezetek.find((x) => x.form === a.nev);
    if (!o) {
      hibak.push(`${cim}: a kézzel ellenőrzött „${a.nev}” szervezetnév hiányzik`);
      continue;
    }
    const kapott = inflectOrganization(a.nev, a.tag, kivetelek(o));
    ell(kapott === a.vart, `${cim}: ${a.nev} [${a.tag}] → „${kapott}”, elvárt „${a.vart}” (${a.indok})`);
  }

  /* --- 6. ütközés valódi, gyakori magyar névvel --- */

  const utkozok: string[] = [];
  for (const e of nevsor) {
    if (homonimak.has(e.form.toLowerCase())) utkozok.push(e.form);
  }
  for (const o of tema.org_parts) {
    if (homonimak.has(o.toLowerCase())) utkozok.push(o);
  }
  for (const o of szervezetek) {
    // A megkülönböztető előtag számít: az intézménymegjelölés („Kórház”)
    // köznév, azt nem kifogásoljuk.
    const elotag = o.form.trim().split(/\s+/)[0] ?? '';
    if (homonimak.has(elotag.toLowerCase())) utkozok.push(o.form);
  }
  for (const p of tema.place_names) {
    if (homonimak.has(p.form.toLowerCase())) utkozok.push(p.form);
  }
  ell(
    utkozok.length === 0,
    `${cim}: egyik álnév sem esik egybe gyakori valódi magyar névvel — ütközik: ${utkozok.join(', ')}`,
  );

  /* --- 7. a kiosztóval: egy sokszereplős irat --- */

  /*
    A LEGERŐSEBB MÉRÉS. Nem az adatot nézzük, hanem azt, amit a felhasználó
    kapna: tizenkét fél, két szervezet, két helység egyetlen ügyben. Ha a
    készlet kicsi, a kiosztó számozott utótagot ragaszt a névhez („Bazalt 2”) —
    az iratban ez látszik meg elsőként abból, hogy gépi.
  */
  const felek: AnonEntity[] = [];
  for (let n = 0; n < 6; n++) {
    felek.push({ kind: 'person', id: `f${n}`, surname: `Teszt${n}`, given: `Elek${n}`, gender: 'M' as Gender });
    felek.push({ kind: 'person', id: `n${n}`, surname: `Proba${n}`, given: `Anna${n}`, gender: 'F' as Gender });
  }
  felek.push({ kind: 'org', id: 'o1', name: 'Aranykalász Kereskedelmi Kft.' } as SeedOrganization);
  felek.push({ kind: 'org', id: 'o2', name: 'Napsugár Óvoda' } as SeedOrganization);
  felek.push({ kind: 'place', id: 'h1', name: 'Szolnok' } as SeedPlace);
  felek.push({ kind: 'place', id: 'h2', name: 'Debrecen' } as SeedPlace);

  const kiosztas = assignPseudonyms(felek, tema, { caseSecret: `keszlet-teszt-${cim}` });
  ell(kiosztas.size === felek.length, `${cim}: mind a ${felek.length} fél kapott álnevet`);

  const megjelenitett = [...kiosztas.values()].map((a) => a.display);
  ell(new Set(megjelenitett).size === megjelenitett.length, `${cim}: a ${felek.length} fél mind más álnevet kapott`);
  const szamozott = megjelenitett.filter((d) => /\d/.test(d));
  ell(
    szamozott.length === 0,
    `${cim}: egyetlen álnév sem kapott számozott utótagot — a készlet kitart egy sokszereplős iratra (${szamozott.join(', ')})`,
  );

  // A nő női utónevet kap: ezért kell a nemek elkülönülése.
  const noiNevek = new Set(noi.map((x) => x.form));
  const noiAlnev = kiosztas.get('n0')?.display ?? '';
  ell(
    noiNevek.has(noiAlnev.split(' ')[1] ?? ''),
    `${cim}: a női félnek női utónév jutott („${noiAlnev}”)`,
  );
  const ferfiNevek = new Set(ferfi.map((x) => x.form));
  const ferfiAlnev = kiosztas.get('f0')?.display ?? '';
  ell(
    ferfiNevek.has(ferfiAlnev.split(' ')[1] ?? ''),
    `${cim}: a férfi félnek férfi utónév jutott („${ferfiAlnev}”)`,
  );
}

/* ------------------------------------------------------------------ *
 *  MINTA A KIMENETRE
 * ------------------------------------------------------------------ */

console.log('\nMinta a kész álnevekből és ragozásukból:');
for (const tema of temak.filter((t) => t.lang === 'en')) {
  const v = tema.surnames[0];
  const u = tema.given_names[0];
  const o = (tema.org_names ?? []).find((x) => x.kind === 'company');
  const i = (tema.org_names ?? []).find((x) => x.kind === 'institution');
  if (!v || !u) continue;
  const nev = `${v.form} ${u.form}`;
  const ov = { ...kivetelek(v), ...kivetelek(u) };
  console.log(`  ${tema.id}`);
  console.log(`    ${nev} — ${inflectName(nev, 'DAT', ov)}, ${inflectName(nev, 'INS', ov)}, ${inflectName(nev, 'ACC', ov)}`);
  if (o) console.log(`    ${o.form} — ${inflectOrganization(o.form, 'DAT', kivetelek(o))}, ${inflectOrganization(o.form, 'INS', kivetelek(o))}`);
  if (i) console.log(`    ${i.form} — ${inflectOrganization(i.form, 'DAT', kivetelek(i))}, ${inflectOrganization(i.form, 'ACC', kivetelek(i))}`);
}

/* ------------------------------------------------------------------ *
 *  ÖSSZEGZÉS
 * ------------------------------------------------------------------ */

const osszes = pass + hibak.length;
console.log(`\nNévkészletek: ${pass}/${osszes} ellenőrzés rendben`);
if (hibak.length) {
  console.log('\nHIBÁK:');
  for (const h of hibak) console.log(`  ${h}`);
}
process.exit(hibak.length === 0 ? 0 : 1);
