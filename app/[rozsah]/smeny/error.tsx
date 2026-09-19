"use client";

import ErrorState from "@/components/ui/ErrorState";

/**
 * Rozpis se nepodařilo načíst.
 *
 * Bez tohohle souboru spadne celá stránka na obecné „This page couldn't
 * load“ a člověk nedostane ani slovo česky, ani tlačítko, co zkusit dál.
 * Chyba se tu nezastírá jako úspěch: říká se, že se nenačetlo, a nabízí
 * se opakování. Rám aplikace (lišta, spodní navigace) zůstává, protože
 * tenhle soubor chytá jen obsah `smeny/`.
 *
 * Kód chyby (`digest`) se ukazuje drobně — kdo se ozve podpoře, má co
 * říct; technický text zprávy se člověku neukazuje.
 */
export default function ChybaSmen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      nadpis="Nepodařilo se načíst směny."
      akce={
        <button type="button" className="ft-tl ft-tl-hlavni" onClick={reset}>
          Zkusit znovu
        </button>
      }
    >
      Zkuste to prosím znovu. Pokud potíž trvá, ozvěte se správci firmy.
      {error.digest ? (
        <span style={{ display: "block", marginTop: "8px", fontSize: "12px", color: "var(--faint)" }}>
          Kód: {error.digest}
        </span>
      ) : null}
    </ErrorState>
  );
}
