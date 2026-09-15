"use client";

import type { ReactNode } from "react";

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
 * `app/[rozsah]/prepinac-rozsahu.tsx`, žádný stavový JS navíc, zavírá
 * se kliknutím mimo (nativní chování disclosure prvku).
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
  return (
    <details className="ds-dropdown">
      <summary>{spoustec}</summary>
      <div className="ds-dropdown-panel" data-align={zarovnani === "end" ? "end" : undefined} role="menu">
        {polozky.map((p) =>
          p.href ? (
            <a key={p.klic} href={p.href} className="ds-dropdown-item" data-tone={p.tone} role="menuitem">
              {p.ikona}
              {p.nazev}
            </a>
          ) : (
            <button key={p.klic} type="button" className="ds-dropdown-item" data-tone={p.tone} role="menuitem" onClick={p.onClick}>
              {p.ikona}
              {p.nazev}
            </button>
          ),
        )}
      </div>
    </details>
  );
}
