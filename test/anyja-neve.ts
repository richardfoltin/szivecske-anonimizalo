/**
 * Az „anyja neve" rovat változatai.
 *
 * A név magát a nyelvi modell akkor is megtalálja, ha a rovatot nem ismerjük
 * fel — de a SZEREP elveszik, és a találat az „egyéb" kategóriába csúszik. Az
 * anyja neve az egyik legérzékenyebb személyes adat: az azonosításhoz gyakran
 * elég önmagában, ezért a szerepének látszania kell a felek listáján.
 */

import { detectByStructure } from '../src/app/detect.js';

let pass = 0;
let fail = 0;

function probal(cimke: string, szoveg: string, varhatoNev: string): void {
  const r = detectByStructure(szoveg);
  const talalt = r.parties.find((p) => p.fullName.includes(varhatoNev));
  const ok = talalt?.role === 'anyja neve';
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(
      `  BUKOTT: ${cimke} — ${talalt ? `szerep: „${talalt.role}"` : 'a nevet sem találta meg'}`,
    );
  }
}

console.log('');

// A tankönyvi alak, ami eddig is ment.
probal('anyja neve:', 'Kovács János felperes, anyja neve: Kiss Erika, lakik: Vác.', 'Kiss Erika');

// Anyakönyvi iratok szokásos alakja.
probal(
  'anyja születési neve:',
  'Nagy Péter alperes, anyja születési neve: Fehér Ilona, született Vácon.',
  'Fehér Ilona',
);

// Űrlapok és táblázatcellák rövidítései.
probal('an.:', 'Szabó Márton kezes, an.: Tóth Mária, lakcím: Budapest.', 'Tóth Mária');
probal('a. n.:', 'Balogh Gábor tanú, a. n.: Varga Anna, szül. 1980.', 'Varga Anna');

// Kettőspont nélkül — a Word-táblázatból másolt szövegben tipikus.
probal('kettőspont nélkül', 'Kovács János felperes\nanyja neve Kiss Erika\nlakcím Vác', 'Kiss Erika');

console.log(`\nAz „anyja neve" rovat: ${pass}/${pass + fail} ellenőrzés rendben`);
process.exit(fail === 0 ? 0 : 1);
