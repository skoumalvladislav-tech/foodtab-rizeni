"use client";

import { useEffect, useRef, type ReactNode } from "react";

export type PolozkaMenu = {
  klic: string;
  nazev: ReactNode;
  ikona?: ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: "default" | "danger";
};

/**
 * Rozbalovací nabídka přes `<details>/<summary>` — stejný vzor jako
 * `app/[rozsah]/prepinac-rozsahu.tsx`.
 *
 * ZAVÍRÁNÍ SI HLÍDÁ SAMA. `<details>` se sám zavírá jen druhým klikem na
 * `<summary>`: po výběru položky ani po kliknutí mimo zůstane otevřený
 * (dřív tu stálo, že mimo se zavírá nativně — není to pravda). U exportu
 * to bylo vidět nejvíc: soubor se stáhne, stránka se nepřenačte a nabídka
 * s Excelem a PDF visí nad mřížkou dál (Šéfík 20. 9. 2026). Proto se
 * zavře po výběru položky, po kliknutí mimo a Escapem (fokus se vrací na
 * tlačítko, které ji otevřelo).
 */
export default function DropdownMenu({
  spoustec,
  polozky,
  zarovnani = "start",
}: {
  spoustec: ReactNode;
  polozky: PolozkaMenu[];
  zarovnani?: "start" | "end";
}) {
  const nabidka = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const d = nabidka.current;
    if (!d) return;
    const mimo = (e: PointerEvent) => {
      if (d.open && !d.contains(e.target as Node)) d.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && d.open) {
        d.open = false;
        d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", mimo);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", mimo);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const zavrit = () => {
    if (nabidka.current) nabidka.current.open = false;
  };

  return (
    <details className="ds-dropdown" ref={nabidka}>
      <summary>{spoustec}</summary>
      <div className="ds-dropdown-panel" data-align={zarovnani === "end" ? "end" : undefined} role="menu">
        {polozky.map((p) =>
          p.href ? (
            // Odkaz na soubor: prohlížeč ho stáhne a stránka zůstane, takže nabídku zavře až tohle.
            <a key={p.klic} href={p.href} className="ds-dropdown-item" data-tone={p.tone} role="menuitem" onClick={zavrit}>
              {p.ikona}
              {p.nazev}
            </a>
          ) : (
            <button
              key={p.klic}
              type="button"
              className="ds-dropdown-item"
              data-tone={p.tone}
              role="menuitem"
              onClick={() => {
                zavrit();
                p.onClick?.();
              }}
            >
              {p.ikona}
              {p.nazev}
            </button>
          ),
        )}
      </div>
    </details>
  );
}
