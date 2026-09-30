"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import { odhlasit } from "@/app/prihlaseni/akce";
import { jeOtevrena, poZmeneAdresy, ZAVRENA, type StavNabidky } from "@/lib/stav-nabidky";

/**
 * ODHLÁŠENÍ S DOTAZEM (podmínka Šéfíka, 8. 9.).
 *
 * Kreslí se na třech místech:
 *
 *   - `varianta="menu"` — na telefonu v menu „Více" (MobileVice),
 *   - `varianta="sloupec"` — nad 640 px vlevo dole, na konci levého
 *     sloupce (ModuleSidebar a sloupce Marketingu a Faktur). Proč
 *     zrovna tam, stojí v ModuleSidebar.
 *   - `varianta="samostatne"` — MIMO AppShell, na sděleních bez rámu
 *     aplikace („Účet zatím nepatří k žádné firmě", „Sem nemáte
 *     přístup", čekající pozvánka …). Do 29. 9. 2026 tam byla vlastní
 *     kopie (`app/cesta-ven.tsx`, kontrola #85, 25. 9.) — sdílená
 *     komponenta ještě nebyla na main (PR #85 běžel souběžně).
 *     Sloučeno, jakmile byla (otázka 18 g, docs/hlaseni/otazky.md).
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
 * jako karta přes obsah. Proto se zavře i po změně adresy bez ukazatele
 * (Alt+←, gesto zpět na iPadu, přesměrování po odeslání formuláře):
 * pamatuje se adresa, kde se otevřel, stejně jako u nabídek
 * (lib/stav-nabidky.ts). V menu „Více" tohle obstarává samo menu.
 *
 * Samostatná varianta tohle pathname-driven zavírání NEPOUŽÍVÁ (vlastní
 * stav místo `stav-nabidky.ts`): na těchhle obrazovkách se nedá nikam
 * jinam přejít, jen odhlásit nebo otevřít Moje údaje, takže by zavírání
 * podle adresy nemělo co dělat. `ptaSeNaZacatku` je jen pro kontrolu
 * (scripts/ceka-na-opravneni.test.mjs), která bez prohlížeče neumí
 * ťuknout a druhý stav (dotaz) by jinak nikdy neviděla.
 */
export default function Odhlaseni({
  varianta = "menu",
  mojeUdaje = false,
  jinaAdresa = false,
  ptaSeNaZacatku = false,
}: {
  varianta?: "menu" | "sloupec" | "samostatne";
  /** Jen `varianta="samostatne"`: odkaz na Moje údaje (kde firma je). */
  mojeUdaje?: boolean;
  /**
   * Jen `varianta="samostatne"`: rada „přihlásili jste se jinou
   * adresou, než na kterou přišla pozvánka?". Jen tam, kde to může být
   * příčina (kontrola 28. 9. 2026).
   */
  jinaAdresa?: boolean;
  /** Jen `varianta="samostatne"`, jen pro kontrolu bez prohlížeče. */
  ptaSeNaZacatku?: boolean;
}) {
  const veSamostatne = varianta === "samostatne";
  const cesta = usePathname() ?? "";
  const [stav, setStav] = useState<StavNabidky>(ZAVRENA);
  const [ptaSeSamostatne, setPtaSeSamostatne] = useState(ptaSeNaZacatku);
  const platny = poZmeneAdresy(stav, cesta);
  if (!veSamostatne && platny !== stav) setStav(platny);
  const ptaSe = veSamostatne ? ptaSeSamostatne : jeOtevrena(platny, cesta);
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
      if (obalRef.current && !obalRef.current.contains(e.target as Node)) setStav(ZAVRENA);
    }
    document.addEventListener("pointerdown", naKlikMimo);
    return () => document.removeEventListener("pointerdown", naKlikMimo);
  }, [veSloupci, ptaSe]);

  function prepnout(novy: boolean) {
    presunoutFokus.current = true;
    if (veSamostatne) setPtaSeSamostatne(novy);
    else setStav(novy ? cesta : ZAVRENA);
  }

  // Na obalu, ne na document: Escape zmáčknutý jinde se dotazu netýká
  // a fokus se nevrací nikomu, kdo tu nebyl.
  function naKlavesu(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && ptaSe) prepnout(false);
  }

  // Jen když je známo, KAM fokus odešel (Tab ven). Safari (Mac i iPad)
  // tlačítko kliknutím nezaměří: fokus z „Zpět" při stisku myši na
  // „Odhlásit" odejde nikam a `relatedTarget` je prázdný. Zavírat
  // i tehdy by dotaz zmizel dřív, než klik doběhne, a odhlášení by se
  // potichu neodeslalo. Kliknutí mimo řeší posluchač výš. Hlídá to
  // scripts/nabidka.test.mjs („Safari: …", klik s { safari: true }).
  function naOdchodFokusu(e: FocusEvent<HTMLDivElement>) {
    const kam = e.relatedTarget as Node | null;
    if (ptaSe && kam && !e.currentTarget.contains(kam)) setStav(ZAVRENA);
  }

  const poznamka = (
    <p className="ds-odhlaseni-poznamka">
      Odhlásí vás z tohohle zařízení. Příště se přihlásíte kódem z e-mailu.
    </p>
  );

  return (
    <div
      ref={obalRef}
      data-odhlaseni-samostatne={veSamostatne ? "" : undefined}
      className={
        veSamostatne
          ? "ds-odhlaseni ds-odhlaseni-samostatne"
          : veSloupci
            ? "ds-odhlaseni ds-odhlaseni-sloupec"
            : "ds-odhlaseni"
      }
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
      ) : veSamostatne ? (
        // Samostatná varianta: řádek vedle sebe s volitelným odkazem na
        // Moje údaje (jen kde firma je — CestaVen dřív, otázka 18 g).
        <div className="ds-odhlaseni-radek">
          {mojeUdaje ? (
            <Link href="/moje-udaje" className="ft-tl ft-tl-vedlejsi">
              Moje údaje
            </Link>
          ) : null}
          {/* Ikona A slovo — samotná ikona se dá splést s čímkoli. */}
          <button
            ref={odhlasitRef}
            type="button"
            className="ft-tl ft-tl-vedlejsi"
            onClick={() => prepnout(true)}
          >
            <Ikona klic="odhlasit" />
            Odhlásit se
          </button>
        </div>
      ) : (
        // Ikona A slovo, všude — i v ikonovém sloupci na tabletu, kde je
        // slovo malé pod ikonou (globals.css). Samotná ikona se dá
        // splést s čímkoli, zvlášť u něčeho, co se nesmí ťuknout omylem.
        // Jméno pro odečítač je to slovo; aria-label ani title netřeba.
        <button
          ref={odhlasitRef}
          type="button"
          className={veSloupci ? "ds-odhlaseni-tl" : "ft-tl ft-tl-vedlejsi ds-odhlaseni-tl"}
          onClick={() => prepnout(true)}
        >
          <Ikona klic="odhlasit" />
          <span className="stitek">Odhlásit se</span>
        </button>
      )}
      {veSamostatne
        ? jinaAdresa
          ? (
              <p className="ds-odhlaseni-jina-adresa">
                Přihlásili jste se jinou adresou, než na kterou vám přišla
                pozvánka? Odhlaste se a přihlaste se tou správnou.
              </p>
            )
          : null
        : veSloupci
          ? null
          : poznamka}
    </div>
  );
}
