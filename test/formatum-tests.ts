/**
 * A bemeneti formátum ellenőrzése.
 *
 * A veszély nem az, hogy a program elszáll egy rossz fájlon — az látható hiba.
 * A veszély az, hogy VÉGIGMEGY rajta: bináris kacatot olvas UTF-8-ként, nem
 * talál benne nevet, nem cserél semmit, és a végén „tiszta" minősítést ad. A
 * felhasználó ekkor kiadja a kezéből az érintetlen iratot abban a hitben, hogy
 * ki van takarva. Ezért itt minden nem támogatott formátumnál HANGOS elutasítást
 * várunk el.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentSession } from '../src/app/session.js';

const ROOT = process.cwd();
let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`  BUKOTT: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Elutasítja-e, és a mondat a felhasználónak szól-e. */
function elutasitja(bytes: number[], ext: string, kell: RegExp, cimke: string): void {
  const gond = DocumentSession.formatCheck(new Uint8Array(bytes), ext);
  check(`${cimke}: elutasítva`, gond !== null, 'átengedte');
  if (gond) {
    check(`${cimke}: a mondat magyar és útmutató`, kell.test(gond), gond);
    // Egy jogásznak szóló mondatban nincs helye fejlesztői szakszónak.
    check(
      `${cimke}: nincs benne fejlesztői szakszó`,
      !/undefined|null|Error|exception|stack/i.test(gond),
      gond,
    );
  }
}

const szoveg = (s: string): number[] => [...Buffer.from(s, 'latin1')];

console.log('');

// Régi Word (OLE-tároló) — ez a leggyakoribb eset a jogi gyakorlatban.
elutasitja(
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0],
  '.doc',
  /Word|docx/i,
  'régi .doc',
);

elutasitja(szoveg('{\\rtf1\\ansi teszt}'), '.rtf', /RTF|docx/i, 'RTF');

// OpenDocument: ZIP, amiben a mimetype az első bejegyzés.
elutasitja(
  [0x50, 0x4b, 0x03, 0x04, ...szoveg('mimetypeapplication/vnd.oasis.opendocument.text')],
  '.odt',
  /OpenDocument|docx/i,
  'OpenDocument',
);

elutasitja(
  [0x50, 0x4b, 0x03, 0x04, ...szoveg('[Content_Types].xml xl/workbook.xml')],
  '.xlsx',
  /Excel|táblázat/i,
  'Excel',
);

// Hamis kiterjesztés mindkét irányban.
elutasitja(szoveg('Ez egyszerű szöveg, nem PDF.'), '.pdf', /nem PDF/i, 'hamis .pdf');
elutasitja(szoveg('Ez egyszerű szöveg, nem Word.'), '.docx', /nem Word/i, 'hamis .docx');

// Bináris tartalom szöveges kiterjesztéssel: nulla bájt szövegfájlban nincs.
elutasitja([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], '.txt', /nem szöveges/i, 'PNG .txt néven');

elutasitja([], '.txt', /üres/i, 'üres fájl');

// ── Amit ÁT KELL engednie ────────────────────────────────────────────────
const atengedi = (bytes: Uint8Array, ext: string, cimke: string): void => {
  const gond = DocumentSession.formatCheck(bytes, ext);
  check(`${cimke}: átengedve`, gond === null, gond ?? '');
};

atengedi(new Uint8Array(readFileSync(join(ROOT, 'spike/out/keresetlevel.pdf'))), '.pdf', 'valódi PDF');
atengedi(new Uint8Array(readFileSync(join(ROOT, 'spike/out/keresetlevel.docx'))), '.docx', 'valódi DOCX');
atengedi(new Uint8Array(readFileSync(join(ROOT, 'samples/itelet.txt'))), '.txt', 'magyar szövegfájl');

// A DOCX rossz kiterjesztéssel is DOCX: a tartalom számít, nem a név.
atengedi(new Uint8Array(readFileSync(join(ROOT, 'spike/out/keresetlevel.docx'))), '.dokumentum', 'DOCX rossz kiterjesztéssel');

console.log(`\nFormátum-ellenőrzés: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
