# ♥ Szivecske Anonimizáló

Magyar jogi iratok álnevesítése a saját gépen. Windows-os asztali program, PDF és
Word iratokhoz. **Semmi nem megy fel az internetre** — nincs felhő, nincs API-hívás,
a felületnek nincs hálózati hozzáférése.

[![Ellenőrzés](https://github.com/richardfoltin/szivecske-anonimizalo/actions/workflows/ellenorzes.yml/badge.svg)](https://github.com/richardfoltin/szivecske-anonimizalo/actions/workflows/ellenorzes.yml)

## Letöltés

A kész Windows-telepítő a **[Releases](https://github.com/richardfoltin/szivecske-anonimizalo/releases)**
oldalon. Töltsd le az `.exe` fájlt, és futtasd.

Két dolgot érdemes tudni róla:

- **A nyelvi modell nincs benne.** 809 MB, külön licenc alatt áll, és a program az
  első indítás után egy gombbal letölti a Hugging Face-ről. Addig is működik, csak
  kevesebb nevet talál meg: azokat, amiket az irat rovatai kifejezetten megneveznek
  („Felperes:", „anyja neve:", cégforma).
- **Nincs kódaláírás.** A Windows SmartScreen az első indításnál figyelmeztet; a
  „További információ → Futtatás mindenképp" úton indítható.

## Indítás forrásból

```bash
npm install
npm start
```

Ez lefordítja a felületet és elindítja az alkalmazást. Fejlesztéshez `npm run dev`
(élő újratöltéssel), telepítő készítéséhez **`npm run dist`**.

> A telepítőt mindig a `npm run dist` gyártsa, ne a puszta `npx electron-builder`:
> az utóbbi a lemezen talált korábbi fordítást csomagolja be, tehát elavult kódot
> szállíthat. A `dist` előbb lefuttatja mind a négy fordítási lépést.

## Telepítés más gépére — olvasd el, mielőtt átadod

A program **nincs digitálisan aláírva**, mert ahhoz megvásárolt tanúsítvány kell. Ezért a
Windows az első indításkor egy kék ablakkal megállítja, és a „Futtatás mindenképp" gomb
alapból **rejtve van** — a felhasználók többsége itt adja fel, abban a hitben, hogy a gép
vírust jelzett.

**[docs/telepites.md](docs/telepites.md)** leírja, mit lát a felhasználó és pontosan mit
kell nyomnia, a fejlesztőnek pedig a három járható utat az aláíráshoz — árakkal, a
2026-os feltételekkel és a pontos `package.json` kulcsokkal.

Két dolgot érdemes előre tudni belőle:

- **Az aláírás önmagában nem tünteti el az első figyelmeztetést** — csak a nevet írja
  ki „Ismeretlen közzétevő" helyett, és hagyja, hogy a hírnév kiadásról kiadásra gyűljön.
- **Az EV tanúsítvány már nem ad azonnali SmartScreen-hírnevet.** Ez régen igaz volt;
  ma nem az, és pusztán ezért EV-t venni kidobott pénz.

## A nyelvi modell

A felismerés motorja egy helyben futó nyelvi modell. Megnyitáskor végigolvassa
az iratot, és megtalálja a személyneveket, szervezeteket, lakcímeket — ott is,
ahol semmilyen szerkezeti jel nem utal rájuk.

A modellt méréssel választottuk ki, nem népszerűség alapján. A meglepő eredmény:
**a nyertes nem nagy nyelvi modell.** Magyar névfelismerésben egy 110 milliós,
magyar szövegen tanult kódoló 10–13 ponttal veri az összes generatív modellt, és
nagyságrendekkel gyorsabb náluk. A mérés részletei: [docs/felmeres.html](docs/felmeres.html).

| | |
|---|---|
| Modell | `foltin/nerkor-hubert-hungarian-onnx` (huBERT) |
| Licenc | **Apache-2.0** — kereskedelmi termékben is használható |
| Méret | 440 MB ONNX, **a telepítővel érkezik** (a tároló csak PyTorch-súlyt közöl) |
| Betöltés | 0,6 s |
| Futtatás | 7161 karakteres ítélet → 92 entitás, **565 ms** |
| Pozíciópontosság | 0 elcsúszás — a pozíció a tokenizálás közvetlen eredménye, nem becslés |
| Szeged NER | 90,2 pont (a legjobb 16 GB-ba férő generatív modell: 79,1) |

Angol nyelvű irathoz a Beállításokban átváltható a többnyelvű
`bardsai/eu-pii-anonimization-multilang` modellre, ami a Hugging Face-ről
letölthető. A csere és a ragozás egyelőre magyar iratra van hangolva.

### Miért nem tömörítjük 8 bitre

A modell 8 bites változata negyedakkora (106 MB) és 1,7-szer gyorsabb — mégsem
azt szállítjuk. A mérés (`npm run test:quant`) szerint elveszít egy csupa
nagybetűs aláírásban álló személynevet. Egy kitakaró programban a kimaradt név
kiszivárgott személyazonosság, és azt nem lehet lemezhellyel megváltani.

Külön folyamatban fut, és a munka végén kilép — a szülő folyamat memóriája
58 MB marad, a modell ~650 MB-ja nem terheli a programot két irat között.

Három dolgot magunknak kellett megoldani, mert a könyvtár nem adja:

1. **Karakterpozíciók.** A Transformers.js token-osztályozása nem ad vissza
   offszetet (a forrásában nyitott TODO). Egy kitakaró programnak viszont
   pontosan az kell, ezért a tokeneket magunk illesztjük vissza a szövegre.
2. **Szókezdet-jelölő.** A `decode()` eldobja, ezért a nevek csonkultak
   („Balo", „Bach Tivad"); a `tokenize()` megtartja.
3. **Darabhatár-törmelék.** A hosszú iratot átfedő darabokban dolgozzuk fel; az
   olyan találatot, ami szó közepén kezdődik vagy végződik, eldobjuk.

### Amit a modell nem tud, és ezért a szerkezet adja

- **Ki milyen szerepben áll** az eljárásban (felperes / tanú / kezes) — ez kell
  a hivatalos OBH-módhoz.
- **Kinek a nevét kell bent hagyni**: az eljáró ügyvéd, a bíró és a bíróság
  neve a Bszi. 166. § (2) szerint nem anonimizálható. A modell ugyanúgy névnek
  látja őket, mint a felperest.

A modell egy ismert hibamódja: ha egy mondaton belül szerepel a valódi „Nagy
Béla" és a köznévi „nagy", az utóbbit is névnek jelölheti — magas
magabiztossággal, ezért küszöbbel nem szűrhető. A program ezt a köznévi
homonimák listájából ismeri fel, és átnézésre teszi, nem cseréli le.

## Mit csinál

1. **Megnyitod az iratot** — PDF vagy Word.
2. **Megadod a feleket** úgy, ahogy a papíron állnak: `Kovács János`,
   `Kovács Jánosné`, `özv. Baloghné Fehér Ilona`, `Aranykalász Agrár Kft.`
3. A program **megkeresi minden alakjukat**: ragozva (`Kováccsal`, `Kovácsot`,
   `Kovácsnak`), családként (`Kovácsék`), asszonynévként, monogrammal (`K. J.`),
   megszólítással (`Kovács úrnak`), csupa nagybetűvel az aláírásblokkban, sőt
   e-mail címbe rejtve is (`kovacs.janos58@freemail.hu`).
4. **Választasz névkészletet** — négy szállított téma, mindegyik magyarul
   ragozható és láthatóan kitalált.
5. **Választasz csere-módot**: fedőnevek, hivatalos (OBH) eljárási szerep,
   adatfajta neve, vagy számozott címke.
6. **Átnézed a szereplapon**, mit talált. Ami bizonytalan, arról te döntesz.
7. **Mentés** — új fájl készül, az eredeti érintetlen marad. Utána a program
   **visszaolvassa a kész fájlt** egy másik könyvtárral, és megmondja, maradt-e
   benne bármi.

## Négy csere-mód

| Mód | Példa | Mikor |
|---|---|---|
| Fedőnevek | `Kovács Jánosnak` → `Kőszikla Frédnek` | belső használat, megosztás, MI-nek adott szöveg |
| Hivatalos (OBH) | `Kovács Jánosnak` → `a felperesnek` | bíróságra menő vagy közzétételre szánt irat |
| Adatfajta neve | `Kovács Jánosnak` → `[név]-nek` | védett adatok, OBH 4/2021. utasítás |
| Számozott címke | `Kovács Jánosnak` → `[NÉV-1]-nek` | gépi feldolgozás |

## Amit a program nem tesz meg helyetted

- **Nem találgat.** A feleket te adod meg. Amit ezen kívül talál, az külön
  listára kerül átnézésre — nem cserélődik magától.
- **Nem állítja, hogy mindent megtalált.** A garancia az, hogy *amit megadtál,
  azt hiánytalanul lecseréltük* — ez mérhető és tesztelt.
- **Nem mondja azt, hogy „anonimizált".** Amíg a visszafejtő kulcs létezik, a
  kimenet a GDPR szerint továbbra is személyes adat. A program végig
  álnevesítésről beszél, és külön gomb kell a kulcs megsemmisítéséhez.

## Mérések

```bash
npm run test:all     # a teljes készlet — ez fut a kiadás előtt
```

| készlet | mit mér | eredmény |
|---|---|---|
| `test:inflect` | magyar toldalékolás arany-készlete | 330/330 |
| `test:detect` | felek automatikus felismerése három iraton | 195/195 |
| `test:azonosito` | magyar azonosítók, ellenőrzőszámmal | 201/201 |
| `test:verify` | a kimenet visszaellenőrzése | 43/43 |
| `test:osszeg-datum` | összegek és dátumok átírása | 353/353 |
| `test:pdf` | Form XObject bejárás, ToUnicode-hiány | 35/35 |
| `test:docx` | formátumhű átírás, rejtett hordozók | 87/87 |
| `test:app` | végponttól végpontig, PDF és DOCX | 5/5 + 5/5 |
| `test:kapu` | **szivárgásnál nem keletkezik fájl** | 2/2 |
| `test:formatum` | nem támogatott formátum hangos elutasítása | 28/28 |
| `test:anyja` | az „anyja neve" rovat változatai | 5/5 |

Külön, csak letöltött modellel futtatható mérések: `npm run test:quant`
(a 8 bites tömörítés vesztesége), `spike1`, `spike2`.

A `test:kapu` a legfontosabb: azt bizonyítja, hogy ha az ellenőrző kör eredeti
nevet talál a kész fájlban, akkor **fájl egyáltalán nem keletkezik**. Enélkül a
felhasználó egy érintetlen iratot kapna a kezébe abban a hitben, hogy kitakart.

Részletek: [SPIKE.md](SPIKE.md). A döntés mögötti felmérés: [docs/felmeres.html](docs/felmeres.html).

## Felépítés

```
src/hu/          magyar nyelvi motor — hangtan, toldalékolás, névalakok, keresés
src/pdf/         PDF tartalomfolyam: tokenizáló, ToUnicode, betűtörlés, újraszedés
src/app/         munkamenet, kulcsfájl, közös típusok
src/pseudonym.ts álnév-hozzárendelés és csere (4 mód)
src/verify.ts    ellenőrző kör a KIMENETEN, másik könyvtárral
electron/        főfolyamat és híd
ui/              felület (React)
data/            témacsomagok, homonima-szótár, kiejtésfüggő névkivételek
```

## Word (.docx)

Formátumhű: a program végigmegy a csomag minden részén — törzsszöveg, élőfej,
élőláb, lábjegyzet, végjegyzet, megjegyzések, szövegtár, diagramfeliratok, ábrák,
egyéni XML, dokumentum-tulajdonságok, sőt a hivatkozások `mailto:` céljai is.
A szövegdobozok mindkét ágát (`mc:Choice` és `mc:Fallback`) átírja, különben a
név láthatatlanul bennmaradna. Mentéskor kitakarítja a szerzőt, a
„utoljára mentette" mezőt, a megjegyzéseket és az összes `rsid` attribútumot.

**Változáskövetés blokkoló.** A `<w:del>` elemek szó szerint őrzik a törölt
szöveget. Amíg van feloldatlan módosítás, a program nem ment — előbb el kell
fogadni vagy elutasítani őket, és ezt a döntést nem hozza meg helyetted, mert a
két út különböző dokumentumot ad.

Nem néz bele: **beágyazott objektumokba** (egy DOCX-be illesztett Excel-tábla),
a **stílus- és számozásdefiníciókba**, és a **képek EXIF-adataiba**. Ezeket
néven nevezve jelzi a szereplapon.

## Jelenlegi korlátok

- **Szkennelt PDF: nincs OCR.** A program felismeri és jelzi, ha az iratban
  nincs kiolvasható szöveg.
- **A sorkizárás elveszik** az újraszedett sorokban. Ez a biztonságos megoldás
  ára; szebbé tehető a szóközök arányos elosztásával.
- **Az összegeket és a dátumokat nem írja át.** Az összegek átírása szétveri a
  végösszegeket; a dátumeltolás külön funkció lesz, kapcsolóval.
