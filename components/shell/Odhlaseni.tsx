"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import { odhlasit } from "@/app/prihlaseni/akce";

/**
 * ODHLÁŠENÍ S DOTAZEM (podmínka Šéfíka, 8. 9.).
 *
 * Kreslí se podle šířky obrazovky na jednom ze dvou míst:
 *
 *   - `varianta="menu"` — na telefonu v menu „Více" (MobileVice),
 *   - `varianta="sloupec"` — nad 640 px vlevo dole, na konci levého
 *     sloupce (ModuleSidebar a sloupce Marketingu a Faktur). Proč
 *     zrovna tam, stojí v ModuleSidebar.
 *
 * Do 25. 9. 2026 bylo na rozcestníku, kam vedlo logo; rozcestník je
 * zrušený. Na Mých údajích zůstává taky — tam patří k výdeji dat
 * a k souhlasům.
 *
 * Nikdy ne jedním ťuknutím: na sdíleném telefonu za barem, s mokrýma
 * rukama, je omylem ťuknuté odhlášení uprostřed směny horší než
 * ťuknutí navíc.
 *
 * Fokus se při přepnutí přesouvá sám: tlačítko, na které člověk
 * ťukl, zmizí, a fokus by jinak spadl mimo. Na dotaz přistane na
 * „Zpět" — bezpečná volba, kdyby se Enter zmáčkl dvakrát. Otázka je
 * jménem skupiny tlačítek, takže ji odečítač přečte i s tím „Zpět".
 *
 * Ve sloupci se dotaz sám zavře, když člověk odejde jinam (klik mimo,
 * Tab ven) nebo zmáčkne Escape. Sloupec se při přechodu na jinou
 * obrazovku nepřekresluje a dotaz by v něm jinak visel dál — na tabletu
 * jako karta přes obsah. V menu „Více" tohle obstarává samo menu.
 */
export default function Odhlaseni({ varianta = "menu" }: { varianta?: "menu" | "sloupec" }) {
  const [ptaSe, setPtaSe] = useState(false);
  const presunoutFokus = useRef(false);
  const obalRef = useRef<HTMLDivElement>(null);
  const odhlasitRef = useRef<HTMLButtonElement>(null);
  const zpetRef = useRef<HTMLButtonElement>(null);
  const idDotazu = useId();
  const veSloupci = varianta === "sloupec";

  useEffect(() => {
    if (!presunoutFokus.current) return;
    presunoutFokus.current = false;
    (ptaSe ? zpetRef : odhlasitRef).current?.focus();
  }, [ptaSe]);

  // Klik mimo dotaz ve sloupci ho zavře a fokus nechá, kam člověk klikl.
  useEffect(() => {
    if (!veSloupci || !ptaSe) return;
    function naKlikMimo(e: PointerEvent) {
      if (obalRef.current && !obalRef.current.contains(e.target as Node)) setPtaSe(false);
    }
    document.addEventListener("pointerdown", naKlikMimo);
    return () => document.removeEventListener("pointerdown", naKlikMimo);
  }, [veSloupci, ptaSe]);

  function prepnout(novy: boolean) {
    presunoutFokus.current = true;
    setPtaSe(novy);
  }

  // Na obalu, ne na document: Escape zmáčknutý jinde se dotazu netýká
  // a fokus se nevrací nikomu, kdo tu nebyl.
  function naKlavesu(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && ptaSe) prepnout(false);
  }

  // Jen když je známo, KAM fokus odešel (Tab ven). Safari fokus při
  // kliknutí na tlačítko nepřesune a `relatedTarget` je prázdný —
  // zavírat i tehdy by dotaz schovalo dřív, než klik na „Odhlásit"
  // doběhne. Kliknutí mimo řeší posluchač výš.
  function naOdchodFokusu(e: FocusEvent<HTMLDivElement>) {
    const kam = e.relatedTarget as Node | null;
    if (ptaSe && kam && !e.currentTarget.contains(kam)) setPtaSe(false);
  }

  const poznamka = (
    <p className="ds-odhlaseni-poznamka">
      Odhlásí vás z tohohle zařízení. Příště se přihlásíte kódem z e-mailu.
    </p>
  );

  return (
    <div
      ref={obalRef}
      className={veSloupci ? "ds-odhlaseni ds-odhlaseni-sloupec" : "ds-odhlaseni"}
      onKeyDown={veSloupci ? naKlavesu : undefined}
      onBlur={veSloupci ? naOdchodFokusu : undefined}
    >
      {ptaSe ? (
        <div className="ds-odhlaseni-otazka">
          <p id={idDotazu} className="ds-odhlaseni-dotaz">
            Odhlásit se?
          </p>
          <div className="ds-odhlaseni-akce" role="group" aria-labelledby={idDotazu}>
            {/* Na rozcestníku bylo holé .ft-tl — bez obrysu i výplně
                vypadalo jako text vedle „Zpět". Po dotazu je to ta akce,
                kvůli které člověk přišel, proto hlavní vzhled. */}
            <form action={odhlasit}>
              <button type="submit" className="ft-tl ft-tl-hlavni">
                Odhlásit
              </button>
            </form>
            <button
              ref={zpetRef}
              type="button"
              className="ft-tl ft-tl-vedlejsi"
              onClick={() => prepnout(false)}
            >
              Zpět
            </button>
          </div>
          {/* Ve sloupci jen u dotazu — natrvalo by zabírala místo pod
              seznamem obrazovek. */}
          {veSloupci ? poznamka : null}
        </div>
      ) : (
        // Ikona A slovo. Samotná ikona se dá splést s čímkoli — zvlášť
        // u něčeho, co se nesmí ťuknout omylem. Na tabletu je sloupec
        // jen z ikon a slovo schová CSS; jméno pak nese aria-label
        // a myši title.
        <button
          ref={odhlasitRef}
          type="button"
          className={veSloupci ? "ds-odhlaseni-tl" : "ft-tl ft-tl-vedlejsi ds-odhlaseni-tl"}
          aria-label={veSloupci ? "Odhlásit se" : undefined}
          title={veSloupci ? "Odhlásit se" : undefined}
          onClick={() => prepnout(true)}
        >
          <Ikona klic="odhlasit" />
          <span className="stitek">Odhlásit se</span>
        </button>
      )}
      {veSloupci ? null : poznamka}
    </div>
  );
}
