/**
 * Álnév-hozzárendelés és csere.
 *
 * A négy csere-mód a felmérés jogi részéből következik:
 *  - 'theme'    témás álnév (Kőszikla Fréd)          — belső használatra, LLM-nek
 *  - 'role'     eljárási szerep (I. r. alperes)      — bíróságra menő irathoz (Bszi./OBH)
 *  - 'type'     adatfajta neve ([lakcím])            — védett adatokra, OBH 4/2021 §10(2)
 *  - 'numbered' számozott címke ([NÉV-1])            — semleges, gépi feldolgozáshoz
 *
 * A hozzárendelés determinisztikus: ugyanaz a név ugyanabban az ügyben mindig
 * ugyanazt az álnevet kapja, akkor is, ha a leképezési táblát még nem töltöttük be.
 */

import { createHmac } from 'node:crypto';
import type { AzonositoKind } from './hu/azonositok.js';
import { buildFragments, rewriteIdentifier } from './hu/identifiers.js';
import { type Harmony, needsAz } from './hu/phonology.js';
import { type CaseTag, type NameOverrides, inflectName, inflectWord } from './hu/inflect.js';
import {
  type CoreShape,
  type Gender,
  type SeedEntity,
  type SeedOrganization,
  type SeedPerson,
  type SeedPlace,
  companyForm,
  entityCores,
  stripCompanyForm,
} from './hu/names.js';
import { type Match, SeedMatcher } from './hu/matcher.js';

export type ReplacementMode = 'theme' | 'role' | 'type' | 'numbered';

/**
 * Egy hivatalos azonosító mint kitakarandó adat: adószám, TAJ, lakcím, IBAN.
 *
 * Azért ITT lakik, és nem a `hu/names.ts`-ben a többi `Seed*` mellett, mert nem
 * NÉV: a `names.ts` teljes gépezete — ragozás, becézés, monogram, asszonynév —
 * értelmezhetetlen egy számsoron. Az azonosító a névvel csak abban közös, hogy
 * álnevesíteni kell; a `names.ts` egyetlen függvényét sem hívjuk rá.
 */
export interface SeedIdentifier {
  kind: 'identifier';
  id: string;
  /**
   * A felszíni alak, ahogy az iratban áll ("8442130976"). A mezőnév
   * szándékosan `name`, mint a szervezetnél és a helynévnél: így a
   * hozzárendelés kézi felülírása egyetlen ágon kezelheti mindhármat.
   */
  name: string;
  /** Melyik azonosítófajta — ebből lesz az adatfajta-címke a kimenetben. */
  identifierKind: AzonositoKind;
}

/**
 * Amit a program álnevesíteni tud. A `SeedEntity` (név) és a `SeedIdentifier`
 * (azonosító) együtt; a kettőt a `kind === 'identifier'` vizsgálat választja el.
 */
export type AnonEntity = SeedEntity | SeedIdentifier;

export interface ThemeEntry {
  form: string;
  gender?: Gender;
  harmony?: Harmony;
  /** Megjegyzés a rendhagyóságról; üres, ha szabályos. */
  notes?: string;
  /** Előre kiszámított kivételek — ez teszi a futásidőt találgatásmentessé. */
  overrides?: NameOverrides;
}

export interface ThemePlace {
  form: string;
  /** -n vagy -ban: a magyar helynevek lexikálisan oszlanak meg. */
  locative?: 'sup' | 'ine';
  overrides?: NameOverrides;
}

/**
 * Kész cég- vagy intézménynév a témacsomagból.
 *
 * Miért nem elég az `org_parts`? Az csak a megkülönböztető ELŐTAG (egy szó), a
 * mögötte álló cégformát vagy intézménymegjelölést a kiosztó az EREDETI névből
 * őrzi meg. Így viszont a témacsomag nem tud ragozási adatot adni az utótaghoz,
 * pedig az utótag az, ami ragot kap: a „Kórház” tárgyesete kötőhangzós
 * („Kórházat”), amit a motor szabályból nem talál el. Ezért a kész név és a
 * hozzá tartozó `overrides` együtt, egy bejegyzésben lakik.
 *
 * A `kind` azért kell, hogy a kiosztó azonos fajtát cserélhessen azonosra: egy
 * kórházból ne legyen Kft., mert az a mondat értelmét változtatná meg.
 */
export interface ThemeOrganization {
  /** A teljes név a cégformával vagy az intézménymegjelöléssel együtt. */
  form: string;
  /** 'company': Kft., Zrt., Bt. — 'institution': iskola, kórház, hivatal, alapítvány. */
  kind: 'company' | 'institution';
  /** Megjegyzés a rendhagyóságról; üres, ha szabályos. */
  notes?: string;
  /** Előre kiszámított kivételek az UTOLSÓ névelemre — az kapja a ragot. */
  overrides?: NameOverrides;
}

export interface Theme {
  id: string;
  /**
   * A névsor nyelve. Hiánya magyart jelent: a régi, még nyelvjelölés nélküli
   * csomagok és a felhasználó saját készletei mind magyar nevekből állnak.
   */
  lang?: 'hu' | 'en';
  /**
   * Az azonos témájú, de más nyelvű csomagok közös azonosítója — ettől tud a
   * felület EGY témát mutatni nyelvváltóval, nem kétszer ugyanazt a témát.
   * Hiánya azt jelenti, hogy a csomag egyedül áll: ilyenkor az `id` a család.
   */
  family?: string;
  name_hu: string;
  description_hu: string;
  license_note: string;
  given_names: ThemeEntry[];
  surnames: ThemeEntry[];
  org_parts: string[];
  /**
   * Kész cég- és intézménynevek. Opcionális: a felhasználó saját, nyelvi
   * modellel gyártott készletében nincs, és enélkül is működik a program —
   * olyankor az `org_parts` előtagjaiból áll össze a szervezetnév.
   */
  org_names?: ThemeOrganization[];
  place_names: ThemePlace[];
}

export interface Assignment {
  entityId: string;
  /** Az eredeti név megjelenítéshez (a szereplap "Eredeti" oszlopa). */
  original: string;
  /** Az álnév megjelenítéshez (a "Csereszöveg" oszlop). */
  display: string;
  /** Az álnév mint entitás — ebből származik minden ragozott alak. */
  pseudo: AnonEntity;
  /** Igaz, ha a felhasználó kézzel írta felül. */
  manual: boolean;
}

/** Determinisztikus, de kiszámíthatatlan index az ügy titkos kulcsából. */
function deterministicIndex(secret: string, key: string, modulo: number): number {
  if (modulo <= 0) return 0;
  const digest = createHmac('sha256', secret).update(key.toLowerCase()).digest();
  // Az első 6 bájt bőven elég, és elkerüli a 32 bites előjeles problémát.
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i]!;
  return n % modulo;
}

function toOverrides(e: ThemeEntry): NameOverrides {
  return { ...(e.overrides ?? {}), ...(e.harmony ? { harmony: e.harmony } : {}) };
}

export interface AssignOptions {
  /**
   * Az ügy titkos kulcsa; ugyanaz a kulcs ugyanazt a leképezést adja.
   *
   * FIGYELEM, MIT NEM DÖNT EL: ha a hívó megadja az `appearanceOrder`-t, akkor
   * az ott felsorolt felek álnevét a MEGJELENÉS SORRENDJE választja ki, nem ez
   * a kulcs (lásd `appearanceOrder`). A kulcs azoknál a feleknél marad döntő,
   * akik a felsorolásban nincsenek benne — nekik nincs megjelenési helyük,
   * tehát nincs mihez képest prioritásuk.
   */
  caseSecret: string;
  /**
   * Ha igaz, a hasonló hosszúságú álnevet részesíti előnyben (elrendezés miatt).
   *
   * PRIORITÁSI MÓDBAN NEM ÉRVÉNYES, és ez tudatos: a hosszegyeztetés elrendezési
   * kényelem (a csere ne törje máshol a sort), a prioritási sorrend viszont
   * kimondott elvárás arról, hogy a főszereplő melyik nevet kapja. A kettő
   * ugyanarra a döntésre pályázik, és egyszerre nem teljesülhet — a „Nagy”
   * vezetéknévhez (4 betű) hosszban a „Kőfej” illik, nem a lista élén álló
   * „Kovakövi” (8 betű). Ilyenkor a prioritás nyer.
   */
  preferSimilarLength?: boolean;
  /**
   * A felek azonosítói abban a sorrendben, ahogy az IRATBAN ELŐSZÖR MEGJELENNEK.
   *
   * A témacsomagok névsorai PRIORITÁSI LISTÁK: elöl állnak a téma legjellemzőbb
   * nevei (a kőkorszaki készletben „Kovakövi” és „Frédi”, a sorozat két
   * főszereplője). Aki ebben a felsorolásban előbb áll, az a lista elejéről kap
   * nevet; az elsőként megjelenő fél az első szabad nevet.
   *
   * AMIT EZ FELAD, ÉS MIÉRT VÁLLALHATÓ. A kulcsból számolt (HMAC-es) kiosztás
   * ÖNMAGÁBAN a névhez kötötte az álnevet: „Kovács János” ugyanabban az ügyben
   * mindig ugyanazt kapta, akárki más szerepelt az iraton. A prioritási
   * kiosztás ezt nem tudja megtartani, és nem is tudná SEMMILYEN megoldás: ha
   * az álnév csak a valódi névtől függ, akkor nem függhet a rangsortól, ha
   * pedig a rangsortól függ, akkor változik, amikor a rangsor változik. A kettő
   * matematikailag zárja ki egymást, tehát itt választani kellett.
   *
   * A kárt viszont határok közé lehetett szorítani, és ez döntött:
   *
   *  1. A sorrend a DOKUMENTUM SZÖVEGÉBŐL jön, nem a felületi féllistából.
   *     Ezért a lista átrendezése, egy szerep átírása, egy nem javítása senkit
   *     nem mozdít el — csak az mozdít, ha ténylegesen más szerepel az iraton.
   *  2. Egy ügy több iratán a fontos felek sorrendje jellemzően UGYANAZ (a
   *     felperes a keresetlevélben is, az ítéletben is elöl van), ezért éppen
   *     azok az álnevek maradnak stabilak, amelyek az olvasónak számítanak. Egy
   *     mellékszereplő elcsúszhat.
   *  3. Akit rögzíteni kell, azt rögzíteni LEHET: a `PartyInput.manualReplacement`
   *     kézi álneve erősebb minden kiosztásnál, és a leképezést a kulcsfájl
   *     (`app/keyfile.ts`) is megőrzi.
   *
   * Aki nincs a felsorolásban (a szövegben nem találtuk meg), az a régi,
   * kulcsból számolt nevet kapja: neki nincs megjelenési helye, a féllistabeli
   * helye pedig esetleges volna.
   */
  appearanceOrder?: readonly string[];
}

/**
 * Álnevek kiosztása a felekre. Garantálja, hogy egy ügyön belül két fél soha nem
 * kap azonos álnevet, és hogy a nem illeszkedik.
 */
export function assignPseudonyms(
  entities: AnonEntity[],
  theme: Theme,
  opts: AssignOptions,
): Map<string, Assignment> {
  const out = new Map<string, Assignment>();
  // A vezetéknevek és a cégnév-alkatrészek KÖZÖS készletből fogynak: különben
  // két különböző fél kaphatna hasonló nevet ("Kőpát Gránit" és "Kőpát
  // Ingatlanforgalmazó Zrt."), ami egy sokszereplős iratban összezavarja az olvasót.
  const usedSurnames = new Set<string>();
  const usedGiven = new Set<string>();
  const usedOrgs = usedSurnames;
  const usedPlaces = new Set<string>();

  // Prioritási rangsor a megjelenés sorrendjéből. Aki nincs benne, az `null`-t
  // kap: neki nincs rangja, tehát a kulcsból számolt régi kiosztás marad.
  const priority = new Map<string, number>();
  (opts.appearanceOrder ?? []).forEach((id, i) => {
    if (!priority.has(id)) priority.set(id, i);
  });
  const pri = (e: AnonEntity): number | null => priority.get(e.id) ?? null;

  /*
    A FELDOLGOZÁS SORRENDJE, mert ez osztja ki a lista elejét.

    Elsődleges kulcs a `rank`, és ez szándékos:

     - Előbb a "-né" nélküli személyek, hogy az asszonynevek a férj álnevéből
       származhassanak, és a származási kapcsolat megmaradjon.
     - A személyek megelőzik a szervezeteket és a helységeket akkor is, ha az
       iratban egy cég neve áll elöl. A vezetéknevek és a cégnév-előtagok közös
       készletből fogynak (lásd fent), tehát egy elöl álló cég elvinné a
       névsor élét — pedig a „Kovakövi Frédi” páros egy SZEMÉLYNEK ér a
       legtöbbet: az olvasó a szereplőket követi, nem a cégeket.

    Másodlagos kulcs a prioritás. Ha nincs megjelenési sorrend, minden rang
    azonos; a JavaScript rendezése az ES2019 óta STABIL, tehát ilyenkor a
    felsorolás eredeti sorrendje marad érvényben — pontosan úgy, ahogy a
    prioritás bevezetése előtt.
  */
  const ordered = [...entities].sort(
    (a, b) => rank(a) - rank(b) || (pri(a) ?? Number.MAX_SAFE_INTEGER) - (pri(b) ?? Number.MAX_SAFE_INTEGER),
  );

  for (const e of ordered) {
    if (e.kind === 'person') {
      out.set(e.id, assignPerson(e, theme, opts, out, usedSurnames, usedGiven, pri(e)));
    } else if (e.kind === 'org') {
      out.set(e.id, assignOrg(e, theme, opts, usedOrgs, pri(e)));
    } else if (e.kind === 'place') {
      out.set(e.id, assignPlace(e, theme, opts, usedPlaces, pri(e)));
    } else {
      out.set(e.id, assignIdentifier(e));
    }
  }
  return out;
}

function rank(e: AnonEntity): number {
  if (e.kind !== 'person') return 2;
  return e.wifeOf ? 1 : 0;
}

/**
 * Egy név kivétele a készletből.
 *
 * @param priority a fél helye a megjelenési sorrendben, vagy `null`, ha az
 *                 iratban nem találtuk meg. A `null` a RÉGI, kulcsból számolt
 *                 kiosztást jelenti — nem hibajelzés, hanem az az eset, amikor
 *                 nincs mihez képest rangsorolni.
 */
function pickEntry(
  pool: ThemeEntry[],
  used: Set<string>,
  secret: string,
  key: string,
  priority: number | null,
  preferLength?: number,
): ThemeEntry {
  let candidates = pool.filter((p) => !used.has(p.form.toLowerCase()));
  if (candidates.length === 0) {
    // A készlet elfogyott: számozott utótaggal bővítünk, hogy soha ne
    // ütközzön két fél álneve. Prioritási módban a lista ELEJÉRŐL számozunk
    // tovább, mert a sor végére szorult fél is a legjellemzőbb nevet érdemli.
    const base = (priority === null ? pool[deterministicIndex(secret, key, pool.length)] : pool[0]) ?? pool[0]!;
    let n = 2;
    while (used.has(`${base.form} ${n}`.toLowerCase())) n++;
    return { ...base, form: `${base.form} ${n}` };
  }
  if (priority !== null) {
    // PRIORITÁSI KIOSZTÁS: a lista ELEJÉRŐL, az első szabad név. A rangot nem
    // indexnek használjuk (`candidates[priority]` hibás volna): a nemenkénti
    // szűrés miatt a listák félenként MÁSHOL tartanak, viszont a feldolgozás
    // sorrendje már a rangsor, ezért az „első szabad” pontosan a rang szerinti
    // nevet adja. Így párosul az első vezetéknév az első utónévvel is.
    return candidates[0]!;
  }
  if (preferLength !== undefined) {
    const close = candidates.filter((c) => Math.abs(c.form.length - preferLength) <= 2);
    if (close.length > 0) candidates = close;
  }
  return candidates[deterministicIndex(secret, key, candidates.length)]!;
}

function assignPerson(
  p: SeedPerson,
  theme: Theme,
  opts: AssignOptions,
  existing: Map<string, Assignment>,
  usedSurnames: Set<string>,
  usedGiven: Set<string>,
  priority: number | null,
): Assignment {
  const lenS = opts.preferSimilarLength ? p.surname.length : undefined;
  const lenG = opts.preferSimilarLength ? p.given.length : undefined;

  // Asszonynév: ha a férj már kapott álnevet, abból származtatunk, hogy a
  // "Kőszikla Frédné" és a "Kőszikla Fréd" kapcsolata megmaradjon.
  let surnameEntry: ThemeEntry | undefined;
  if (p.wifeOf) {
    const husband = [...existing.values()].find(
      (a) => a.pseudo.kind === 'person' && `${(a.pseudo as SeedPerson).surname} ${(a.pseudo as SeedPerson).given}` === a.display && a.original === p.wifeOf,
    );
    if (husband && husband.pseudo.kind === 'person') {
      surnameEntry = {
        form: husband.pseudo.surname,
        harmony: husband.pseudo.overrides?.harmony,
        overrides: husband.pseudo.overrides,
      };
    }
  }
  if (!surnameEntry) {
    surnameEntry = pickEntry(
      tovekSzerintSzabad(theme.surnames, usedSurnames),
      usedSurnames,
      opts.caseSecret,
      `${p.surname}|surname`,
      priority,
      lenS,
    );
    usedSurnames.add(surnameEntry.form.toLowerCase());
  }

  /*
    NEM SZERINTI EGYEZTETÉS. A nő női, a férfi férfi utónevet kap; a `gender: 'N'`
    (ismeretlen nem) a TELJES készletet látja, mert egy ismeretlen nemű félnél
    minden tippünk félrevezető volna — a névsor elejéről kap nevet, akármelyik
    nemhez tartozik is az. Ha egy készletből hiányzik a fél neme (csupa férfi
    névsor mellett egy nő), a szűrés üresre fut; ilyenkor a teljes készletre
    esünk vissza, mert a rossz nemű álnév is jobb, mint az álnév nélkül maradt,
    tehát az iratban BENT HAGYOTT valódi név.
  */
  const genderPool =
    p.gender === 'N'
      ? theme.given_names
      : theme.given_names.filter((g) => g.gender === p.gender || g.gender === 'N');
  // Azonos tövű pár tiltása: a "Zsályás Zsálya" vagy a "Kavicsos Kavics"
  // nevetségesen hangzik, és egy sokszereplős iratban nehéz megkülönböztetni.
  const pool = (genderPool.length > 0 ? genderPool : theme.given_names).filter(
    (g) => !azonosTovu(surnameEntry!.form, g.form),
  );
  const givenPool = tovekSzerintSzabad(pool.length > 0 ? pool : theme.given_names, usedGiven);
  const givenEntry = pickEntry(
    givenPool,
    usedGiven,
    opts.caseSecret,
    `${p.surname} ${p.given}|given`,
    priority,
    lenG,
  );
  usedGiven.add(givenEntry.form.toLowerCase());

  const pseudo: SeedPerson = {
    kind: 'person',
    id: p.id,
    surname: surnameEntry.form,
    given: givenEntry.form,
    gender: p.gender,
    role: p.role,
    overrides: mergeOverrides(toOverrides(surnameEntry), toOverrides(givenEntry)),
  };

  if (p.wifeOf) {
    // A férj álnevéből képezzük az asszonynevet.
    const husbandPseudo = [...existing.values()]
      .map((a) => a.pseudo)
      .find((x): x is SeedPerson => x.kind === 'person' && x.surname === surnameEntry!.form && x.id !== p.id);
    pseudo.wifeOf = husbandPseudo
      ? `${husbandPseudo.surname} ${husbandPseudo.given}`
      : `${surnameEntry.form} ${givenEntry.form}`;
    if (p.maidenSurname) {
      const maiden = pickEntry(
        tovekSzerintSzabad(theme.surnames, usedSurnames),
        usedSurnames,
        opts.caseSecret,
        `${p.maidenSurname}|maiden`,
        priority,
      );
      usedSurnames.add(maiden.form.toLowerCase());
      pseudo.maidenSurname = maiden.form;
    }
  }

  // A -né képző is toldalék: a szóvégi rövid a/e megnyúlik előtte
  // ("Csorba" → "Csorbáné"), ezért nem szabad puszta összefűzéssel képezni.
  const originalDisplay = p.wifeOf
    ? p.maidenSurname
      ? `${inflectWord(p.wifeOf.split(/\s+/)[0]!, 'WIFE')} ${p.maidenSurname} ${p.given}`
      : inflectName(p.wifeOf, 'WIFE')
    : `${p.surname} ${p.given}`;

  const pseudoDisplay = p.wifeOf
    ? p.maidenSurname
      ? `${inflectWord(pseudo.surname, 'WIFE')} ${pseudo.maidenSurname} ${pseudo.given}`
      : inflectName(pseudo.wifeOf ?? `${pseudo.surname} ${pseudo.given}`, 'WIFE')
    : `${pseudo.surname} ${pseudo.given}`;

  return { entityId: p.id, original: originalDisplay, display: pseudoDisplay, pseudo, manual: false };
}

function assignOrg(
  o: SeedOrganization,
  theme: Theme,
  opts: AssignOptions,
  used: Set<string>,
  priority: number | null,
): Assignment {
  const form = companyForm(o.name);
  const stem = stripCompanyForm(o.name);
  const parts = theme.org_parts.length > 0 ? theme.org_parts : theme.surnames.map((s) => s.form);

  // A cégnév-előtagok listája is prioritási lista: elöl a téma legjellemzőbb
  // szavai. Prioritási módban tehát a lista elejéről indulunk, egyébként a
  // kulcsból számolt helyről — a továbblépés mindkét esetben ugyanaz.
  let idx = priority === null ? deterministicIndex(opts.caseSecret, `${o.name}|org`, parts.length) : 0;
  let candidate = parts[idx] ?? parts[0]!;
  let guard = 0;
  while (used.has(candidate.toLowerCase()) && guard < parts.length) {
    idx = (idx + 1) % parts.length;
    candidate = parts[idx] ?? parts[0]!;
    guard++;
  }
  used.add(candidate.toLowerCase());

  // A cégformát megtartjuk: Kft. marad Kft., Zrt. marad Zrt.
  const stemWords = stem.split(/\s+/);
  const keptTail = stemWords.length > 1 ? ` ${stemWords.slice(1).join(' ')}` : '';
  const pseudoName = `${candidate}${keptTail}${form ? ` ${form}` : ''}`.trim();

  // A rövidítést ugyanazzal a szabállyal képezzük, mint az eredetit:
  // a szavak kezdőbetűiből.
  const pseudoAbbrev = o.abbreviation ? initialsOf(stripCompanyForm(pseudoName)) : undefined;

  const pseudo: SeedOrganization = {
    kind: 'org',
    id: o.id,
    name: pseudoName,
    ...(pseudoAbbrev ? { abbreviation: pseudoAbbrev } : {}),
    role: o.role,
  };
  return { entityId: o.id, original: o.name, display: pseudoName, pseudo, manual: false };
}

function assignPlace(
  pl: SeedPlace,
  theme: Theme,
  opts: AssignOptions,
  used: Set<string>,
  priority: number | null,
): Assignment {
  const fallback: ThemePlace[] = [{ form: 'Kavicsfalva' }, { form: 'Kőhalom' }, { form: 'Sziklakövesd' }];
  const pool = theme.place_names.length > 0 ? theme.place_names : fallback;
  // Ugyanaz az elv, mint a szervezeteknél: a helységnévsor is prioritási lista.
  let idx = priority === null ? deterministicIndex(opts.caseSecret, `${pl.name}|place`, pool.length) : 0;
  let candidate = pool[idx] ?? pool[0]!;
  let guard = 0;
  while (used.has(candidate.form.toLowerCase()) && guard < pool.length) {
    idx = (idx + 1) % pool.length;
    candidate = pool[idx] ?? pool[0]!;
    guard++;
  }
  used.add(candidate.form.toLowerCase());
  const pseudo: SeedPlace = {
    kind: 'place',
    id: pl.id,
    name: candidate.form,
    locative: candidate.locative ?? 'sup',
    ...(candidate.overrides ? { overrides: candidate.overrides } : {}),
  };
  return { entityId: pl.id, original: pl.name, display: candidate.form, pseudo, manual: false };
}

/**
 * Az azonosító "álneve" maga az adatfajta megjelölése.
 *
 * Nem témás fedőnév, mert egy adószámnak nincs értelmes "Kovakövi Frédi"
 * megfelelője: egy kitalált tízjegyű szám ugyanolyan érzékenynek LÁTSZANA,
 * mint az eredeti, és az olvasó nem tudná eldönteni, valódi-e. Ezért az
 * azonosító nem álnevet, hanem címkét kap, és nem is fogy a témakészletből.
 *
 * A `pseudo` másolat: a kézi felülírás különben az EREDETI entitást írná át,
 * amit az `originals` térkép is ugyanígy tart nyilván.
 */
function assignIdentifier(a: SeedIdentifier): Assignment {
  return {
    entityId: a.id,
    original: a.name,
    display: `[${AZONOSITO_CIMKE[a.identifierKind]}]`,
    pseudo: { ...a },
    manual: false,
  };
}

/**
 * A név "töve" a hasonló nevek kiszűréséhez: a gyakori magyar képzők
 * (-s, -os, -es, -ös, -i, -ó, -ő) leválasztva. Zsálya/Zsályás → "zsály".
 *
 * A minta `u` jelzővel megy, és kiírt magyar betűkkel dolgozik: ASCII szóhatár
 * és `\w` nincs benne, mert a JavaScript azokat ASCII-alapon értelmezi, és az
 * ékezetes betűkön elromlana.
 */
function wordRoot(word: string): string {
  return word.toLowerCase().replace(/(os|es|ös|ás|és|i|ó|ő|s|a|e)$/u, '');
}

/**
 * Ugyanabból a tőből képzett-e a két név — ez tiltja a „Zsályás Zsálya" párost.
 *
 * MIÉRT NEM A TŐ ELSŐ ÖT BETŰJE DÖNT (a korábbi megoldás). Azért, mert az öt
 * betűs csonkolás két KÜLÖNBÖZŐ szót is azonosnak lát, ha véletlenül ugyanúgy
 * kezdődnek — a „Flintwood" és a „Flint" töve egyaránt „flint" lett, tehát a
 * program letiltotta a saját készletének a zászlóshajó párosát. Ez a prioritási
 * kiosztás mellett már nem apróság: pont az ELSŐ fél nevét rontotta volna el,
 * akinek a névsor eleje jár.
 *
 * A szabály ezért az, ami a tiltás valódi célja: akkor azonos tövű a két név,
 * ha az egyik a másikból magyar képzővel keletkezhetett — vagyis a levágott
 * tövek megegyeznek, vagy az egyik a másik eleje, és a különbség legfeljebb két
 * betű. „Kavicsos"/„Kavics" (1 betű) tiltva, „Flintwood"/„Flint" (4 betű) nem.
 */
/**
 * A készlet szűkítése: ami már KIOSZTOTT névvel azonos tövű, az kiesik.
 *
 * MIÉRT KELLETT EZ A PRIORITÁSI KIOSZTÁSSAL EGYÜTT. Amíg a kulcsból számolt
 * kiosztás szórta a neveket a készletben, két egymáshoz hasonló név csak
 * véletlenül került egy iratra. A prioritási kiosztás viszont ELÖLRŐL HALAD:
 * a névsorban egymás mellett álló nevek rendszeresen a felperesé és az
 * alperesé lesznek. A növény-készlet első két vezetékneve „Somfa” és „Somfai” —
 * az irat két főszereplője egy betűben különbözne, és az olvasó a bekezdés
 * közepén már nem tudná, melyikről van szó.
 *
 * A tiltás ugyanaz a szabály, mint a vezeték- és utónév párosításánál
 * (`azonosTovu`), csak a már elhasznált nevekre nézve. Ha MINDEN név kiesne,
 * a szűkítetlen készlettel megyünk tovább: a hasonló álnév kellemetlen, az
 * álnév nélkül maradt fél viszont szivárgás.
 */
function tovekSzerintSzabad(pool: ThemeEntry[], used: Set<string>): ThemeEntry[] {
  if (used.size === 0) return pool;
  const kiosztott = [...used];
  const szabad = pool.filter((e) => !kiosztott.some((u) => azonosTovu(u, e.form)));
  return szabad.length > 0 ? szabad : pool;
}

function azonosTovu(a: string, b: string): boolean {
  const x = wordRoot(a);
  const y = wordRoot(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x === y) return true;
  const [rovid, hosszu] = x.length <= y.length ? [x, y] : [y, x];
  return hosszu.startsWith(rovid) && hosszu.length - rovid.length <= 2;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function mergeOverrides(a: NameOverrides, b: NameOverrides): NameOverrides {
  // A ragot az UTOLSÓ névelem kapja, ezért a keresztnév kivételei dominálnak.
  return { ...a, ...b };
}

/** Egy entitás magjainak (core) ragozott alakjai, gyorsan visszakereshetően. */
export function renderCoreTable(e: SeedEntity): Map<string, string> {
  const table = new Map<string, string>();
  for (const c of entityCores(e)) {
    for (const tag of [
      'NOM', 'ACC', 'DAT', 'INS', 'INE', 'ILL', 'ELA', 'SUP', 'SUB', 'DEL',
      'ADE', 'ALL', 'ABL', 'TER', 'CAU', 'FOR', 'POSS', 'PL',
    ] as CaseTag[]) {
      try {
        table.set(`${c.core}|${tag}`, c.render(tag));
      } catch {
        // A nem ragozható magok (monogram) csak alanyesetben léteznek.
      }
    }
  }
  return table;
}

export interface ReplacementContext {
  mode: ReplacementMode;
  /**
   * A CÍMKÉK NYELVE a szerep-, adatfajta- és számozott módban.
   *
   * Hiányában magyar. A fedőnév-módra nincs hatása: ott a NÉVKÉSZLET dönti el a
   * nyelvet, és a készletnek saját angol kiadása van — egy második, ide tett
   * kapcsoló ugyanarra a döntésre azt jelentené, hogy a kettő szétcsúszhat.
   */
  labelLang?: LabelLang;
  assignments: Map<string, Assignment>;
  /** entityId → sorszám, a 'numbered' módhoz. */
  numbering: Map<string, number>;
  /** entityId → eljárási szerep, a 'role' módhoz. */
  roles: Map<string, string>;
  /** Előre kiszámított magtáblák az álnevekhez. Azonosítóhoz nincs. */
  coreTables: Map<string, Map<string, string>>;
  /** Az eredeti entitások, azonosító szerint. */
  originals: Map<string, AnonEntity>;
  /** Figyelmeztetések, amiket a szereplapon meg kell mutatni. */
  warnings: string[];
}

export function buildContext(
  mode: ReplacementMode,
  entities: AnonEntity[],
  assignments: Map<string, Assignment>,
  labelLang: LabelLang = 'hu',
): ReplacementContext {
  const numbering = new Map<string, number>();
  const roles = new Map<string, string>();
  const coreTables = new Map<string, Map<string, string>>();
  const originals = new Map<string, AnonEntity>();
  const warnings: string[] = [];

  let personNo = 0;
  let orgNo = 0;
  let placeNo = 0;
  let identifierNo = 0;
  for (const e of entities) {
    originals.set(e.id, e);
    if (e.kind === 'person') numbering.set(e.id, ++personNo);
    else if (e.kind === 'org') numbering.set(e.id, ++orgNo);
    else if (e.kind === 'place') numbering.set(e.id, ++placeNo);
    else numbering.set(e.id, ++identifierNo);
    // Eljárási szerepe csak személynek és szervezetnek van. Egy adószám vagy
    // egy helynév nem "felperes", ezért ott a szerep-mód is az adatfajta
    // megjelölésére esik vissza.
    if ((e.kind === 'person' || e.kind === 'org') && e.role) {
      const { label, warning } = sanitizeRoleLabel(e.role, entities);
      // Ismeretlen szerepnél NEM állítunk be címkét: így a csere az adatfajta
      // nevére esik vissza ahelyett, hogy ellenőrizetlen szöveget írnánk az
      // iratba.
      if (label) roles.set(e.id, label);
      if (warning) warnings.push(warning);
    }
    const a = assignments.get(e.id);
    // Az azonosítónak nincs ragozási magja: nem névből, hanem címkéből áll.
    if (a && a.pseudo.kind !== 'identifier') coreTables.set(e.id, renderCoreTable(a.pseudo));
  }
  return { mode, labelLang, assignments, numbering, roles, coreTables, originals, warnings };
}

/**
 * Az eljárási szerepek ZÁRT SZÓTÁRA. Csak ami itt szerepel, kerülhet
 * csereszövegként a kimeneti iratba.
 *
 * A felületen a szerep zárt legördülőből jön — a mező TÍPUSA viszont szabad
 * szöveg (`role: string`), és az IPC-határon senki nem validálja. Egy hibás
 * vagy megkerült felület tehát tetszőleges karakterláncot küldhet, ami szó
 * szerint bekerülne a kész iratba. A korábbi fertőtlenítés ezt csak részben
 * fogta meg: a FELISMERT felek nevét kereste a leírásban, így egy fel nem
 * ismert cégnév ("a Vashegyi Malom ügyvezetője") változatlanul átment rajta.
 *
 * A zárt szótár azért zárja le a rést, mert nem a bemenetet szűri, hanem a
 * kimenetet VÁLASZTJA: amit visszaadunk, az mindig ebből a táblából való
 * konstans, tehát a felhasználótól érkező szövegnek egyetlen betűje sem juthat
 * a dokumentumba.
 */
const ROLE_VOCABULARY = [
  // Peres és nemperes eljárás
  'felperes', 'alperes', 'beavatkozó', 'kérelmező', 'kérelmezett', 'indítványozó',
  'tanú', 'szakértő', 'tolmács', 'jogi képviselő', 'képviselő', 'meghatalmazott',
  'törvényes képviselő', 'gyám', 'ügygondnok',
  // Büntetőeljárás
  'vádlott', 'terhelt', 'gyanúsított', 'sértett', 'magánvádló', 'pótmagánvádló',
  'feljelentő', 'magánfél',
  // Végrehajtás, fizetési meghagyás
  'adós', 'hitelező', 'kezes', 'készfizető kezes', 'jogosult', 'kötelezett',
  'végrehajtást kérő', 'végrehajtást szenvedő', 'zálogkötelezett',
  // Szerződéses szerepek
  'eladó', 'vevő', 'bérlő', 'bérbeadó', 'megbízó', 'megbízott', 'kölcsönadó',
  'kölcsönvevő', 'ajándékozó', 'megajándékozott', 'haszonélvező', 'szerződő fél',
  'szerződő', 'örökös', 'hagyatéki hitelező', 'ügyvéd',
] as const;

const ROLE_BY_KEY = new Map<string, string>(ROLE_VOCABULARY.map((r) => [r, r]));

/**
 * A saját helykitöltőink: a felismerő ezt írja be, amikor a szerepet nem tudta
 * megállapítani. Csereszövegnek alkalmatlanok ("az egyébnek"), de
 * figyelmeztetést sem érdemelnek — nem a felhasználó adta meg őket.
 */
const ROLE_PLACEHOLDERS = new Set(['', 'egyéb', 'ismeretlen', 'szervezet', 'anyja neve']);

/** "I. r. alperes", "II. rendű felperes" — a sorszám a szerep előtt állhat. */
const ROLE_ORDINAL = /^([ivxlcdm]+)\.[ \t]*(?:r\.?|rend[űu])[ \t]+(.+)$/;

function roleKey(role: string): string {
  return role.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
}

/** A szerep szótárbeli, kanonikus alakja — vagy null, ha nem ismerjük. */
function canonicalRole(role: string): string | null {
  const key = roleKey(role);
  const direct = ROLE_BY_KEY.get(key);
  if (direct) return direct;

  const m = ROLE_ORDINAL.exec(key);
  if (!m) return null;
  const base = ROLE_BY_KEY.get(roleKey(m[2] ?? ''));
  // A sorszám római szám, a szerep pedig a szótárból való — mindkét darab a
  // saját készletünkből származik, tehát az összerakott címke is tiszta.
  return base ? `${(m[1] ?? '').toUpperCase()}. r. ${base}` : null;
}

/** Idézés a figyelmeztetésbe, megvágva: a szerep mezőn nincs hosszkorlát. */
function quote(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/**
 * A csereszöveg maga is szivároghat.
 *
 * A valódi mintában a szerepleírás így nézett ki: "tanú (az Aranykalász Agrár
 * Kft. ügyvezetője)" — ha ezt írjuk a név helyére, a cégnevet épp visszatettük a
 * dokumentumba. A zárójeles pontosítás levágása ezért megmarad; ami nem áll
 * benne a zárt szótárban, az viszont nem "megtisztítva", hanem EGYÁLTALÁN nem
 * kerül az iratba: a hívó ilyenkor az adatfajta nevére vált (null).
 */
export function sanitizeRoleLabel(
  role: string,
  entities: AnonEntity[],
): { label: string | null; warning: string | null } {
  const direct = canonicalRole(role);
  if (direct) return { label: direct, warning: null };

  if (ROLE_PLACEHOLDERS.has(roleKey(role))) return { label: null, warning: null };

  const head = role.split('(')[0]?.trim() ?? '';
  const fromHead = head ? canonicalRole(head) : null;
  if (fromHead) {
    return {
      label: fromHead,
      warning:
        `A(z) "${quote(role)}" szerepleírás pontosítása elmaradt a kimenetből; ` +
        `a csereszöveg: "${fromHead}".`,
    };
  }

  // Külön üzenet arra, ha a leírás egy fél nevét tartalmazza: az a súlyosabb
  // eset, mert ott maga a csereszöveg szivárogtatott volna.
  const named = new SeedMatcher(entities.filter(isNameEntity)).find(role).length > 0;
  return {
    label: null,
    warning: named
      ? `A(z) "${quote(role)}" szerepleírás egy fél nevét tartalmazza, ezért nem használható ` +
        'csereszövegként; az adatfajta neve kerül a helyére.'
      : `A(z) "${quote(role)}" nem ismert eljárási szerep, ezért nem használjuk csereszövegként; ` +
        'az adatfajta neve kerül a helyére.',
  };
}

/** Igaz a névre (személy, szervezet, helység), hamis az azonosítóra. */
function isNameEntity(e: AnonEntity): e is SeedEntity {
  return e.kind !== 'identifier';
}

const TYPE_LABEL: Record<AnonEntity['kind'], string> = {
  person: 'név',
  org: 'szervezet',
  place: 'helység',
  // Csak akkor látszik, ha az azonosító fajtája valahogy hiányzik; egyébként a
  // részletesebb AZONOSITO_CIMKE nyer, mert az adatfajta MEGJELÖLÉSE a lényeg.
  identifier: 'azonosító',
};

/** A számozott mód címkéi. Az azonosítóé csak tartalék — lásd identifierLabel. */
const NUMBERED_LABEL: Record<AnonEntity['kind'], string> = {
  person: 'NÉV',
  org: 'SZERVEZET',
  place: 'HELY',
  identifier: 'AZONOSÍTÓ',
};

/**
 * Az azonosítók ADATFAJTA-CÍMKÉI.
 *
 * Külön tábla, nem az `AZONOSITO_NEV` újrahasznosítása, mert a kettő két
 * különböző közönségnek szól: az `AZONOSITO_NEV` a szereplapon MAGYARÁZ
 * ("személyazonosító igazolvány száma"), ez viszont bekerül magába az iratba,
 * ezért rövid, és az OBH 4/2021. §10(2) szóhasználatát követi.
 *
 * Két tudatos eltérés:
 *  - az IBAN is "bankszámlaszám": az adatfajta csakugyan ugyanaz, és az irat
 *    olvasójának a magyar megnevezés mond valamit,
 *  - a teljes címből "lakcím" lesz, mert a bírósági gyakorlat és a saját
 *    dokumentációnk is ezt a megjelölést használja. Ha egy konkrét cím
 *    székhely vagy telephely, a felhasználó kézzel átírhatja — a kézi érték a
 *    javítás óta MIND A NÉGY módban érvényesül.
 */
const AZONOSITO_CIMKE: Record<AzonositoKind, string> = {
  ado_azonosito_jel: 'adóazonosító jel',
  taj: 'TAJ-szám',
  adoszam: 'adószám',
  cegjegyzekszam: 'cégjegyzékszám',
  bankszamlaszam: 'bankszámlaszám',
  iban: 'bankszámlaszám',
  helyrajzi_szam: 'helyrajzi szám',
  iranyitoszam: 'irányítószám',
  telefonszam: 'telefonszám',
  szemelyazonosito_igazolvany: 'igazolványszám',
  birosagi_ugyszam: 'ügyszám',
  email: 'e-mail cím',
  rendszam: 'rendszám',
  cim: 'lakcím',
};

/* ─────────────────────── a címkék angol változata ─────────────────────── */

/*
  MIÉRT VAN ANGOL VÁLTOZAT, ÉS MIT NEM JELENT.

  A fedőnév-készleteknek régóta van angol kiadásuk, a másik három módnak nem
  volt — pedig ugyanaz az igény: az iratot külföldi félnek, társirodának vagy
  angol nyelvű beadványhoz is ki kell adni.

  Amit az angol változat MEGVÁLTOZTAT: a nevek helyére kerülő CÍMKE szövegét.
  Amit NEM: a magyar mondatot körülötte. Az irat magyar marad, ezért a
  toldalékolás is magyar szabály szerint megy — „[name]-nek", „the plaintiffnek"
  helyett „the plaintiff-nek". Ez szándékos: a címke idegen szó a magyar
  mondatban, és a kötőjeles toldalékolás pontosan az a helyesírási megoldás,
  amit a magyar erre használ.
*/

/** A fordítás nyelve — a felület a kártyán állítja át. */
export type LabelLang = 'hu' | 'en';

/**
 * AZ ANGOL CÍMKÉK HANGRENDJE — KIEJTÉS SZERINT, TÁBLÁZATBÓL.
 *
 * A magyar toldalék az utolsó szó KIEJTETT hangrendjéhez igazodik, nem az
 * írásképéhez: a „plaintiff” magyarul „plentif”, tehát magas — a program a
 * betűkből viszont az „a”-t látná meg, és mély toldalékot adna („plaintiff-nak”).
 * Ugyanez a csapda, amit a szállított angol névkészletek (`data/themes/*_en.json`)
 * alakonkénti `harmony` mezővel oldanak meg.
 *
 * A kulcs az UTOLSÓ SZÓ kisbetűsen — az kapja a ragot. Ugyanaz a szó több
 * címkében is előfordul („the enforcement debtor”, „the debtor”), ezért szó
 * szerinti táblázat, nem címkénkénti.
 *
 * FIGYELEM, AMI EBBEN EMBERI DÖNTÉS: hogy egy angol szót a magyar olvasó
 * milyen hangrendűnek hall, néhány szónál vitatható („owner”, „donee”,
 * „organisation”). Ami NEM vitatható: hogy találgatni tilos — a
 * `test/cimke-nyelv-es-hivatalos.ts` ezért méri, hogy MINDEN angol címke
 * utolsó szava szerepel-e itt. Ha új címke kerül a táblákba, a teszt elbukik,
 * nem a kimenet romlik el csendben.
 */
const ANGOL_HANGREND: Record<string, Harmony> = {
  // Eljárási szerepek
  plaintiff: 'front_unrounded',
  defendant: 'front_unrounded',
  intervener: 'front_unrounded',
  applicant: 'front_unrounded',
  respondent: 'front_unrounded',
  petitioner: 'front_unrounded',
  witness: 'front_unrounded',
  expert: 'front_unrounded',
  interpreter: 'front_unrounded',
  representative: 'front_unrounded',
  agent: 'front_unrounded',
  guardian: 'front_unrounded',
  litem: 'front_unrounded',
  suspect: 'front_unrounded',
  complainant: 'front_unrounded',
  claimant: 'front_unrounded',
  tenant: 'front_unrounded',
  seller: 'front_unrounded',
  buyer: 'front_unrounded',
  lender: 'front_unrounded',
  heir: 'front_unrounded',
  attorney: 'front_unrounded',
  principal: 'front_unrounded',
  // „ekjúzd", „párti", „proszekjútor" — a hangsúlyos mély magánhangzó dönt
  accused: 'back',
  party: 'back',
  prosecutor: 'back',
  debtor: 'back',
  creditor: 'back',
  surety: 'back',
  obligor: 'back',
  pledgor: 'back',
  landlord: 'back',
  borrower: 'back',
  donor: 'back',
  donee: 'back',
  owner: 'back',
  // Adatfajta- és számozott címkék
  name: 'front_unrounded',
  place: 'front_unrounded',
  identifier: 'front_unrounded',
  id: 'front_unrounded',
  organisation: 'back',
  org: 'back',
  // Azonosítófajták utolsó szavai
  number: 'back',
  postcode: 'back',
  address: 'front_unrounded',
  plate: 'front_unrounded',
};

/**
 * Az angol címke utolsó szavához tartozó ragozási adat.
 *
 * Ha a szó nincs a táblában, ÜRES adatot adunk vissza — a toldalékolás ilyenkor
 * az írásképből találgat. Ez nem elfogadható végállapot, de futásidőben mégis
 * ez a helyes viselkedés: egy kivétel dobása a csere közepén az egész iratot
 * megfogná egy címke miatt. A hiányt a teszt fogja meg, nem a felhasználó.
 */
function angolRagAdat(utolsoSzo: string): NameOverrides {
  const h = ANGOL_HANGREND[utolsoSzo.toLowerCase()];
  return h ? { harmony: h } : {};
}

/** Az angol címkék listája — a teszt ezen ellenőrzi, hogy a tábla teljes-e. */
export function angolCimkeSzavak(): string[] {
  const cimkek = [
    ...Object.values(ROLE_EN),
    ...Object.values(TYPE_LABEL_EN),
    ...Object.values(NUMBERED_LABEL_EN),
    ...Object.values(AZONOSITO_CIMKE_EN),
  ];
  const szavak = new Set<string>();
  for (const c of cimkek) {
    const utolso = c.trim().split(/\s+/).pop();
    if (utolso) szavak.add(utolso.toLowerCase());
  }
  return [...szavak].sort();
}

/** Van-e ragozási adata minden angol címkének. A teszt ezt kérdezi meg. */
export function angolRagHianyok(): string[] {
  return angolCimkeSzavak().filter((sz) => ANGOL_HANGREND[sz] === undefined);
}

const TYPE_LABEL_EN: Record<AnonEntity['kind'], string> = {
  person: 'name',
  org: 'organisation',
  place: 'place',
  identifier: 'identifier',
};

const NUMBERED_LABEL_EN: Record<AnonEntity['kind'], string> = {
  person: 'NAME',
  org: 'ORG',
  place: 'PLACE',
  identifier: 'ID',
};

const AZONOSITO_CIMKE_EN: Record<AzonositoKind, string> = {
  ado_azonosito_jel: 'tax ID',
  taj: 'social security number',
  adoszam: 'tax number',
  cegjegyzekszam: 'company registration number',
  bankszamlaszam: 'bank account number',
  iban: 'bank account number',
  helyrajzi_szam: 'land registry number',
  iranyitoszam: 'postcode',
  telefonszam: 'phone number',
  szemelyazonosito_igazolvany: 'ID card number',
  birosagi_ugyszam: 'case number',
  email: 'e-mail address',
  rendszam: 'registration plate',
  cim: 'address',
};

/**
 * Az eljárási szerepek angol megfelelője.
 *
 * UGYANOLYAN ZÁRT, mint a magyar (`ROLE_VOCABULARY`): a csereszöveg mindig
 * ebből a táblából való konstans, tehát a felhasználótól érkező szövegnek itt
 * sem juthat egyetlen betűje sem a dokumentumba. Amihez nincs angol pár, az
 * — épp úgy, mint az ismeretlen szerep — az adatfajta címkéjére esik vissza,
 * nem a magyar szóra: egy „the felperes" alak azt a látszatot keltené, hogy a
 * fordítás félbemaradt.
 */
const ROLE_EN: Record<string, string> = {
  felperes: 'the plaintiff',
  alperes: 'the defendant',
  beavatkozó: 'the intervener',
  kérelmező: 'the applicant',
  kérelmezett: 'the respondent',
  indítványozó: 'the petitioner',
  tanú: 'the witness',
  szakértő: 'the expert',
  tolmács: 'the interpreter',
  'jogi képviselő': 'the legal representative',
  képviselő: 'the representative',
  meghatalmazott: 'the authorised agent',
  'törvényes képviselő': 'the legal guardian',
  gyám: 'the guardian',
  ügygondnok: 'the guardian ad litem',
  vádlott: 'the accused',
  terhelt: 'the defendant',
  gyanúsított: 'the suspect',
  sértett: 'the injured party',
  magánvádló: 'the private prosecutor',
  pótmagánvádló: 'the substitute private prosecutor',
  feljelentő: 'the complainant',
  magánfél: 'the civil claimant',
  adós: 'the debtor',
  hitelező: 'the creditor',
  kezes: 'the surety',
  'készfizető kezes': 'the joint and several surety',
  jogosult: 'the entitled party',
  kötelezett: 'the obligor',
  'végrehajtást kérő': 'the enforcement claimant',
  'végrehajtást szenvedő': 'the enforcement debtor',
  zálogkötelezett: 'the pledgor',
  eladó: 'the seller',
  vevő: 'the buyer',
  bérlő: 'the tenant',
  bérbeadó: 'the landlord',
  megbízó: 'the principal',
  megbízott: 'the agent',
  kölcsönadó: 'the lender',
  kölcsönvevő: 'the borrower',
  ajándékozó: 'the donor',
  megajándékozott: 'the donee',
  haszonélvező: 'the beneficial owner',
  'szerződő fél': 'the contracting party',
  szerződő: 'the contracting party',
  örökös: 'the heir',
  'hagyatéki hitelező': 'the estate creditor',
  ügyvéd: 'the attorney',
};

/**
 * A találat helyére kerülő szöveg. Null, ha nem tudjuk biztonságosan előállítani —
 * ilyenkor a találat az átnézési listára megy, nem cserélődik.
 */
export function renderReplacement(
  match: Match,
  entity: AnonEntity,
  ctx: ReplacementContext,
): string | null {
  const caseTag: CaseTag = match.tail ? 'NOM' : (match.caseTag ?? 'NOM');
  const assignment = ctx.assignments.get(entity.id);

  // Az azonosító mind a négy módban ugyanazt kapja: az adatfajta megjelölését.
  // Nincs értelmes témás megfelelője — egy kitalált tízjegyű szám ugyanúgy
  // adóazonosítónak LÁTSZANA, és az olvasó nem tudná eldönteni, valódi-e.
  if (entity.kind === 'identifier') {
    const label = assignment?.manual ? assignment.display : identifierLabel(entity, ctx);
    // A KÉZZEL ÁTÍRT csereszöveg a felhasználóé: azt magyar szónak vesszük, mert
    // ő írta be. Csak a saját, angol nyelvű címkéinkre kell a kiejtés szerinti
    // hangrend — egy kézzel beírt magyar szóra ráerőltetve elrontanánk.
    const idBody = bracketed(label, caseTag, ctx.labelLang === 'en' && !assignment?.manual);
    return match.upperCase ? idBody.toUpperCase() : idBody;
  }

  // A KÉZI fedőnév mind a négy módban él.
  //
  // Eddig csak a témás ág olvasta ki, a szereplap és a titkosított kulcsfájl
  // viszont mindig a kézi értéket írta le. Szerep-, adatfajta- és számozott
  // módban tehát a jegyzőkönyv olyan megfeleltetést rögzített, ami a kimeneti
  // iratban sehol nem szerepelt — épp a visszafejtés lett volna hibás tőle.
  // A felhasználó kifejezett kérése erősebb a mód alapértelmezésénél.
  if (ctx.mode === 'theme' || assignment?.manual === true) {
    if (match.core === null) return null; // ismeretlen toldalék: nem találgatunk
    if (match.core === 'identifier') return rewriteEmbeddedIdentifier(match, entity, ctx);
    // Helynévnél a helyhatározót az ÁLNÉV sajátja dönti el, nem az eredetié:
    // "Szolnokon" → "Kavicsfalván", de ha az álnév -ban-os, akkor "Kőváriban".
    const tag = adjustLocative(match.core, caseTag, assignment?.pseudo);
    const body = ctx.coreTables.get(entity.id)?.get(`${match.core}|${tag}`) ?? null;
    if (body === null) return null;
    const result = `${match.prefix}${body}${match.tail}`;
    return match.upperCase ? result.toUpperCase() : result;
  }

  // Címke-módok (szerep, adatfajta, számozott): a névelőtag és a megszólítás
  // elmarad, mert a címke nem név.
  const body = labelBody(entity, ctx, caseTag);
  return match.upperCase ? body.toUpperCase() : body;
}

/** A szerep-, adatfajta- és számozott mód csereszövege, ragozva. */
function labelBody(entity: SeedEntity, ctx: ReplacementContext, caseTag: CaseTag): string {
  const angol = ctx.labelLang === 'en';
  if (ctx.mode === 'role') {
    const role = ctx.roles.get(entity.id);
    if (role) {
      // Az eljárási szerep köznév: rendesen ragozzuk. "az I. r. alperesnek"
      if (!angol) return inflectRoleLabel(role, caseTag);
      const en = roleEnglish(role);
      // Amihez nincs angol pár, az NEM marad magyarul: a „the felperes" alak
      // félbehagyott fordításnak látszana. Az adatfajta címkéjére esik vissza,
      // ugyanúgy, mint az ismeretlen szerep.
      if (en) return idegenCimke(en, caseTag);
    }
    // Akinek nincs eljárási szerepe (helynév, harmadik személy), vagy akinek a
    // szerepe nem állta ki a zárt szótár próbáját, az az adatfajta nevét kapja
    // — ez az OBH 4/2021. §10(2) szerinti megoldás.
  }
  if (ctx.mode === 'numbered') {
    const n = ctx.numbering.get(entity.id) ?? 1;
    const cimke = angol ? NUMBERED_LABEL_EN[entity.kind] : NUMBERED_LABEL[entity.kind];
    return bracketed(`[${cimke}-${n}]`, caseTag, angol);
  }
  return bracketed(
    `[${angol ? TYPE_LABEL_EN[entity.kind] : TYPE_LABEL[entity.kind]}]`,
    caseTag,
    angol,
  );
}

/**
 * Az eljárási szerep angol megfelelője, a sorszámot megtartva.
 *
 * A magyar kanonikus alak „I. r. alperes"; az angol megfelelő ugyanezt a
 * sorszámot viszi tovább („the 1st defendant"). A római szám a mi saját
 * összeállításunkból való (`canonicalRole`), tehát itt sem kerül a kimenetbe
 * ellenőrizetlen szöveg.
 */
const SORSZAM_EN: Record<string, string> = { I: '1st', II: '2nd', III: '3rd', IV: '4th', V: '5th' };

function roleEnglish(role: string): string | null {
  const kozvetlen = ROLE_EN[role.toLowerCase()];
  if (kozvetlen) return kozvetlen;
  const m = /^([IVXLCDM]+)\. r\. (.+)$/.exec(role);
  if (!m) return null;
  const alap = ROLE_EN[(m[2] ?? '').toLowerCase()];
  if (!alap) return null;
  const sorszam = SORSZAM_EN[m[1] ?? ''];
  // Ismeretlen római számnál nem találgatunk: a puszta szerep is helyes, csak
  // kevesebbet mond. Egy kitalált sorszám viszont MÁSIK felet jelölne.
  if (!sorszam) return alap;
  // "the defendant" → "the 1st defendant": a névelő után szúrjuk be.
  return alap.startsWith('the ') ? `the ${sorszam} ${alap.slice(4)}` : `${sorszam} ${alap}`;
}

/**
 * IDEGEN SZÓ RAGOZÁSA A MAGYAR MONDATBAN — kötőjellel.
 *
 * Az irat magyar marad akkor is, ha a címke angol: a „the plaintiff" a magyar
 * mondatban toldalékot kap. A magyar helyesírás az idegen szavak toldalékát
 * kötőjellel kapcsolja, ha a szó írásképe és kiejtése eltér — ez az angol
 * szavak túlnyomó többségére igaz, ezért itt következetesen kötőjelezünk. Így a
 * kimenet nem lesz „the plaintiffnek", és a címke szó szerint visszakereshető
 * marad az iratban.
 */
function idegenCimke(label: string, tag: CaseTag): string {
  if (tag === 'NOM') return label;
  const utolso = label.split(/\s+/).pop() ?? label;
  const ragozott = inflectWord(utolso, tag, angolRagAdat(utolso));
  const rag = ragozott.length > utolso.length ? ragozott.slice(utolso.length) : '';
  return rag ? `${label}-${rag}` : label;
}

/** Egy azonosító címkéje alanyesetben, a szögletes zárójelekkel együtt. */
function identifierLabel(e: SeedIdentifier, ctx: ReplacementContext): string {
  const label =
    ctx.labelLang === 'en' ? AZONOSITO_CIMKE_EN[e.identifierKind] : AZONOSITO_CIMKE[e.identifierKind];
  if (ctx.mode !== 'numbered') return `[${label}]`;
  // Számozott módban a fajta is bent marad ("[ADÓSZÁM-2]"): a címke így is
  // gépi, de az adatfajta megjelölése nem vész el — pont az hiányzott eddig.
  const n = ctx.numbering.get(e.id) ?? 1;
  return `[${label.toUpperCase()}-${n}]`;
}

/**
 * Amit a fél helyén a KIMENETI IRAT ténylegesen tartalmazni fog, alanyesetben.
 *
 * A szereplap, az anonimizálási jegyzőkönyv és a kulcsfájl eddig az
 * `Assignment.display` mezőt írta le, az viszont mindig a témás álnév. Szerep-,
 * adatfajta- és számozott módban tehát olyan párokat rögzítettek, amik az
 * iratban sehol nem szerepeltek. Egy kulcsfájl, ami rossz párokat állít, nem
 * pusztán félrevezető: a visszafejtést teszi hibássá.
 */
export function displayFor(entity: AnonEntity, ctx: ReplacementContext): string {
  const assignment = ctx.assignments.get(entity.id);
  if (entity.kind === 'identifier') {
    return assignment?.manual ? assignment.display : identifierLabel(entity, ctx);
  }
  if (ctx.mode === 'theme' || assignment?.manual === true) return assignment?.display ?? '';
  return labelBody(entity, ctx, 'NOM');
}

/**
 * E-mail cím vagy azonosító újraépítése az álnévből:
 * "kovacs.janos58@freemail.hu" → "kvarcos.tuzko58@freemail.hu".
 * A számokat, elválasztókat és a domain többi részét érintetlenül hagyjuk.
 */
function rewriteEmbeddedIdentifier(
  match: Match,
  entity: AnonEntity,
  ctx: ReplacementContext,
): string | null {
  const a = ctx.assignments.get(entity.id);
  if (!a) return null;
  const p = a.pseudo;

  // Egy e-mail cím több fél nevét is tartalmazhatja: a helyi rész a személyé,
  // a domain a cégé ("nagy.peter@aranykalasz.hu"). Ezért MINDEN fél töredékét
  // átvizsgáljuk, nem csak azét, amelyikre a találat szólt.
  void p;
  let out = match.surface;
  for (const [id, assignment] of ctx.assignments) {
    const src = ctx.originals.get(id);
    if (!src) continue;
    const fragments = buildFragments(id, partsOf(src));
    const target = partsOf(assignment.pseudo);
    out = rewriteIdentifier(out, fragments, (part) => {
      const v = target[part];
      return v ? v.split(/\s+/)[0] : undefined;
    });
  }
  return out === match.surface ? null : out;
}

/**
 * "Szolnokon" (-n) és "Debrecenben" (-ban) ugyanazt jelenti, de a helynévtől
 * függ, melyik járja. Cserénél tehát az álnév saját helyhatározójára váltunk.
 */
function adjustLocative(core: CoreShape, tag: CaseTag, pseudo: AnonEntity | undefined): CaseTag {
  if (core !== 'place' || !pseudo || pseudo.kind !== 'place') return tag;
  const want = pseudo.locative ?? 'sup';
  if (tag === 'SUP' || tag === 'INE') return want === 'ine' ? 'INE' : 'SUP';
  if (tag === 'SUB' || tag === 'ILL') return want === 'ine' ? 'ILL' : 'SUB';
  if (tag === 'DEL' || tag === 'ELA') return want === 'ine' ? 'ELA' : 'DEL';
  return tag;
}

/** A névrészletek, amiket egy azonosítóban keresünk vagy cserélünk. */
function partsOf(e: AnonEntity): { surname?: string; given?: string; maiden?: string; org?: string } {
  if (e.kind === 'person') return { surname: e.surname, given: e.given, maiden: e.maidenSurname };
  if (e.kind === 'org') return { org: stripCompanyForm(e.name) };
  // Az azonosítóban nincs névrészlet, amit egy e-mail címbe bele lehetne
  // építeni: a "8442130976" nem darabolható úgy, hogy értelmes tövet adjon.
  if (e.kind === 'identifier') return {};
  return { org: e.name };
}

/**
 * Szerepnév ragozása. A többtagú szerepeknél ("I. r. alperes") csak az utolsó
 * szó kap ragot.
 */
function inflectRoleLabel(role: string, tag: CaseTag): string {
  const parts = role.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (last === undefined) return role;
  parts[parts.length - 1] = inflectWord(last, tag);
  return parts.join(' ');
}

/** Szögletes zárójeles címke ragozása: "[lakcím]-nek", "[NÉV-1]-hez". */
function bracketed(label: string, tag: CaseTag, angol = false): string {
  if (tag === 'NOM') return label;
  // A címke belsejéből vesszük a harmóniát, hogy a rag illeszkedjen.
  const inner = label.replace(/[[\]]/g, '').replace(/-\d+$/, '');
  // A rag magyarul az UTOLSÓ szóra kerül, ezért a többszavas adatfajta-címkénél
  // ("helyrajzi szám", "e-mail cím") is az utolsó szó dönti el az illeszkedést.
  // Az egész címkére hívott toldalékolás itt kiszámíthatatlan alakot adna.
  const last = inner.split(/\s+/).pop() ?? inner;
  // ANGOL CÍMKÉNÉL A KIEJTÉS DÖNT, nem az írásmód: a „[name]" magyarul „nejm",
  // tehát magas — a betűkből viszont az „a" látszana, és mély rag kerülne rá.
  const inflected = inflectWord(last, tag, angol ? angolRagAdat(last) : {});
  // Csak akkor van mit kiírni, ha a toldalékolás HOZZÁTETT. Ha a tő maga is
  // megváltozott (rövidült), a levágott vég értelmetlen betűsor lenne.
  const suffix = inflected.length > last.length ? inflected.slice(last.length) : '';
  return suffix ? `${label}-${suffix}` : label;
}

export interface SubstitutionResult {
  text: string;
  /** Hány találatot cseréltünk le. */
  replaced: number;
  /** Amit nem cseréltünk: emberi döntésre vár. */
  pending: Match[];
  /** Hány határozott névelőt kellett javítani a csere után (a/az). */
  articlesFixed: number;
}

export interface SubstituteOptions {
  /** Kézzel jóváhagyott találatok indexei. */
  approved?: Set<number>;
  /** Mindent lecserél, ami megtalálható — a "jóváhagyom az összeset" gomb. */
  approveAll?: boolean;
}

/**
 * A csere végrehajtása. Alapból csak az automatikusan cserélhető találatokat
 * írja át; minden más az átnézési listára kerül.
 */
export function substitute(
  text: string,
  matches: Match[],
  entities: Map<string, SeedEntity>,
  ctx: ReplacementContext,
  opts: SubstituteOptions = {},
): SubstitutionResult {
  const pending: Match[] = [];
  const pieces: string[] = [];
  let cursor = 0;
  let replaced = 0;
  let articlesFixed = 0;

  matches.forEach((m, i) => {
    // A "mindent jóváhagyok" sem cseréli le azt, amit a rendszer köznévnek
    // tart — azt kifejezetten ki kell pipálni a szereplapon.
    const allowed =
      m.autoReplaceable ||
      (opts.approveAll === true && m.disposition !== 'reject') ||
      opts.approved?.has(i) === true;
    if (!allowed) {
      pending.push(m);
      return;
    }
    const entity = entities.get(m.entityId);
    if (!entity) {
      pending.push(m);
      return;
    }
    const replacement = renderReplacement(m, entity, ctx);
    if (replacement === null) {
      pending.push(m);
      return;
    }

    let before = text.slice(cursor, m.start);
    const fixed = fixDefiniteArticle(before, replacement);
    if (fixed !== before) {
      articlesFixed++;
      before = fixed;
    }
    pieces.push(before, replacement);
    cursor = m.end;
    replaced++;
  });

  pieces.push(text.slice(cursor));
  return { text: pieces.join(''), replaced, pending, articlesFixed };
}

const TRAILING_ARTICLE = /(^|[^A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű])(a|az|A|Az|AZ)(\s+)$/;

/**
 * A határozott névelő igazítása a csere után. "az Aranykalász" → "a Tűzkő",
 * "a Nagy" → "az Obszidián". Enélkül minden névcsere után nyelvtani hiba marad.
 */
export function fixDefiniteArticle(before: string, replacement: string): string {
  const m = TRAILING_ARTICLE.exec(before);
  if (!m) return before;

  const [, lead = '', article = '', space = ''] = m;
  // A csere első SZAVA dönt (a névelőtagot is beleértve: "dr." → "a dr.").
  const firstWord = replacement.trim().split(/\s+/)[0] ?? replacement;
  const wantAz = needsAz(firstWord);
  const isAz = article.toLowerCase() === 'az';
  if (wantAz === isAz) return before;

  const capitalized = article[0] === article[0]?.toUpperCase();
  const allCaps = article === article.toUpperCase() && article.length > 1;
  let corrected = wantAz ? 'az' : 'a';
  if (allCaps) corrected = corrected.toUpperCase();
  else if (capitalized) corrected = corrected[0]!.toUpperCase() + corrected.slice(1);

  return before.slice(0, before.length - m[0].length) + lead + corrected + space;
}
