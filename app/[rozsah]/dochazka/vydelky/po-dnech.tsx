import type { ReactNode } from "react";

import { hodinyAMinuty, koruny, nazevMesice } from "@/lib/mzdy";
import { pocet } from "@/lib/sklonovani";
import { denZkraceny } from "@/lib/upozorneni-text";
import { PanelHlava } from "../../dnes/prvky";

/**
 * Náklady na mzdy a zálohy po dnech — oddíl „Po dnech“ záložky Výdělky.
 *
 * Zadání majitele 24. 9. večer: „denní přehled nákladů na mzdy
 * a odečtené zálohy.“
 *
 * ČISTĚ KRESLICÍ, jako tabulka po lidech nad ní. Čísla dává
 * `public.vydelky_po_dnech`: mzda je rozklad téže app.earnings po
 * provozních dnech (součet dnů = součet sloupce Vyděláno po lidech,
 * hlídá krok59), lidé a práva jako `vydelky_prehled`.
 *
 * „Bez sazby“ nikdy jako „0 Kč“ (zadání mezd, oddíl 6): den, kdy
 * pracovali jen lidé bez sazby, má „bez sazby“; den, kdy chyběla jen
 * u někoho, má částku se štítkem.
 *
 * Mzdová data: nikdy do jazykového modelu (pravidlo 8).
 */

/** Jeden řádek z `public.vydelky_po_dnech` — kontrakt DB → aplikace. */
export type RadekDne = {
  /** Provozní den, RRRR-MM-DD. */
  den: string;
  /** Lidé s uzavřenou docházkou ten den. */
  lidi: number;
  odpracovano_minut: number;
  /** Hrubá mzda; NULL = ten den pracovali jen lidé bez sazby (nebo nikdo). */
  mzdy_haleru: number | null;
  bez_sazby_lidi: number;
  zalohy_haleru: number;
  zaloh: number;
  zaloh_nepotvrzenych: number;
};

const SLOUPCE = ["Den", "Lidé", "Odpracováno", "Mzdy (hrubě)", "Zálohy"] as const;

export default function NakladyPoDnech({
  radky,
  mesic,
}: {
  /** NULL = databáze funkci ještě nemá (nenasazená migrace). */
  radky: RadekDne[] | null;
  /** První den měsíce, RRRR-MM-DD. */
  mesic: string;
}) {
  if (radky === null) {
    return (
      <section className="ds-plocha ds-vy-dny">
        <PanelHlava ikona="kalendar" nadpis="Po dnech" />
        <p className="ds-vy-poznamka">Přehled po dnech bude dostupný po nasazení databáze.</p>
      </section>
    );
  }

  const dny = [...radky].sort((a, b) => a.den.localeCompare(b.den));
  const celkem = soucet(dny);

  return (
    <section className="ds-plocha ds-vy-dny" aria-label="Náklady na mzdy a zálohy po dnech">
      <PanelHlava ikona="kalendar" nadpis={`Po dnech (${nazevMesice(mesic)})`} />

      {dny.length === 0 ? (
        <p className="ds-vy-poznamka">
          Za {nazevMesice(mesic)} zatím žádná uzavřená docházka ani záloha.
        </p>
      ) : (
        <>
          <div className="ds-vy-tabulka-obal">
            <table className="ds-vy-tabulka">
              <thead>
                <tr>
                  {SLOUPCE.map((sl) => (
                    <th key={sl} scope="col">
                      {sl}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dny.map((r) => (
                  <tr key={r.den} data-den={r.den}>
                    <th scope="row">{denZkraceny(r.den)}</th>
                    {bunky(r).map((b, i) => (
                      <td key={SLOUPCE[i + 1]}>{b}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-den="celkem">
                  <th scope="row">Celkem</th>
                  {bunky(celkem, true).map((b, i) => (
                    <td key={SLOUPCE[i + 1]}>{b}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Telefon: každý den jako karta, stejné buňky; celkem na konci. */}
          <ul className="ds-vy-karty">
            {[...dny, celkem].map((r) => (
              <li key={r.den} className="ds-vy-karta" data-den={r.den}>
                <span className="ds-vy-jmeno">{r === celkem ? "Celkem" : denZkraceny(r.den)}</span>
                <dl>
                  {bunky(r, r === celkem).map((b, i) => (
                    <div key={SLOUPCE[i + 1]} className="ds-vy-radek">
                      <dt>{SLOUPCE[i + 1]}</dt>
                      <dd>{b}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* --- kousky ------------------------------------------------------------ */

/**
 * Buňky dne po sloupci Den. Jedna funkce pro tabulku, karty i Celkem.
 * U Celkem je sloupec Lidé prázdný: lidi se přes dny sčítat nedají —
 * jeden člověk by se započetl tolikrát, kolik dnů pracoval.
 */
function bunky(r: RadekDne, jeCelkem = false): ReactNode[] {
  return [
    !jeCelkem && r.lidi > 0 ? pocet(r.lidi, "člověk", "lidé", "lidí") : <Nic key="l" />,
    r.lidi > 0 ? hodinyAMinuty(r.odpracovano_minut) : <Nic key="o" />,
    mzdy(r, jeCelkem),
    zalohy(r),
  ];
}

function mzdy(r: RadekDne, jeCelkem: boolean): ReactNode {
  if (r.lidi === 0) return <Nic />;
  if (r.mzdy_haleru === null) return <span className="ds-vy-bez-sazby">bez sazby</span>;
  return (
    <>
      {koruny(r.mzdy_haleru)}
      {r.bez_sazby_lidi > 0 ? (
        <span className="ds-vy-znacka ds-vy-pod">
          {jeCelkem
            ? "část bez sazby"
            : `+ ${pocet(r.bez_sazby_lidi, "člověk", "lidé", "lidí")} bez sazby`}
        </span>
      ) : null}
    </>
  );
}

/**
 * Zálohy dne a kolik z nich je nepotvrzených. Jen „nepotvrzená“, ne čím
 * se má potvrdit: od 25. 9. 2026 jde PINem na tabletu, v telefonu i za
 * zaměstnance majitelem.
 */
function zalohy(r: RadekDne): ReactNode {
  if (r.zaloh === 0) return <Nic />;
  return (
    <>
      {koruny(r.zalohy_haleru)}
      {r.zaloh_nepotvrzenych > 0 ? (
        <span className="ds-vy-znacka ds-vy-pod">
          {pocet(r.zaloh_nepotvrzenych, "nepotvrzená", "nepotvrzené", "nepotvrzených")}
        </span>
      ) : null}
    </>
  );
}

/** Prázdná buňka. Pomlčka, ne nula: nula by tvrdila výsledek. */
function Nic() {
  return (
    <span className="ds-vy-nic">
      <span aria-hidden="true">—</span>
      <span className="sr-only">nic</span>
    </span>
  );
}

/**
 * Řádek Celkem — jen sčítání hotových čísel z databáze. Mzdy jsou
 * součet dnů se sazbou (rozklad je udělaný tak, aby to byl přesně
 * součet po lidech); NULL jen tehdy, když ani jeden den sazbu neměl.
 * `lidi` je tu jen příznak „někdo pracoval“ a `bez_sazby_lidi` „aspoň
 * jeden den sazba chyběla“ — proto se u Celkem píše „část bez sazby“.
 */
function soucet(dny: RadekDne[]): RadekDne {
  const s: RadekDne = {
    den: "celkem",
    lidi: 0,
    odpracovano_minut: 0,
    mzdy_haleru: null,
    bez_sazby_lidi: 0,
    zalohy_haleru: 0,
    zaloh: 0,
    zaloh_nepotvrzenych: 0,
  };
  for (const r of dny) {
    s.odpracovano_minut += r.odpracovano_minut;
    if (r.mzdy_haleru !== null) s.mzdy_haleru = (s.mzdy_haleru ?? 0) + r.mzdy_haleru;
    s.bez_sazby_lidi += r.bez_sazby_lidi;
    s.zalohy_haleru += r.zalohy_haleru;
    s.zaloh += r.zaloh;
    s.zaloh_nepotvrzenych += r.zaloh_nepotvrzenych;
    s.lidi = Math.max(s.lidi, r.lidi);
  }
  return s;
}
