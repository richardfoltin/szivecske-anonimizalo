/**
 * Magyar személy- és szervezetnevek felszíni alakjainak előállítása.
 *
 * A termék alapötlete: az ügyvéd megadja a feleket, mi pedig megkeressük az
 * ÖSSZES alakjukat a szövegben. Ez a modul állítja elő azt a listát, ami alapján
 * keresünk.
 *
 * Minden variáns tartalmazza a saját "receptjét" is (prefix + mag + tail), így a
 * cserénél nem kell visszafejteni, mit találtunk: ugyanazt a receptet lefuttatjuk
 * az álnévre, és pontosan a helyes alakot kapjuk. "Kovács úrnak" → "Kőszikla
 * úrnak", "dr. Kovács Jánossal" → "dr. Kőszikla Fréddel".
 */

import {
  ALL_CASES,
  type CaseTag,
  type NameOverrides,
  inflectName,
  inflectOrganization,
  inflectWord,
} from './inflect.js';

export type Gender = 'F' | 'M' | 'N';

/** A név melyik része áll a felszíni alak magjában. */
export type CoreShape =
  | 'full' // Kovács János
  | 'reversed' // János Kovács
  | 'surname' // Kovács
  | 'given' // János
  | 'wife_full' // Kovács Jánosné
  | 'wife_surname' // Kovácsné
  | 'wife_maiden' // Kovácsné Szabó Anna
  | 'maiden_full' // Szabó Anna (leánykori név önállóan)
  | 'maiden_surname' // Szabó
  | 'identifier' // kovacs.janos@pelda.hu — névrészlet azonosítóba ágyazva
  | 'family' // Kovácsék
  | 'initials_both' // K. J.
  | 'initials_both_tight' // K.J.
  | 'initials_surname' // K. János
  | 'initials_given' // Kovács J.
  | 'org' // Aranykalász Kereskedelmi Kft.
  | 'org_short' // Aranykalász Kft.
  | 'org_stem' // Aranykalász
  | 'org_abbrev' // MFB
  | 'place'; // Szolnok

export interface Variant {
  /** A keresendő felszíni alak. */
  text: string;
  /** A mag: melyik névrész. */
  core: CoreShape;
  /**
   * A magon (vagy a tail-en, ha van) lévő rag. Ha `tail` nem üres, a mag
   * alanyesetben áll, és a ragot a tail hordozza.
   */
  caseTag: CaseTag;
  /** Változatlanul átemelendő előtag, pl. "dr. ". */
  prefix: string;
  /** Változatlanul átemelendő utótag a ragjával együtt, pl. " úrnak". */
  tail: string;
  /**
   * Mennyire biztos, hogy ez az alak tényleg erre a félre utal.
   * 1.0 = egyértelmű; 0.4 = önmagában kétes, emberi jóváhagyás kell.
   */
  confidence: number;
  /** Magyar magyarázat a szereplapra. */
  reason: string;
}

export interface SeedPerson {
  kind: 'person';
  id: string;
  /** Vezetéknév, pl. "Kovács". Kettős névnél "Kiss-Nagy". */
  surname: string;
  /** Keresztnév(ek), pl. "János". */
  given: string;
  /** Asszonynév esetén a férj teljes neve. */
  wifeOf?: string;
  /** Leánykori vezetéknév: "Kovácsné Szabó Anna" → "Szabó". */
  maidenSurname?: string;
  gender: Gender;
  /** Eljárási szerep, pl. "felperes", "I. r. alperes". */
  role?: string;
  overrides?: NameOverrides;
}

export interface SeedOrganization {
  kind: 'org';
  id: string;
  name: string;
  /** Rövidítés, ha a szöveg használja: "Magyar Fejlesztési Bank Zrt." → "MFB". */
  abbreviation?: string;
  role?: string;
  overrides?: NameOverrides;
}

export interface SeedPlace {
  kind: 'place';
  id: string;
  name: string;
  /**
   * Melyik helyhatározót veszi fel a településnév. A magyar helynevek lexikálisan
   * oszlanak meg: "Szolnokon", de "Debrecenben"; "Győrben", de "Miskolcon".
   * Szabályból nem levezethető, ezért adat. Alapértelmezés: -n (superessivus).
   */
  locative?: 'sup' | 'ine';
  overrides?: NameOverrides;
}

export type SeedEntity = SeedPerson | SeedOrganization | SeedPlace;

/** Megszólítások; a rag ezekre kerül, nem a névre. */
export const HONORIFICS = ['úr', 'asszony', 'kisasszony'] as const;

/** Névelőtagok. Nem részei a névnek, de együtt fordulnak elő vele. */
export const TITLES = ['dr.', 'Dr.', 'DR.', 'ifj.', 'id.', 'özv.', 'néhai', 'prof. dr.', 'Prof. Dr.'] as const;

/** A -né és a -ék önálló képzők, nem a teljes ragozási paradigma tagjai. */
const INFLECTABLE_CASES = ALL_CASES.filter((t) => t !== 'WIFE' && t !== 'FAM');

export interface VariantOptions {
  /** Vezetéknevek, amelyek köznévként is előfordulnak (Nagy, Kis, Szabó...). */
  homonyms?: Set<string>;
  /** Keresztnevek, amelyek több félnél is előfordulnak. */
  ambiguousGivenNames?: Set<string>;
}

export interface CoreBuilder {
  core: CoreShape;
  /** A mag adott ragozott alakja. */
  render: (tag: CaseTag) => string;
  confidence: number;
  reason: string;
  /** Fűzhető-e hozzá megszólítás ("Kovács úr"). */
  allowHonorific?: boolean;
  /** Fűzhető-e hozzá névelőtag ("dr. Kovács János"). */
  allowTitle?: boolean;
  /** Ragozható-e egyáltalán (a monogram nem). */
  inflectable?: boolean;
}

/** A személy magjainak leírása — ebből származik minden felszíni alak. */
export function personCores(p: SeedPerson, opts: VariantOptions = {}): CoreBuilder[] {
  const ov = p.overrides ?? {};
  const homonyms = opts.homonyms ?? new Set<string>();
  const ambiguous = opts.ambiguousGivenNames ?? new Set<string>();

  const full = `${p.surname} ${p.given}`.trim();
  const reversed = `${p.given} ${p.surname}`.trim();
  const surnameIsHomonym = homonyms.has(p.surname.toLowerCase());
  const givenIsAmbiguous = ambiguous.has(p.given.toLowerCase()) || homonyms.has(p.given.toLowerCase());

  /**
   * Van-e saját keresztneve. "Kovács Jánosné" esetén NINCS: a nő nevében a
   * "János" a férj keresztneve, ezért ebből a félből nem szabad "Kovács János"
   * alakot gyártani — az a férj neve, és az összemosásuk hibás összevonás.
   */
  const hasOwnFullName = p.given.trim().length > 0 && !(p.wifeOf && !p.maidenSurname);

  const cores: CoreBuilder[] = [];

  if (hasOwnFullName) {
    cores.push(
      {
        core: 'full',
        render: (t) => inflectName(full, t, ov),
        confidence: 1.0,
        reason: 'teljes név',
        allowHonorific: true,
        allowTitle: true,
      },
      {
        core: 'reversed',
        render: (t) => inflectName(reversed, t, ov),
        confidence: 1.0,
        reason: 'fordított névsorrend',
        allowTitle: true,
      },
      {
        core: 'given',
        render: (t) => inflectName(p.given, t, ov),
        confidence: givenIsAmbiguous ? 0.4 : 0.75,
        reason: givenIsAmbiguous ? 'csak keresztnév — több félnél is előfordul' : 'csak keresztnév',
      },
    );
  }

  cores.push(
    {
      core: 'surname',
      render: (t) => inflectName(p.surname, t, ov),
      confidence: surnameIsHomonym ? 0.4 : 0.85,
      reason: surnameIsHomonym
        ? 'csak vezetéknév — köznévvel azonos alakú'
        : 'csak vezetéknév',
      allowHonorific: true,
      allowTitle: true,
    },
    {
      core: 'family',
      render: (t) => inflectName(inflectWord(p.surname, 'FAM', ov), t),
      confidence: 0.8,
      reason: 'család (-ék)',
    },
  );

  if (p.wifeOf) {
    const wifeFull = inflectName(p.wifeOf, 'WIFE', ov);
    cores.push({
      core: 'wife_full',
      render: (t) => inflectName(wifeFull, t),
      confidence: 1.0,
      reason: 'asszonynév (-né)',
      allowHonorific: true,
      allowTitle: true,
    });
    const husbandSurname = p.wifeOf.trim().split(/\s+/)[0];
    if (husbandSurname) {
      const wifeSurname = inflectWord(husbandSurname, 'WIFE');
      cores.push({
        core: 'wife_surname',
        render: (t) => inflectName(wifeSurname, t),
        confidence: 0.9,
        reason: 'asszonynév vezetéknévből (-né)',
        allowHonorific: true,
      });
      if (p.maidenSurname) {
        const maiden = p.maidenSurname;
        const combined = `${wifeSurname} ${maiden} ${p.given}`.trim();
        cores.push(
          {
            core: 'wife_maiden',
            render: (t) => inflectName(combined, t, ov),
            confidence: 1.0,
            reason: 'asszonynév leánykori névvel',
            allowTitle: true,
          },
          // A leánykori név ÖNÁLLÓAN is előfordul — tipikusan az "anyja neve"
          // rovatban, ahol csak az szerepel: "anyja neve: Fehér Ilona".
          {
            core: 'maiden_full',
            render: (t) => inflectName(`${maiden} ${p.given}`.trim(), t, ov),
            confidence: 1.0,
            reason: 'leánykori név',
            allowTitle: true,
            allowHonorific: true,
          },
          {
            core: 'maiden_surname',
            render: (t) => inflectName(maiden, t, ov),
            confidence: homonyms.has(maiden.toLowerCase()) ? 0.4 : 0.8,
            reason: homonyms.has(maiden.toLowerCase())
              ? 'csak leánykori vezetéknév — köznévvel azonos alakú'
              : 'csak leánykori vezetéknév',
            allowHonorific: true,
          },
        );
      }
    }
  }

  const si = firstLetter(p.surname);
  const gi = firstLetter(p.given);
  if (hasOwnFullName && si && gi) {
    cores.push(
      { core: 'initials_both', render: () => `${si}. ${gi}.`, confidence: 0.6, reason: 'monogram', inflectable: false },
      { core: 'initials_both_tight', render: () => `${si}.${gi}.`, confidence: 0.6, reason: 'monogram szóköz nélkül', inflectable: false },
      { core: 'initials_surname', render: (t) => `${si}. ${inflectName(p.given, t, ov)}`, confidence: 0.8, reason: 'rövidített vezetéknév' },
      { core: 'initials_given', render: () => `${p.surname} ${gi}.`, confidence: 0.85, reason: 'rövidített keresztnév', inflectable: false },
    );
  }

  return cores;
}

export function organizationCores(o: SeedOrganization): CoreBuilder[] {
  const ov = o.overrides ?? {};
  const cores: CoreBuilder[] = [
    { core: 'org', render: (t) => inflectOrganization(o.name, t, ov), confidence: 1.0, reason: 'szervezet teljes neve' },
  ];
  const stem = stripCompanyForm(o.name);
  const form = companyForm(o.name);
  if (stem && stem !== o.name) {
    cores.push({
      core: 'org_stem',
      render: (t) => inflectName(stem, t, ov),
      confidence: 0.7,
      reason: 'szervezet neve cégforma nélkül',
    });
  }
  // Rövidített hivatkozás: az első szó + a cégforma. A jogi iratok az első
  // említés után rendszerint így hivatkoznak: "Aranykalász Kereskedelmi Kft."
  // → "az Aranykalász Kft.".
  const firstWord = stem.split(/\s+/)[0];
  if (form && firstWord && firstWord !== stem) {
    const short = `${firstWord} ${form}`;
    cores.push({
      core: 'org_short',
      render: (t) => inflectOrganization(short, t, ov),
      confidence: 0.95,
      reason: 'szervezet rövidebb megnevezése',
    });
  }
  if (o.abbreviation) {
    const abbrev = o.abbreviation;
    cores.push({
      core: 'org_abbrev',
      render: (t) => inflectName(abbrev, t, { ...ov, hyphenate: true }),
      confidence: 0.9,
      reason: 'szervezet rövidítése',
    });
  }
  return cores;
}

export function placeCores(pl: SeedPlace): CoreBuilder[] {
  return [
    {
      core: 'place',
      render: (t) => inflectName(pl.name, t, pl.overrides ?? {}),
      confidence: 1.0,
      reason: 'helynév',
    },
  ];
}

export function entityCores(e: SeedEntity, opts: VariantOptions = {}): CoreBuilder[] {
  switch (e.kind) {
    case 'person':
      return personCores(e, opts);
    case 'org':
      return organizationCores(e);
    case 'place':
      return placeCores(e);
  }
}

/** Egy entitás összes keresendő felszíni alakja, recepttel együtt. */
export function entityVariants(e: SeedEntity, opts: VariantOptions = {}): Variant[] {
  const out: Variant[] = [];
  const gender = e.kind === 'person' ? e.gender : 'N';

  for (const c of entityCores(e, opts)) {
    const tags = c.inflectable === false ? (['NOM'] as CaseTag[]) : INFLECTABLE_CASES;

    for (const tag of tags) {
      const body = c.render(tag);
      out.push({ text: body, core: c.core, caseTag: tag, prefix: '', tail: '', confidence: c.confidence, reason: c.reason });
    }

    // A névelőtag ("dr. Nagy") és a megszólítás ("Nagy úr") önmagában erős jel:
    // felülírja a köznévi homonímia miatti bizonytalanságot.
    const STRONG = 0.92;

    if (c.allowTitle) {
      for (const title of TITLES) {
        for (const tag of tags) {
          out.push({
            text: `${title} ${c.render(tag)}`,
            core: c.core,
            caseTag: tag,
            prefix: `${title} `,
            tail: '',
            confidence: Math.max(c.confidence, STRONG),
            reason: `${c.reason}, névelőtaggal (${title})`,
          });
        }
      }
    }

    if (c.allowHonorific) {
      const nominative = c.render('NOM');
      for (const h of HONORIFICS) {
        if (gender === 'M' && h !== 'úr') continue;
        if (gender === 'F' && h === 'úr') continue;
        for (const tag of INFLECTABLE_CASES) {
          const honorific = inflectWord(h, tag);
          out.push({
            text: `${nominative} ${honorific}`,
            core: c.core,
            caseTag: tag,
            prefix: '',
            tail: ` ${honorific}`,
            confidence: Math.max(c.confidence, STRONG),
            reason: `${c.reason}, megszólítással (${h})`,
          });
        }
      }
    }
  }

  return dedupe(out);
}

const COMPANY_FORMS = /\s+(Nonprofit\s+)?(Kft\.|Zrt\.|Nyrt\.|Bt\.|Kkt\.|Kht\.|Ec\.|Rt\.)$/i;

export function stripCompanyForm(name: string): string {
  return name.replace(COMPANY_FORMS, '').trim();
}

/** A cégforma-utótag ("Kft.") kinyerése, hogy a csere megőrizhesse. */
export function companyForm(name: string): string {
  const m = COMPANY_FORMS.exec(name);
  return m ? m[0].trim() : '';
}

function firstLetter(word: string): string | null {
  const ch = word.trim()[0];
  return ch ? ch.toUpperCase() : null;
}

/** Azonos felszíni alakból a legmagasabb megbízhatóságút tartjuk meg. */
function dedupe(list: Variant[]): Variant[] {
  const best = new Map<string, Variant>();
  for (const v of list) {
    const prev = best.get(v.text);
    if (!prev || v.confidence > prev.confidence) best.set(v.text, v);
  }
  return [...best.values()];
}

/**
 * Milyen tövekre fusson az "ismeretlen toldalék" biztonsági keresés.
 * Ezek akkor is megtalálják a nevet, ha a rag nincs a paradigmában
 * ("Kovács-féle", "Kovácsi", "Kovácsékhoz").
 */
export function stemsForFallback(e: SeedEntity): string[] {
  switch (e.kind) {
    case 'person': {
      const stems = [e.surname, e.given, `${e.surname} ${e.given}`];
      if (e.wifeOf) stems.push(e.wifeOf, inflectName(e.wifeOf, 'WIFE'));
      if (e.maidenSurname) stems.push(e.maidenSurname);
      return stems;
    }
    case 'org': {
      const stems = [e.name, stripCompanyForm(e.name)];
      if (e.abbreviation) stems.push(e.abbreviation);
      return stems.filter(Boolean);
    }
    case 'place':
      return [e.name];
  }
}
