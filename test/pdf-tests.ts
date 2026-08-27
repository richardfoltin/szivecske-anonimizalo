/**
 * A PDF-szövegkinyerés mérése — a minta a programból készül, nem Chrome-ból.
 *
 *   npx tsx test/pdf-tests.ts
 *
 * Miért gyártott minta: a spike/out/ alatti valódi minta-PDF-ekben (Chrome-ból
 * nyomtatott keresetlevél) EGYETLEN Form XObject sincs, és mind a hét
 * betűkészletüknek van ToUnicode táblája. Vagyis pontosan azt a két hibát nem
 * tudják kiváltani, amiről ez a mérés szól. A gyártott mintánál viszont
 * PONTOSAN tudjuk, melyik névből hány betűt hova rejtettünk el.
 *
 * A minta ezért szándékosan olyan, mint egy iratsablon:
 *  1. a törzsszöveg a lap saját /Contents folyamában,
 *  2. a fejléc (benne az ügyvéd nevével) egy Form XObjectben, saját /Matrix-szal
 *     és saját /Resources szótárral,
 *  3. részhalmazolt Type0 betűkészlet Identity-H kódolással — a kódok nem
 *     betűk, csak a ToUnicode tábla mondja meg, mi micsoda.
 */

import { PDFDocument, PDFName } from 'pdf-lib';

import {
  ROOT_STREAM_ID,
  type ContentStream,
  type FontInfo,
  deleteRanges,
  extractContent,
  groupRangesByStream,
} from '../src/pdf/textRuns.js';
import { readPageStreams } from '../src/pdf/resources.js';
import { formatPdfWarnings } from '../src/pdf/warnings.js';
import { buildPageText } from '../src/pdf/pageText.js';
import type { CMap } from '../src/pdf/toUnicode.js';

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (!ok) {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function bytes(s: string): Uint8Array {
  return Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
}

/**
 * Részhalmazolt betűkészlet utánzása: a betűk kódjai 1-től futnak, és
 * kizárólag a ToUnicode tábla mondja meg, melyik kód melyik magyar betű.
 * Pont úgy, ahogy egy valódi PDF-készítő csinálja.
 */
function subsetFont(corpus: string): {
  toUnicode: string;
  cmap: CMap;
  hex: (s: string) => string;
} {
  const codes = new Map<string, number>();
  for (const ch of corpus) if (!codes.has(ch)) codes.set(ch, codes.size + 1);

  const pairs = [...codes.entries()].map(
    ([ch, code]) => `<${code.toString(16).padStart(4, '0')}> <${ch.charCodeAt(0).toString(16).padStart(4, '0')}>`,
  );
  const toUnicode = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${pairs.length} beginbfchar`,
    ...pairs,
    'endbfchar',
    'endcmap',
    'end end',
  ].join('\n');

  const map = new Map<number, string>();
  for (const [ch, code] of codes) map.set(code, ch);

  return {
    toUnicode,
    cmap: { map, codeBytes: 2 },
    hex: (s) => [...s].map((ch) => (codes.get(ch) ?? 0).toString(16).padStart(4, '0')).join(''),
  };
}

const UGYVED = 'dr. Kővári Zsófia ügyvéd';
const BIROSAG = 'Fővárosi Törvényszék';
const TORZS = 'A felperes a keresetét fenntartja.';
const FONT = subsetFont(`${UGYVED}${BIROSAG}${TORZS}`);

// ─────────────── 1. Bejárás Form XObjectbe (tiszta egység) ───────────────

const formContent = bytes(
  `BT /F1 12 Tf 1 0 0 1 5 5 Tm <${FONT.hex(UGYVED)}> Tj ET\n` +
    `BT /F1 12 Tf 1 0 0 1 5 -15 Tm <${FONT.hex(BIROSAG)}> Tj ET\n`,
);
const pageContent = bytes(
  `BT /F1 11 Tf 1 0 0 1 72 600 Tm <${FONT.hex(TORZS)}> Tj ET\n` +
    `q 1 0 0 1 10 20 cm /Fej Do Q\n`,
);

const fonts = new Map<string, FontInfo>([['F1', { cmap: FONT.cmap, codeBytes: 2, baseFont: 'AAAAAA+Times' }]]);

const form: ContentStream & { matrix: [number, number, number, number, number, number] } = {
  id: '7 0 R',
  content: formContent,
  fonts,
  matrix: [1, 0, 0, 1, 50, 700],
};
const rootStream: ContentStream = {
  id: ROOT_STREAM_ID,
  content: pageContent,
  fonts,
  resolveXObject: (name) => (name === 'Fej' ? { kind: 'form', stream: form } : { kind: 'missing' }),
};

const walked = extractContent(rootStream);
const texts = walked.segments.map((s) => s.text);

check('a bejárás belép a Form XObjectbe', texts.includes(UGYVED), texts.join(' | '));
check('a törzsszöveg is megvan', texts.includes(TORZS), texts.join(' | '));
check('a form mindkét sora megvan', texts.includes(BIROSAG), texts.join(' | '));

const ugyvedSeg = walked.segments.find((s) => s.text === UGYVED);
check('a form szakasza a SAJÁT folyamát hordozza', ugyvedSeg?.streamId === '7 0 R', `${ugyvedSeg?.streamId}`);
check('a törzs szakasza a lap folyamáé', walked.segments.find((s) => s.text === TORZS)?.streamId === ROOT_STREAM_ID);

// A form /Matrix-a és a Do helyén érvényes CTM is beleszámít a helybe:
// (5,5) + /Matrix(50,700) + cm(10,20) = (65,725).
check('a /Matrix és a CTM is beleszámít a helybe', ugyvedSeg?.x === 65 && ugyvedSeg?.y === 725, `${ugyvedSeg?.x};${ugyvedSeg?.y}`);

const ranges = ugyvedSeg?.opRanges ?? [];
const grouped = groupRangesByStream(ranges);
check('a törlendő tartomány a form folyamára mutat', grouped.size === 1 && grouped.has('7 0 R'));
check(
  'a lap folyamára szűrve semmit nem törölnénk',
  deleteRanges(pageContent, ranges, ROOT_STREAM_ID).length === pageContent.length,
);

// A régi, egyfolyamos belépési pont szándékosan NEM lép be — így aki még úgy
// hívja, nem kap idegen folyamból származó bájttartományt a lap folyamára.
const flat = extractContent({ id: ROOT_STREAM_ID, content: pageContent, fonts });
check('feloldó nélkül nem lépünk be a formba', !flat.segments.some((s) => s.text === UGYVED));
check('feloldó nélkül a hiányt jelentjük', flat.warnings.unresolvedXObjects.includes('Fej'));

// Az oldalszintű szöveg a form sorait is tartalmazza — a keresőnek ez a bemenete.
check('a form szövege bekerül az oldalszintű szövegbe', buildPageText(walked.segments).text.includes(UGYVED));

// ─────────────── 2. Körkörös és túl mély hivatkozás ───────────────

const selfRef: ContentStream = {
  id: '9 0 R',
  content: bytes(`BT /F1 12 Tf 1 0 0 1 0 0 Tm <${FONT.hex(BIROSAG)}> Tj ET\n/Onmaga Do\n`),
  fonts,
  resolveXObject: (name) => (name === 'Onmaga' ? { kind: 'form', stream: selfRef } : { kind: 'missing' }),
};
const cyclic = extractContent({
  id: ROOT_STREAM_ID,
  content: bytes('/Kor Do\n'),
  fonts,
  resolveXObject: () => ({ kind: 'form', stream: selfRef }),
});
check('a körkörös hivatkozás megáll', cyclic.segments.length === 1, `${cyclic.segments.length} szakasz`);
check('a kihagyott folyamot jelentjük', cyclic.warnings.skippedForms.includes('9 0 R'));

// A kép nem hiány: minden szkennelt lapon van, a figyelmeztetése zaj lenne.
const withImage = extractContent({
  id: ROOT_STREAM_ID,
  content: bytes('/Kep Do\n'),
  fonts,
  resolveXObject: () => ({ kind: 'image' }),
});
check('a képre nem figyelmeztetünk', withImage.warnings.unresolvedXObjects.length === 0);

// ─────────────── 3. ToUnicode nélküli betűkészlet ───────────────

const blindFonts = new Map<string, FontInfo>([['F1', { cmap: null, codeBytes: 2, baseFont: 'BAAAAA+Times' }]]);
const blind = extractContent({
  id: ROOT_STREAM_ID,
  content: bytes(`BT /F1 12 Tf 1 0 0 1 72 700 Tm <${FONT.hex(UGYVED)}> Tj ET\n`),
  fonts: blindFonts,
});
check('ToUnicode nélkül nem állítunk valótlant a szövegről', blind.segments.length === 0);
check('a kimaradt karakterkódokat megszámoljuk', blind.warnings.unresolvedCodes === UGYVED.length, `${blind.warnings.unresolvedCodes} ≠ ${UGYVED.length}`);
check('a hiányzó táblát nevesítjük', blind.warnings.fonts[0]?.missingToUnicode === true && blind.warnings.fonts[0]?.baseFont === 'BAAAAA+Times');

// Hiányos tábla: a „ő" kimarad belőle. Egyetlen kiesett betű elég ahhoz, hogy
// a „Kővári" soha ne illeszkedjen — ez a némán csonkolt szöveg esete.
const holed = new Map(FONT.cmap.map);
for (const [code, ch] of holed) if (ch === 'ő') holed.delete(code);
const partial = extractContent({
  id: ROOT_STREAM_ID,
  content: bytes(`BT /F1 12 Tf 1 0 0 1 72 700 Tm <${FONT.hex(UGYVED)}> Tj ET\n`),
  fonts: new Map<string, FontInfo>([['F1', { cmap: { map: holed, codeBytes: 2 }, codeBytes: 2 }]]),
});
check('a hiányos tábla is számít', partial.warnings.unresolvedCodes === 1, `${partial.warnings.unresolvedCodes}`);
check('a csonka szöveget nem adjuk ki teljesnek', partial.segments[0]?.text === UGYVED.replace(/ő/g, ''));

// Ismeretlen erőforrásnév: a Tf olyan készletre hivatkozik, ami nincs a szótárban.
const unknown = extractContent({
  id: ROOT_STREAM_ID,
  content: bytes(`BT /F9 12 Tf 1 0 0 1 72 700 Tm <${FONT.hex(BIROSAG)}> Tj ET\n`),
  fonts,
});
check('az ismeretlen betűkészletet is jelentjük', unknown.warnings.fonts[0]?.unknownFont === true);

const messages = formatPdfWarnings([{ page: 1, warnings: blind.warnings }, { page: 4, warnings: blind.warnings }]);
check('a figyelmeztetés magyar és megnevezi az oldalt', messages.some((m) => m.includes('2. és 5. oldalon') && m.includes('NEM LÁTJA')), messages.join(' / '));

// ─────────────── 4. Valódi PDF: feloldás, törlés, visszaírás ───────────────

async function pdfRoundTrip(): Promise<void> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([595, 842]);

  const toUnicodeRef = ctx.register(ctx.flateStream(FONT.toUnicode));
  const descendantRef = ctx.register(
    ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'AAAAAA+Times', CIDToGIDMap: 'Identity' }),
  );
  const fontRef = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'AAAAAA+Times',
      Encoding: 'Identity-H',
      DescendantFonts: [descendantRef],
      ToUnicode: toUnicodeRef,
    }),
  );
  // A ToUnicode nélküli készlet: ugyanaz, csak a tábla hiányzik róla.
  const blindFontRef = ctx.register(
    ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'CAAAAA+Arial', Encoding: 'Identity-H', DescendantFonts: [descendantRef] }),
  );

  const formRef = ctx.register(
    ctx.flateStream(formContent, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, -20, 300, 20],
      Matrix: [1, 0, 0, 1, 50, 700],
      Resources: { Font: { F1: fontRef } },
    }),
  );

  // Csonka, kicsomagolhatatlan folyam — egy félbeszakadt letöltés ilyen. Nem
  // szabad kivétellel megbuknia a megnyitásnak, de némán sem tűnhet el.
  const brokenRef = ctx.register(
    ctx.stream(Uint8Array.from([0x78, 0x9c, 0x01, 0x02, 0x03]), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 10, 10],
      Filter: 'FlateDecode',
    }),
  );

  page.node.set(
    PDFName.of('Resources'),
    ctx.obj({ Font: { F1: fontRef, F9: blindFontRef }, XObject: { Fej: formRef, Csonka: brokenRef } }),
  );
  page.node.set(
    PDFName.of('Contents'),
    ctx.register(
      ctx.flateStream(
        `BT /F1 11 Tf 1 0 0 1 72 600 Tm <${FONT.hex(TORZS)}> Tj ET\n` +
          `BT /F9 11 Tf 1 0 0 1 72 560 Tm <${FONT.hex(BIROSAG)}> Tj ET\n` +
          `q 1 0 0 1 10 20 cm /Fej Do Q\n` +
          `q /Csonka Do Q\n`,
      ),
    ),
  );

  const opened = await PDFDocument.load(await doc.save({ useObjectStreams: false }));
  const streams = readPageStreams(opened.getPage(0));
  const found = extractContent(streams.root);
  const foundTexts = found.segments.map((s) => s.text);

  check('valódi PDF: a fejléc neve előkerül', foundTexts.includes(UGYVED), foundTexts.join(' | '));
  check('valódi PDF: a /Matrix a helyére teszi', found.segments.find((s) => s.text === UGYVED)?.y === 725);
  // A lap ToUnicode nélküli sora nem lesz szöveg — de nem is tűnik el nyomtalanul.
  check(
    'valódi PDF: a ToUnicode nélküli sort nem találjuk ki',
    !found.segments.some((s) => s.streamId === ROOT_STREAM_ID && s.text === BIROSAG),
  );
  check(
    'valódi PDF: a kimaradt karaktereket megszámoljuk',
    found.warnings.unresolvedCodes === BIROSAG.length,
    `${found.warnings.unresolvedCodes} ≠ ${BIROSAG.length}`,
  );
  check(
    'valódi PDF: a hiányzó tábla a /BaseFont nevével jelenik meg',
    found.warnings.fonts.some((f) => f.missingToUnicode && f.baseFont === 'CAAAAA+Arial'),
    JSON.stringify(found.warnings.fonts),
  );
  check('valódi PDF: a csonka folyam nem dönti el a megnyitást, hanem jelentődik', streams.unreadable.length === 1, streams.unreadable.join(','));
  check('valódi PDF: a csonka folyamot hiányként is jelentjük', found.warnings.unresolvedXObjects.includes('Csonka'));

  const target = found.segments.find((s) => s.text === UGYVED);
  const keep = found.segments.find((s) => s.text === BIROSAG && s.streamId !== ROOT_STREAM_ID);
  if (!target || !keep) {
    check('valódi PDF: a törléshez megvannak a szakaszok', false);
    return;
  }

  // Törlés folyamonként — a fejléc tartománya a form folyamába való.
  for (const [streamId, list] of groupRangesByStream(target.opRanges)) {
    const content = streams.content(streamId);
    check(`valódi PDF: a(z) ${streamId} folyam tartalma megvan`, content !== null);
    if (!content) continue;
    check(`valódi PDF: a(z) ${streamId} folyam visszaírható`, streams.write(streamId, deleteRanges(content, list, streamId)));
  }

  const reopened = await PDFDocument.load(await opened.save({ useObjectStreams: false }));
  const after = extractContent(readPageStreams(reopened.getPage(0)).root);
  const afterTexts = after.segments.map((s) => s.text);

  check('valódi PDF: a törölt név eltűnt a beágyazott folyamból', !afterTexts.includes(UGYVED), afterTexts.join(' | '));
  check('valódi PDF: a form másik sora megmaradt', afterTexts.includes(BIROSAG));
  check('valódi PDF: a törzsszöveg érintetlen', afterTexts.includes(TORZS));

  // Ha a /Matrix vagy a /Resources nem élte túl a visszaírást, a megmaradt sor
  // elcsúszna vagy olvashatatlanná válna.
  const keptAfter = after.segments.find((s) => s.text === BIROSAG && s.streamId !== ROOT_STREAM_ID);
  check('valódi PDF: a form szótára (/Matrix, /Resources) túlélte a visszaírást', keptAfter?.x === keep.x && keptAfter?.y === keep.y, `${keptAfter?.x};${keptAfter?.y} ≠ ${keep.x};${keep.y}`);

  // A nyers bájtokban sem maradhat ott a név: ez az igazi próba.
  const raw = Buffer.from(await reopened.save({ useObjectStreams: false })).toString('latin1');
  check('valódi PDF: a név kódjai a fájlból is eltűntek', !raw.includes(FONT.hex(UGYVED)));
}

await pdfRoundTrip();

console.log(`\nPDF: ${checks - failures}/${checks} ellenőrzés rendben`);
console.log('');
process.exit(failures === 0 ? 0 : 1);
