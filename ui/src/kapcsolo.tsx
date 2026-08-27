/**
 * A KAPCSOLÓ — a program EGYETLEN ki-be vezérlője.
 *
 * Korábban két különböző dolog állt ugyanarra a kérdésre: a beállító lapon ez
 * a kapcsoló, a Beállítások ablakban és a párbeszédekben viszont rendszer-
 * rajzolású jelölőnégyzet. Ugyanaz a mozdulat, két külhalmaz — a felhasználó
 * pedig joggal kérdezte meg, miért.
 *
 * Ezért került ki külön modulba: nem a beállító lap tartozéka, hanem a felület
 * alapeleme. Aki ki-be kapcsolható dolgot rajzol, ezt használja.
 *
 * VALÓDI `input[type=checkbox]`, csak a megjelenése más — nem `div` és nem
 * kattintáskezelő. Ez nem stílusdöntés: a saját rajzolású kapcsolóból elvész a
 * Szóköz és az Enter, a képernyőolvasó pedig nem mondja meg, hogy be vagy ki
 * van kapcsolva. Egy jogi iratot álnevesítő programban ez azt jelentené, hogy
 * a felhasználó nem tudja ellenőrizni, mit kapcsolt be.
 *
 * A „Be” / „Ki” felirat AZ ÁLLAPOT MÁSODIK JELE. A gomb helyzete és a felirat
 * együtt mondja meg, mi van bekapcsolva; ha csak a szín különböztetné meg őket,
 * a színtévesztő felhasználó és a szürkeárnyalatos nyomat is vakon maradna.
 * A felirat `aria-hidden`, mert az állapotot a jelölőnégyzet maga már közli —
 * kétszer felolvasva csak zaj lenne.
 */
export function Kapcsolo({
  id,
  be,
  tiltva,
  leirasId,
  cimke,
  onValt,
}: {
  id: string;
  be: boolean;
  tiltva?: boolean;
  /**
   * A magyarázó szöveg azonosítója, ha van ilyen a kapcsoló mellett.
   *
   * SZÁNDÉKOSAN NEM SZÁMOLJUK KI `${id}-s` alakban. Éppen az volt itt korábban,
   * és a fejlécekbe tett kapcsolóknál a semmire mutatott: a képernyőolvasó egy
   * nem létező elemet keresett. Ami nincs, azt nem hivatkozzuk.
   */
  leirasId?: string;
  /**
   * A kapcsoló neve, ha nem áll mellette `<label for>`.
   *
   * A soros elrendezésben a megnevezés maga a címke, ott ez fölösleges. A
   * csoportfejlécekben viszont nincs `<label>`, és név nélkül a képernyőolvasó
   * annyit mond, hogy „kapcsoló, bekapcsolva” — azt nem, hogy MI van bekapcsolva.
   */
  cimke?: string;
  onValt: (be: boolean) => void;
}) {
  return (
    <>
      <span className="tstate" aria-hidden="true">
        {be ? 'Be' : 'Ki'}
      </span>
      <input
        id={id}
        type="checkbox"
        className="toggle"
        role="switch"
        checked={be}
        disabled={tiltva === true}
        {...(leirasId !== undefined ? { 'aria-describedby': leirasId } : {})}
        {...(cimke !== undefined ? { 'aria-label': cimke } : {})}
        onChange={(e) => onValt(e.target.checked)}
      />
    </>
  );
}

/**
 * EGY KAPCSOLÓ A SAJÁT SORÁBAN: balra a megnevezés és a magyarázat, jobbra a
 * kapcsoló.
 *
 * Ez a párbeszédek és a Beállítások ablak alakja — ott nincs csoportfejléc,
 * amibe be lehetne ülni. A rendezés ugyanaz, mint mindenhol máshol a
 * programban: a kapcsolók jobb széle egy vonalban áll, a szem egyetlen
 * függőleges vonal mentén olvassa le, mi van bekapcsolva.
 *
 * A megnevezés `<label for>`, tehát rá lehet kattintani, és a képernyőolvasó
 * ezt mondja ki a kapcsoló neveként. A magyarázat NEM a névbe kerül, hanem
 * `aria-describedby`-jal kapcsolódik: a névbe fűzve minden kapcsoló egy
 * háromsoros felolvasással kezdődne, és a lényeg — hogy be vagy ki van
 * kapcsolva — a mondat végére csúszna.
 */
export function KapcsoloSor({
  id,
  cim,
  leiras,
  be,
  tiltva,
  onValt,
}: {
  id: string;
  cim: string;
  leiras: React.ReactNode;
  be: boolean;
  tiltva?: boolean;
  onValt: (be: boolean) => void;
}) {
  return (
    <div className="checkline">
      <div className="clszoveg">
        <label className="t" htmlFor={id}>
          {cim}
        </label>
        <div className="s" id={`${id}-s`}>
          {leiras}
        </div>
      </div>
      <div className="clctl">
        <Kapcsolo id={id} be={be} leirasId={`${id}-s`} {...(tiltva !== undefined ? { tiltva } : {})} onValt={onValt} />
      </div>
    </div>
  );
}
