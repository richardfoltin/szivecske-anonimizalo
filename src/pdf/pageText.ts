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
  const relevant = edits
    .filter((e) => e.start < span.end && span.start < e.end)
    .sort((a, b) => a.start - b.start);
  if (relevant.length === 0) return span.segment.text;

  let out = '';
  let cursor = span.start;
  for (const e of relevant) {
    const from = Math.max(cursor, span.start);
    const editStart = Math.max(e.start, span.start);
    if (editStart > from) out += sliceGlobal(span, from, editStart);
    // A cserét csak abban a szakaszban írjuk ki, amelyikben a találat KEZDŐDIK.
    if (e.start >= span.start) out += e.replacement;
    cursor = Math.max(cursor, Math.min(e.end, span.end));
  }
  if (cursor < span.end) out += sliceGlobal(span, cursor, span.end);
  return out;
}

function sliceGlobal(span: SegmentSpan, from: number, to: number): string {
  return span.segment.text.slice(from - span.start, to - span.start);
}
