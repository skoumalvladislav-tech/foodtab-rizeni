"use client";

import { useId, useState, type ReactNode } from "react";

export type TabPolozka = { klic: string; nazev: string; obsah: ReactNode };

/**
 * Řízené i neřízené záložky. Appka do teď měla tři nezávislé ruční
 * implementace (marketing/menu/nove, vzkazy, legacy dashboard) — tohle
 * je jedna sdílená, klávesnicí ovladatelná (role="tablist").
 */
export default function Tabs({
  polozky,
  aktivni,
  onZmena,
}: {
  polozky: TabPolozka[];
  /** Neřízené použití: vynech `aktivni`/`onZmena`, stav si drží komponenta sama. */
  aktivni?: string;
  onZmena?: (klic: string) => void;
}) {
  const idBase = useId();
  const [vlastni, setVlastni] = useState(polozky[0]?.klic);
  const vybrany = aktivni ?? vlastni;

  function zvol(klic: string) {
    if (onZmena) onZmena(klic);
    else setVlastni(klic);
  }

  const obsah = polozky.find((p) => p.klic === vybrany);

  return (
    <div>
      <div className="ds-tabs" role="tablist">
        {polozky.map((p) => (
          <button
            key={p.klic}
            type="button"
            role="tab"
            id={`${idBase}-${p.klic}`}
            aria-selected={p.klic === vybrany}
            aria-controls={`${idBase}-panel-${p.klic}`}
            className="ds-tab"
            onClick={() => zvol(p.klic)}
          >
            {p.nazev}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={obsah ? `${idBase}-panel-${obsah.klic}` : undefined} aria-labelledby={obsah ? `${idBase}-${obsah.klic}` : undefined}>
        {obsah?.obsah}
      </div>
    </div>
  );
}
