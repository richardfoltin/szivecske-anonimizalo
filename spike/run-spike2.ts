/**
 * Spike 2 — PDF: valódi betűtörlés és sor-újraszedés.
 *
 * A kérdés: ki tudjuk-e venni egy név betűit a PDF tartalomfolyamából (nem
 * ráfesteni, hanem TÖRÖLNI), és a helyére tudunk-e magyar ékezetes álnevet
 * szedni úgy, hogy egy MÁSIK könyvtár se találja meg utána az eredetit?
 *
 * A biztonsági szakirodalom (Bland–Iyer–Levchenko, PETS 2023) szerint a
 * kitakart szöveg visszafejthető a betűk mikro-elcsúszásaiból, ezért NEM
 * szabad az álnevet az eredeti szélességébe beleszorítani. Ehelyett a TELJES
 * SORT újraszedjük — így semmilyen szélességviszony nem marad meg.
 *
 *   npm run spike2
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { SeedMatcher } from '../src/hu/matcher.js';
import type { Gender, SeedEntity } from '../src/hu/names.js';
import { assignPseudonyms, buildContext, substitute, type Theme } from '../src/pseudonym.js';
import { extractTextSegments, deleteRanges, type ByteRange, type Matrix } from '../src/pdf/textRuns.js';
import { buildPageText, segmentTextAfterEdits, type Edit } from '../src/pdf/pageText.js';
import { parseToUnicode, type CMap } from '../src/pdf/toUnicode.js';
import { makeSamplePdf } from './make-sample-pdf.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'spike', 'out');

/** Magyar ékezeteket biztosan tartalmazó rendszerbetűkészletek, sorrendben. */
const FALLBACK_FONTS = [
  'C:/Windows/Fonts/times.ttf',
  'C:/Windows/Fonts/timesbd.ttf',
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/calibri.ttf',
];

function bar(s: string): string {
  return `\n${'─'.repeat(78)}\n${s}\n${'─'.repeat(78)}`;
}

/** Egy oldal tartalomfolyama egyben (a Contents tömb is lehet). */
function readContent(page: ReturnType<PDFDocument['getPage']>): Uint8Array {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array();
  if (contents instanceof PDFArray) {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const st = page.node.context.lookup(contents.get(i));
      if (st instanceof PDFRawStream) parts.push(decodePDFRawStream(st).decode());
    }
    const total = parts.reduce((a, b) => a + b.length + 1, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
      out[o++] = 0x0a;
    }
    return out;
  }
  return decodePDFRawStream(contents as unknown as PDFRawStream).decode();
}

/** A betűkészletek ToUnicode tábláinak beolvasása erőforrásnév szerint. */
function readFonts(page: ReturnType<PDFDocument['getPage']>): Map<string, { cmap: CMap | null }> {
  const out = new Map<string, { cmap: CMap | null }>();
  const res = page.node.Resources();
  const fonts = res?.lookup(PDFName.of('Font'), PDFDict);
  if (!fonts) return out;
  for (const [key, ref] of fonts.entries()) {
    const f = page.node.context.lookup(ref, PDFDict);
    const tuRef = f?.get(PDFName.of('ToUnicode'));
    let cmap: CMap | null = null;
    if (tuRef) {
      const st = page.node.context.lookup(tuRef);
      if (st instanceof PDFRawStream) cmap = parseToUnicode(decodePDFRawStream(st).decode());
    }
    out.set(key.asString().replace(/^\//, ''), { cmap });
  }
  return out;
}

interface SampleParty {
  canonical: string;
  type: 'PERSON' | 'ORG' | 'LOC';
  role: string;
  gender: Gender;
}

const TITLE_PREFIX = /^((?:prof\.\s*)?(?:dr\.|ifj\.|id\.|özv\.|néhai|prof\.)\s*)+/i;

function toEntities(parties: SampleParty[]): SeedEntity[] {
  const out: SeedEntity[] = [];
  let n = 0;
  for (const p of parties) {
    const id = `E${++n}`;
    if (p.type === 'ORG') { out.push({ kind: 'org', id, name: p.canonical, role: p.role }); continue; }
    if (p.type === 'LOC') { out.push({ kind: 'place', id, name: p.canonical }); continue; }
    const bare = p.canonical.trim().replace(TITLE_PREFIX, '').trim();
    const parts = bare.split(/\s+/);
    const withMaiden = /^(.+?)né$/.exec(parts[0] ?? '');
    if (withMaiden && parts.length >= 3 && p.gender === 'F') {
      out.push({ kind: 'person', id, surname: withMaiden[1]!, given: parts[parts.length - 1]!, maidenSurname: parts.slice(1, -1).join(' '), wifeOf: withMaiden[1]!, gender: 'F', role: p.role });
      continue;
    }
    const married = /^(.*?)né$/.exec(bare);
    if (married && p.gender === 'F' && parts.length >= 2) {
      const hp = married[1]!.trim().split(/\s+/);
      out.push({ kind: 'person', id, surname: hp[0] ?? bare, given: hp.slice(1).join(' '), wifeOf: married[1]!.trim(), gender: 'F', role: p.role });
      continue;
    }
    out.push({ kind: 'person', id, surname: parts[0] ?? bare, given: parts.slice(1).join(' '), gender: p.gender, role: p.role });
  }
  return out;
}

interface Redraw {
  pageIndex: number;
  x: number;
  y: number;
  size: number;
  text: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log(bar('SPIKE 2 — PDF: betűtörlés és sor-újraszedés'));

  const stem = 'keresetlevel';
  const sample = JSON.parse(readFileSync(join(ROOT, 'samples', `${stem}.json`), 'utf8')) as {
    text: string;
    parties: SampleParty[];
    must_keep: string[];
  };

  const srcPdf = join(OUT, `${stem}.pdf`);
  if (!existsSync(srcPdf)) makeSamplePdf(stem);
  const srcBytes = readFileSync(srcPdf);
  console.log(`Forrás PDF: ${srcPdf} (${(srcBytes.length / 1024).toFixed(1)} kB) — fejnélküli Chrome készítette`);

  const doc = await PDFDocument.load(srcBytes);
  doc.registerFontkit(fontkit);

  const fontPath = FALLBACK_FONTS.find((f) => existsSync(f));
  if (!fontPath) throw new Error('Nem találtam ékezetes betűkészletet a rendszerben.');
  const embedded = await doc.embedFont(readFileSync(fontPath), { subset: true });
  console.log(`Beágyazott pótbetűkészlet: ${fontPath}`);

  // --- felek és álnevek ---
  const entities = toEntities(sample.parties);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const theme = JSON.parse(readFileSync(join(ROOT, 'data', 'themes', 'kokorszak.json'), 'utf8')) as Theme;
  const assignments = assignPseudonyms(entities, theme, { caseSecret: 'spike2-kulcs', preferSimilarLength: true });
  const ctx = buildContext('theme', entities, assignments);
  const matcher = new SeedMatcher(entities);

  console.log('\nSZEREPLAP:');
  for (const a of assignments.values()) {
    console.log(`  ${a.original.padEnd(32)} → ${a.display}`);
  }

  // --- oldalanként: szakaszok kiolvasása, csere, betűtörlés ---
  const redraws: Redraw[] = [];
  const newContents: (Uint8Array | null)[] = [];
  let totalSegments = 0;
  let touchedSegments = 0;
  let deletedOps = 0;
  let crossLineMatches = 0;
  const missingGlyphs = new Set<string>();

  for (let pi = 0; pi < doc.getPageCount(); pi++) {
    const page = doc.getPage(pi);
    const content = readContent(page);
    const fonts = readFonts(page);
    const segments = extractTextSegments(content, fonts, [1, 0, 0, 1, 0, 0] as Matrix);
    totalSegments += segments.length;

    // Az egész oldalt egy szövegként keressük, hogy a sortörésen átnyúló nevek
    // (a sor végén "Hármashatár Ingatlanforgalmazó", a következő elején
    // "Zrt.-vel") is meglegyenek.
    const pageText = buildPageText(segments);
    const matches = matcher.find(pageText.text);

    const edits: Edit[] = [];
    for (const m of matches) {
      const entity = byId.get(m.entityId);
      if (!entity) continue;
      const one = substitute(pageText.text.slice(m.start, m.end), [{ ...m, start: 0, end: m.end - m.start }], byId, ctx, {
        approveAll: true,
      });
      if (one.replaced === 0) continue;
      edits.push({ start: m.start, end: m.end, replacement: one.text });
      if (m.end > (pageText.spans.find((s) => s.start <= m.start && m.start < s.end)?.end ?? m.end)) {
        crossLineMatches++;
      }
    }

    const toDelete: ByteRange[] = [];
    for (const span of pageText.spans) {
      const newText = segmentTextAfterEdits(span, edits);
      if (newText === span.segment.text) continue;

      touchedSegments++;
      toDelete.push(...span.segment.opRanges);
      deletedOps += span.segment.opRanges.length;
      redraws.push({
        pageIndex: pi,
        x: span.segment.x,
        y: span.segment.y,
        size: span.segment.fontSize,
        text: newText,
      });

      // Betűkészlet-lefedettség: a magyar ő és ű a leggyakoribb hiányzó glifa.
      for (const ch of newText) {
        try {
          embedded.widthOfTextAtSize(ch, 10);
        } catch {
          missingGlyphs.add(ch);
        }
      }
    }

    newContents.push(toDelete.length > 0 ? deleteRanges(content, toDelete) : null);
  }

  console.log(
    `\nSzövegszakasz (sor) összesen: ${totalSegments}, ebből érintett: ${touchedSegments}`,
  );
  console.log(`Törölt betűrajzoló utasítás: ${deletedOps}`);
  console.log(`Sortörésen átnyúló név: ${crossLineMatches} — ezeket soronkénti kereséssel nem találnánk meg`);
  if (missingGlyphs.size > 0) {
    console.log(`FIGYELEM — hiányzó glifa a pótbetűkészletben: ${[...missingGlyphs].join(' ')}`);
  } else {
    console.log('A pótbetűkészlet minden magyar ékezetes betűt tartalmaz (ő, ű is).');
  }

  // --- új tartalomfolyam kiírása, majd az új sorok kiszedése ---
  for (let pi = 0; pi < doc.getPageCount(); pi++) {
    const replacement = newContents[pi];
    if (!replacement) continue;
    const page = doc.getPage(pi);
    const stream = page.node.context.flateStream(replacement);
    const ref = page.node.context.register(stream);
    page.node.set(PDFName.of('Contents'), ref);
  }

  for (const r of redraws) {
    const page = doc.getPage(r.pageIndex);
    page.drawText(r.text, {
      x: r.x,
      y: r.y,
      size: r.size,
      font: embedded,
      color: rgb(0, 0, 0),
    });
  }

  // Metaadat-tisztítás: a szerző, a cím és a készítő is szivárgás.
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('Szivecske Anonimizáló');
  doc.setCreator('Szivecske Anonimizáló');

  const outPdf = join(OUT, `${stem}.anonim.pdf`);
  // Teljes újraírás, SOHA nem növekményes mentés: különben a régi tartalom
  // ott marad a fájlban, és visszafejthető.
  writeFileSync(outPdf, await doc.save({ useObjectStreams: false }));
  console.log(`\nKimenet: ${outPdf}`);

  // --- ellenőrzés MÁSIK könyvtárral ---
  await verifyWithPdfJs(outPdf, entities, sample.must_keep, [...assignments.values()].map((a) => a.display));
}

/**
 * Az ellenőrzés szándékosan MÁS könyvtárral fut, mint az átírás (pdf.js, nem
 * pdf-lib): ha ugyanaz a kód írná és ellenőrizné, a saját hibáit nem venné észre.
 */
async function verifyWithPdfJs(
  pdfPath: string,
  entities: SeedEntity[],
  mustKeep: string[],
  pseudonyms: string[],
): Promise<void> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;

  let all = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    all += tc.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }

  const meta = await doc.getMetadata();
  const info = (meta.info ?? {}) as Record<string, unknown>;

  console.log(bar('ELLENŐRZÉS (pdf.js — másik könyvtár)'));
  console.log(`Kinyert szöveg: ${all.length} karakter`);

  const matcher = new SeedMatcher(entities);
  const leaks = matcher.find(all);
  console.log(`\nEredeti névtalálat a kimenetben: ${leaks.length}`);
  for (const l of leaks.slice(0, 10)) {
    console.log(`  SZIVÁRGÁS: "${l.surface}" — ${l.reason}`);
  }

  const present = pseudonyms.filter((p) => all.includes(p.split(/\s+/)[0] ?? p));
  console.log(`\nÁlnév megjelenik a kimenetben: ${present.length}/${pseudonyms.length}`);

  const keptOk = mustKeep.filter((k) => all.includes(k.replace(TITLE_PREFIX, '').trim().split(/\s+/)[0] ?? k));
  console.log(`Bent maradt, aminek bent kell maradnia: ${keptOk.length}/${mustKeep.length}`);

  const metaLeaks = Object.entries(info).filter(([, v]) => typeof v === 'string' && v.length > 0 && entities.some((e) => {
    const n = e.kind === 'person' ? e.surname : e.name;
    return (v as string).includes(n);
  }));
  console.log(`Metaadat-szivárgás: ${metaLeaks.length}`);
  console.log(`  Producer: ${String(info.Producer ?? '')} | Creator: ${String(info.Creator ?? '')} | Author: ${String(info.Author ?? '(üres)')}`);

  const ok = leaks.length === 0 && metaLeaks.length === 0;
  console.log(bar(ok ? 'DÖNTÉS: a spike ÁTMENT — az eredeti nevek nincsenek a fájlban.' : 'DÖNTÉS: még nem megy át.'));
  process.exit(ok ? 0 : 1);
}

await main();
