"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * Záložky „Aktivita / Související" v boku detailu.
 *
 * Obsah vykresluje server; tady se jen přepíná, co je vidět. Do načtení
 * skriptu (a bez JavaScriptu vůbec) jsou vidět OBĚ části pod sebou —
 * záložky, které by bez skriptu nešly přepnout, by druhou část schovaly
 * navždy. `useSyncExternalStore` pozná prohlížeč bez efektu, který by
 * při hydrataci blikl.
 */
const nicSeNemeni = () => () => {};

export default function ZalozkyBoku({
  aktivita,
  souvisejici,
  pocetSouvisejicich,
}: {
  aktivita: ReactNode;
  souvisejici: ReactNode;
  pocetSouvisejicich: number;
}) {
  const vProhlizeci = useSyncExternalStore(nicSeNemeni, () => true, () => false);
  const [zalozka, setZalozka] = useState<"aktivita" | "souvisejici">("aktivita");

  if (!vProhlizeci) {
    return (
      <>
        <section className="ck-bok-panel" aria-label="Aktivita">
          <h3>Aktivita</h3>
          {aktivita}
        </section>
        <section className="ck-bok-panel" aria-label="Související">
          <h3>Související ({pocetSouvisejicich})</h3>
          {souvisejici}
        </section>
      </>
    );
  }

  return (
    <>
      <div className="ck-bok-zalozky" role="tablist" aria-label="Aktivita a související úkoly">
        <button
          type="button"
          role="tab"
          id="ck-tab-aktivita"
          aria-controls="ck-panel-aktivita"
          aria-selected={zalozka === "aktivita"}
          onClick={() => setZalozka("aktivita")}
        >
          Aktivita
        </button>
        <button
          type="button"
          role="tab"
          id="ck-tab-souvisejici"
          aria-controls="ck-panel-souvisejici"
          aria-selected={zalozka === "souvisejici"}
          onClick={() => setZalozka("souvisejici")}
        >
          Související ({pocetSouvisejicich})
        </button>
      </div>
      <div
        role="tabpanel"
        id="ck-panel-aktivita"
        aria-labelledby="ck-tab-aktivita"
        hidden={zalozka !== "aktivita"}
      >
        {aktivita}
      </div>
      <div
        role="tabpanel"
        id="ck-panel-souvisejici"
        aria-labelledby="ck-tab-souvisejici"
        hidden={zalozka !== "souvisejici"}
      >
        {souvisejici}
      </div>
    </>
  );
}
