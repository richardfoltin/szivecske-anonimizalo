/**
 * JOBB GOMBOS MENÜ AZ IRATON — a javítás ott, ahol a hiba látszik.
 *
 * Ez a fájl CSAK a menüt rajzolja; hogy mi áll benne, azt a hívó dönti el
 * (ui/src/App.tsx). A szétválasztás szándékos: a menü tartalma a találatokról
 * és a felekről szól — arról ez a fájl semmit nem tud, és nem is kell tudnia.
 *
 * MIÉRT KELL EGYÁLTALÁN. A programban eddig két út vezetett ahhoz, hogy egy
 * szóról megmondjuk, minek számít: a felek párbeszéde (ott be kell gépelni a
 * nevet) és a találat kikapcsolása (ott csak annyit lehet mondani, hogy „ne
 * cseréld"). Egyik sem arra a kérdésre válaszol, ami az ügyvédben az iratot
 * olvasva felmerül: „ez itt nem tanú, hanem szervezet" — vagy fordítva, „ezt a
 * szót a program tévedésből húzta alá". A jobb kattintás azon a szón kérdez,
 * amelyikről szó van.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A menü egy sora. A `almenu` ágra kattintva oldalt nyílik a folytatás. */
export type MenuTetel =
  /** Nem választható sor: a menü teteje mondja meg, MIRE vonatkozik. */
  | { fajta: 'cim'; szoveg: string; also?: string }
  | { fajta: 'valaszto' }
  | {
      fajta: 'gomb';
      cimke: string;
      sugo?: string;
      /** Kiemelve: ez a sor visszavon valamit (aláhúzás törlése). */
      bont?: boolean;
      onValaszt: () => void;
    }
  | { fajta: 'almenu'; cimke: string; sugo?: string; tetelek: MenuTetel[] };

export interface MenuAllas {
  x: number;
  y: number;
  tetelek: MenuTetel[];
}

/**
 * A MENÜ MINDIG A KÉPERNYŐN BELÜL MARAD.
 *
 * A jobb kattintás gyakran a panel alján vagy jobb szélén ér — ott a lefelé
 * nyíló menü kilógna, és a felhasználó pont azt a sort nem érné el, amiért
 * megnyitotta. A mérés a kirajzolás UTÁN történik (`useLayoutEffect`), mert a
 * menü magassága a tételszámtól függ; a festés előtt igazítunk, tehát nem
 * villan.
 */
function igazit(
  x: number,
  y: number,
  el: HTMLElement | null,
): { left: number; top: number } {
  if (!el) return { left: x, top: y };
  const { width, height } = el.getBoundingClientRect();
  const margo = 8;
  const left = x + width + margo > window.innerWidth ? Math.max(margo, x - width) : x;
  const top =
    y + height + margo > window.innerHeight
      ? Math.max(margo, window.innerHeight - height - margo)
      : y;
  return { left, top };
}

export function KontextMenu({ allas, onClose }: { allas: MenuAllas; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hely, setHely] = useState<{ left: number; top: number }>({
    left: allas.x,
    top: allas.y,
  });

  useLayoutEffect(() => {
    setHely(igazit(allas.x, allas.y, ref.current));
  }, [allas.x, allas.y, allas.tetelek]);

  /*
    A MENÜ NEM ÉLI TÚL A HÁTTÉR MOZGÁSÁT.

    Görgetéskor és ablakméretezéskor a menü a régi képernyőponton maradna, a
    szó pedig elcsúszna alóla — a felhasználó másra kattintana, mint amire
    kinyitotta. Ezért ilyenkor bezárjuk, ahelyett hogy utánaszámolnánk.
  */
  useEffect(() => {
    const zar = (): void => onClose();
    const gomb = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // `capture`: a görgetés a belső panelen történik, és nem bugyborékol fel.
    window.addEventListener('scroll', zar, true);
    window.addEventListener('resize', zar);
    window.addEventListener('blur', zar);
    window.addEventListener('keydown', gomb, true);
    return () => {
      window.removeEventListener('scroll', zar, true);
      window.removeEventListener('resize', zar);
      window.removeEventListener('blur', zar);
      window.removeEventListener('keydown', gomb, true);
    };
  }, [onClose]);

  // A billentyűzetes használathoz a fókusznak a menübe kell kerülnie —
  // különben Tabbal a menü MÖGÖTTI lapon lépkedne tovább a felhasználó.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus();
  }, [allas.tetelek]);

  return (
    <>
      {/*
        A FÁTYOL FOGJA EL A KÖVETKEZŐ KATTINTÁST, bárhol is éri a képernyőt.
        Átlátszó, tehát nem takar semmit — de enélkül a menü melletti kattintás
        a lap valamelyik gombját nyomná meg, és a felhasználó a menü bezárása
        helyett egy műveletet indítana el.
      */}
      <div
        className="kmenu-fatyol"
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="kmenu"
        ref={ref}
        style={{ left: hely.left, top: hely.top }}
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
      >
        <MenuSorok tetelek={allas.tetelek} onClose={onClose} />
      </div>
    </>
  );
}

/**
 * AZ ALMENÜ ARRA AZ OLDALRA NYÍLIK, AMELYIKEN VAN HELY.
 *
 * Jobbra nyílik, mert a menü rendszerint a bal oldali dokumentumpanelen áll —
 * de nem mindig: keskeny ablakon a panel a képernyő jobb feléig ér, és ott a
 * szerepek tizennégy elemű listája egyszerűen levágódna a képernyő szélén.
 * Éppen az a sor tűnne el, amiért a felhasználó a menüt kinyitotta.
 *
 * A mérés a kirajzolás UTÁN, de a festés ELŐTT történik (`useLayoutEffect`),
 * tehát az almenü nem ugrik át a szem előtt.
 */
function Almenu({ tetelek, onClose }: { tetelek: MenuTetel[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [balra, setBalra] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A mérés a JOBBRA nyíló állapoton fut (ez az alapállás), és csak akkor
    // fordítunk, ha tényleg kilóg — különben minden almenü átbillenne.
    const r = el.getBoundingClientRect();
    setBalra(r.right > window.innerWidth - 8);
  }, [tetelek]);

  return (
    <div className={`kmenu al${balra ? ' balra' : ''}`} ref={ref} role="menu">
      <MenuSorok tetelek={tetelek} onClose={onClose} />
    </div>
  );
}

function MenuSorok({ tetelek, onClose }: { tetelek: MenuTetel[]; onClose: () => void }) {
  const [nyitva, setNyitva] = useState<number | null>(null);

  return (
    <>
      {tetelek.map((t, i) => {
        if (t.fajta === 'valaszto') return <div key={i} className="kmenu-vonal" role="separator" />;
        if (t.fajta === 'cim') {
          return (
            <div key={i} className="kmenu-cim">
              <b>{t.szoveg}</b>
              {t.also !== undefined && <span className="kmenu-also">{t.also}</span>}
            </div>
          );
        }
        if (t.fajta === 'almenu') {
          return (
            <div
              key={i}
              className={`kmenu-ag${nyitva === i ? ' nyitva' : ''}`}
              onPointerEnter={() => setNyitva(i)}
            >
              <button
                className="kmenu-sor"
                role="menuitem"
                aria-haspopup="true"
                aria-expanded={nyitva === i}
                title={t.sugo ?? ''}
                onClick={() => setNyitva(nyitva === i ? null : i)}
                onFocus={() => setNyitva(i)}
              >
                <span className="kmenu-szo">{t.cimke}</span>
                <span className="kmenu-nyil" aria-hidden="true">
                  ›
                </span>
              </button>
              {nyitva === i && (
                <Almenu tetelek={t.tetelek} onClose={onClose} />
              )}
            </div>
          );
        }
        return (
          <button
            key={i}
            className={`kmenu-sor${t.bont ? ' bont' : ''}`}
            role="menuitem"
            title={t.sugo ?? ''}
            onPointerEnter={() => setNyitva(null)}
            onFocus={() => setNyitva(null)}
            onClick={() => {
              // A bezárás MEGY ELŐSZÖR: a művelet újraszámolást indít, és a
              // menü különben a friss lista fölött maradna nyitva, a régi
              // találatra mutatva.
              onClose();
              t.onValaszt();
            }}
          >
            <span className="kmenu-szo">{t.cimke}</span>
          </button>
        );
      })}
    </>
  );
}
