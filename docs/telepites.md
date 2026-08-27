# Telepítés és az első indítás

A program **nincs digitálisan aláírva**. Ezért a Windows az első indításkor egy kék
ablakkal megállítja. Ez a dokumentum két részből áll: az első a felhasználónak szól
(mit fog látni és mit nyomjon), a második a fejlesztőnek (mibe kerül ezt megszüntetni,
és hova kell a beállítás).

A mérés, ami miatt ez a lap létezik:

```
Get-AuthenticodeSignature "dist\telepito\Szivecske Anonimizáló Setup 0.1.0.exe"
  Status : NotSigned

Get-AuthenticodeSignature "dist\telepito\win-unpacked\Szivecske Anonimizáló.exe"
  Status : NotSigned
```

---

# 1. rész — A felhasználónak

## Mi fog történni, és miért

A Windows minden internetről érkező programnál megnézi, hogy **ki készítette**. Ezt egy
tanúsítványból olvassa ki, amit a fejlesztőnek pénzért kell megvennie. Ebben a programban
ilyen tanúsítvány nincs, ezért a Windows nem tud válaszolni arra, hogy ki a készítő —
és amíg nem tud, addig megállítja a programot.

**Ez nem vírusjelzés.** A Windows nem talált a fájlban semmi rosszat. Azt mondja, hogy
*nem ismeri fel a készítőt* — ami egészen más állítás. A vírusellenőrzés ettől függetlenül,
külön fut le, és nem szólt.

Ugyanakkor ez egy valódi védelmi lépés, nem formaság. Amit alább leírok, az kikapcsolja
ezt a védelmet **erre az egy fájlra**. Ezért mielőtt megteszi, győződjön meg róla, hogy
a telepítőt **közvetlenül tőlem** kapta, és nem egy továbbküldött levélből vagy egy
letöltőoldalról. A fájl neve és mérete legyen pontosan ez:

| | |
|---|---|
| Fájlnév | `Szivecske Anonimizáló Setup 0.1.0.exe` |
| Méret | **529 MB** — ennyit ír ki a Windows a 0.1.0 verziónál (a nyelvi modell teszi ki a nagy részét) |

A méret verziónként változik, tehát ha nem pontosan ennyi, az önmagában még nem baj — a
nagyságrend viszont igen: ha néhány megabájtos fájlt kapott, az biztosan nem ez a program.
Ha bármi nem stimmel, ne indítsa el, hanem kérdezzen rá.

## Lépésről lépésre

### Ha böngészővel töltötte le

A böngésző maga is szólhat, még a Windows előtt. Az Edge és a Chrome a ritkán letöltött,
aláíratlan programoknál a letöltési listában pirosra vált, és olyasmit ír, hogy a fájl
*„nem gyakran letöltött"* vagy *„megbízhatatlan lehet"*.

1. Nyissa meg a böngésző letöltési listáját (jobb fent a nyíl ikon, vagy `Ctrl+J`).
2. Vigye az egeret a fájl sorára, és válassza a **Megtartás** (Keep) lehetőséget.
   Ha almenü nyílik, ott a **Mindenképp megtartás** (Keep anyway) a jó.

Ha a fájlt pendrive-on kapta, ez a lépés kimarad — és a 2. lépés kék ablaka is
gyakran elmarad, mert a Windows csak az internetről érkező fájlokat jelöli meg.

### A kék ablak

Kattintson duplán a telepítőre. Egy **kék, teljes szélességű ablak** jelenik meg, a
tetején nagy fehér betűkkel a címmel, alatta egy rövid magyarázó mondattal.

**A csapda:** az ablak alján először **csak egyetlen gomb** látszik — a **`Ne futtassa`**.
Nincs mellette „Futtatás" gomb. Nagyon sokan itt adják fel, mert úgy tűnik, nincs más
választás. **Van.** Csak el van rejtve.

1. **A szöveg alatt keresse meg a `További információ` feliratot.** Ez nem gomb, hanem
   egy aláhúzott vagy kiemelt szövegre kattintható link, a magyarázó mondat alatt.
   Kattintson rá.

2. Az ablak kibővül, és megjelenik egy kis táblázat:

   ```
   Alkalmazás:  Szivecske Anonimizáló Setup 0.1.0.exe
   Közzétevő:   Ismeretlen közzétevő
   ```

   A **`Ismeretlen közzétevő`** pontosan az, amiről fentebb szó volt: nincs tanúsítvány,
   tehát a Windows nem tudja kiírni a nevemet. Ez a várt állapot, nem hibajel.

3. **Most jelent meg egy új gomb a `Ne futtassa` mellett: `Futtatás mindenképp`.**
   Erre kattintson.

4. Innentől a szokásos telepítő fut. Ha a Windows még egyszer rákérdez, hogy engedélyezi-e
   a módosítást (fehér-kék ablak, `Igen` / `Nem`), válassza az **`Igen`**-t.

> A gombfeliratok Windows-verziónként egy-két szóban eltérhetnek (például
> `Futtatás mindenképpen`). A biztos fogódzó a **`További információ`** link és a
> **`Ismeretlen közzétevő`** sor — ha ezeket látja, jó helyen jár.

### Ezt csak egyszer kell megtenni

A figyelmeztetés a **letöltött telepítőfájlhoz** tapad. A telepítés után a Start menüből
indított program **nem fogja többé kiírni**. Új verzió telepítésekor viszont a fenti
lépések megismétlődnek, mert az megint egy új, letöltött fájl lesz.

## Ha nincs `Futtatás mindenképp` gomb

Két eset van, és egyikben sem hiba történt:

- **Smart App Control.** Windows 11-en van egy szigorúbb védelem, ami az aláíratlan
  programokat **megkerülési lehetőség nélkül** blokkolja. Ha ez be van kapcsolva, a
  program ezen a gépen nem telepíthető, amíg alá nincs írva.
- **Céges vagy irodai gép.** Ha a laptopot egy iroda informatikusa kezeli, a
  „Futtatás mindenképp" házirenddel letiltható. Ilyenkor az informatikushoz kell fordulni.

Mindkét esetben szóljon, mert ezt a programon belül nem tudom megoldani — a 2. rész
arról szól, hogy mi kell hozzá.

---

# 2. rész — A fejlesztőnek

## Az alaphelyzet, amit tudni kell, mielőtt bárki fizet

Két, egymással könnyen összekeverhető állítás van, és a különbségük dönti el, megéri-e
a tanúsítvány:

**Az aláírás önmagában NEM tünteti el az első indítási figyelmeztetést.**

A Microsoft saját dokumentációja szerint az érvényes OV vagy EV tanúsítvánnyal aláírt
program **is** kap figyelmeztetést az első letöltéseknél — csak addig, amíg a fájl
hírnevet nem gyűjt. Amit az aláírás megvesz:

| | aláírás nélkül (ma) | OV/EV aláírással |
|---|---|---|
| Első indítás | figyelmeztetés | figyelmeztetés |
| A „Közzétevő" sor | `Ismeretlen közzétevő` | `Foltin Csaba` (a tanúsítvány neve) |
| Hírnév a következő kiadásnak | **nulláról indul minden verziónál** | átöröklődik az azonos tanúsítvánnyal aláírt fájlokra |
| Smart App Control | blokkol | átengedheti |
| Céges házirend | teljesen tilthatja | jellemzően átengedi |

Vagyis a tanúsítvány nem egy kapcsoló, ami holnap megszünteti a jogász problémáját.
Az **első** aláírt kiadás felhasználója ugyanúgy látni fogja a kék ablakot — de a
nevemmel, és a következő kiadásoknál a figyelmeztetés fokozatosan elmarad. A Microsoft
szerint ez „több hét és több száz tiszta telepítés" nagyságrend, pontos küszöb nincs.

**Az EV tanúsítvány már nem ad azonnali hírnevet.** Ez régen igaz volt, és rengeteg
elavult blogbejegyzés máig ezt írja. A Microsoft dokumentációja ma kimondja, hogy ez a
viselkedés megszűnt, és hogy pusztán a SmartScreen miatt EV-t venni már nem indokolt.
**Ne fizessen érte senki ezen az alapon.**

Ha a cél tényleg a *nulla* figyelmeztetés, arra egyetlen biztos út van, és az nem
tanúsítvány: a **Microsoft Store**-on keresztüli terjesztés, ahol a Microsoft írja alá
a csomagot. Ez ennél a programnál külön mérlegelést igényel (Store-szabályzat, 440 MB-os
modell, offline működés), és nincs végiggondolva.

## A) Azure Artifact Signing (2026-ig „Trusted Signing" néven)

A Microsoft felhős aláíró szolgáltatása. **2026-ban átnevezték** `Trusted Signing`-ról
`Artifact Signing`-ra — de az electron-builder beállításkulcsa és a mögötte futó
PowerShell-modul **még a régi nevet viseli**, úgyhogy a névváltás csak a dokumentációt
keveri, a kódot nem.

**Mellette szól**

- Havi 9,99 USD (Basic, 5000 aláírás/hó); Premium 99,99 USD. Túlhasználat 0,005 USD/aláírás.
- **Nincs hardveres token** — gépi folyamatból is működik.
- FIPS 140-3 Level 3 szintű kulcskezelés, a magánkulcsot soha nem adják ki.

**Ellene szól, és ezt előre kell tudni**

- **Fizetős Azure-előfizetés kell.** Ingyenes, próba- és támogatott (sponsored)
  előfizetéssel a szolgáltatás nem hozható létre.
- **A díj nem arányosított** — a hónap közben létrehozott fiókra is a teljes havidíj jön.
- **Az azonosság-ellenőrzés 1–20 munkanap**, és csak az Azure portálon végezhető el.
- A tanúsítvány neve a bevizsgált jogi név, **egyedi CN/O nem kérhető**.
- **EV-t nem ad ki**, és nem is tervezi.

**A buktató, ami ezt a projektet konkrétan érinti**

A Microsoft feltételei szerint a nyilvánosan megbízható (Public Trust) tanúsítvány
**szervezeteknek** érhető el az USA, Kanada, **az Európai Unió**, az Egyesült Királyság,
Ausztrália, Új-Zéland, Japán, Dél-Korea, Szingapúr, Svájc, Norvégia és Izrael területén —
**magánszemély fejlesztőknek viszont csak az USA-ban és Kanadában.**

Magyarország EU-tag, tehát egy **magyar cég** jogosult. Egy **magyar magánszemély nem**.
A `package.json` szerint a szerző jelenleg magánszemély (`Foltin Csaba`, a legyártott
EXE `CompanyName` mezője is ez), ezért ez az út **jelenleg zárva** — hacsak nincs
mögötte bejegyzett jogi személy.

**Amiben bizonytalan vagyok, és utána kell járni:** hogy az **egyéni vállalkozó**
minősül-e ebben a rendszerben szervezetnek. A szervezeti ellenőrzés bejegyzett jogi
entitást, üzleti azonosítót, **saját domainen lévő weboldalt és e-mail címet** kér. Egy
egyéni vállalkozónak van adószáma és nyilvántartási száma, de hogy a Microsoft
validációja ezt elfogadja-e, azt nem tudom, és nem is akarom megtippelni. Ezt a
regisztráció megkezdése előtt kell tisztázni — bukott ellenőrzés után új kérelmet kell
beadni, és a kiegészítő dokumentumokra összesen három próbálkozás van.

**Gyakorlati követelmény a fordítógépen**

Az electron-builder ezt az utat PowerShellből hajtja végre: futás közben feltelepíti a
`TrustedSigning` PowerShell-modult (min. 0.5.0) a PSGallery-ből, előtte a NuGet
csomagszolgáltatót. Tehát a `npm run dist`-nek ilyenkor **internet és PowerShell kell**,
és az első futás lassabb.

## B) OV tanúsítvány hardveres tokenen

A klasszikus út: tanúsítvány egy kereskedelmi hitelesítés-szolgáltatótól (Sectigo,
DigiCert, SSL.com, GlobalSign).

- **Ár:** kb. 220–400 USD/év, plusz a token postázása.
- **2023. június 1. óta nem lehet PFX-fájlként megkapni.** A CA/Browser Forum szabálya
  szerint a magánkulcsnak FIPS 140-2 Level 2 (vagy azzal egyenértékű) hardveren kell
  lennie. Ez a gyakorlatban vagy egy postán küldött USB-token, vagy a szolgáltató
  felhős HSM-je.
- **A fizikai token gépi folyamatból kényelmetlen:** be kell dugni, PIN kell hozzá, és
  minden aláíráshoz jelen kell lennie. Egy egyszemélyes projektnél ez elviselhető, de
  automatizált kiadáshoz nem.
- **Felhős HSM változatok** (DigiCert KeyLocker, SSL.com eSigner, Sectigo felhős
  aláírás) ezt megoldják, cserébe drágábbak.

**Ez az az út, ami magánszemélynek is járható.** Több szolgáltató ad ki OV kódaláíró
tanúsítványt magánszemélynek is (ilyenkor a tanúsítvány a személy nevére szól, és
személyazonosság-ellenőrzés kell hozzá). Mivel az A) utat a magánszemély-korlát
Magyarországon kizárja, **ez marad az egyetlen reális lehetőség cégalapítás nélkül** —
de a konkrét szolgáltató konkrét feltételeit meg kell nézni, mert nem mind ad
magánszemélynek.

## C) Aláírás nélküli szállítás — ez fut ma

- **Költsége nulla.**
- **Amit elveszítünk:** minden kiadásnál újra megjelenik a figyelmeztetés, és a hírnév
  soha nem gyűlik — aláíratlan fájl nem tudja átörökíteni az előző verzió hírnevét.
  A Smart App Control blokkol, céges házirend teljesen tilthatja.
- **Amivel ellensúlyozzuk:**
  1. A fenti 1. rész — pontos, képernyőre illeszkedő leírás, hogy a felhasználó ne itt
     akadjon el. Ez a legolcsóbb és leghatásosabb lépés.
  2. **Pendrive-os átadás.** A kék ablakot a fájlra ragasztott internetes eredetjelölés
     (Mark of the Web) váltja ki, amit a böngésző és a levelezőprogram tesz rá. USB-ről
     másolt fájlon ez jellemzően nincs rajta, így a figyelmeztetés is elmarad. Ez nem
     helyettesíti az aláírást, és a Smart App Control ettől függetlenül blokkolhat —
     de a leggyakoribb esetet megoldja.
  3. **SHA-256 ellenőrzőösszeg** közzététele a telepítőhöz, hogy az átadott fájl
     azonossága ellenőrizhető legyen.

Amit **nem** szabad tanácsolni: a `Zone.Identifier` adatfolyam kézi törlését vagy a
SmartScreen kikapcsolását. Az nem ennek az egy fájlnak a problémáját oldja meg, hanem
a gép védelmét gyengíti tartósan.

## Hova kerül a beállítás, ha egyszer lesz tanúsítvány

A beállítás helye a **`package.json`** → **`build`** → **`win`** blokk (jelenleg a
`107.` sorban kezdődik, és csak `target` és `icon` kulcsot tartalmaz).

> **Verzióbuktató.** A projekt `electron-builder@26.15.3`-at használ. A **24-es és
> korábbi** verziókban ezek a kulcsok közvetlenül a `win` alatt voltak
> (`win.certificateFile`, `win.certificatePassword`). A **25-ös verziótól** át kellett
> költöztetni őket a `win.signtoolOptions` alá. A neten és a MI-válaszokban keringő
> példák túlnyomó része még a régi helyet mutatja, és a régi helyre írt kulcsot az
> electron-builder **szó nélkül figyelmen kívül hagyja** — a build lefut, a telepítő
> elkészül, és aláíratlan marad. A helyes kulcsneveket a telepített csomag
> típusdefiníciója mondja meg:
> `node_modules/app-builder-lib/out/options/winOptions.d.ts`.

### A) változat — Azure Artifact Signing

```json
"win": {
  "target": [ { "target": "nsis", "arch": ["x64"] } ],
  "icon": "build/icon.ico",
  "azureSignOptions": {
    "publisherName": "Foltin Csaba",
    "endpoint": "https://weu.codesigning.azure.net",
    "codeSigningAccountName": "<az Artifact Signing fiók neve>",
    "certificateProfileName": "<a tanúsítványprofil neve>"
  }
}
```

Mind a négy mező kötelező. Az `endpoint` **régiófüggő**, és annak a régiónak kell lennie,
amelyikben a fiók készült (`weu` = West Europe, `neu` = North Europe, `plc` = Poland
Central — ezek a legközelebbiek).

Környezeti változók:

| változó | mi ez |
|---|---|
| `AZURE_TENANT_ID` | a Microsoft Entra bérlő (könyvtár) azonosítója |
| `AZURE_CLIENT_ID` | a szolgáltatásnév (app registration) azonosítója |
| `AZURE_CLIENT_SECRET` | a hozzá tartozó titok |

**Fontos pontosítás:** ezt a három változót **nem az electron-builder olvassa**. Ő csak
összeállít egy `Invoke-TrustedSigning` PowerShell-hívást, és a változókat a mögötte lévő
Azure `EnvironmentCredential` dolgozza fel. Ezért hiába keresi bárki az `AZURE_` nevet az
electron-builder forrásában — nincs benne. (Ellenőrizve:
`node_modules/app-builder-lib/out/codeSign/windowsSignAzureManager.js`.)

A szolgáltatásnévnek meg kell kapnia az **Artifact Signing Certificate Profile Signer**
szerepkört, különben a build `403`-mal áll meg.

### B) változat — token vagy felhős HSM (signtool)

```json
"win": {
  "target": [ { "target": "nsis", "arch": ["x64"] } ],
  "icon": "build/icon.ico",
  "signtoolOptions": {
    "certificateSubjectName": "Foltin Csaba",
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
}
```

Hardveres tokennél `certificateSubjectName` (vagy `certificateSha1`) kell — a tanúsítvány
a token illesztőprogramján keresztül a Windows tanúsítványtárában látszik, fájlként nincs
meg. PFX-fájlos esetben (ma már csak régi, még érvényes tanúsítványnál) a fájl helyét és
jelszavát **ne írja bele a `package.json`-ba**, hanem környezeti változóból adja:

| változó | mi ez |
|---|---|
| `CSC_LINK` vagy `WIN_CSC_LINK` | a `.pfx` elérési útja vagy base64 tartalma |
| `CSC_KEY_PASSWORD` vagy `WIN_CSC_KEY_PASSWORD` | a `.pfx` jelszava |

**Az időbélyegről.** Az `rfc3161TimeStampServer` alapértelmezése az electron-builderben
`http://timestamp.digicert.com`, tehát ha egyáltalán nem írjuk ki, akkor is kap időbélyeget
az aláírás — csak a DigiCert szerverét fogja használni. Kiírni két okból érdemes: hogy
látható legyen, mi történik, és hogy a saját szolgáltatónk szerverére lehessen állítani.
Amit **nem** szabad, az az időbélyegzés kiiktatása: nélküle az aláírás a tanúsítvány
lejártakor érvénytelenné válik, és a már kiadott telepítők visszamenőleg elkezdenek
figyelmeztetést dobni.

A `Get-AuthenticodeSignature` kimenetében ezért kell a `TimeStamperCertificate` mezőnek
kitöltöttnek lennie — ez a bizonyíték, hogy az időbélyeg tényleg ráment.

### Amit nem szabad

`azureSignOptions` és `signtoolOptions` **egyszerre nem adható meg** — ilyenkor az
electron-builder az Azure-ágat választja, és a signtool-beállítás csendben elvész.

Van még egy `signExecutable: false` kapcsoló is; ez **kikapcsolja** az aláírást, miközben
az ikon és a verzióadatok beírása megmarad. Ez a mai, aláírás nélküli állapot
kifejezett rögzítésére való — nem kell beírni, mert az alapértelmezés úgyis ez.

### Az ellenőrzés, ami nélkül nincs kész

A beállítás beírása **nem bizonyíték**. Ez a projekt pontosan azon a hibán bukott már el
többször, hogy a fogadóoldal elkészült, a termelőoldal nem. Aláírás után **le kell
futtatni** és meg kell nézni a kimenetet:

```powershell
npm run dist
Get-AuthenticodeSignature "dist\telepito\Szivecske Anonimizáló Setup 0.1.0.exe" |
  Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
```

Akkor jó, ha a `Status` **`Valid`**, és a `TimeStamperCertificate` **nem üres**. Ha a
`Status` továbbra is `NotSigned`, akkor a kulcs rossz helyre került — jó eséllyel
közvetlenül a `win` alá a `signtoolOptions` helyett.

Ugyanezt a `win-unpacked\Szivecske Anonimizáló.exe`-re is ellenőrizni kell: a telepítő és
a benne lévő program két külön fájl, és külön-külön kapja meg az aláírást.

---

## Források

- [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) — Microsoft Learn (a hírnévépülés, az OV/EV táblázat és az EV-viselkedés megszűnése)
- [Quickstart: Set up Artifact Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/quickstart) — Microsoft Learn (jogosultsági országlista, azonosság-ellenőrzés menete)
- [Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/trusted-signing/faq) — Microsoft Learn (előfizetési feltételek, díjszabás jellege, EV-kizárás, `AZURE_*` változók)
- [Artifact Signing – Pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/) — Microsoft Azure
- [Windows Apps PSA: EV Certs do not grant immediate reputation anymore](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore) — ToDesktop
- [Code Signing Certificates, Cloud Signing Options](https://www.ssl.com/guide/code-signing-certificates-cloud-signing-options-and-signing-operations-integration/) — SSL.com (a 2023-as hardveres kulcstárolási követelmény)

A helyi tényeket (`NotSigned` állapot, kulcsnevek, PowerShell-modul) nem forrásból vettem,
hanem a gépen mértem, illetve a telepített `electron-builder@26.15.3` forrásából olvastam
ki; a fájlhelyek a szövegben ott állnak.
