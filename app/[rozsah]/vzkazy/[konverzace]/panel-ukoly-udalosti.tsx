import Link from 'next/link'

import Ikona from '@/app/[rozsah]/ikona'
import { datumACasVPasmu } from '@/lib/cas'
import { STAV_UKOLU, type UdalostUI, type UkolUI } from './panel-konverzace'

/**
 * Panel „Úkoly a události“ — čtvrtý sloupec desktopu, vedle „O konverzaci“.
 *
 * Vzniklo 22. 9. rozdělením panel-konverzace.tsx podle Šéfíkova obrázku
 * (samostatný sloupec pro úkoly/checklisty/události). Data jsou stejná,
 * jen přestěhovaná — žádný nový dotaz, žádná nová informace.
 *
 * Checklisty tu schválně NEJSOU: mezi konverzací a checklistem žádná
 * vazba v databázi neexistuje (viz komentář v panel-konverzace.tsx).
 * Sekce s vymyšleným počtem by lhala, tak tu radši chybí, než aby
 * ukazovala číslo, které nikde nevzniklo.
 */
export default function PanelUkolyUdalosti({
  rozsah,
  ukoly,
  udalosti,
  zona,
}: {
  rozsah: string
  /** null = úkoly se k rozhovorům zatím nedají svázat (migrace nenasazená). */
  ukoly: UkolUI[] | null
  udalosti: UdalostUI[]
  zona: string
}) {
  return (
    <aside className="ds-plocha pc-panel" aria-label="Úkoly a události">
      <div className="ds-plocha-hlava">
        <Ikona klic="fajfkaCtverec" />
        <h2>
          Úkoly{ukoly && ukoly.length > 0 ? ` (${ukoly.length})` : ''}
        </h2>
      </div>

      <section className="pc-sekce">
        {ukoly === null ? (
          <p className="pc-prazdno">Úkoly se k rozhovorům přiřadí po nasazení databáze.</p>
        ) : ukoly.length === 0 ? (
          <p className="pc-prazdno">Z téhle konverzace zatím žádný úkol nevznikl.</p>
        ) : (
          <ul className="pc-seznam">
            {ukoly.map((u) => (
              <li key={u.id}>
                <span className="pc-avatar" aria-hidden="true">
                  <Ikona klic="fajfkaCtverec" />
                </span>
                <Link href={`/${rozsah}/ukoly/ukol/${u.id}`}>
                  {u.nazev}
                  <small>
                    <span
                      className="pc-chip"
                      data-stav={u.stav === 'done' ? 'hotovo' : u.poTerminu ? 'pozde' : u.priorita === 'high' ? 'high' : undefined}
                    >
                      {u.stav === 'open' && u.poTerminu ? 'Po termínu' : STAV_UKOLU[u.stav]}
                    </span>
                    {u.termin ? ` · do ${datumACasVPasmu(u.termin, zona)}` : ''}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pc-sekce">
        <h3>Poslední systémové události</h3>
        {udalosti.length === 0 ? (
          <p className="pc-prazdno">Zatím se nic nestalo.</p>
        ) : (
          <ul className="pc-seznam">
            {udalosti.map((u) => (
              <li key={u.id}>
                <span className="pc-avatar" aria-hidden="true">
                  <Ikona klic="fajfkaKruh" />
                </span>
                {u.ukolId ? (
                  <Link href={`/${rozsah}/ukoly/ukol/${u.ukolId}`}>
                    {u.text}
                    <small>{datumACasVPasmu(u.kdy, zona)}</small>
                  </Link>
                ) : (
                  <span>
                    {u.text}
                    <small>{datumACasVPasmu(u.kdy, zona)}</small>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
