/**
 * Azonosítókba ágyazott névrészletek: e-mail cím, felhasználónév, domain,
 * fájlnév.
 *
 * A valódi mintadokumentumok azonnal megmutatták, hogy ez nem elméleti eset:
 * "kovacs.janos58@freemail.hu" és "nagy.peter@aranykalasz.hu" — a név ékezet
 * nélkül, kisbetűsen, ponttal tagolva. Egy sima szövegkeresés soha nem találja
 * meg, mégis ugyanolyan azonosító, mint maga a név.
 */

import { HU_LETTER_CLASS } from './phonology.js';

/**
 * E fölött cserélünk automatikusan, alatta emberi jóváhagyás kell.
 *
 * EGY helyen áll, mert két különböző felismerő használja: a névkereső
 * (matcher.ts) és az azonosító-kereső (azonositok.ts). Korábban mindkettő
 * SAJÁT 0.8-as másolatot tartott, azzal a megjegyzéssel, hogy „szándékosan
 * ugyanaz az érték" — vagyis a küszöb elcsúszása csendben megtörténhetett
 * volna: a két modul ugyanazt a 0..1 megbízhatósági skálát méri, de a
 * felhasználó két különböző határon látta volna a találatait. Ez a fájl azért
 * a közös otthon, mert mindkét modul már eddig is behúzta, tehát nem
 * keletkezik új körkörös függés.
 */
export const AUTO_REPLACE_THRESHOLD = 0.8;

const ACCENT_MAP: Record<string, string> = {
  á: 'a', Á: 'A',
  é: 'e', É: 'E',
  í: 'i', Í: 'I',
  ó: 'o', Ó: 'O',
  ö: 'o', Ö: 'O',
  ő: 'o', Ő: 'O',
  ú: 'u', Ú: 'U',
  ü: 'u', Ü: 'U',
  ű: 'u', Ű: 'U',
};

/**
 * Ékezetek eltávolítása. A magyar ékezetes betűk egy karakteren tárolódnak,
 * ezért a hossz és így a pozíciók változatlanok maradnak — ez fontos, mert a
 * találat pozícióit az EREDETI szövegre kell visszavezetni.
 */
export function stripAccents(s: string): string {
  let out = '';
  for (const ch of s) out += ACCENT_MAP[ch] ?? ch;
  return out;
}

/** Kereséshez normalizált alak: ékezet nélkül, kisbetűsen. */
export function normalizeForIdentifier(s: string): string {
  return stripAccents(s).toLowerCase();
}

/**
 * Azonosítónak látszó token: e-mail cím, URL, domain, felhasználónév vagy
 * fájlnév. Szándékosan bőkezű — a találatból úgyis a névrészlet dönt.
 */
export const IDENTIFIER_TOKEN = /[A-Za-z0-9._%+\-ÁÉÍÓÖŐÚÜŰáéíóöőúüű]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}|(?:https?:\/\/|www\.)[^\s,;)]+/g;

export interface IdentifierToken {
  start: number;
  end: number;
  text: string;
  kind: 'email' | 'url';
}

/**
 * MINDEN azonosítónak látszó token, függetlenül attól, hogy van-e benne
 * valamelyik fél neve.
 *
 * Erre azért van szükség, mert az e-mail cím ÖNMAGÁBAN azonosít. A korábbi
 * megoldás csak akkor vette elő, ha egy fél neve benne volt — így az irodai és
 * a harmadik személyes címek ("iroda@sarkozi.hu", "info@aranykalasz.hu")
 * érintetlenül átmentek a kimeneten, pedig egy e-mail cím legalább annyira
 * azonosít, mint egy lakcím.
 */
export function findIdentifierTokens(text: string): IdentifierToken[] {
  const out: IdentifierToken[] = [];
  IDENTIFIER_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IDENTIFIER_TOKEN.exec(text)) !== null) {
    const token = m[0];
    out.push({
      start: m.index,
      end: m.index + token.length,
      text: token,
      kind: token.includes('@') ? 'email' : 'url',
    });
  }
  return out;
}

export interface Fragment {
  entityId: string;
  /** Normalizált névrészlet, amit az azonosítóban keresünk. */
  needle: string;
  /** Melyik névrész — a cserénél ezt kell az álnév megfelelő részére cserélni. */
  part: 'surname' | 'given' | 'maiden' | 'org';
}

/**
 * Egy névrészlet csak akkor használható, ha elég hosszú ahhoz, hogy ne
 * találjon rá véletlenül.
 *
 * A korábbi négybetűs korlát a leggyakoribb magyar vezetéknevek egész
 * osztályát kizárta: Kis, Tar, Bán, Vas, Tót, Kun — mindegyik három betű.
 * Ezek soha nem kerültek a töredéklistába, így a "kis.erika@..." típusú
 * címekben a név bent maradt. Három betűnél viszont a puszta hossz már nem
 * bizonyíték, ezért ott betűhatárt is követelünk (lásd `fragmentFits`).
 */
const MIN_FRAGMENT = 3;

/** Ez alatt a hossz alatt a töredéknek betűhatáron kell állnia az azonosítón belül. */
const DELIMITED_BELOW = 4;

const IDENT_LETTER = new RegExp(`[${HU_LETTER_CLASS}]`);

/**
 * Betűhatáron áll-e a töredék az azonosítón belül.
 *
 * Csak a rövid, három betűs töredékeknél kérjük: a "vas" enélkül a
 * "vasarnap@..." közepébe is beleillene. A hosszabbaknál viszont ÁRTANA, mert
 * a "kovacsjanos58@..." alakban a "kovacs" után rögtön betű áll — ott maga a
 * hossz a bizonyíték, nem a határ.
 */
function fragmentFits(norm: string, needle: string, idx: number): boolean {
  if (needle.length >= DELIMITED_BELOW) return true;
  const before = norm[idx - 1];
  const after = norm[idx + needle.length];
  if (before !== undefined && IDENT_LETTER.test(before)) return false;
  if (after !== undefined && IDENT_LETTER.test(after)) return false;
  return true;
}

/** Előfordul-e a töredék az azonosítóban úgy, hogy a határfeltétel is teljesül. */
function containsFragment(norm: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const idx = norm.indexOf(needle, from);
    if (idx === -1) return false;
    if (fragmentFits(norm, needle, idx)) return true;
    from = idx + 1;
  }
}

export function buildFragments(
  entityId: string,
  parts: { surname?: string; given?: string; maiden?: string; org?: string },
): Fragment[] {
  const out: Fragment[] = [];
  for (const [part, value] of Object.entries(parts) as [Fragment['part'], string | undefined][]) {
    if (!value) continue;
    for (const word of value.split(/\s+/)) {
      const needle = normalizeForIdentifier(word);
      if (needle.length >= MIN_FRAGMENT) out.push({ entityId, needle, part });
    }
  }
  return out;
}

export interface IdentifierHit {
  start: number;
  end: number;
  token: string;
  entityId: string;
  /** Mely részletek találhatók benne. */
  parts: Fragment['part'][];
}

/** Azonosítók, amelyekbe valamelyik fél neve bele van építve. */
export function findIdentifiersWithNames(text: string, fragments: Fragment[]): IdentifierHit[] {
  const hits: IdentifierHit[] = [];
  IDENTIFIER_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IDENTIFIER_TOKEN.exec(text)) !== null) {
    const token = m[0];
    const norm = normalizeForIdentifier(token);
    const byEntity = new Map<string, Set<Fragment['part']>>();
    for (const f of fragments) {
      if (!containsFragment(norm, f.needle)) continue;
      const set = byEntity.get(f.entityId) ?? new Set<Fragment['part']>();
      set.add(f.part);
      byEntity.set(f.entityId, set);
    }
    // Ha több félre is illeszkedik (pl. személy + cég a domainben), a leghosszabb
    // egyezésű nyer; a többi az átnézési listán jelenik meg.
    for (const [entityId, parts] of byEntity) {
      hits.push({ start: m.index, end: m.index + token.length, token, entityId, parts: [...parts] });
    }
  }
  return hits;
}

/**
 * Az azonosító újraépítése az álnévből: a benne szereplő névrészleteket
 * ékezet nélküli álnévrészletekre cseréljük, a többit (számokat, domaint,
 * elválasztókat) változatlanul hagyjuk.
 *
 *   kovacs.janos58@freemail.hu  →  kvarcos.tuzko58@freemail.hu
 */
export function rewriteIdentifier(
  token: string,
  fragments: Fragment[],
  replacementFor: (part: Fragment['part']) => string | undefined,
): string {
  const norm = normalizeForIdentifier(token);
  // A leghosszabb részlettel kezdjük, hogy a rövidebb ne vágja szét.
  const ordered = [...fragments].sort((a, b) => b.needle.length - a.needle.length);

  const replaced: boolean[] = new Array(token.length).fill(false);
  const pieces: { start: number; end: number; text: string }[] = [];

  for (const f of ordered) {
    let from = 0;
    for (;;) {
      const idx = norm.indexOf(f.needle, from);
      if (idx === -1) break;
      const end = idx + f.needle.length;
      // A rövid töredék itt is csak betűhatáron cserélhető, különben a
      // "vas" a "vasarnap" közepét írná át.
      if (!fragmentFits(norm, f.needle, idx)) {
        from = idx + 1;
        continue;
      }
      if (!replaced.slice(idx, end).some(Boolean)) {
        const to = replacementFor(f.part);
        if (to) {
          for (let i = idx; i < end; i++) replaced[i] = true;
          pieces.push({ start: idx, end, text: normalizeForIdentifier(to) });
        }
      }
      from = idx + 1;
    }
  }

  if (pieces.length === 0) return token;
  pieces.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const p of pieces) {
    out += token.slice(cursor, p.start) + p.text;
    cursor = p.end;
  }
  out += token.slice(cursor);
  return out;
}
