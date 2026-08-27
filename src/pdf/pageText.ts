/**
 * Oldalszintű szöveg a PDF szövegszakaszaiból, visszaképzéssel.
 *
 * Miért kell: a PDF-ben a sortörés fizikai. A "Hármashatár Ingatlanforgalmazó
 * Zrt." név az egyik sor végén kezdődik és a következő elején folytatódik, két
 * külön tartalomfolyam-szakaszban. Ha soronként keresnénk, ezt a nevet SOHA nem
 * találnánk meg — pedig ott van. Ezért az egész oldalt egy szövegként kezeljük,
 * és a találatokat képezzük vissza a szakaszokra.
 */

import type { TextSegment } from './textRuns.js';

export interface SegmentSpan {
  index: number;
  /** A szakasz szövegének helye az oldalszintű szövegben. */
  start: number;
  end: number;
  segment: TextSegment;
}

export interface PageText {
  text: string;
  spans: SegmentSpan[];
}

/** A szakaszok összefűzése egy szóközzel, hogy a sortörésen átnyúló nevek is egyben legyenek. */
export function buildPageText(segments: TextSegment[]): PageText {
  const spans: SegmentSpan[] = [];
  let text = '';
  segments.forEach((segment, index) => {
    if (index > 0) text += ' ';
    const start = text.length;
    text += segment.text;
    spans.push({ index, start, end: text.length, segment });
  });
  return { text, spans };
}

export interface Edit {
  start: number;
  end: number;
  replacement: string;
  /**
   * MELYIK TALÁLAT ÍRTA — csak a megjelenítésnek.
   *
   * A visszaírás (PDF és DOCX egyaránt) nem nézi: neki a tartomány és a
   * csereszöveg elég. Az álnevesített lapkép kiemeléseihez viszont vissza kell
   * találni a találathoz, hogy a szín a fajtáját mondja el, a buboréksúgó
   * pedig azt, mi került az eredeti helyére.
   */
  matchId?: number;
}

/** Hova került egy csereszöveg a szakasz ÚJ szövegében. */
export interface EditPlacement {
  edit: Edit;
  /** A csereszöveg helye az új szövegben (karakterindex). */
  start: number;
  end: number;
}

/**
 * Egy szakasz új szövege az oldalszintű szerkesztések alapján.
 *
 * A több szakaszon átnyúló csere teljes egészében az ELSŐ érintett szakaszba
 * kerül, a többiből a lefedett rész kimarad. A sor hossza így változik — ez
 * szándékos: a szélességviszony megőrzése éppen az a hiba, amiből a kitakart
 * szöveg visszafejthető (Bland et al., PETS 2023).
 */
export function segmentTextAfterEdits(span: SegmentSpan, edits: Edit[]): string {
  return segmentEditPlan(span, edits).text;
}

/**
 * UGYANAZ A SZÁMÍTÁS, a csereszövegek helyével együtt.
 *
 * Az álnevesített lapkép kiemelése ebből tudja, hol áll a kész sorban az
 * álnév. Nem külön számítás: a `segmentTextAfterEdits` maga is ezt hívja.
 * Két másolat ebből a szabályból pontosan úgy csúszna szét, mint annak
 * idején a kimenet-számításból — a kiemelés a rossz szóra kerülne, és a
 * felhasználó a MELLETTE álló szót hinné lecseréltnek.
 */
export function segmentEditPlan(
  span: SegmentSpan,
  edits: Edit[],
): { text: string; placements: EditPlacement[] } {
  const relevant = edits
    .filter((e) => e.start < span.end && span.start < e.end)
    .sort((a, b) => a.start - b.start);
  if (relevant.length === 0) return { text: span.segment.text, placements: [] };

  const placements: EditPlacement[] = [];
  let out = '';
  let cursor = span.start;
  for (const e of relevant) {
    const from = Math.max(cursor, span.start);
    const editStart = Math.max(e.start, span.start);
    if (editStart > from) out += sliceGlobal(span, from, editStart);
    // A cserét csak abban a szakaszban írjuk ki, amelyikben a találat KEZDŐDIK.
    if (e.start >= span.start) {
      placements.push({ edit: e, start: out.length, end: out.length + e.replacement.length });
      out += e.replacement;
    }
    cursor = Math.max(cursor, Math.min(e.end, span.end));
  }
  if (cursor < span.end) out += sliceGlobal(span, cursor, span.end);
  return { text: out, placements };
}

function sliceGlobal(span: SegmentSpan, from: number, to: number): string {
  return span.segment.text.slice(from - span.start, to - span.start);
}
