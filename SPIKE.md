# Spike-eredmények — 2026-08-25

A [felmérés](docs/felmeres.html) két kockázatot nevezett meg, amelyek eldöntik,
van-e értelme megépíteni a terméket. Mindkettőre külön spike készült. **Mindkettő
átment.**

```bash
npm install
npm test        # morfológiai arany-készlet
npm run spike1  # magyar név-illesztés és ragozás
npm run spike2  # PDF: betűtörlés és sor-újraszedés
```

---

## Spike 1 — magyar név-illesztés és ragozás

**Kérdés:** ha az ügyvéd megadja a feleket, megtaláljuk-e az összes ragozott
alakjukat, és tudunk-e a helyükre helyes magyar álnevet írni?

**Döntési szabály volt:** ha a lefedettség nem gyakorlatilag 100%, és a kimenet
nem olvasható tiszta magyarként, nincs értelme továbbmenni.

| Mérés | Eredmény |
|---|---|
| Morfológiai arany-készlet | **330/330 (100%)** |
| Említés-lefedettség 4 dokumentumon | **158/158 (100%)** |
| Bennmaradt eredeti név a kimenetben | **0** |
| Csere-módok (témás / szerep / számozott) | mindhárom 0 szivárgás |

A mérés alapja három valósághű magyar jogi irat (keresetlevél, elsőfokú ítélet,
kölcsönszerződés, összesen ~16 600 karakter), 10 féllel és 142 kézzel annotált
említéssel, plusz egy kézi próbaszöveg.

### Amit a motor kezel

- **Ragozás** 21 esetre, magánhangzó-harmóniával: `Kovács Jánosnak`,
  `Kováccsal`, `Kovácsot`, `Kovácsék`, `Kovácsé`
- **-val/-vel hasonulás** kétjegyű mássalhangzókkal: `Kováccsal`, `Naggyal`,
  `Kodállyal`, `Balázzsal`; eleve kettőzöttnél kötőjellel: `Kiss-sel`, `Papp-pal`
- **Régies írásmódú családnevek** a kiejtés szerint: `Tóthtal`, `Baloghgal`,
  `Móriczcal`, `Babitscsal`, `Marxszal`
- **Hármas betűtorlódás**: `Mann-nak`, `Scott-tól`, `Ivett-től`
- **Asszonynév**: `Kovács Jánosné` külön jogi személy, de a férj álnevéből
  képződik → `Kőszikla Frédné`; a `Kovácsné Fehér Ilona` szerkezet és a
  leánykori név önállóan is (`anyja neve:` rovat)
- **Névelőtag és megszólítás**: `dr. Kovács Jánost`, `Kovács úrnak` — a rag a
  megszólításon marad
- **Monogram**: `K. J.` → az álnév monogramja, `Z. H.`
- **Sortöréssel elválasztott név**: `Ko-\nvács`
- **Csupa nagybetűs alak** aláírásblokkban
- **Névelő-javítás csere után**: `az Aranykalász` → `a Tűzkő`; rövidítéseknél a
  betűnév kiejtése szerint (`az MFB`)
- **Névrészlet e-mail címben**: `kovacs.janos58@freemail.hu` →
  `agyaras.csorba58@freemail.hu` — ékezet nélkül, a számot és a domaint hagyva

### Amit szándékosan NEM cserél

Három kategóriába sorolja a találatokat:

- **automatikus** — magabiztos, alapból cserélődik
- **átnézésre vár** — bizonytalan, emberi döntés kell
- **elutasítva** — nagy valószínűséggel köznév; a „mindent jóváhagyok" sem
  cseréli le

Ez utóbbi védi meg a „**Nagy** a kockázatot vállalta" mondatot attól, hogy a
melléknévből álnév legyen. A szereplőnév-homonimák (Nagy, Kis, Szabó, Molnár,
Fehér, Farkas, Király…) 165 elemű szótárból jönnek.

**Diskurzus-szabály:** ha egy fél teljes neve már szerepelt korábban a
dokumentumban, a későbbi puszta vezetéknév már nem kétes. Ez a legnagyobb tétel
az átnézés idejében — a felmérés szerint ez a termék legvalószínűbb bukási oka.

### A csereszöveg is szivároghat

A valódi mintán kiderült, hogy a szerepleírás maga tartalmazza a fél nevét:
`tanú (az Aranykalász Agrár Kft. ügyvezetője)`. Ha ezt írjuk a név helyére, a
cégnevet éppen visszatettük. A program ezért minden csereszöveget átvizsgál, és
levágja vagy semlegesíti a szennyezett részt — figyelmeztetéssel.

---

## Spike 2 — PDF: valódi betűtörlés és sor-újraszedés

**Kérdés:** ki tudjuk-e venni a név betűit a PDF tartalomfolyamából (nem
ráfesteni, hanem törölni), és a helyére tudunk-e magyar ékezetes álnevet szedni
úgy, hogy egy *másik* könyvtár se találja meg utána az eredetit?

A forrás PDF-et **fejnélküli Chrome** készítette — tehát harmadik fél, valódi
részhalmazolt beágyazott betűkészlettel, nem a saját generátorunk.

| Mérés | Eredmény |
|---|---|
| Fizikailag törölt betűrajzoló utasítás | **3 178** |
| Újraszedett sor | 40 (a 86-ból) |
| Sortörésen átnyúló név | 3 — soronkénti kereséssel nem lennének meg |
| Eredeti névtalálat a kimenetben (pdf.js) | **0** |
| Metaadat-szivárgás | **0** |
| Hiányzó glifa (ő, ű) | nincs |

### A megoldás lényege

1. A tartalomfolyamot tokenizáljuk, és mátrixveremmel követjük a
   koordinátákat — így minden sorról tudjuk a szövegét, az alapvonalát, a
   tényleges betűméretét és a betűit rajzoló utasítások **bájttartományát**.
2. A betűket a ToUnicode táblából olvassuk vissza (a Chrome glifaazonosítókat
   ír a fájlba, nem karaktereket).
3. A találatokat az **egész oldal** szövegére illesztjük, nem soronként — a
   „Hármashatár Ingatlanforgalmazó / Zrt.-vel" a sortörés két oldalán van.
4. Az érintett sorok betűrajzoló utasításait **töröljük** a fájlból.
5. A sort **teljes egészében újraszedjük** saját, ékezetes betűkészlettel.
6. Teljes újraírás, soha nem növekményes mentés — különben a régi tartalom
   ott marad a fájlban.
7. Metaadat (szerző, cím, készítő) törlése.
8. Az ellenőrzés **másik könyvtárral** fut (pdf.js írás helyett pdf-lib), hogy
   ne a saját hibáit igazolja vissza.

### Miért a teljes sort szedjük újra

Bland–Iyer–Levchenko (PETS 2023) kimutatta, hogy a kitakart szöveg
visszafejthető a betűk mikro-elcsúszásaiból: egy Wordből készült PDF-nél a
névkitakarások 38%-a feltörhető. Ha az álnevet az eredeti szélességébe
szorítanánk, ugyanazt az ujjlenyomatot hoznánk vissza. A teljes sor újraszedése
ezt megszünteti — cserébe a sortörés elcsúszhat.

---

## Ismert korlátok

Amit a spike-ok **nem** oldottak meg, és a v1-ben kezelni kell:

1. **Sorkizárás elveszik.** Az újraszedett sorok balra zártak lesznek, az
   eredeti sorkizárt bekezdésekben ez látszik. Megoldható a szóközök arányos
   elosztásával (`Tw` vagy explicit `TJ` eltolás) — a biztonságot nem rontja,
   mert az álnév glifapozíciói attól még nem az eredetiéi.
2. **Csak beágyazott, ToUnicode-táblás betűkészlet.** Ha egy PDF-ben nincs
   ToUnicode, a szöveget nem tudjuk visszaolvasni. Ilyenkor a program nem
   találgat, hanem jelzi, hogy az oldalt nem tudta feldolgozni.
3. **Csak születetten digitális PDF.** Szkennelt irat (OCR) a következő kör.
4. **A tokenizáló a gyakori operátorokra készült.** Word és Acrobat több
   változatot használ; bővíteni kell, és a bővítést mérni.
5. ~~**DOCX még nincs.**~~ **Kész** — lásd a README Word-fejezetét. A csomag
   minden szövegtartó része átvizsgálva, a szövegdoboz mindkét ága átírva,
   metaadat takarítva, a változáskövetés blokkoló döntés. Valódi, Wordben
   készült dokumentumon ellenőrizve; Word javítás nélkül nyitja meg.
6. **A témacsomagok emberi átnézést igényelnek.** Az automatikus nyelvi
   ellenőrzés talált bennük hibát (rossz kötőhangzó, hangzóhiányos tő,
   valós céggel ütköző név); a szűrőket beépítettük, de egy anyanyelvi
   lektorálás nem megspórolható.

## Ami jogilag kötött, és már be van építve

- A kimenet **álnevesített**, nem anonimizált, amíg a kulcs létezik
- Három csere-mód: témás álnév / eljárási szerep (OBH) / adatfajta neve
- Kötelező meghagyási lista (eljáró ügyvéd, bíró, hivatalos közszereplő)
- Kötelező ellenőrző kör a kimeneten, más könyvtárral
- Soha nem fekete csík, soha nem növekményes mentés
