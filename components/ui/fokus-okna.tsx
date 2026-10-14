"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Fokus a Esc pro Drawer a Dialog — jedno místo, obě okna se chovají stejně.
 *
 *   * Při otevření dostane fokus panel, aby čtečka věděla, kde je. Když
 *     už je fokus UVNITŘ (pole s `autoFocus`, třeba „Proč se stornuje“
 *     v Docházce), nechá se tam — dřív ho panel tomu poli sebral.
 *   * Při zavření se vrátí tam, odkud se okno otevřelo, ale jen když
 *     zůstal v panelu (nebo s ním zmizel na `<body>`). Kdo mezitím klikl
 *     jinam — na jinou směnu v rozpisu vedle nemodálního panelu — tomu se
 *     fokus nebere. Bez toho přepnutí na jinou směnu odrolovalo rozpis
 *     zpátky k první otevřené a zavření vrátilo fokus na ni.
 *     `preventScroll`: návrat fokusu stránkou nehýbe.
 *   * `onZavrit` je v refu, NE v závislostech efektu. Rodiče ji skládají
 *     v těle komponenty, takže je při každém vykreslení nová — dokud byla
 *     v závislostech, každé překreslení (zaškrtnutí políčka mezerníkem,
 *     obnovení rozpisu) efekt zrušilo a spustilo znovu a fokus skočil
 *     z prvku, se kterým člověk pracoval, na celý panel (headless Chrome,
 *     14. 10. 2026). Stejný vzor má app/[rozsah]/smeny/mobil/sheet.tsx.
 *
 * Hlídá scripts/ui-okna.test.mjs. Přípona .tsx, ne .ts: testy (scripts/vykreslit.mjs,
 * klikat.mjs) překládají s podstrčeným Reactem jen .tsx — .ts by načetly napřímo
 * se skutečným Reactem a háčky by spadly.
 */
export function useFokusOkna(
  otevreno: boolean,
  onZavrit: () => void,
  panelRef: RefObject<HTMLElement | null>,
) {
  const zavrit = useRef(onZavrit);
  useEffect(() => {
    zavrit.current = onZavrit;
  });

  useEffect(() => {
    if (!otevreno) return;
    const panel = panelRef.current;
    const aktivni = document.activeElement as HTMLElement | null;
    const uzUvnitr = Boolean(panel && aktivni && panel.contains(aktivni));
    const predchozi = uzUvnitr ? null : aktivni;
    if (!uzUvnitr) panel?.focus();

    function naKlavesu(e: KeyboardEvent) {
      if (e.key === "Escape") zavrit.current();
    }
    document.addEventListener("keydown", naKlavesu);
    return () => {
      document.removeEventListener("keydown", naKlavesu);
      const ted = document.activeElement;
      if (ted && ted !== document.body && !panel?.contains(ted)) return;
      predchozi?.focus({ preventScroll: true });
    };
  }, [otevreno, panelRef]);
}
