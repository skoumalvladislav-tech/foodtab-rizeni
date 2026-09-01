'use client'

import { useActionState } from 'react'

import { vyplatitZalohu, type StavVyplaceni } from './akce'

/**
 * Vyplacení zálohy.
 *
 * Klientský kvůli varování: „odpracováno zatím 8 400 Kč, vyplácíte
 * 10 000 Kč“ se musí ukázat PO zápisu, u toho řádku, ne jako parametr
 * v adrese. Rozhodnutí ze 1. 9. (oddíl 11 bod 3): aplikace vyšší zálohu
 * nikdy neodmítne, jen ji ohlásí — o penězích rozhoduje majitel.
 */
export default function FormularZalohy({
  rozsah,
  lide,
}: {
  rozsah: string
  lide: { id: string; jmeno: string }[]
}) {
  const [stav, akce, ceka] = useActionState<StavVyplaceni, FormData>(vyplatitZalohu, {
    stav: 'nic',
  })

  return (
    <section style={karta}>
      <h2 style={nadpis}>Vyplatit zálohu</h2>
      <p style={popis}>
        Záznam o hotovosti, která přešla z ruky do ruky. Aplikace nikomu
        nic neposílá. Zaměstnanec zálohu potvrdí PINem na tabletu — tím
        se z ní stane doklad, ne tvrzení jednoho člověka.
      </p>

      <form action={akce} style={mrizka}>
        <input type="hidden" name="rozsah" value={rozsah} />

        <label style={poleLabel}>
          <span>Komu</span>
          <select name="zamestnanec" required style={pole}>
            <option value="">— Vyberte —</option>
            {lide.map((l) => (
              <option key={l.id} value={l.id}>
                {l.jmeno}
              </option>
            ))}
          </select>
        </label>

        <label style={poleLabel}>
          <span>Částka v Kč</span>
          <input
            name="castka"
            required
            inputMode="decimal"
            placeholder="2000"
            style={pole}
          />
        </label>

        <label style={{ ...poleLabel, gridColumn: '1 / -1' }}>
          <span>Poznámka (nepovinná)</span>
          <input
            name="poznamka"
            maxLength={200}
            placeholder="hotově u baru"
            style={pole}
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
            {ceka ? 'Zapisuji…' : 'Vyplatit'}
          </button>
        </div>
      </form>

      {stav.stav === 'chyba' ? <p className="hlaska-chyba">{stav.text}</p> : null}

      {stav.stav === 'hotovo' ? (
        <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
            Zapsáno: <strong>{stav.castka} Kč</strong> pro {stav.komu}. Čeká
            na potvrzení PINem na tabletu.
          </p>

          {/*
            Varování, ne odmítnutí. Záloha už je zapsaná — tohle je
            informace pro obsluhu, ne otázka.
          */}
          {stav.varovani ? (
            <p style={ramecek}>
              <strong>Pozor:</strong> {stav.varovani} Vyplaceno to je;
              tohle je jen upozornění.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '18px',
  marginBottom: '16px',
  maxWidth: '640px',
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '62ch',
  lineHeight: 1.5,
} as const

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '12px',
  alignItems: 'end',
} as const

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const ramecek = {
  margin: 0,
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const
