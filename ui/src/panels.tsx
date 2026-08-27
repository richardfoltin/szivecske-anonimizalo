import { useEffect, useMemo, useRef } from 'react';
import { matchKind, matchOutcome } from './api';
import type { AnalysisResult, MatchKind, MatchRow } from './api';

/* ─────────────────────────── dokumentum-nézet ─────────────────────────── */

/**
 * MI TÖRTÉNIK A TALÁLATTAL — a jelmagyarázat szövege.
 *
 * Ugyanaz a három szó áll a kiemelés mellett, a jelmagyarázatban és az
 * állapotsorban. A régi „köznévnek ítélve" azért került ki, mert csak az egyik
 * okát nevezte meg annak, amiért egy találat bent marad: a kikapcsolt összeg,
 * a kézzel kikapcsolt név és a köznévnek ítélt szó a képernyőn ugyanaz a jel,
 * a felirat viszont csak az utolsóra volt igaz.
 */
export const KIMENET_CIMKE: Record<ReturnType<typeof matchOutcome>, string> = {
  csere: 'lecserélve',
  bizonytalan: 'bizonytalan',
  nincs: 'nincs csere',
};

/**
 * MI EZ A TALÁLAT — a kiemelés SZÍNE ezt mondja el.
 *
 * A kettő két külön kérdés, és a képernyőn is két külön jel: a KIMENET a
 * fedettség (kitöltve = lecseréljük, csak aláhúzva = marad), a FAJTA pedig a
 * szín. Így egyetlen pillantással látszik, hogy egy bekarikázott szám összeg-e
 * vagy dátum, és hogy egy név a feleké-e vagy az eljáró bíróé — utóbbi
 * ugyanis alapból bent marad, és a felhasználónak tudnia kell, melyiket nézi.
 */
export const FAJTA_CIMKE: Record<MatchKind, string> = {
  nev: 'név',
  osszeg: 'összeg',
  datum: 'dátum',
  hivatalos: 'hivatalos szereplő',
};

export function DocumentView({
  analysis,
  selected,
  onSelect,
  hivatalosIdk = new Set<string>(),
  dontesek,
  onToggle,
}: {
  analysis: AnalysisResult;
  selected: number | null;
  onSelect: (id: number | null) => void;
  /**
   * A Bszi. 166. § (2) szerinti szereplők azonosítói.
   *
   * Tőlük kapja a nézet a NEGYEDIK kiemelésszínt. Nem a motor fogalma — ott ők
   * közönséges felek, ha a felhasználó a cseréjüket kérte —, ezért érkezik
   * kívülről. Üres halmaz is jó: olyankor mindenki „név”.
   */
  hivatalosIdk?: ReadonlySet<string>;
  /**
   * A FELHASZNÁLÓ DÖNTÉSEI, AHOGY ÉPP ÁLLNAK — az elemzés előtt.
   *
   * A kattintás a `decisions` tárolóba ír, az új elemzés viszont csak egy
   * rövid szünet után indul (a küszöbcsúszka miatt késleltetett). Enélkül a
   * kiemelés ez alatt a RÉGI színben állt volna: a felhasználó kikapcsolja a
   * cserét, és negyed másodpercig azt látja, hogy nem történt semmi — vagy
   * ami rosszabb, hogy még mindig cserélünk.
   *
   * A friss döntés ezért a megjelenítésnél FELÜLÍRJA az elemzésből kapott
   * állapotot. Nem külön igazság: pontosan az, amit a motor a következő
   * körben visszaigazol.
   */
  dontesek?: Record<number, 'accept' | 'skip'>;
  /**
   * KATTINTÁSRA KI-BE KAPCSOLÁS — a beállító lap bal oldalán ez a fő működés.
   *
   * A kiemelés eddig ott nézet volt, semmi több: a felhasználó látta, mihez
   * fogunk nyúlni, de a képernyő azon a felén nem tudott dönteni róla — a
   * listát a jobb oldali panelen kellett megkeresnie. Márpedig az irat az a
   * hely, ahol a kérdés felmerül: „ez itt tényleg név?"
   *
   * Ha nincs megadva, a kattintás KIJELÖL (`onSelect`) — ez a munkalap
   * működése, ahol a kijelölés a szereplapra mutat vissza.
   */
  onToggle?: (id: number) => void;
}) {
  const byPage = useMemo(() => {
    const m = new Map<number, typeof analysis.highlights>();
    for (const h of analysis.highlights) {
      const list = m.get(h.page) ?? [];
      list.push(h);
      m.set(h.page, list);
    }
    return m;
  }, [analysis.highlights]);

  const matchById = useMemo(
    () => new Map(analysis.matches.map((m) => [m.id, m])),
    [analysis.matches],
  );

  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => gorgessOda(ref.current, selected), [selected]);

  if (analysis.pages.length === 0) {
    return (
      <TextView
        analysis={analysis}
        selected={selected}
        hivatalosIdk={hivatalosIdk}
        onSelect={onSelect}
        {...(dontesek ? { dontesek } : {})}
        {...(onToggle ? { onToggle } : {})}
      />
    );
  }

  return (
    // A „source" osztály nem díszítés: a nyomtatási szabályok ebből tudják,
    // hogy ezen a nézeten a VALÓDI nevek állnak, és papírra sosem kerülhet.
    <div className={`viewport source${onToggle ? ' kapcsolhato' : ''}`} ref={ref}>
      <div className="pagewrap">
        {analysis.pages.map((p) => (
          <div className="page" key={p.index}>
            <img src={p.dataUrl} alt={`${p.index + 1}. oldal`} draggable={false} />
            {(byPage.get(p.index) ?? []).map((h) => {
              const nyers = matchById.get(h.matchId);
              const m = nyers ? frissSor(nyers, dontesek) : undefined;
              // KÉT OSZTÁLY: a kimenet adja a fedettséget, a fajta a színt.
              const cls = m
                ? `${matchOutcome(m)} k-${matchKind(m, hivatalosIdk)}`
                : 'csere k-nev';
              return (
                <div
                  key={h.matchId}
                  data-hl={h.matchId}
                  className={`hl ${cls}${selected === h.matchId ? ' selected' : ''}`}
                  style={{
                    left: `${h.left * 100}%`,
                    top: `${h.top * 100}%`,
                    width: `${h.width * 100}%`,
                    height: `${h.height * 100}%`,
                  }}
                  title={m ? kiemelesSugo(m, onToggle !== undefined) : ''}
                  /* Billentyűzetről is: a szöveges nézet markjai eddig is
                     kapcsolhatók voltak Enterrel, a lapképes kiemelés nem —
                     ugyanaz a művelet a formátumtól függően hol járt, hol nem. */
                  role="button"
                  tabIndex={0}
                  onClick={
                    onToggle
                      ? () => onToggle(h.matchId)
                      : () => onSelect(selected === h.matchId ? null : h.matchId)
                  }
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (onToggle) onToggle(h.matchId);
                    else onSelect(selected === h.matchId ? null : h.matchId);
                  }}
                />
              );
            })}
            <span className="pageno">{p.index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A KIEMELÉS BUBORÉKSÚGÓJA — megmondja, mi lesz, és mit tehetsz.
 *
 * A régi súgó („Kovács János → Kvarcos Tűzkő") akkor is a csereszöveget írta
 * ki, ha a csere NEM történik meg: a kikapcsolt névnél és a köznévnek ítélt
 * szónál is. Az ügyvéd tehát azt olvasta, hogy cserélünk, miközben nem
 * cserélünk — ez a legdrágább fajta félreértés ebben a programban.
 */
/**
 * A TALÁLAT SORA A FRISS DÖNTÉSSEL — az elemzés bevárása nélkül.
 *
 * A kattintás azonnal látszik: a `decisions` tároló friss értéke felülírja
 * azt, amit az elemzés még a régi állapotból hozott. A következő elemzés
 * ugyanezt adja vissza, tehát nem két igazság van, csak az egyik hamarabb
 * ér a képernyőre.
 */
/**
 * A KIJELÖLT TALÁLAT LÁTÓTÉRBE HOZÁSA — de csak ha tényleg nem látszik.
 *
 * A feltétel nem finomkodás: a kijelölést az iratra KATTINTÁS is állítja, és
 * a feltétel nélkül a képernyő minden kattintásra középre görgette a
 * megkattintott szót — elmozdult a felhasználó mutatója alól. Ami már
 * látszik, azt nem mozgatjuk; ahova a lépegetés ugrik, az odagörög.
 *
 * KÉT NÉZET HASZNÁLJA: a lapképes és a szöveges is. Korábban csak a lapképesé
 * volt, vagyis DOCX-en és TXT-n — a jogi iratok többségén — a „lépegetésre az
 * irat odagörög" ígéret némán nem teljesült.
 */
function gorgessOda(tarto: HTMLElement | null, selected: number | null): void {
  if (selected === null || !tarto) return;
  const el = tarto.querySelector(`[data-hl="${selected}"]`);
  if (!el) return;
  const e = el.getBoundingClientRect();
  const t = tarto.getBoundingClientRect();
  if (e.top >= t.top && e.bottom <= t.bottom) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function frissSor(m: MatchRow, dontesek: Record<number, 'accept' | 'skip'> | undefined): MatchRow {
  const d = dontesek?.[m.id];
  return d === undefined ? m : { ...m, decision: d };
}

function kiemelesSugo(m: MatchRow, kapcsolhato: boolean): string {
  const kimenet = matchOutcome(m);
  const fej =
    kimenet === 'csere'
      ? `${m.surface} → ${m.replacement ?? '—'}`
      : kimenet === 'bizonytalan'
        ? `${m.surface} — bizonytalan, még nincs eldöntve (a program „${m.replacement ?? '—'}" szöveget írna a helyére)`
        : `${m.surface} — nincs csere, az eredeti szöveg marad`;
  if (!kapcsolhato) return `${fej}\n${m.reason}`;
  const teendo = kimenet === 'csere' ? 'Kattints: ne cserélje.' : 'Kattints: cserélje le.';
  return `${fej}\n${m.reason}\n${teendo}`;
}

/**
 * Szöveges nézet, ha nincs lapkép (DOCX, TXT) — VALÓDI TALÁLATOKKAL.
 *
 * Eddig ez a nézet szövegkereséssel jelölt: fogta a találatok felszíni alakját,
 * és minden előfordulásukat kiemelte a szövegben. Két baj volt vele. Az egyik,
 * hogy TÖBBET jelölt a valóságnál — a „Nagy" szó minden példányát, akkor is, ha
 * ott melléknév volt, és a program nem is nyúl hozzá. A másik, hogy a jelölés
 * nem tartozott találathoz: nem lehetett megmondani róla, mi lesz vele, és rá
 * sem lehetett kattintani.
 *
 * A motor mostantól kiadja a találatok pozícióját (`previewStart`), tehát a
 * nézet pontosan azt jelöli meg, amit a mentés is megváltoztat — és minden
 * jelölés egy konkrét találat, amit ki-be lehet kapcsolni.
 */
function TextView({
  analysis,
  selected,
  hivatalosIdk,
  dontesek,
  onSelect,
  onToggle,
}: {
  analysis: AnalysisResult;
  selected: number | null;
  hivatalosIdk: ReadonlySet<string>;
  dontesek?: Record<number, 'accept' | 'skip'>;
  /** Kapcsoló nélküli (munkalapi) nézetben a kattintás kijelöl — mint a lapképesen. */
  onSelect: (id: number | null) => void;
  onToggle?: (id: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => gorgessOda(ref.current, selected), [selected]);
  /*
    A darabolás POZÍCIÓ SZERINT megy, és az átfedéseket eldobja.

    A motor a lefedettségi térképpel gondoskodik róla, hogy ne legyen átfedés;
    ez a szűrés a védőháló arra az esetre, ha egy régebbi motor mégis adna
    ilyet. Átfedő tartományokból a szöveg megkettőződne a képernyőn.
  */
  const darabok = useMemo(() => {
    const text = analysis.previewText;
    const jelolt = analysis.matches
      .filter(
        (m): m is MatchRow & { previewStart: number; previewEnd: number } =>
          typeof m.previewStart === 'number' &&
          typeof m.previewEnd === 'number' &&
          m.previewEnd > m.previewStart &&
          m.previewEnd <= text.length,
      )
      .sort((a, b) => a.previewStart - b.previewStart);

    const out: { kulcs: string; szoveg: string; m?: MatchRow }[] = [];
    let poz = 0;
    for (const m of jelolt) {
      if (m.previewStart < poz) continue;
      if (m.previewStart > poz) {
        out.push({ kulcs: `t${poz}`, szoveg: text.slice(poz, m.previewStart) });
      }
      out.push({ kulcs: `m${m.id}`, szoveg: text.slice(m.previewStart, m.previewEnd), m });
      poz = m.previewEnd;
    }
    if (poz < text.length) out.push({ kulcs: `t${poz}`, szoveg: text.slice(poz) });
    return out;
  }, [analysis.previewText, analysis.matches]);

  return (
    <div className={`viewport source${onToggle ? ' kapcsolhato' : ''}`} ref={ref}>
      <div className="textview">
        {darabok.map((d) =>
          d.m === undefined ? (
            <span key={d.kulcs}>{d.szoveg}</span>
          ) : (
            <mark
              key={d.kulcs}
              data-hl={d.m.id}
              className={`${matchOutcome(frissSor(d.m, dontesek))} k-${matchKind(
                d.m,
                hivatalosIdk,
              )}${selected === d.m.id ? ' selected' : ''}`}
              title={kiemelesSugo(frissSor(d.m, dontesek), onToggle !== undefined)}
              role="button"
              tabIndex={0}
              onClick={() =>
                onToggle ? onToggle(d.m!.id) : onSelect(selected === d.m!.id ? null : d.m!.id)
              }
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (onToggle) onToggle(d.m!.id);
                else onSelect(selected === d.m!.id ? null : d.m!.id);
              }}
            >
              {d.szoveg}
            </mark>
          ),
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── előnézet ─────────────────────────── */

/**
 * Az ANONIMIZÁLT szöveg — az, ami a mentett fájlba kerül.
 *
 * A szöveget a motor adja (`api.previewText`), nem a felület állítja elő: a
 * felület nem ismeri sem a ragozást, sem a fedést, sem a döntéseket. Eddig a
 * szövegnézet az EREDETIT mutatta kiemelésekkel, és a felhasználó a mentés
 * pillanatáig nem látta, mi lesz a kimenet — most már a nyomtatás is ezt viszi
 * papírra.
 */
export function PreviewView({
  analysis,
  text,
  error,
  hivatalosIdk = new Set<string>(),
}: {
  analysis: AnalysisResult;
  /** null: még töltjük a motortól. */
  text: string | null;
  error: string | null;
  /** A Bszi. szerinti szereplők — tőlük kapja az előnézet az ibolya jelölést. */
  hivatalosIdk?: ReadonlySet<string>;
}) {
  const html = useMemo(() => {
    if (text === null) return '';
    const escaped = escapeHtml(text);
    /*
      MINDEN CSERE MEG VAN JELÖLVE, A FAJTÁJA SZÍNÉVEL — nem csak a nevek.

      Eddig csak a szereplők álnevei kaptak jelölést, és mind a nevek
      rózsaszínjével: az összeg- és dátumcserék jelöletlenül ültek a
      szövegben, mintha az eredeti értékek volnának. Pedig az előnézet egyetlen
      dolga megmutatni, MI VÁLTOZOTT — és a bal oldali nézet négy színét a
      felhasználó itt is ugyanabban a jelentésben várja.

      Az álneveket a szövegben MEGRAGOZVA találjuk meg („Kvarcos Tűzkővel”),
      ezért csak a szótövet jelöljük, a toldalék jelöletlenül marad utána.
      Szóhatárt (\b) tilos használni: a JS ASCII-alapon értelmezi, és az
      ékezetes betűkön csendben elromlik.
    */
    const fajtaSzerint = new Map<string, string>();
    for (const c of analysis.cast) {
      if (c.skipped || !c.replacement) continue;
      fajtaSzerint.set(
        escapeHtml(c.replacement),
        hivatalosIdk.has(c.entityId) ? 'k-hivatalos' : 'k-nev',
      );
    }
    // Az összeg és a dátum cseréi a találatokból jönnek: ők nem szereplők,
    // a `cast` nem ismeri őket.
    for (const m of analysis.matches) {
      if (m.replacement === null || matchOutcome(m) !== 'csere') continue;
      if (m.entityId === '#osszeg') fajtaSzerint.set(escapeHtml(m.replacement), 'k-osszeg');
      else if (m.entityId === '#datum') fajtaSzerint.set(escapeHtml(m.replacement), 'k-datum');
    }
    const needles = [...fajtaSzerint.keys()].sort((a, b) => b.length - a.length);
    if (needles.length === 0) return escaped;
    const re = new RegExp(needles.map(escapeRe).join('|'), 'g');
    // A `csere` osztállyal a jelölés UGYANAZOKAT a stílusszabályokat kapja,
    // mint az eredeti nézet markjai — egy színrend, két nézet.
    return escaped.replace(
      re,
      (t) => `<mark class="csere ${fajtaSzerint.get(t) ?? 'k-nev'}">${t}</mark>`,
    );
  }, [text, analysis.cast, analysis.matches, hivatalosIdk]);

  return (
    <div className="viewport preview">
      {error !== null ? (
        <div className="textview">
          <div className="note bad" style={{ margin: 0 }}>
            Az előnézet nem készült el: {error}
          </div>
        </div>
      ) : text === null ? (
        <div className="textview">
          <span className="spinner" /> Az álnevesített szöveg előállítása…
        </div>
      ) : (
        <div className="textview" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/*
  A `decisionClass` INNEN ELTŰNT.

  Ugyanazt a három állapotot számolta ki, amit a motor `outcomes` számhármasa —
  csak külön kóddal. Két másolat egy ilyen szabályból garantáltan szétcsúszik:
  a motor megtanul egy negyedik esetet (a kikapcsolt összeget), a felület
  pedig változatlanul a régi hármat rajzolja. A `matchOutcome` (src/app/types.ts)
  most már mindkét oldalt kiszolgálja.
*/

/* ─────────────────────────── szereplap ─────────────────────────── */

/*
  A „FELEK" FÜL INNEN KIKERÜLT — és ez nem egyszerűsítés, hanem az igazság
  egyesítése.

  Ugyanaz a lista két helyen állt: itt és a megnyitás utáni beállító lap „Mit
  talált?" fülén. Nem csúszhattak szét (mindkettő az elemzés eredményét
  olvasta, és mindkettő a felek listájába írt vissza), a VEZÉRLŐIK viszont
  különböztek: itt „Átírom" és „Ne cseréld" gomb, ott szerkeszthető mező és
  kapcsoló. Két külön kezelőfelület ugyanarra a döntésre azt tanítja meg a
  használónak, hogy két különböző dologról van szó — és a végén egyiken sem
  mer dönteni.

  A választás azért a beállító lapra esett, mert az a döntés HELYE: a csere
  ELŐTT áll, ott mindegyik névhez ott a csereszöveg, a szerep, az előfordulás
  és a törvény szerint bent maradó nevek listája is. Ez a panel azt tartja meg,
  amit CSAK ő tud: a találatot a saját mondatában mutatja meg, tehát arra a
  kérdésre válaszol, hogy „ez a szó ITT név volt-e" — nem arra, hogy „ezt a
  nevet cseréljük-e".
*/
/*
  A `CastPanel` ÉS A `MatchRowView` INNEN KIKERÜLT.

  A munkalapon egy teljes döntéslista állt („Átnézésre vár / Minden találat”,
  soronként „Cseréld le / Hagyd bent / Alapértelmezés” gombokkal) — vagyis
  ugyanazok a döntések, amiket a beállító lap sorai és az iratra kattintás
  már eldöntöttek, HARMADIK vezérlőkészlettel. A felhasználó ki is mondta,
  hogy furcsa egy átnéző lista, ami csak a mentés előtt jelenik meg.

  A döntés helye a beállító lap lett (kapcsoló + lépegetés + kattintás az
  iraton); ez az állomás az ellenőrzésé és a mentésé — az alábbi
  `OsszegzoPanel`.
*/

/**
 * A MUNKALAP JOBB PANELE: mi történt, és mehet-e a fájlba.
 *
 * Nem döntésfelület — a döntések a beállító lapon születnek. Itt az áll,
 * amit a mentés előtt tudni kell: hány találat cserélődik (fajtánként, a
 * bal oldali kiemelés színeivel), hány marad bent, döntött-e a program
 * ember helyett, és van-e akadálya a mentésnek.
 */
export function OsszegzoPanel({
  analysis,
  fajtak,
  autoDecidedCount,
  mentesAkadaly,
  onMentes,
  onVissza,
  onAutoReport,
}: {
  analysis: AnalysisResult;
  /** A jelmagyarázat sorai (fajta + darab) — UGYANABBÓL a számításból, mint a bal oldali sáv. */
  fajtak: { kulcs: string; osztaly: string; cimke: string; db: number }[];
  autoDecidedCount: number;
  /** Miért nem lehet menteni; `null`, ha mehet. */
  mentesAkadaly: string | null;
  onMentes: () => void;
  onVissza: () => void;
  onAutoReport: () => void;
}) {
  const csere = analysis.outcomes?.csere ?? analysis.counts.auto;
  const nincs = analysis.outcomes?.nincs ?? analysis.counts.reject;
  const bizonytalan = analysis.outcomes?.bizonytalan ?? analysis.counts.review;

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Ellenőrzés és mentés</h2>
        <p>
          A csere kész. Nézd meg az előnézeten, aztán mentsd új fájlba — az eredeti irat érintetlen
          marad.
        </p>
      </div>

      <div className="panel-body osszegzo">
        {analysis.warnings.map((w, i) => (
          <div key={i} className="note">
            {w}
          </div>
        ))}

        <div className="resultrow fo">
          <span>Lecserélve</span>
          <span className="v">{csere}</span>
        </div>
        {/* A fajtánkénti bontás UGYANAZOKKAL a színekkel, mint a bal oldali
            kiemelés és a beállító lap fejlécei — a pötty köti össze a számot
            azzal, amit a szem az iraton lát. */}
        {fajtak
          .filter((f) => !['bizonytalan', 'nincs'].includes(f.kulcs))
          .map((f) => (
            <div key={f.kulcs} className="resultrow al">
              <span>
                <span className={`dot ${f.osztaly.replace('csere ', '')}`} aria-hidden="true" /> {f.cimke}
              </span>
              <span className="v">{f.db}</span>
            </div>
          ))}
        <div className="resultrow fo">
          <span>Nincs csere — az eredeti marad</span>
          <span className="v">{nincs}</span>
        </div>

        {/*
          BIZONYTALAN TALÁLAT A MENTÉS ELŐTT: ezt nem elég egy számmal
          elintézni. Aki idáig eljutott, annak meg kell mondani, hogy ezek az
          előfordulások ebben az állásban NEM cserélődnek — és hogy hol tudja
          eldönteni őket.
        */}
        {bizonytalan > 0 && (
          <div className="note">
            <b>{bizonytalan} találat még bizonytalan</b> — ezek most nem cserélődnek. A beállító
            lapon a borostyán pöttyös soroknál egyenként végigmehetsz rajtuk.
            <div className="pathacts">
              <button className="btn sm" onClick={onVissza}>
                Megnézem őket
              </button>
            </div>
          </div>
        )}

        {autoDecidedCount > 0 && (
          <div className="note">
            <b>{autoDecidedCount} bizonytalan találatról a program döntött</b> ember helyett.
            <div className="pathacts">
              <button className="btn sm" onClick={onAutoReport}>
                Melyek ezek?
              </button>
            </div>
          </div>
        )}

        {mentesAkadaly !== null && (
          <div className="note bad">{mentesAkadaly}</div>
        )}
      </div>

      <div className="panel-foot">
        <button className="btn ghost" onClick={onVissza}>
          Vissza a beállításokhoz
        </button>
        <button
          className="btn primary"
          disabled={mentesAkadaly !== null}
          title={mentesAkadaly ?? 'Mentés új fájlba (Ctrl+S)'}
          onClick={onMentes}
        >
          Mentés másként…
        </button>
      </div>
    </aside>
  );
}

/**
 * A találat körüli szöveg három részre bontva: előtte, a találat, utána.
 *
 * Exportálva is van, mert a mentés utáni jelentés UGYANEZT a környezetet
 * rajzolja ki, csak másik ablakban. Két külön bontás előbb-utóbb kétféleképp
 * jelölné ki a találatot, és a felhasználó ugyanarról a tételről két különböző
 * képet látna.
 */
export function splitContext(ctx: string): [string, string, string] {
  const a = ctx.indexOf('⟦');
  const b = ctx.indexOf('⟧');
  if (a < 0 || b < 0) return [ctx, '', ''];
  return [ctx.slice(0, a), ctx.slice(a + 1, b), ctx.slice(b + 1)];
}
