/**
 * A PDF-szövegkinyerés kihagyásainak számbavétele.
 *
 * Miért külön szerkezet: ha egy betűkészletnek nincs ToUnicode táblája, a
 * program NEM LÁTJA az azzal szedett szöveget. Eddig ez pontosan úgy nézett ki,
 * mintha az irat tiszta lenne: nem lett találat, nem lett figyelmeztetés, a
 * jegyzőkönyv pedig azt írta, hogy nem maradt bent név. A „nem találtam nevet"
 * és a „nem is láttam a szöveget" két gyökeresen más állítás, és a
 * felhasználóval szemben csak a második becsületes.
 *
 * Ezért minden kihagyást megszámolunk, és a hívó (src/app/session.ts) viszi ki
 * a felületre. Ez a modul semmit nem dob el csendben.
 */

/** Egy betűkészlet kihagyásai egy oldalon. */
export interface FontWarning {
  /** Az erőforrásnév, ahogy a tartalomfolyam hivatkozik rá (pl. „F4"). */
  fontKey: string;
  /** A /BaseFont a PDF-ből, ha a hívó megadta — ettől lesz emberi a szöveg. */
  baseFont?: string;
  /** Nincs ToUnicode tábla: ezzel a készlettel EGY betűt sem tudunk kiolvasni. */
  missingToUnicode: boolean;
  /** A Tf által hivatkozott kulcs nincs az erőforrás-szótárban. */
  unknownFont: boolean;
  /** Hány karakterkód veszett el ezzel a készlettel. */
  unresolved: number;
}

export interface ExtractionWarnings {
  /** Hány karakterkódot nem tudtunk szöveggé alakítani összesen. */
  unresolvedCodes: number;
  /** Készletenkénti bontás — csak azok, ahol tényleg veszett el karakter. */
  fonts: FontWarning[];
  /**
   * Bejáratlanul hagyott Form XObjectek: körkörös vagy túl mély hivatkozás,
   * illetve a bejárási korlát elérése. Ami itt szerepel, azt NEM néztük meg.
   */
  skippedForms: string[];
  /** Hivatkozott, de fel nem oldható XObject-nevek. */
  unresolvedXObjects: string[];
}

export interface PageWarnings {
  /** Nulláról indexelt oldalszám, ahogy a munkamenet tartja. */
  page: number;
  warnings: ExtractionWarnings;
}

export function emptyWarnings(): ExtractionWarnings {
  return { unresolvedCodes: 0, fonts: [], skippedForms: [], unresolvedXObjects: [] };
}

export function hasWarnings(w: ExtractionWarnings): boolean {
  return w.unresolvedCodes > 0 || w.skippedForms.length > 0 || w.unresolvedXObjects.length > 0;
}

/** Oldalszámok emberi felsorolása: „2., 5. és 9." — sok oldalnál csak darabszám. */
function pageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b).map((p) => `${p + 1}.`);
  if (sorted.length === 0) return '';
  if (sorted.length > 6) return `${sorted.length} oldalon`;
  if (sorted.length === 1) return `a ${sorted[0]} oldalon`;
  return `a ${sorted.slice(0, -1).join(', ')} és ${sorted[sorted.length - 1]} oldalon`;
}

/**
 * Magyar figyelmeztetőszövegek a felületnek.
 *
 * Szándékosan kimondja a következményt is („a program NEM LÁTJA"), mert a puszta
 * darabszám nem árulja el a felhasználónak, hogy az iratban maradhatott név.
 */
export function formatPdfWarnings(pages: PageWarnings[]): string[] {
  const out: string[] = [];

  const blindPages: number[] = [];
  const blindFonts = new Set<string>();
  let blindCodes = 0;

  const partialPages: number[] = [];
  let partialCodes = 0;

  const skippedPages: number[] = [];
  let skippedForms = 0;

  const unresolvedPages: number[] = [];
  let unresolvedXObjects = 0;

  for (const { page, warnings } of pages) {
    for (const f of warnings.fonts) {
      if (f.missingToUnicode || f.unknownFont) {
        blindPages.push(page);
        blindFonts.add(f.baseFont ?? f.fontKey);
        blindCodes += f.unresolved;
      } else if (f.unresolved > 0) {
        partialPages.push(page);
        partialCodes += f.unresolved;
      }
    }
    if (warnings.skippedForms.length > 0) {
      skippedPages.push(page);
      skippedForms += warnings.skippedForms.length;
    }
    if (warnings.unresolvedXObjects.length > 0) {
      unresolvedPages.push(page);
      unresolvedXObjects += warnings.unresolvedXObjects.length;
    }
  }

  if (blindCodes > 0 || blindFonts.size > 0) {
    out.push(
      `${capitalize(pageList(blindPages))} ${blindFonts.size} betűkészlethez nincs használható ` +
        `ToUnicode tábla, ezért ${blindCodes} karaktert nem tudtunk elolvasni. Az ezekkel szedett ` +
        `szöveget a program NEM LÁTJA: ha név van benne, nem talál rá és nem is cseréli ki. ` +
        `Érintett betűkészlet: ${[...blindFonts].slice(0, 4).join(', ')}.`,
    );
  }
  if (partialCodes > 0) {
    out.push(
      `${capitalize(pageList(partialPages))} ${partialCodes} karakterkód hiányzik a betűkészlet ` +
        `ToUnicode táblájából; ezek a betűk kimaradtak a kiolvasott szövegből, így a rájuk eső ` +
        `nevekre a kereső nem illeszkedik.`,
    );
  }
  if (skippedForms > 0) {
    out.push(
      `${capitalize(pageList(skippedPages))} ${skippedForms} beágyazott tartalomrészt (Form XObject) ` +
        `kihagytunk — körkörös vagy túl mély hivatkozás. Az ezekben lévő szöveget nem néztük át.`,
    );
  }
  if (unresolvedXObjects > 0) {
    out.push(
      `${capitalize(pageList(unresolvedPages))} ${unresolvedXObjects} hivatkozott tartalomrészt nem ` +
        `sikerült megnyitni, ezért a tartalmát nem néztük át.`,
    );
  }
  return out;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
