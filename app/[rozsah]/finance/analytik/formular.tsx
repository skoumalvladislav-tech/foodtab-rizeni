'use client'

import { useActionState } from 'react'

import { zeptatSeAnalytika, type StavAnalytika } from './akce'

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '8px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '80px',
  resize: 'vertical' as const,
}

/**
 * Formulář analytika — otázka → vysvětlení. Žádná historie konverzace
 * (appka si nic nepamatuje mezi otázkami) — každé zeptání je jeden
 * samostatný, auditovatelný požadavek s čerstvými podklady.
 */
export default function AnalytikFormular({ rozsah }: { rozsah: string }) {
  const [stav, odeslat, cekaSe] = useActionState<StavAnalytika, FormData>(zeptatSeAnalytika, { stav: 'nic' })

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <form action={odeslat} style={{ ...karta, display: 'grid', gap: '12px' }}>
        <input type="hidden" name="rozsah" value={rozsah} />
        <label>
          <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
            Na co se chcete zeptat? (čísla za aktuální měsíc appka dodá sama)
          </span>
          <textarea name="otazka" required placeholder="např. Proč je u Černé Perly nižší příspěvek na úhradu než minulý měsíc?" style={pole} />
        </label>
        <div>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={cekaSe}>
            {cekaSe ? 'Analytik přemýšlí…' : 'Zeptat se analytika'}
          </button>
        </div>
      </form>

      {stav.stav === 'chyba' ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{stav.text}</p>
      ) : null}

      {stav.stav === 'hotovo' ? (
        <div style={{ ...karta, display: 'grid', gap: '12px' }}>
          {stav.vysledek.jeUkazka ? (
            <p style={{ margin: 0, fontSize: '12px', padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--pozor-bg)', color: 'var(--pozor)', display: 'inline-block' }}>
              UKÁZKA — nenapsal model (chybí klíč k AI)
            </p>
          ) : null}

          <p style={{ margin: 0, fontSize: '14.5px', fontWeight: 600 }}>{stav.vysledek.vysvetleni.shrnuti}</p>

          {stav.vysledek.vysvetleni.body.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px', fontSize: '13.5px' }}>
              {stav.vysledek.vysvetleni.body.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : null}

          {stav.vysledek.vysvetleni.stojiZaPozornost.length > 0 ? (
            <div style={{ display: 'grid', gap: '4px' }}>
              <strong style={{ fontSize: '13px' }}>Stojí za pozornost</strong>
              <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px', fontSize: '13.5px', color: 'var(--pozor)' }}>
                {stav.vysledek.vysvetleni.stojiZaPozornost.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          ) : null}

          {stav.vysledek.vysvetleni.chybi.length > 0 ? (
            <div style={{ display: 'grid', gap: '4px' }}>
              <strong style={{ fontSize: '13px', color: 'var(--muted)' }}>Co appka neví / nedomýšlí</strong>
              <ul style={{ margin: 0, paddingLeft: '20px', display: 'grid', gap: '4px', fontSize: '13px', color: 'var(--muted)' }}>
                {stav.vysledek.vysvetleni.chybi.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          ) : null}

          <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
            Čísla počítá appka (nikdy model) — tohle je jen slovní vysvětlení toho, co appka už spočítala.
          </p>
        </div>
      ) : null}
    </div>
  )
}
