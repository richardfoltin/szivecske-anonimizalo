/**
 * Az alkalmazás emblémájának előállítása: MOZAIKOS (kikockázott) szivecske.
 *
 * A képi ötlet az, amit a tévében látni, amikor kitakarják valakinek az arcát.
 * Egy anonimizáló programnál ez nem díszítés: pontosan azt mutatja, amit a
 * program csinál — a felismerhető részletet durva kockákra cseréli, de a
 * körvonal megmarad.
 *
 * Két dolog dönti el, hogy ez mozaiknak látszik-e, vagy csak elmosott foltnak:
 *
 *  1. A kockák VALÓDI átlagolásból születnek, nem kézzel rajzolt négyzetekből.
 *     A szívet nagy felbontásban rajzoljuk meg, majd cellánként átlagoljuk —
 *     ez ugyanaz a művelet, amit a videós mozaikszűrő végez. Ezért a szélen
 *     félig fedett, halványabb kockák keletkeznek, ahogy az igazi kitakarásnál.
 *  2. A cellahatárok EGÉSZ képpontra esnek. Ha fél képpontra esnének, a rajzoló
 *     élsimítana, és a kockákból puha pép lenne — pont az veszne el, amitől
 *     mozaiknak látszik. Ezért a méretenkénti hangolásnál `cella` és az ebből
 *     adódó eltolás is egész (lásd `ellenoriz`).
 *
 * Elmaradt a korábbi mély szilvakék lekerekített lap a szív mögül. Nem stílus
 * kérdése volt: 16 képponton a lap elvette a szélső két-két képpontot, és a
 * maradékon a mozaikrács már nem fért el annyi kockával, hogy a szív alakja
 * kijöjjön. A kockák maguk adják a jel keretét, a lekerekítés pedig épp a
 * sarki kockákba vágott volna bele.
 *
 *   npm run icon
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'build');
const ASSETS = join(HERE, '..', 'ui', 'assets');

/* A meglévő rózsa színvilág, de a korábbinál nagyobb tónustartományban.
   Világos a bal felső, mély a jobb alsó sarokban: az ÁTLÓS átmenet azért kell,
   mert így minden kocka más árnyalatot kap, és a rács mindkét irányban látszik.
   Vízszintes átmenetnél csak sávok lennének, és a mozaik visszaesne „elmosott
   folt” hatásba. */
const ROZSA_VILAGOS = '#F0A0BE';
const ROZSA_KOZEP = '#C75B84';
const ROZSA_MELY = '#80284F';

/* A csillanás és a mély tónus színe. Nem díszítés: ezektől lesz elég eltérés a
   szomszédos kockák között ahhoz, hogy a kép átlagolt felvételnek látsszon. */
const CSILLANAS = '255, 238, 245';
const MELYARNY = '92, 24, 54';

/* Ennyiszeres felbontásban rajzoljuk meg a szívet cellánként, mielőtt
   átlagolunk. 12 már bőven a mérési zaj alatt van, és gyorsan lefut. */
const MINTAVETEL = 12;

// ---------------------------------------------------------------------------
// A szív alakja
// ---------------------------------------------------------------------------

/**
 * A szív négy köbös Bézier-szakasza egy névleges, origó középpontú rendszerben.
 * Ez a korábbi embléma görbéje változatlanul: telt lebenyek, nem tűhegyes csúcs.
 */
const SZAKASZOK: readonly (readonly [number, number])[][] = [
  [
    [0, 0.46],
    [-0.66, 0.04],
    [-0.52, -0.52],
    [-0.23, -0.52],
  ],
  [
    [-0.23, -0.52],
    [-0.07, -0.52],
    [0, -0.34],
    [0, -0.22],
  ],
  [
    [0, -0.22],
    [0, -0.34],
    [0.07, -0.52],
    [0.23, -0.52],
  ],
  [
    [0.23, -0.52],
    [0.52, -0.52],
    [0.66, 0.04],
    [0, 0.46],
  ],
];

function kobos(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/**
 * A görbe VALÓDI befoglaló téglalapja. A Bézier nem éri el a vezérlőpontjait,
 * ezért a névleges ±0.66 szélességből fejben nem lehet arányt számolni — sűrűn
 * mintavételezve viszont pontosan megkapjuk. Enélkül a mozaikrács és a szív
 * nem esne egybe, és a szélső cellasor üresen maradna.
 */
const HATAR = (() => {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const sz of SZAKASZOK) {
    const [p0, p1, p2, p3] = sz;
    if (!p0 || !p1 || !p2 || !p3) continue;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const x = kobos(p0[0], p1[0], p2[0], p3[0], t);
      const y = kobos(p0[1], p1[1], p2[1], p3[1], t);
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  return { xMin, xMax, yMin, yMax, w: xMax - xMin, h: yMax - yMin };
})();

/** A szívet pontosan a megadott téglalapba feszíti ki. */
function szivUt(ctx: SKRSContext2D, x: number, y: number, w: number, h: number): void {
  const sx = w / HATAR.w;
  const sy = h / HATAR.h;
  const px = (u: number) => x + (u - HATAR.xMin) * sx;
  const py = (v: number) => y + (v - HATAR.yMin) * sy;

  // Egyetlen, összefüggő útvonal: szakaszonkénti `moveTo` négy külön, nyitott
  // ívre bontaná a szívet, és a kitöltés összevissza zárná be őket.
  const kezdet = SZAKASZOK[0]?.[0];
  if (!kezdet) throw new Error('Üres szívgörbe.');
  ctx.beginPath();
  ctx.moveTo(px(kezdet[0]), py(kezdet[1]));
  for (const sz of SZAKASZOK) {
    const [, p1, p2, p3] = sz;
    if (!p1 || !p2 || !p3) continue;
    ctx.bezierCurveTo(px(p1[0]), py(p1[1]), px(p2[0]), py(p2[1]), px(p3[0]), py(p3[1]));
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// A mozaik
// ---------------------------------------------------------------------------

type Kocka = {
  /** Oszlop- és sorindex a rácson belül. */
  ox: number;
  oy: number;
  r: number;
  g: number;
  b: number;
  /** Fedettség 0..1 — ennyire takarja a szív ezt a cellát. */
  a: number;
};

/**
 * Kis, determinisztikus keverő. Azért nem `Math.random`, mert az embléma
 * beépülő fájl: két futásnak képpontra azonos eredményt kell adnia, különben
 * minden build fölöslegesen új ikont ír.
 */
function zajMag(ox: number, oy: number): number {
  let h = (ox * 374761393 + oy * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

/**
 * A szívet `rács × rács` cellára bontja úgy, hogy minden cella a mögötte lévő
 * terület ÁTLAGA legyen — ez a mozaikszűrő működése.
 *
 * A színátlag súlyozott: az áttetsző mintákat a fedettségükkel arányosan
 * vesszük figyelembe. Súlyozás nélkül a szélen a teljesen átlátszó képpontok
 * (amelyek nulla színűek) feketére húznák a kockákat, és az embléma pereme
 * bekoszolódna.
 */
function mozaik(racs: number, zajMertek: number): Kocka[] {
  const n = racs * MINTAVETEL;
  const vaszon = createCanvas(n, n);
  const ctx = vaszon.getContext('2d');
  ctx.clearRect(0, 0, n, n);

  const atmenet = ctx.createLinearGradient(0, 0, n, n);
  atmenet.addColorStop(0, ROZSA_VILAGOS);
  atmenet.addColorStop(0.45, ROZSA_KOZEP);
  atmenet.addColorStop(1, ROZSA_MELY);
  ctx.fillStyle = atmenet;
  szivUt(ctx, 0, 0, n, n);
  ctx.fill();

  /* Csillanás a bal felső lebenyen, mély tónus a csúcs felé — a szív alakjára
     vágva. Egy sima átmenetből az átlagolás után szinte egyforma kockák
     jönnének ki, és a rács retró pixelgrafikának látszana. A kitakarás attól
     ismerhető fel, hogy a kockák láthatóan KÜLÖNBÖZŐ átlagok: valami volt
     alattuk, csak már nem lehet kivenni, mi. */
  ctx.save();
  szivUt(ctx, 0, 0, n, n);
  ctx.clip();

  const feny = ctx.createRadialGradient(n * 0.3, n * 0.26, 0, n * 0.3, n * 0.26, n * 0.42);
  feny.addColorStop(0, `rgba(${CSILLANAS}, 0.34)`);
  feny.addColorStop(1, `rgba(${CSILLANAS}, 0)`);
  ctx.fillStyle = feny;
  ctx.fillRect(0, 0, n, n);

  const arny = ctx.createRadialGradient(n * 0.74, n * 0.88, 0, n * 0.74, n * 0.88, n * 0.58);
  arny.addColorStop(0, `rgba(${MELYARNY}, 0.5)`);
  arny.addColorStop(1, `rgba(${MELYARNY}, 0)`);
  ctx.fillStyle = arny;
  ctx.fillRect(0, 0, n, n);
  ctx.restore();

  const kep = ctx.getImageData(0, 0, n, n).data;
  const kockak: Kocka[] = [];

  for (let oy = 0; oy < racs; oy++) {
    for (let ox = 0; ox < racs; ox++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let y = 0; y < MINTAVETEL; y++) {
        const sor = (oy * MINTAVETEL + y) * n;
        for (let x = 0; x < MINTAVETEL; x++) {
          const i = (sor + ox * MINTAVETEL + x) * 4;
          const a = (kep[i + 3] ?? 0) / 255;
          sr += (kep[i] ?? 0) * a;
          sg += (kep[i + 1] ?? 0) * a;
          sb += (kep[i + 2] ?? 0) * a;
          sa += a;
        }
      }
      if (sa <= 0) continue;

      const minta = MINTAVETEL * MINTAVETEL;
      // A valódi felvételen a szomszédos kockák sosem pont egyformák; egy hajszálnyi
      // eltérés kell, hogy a belső rács is látsszon, ne egyetlen sima folt legyen.
      const zaj = 1 + zajMag(ox, oy) * zajMertek;
      kockak.push({
        ox,
        oy,
        r: Math.min(255, (sr / sa) * zaj),
        g: Math.min(255, (sg / sa) * zaj),
        b: Math.min(255, (sb / sa) * zaj),
        a: sa / minta,
      });
    }
  }
  return kockak;
}

// ---------------------------------------------------------------------------
// Méretenkénti hangolás
// ---------------------------------------------------------------------------

type Hangolas = {
  /** Egy mozaikkocka oldala képpontban. Egész, különben elmosódnak az élek. */
  cella: number;
  /** Hány kocka fedi a szív befoglaló négyzetét. */
  racs: number;
  /**
   * Ennyi fedettségtől már teljesen átlátszatlan a kocka. Igazi kitakarásnál
   * MINDEN kocka átlátszatlan; az áttetszőség itt csak azt jelöli, mennyire
   * lóg rá a szív a cellára. Kis méretben ezt korán telítjük, mert a fehér
   * fejlécsávon a halvány szélső kockák egyszerűen eltűnnének, és velük a
   * sziluett. Nagy méretben marad egy vékony lágy perem — az a hiteles.
   */
  telitett: number;
  /** Ennél kevésbé fedett kockát eldobunk: kis méretben a szemcse csak kosz. */
  kuszob: number;
  /** A kockánkénti árnyalatszórás mértéke. */
  zaj: number;
};

/**
 * Méretenként külön hangolt változat, nem egyetlen kép kicsinyítése.
 *
 * A rácssűrűség a fő döntés. 48 képpontig hét kocka: ennél sűrűbb rácsban a
 * szív felismerhetetlen péppé esik szét, mert egy kockára már csak egy-két
 * képpont jut. 64 képponttól viszont a hét kocka már nem mozaiknak, hanem
 * retró pixelgrafikának látszana, ezért ott fokozatosan sűrítünk 14-ig.
 *
 * A szív mindenütt a keret nagyjából 87%-át tölti ki. Ez az egyezés szándékos:
 * ha méretenként más arányban állna, a jel a tálcán és az Alt-Tabban láthatóan
 * hol nagyobb, hol kisebb lenne ugyanazon a képernyőn.
 *
 * A küszöb és a telítés együtt szabja meg, milyen kemény a perem: kis méretben
 * szűk a sáv (szinte kétállású, hogy a sziluett megmaradjon), nagy méretben
 * széles (marad egy lágy, hiteles mozaikperem).
 */
const HANGOLAS: Record<number, Hangolas> = {
  16: { cella: 2, racs: 7, kuszob: 0.34, telitett: 0.5, zaj: 0.0 },
  24: { cella: 3, racs: 7, kuszob: 0.3, telitett: 0.52, zaj: 0.035 },
  32: { cella: 4, racs: 7, kuszob: 0.28, telitett: 0.55, zaj: 0.035 },
  48: { cella: 6, racs: 7, kuszob: 0.26, telitett: 0.58, zaj: 0.04 },
  64: { cella: 6, racs: 9, kuszob: 0.2, telitett: 0.64, zaj: 0.045 },
  128: { cella: 10, racs: 11, kuszob: 0.15, telitett: 0.72, zaj: 0.05 },
  256: { cella: 16, racs: 14, kuszob: 0.12, telitett: 0.78, zaj: 0.055 },
};

/**
 * A rács bal felső sarka. Csak két dolog számít: a cella egész legyen, és az
 * eltolás is — így minden cellahatár egész képpontra esik, és nincs élsimítás.
 *
 * A tökéletes középre igazítást NEM követeljük meg. Átlátszó hátterű ikonnál a
 * szív körüli üres sáv láthatatlan, tehát egy fél képpontos eltérés a két oldal
 * margója között senkinek nem tűnik fel — a rács élessége viszont igen. Amikor
 * korábban páros osztást írtunk elő, emiatt esett vissza a 24 és a 48 képpontos
 * változat a keretének háromnegyedére, és a tálcán ezek észrevehetően kisebbnek
 * látszottak a többinél.
 */
function ellenoriz(meret: number, h: Hangolas): number {
  const doboz = h.cella * h.racs;
  if (!Number.isInteger(h.cella) || doboz > meret) {
    throw new Error(
      `A ${meret} képpontos ikon rácsa nem fér el vagy nem egész ` +
        `(cella ${h.cella} × rács ${h.racs} = ${doboz}).`,
    );
  }
  return Math.round((meret - doboz) / 2);
}

// ---------------------------------------------------------------------------
// Rajzolás
// ---------------------------------------------------------------------------

/** Küszöb alatt eldob, telítés fölött teljesen fed, közte egyenletesen átmegy. */
function fedettseg(a: number, h: Hangolas): number {
  if (a <= h.kuszob) return 0;
  if (a >= h.telitett) return 1;
  return (a - h.kuszob) / (h.telitett - h.kuszob);
}

function ikont(meret: number): Buffer {
  const h = HANGOLAS[meret];
  if (!h) throw new Error(`Nincs hangolás a(z) ${meret} képpontos mérethez.`);
  const eltolas = ellenoriz(meret, h);

  const vaszon = createCanvas(meret, meret);
  const ctx = vaszon.getContext('2d');
  ctx.clearRect(0, 0, meret, meret);

  for (const k of mozaik(h.racs, h.zaj)) {
    const a = fedettseg(k.a, h);
    if (a <= 0) continue;
    ctx.fillStyle = `rgba(${Math.round(k.r)}, ${Math.round(k.g)}, ${Math.round(k.b)}, ${a.toFixed(3)})`;
    ctx.fillRect(eltolas + k.ox * h.cella, eltolas + k.oy * h.cella, h.cella, h.cella);
  }

  return vaszon.toBuffer('image/png');
}

// ---------------------------------------------------------------------------
// SVG a felületre
// ---------------------------------------------------------------------------

/**
 * Ugyanabból a cellaszámításból SVG. Azért ugyanabból, hogy a fejlécben lévő
 * embléma és a tálcaikon ne csússzon szét, ha valaki később hangol az arányokon.
 *
 * `shape-rendering="crispEdges"`: enélkül a böngésző élsimítaná a szomszédos
 * négyzetek közös élét, és hajszálvékony világos vonalak jelennének meg a rácsban.
 */
function svg(racs: number, telitett: number, kuszob: number, zaj: number): string {
  const h: Hangolas = { cella: 1, racs, telitett, kuszob, zaj };
  const sorok: string[] = [];
  for (const k of mozaik(racs, zaj)) {
    const a = fedettseg(k.a, h);
    if (a <= 0) continue;
    const szin = `#${[k.r, k.g, k.b]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')}`;
    const atlatszo = a >= 0.999 ? '' : ` fill-opacity="${a.toFixed(3)}"`;
    sorok.push(`    <rect x="${k.ox}" y="${k.oy}" width="1" height="1" fill="${szin}"${atlatszo}/>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${racs} ${racs}" role="img" aria-label="Szivecske">`,
    '  <title>Szivecske</title>',
    '  <g shape-rendering="crispEdges">',
    ...sorok,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// ICO
// ---------------------------------------------------------------------------

/** ICO-tároló: PNG-ket ágyaz be, ahogy a Vista óta megengedett. */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // foglalt
  header.writeUInt16LE(1, 2); // 1 = ikon
  header.writeUInt16LE(count, 4);

  const entries: Buffer[] = [];
  let offset = 6 + count * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // szélesség (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // magasság
    e.writeUInt8(0, 2); // színpaletta
    e.writeUInt8(0, 3); // foglalt
    e.writeUInt16LE(1, 4); // színsíkok
    e.writeUInt16LE(32, 6); // bit/képpont
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ---------------------------------------------------------------------------

function main(): void {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ASSETS, { recursive: true });

  const meretek = [16, 24, 32, 48, 64, 128, 256];
  const images = meretek.map((size) => ({ size, png: ikont(size) }));

  for (const { size, png } of images) {
    writeFileSync(join(OUT, `icon-${size}.png`), png);
  }
  const nagy = images[images.length - 1];
  const fejlec = images.find((i) => i.size === 64);
  if (!nagy || !fejlec) throw new Error('Hiányzó méret az ikonkészletből.');

  writeFileSync(join(OUT, 'icon.png'), nagy.png);
  writeFileSync(join(OUT, 'icon.ico'), buildIco(images));

  // Raszteres tartalék a felületnek. Azért írjuk felül itt is, hogy soha ne
  // maradjon a régi, sima szív a fejlécben, ha valaki még ezt a fájlt hivatkozza.
  writeFileSync(join(ASSETS, 'icon.png'), fejlec.png);

  /* A felületi, léptékfüggetlen változat.
     Tizenegy kocka: a fejléc 22 képpontos helyén még kivehető a rács, a
     „A programról” ablak 88 képpontján pedig már félreérthetetlenül kitakarás.

     FIGYELEM a CSS-méretre: az SVG-t csak 11 TÖBBSZÖRÖSÉBEN szabad megjeleníteni
     (22, 33, 44, 88 …). Közte a cellahatár tört képpontra esik, a böngésző
     elsimítja, és a szabályos rács szabálytalan, pöttyös zajjá esik szét —
     20 képponton (1,82 képpont/kocka) ez kimérten csúnya. Lásd `ui/src/styles.css`. */
  writeFileSync(join(ASSETS, 'szivecske-mozaik.svg'), svg(11, 0.72, 0.12, 0.05));

  console.log(`Embléma kész: ${OUT}`);
  console.log(`  icon.ico (${meretek.join(', ')} képpont)`);
  for (const m of meretek) {
    const h = HANGOLAS[m];
    if (h) console.log(`    ${m}: ${h.racs}×${h.racs} kocka, ${h.cella} képpont/kocka`);
  }
  console.log(`  icon.png (256 képpont)`);
  console.log(`  ${join(ASSETS, 'szivecske-mozaik.svg')} (11×11 kocka)`);
}

main();
