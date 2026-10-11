'use client'

import { useActionState, type CSSProperties } from 'react'

import { vydatKlicPrijmu, type StavKlicePrijmu } from './akce'

/**
 * Vydání / výměna klíče pro příjmové API. Klíč appka ukáže jen tady,
 * jen jednou — po obnovení stránky už ho nikdo neuvidí (v databázi je
 * jen zašifrovaný). Proto `useActionState`, ne přesměrování s klíčem
 * v adrese.
 */
export default function KlicPrijmu({
  rozsah,
  id,
  pobocky,
  pole,
}: {
  rozsah: string
  /** Vyplněné = výměna klíče u existujícího připojení. */
  id?: string
  pobocky?: { id: string; name: string }[]
  pole: CSSProperties
}) {
  const [stav, odeslat, ceka] = useActionState<StavKlicePrijmu, FormData>(vydatKlicPrijmu, null)

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      <form action={odeslat} style={{ display: 'flex', gap: '10px', alignItems: 'end', flexWrap: 'wrap' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        {id ? <input type="hidden" name="id" value={id} /> : null}
        {!id && pobocky ? (
          <label style={{ minWidth: '200px', flex: '1 1 200px' }}>
            <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>Pobočka *</span>
            <select name="branch_id" required style={pole}>
              {pobocky.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ) : null}
        <button type="submit" className={id ? 'ft-tl' : 'ft-tl ft-tl-hlavni'} disabled={ceka}>
          {ceka ? 'Chystám klíč…' : id ? 'Vyměnit klíč' : 'Vytvořit klíč'}
        </button>
      </form>

      {stav?.stav === 'chyba' ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{stav.duvod}</p> : null}

      {stav?.stav === 'ok' ? (
        <div style={{ display: 'grid', gap: '8px', padding: '12px', borderRadius: 'var(--radius-md)', background: 'var(--pozor-bg)' }}>
          <strong style={{ fontSize: '13.5px' }}>Klíč si zkopírujte teď — appka ho už znovu neukáže.{id ? ' Starý klíč právě přestal platit.' : ''}</strong>
          <label>
            <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--muted)', marginBottom: '4px' }}>Klíč (hlavička Authorization: Bearer …)</span>
            <input readOnly value={stav.klic} onFocus={(e) => e.currentTarget.select()} style={{ ...pole, fontFamily: 'ui-monospace, monospace', fontSize: '12.5px' }} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--muted)', marginBottom: '4px' }}>Adresa (POST)</span>
            <input readOnly value={stav.adresa} onFocus={(e) => e.currentTarget.select()} style={{ ...pole, fontFamily: 'ui-monospace, monospace', fontSize: '12.5px' }} />
          </label>
        </div>
      ) : null}
    </div>
  )
}
