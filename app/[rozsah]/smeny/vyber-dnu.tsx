import { cisloDne, jeVikend, popisDne, ZKRATKY_DNU } from "@/lib/rozpis-mobil";
import { tydnyOkna } from "@/lib/vyber-dnu";

/**
 * Mřížka pro výběr víc dnů — kreslí `formular-smeny.tsx`, když je zapnuté
 * „Víc dní“ u nové směny. Sama nedrží žádný stav: který den je vybraný
 * a kolik týdnů je vidět, řídí formulář (`prepnoutDen`, `pocetTydnuOkna`),
 * tady je jen kreslení.
 *
 * Stejná mřížka na počítači i na telefonu (žádná druhá kopie) — buňky
 * mají dotykovou výšku 52 px jako ostatní klikací pole ve Směnách na
 * telefonu (`.ds-sm-mesic-den`, `.ds-sm-pole-obal`); na počítači ji
 * zmenší `.ds-smd-form .ds-sm-vd-den` na 40 px, stejnou úvahou jako
 * u ostatních polí panelu (app/_komponenty.css).
 */
export default function VyberDnu({
  zacatek,
  vybrane,
  pocetTydnu,
  onPrepnout,
  onVicTydnu,
}: {
  /** Den, kolem kterého se sestaví první týden okna (obvykle předvyplněný den formuláře). */
  zacatek: string;
  vybrane: string[];
  pocetTydnu: number;
  onPrepnout: (den: string) => void;
  /** Rozšíří okno o další týdny; vynechá se, když je okno na svém stropu. */
  onVicTydnu?: () => void;
}) {
  const tydny = tydnyOkna(zacatek, pocetTydnu);
  const vybranaMnozina = new Set(vybrane);

  return (
    <div className="ds-sm-vd">
      <div className="ds-sm-vd-hlavicka" aria-hidden="true">
        {ZKRATKY_DNU.map((z) => (
          <span key={z}>{z}</span>
        ))}
      </div>
      <div className="ds-sm-vd-mrizka" role="group" aria-label="Dny, pro které se založí směna">
        {tydny.map((tyden) => (
          <div key={tyden[0]} className="ds-sm-vd-tyden">
            {tyden.map((den) => {
              const vybran = vybranaMnozina.has(den);
              return (
                <button
                  key={den}
                  type="button"
                  className="ds-sm-vd-den"
                  data-vybrano={vybran ? "" : undefined}
                  data-vikend={jeVikend(den) ? "" : undefined}
                  aria-pressed={vybran}
                  aria-label={popisDne(den)}
                  onClick={() => onPrepnout(den)}
                >
                  {cisloDne(den)}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {onVicTydnu ? (
        <button type="button" className="ds-sm-vd-vic" onClick={onVicTydnu}>
          Zobrazit další týdny
        </button>
      ) : null}
    </div>
  );
}
