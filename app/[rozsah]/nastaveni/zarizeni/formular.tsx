'use client'

import { useActionState } from 'react'

import { vystavitKod, type StavKodu } from './akce'

/**
 * Vystavení registračního kódu.
 *
 * Klientský kvůli tomu, aby se kód dal ukázat, aniž by se dostal do
 * adresy. Adresa se pamatuje v historii prohlížeče, v protokolu serveru
 * i v odkazovači — a tenhle kód je po tu chvíli klíč k tomu, aby si
 * někdo zaregistroval zařízení pobočky.
 */
export default function FormularKodu({
  rozsah,
  pobocky,
}: {
  rozsah: string
  pobocky: { id: string; nazev: string }[]
}) {
  const [stav, akce, ceka] = useActionState<StavKodu, FormData>(vystavitKod, {
    stav: 'nic',
  })

  return (
    <section style={karta}>
      <h2 style={nadpis}>Zaregistrovat tablet</h2>
      <p style={popis}>
        Vystaví kód, který se na tabletu jednou zadá na adrese{' '}
        <code>/kiosek</code>. Platí patnáct minut a jde použít jednou.
        Tablet si při tom uloží klíč — ten se pak už nikde nezobrazí ani
        nedá přečíst.
      </p>

      <form action={akce} style={mrizka}>
        <input type="hidden" name="rozsah" value={rozsah} />

        <label style={poleLabel}>
          <span>Pobočka</span>
          <select name="pobocka" required style={pole}>
            {pobocky.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nazev}
              </option>
            ))}
          </select>
        </label>

        <label style={poleLabel}>
          <span>Název zařízení</span>
          <input
            name="nazev"
            required
            maxLength={60}
            placeholder="tablet u baru"
            style={pole}
          />
        </label>

        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
            {ceka ? 'Vystavuji…' : 'Vystavit kód'}
          </button>
        </div>
      </form>

      {stav.stav === 'chyba' ? <p className="hlaska-chyba">{stav.text}</p> : null}

      {stav.stav === 'kod' ? (
        <div style={ramecek}>
          <p style={{ margin: '0 0 4px', fontSize: '13px' }}>
            Kód pro <strong>{stav.nazev}</strong> — opište ho na tabletu:
          </p>
          <p style={kodStyl}>{stav.kod}</p>
          <p style={{ margin: '8px 0 0', fontSize: '12.5px' }}>
            Ukáže se jenom teď. Když ho ztratíte, vystavte nový — přečíst
            se nedá ani z databáze.
          </p>
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
} as const

const nadpis = { margin: '0 0 8px', fontSize: '17px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13px',
  color: 'var(--muted)',
  maxWidth: '66ch',
} as const

const mrizka = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '12px',
  alignItems: 'end',
  maxWidth: '620px',
} as const

const poleLabel = {
  display: 'grid',
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
  marginTop: '16px',
  padding: '14px 16px',
  border: '1px solid var(--mosaz)',
  borderRadius: '12px',
  background: 'var(--paper)',
  color: 'var(--ink)',
} as const

const kodStyl = {
  margin: 0,
  fontSize: '34px',
  letterSpacing: '.18em',
  fontVariantNumeric: 'tabular-nums' as const,
} as const
