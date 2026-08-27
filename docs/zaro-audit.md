# az 1–9. tétel (a szállítást blokkoló hibák)
**1–9. tétel ellenőrzése (szállítást blokkoló hibák) — F:\Projects\Szivecske-Anonymizer**

---

**1. Magyar modell a telepítőben + a felület zsákutcája — KÉSZ**
A `package.json` `build.extraResources` már tartalmazza a `.modellek` → `modellek` bejegyzést a hat NYTK-fájlra szűrve (`F:\Projects\Szivecske-Anonymizer\package.json:76-92`), a `main.ts` pedig `bundledModelDir()`-rel adja át a `ModelStore` második gyökereként (`F:\Projects\Szivecske-Anonymizer\electron\main.ts:80-87, 520`).
Bizonyíték a TÉNYLEGESEN legyártott csomagból, nem a konfigból: `dist/telepito/win-unpacked/resources/modellek/NYTK/…/model.onnx` = **440 342 356 bájt**, és a `ModelStore`-t erre a mappára ráeresztve:
```
nytk-nerkor-hubert   state=installed  onDisk=420.7 MB  total=420.7 MB  source=converted
```
A `source: 'converted'` maradt (ez helyes: letölteni tényleg nincs mit), és mivel a modell `installed`, a `settings.tsx:525-527` „telepítsd újra a programot" ága már csak valódi sérült telepítésnél jelenik meg — ott pedig ez a helyes tanács. A telepítő ára: **555 MB** (`Szivecske Anonimizáló Setup 0.1.0.exe`).

---

**2. PDF megnyitása a telepített programban — KÉSZ (egy apró maradvánnyal)**
`pdf-to-img` átkerült a `dependencies`-be (`package.json:59`), és a natív canvas is bent van. Futtatott bizonyíték a becsomagolt asar-ból (Electron `ELECTRON_RUN_AS_NODE`, `app.asar/dist-electron/main.js`-ből feloldva):
```
RESOLVED: …\app.asar\node_modules\pdf-to-img\dist\index.js
IMPORT OK, exports: pdf
page 1 png bytes 198293
RENDER OK
```
Vagyis a korábbi `MODULE_NOT_FOUND` megszűnt, és valódi PDF-oldal is kirajzolódik. A `@napi-rs/canvas` **nem** került át a `dependencies`-be (ma is `devDependencies:37`), de ez nem számít: az asar-ba a `pdfjs-dist` `optionalDependencies` ágán a **0.1.100** verzió került (ellenőrizve az asar-beli `package.json`-ból), a `.node` bináris pedig helyesen ki van csomagolva (`resources/app.asar.unpacked/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node`).
**Maradvány:** a dinamikus import változatlanul a `try` blokk ELŐTT áll — `F:\Projects\Szivecske-Anonymizer\src\app\session.ts:1860` (`const { pdf } = await import('pdf-to-img');`), a `try {` csak 1862-ben. Ma ártalmatlan, mert a modul feloldható, de a védőháló nem készült el.

---

**3. Felek automatikus felismerése — KÉSZ**
`api.detectParties()` valóban meghívódik: `F:\Projects\Szivecske-Anonymizer\ui\src\App.tsx:185` a `detectAndAskParties`-ben, `setDetected` a 186. soron, `setParties(res.parties.map(stripDetection))` a 187-en, és a kért `finally { setBusy(null); setDialog('parties'); }` a 191-197. sorokon — hibánál is felold és nyit.
Három hívási hely: megnyitás után (`App.tsx:246` `continueAfterOpen`), változáskövetés feloldása után (`App.tsx:309`), és a szkennelt-párbeszédből (`App.tsx:886`). A fogadóoldal is használja (`dialogs.tsx:78,110,117,213`).
A motor futtatva: `npm run test:detect` → `Felek felismerése: 195/195 ellenőrzés rendben` (mindhárom mintairaton 10/10, 10/10, 8/8 fél).

---

**4. Elrontott kódolású programnév — KÉSZ**
Nyers bájtellenőrzés a `package.json`-on: `productName": "Szivecske Anonimiz\xc3\xa1l\xc3\xb3"` és `shortcutName": "Szivecske Anonimiz\xc3\xa1l\xc3\xb3"` — szabályos egyszeres UTF-8.
A LEGYÁRTOTT fájlokon ellenőrizve (`Get-Item ... .VersionInfo`):
```
EXE ProductName : Szivecske Anonimizáló
SETUP ProductName : Szivecske Anonimizáló
```
A telepítő fájlneve is helyes. A `styles.css:1169-1170` mojibake-megjegyzések is eltűntek (0 találat `[ĂĹÄÅË]`-re). Egyetlen megjegyzés: az alapértelmezett telepítési útvonal továbbra is nem-ASCII (`…\Szivecske Anonimizáló`), de már érvényes UTF-8, és a 49. tétel mérése szerint az egyfájlos ONNX ilyen útvonalról betölt.

---

**5. Munka figyelmeztetés nélküli elvesztése — RÉSZBEN**
Ami elkészült: `Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()))` a `main.ts:523`-on; a Nézet menüből a reload/forceReload szerepek szándékosan kimaradtak (`main.ts:381-383`), tehát a Ctrl+R nincs többé bekötve; `CmdOrCtrl+O / +S / +P` megvan (`main.ts:355-357`); `win.on('close')` háromgombos magyar párbeszéddel (`main.ts:460-489`); a piszkos állapotot a felület jelzi (`App.tsx:571` → `main.ts:600`); `will-navigate` kapu a `main.ts:454`-en. A legyártott bundle-ben is bent van (`dist-electron/main.js`: 1 db `setApplicationMenu`, `CmdOrCtrl+O/S/P`; `preload.cjs`: `app:menu`, `app:setDirty`).
Ami NEM készült el: a „Másik irat" gomb **ma is kérdés nélkül nulláz**. `App.tsx:683` `onClick={openDocument}` → `App.tsx:254-259` `openDocument` semmit nem kérdez → `openPath` a 227-232. sorokon `setParties([])`, `setAnalysis(null)`, `setDecisions({})`. Megerősítés csak az „Új ügy" ágon van (`requestNewCase`, `App.tsx:378-381`, `NewCaseDialog`). `beforeunload` csak a böngészős fejlesztői helyettesítőben létezik (`devMock.ts:264`), az éles felületen nincs — ezt a `win.on('close')` kiváltja, tehát ez nem hiány.

---

**6. Nyers angol hibaüzenetek — KÉSZ**
Van fordítóréteg: `HIBA_MINTAK` 15 mintával (`main.ts:197-273`), `magyarHiba()` (`main.ts:298`), és MINDEN IPC-csatorna a `handle()` burkolón át regisztrálódik (`main.ts:317-328`) — 22 `handle(` hívás, nyers `ipcMain.handle` sehol. Az Electron-előtagot a felület leszedi (`ui/src/api.ts:188` `IPC_ELOTAG`). A megszakítást a forrásnál lenyeli: `main.ts:660` `if (!megszakitas(err)) throw err;`.
Futtatott bizonyíték — a **lefordított** `magyarHiba`-t kiemelve a `dist-electron/main.js`-ből és valódi üzenetekre eresztve:
```
pdf-lib jelszavas  => Ez a PDF jelszóval védett, ezért nem tudjuk megnyitni. Nyisd meg a jelszavával…
valtozaskovetes    => A dokumentumban feloldatlan változáskövetés (korrektúra) van…
fetch              => Nem sikerült elérni a letöltő kiszolgálót…
abort              => A művelet megszakítva.
http404            => A letöltő kiszolgáló nem adta ki a fájlt (HTTP 404). Próbáld meg később.
sajat magyar       => Nincs megnyitott irat.
ismeretlen JS      => A művelet nem sikerült. Ha újra előfordul, ez a részlet segít…
```
Az audit által név szerint felsorolt mind a négy eset (`<w:del>`/`resolveRevisions()`, pdf-lib jelszó, nyers fetch, AbortError) lefedve.

---

**7. Kiadási npm script — KÉSZ**
`package.json:22`: `"dist": "npm run build:electron && npm run build:preload && npm run build:aiworker && npm run build:ui && electron-builder"` — mind a négy fordítási lépés lefut a csomagolás előtt. A README is javítva: `README.md:15` és `README.md:17` („A telepítőt mindig a `npm run dist` gyártsa, ne a puszta `npx electron-builder`"). A jelenlegi build ezt igazolja: a források legkésőbb 22:43-kor módosultak, a `dist-electron/*` és `dist/ui/*` 22:46-kor készült, a telepítő 22:48-kor — nincs elavult kód a csomagban.

---

**8. Az EXE gyártója — KÉSZ**
`package.json:6-9`: `"author": { "name": "Foltin Csaba" }`, `"license": "UNLICENSED"`. A legyártott bináris verzióerőforrásán ellenőrizve:
```
EXE CompanyName : Foltin Csaba
EXE Copyright   : Copyright © 2026 Foltin Csaba
SETUP CompanyName : Foltin Csaba
```
A „GitHub, Inc." eltűnt mind az EXE-ről, mind a telepítőről.

---

**9. Kódaláírás / SmartScreen — NINCS KÉSZ**
`Get-AuthenticodeSignature` a legyártott fájlokra:
```
EXE  sig: NotSigned
SETUP sig: NotSigned
```
A `build.win` változatlanul csak `target` és `icon` (kiírva a `package.json`-ból) — nincs `certificateFile`, `azureSignOptions`, `signtoolOptions`, nincs `electron-builder.yml` és nincs `CSC_*` beállítás sehol. A harmadik, aláírás nélküli út sem valósult meg: a „SmartScreen / További információ → Futtatás mindenképp" kézi lépés egyetlen szállítható dokumentumban sem szerepel — a `smartscreen` szó a projektben **kizárólag** a `docs/hatralevo-feladatok.md`-ben és a `docs/hatralevo-reszletek.json`-ban fordul elő, vagyis magában az auditban, a README-ben nem.

---

**Összegzés:** KÉSZ: 1, 2, 3, 4, 6, 7, 8. RÉSZBEN: 5 (a „Másik irat" gomb máig kérdés nélkül dobja el a munkát). NINCS KÉSZ: 9 (nincs aláírás és nincs dokumentált kézi megkerülés sem). Kisebb, nem blokkoló maradvány a 2. tételnél: `src\app\session.ts:1860` — a `pdf-to-img` importja továbbra is a `try` blokkon kívül van.

# a 10–19. tétel (kitakarási hiányok első fele)
**10. Jegyzőkönyv titkosítatlan szereplappal — RÉSZBEN**
A két súlyos fele kész, a harmadik nem. A szereplap KIKERÜLT: `src/app/session.ts:1050-1120` szándékosan csak darabszámot és fajtánkénti összesítést ír, és a fájl végén ki is mondja, hogy a ki-kicsoda tábla a titkosított kulcsfájlba megy. Az idegen fájl felülírása is megoldva: `session.ts:1025-1047` (`writeCertificate` + `isOwnCertificate`) sorszámoz, ha a néven más fájl van — a `spike/out/app-integration-jegyzokonyv-2.txt` létező bizonyíték rá. A `main.ts:774-791` sajátkezű `writeFileSync`-e is eltűnt. **Ami NEM készült el:** „a felület meg sem említi". A `certificatePath` visszajön a munkamenetből (`session.ts:766`), de a felületi `ExportResult` típusban nincs is ilyen mező (`src/app/types.ts:199-205`), és `grep -rn "certificatePath" ui/` üres — a `ui/src/dialogs.tsx:530-568` a kulcsfájl és az irat útvonalát kiírja, a jegyzőkönyvét soha. A felhasználó továbbra sem tudja, hogy egy harmadik fájl is keletkezett a kimenet mellett.

**11. Az ellenőrző kör a szándékszöveget igazolja — KÉSZ**
Mindkét kifogás javítva. A `session.ts:699` `readBack(outputBytes)`-t hív, ami PDF-nél `PDFDocument.load(bytes)`-szal újra parse-olja a KÉSZ bájtokat (`session.ts:809-828`), lapfolyamot és `collectPdfStrings`-et is bejárva; DOCX-nél `analyzeDocx(bytes)` + bájtszintű kör. A sorrend is megfordult: `session.ts:747-760` — a `writeFileSync` az `if (ok)` blokkon BELÜL van, szivárgásnál egyetlen fájl sem keletkezik. Futtatott bizonyíték: `npx tsx test/szivargas-kapu.ts` → „A mentés megtagadta magát: NEM / jelentés: ok=false, 6 bennmaradt név / Keletkezett kimeneti fájl: nem", 2/2 rendben.

**12. Nincs számformátumú azonosító-felismerés — RÉSZBEN (a motor kész, a felületen nem jut el hozzá)**
A motor teljes: `src/hu/azonositok.ts` (661 sor) mind a 13 fajtát ismeri (`azonositok.ts:49-62`), és az ellenőrzőszám tényleg pont, nem kapu. `npx tsx test/azonosito-tests.ts` → 201/201, mintairatonként 14/14, 12/12, 20/20 elvárt azonosító, és külön szakasz mutatja, hogy az érvénytelen ellenőrzőszámú 8442130976 / 24817350-2-13 / HU42… is találat marad. A hrsz-sorrend is megvan (`session.ts:538-546`, `sortForCoverage` az azonosítókat a helynevek ELÉ teszi). **DE a felület nem adja át őket.** A `detectParties` külön `identifiers` listát ad vissza (`src/app/detect.ts:471, 865`), a `ui/src/api.ts:47-54` `DetectionResult` típusában viszont ilyen mező nincs, és az `ui/src/App.tsx:187` csak `setParties(res.parties.map(stripDetection))`-t hív — az `identifiers` a padlóra esik. A `session.ts:541` `if (!entity) continue;` miatt így egyetlen azonosító sem cserélődik. Futtatva a `samples/kolcsonszerzodes.txt`-n:

```
detectParties → parties=8, identifiers=20
A) UI-út (csak parties): 29 találat, ebből azonosító-csere: 0
B) identifiers is átadva: 49 találat, ebből azonosító-csere: 20
```

és a UI-úton lementett kimenetben: `written=true ok=true leaks=0`, miközben `8442130976`, `041 273 856`, `HU42…`, `2000 Szentendre, Bükkös part 14.` mind BENT MARADT. A jegyzőkönyv erre azt írja, hogy „a KÉSZ FÁJL visszaolvasva tiszta". A 14. pont hálója elkapja őket (`residual=39`), de csak átnézési javaslatként — nem blokkol.

**13. Az adatmodell nem ismer „azonosító" adatfajtát — KÉSZ (egy kozmetikai maradvánnyal)**
`src/app/types.ts:20` `EntityKind = 'person' | 'org' | 'place' | 'identifier'`; `src/ai/types.ts:20` `EntityLabel` is öt értékű; `src/pseudonym.ts:561-575` `TYPE_LABEL` és `NUMBERED_LABEL` négy bejegyzéses; `PartyInput.identifierKind` megvan (`types.ts:39`), és a `pseudonym.ts:578+` `AZONOSITO_CIMKE` külön táblát ad az OBH-szóhasználatnak. A `[lakcím]` címke ténylegesen előáll — a fenti futtatás B) ága: `"2000 Szentendre, Bükkös part 14." → "[lakcím]"`. Maradvány: `ui/src/panels.tsx:276` `row.kind === 'person' ? 'személy' : row.kind === 'org' ? 'szervezet' : 'helység'` — egy azonosító-sor a szereplapon „helység"-ként címkéződne.

**14. Az ellenőrző kör vak a számokra — KÉSZ**
`src/verify.ts:232` `BUILTIN_NUMERIC_PATTERNS`, `verify.ts:398` `findNumericIdentifiers`, és a `verify.ts:311-318` alapból bekapcsolva futtatja őket; a hívó ismert eredeti azonosítói `numericLiterals`-ként kemény szivárgássá válnak, a tételesen bent hagyottak `keepNumbers`-szel kikerülnek. A `session.ts:718-731` mind a hármat átadja. `npx tsx test/verify-tests.ts` → 43/43, benne a tagolásfüggetlenség („8442 130 976" ≠ rejtekhely), a 8-8-8 bankszámla egyben tartása, és hogy egy 16 jegyű kártyaszámból nem hasít ki 10 jegyű adóazonosítót.

**15. Az összeg- és dátumkapcsoló mögött nincs kód — KÉSZ (a kulcsfájl-visszafejtés kivételével)**
Van olvasójuk: `session.ts:472-473` (`findOsszegek` / `findDatumok`), a csere a `session.ts:557-588`-ban fut (`tervezOsszegCsere`, `tervezDatumCsere`), a motor `src/hu/osszegek.ts` (1121+ sor) és `src/hu/datumok.ts` (1101+ sor). `npx tsx test/osszeg-datum-tests.ts` → 353/353. Végponti bizonyíték a `samples/kolcsonszerzodes.txt`-n: kikapcsolva 14 találat, bekapcsolva 23, például `"1979. november 21." → "1980. október 14."`. A felületi magyarázó szöveg is a valósághoz igazodott (`ui/src/settings.tsx:288-330`). **Ami nyitva maradt:** a `KeyPayload` továbbra is csak `created` + `entries` (`src/app/keyfile.ts:18-21`), az eltolás mértéke és az összegszorzó nem kerül bele — a kulcsfájlból tehát a nevek visszafejthetők, az összegek és dátumok nem.

**16. A PDF Form XObjectjeibe soha nem lép be — KÉSZ**
`src/pdf/textRuns.ts:449` kezeli a `Do` operátort, `:324-355` rekurzívan bejárja a formot a saját `/Matrix`-ával és a `Do` helyén érvényes CTM-mel, körkörös hivatkozás- és mélységvédelemmel (`DEFAULT_MAX_DEPTH = 8`, `path.has(child.id)`). Az erőforrás-feloldás a `src/pdf/resources.ts`-ben lusta. Amit nem járt be, arról hangosan szól: `src/pdf/warnings.ts:126-134` + `session.ts:376`. A visszaírás is folyamhelyesen megy (`session.ts:974`, `groupRangesByStream`). `npx tsx test/pdf-tests.ts` → 35/35, benne „a bejárás belép a Form XObjectbe", a `/Matrix` szorzás, az önhivatkozás és a csonka folyam jelentése.

**17. A PDF-mentés csak az Info szótárat tisztítja — KÉSZ**
`session.ts:1612-1704` `scrubPdfMetadata` lefedi az XMP-t (`catalog.Metadata`), `Annots`-ot, `AcroForm`-ot, `Names/EmbeddedFiles`+`JavaScript`-et, `Outlines`-t, továbbá a `StructTreeRoot`-ot és `PieceInfo`-t, majd `purgeUnreachableObjects` ténylegesen TÖRLI az árva objektumokat (a hivatkozás elvágása önmagában nem lett volna elég). Empirikusan ellenőriztem egy szándékosan bepiszkított PDF-fel (XMP `xmp:CreatorTool` + `C:\Users\kovacsj\` útvonal, jegyzet, könyvjelző, AcroForm, beágyazott melléklet) — a forrásban benne, a kimeneti bájtokban egyik sem:

```
FORRÁS:  xmp:CreatorTool IGEN, kovacsj IGEN, titkos melleklet IGEN
KIMENET: xmp:CreatorTool nem, kovacsj nem, titkos melleklet nem,
         /Metadata nem, /Annots nem, /AcroForm nem, /Outlines nem, /EmbeddedFiles nem
```

**18. A DOCX bájtszintű maradványvizsgálat kikapcsol, ha egy találat eldöntetlen — KÉSZ**
Pontosan az előírt megoldás született meg: `src/docx/anonymize.ts:310` `buildResidueGuard` a SZERKESZTÉSEKBŐL állítja elő a tiltólistát (azaz azokból a felszíni alakokból, amikhez tényleg tartozik elfogadott csere), és részenként megtűrt darabszámot számol a megjósolt kimenetből — ez oldja fel a „Kovács Jánosné tartalmazza a Kovács Jánost" csapdát. A `:235` a hívó jóindulatától függetlenül lefut, a `:272` `checkResidueGuard` a KÉSZ zip-en. Második, szintén kapu nélküli hívási hely a `session.ts:840-865` `docxByteLeaks` (`residueNeedles()` a `lastAssignments`-ből). `npx tsx test/docx-tests.ts` → 87/87, benne a 16. teszt, ami pont az auditált helyzetet reprodukálja: „üres tiltólistával is megáll a rejtett bináris részben maradt névtől" (`word/embeddings/oleObject1.bin`, utf-16le), miközben „a félkész átnézés exportja nem áll meg", csak jelentést ad.

**19. Hiányzó DOCX attribútum-hordozók — KÉSZ**
`src/docx/text.ts:126-158` mind a nyolc kért hordozót felvette: `w:fldSimple/@w:instr`, `w:bookmarkStart/@w:name`, `w:hyperlink/@w:tooltip` (+ ráadásként `@w:anchor`, hogy a hivatkozás ne törjön el), `w:tblCaption/@w:val`, `w:tblDescription/@w:val`, `wp:docPr/@name` (és `pic:cNvPr/@name`), `v:shape/@alt` és `@o:title`. A `test/docx-tests.ts:280-338` mindegyikre névvel töltött mintát épít, a `:622-735` pedig visszaellenőrzi a kimeneten (`!/w:instr="[^"]*Kovács/`, `!/(alt|o:title)="[^"]*Kovács/` stb.) — 87/87 rendben.

**Összegzés:** KÉSZ: 11, 14, 15, 16, 17, 18, 19. RÉSZBEN: 10 (a felület nem említi a jegyzőkönyvet), 12 (a motor kész, de a felület elejti a felismert azonosítókat — ez a legsúlyosabb megmaradt hiba, mert álnevesített iratot ad ki bent maradt adóazonosítóval, TAJ-jal és lakcímmel, „tiszta" jegyzőkönyvvel), 13 (adatmodell kész, `ui/src/panels.tsx:276` rossz címkét ad az azonosítóknak).

# a 20–29. tétel (kitakarási hiányok második fele)
**20–29. tétel — ellenőrzés kódból, futtatott bizonyítékkal**

---

**20. DOCX-be ágyazott képek: figyelmeztetés + EXIF — KÉSZ**
Van teljes EXIF/IPTC/XMP/PNG-chunk-vágó (`F:\Projects\Szivecske-Anonymizer\src\docx\media.ts`, JPEG-jelölő- és PNG-chunk-bejárással, ismeretlen formátumnál érintetlenül hagy), a `word/media/` besorolás kapott magyar megjegyzést (`src\docx\parts.ts:134-142`), az elemzés hangosan jelenti a képeket (`src\docx\anonymize.ts:133-141`), az export pedig ténylegesen takarít (`src\docx\sanitize.ts:290` hívja a `cleanMedia`-t, `:315-334`).
Futtatva: `npx tsx test/docx-tests.ts` → `DOCX: 87/87 ellenőrzés rendben`, és a kimenet végén: „3 beágyazott kép van a dokumentumban (word/media/image1.png, image2.png, image3.jpg). A metaadataikat (EXIF, IPTC, XMP, PNG-szövegdarabok) kitöröltük…”

**21. ToUnicode nélküli betűkészlet — KÉSZ**
`src\pdf\warnings.ts` új modul (`FontWarning.missingToUnicode/unknownFont/unresolved`, magyar mondatokká formázva). A rajzolási ág már számol: `src\pdf\textRuns.ts:301-308` cmap nélkül nem talál ki szöveget, de `unresolved += Math.ceil(bytes.length/step)`; `:314` az üres leképezést is veszteségként számolja. A csatorna kimegy a felületig: `src\app\session.ts:376` → `loadWarnings` (`:275-288`) → `analysis.warnings` (`:624-630`) → `ui\src\panels.tsx:217` kirajzolja.
Futtatva: `npx tsx test/pdf-tests.ts` → `PDF: 35/35`, benne „a kimaradt karakterkódokat megszámoljuk”, „valódi PDF: a ToUnicode nélküli sort nem találjuk ki”.

**22. Kézi fedőnév mind a négy módban — KÉSZ**
`src\pseudonym.ts:638` (`ctx.mode === 'theme' || assignment?.manual === true`) és `:692-698` (`displayFor`), a szereplap `session.ts:607` már `displayFor`-t használ.
Futtatva (saját próba, `manualReplacement: 'Zafír Bálint'`, ugyanaz a fél mind a négy módban):
```
theme    cast: Kovács János -> Zafír Bálint [kézi] | csere: Kovács János => Zafír Bálint
role     cast: Kovács János -> Zafír Bálint [kézi] | csere: Kovács János => Zafír Bálint
type     cast: Kovács János -> Zafír Bálint [kézi] | csere: Kovács János => Zafír Bálint
numbered cast: Kovács János -> Zafír Bálint [kézi] | csere: Kovács János => Zafír Bálint
```
(A kézi nélküli fél mindenütt helyesen `I. r. alperes` / `[név]` / `[NÉV-2]`.) Egy maradék megjegyzés: a kulcsfájl továbbra is `a.display`-t ír (`src\app\keyfile.ts:69`), nem `displayFor`-t — kézi félnél ez már helyes, de kézi felülírás NÉLKÜLI félnél szerep-/adatfajta-/számozott módban a kulcsfájl még mindig a témás álnevet rögzíti, nem azt, ami az iratban áll.

**23. keepList az ellenőrzéshez + maradványcsonkolás + „dr.” — KÉSZ**
`src\app\session.ts:704-731`: a `verifyOutput` megkapja a `keepList`-et (kihagyott felek + `lastKeepList`), a `safeWords`-öt, a `reviewedKept`-et. A csonkolás láthatóvá vált: `src\verify.ts:157` (`DEFAULT_RESIDUAL_LIMIT = 40`), `:384-385` (`residual: slice(0, limit)`, `residualTotal: allResidual.length`), a felület a TELJES számot mutatja (`ui\src\dialogs.tsx` „Gyanús maradvány átnézésre” → `r.residualTotal`, külön „N látszik a M maradványból” jelzéssel). A mondatkezdet-heurisztika javítva: `src\verify.ts:186` `NOT_SENTENCE_END = {dr, ifj, id, özv, stb, ill, pl, prof}`.
Futtatva: `npx tsx test/verify-tests.ts` → `43/43`, benne „a keepList elnémítja az eljáró nevét”, „a teljes szám a levágás előtti (12)”.

**24. Modellhiba néma visszaesése — RÉSZBEN (a motor kész, a huzalozás hiányzik)**
Megvan a négyállapotú `ModelState = 'ok'|'off'|'missing'|'failed'` (`src\app\session.ts:188-201`), a hangos magyar figyelmeztetés (`:1395-1436`) és a jegyzőkönyv-sor (`:1445-1462`). **Viszont a `AnalyzeInput.model` mezőt SOHA senki nem tölti ki:** a felületi `AnalyzeInput` típusban nincs is `model` mező (`ui\src\api.ts:23-39`), a `runAnalysis` nem küldi (`ui\src\App.tsx:144-153`), a `doc:analyze` kezelő sem injektálja (`electron\main.ts:751-761`). Emiatt `lastModel` mindig `{state:'off'}`.
Futtatva (végponttól végpontig export, szerkezeti felismeréssel):
```
Nyelvi modell:         NEM FUTOTT — kikapcsolva; csak a szerkezeti felismerés dolgozott
  - A nyelvi modell KI VAN KAPCSOLVA, ezért csak a szerkezeti felismerés futott…
```
A `doc:detectParties` ráadásul még a régi alakot adja vissza (`electron\main.ts:738`: `{ ...result, modelUsed, modelNote }`), tehát `'failed'` állapot sehol nem keletkezik, és a jelzés továbbra is CSAK a fél-jóváhagyó ablakban látszik (`ui\src\dialogs.tsx:117-131`) — pont az, amit a tétel kifogásolt.

**25. A modell nem értelmezett találatai — RÉSZBEN (csak a fogadóoldal épült meg)**
A `session.ts:201` `unmappedLabels?` mező, a hozzá tartozó figyelmeztetés (`:1422-1428`) és jegyzőkönyv-toldalék (`:1447-1450`) megvan — de **sehol nem íródik bele érték** (grep az egész `src`/`electron`/`ui`-ra: csak definíció és két olvasó). A négy kért változtatásból egy készült el (`EntityLabel` kapott `'identifier'`-t, `src\ai\types.ts:20`); a többi változatlan:
- `src\ai\tokenClassifier.ts:141-142`: `const label = this.cfg.labelMap[t.label]; if (!label) continue;` — néma eldobás, számláló nélkül.
- `src\ai\hubertNer.ts:215-217`: `if (label && trimmed && …)` — ugyanígy némán kihagy.
- `src\app\detect.ts:688`: `if (e.label === 'other') continue;`, `:692` minden nem-person/org `place`-re kényszerül.
- `src\app\models.ts:114-122`: a többnyelvű modell `labelMap`-je továbbra is 7 név-jellegű címke, a leírása (`:101`) viszont változatlanul „összegeket, dátumokat és azonosítókat” ígér. Egyik kiút sem lett megjárva.
- Az `extract()` visszatérése is csak `{ entities, ms }` (`src\ai\client.ts:109-113`), nincs mit átadni.

**26. Bszi. 166. § (2) szerepfelismerés — KÉSZ**
Az ülnök bekerült mindkét szókincsbe (`src\app\detect.ts:186-188` `KEEP_ROLE_AFTER` … `[Nn]épi ülnök|[Üü]lnök`), és megszületett a fordított szórendű, rovatos minta (`:190-202` `KEEP_ROLE_BEFORE`, benne `[Tt]anács[ \t]+elnöke`; a bejárás `:390-403`, vesszős felsorolással). A „dr.” előtag már nem kötelező (`TITLES` `(?:…)*` a `:66` sorban).
Futtatva (saját próba):
```
{"name":"Kovács Anna","why":"eljáró tanács elnöke — a törvény szerint a neve bent marad"}
{"name":"Szabó Béla","why":"eljáró ülnök — …"}   {"name":"Tóth Márta","why":"eljáró ülnök — …"}
{"name":"Fekete Imre","why":"eljáró ülnök — …"}  (dr. előtag nélkül, „Fekete Imre ülnök” alakból)
```
`npx tsx test/detect-tests.ts` → `195/195`.

**27. Üres jelszó a kulcsfájlban — KÉSZ**
`src\app\keyfile.ts:27` `MIN_PASSPHRASE_LENGTH = 8`, `:44-55` `checkPassphrase` (üres/csupa szóköz és 8 alatti hossz elutasítva), és **mindkét** belépési pont hívja: `writeKeyFile` (`:62`) és `readKeyFile` (`:97`). Az export sorrendje is helyes lett: a kulcsfájl megy először, hogy gyenge jelszónál ne maradjon kulcs nélküli álnevesített irat (`src\app\session.ts:748-757`).
Futtatva:
```
jelszó ""            -> ELUTASÍTVA: A kulcsfájl jelszó nélkül nem használható…
jelszó "   "         -> ELUTASÍTVA: ugyanaz
jelszó "rovid"       -> ELUTASÍTVA: legalább 8 karakter hosszúnak kell lennie
jelszó "nagyontitkos"-> ELFOGADVA
readKeyFile üres jelszóval -> elutasítva
```

**28. E-mail mint önálló azonosító — RÉSZBEN**
A motorban mindkét kifogás javítva:
- Önálló felismerés: `src\hu\identifiers.ts:78-91` `findIdentifierTokens`, amit az azonosító-kereső be is húz (`src\hu\azonositok.ts:519-523`). Futtatva: `iroda@drkovacsugyved.hu`, `titkarsag@torvenyszek.hu`, `kis.robert@gmail.com` mind `email` találat lett, egyetlen fél neve nélkül is.
- A hárombetűs vezetéknevek: `MIN_FRAGMENT = 3` (`identifiers.ts:108`) + betűhatár-feltétel 4 alatt (`DELIMITED_BELOW`, `fragmentFits`, `:110-133`). Futtatva: a töredéklistán ott a `kis`, `ban`, `vas`; a `kis.erika@freemail.hu` és `ban.tamas@iroda.hu` illeszkedik, a `vasarnap@pelda.hu` és `kovacsvas@pelda.hu` NEM. Végponttól végpontig: `kis.erika@freemail.hu → erces.turkiz@freemail.hu`.

**De a szivárgás megmarad:** a `detectParties` külön listában adja vissza az azonosítókat (`src\app\detect.ts:865` `{ parties, keepList, identifiers }`), a felület viszont ezt a mezőt nem ismeri — a `DetectionResult` típusban nincs `identifiers` (`ui\src\api.ts:47-54`), és az `App` csak a `res.parties`-t veszi át (`ui\src\App.tsx:186`). A csere pedig fél nélkül nem történik meg (`src\app\session.ts:541-542`: `matchIdentifierEntity(...); if (!entity) continue;`). Futtatott bizonyíték — előnézet: `Kapcsolat: iroda@drszabougyved.hu, valamint erces.turkiz@freemail.hu.` — az irodai cím érintetlen maradt, pont az az eset, amiért a tétel íródott.

**29. A mentéskori figyelmeztetések — NINCS KÉSZ**
Az `ExportResult`-ban ma sincs `warnings` mező: `src\app\types.ts:199-205` mindössze `{ outputPath, keyPath, report, certificate }`. Futtatva, valódi exportból: `ExportResult kulcsok: outputPath,written,keyPath,certificatePath,model,report,certificate` — `warnings` sehol.
A mentés utáni ablak (`ui\src\dialogs.tsx:433-580`) egyetlen figyelmeztetést sem rajzol ki: darabszámokat, szivárgáslistát, maradványlistát, kulcs- és iratútvonalat igen. A `certificate` szöveg (ami tartalmazza a figyelmeztetéseket, `src\app\session.ts:1098-1106`) sehol nem jelenik meg a felületen — `grep -rn "certificate" ui/src` egyetlen találata `devMock.ts:143`. Vagyis az `exportWarnings` továbbra is csak akkor bukkan fel, ha a felhasználó a mentés után ugyanabban a munkamenetben újra lefuttatja az elemzést (`session.ts:630`).

---

**Összesítés:** KÉSZ: 20, 21, 22, 23, 26, 27. RÉSZBEN: 24, 25, 28. NINCS KÉSZ: 29.
Közös minta a három részlegesnél: a **fogadóoldal** (mezők, magyar szövegek, jegyzőkönyv-sorok) megépült, a **termelő- vagy továbbító oldal** nem — a `model` és az `identifiers` sosem kel át az IPC-n, az `unmappedLabels`-t senki nem számolja.

# a 30–42. tétel (a felület hiányai)
**30. A mentett alapértelmezések nem érvényesülnek induláskor — KÉSZ**
Az App induláskori `useEffect`-je most lekéri és alkalmazza a mentett beállításokat, a kulcsfájl-kapcsolót is átadja az export-ablaknak.
Bizonyíték: `F:\Projects\Szivecske-Anonymizer\ui\src\App.tsx:580-601` (`saved = await api.getSettings()`, majd `setMode / setKeepKeyDefault / setAutoDetect / setAutoThreshold / setReplaceAmounts / setShiftDates`, és `:596-597` a mentett `themeId` alkalmazása léttel-ellenőrzéssel); `App.tsx:906` `defaultKeepKey={keepKeyDefault}` → `ui\src\dialogs.tsx:428` `useState(defaultKeepKey)`; a `settings.tsx` `onChanged` visszahívása mind a hét értéket visszaadja (`App.tsx:936-947`). Az `autoDetect` valódi olvasója megvan (`App.tsx:178`), nem csak a főfolyamatban.

**31. Az „Automatikus csere küszöbe” csúszka — KÉSZ (egy fenntartással)**
A küszöb példányszintű lett a matcherben, és az elemzés bemenetén átjut.
Futtatott bizonyíték (`npx tsx` a `SeedMatcher`-rel, 4 találat ugyanazon a szövegen):
```
kuszob=0.5 : Kovács János[1.00/auto] János[1.00/auto] K. J.[0.95/auto]   Kovács[1.00/auto]
kuszob=0.96: Kovács János[1.00/auto] János[1.00/auto] K. J.[0.95/review] Kovács[1.00/auto]
```
Kód: `src\hu\matcher.ts:178` `private readonly autoThreshold`, `:185` `clampThreshold(opts.autoThreshold)`, `:295-296`, `:305`, `:386-387`, `:499` (a boost is paraméterből dolgozik); `src\app\session.ts:462` adja át; `ui\src\App.tsx:150` küldi el; `App.tsx:518-529` újrafuttatja az elemzést, ha a kapcsoló változik.
Fenntartás: a KÉSŐBB hozzáadott szám-felismerők még a modulszintű állandóval döntenek — `src\hu\azonositok.ts:575`, `src\hu\datumok.ts:766`, `src\hu\osszegek.ts:480` mind `confidence >= AUTO_REPLACE_THRESHOLD`. A csúszka tehát a nevekre hat, az azonosítókra/dátumokra/összegekre nem. Ez az eredeti tétel szövegén kívül esik („amit a matcher három helyen használ”), de a felhasználónak egyetlen csúszka látszik.

**32. Új irat megnyitásakor bent maradnak az előző ügy felei — KÉSZ**
`ui\src\App.tsx:225` `setParties([])` a megnyitás után (a `setDetected(null)`, `setAnalysis(null)`, `setDecisions({})` mellett). Az ügyazonosító titok kapott settert és tudatos műveletet: `App.tsx:122` `useState(newCaseSecret)`, `:358-377` `startNewCase()` (`setCaseSecret(newCaseSecret())`), `:379-382` `requestNewCase()` megerősítéssel, `dialogs.tsx:774` `NewCaseDialog`, elérhető a lépéssávból (`App.tsx:688`) és a Fájl menüből (`electron\main.ts:359`).

**33. Nincs képernyő a kulcsfájl visszafejtésére — KÉSZ**
Teljes lánc megvan: `electron\main.ts:617-627` `key:choose`, `:633-640` `key:read` (hívja a `readKeyFile`-t), `electron\preload.ts:87-88` kivezetés, `ui\src\dialogs.tsx:839-1011` `KeyFileDialog` (tallózás, jelszó, tábla, magyarított hibaüzenetek a `emberiKulcsHiba`-ban `:818`), belépés a Fájl menüből (`main.ts:358`) és a mentés utáni képernyőről (`dialogs.tsx:545-547`). A kulcs útvonala ki is íródik: `dialogs.tsx:540` `<div className="pathline mono">{keyPath}</div>`, `:543` „A kulcs mappája” gomb a kulcsra mutat, `:566/573` külön sor és gomb az iratra.
Futtatott bizonyíték (`npx tsx test/app-integration.ts`): `Kulcsfájl visszaolvasva: 10 bejegyzés`.

**34. A „Gyanús maradvány átnézésre: N” szám zsákutca — KÉSZ**
`ui\src\dialogs.tsx:505-524`: `r.residual.length > 0` esetén `<FindingList items={r.residual} />` — ugyanaz a komponens (`:394`), ami a szivárgásokat rajzolja, felszíni alakkal és indoklással; `:509-515` külön kiírja, ha a lista csonkolt („40 látszik az 52 maradványból”), és a számsor a teljes `residualTotal`-t mutatja (`:484`), nem a levágott hosszt.
Futtatott bizonyíték: `Gyanús maradvány: 52 (listázva 40)` az integrációs tesztből — a motor tényleg 40 tételt ad át, és a felület kirajzolja őket.

**35. A szkennelt PDF csak a folyamat legvégén derül ki — RÉSZBEN**
A fő követelmény kész: `ui\src\App.tsx:242-245` a megnyitás után azonnal `setDialog('scanned')`, a Felek-párbeszéd ELŐTT; a párbeszéd (`dialogs.tsx:725-765`) kimondja, hogy nincs mit kiolvasni, és „Másik irat megnyitása” / „Mégis megnézem” választást ad.
Ami nem készült el: a betöltési figyelmeztetések továbbra sem jelennek meg megnyitáskor. A `DocumentInfo.loadWarnings` (`src\app\types.ts:154`, feltöltve `src\app\session.ts:340`) az egész `ui/` alatt egyszer sem olvasódik ki — `grep -rn "loadWarnings" ui/src/` egyetlen találata `ui\src\devMock.ts:69`. A figyelmeztetések ma is csak az elemzés után, a Szereplap „Felek” fülén látszanak (`ui\src\panels.tsx:217`, `analysis.warnings`).

**36. A behúzott fájl nem nyílik meg, az ablakra ejtve elnavigál — KÉSZ**
Ejtés: `ui\src\App.tsx:268-293` `openDropped()` kiolvassa a `dataTransfer.files`-t, kiterjesztésre szűr (`:45` `OPENABLE`), az útvonalat a hídtól kéri (`:280` `api.pathForFile`, megvalósítás `electron\preload.ts:75-82` `webUtils.getPathForFile`), és tallózásra lép vissza, ha nincs útvonal. Ablakszintű védelem: `App.tsx:633-648` `window` `dragover`+`drop` `preventDefault`-tal (nyitott párbeszéd alatt csak elnyeli). Főfolyamat-kapu: `electron\main.ts:454-458` `will-navigate`, ami mindent tilt a saját lapon kívül (`sajatOldal()`, `:400`). Az ejtőmező `stopPropagation`-nel kerüli a dupla megnyitást (`App.tsx:1009`).

**37. A változáskövetés-párbeszéd „Mégse” gombja zsákutcába enged — KÉSZ**
A blokkoló állapotot a felület tartja fenn: `ui\src\App.tsx:441` `revisionsBlocked`, `:443-453` `requestExport()` blokkolt állapotban a feloldó párbeszédre visz, nem hibaüzenetre; `:745-756` a „Mentés másként…” gomb `disabled={!analysis || revisionsBlocked}` magyarázó tooltippel; `:732-744` látható figyelmeztetés a lépéssávban („N feloldatlan módosítás — kattints a feloldáshoz”). Az ablakbezárás „Mentés másként” ága is ide fut vissza (`electron\main.ts:481-484` → `sendMenu('save')` → `requestExport`).

**38. Nincs előnézet és nincs nyomtatás — KÉSZ**
Előnézet: `ui\src\App.tsx:769-801` nézetváltó („Eredeti — kiemelve” / „Előnézet — ez kerül a fájlba”), `:460-476` lekéri a MOTOR kimenetét (`api.previewText()` → `electron\main.ts:761-764` → `session.anonymizedText()`, `src\app\session.ts:659`), `ui\src\panels.tsx:110-152` `PreviewView` rajzolja, az elemzés újrafutásakor a gyorsítótár ürül (`App.tsx:160-161`).
Nyomtatás mind a három úton: menüpont + Ctrl+P (`electron\main.ts:357`), gomb (`App.tsx:785`), és a `doPrint()` (`:488-509`) előbb átvált az álnevesített nézetre. Védelem: `ui\src\styles.css:1383-1394` `@media print` alatt `.viewport.source { display: none !important }` — az eredeti nevek papírra nem kerülhetnek.

**39. A mentés folyamatjelzője a fájlnév megadása előtt pörög — KÉSZ**
`ui\src\App.tsx:384-397`: a `suggestOutputPath` és a `chooseSaveTarget` fátyol nélkül fut, a `setBusy('Mentés és ellenőrzés…')` csak a `:396` `if (!target) return;` UTÁN áll be. A gomb kétszeri elindítása ellen az ExportDialog saját `working` állapota véd (`ui\src\dialogs.tsx:432`, `:642-646`).

**40. Nincs verziószám és névjegy — KÉSZ**
`electron\main.ts:586-598` `app:info` kezelő (`app.getVersion()`, modellazonosító, `modelState`, motor, és a `halofajl()` (`:550`) által megállapított TÉNYLEGESEN betöltendő hálófájl). Megjelenítés: `ui\src\settings.tsx:388-419` hat sor a „A programról” fülön, `:341-352` hangos figyelmeztetés hiányzó modellnél, `:357-363` külön jelzés, ha a 8 bites háló fut (`nyolcBites()`, `:35`), `:368-373` ha a legutóbbi felismerésnél a modell nem futott le. Elérés: Súgó → A programról (`main.ts:394` → `App.tsx:546-547` `openSettings('about')`).

**41. A Beállítások ablak kilóg a többi közül — KÉSZ**
`ui\src\settings.tsx:12` importálja és `:121` használja a közös `Overlay`-t (`dialogs.tsx:17-30`, benne az Escape-figyelő). Mindhárom betöltő hívásnak van `.catch`-e: `settings.tsx:77-79`, és a hiba meg is jelenik (`:144` `{error && <div className="note bad">…}`, plusz üres állapotra magyarázó szöveg `:156-162` és `:203-209`). A modelltörlés try/catch-ben van: `:108-118`.

**42. Magyar helyesírási és tipográfiai hibák — KÉSZ (egy új ellentmondással)**
A tautológia javítva: `ui\src\dialogs.tsx:444` `'Elkészült, de maradt benne eredeti név'`.
Idézőjelek: az egész `ui/src/` alatt 36 nyitó „ és 23 záró ” áll; a 13 páratlan mind KÓDMEGJEGYZÉSBEN van (`App.tsx:731`, `dialogs.tsx:482,510,511,536`, `panels.tsx:42`, `settings.tsx:298`, `api.ts:108,120,128,184`) plusz egy fejlesztői próbaadat (`devMock.ts:105`). Minden felhasználónak megjelenő szöveg helyes párt használ — pl. `App.tsx:274,1035`, `dialogs.tsx:98-99`, `settings.tsx:150,194,326,344`.
Amit viszont a javítás behozott: a `r.ok === false` ágon a cím azt mondja, „**Elkészült**, de maradt benne eredeti név”, a törzs négy sorral lejjebb viszont azt, hogy „**egyetlen fájl sem készült el**” (`dialogs.tsx:444` vs. `:458-460`). Ez tárgyi ellentmondás ugyanazon a képernyőn — a szivárgásnál semmi nem készült el.

**Módszertani megjegyzés**: `npx tsc --noEmit` hibátlanul lefut (a `tsconfig.json` a `ui/**/*.tsx`-et is befedi), és `npx tsx test/app-integration.ts` végigmegy (`Végponttól végpontig: 5/5 ellenőrzés rendben`). A tételekhez tartozó CSS-osztályok (`pathline`, `pathacts`, `pathpick`, `keytable`, `findings`, `findhead`, `viewbanner`, `viewtabs`, `segbtn`, `step.warn`, `fieldlabel`) mind léteznek a `ui\src\styles.css`-ben, tehát nem félkész felületről van szó.

# a 43–52. tétel (jó-lenne és későbbre tett tételek)
## 43–52. tétel — ellenőrzés

**43. Windows-integrációs apróságok — KÉSZ**
Mind a négy darab megvan, és a KÉSZ BUILDBEN is: `F:\Projects\Szivecske-Anonymizer\electron\main.ts:504` (`if (!app.requestSingleInstanceLock()) app.quit(); else bootstrap();`), `:508` (`app.setAppUserModelId(APP_ID)`, ahol `APP_ID = 'hu.szivecske.anonimizalo'` a `:50`-en pontosan egyezik a `build.appId`-vel), `:510–516` a `second-instance` előhozó kezelő. A `package.json` nsis-blokkjában ott a `installerLanguages: ["hu_HU"]` és a `shortcutName: "Szivecske Anonimizáló"`. Futtatott bizonyíték: `grep -c "setAppUserModelId\|requestSingleInstanceLock" dist-electron/main.js` → **2**, és a legenerált NSIS-scriptben (`dist/telepito/builder-debug.yml:82`) egyetlen nyelv szerepel: `!insertmacro MUI_LANGUAGE "Hungarian"`.

**44. 1,1 GB telepített méret — KÉSZ (a sharp bent maradt)**
Mérés a valódi buildből (`dist/telepito/win-unpacked`): **969,6 MB összesen, ebből 420,7 MB a modell → 548,9 MB modell nélkül**, az auditbeli 1,1 GB helyett. Ez ~550 MB megtakarítás, kétszerese a kitűzött ~250 MB-nak. Ellenőrizve a csomagban: `onnxruntime-node/bin/napi-v6` alatt CSAK `win32/x64` van (a darwin/linux/arm64 kizárva), a `@huggingface/transformers/node_modules/onnxruntime-node` **nem létezik** (`Test-Path` → False), az `onnxruntime-web` sem. `overrides` mező nincs, de a `!`-kizárás ugyanazt éri el, és mérhetően működik. **Ami maradt:** a sharp 19,0 MB (`@img\sharp-win32-x64\lib\libvips-42.dll` 18,2 MB) — semmi nem használja, ez a tétel egyetlen le nem zárt darabja. A `@napi-rs/canvas` 36 MB viszont ma már JOGOS: a `pdf-to-img` bekerült az asarba (`npx asar list` → `\node_modules\pdf-to-img\dist\canvasFactory.js`), tehát nem halott súly többé.

**45. A `parties:suggest` csonk törlése — KÉSZ**
`grep -rn "parties:suggest\|suggestParties" electron/ src/ ui/ test/` → **0 találat** (exit 1). Az IPC-kezelőlista teljes felsorolása (`grep -on "handle('...'" electron/main.ts`) 22 kezelőt ad, `parties:suggest` nincs köztük. A buildben sem: `grep -c "parties:suggest" dist-electron/main.js dist-electron/preload.cjs` → **0, 0**. Csak a független `doc:suggestOutputPath` maradt.

**46. Bájtaláírás-ellenőrzés a szöveges ágon — KÉSZ (egy szűk maradék réssel)**
A `formatumGond()` (`src/app/session.ts:1201`) valóban a valós megnyitási úton van: `fromBytes()` hívja a `:314`-en és `throw`-ol. Kezeli az OLE-t (`D0CF11E0`), az RTF-et (`{\rtf`), a ZIP-en belüli ODF/xlsx/pptx jelet, a hamis kiterjesztést mindkét irányban, a nulla bájtot és az üres fájlt. Futtatott: `npx tsx test/formatum-tests.ts` → **28/28 ellenőrzés rendben**. *Maradék rés:* futtattam a fordított eseteket is — egy valódi PDF `.txt` néven, egy ismeretlen ZIP `.txt` néven és egy `word/`-jelű ZIP `.txt` néven mind **`null`-t ad** (átengedi), és a `format` a `:317`-en tisztán kiterjesztésből dől el, tehát ezek UTF-8 kacatként olvasódnának be — épp a tétel által leírt néma „tiszta” forgatókönyv. A tétel által NEVESÍTETT esetek (.doc, .rtf, .odt) viszont mind hangosan elszállnak.

**47. További azonosító-minták és rovatváltozatok — RÉSZBEN**
Csak az „anyja neve” rész készült el, a másik kettő egyáltalán nem.
- ✅ „anyja neve” változatai: `src/app/detect.ts:325-327` regexe lefedi az `anyja születési neve`, `an.`, `a. n.`, `szül. anyja neve` alakokat és a kettőspont nélküli formát is; `role: 'anyja neve'` beáll (`:334`). Futtatva: `npx tsx test/anyja-neve.ts` → **5/5 rendben**, mind a öt változat megkapja a helyes szerepet.
- ❌ Rendszám: `grep -rni "rendszám\|forgalmi rendsz" src/ ui/ electron/ test/` → **0 érdemi találat**. Az `AzonositoKind` union (`src/hu/azonositok.ts:49-62`) 13 fajtát tartalmaz, rendszám nincs benne.
- ❌ Ügyvédi kamarai azonosító (KASZ) és irodacím „tudatosan meghagyottként”: `grep -rni "kamarai\|KASZ\|irodacím"` → **0 találat a forrásban**. A `KASZ:` mindössze egy NEGATÍV tesztsorban szerepel (`test/azonosito-tests.ts:350`), ahol azt várjuk el, hogy semmi ne illeszkedjen rá — tehát nem „láthatóan meghagyott”, hanem egyszerűen nem létezik. A `keepList` (`src/app/detect.ts:46, 467`) kizárólag NEVEKET tart nyilván (hatóság, eljáró ügyvéd, bíró), azonosítót nem.

**48. Szerepcímke-fertőtlenítés zárt szótárral — KÉSZ**
A zárt szótár megvan (`src/pseudonym.ts:461-475`, `ROLE_VOCABULARY` 50+ elem), és a `sanitizeRoleLabel()` (`:523`) a kimenetet VÁLASZTJA, nem a bemenetet szűri. Élő úton van: `buildContext()` (`:406`) hívja minden személy/szervezet entitásra a `:431`-en, azt pedig `src/app/session.ts:454` hívja az elemzésnél. Futtatott bizonyíték:
```
"tanú (az Aranykalász Agrár Kft. ügyvezetője)" -> "tanú"        | fig: van
"a Vashegyi Malom ügyvezetője"                 -> null          | fig: van
"<script>alert(1)</script>"                    -> null          | fig: van
"II. r. alperes"                               -> "II. r. alperes"
```
A fel nem ismert cégnevet tartalmazó szerep tehát `null`-t ad, és a hívó az adatfajta nevére esik vissza — a szivárgás lezárva. *Megjegyzés:* nincs rá dedikált tesztfájl, csak az általam futtatott ellenőrzés.

**49. Ékezetes útvonal és projektgyökér-takarítás — RÉSZBEN**
- ✅ Takarítás: `find . -name "*.data" -not -path "./node_modules/*"` → **üres**; `find . -name "*temp*.onnx" -o -name "sym_shape*"` → **üres**. A gyökérben már csak 8 fájl van, egy sem modell-szemét. Az 1,3 GB eltűnt.
- ✅ Részleges védőháló: a méretellenőrzés megvan (`src/app/models.ts:210` a `list()`-ben, `:255` és `:286-287` a letöltésnél).
- ❌ **Ellenőrzőösszeg-vizsgálat a kiadási scriptbe: NINCS.** A `SHA256SUMS.json` létezik és be is kerül a telepítőbe (`package.json:102`), de **senki nem olvassa**: `grep -rn "SHA256SUMS"` a node_modules/.modellek/dist kizárásával mindössze 3 találatot ad — `docs/hatralevo-reszletek.json`, `package.json` (a másolási szűrő), és `scripts/export-nytk.py:88`, ami **kiírja**. Sem a `models.ts`, sem a `dist` npm-script nem ellenőrzi. Ez pontosan a „kapcsoló létezik, de nincs olvasója” eset.

**50. Angol nyelvű irat teljes lánca — NINCS KÉSZ (és a felület a rossz irányba mutat)**
Nem csak hogy nincs meg a második nyelvi lánc, hanem a tétel MÁSIK megoldását (a modellista tegye egyértelművé, hogy a program magyar iratokra való) sem választották — a kód épp az ellenkezőjét mondja. `src/app/models.ts:81` a magyar modell `caveat`-jában szó szerint ez áll: *„Kizárólag magyarul tud; angol irathoz válts a többnyelvű modellre."* A többnyelvű modell leírása (`:98-100`) 24 európai nyelvet hirdet, a `caveat`-ja (`:102-105`) egy szót sem szól arról, hogy a felismerés UTÁN minden magyar (álnévkészlet, ragozás, szerep- és adatfajta-címkék). A felület pedig kiírja a `nyelvek: hu, en, de, fr…` sort (`ui/src/settings.tsx:505`) minden ellenjavallat nélkül. Egyetlen enyhítés a README-ben van (`README.md:42-44`: „A csere és a ragozás egyelőre magyar iratra van hangolva") — a programban sehol.

**51. OCR — HALASZTVA (szándékosan), a kiváltó viselkedés KÉSZ**
OCR nincs, és nem is kellett. Amit a tétel elfogadható viselkedésként megkövetel (a 35. pont szerinti korai, egyértelmű figyelmeztetés), az kész és be van kötve: `src/app/session.ts:338` állítja a `looksScanned`-et, `ui/src/App.tsx:242-244` **rögtön a megnyitás után, a Felek-párbeszéd ELŐTT** nyitja a `scanned` dialógust (`return`-nel megszakítva a folyamatot), a `ScannedDialog` (`ui/src/dialogs.tsx:725-765`) pedig kimondja, hogy „A képfelismerés (OCR) még nem készült el", és másik irat megnyitását ajánlja. A tételben említett beágyazott képek (20.) is jelentve vannak: `src/docx/parts.ts:139` és `src/docx/media.ts:5`.

**52. XLSX-támogatás — HALASZTVA (szándékosan), a hangos elutasítás KÉSZ**
XLSX-feldolgozás nincs, ahogy tervezve volt. Helyette a `formatumGond()` felismeri a ZIP-en belüli `xl/` jelet és jogásznak szóló mondattal utasít el (`src/app/session.ts:1242-1245`: *„Ez egy Excel-táblázat… így viszont nem is minősítheti tévesen tisztának."*), ez a `test/formatum-tests.ts` 28/28-as futásának része. A DOCX-be ÁGYAZOTT xlsx viszont már ma feldolgozásra kerül (`src/docx/parts.ts:171-186`, `embeddedPackages` + `isOoxmlPackage` rekurzívan).

---

**Összesítés:** KÉSZ: 43, 44, 45, 46, 48. HALASZTVA a kiváltó viselkedéssel: 51, 52. RÉSZBEN: 47, 49. NINCS KÉSZ: 50.

**A három valódi hiány, sorrendben:**
1. **50.** — a program aktívan a többnyelvű modellre küldi a felhasználót angol irathoz (`src/app/models.ts:81`), miközben a csere magyar álnevekkel és magyar címkékkel dolgozna. Ez a legkockázatosabb a háromból, mert nem hiányzik, hanem téveszt.
2. **49b.** — a `SHA256SUMS.json` generálódik és szállítódik, de nulla olvasója van.
3. **47a/b.** — rendszám, KASZ és irodacím: érintetlen, egy sor kód sincs rá.

`npx tsc --noEmit` → hibátlan; `test/formatum-tests.ts` 28/28; `test/anyja-neve.ts` 5/5.