"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import PrepinacRezimu from "@/app/prepinac-rezimu";
import { prepnoutFirmu } from "@/app/firma-prepnuti";
import { jeOtevrena, poKliknuti, poZmeneAdresy, ZAVRENA, type StavNabidky } from "@/lib/stav-nabidky";

export type FirmaProp = { tenantId: string; nazev: string };

/**
 * Nabídka účtu pod iniciálami v horní liště — Moje údaje a Vzhled.
 * Na počítači a tabletu; na telefonu jsou iniciály schované a totéž je
 * v menu „Více" (MobileVice).
 *
 * ---------------------------------------------------------------------
 * ODHLÁŠENÍ TU NENÍ (25. 9. 2026)
 *
 * Chvíli tu bylo — a bylo to proti dvěma rozhodnutím Šéfíka: 7. 9.
 * „Do horní lišty ne. Omylem ťuknuté odhlášení uprostřed směny je
 * horší než o jedno ťuknutí delší cesta" a 8. 9. odhlášení „na
 * základní obrazovku třeba vlevo dolů, teď je schovaná"
 * (docs/zarazeni-misto-roli.md, 6.6). Pod iniciálami by bylo zase
 * schované. Je vlevo dole na konci levého sloupce (ModuleSidebar)
 * a hlídá to scripts/prihlaseni.test.mjs — i to, že tenhle soubor
 * slovo s „odhl…s" vůbec neobsahuje.
 *
 * PROČ NABÍDKA ZŮSTALA
 *
 * Moje údaje jsou ve sloupci i pod Nastavením, jenže na tabletu je
 * sloupec jen z ikon a jejich ikona je stejná jako u Lidí a Zařazení.
 * Tady mají slovo, na místě, kde se účet v aplikacích hledá. Vzhled
 * je měsíček v liště hned vedle; tady je s popiskem, ať se dá najít
 * podle slova. Iniciály na obrazovce byly i dřív — jen jako ozdoba.
 *
 * ---------------------------------------------------------------------
 * PŘÍSTUPNOST
 *
 * Tlačítko s `aria-haspopup` a `aria-expanded`, panel je nemodální
 * `role="dialog"` s nadpisem. Po otevření jde fokus do panelu, Escape
 * nabídku zavře a vrátí fokus na iniciály. Klik mimo i Tab ven zavřou
 * bez přesunu fokusu (člověk šel jinam, tam ho nechat). Po přechodu
 * na jinou adresu je zavřená sama a po návratu nevyskočí
 * (lib/stav-nabidky.ts).
 */
export default function MenuUctu({
  iniciraly,
  nazevFirmy,
  firmy,
  aktivniFirmaId,
}: {
  iniciraly: string;
  nazevFirmy: string;
  /** Víc než jedna položka jen u člena víc firem zároveň — jinak se sekce nekreslí. */
  firmy?: FirmaProp[];
  aktivniFirmaId?: string;
}) {
  const cesta = usePathname() ?? "";
  const [stav, setStav] = useState<StavNabidky>(ZAVRENA);
  const platny = poZmeneAdresy(stav, cesta);
  if (platny !== stav) setStav(platny);
  const otevreno = jeOtevrena(platny, cesta);

  const obalRef = useRef<HTMLDivElement>(null);
  const tlacitkoRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const idPanelu = useId();
  const idNadpisu = useId();

  const zavrit = useCallback(() => setStav(ZAVRENA), []);

  useEffect(() => {
    if (!otevreno) return;
    panelRef.current?.focus();

    function naKlikMimo(e: PointerEvent) {
      if (obalRef.current && !obalRef.current.contains(e.target as Node)) zavrit();
    }
    document.addEventListener("pointerdown", naKlikMimo);
    return () => document.removeEventListener("pointerdown", naKlikMimo);
  }, [otevreno, zavrit]);

  // Na obalu, ne na document: Escape zmáčknutý jinde (třeba v seznamu
  // v obsahu) nabídku nechá a fokus nikam nepřehazuje.
  function naKlavesu(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape" || !otevreno) return;
    zavrit();
    tlacitkoRef.current?.focus();
  }

  // Jen když je známo, KAM fokus odešel (Tab ven). Safari tlačítko ani
  // odkaz kliknutím nezaměří a `relatedTarget` je prázdný — zavírat
  // i tehdy by třeba druhý klik na iniciály nabídku zavřel při stisku
  // a hned zase otevřel. Hlídá to scripts/nabidka.test.mjs („Safari: …").
  function naOdchodFokusu(e: FocusEvent<HTMLDivElement>) {
    const kam = e.relatedTarget as Node | null;
    if (otevreno && kam && !e.currentTarget.contains(kam)) zavrit();
  }

  return (
    <div ref={obalRef} className="ft-ucet" onKeyDown={naKlavesu} onBlur={naOdchodFokusu}>
      <button
        ref={tlacitkoRef}
        type="button"
        className="ft-ucet-tl"
        title="Můj účet"
        aria-label="Můj účet"
        aria-haspopup="dialog"
        aria-expanded={otevreno}
        aria-controls={otevreno ? idPanelu : undefined}
        onClick={(e) => {
          // Safari tlačítko kliknutím nezaměří; Escape pak vrací fokus
          // sem a musí mít kam.
          e.currentTarget.focus();
          setStav((s) => poKliknuti(s, cesta));
        }}
      >
        <span className="ft-avatar" aria-hidden="true">
          {iniciraly}
        </span>
      </button>

      {otevreno ? (
        <div
          ref={panelRef}
          id={idPanelu}
          className="ft-ucet-panel"
          role="dialog"
          aria-labelledby={idNadpisu}
          tabIndex={-1}
        >
          <div className="ft-ucet-hlava">
            <b id={idNadpisu}>Můj účet</b>
            <span>{nazevFirmy}</span>
          </div>

          <Link href="/moje-udaje" className="ft-ucet-odkaz" onClick={zavrit}>
            <Ikona klic="clovek" />
            Moje údaje
          </Link>

          {/* Přepínač je i v liště vedle; tady je s popiskem, ať se dá
              najít podle slova, ne jen podle měsíčku. */}
          <div className="ft-ucet-radek">
            <span>Vzhled</span>
            <PrepinacRezimu />
          </div>

          {/*
            Přepínač firmy — jen u člena víc firem zároveň (2. 10. 2026).
            Schovaná položka u jedné firmy není zámek, je to jen to, že
            není co přepínat. Čisté odeslání formuláře jako všude jinde
            v appce (žádný confirm() v prohlížeči, žádný klientský stav).
          */}
          {firmy && firmy.length > 1 ? (
            <div className="ft-ucet-firmy">
              <span className="ft-ucet-firmy-nadpis">Firma</span>
              <ul>
                {firmy.map((f) => (
                  <li key={f.tenantId}>
                    {f.tenantId === aktivniFirmaId ? (
                      <span className="ft-ucet-firma-aktivni" aria-current="true">
                        {f.nazev}
                      </span>
                    ) : (
                      <form action={prepnoutFirmu}>
                        <input type="hidden" name="tenantId" value={f.tenantId} />
                        <button type="submit" className="ft-ucet-firma-tl">
                          {f.nazev}
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
