**A szállítást blokkoló hibák (enélkül a program nem használható)**

**1. A magyar nyelvi modell nem kerül bele a telepítőbe, és a felület zsákutcába vezet** — *kicsi*
Mi hiányzik: a `package.json` `extraResources` csak a `data` és `build` mappát másolja, a 440 MB-os `model.onnx`-et nem; a csomagolt buildben a `resources/modellek` nem is létezik (ellenőrzött build). Az alapértelmezett modell `source: 'converted'`, ezért a letöltés kifejezetten hibát dob, a Beállítások lap pedig letöltés gomb helyett a „telepítsd újra a programot” mondatot mutatja — az újratelepítés ugyanezt adja.
Miért számít: pont az alapértelmezett modell hiányzik, tehát a felismerés a gyengébb, csak szerkezeti ágra esik vissza, és a felhasználó tudja, hogy baj van, de semmit nem tud tenni. Két járható út: a modell becsomagolása (vállalva a ~700 MB-os telepítőt vagy külön modelltelepítőt), vagy a `converted` ág letölthetővé tétele.

**2. PDF-et nem lehet megnyitni a telepített programban** — *kicsi*
Mi hiányzik: a `pdf-to-img` a `--external` fordítás miatt futásidejű `require` marad, és devDependencyként nem kerül a csomagba (ellenőrizve: `MODULE_NOT_FOUND` a becsomagolt asar-ból). A `session.ts:716` dinamikus importja ráadásul a `try` blokk ELŐTT áll, így a hiba nem nyelődik el, hanem elszáll a megnyitás.
Miért számít: a jogi iratok fele PDF. Javítás: az import behúzása a try-ba, plusz a `pdf-to-img` és a `@napi-rs/canvas` áthelyezése a `dependencies`-be.

**3. A felek automatikus felismerése soha nem fut le** — *kicsi*
Mi hiányzik: a `doc:detectParties` IPC-kezelő, a preload-kivezetés, a detect motor és a fogadó felület (találatszám, bizonyítékszöveg, keepList-doboz, státuszfigyelő) mind kész, de az `api.detectParties()` sehol nem hívódik meg, a `setDetected` egyszer sem fut le. A megnyitás egyenesen az üres Felek-táblázatra visz.
Miért számít: ez a program legfontosabb kényelmi funkciója — így minden nevet kézzel kell begépelni, a felismerés egész ága elérhetetlen. A hívás mellé kell egy `finally { setBusy(null) }`, különben a státuszfátyol beragad.

**4. A program neve elrontott kódolással jelenik meg mindenhol („Szivecske AnonimizĂˇlĂł”)** — *kicsi*
Mi hiányzik: a `package.json` `productName` mezője kétszeresen kódolt UTF-8 (nyers bájtok: `Anonimiz\xc4\x82\xcb\x87l\xc4\x82\xc5\x82`). Az épített EXE, a telepítő fájlneve, a Start menü, az asztali parancsikon, a Programok és szolgáltatások lista és a verzióerőforrás mind ezt kapja.
Miért számít: ez az első, amit a felhasználó lát, még indítás előtt. Következmény az is, hogy az alapértelmezett telepítési útvonal nem-ASCII lesz, ami fölöslegesen kockáztatja a modellbetöltést.

**5. A munka figyelmeztetés nélkül elveszik** — *közepes*
Mi hiányzik: nincs `Menu.setApplicationMenu()`, ezért az angol Electron-alapmenü gyorsbillentyűi élnek — a Ctrl+R újratölti a renderert és eldobja a megnyitott iratot, a felvitt feleket és minden egyenkénti döntést. Nincs `win.on('close')`, nincs `beforeunload`, és a „Másik irat” gomb is kérdés nélkül nulláz. A várt Ctrl+O / Ctrl+S nem létezik.
Miért számít: órányi átnézés vész el egyetlen billentyűre vagy egy X-re, visszaút nélkül.

**6. Nyers, angol fejlesztői hibaüzenetek jutnak ki a felhasználóhoz** — *közepes*
Mi hiányzik: nincs hibaüzenet-fordító réteg, minden hiba nyers `Error.message`-ként jelenik meg, az Electron `Error invoking remote method 'doc:open': …` előtaggal. Az alatta lévő szövegek fejlesztőknek szólnak (`<w:del>` blokkok, `resolveRevisions()` hívás, pdf-lib angol üzenete jelszavas PDF-nél, nyers fetch-hiba). A saját „Megszakítás” gomb `AbortError`-ja is piros hibadobozként landol egy sikeres, szándékos művelet után.
Miért számít: a felhasználó nem tudja eldönteni, hogy elrontott valamit, vagy a program hibás.

**7. Nincs kiadási npm script — a telepítő elavult kódot csomagolhat** — *kicsi*
Mi hiányzik: egyik script sem hívja az electron-buildert, a README puszta `npx electron-builder`-t ír. A csomagolás a lemezen talált korábbi fordítást viszi el újrafordítás nélkül (a saját futtatásomnál is ez történt).
Miért számít: a `start` script már ma is lefuttatja mind a négy fordítási lépést — egy `dist` script, ami ugyanezt teszi, majd hívja a buildert, megszünteti a kockázatot.

**8. Az EXE gyártója „GitHub, Inc.”** — *kicsi*
Mi hiányzik: nincs `author` a `package.json`-ban (az electron-builder minden futásnál figyelmeztet rá), ezért a `CompanyName` az Electron alapértékét örökli, a `LegalCopyright` pedig ebből származik.
Miért számít: a fájl tulajdonságainál és a SmartScreen-ablakban idegen cég neve jelenik meg. A `license` mezőt érdemes egyszerre rendezni a Névjegy szakasszal.

**9. Nincs kódaláírás — a SmartScreen letiltja az első indítást** — *közepes (részben beszerzés)*
Mi hiányzik: sem az EXE, sem a telepítő nincs aláírva (`Get-AuthenticodeSignature` → `NotSigned`), a `build.win` csak `target`-et és `icon`-t tartalmaz.
Miért számít: nem műszaki felhasználó pont ezen a ponton adja fel. Opciók: Azure Trusted Signing, OV tanúsítvány hardveres tokenen, vagy aláírás nélküli szállítás dokumentált, képernyőképes kézi lépéssel („További információ → Futtatás mindenképp”).

**Valódi kitakarási hiányok — itt maradhat bent személyes adat**

**10. A jegyzőkönyv titkosítatlanul a kimenet mellé írja a teljes ki-kicsoda táblát** — *kicsi*
Mi hiányzik: minden mentéskor, feltétel nélkül elkészül a `<kimenet>-jegyzokonyv.txt`, benne a SZEREPLAP soronkénti `eredeti név → álnév` párokkal. Akkor is, ha a felhasználó kikapcsolta a kulcsfájlt — a fájl ekkor a saját fejlécében írja, hogy „Kulcsfájl: nem készült (visszafordíthatatlan)”, tizenkét sorral a teljes visszafejtő tábla fölött. Létezés-ellenőrzés nélkül felülír, a felület pedig meg sem említi (a `certPath` vissza sem jut a felülethez).
Miért számít: ez ugyanaz a tábla, amit a kulcsfájl scrypt+AES-256-GCM-mel titkosít, kitalálható néven, az anonimizált irat mellett. Ha a felhasználó kiküldi a mappát, mindent kiküldött. Javítás: a szereplap kivétele a jegyzőkönyvből (csak darabszámok), vagy áttétele a titkosított kulcsfájlba.

**11. Az ellenőrző kör a saját szándékszövegét igazolja vissza, a felület mégis „a kész fájlt” állítja** — *közepes*
Mi hiányzik: a `verifyOutput` minden formátumnál a memóriabeli, általunk előállított szöveget kapja, nem a lemezre írt fájlt. Ha egy szöveghelyet nem láttunk (Form XObject, jegyzet, XMP, kép), az a szándékszövegben sincs benne, tehát az ellenőrzés ott definíció szerint nem tud megbukni. Ráadásul a `writeFileSync` az ellenőrzés ELŐTT fut, tehát a fájl akkor is a lemezen marad, ha szivárgást találunk — pedig a `verify.ts` fejléce azt írja, ilyenkor tiltjuk az exportot.
Miért számít: a felhasználónak megjelenő mondat — „Visszaolvastuk a mentett fájlt… egyetlen eredeti név sem maradt benne, sem a szövegben, sem a metaadatban” — hitelesítésként olvasódik, és nem igaz. Vagy vezessük be a PDF visszaparse-olását, vagy azonnal igazítsuk a felületi szöveget a valósághoz. A DOCX-oldal bájtszintű `findResidue`-ja mutatja a helyes mintát.

**12. Nincs semmilyen számformátumú azonosító-felismerés** — *nagy*
Mi hiányzik: a program egyetlen azonosító-mintája egy e-mail/URL regex, és az is csak névtöredéket keres bennük. Teljesen kezeletlen: adóazonosító jel, TAJ-szám, bankszámlaszám, IBAN, adószám, cégjegyzékszám, helyrajzi szám, lakcím (házszám, emelet, ajtó), irányítószám, telefonszám, személyazonosító igazolvány és jogosítvány száma, bírósági ügyszám.
Miért számít: a mintairatokban ezek mind ott vannak, és mind változatlanul átmennek a kimeneten. A településnév cseréje önmagában semmit nem ér, ha az irányítószám és a hrsz. bent marad — egyetlen ügyszámból pedig az egész per visszakereshető. Fontos csapda: az ellenőrzőszám ne szűrő legyen, hanem megbízhatósági pont, mert a saját mintairatok azonosítóinak többsége érvénytelen ellenőrzőszámú (a 8442130976 adóazonosító, a 24817350-2-13 adószám és a HU42… IBAN is), tehát kemény kapuval a program a saját tesztadatait sem találná meg. Erősebb jel a címke-kontextus („adóazonosító jel:”, „TAJ szám:”). A hrsz-mintát a településnévvel egyben kell felvenni, a helynév-találat előtt, különben a lefedettségi logika eldobja.

**13. Az adatmodell nem ismer „azonosító” adatfajtát** — *közepes, a 12. pont előfeltétele*
Mi hiányzik: az `EntityKind` háromértékű (`person | org | place`), az `EntityLabel` négyértékű, a `TYPE_LABEL` tábla is három bejegyzés. Nincs hova betenni egy adószámot vagy lakcímet.
Miért számít: emiatt a saját dokumentációjában szereplő `[lakcím]` címke szerkezetileg nem állítható elő, vagyis az OBH 4/2021 §10(2) szerinti adatfajta-megjelölés hiányos. Ez típusszintű változtatás a teljes láncon (PartyInput, SeedEntity, számozott mód címkéi), nem egy regex hozzáadása.

**14. Az ellenőrző kör vak a számokra** — *közepes*
Mi hiányzik: a `verify.ts` egyetlen felszíni mintája nagybetűvel kezdődő, legalább három betűs szavakra illeszkedik; a betűosztályban nincs számjegy. Egy bent maradt adóazonosító, IBAN vagy ügyszám nem is jelöltként bukik el, hanem sosem kerül a keresés látókörébe.
Miért számít: a jegyzőkönyv ilyenkor szó szerint „tiszta” minősítést ír. Az azonosító-felismerés (12.) önmagában nem elég, ha az ellenőrzés utána nem látja ugyanazokat.

**15. Az összeg- és dátumcsere kapcsolója mögött nincs kód** — *nagy*
Mi hiányzik: a `replaceAmounts` és `shiftDates` definiálva, validálva, elmentve, visszaolvasva és a felületen magyarázó szöveggel megjelenítve van — de a motorban nulla olvasójuk van. Sem összeg-, sem dátumkezelő logika nincs a kódban, az `ExportOptions` típusban sincs ilyen mező, és a dátumeltoláshoz a kulcsfájl formátumát is bővíteni kellene (a `KeyPayload` ma csak `created` és `entries` mezőt tartalmaz).
Miért számít: ez az egyetlen tétel a listán, ami aktívan téveszt. A megbízásban kimondott kérés volt, a jogász bekapcsolja, a pipa marad, semmi nem történik, és kiadja az iratot a valódi összegekkel és születési dátumokkal. Sürgős döntés kell: vagy azonnal le kell tiltani a kapcsolókat „hamarosan” felirattal (egy órás munka, azonnal megszünteti a megtévesztést), vagy meg kell írni a funkciót (hetes nagyságrend).

**16. A PDF Form XObjectjeibe a program soha nem lép be** — *nagy*
Mi hiányzik: az `extractTextSegments` nem kezeli a `Do` operátort, és a lapfeldolgozó csak a `Contents`-t adja át, az `/XObject` erőforrást nem (a `baseCtm` paraméter mutatja, hogy a rekurzió terve megvolt).
Miért számít: fejléc, lábléc, iratsablon, bélyegző, aláírásblokk — sok generátornál a törzs egy része — Form XObjectbe kerül. Az ott lévő név nem jut a lapos szövegbe, nem lesz találat, nem törlődik, és mivel az ellenőrzés is a mi kimenetünkön fut, semmi nem jelez. Minimum egy hangos figyelmeztetés kell, ha az oldal `Do`-t tartalmaz.

**17. A PDF-mentés csak az Info szótárat tisztítja** — *közepes*
Mi hiányzik: a hat `doc.set*()` hívás a pdf-lib-ben kizárólag az /Info szótárat írja; a katalógus /Metadata XMP-csomagja érintetlen marad, benne a `dc:creator`, `xmp:CreatorTool`, gyakran az eredeti fájlútvonal a Windows-felhasználónévvel. Ugyanígy érintetlen a `/Annots` (jegyzetszerző, jegyzetszöveg), az AcroForm mezőértékek, a `/Names /EmbeddedFiles` mellékletek és az `/Outlines` könyvjelzőcímek.
Miért számít: a DOCX-oldalon ez a hibaosztály végig van gondolva, a PDF-oldalon nincs — pedig a metaadat-ígéret a felületen mindkét formátumra elhangzik.

**18. A DOCX bájtszintű maradványvizsgálat kikapcsol, ha egyetlen találat eldöntetlen** — *közepes*
Mi hiányzik: a tiltott alakok listája csak akkor telik meg, ha nincs eldöntetlen találat, üres listánál pedig a `findResidue` el sem indul — ez a függvény egyetlen éles hívási helye.
Miért számít: a rejtett ágakban (szövegdoboz `mc:Fallback`, beágyazott objektum, régi bináris rész UTF-16LE-ben) bennmaradt név egyetlen elkapó mechanizmusa épp a leggyakoribb valós helyzetben, a félkész átnézésnél van kikapcsolva. Helyette azokat a felszíni alakokat kell tiltani, amikhez ténylegesen tartozik elfogadott csere.

**19. Hiányzó DOCX attribútum-hordozók** — *közepes*
Mi hiányzik: az attribútumtérkép négy elemet ismer (`wp:docPr`, `pic:cNvPr`, `v:textpath`, `w:comment`). Kezeletlen: `w:fldSimple/@w:instr` (az egyszerű mezőkód attribútumban áll, a mezőkód-kezelés csak elemekre néz), `w:bookmarkStart/@w:name` (a Word a címsor szövegéből gyártja), `w:hyperlink/@w:tooltip`, `w:tblCaption` és `w:tblDescription`, a `wp:docPr/@name`, valamint a VML `v:shape/@alt` és `o:title`.
Miért számít: egyik sem látszik a Wordben, kicsomagolva mind olvasható, és magyar jogi iratokban rendszeresen név van bennük.

**20. A DOCX-be ágyazott képekről se figyelmeztetés, se EXIF-tisztítás** — *kicsi*
Mi hiányzik: a `word/media/` alá eső részek megjegyzés nélküli `media` besorolást kapnak, és nem esnek az ismeretlen részek gyűjtője alá sem, tehát a felhasználó egyetlen sort sem lát róluk. EXIF-kezelés sehol nincs.
Miért számít: a beszkennelt aláírás, a fényképezett tanúsítvány vagy egy képernyőkép ugyanúgy tartalmazza a nevet, a JPEG EXIF-je pedig szerzőt, gépnevet és GPS-t. Ugyanez az érv, ami miatt a `docProps/thumbnail`-t helyesen töröljük. OCR nélkül legalább egy hangos figyelmeztetés és EXIF-törlés kell.

**21. ToUnicode nélküli PDF-betűkészletnél némán eltűnik a szöveg** — *közepes*
Mi hiányzik: a rajzolási lépés kimarad, ha a betűkészletnek nincs cmap-je, és a hiányzó kód üres karakterlánccal pótlódik — részhalmazolt betűkészletnél a „Kovács János”-ból „Kovcs Jnos” lesz, amire a matcher soha nem illeszkedik. A kihagyások sehol nem számítódnak, a PDF-ág figyelmeztetési csatornája a felület felé teljesen üres, a `looksScanned` heurisztika pedig csak a teljesen olvashatatlan PDF-et fogja meg.
Miért számít: a program azt jelenti, hogy nem talált nevet, miközben nem is látta a szöveget.

**22. A kézi fedőnév csak fedőnév-módban él, de a jegyzőkönyv és a kulcsfájl a kézi értéket rögzíti** — *közepes*
Mi hiányzik: a `role`, `type` és `numbered` ág egyike sem olvassa a kézi értéket, viszont a szereplap és a titkosított kulcsfájl egyaránt azt írja le.
Miért számít: nem csak felületi következetlenség — a jegyzőkönyv és a kulcsfájl olyan megfeleltetést állít, ami a kimeneti iratban nem szerepel, tehát a későbbi visszafejtés hibás lesz. A felület közben minden módban kiírja a „kézi” jelölést.

**23. A megtartandó névlista nem jut el az ellenőrzéshez, a maradványlista 40-nél némán csonkul** — *kicsi*
Mi hiányzik: a `verifyOutput` hívása nem kapja meg a keepListet és a biztonságos szavakat, pedig a fogadóoldal támogatja. A maradványlista 40 elemnél levágódik, és mivel a felületen látható szám a levágás után keletkezik, a csonkolás sem derül ki. A mondatkezdet-heurisztika a „dr.” utáni pontot mondatvégnek nézi, ezért a bíró vezetéknevét átugorja, a keresztnevét viszont maradványként jelenti.
Miért számít: az eljáró ügyvéd és bíró neve jogszerűen marad bent, mégis riasztásként jelenik meg — a zaj miatt a valódi találatokat is átugorja a felhasználó.

**24. A modell hibája csendben szabályalapú felismerésre esik vissza** — *kicsi*
Mi hiányzik: a betöltési vagy futtatási hiba csak egy `modelNote` szöveget hagy maga után, a folyamat változatlanul fut tovább, és a `modelUsed` jelző a „modell nincs letöltve” esettel megkülönböztethetetlenné teszi. A jelzés egyetlen helyen jelenik meg (a fél-jóváhagyó ablakban, semleges szürke dobozban), és sem az exportgombig, sem a jegyzőkönyvig nem jut el.
Miért számít: a modell a felismerés motorja — nélküle csak a szerkezeti minták találnak feleket, a szövegben elszórt nevek java fedezetlen marad. Ez megállító esemény, nem lábjegyzet.

**25. A modell nem értelmezett találatai némán eldobódnak** — *közepes*
Mi hiányzik: ha a nyers címkéhez nincs bejegyzés a `labelMap`-ben, a találat naplózás és számláló nélkül eltűnik — mindkét futtatóban. A többnyelvű modell leírása viszont összegeket, dátumokat és azonosítókat ígér, miközben a térképe hét név-jellegű címkét tartalmaz. Négy helyen kellene változtatni (EntityLabel, labelMap, két kinyerő, majd a detect, ahol az `other` címke azonnal eldobódik és minden nem-person/org címke `place`-re kényszerül).
Miért számít: vagy a felületen kell összesítést adni („a modell N találatát nem tudtuk értelmezni”), vagy a modell leírásából kell kivenni a nem támogatott adatfajtákat — a jelenlegi állapot ígér valamit, amit a kód eldob.

**26. A Bszi. 166. § (2) szerepfelismerés hiányos** — *közepes*
Mi hiányzik: az ülnökre nincs jelöltminta (a mintázat „dr.” előtagot vár), így a nyelvi modell hozza be félként, és mivel nincs a megtartandó listán, lecseréljük. A minta csak a „név, majd szerep” sorrendet ismeri, ezért a „A tanács elnöke: …” alak kimarad (csak az egybeírt „tanácselnök” szerepel a szókincsben).
Miért számít: aki nincs a megtartandó listán, az félként álnevet kap — az ülnök és a szétírt szerepmegjelölésű tanácselnök neve tehát hibásan cserélődik.

**27. A kulcsfájl üres jelszót is elfogad a magban** — *kicsi*
Mi hiányzik: az export üres karakterláncot ad tovább, ha nincs jelszó, és a `writeKeyFile` ezt validálás nélkül engedi a `scryptSync`-be. A 8 karakteres minimumot kizárólag a React gomb `disabled` feltétele érvényesíti, a bizalmi határ rossz oldalán; az IPC-kezelő tetszőleges `ExportOptions`-t elfogad.
Miért számít: a kulcsfájl formálisan AES-256-GCM-mel titkosított, valójában bárki kinyithatja. A `writeKeyFile`-nak (és a `readKeyFile`-nak) magának kell megtagadnia a rövid vagy üres jelszót.

**28. Az e-mail-cím csak akkor kerül elő, ha egy fél neve van benne** — *kicsi*
Mi hiányzik: az e-mail nem önálló azonosítóként ismerődik fel, csak névtöredék-egyezés alapján. A négy betűs alsó korlát miatt a három betűs magyar vezetéknevek (Kis, Tar, Bán, Vas, Tót, Kun) soha nem kerülnek a töredéklistába.
Miért számít: az iroda- és harmadik személyes e-mail-címek (`iroda@…ugyved.hu`) érintetlenül maradnak, a rövid vezetéknevek pedig az ékezettelen keresésből is kiesnek — ez a küszöb önmagában is szivárgás.

**29. A mentéskori figyelmeztetések nem jutnak el a felhasználóhoz** — *kicsi*
Mi hiányzik: a beágyazott objektumokról és az ismeretlen dokumentumrészekről szóló figyelmeztetés csak az elemzés eredményén keresztül jön ki, az `ExportResult`-ban nincs `warnings` mező.
Miért számít: a figyelmeztetés csak akkor bukkanna fel, ha a felhasználó a mentés után ugyanabban a munkamenetben újra lefuttatja az elemzést — a mentés utáni „az irat tiszta” ablak sosem mutatja.

**A felület hiányai**

**30. A mentett alapértelmezések nem érvényesülnek induláskor** — *kicsi*
Mi hiányzik: az App bedrótozott kezdőértékkel indul, és soha nem hívja a beállítások lekérdezését; a téma és a mód csak akkor frissül, ha a felhasználó ugyanabban a munkamenetben megnyitja a Beállításokat. A kulcsfájl-kapcsoló ennél is rosszabb: az export-ablak bedrótozott értékkel indul, és a beállítás-visszahívás sem adja át — ez a kapcsoló még abban a munkamenetben sem hat, amelyikben átállították.
Miért számít: a Beállítások ablak látszólag működik, valójában négy vezérlője nem hat semmire.

**31. Az „Automatikus csere küszöbe” csúszka nem csinál semmit** — *kicsi*
Mi hiányzik: a küszöb modulszintű konstans, amit a matcher három helyen használ; a csúszka értéke soha nem jut el a motorhoz. Nem elég átadni a matchernek: a döntésfüggvényt és a magabiztosság-emelő ágat is példányszintű állapotra kell vinni, és a beállítást az elemzés bemenetén kell átjuttatni — ugyanaz a csatorna, ami az összeg- és dátumcseréhez is kell.
Miért számít: a felhasználó azt hiszi, szigorít vagy lazít, közben mindig 0,8-cel dolgozik a program.

**32. Új irat megnyitásakor bent maradnak az előző ügy felei** — *kicsi*
Mi hiányzik: a megnyitás nullázza az elemzést, a döntéseket és a kijelölést, de a felek listáját nem, ezért a második irat a Felek-ablakban az ELŐZŐ ügy valódi neveivel nyílik. Az ügyazonosító titok setter nélküli, tehát a program indulásakor egyszer képződik, és minden iratra ugyanaz.
Miért számít: az egyik ügy nevei átszivárognak a másik munkamenetébe, és két különböző ügyben ugyanaz a valódi név ugyanazt az álnevet kapja — a kiosztások korrelálnak. Egy ügy több iratára ez kívánatos; a hiba az, hogy nincs mód új ügyet kezdeni.

**33. Nincs képernyő a kulcsfájl visszafejtésére, és a kulcs útvonalát sem írja ki a program** — *nagy*
Mi hiányzik: a visszafejtő függvény kész és működik, de a programon belül semmi nem hívja — nincs IPC-csatorna, preload-metódus, gomb vagy menüpont. A `.szkulcs` fájl a felhasználó számára megnyithatatlan. Az eredményképernyő a kulcs útvonalát csak logikai feltételként használja, sosem írja ki, a „Mappa megnyitása” gomb pedig a kimeneti iratot mutatja.
Miért számít: a felület azt ígéri, „ezzel később vissza tudod nézni, ki kicsoda volt” — ez ma nem teljesíthető.

**34. A „Gyanús maradvány átnézésre: N” szám zsákutca** — *kicsi*
Mi hiányzik: a motor legfeljebb 40 tételt átad `surface` és `detail` mezővel, pontosan úgy, ahogy a szivárgáslistát, amit a felület pár sorral feljebb ki is rajzol — a maradványokból viszont csak a darabszám jelenik meg, és nincs gomb, amivel elő lehetne hozni őket.
Miért számít: a „7 gyanús maradvány” szám önmagában használhatatlan: vagy megnézi őket a jogász, vagy nem meri kiadni az iratot.

**35. A szkennelt PDF csak a folyamat legvégén derül ki** — *kicsi*
Mi hiányzik: a szkennelt-jelzés és a betöltési figyelmeztetések már megnyitáskor eldőlnek és eljutnak a felülethez, de csak az elemzés UTÁN jelennek meg — a szkennelt-jelzés az állapotsor vékony narancssárga szövegében, a figyelmeztetések a Szereplap egyik fülén.
Miért számít: a felhasználó előbb végigmegy a Felek-párbeszéden és begépeli a neveket, mielőtt megtudná, hogy az iratból nincs mit kiolvasni. Mivel az OCR szándékosan későbbre került, ez az eset elő fog fordulni, és már megnyitáskor egyértelmű ablakkal kell közölni.

**36. A behúzott fájl nem nyílik meg, az ablakra ejtve pedig elnavigál a program** — *kicsi*
Mi hiányzik: az ejtőmező figyelmen kívül hagyja a behúzott fájlt, és csak a tallózó ablakot nyitja meg. Nincs ablakszintű `dragover`/`drop` védelem és nincs `will-navigate` kapu a főfolyamatban.
Miért számít: ha a fájl az ejtőmezőn kívül ér földet — megnyitott iratnál a mező nem is létezik —, a Chromium elnavigálja az ablakot a `file://` URL-re, és menü híján nincs mivel visszamenni.

**37. A változáskövetés-párbeszéd „Mégse” gombja zsákutcába enged** — *kicsi*
Mi hiányzik: a párbeszéd kimondja, hogy „amíg ez fennáll, nem mentünk”, de a Mégse bezárja az ablakot, és utána semmi nem tiltja a mentést — a „Mentés másként” gomb nem nézi a nyitott változásokat.
Miért számít: a felhasználó felviszi a feleket, végigrágja a találatokat, jelszót ad a kulcsfájlhoz, kiválasztja a fájlnevet, és csak ekkor kap egy fejlesztőknek szóló hibaüzenetet. A blokkoló állapotot a felületnek kell fenntartania (letiltott gomb, látható figyelmeztetés a lépéssávban).

**38. Nincs előnézet az álnevesített iratról, és nincs nyomtatás** — *közepes*
Mi hiányzik: az anonimizált szöveg előállítása kész és ki is van vezetve a hídon, de a felület soha nem hívja meg. Amit a szövegnézet mutat, az az EREDETI szöveg kiemelésekkel, nem az eredmény. Nyomtatás sehol nincs — se menüpont, se gomb, se Ctrl+P.
Miért számít: a felhasználó a mentés pillanatáig nem látja, mi lesz a kimenet.

**39. A mentés folyamatjelzője már akkor pörög, amikor a program a fájlnevet várja** — *kicsi*
Mi hiányzik: a „Mentés és ellenőrzés…” fátyol a natív mentés-ablak megnyitása ELŐTT áll be.
Miért számít: a felhasználó azt hiszi, dolgozik a program, közben az őrá vár. A fátylat a fájlnév megadása után kell beállítani.

**40. Nincs verziószám és névjegy sehol a felületen** — *kicsi*
Mi hiányzik: sem verziómegjelenítés, sem a betöltött modell azonosítója és állapota nem látszik.
Miért számít: hibajelentésnél nem elég tudni, melyik programverzió fut — azt is tudni kell, melyik háló, mert a betöltő csendben a 8 bites változatra esik vissza, ha a pontos fájl nincs a gépen, és a mérés szerint az elveszít egy csupa nagybetűs aláírásban álló személynevet. Ugyanaz az IPC-hívás kiszolgálja az indulási modell-ellenőrzést is.

**41. A Beállítások ablak kilóg a többi közül** — *kicsi*
Mi hiányzik: nem a közös átfedő réteget használja, ezért az Esc nem zárja; a két betöltő hívás `.catch()` nélküli, tehát hibánál a fül némán, üresen jelenik meg; a modelltörlés try/catch nélküli, hibánál a gombra szó szerint nem történik semmi.
Miért számít: következetlen viselkedés és néma hibák a program egyetlen konfigurációs felületén.

**42. Magyar helyesírási és tipográfiai hibák a legfontosabb képernyőkön** — *kicsi*
Mi hiányzik: a mentés utáni cím tautologikus („Elkészült, de maradt bennmaradt név”). A felhasználónak megjelenő szövegekben 11 nyitó magyar idézőjel áll és nulla helyes záró — mindegyik ASCII egyenes idézőjellel zárul.
Miért számít: ez az utolsó, amit a felhasználó lát; a fejlesztői helyettesítő fájl egyébként helyes párt használ, tehát következetlenségről van szó, nem döntésről.

**Jó-lenne és kifejezetten későbbre tett tételek**

**43. Windows-integrációs apróságok: `setAppUserModelId`, egypéldányos zár, telepítőnyelv, parancsikonnév** — *kicsi*
Mi hiányzik: nincs alkalmazásazonosító beállítás (pedig az `appId` már megvan a build-konfigban), és nincs single-instance zár. A telepítőnél a `language: "1038"` csak a verzióerőforrás nyelvi kódját állítja, a telepítő nyelvét nem — ahhoz `installerLanguages: ["hu_HU"]` kell; `shortcutName` nélkül a parancsikon a hibás programnevet örökli.
Miért számít: az alkalmazásazonosító köti össze a tálcaikont a Start menü parancsikonnal — pont a kért szivecskés tálcaikon működéséhez kell. Két párhuzamos példány nem korrumpálja a beállításfájlt, de a felhasználó beállításai csendben visszaállhatnak.

**44. 1,1 GB telepített méret modell nélkül** — *közepes*
Mi hiányzik: a fájlszűrő nem allowlistként hat, ezért a csomagba kerül a Linux és macOS ONNX futtató (151 MB), egy második, teljes ONNX-példány a transformers csomag alatt (212 MB), a sharp (19 MB), és egy 37 MB-os canvas, amit már semmi nem használ, mert a `pdf-to-img` épp kimaradt. A helyes eszköz a kizárás, plusz az `overrides` az egyetlen ONNX-példányra; ~250 MB megtakarítás reális.
Miért számít: a kész telepítő már ma 264 MB, a modell hozzáadásával jóval nagyobb lesz — a másolás és a letöltés is nehezebb.

**45. A `parties:suggest` csonk törlése** — *kicsi*
Mi hiányzik: a kezelő mindkét ágon üres listát ad, ki van vezetve a preload-on és az api-típuson, de senki nem hívja.
Miért számít: a `doc:detectParties` már ma is elvégzi ugyanezt a munkát, jobban. A helyes lépés a törlés, nem a kitöltés — így nem látszik meglévő funkciónak.

**46. Minden nem .pdf és nem .docx fájl bájtaláírás-ellenőrzés nélkül olvasódik UTF-8-ként** — *kicsi*
Mi hiányzik: a formátum pusztán a kiterjesztésből dől el, minden más a szöveges ágra esik. Egy .doc, .rtf vagy .odt fájl esetén ez értelmezhetetlen kacatot ad, a program viszont végigmegy a folyamaton, 0 találattal és „tiszta” ellenőrzéssel.
Miért számít: a DOCX-ág helyesen, hangosan száll el rossz bemenetnél — ugyanezt kell tennie a szöveges ágnak is (`D0CF11E0`, `{\rtf`, `PK` aláírás-ellenőrzéssel). A megnyitó párbeszéd szűrői nem védenek, mert a felhasználó begépelhet tetszőleges fájlnevet.

**47. További, alacsony prioritású azonosító-minták és rovatváltozatok** — *kicsi*
Mi hiányzik: rendszám (a mintairatokban nem is fordul elő, tisztán jövőbeli lefedettség), ügyvédi kamarai azonosító és irodacím (itt a megtartás a valószínűleg helyes válasz — a tétel inkább láthatóság: jelenjenek meg tudatosan meghagyottként), valamint az „anyja neve” felismerés kettőspont nélküli és rövidített változatai („anyja születési neve”, „an.:”, „a. n.:”, táblázatcellás alak).
Miért számít: az „anyja neve” rovat esetén a védőháló a nyelvi modell, de a SZEREP elveszik — ez az egyik legérzékenyebb adat, nem szabad az „egyéb” kategóriára bízni.

**48. A szerepcímke-fertőtlenítés csak a felismert felek nevére néz** — *közepes*
Mi hiányzik: a szerepcímke ellenőrzése nem szűri a nem-entitás neveket, tehát egy fel nem ismert cégnév változatlanul csereszöveggé válhat.
Miért számít: a szállított felületen ma nem érhető el (a szerep zárt legördülőből vagy zárt szókincsből jön), de a típus szabad szöveg és az IPC nem validál — védelmi mélység a jövőbeli kötegelt módhoz. Zárt szótár a helyes megoldás.

**49. Ékezetes útvonal és a projektgyökér kitakarítása** — *kicsi*
Mi hiányzik: a jelenlegi, egyetlen fájlból álló modell ékezetes útvonalról is betölt (mérve), de külső-adatos ONNX-nél az útvonal elromlik (mérve: az „á” és „é” kérdőjellé torzul a hibaüzenetben). A projektgyökérben ott felejtett három `.data` fájl és egy ideiglenes ONNX 1,3 GB szemetet jelent.
Miért számít: preventív tétel — a részleges védőháló (méretellenőrzés) ma is elkapná az esetet, és a hibás telepítési útvonalat a 4. pont javítása megszünteti. A kiadási scriptbe érdemes egy ellenőrzőösszeg-vizsgálatot tenni.

**50. Angol nyelvű irat teljes lánca** — *nagy, későbbre*
Mi hiányzik: a modellista sugallja a többnyelvű használatot, és a modell fel is ismerné az angol neveket, de a felismerés UTÁN törik el a lánc: kötött magyar névsorrend, kizárólag magyar álnévkészletek, magyar ragozás, magyar szerep- és cégformaszótár, magyar adatfajta-címkék.
Miért számít: a kimenet magyar álnevekkel és magyar címkékkel jönne ki angol szövegbe. Vagy meg kell írni a második nyelvi láncot, vagy a modellistából egyértelművé kell tenni, hogy a program magyar iratokra való.

**51. OCR a szkennelt PDF-ekhez** — *nagy, kifejezetten későbbre halasztva*
Mi hiányzik: képként tárolt szöveg felismerése; jelenleg az ilyen irat feldolgozhatatlan.
Miért számít: amíg nincs, a 35. pont szerinti korai, egyértelmű figyelmeztetés az egyetlen elfogadható viselkedés — és a beágyazott képek (20.) ugyanebbe a hézagba esnek.

**52. XLSX-támogatás** — *nagy, kifejezetten későbbre halasztva*
Mi hiányzik: táblázatos mellékletek (követeléslisták, kimutatások) feldolgozása.
Miért számít: ma az ilyen fájl a szöveges ágra esne (lásd 46.), ezért előbb a hangos elutasítást kell megoldani, hogy senki ne higgye anonimizáltnak.