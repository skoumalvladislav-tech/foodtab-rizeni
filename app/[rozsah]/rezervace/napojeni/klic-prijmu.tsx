'use client'

import { useActionState } from 'react'

import { vydatKlicPrijmuRezervaci, type StavKliceRezervaci } from '../akce'

/**
 * Vydání / výměna klíče pro příjmové API rezervací. Klíč appka ukáže jen
 * tady, jen jednou — po obnovení stránky už ho nikdo neuvidí (v databázi
 * je jen zašifrovaný). Proto `useActionState`, ne přesměrování s klíčem
 * v adrese. Stejný vzor jako u pokladen
 * (finance/integrace/pokladna/klic-prijmu.tsx).
 */
export default function KlicPrijmuRezervaci({
  rozsah,
  id,
  pobocky,
}: {
  rozsah: string
  /** Vyplněné = výměna klíče u existujícího napojení. */
  id?: string
  /** U nového napojení pobočky, které ještě klíč nemají. */
  pobocky?: { id: string; nazev: string }[]
}) {
  const [stav, odeslat, ceka] = useActionState<StavKliceRezervaci, FormData>(vydatKlicPrijmuRezervaci, null)

  return (
    <div className="ds-rez-formular">
      <form action={odeslat} className="ds-rez-tlacitka" style={{ alignItems: 'end' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        {id ? <input type="hidden" name="id" value={id} /> : null}
        {!id && pobocky && pobocky.length > 1 ? (
          <label className="ds-field" style={{ minWidth: '200px', flex: '1 1 200px' }}>
            <span className="ds-field-label">Pobočka</span>
            <select className="ds-input" name="pobocka" defaultValue={pobocky[0].id}>
              {pobocky.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nazev}
                </option>
              ))}
            </select>
          </label>
        ) : !id && pobocky?.[0] ? (
          <input type="hidden" name="pobocka" value={pobocky[0].id} />
        ) : null}
        <button type="submit" className={id ? 'ft-tl ft-tl-vedlejsi ft-tl-male' : 'ft-tl ft-tl-hlavni'} disabled={ceka}>
          {ceka ? 'Chystám klíč…' : id ? 'Vyměnit klíč' : 'Vytvořit klíč'}
        </button>
      </form>

      {stav?.stav === 'chyba' ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {stav.duvod}
        </p>
      ) : null}

      {stav?.stav === 'ok' ? (
        <div className="ds-rez-klic" role="status">
          <strong>Klíč si zkopírujte teď — appka ho už znovu neukáže.{id ? ' Starý klíč právě přestal platit.' : ''}</strong>
          <label className="ds-field">
            <span className="ds-field-label">Klíč (hlavička Authorization: Bearer …)</span>
            <input className="ds-input ds-rez-pismo-kodu" readOnly value={stav.klic} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <label className="ds-field">
            <span className="ds-field-label">Adresa (POST)</span>
            <input className="ds-input ds-rez-pismo-kodu" readOnly value={stav.adresa} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </div>
      ) : null}
    </div>
  )
}
