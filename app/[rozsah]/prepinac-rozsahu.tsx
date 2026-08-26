"use client";

import Link from "next/link";

/**
 * Přepínač rozsahu.
 *
 * Vypisuje volby vedle sebe jako segmenty: Celá firma a jednotlivé
 * pobočky. Vybraná je vyplněná svou barvou, ostatní mají jen obrys.
 * U každé je tečka i název — barva sama nikdy nestačí, deset procent
 * mužů rozeznává odstíny hůř a na displej se v provozu kouká přes rameno.
 *
 * Od páté volby se řada sbalí do rozbalovací nabídky, jinak by lišta
 * přetekla; poboček může mít zákazník neomezeně. Na mobilu se sbaluje
 * vždycky a rozbaluje SEZNAM POBOČEK — obrazovky patří do spodní lišty.
 *
 * Barvu drží data-branch na každé volbě zvlášť, takže var(--branch)
 * uvnitř sáhne po odstínu té které pobočky.
 */

export type RozsahProp = {
  slug: string;
  nazev: string;
  /** Klíč z branches.color. Celá firma má neutrální odstín. */
  barva: string;
};

/** Kolik voleb se ještě vejde vedle sebe, než se řada sbalí. */
const VEDLE_SEBE = 4;

export default function PrepinacRozsahu({
  rozsahy,
  aktivni,
  cil,
}: {
  rozsahy: RozsahProp[];
  aktivni: string;
  /** Kam vede přepnutí na daný rozsah. Počítá to rám, zná adresu. */
  cil: (slug: string) => string;
}) {
  if (rozsahy.length === 0) return null;

  const zde = rozsahy.find((r) => r.slug === aktivni) ?? rozsahy[0];
  const sbaleno = rozsahy.length > VEDLE_SEBE;

  return (
    <>
      {sbaleno ? null : (
        <div className="ft-seg" role="group" aria-label="Rozsah">
          {rozsahy.map((r) => (
            <Link
              key={r.slug}
              href={cil(r.slug)}
              data-branch={r.barva}
              className={r.slug === aktivni ? "on" : undefined}
              aria-current={r.slug === aktivni ? "page" : undefined}
            >
              <span className="ft-swatch" aria-hidden="true" />
              <span>{r.nazev}</span>
            </Link>
          ))}
        </div>
      )}

      <details className={sbaleno ? "ft-rozsah vzdy" : "ft-rozsah"}>
        <summary data-branch={zde.barva} aria-label={`Rozsah: ${zde.nazev}`}>
          <span className="ft-swatch" aria-hidden="true" />
          <span>{zde.nazev}</span>
          <svg className="ft-i sipka" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5.5 8l4.5 4.5L14.5 8" />
          </svg>
        </summary>

        <div className="ft-rozsah-panel">
          <p>Přepnout na</p>
          {rozsahy.map((r) => (
            <Link
              key={r.slug}
              href={cil(r.slug)}
              data-branch={r.barva}
              className={r.slug === aktivni ? "on" : undefined}
              aria-current={r.slug === aktivni ? "page" : undefined}
            >
              <span className="ft-swatch" aria-hidden="true" />
              <span>{r.nazev}</span>
            </Link>
          ))}
        </div>
      </details>
    </>
  );
}
