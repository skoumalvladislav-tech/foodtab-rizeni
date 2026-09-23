import Link from "next/link";

import { datumACasVPasmu, denVPasmu, hodinaVPasmu } from "@/lib/cas";
import Ikona from "../../ikona";
import type { SouvisejiciUkol, Udalost } from "./data";
import ZalozkyBoku from "./zalozky-boku";

/**
 * Bok detailu běhu: časová osa (Aktivita) a úkoly vzniklé z checklistu
 * (Související). Úkol je samostatný objekt s vazbou na běh/položku —
 * checklist a úkol se neslučují (zadání bod 2), jen se na sebe odkazují.
 */
export default function BokBehu({
  rozsah,
  udalosti,
  ukoly,
  nazvyPolozek,
  zona,
  den,
}: {
  rozsah: string;
  udalosti: Udalost[];
  ukoly: SouvisejiciUkol[];
  nazvyPolozek: Map<string, string>;
  zona: string;
  /** Provozní den běhu — u starších událostí se ukáže i datum. */
  den: string;
}) {
  // Den se porovnává v pásmu pobočky, ne podle UTC řetězce — kolem půlnoci
  // by jinak dnešní zápis ukázal včerejší datum.
  const cas = (iso: string) =>
    denVPasmu(iso, zona) === den ? hodinaVPasmu(iso, zona) : datumACasVPasmu(iso, zona);

  const aktivita =
    udalosti.length === 0 ? (
      <p className="pc-prazdno">Zatím se tu nic nestalo.</p>
    ) : (
      <ol className="ck-osa">
        {udalosti.map((u) => (
          <li key={u.klic} data-ton={u.ton}>
            <div className="ck-osa-hlava">
              <strong>{u.kdo ?? (u.ton === "bad" && u.ukol ? "Nahlášen problém" : "—")}</strong>
              <time dateTime={u.kdy}>{cas(u.kdy)}</time>
            </div>
            <p>{u.text}</p>
            {u.ukol ? (
              <Link href={`/${rozsah}/ukoly/ukol/${u.ukol.id}`} className="ck-ukol-karta">
                <Ikona klic="fajfkaCtverec" />
                <span>
                  <strong>Úkol</strong>
                  {u.ukol.nazev}
                </span>
                <Ikona klic="sipkaVpravo" />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
    );

  const souvisejici =
    ukoly.length === 0 ? (
      <p className="pc-prazdno">Z tohohle checklistu zatím nevznikl žádný úkol.</p>
    ) : (
      <ul className="ck-souvisejici">
        {ukoly.map((u) => (
          <li key={u.id}>
            <Link href={`/${rozsah}/ukoly/ukol/${u.id}`} className="ck-ukol-karta">
              <Ikona klic={u.stav === "done" ? "fajfkaKruh" : "vykricnik"} />
              <span>
                <strong>{u.nazev}</strong>
                {[
                  u.polozkaId ? nazvyPolozek.get(u.polozkaId) : null,
                  u.komu,
                  u.priorita === "critical" ? "kritická" : u.priorita === "high" ? "důležitá" : null,
                  u.stav === "done" ? "hotovo" : u.stav === "cancelled" ? "zrušeno" : "otevřený",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <Ikona klic="sipkaVpravo" />
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <aside className="ck-bok" aria-label="Aktivita a související">
      <ZalozkyBoku aktivita={aktivita} souvisejici={souvisejici} pocetSouvisejicich={ukoly.length} />
    </aside>
  );
}
