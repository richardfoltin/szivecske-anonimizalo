# Kiadás készítése

Hogyan lesz a forráskódból telepíthető program. A belépési pont egyetlen parancs,
`npm run dist`, de van néhány dolog, amit előtte ellenőrizni kell, és néhány, ami
szándékosan **nem** kerül bele a telepítőbe.

---

## Előfeltételek

**1. Függőségek.**

```bash
npm install
```

**2. A nyelvi modell a helyén van.** Ez a lépés a legkönnyebben elfelejthető, mert
a modell **nincs a git-tárban** — 809 MB, és a GitHub fájlonként 100 MB fölött
elutasít. Friss klón után a `.modellek/` mappa üres vagy hiányzik, és az
`electron-builder` ilyenkor hibaüzenettel áll meg az `extraResources` lépésnél.

A telepítéshez ennek a hat fájlnak kell léteznie:

```
.modellek/foltin/nerkor-hubert-hungarian-onnx/
    model.onnx              (440 MB — a scripts/export-nytk.py állítja elő)
    config.json
    tokenizer.json
    tokenizer_config.json
    SHA256SUMS.json
    PROVENANCE.md
```

A `model.onnx` nem tölthető le készen: a Hugging Face-tárolóban csak PyTorch-súly
van, az ONNX-et a `scripts/export-nytk.py` exportálja. Az ellenőrzőösszegek a
`SHA256SUMS.json`-ban állnak — másik gépről átmásolt modellnél érdemes egyeztetni,
mielőtt kiadás készül belőle.

**3. A tesztek zöldek.**

```bash
npm run test:all
```

Ez a lánc típusellenőrzést és 17 tesztfájlt futtat (18 futtatással — az
`app-integration` külön fut PDF-re és DOCX-re). Egy anonimizáló programnál ez nem
formális lépés: a szivárgáskapuk (`test:kapu`, `test:azon-szivargas`,
`test:tamadas`) éppen azt mérik, hogy a kimenetben maradt-e bent valódi adat.
**Piros teszttel nem adunk ki telepítőt.**

---

## A kiadás

```bash
npm run dist
```

Ez öt lépés egyben, ebben a sorrendben:

| Lépés | Mit csinál | Kimenet |
|---|---|---|
| `build:electron` | esbuild becsomagolja a főfolyamatot | `dist-electron/main.js` |
| `build:preload` | esbuild becsomagolja a preload-hidat (CJS) | `dist-electron/preload.cjs` |
| `build:aiworker` | esbuild becsomagolja a modell-munkaszálat | `dist-electron/ai-worker.cjs` |
| `build:ui` | vite lefordítja a React felületet | `dist/ui/` |
| `electron-builder` | NSIS-telepítőt gyárt | `dist/telepito/` |

> **Ne futtasd helyette a puszta `npx electron-builder`-t.** Az nem fordít, csak
> becsomagolja, amit a lemezen talál — így néma módon egy korábbi fordítás kódját
> szállítanád, miközben a forrás már mást tartalmaz. Ezt a README is kiemeli.

A verziószám a `package.json` `version` mezőjéből jön, és megjelenik a telepítő
fájlnevében. Kiadás előtt ezt kell megemelni.

---

## Mi lesz a végén

A `dist/telepito/` alatt:

| Fájl | Méret | Mire való |
|---|---|---|
| `Szivecske Anonimizáló Setup <verzió>.exe` | **~529 MiB** | ez az, amit át kell adni |
| `...exe.blockmap` | néhány száz kB | különbség-alapú frissítéshez; átadni nem kell |
| `win-unpacked/` | ~1 GB | a kicsomagolt program; hibakereséshez hasznos, átadni nem kell |
| `builder-debug.yml` | kicsi | az electron-builder naplója |

Cél: Windows x64, NSIS telepítő, magyar nyelvű telepítővarázslóval
(`nsis.language: 1038`), és a felhasználó megválaszthatja a célmappát
(`oneClick: false`).

### Miért ekkora

Nem a saját kódunk teszi ki. A három nagy tétel:

- **440 MB** — a `model.onnx` nyelvi modell,
- **~86 MiB** — az `app.asar`, ebben a legnagyobb tétel az `onnxruntime-node`
  natív futtatókörnyezete,
- a maradék az Electron/Chromium futtatókörnyezet.

Van 8 bites, negyedakkora modellváltozat (`model.int8.onnx`, 106 MB), de
**szándékosan nem azt szállítjuk**: a `npm run test:quant` mérése szerint elveszít
egy csupa nagybetűs aláírásban álló személynevet. Egy kitakaró programban a
kimaradt név kiszivárgott személyazonosság, és azt nem lehet lemezhellyel
megváltani.

---

## Mi kerül a telepítőbe

**Az `app.asar`-ban:**

- `dist-electron/` — a főfolyamat, a preload és a modell-munkaszál,
- `dist/ui/` — a lefordított felület (React beépítve),
- `package.json`,
- a futásidejű npm-csomagok (95 db). Az `electron-builder` a `dependencies` fát
  **magától** becsomagolja, függetlenül attól, hogy a `build.files` lista mit sorol
  fel tételesen — erre a `docs/licencek.md` 3. pontja kitér, mert egy LGPL-3.0-s
  natív könyvtár is így csúszik be.

**Az `extraResources` alatt (az asar-on kívül, mert a natív betöltőnek valódi fájl kell):**

- `resources/modellek/` — az NYTK modell hat fájlja,
- `resources/data/` — szótárak, homonimalista, névkészletek,
- `resources/build/` — ikonok.

**A telepítő gyökerében az Electron futtatókörnyezet**, benne a kötelező
licencszövegek: `LICENSE.electron.txt` és `LICENSES.chromium.html`. Ezeket
takarításkor sem szabad kitörölni.

---

## Mi NEM kerül bele

| Mi | Miért |
|---|---|
| `model.int8.onnx` (8 bites modell) | méréssel elutasítva, lásd fentebb |
| `bardsai/eu-pii-anonimization-multilang` | a felhasználó tölti le a Beállításokból, ha angol iratot dolgoz fel |
| `samples/`, `spike/`, `test/`, `docs/`, `scripts/` | fejlesztői anyag |
| a `devDependencies` bármelyike | fejlesztéshez kell, futáshoz nem |
| macOS és Linux natív bináris | a `build.files` kizárja az `onnxruntime-node` idegen platformú `napi-v6` mappáit és az arm64-et |
| `onnxruntime-web` | a beágyazott `@huggingface/transformers` másolata kizárva |
| betűkészletek | nem szállítunk: a PDF-átírás a Windows saját `C:/Windows/Fonts` alatti betűit ágyazza be |

Egy tétel a szürke zónában: a `pdf-to-img` és a natív `canvas` a `build:electron`
lépésben `--external`, tehát nem kerül be a főfolyamat kötegébe. A csomagba azért
mégis bejut, a futásidejű függőségi fával együtt. A `src/app/session.ts` ezt
figyelembe veszi: a behúzás `try` blokkon belül, futásidejű `import()`-tal
történik, tehát ha a natív rajzoló mégis hiányozna, a program nem áll meg tőle.

---

## Kiadás után

1. **Próbáld ki telepítve, ne csak a `win-unpacked`-ből.** Az `extraResources`
   útvonalak fejlesztői és telepített módban eltérnek; ez a különbség csak valódi
   telepítéskor jön elő.
2. **Nyiss meg egy valódi iratot, és nézd meg a jegyzőkönyvet.** A program mentés
   után visszaolvassa a kész fájlt egy másik könyvtárral — ennek az ellenőrzésnek
   tisztán kell lefutnia.
3. **Számíts a Windows kék figyelmeztetésére.** A program nincs digitálisan
   aláírva, tehát a SmartScreen az első indításkor megállítja, és a „Futtatás
   mindenképp” gomb alapból rejtve van. Amit a felhasználó lát és mit kell nyomnia:
   `docs/telepites.md`. Ne az átadás pillanatában találkozzon vele először.

---

## Nyitott tételek a következő kiadás előtt

Mindkettő a `package.json` `build` szakaszát érinti, részletes indoklással a
`docs/licencek.md`-ben:

1. **Apache-2.0 licencszöveg mellékelése a modell mellé.** Ma a `PROVENANCE.md`
   megnevezi a licencet, de a szövegét nem szállítjuk — az Apache-2.0 4/a pontja
   viszont kéri. Néhány kB.
2. **A `sharp` kizárása a csomagolásból.** LGPL-3.0-or-later licencű natív
   könyvtárat szállítunk, amit a szöveges felismerés nem használ. A kizárás
   egyszerre tisztázza a licenchelyzetet és **~20 MB-tal csökkenti a telepítőt**.
