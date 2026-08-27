# Licencek — mi honnan jön, és milyen feltétellel

Ez a leltár a **tényleges** függőségekből készült, nem emlékezetből: a
`package.json` futásidejű fája (`npm ls --omit=dev --all`, 95 csomag), a csomagok
`package.json`-jában álló `license` mező, és a lefordított telepítő
(`dist/telepito/win-unpacked/resources/app.asar`) tartalomjegyzéke alapján.

A leltár azért fontosabb, mint amilyennek látszik: a program egy része **továbbadásra
kerül** a telepítőben, és ott már nem elég tudni, hogy valami nyílt forráskódú —
feltüntetési és mellékelési kötelezettségek is járnak vele.

---

## 1. A projekt saját kódja

| | |
|---|---|
| Szerző | Foltin Csaba |
| Licenc | `UNLICENSED` — minden jog fenntartva, lásd a gyökérben álló `LICENSE` fájlt |
| Tár | privát |

Privát tárolónál ez rendben van. Egyetlen dolgot érdemes tudni: az `UNLICENSED`
a saját kódra vonatkozik, és **nem** írja felül az alábbi harmadik felek
feltételeit. A kettő párhuzamosan él.

---

## 2. A nyelvi modell — ezt továbbadjuk, és ezért külön figyelmet kér

Ez a leltár legfontosabb tétele, mert ez az egyetlen harmadik féltől származó
rész, amit **mi magunk módosítottunk**, és amit **mi magunk csomagolunk** a
telepítőbe.

| | |
|---|---|
| Modell | `foltin/nerkor-hubert-hungarian-onnx` (huBERT alapú NER) |
| Forrás | https://huggingface.co/foltin/nerkor-hubert-hungarian-onnx |
| Licenc | **Apache License 2.0** |
| Jogtulajdonos | Nyelvtudományi Kutatóközpont (NYTK) |
| Szállítjuk? | **Igen**, a telepítő `resources/modellek/` alá teszi (440 MB `model.onnx`) |
| Származási jegyzék | `.modellek/NYTK/.../PROVENANCE.md` + `SHA256SUMS.json` |

### Amit mi változtattunk rajta

A Hugging Face-tárolóban **nincs ONNX fájl** — a közölt súlyok PyTorch formátumúak.
Az általunk szállított `model.onnx`-et mi állítottuk elő a `scripts/export-nytk.py`
futtatásával (torch 2.5.1, opset 17, `do_constant_folding`). A `scripts/quantize-nytk.py`
készített egy 8 bites változatot is (`model.int8.onnx`), de azt **nem szállítjuk** —
a mérés szerint elveszít egy csupa nagybetűs aláírásban álló személynevet.

Ez a formátumváltás az Apache-2.0 értelmében **módosított mű** (Derivative Work),
és emiatt a 4. szakasz feltételei élesek, nem elméletiek.

### Mit kér cserébe az Apache-2.0, ha továbbadjuk

- **4/a — a licenc szövegének mellékelése.** A címzettnek kapnia kell egy másolatot
  magából az Apache License 2.0 szövegéből.
- **4/b — a módosítás feltüntetése.** Jól látható jelzés kell arról, hogy a fájlokat
  megváltoztattuk.
- **4/c és 4/d — a szerzői jogi és NOTICE-bejegyzések megtartása,** ha a forrásmű
  tartalmaz ilyet.

### Hol állunk ezzel most

| Feltétel | Állapot |
|---|---|
| Módosítás feltüntetése (4/b) | **Teljesül.** A `PROVENANCE.md` kimondja, hogy „A tárolóban nincs ONNX; ezt a fájlt mi állítottuk elő”, és a fájl a telepítőbe is bekerül (`extraResources` felsorolja). |
| Forrás és jogtulajdonos megnevezése | **Teljesül.** `PROVENANCE.md`, továbbá a Beállítások képernyő ki is írja a modell licencét (`ui/src/settings.tsx`, az adat a `src/app/models.ts`-ből jön). |
| A licenc szövegének mellékelése (4/a) | **HIÁNYZIK.** A `PROVENANCE.md` megnevezi az Apache-2.0-t, de a szövegét nem tartalmazza, és a `package.json` `extraResources` szűrője sem szállít ilyen fájlt. |

**Teendő a következő kiadás előtt.** Tegyünk egy `LICENSE-Apache-2.0.txt` fájlt a
`.modellek/foltin/nerkor-hubert-hungarian-onnx/` mellé az Apache
License 2.0 teljes szövegével, és vegyük fel a `package.json`
`build.extraResources[].filter` listájába a többi hat fájl mellé. Ez néhány kB, és
ezzel a 4/a is rendben van.

> A `package.json` érintett része a `build.extraResources` tömb harmadik eleme
> (`"from": ".modellek"`), ahol jelenleg hat fájlnév szerepel a `filter`-ben.
> Ez nem az én fájlköröm, ezért nem nyúltam hozzá.

### A másik, választható modell

| | |
|---|---|
| Modell | `bardsai/eu-pii-anonimization-multilang` |
| Licenc | `Apache-2.0` a `src/app/models.ts` katalógusa szerint |
| Szállítjuk? | **Nem.** A felhasználó tölti le a Hugging Face-ről, ha angol iratot dolgoz fel. |

Mivel ezt nem adjuk tovább, a 4. szakasz mellékelési kötelezettsége ránk nem
vonatkozik. Két dolgot viszont érdemes tudni: a helyi `.modellek/bardsai/` mappában
**nincs `PROVENANCE.md`**, ellentétben az NYTK modellel, és a licencállítást a
kódban álló katalógusbejegyzésen kívül semmi nem támasztja alá. Ha valaha a
telepítőbe kerülne, előbb ellenőrizni kell a forrásnál.

---

## 3. Az npm-csomagok, amelyek a telepítőbe kerülnek

Az `electron-builder` a futásidejű (`dependencies`) fát automatikusan becsomagolja
az `app.asar`-ba — függetlenül attól, hogy a `package.json` `build.files` listája
mit sorol fel tételesen. Az alábbi bontás a ténylegesen elkészült `app.asar`
tartalomjegyzékéből származik: **95 csomag**.

| Licenc | Csomagok száma | Nevezetesebb tagok |
|---|---|---|
| MIT | 35 | `pdf-lib`, `@pdf-lib/fontkit`, `onnxruntime-node`, `onnxruntime-common`, `react`, `react-dom`, `adm-zip`, `pdf-to-img`, `@napi-rs/canvas` |
| BSD-3-Clause | 13 | `protobufjs` és `@protobufjs/*`, `global-agent`, `roarr`, `sprintf-js` |
| Apache-2.0 | 7 | `@huggingface/transformers`, `@huggingface/tokenizers`, `pdfjs-dist`, `sharp`, `flatbuffers`, `long`, `detect-libc` |
| ISC | 3 | `semver`, `guid-typescript`, `json-stringify-safe` |
| 0BSD | 1 | `tslib` |
| MIT AND Zlib | 1 | `pako` |
| MIT OR CC0-1.0 | 1 | `type-fest` |
| **Apache-2.0 AND LGPL-3.0-or-later** | 1 | **`@img/sharp-win32-x64`** — lásd alább |
| nincs `license` mező | 33 | kizárólag `@img/sharp-*` és `@napi-rs/canvas-*` platformcsomagok, amelyekből Windowsra csak egy telepszik |

Mind megengedő licenc, és mind összefér egy zárt forráskódú termékkel — **egy
kivétellel**.

### A kivétel: LGPL-3.0 a telepítőben

**`@img/sharp-win32-x64` licence `Apache-2.0 AND LGPL-3.0-or-later`** (a natív
libvips miatt), és **benne van a szállított `app.asar`-ban** — ellenőrizve, a
`node_modules/@img/` alatt `colour` és `sharp-win32-x64` szerepel.

Hogy került oda? Nem közvetlenül vettük fel, hanem így:

```
@huggingface/transformers → sharp → @img/sharp-win32-x64
```

Miért érdemes ezzel foglalkozni: az LGPL-3.0 továbbadás esetén többletfeltételeket
szab — feltüntetés, a könyvtár forrásának elérhetővé tétele, és annak biztosítása,
hogy a felhasználó a könyvtárat kicserélhesse. Ez egy zárt forráskódú, aláíratlan
asztali telepítőnél nem magától értetődően teljesül.

**A jó hír, hogy valószínűleg nincs is rá szükségünk.** A `sharp` a Transformers.js
képfeldolgozó folyamataihoz kell; a mi munkaszálunk (`src/ai/worker.ts`) kizárólag
szöveges token-osztályozást futtat, és sehol nem hivatkozik `sharp`-ra vagy
`RawImage`-re.

**Javaslat.** Zárjuk ki a `sharp`-ot a csomagolásból egy kizáró mintával a
`package.json` `build.files` listájában:

```
"!node_modules/sharp/**",
"!node_modules/@img/**"
```

Ez két dolgot old meg egyszerre: kikerül az LGPL-3.0 a szállított termékből, és
**~20 MB-tal kisebb lesz a telepítő** (`@img/sharp-win32-x64` önmagában 19 MB).
Utána viszont **le kell futtatni a `npm run test:all`-t és el kell indítani a
telepített programot**, hogy kiderüljön, a Transformers.js nem próbálja-e mégis
betölteni indításkor. Ez sem az én fájlköröm, ezért nem módosítottam.

### Az Electron futtatókörnyezet

| | |
|---|---|
| Electron | 41.7.1, **MIT** |
| Chromium, Node.js, V8 és a beágyazott könyvtárak | BSD-3-Clause és számos további licenc |

Ezzel nincs teendő: az `electron-builder` a kötelező szövegeket magától a telepítő
mellé teszi, ellenőrizve a `dist/telepito/win-unpacked/` alatt:

- `LICENSE.electron.txt`
- `LICENSES.chromium.html`

Ezeket **nem szabad kitörölni** a csomagolás utáni takarításkor.

---

## 4. Csak fejlesztéskor használt csomagok

Ezek egyike sem kerül a telepítőbe, tehát továbbadási kötelezettséget nem
keletkeztetnek. A teljesség kedvéért:

| Csomag | Verzió | Licenc |
|---|---|---|
| `electron` | 41.7.1 | MIT |
| `electron-builder` | 26.15.3 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `vite` | 8.2.2 | MIT |
| `@vitejs/plugin-react` | 6.1.0 | MIT |
| `esbuild` | 0.28.2 | MIT |
| `tsx` | 4.23.12 | MIT |
| `@napi-rs/canvas` | 1.0.8 | MIT |
| `concurrently` | 9.2.4 | MIT |
| `cross-env` | 10.1.0 | MIT |
| `wait-on` | 9.1.0 | MIT |
| `@types/node`, `@types/react`, `@types/react-dom` | — | MIT |

---

## 5. Adatfájlok és névkészletek

| Mi | Honnan | Feltétel |
|---|---|---|
| `data/themes/*.json` | saját képzésű álnévkészletek | saját mű |
| `data/homonyms.json` | saját összeállítás | saját mű |
| `data/name-overrides.json` | saját összeállítás, hivatkozási alap: AkH. 12. kiadás 216. b) és 217. pont | saját mű; a szabályzat *pontszámaira* hivatkozunk, a szövegét nem másoljuk |
| `build/icon*.png`, `icon.ico` | saját, a `scripts/make-icon.ts` állítja elő | saját mű |
| A fejléc ikonjai (`IKON_UTVONALAK`, `ui/src/App.tsx`) | **Tabler Icons 3.46.0**, `icons/outline` | **MIT** — a szerzői jogi közlést és a licencszöveget a program mellett elérhetővé kell tenni |

### A Tabler Icons — hét útvonal, nem egy csomag

A fejléc hét ikonja (`folder-open`, `device-floppy`, `adjustments`, `sparkles`,
`settings`, `eye-check`, `alert-triangle`) a **Tabler Icons** készletből való.
A projektben **nincs** `@tabler/icons` függőség, és nem is lesz: a program
offline fut, egy ikoncsomag pedig futásidejű függőséget és fölös kötegméretet
jelentene. Helyette az érintett hét ikon SVG-útvonaladata **be van másolva**
az `ui/src/App.tsx` `IKON_UTVONALAK` táblájába, a hivatalos kiadásból
(`https://unpkg.com/@tabler/icons@3.46.0/icons/outline/…`), változtatás nélkül.

A licenc **MIT**, ami a másolást és a továbbadást engedi, cserébe egyetlen
feltételt szab: a szerzői jogi közlésnek és a licencszövegnek a terjesztett
programmal együtt elérhetőnek kell lennie. Ez a bekezdés — és a fenti táblázat
sora — ezt teljesíti; a licenc teljes szövege a
`https://github.com/tabler/tabler-icons/blob/main/LICENSE` címen áll.

    Copyright (c) 2020-2026 Paweł Kuna
    Tabler Icons — MIT License

Ha egy ikon útvonaladata változik vagy új ikon kerül be, azt UGYANONNAN kell
hozni, nem emlékezetből: egy „körülbelül olyan” rajz nem Tabler-ikon, csak
hasonlít rá — és a licencsor akkor is állítaná, hogy az.

---

Az `asvanyok.json` és a `kokorszak.json` fájl saját `license_note` mezőt is hordoz,
amely rögzíti, hogy a nevek nem védjegyezett franchise-ból származnak, és hogy a
valós magyar vezetéknévvé vált alakokat szándékosan kihagytuk — épp azért, hogy egy
álnév ne ütközzön létező személlyel vagy céggel.

---

## 6. Mintairatok — ellenőrizve, hogy tényleg szintetikusak

A `samples/` és a `spike/out/keresetlevel.*` iratok valósághű magyar jogi iratok
teljes személyi adatsorral: névvel, lakcímmel, adóazonosítóval, TAJ-számmal,
telefonnal, e-mail címmel, bankszámlaszámmal. Mivel ezek felkerülnek a tárba, nem
elég feltételezni, hogy kitaláltak — meg is néztem.

**Az azonosítók többsége már az ellenőrzőszámán elbukik, tehát nem tartozhat élő
nyilvántartási tételhez.** A táblázat MINDEN mintaazonosítót felsorol, a
kivételeket is — az alábbi eredményeket a program saját ellenőrzője adta
(`adoazonositoOk`, `tajOk`, `src/hu/azonositok.ts`), nem kézi számolás:

| Adat | Minta | Eredmény |
|---|---|---|
| adóazonosító jel | `8442130976` (felperes) | ellenőrzőszám **érvénytelen** |
| adóazonosító jel | `8391764205` (I. r. alperes) | ellenőrzőszám **érvénytelen** |
| adóazonosító jel | `8517029364` (II. r. alperes) | ellenőrzőszám **érvényes** — lásd alább |
| TAJ-szám | `041 273 856` | ellenőrzőszám **érvényes** — lásd alább |
| bankszámlaszám | `10402142-49575354-56561008` | a három blokkból csak az első ad érvényes GIRO-ellenőrzőszámot |
| IBAN | `HU42 1040 2142 4957 5354 5656 1008` | mod-97 maradék 64 az előírt 1 helyett — **érvénytelen** |

Ezt a projekt saját auditja is rögzíti (`docs/hatralevo-reszletek.json`), ott
kifejezetten „fiktív irat”-ként hivatkozva rájuk.

**A KÉT ÉRVÉNYES ELLENŐRZŐSZÁMRÓL — mert a szakasz állítása enélkül hamis volna.**

Ez a bekezdés egy korábbi hiba javítása: a táblázat eredetileg csak a két
érvénytelen adóazonosítót sorolta fel, a fölötte álló mondat viszont ÁLTALÁNOS
állítást tett („az azonosítók ellenőrzőszáma nem stimmel”). A II. r. alperes
adóazonosítójára ez nem igaz, és ezt egy külső átnézés vette észre — pont abban
a dokumentumban, aminek az a dolga, hogy a minták közzétételét megindokolja.

Amit az érvényes ellenőrzőszám JELENT: hogy a szám alaki próbán átmegy. Amit NEM
jelent: hogy kiadták valakinek. Az adóazonosító jel tíz számjegy egy
ellenőrzőszámmal — véletlenszerű számsor tizenegyből egyszer átmegy a próbán —, a
TAJ kilenc számjegy, ott tízből egyszer. Két találat hat azonosító között tehát
pontosan az, amit a véletlentől várni lehet, és nem utal arra, hogy a számokat
valódi nyilvántartásból másolták volna.

Ami az érvényességnél többet mond: a minták körül MINDEN MÁS kitalált — a nevek,
a lakcímek, a cégnevek, az ügyszám, a bíróság —, és a bankszámlaszám meg az IBAN
elbukik a saját próbáján. Egy valódi iratból átvett adatsor nem viselkedne így.

Ha valaki mégis kényelmetlennek találja: a `samples/*.json` és a belőlük gyártott
minták cseréje egyetlen szerkesztés, és a két számot ellenőrzőszám-hibásra
állítva a táblázat minden sora „érvénytelen” lesz.

**Egy megjegyzés az e-mail címről:**

- A `kovacs.janos58@freemail.hu` cím létező szolgáltatónál van. Ez a mintában
  szándékos: az egyik teszt épp azt méri, hogy a program az e-mail címbe *rejtett*
  nevet is megtalálja. Valódi postafiókra utaló jel nincs.
- A `docs/zaro-audit.md` egy `kis.robert@gmail.com` tesztcímet is idéz, míg a
  többi tesztcím a `pelda.hu` tartományt használja. Kitalált, de a
  következetesség kedvéért érdemes lecserélni `pelda.hu`-ra.

**Következtetés: a mintairatok felmehetnek a tárba.**

---

## 7. Amit a tárba nem engedünk

A `.gitignore` külön szabályt kapott a `*.szkulcs` fájlokra és a gyökérben álló
PDF/Word iratokra. Indoklás ott, a fájl kommentjeiben; a lényeg, hogy a kulcsfájl
az álnév → valódi név megfeleltetést hordozza, tehát pont az a fájl, amitől az
anonimizálás visszafordíthatóvá válik.

Titok- és jelszókeresés a forráson (`api key`, `token`, `password`, `jelszó`,
`BEGIN PRIVATE KEY`, GitHub- és AWS-kulcsminták) **nem hozott találatot**. A
`docs/hatralevo-reszletek.json` tartalmaz `F:/Projects/Szivecske-Anonymizer/...`
kezdetű abszolút útvonalakat — ez a fejlesztői gép meghajtószerkezetét árulja el,
felhasználónevet és személyes adatot nem; privát tárnál nem indokol beavatkozást.
