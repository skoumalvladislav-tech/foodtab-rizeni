"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import Ikona from "@/app/[rozsah]/ikona";
import { pocet } from "@/lib/sklonovani";

/**
 * Výsledek vydání rozpisu — co se opravdu stalo.
 *
 * Akce `vydatRozpis` po sobě přesměruje s `?vydano=N` (kolik zpráv
 * odešlo) nebo `?chyba=vydani&text=…` (co databáze odmítla). Dřív to
 * nečetla žádná obrazovka: kdo rozpis vydal, viděl jen obnovenou stránku
 * a nevěděl, jestli se to povedlo — a chybu z databáze neviděl vůbec.
 *
 * Text se skládá z toho, co vrátila databáze. Nic se tu nepředstírá:
 * nula rozeslaných zpráv se řekne jako nula, ne jako „hotovo“.
 */

export type VysledekVydani = {
  /** Kolik zpráv odešlo; `null` = vydání se tentokrát neprovádělo. */
  vydano: number | null;
  /** Text chyby z databáze; `null` = žádná. */
  chyba: string | null;
};

export default function ZpravaVydani({ vysledek }: { vysledek: VysledekVydani }) {
  const router = useRouter();
  const cesta = usePathname();
  const parametry = useSearchParams();
  const [skryto, setSkryto] = useState(false);

  if (skryto || (vysledek.vydano === null && !vysledek.chyba)) return null;

  function zavrit() {
    setSkryto(true);
    const p = new URLSearchParams(parametry.toString());
    for (const k of ["vydano", "chyba", "text"]) p.delete(k);
    const dotaz = p.toString();
    router.replace(dotaz ? `${cesta}?${dotaz}` : cesta, { scroll: false });
  }

  const chyba = vysledek.chyba !== null;

  return (
    <div className="ds-smd-zprava" role={chyba ? "alert" : "status"} data-chyba={chyba ? "" : undefined}>
      <span className="ds-smd-zprava-ikona" aria-hidden="true">
        <Ikona klic={chyba ? "varovani" : "fajfka"} velikost={16} />
      </span>
      <p>
        {chyba ? (
          <>
            <strong>Rozpis se nepodařilo vydat.</strong> {vysledek.chyba}
          </>
        ) : vysledek.vydano === 0 ? (
          <>
            <strong>Rozpis je vydaný.</strong> Žádná zpráva neodešla — nebylo komu: nic se nezměnilo, dotčení
            lidé nemají účet, nebo šlo jen o vaše vlastní směny.
          </>
        ) : (
          <>
            <strong>Rozpis je vydaný.</strong> Rozesláno {pocet(vysledek.vydano ?? 0, "zpráva", "zprávy", "zpráv")}.
          </>
        )}
      </p>
      <button type="button" className="ds-smd-zprava-zavrit" onClick={zavrit} aria-label="Zavřít zprávu">
        <Ikona klic="zavrit" velikost={14} />
      </button>
    </div>
  );
}
