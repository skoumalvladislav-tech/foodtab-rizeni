"use client";

import { useCallback, useSyncExternalStore } from "react";

type Rezim = "light" | "dark" | "system";

const KLIC = "foodtab-rezim";

/* ---------------------------------------------------------------------
 * Malé napojení na vnější stav
 *
 * Režim nežije v Reactu, ale na atributu <html> — nasazuje ho skript
 * v hlavičce ještě před vykreslením. Číst ho v efektu a přepisovat přes
 * setState by znamenalo vykreslit se dvakrát a React to právem hlídá.
 * useSyncExternalStore je na přesně tohle: řekne se mu, jak se stav
 * přečte na klientovi, jak na serveru a kdy se změnil.
 * ------------------------------------------------------------------ */

const posluchaci = new Set<() => void>();

function odebirat(zmena: () => void) {
  posluchaci.add(zmena);
  // Přepnutí v jiné záložce se propíše i sem.
  window.addEventListener("storage", zmena);
  return () => {
    posluchaci.delete(zmena);
    window.removeEventListener("storage", zmena);
  };
}

function oznamit() {
  for (const zmena of posluchaci) zmena();
}

function stavKlient(): Rezim {
  const v = document.documentElement.getAttribute("data-theme");
  return v === "light" || v === "dark" ? v : "system";
}

// Server o uložené volbě nic neví. Kdyby si ji domýšlel, po připojení by
// se značka přepsala a vykreslení by nesouhlasilo.
function stavServer(): Rezim {
  return "system";
}

export default function PrepinacRezimu() {
  const rezim = useSyncExternalStore(odebirat, stavKlient, stavServer);

  const prepnout = useCallback(() => {
    // Ze systémového režimu jdeme na opak toho, co je právě vidět —
    // jinak by první kliknutí u tmavého systému zdánlivě nic neudělalo.
    const jeTma =
      rezim === "dark" ||
      (rezim === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    const dalsi: Rezim = jeTma ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", dalsi);
    try {
      localStorage.setItem(KLIC, dalsi);
    } catch {
      // Soukromé okno nebo zakázané úložiště. Přepnutí platí do konce
      // návštěvy, jen se nezapamatuje.
    }
    oznamit();
  }, [rezim]);

  const popis =
    rezim === "dark" ? "Přepnout na světlý režim" : "Přepnout na tmavý režim";

  return (
    <button
      type="button"
      onClick={prepnout}
      title={popis}
      aria-label={popis}
      className="ft-ikona"
    >
      {rezim === "dark" ? (
        <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" />
          <path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4M15.7 15.7l-1.4-1.4M5.7 5.7L4.3 4.3" />
        </svg>
      ) : (
        <svg className="ft-i" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M16.5 11.8A7 7 0 018.2 3.5a7 7 0 108.3 8.3z" />
        </svg>
      )}
    </button>
  );
}
