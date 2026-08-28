import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { matchKind, matchOutcome } from './api';
import type {
  AnalysisResult,
  DocSection,
  MatchKind,
  MatchRow,
  PreviewPages,
  TextSpan,
} from './api';

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
  szakasz,
  selected,
  onSelect,
  hivatalosIdk = new Set<string>(),
  dontesek,
  onToggle,
  onContext,
}: {
  analysis: AnalysisResult;
  /**
   * A MEGJELENÍTETT IRAT saját része: lapképek, kiemelés-koordináták, szöveg.
   *
   * Egy ügyben több irat is nyitva lehet, és a bal panel egyszerre egyet mutat
   * — a találatok listája (`analysis.matches`) viszont MINDEGYIKÉ, mert a
   * döntések az egész ügyre szólnak. Hiányában az elemzés gyökere áll be, ami
   * az első irat szakasza: így a fejlesztői álkimenet és az egy iratra írt
   * hívások változatlanul működnek.
   */
  szakasz?: DocSection;
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
  /**
   * JOBB KATTINTÁS AZ IRATON — a javító menü kérése.
   *
   * A `matchId` annak a találatnak az azonosítója, amelyikre a kattintás
   * esett; `null`, ha nem találatra (olyankor a kijelölt szöveg a tárgy). A
   * menü TARTALMÁT nem itt döntjük el: ez a nézet a találatokról tud, a
   * felekről és a döntésekről nem — azok az `App.tsx`-ben laknak.
   */
  onContext?: (e: React.MouseEvent, matchId: number | null) => void;
}) {
  const pages = szakasz?.pages ?? analysis.pages;
  const highlights = szakasz?.highlights ?? analysis.highlights;
  const textSpans = szakasz?.textSpans ?? analysis.textSpans ?? [];
  const previewText = szakasz?.previewText ?? analysis.previewText;

  const byPage = useMemo(() => {
    const m = new Map<number, typeof highlights>();
    for (const h of highlights) {
      const list = m.get(h.page) ?? [];
      list.push(h);
      m.set(h.page, list);
    }
    return m;
  }, [highlights]);

  const matchById = useMemo(
    () => new Map(analysis.matches.map((m) => [m.id, m])),
    [analysis.matches],
  );

  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => gorgessOda(ref.current, selected), [selected]);

  if (pages.length === 0) {
    return (
      <TextView
        analysis={analysis}
        previewText={previewText}
        tolIg={szakasz ? [szakasz.matchIdTol, szakasz.matchIdIg] : null}
        selected={selected}
        hivatalosIdk={hivatalosIdk}
        onSelect={onSelect}
        {...(dontesek ? { dontesek } : {})}
        {...(onToggle ? { onToggle } : {})}
        {...(onContext ? { onContext } : {})}
      />
    );
  }

  return (
    // A „source" osztály nem díszítés: a nyomtatási szabályok ebből tudják,
    // hogy ezen a nézeten a VALÓDI nevek állnak, és papírra sosem kerülhet.
    <div
      className={`viewport source${onToggle ? ' kapcsolhato' : ''}`}
      ref={ref}
      {...(onContext ? { onContextMenu: (e: React.MouseEvent) => onContext(e, hlAlatta(e)) } : {})}
    >
      <div className="pagewrap">
        {pages.map((p) => (
          <div className="page" key={p.index}>
            <img src={p.dataUrl} alt={`${p.index + 1}. oldal`} draggable={false} />
            <SzovegReteg spans={textSpans} page={p.index} />
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

/**
 * KIJELÖLHETŐ, ÁTLÁTSZÓ SZÖVEG A LAPKÉP FÖLÖTT — a PDF-olvasók fogása.
 *
 * MIÉRT KELL. A PDF a felületen kép: a lapot a natív rajzoló festi meg, és a
 * képen nincs szöveg, amit meg lehetne fogni. A jobb gombos „jelöld ki, és
 * mondd meg, minek értelmezze" tehát pontosan azon a formátumon nem működött
 * volna, ami a program fő tárgya — a bírósági iratok PDF-ben járnak. Ez a
 * réteg minden szövegszakaszt a saját helyére tesz, átlátszó betűvel: nem
 * látszik, de kijelölhető, és a kijelölés a KÉPEN LÁTHATÓ szavakon fut végig.
 *
 * A RÉTEG A KIEMELÉSEK ALATT VAN. Fölöttük ülve elnyelné a kattintást, és az
 * iraton nem lehetne többé ki-be kapcsolni egy cserét — pedig az a bal panel
 * fő működése. Így viszont a kijelölés ott indul, ahol új dolgot lehet
 * felvenni (a jelöletlen szövegen), a már megjelölt szavakra pedig a
 * kiemelés saját jobb gombos menüje válaszol.
 *
 * A VÍZSZINTES IGAZÍTÁS mérésből jön. A betűméretet a motor adja (a lap
 * arányában, tehát a nagyítást magától követi), de a mi betűnk nem az iratéi:
 * ugyanaz a szöveg nálunk szélesebb vagy keskenyebb. A `scaleX` a mért
 * szélességet ráhúzza a ténylegesen kirajzoltra — enélkül a sor végére a
 * kijelölés fél szónyit csúszna el a betűkről.
 */
function SzovegReteg({ spans, page }: { spans: TextSpan[]; page: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sajat = useMemo(() => spans.filter((s) => s.page === page), [spans, page]);

  useLayoutEffect(() => {
    const tarto = ref.current;
    if (!tarto) return;
    const igazit = (): void => {
      /*
        A LAP SZÉLESSÉGE KÉPPONTBAN — enélkül a számítás mértékegységet keverne.

        A motor a szakasz szélességét a lap ARÁNYÁBAN adja meg (0..1); a mért
        szélesség viszont KÉPPONT. A kettőt közvetlenül elosztva a nagyítás
        nagyságrendekkel mellémegy — a réteg tizedére zsugorodik, és a
        kijelölésnek semmi köze nem lesz a képen látható szavakhoz. A réteg
        `inset: 0` a lapon, tehát a saját szélessége maga a lapszélesség.
      */
      const lapSzelesseg = tarto.getBoundingClientRect().width;
      if (lapSzelesseg <= 0) return;
      const elemek = tarto.querySelectorAll<HTMLElement>('span[data-arany]');
      for (const el of elemek) {
        const arany = Number(el.dataset.arany);
        if (!Number.isFinite(arany) || arany <= 0) continue;
        const celKeppont = arany * lapSzelesseg;
        // A mérés a saját, torzítatlan szélességen fut — különben minden
        // újramérés az ELŐZŐ nyújtást szorozná tovább.
        el.style.transform = 'none';
        const sajatSzelesseg = el.getBoundingClientRect().width;
        if (sajatSzelesseg > 0) el.style.transform = `scaleX(${celKeppont / sajatSzelesseg})`;
      }
    };
    igazit();
    // A lapkép a panel szélességével nagyítódik: méretváltáskor újra kell mérni.
    const figyelo = new ResizeObserver(igazit);
    figyelo.observe(tarto);
    return () => figyelo.disconnect();
  }, [sajat]);

  if (sajat.length === 0) return null;

  return (
    /*
      NEM `aria-hidden`. Ez a réteg a lap EGYETLEN olvasható szövege: a lapkép
      egy PNG, alt-szövege csak az oldalszám. Elrejtve a PDF a képernyőolvasó
      számára üres lap volna — a réteggel viszont felolvasható.
    */
    <div className="szovegreteg" ref={ref}>
      {sajat.map((s, i) => (
        <span
          key={i}
          /* ARÁNY, nem százalék: a nyújtás számítása képponttal szoroz. A
             mértékegység a névben áll, mert épp ezen csúszott el egyszer. */
          data-arany={s.width}
          style={{
            left: `${s.left * 100}%`,
            top: `${s.top * 100}%`,
            height: `${s.height * 100}%`,
            fontSize: `${s.fontSize * 100}cqw`,
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}

/**
 * MELYIK TALÁLATRA ESETT A JOBB KATTINTÁS — egyetlen figyelővel, mindkét nézeten.
 *
 * A kiemelés a lapképen `div`, a szövegben `mark`; ami közös bennük, az a
 * `data-hl` azonosító. A `closest` ezt keresi meg a kattintás helyétől
 * felfelé, tehát a nézetnek elég EGY `onContextMenu` figyelője — nem kell
 * mindegyik jelölésre külön, és a kettő nem is tud kétszer elsülni.
 *
 * `null`: nem jelölésre kattintottak. Olyankor a menü a kijelölt szövegről
 * szól.
 */
function hlAlatta(e: React.MouseEvent): number | null {
  const el = (e.target as HTMLElement | null)?.closest?.('[data-hl]');
  if (!el) return null;
  const n = Number((el as HTMLElement).dataset.hl);
  return Number.isFinite(n) ? n : null;
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
  previewText,
  tolIg,
  selected,
  hivatalosIdk,
  dontesek,
  onSelect,
  onToggle,
  onContext,
}: {
  analysis: AnalysisResult;
  /** A MEGJELENÍTETT irat szövege — több irat esetén nem az elemzés gyökeréé. */
  previewText: string;
  /** A megjelenített irat találat-azonosító tartománya; `null`: mind. */
  tolIg: [number, number] | null;
  selected: number | null;
  hivatalosIdk: ReadonlySet<string>;
  dontesek?: Record<number, 'accept' | 'skip'>;
  /** Kapcsoló nélküli (munkalapi) nézetben a kattintás kijelöl — mint a lapképesen. */
  onSelect: (id: number | null) => void;
  onToggle?: (id: number) => void;
  onContext?: (e: React.MouseEvent, matchId: number | null) => void;
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
    const text = previewText;
    /*
      CSAK EBBEN AZ IRATBAN álló találatok. Több irat mellett a `matches` az
      egész ügyé, a pozíciók (`previewStart`) viszont IRATONKÉNT nullától
      indulnak — a másik irat találatait ideszámolva a jelölés véletlenszerű
      szavakra kerülne. A szakasz azonosító-tartománya választja szét őket.
    */
    const jelolt = analysis.matches
      .filter((m) => tolIg === null || (m.id >= tolIg[0] && m.id <= tolIg[1]))
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
  }, [previewText, analysis.matches, tolIg]);

  return (
    <div
      className={`viewport source${onToggle ? ' kapcsolhato' : ''}`}
      ref={ref}
      {...(onContext ? { onContextMenu: (e: React.MouseEvent) => onContext(e, hlAlatta(e)) } : {})}
    >
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

/* ─────────────────────── összevetés: régi és új ─────────────────────── */

/**
 * A RÉGI ÉS AZ ÚJ EGYMÁS MELLETT — áthúzva és kiemelve.
 *
 * A harmadik nézet arra a kérdésre válaszol, amire a másik kettő külön-külön
 * nem tud: „MI VÁLTOZOTT?" Az eredeti nézeten a valódi nevek állnak, az
 * előnézeten az álnevek — a kettő közti eltérést a felhasználónak fejben
 * kellett összevetnie, két fül között oda-vissza kapcsolgatva.
 *
 * Itt mindkettő ott áll: a lecserélt szöveg ÁTHÚZVA, a fajtája színével, és
 * közvetlenül utána az álnév, ugyanabban a kiemelésben, amit az előnézeten is
 * visel. Így a párosítás nem emlékezet kérdése.
 *
 * MIÉRT SZÖVEG, LAPKÉP HELYETT. PDF-en az előnézet a kész oldalt rajzolja ki,
 * itt viszont nem az a kérdés, hogy MILYEN LESZ az irat, hanem hogy MI
 * VÁLTOZIK BENNE. Ehhez a két szövegnek egymás mellett kell állnia; egy
 * lapképre ezt nem lehet ráfesteni úgy, hogy olvasható maradjon.
 */
export function OsszevetesView({
  analysis,
  szakasz,
  hivatalosIdk = new Set<string>(),
  dontesek,
  selected,
  onSelect,
}: {
  analysis: AnalysisResult;
  szakasz?: DocSection;
  hivatalosIdk?: ReadonlySet<string>;
  dontesek?: Record<number, 'accept' | 'skip'>;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const szoveg = szakasz?.previewText ?? analysis.previewText;
  const bekezdesek = szakasz?.paragraphs ?? analysis.paragraphs ?? [];
  const tolIg: [number, number] | null = szakasz
    ? [szakasz.matchIdTol, szakasz.matchIdIg]
    : null;
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => gorgessOda(ref.current, selected), [selected]);

  /*
    A SZÖVEG BEKEZDÉSEKRE BONTVA, ÉS BEKEZDÉSEN BELÜL DARABOKRA.

    Két dolgot kell egyszerre megoldani: a találatok a szöveg POZÍCIÓIRA
    hivatkoznak (`previewStart`), a szedés viszont bekezdéseket kíván. Ezért
    előbb bekezdésekre vágjuk a szöveget a motor határai mentén, aztán
    bekezdésen BELÜL daraboljuk a találatokra — a pozíciók végig a teljes
    szövegre értendők, tehát nem csúszhat el semmi.

    MIÉRT NEM ELÉG A SORTÖRÉS. Egy `\n\n` szövegcsomópont bekezdésnek
    LÁTSZIK, de nem az: nem lehet sorkizárttá tenni, nem lehet középre zárni,
    és a szedés minden szabálya (behúzás, térköz) elérhetetlen marad. A
    bekezdés akkor bekezdés, ha saját eleme van.
  */
  const szedes = useMemo(() => {
    const jelolt = analysis.matches
      .filter((m) => tolIg === null || (m.id >= tolIg[0] && m.id <= tolIg[1]))
      .filter(
        (m): m is MatchRow & { previewStart: number; previewEnd: number } =>
          typeof m.previewStart === 'number' &&
          typeof m.previewEnd === 'number' &&
          m.previewEnd > m.previewStart &&
          m.previewEnd <= szoveg.length,
      )
      .sort((a, b) => a.previewStart - b.previewStart);

    // A bekezdések határai; ha a motor nem adott (DOCX, TXT), a szöveg saját
    // sortörései tagolják — ott eleve van tagolás.
    const hatarok =
      bekezdesek.length > 0
        ? [...new Set([0, ...bekezdesek.map((b) => b.start)])].sort((a, b) => a - b)
        : [0, ...[...szoveg.matchAll(/\n{2,}/g)].map((m) => (m.index ?? 0) + m[0].length)];
    const kozepre = new Set(bekezdesek.filter((b) => b.center).map((b) => b.start));

    let mutato = 0;
    return hatarok.map((kezd, i) => {
      const veg = hatarok[i + 1] ?? szoveg.length;
      const darabok: { kulcs: string; szoveg: string; m?: MatchRow }[] = [];
      let poz = kezd;
      while (mutato < jelolt.length && jelolt[mutato]!.previewEnd <= kezd) mutato++;
      for (let j = mutato; j < jelolt.length; j++) {
        const m = jelolt[j]!;
        if (m.previewStart >= veg) break;
        if (m.previewStart < poz) continue;
        if (m.previewStart > poz) {
          darabok.push({ kulcs: `t${poz}`, szoveg: szoveg.slice(poz, m.previewStart) });
        }
        darabok.push({ kulcs: `m${m.id}`, szoveg: szoveg.slice(m.previewStart, m.previewEnd), m });
        poz = m.previewEnd;
      }
      if (poz < veg) darabok.push({ kulcs: `t${poz}`, szoveg: szoveg.slice(poz, veg) });
      return { kulcs: `b${kezd}`, kozepre: kozepre.has(kezd), darabok };
    });
  }, [szoveg, analysis.matches, tolIg, bekezdesek]);

  return (
    <div className="viewport osszevetes" ref={ref}>
      <div className="textview szedett">
        {szedes.map((b) => (
          <p key={b.kulcs} className={b.kozepre ? 'kozepre' : undefined}>
        {b.darabok.map((d) => {
          if (d.m === undefined) return <span key={d.kulcs}>{d.szoveg}</span>;
          const m = frissSor(d.m, dontesek);
          const fajta = matchKind(m, hivatalosIdk);
          const kimenet = matchOutcome(m);
          /*
            AMI NEM CSERÉLŐDIK, AZT NEM HÚZZUK ÁT. Az áthúzás azt állítja, hogy
            ez a szöveg eltűnik az iratból; egy bent maradó néven ez hazugság
            volna. Ott a jelölés ugyanaz marad, ami az eredeti nézeten.
          */
          if (kimenet !== 'csere' || m.replacement === null) {
            return (
              <mark
                key={d.kulcs}
                data-hl={m.id}
                className={`${kimenet} k-${fajta}${selected === m.id ? ' selected' : ''}`}
                title={`${m.surface} — nem cserélődik\n${m.reason}`}
                onClick={() => onSelect(selected === m.id ? null : m.id)}
              >
                {d.szoveg}
              </mark>
            );
          }
          return (
            <span
              key={d.kulcs}
              data-hl={m.id}
              className={`valtozas${selected === m.id ? ' selected' : ''}`}
              title={`${m.surface} → ${m.replacement}\n${m.reason}`}
              onClick={() => onSelect(selected === m.id ? null : m.id)}
            >
              <del className={`k-${fajta}`}>{d.szoveg}</del>
              <mark className={`csere k-${fajta}`}>{m.replacement}</mark>
            </span>
          );
        })}
          </p>
        ))}
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
  lapok,
  error,
  hivatalosIdk = new Set<string>(),
}: {
  analysis: AnalysisResult;
  /** null: még töltjük a motortól — vagy a lapképes út vitte el. */
  text: string | null;
  /**
   * AZ ÁLNEVESÍTETT IRAT LAPKÉPEI — PDF-en ez az előnézet.
   *
   * A motor a KÉSZ kimeneti bájtokat rajzolja ki, tehát ami itt látszik, az
   * nem hasonlít a mentett fájlra: az. Enélkül az előnézet a lapról leszedett
   * szöveget mutatta egyetlen folyó bekezdésben — se sortörés, se hasáb, se
   * táblázat, se fejléc a helyén —, és a felhasználónak külön mondatban
   * kellett elmagyarázni, hogy amit lát, az nem a kimenet képe.
   *
   * `null`: nincs (DOCX, TXT, régebbi híd, vagy hiányzik a natív rajzoló) —
   * olyankor a `text` szövege áll be, ahogy eddig.
   */
  lapok: PreviewPages | null;
  error: string | null;
  /** A Bszi. szerinti szereplők — tőlük kapja az előnézet az ibolya jelölést. */
  hivatalosIdk?: ReadonlySet<string>;
}) {
  const matchById = useMemo(
    () => new Map(analysis.matches.map((m) => [m.id, m])),
    [analysis.matches],
  );

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

  if (error !== null) {
    return (
      <div className="viewport preview">
        <div className="textview">
          <div className="note bad" style={{ margin: 0 }}>
            Az előnézet nem készült el: {error}
          </div>
        </div>
      </div>
    );
  }

  /*
    A LAPKÉPES ÚT — a kész kimenet kirajzolva, a cserék megjelölve.

    A jelölés UGYANAZ a `.hl` elem, mint az eredeti nézeten, csak nem
    kapcsolható: az előnézeten már nincs mit eldönteni, ez az irat állapota.
    A színrend viszont közös — ami ott rózsaszín volt, az itt is az.
  */
  if (lapok !== null) {
    const oldalanként = new Map<number, typeof lapok.highlights>();
    for (const h of lapok.highlights) {
      oldalanként.set(h.page, [...(oldalanként.get(h.page) ?? []), h]);
    }
    return (
      <div className="viewport preview">
        <div className="pagewrap">
          {lapok.pages.map((p) => (
            <div className="page" key={p.index}>
              <img src={p.dataUrl} alt={`${p.index + 1}. oldal — álnevesítve`} draggable={false} />
              {(oldalanként.get(p.index) ?? []).map((h) => {
                const m = matchById.get(h.matchId);
                return (
                  <div
                    key={h.matchId}
                    className={`hl csere k-${m ? matchKind(m, hivatalosIdk) : 'nev'}`}
                    style={{
                      left: `${h.left * 100}%`,
                      top: `${h.top * 100}%`,
                      width: `${h.width * 100}%`,
                      height: `${h.height * 100}%`,
                    }}
                    title={m ? elonezetSugo(m) : ''}
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

  return (
    <div className="viewport preview">
      {text === null ? (
        <div className="textview">
          <span className="spinner" /> Az álnevesített irat előállítása…
        </div>
      ) : (
        <div className="textview" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

/**
 * A LAPKÉPES ELŐNÉZET BUBORÉKSÚGÓJA — visszafelé olvas.
 *
 * Az eredeti nézeten a kérdés az, hogy „mi lesz ezzel a szóval"; itt már az,
 * hogy „mi állt ennek a helyén". A nyíl iránya ezért fordított, és ez nem
 * szőrszálhasogatás: az álnév és a valódi név ugyanolyan hihető magyar név,
 * a kettőt csak az különbözteti meg, melyik oldalán áll a nyílnak.
 */
function elonezetSugo(m: MatchRow): string {
  return `${m.replacement ?? '—'} ← az eredetiben: ${m.surface}
${m.reason}`;
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
 * A BEÁLLÍTÓ LAP HARMADIK FÜLE: MIRŐL DÖNTÖTT A PROGRAM HELYETTED.
 *
 * A SZÁMOK INNEN KIKERÜLTEK, és ez nem kurtítás. Ugyanaz az öt szám állt itt,
 * ami az irat fölötti jelmagyarázatban („név · 78, összeg · 9, dátum · 13,
 * nincs csere · 1") és a lap alján az állapotsorban („100 lecserélve … 101
 * találat”) — HARMADSZOR. Egy szám három helyen nem háromszor olyan
 * meggyőző, hanem azt a kérdést szüli, hogy melyik az igazi; a mentés előtti
 * utolsó képernyőn pedig épp az veszett el mögötte, amit CSAK itt lehet
 * megtudni: hol döntött a program ember helyett.
 *
 * AMI ITT MARAD, AZ MIND TEENDŐ vagy figyelmeztetés — nem összefoglaló:
 *   – amiről a program döntött helyetted (a lap fő tartalma),
 *   – ami még eldöntetlen, és ezért NEM cserélődik,
 *   – az elemzés figyelmeztetései (összecsukva),
 *   – ami a mentést blokkolja.
 *
 * A mentés gombja a lap közös láblécében áll, a többi fül továbblépő
 * gombjának helyén — így a folyamat mindhárom állomásán ugyanott van a
 * következő lépés.
 */
export function OsszegzoLap({
  analysis,
  autoJelentes,
  mentesAkadaly,
  onVissza,
}: {
  analysis: AnalysisResult;
  /**
   * AMIRŐL A PROGRAM DÖNTÖTT HELYETTED — kész lista, nem szám és nem gomb.
   *
   * Eddig egy „Melyek ezek?" gomb állt itt, ami ablakot nyitott: a felhasználó
   * a mentés előtti utolsó képernyőn azt látta, hogy 10 dologról döntöttek
   * helyette, és hogy ezért még kattintania kell egyet. A lista viszont pont
   * ide való — ez az az állomás, ahol az irat átnézése történik.
   *
   * Csomópontként érkezik, nem sorokként: a jelentés a `dialogs.tsx`-ben lakik
   * (a mentés utáni ablak is ugyanazt mutatja), és ez a fájl nem hívhatja meg
   * onnan — a `dialogs.tsx` már innen importál, a kör pedig oda-vissza nem
   * mehet. `null`, ha a program nem döntött semmiről.
   */
  autoJelentes: React.ReactNode;
  /** Miért nem lehet menteni; `null`, ha mehet. A gomb a lap láblécében áll. */
  mentesAkadaly: string | null;
  /** Vissza a „Mit cserélünk?" fülre — ott lehet dönteni a bizonytalanokról. */
  onVissza: () => void;
}) {
  const bizonytalan = analysis.outcomes?.bizonytalan ?? analysis.counts.review;
  /*
    UGYANAZ A MONDAT EGYSZER. A dátumterv iratrészenként keletkezik, és a
    „csak hónap pontossággal szerepel" figyelmeztetést mindegyik külön adja ki
    — a listán ettől kétszer-háromszor állt ugyanaz a bekezdés, csak más
    darabszámmal. A szó szerinti egyezéseket itt vonjuk össze.
  */
  const figyelmeztetesek = useMemo(() => [...new Set(analysis.warnings)], [analysis.warnings]);

  /*
    NINCS ÁTNÉZNIVALÓ — ezt is ki kell mondani.

    Ha a program nem döntött ember helyett, nincs eldöntetlen találat, nincs
    figyelmeztetés és nincs mentési akadály, akkor ez a fül ÜRESEN állna. Egy
    üres lap a folyamat utolsó állomásán azt a kérdést veti fel, hogy
    betöltődött-e egyáltalán — pedig épp a jó hírt jelenti.
  */
  const nincsAtneznivalo =
    autoJelentes === null && bizonytalan === 0 && figyelmeztetesek.length === 0 && mentesAkadaly === null;

  return (
    <>
      <div className="osszegzo">
        {/*
          A JELENTÉSNEK SAJÁT FEJLÉCE VAN („Amiről a program döntött
          helyetted", a darabszámmal), ezért NEM teszünk fölé lapcímet: két
          egymás alatti cím ugyanarról a listáról csak szélesíti a fejet.
        */}
        {autoJelentes}

        {nincsAtneznivalo && (
          <div className="ds-szakasz" style={{ padding: 0 }}>
            <h3>Nincs átnéznivaló</h3>
            <p>
              Minden döntést te hoztál, és nincs akadálya a mentésnek. Nézd meg a bal oldali{' '}
              <b>Előnézet</b> nézeten, mi kerül a fájlba, aztán mentsd — az eredeti irat érintetlen
              marad.
            </p>
          </div>
        )}

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
              {/* UGYANAZ A BOROSTYÁN, mint a beállító lap „Végignézem"
                  gombján: mindkettő ugyanoda visz, ugyanazért. */}
              <button className="btn sm varakozik" onClick={onVissza}>
                Megnézem őket
              </button>
            </div>
          </div>
        )}

        {/*
          A FIGYELMEZTETÉSEK ÖSSZECSUKVA — nem eltüntetve.

          Öt-hat bekezdésnyi borostyán szöveg állt itt a lap tetején, a
          számok ELŐTT: a felhasználó a mentés előtti utolsó képernyőn először
          egy fal szöveget kapott, és csak alatta azt, hogy mi lett az
          irattal. Ráadásul ugyanaz a mondat többször is szerepelt, más
          darabszámmal.

          Törölni mégsem szabad: van köztük olyan, hogy „a modell 9 találatát
          nem tudtuk értelmezni — ezeket kézzel kell felvenni". Egy sorba
          csukva ott marad, kinyitható, és ugyanez a lista bekerül a mentés
          melletti jegyzőkönyvbe (FIGYELMEZTETÉSEK rovat) és a mentés utáni
          ablakba is — tehát három helyen érhető el, csak nem áll az útban.
        */}
        {figyelmeztetesek.length > 0 && (
          <details className="figyelmek">
            <summary>
              {figyelmeztetesek.length} figyelmeztetés az elemzésből
            </summary>
            {figyelmeztetesek.map((w, i) => (
              <div key={i} className="note">
                {w}
              </div>
            ))}
          </details>
        )}

        {mentesAkadaly !== null && <div className="note bad">{mentesAkadaly}</div>}
      </div>
    </>
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
