'use client'

import { useActionState, useState } from 'react'

import Ikona from '../../ikona'
import { zrusitPozvanku, type StavZruseni } from './pozvanky-akce'

/**
 * Čekající pozvánky firmy — a jak je zrušit.
 *
 * Od 20260925150000 do tabulky pozvánek z aplikace nikdo nezapisuje,
 * takže ani nezruší (dřív to šlo jen přímo přes API, tlačítko nebylo
 * nikde). Pozvánka k PŘESUNU účtu je přitom ta nejcitlivější: kdo drží
 * adresu, dostane záznam v Lidech i s právy a starý účet se odpojí.
 * Překlep v adrese by platil sedm dní a nešlo by ho stáhnout
 * (nezávislá kontrola 28. 9. 2026). V ostré databázi 25. 9. čekalo
 * osm pozvánek, dvě na jinou adresu, než má účet.
 *
 * Adresa se ukazuje celá: je to adresa, na kterou pozvánku vystavil
 * někdo z téže firmy, a právě kvůli překlepu ji má kdo zve vidět.
 * Čtou ji jen správci lidí za celou firmu (politika `invitations_manage`).
 *
 * Přesun zruší jen majitel — ostatním se místo tlačítka řekne proč.
 * Rozhoduje databáze (`public.zrusit_pozvanku`), tohle je vysvětlení.
 */

export type CekajiciPozvankaFirmy = {
  id: string
  /** Komu v Lidech — `null`, když ji někdo vystavil bez člověka (API). */
  jmeno: string | null
  kontakt: string
  /** Pozvánka přesouvá účet na novou adresu (`nahrazuje_ucet`). */
  presun: boolean
  expires_at: string
}

const datum = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'numeric',
  timeZone: 'Europe/Prague',
})

export default function CekajiciPozvanky({
  pozvanky,
  jsemMajitel,
}: {
  pozvanky: CekajiciPozvankaFirmy[]
  jsemMajitel: boolean
}) {
  if (pozvanky.length === 0) return null

  return (
    <section id="pozvanky" className="ds-plocha" style={{ marginTop: '32px', scrollMarginTop: '80px' }}>
      <div className="ds-plocha-hlava">
        <Ikona klic="zprava" />
        <h2>Čekající pozvánky</h2>
      </div>
      <p style={uvod}>
        Vystavené, zatím nepřijaté. Když je adresa špatně, pozvánku zrušte
        a vystavte novou — odkaz ze zrušené přestane platit.
      </p>
      <ul style={seznam}>
        {pozvanky.map((p) => (
          <li key={p.id} style={radek} data-pozvanka={p.id}>
            <div style={{ display: 'grid', gap: '2px', minWidth: 0, flex: '1 1 220px' }}>
              <span style={{ fontSize: '15px', color: 'var(--ink)', overflowWrap: 'anywhere' }}>
                {p.jmeno ?? 'Bez člověka z Lidí'}
              </span>
              <span style={maly}>
                {p.kontakt} · platí do {datum.format(new Date(p.expires_at))}
              </span>
              {p.presun ? (
                <span style={{ fontSize: '13px', color: 'var(--pozor)' }}>
                  Přesun účtu — po přijetí se přístup přestěhuje na tuhle adresu.
                </span>
              ) : null}
            </div>
            <div style={{ minWidth: 0, maxWidth: '100%' }}>
              {p.presun && !jsemMajitel ? (
                <span style={maly}>Přesun zruší jen majitel.</span>
              ) : (
                <ZrusitPozvanku id={p.id} kontakt={p.kontakt} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Zrušit pozvánku. Dva kroky jako „Odebrat z firmy" v okně čekajících:
 * odesílací tlačítko existuje AŽ při otázce, takže ho nejde spustit
 * jedním ťuknutím ani před načtením skriptů.
 *
 * `ptaSeNaZacatku` je pro kontrolu (scripts/ceka-na-opravneni.test.mjs),
 * která bez prohlížeče neumí ťuknout.
 */
export function ZrusitPozvanku({
  id,
  kontakt,
  ptaSeNaZacatku = false,
}: {
  id: string
  kontakt: string
  ptaSeNaZacatku?: boolean
}) {
  const [ptameSe, setPtameSe] = useState(ptaSeNaZacatku)
  const [stav, odeslat, ceka] = useActionState<StavZruseni, FormData>(zrusitPozvanku, { stav: 'nic' })

  if (stav.stav === 'hotovo') {
    return <span style={{ fontSize: '13px', color: 'var(--dobre)' }}>Pozvánka je zrušená.</span>
  }

  if (!ptameSe) {
    return (
      <div style={{ display: 'grid', gap: '6px', justifyItems: 'start' }}>
        <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => setPtameSe(true)}>
          Zrušit
        </button>
        {stav.stav === 'chyba' ? (
          <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
            {stav.text}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form action={odeslat} style={{ display: 'grid', gap: '6px', justifyItems: 'start', minWidth: 0 }}>
      <input type="hidden" name="pozvanka" value={id} />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="submit" disabled={ceka} className="ft-tl ft-tl-nebezpecne">
          {ceka ? 'Ruším…' : 'Opravdu zrušit'}
        </button>
        {!ceka ? (
          <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => setPtameSe(false)}>
            Zpět
          </button>
        ) : null}
      </div>
      <p aria-live="polite" style={{ ...maly, margin: 0, maxWidth: '38ch' }}>
        Odkaz v pozvánce na {kontakt} přestane platit. Kdyby byla potřeba,
        vystavte novou.
      </p>
      {stav.stav === 'chyba' ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {stav.text}
        </p>
      ) : null}
    </form>
  )
}

const uvod = {
  margin: '0 0 6px',
  fontSize: '13.5px',
  color: 'var(--muted)',
  lineHeight: 1.5,
  maxWidth: '62ch',
} as const

const seznam = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '8px',
} as const

const radek = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap' as const,
  padding: '10px 0',
  borderTop: '1px solid var(--line)',
}

const maly = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  lineHeight: 1.45,
  overflowWrap: 'anywhere' as const,
} as const
