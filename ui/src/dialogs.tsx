import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { Kapcsolo, KapcsoloSor } from './kapcsolo';
import { splitContext } from './panels';
import type {
  AutoDecisionRow,
  DetectionResult,
  DownloadProgress,
  EllenorzottNev,
  ExportResult,
  KeyEntry,
  ModelRunStatus,
  ModelStatus,
  PartyInput,
  TemaEredmeny,
  TemaGenStatus,
  ThemeSummaryUi,
  UpdateProgress,
  UpdateState,
} from './api';

/**
 * Közös átfedő réteg: az Esc-kezelés és a háttérre kattintás egy helyen él.
 * Exportálva is van, mert a beállítások ablaka külön fájlban lakik, és ha saját
 * réteget rajzol magának, azon az Esc némán nem működik.
 */
export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {children}
    </div>
  );
}

/* ─────────────────────────── felek ─────────────────────────── */

const ROLES = [
  'felperes',
  'I. r. alperes',
  'II. r. alperes',
  'alperes',
  'tanú',
  'vádlott',
  'sértett',
  'kérelmező',
  'kérelmezett',
  'kezes',
  'eladó',
  'vevő',
  'örökös',
  'egyéb',
];

let seq = 0;
function newId(): string {
  return `p${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function emptyParty(): PartyInput {
  return { id: newId(), kind: 'person', fullName: '', gender: 'N', role: 'felperes' };
}

/**
 * Hány modell-találatot nem tudtunk értelmezni.
 *
 * Nem elég a `unmappedLabels` mezőt kiolvasni: a főfolyamat a nyers állapotba
 * CSAK a fajtánkénti bontást teszi bele (electron/main.ts), az összeget a
 * felismerő számolja hozzá. Ha a felület vakon a kész összegre várna, ez a
 * mondat pontosan azokon az útvonalakon hiányozna a képernyőről, ahol a hiba
 * keletkezett — ezért a bontásból is összeadjuk, és a nagyobbat mutatjuk.
 */
function nemErtelmezett(m: ModelRunStatus): number {
  const byLabel = m.unmappedByLabel ?? {};
  const osszeg = Object.values(byLabel).reduce((a, n) => a + n, 0);
  return Math.max(m.unmappedLabels ?? 0, osszeg);
}

/** „MISC: 2, DATE: 1" — a puszta darabszám nem mond teendőt, a fajta igen. */
function bontas(m: ModelRunStatus): string {
  const byLabel = m.unmappedByLabel ?? {};
  const parts = Object.entries(byLabel)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label}: ${n}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * A NYELVI MODELL ÁLLAPOTA — négy eset, négy külön teendő.
 *
 * Nem lábjegyzet, hanem megállító esemény: a modell a felismerés motorja. Ha
 * nem futott, csak azokat a feleket találtuk meg, akiket az irat KIFEJEZETTEN
 * megnevez („felperes:", „anyja neve:", cégforma) — a folyó szövegben elszórt
 * nevek java fedezetlen maradt. Ezért a négy állapot nem ugyanaz a doboz más
 * szöveggel: a hiba hangos és piros, a hiányzó modell teendőt ad, a
 * kikapcsolás tájékoztat, a sikeres futás nyugtáz.
 */
function ModelStatusNote({
  model,
  note,
  onOpenSettings,
}: {
  model: ModelRunStatus;
  /** A főfolyamat mondata — mérési adat vagy a hiba magyar szövege. */
  note: string;
  onOpenSettings?: (() => void) | undefined;
}) {
  const unmapped = nemErtelmezett(model);

  const fej: Record<ModelRunStatus['state'], { mark: string; title: string }> = {
    ok: { mark: '✓', title: 'A nyelvi modell végigolvasta az iratot' },
    off: { mark: '⏻', title: 'A nyelvi modell ki van kapcsolva' },
    missing: { mark: '↓', title: 'A nyelvi modell nincs telepítve' },
    failed: { mark: '!', title: 'A nyelvi modell hibára futott' },
  };
  /*
    Ismeretlen állapotnál a HIBA olvasata a helyes, nem a sikeré: ha a motor
    olyasmit küld, amit ez a képernyő nem ismer, akkor nem tudjuk, hogy a
    modell végigolvasta-e az iratot — és a bizonytalanságot ugyanúgy meg kell
    állítani, mint a hibát. (Egy hiányzó ág itt különben fehér képernyőt adna,
    épp a kézi névfelvitel megnyitásakor.)
  */
  const state = fej[model.state] ? model.state : 'failed';
  const { mark, title } = fej[state];

  return (
    <div className={`modelnote ${state}`}>
      <div className="mhead">
        <span className="mark">{mark}</span>
        <span className="t">{title}</span>
      </div>

      {state === 'ok' && (
        <p>
          {note || `A modell ${model.entityCount ?? 0} entitást talált.`} A folyó szövegben
          említett nevekre is rákerestünk, nemcsak a megnevezett felekre.
        </p>
      )}

      {state !== 'ok' && (
        <p>
          {/* A KÖVETKEZMÉNYT mondjuk ki, nem az okot: a felhasználót nem az
              érdekli, melyik alrendszer nem indult el, hanem az, hogy mit nem
              találtunk meg emiatt. */}
          A felismerés kizárólag a <b>szerkezeti mintákra</b> támaszkodott: csak azokat a feleket
          találtuk meg, akiket az irat kifejezetten megnevez. A folyó szövegben elszórt nevekre{' '}
          <b>nem kerestünk rá</b> — ezeket neked kell felvenned.
        </p>
      )}

      {state === 'failed' && (
        <p className="loud">
          {model.message || note || 'A modell futás közben leállt.'} Ezt az iratot{' '}
          <b>ne fogadd el anonimizáltként</b>, amíg a modell újra le nem futott.
        </p>
      )}

      {state === 'missing' && note && <p className="soft">{note}</p>}

      {/*
        A modell olyan találatokat is dobhat, amiknek a nyers címkéjéhez nincs
        bejegyzés a címketérképünkben. Ezek eddig némán eltűntek — vagyis a
        program pont arról hallgatott, amit nem értett.
      */}
      {unmapped > 0 && (
        <p className="soft">
          A modell <b>{unmapped} találatát nem tudtuk értelmezni</b>
          {bontas(model)}: a nyers címkéjükhöz nincs bejegyzés a címketérképben, ezért nem kerültek
          a felek közé. Ha az iratban idegen nyelvű vagy szokatlan névformák vannak, azokat kézzel
          kell felvenni.
        </p>
      )}

      {state !== 'ok' && onOpenSettings && (
        <div className="macts">
          <button className="btn sm" onClick={onOpenSettings}>
            {state === 'missing' ? 'Modell letöltése' : 'Beállítások → Nyelvi modellek'}
          </button>
        </div>
      )}
    </div>
  );
}

export function PartiesDialog({
  parties,
  identifiers,
  detected,
  detectError,
  onSave,
  onClose,
  onOpenSettings,
}: {
  parties: PartyInput[];
  /**
   * A megtalált hivatalos azonosítók (adószám, TAJ, lakcím, bankszámlaszám,
   * hrsz., e-mail) — MÁR leválasztott felületi alakban, `skipped` jelzéssel.
   *
   * Külön érkezik, nem a `parties` végén: egy azonosító nem fél. Nincs neme,
   * nincs eljárási szerepe, és nem témás fedőnevet kap, hanem
   * adatfajta-megjelölést. A felek közé keverve az ügyvéd tíz számsor közül
   * keresné ki a felperest.
   */
  identifiers?: PartyInput[];
  detected?: DetectionResult | null;
  /** A felismerés hibaüzenete. Ilyenkor kézzel kell felvinni a feleket. */
  detectError?: string | null;
  onSave: (p: PartyInput[], identifiers: PartyInput[]) => void;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const [rows, setRows] = useState<PartyInput[]>(parties.length ? parties : [emptyParty()]);
  /**
   * Az azonosítók a párbeszéd megnyitásakor MIND be vannak kapcsolva, és a
   * kikapcsolás itt csak jelzés: a motor a `skipped` mezőből tudja meg, hogy
   * ezt az azonosítót nem kell kicserélnie (`foundIdentifierParties` és az
   * `entities` szűrése, src/app/session.ts).
   */
  const [idRows, setIdRows] = useState<PartyInput[]>(identifiers ?? []);
  const lastRef = useRef<HTMLInputElement | null>(null);
  const byId = new Map((detected?.parties ?? []).map((d) => [d.id, d]));
  // A bizonyíték és az előfordulásszám a felismerés kísérőadata; a felületi
  // sor maga csak `PartyInput`, ezért az indoklást innen olvassuk hozzá.
  const idEvidence = new Map((detected?.identifiers ?? []).map((d) => [d.id, d]));
  const foundCount = detected?.parties.length ?? 0;

  const update = (id: string, patch: Partial<PartyInput>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const add = () => setRows((r) => [...r, emptyParty()]);
  const remove = (id: string) => setRows((r) => (r.length > 1 ? r.filter((x) => x.id !== id) : r));

  const toggleId = (id: string) =>
    setIdRows((r) => r.map((x) => (x.id === id ? { ...x, skipped: !x.skipped } : x)));
  const setAllIds = (skipped: boolean) => setIdRows((r) => r.map((x) => ({ ...x, skipped })));
  const idOnCount = idRows.filter((x) => !x.skipped).length;

  const valid = rows.filter((r) => r.fullName.trim().length > 1);

  return (
    <Overlay onClose={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{foundCount > 0 ? `${foundCount} felet találtunk az iratban` : 'Kik szerepelnek az iratban?'}</h2>
          <p>
            {foundCount > 0 ? (
              <>
                Nézd át a listát: töröld, ami nem kell, javítsd, ami félrement, és vedd fel, ami
                kimaradt. Innentől a program <b>minden ragozott alakjukat</b> megkeresi — a „Kovács
                Jánosnak”, a „Kováccsal”, a „Kovácsék” és a „K. J.” is meglesz.
              </>
            ) : (
              <>
                Írd be a feleket úgy, ahogy a papíron állnak. A program ebből megkeresi az{' '}
                <b>összes ragozott alakjukat</b>.
              </>
            )}
          </p>
        </div>
        <div className="dialog-body">
          {detectError && (
            <div className="note bad" style={{ marginBottom: 14 }}>
              <b>A felek automatikus felismerése nem sikerült.</b> {detectError} A program ettől még
              használható: írd be a feleket kézzel, a keresés és a csere ugyanúgy működik.
            </div>
          )}

          {detected && (
            <ModelStatusNote
              model={detected.model}
              note={detected.modelNote}
              onOpenSettings={onOpenSettings}
            />
          )}

          <table className="partytable">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Név</th>
                <th style={{ width: '17%' }}>Fajta</th>
                <th style={{ width: '14%' }}>Nem</th>
                <th style={{ width: '27%' }}>Szerep az eljárásban</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="text"
                      value={r.fullName}
                      ref={i === rows.length - 1 ? lastRef : undefined}
                      placeholder={r.kind === 'person' ? 'Kovács János' : 'Aranykalász Agrár Kft.'}
                      onChange={(e) => update(r.id, { fullName: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && i === rows.length - 1) add();
                      }}
                    />
                    {byId.get(r.id) && (
                      <div className="detected">
                        <span>{byId.get(r.id)!.occurrences}× az iratban</span>
                        <span className="ev">— {byId.get(r.id)!.evidence}</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      value={r.kind}
                      onChange={(e) => update(r.id, { kind: e.target.value as PartyInput['kind'] })}
                    >
                      <option value="person">személy</option>
                      <option value="org">szervezet</option>
                      <option value="place">helység</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={r.gender}
                      disabled={r.kind !== 'person'}
                      onChange={(e) => update(r.id, { gender: e.target.value as PartyInput['gender'] })}
                    >
                      <option value="N">—</option>
                      <option value="F">nő</option>
                      <option value="M">férfi</option>
                    </select>
                  </td>
                  <td>
                    <select value={r.role} onChange={(e) => update(r.id, { role: e.target.value })}>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn ghost sm" title="Sor törlése" onClick={() => remove(r.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={add}>
            + Még egy fél
          </button>

          {/*
            AZONOSÍTÓK — külön rovatban, a felek TÁBLÁJA UTÁN.

            Nincs nemük és nincs eljárási szerepük, ezért a felek négyoszlopos
            táblájába csak üres cellákkal fértek volna bele; a valódi baj
            viszont nem a kitöltetlen oszlop, hanem hogy tíz számsor közé
            keverve kellene kikeresni a felperest. A csere sem témás fedőnevet
            ad rájuk, hanem adatfajta-megjelölést az OBH 4/2021. §10(2)
            szerint — ezért a sorban a fajta neve áll, nem egy álnév.
          */}
          {idRows.length > 0 && (
            <div className="idsection">
              <div className="idhead">
                <div>
                  <div className="t">
                    {idRows.length} azonosítót találtunk az iratban
                    <span className="on">{idOnCount} kikerül</span>
                  </div>
                  <div className="s">
                    Ezek nem felek: a helyükre nem fedőnév kerül, hanem az adatfajta megjelölése
                    (»lakcím«, »adószám«). Kapcsold ki azt, aminek bent kell maradnia.
                  </div>
                </div>
                <div className="idacts">
                  <button className="btn ghost sm" onClick={() => setAllIds(false)}>
                    Mind
                  </button>
                  <button className="btn ghost sm" onClick={() => setAllIds(true)}>
                    Egyik sem
                  </button>
                </div>
              </div>

              {idRows.map((r) => {
                const d = idEvidence.get(r.id);
                return (
                  /*
                    A KAPCSOLÓ A SOR JOBB SZÉLÉN ÁLL, nem az elején.

                    Itt korábban jelölőnégyzet volt, a sor bal szélén. A
                    kapcsoló szélesebb nála, és a bal szélre téve minden sor
                    szövege beljebb csúszott volna — a lista pedig épp attól
                    olvasható, hogy az azonosítók egy vonalban kezdődnek.
                    Jobbra téve ugyanaz az elrendezés jön ki, mint a beállító
                    lap csoportfejlécein: szöveg balra, kapcsoló jobbra.
                  */
                  <label key={r.id} className={`idrow${r.skipped ? ' off' : ''}`}>
                    <div className="idmain">
                      <span className="val mono">{r.fullName}</span>
                      <span className="pill kind">{r.role}</span>
                      {d && <span className="occ">{d.occurrences}× az iratban</span>}
                    </div>
                    <div className="idctl">
                      <Kapcsolo
                        id={`idrow-${r.id}`}
                        cimke={`${r.fullName} cseréje`}
                        be={!r.skipped}
                        onValt={() => toggleId(r.id)}
                      />
                    </div>
                    {d && <div className="ev">{d.evidence}</div>}
                  </label>
                );
              })}
            </div>
          )}

          {detected && detected.keepList.length > 0 && (
            <div className="note good" style={{ marginTop: 14 }}>
              <b>Ezek bent maradnak:</b> {detected.keepList.map((k) => k.name).join(', ')}. Az eljáró
              ügyvéd, a bíró és a bíróság neve a Bszi. 166. § (2) szerint nem anonimizálandó — ezért
              fel sem vettük a felek közé.
            </div>
          )}

          <div className="note" style={{ marginTop: 16 }}>
            Az asszonynevet nyugodtan írd teljes alakban: <b>Kovács Jánosné</b> vagy{' '}
            <b>Baloghné Fehér Ilona</b>. A program tudja, hogy ez külön személy, de a férj nevéből
            képződik, és az álnevet is így fogja képezni.
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            Mégse
          </button>
          <button
            className="btn primary"
            disabled={valid.length === 0}
            onClick={() => onSave(valid, idRows)}
          >
            {valid.length} fél
            {idOnCount > 0 && ` és ${idOnCount} azonosító`} mentése és keresés
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── névkészletek ─────────────────────────── */

/**
 * A készletfájlok két mezője, amit a kártyának ismernie kell.
 *
 * A `data/themes/*.json` állományokban ott van mindkettő: a `lang` mondja meg,
 * milyen nyelvűek a nevek, a `family` pedig azt, hogy a magyar és az angol
 * kiadás UGYANANNAK a témának a két változata. A `ThemeSummaryUi` viszont ma
 * még nem sorolja fel őket, ezért olvassuk így — a felsorolás bővítése az
 * `ui/src/api.ts` dolga, ami nem ebben a munkakörben készül. Amint bekerülnek,
 * ez a két segédfüggvény egyszerűsödik, de a viselkedés nem változik.
 */
type KeszletMezok = { lang?: unknown; family?: unknown };

/** A nyelvjelölés az azonosító végén — ez a tartalék, ha a `lang` nem jön át. */
const NYELV_VEG = /[_-](hu|en)$/i;

/**
 * Egy készlet NYELVE.
 *
 * Ha a híd nem küldi a mezőt, az azonosító végéről olvassuk ki: a szállított
 * angol kiadások azonosítója `_en`-re végződik. Enélkül minden készlet
 * magyarnak látszana, a magyar és az angol változat KÜLÖN kártyára kerülne, és
 * a kapcsoló — amiért az egész készült — meg sem jelenne.
 */
function nyelve(t: ThemeSummaryUi): string {
  const mezo = (t as KeszletMezok).lang;
  if (typeof mezo === 'string' && mezo !== '') return mezo;
  const veg = NYELV_VEG.exec(t.id);
  return veg?.[1] ? veg[1].toLowerCase() : 'hu';
}

/**
 * A NYELVFÜGGETLEN csoportkulcs: ezen kerül a magyar és az angol változat
 * ugyanarra a kártyára.
 *
 * Elsőként a `family` mezőt kérdezzük — a készletfájlok ezt viselik. Ha nem jön
 * át, az azonosító végéről vágjuk le a nyelvjelölést; ugyanazt a szűk, felsorolt
 * mintát használva, amit a nyelv kiolvasása is.
 */
function csoportKulcs(t: ThemeSummaryUi): string {
  const csalad = (t as KeszletMezok).family;
  if (typeof csalad === 'string' && csalad !== '') return csalad;
  return t.id.replace(NYELV_VEG, '');
}

const NYELV_CIMKE: Record<string, string> = { hu: 'magyar', en: 'angol' };
const NYELV_SORREND: Record<string, number> = { hu: 0, en: 1 };

/** Egy téma minden nyelvi változata együtt — ennyi tartozik EGY kártyára. */
interface Keszletcsoport {
  kulcs: string;
  valtozatok: ThemeSummaryUi[];
}

function csoportosit(themes: ThemeSummaryUi[]): Keszletcsoport[] {
  const sorrend: string[] = [];
  const tarolo = new Map<string, ThemeSummaryUi[]>();
  for (const t of themes) {
    const alap = csoportKulcs(t);
    const meglevo = tarolo.get(alap);
    if (meglevo && !meglevo.some((x) => nyelve(x) === nyelve(t))) {
      meglevo.push(t);
      continue;
    }
    /*
      Ha ugyanabból a nyelvből kettő érkezne egy témára, a másodiknak SAJÁT
      kártyát nyitunk. A kapcsolóra nyelvenként csak egy fér, egy némán eltűnő
      készlet viszont azt jelentené, hogy a felhasználó hiába gyártotta le. A
      kulcs elé tett vezérlőkarakter nem lehet valódi azonosító, tehát nem
      ütközhet a többivel.
    */
    const kulcs = meglevo ? `\u0000${t.id}` : alap;
    if (tarolo.has(kulcs)) continue;
    tarolo.set(kulcs, [t]);
    sorrend.push(kulcs);
  }
  return sorrend.map((kulcs) => ({
    kulcs,
    valtozatok: (tarolo.get(kulcs) ?? []).sort(
      (a, b) => (NYELV_SORREND[nyelve(a)] ?? 9) - (NYELV_SORREND[nyelve(b)] ?? 9),
    ),
  }));
}

/**
 * A KÁRTYA CÍME — a téma neve, nem a látszó változaté.
 *
 * A szállított angol kiadás neve „… – angol nevek”-re végződik. Ha ezt írnánk
 * ki, a kártya kétszer mondaná ugyanazt (a bekapcsolt „angol” gomb már ott
 * van mellette), és a hosszabb név a 238 képpontos kártyán a végén elvágódna.
 * A csoport első — magyar — változatának a neve viszont a TÉMÁT nevezi meg,
 * ami a nyelvkapcsolótól függetlenül ugyanaz.
 */
function csoportCim(cs: Keszletcsoport, mutatott: ThemeSummaryUi): string {
  return cs.valtozatok[0]?.name ?? mutatott.name;
}

/**
 * A leírás első mondata.
 *
 * A kártyán három sor jut rá; a teljes leírás a lebegő súgóban áll. A vágás
 * MONDATHATÁRON van, nem karakterszámra: a fél mondat úgy néz ki, mintha a
 * program elrontotta volna.
 */
function elsoMondat(s: string): string {
  const pont = s.indexOf('.');
  return pont < 0 ? s : s.slice(0, pont + 1);
}

/**
 * Egy névkészlet kártyája.
 *
 * A kártya NEM `<button>`, pedig az volt: nyelvkapcsoló és törlés is került
 * rá, gombot pedig gombba ágyazni nem szabad — a böngésző az ilyen szerkezetet
 * szétszedi, és onnantól kiszámíthatatlan, melyik kattintás melyikre megy.
 * Ezért `role="radio"`, saját billentyűkezeléssel.
 */
function KeszletKartya({
  csoport,
  mutatott,
  kivalasztott,
  tiltva,
  onValaszt,
  onNyelv,
  onTorolKer,
}: {
  csoport: Keszletcsoport;
  /** A kártyán ÉPPEN látszó nyelvi változat. */
  mutatott: ThemeSummaryUi;
  kivalasztott: boolean;
  /**
   * A kártya MOST NEM DÖNTÉS, csak látvány.
   *
   * Nem fedőnév-módban a névkészletnek nincs hatása a kimenetre. A kártyákat
   * ilyenkor is kirajzoljuk — látni kell, melyik van beállítva —, de nem
   * engedjük megnyomni: egy kattintásra reagáló, majd semmit nem eredményező
   * választás azt hazudná, hogy a döntés érvényesült.
   */
  tiltva?: boolean;
  onValaszt: () => void;
  /** A kártyán kért nyelvi változat — a VÁLTOZAT maga, nem a nyelv kódja. */
  onNyelv: (valtozat: ThemeSummaryUi) => void;
  onTorolKer: () => void;
}) {
  const tobbNyelv = csoport.valtozatok.length > 1;
  const ki = tiltva === true;
  return (
    <div
      className={`themecard${kivalasztott ? ' selected' : ''}${ki ? ' tiltva' : ''}`}
      role="radio"
      aria-checked={kivalasztott}
      /*
        A KÁRTYA NEVE A KÉSZLET NEVE — nem a leírása.

        Enélkül a felolvasott név a `title`, vagyis a készlet több soros
        ismertetője: a felhasználó megtudja, miféle nevek vannak benne, de a
        készlet NEVÉT nem hallja meg — pedig a rács alatti sor, a lépéssáv és a
        törlés megerősítése is azon nevezi. Ugyanaz a döntés, mint a
        mód-kártyán (ui/src/documentSetup.tsx): a `title` `aria-label` mellett
        leírásként marad meg.
      */
      aria-label={csoportCim(csoport, mutatott)}
      aria-disabled={ki}
      /* Letiltva kimarad a Tab-sorrendből: a billentyűzetes felhasználó ne
         álljon meg egy olyan kártyán, amit nem tud megnyomni. */
      tabIndex={ki ? -1 : 0}
      title={mutatott.description}
      {...(ki ? {} : { onClick: onValaszt })}
      onKeyDown={(e) => {
        // Csak a kártya SAJÁT billentyűje választ: a nyelvkapcsoló és a törlés
        // valódi gomb, azoké az Enter és a szóköz.
        if (ki || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onValaszt();
        }
      }}
    >
{/*
        EGY FEJLÉCSOR MINDEN KÁRTYÁN: balra a jelvények, jobbra a nyelvváltó.

        Két dolog került ide, és a kettő NEM egyenrangú, ezért másképp is néz ki:

          JELVÉNY — CÍMKE, hogy MI EZ a kártya („névkészlet”, „saját”). Nem
            megnyomható, halk, csupa kisbetű.
          NYELVVÁLTÓ — VEZÉRLŐ: gomb, amivel a felhasználó dönt.

        Régen a nyelvváltó a kártya közepén, a cím alatt állt, ugyanolyan
        kinézettel, mint a jelvény — a felhasználó nem tudta megkülönböztetni a
        kettőt: egy címkére próbált kattintani, egy gombot pedig felirátnak
        nézett. Fent, egy sorban, a jelvényektől elhúzva ez a kérdés nem merül
        fel, és mind a hat kártya azonos szerkezettel kezdődik.
      */}
      <div className="kartyafej">
        <div className="jelek">
          <span className="kartyajel keszlet">névkészlet</span>
          {/* A saját készletet nyelvi modell javasolta, nem ember nézte át.
              Ez a kártya legfontosabb ténye — jelvényként az első pillantásra
              látszik, nem a leírás első szavaként. */}
          {mutatott.sajat && <span className="kartyajel sajat">saját</span>}
        </div>
        <div className="langsor">
          {tobbNyelv &&
            csoport.valtozatok.map((v) => (
              <button
                key={v.id}
                className={`langchip${v.id === mutatott.id ? ' on' : ''}`}
                aria-pressed={v.id === mutatott.id}
                disabled={ki}
                onClick={(e) => {
                  e.stopPropagation();
                  onNyelv(v);
                }}
              >
                {NYELV_CIMKE[nyelve(v)] ?? nyelve(v)}
              </button>
            ))}
        </div>
      </div>
      <div className="t">
        <span className="nev">{csoportCim(csoport, mutatott)}</span>
        {kivalasztott && <span className="pipa">✓</span>}
        {mutatott.sajat && (
          <button
            className="torol"
            aria-label={`A(z) ${mutatott.name} készlet törlése`}
            title="A készlet törlése"
            disabled={ki}
            onClick={(e) => {
              e.stopPropagation();
              onTorolKer();
            }}
          >
            ✕
          </button>
        )}
      </div>
      {/* A „Saját készlet.” előtag INNEN KIKERÜLT: fent, jelvényként áll, ahol
          a kártya többi ténye is — és ott nem vesz el helyet a leírásból. */}
      <div className="s">{elsoMondat(mutatott.description)}</div>
      <div className="samples">{mutatott.sample.filter(Boolean).join(' · ')}</div>
      {/*
        A KÉSZLET MÉRETE A KÁRTYÁN ÁLL, nem a rács alatt.

        Korábban egy sor volt a rács alatt, és CSAK a kiválasztott készletről
        szólt: a többit összehasonlítani nem lehetett vele. Márpedig épp ez a
        szám az, ami miatt választani érdemes — egy sokszereplős iratban a
        kevés nevű készlet elfogy, és számozott utótaghoz kell nyúlni. A
        kártyán mind a hat egymás mellett látszik.
      */}
      <div className="meret">
        {mutatott.givenCount} keresztnév · {mutatott.surnameCount} vezetéknév
      </div>
    </div>
  );
}

/**
 * A névkészlet-gyártó modell állása — csak annyi, amennyi a kártyára kell.
 */
type GyartoAllas =
  | { fajta: 'kerdez' }
  | { fajta: 'nincs' }
  | { fajta: 'hianyzik'; id: string; meret: string }
  | { fajta: 'kesz' };

/**
 * „Készlet hozzáadása” — a rács utolsó kártyája.
 *
 * A LETÖLTÉS GOMB ITT VAN, nem a Beállításokban. Aki készletet akar gyártani,
 * az itt tudja meg, hogy előbb modellt kell tölteni; ha ilyenkor egy másik
 * ablakba küldenénk, a felhasználó a letöltés végén ott állna, ahová küldtük,
 * és nem ott, ahová indult.
 */
function KeszletHozzaadasKartya({ onIndit, tiltva }: { onIndit: () => void; tiltva?: boolean }) {
  const [allas, setAllas] = useState<GyartoAllas>({ fajta: 'kerdez' });
  const [gyartoId, setGyartoId] = useState<string | null>(null);
  const [halad, setHalad] = useState<DownloadProgress | null>(null);
  const [hiba, setHiba] = useState<string | null>(null);

  const frissit = useCallback(async (): Promise<void> => {
    try {
      const r = await api.listModels();
      const gyarto = r.models.find((m) => m.purpose === 'namegen');
      if (!gyarto) {
        setGyartoId(null);
        setAllas({ fajta: 'nincs' });
        return;
      }
      setGyartoId(gyarto.id);
      setAllas(
        gyarto.state === 'installed'
          ? { fajta: 'kesz' }
          : { fajta: 'hianyzik', id: gyarto.id, meret: fmtMeret(gyarto.totalBytes) },
      );
    } catch (e) {
      setHiba((e as Error).message);
      setAllas({ fajta: 'nincs' });
    }
  }, []);

  useEffect(() => {
    void frissit();
  }, [frissit]);

  /*
    A HALADÁS CSAK A GYÁRTÓ MODELLÉ.

    A csatornán a felismerő modell letöltése is jön. Szűrés nélkül ez a kártya
    egy másik munka százalékát rajzolná ki, vagyis azt állítaná, hogy a
    névkészlet-gyártó tölt — miközben nem is indult el.
  */
  useEffect(() => {
    if (!gyartoId) return;
    return api.onDownloadProgress((p) => {
      if (p.modelId !== gyartoId) return;
      setHalad(p.done ? null : p);
    });
  }, [gyartoId]);

  const letolt = async (id: string): Promise<void> => {
    setHiba(null);
    // Azonnal jelzünk, mert az első haladásüzenetig másodpercek telnek el, és
    // addig a gomb úgy néz ki, mintha nem történt volna semmi.
    setHalad({ modelId: id, file: '', receivedBytes: 0, totalBytes: 1, ratio: 0, done: false });
    try {
      await api.downloadModel(id);
      await frissit();
    } catch (e) {
      setHiba((e as Error).message);
    } finally {
      setHalad(null);
    }
  };

  const szazalek = Math.round((halad?.ratio ?? 0) * 100);
  // Nem fedőnév-módban ez a kártya sem döntés: egy percekig tartó gyártást
  // olyankor indítani, amikor a készletnek nincs hatása a kimenetre, épp azt
  // a fölösleges munkát jelentené, amit a lap magyarázata kizár.
  const ki = tiltva === true;

  return (
    <div className={`themecard addcard${ki ? ' tiltva' : ''}`} aria-disabled={ki}>
      <div className="kartyafej">
        <div className="jelek">
          <span className="kartyajel keszlet">névkészlet</span>
          {/* AMI A KÁRTYA LÉNYEGES TÉNYE: ehhez előbb tölteni kell. Jelvényként
              az első pillantásra látszik, nem a gomb feliratából derül ki. */}
          {allas.fajta === 'hianyzik' && <span className="kartyajel letoltes">letöltés</span>}
        </div>
        <div className="langsor" />
      </div>
      <div className="t">
        <span className="nev">Készlet hozzáadása</span>
      </div>
      <div className="s">
        Írd be, milyen témájú neveket szeretnél („görög mitológia”), és a program legyárt hozzá
        egy készletet. Jóváhagyás után itt, ebben a rácsban áll majd.
      </div>
      <div className="cardact">
        {allas.fajta === 'kerdez' && <span className="hint">A gyártó modell keresése…</span>}

        {allas.fajta === 'kesz' && !halad && (
          <button className="btn primary sm" disabled={ki} onClick={onIndit}>
            Új készlet…
          </button>
        )}

        {allas.fajta === 'hianyzik' && !halad && (
          <>
            {/* A MÉRET KÜLÖN SORBA. Egy szűk kártyán a „Modell letöltése (2,7
                GB)” a zárójel közepén tört el — a „GB)” önmagában maradt a
                második soron. A méret nem a felirat része, hanem adat mellette. */}
            <button className="btn primary sm tordelt" disabled={ki} onClick={() => void letolt(allas.id)}>
              <span>Modell letöltése</span>
              <span className="meret">{allas.meret}</span>
            </button>
            <span className="hint">Egyszeri letöltés; a gyártás utána a gépen megy.</span>
          </>
        )}

        {halad && (
          <>
            <div className="progress sm">
              <div className="bar" style={{ width: `${szazalek}%` }} />
              <span className="ptext">{szazalek}%</span>
            </div>
            {/* A százalék önmagában nem mondja meg, MI tölt. A Beállításokban
                egyszerre több modell is letölthető, és a kártya csak a
                gyártóét mutatja — ezt ki kell mondani. */}
            <span className="hint">A névkészlet-gyártó modell letöltése.</span>
            <button className="btn sm" onClick={() => void api.cancelDownload()}>
              Megszakítás
            </button>
          </>
        )}

        {allas.fajta === 'nincs' && !hiba && (
          <span className="hint">
            Ehhez a programváltozathoz nem tartozik névkészlet-gyártó modell.
          </span>
        )}
        {hiba && <span className="hint amber">{hiba}</span>}
      </div>
    </div>
  );
}

/* ─────────────────────── a felismerő modell a lapon ─────────────────────── */

/**
 * A NYELVI MODELL SÁVJA — a csere lapján, nem a Beállításokban.
 *
 * A modell nélkül a program csak azokat a neveket találja meg, amiket az irat
 * kifejezetten megnevez („Felperes:", „anyja neve:", cégforma) — a folyó
 * szövegben elszórt tanúnevekre nem keres rá. Ez nem lábjegyzet, hanem a
 * felismerés minőségének megváltozása, és pont ezen a lapon derül ki: itt
 * nézi át a felhasználó, mit talált a program.
 *
 * EDDIG INNEN NEM LEHETETT KEZELNI. Aki üres vagy rövid listát látott, a
 * Beállításokba lett küldve letölteni, onnan vissza, és a vizsgálatot még
 * egyszer el kellett indítania. Innentől mind a három lépés itt van: a
 * dokumentum nyelve szerinti modellválasztás, a letöltés és az indítás.
 *
 * A NYELVVÁLASZTÁS A DOKUMENTUM NYELVE, nem a felületé. Magyar iraton a
 * magyar felismerő a pontosabb és nagyságrenddel gyorsabb; angol vagy vegyes
 * nyelvű iraton az kevesebbet talál meg, ott a többnyelvű való.
 */
export function FelismeroSav({
  fut,
  felirat,
  onVizsgalat,
}: {
  /** Éppen tart a vizsgálat: ilyenkor nincs mit indítani, és nincs mit tölteni. */
  fut: boolean;
  /**
   * A vizsgálatgomb felirata — a HÍVÓ mondja meg, mert csak ő tudja, futott-e
   * már vizsgálat. Két különböző felirat ugyanarra a műveletre („Vizsgálat
   * indítása" itt, „Vizsgálat újra" a lista kiútjai közt) azt kérdeztette a
   * felhasználóval, mi a különbség — semmi.
   */
  felirat: string;
  onVizsgalat: () => void;
}) {
  const [modellek, setModellek] = useState<ModelStatus[]>([]);
  const [aktiv, setAktiv] = useState<string>('');
  const [halad, setHalad] = useState<DownloadProgress | null>(null);
  const [hiba, setHiba] = useState<string | null>(null);

  const frissit = useCallback(async (): Promise<void> => {
    try {
      const [r, s] = await Promise.all([api.listModels(), api.getSettings()]);
      setModellek(r.models.filter((m) => m.purpose === 'detect'));
      setAktiv(s.modelId);
    } catch (e) {
      setHiba((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void frissit();
  }, [frissit]);

  /*
    A HALADÁS CSAK A FELISMERŐ MODELLEKÉ.

    A csatornán a névkészlet-gyártó letöltése is jön. Szűrés nélkül ez a sáv
    egy másik munka százalékát rajzolná ki — vagyis azt állítaná, hogy a
    felismerő tölt, miközben el sem indult.
  */
  useEffect(() => {
    const felismerok = new Set(modellek.map((m) => m.id));
    return api.onDownloadProgress((p) => {
      if (!felismerok.has(p.modelId)) return;
      setHalad(p.done ? null : p);
    });
  }, [modellek]);

  const valaszt = async (id: string): Promise<void> => {
    setAktiv(id);
    try {
      await api.setSettings({ modelId: id });
    } catch (e) {
      setHiba((e as Error).message);
    }
  };

  const letolt = async (id: string): Promise<void> => {
    setHiba(null);
    // Azonnal jelzünk: az első haladásüzenetig másodpercek telnek el, és addig
    // a gomb úgy néz ki, mintha nem történt volna semmi.
    setHalad({ modelId: id, file: '', receivedBytes: 0, totalBytes: 1, ratio: 0, done: false });
    try {
      await api.downloadModel(id);
      await frissit();
    } catch (e) {
      setHiba((e as Error).message);
    } finally {
      setHalad(null);
    }
  };

  const most = modellek.find((m) => m.id === aktiv) ?? modellek[0];
  if (!most) return null;
  const szazalek = Math.round((halad?.ratio ?? 0) * 100);

  return (
    <div className={`modellsav${most.state === 'installed' ? '' : ' hianyzik'}`}>
      <div className="t">Nyelvi modell</div>
      {/*
        A VÁLASZTÁS A DOKUMENTUM NYELVE SZERINT MEGY, nem modellnév szerint: a
        felhasználó az iratot ismeri, nem a modelleket. A modell neve és
        mérete a buboréksúgóban áll.
      */}
      <div className="seg sm" role="group" aria-label="A dokumentum nyelve">
        {modellek.map((m) => (
          <button
            key={m.id}
            className={`segbtn${m.id === most.id ? ' active' : ''}`}
            aria-pressed={m.id === most.id}
            disabled={halad !== null || fut}
            title={`${m.name} — ${fmtMeret(m.totalBytes)}`}
            onClick={() => void valaszt(m.id)}
          >
            {m.languages.includes('hu') && m.languages.length <= 2 ? 'magyar irat' : 'más nyelvű irat'}
          </button>
        ))}
      </div>

      <div className="allapot">
        {halad ? (
          <>
            <div className="progress sm">
              <div className="bar" style={{ width: `${szazalek}%` }} />
              <span className="ptext">{szazalek}%</span>
            </div>
            <button className="btn sm ghost" onClick={() => void api.cancelDownload()}>
              Megszakítás
            </button>
          </>
        ) : most.state === 'installed' ? (
          <>
            <span className="jo">letöltve</span>
            <button className="btn sm" disabled={fut} onClick={onVizsgalat}>
              {fut ? 'A vizsgálat fut…' : felirat}
            </button>
          </>
        ) : (
          <>
            {/* MI HIÁNYZIK ÉS MI A KÖVETKEZMÉNYE — egy mondatban. Enélkül a
                letöltés gomb csak egy nagy fájlt kérne a felhasználótól, ok
                nélkül. */}
            <span className="amber">
              nincs letöltve — csak a rovatokból („Felperes:”, „anyja neve:”) találunk neveket
            </span>
            {/* A méret külön sorba: a „Letöltés (421 MB)” a zárójel közepén
                tört el a szűk panelen. */}
            <button
              className="btn sm primary tordelt"
              disabled={fut}
              onClick={() => void letolt(most.id)}
            >
              <span>Letöltés</span>
              <span className="meret">{fmtMeret(most.totalBytes)}</span>
            </button>
          </>
        )}
      </div>
      {hiba && <div className="hiba">{hiba}</div>}
    </div>
  );
}

/**
 * A NÉVKÉSZLETEK KÁRTYÁS RÁCSA.
 *
 * Ez volt a `ThemeDialog` törzse, és azért lett önálló, kirakható darab, mert a
 * választás helye megváltozott: a fejléc külön ablaka helyett a beállító lap
 * egyik füle. A rács maga viszont ugyanaz maradt — a kártyák egyforma
 * magasak, mintanevekkel, kártyánkénti nyelvkapcsolóval és a hozzáadó kártyával
 * a végén. Újraírva a két hely előbb-utóbb két különböző kinézetet adna
 * ugyanarra a döntésre, és épp ezt a kettősséget szüntettük meg.
 *
 * AMI KIMARADT BELŐLE: az „Ezt választom” gomb. Párbeszédben kellett, mert ott
 * a Mégse is ott állt, és a kettő együtt adta a döntés bezárását. Egy fülön
 * nincs mit bezárni: a kattintás MAGA a döntés, és a bal oldali iratnézet
 * azonnal meg is mutatja a következményét. Egy külön megerősítő gomb itt csak
 * annyit tenne, hogy a felhasználó választ, aztán nem érti, miért nem történt
 * semmi.
 */
export function NevkeszletRacs({
  themes,
  selected,
  elotte,
  onPick,
  onNewCustom,
  onRemoveCustom,
}: {
  themes: ThemeSummaryUi[];
  /**
   * Az ÉPPEN ÉRVÉNYES készlet azonosítója — az egyetlen forrás.
   *
   * ÜRES SZÖVEG: egyetlen készlet sincs kiválasztva. Ez nem hibaállapot: a
   * beállító lapon a címkés módok ugyanennek a rácsnak a kártyái, és ha
   * azok közül áll valamelyiken a választás, egy készleten sem szabad pipának
   * lennie — két pipa két egymást kizáró döntésen azt jelentené, hogy mindkettő
   * érvényes.
   */
  selected: string;
  /**
   * Kártyák a készletek ELŐTT, UGYANEBBEN a rácsban.
   *
   * A `tiltva` prop helyére jött, és pontosan azt a bajt szünteti meg, amiért
   * az kellett: a csere-módot eddig egy MÁSIK rács döntötte el, és amíg nem
   * fedőnév-mód volt érvényben, ez a rács letiltva, halványan állt ott. Ma a
   * címkés módok kártyái ide kerülnek be, ugyanabba a `radiogroup`-ba —
   * egyetlen döntés, egyetlen rács, egyetlen billentyűzetes bejárás.
   */
  elotte?: React.ReactNode;
  onPick: (id: string) => void;
  /** „Készlet hozzáadása” — a téma megadásának ablaka nyílik meg. */
  onNewCustom: () => void;
  onRemoveCustom: (id: string) => void;
}) {
  const csoportok = useMemo(() => csoportosit(themes), [themes]);
  // A törlés KÉTLÉPÉSES, és a megerősítés itt, a rács alatt áll — nem külön
  // ablakban. Egy legyártott készlet percekbe telt, és a modell másodszor nem
  // ugyanazokat a neveket javasolja: ami elveszik, az nem állítható vissza.
  const [torles, setTorles] = useState<string | null>(null);

  /*
    A NYELV KÁRTYÁNKÉNT KÜLÖN ÁLL, DE CSAK A NEM VÁLASZTOTTAKON.

    A felhasználó több készlet angol változatát is megnézheti, mielőtt választ,
    és attól még nem cserélődik ki, amivel az irat készül. A KIVÁLASZTOTT
    kártyán viszont nincs mit tárolni: ott a `selected` maga mondja meg, melyik
    változat érvényes, és a nyelvkapcsoló azonnal átállítja. Így a kártyán
    látszó név és az iratba kerülő nevek nem csúszhatnak szét — ami két külön
    tárolóval előbb-utóbb megtörténne.
  */
  const [nyelvek, setNyelvek] = useState<Record<string, string>>({});

  const valasztott = themes.find((t) => t.id === selected);
  const valasztottKulcs = valasztott ? csoportKulcs(valasztott) : '';

  const mutatottja = (cs: Keszletcsoport): ThemeSummaryUi | undefined => {
    if (valasztott && cs.kulcs === valasztottKulcs) return valasztott;
    const kert = nyelvek[cs.kulcs];
    if (kert !== undefined) {
      const v = cs.valtozatok.find((x) => nyelve(x) === kert);
      if (v) return v;
    }
    return cs.valtozatok[0];
  };

  const torlendo = themes.find((t) => t.id === torles);

  return (
    <>
      <div className="themegrid compact" role="radiogroup" aria-label="Mi kerüljön a nevek helyére">
        {elotte}
        {csoportok.map((cs) => {
          const m = mutatottja(cs);
          if (!m) return null;
          return (
            <KeszletKartya
              key={cs.kulcs}
              csoport={cs}
              mutatott={m}
              kivalasztott={cs.kulcs === valasztottKulcs}
              onValaszt={() => {
                setTorles(null);
                onPick(m.id);
              }}
              /*
                A nyelvkapcsoló a KIVÁLASZTOTT kártyán azonnal hat — ott a
                nyelv és a választás ugyanaz a döntés. Egy másik kártyán
                megnézni való: a böngészés nem állíthatja át némán azt,
                amivel az irat készül.
              */
              onNyelv={(v) => {
                setTorles(null);
                if (cs.kulcs === valasztottKulcs) onPick(v.id);
                else setNyelvek((elozo) => ({ ...elozo, [cs.kulcs]: nyelve(v) }));
              }}
              /*
                A törlés kérése NEM VÁLASZT. A megerősítő sáv névvel mondja
                meg, mit dob el; ha közben átállítanánk a választást is, a
                „Mégsem törlöm” után a felhasználó egy másik készlettel
                állna ott, mint amivel a törlés előtt.
              */
              onTorolKer={() => setTorles(m.id)}
            />
          );
        })}
        {/*
          A HOZZÁADÁS ugyanabban a rácsban áll, mint a többi, mert ugyanaz a
          döntés: melyik nevekre cseréljünk. Külön gombként a lap alján az
          volna az üzenete, hogy ez valami haladó, ritka dolog — pedig egy
          ügyvédnek épp az a kényelmes, ha az iratai nem mind ugyanabból a
          néhány készletből kapják a fedőneveket.
        */}
        <KeszletHozzaadasKartya onIndit={onNewCustom} />
      </div>

      {torlendo ? (
        <div className="note bad" style={{ marginTop: 12 }}>
          <b>Törlöd a(z) „{torlendo.name}” készletet?</b> A legyártott nevek elvesznek, és a modell
          másodszor nem ugyanazokat javasolja. Ha egy korábbi iratot ezzel a készlettel
          álnevesítettél, a kulcsfájl attól még megmarad — de új iratot ezekkel a nevekkel többé
          nem tudsz készíteni. A törlés nem vonható vissza.
          <div className="ds-ways" style={{ marginTop: 10 }}>
            <button className="btn sm ghost" onClick={() => setTorles(null)}>
              Mégsem törlöm
            </button>
            <button
              className="btn sm primary"
              onClick={() => {
                onRemoveCustom(torlendo.id);
                setTorles(null);
              }}
            >
              Igen, törlöm
            </button>
          </div>
        </div>
      ) : (
        valasztott && (
          <>
            {/* A KÉSZLET MÉRETE A KÁRTYÁRA KÖLTÖZÖTT: ott mind a hat összemérhető,
                itt csak a kiválasztottról szólt volna. Ami maradt: a saját
                gyártású készlet figyelmeztetése — az nem adat, hanem teendő. */}
            {valasztott.sajat && (
              <div className="note" style={{ marginTop: 10 }}>
                <b>Ezt a készletet nyelvi modell javasolta.</b> A program a magyar helyesírást, a
                ragozhatóságot és a valódi magyar nevekkel való ütközést ellenőrizte, azt viszont
                nem tudta megnézni, hogy egy név védjegy vagy szerzői jogi oltalom alatt álló műből
                származik-e. Kiadott iraton csak akkor használd, ha ezt magad átnézted.
              </div>
            )}
          </>
        )
      )}
    </>
  );
}

/* ──────────────────── saját névkészlet gyártása ──────────────────── */

/**
 * Hol tart a saját készlet elkészítése.
 *
 *  - 'ellenoriz'   megnézzük, le van-e töltve a gyártó modell
 *  - 'nincs_modell' nincs letöltve: itt nem hibázunk, hanem elvezetünk oda
 *  - 'tema'        a felhasználó beírja a témát
 *  - 'gyart'       a modell dolgozik (percek)
 *  - 'atnez'       a kész készlet JÓVÁHAGYÁS ELŐTT, ragozott alakokkal
 */
type SajatLepes = 'ellenoriz' | 'nincs_modell' | 'tema' | 'gyart' | 'atnez';

/** Az elutasítás okai csoportosítva — a lista így nem foly össze. */
const ELUTASITAS_CIM: Record<string, string> = {
  ures: 'üres javaslat',
  nem_magyar_betuk: 'nem magyar betű van benne',
  nincs_maganhangzo: 'nincs benne magánhangzó',
  tul_rovid: 'túl rövid',
  tul_hosszu: 'túl hosszú',
  ismetlodes: 'ismétlődés',
  valodi_nev: 'valódi, gyakori magyar név',
  nem_nelkul: 'hiányzik a neme',
  ket_nemben: 'két nemben is szerepelt',
  utonev_es_vezeteknev: 'utónévként és vezetéknévként is szerepelt',
  ragozhatatlan: 'nem ragozható',
};

const CSOPORT_CIM: Record<EllenorzottNev['csoport'], string> = {
  given: 'Utónevek',
  surname: 'Vezetéknevek',
  org: 'Cégnév-előtagok',
  place: 'Helységnevek',
};

/**
 * Egy ellenőrzött név a jóváhagyó listában, a ragozott alakjaival.
 *
 * A RAGOZOTT ALAKOK NEM DÍSZEK. A modell a neveket javasolta, a toldalékolást
 * viszont a program saját motorja tette hozzá — és van néhány eset (idegen
 * szóvég, kiejtésfüggő hangrend), ahol a helyes alak a KIEJTÉSEN múlik, amit a
 * helyesírásból nem lehet levezetni. Ilyenkor a program a gyakoribbat
 * választja, de tévedhet, és ez az irat minden mondatában látszana. Ezért
 * kerül a felhasználó szeme elé, mielőtt bármit elmentenénk.
 */
function NevSor({ n }: { n: EllenorzottNev }) {
  return (
    <tr>
      <td className="pseudo">
        {n.form}
        {n.gender === 'M' ? ' (férfi)' : n.gender === 'F' ? ' (női)' : ''}
      </td>
      <td>
        {n.mutatvany.map((m) => (
          <div key={m.eset}>
            <span style={{ color: 'var(--muted)' }}>{m.cimke}: </span>
            {m.alak}
          </div>
        ))}
      </td>
      <td style={{ color: n.kiejtesFuggo ? 'var(--amber)' : 'var(--muted)', fontSize: 12 }}>
        {n.kiejtesFuggo ? n.notes || 'A ragozás tippen alapul — nézd át.' : n.notes}
      </td>
    </tr>
  );
}

export function SajatKeszletDialog({
  onOpenSettings,
  onSaved,
  onClose,
}: {
  /** A gyártó modell letöltéséhez: a Beállítások → Nyelvi modellek lapra visz. */
  onOpenSettings: () => void;
  /** A frissült készletlista és az imént elmentett készlet azonosítója. */
  onSaved: (themes: ThemeSummaryUi[], id: string) => void;
  onClose: () => void;
}) {
  const [lepes, setLepes] = useState<SajatLepes>('ellenoriz');
  const [tema, setTema] = useState('');
  const [modellNev, setModellNev] = useState('');
  const [modellMeret, setModellMeret] = useState('');
  const [allapot, setAllapot] = useState<TemaGenStatus | null>(null);
  const [eredmeny, setEredmeny] = useState<TemaEredmeny | null>(null);
  const [hiba, setHiba] = useState<string | null>(null);
  const [mentes, setMentes] = useState(false);

  /*
    A MODELL ÁLLAPOTÁT ELŐRE MEGNÉZZÜK, nem a gyártás közben.

    Enélkül a felhasználó beírná a témát, rákattintana a gyártásra, és csak
    utána tudná meg, hogy előbb 2,7 GB-ot le kell töltenie. A sorrend nem
    kényelmi kérdés: a hibaüzenet a munka UTÁN érkezik, a tájékoztatás előtte.
  */
  useEffect(() => {
    let el = true;
    void api
      .listModels()
      .then((r) => {
        if (!el) return;
        const gyarto = r.models.find((m) => m.purpose === 'namegen');
        if (!gyarto) {
          setHiba(
            'Ehhez a programváltozathoz nem tartozik névkészlet-gyártó modell, ezért saját ' +
              'készletet nem lehet legyártani. A programmal szállított készletek működnek.',
          );
          setLepes('nincs_modell');
          return;
        }
        setModellNev(gyarto.name);
        setModellMeret(fmtMeret(gyarto.totalBytes));
        setLepes(gyarto.state === 'installed' ? 'tema' : 'nincs_modell');
      })
      .catch((e: Error) => {
        if (!el) return;
        setHiba(e.message);
        setLepes('nincs_modell');
      });
    return () => {
      el = false;
    };
  }, []);

  // A gyártás percekbe telik, csoportonként. A haladást a főfolyamat üzeni meg;
  // enélkül a felhasználó egy mozdulatlan pörgőt nézne, és azt hinné, megállt.
  useEffect(() => api.onThemeGenStatus((s) => setAllapot(s)), []);

  const gyart = async (): Promise<void> => {
    setHiba(null);
    setAllapot({ uzenet: 'A modell indítása…', lepes: 0, lepesek: 4 });
    setLepes('gyart');
    try {
      const r = await api.generateTheme(tema);
      setEredmeny(r);
      setLepes('atnez');
    } catch (e) {
      setHiba((e as Error).message);
      setLepes('tema');
    }
  };

  const ment = async (): Promise<void> => {
    setHiba(null);
    setMentes(true);
    try {
      const lista = await api.saveGeneratedTheme();
      const id = eredmeny?.theme?.id ?? '';
      onSaved(lista, id);
    } catch (e) {
      setHiba((e as Error).message);
    } finally {
      setMentes(false);
    }
  };

  const jelentes = eredmeny?.jelentes;

  return (
    <Overlay onClose={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Készlet hozzáadása</h2>
          <p>
            Írd be, milyen témájú fedőneveket szeretnél. A neveket egy nyelvi modell javasolja, a
            magyar ragozást viszont a program saját motorja adja hozzá — és a kész készletet
            jóváhagyás előtt megmutatjuk. Mentés után a névkészletek rácsában áll majd, a
            többivel egy sorban.
          </p>
        </div>

        <div className="dialog-body">
          {hiba && <div className="note bad">{hiba}</div>}

          {lepes === 'ellenoriz' && <p className="hint">A gyártó modell keresése…</p>}

          {/*
            NEM HIBAÜZENET, HANEM ÚTMUTATÁS.

            A hiányzó modell nem a felhasználó tévedése: úgy döntöttünk, hogy a
            nyelvi modellek nem a telepítővel érkeznek. Ilyenkor az a dolgunk,
            hogy megmondjuk, mi hiányzik, mekkora, és hol lehet elindítani —
            nem az, hogy közöljük a kudarcot.
          */}
          {lepes === 'nincs_modell' && !hiba && (
            <>
              <div className="note">
                <b>Ehhez előbb le kell tölteni a névkészlet-gyártó modellt.</b> Ez a modell{' '}
                <b>nem az iratot olvassa</b>: csak neveket javasol a beírt témához. A kitakarásra
                nincs hatással, és a programmal szállított négy készlet nélküle is működik.
                {modellMeret && (
                  <>
                    {' '}
                    A letöltés <b>{modellMeret}</b>, egyszeri; utána a gyártás is offline megy.
                  </>
                )}
              </div>
              {modellNev && (
                <p className="hint">
                  A modell neve a listában: <b>{modellNev}</b>.
                </p>
              )}
              <div style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={onOpenSettings}>
                  Ugrás a letöltéshez
                </button>
              </div>
            </>
          )}

          {lepes === 'tema' && (
            <>
              <div className="field">
                <label htmlFor="sajat-tema">Milyen témájú neveket szeretnél?</label>
                <input
                  id="sajat-tema"
                  type="text"
                  value={tema}
                  autoFocus
                  placeholder="görög mitológia"
                  onChange={(ev) => setTema(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' && tema.trim().length >= 3) void gyart();
                  }}
                />
                <span className="hint">
                  Néhány szó elég: „görög mitológia", „csillagképek", „fűszernövények". A modell
                  ebből javasol utóneveket, vezetékneveket, cégnév-előtagokat és helységneveket.
                </span>
              </div>
              <div className="note">
                <b>A gyártás percekbe telik.</b> A modell mindegyik csoporton külön végigmegy, és
                mielőtt válaszol, magában végigfut a feladaton. Közben a program használható
                marad, de ez az ablak addig nyitva kell maradjon.
              </div>
            </>
          )}

          {lepes === 'gyart' && (
            <>
              <div className="progress">
                <div
                  className="bar"
                  style={{
                    width: `${Math.round((((allapot?.lepes ?? 0) / (allapot?.lepesek || 4)) * 100))}%`,
                  }}
                />
                <div className="ptext">
                  {allapot?.lepes ? `${allapot.lepes}. lépés a(z) ${allapot.lepesek}-ből` : 'Indul…'}
                </div>
              </div>
              <p className="hint">
                <span className="spinner" style={{ display: 'inline-block', verticalAlign: -3 }} />{' '}
                {allapot?.uzenet ?? 'A modell dolgozik…'}
              </p>
            </>
          )}

          {lepes === 'atnez' && jelentes && (
            <>
              {/*
                A FIGYELMEZTETÉSEK ELŐBB ÁLLNAK, MINT A NEVEK. Aki csak a
                listát nézi végig, azt hiszi, kész munkát lát — pedig épp az a
                dolga, hogy ellenőrizzen. A sorrend maga is üzenet.
              */}
              {!jelentes.hasznalhato && (
                <div className="note bad">
                  <b>Ez a készlet így még nem használható.</b> Kevés név ment át az ellenőrzésen.
                  Próbáld meg bővebb témával („görög mitológia istenei és hősei"), vagy futtasd le
                  még egyszer — a modell másodszor más neveket javasol.
                </div>
              )}
              {jelentes.figyelmeztetesek.map((f, i) => (
                <div className="warnitem" key={i}>
                  {f}
                </div>
              ))}

              {jelentes.hianyok.length > 0 && (
                <div className="note" style={{ marginTop: 10 }}>
                  <b>Ami hiányzik:</b>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {jelentes.hianyok.map((h, i) => (
                      <li key={i}>{h.uzenet}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="findings">
                <div className="findhead">
                  <span>
                    {jelentes.elfogadva.length} név ment át — a ragozást a program készítette
                  </span>
                  <span className="cut">
                    {jelentes.javaslatokSzama} javaslatból, {jelentes.elutasitva.length} kiesett
                  </span>
                </div>
                {(['given', 'surname', 'org', 'place'] as const).map((cs) => {
                  const sorok = jelentes.elfogadva.filter((n) => n.csoport === cs);
                  if (sorok.length === 0) return null;
                  return (
                    <div key={cs} style={{ marginBottom: 14 }}>
                      <div className="fieldlabel">
                        {CSOPORT_CIM[cs]} ({sorok.length})
                      </div>
                      <table className="keytable">
                        <thead>
                          <tr>
                            <th>Név</th>
                            <th>Ragozott alakok</th>
                            <th>Megjegyzés</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorok.map((n) => (
                            <NevSor key={`${cs}-${n.form}`} n={n} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>

              {jelentes.elutasitva.length > 0 && (
                <div className="findings">
                  <div className="findhead">
                    <span>Amit a program kidobott ({jelentes.elutasitva.length})</span>
                  </div>
                  {/* A kidobás INDOKLÁSSAL áll, mert ebből látszik, hogy az
                      ellenőrzés dolgozott — és mert egy „valódi név" indoklás
                      azt is elárulja, hogy a téma túl közel van a magyar
                      köznevekhez, tehát érdemes mást választani. */}
                  <table className="keytable">
                    <tbody>
                      {jelentes.elutasitva.map((r, i) => (
                        <tr key={`${r.form}-${i}`}>
                          <td className="orig">{r.form}</td>
                          <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {ELUTASITAS_CIM[r.ok] ?? r.ok}
                          </td>
                          <td style={{ fontSize: 12 }}>{r.indoklas}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            {lepes === 'atnez' ? 'Elvetem' : 'Mégse'}
          </button>
          {lepes === 'tema' && (
            <button className="btn primary" disabled={tema.trim().length < 3} onClick={() => void gyart()}>
              Készlet legyártása
            </button>
          )}
          {lepes === 'atnez' && (
            <>
              <button className="btn" onClick={() => setLepes('tema')}>
                Új téma
              </button>
              <button
                className="btn primary"
                disabled={!jelentes?.hasznalhato || mentes}
                title={
                  jelentes?.hasznalhato
                    ? undefined
                    : 'Kevés név ment át az ellenőrzésen: ebből a program számozott álneveket gyártana, és az az iratban látszana.'
                }
                onClick={() => void ment()}
              >
                {mentes ? 'Mentés…' : 'Átnéztem, elmentem'}
              </button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/**
 * Bájt emberi alakban.
 *
 * A tizedesjel MAGYARUL VESSZŐ: a „2.7 GB" angolul olvasható, magyarul
 * ezredes tagolásnak látszik. A `toLocaleString` a magyar területi beállítást
 * kapja meg, nem a gépét — a program magyar szöveget ír, akármilyen Windowson
 * fut.
 */
function fmtMeret(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024).toLocaleString('hu-HU')} kB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024)).toLocaleString('hu-HU')} MB`;
  return `${(n / (1024 * 1024 * 1024)).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} GB`;
}

/* ─────────────────────────── frissítés ─────────────────────────── */

/**
 * A frissítés ablaka: keresés → van új / naprakész → letöltés → újraindítás.
 *
 * AMIÉRT A CÍM ITT ÁLLÍTHATÓ, ÉS NEM CSAK A BEÁLLÍTÁSOKBAN: a felhasználó
 * ebből az ablakból tudja meg, hogy a frissítés nincs bekapcsolva. Ha a
 * bekapcsolás máshol volna, az ablak zsákutca lenne — közölné a bajt, és
 * elküldené keresgélni. Az a mondat, ami megnevezi a hiányt, ugyanott áll,
 * ahol a hiány megszüntethető.
 */
export function UpdateDialog({
  vanMunka,
  onClose,
}: {
  /** Van-e el nem mentett munka: a telepítés bezárja a programot. */
  vanMunka: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [cim, setCim] = useState('');
  const [szerkeszt, setSzerkeszt] = useState(false);
  const [hiba, setHiba] = useState<string | null>(null);
  const [dolgozik, setDolgozik] = useState(false);
  /**
   * FOLYIK-E ÉPP A LETÖLTÉS — a felület saját jelzése, nem a főfolyamaté.
   *
   * A `downloadUpdate()` hívás CSAK A VÉGÉN tér vissza, tehát a főfolyamat
   * 》downloading《 fázisa a felületre soha nem érkezik meg időben: mire
   * megkapnánk, már 》ready《. Ha a folyamatjelzőt arra a fázisra kötnénk, a
   * felhasználó több száz megabájt letöltése alatt egy mozdulatlan ablakot
   * nézne, és azt hinné, hogy a gomb nem csinált semmit. Ezért a letöltés
   * tényét itt tartjuk számon; a HALADÁST viszont továbbra is a főfolyamat
   * üzenetei adják.
   */
  const [tolt, setTolt] = useState(false);

  useEffect(() => {
    let el = true;
    void api
      .updateState()
      .then((s) => {
        if (!el) return;
        setState(s);
        setCim(s.feedUrl);
      })
      .catch((e: Error) => el && setHiba(e.message));
    return () => {
      el = false;
    };
  }, []);

  useEffect(() => api.onUpdateProgress((p) => setProgress(p)), []);

  const fut = async (mit: () => Promise<UpdateState>): Promise<void> => {
    setHiba(null);
    setDolgozik(true);
    try {
      setState(await mit());
    } catch (e) {
      setHiba((e as Error).message);
    } finally {
      setDolgozik(false);
    }
  };

  const mentCim = async (): Promise<void> => {
    await fut(() => api.setUpdateFeed(cim));
    setSzerkeszt(false);
  };

  const letolt = async (): Promise<void> => {
    setHiba(null);
    setProgress(null);
    setTolt(true);
    try {
      setState(await api.downloadUpdate());
    } catch (e) {
      setHiba((e as Error).message);
    } finally {
      setTolt(false);
    }
  };

  const fazis = state?.phase ?? 'idle';
  const beallitva = (state?.feedUrl ?? '') !== '';
  // A címet akkor mutatjuk beírhatóan, ha nincs beállítva, vagy ha a
  // felhasználó rákattintott a módosításra. Egy mindig nyitott szövegmező azt
  // sugallná, hogy ezt rendszeresen át kell írni — pedig egyszer kell.
  const cimLatszik = szerkeszt || !beallitva;

  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Frissítés keresése</h2>
          <p>
            A program a saját gépeden fut, és magától soha nem keres frissítést — csak akkor, ha
            ezt megnyitod.
          </p>
        </div>

        <div className="dialog-body">
          {hiba && <div className="note bad">{hiba}</div>}

          {state && (
            <div className="resultrow">
              <span>A most futó verzió</span>
              <span className="v">{state.currentVersion}</span>
            </div>
          )}

          {/* A HELYZET EGY MONDATBAN. A mondatot a főfolyamat fogalmazza meg,
              mert csak ő tudja, mi történt: a beállítatlanság, a hálózati hiba
              és a naprakészség itt egy helyen, ugyanolyan hangsúllyal áll. */}
          {state && state.uzenet && (
            <div
              className={
                fazis === 'available' || fazis === 'ready'
                  ? 'note good'
                  : fazis === 'failed'
                    ? 'note bad'
                    : 'note'
              }
              style={{ marginTop: 12 }}
            >
              {state.uzenet}
            </div>
          )}

          {state && state.notes && (
            <div className="findings">
              <div className="findhead">
                <span>Mi változott a(z) {state.newVersion} verzióban</span>
              </div>
              <p className="hint" style={{ whiteSpace: 'pre-wrap' }}>
                {state.notes}
              </p>
            </div>
          )}

          {(tolt || fazis === 'downloading') && (
            <>
              <div className="progress" style={{ marginTop: 12 }}>
                <div className="bar" style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }} />
                <div className="ptext">
                  {progress?.totalBytes
                    ? `${fmtMeret(progress.receivedBytes)} / ${fmtMeret(progress.totalBytes)}`
                    : 'Letöltés…'}
                </div>
              </div>
              <p className="hint">
                A letöltés megszakítható a program bezárásával; a félbemaradt fájl nem kerül
                telepítésre.
              </p>
            </>
          )}

          {fazis === 'ready' && vanMunka && (
            <div className="note bad" style={{ marginTop: 12 }}>
              <b>Előbb mentsd el az iratot.</b> A telepítéshez a program bezárul, és a megnyitott
              irat, a felvitt felek meg az egyenkénti döntések elvesznek.
            </div>
          )}

          {/* A CÍM. Nem műszaki finomság, hanem az, ami nélkül a funkció nem
              létezik — ezért a magyarázat is arról szól, honnan szerzi meg,
              nem arról, mi az az URL. */}
          <div className="field" style={{ marginTop: 16 }}>
            <div className="fieldlabel">Frissítési cím</div>
            {cimLatszik ? (
              <>
                <input
                  type="text"
                  value={cim}
                  placeholder="https://…"
                  onChange={(e) => setCim(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void mentCim();
                  }}
                />
                <span className="hint">
                  Ezt attól kérdezd meg, akitől a programot kaptad. Csak <b>https://</b> címet
                  fogadunk el: ezen a csatornán futtatható program érkezik a gépedre, és
                  titkosítatlan kapcsolaton bárki kicserélhetné a hálózaton.
                </span>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button className="btn primary sm" disabled={dolgozik} onClick={() => void mentCim()}>
                    Cím mentése
                  </button>
                  {beallitva && (
                    <button
                      className="btn ghost sm"
                      onClick={() => {
                        setCim(state?.feedUrl ?? '');
                        setSzerkeszt(false);
                      }}
                    >
                      Mégse
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="pathline">{state?.feedUrl}</div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn ghost sm" onClick={() => setSzerkeszt(true)}>
                    Cím módosítása
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            Bezárás
          </button>
          {beallitva && !tolt && fazis !== 'ready' && fazis !== 'downloading' && (
            <button className="btn" disabled={dolgozik} onClick={() => void fut(() => api.checkUpdate())}>
              {dolgozik ? 'Keresés…' : 'Keresés most'}
            </button>
          )}
          {fazis === 'available' && (
            <button className="btn primary" disabled={dolgozik || tolt} onClick={() => void letolt()}>
              {tolt ? 'Letöltés folyamatban…' : 'Letöltés'}
            </button>
          )}
          {fazis === 'ready' && (
            <button className="btn primary" onClick={() => void api.installUpdate()}>
              Újraindítás és telepítés
            </button>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/* ──────────────────── kérdezés nélkül vagy együtt ──────────────────── */

/*
  ITT ÁLLT A CSERE-MÓD PÁRBESZÉDE, AZ ÚTVÁLASZTÓ KÉRDÉS ÉS AZ `AUTO_MERES`.

  Az első kettő a megnyitás UTÁNI beállító lapra költözött
  (ui/src/documentSetup.tsx): a mód ott kártya, az út pedig már nem is
  kapcsoló, hanem a „Mindent cserélünk” gomb. Egyik sem külön megállító
  kérdés, hanem ANNAK AZ IRATNAK a beállítása — és a felhasználó akkor tudja
  meghozni, amikor már látja, mi van az iratban.

  AZ `AUTO_MERES` SZÖVEGDARAB IS ELTŰNT INNEN. A mért tényt (át nem nézett
  iraton 35 helyett 1 bennmaradt név) két hely mondta ki, egy közös React-
  darabból. Ma egy hely mondja ki, a „Mindent cserélünk” gomb buboréksúgója —
  a képernyőn álló bekezdés helyett, mert a felhasználó kérése az volt, hogy a
  lapon ne legyen végigolvasandó szöveg. Egy exportált, sehol nem használt
  darab viszont rosszabb az ismétlésnél: azt állítaná, hogy két helyen
  ugyanaz áll, miközben egyik helyen sem.
*/

/* ───────────── amiről a program döntött ember helyett ───────────── */

/**
 * A KÖZNÉVI ALAKOK ÖSSZEVONVA, felenként.
 *
 * A „Nagy” nem egyszer szerepel az iratban, és ragozva sem ugyanaz az alak
 * („Nagynak”, „Nagyot”). Tételenként felsorolva ugyanaz a gyanú tízszer állna
 * a listán, és pont az veszne el, ami a teendő: hogy EGY szót cseréltünk le
 * több helyen, és lehet, hogy egyszer sem név volt. Ezért félenként vonjuk
 * össze — a felszíni alakok különböznek, a kérdés viszont egy.
 */
function koznevCsoportok(
  rows: AutoDecisionRow[],
): { key: string; label: string; forms: string[]; rows: AutoDecisionRow[] }[] {
  const csoportok = new Map<string, AutoDecisionRow[]>();
  for (const r of rows) {
    const lista = csoportok.get(r.entityId);
    if (lista) lista.push(r);
    else csoportok.set(r.entityId, [r]);
  }
  return [...csoportok.entries()].map(([key, tetelek]) => {
    // A LEGRÖVIDEBB alak a szótári alakhoz áll a legközelebb: a „Nagy” rövidebb,
    // mint a „Nagynak”, és a felhasználó ezt a szót keresi majd a szövegben.
    const forms = [...new Set(tetelek.map((t) => t.surface))];
    const label = forms.reduce((a, b) => (Array.from(b).length < Array.from(a).length ? b : a), forms[0] ?? '');
    return { key, label, forms, rows: tetelek };
  });
}

/** Egy tétel: mit cseréltünk, mire, milyen szövegkörnyezetben és miért. */
function AutoRow({ row }: { row: AutoDecisionRow }) {
  const [before, mid, after] = splitContext(row.context);
  return (
    <div className="matchrow" style={{ cursor: 'default' }}>
      <div className="top">
        {/* Semleges címke: az oldalszám nem állapot. A találat fokozatát itt
            nem írjuk ki, mert már nincs jelentősége — mindegyik el van döntve. */}
        <span className="pill kind">{row.page + 1}. oldal</span>
        <span className="surface">{row.surface}</span>
        {row.replacement && (
          <>
            <span style={{ color: 'var(--muted)' }}>→</span>
            <span className="to">{row.replacement}</span>
          </>
        )}
      </div>
      <div className="ctx">
        {before}
        <b>{mid}</b>
        {after}
      </div>
      <div className="why">{row.reason}</div>
    </div>
  );
}

/**
 * A KÉRDEZÉS NÉLKÜLI ÚT ÁRA, kimondva.
 *
 * A felhasználó egyetlen kattintás nélkül kapott kész iratot; cserébe joga van
 * megtudni, hol döntött helyette a program. A puszta darabszám nem elég: ami a
 * jelentésben benne van, azt ki is kell írni, tételesen, felszíni alakkal és
 * környezettel — ugyanúgy, ahogy a szivárgáslistát rajzoljuk.
 *
 * A KÖZNÉVI ALAKOK ELÖL ÁLLNAK, és nyitva. Ott van az elrontott mondat, ha van:
 * a többi tétel java valódi név volt, azokat végignézni ritkán éri meg.
 */
export function AutoDecisionReport({
  rows,
  onReview,
  saved,
}: {
  rows: AutoDecisionRow[];
  /** Átváltás az átnézős útra ugyanezen az iraton. */
  onReview?: () => void;
  /** Elkészült-e már a fájl: ettől függ, mit ígér a visszaút gombja. */
  saved: boolean;
}) {
  const [mind, setMind] = useState(false);
  if (rows.length === 0) return null;

  const koznev = rows.filter((r) => r.commonWord);
  const tobbi = rows.filter((r) => !r.commonWord);
  const csoportok = koznevCsoportok(koznev);

  return (
    <div className="findings autoreport">
      <div className="findhead">
        Amiről a program döntött helyetted
        {/* Szám után a magyar főnév egyes számban áll: „12 találat". */}
        <span className="cut">{rows.length} találat</span>
      </div>
      <p className="hint" style={{ margin: '0 2px 10px' }}>
        Ezek emberi döntésre vártak volna. A program elfogadta őket, mert így marad bent a
        legkevesebb eredeti név — de a döntés a tiéd marad, csak utólag.
      </p>

      {csoportok.length > 0 && (
        <div className="koznev">
          <div className="kfej">
            Valószínű fölösleges csere — köznévvel azonos alakú
            <span className="cut">{koznev.length} találat</span>
          </div>
          <p className="hint" style={{ margin: '0 0 9px' }}>
            Ezeket érdemes ránézésre ellenőrizni: ha ott köznév állt, a mondat csúnya lett, de
            senkit nem árul el.
          </p>
          {csoportok.map((cs) => (
            <div key={cs.key} className="kgroup">
              <div className="kline">
                a(z) <b>„{cs.label}”</b> alakot <b>{cs.rows.length} helyen</b> is lecseréltük —
                lehet, hogy ott köznév volt
                {cs.forms.length > 1 && (
                  <span className="kforms">az iratban: {cs.forms.join(', ')}</span>
                )}
              </div>
              {cs.rows.map((r) => (
                <AutoRow key={r.matchId} row={r} />
              ))}
            </div>
          ))}
        </div>
      )}

      {tobbi.length > 0 && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setMind(!mind)}>
            {/* Egyetlen tételre a „többi 1 tétel" magyarul hibás; a szám
                ilyenkor nem is mond semmit, amit a mondat ne mondana. */}
            {mind
              ? 'A többi tétel elrejtése'
              : tobbi.length === 1
                ? 'A maradék tétel megmutatása'
                : `A többi ${tobbi.length} tétel megmutatása`}
          </button>
          {mind && <div style={{ marginTop: 9 }}>{tobbi.map((r) => <AutoRow key={r.matchId} row={r} />)}</div>}
        </>
      )}

      {onReview && (
        <div className="backline">
          <div className="s">
            {saved
              ? 'Ha hibát látsz a listán, nem kell elölről kezdened: ugyanezen az iraton átválthatsz az átnézős útra, és a javítás után újra mented.'
              : 'Ha inkább te döntenél, ugyanezen az iraton átválthatsz — a felismerés és a felek listája megmarad.'}
          </div>
          <button className="btn" onClick={onReview}>
            Nézzük át együtt
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Ugyanaz a jelentés, mentés ELŐTT is elérhetően.
 *
 * A mentés utáni ablak csak akkor jön elő, ha már fájl készült. Aki a mentést
 * megszakítja, ugyanígy ott áll egy irattal, amiben a program döntött helyette
 * — a listának előtte is elő kell hívhatónak lennie, különben a visszaút
 * egyetlen bejárata a kész fájl volna.
 */
export function AutoReportDialog({
  rows,
  onReview,
  onClose,
}: {
  rows: AutoDecisionRow[];
  onReview: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Miről döntött a program?</h2>
          <p>Ezt a listát a mentés utáni ablak is megmutatja.</p>
        </div>
        <div className="dialog-body">
          <AutoDecisionReport rows={rows} onReview={onReview} saved={false} />
        </div>
        <div className="dialog-foot">
          <button className="btn primary" onClick={onClose}>
            Rendben
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── mentés ─────────────────────────── */

/**
 * Egy tétel az ellenőrzés listáiból (szivárgás vagy gyanús maradvány).
 *
 * A két lista alakja azonos, ezért a megjelenítésük is: a felszíni alak
 * kiemelve, alatta a motor indoklása. Ami a jelentésben benne van, azt a
 * felületnek KI is kell írnia — a puszta darabszám nem döntés, csak szorongás.
 */
function FindingList({ items }: { items: { surface: string; detail: string }[] }) {
  return (
    <>
      {items.map((x, i) => (
        <div key={i} className="matchrow" style={{ borderRadius: 8 }}>
          <div className="surface">{x.surface}</div>
          <div className="why">{x.detail}</div>
        </div>
      ))}
    </>
  );
}

export function ExportDialog({
  pending,
  defaultKeepKey,
  onExport,
  onClose,
  result,
  busy,
  onReveal,
  onOpenKeyFile,
  autoDecided,
  onReview,
}: {
  pending: number;
  /** A beállításokban megadott alapállás — a kapcsoló innen indul. */
  defaultKeepKey: boolean;
  onExport: (keepKey: boolean, passphrase: string) => Promise<void>;
  onClose: () => void;
  result: ExportResult | null;
  busy: boolean;
  onReveal: (path: string) => void;
  /** A most készült kulcsfájl megnyitása a ki-kicsoda táblához. */
  onOpenKeyFile: (path: string) => void;
  /**
   * Hány találatot fogadott el a program ember helyett az ELEMZÉSBEN.
   *
   * A mentés előtti képernyőn ez az egyetlen jelzés arról, hogy az irat
   * kérdezés nélküli úton készült. Enélkül a felhasználó a mentés
   * pillanatáig nem tudná, hogy döntöttek helyette.
   */
  autoDecided: number;
  /** Átváltás az átnézős útra ugyanezen az iraton; hiányában nincs mire váltani. */
  onReview?: () => void;
}) {
  const [keepKey, setKeepKey] = useState(defaultKeepKey);
  const [pass, setPass] = useState('');
  // A folyamatfátyol csak a fájlnév megadása után jelenik meg, ezért a gombot
  // itt kell letiltani — különben a natív ablak alatt kétszer is elindítható.
  const [working, setWorking] = useState(false);

  if (result) {
    const r = result.report;
    // Külön névre kötve, hogy a lenti gombok visszahívásaiban is szűkített
    // típusú maradjon: egy objektummezőre a TypeScript a záró függvényen belül
    // már nem tartja meg a szűkítést.
    const keyPath = result.keyPath;
    // Ugyanezért külön néven: a `certificatePath` a lenti gomb visszahívásában
    // is szűkített kell maradjon. A két mező azért opcionális a típusban, mert
    // a böngészős fejlesztői álkimenet is `ExportResult`-ot ad — a motor
    // mindkettőt mindig kitölti (`SessionExportResult`, src/app/session.ts).
    const certificatePath = result.certificatePath ?? null;
    const warnings = result.warnings ?? [];
    /*
      A MENTÉS eredményéből vesszük, nem az elemzésből: automatikus módban a
      felhasználó ezt a képernyőt látja először, és a kettőnek ugyanazt kell
      mondania, mint a jegyzőkönyvnek. A motor mindkét helyre ugyanazt a listát
      adja (`SessionExportResult`, src/app/session.ts); opcionális, mert a
      böngészős álkimenet is `ExportResult`-ot állít elő.
    */
    const auto = result.autoAccepted ?? [];
    return (
      <Overlay onClose={onClose}>
        <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
          <div className="dialog-head">
            <h2>{r.ok ? 'Kész — az irat tiszta' : 'Elkészült, de maradt benne eredeti név'}</h2>
            <p>
              Az ellenőrzés a <b>kész fájlt</b> olvasta vissza, nem azt, amit beleírtunk.
            </p>
          </div>
          <div className="dialog-body">
            <div className={`note ${r.ok ? 'good' : 'bad'}`}>
              {r.ok ? (
                <>
                  Visszaolvastuk a mentett fájlt, és <b>egyetlen eredeti név sem maradt benne</b> —
                  sem a szövegben, sem a metaadatban.
                </>
              ) : (
                <>
                  <b>{r.leaks.length} eredeti név</b> megmaradt a kimenetben, ezért{' '}
                  <b>egyetlen fájl sem készült el</b> — sem az irat, sem a kulcsfájl. Nézd át az
                  eldöntetlen találatokat az „Átnézésre vár” listán, és mentsd újra.
                </>
              )}
            </div>

            <div className="resultrow">
              <span>Lecserélt előfordulás</span>
              <span className="v">{r.replaced}</span>
            </div>
            <div className="resultrow">
              <span>Eldöntetlen találat</span>
              <span className="v">{r.pending}</span>
            </div>
            <div className="resultrow">
              <span>Ellenőrzött karakter</span>
              <span className="v">{r.checkedChars.toLocaleString('hu-HU')}</span>
            </div>
            <div className="resultrow">
              <span>Gyanús maradvány átnézésre</span>
              {/*
                A TELJES szám kell ide, nem a lista hossza: a lista le van vágva,
                és ha a levágott hosszt írnánk ki, a csonkolás maga sem derülne
                ki — 137 maradványból 40 látszana, a képernyőn pedig a „40".
              */}
              <span className="v">{r.residualTotal}</span>
            </div>

            {r.leaks.length > 0 && (
              <div className="findings">
                <div className="findhead">
                  Bennmaradt eredeti nevek
                  {r.leaks.length > 8 && (
                    <span className="cut">8 látszik a {r.leaks.length} találatból</span>
                  )}
                </div>
                <FindingList items={r.leaks.slice(0, 8)} />
              </div>
            )}

            {/*
              A KÉRDEZÉS NÉLKÜLI ÚT ÁRA — a szivárgáslista után, a többi átnézni
              való elé. Ebben a módban a felhasználó ezen a képernyőn látja
              először, hogy döntöttek helyette; ha ez a lista lentebb állna, a
              jelentés végét pedig nem olvassa el senki, a mód ára némán
              kimaradna.
            */}
            <AutoDecisionReport rows={auto} onReview={onReview} saved={r.ok} />

            {/*
              A darabszám önmagában zsákutca: a jogász vagy megnézi a
              maradványokat, vagy nem meri kiadni az iratot. A motor a tételeket
              felszíni alakkal és indoklással adja át — ugyanabban az alakban,
              mint a szivárgásokat —, tehát nincs mit visszatartani.
            */}
            {r.residual.length > 0 && (
              <div className="findings">
                <div className="findhead">
                  Gyanús maradvány — a program nem tudta eldönteni
                  {r.residualTotal > r.residual.length && (
                    // A toldalék SZÓRA kerül, nem a számjegyre: a „137-ből" és a
                    // „40-ből" hangrendje különbözik, és a számjegy után a
                    // helyes toldalékot csak a kiejtett alakból lehetne kitalálni.
                    <span className="cut">
                      {r.residual.length} látszik a {r.residualTotal} maradványból
                    </span>
                  )}
                </div>
                <FindingList items={r.residual} />
                <p className="hint" style={{ margin: '8px 2px 0' }}>
                  Ezek nem biztos, hogy nevek: a visszaolvasott szövegben olyan alakok, amiket a
                  program nem tudott egyik félhez sem kötni. Nézd át őket, mielőtt kiadod az iratot.
                </p>
              </div>
            )}

            {/*
              A MENTÉS FIGYELMEZTETÉSEI.

              Nem ugyanaz, mint az elemzésé: egy részük CSAK a kiírás közben
              derül ki (a PDF-metaadat kitakarítása, az űrlapmezők eltávolítása,
              a vissza nem írható tartalomfolyam). A felhasználó ezeket eddig
              csak akkor látta volna, ha a mentés UTÁN újra végigfuttat mindent
              — vagyis a gyakorlatban soha. Ugyanez a lista kerül a
              jegyzőkönyv FIGYELMEZTETÉSEK rovatába (`exportWarningList`,
              src/app/session.ts), tehát a képernyő és a fájl ugyanazt mondja.
            */}
            {warnings.length > 0 && (
              <div className="findings">
                <div className="findhead">
                  {r.ok ? 'Amit a mentésről tudnod kell' : 'Amit a mentési kísérlet feltárt'}
                  {/* Szám után a magyar főnév egyes számban áll: „5 figyelmeztetés". */}
                  <span className="cut">{warnings.length} figyelmeztetés</span>
                </div>
                {warnings.map((w, i) => (
                  <div key={i} className="warnitem">
                    {w}
                  </div>
                ))}
                {!r.ok && (
                  <p className="hint" style={{ margin: '8px 2px 0' }}>
                    Fájl nem készült — ezek arra vonatkoznak, amit a mentés előkészítése közben
                    találtunk.
                  </p>
                )}
              </div>
            )}

            {/* Szivárgásnál sem irat, sem kulcsfájl nem készült — a kulcsról
                szóló mondat ilyenkor nem elhallgatás, hanem tárgytalan. */}
            {r.ok && (
              <div className="note" style={{ marginTop: 14 }}>
                {keyPath ? (
                  <>
                    A visszafejtő kulcs külön fájlba került. <b>Ez maga is személyes adat</b>:
                    tartsd másik mappában, és ne küldd együtt az irattal.
                    {/*
                      Az útvonalat ki KELL írni: eddig a kulcsfájl léte csak
                      logikai feltételként szerepelt, a „Mappa megnyitása" pedig
                      az iratot mutatta — a felhasználó tehát azt sem tudta,
                      hová került a kulcs, amit külön kellene őriznie.
                    */}
                    <div className="pathline mono">{keyPath}</div>
                    <div className="pathacts">
                      <button className="btn sm" onClick={() => onReveal(keyPath)}>
                        A kulcs mappája
                      </button>
                      <button className="btn sm" onClick={() => onOpenKeyFile(keyPath)}>
                        Ki kicsoda? — kulcsfájl megnyitása
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    Kulcsfájl <b>nem készült</b>: a csere visszafordíthatatlan.
                  </>
                )}
              </div>
            )}

            {/*
              Az útvonalat CSAK akkor írjuk ki, ha a fájl tényleg elkészült:
              szivárgásnál a motor szándékosan semmit nem ír ki, és egy létező
              fájlra mutató sor pontosan azt hazudná, hogy megvan az irat.
            */}
            {r.ok && (
              <div className="note" style={{ marginTop: 14 }}>
                Az álnevesített irat:
                <div className="pathline mono">{result.outputPath}</div>
              </div>
            )}

            {/*
              A JEGYZŐKÖNYV — a HARMADIK fájl, ami minden mentéskor keletkezik.

              Származtatott néven kerül az irat mellé, és eddig sehol nem
              szerepelt a felületen: a felhasználó tehát nem tudta, hogy a
              mappa kiküldésével a jegyzőkönyvet is kiküldi. Az útvonalat
              ugyanúgy ki kell írni, mint az iratét és a kulcsfájlét.
            */}
            {certificatePath && (
              <div className="note" style={{ marginTop: 14 }}>
                Az anonimizálási jegyzőkönyv is elkészült — <b>ez egy harmadik fájl</b> az irat
                mellett. A ki-kicsoda megfeleltetést szándékosan nem tartalmazza (az a kulcsfájlba
                kerül), de leírja, mit cseréltünk és mi maradt átnézésre.
                <div className="pathline mono">{certificatePath}</div>
                <div className="pathacts">
                  <button className="btn sm" onClick={() => onReveal(certificatePath)}>
                    A jegyzőkönyv mappája
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="dialog-foot">
            {r.ok && (
              <button className="btn" onClick={() => onReveal(result.outputPath)}>
                Az irat mappája
              </button>
            )}
            <button className="btn primary" onClick={onClose}>
              Rendben
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Álnevesített irat mentése</h2>
          <p>Az eredeti fájl érintetlen marad; mindig új fájl készül.</p>
        </div>
        <div className="dialog-body">
          {pending > 0 && (
            <div className="note">
              <b>{pending} találat</b> még eldöntetlen. Ezek most <b>nem</b> cserélődnek le. Nézd át
              őket az „Átnézésre vár” listán, ha nem akarod bent hagyni őket.
            </div>
          )}

          {/*
            Kérdezés nélküli úton ez az ELSŐ képernyő, amit a felhasználó lát a
            megnyitás után. Ha itt nem mondanánk ki, hogy a program döntött
            helyette, a mentés úgy nézne ki, mintha ő ment volna végig a
            találatokon — a tételes lista a mentés után jön, de a tényt itt kell
            kimondani, mert innen még van visszaút.
          */}
          {autoDecided > 0 && (
            <div className="note good">
              <b>{autoDecided} bizonytalan találatról</b> a program döntött helyetted, és mindet
              lecserélte. Mentés után tételesen megmutatjuk, melyekről — köztük azokat is, ahol
              köznevet cserélhetett le.
              {onReview && (
                <div className="pathacts">
                  <button className="btn sm" onClick={onReview}>
                    Inkább nézzük át együtt
                  </button>
                </div>
              )}
            </div>
          )}

          <KapcsoloSor
            id="export-keepkey"
            cim="Készüljön visszafejtő kulcsfájl"
            leiras={
              <>
                Ezzel később vissza tudod nézni, ki kicsoda volt: <b>Fájl → Kulcsfájl megnyitása</b>.
                Amíg a kulcs létezik, a kimenet a GDPR szerint továbbra is személyes adat — ez
                álnevesítés, nem anonimizálás.
              </>
            }
            be={keepKey}
            onValt={setKeepKey}
          />

          {keepKey && (
            <div className="field">
              <label htmlFor="pass">Jelszó a kulcsfájlhoz</label>
              <input
                id="pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="legalább 8 karakter"
              />
              <span className="hint">
                A kulcsfájl AES-256-GCM titkosítást kap. Ha elveszik a jelszó, a leképezés
                visszafordíthatatlanul elvész.
              </span>
            </div>
          )}

          {!keepKey && (
            <div className="note bad">
              Kulcs nélkül <b>nincs visszaút</b>. Ez a valódi anonimizálás, de utána már senki nem
              tudja megmondani, ki volt az eredeti fél.
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy || working}>
            Mégse
          </button>
          <button
            className="btn primary"
            disabled={busy || working || (keepKey && pass.length < 8)}
            onClick={() => {
              setWorking(true);
              void onExport(keepKey, pass).finally(() => setWorking(false));
            }}
          >
            {busy || working ? 'Mentés…' : 'Mentés és ellenőrzés'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── változáskövetés ─────────────────────────── */

/**
 * Word-dokumentumban a törölt szöveg NEM tűnik el: a `<w:del>` elemek szó
 * szerint őrzik. Ha így mentenénk, ugyanazt a hibát követnénk el, mint aki
 * fekete csíkot rajzol a név fölé. Ezért ez egy blokkoló döntés.
 */
export function RevisionsDialog({
  count,
  onResolve,
  onClose,
  busy,
}: {
  count: number;
  onResolve: (mode: 'accept' | 'reject') => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Változáskövetés van a dokumentumban</h2>
          <p>
            {count} feloldatlan módosítás. Ezekben a <b>törölt szöveg is benne van</b> a fájlban,
            láthatatlanul — Wordben nem látszik, de kicsomagolva bárki elolvassa.
          </p>
        </div>
        <div className="dialog-body">
          <div className="note bad">
            Amíg ez fennáll, nem mentünk. Nem lenne értelme lecserélni a neveket a látható
            szövegben, ha a törölt változatban ott maradnak.
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 6px' }}>
            A két lehetőség <b>különböző dokumentumot</b> ad, ezért neked kell eldöntened:
          </p>
          <ul style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 0 }}>
            <li>
              <b>Elfogadás</b> — a módosítások véglegesek lesznek, a törölt szöveg eltűnik.
            </li>
            <li>
              <b>Elutasítás</b> — visszaáll az eredeti szöveg, a beszúrások eltűnnek.
            </li>
          </ul>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Mégse
          </button>
          <button className="btn" onClick={() => onResolve('reject')} disabled={busy}>
            Módosítások elutasítása
          </button>
          <button className="btn primary" onClick={() => onResolve('accept')} disabled={busy}>
            Módosítások elfogadása
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── kilépés mentés nélkül ─────────────────────────── */

/**
 * A BEZÁRÁS MEGERŐSÍTÉSE — a PROGRAM SAJÁT ABLAKÁBAN.
 *
 * Eddig a Windows rendszerpárbeszéde kérdezett. Nem stílusdöntés, hogy
 * lecseréltük: a rendszerpárbeszédbe nem fér el az, amit itt el KELL mondani —
 * hogy a mentés SOHA nem írja felül az eredeti iratot, hanem új fájlba megy.
 * Enélkül a „Mentés másként" gomb egy kilépési kérdés közepén épp attól
 * ijeszthet meg, amit nem csinál.
 *
 * A HÁROM GOMB SORRENDJE a veszélyesség szerint fordított: a legártalmatlanabb
 * (Mégse) a bal szélen, a kiemelt, ajánlott művelet (Mentés) a jobb szélen —
 * ez a program minden más ablakában is így van. Az „Escape" a Mégsére megy: a
 * bezárás kérdésére a véletlen billentyű nem válaszolhat kilépéssel.
 *
 * A BEZÁRÁST NEM EZ AZ ABLAK VÉGZI, csak a választ küldi vissza. A főfolyamat
 * időzítőt tart a kérdés mellett: ha a lap nem felel, a rendszerpárbeszéd veszi
 * át — így a programból akkor is ki lehet lépni, ha a felület kifagyott.
 */
export function ExitDialog({
  onValaszt,
}: {
  onValaszt: (valasz: 'save' | 'discard' | 'cancel') => void;
}) {
  return (
    <Overlay onClose={() => onValaszt('cancel')}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Van el nem mentett munka</h2>
          <p>
            A megnyitott irat, a felvitt nevek és az egyenkénti döntések elvesznek, ha most bezárod a
            programot.
          </p>
        </div>
        <div className="dialog-body">
          <div className="note">
            A mentés <b>nem írja felül az eredeti iratot</b>: az álnevesített változat új fájlba
            kerül, és a program megkérdezi, hova.
          </div>
        </div>
{/*
          A HÁROM GOMB A PROGRAM SAJÁT SORRENDJÉBEN ÁLL: balra a visszalépés,
          jobbra az, amit ajánlunk. Ez a lábléc ugyanaz, mint a többi
          párbeszédé — a bezárás kérdése nem kivétel.

          A FELIRATOK RÖVIDEK. „Mégsem lépek ki" állt itt: egy mondat egy
          gombon. A gombfelirat nem mondat, hanem a művelet neve — a mondat a
          fejlécben van, ahol el is olvassák.
        */}
        <div className="dialog-foot">
          <button className="btn ghost" onClick={() => onValaszt('cancel')}>
            Mégse
          </button>
          <button className="btn" onClick={() => onValaszt('discard')}>
            Kilépés mentés nélkül
          </button>
          <button className="btn primary" onClick={() => onValaszt('save')}>
            Mentés másként…
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── szkennelt irat ─────────────────────────── */

/**
 * A szkennelt irat ténye a megnyitáskor már eldől, de eddig csak a folyamat
 * végén, az állapotsor egy sorában látszott. Addigra a felhasználó végigvárta a
 * vizsgálatot és átnézte a találatokat egy iratra, amiből nincs mit kiolvasni.
 * Ezért itt, rögtön a megnyitás után kell megmondani — a vizsgálat ELŐTT.
 */
export function ScannedDialog({
  fileName,
  onClose,
  onContinue,
  onOpenOther,
}: {
  fileName: string;
  /**
   * A kérdés elhessegetése (Escape, kattintás a fátyolra) — NEM beleegyezés.
   *
   * Korábban az `onContinue` állt itt: aki a figyelmeztetést válasz nélkül
   * bezárta, annak azonnal ELINDULT a percekig tartó vizsgálat — a
   * leggyengébb mozdulat a legerősebb következménnyel. A bezárás után a
   * „várunk" képernyő áll, ahonnan a vizsgálat kifejezett gombbal indítható.
   */
  onClose: () => void;
  onContinue: () => void;
  onOpenOther: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Ebből az iratból nem olvasható ki szöveg</h2>
          <p>
            A(z) <b>{fileName}</b> szkennelt oldalakat tartalmaz: a lapokon kép van, nem betűk.
          </p>
        </div>
        <div className="dialog-body">
          <div className="note bad">
            A program a szövegben keresi a neveket. Ha nincs szöveg, <b>nincs mit lecserélni</b> —
            a mentett fájl gyakorlatilag az eredetivel egyezne meg. A képfelismerés (OCR) még nem
            készült el.
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            Amit most tehetsz: keresd elő az irat szerkeszthető változatát (Word vagy szöveges PDF),
            vagy futtasd át előbb egy OCR-programon, és azt nyisd meg itt.
          </div>
        </div>
        {/* Ugyanaz a sorrend, mint mindenhol máshol: balra a halkabb válasz,
            jobbra az, amit ajánlunk. Ez a lábléc korábban fordítva állt. */}
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onContinue}>
            Mégis megnézem
          </button>
          <button className="btn primary" onClick={onOpenOther}>
            Másik irat megnyitása
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────── betöltési figyelmeztetések ─────────────────────── */

/**
 * Amit a megnyitáskor NEM tudtunk elolvasni az iratból.
 *
 * A `DocumentInfo.loadWarnings` a megnyitás pillanatában már kész, de eddig
 * csak az elemzés UTÁN, egy fül mélyén látszott — a felhasználó tehát
 * végigvárta a vizsgálatot, átnézte a találatokat, és csak azután tudta meg,
 * hogy a PDF egyik betűkészletéből ki sem tudtuk olvasni a szöveget. Ez pedig
 * nem részletkérdés: ahol nem látunk szöveget, ott nevet sem találunk, tehát
 * nem is cserélünk ki.
 *
 * Ezért itt, rögtön a megnyitás után áll meg a folyamat, a vizsgálat ELŐTT —
 * ugyanúgy, ahogy a szkennelt iratnál.
 */
export function LoadWarningsDialog({
  fileName,
  warnings,
  onClose,
  onContinue,
  onOpenOther,
}: {
  fileName: string;
  warnings: string[];
  /** A kérdés elhessegetése — nem beleegyezés. Lásd a `ScannedDialog`-ot. */
  onClose: () => void;
  onContinue: () => void;
  onOpenOther: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Az irat egy részét nem tudtuk elolvasni</h2>
          <p>
            {/* Szám után a magyar főnév egyes számban áll: „2 részlet". */}
            A(z) <b>{fileName}</b> megnyitása sikerült, de {warnings.length} részlet kimaradt az
            átvizsgálásból.
          </p>
        </div>
        <div className="dialog-body">
          <div className="note bad">
            A program a szövegben keresi a neveket. <b>Amit nem látunk, azt nem cseréljük ki</b> —
            ha az alábbi részekben név van, az bent marad a mentett fájlban is.
          </div>

          {warnings.map((w, i) => (
            <div key={i} className="warnitem">
              {w}
            </div>
          ))}

          <div className="note" style={{ marginTop: 14 }}>
            Amit tehetsz: nézd át ezeket a helyeket az eredeti iratban, vagy keresd elő a
            szerkeszthető változatát (Word), amiből a szöveg hiánytalanul kiolvasható. Ha mégis
            továbbmész, a mentés utáni jegyzőkönyvben is szerepelni fog ez a figyelmeztetés.
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onOpenOther}>
            Másik irat megnyitása
          </button>
          {/* A gomb AZT MONDJA, ami történni fog: a bezárása után a vizsgálat
              indul el, nem egy űrlap nyílik ki. A régi „tovább a felekhez"
              felirat egy olyan párbeszédet ígért, ami már nem áll a folyamatban. */}
          <button className="btn primary" onClick={onContinue}>
            Értem, kezdődhet a vizsgálat
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── új ügy ─────────────────────────── */

/**
 * Az ügyazonosító titok dönti el, hogy egy valódi név melyik álnevet kapja. Egy
 * ügy több iratán belül ez KÍVÁNATOS, két külön ügy között viszont összeköti a
 * két iratot. Ezért az új ügy külön, tudatos művelet.
 */
export function NewCaseDialog({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Új ügy kezdése</h2>
          <p>A megnyitott irat, a felek és a meghozott döntések elvesznek.</p>
        </div>
        <div className="dialog-body">
          <div className="note">
            Az új ügy <b>új álnév-kiosztást</b> kap: ugyanaz a valódi név a következő ügyben már más
            fedőnevet kap, így a két ügy kimenete nem köthető össze.
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            Ha ugyanannak az ügynek egy másik iratát nyitnád meg, ne ezt válaszd, hanem a{' '}
            <b>Másik irat</b> gombot — akkor a nevek végig ugyanazt az álnevet kapják.
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            Mégse
          </button>
          <button className="btn primary" onClick={onConfirm}>
            Új ügyet kezdek
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── másik irat ─────────────────────────── */

/**
 * A „Másik irat" ág is KÉRDEZ, mielőtt eldobja a munkát.
 *
 * Az „Új ügy" gomb már rákérdezett (`NewCaseDialog`), ez viszont nem: a
 * felhasználó felvitte a feleket, végigdöntötte a találatokat, aztán egyetlen
 * kattintással mindent elvesztett. A két ág vesztesége UGYANAKKORA — az
 * egyetlen különbség, hogy itt az álnév-kiosztás megmarad, mert az ügy nem
 * változik.
 */
export function OpenOtherDialog({
  fileName,
  onConfirm,
  onClose,
}: {
  /** A most nyitva lévő irat neve — ez az, ami elveszik. */
  fileName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="dialog narrow" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Másik irat megnyitása</h2>
          <p>
            A(z) <b>{fileName}</b> felei és a rajta meghozott döntések elvesznek. A mentett fájlok
            megmaradnak, a képernyőn lévő munka nem.
          </p>
        </div>
        <div className="dialog-body">
          <div className="note">
            Ez <b>ugyanaz az ügy</b> marad: az álnév-kiosztás nem változik, tehát a következő
            iratban ugyanaz a valódi név ugyanazt a fedőnevet kapja. Ha új ügyhöz kezdenél, az{' '}
            <b>Új ügy</b> gombot válaszd.
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            Ha a jelenlegi iratot még nem mentetted el, előbb zárd be ezt az ablakot, és futtasd le
            a <b>Mentés másként…</b> lépést.
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            Mégse
          </button>
          <button className="btn primary" onClick={onConfirm}>
            Eldobom, és megnyitok másikat
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ─────────────────────────── kulcsfájl ─────────────────────────── */

/**
 * A visszafejtés hibáinak magyarra fordítása.
 *
 * Rossz jelszónál a művelet az OpenSSL angol mondatával áll meg („Unsupported
 * state or unable to authenticate data”), ami a felhasználónak semmit nem mond
 * — ő a saját jelszavát gépelte be, nem egy titkosítási állapotot. A
 * hitelesítés bukása KÉT dolgot jelenthet, rossz jelszót vagy sérült fájlt, és
 * a kettőt megkülönböztetni elvileg sem lehet: az azonosító címke pontosan
 * azért van, hogy a hamisítást ne lehessen jelszóhibának álcázni. Ezért
 * mindkét lehetőséget kimondjuk, és nem állítunk többet, mint amit tudunk.
 */
function emberiKulcsHiba(uzenet: string): string {
  if (/authenticate|unsupported state|bad decrypt|wrong final block/i.test(uzenet)) {
    return 'Ez a jelszó nem nyitja ki a kulcsfájlt. Vagy elgépelted — a kis- és nagybetűk számítanak —, vagy a fájl megsérült.';
  }
  if (/JSON|Unexpected token|Unexpected end/i.test(uzenet)) {
    return 'Ez a fájl nem Szivecske kulcsfájl. A kulcsfájl kiterjesztése .szkulcs, és mentéskor keletkezik az irat mellé.';
  }
  if (/ENOENT|no such file/i.test(uzenet)) {
    return 'Ez a fájl már nincs meg ezen az útvonalon — lehet, hogy átmozgattad vagy törölted.';
  }
  return uzenet;
}

/**
 * A kulcsfájl visszafejtése: melyik álnév mögött ki állt.
 *
 * A mentéskor felkínált kulcsfájlnak eddig NEM volt olvasója a programban: a
 * felület megígérte, hogy „ezzel később vissza tudod nézni, ki kicsoda volt”,
 * a .szkulcs fájlt viszont semmi nem nyitotta meg. Az ígéret így pontosan
 * annyit ért, mint a le nem futó ellenőrzés.
 */
export function KeyFileDialog({
  initialPath,
  onClose,
}: {
  /** Mentés után a most készült kulcsfájl — ilyenkor nem kell tallózni. */
  initialPath?: string | null;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string | null>(initialPath ?? null);
  const [pass, setPass] = useState('');
  const [entries, setEntries] = useState<KeyEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (): Promise<void> => {
    setError(null);
    try {
      const p = await api.chooseKeyFile();
      if (!p) return;
      setPath(p);
      setEntries(null);
      setPass('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const open = async (): Promise<void> => {
    if (!path || pass.length < 8) return;
    setBusy(true);
    setError(null);
    try {
      const rows = await api.readKeyFile(path, pass);
      setEntries(rows);
      // A jelszót nem tartjuk tovább: a tábla megvan, a jelszóra nincs több
      // szükség, így a felület állapotában sem marad ott.
      setPass('');
    } catch (e) {
      setEntries(null);
      setError(emberiKulcsHiba((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Kulcsfájl megnyitása</h2>
          <p>
            A mentéskor készült <span className="mono">.szkulcs</span> fájl mondja meg, melyik álnév
            mögött ki állt. A fájl AES-256-GCM titkosítást hordoz: jelszó nélkül a tábla nem
            olvasható ki belőle.
          </p>
        </div>

        <div className="dialog-body">
          {error && <div className="note bad">{error}</div>}

          {entries === null ? (
            <>
              <div className="field">
                {/* Nem <label for>: a kiválasztott útvonalat mutató doboz nem
                    beviteli mező, egy címke nem mutathat rá. */}
                <span className="fieldlabel">Kulcsfájl</span>
                <div className="pathpick">
                  <span className={`pathline mono${path ? '' : ' empty'}`}>
                    {path ?? 'Még nincs kiválasztva'}
                  </span>
                  <button className="btn sm" onClick={() => void choose()}>
                    Tallózás…
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="keypass">Jelszó</label>
                <input
                  id="keypass"
                  type="password"
                  autoFocus={Boolean(path)}
                  disabled={!path || busy}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void open();
                  }}
                  placeholder="a mentéskor megadott jelszó"
                />
                <span className="hint">
                  Amit a mentéskor megadtál. Ha elveszett, a leképezés visszafordíthatatlanul
                  elveszett vele — a kulcsfájlban nincs kiskapu, és mi sem tudjuk kinyitni.
                </span>
                {/* A gomb 8 karakter alatt le van tiltva. Meg is kell mondani,
                    miért: ilyen rövid jelszóval kulcsfájl nem is készülhetett. */}
                {pass.length > 0 && pass.length < 8 && (
                  <span className="hint">
                    A kulcsfájl jelszava legalább 8 karakter — ennél rövidebbel a program nem is
                    engedte volna elmenteni.
                  </span>
                )}
              </div>
            </>
          ) : entries.length === 0 ? (
            <div className="empty">
              <div className="big">◌</div>
              A kulcsfájl kinyílt, de nincs benne egyetlen bejegyzés sem. Ez akkor fordul elő, ha a
              mentéskor egyetlen nevet sem cseréltünk le.
            </div>
          ) : (
            <>
              <div className="note bad">
                Ez a tábla a <b>valódi neveket</b> tartalmazza. Ne mentsd ki, ne küldd tovább, és ne
                hagyd nyitva a képernyőn — ettől kezdve ugyanaz a védendő adat van előtted, mint az
                eredeti iratban.
              </div>
              <table className="keytable">
                <thead>
                  <tr>
                    <th style={{ width: '42%' }}>Az iratban ez áll</th>
                    <th style={{ width: '42%' }}>Valójában ő</th>
                    <th>Fajta</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((k, i) => (
                    <tr key={i}>
                      <td className="pseudo">{k.pseudonym}</td>
                      <td className="orig">{k.original}</td>
                      <td>
                        <span className="pill kind">{k.kind}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint" style={{ marginTop: 10 }}>
                {entries.length} bejegyzés. A tábla iránya szándékosan az álnévtől indul: a
                kimeneti iratot olvasod, és arra vagy kíváncsi, ki áll egy-egy fedőnév mögött.
              </p>
            </>
          )}
        </div>

        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            Bezárás
          </button>
          {entries === null ? (
            <button
              className="btn primary"
              disabled={!path || pass.length < 8 || busy}
              onClick={() => void open()}
            >
              {busy ? 'Visszafejtés…' : 'Megnyitom'}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                setEntries(null);
                void choose();
              }}
            >
              Másik kulcsfájl
            </button>
          )}
        </div>
      </div>
    </Overlay>
  );
}
