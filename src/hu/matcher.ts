/**
 * Megadott felek keresése magyar szövegben, minden ragozott alakjukkal együtt.
 *
 * Két keresés fut egymás után:
 *  1. Pontos illesztés a legyártott alakokra, a leghosszabbtól a legrövidebbig.
 *  2. "Ismeretlen toldalék" biztonsági kör: a névtő + bármilyen kisbetűs végződés.
 *     Ez fogja meg azt, amit a paradigma nem tartalmaz ("Kovács-féle", "Kovácsi").
 *     Ezek NEM cserélődnek automatikusan, hanem az átnézési listára kerülnek —
 *     ez a különbség a "megtaláltuk" és a "kitaláltuk" között.
 */

import { HU_LETTER_CLASS } from './phonology.js';
import {
  type Fragment,
  AUTO_REPLACE_THRESHOLD,
  buildFragments,
  findIdentifiersWithNames,
  normalizeForIdentifier,
  stripAccents,
} from './identifiers.js';
import type { CaseTag } from './inflect.js';
import {
  type CoreShape,
  type SeedEntity,
  type Variant,
  type VariantOptions,
  entityVariants,
  stemsForFallback,
  stripCompanyForm,
} from './names.js';

export interface Match {
  /** Kezdő és záró karakterpozíció az EREDETI szövegben. */
  start: number;
  end: number;
  /** A szövegben ténylegesen szereplő karaktersorozat. */
  surface: string;
  entityId: string;
  /** Melyik névrész áll a magban; null, ha ismeretlen toldalékos találat. */
  core: CoreShape | null;
  caseTag: CaseTag | null;
  /** Változatlanul átemelendő előtag ("dr. ") és utótag (" úrnak"). */
  prefix: string;
  tail: string;
  confidence: number;
  reason: string;
  /** Igaz, ha csupa nagybetűs alakra illeszkedett. */
  upperCase: boolean;
  /** Igaz, ha több fél is illeszkedhet erre az alakra. */
  ambiguous: boolean;
  candidates: string[];
  /** Igaz, ha automatikusan cserélhető; hamis, ha emberi döntés kell. */
  autoReplaceable: boolean;
  /**
   * Mit kezdjen vele a szereplap:
   *  'auto'   — magabiztos találat, alapból cserélődik,
   *  'review' — bizonytalan, emberi döntést vár, alapból NEM cserélődik,
   *  'reject' — nagy valószínűséggel nem név (köznévi homonima), alapból
   *             elutasítva; a "mindent jóváhagyok" sem cseréli le.
   */
  disposition: 'auto' | 'review' | 'reject';
}

const BOUNDARY_BEFORE = `(?<![${HU_LETTER_CLASS}0-9])`;
const BOUNDARY_AFTER = `(?![${HU_LETTER_CLASS}])`;

/**
 * ALAPÉRTELMEZETT küszöb: e fölött cserélünk automatikusan, alatta emberi
 * jóváhagyás kell. Amit a példány ténylegesen használ, azt a konstruktor
 * `autoThreshold` beállítása dönti el — lásd `SeedMatcher.autoThreshold`.
 *
 * Az ÉRTÉK a közös helyen áll (identifiers.ts), mert az azonosító-kereső
 * ugyanezt a küszöböt méri ugyanazon a 0..1 skálán. Itt csak tovább adjuk,
 * hogy a modul eddigi nyilvános neve ne változzon.
 */
export { AUTO_REPLACE_THRESHOLD };

/** Ez alatt alapból elutasítjuk: szinte biztosan köznév, nem név. */
export const REJECT_THRESHOLD = 0.25;

/**
 * A felületi csúszka szélső értékei. A `src/app/settings.ts` ugyanezt a
 * tartományt ellenőrzi, DE a motor nem hagyatkozhat rá: a küszöb az elemzés
 * bemenetén, IPC-n át érkezik, és azon a határon senki nem validál. Egy 0-ra
 * állított küszöbtől minden bizonytalan találat magától cserélődne — épp az
 * ellenkezője annak, amit a csúszka ígér.
 */
const MIN_THRESHOLD = 0.5;
const MAX_THRESHOLD = 1;

/** A kapott küszöb a megengedett sávba szorítva; hibás értéknél az alapérték. */
export function clampThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AUTO_REPLACE_THRESHOLD;
  return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, value));
}

function dispositionOf(
  confidence: number,
  ambiguous: boolean,
  autoThreshold: number,
): 'auto' | 'review' | 'reject' {
  if (confidence < REJECT_THRESHOLD) return 'reject';
  if (confidence >= autoThreshold && !ambiguous) return 'auto';
  return 'review';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface IndexedVariant {
  entityId: string;
  variant: Variant;
  upperCase: boolean;
}

/**
 * Szövegnormalizálás: a sortöréssel elválasztott szavak összevonása
 * ("Ko-\nvács" → "Kovács"), pozíciótérképpel az eredetihez.
 */
export interface Normalized {
  text: string;
  /** map[i] = az i-edik normalizált karakter kezdőpozíciója az eredetiben. */
  map: number[];
}

export function normalizeForSearch(original: string): Normalized {
  const chars: string[] = [];
  const map: number[] = [];
  let i = 0;
  while (i < original.length) {
    const ch = original[i]!;
    if (ch === '-' || ch === '­') {
      const m = /^[ \t]*\r?\n[ \t]*/.exec(original.slice(i + 1));
      if (m) {
        i += 1 + m[0].length;
        continue;
      }
    }
    chars.push(ch);
    map.push(i);
    i++;
  }
  map.push(original.length);
  return { text: chars.join(''), map };
}

const DEFAULT_ROLE_WORDS = [
  'felperes', 'alperes', 'vádlott', 'tanú', 'sértett', 'kérelmező', 'kérelmezett',
  'beavatkozó', 'adós', 'hitelező', 'kezes', 'eladó', 'vevő', 'bérlő', 'bérbeadó',
  'megbízó', 'megbízott', 'ügyvéd', 'képviselő', 'örökös', 'indítványozó',
];

export class SeedMatcher {
  private readonly byText = new Map<string, IndexedVariant[]>();
  private readonly variantRegex: RegExp | null;
  private readonly fallbackStems: { entityId: string; stem: string }[] = [];
  private readonly givenNames = new Set<string>();
  private readonly roleWords: Set<string>;
  private readonly homonyms: Set<string>;
  private readonly surnameById = new Map<string, string>();
  /** Ékezet nélküli névrészletek e-mail címek és azonosítók átvizsgálásához. */
  private readonly fragments: Fragment[] = [];
  /**
   * Ékezet nélküli alakok: "Kovacs Janos" ugyanúgy azonosít, mint "Kovács
   * János". Gépelési kényelemből, régi rendszerekből és OCR-ből is így kerül
   * a szövegbe — élőfejben, aláírásblokkban, fájlnévben tipikus.
   */
  private readonly strippedIndex = new Map<string, IndexedVariant>();
  /**
   * PÉLDÁNYSZINTŰ küszöb, nem modulszintű állandó.
   *
   * Amíg állandó volt, a felületi csúszka értéke soha nem jutott el idáig: a
   * program mindig 0,8-cel dolgozott, miközben a felhasználó azt hitte,
   * szigorít vagy lazít. Példányszinten viszont egy futáson belül is
   * konzisztens marad, és a tesztek is állíthatják.
   */
  private readonly autoThreshold: number;

  constructor(
    entities: SeedEntity[],
    opts: VariantOptions & { roleWords?: string[]; autoThreshold?: number } = {},
  ) {
    this.homonyms = opts.homonyms ?? new Set<string>();
    this.autoThreshold = clampThreshold(opts.autoThreshold);
    for (const e of entities) {
      if (e.kind === 'person') {
        this.givenNames.add(e.given.toLowerCase());
        this.surnameById.set(e.id, e.surname.toLowerCase());
      }
      for (const v of entityVariants(e, opts)) {
        this.add(v.text, { entityId: e.id, variant: v, upperCase: false });
        const upper = v.text.toUpperCase();
        if (upper !== v.text) {
          this.add(upper, { entityId: e.id, variant: v, upperCase: true });
        }
        // Csak a magabiztos, többtagú alakokat vesszük fel ékezet nélkül:
        // egy ékezettelen puszta vezetéknév túl sok téves találatot adna.
        const stripped = stripAccents(v.text);
        if (stripped !== v.text && v.confidence >= 0.9 && v.text.includes(' ')) {
          this.strippedIndex.set(stripped.toLowerCase(), { entityId: e.id, variant: v, upperCase: false });
        }
      }
      for (const stem of stemsForFallback(e)) {
        if (stem.trim()) this.fallbackStems.push({ entityId: e.id, stem });
      }
      this.fragments.push(
        ...buildFragments(
          e.id,
          e.kind === 'person'
            ? { surname: e.surname, given: e.given, maiden: e.maidenSurname }
            : e.kind === 'org'
              ? { org: stripCompanyForm(e.name) }
              : { org: e.name },
        ),
      );
    }

    this.roleWords = new Set((opts.roleWords ?? DEFAULT_ROLE_WORDS).map((w) => w.toLowerCase()));

    const texts = [...this.byText.keys()].sort((a, b) => b.length - a.length);
    this.variantRegex =
      texts.length === 0
        ? null
        : new RegExp(`${BOUNDARY_BEFORE}(?:${texts.map(escapeRe).join('|')})${BOUNDARY_AFTER}`, 'g');
  }

  private add(text: string, iv: IndexedVariant): void {
    const list = this.byText.get(text);
    if (list) list.push(iv);
    else this.byText.set(text, [iv]);
  }

  /** Hány felszíni alakot tartunk nyilván (diagnosztikához). */
  get variantCount(): number {
    return this.byText.size;
  }

  /** Az összes találat az eredeti szöveg pozícióival, átfedés nélkül. */
  find(original: string): Match[] {
    const norm = normalizeForSearch(original);
    const matches: Match[] = [];
    const covered: boolean[] = new Array(norm.text.length).fill(false);

    if (this.variantRegex) {
      this.variantRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = this.variantRegex.exec(norm.text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (isCovered(covered, start, end)) continue;

        const entries = this.byText.get(m[0]) ?? [];
        if (entries.length === 0) continue;
        const ids = [...new Set(entries.map((e) => e.entityId))];
        const best = entries.reduce((a, b) => (b.variant.confidence > a.variant.confidence ? b : a));

        let confidence = best.variant.confidence;
        let reason = best.variant.reason;

        // Az azonos vezetéknevű felek (házastársak, testvérek) között a puszta
        // vezetéknév és a -ék alak nem valódi kétértelműség: ugyanazt a
        // családnevet kapják álnévként is.
        const sharedSurname =
          ids.length > 1 &&
          (best.variant.core === 'surname' || best.variant.core === 'family') &&
          new Set(ids.map((id) => this.surnameById.get(id))).size === 1;

        const reallyAmbiguous = ids.length > 1 && !sharedSurname;
        if (reallyAmbiguous) {
          confidence = Math.min(confidence, 0.4);
          reason = `${reason} — több félre is illeszkedik`;
        }
        if (confidence < 0.9) {
          const ctx = this.scoreContext(norm.text, start, end, best.variant);
          confidence = clamp(confidence + ctx.delta);
          if (ctx.note) reason = `${reason} — ${ctx.note}`;
        }

        mark(covered, start, end);
        matches.push({
          start: norm.map[start]!,
          end: norm.map[end]!,
          surface: original.slice(norm.map[start]!, norm.map[end]!),
          entityId: best.entityId,
          core: best.variant.core,
          caseTag: best.variant.caseTag,
          prefix: best.variant.prefix,
          tail: best.variant.tail,
          confidence,
          reason,
          upperCase: best.upperCase,
          ambiguous: reallyAmbiguous,
          candidates: ids,
          autoReplaceable: confidence >= this.autoThreshold && !reallyAmbiguous,
          disposition: dispositionOf(confidence, reallyAmbiguous, this.autoThreshold),
        });
      }
    }

    matches.push(...this.findAccentStripped(original, norm, covered));
    matches.push(...this.findEmbeddedIdentifiers(original, norm, covered));
    matches.push(...this.findUnknownSuffixes(original, norm, covered));
    matches.sort((a, b) => a.start - b.start);
    applyDiscourseBoost(matches, this.autoThreshold);
    return matches;
  }

  /**
   * Ékezet nélkül írt nevek. Az ékezetes magyar betűk egy karakteren tárolódnak,
   * ezért az ékezetlevétel nem tolja el a pozíciókat — a találat visszaképezhető
   * az eredeti szövegre. Ezek nem cserélődnek automatikusan: az ékezettelen alak
   * gyakran szándékos (idegen nyelvű melléklet), ezért emberi döntést kérünk.
   */
  private findAccentStripped(original: string, norm: Normalized, covered: boolean[]): Match[] {
    const out: Match[] = [];
    if (this.strippedIndex.size === 0) return out;

    const haystack = normalizeForIdentifier(norm.text);
    for (const [needle, iv] of this.strippedIndex) {
      let from = 0;
      for (;;) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        from = idx + 1;
        const end = idx + needle.length;
        if (isCovered(covered, idx, end)) continue;
        // Szóhatár-ellenőrzés az ékezet nélküli nézeten.
        const before = haystack[idx - 1];
        const after = haystack[end];
        if (before && /[a-z0-9]/.test(before)) continue;
        if (after && /[a-z]/.test(after)) continue;
        // Ha a szövegben ékezetesen áll, azt a pontos kör már megtalálta.
        if (norm.text.slice(idx, end) === iv.variant.text) continue;

        mark(covered, idx, end);
        out.push({
          start: norm.map[idx]!,
          end: norm.map[end]!,
          surface: original.slice(norm.map[idx]!, norm.map[end]!),
          entityId: iv.entityId,
          core: iv.variant.core,
          caseTag: iv.variant.caseTag,
          prefix: iv.variant.prefix,
          tail: iv.variant.tail,
          confidence: 0.7,
          reason: `${iv.variant.reason} — ékezet nélkül írva`,
          upperCase: false,
          ambiguous: false,
          candidates: [iv.entityId],
          autoReplaceable: false,
          disposition: 'review',
        });
      }
    }
    return out;
  }

  /**
   * E-mail címek, felhasználónevek és domainek, amelyekbe valamelyik fél neve
   * ékezet nélkül bele van építve: "kovacs.janos58@freemail.hu". Sima
   * szövegkeresés ezeket sosem találná meg, pedig ugyanúgy azonosítanak.
   */
  private findEmbeddedIdentifiers(original: string, norm: Normalized, covered: boolean[]): Match[] {
    const out: Match[] = [];
    // A beágyazott névrészlet magabiztos találat, de a küszöb ITT IS érvényes:
    // ha a felhasználó feljebb húzza a csúszkát, ezt is látni akarja.
    const confidence = 0.9;
    for (const hit of findIdentifiersWithNames(norm.text, this.fragments)) {
      if (isCovered(covered, hit.start, hit.end)) continue;
      mark(covered, hit.start, hit.end);
      out.push({
        start: norm.map[hit.start]!,
        end: norm.map[hit.end]!,
        surface: original.slice(norm.map[hit.start]!, norm.map[hit.end]!),
        entityId: hit.entityId,
        core: 'identifier',
        caseTag: 'NOM',
        prefix: '',
        tail: '',
        confidence,
        reason: `névrészlet azonosítóba ágyazva (${hit.parts.join(', ')})`,
        upperCase: false,
        ambiguous: false,
        candidates: [hit.entityId],
        autoReplaceable: confidence >= this.autoThreshold,
        disposition: dispositionOf(confidence, false, this.autoThreshold),
      });
    }
    return out;
  }

  /**
   * Névtő + ismeretlen kisbetűs végződés. Csak olyan helyen keres, amit az
   * első kör nem fedett le. Ezek soha nem cserélődnek automatikusan.
   */
  private findUnknownSuffixes(original: string, norm: Normalized, covered: boolean[]): Match[] {
    const out: Match[] = [];
    for (const { entityId, stem } of this.fallbackStems) {
      const re = new RegExp(
        `${BOUNDARY_BEFORE}(${escapeRe(stem)})([${HU_LETTER_CLASS}]{1,14})${BOUNDARY_AFTER}`,
        'g',
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(norm.text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        if (isCovered(covered, start, end)) continue;
        const suffix = m[2] ?? '';
        if (suffix !== suffix.toLowerCase()) continue; // nagybetűs folytatás = másik szó
        mark(covered, start, end);
        out.push({
          start: norm.map[start]!,
          end: norm.map[end]!,
          surface: original.slice(norm.map[start]!, norm.map[end]!),
          entityId,
          core: null,
          caseTag: null,
          prefix: '',
          tail: '',
          confidence: 0.5,
          reason: `ismeretlen toldalék: -${suffix} — ellenőrizendő`,
          upperCase: false,
          ambiguous: false,
          candidates: [entityId],
          autoReplaceable: false,
          disposition: 'review',
        });
      }
    }
    return out;
  }

  /** Környezeti jelek, amelyek eldöntik, hogy egy nagybetűs szó tényleg név-e. */
  private scoreContext(
    text: string,
    start: number,
    end: number,
    variant: Variant,
  ): { delta: number; note: string } {
    const before = text.slice(Math.max(0, start - 40), start);
    const after = text.slice(end, Math.min(text.length, end + 60));

    if (/(dr\.|Dr\.|DR\.|ifj\.|id\.|özv\.|néhai|prof\.)\s*$/.test(before)) {
      return { delta: 0.35, note: 'névelőtag előzi meg' };
    }
    const nextWordRaw = /^[\s,]*([^\s,.;:()]+)/.exec(after)?.[1] ?? '';
    const nextWord = nextWordRaw.toLowerCase();
    const nextWordBare = nextWord.replace(/[^a-záéíóöőúüű]/gi, '');
    if (this.givenNames.has(nextWord)) {
      return { delta: 0.35, note: 'keresztnév követi' };
    }
    if (/^(úr|asszony|kisasszony)/.test(nextWord)) {
      return { delta: 0.3, note: 'megszólítás követi' };
    }
    if (this.roleWords.has(nextWordBare)) {
      return { delta: 0.3, note: 'eljárási szerep követi' };
    }
    if (/^\s*\(/.test(after) && /szül|anyja neve|lakcím|lakos|adóazonosító/i.test(after)) {
      return { delta: 0.3, note: 'személyi adatok követik' };
    }
    const atSentenceStart = /(^|[.!?]\s+|\n\s*)$/.test(before);
    const nextIsLowercase = nextWordRaw.length > 0 && nextWordRaw[0] === nextWordRaw[0]!.toLowerCase();
    // Ez a jel CSAK a puszta, köznévvel azonos alakú vezetéknévre vonatkozik:
    // "Nagy a kockázat" köznév, de a "Kovácsék a tárgyalás után" név.
    const bareHomonymSurname =
      variant.core === 'surname' &&
      variant.prefix === '' &&
      variant.tail === '' &&
      this.homonyms.has(text.slice(start, end).toLowerCase());
    if (atSentenceStart && nextIsLowercase && bareHomonymSurname) {
      return { delta: -0.3, note: 'mondat elején, kisbetűs szó követi — valószínűleg köznév' };
    }
    if (atSentenceStart) {
      return { delta: -0.1, note: 'mondat elején áll, a nagybetű nem árulkodó' };
    }
    return { delta: 0, note: '' };
  }
}

/** Ezek a magok egyértelműen azonosítják a felet, amikor előfordulnak. */
const INTRODUCING_CORES = new Set<CoreShape>([
  'full', 'reversed', 'wife_full', 'wife_maiden', 'org', 'org_short', 'place',
]);

/** Ezek önmagukban kétesek, de a bemutatás után már nem. */
const SHORTHAND_CORES = new Set<CoreShape>([
  'surname', 'given', 'family', 'wife_surname', 'org_stem', 'org_abbrev',
  'initials_both', 'initials_both_tight', 'initials_surname', 'initials_given',
]);

/**
 * Diskurzus-szabály: a jogi irat egyszer bemutatja a felet teljes néven, utána
 * rövidít. Ha egy fél teljes neve MÁR SZEREPELT korábban a szövegben, akkor a
 * későbbi puszta vezetéknév, keresztnév vagy monogram már nem kétes — így nem
 * kerül feleslegesen az átnézési listára. Ez a legnagyobb tétel az átnézés
 * idejében, ami a felmérés szerint a termék legvalószínűbb bukási oka.
 */
function applyDiscourseBoost(matches: Match[], autoThreshold: number): void {
  const introduced = new Set<string>();
  for (const m of matches) {
    if (m.core !== null && INTRODUCING_CORES.has(m.core) && m.confidence >= autoThreshold) {
      introduced.add(m.entityId);
      continue;
    }
    if (m.core === null || !SHORTHAND_CORES.has(m.core)) continue;
    if (!introduced.has(m.entityId)) continue;
    if (m.ambiguous) continue;

    const boosted = Math.min(1, m.confidence + 0.35);
    if (boosted <= m.confidence) continue;
    m.confidence = boosted;
    m.reason = `${m.reason} — a fél teljes neve korábban már szerepelt`;
    m.autoReplaceable = boosted >= autoThreshold;
    m.disposition = m.autoReplaceable ? 'auto' : boosted < REJECT_THRESHOLD ? 'reject' : 'review';
  }
}

function isCovered(covered: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (covered[i]) return true;
  return false;
}

function mark(covered: boolean[], start: number, end: number): void {
  for (let i = start; i < end; i++) covered[i] = true;
}

function clamp(x: number): number {
  return Math.max(0, Math.min(1, x));
}
