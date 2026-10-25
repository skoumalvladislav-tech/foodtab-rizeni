'use client'

import { useActionState } from 'react'

import type { PopisSystemu } from '@/lib/rezervace-poskytovatele'

import { importovatSoubor, type StavImportu } from '../akce'

/**
 * Načtení rezervací ze souboru (CSV export z jiného rezervačního
 * systému). Klientský jen kvůli tomu, aby se výsledek a chyby ukázaly
 * u formuláře — ne v adrese, kam nepatří obsah souboru.
 *
 * Soubor se čte na serveru (lib/rezervace-import.ts). Když je v něm
 * jediná chyba, nenačte se nic — opravený soubor se nahraje celý znovu
 * a nic se nezdvojí (páruje se podle čísla rezervace).
 */
export default function ImportFormular({
  rozsah,
  pobocky,
  systemy,
}: {
  rozsah: string
  pobocky: { id: string; nazev: string }[]
  systemy: readonly PopisSystemu[]
}) {
  const [stav, akce, ceka] = useActionState<StavImportu, FormData>(importovatSoubor, { stav: 'klid' })

  return (
    <form action={akce} className="ds-rez-formular">
      <input type="hidden" name="rozsah" value={rozsah} />
      <div className="ds-rez-mrizka">
        {pobocky.length > 1 ? (
          <label className="ds-field">
            <span className="ds-field-label">Pobočka</span>
            <select className="ds-input" name="pobocka" defaultValue={pobocky[0].id}>
              {pobocky.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nazev}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="pobocka" value={pobocky[0].id} />
        )}
        <label className="ds-field">
          <span className="ds-field-label">Ze kterého systému je soubor</span>
          <select className="ds-input" name="system" defaultValue="jiny">
            {systemy.map((s) => (
              <option key={s.klic} value={s.klic}>
                {s.nazev}
              </option>
            ))}
          </select>
          <span className="ds-field-hint">Podle toho se pozná stejná rezervace i po napojení systému.</span>
        </label>
        <label className="ds-field">
          <span className="ds-field-label">Soubor CSV</span>
          <input className="ds-input" type="file" name="soubor" accept=".csv,text/csv" required style={{ paddingTop: '8px' }} />
        </label>
      </div>

      {stav.stav === 'chyba' ? (
        <div role="alert">
          {stav.chyby.map((c, i) => (
            <p key={i} className="hlaska-chyba" style={{ margin: '0 0 6px' }}>
              {c}
            </p>
          ))}
        </div>
      ) : null}
      {stav.stav === 'hotovo' ? (
        <p className="ds-rez-hlaska" role="status">
          Načteno. Nových {stav.nove}, změněných {stav.zmenene}, beze změny {stav.bezeZmeny}
          {stav.zastarale ? `, přeskočených starších ${stav.zastarale}` : ''}.
          {stav.bezCisla
            ? ' Soubor neměl číslo rezervace — stejnou rezervaci appka pozná podle data, času a jména. Když se v systému změní čas, objeví se jako nová.'
            : ''}
        </p>
      ) : null}

      <div className="ds-rez-tlacitka">
        <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
          {ceka ? 'Načítá se…' : 'Načíst rezervace'}
        </button>
      </div>
    </form>
  )
}
