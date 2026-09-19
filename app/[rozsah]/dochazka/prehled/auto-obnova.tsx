"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Živý přehled se obnovuje sám: každou minutu znovu načte data ze
 * serveru (`router.refresh` — stránka zůstane, otevřený panel taky).
 *
 * Neběží na skryté záložce (prohlížeč by zbytečně tahal data a v den, kdy
 * je karta otevřená celý provoz, se to sečte) a hned po návratu na záložku
 * obnoví, co mezitím zestárlo.
 */
export default function AutoObnova({ sekund = 60 }: { sekund?: number }) {
  const router = useRouter();

  useEffect(() => {
    let posledni = Date.now();
    const obnovit = () => {
      if (document.visibilityState !== "visible") return;
      posledni = Date.now();
      router.refresh();
    };
    const casovac = window.setInterval(obnovit, sekund * 1000);
    const naZobrazeni = () => {
      if (document.visibilityState === "visible" && Date.now() - posledni > sekund * 1000) obnovit();
    };
    document.addEventListener("visibilitychange", naZobrazeni);
    return () => {
      window.clearInterval(casovac);
      document.removeEventListener("visibilitychange", naZobrazeni);
    };
  }, [router, sekund]);

  return null;
}
