import Ikona from "../../ikona";
import type { IkonaKlic } from "../../nabidka";
import { inicialy, STAV_POPIS, STAV_TON, type Stav } from "./spolecne";

/**
 * Drobné prvky obrazovky checklistů — jen vykreslení, žádná data.
 * Serverové i klientské části je sdílejí, ať vypadají všude stejně.
 */

/** Kolečko s iniciálami (appka fotky lidí nemá). Jméno je v `title`, když ho nenese okolní text. */
export function Avatar({
  jmeno,
  velikost,
  popsat = false,
}: {
  jmeno: string | null;
  velikost?: "male" | "velke";
  /** true = avatar stojí sám, bez jména vedle — pak ho odečítač přečte. */
  popsat?: boolean;
}) {
  return (
    <span
      className="ck-avatar"
      data-velikost={velikost}
      title={jmeno ?? undefined}
      aria-hidden={popsat ? undefined : "true"}
      aria-label={popsat && jmeno ? jmeno : undefined}
      role={popsat ? "img" : undefined}
    >
      {inicialy(jmeno)}
    </span>
  );
}

export function StavChip({ stav }: { stav: Stav }) {
  return (
    <span className="ck-chip" data-ton={STAV_TON[stav]}>
      {STAV_POPIS[stav]}
    </span>
  );
}

/** Pruh postupu. Procenta se zaokrouhlují, nula a sto zůstávají přesně. */
export function Pruh({ hotovo, celkem, ton }: { hotovo: number; celkem: number; ton?: string }) {
  const procenta = celkem > 0 ? Math.round((hotovo / celkem) * 100) : 0;
  return (
    <span
      className="ck-pruh"
      data-ton={ton}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={celkem}
      aria-valuenow={hotovo}
      aria-label={`${hotovo} z ${celkem} hotovo`}
    >
      <span style={{ width: `${procenta}%` }} />
    </span>
  );
}

export function SouhrnKarta({
  nazev,
  cislo,
  popis,
  ikona,
  ton,
}: {
  nazev: string;
  cislo: number;
  popis: string;
  ikona: IkonaKlic;
  ton?: "pozor" | "bad" | "dobre";
}) {
  return (
    <div className="ck-souhrn-karta" data-ton={ton}>
      <p className="ck-souhrn-nazev">{nazev}</p>
      <span className="ck-souhrn-ikona" aria-hidden="true">
        <Ikona klic={ikona} />
      </span>
      <p className="ck-souhrn-cislo ds-cislo">{cislo}</p>
      <p className="ck-souhrn-popis">{popis}</p>
    </div>
  );
}
