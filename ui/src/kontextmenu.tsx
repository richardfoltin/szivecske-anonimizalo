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
 * AZ ALMENÜ A KÉPERNYŐHÖZ VAN KÖTVE, NEM A SZÜLŐ MENÜHÖZ.
 *
 * EZ VOLT AZ A HIBA, AMITŐL AZ „INKÁBB EZ LEGYEN…" NEM NYÍLT KI. A főmenü
 * görgethető (hogy a tizennégy eljárási szerep elférjen benne), egy görgethető
 * doboz pedig LEVÁGJA a belőle kilógó gyermeket — márpedig egy oldalt nyíló
 * almenü definíció szerint kilóg. A menü tehát kinyílt, csak épp a levágott
 * sávban, láthatatlanul: a felhasználó egy nyilat látott, ami nem csinál semmit.
 *
 * A megoldás az, hogy az almenü a KÉPERNYŐHÖZ igazodik (`position: fixed`), a
 * helyét pedig a szülő sor méréséből kapja. Így semmilyen görgetés nem
 * vághatja el.
 *
 * A HELYE HÁROM SZABÁLYBÓL ÁLL:
 *   – alapban a szülő sor jobb szélénél nyílik, a sor tetejéhez igazítva;
 *   – ha jobbra nem fér el, átfordul a sor bal oldalára;
 *   – ha alul kilógna, feljebb csúszik, hogy az utolsó sora is elérhető legyen.
 *
 * A mérés a kirajzolás UTÁN, de a festés ELŐTT történik (`useLayoutEffect`),
 * tehát az almenü nem ugrik át a szem előtt.
 */
function Almenu({
  tetelek,
  horgony,
  onClose,
}: {
  tetelek: MenuTetel[];
  /** A szülő sor eleme — ehhez képest nyílik az almenü. */
  horgony: HTMLElement | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hely, setHely] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !horgony) return;
    const sor = horgony.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    const margo = 8;

    // Jobbra, ha elfér; különben balra a sor mellé.
    const jobbra = sor.right - 2;
    const left =
      jobbra + m.width + margo > window.innerWidth
        ? Math.max(margo, sor.left - m.width + 2)
        : jobbra;

    // Felül a sor tetejéhez igazítva; ha alul kilógna, feljebb csúszik.
    const top = Math.max(
      margo,
      Math.min(sor.top - 5, window.innerHeight - m.height - margo),
    );
    setHely({ left, top });
  }, [tetelek, horgony]);

  return (
    <div
      className="kmenu al"
      ref={ref}
      role="menu"
      /* Amíg nincs kimérve a helye, láthatatlan: különben egy pillanatra a
         bal felső sarokban villanna fel. */
      style={hely === null ? { opacity: 0, left: 0, top: 0 } : hely}
    >
      <MenuSorok tetelek={tetelek} onClose={onClose} />
    </div>
  );
}

function MenuSorok({ tetelek, onClose }: { tetelek: MenuTetel[]; onClose: () => void }) {
  const [nyitva, setNyitva] = useState<number | null>(null);
  /** Soronként a gomb eleme — az almenü ebből számolja ki, hova nyíljon. */
  const horgonyok = useRef<(HTMLElement | null)[]>([]);

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
                /* A sor eleme a horgony: az almenü a képernyőhöz igazodik, és
                   ebből számolja ki, hova nyíljon. */
                ref={(el) => {
                  horgonyok.current[i] = el;
                }}
                onClick={() => setNyitva(nyitva === i ? null : i)}
                onFocus={() => setNyitva(i)}
              >
                <span className="kmenu-szo">{t.cimke}</span>
                <span className="kmenu-nyil" aria-hidden="true">
                  ›
                </span>
              </button>
              {nyitva === i && (
                <Almenu
                  tetelek={t.tetelek}
                  horgony={horgonyok.current[i] ?? null}
                  onClose={onClose}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={i}
            className={`kmenu-sor${t.bont ? ' bont' : ''}`}
            role="menuitem"
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
