import type { ReactNode } from "react";

import Ikona from "@/app/[rozsah]/ikona";
import {
  casSDnem,
  casZaznamu,
  druhZaznamuSlovy,
  jedinyZaznam,
  nulovyUsekSlovy,
  opravenoZ,
  podleCasu,
  procSeNepocita,
  rucneSlovy,
  vypocetUseku,
  zdrojSlovy,
  type DenUseku,
  type RadekUseku,
  type ZaznamUseku,
} from "@/lib/useky-dochazky";
import { datumACasVPasmu } from "@/lib/cas";

/**
 * Úseky jednoho provozního dne — ČISTĚ KRESLICÍ, bez dotazu a bez práva.
 *
 * Kreslí ji obrazovka Docházka člověka (s tlačítky, která jí podstrčí
 * přes `akce`) i Můj účet (bez tlačítek, jen pro čtení). Proto tu není
 * žádná klientská komponenta ani serverová akce: tahle část se dá
 * vykreslit v testu bez podstrkování (scripts/dochazka-cloveka.test.mjs).
 *
 * Pravidla, každé s důvodem:
 *   * co se do mzdy nepočítá, je napsané SLOVY (barva nikdy sama —
 *     oddíl 7 vzhledu): otevřený úsek, druhý příchod, odchod bez příchodu
 *   * stornované a nahrazené se nemažou ani neschovávají — jsou
 *     přeškrtnuté i s důvodem, kdo a kdy (pravidlo 9: nic se nemaže)
 *   * ruční záznam nikdy nevypadá jako píchnutí: „ručně · kdo: proč"
 *   * časy v pásmu POBOČKY ZÁZNAMU (lib/cas), nikdy v pásmu serveru
 *   * řádky dne podle ČASU, ne podle pořadí automatu (`podleCasu`) —
 *     „druhý příchod" v 18:15 patří pod úsek 7:30 → 18:15, ne nad něj
 *   * úsek s příchodem a odchodem v téže chvíli (0 min) je napsaný
 *     slovy: přehled dne ho přitom ukazuje jako „v práci"
 */
export default function SeznamUseku({
  den,
  dnes,
  pobocky,
  viceBranches,
  akce,
}: {
  den: DenUseku;
  /** Dnešní provozní den — u otevřeného úseku „v práci od". */
  dnes: string | null;
  /** Názvy poboček podle id. */
  pobocky: Record<string, string>;
  /** Měsíc má záznamy na víc pobočkách — pak se pobočka píše. */
  viceBranches: boolean;
  /** Tlačítka u řádku (obrazovka vedoucího). Bez nich jen pro čtení. */
  akce?: (r: RadekUseku) => ReactNode;
}) {
  const pobocka = (z: ZaznamUseku | null) =>
    viceBranches && z?.pobocka ? (pobocky[z.pobocka] ?? null) : null;

  return (
    <>
      {den.useky.length + den.nezapocitane.length > 0 ? (
        <ol className="ds-uc-useky">
          {podleCasu([...den.useky, ...den.nezapocitane]).map((r) => (
            <li
              key={`${r.druh}-${r.prichod?.id ?? ""}-${r.odchod?.id ?? ""}`}
              className="ds-uc-usek"
              data-druh={r.druh}
            >
              <div className="ds-uc-usek-telo">
                {r.druh === "usek" || r.druh === "otevreny" ? (
                  <Usek r={r} den={den} dnes={dnes} pobocka={pobocka} />
                ) : (
                  <Nezapocitany r={r} pobocka={pobocka} />
                )}
              </div>
              {akce ? <div className="ds-uc-akce">{akce(r)}</div> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="ds-uc-prazdny">Platný záznam tu už není — jen stornované níž.</p>
      )}

      {den.stornovane.length > 0 ? (
        <details className="ds-uc-storna">
          <summary>
            Stornované a nahrazené ({den.stornovane.length})
          </summary>
          <ul>
            {den.stornovane.map((r) => {
              const z = jedinyZaznam(r);
              if (!z) return null;
              return (
                <li key={z.id} data-stornovano="">
                  <s>
                    {casZaznamu(z)} {druhZaznamuSlovy(r.udalostDruh)} · {zdrojSlovy(z)}
                  </s>
                  <span className="ds-uc-storno-proc">
                    {r.nahrazeno ? "Nahrazeno opravou" : "Stornováno"}
                    {r.stornovanoKdy ? ` ${datumACasVPasmu(r.stornovanoKdy, z.zona)}` : ""}
                    {r.stornovalJmeno ? ` · ${r.stornovalJmeno}` : ""}
                    {r.duvodStorna ? ` · ${r.duvodStorna}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function Usek({
  r,
  den,
  dnes,
  pobocka,
}: {
  r: RadekUseku;
  den: DenUseku;
  dnes: string | null;
  pobocka: (z: ZaznamUseku | null) => string | null;
}) {
  const p = r.prichod;
  const o = r.odchod;
  if (!p) return null;
  const otevreny = r.druh === "otevreny";
  const vypocet = vypocetUseku(r);
  const nulovy = nulovyUsekSlovy(r);
  const opravyP = opravenoZ(p, den.stornovane);
  const opravyO = o ? opravenoZ(o, den.stornovane) : null;
  const pobP = pobocka(p);
  const pobO = pobocka(o);

  return (
    <>
      <p className="ds-uc-cas ds-cislo">
        {casSDnem(p, den.den)}
        <span aria-hidden="true"> → </span>
        <span className="sr-only"> až </span>
        {o ? casSDnem(o, den.den) : <span className="ds-uc-chybi">?</span>}
      </p>

      <p className="ds-uc-cipy">
        <Cip z={p} kde={pobP} kdo="příchod" />
        {o ? <Cip z={o} kde={pobO} kdo="odchod" /> : null}
        {p.mimoRozpis ? <span className="ds-uc-cip">mimo rozpis</span> : null}
      </p>

      {rucneSlovy(p) ? <p className="ds-uc-rucne">Příchod {rucneSlovy(p)}</p> : null}
      {o && rucneSlovy(o) ? <p className="ds-uc-rucne">Odchod {rucneSlovy(o)}</p> : null}
      {opravyP ? <p className="ds-uc-oprava">Příchod {opravyP}</p> : null}
      {opravyO ? <p className="ds-uc-oprava">Odchod {opravyO}</p> : null}

      {otevreny ? (
        <p className="ds-uc-nepocita" data-ton="pozor">
          <Ikona klic="varovani" velikost={15} />
          <span>
            {procSeNepocita(r)}
            {dnes && den.den === dnes && !p.uzavreno ? ` V práci od ${casZaznamu(p)}.` : ""}
            {p.uzavreno
              ? ` Systém příchod uzavřel ${datumACasVPasmu(p.uzavreno, p.zona)} (další příchod jiný den), odchod pořád chybí.`
              : ""}
          </span>
        </p>
      ) : nulovy ? (
        <p className="ds-uc-nepocita" data-ton="pozor" data-nulovy="">
          <Ikona klic="varovani" velikost={15} />
          <span>{nulovy}</span>
        </p>
      ) : vypocet ? (
        <p className="ds-uc-vypocet">{vypocet}</p>
      ) : null}
    </>
  );
}

function Nezapocitany({
  r,
  pobocka,
}: {
  r: RadekUseku;
  pobocka: (z: ZaznamUseku | null) => string | null;
}) {
  const z = jedinyZaznam(r);
  if (!z) return null;
  return (
    <>
      <p className="ds-uc-cas ds-cislo">
        {casZaznamu(z)} <span className="ds-uc-druh">{druhZaznamuSlovy(r.udalostDruh)}</span>
      </p>
      <p className="ds-uc-cipy">
        <Cip z={z} kde={pobocka(z)} kdo={null} />
      </p>
      {rucneSlovy(z) ? <p className="ds-uc-rucne">{rucneSlovy(z)}</p> : null}
      <p className="ds-uc-nepocita" data-ton="pozor">
        <Ikona klic="vykricnik" velikost={15} />
        <span>{procSeNepocita(r)}</span>
      </p>
    </>
  );
}

/** Zdroj slovem (a pobočka, když je jich víc). Ruční má tužku. */
function Cip({ z, kde, kdo }: { z: ZaznamUseku; kde: string | null; kdo: string | null }) {
  return (
    <span className="ds-uc-cip" data-zdroj={z.zdroj}>
      {z.zdroj === "rucne" ? <Ikona klic="tuzka" velikost={13} /> : null}
      {kdo ? <span className="ds-uc-cip-kdo">{kdo}</span> : null}
      {zdrojSlovy(z)}
      {kde ? ` · ${kde}` : ""}
    </span>
  );
}
