import { useEffect, useState } from 'react';
import {
  api,
  type AppSettings,
  type DetectionResult,
  type DownloadProgress,
  type ModelListResult,
  type ModelStatus,
} from './api';
import { Overlay } from './dialogs';
import { KapcsoloSor } from './kapcsolo';

/**
 * A programadatokat a hídtól kérjük, a típust is onnan vesszük át: így nem
 * kell két helyen karbantartani, és nem múlik azon, hogy a híd fájlja
 * exportálja-e külön a típusnevet.
 */
type AppInfo = Awaited<ReturnType<typeof api.appInfo>>;

const MODEL_STATE_LABEL: Record<AppInfo['modelState'], string> = {
  missing: 'nincs letöltve',
  partial: 'félbemaradt letöltés',
  installed: 'használatra kész',
};

/**
 * A 8 bites (tömörített) hálófájl felismerése a fájlnévből.
 *
 * A betöltő szó nélkül erre esik vissza, ha a teljes pontosságú fájl nincs a
 * gépen. A kettő NEM egyformán pontos: a mérésünkben a tömörített változat
 * elvesztett egy csupa nagybetűs aláírásban álló személynevet. Hibajelentésnél
 * és kiadás előtt is tudni kell, melyik futott — ezért nem elég a modell neve.
 */
function nyolcBites(modelFile: string): boolean {
  return /int8|quantized|uint8|q8/i.test(modelFile);
}

/**
 * A fedőnév-készleteket előállító modell azonosítója a nyilvántartásban.
 *
 * NEM felismerő modell: nem ez olvassa végig az iratot. Ha ugyanúgy
 * kiválasztható volna „olvasó” modellnek, mint a másik kettő, egyetlen
 * kattintással elromlana a névfelismerés — és semmi nem szólna róla, mert a
 * program a beállított modellt szó nélkül betölti.
 *
 * Amíg a nyilvántartás (src/app/models.ts) fel nem veszi ezen az azonosítón, a
 * lista egyszerűen nem tartalmazza, és itt sem történik semmi.
 */
const GENERALO_MODELL_ID = 'theme-generator';

/**
 * Névkészlet-generáló-e ez a modell.
 *
 * ELSŐSORBAN a modell SZEREPÉT nézzük: a nyilvántartásban erre való a
 * `purpose` mező ('detect' / 'namegen', src/app/models.ts). A felületig ez ma
 * még nem jut el — a híd `ModelStatus`-a (ui/src/api.ts) nem hordozza —, ezért
 * van mögötte az azonosítós tartalék.
 *
 * A sorrend szándékos: amint a híd átadja a mezőt, magától a mező dönt, és
 * ehhez ezt a fájlt nem kell hozzáigazítani. Az azonosítóhoz kötés csak addig
 * él, amíg a szerep nem érkezik meg.
 */
function generaloModell(m: ModelStatus): boolean {
  const szerep = (m as { purpose?: string }).purpose;
  if (szerep !== undefined) return szerep === 'namegen';
  return m.id === GENERALO_MODELL_ID;
}

/**
 * A Beállítások fülei.
 *
 * NINCS köztük „Alapértelmezések”: ami ott állt — névkészlet, csere-mód,
 * küszöb, kulcsfájl, összegek, dátumok —, az iratonként más lehet, ezért az
 * irat megnyitása után megjelenő beállító lapra került át. Ha itt is
 * állítható maradna, ugyanaz a dolog két helyen élne, és a használó nem tudná,
 * melyik az érvényes.
 */
type Tab = 'altalanos' | 'models' | 'what' | 'about';

function fmt(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Egy fajta, amit a program megtalál — a „Mit csinál” fül tartalma.
 *
 * A példák MINDIG párban állnak (bemenet → kimenet), mert a használó nem a
 * fogalmat akarja tudni, hanem azt, hogy mi lesz az iratából. A `kapcsolo` ott
 * áll, ahol a fajta beállításhoz kötött: az összeg és a dátum csak akkor
 * cserélődik, ha a kapcsoló be van kapcsolva, és hallgatni erről pontosan azt
 * a téves biztonságérzetet adná, amit el akarunk kerülni.
 */
interface Fajta {
  cim: string;
  mit: string;
  peldak: [be: string, ki: string][];
  kapcsolo?: 'replaceAmounts' | 'shiftDates';
}

/*
  A példák a FEDŐNEVEK módra vonatkoznak, egyetlen készletből (kőkorszak),
  hogy összeálljanak: ugyanaz a személy végig „Kovakövi Frédi”. Az összegeknél
  ugyanaz a szorzó fut végig, a dátumoknál ugyanaz az eltolás — így a lapon is
  látszik az, ami a programban a lényeg: az összefüggések megmaradnak.

  MINDEN RAGOZOTT ALAK A RAGOZÓ MOTORTÓL VALÓ, nem kézzel begépelt. A képernyőn
  álló példa ígéret: azt mondja, hogy a program pontosan ezt fogja az iratba
  írni. Egy kézzel odaírt, hihetőnek látszó alak pont akkor derülne ki
  hamisnak, amikor a felhasználó ellenőrizni akarja — ezért az itt álló
  alakokat a `renderCoreTable` (src/pseudonym.ts) adta, a szállított
  `data/themes/kokorszak.json` névsorával.
*/
const MIT_TALAL: Fajta[] = [
  {
    cim: 'Személynevek, minden ragozott alakban',
    mit:
      'Elég egyszer megadni a nevet. Onnantól a program a toldalékos alakokat is megtalálja, ' +
      'és az álnevet a magyar hangrend szerint ragozza vissza — nem „Kovakövi-val”, hanem ' +
      '„Kovakövivel”. Az aláírásblokk csupa nagybetűs alakját és a monogramot is felismeri.',
    peldak: [
      ['Kovácsot', 'Kovakövit'],
      ['Kováccsal', 'Kovakövivel'],
      ['Kovácsék', 'Kovaköviék'],
      ['Kovács úrnak', 'Kovakövi úrnak'],
      ['dr. Kovács Jánossal', 'dr. Kovakövi Frédivel'],
      ['KOVÁCS JÁNOS (aláírásblokk)', 'KOVAKÖVI FRÉDI'],
      ['K. J. (monogram)', 'K. F.'],
    ],
  },
  {
    cim: 'Asszonynév és leánykori név',
    mit:
      'A „-né” nem rag, hanem külön név: a „Kovácsné” nem a „Kovács” ragozott alakja. A ' +
      'program külön névként veszi fel — enélkül a férj neve kicserélődne, a feleségé pedig ' +
      'bent maradna. A leánykori név önálló nevet kap, nem a férjezettből képzettet.',
    peldak: [
      ['Kovács Jánosné', 'Kovakövi Frédiné'],
      ['Kovácsné Szabó Anna', 'Kovaköviné Kavicsi Vilma'],
      ['Szabó Anna', 'Kavicsi Vilma'],
    ],
  },
  {
    cim: 'Szervezetek és cégformák',
    mit:
      'A cégforma nem változik: a Kft. Kft. marad, a Zrt. Zrt. A toldalék a rövidítés ' +
      'KIEJTÉSE szerint kapcsolódik („Kft.” kiejtve magas hangrendű, ezért „-nek” és nem ' +
      '„-nak”). A névelőt a csere után javítja, különben minden átírt mondaton látszana, hogy ' +
      'gép nyúlt hozzá.',
    peldak: [
      ['Aranykalász Kft.-nek', 'Kovakövi Kft.-nek'],
      ['Aranykalász Kereskedelmi Kft.', 'Kovakövi Kereskedelmi Kft.'],
      ['az Aranykalász Zrt.-vel', 'a Kavicsi Zrt.-vel'],
    ],
  },
  {
    cim: 'Helynevek és lakcímek',
    mit:
      'A helységnév fedőnevet kap, a ragjával együtt. A teljes lakcímre viszont mind a négy ' +
      'módban adatfajta-megjelölés kerül: egy kitalált utca és házszám ugyanúgy valódinak ' +
      'látszana, és az olvasó nem tudná eldönteni, melyik az igazi.',
    peldak: [
      ['Szentendrén', 'Kovakőfalván'],
      ['Szentendrére költözött', 'Kovakőfalvára költözött'],
      // Az emelet és az ajtó IS a címhez tartozik. A példa sokáig a házszámig
      // tartott, mert a felismerő is ott állt meg — egy társasházban viszont
      // épp az emelet és az ajtó szűkíti egyetlen lakásra.
      ['1085 Budapest, Baross u. 12. 2/4.', '[lakcím]'],
    ],
  },
  {
    cim: 'Hivatalos azonosítók',
    mit:
      'Ezek FEDŐNEVEK MÓDBAN IS az adatfajta megjelölését kapják, nem kitalált számsort — egy ' +
      'kitalált tízjegyű szám ugyanúgy valódi adóazonosítónak látszana. Ahol van ' +
      'ellenőrzőszám, azt a program kiszámolja: ha nem stimmel, nem cserél magától, hanem ' +
      'megkérdez.',
    peldak: [
      ['adóazonosító jel: 8412345678', '[adóazonosító jel]'],
      ['TAJ: 123 456 789', '[TAJ-szám]'],
      ['adószám: 12345678-2-42', '[adószám]'],
      ['cégjegyzékszám: 01-09-123456', '[cégjegyzékszám]'],
      ['bankszámlaszám: 11711034-20000000', '[bankszámlaszám]'],
      ['HU42 1177 1034 2000 0000 0000 0000 (IBAN)', '[bankszámlaszám]'],
      ['helyrajzi szám: 4567/12', '[helyrajzi szám]'],
      ['1085 Budapest (irányítószám településnévvel)', '[irányítószám]'],
      ['telefonszám: +36 20 123 4567', '[telefonszám]'],
      ['személyi igazolvány: 123456AB', '[igazolványszám]'],
      ['12.P.20.345/2024/8. (ügyszám)', '[ügyszám]'],
      ['rendszám: ABC-123', '[rendszám]'],
      ['kovacs.janos@freemail.hu', '[e-mail cím]'],
    ],
  },
  {
    cim: 'Összegek',
    kapcsolo: 'replaceAmounts',
    mit:
      'Fedőnevek módban minden összeg UGYANAZZAL az ügyre állandó szorzóval változik, így az ' +
      'összefüggések megmaradnak: ami eddig kiadta a végösszeget, utána is kiadja. A betűvel ' +
      'kiírt alakot is átírja. Az eredmény az eredeti KEREKSÉGÉHEZ igazodik: a kerek ' +
      'milliókból kerek milliók lesznek, nem „5 280 000”-féle álpontos szám — ezért a ' +
      'példákban látszó arány nem pontosan ugyanaz. A másik három módban a szám helyére ' +
      '„[összeg]” kerül. Pénznem nélküli számhoz — paragrafus, ügyszám, határidő, sorszám ' +
      '— a program nem nyúl.',
    peldak: [
      ['4 800 000 Ft', '5 300 000 Ft'],
      ['azaz négymillió-nyolcszázezer forint', 'azaz ötmillió-háromszázezer forint'],
      ['1 200 000 Ft-ot', '1 300 000 Ft-ot'],
      ['a Ptk. 6:519. §-a alapján', 'a Ptk. 6:519. §-a alapján (nem nyúl hozzá)'],
    ],
  },
  {
    cim: 'Dátumok',
    kapcsolo: 'shiftDates',
    mit:
      'Egyetlen, az ügyre állandó eltolás: az időközök megmaradnak, a 90 napos felmondási idő ' +
      'utána is 90 nap. A ragozott alakot a program ÚJRARAGOZZA, mert az új naphoz más ' +
      'toldalék tartozik. A jogszabályok évszámához nem nyúl. Vigyázz: a határidők a valós ' +
      'naptárhoz képest elcsúsznak, tehát az eltolt iratból határidőt számolni nem szabad.',
    peldak: [
      ['2024. június 24-én', '2024. augusztus 3-án'],
      ['2024. július 1-jétől', '2024. augusztus 10-étől'],
      ['2024. március 15.', '2024. április 24.'],
      ['a 2016. évi CXXX. törvény', 'a 2016. évi CXXX. törvény (nem nyúl hozzá)'],
    ],
  },
];

/** Egy példa: mi állt az iratban, és mi lesz belőle. */
function Pelda({ be, ki }: { be: string; ki: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 7,
        // A dokumentum-betűtípus szándékos: ezek a szövegrészletek az IRATBÓL
        // valók, nem a felület címkéi.
        fontFamily: 'var(--doc)',
        fontSize: 12.5,
        lineHeight: 1.6,
        padding: '1px 0',
      }}
    >
      <span style={{ color: 'var(--ink-soft)' }}>{be}</span>
      <span style={{ color: 'var(--muted)' }}>→</span>
      <span style={{ color: 'var(--rose-deep)', fontWeight: 600 }}>{ki}</span>
    </div>
  );
}

/** Egy fajta a „Mit csinál” fülön: cím, magyarázat, példák. */
function FajtaBlokk({ fajta, kikapcsolva }: { fajta: Fajta; kikapcsolva: boolean }) {
  return (
    <div className="field">
      <div className="fieldlabel">{fajta.cim}</div>
      <span className="hint">{fajta.mit}</span>
      {kikapcsolva && (
        <span className="hint" style={{ color: 'var(--amber)', fontWeight: 600 }}>
          Most ki van kapcsolva — az irat megnyitása után, a „Mit cserélünk?” fülön
          kapcsolhatod be.
        </span>
      )}
      <div style={{ marginTop: 3 }}>
        {fajta.peldak.map(([be, ki]) => (
          <Pelda key={be} be={be} ki={ki} />
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog({
  initialTab = 'models',
  detected,
  onClose,
  onChanged,
}: {
  /** A menü „A programról” pontja rögtön a megfelelő fülre nyit. */
  initialTab?: Tab;
  /**
   * A legutóbbi felismerés eredménye. A modell FUTÁSÁRÓL csak ez tud: az
   * `appInfo` a telepítettséget ismeri, azt nem, hogy a betöltés hibára
   * futott-e. A kettő együtt adja ki a valóságot.
   */
  detected?: DetectionResult | null;
  onClose: () => void;
  onChanged: (s: AppSettings) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ModelListResult | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Hiba esetén is legyen mondanivalónk: enélkül a fül némán, üresen jelenik
    // meg, és a felhasználó azt hiszi, ilyen a program.
    void api.getSettings().then(setSettings).catch((e: Error) => setError(e.message));
    void api.listModels().then(setModels).catch((e: Error) => setError(e.message));
    void api.appInfo?.().then(setInfo).catch(() => setInfo(null));
    const off = api.onDownloadProgress((p) => setProgress(p.done ? null : p));
    return off;
  }, []);

  const patch = async (p: Partial<AppSettings>): Promise<void> => {
    setError(null);
    try {
      const next = await api.setSettings(p);
      setSettings(next);
      onChanged(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const download = async (id: string): Promise<void> => {
    setError(null);
    setProgress({ modelId: id, file: '', receivedBytes: 0, totalBytes: 1, ratio: 0, done: false });
    try {
      await api.downloadModel(id);
      setModels(await api.listModels());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    // Zárolt vagy használatban lévő fájlnál a törlés eldobódik. Enélkül a
    // gombra szó szerint nem történik semmi, és ezt hibának hiszi a felhasználó.
    try {
      await api.removeModel(id);
      setModels(await api.listModels());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // A két lista KÜLÖN áll, mert két külön munkát végeznek: az egyik az iratot
  // olvassa, a másik a fedőnév-készleteket állítja elő. Egy listában a
  // „Ezt használjuk” gomb ugyanúgy nézne ki mindkettőn, és a generálót
  // olvasónak beállítva a névfelismerés némán elromlana.
  const osszesModell = models?.models ?? [];
  const felismeroModellek = osszesModell.filter((m) => !generaloModell(m));
  const generaloModellek = osszesModell.filter(generaloModell);

  return (
    <Overlay onClose={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Beállítások</h2>
          <p>
            A program a gépeden fut. Hálózatot egyetlen dolog használ: a nyelvi modell letöltése,
            és az is csak akkor, ha rákattintasz.
          </p>
        </div>

        <div className="tabs" style={{ padding: '9px 21px 0' }}>
          <button
            className={`tab${tab === 'altalanos' ? ' active' : ''}`}
            onClick={() => setTab('altalanos')}
          >
            Általános
          </button>
          <button className={`tab${tab === 'models' ? ' active' : ''}`} onClick={() => setTab('models')}>
            Nyelvi modellek
          </button>
          <button className={`tab${tab === 'what' ? ' active' : ''}`} onClick={() => setTab('what')}>
            Mit csinál
          </button>
          <button className={`tab${tab === 'about' ? ' active' : ''}`} onClick={() => setTab('about')}>
            A programról
          </button>
        </div>

        <div className="dialog-body">
          {error && <div className="note bad">{error}</div>}

          {/*
            ÁLTALÁNOS — egyelőre egyetlen beállítással.

            A téma nem fér el a másik három fül egyikén sem: nem a nyelvi
            modellről szól, nem arról, mit csinál a program, és nem is a
            programról mint olyanról. Egy fül egy beállítással soványnak
            látszik, de a helye pontos — és ez az a fül, ahova a következő
            hasonló, „az egész programra szóló" kapcsoló kerül majd.
          */}
          {/*
            A BEÁLLÍTÁSSOR: BALRA A KÉRDÉS, JOBBRA A VÁLASZ.

            Egy beállítás két részből áll — mit állítok, és mire. Egymás alá
            téve (cím, magyarázat, majd alatta a vezérlő) a szem kétszer
            fut végig ugyanazon a soron, és sok beállítás mellett a lap
            végtelen szöveggé válik. Egy sorban, két oszlopban viszont
            ránézésre látszik, MI van bekapcsolva — a magyarázatot csak az
            olvassa el, akit érdekel.
          */}
          {tab === 'altalanos' && (
            <div className="bsorok">
              <div className="bsor">
                <div className="bszoveg">
                  <h4>Felület témája</h4>
                  <p>Alapból azt követi, amit a Windowsban beállítottál.</p>
                </div>
                <div className="seg sm" role="radiogroup" aria-label="Felület témája">
                  {(
                    [
                      ['auto', 'Rendszer'],
                      ['vilagos', 'Világos'],
                      ['sotet', 'Sötét'],
                    ] as const
                  ).map(([ertek, cimke]) => (
                    <button
                      key={ertek}
                      role="radio"
                      aria-checked={(settings?.uiTheme ?? 'auto') === ertek}
                      className={`segbtn${(settings?.uiTheme ?? 'auto') === ertek ? ' active' : ''}`}
                      onClick={() => void patch({ uiTheme: ertek })}
                    >
                      {cimke}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'models' && (
            <>
              <div className="note good">
                A <b>nyelvi modell olvassa végig az iratot</b> és találja meg a neveket. A jogi
                irat szerkezete („Felperes:”, „anyja neve:”, „mint kölcsönadó”, cégforma) azt teszi
                hozzá, amit a modell nem tudhat: ki milyen szerepben áll az eljárásban, és kinek a
                nevét kell a törvény szerint bent hagyni. Modell nélkül a program csak a szerkezeti
                jelekre tud támaszkodni — ezért töltsd le.
              </div>

              {!models && (
                <p className="hint">
                  {error
                    ? 'A modellek listája nem tölthető be — a fenti hibaüzenet mondja meg, miért.'
                    : 'A modellek listájának betöltése…'}
                </p>
              )}

              {felismeroModellek.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  active={settings?.modelId === m.id}
                  valaszthato
                  progress={progress?.modelId === m.id ? progress : null}
                  onDownload={() => void download(m.id)}
                  onCancel={() => void api.cancelDownload()}
                  onRemove={() => void remove(m.id)}
                  onActivate={() => void patch({ modelId: m.id })}
                />
              ))}

              {/* A generáló csak akkor jelenik meg, ha a nyilvántartás felvette.
                  Külön rovat, külön mondattal: enélkül a felhasználó azt hinné,
                  ez a harmadik választható olvasó modell. */}
              {generaloModellek.length > 0 && (
                <>
                  <div className="fieldlabel" style={{ marginTop: 18 }}>
                    Névkészlet-generáló
                  </div>
                  <p className="hint" style={{ marginBottom: 9 }}>
                    Ez a modell <b>nem az iratot olvassa</b>: fedőnév-készletet állít elő, amiből a
                    program az álneveket veszi. A felismerésre nincs hatással, ezért nem is
                    választható ki olvasó modellnek. Letöltés nélkül is működik minden — csak a
                    szállított névkészletekből tudsz választani.
                  </p>
                  {generaloModellek.map((m) => (
                    <ModelCard
                      key={m.id}
                      model={m}
                      active={false}
                      valaszthato={false}
                      progress={progress?.modelId === m.id ? progress : null}
                      onDownload={() => void download(m.id)}
                      onCancel={() => void api.cancelDownload()}
                      onRemove={() => void remove(m.id)}
                      onActivate={() => undefined}
                    />
                  ))}
                </>
              )}

              {models && (
                <p className="hint" style={{ marginTop: 12 }}>
                  A modellek helye: a felhasználói mappa <span className="mono">modellek</span>{' '}
                  könyvtára. Jelenleg <b>{models.diskUsageLabel}</b> foglalt.
                </p>
              )}

              {settings && (
                <div style={{ marginTop: 14 }}>
                  <KapcsoloSor
                    id="beall-usemodel"
                    cim="A nyelvi modell olvassa végig az iratot"
                    leiras="Ha kikapcsolod, a program csak a szerkezeti jelekre („Felperes:”, cégforma) tud támaszkodni, és a szövegben szabadon említett neveket nem találja meg."
                    be={settings.useModel}
                    onValt={(be) => void patch({ useModel: be })}
                  />
                </div>
              )}
            </>
          )}

          {tab === 'what' && (
            <>
              <div className="note good">
                <b>Amit a program megtalál, és amit a helyére ír.</b> Az alábbi példák a
                fedőnév-módra vonatkoznak; a másik három módban ugyanezeket találja meg, csak mást
                ír a helyükre (eljárási szerepet, adatfajta-megjelölést vagy számozott címkét).
              </div>

              {MIT_TALAL.map((f) => (
                <FajtaBlokk
                  key={f.cim}
                  fajta={f}
                  kikapcsolva={f.kapcsolo !== undefined && settings?.[f.kapcsolo] === false}
                />
              ))}

              {/*
                A NEM-lista nem szerénykedés, hanem munkavédelem: aki azt hiszi,
                a program a szkennelt iratot is kitakarja, kiadja a kezéből az
                iratot anélkül, hogy egyetlen nevet is lecseréltek volna benne.
              */}
              <div className="note bad">
                <b>Amit NEM csinál.</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  <li>
                    <b>Nem olvas képet.</b> A szkennelt iratban a betűk kép formájában állnak; a
                    program nem lát bennük szöveget, tehát nem is takar ki semmit. Ilyenkor szól,
                    hogy nem talált kiolvasható szöveget — ezt az üzenetet komolyan kell venni.
                  </li>
                  <li>
                    <b>Nem dolgozik táblázattal.</b> Az <span className="mono">.xlsx</span> nem
                    nyitható meg. Amit kezel: <span className="mono">.pdf</span>,{' '}
                    <span className="mono">.docx</span>, <span className="mono">.txt</span>.
                  </li>
                  <li>
                    <b>Az eljáró bíró, az ügyvéd, a védő és a bíróság neve bent marad.</b> Ezt a
                    törvény írja elő (Bszi. 166. § (2)), nem a program mulasztása. A szereplapon
                    külön listán látod, kiket hagyott bent és miért.
                  </li>
                </ul>
              </div>

              <p className="hint">
                A kimenetet a program minden mentés után visszaolvassa egy másik könyvtárral, és
                megmondja, maradt-e benne bármi. Ez nem kikapcsolható.
              </p>
            </>
          )}

          {tab === 'about' && (
            <>
              {/*
                A MODELL HIÁNYÁNAK FIGYELMEZTETÉSE INNEN KIKERÜLT.

                A tény nem tűnt el, csak a NEGYEDIK példánya. Ugyanez a
                figyelmeztetés áll a nyitóképernyőn (letöltés gombbal), a csere
                lapjának modellsávjában (letöltéssel és indítással), és a
                fejlécben, végig, amíg a modell nem fut. Ez a lap a program
                NÉVJEGYE: azt mondja meg, mi ez a program és melyik háló fut —
                itt a hiány közlése csak egy ötödik hely, ahonnan a
                felhasználót a szomszéd fülre küldjük.
              */}

              {/* A híd a TÉNYLEGESEN betöltendő fájlt adja vissza, nem a
                  beállítottat: a betöltő csendben a 8 bites változatra vált, ha a
                  pontos nincs a gépen. */}
              {info && info.modelState === 'installed' && nyolcBites(info.modelFile) && (
                <div className="note">
                  <b>A 8 bites, tömörített háló fut.</b> A betöltő erre vált, ha a teljes
                  pontosságú fájl nincs a gépen. A mérésünkben ez a változat elvesztett egy csupa
                  nagybetűs aláírásban álló személynevet — kiadás előtt nézd át a szereplapot.
                </div>
              )}

              {/* A telepítettség és a FUTÁS két különböző dolog: a modell meglehet
                  a lemezen, és a betöltése mégis hibára futhat. Ezt csak a
                  legutóbbi felismerés tudja. */}
              {detected && !detected.modelUsed && (
                <div className="note bad">
                  <b>A legutóbbi felismerésnél a nyelvi modell nem futott le.</b>{' '}
                  {detected.modelNote || 'A program csak a szerkezeti jelekre tudott támaszkodni.'}
                </div>
              )}

              <div className="note good">
                <b>Az irat nem hagyja el a gépet.</b> A felületnek nincs hálózati hozzáférése, a
                dokumentumot csak a program belső része látja. Egyetlen kivétel a modell letöltése,
                amit te indítasz el.
              </div>

              {!info && (
                <p className="hint">
                  A programadatok nem érhetők el. Hibajelentésnél írd meg, melyik verziót
                  telepítetted és melyik modellt választottad ki.
                </p>
              )}

              {info && (
                <>
                  <div className="resultrow">
                    <span>Szivecske Anonimizáló</span>
                    <span className="v">{info.version} verzió</span>
                  </div>
                  <div className="resultrow">
                    <span>Használt nyelvi modell</span>
                    <span className="v">{info.modelName}</span>
                  </div>
                  <div className="resultrow">
                    <span>A modell azonosítója</span>
                    <span className="v mono">{info.modelId}</span>
                  </div>
                  <div className="resultrow">
                    <span>A modell állapota</span>
                    <span className="v">{MODEL_STATE_LABEL[info.modelState]}</span>
                  </div>
                  <div className="resultrow">
                    <span>A ténylegesen betöltött hálófájl</span>
                    <span className="v mono">{info.modelFile || '—'}</span>
                  </div>
                  <div className="resultrow">
                    <span>Futtatómotor</span>
                    <span className="v">{info.engine}</span>
                  </div>
                  {/*
                    A TESZTSTATISZTIKA INNEN KIKERÜLT, és nem véletlenül: a
                    „330/330 arany-készlet” típusú sorok a fejlesztés adatai, a
                    használónak semmit nem mondanak arról, hogy MIT tegyen. Amit
                    a program elvégez, azt a „Mit csinál” fül mondja el példákkal;
                    itt csak az marad, ami HIBAJELENTÉSNÉL kell.
                  */}
                  <p className="hint" style={{ margin: '8px 0 0' }}>
                    Hibajelentéshez ez a hat sor kell: a programverzió önmagában kevés, mert a
                    felismerés minősége azon múlik, melyik háló futott.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <div className="dialog-foot">
          {/* A nyugtázó gomb neve mindenhol „Rendben" — a „Kész" itt negyedik
              szóként állt ugyanarra a mozdulatra. */}
          <button className="btn primary" onClick={onClose}>
            Rendben
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function ModelCard({
  model,
  active,
  valaszthato,
  progress,
  onDownload,
  onCancel,
  onRemove,
  onActivate,
}: {
  model: ModelStatus;
  active: boolean;
  /**
   * Kiválasztható-e OLVASÓ modellnek. Hamis a névkészlet-generálóra: az nem az
   * iratot olvassa, és beállítva a névfelismerést rontaná el.
   */
  valaszthato: boolean;
  progress: DownloadProgress | null;
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onActivate: () => void;
}) {
  const installed = model.state === 'installed';
  // A magyar modellt nem a tároló szállítja futtatható formában — azt építéskor
  // mi állítjuk elő, és a programmal együtt adjuk. Ilyenkor letöltés-gomb
  // helyett meg kell mondani, hogy nincs teendő.
  const bundled = model.source === 'converted';
  return (
    <div className={`modelcard${installed && active ? ' active' : ''}`}>
      <div className="mhead">
        <div>
          <div className="mname">
            {model.name}
            {model.recommended && <span className="pill kind">ajánlott</span>}
            {installed && <span className="pill auto">{bundled ? 'a programban' : 'letöltve'}</span>}
            {model.state === 'partial' && <span className="pill review">félbemaradt</span>}
          </div>
          <div className="mrepo mono">{model.repo}</div>
        </div>
        <div className="msize">{fmt(model.totalBytes)}</div>
      </div>

      {/*
        Két rovat, két kérdésre: MI EZ és MIT CSINÁL. Korábban egy méltató
        bekezdés állt itt, alatta egy figyelmeztető doboz arról, amit a modell
        nem tud — a kettő együtt inkább reklám volt, mint adat. A modellkártyán
        annak van helye, ami mérhető.
      */}
      <dl className="mfacts">
        <dt>Mi ez</dt>
        <dd>{model.mi}</dd>
        <dt>Mit csinál</dt>
        <dd>{model.mit}</dd>
      </dl>

      <div className="mmeta">
        <span className="pill kind">{model.license}</span>
        <span>nyelvek: {model.languages.join(', ')}</span>
      </div>

      {progress && (
        <div className="progress">
          <div className="bar" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          <span className="ptext">
            {progress.file || 'előkészítés'} — {fmt(progress.receivedBytes)} /{' '}
            {fmt(progress.totalBytes)} ({Math.round(progress.ratio * 100)}%)
          </span>
        </div>
      )}

      <div className="mactions">
        {!installed && !progress && !bundled && (
          <button className="btn primary sm" onClick={onDownload}>
            Letöltés ({fmt(model.totalBytes)})
          </button>
        )}
        {!installed && bundled && (
          <span className="hint">
            Ez a modell a programmal érkezik. Ha hiányzik, telepítsd újra a programot.
          </span>
        )}
        {progress && (
          <button className="btn sm" onClick={onCancel}>
            Megszakítás
          </button>
        )}
        {installed && valaszthato && !active && (
          <button className="btn sm" onClick={onActivate}>
            Ezt használjuk
          </button>
        )}
        {installed && valaszthato && active && <span className="pill auto">aktív</span>}
        {(installed || model.state === 'partial') && !progress && !bundled && (
          <button className="btn ghost sm" onClick={onRemove}>
            Törlés
          </button>
        )}
      </div>
    </div>
  );
}
