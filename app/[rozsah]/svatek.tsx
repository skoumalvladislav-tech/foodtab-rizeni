import { druhText, obchodyText, popisSvatku, type Svatek } from "@/lib/svatky";

import Ikona from "./ikona";

/**
 * Svátek u dne v kalendáři — Rozpis směn i Rezervace a akce stejně
 * (Šéfík 28. 10. 2026). Výpočet je v lib/svatky.ts, vzhled
 * v app/_svatky.css. Čistě kreslicí: komponenta nesahá na čas ani na
 * databázi, svátek dostane hotový.
 *
 * Den se pozná třemi způsoby, žádný není jen barva:
 *   - šrafa v mosazi přes celý den (`data-svatek` na buňce, CSS);
 *   - název svátku textem — v úzké buňce krátký, celý v `title`
 *     a pro odečítač;
 *   - značka zavřených obchodů: vozík a slovo („zavřeno“, „od 12“).
 */

/** Text značky obchodů do úzké buňky. */
function obchodyKratce(s: Svatek): string {
  return s.obchody === "od-poledne" ? "od 12" : "zavřeno";
}

/** S velkým písmenem na začátku — do `title`. */
function vetou(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

/**
 * Značka zavřených obchodů (zákon o prodejní době). Nic, když mají
 * obchody otevřeno.
 */
export function ObchodyZavreno({ svatek, kratce = false }: { svatek: Svatek; kratce?: boolean }) {
  if (!svatek.obchody) return null;
  const text = obchodyText(svatek);
  return (
    <span className="ds-svatek-obchody" title={`${vetou(text)} (zákon o prodejní době)`}>
      <Ikona klic="vozik" velikost={12} />
      {kratce ? (
        <>
          <span aria-hidden="true">{obchodyKratce(svatek)}</span>
          <span className="ft-jen-pro-odecitac">{text}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

/**
 * Název svátku a značka obchodů do buňky dne.
 *
 * `kratce`: do úzké buňky (měsíc, záhlaví mřížky) — vidět je krátký
 * název, odečítač čte celý. Kde má celá buňka `aria-label`, musí do něj
 * volající přidat `popisSvatku()` sám: popisek přebije obsah.
 */
export function ZnackaSvatku({ svatek, kratce = false }: { svatek: Svatek; kratce?: boolean }) {
  return (
    <span className="ds-svatek" data-kratce={kratce ? "" : undefined} title={popisSvatku(svatek)}>
      <span className="ds-svatek-nazev">
        {kratce ? (
          <>
            <span aria-hidden="true">{svatek.kratce}</span>
            <span className="ft-jen-pro-odecitac">
              {druhText(svatek)} {svatek.nazev}
            </span>
          </>
        ) : (
          svatek.nazev
        )}
      </span>
      <ObchodyZavreno svatek={svatek} kratce={kratce} />
    </span>
  );
}

/** Pruh nad dnem (Rezervace: den; Rozpis: den na počítači i telefonu). Nic, když svátek není. */
export function PruhSvatku({ svatek }: { svatek: Svatek | null }) {
  if (!svatek) return null;
  return (
    <p className="ds-svatek-pruh" data-svatek="">
      <span className="ds-svatek-pruh-druh">{druhText(svatek)}</span>
      <span className="ds-svatek-pruh-nazev">{svatek.nazev}</span>
      <ObchodyZavreno svatek={svatek} />
    </p>
  );
}

/**
 * Svátky zobrazeného období pod kalendářem: „28. 10. Den vzniku
 * samostatného československého státu · obchody zavřené“. Zároveň
 * vysvětlivka k šrafě a vozíku. Nic, když v období svátek není.
 */
export function SvatkyObdobi({ svatky }: { svatky: readonly Svatek[] }) {
  if (svatky.length === 0) return null;
  return (
    <section className="ds-svatky-obdobi" aria-label="Svátky v zobrazeném období">
      <span className="ds-svatky-vzorek" data-svatek="" aria-hidden="true" />
      <ul>
        {svatky.map((s) => {
          const [, m, d] = s.den.split("-").map(Number);
          return (
            <li key={s.den}>
              <span className="ds-svatky-datum">
                {d}. {m}.
              </span>{" "}
              <span>{s.nazev}</span>
              <ObchodyZavreno svatek={s} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
