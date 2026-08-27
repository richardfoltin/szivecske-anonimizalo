import { useEffect, useMemo, useRef, useState } from 'react';
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
  csere: 'lecseréljük',
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
  useEffect(() => {
    if (selected === null) return;
    const el = ref.current?.querySelector(`[data-hl="${selected}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selected]);

  if (analysis.pages.length === 0) {
    return (
      <TextView
        analysis={analysis}
        selected={selected}
        hivatalosIdk={hivatalosIdk}
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
                  onClick={
                    onToggle
                      ? () => onToggle(h.matchId)
                      : () => onSelect(selected === h.matchId ? null : h.matchId)
                  }
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
  onToggle,
}: {
  analysis: AnalysisResult;
  selected: number | null;
  hivatalosIdk: ReadonlySet<string>;
  dontesek?: Record<number, 'accept' | 'skip'>;
  onToggle?: (id: number) => void;
}) {
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
    <div className={`viewport source${onToggle ? ' kapcsolhato' : ''}`}>
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
              {...(onToggle
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => onToggle(d.m!.id),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      onToggle(d.m!.id);
                    },
                  }
                : {})}
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
}: {
  analysis: AnalysisResult;
  /** null: még töltjük a motortól. */
  text: string | null;
  error: string | null;
}) {
  const html = useMemo(() => {
    if (text === null) return '';
    const escaped = escapeHtml(text);
    // Az álneveket a szövegben MEGRAGOZVA találjuk meg („Kvarcos Tűzkővel”),
    // ezért csak a szótövet jelöljük, a toldalék jelöletlenül marad utána.
    // Szóhatárt (\b) tilos használni: a JS ASCII-alapon értelmezi, és az
    // ékezetes betűkön csendben elromlik.
    const needles = [
      ...new Set(analysis.cast.filter((c) => !c.skipped && c.replacement).map((c) => c.replacement)),
    ].sort((a, b) => b.length - a.length);
    if (needles.length === 0) return escaped;
    const re = new RegExp(needles.map((n) => escapeRe(escapeHtml(n))).join('|'), 'g');
    return escaped.replace(re, (m) => `<mark>${m}</mark>`);
  }, [text, analysis.cast]);

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
type Tab = 'review' | 'all';

export function CastPanel({
  analysis,
  selected,
  onSelect,
  onDecide,
  reviewFocus = 0,
}: {
  analysis: AnalysisResult;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onDecide: (id: number, d: 'accept' | 'skip' | undefined) => void;
  /**
   * Számláló: ha nő, a szereplap az „Átnézésre vár” fülre ugrik.
   *
   * A kérdezés nélküli útról visszaváltó felhasználó pontosan azért kattintott,
   * hogy lássa a bizonytalan találatokat — ha a szereplap a másik fülön
   * maradna, a visszaút a semmibe vinne. Számláló, nem logikai érték: ugyanaz
   * a kérés kétszer is jöhet, és a másodiknak ugyanúgy oda kell vinnie.
   */
  reviewFocus?: number;
}) {
  const review = analysis.matches.filter((m) => m.disposition !== 'auto' && !m.decision);
  /*
    A KEZDŐ FÜL AZT MUTATJA, AHOL MUNKA VAN.

    Átnézős úton az eldöntetlen találatok — azokért van nyitva ez a panel.
    Kérdezés nélküli úton viszont egyetlen ilyen sincs, és egy üres, pipával
    nyugtázó fül azt üzenné, hogy nincs mit nézni: ott a teljes lista a
    hasznos kezdőkép.
  */
  const [tab, setTab] = useState<Tab>(() =>
    analysis.matches.some((m) => m.disposition !== 'auto' && !m.decision) ? 'review' : 'all',
  );

  // Az iratban kijelölt kiemelés a TELJES listán található meg biztosan: az
  // átnézési fülről egy már eldöntött találat hiányozna, és a kattintás a
  // semmibe vinne.
  useEffect(() => {
    if (selected !== null) setTab('all');
  }, [selected]);

  // A nulladik érték a kezdőállapot, nem kérés: enélkül a szereplap minden
  // megnyitáskor az átnézési fülön indulna.
  useEffect(() => {
    if (reviewFocus > 0) setTab('review');
  }, [reviewFocus]);

  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>Találatok</h2>
        <p>
          {analysis.cast.length} fél · {analysis.matches.length} találat az iratban
        </p>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'review' ? ' active' : ''}`} onClick={() => setTab('review')}>
          Átnézésre vár <span className="count">{review.length}</span>
        </button>
        <button className={`tab${tab === 'all' ? ' active' : ''}`} onClick={() => setTab('all')}>
          Minden találat <span className="count">{analysis.matches.length}</span>
        </button>
      </div>

      <div className="panel-body">
        {/* Az elemzés figyelmeztetései a FÜLEKTŐL FÜGGETLENÜL állnak: eddig a
            Felek fülön voltak, és azzal együtt tűntek volna el — pedig az
            egész iratra vonatkoznak, nem a fül tartalmára. */}
        {analysis.warnings.map((w, i) => (
          <div key={i} className="note" style={{ margin: '12px 14px' }}>
            {w}
          </div>
        ))}

        {tab === 'review' &&
          (review.length === 0 ? (
            <div className="empty">
              <div className="big">✓</div>
              Nincs eldöntetlen találat. Minden, amit megtaláltunk, biztosan a megadott felekhez
              tartozik.
            </div>
          ) : (
            review.map((m) => (
              <MatchRowView
                key={m.id}
                m={m}
                selected={selected === m.id}
                onSelect={onSelect}
                onDecide={onDecide}
              />
            ))
          ))}

        {tab === 'all' &&
          analysis.matches.map((m) => (
            <MatchRowView
              key={m.id}
              m={m}
              selected={selected === m.id}
              onSelect={onSelect}
              onDecide={onDecide}
            />
          ))}
      </div>
    </aside>
  );
}

function MatchRowView({
  m,
  selected,
  onSelect,
  onDecide,
}: {
  m: MatchRow;
  selected: boolean;
  onSelect: (id: number | null) => void;
  onDecide: (id: number, d: 'accept' | 'skip' | undefined) => void;
}) {
  /*
    A PROGRAM DÖNTÉSE NEM UGYANAZ, MINT A FELHASZNÁLÓÉ.

    Az „elfogadva" felirat a saját döntését jelenti; ha a program helyette
    döntött, ugyanaz a szó azt hazudná, hogy ő döntött. A `MatchRow.autoDecided`
    pontosan ezt a különbséget hordozza — enélkül a képernyőn a kettő
    megkülönböztethetetlen volna, és a felhasználó nem tudná, hol nézzen utána.
  */
  const label = m.autoDecided
    ? m.decision === 'skip'
      ? 'a program bent hagyta'
      : 'a program cserélte'
    : m.decision === 'accept'
      ? 'elfogadva'
      : m.decision === 'skip'
        ? 'kihagyva'
        : m.disposition === 'auto'
          ? 'automatikus'
          : m.disposition === 'review'
            ? 'átnézésre'
            : 'köznév?';
  const pillClass = m.decision === 'skip' ? 'reject' : m.decision === 'accept' ? 'auto' : m.disposition;

  const [before, mid, after] = splitContext(m.context);

  return (
    <div className={`matchrow${selected ? ' selected' : ''}`} onClick={() => onSelect(selected ? null : m.id)}>
      <div className="top">
        <span className={`pill ${pillClass}`}>{label}</span>
        <span className="surface">{m.surface}</span>
        {m.replacement && (
          <>
            <span style={{ color: 'var(--muted)' }}>→</span>
            <span className="to">{m.replacement}</span>
          </>
        )}
      </div>
      <div className="ctx">
        {before}
        <b>{mid}</b>
        {after}
      </div>
      <div className="why">{m.reason}</div>
      <div className="acts" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn sm"
          disabled={m.decision === 'accept'}
          onClick={() => onDecide(m.id, 'accept')}
        >
          Cseréld le
        </button>
        <button className="btn sm" disabled={m.decision === 'skip'} onClick={() => onDecide(m.id, 'skip')}>
          Hagyd bent
        </button>
        {m.decision && (
          <button className="btn ghost sm" onClick={() => onDecide(m.id, undefined)}>
            Alapértelmezés
          </button>
        )}
      </div>
    </div>
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
