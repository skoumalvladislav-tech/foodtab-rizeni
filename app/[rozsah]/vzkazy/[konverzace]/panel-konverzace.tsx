import Link from 'next/link'

import Ikona from '@/app/[rozsah]/ikona'
import { datumACasVPasmu } from '@/lib/cas'
import { mmss } from '@/lib/hlasove-zpravy'
import { oznacitPrecteno } from '../akce'

/**
 * Panel „O konverzaci“ — třetí sloupec desktopu.
 *
 * Ukazuje jen to, co aplikace OPRAVDU ví:
 *   * účastníky (nebo větu, koho se týká odvozený kanál),
 *   * sdílené soubory — hlasové zprávy a přílohy (fotky, PDF; ty až po
 *     nasazení migrace 20260921130000, do té doby jen hlasovky).
 *
 * Související úkoly a události mají VLASTNÍ, čtvrtý sloupec —
 * `panel-ukoly-udalosti.tsx` — vzhled 22. 9. podle Šéfíkova obrázku.
 * Rozdělení je čistě vizuální, žádná data se nepřidala.
 *
 * Checklisty tu nejsou (ani ve čtvrtém sloupci): mezi konverzací
 * a checklistem žádná vazba neexistuje a sekce s vymyšlenými daty
 * by lhala.
 *
 * Komponenta nesahá do databáze — data jí dodá stránka, takže se dá
 * vykreslit i v dočasném náhledu.
 */

export type UcastnikUI = { id: string; jmeno: string; jeJa: boolean }
export type SouborUI = {
  /** Id zprávy — kotva ve vlákně (#z-…). */
  id: string
  /** Jednoznačný klíč řádku, když jedna zpráva nese víc souborů. */
  klic?: string
  kdy: string
  delkaS: number | null
  /** Název přiloženého souboru; u hlasovky null. */
  nazev?: string | null
}
export type UkolUI = {
  id: string
  nazev: string
  /** ISO okamžik termínu, nebo null. */
  termin: string | null
  stav: 'open' | 'done' | 'cancelled'
  priorita: 'normal' | 'high'
  poTerminu: boolean
}
export type UdalostUI = { id: string; text: string; kdy: string; ukolId: string | null }

/** Sdílené i s panel-ukoly-udalosti.tsx a vlakno-zprav.tsx — jedna definice „jak se dělá iniciála“. */
export function iniciely(jmeno: string): string {
  const casti = jmeno.trim().split(/\s+/).filter(Boolean)
  if (casti.length === 0) return '?'
  const a = casti[0].charAt(0)
  const b = casti.length > 1 ? casti[casti.length - 1].charAt(0) : ''
  return `${a}${b}`.toUpperCase()
}

export const STAV_UKOLU: Record<UkolUI['stav'], string> = {
  open: 'Otevřený',
  done: 'Hotovo',
  cancelled: 'Zrušený',
}

export default function PanelKonverzace({
  rozsah,
  konverzace,
  druhNazev,
  kdoCte,
  zalozeno,
  ucastnici,
  soubory,
  zona,
  smiUkoly,
  zpravaProUkol,
  jeUzavrena,
  prilohyDostupne = false,
}: {
  rozsah: string
  konverzace: string
  druhNazev: string
  /** Věta o tom, koho se rozhovor týká (kanál pobočky, úseku, vzkaz vedení…). */
  kdoCte: string
  zalozeno: string | null
  /** null = seznam se nepodařilo načíst. */
  ucastnici: UcastnikUI[] | null
  soubory: SouborUI[]
  zona: string
  smiUkoly: boolean
  /** Poslední textová zpráva, ze které se dá udělat úkol; jinak null. */
  zpravaProUkol: string | null
  jeUzavrena: boolean
  /** Přílohy jsou v databázi (migrace 20260921130000 nasazená). Bez nich panel řekne, že se fotky sdílet nedají. */
  prilohyDostupne?: boolean
}) {
  return (
    <aside className="ds-plocha pc-panel" aria-label="O konverzaci">
      <div className="ds-plocha-hlava">
        <Ikona klic="lide" />
        <h2>O konverzaci</h2>
      </div>

      <section className="pc-sekce">
        <dl className="pc-udaje">
          <dt>Druh</dt>
          <dd>{druhNazev}{jeUzavrena ? ' · uzavřeno' : ''}</dd>
          <dt>Kdo čte</dt>
          <dd>{kdoCte}</dd>
          {zalozeno ? (
            <>
              <dt>Založeno</dt>
              <dd>{datumACasVPasmu(zalozeno, zona)}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {ucastnici !== null && ucastnici.length > 0 ? (
        <section className="pc-sekce">
          <h3>Účastníci ({ucastnici.length})</h3>
          <ul className="pc-seznam">
            {ucastnici.map((u) => (
              <li key={u.id}>
                <span className="pc-avatar" aria-hidden="true">
                  {iniciely(u.jmeno)}
                </span>
                <span>{u.jeJa ? `${u.jmeno} (vy)` : u.jmeno}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pc-sekce">
        <h3>Sdílené soubory</h3>
        {soubory.length > 0 ? (
          <ul className="pc-seznam">
            {soubory.map((s) => (
              <li key={s.klic ?? s.id}>
                <span className="pc-avatar" aria-hidden="true">
                  <Ikona klic={s.nazev ? 'faktura' : 'zprava'} />
                </span>
                <a href={`#z-${s.id}`}>
                  {s.nazev ? s.nazev : `Hlasová zpráva${s.delkaS ? ` · ${mmss(s.delkaS)}` : ''}`}
                  <small>{datumACasVPasmu(s.kdy, zona)}</small>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pc-prazdno">Zatím nic nesdíleno.</p>
        )}
        {prilohyDostupne ? null : (
          <p className="pc-prazdno" style={{ marginTop: '8px' }}>
            Fotky a dokumenty se zatím sdílet nedají.
          </p>
        )}
      </section>

      <section className="pc-sekce">
        <h3>Rychlé akce</h3>
        <div className="pc-rychle">
          {smiUkoly && zpravaProUkol ? (
            <Link
              href={`/${rozsah}/vzkazy/${konverzace}/ukol?zprava=${zpravaProUkol}`}
              className="ft-tl ft-tl-hlavni ft-tl-male"
            >
              <Ikona klic="fajfkaCtverec" /> Úkol z poslední zprávy
            </Link>
          ) : null}
          <form action={oznacitPrecteno}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="konverzace" value={konverzace} />
            <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male" style={{ width: '100%' }}>
              <Ikona klic="fajfka" /> Označit za přečtené
            </button>
          </form>
        </div>
      </section>
    </aside>
  )
}
