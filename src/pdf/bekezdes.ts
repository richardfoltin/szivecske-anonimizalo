/**
 * BEKEZDÉSEK A PDF SORAIBÓL — és a bekezdés újratördelése.
 *
 * MIÉRT KELL. A PDF-ben nincs bekezdés, csak SOROK: mindegyik külön rajzolási
 * utasítás, saját kezdőponttal. Amikor egy nevet lecserélünk, a sor hossza
 * megváltozik — az álnév ritkán ugyanolyan hosszú, mint a valódi név. Ha
 * soronként rajzolunk újra, két dolog romlik el egyszerre:
 *
 *   1. A SORKIZÁRÁS ELVÉSZ. Az eredeti sort a szedő úgy húzta ki a jobb
 *      margóig, hogy a szóközöket megnyújtotta; a mi újrarajzolt sorunk
 *      normál szóközökkel áll, tehát a jobb széle csipkés lesz. Egy
 *      bíróságra menő iraton ez azonnal látszik.
 *   2. A SOR KIFUT A MARGÓBÓL. Egy hosszabb álnév a sor végén egyszerűen
 *      túlnyúlik a lap szélén, mert a szöveg nem tud a következő sorba
 *      csordulni — a sor a fájlban egy önálló utasítás.
 *
 * A megoldás az, amit egy szövegszerkesztő is tesz: nem a SORT rajzoljuk újra,
 * hanem a BEKEZDÉST. Összeszedjük a bekezdés összes sorát, a cserék után
 * összeálló szöveget újratördeljük a bekezdés saját szélességére, és a sorokat
 * kizárjuk — a bekezdés eredeti sorhelyeire.
 *
 * MIT NEM VÁLLAL. A bekezdés nem nőhet: a soraink helye kötött, alattuk másik
 * bekezdés áll. Ha az újratördelés több sort kívánna, mint amennyi hely van,
 * inkább nem nyúlunk hozzá (a hívó ilyenkor a soronkénti útra esik vissza) —
 * egy egymásra csúszott két bekezdés rosszabb a csipkés jobb szélnél.
 */

import type { TextSegment } from './textRuns.js';

/** Két érték egyezése ponttal mért tűréssel. */
function kozel(a: number, b: number, tures: number): boolean {
  return Math.abs(a - b) <= tures;
}

export interface Bekezdes {
  /** A bekezdés sorai, felülről lefelé. */
  sorok: TextSegment[];
  /** A bal margó (minden sor innen indul). */
  x: number;
  /** A jobb margó — a kizárt sorok eddig érnek. */
  jobbSzel: number;
  /** Igaz, ha a bekezdés sorkizárt volt (a sorok jobb széle egy vonalban áll). */
  sorkizart: boolean;
}

/**
 * A SOROK BEKEZDÉSEKBE RENDEZÉSE.
 *
 * A döntés három jelre támaszkodik, mert egy sem elég önmagában:
 *
 *   – A BAL MARGÓ. Ami máshonnan indul, az más bekezdés (behúzás, középre
 *     zárt cím, másik hasáb).
 *   – A SORKÖZ. A bekezdésen belül állandó; a bekezdések között nagyobb. A
 *     küszöböt nem tapasztalatból lőjük be, hanem az ELSŐ két sor távolságából
 *     — így a mérték az iraté, nem a miénk.
 *   – A BETŰMÉRET. Más méret más szerep: cím, lábjegyzet, aláírásblokk.
 *
 * A tartalomfolyam is számít: egy Form XObjectből (fejléc, bélyegző) érkező
 * sor sosem tartozik a lap törzsszövegéhez, akkor sem, ha véletlenül egy
 * vonalba esik vele.
 */
export function bekezdesekre(segments: readonly TextSegment[]): Bekezdes[] {
  const out: Bekezdes[] = [];
  let jelenlegi: TextSegment[] = [];
  let sorkoz: number | null = null;

  const lezar = (): void => {
    if (jelenlegi.length > 0) out.push(keszitBekezdes(jelenlegi));
    jelenlegi = [];
    sorkoz = null;
  };

  for (const seg of segments) {
    const elozo = jelenlegi[jelenlegi.length - 1];
    if (!elozo) {
      jelenlegi.push(seg);
      continue;
    }
    const dy = elozo.y - seg.y;
    const folytatas =
      seg.streamId === elozo.streamId &&
      kozel(seg.x, elozo.x, 1) &&
      kozel(seg.fontSize, elozo.fontSize, 0.6) &&
      // Lefelé haladunk, és nem ugorhatunk vissza: a hasábváltás vagy az új
      // oldal felfelé lép, az pedig sosem ugyanannak a bekezdésnek a folytatása.
      dy > 0 &&
      (sorkoz === null ? dy < seg.fontSize * 2 : kozel(dy, sorkoz, 1.5));

    if (!folytatas) {
      lezar();
      jelenlegi.push(seg);
      continue;
    }
    if (sorkoz === null) sorkoz = dy;
    jelenlegi.push(seg);
  }
  lezar();
  return out;
}

function keszitBekezdes(sorok: TextSegment[]): Bekezdes {
  const x = sorok[0]!.x;
  /*
    A JOBB MARGÓT A KIZÁRT SOROK ADJÁK MEG, nem az utolsó.

    A bekezdés utolsó sora sorkizárás mellett is rövid — épp attól utolsó. Ha
    őt is beszámítanánk a margóba, minden bekezdés a saját utolsó sorának
    hosszához igazodna, és a szöveg fokozatosan összeszűkülne.
  */
  const teljesek = sorok.length > 1 ? sorok.slice(0, -1) : sorok;
  const jobbSzel = Math.max(...teljesek.map((s) => s.x + s.width));

  /*
    SORKIZÁRT VOLT-E. Ha a teljes sorok jobb széle egy vonalban áll, akkor a
    szedő kizárta őket; ha szóródik, balra zárt (vagy középre) a bekezdés.

    A tűrés azért ilyen bőkezű (4 pont), mert a sor szélessége nálunk az
    utolsó futam becslésével zárul (lásd `TextSegment.width`): egy betűnyi
    bizonytalanság soronként. Szigorúbb tűrés mellett minden kizárt bekezdést
    balra zártnak látnánk, és sosem javítanánk azt, amiért ez az egész van.
  */
  const sorkizart =
    teljesek.length > 1 && teljesek.every((s) => kozel(s.x + s.width, jobbSzel, 4));

  return { sorok, x, jobbSzel, sorkizart };
}

/**
 * Egy szó a kész sorban.
 *
 * A `kezd`/`veg` a BEMENETI szövegben elfoglalt helye. Erre a kiemelésnek van
 * szüksége: a csereszöveg helyét a bekezdés szövegében ismerjük, a lapon
 * viszont azt kell megjelölni, ahova az újratördelés végül tette — és az
 * másik sorba is kerülhet, mint ahol az eredeti állt.
 */
export interface TordeltSzo {
  szoveg: string;
  x: number;
  szelesseg: number;
  kezd: number;
  veg: number;
}

export interface TordeltSor {
  /** Az alapvonal y-ja — a bekezdés eredeti sorhelyeiből. */
  y: number;
  /** A sor szavai a saját x-ükkel; kizárás esetén a szóközök meg vannak nyújtva. */
  szavak: TordeltSzo[];
}

/**
 * EGY BEKEZDÉS ÚJRATÖRDELÉSE — a saját szélességére, a saját sorhelyeire.
 *
 * @param mer  a szöveg szélességét adja pontban, azzal a betűvel és mérettel,
 *             amivel a hívó rajzolni fog. Azért visszahívás, hogy ez a modul
 *             ne ismerje a PDF-könyvtárat: a tördelés szabályai a betűkészlet
 *             nélkül is leírhatók, és így önmagukban mérhetők.
 * @returns `null`, ha a bekezdés nem fér el a rendelkezésre álló sorokban. A
 *          hívó ilyenkor NEM tördel: egy alsó szomszédjára csúszott bekezdés
 *          rosszabb a csipkés jobb szélnél, és néma is — a fájlban nem
 *          látszik, hogy valami elromlott.
 */
export function ujratordel(
  b: Bekezdes,
  szoveg: string,
  mer: (t: string) => number,
): TordeltSor[] | null {
  /*
    A SZAVAK A HELYÜKKEL EGYÜTT. A puszta `split` eldobná, hogy a szó hol állt
    a bekezdés szövegében — pedig a kiemelésnek épp az kell: a csereszöveg
    helyét a szövegben ismerjük, és meg kell találni, a lapon hova került.
  */
  const szavak: { szoveg: string; kezd: number; veg: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(szoveg)) !== null) {
    szavak.push({ szoveg: m[0], kezd: m.index, veg: m.index + m[0].length });
  }
  if (szavak.length === 0) return [];

  const szelesseg = b.jobbSzel - b.x;
  if (szelesseg <= 0) return null;
  const szokoz = mer(' ');

  // Mohó tördelés, ahogy a szövegszerkesztők: a sorba addig teszünk szót, amíg
  // elfér. Egy szó, ami magában sem fér el (hosszú azonosító), a saját sorát
  // kapja — kilóg, de nem tünteti el a következő szót.
  const sorok: (typeof szavak)[] = [];
  let sor: typeof szavak = [];
  let sorSzelesseg = 0;
  for (const szo of szavak) {
    const w = mer(szo.szoveg);
    const uj = sor.length === 0 ? w : sorSzelesseg + szokoz + w;
    if (sor.length > 0 && uj > szelesseg) {
      sorok.push(sor);
      sor = [szo];
      sorSzelesseg = w;
      continue;
    }
    sor.push(szo);
    sorSzelesseg = uj;
  }
  if (sor.length > 0) sorok.push(sor);

  // NEM FÉR EL: a bekezdés alatt másik bekezdés áll, nincs hova nyúlnia.
  if (sorok.length > b.sorok.length) return null;

  return sorok.map((szavakASorban, i) => {
    const y = b.sorok[i]!.y;
    /*
      A KIZÁRÁS AZ UTOLSÓ SORRA NEM VONATKOZIK.

      Egy kizárt utolsó sor a legárulkodóbb tipográfiai hiba: a „egymással."
      két szava a lap két szélére feszülne. A bekezdés utolsó sora balra zárt
      marad — akkor is, ha a bekezdés egyébként sorkizárt.
    */
    const utolso = i === sorok.length - 1;
    const kizar = b.sorkizart && !utolso && szavakASorban.length > 1;

    const sajat = szavakASorban.reduce((a, w) => a + mer(w.szoveg), 0);
    const resek = szavakASorban.length - 1;
    const rescsak = kizar ? (szelesseg - sajat) / resek : szokoz;
    /*
      A NYÚJTÁS NEM MEHET AKÁRMEDDIG. Ha egy sorban két szó van, és a szöveg a
      csere után sokkal rövidebb lett, a kizárás a lap két szélére feszítené
      őket — ez olvashatatlan, és jobban látszik, mint a csipkés szél. Ilyenkor
      inkább balra zárjuk a sort.
    */
    const res = kizar && rescsak > szokoz * 4 ? szokoz : rescsak;

    let x = b.x;
    const szavakKi: TordeltSzo[] = szavakASorban.map((w) => {
      const szelessege = mer(w.szoveg);
      const tetel: TordeltSzo = { szoveg: w.szoveg, x, szelesseg: szelessege, kezd: w.kezd, veg: w.veg };
      x += szelessege + res;
      return tetel;
    });
    return { y, szavak: szavakKi };
  });
}
