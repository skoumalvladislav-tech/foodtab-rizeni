'use client'

import { useMemo, useState } from 'react'

import Ikona from '@/app/[rozsah]/ikona'
import TlacitkoOdeslat from '../tlacitko-odeslat'
import {
  hledatPrijemce,
  seskupitPrijemce,
  souhrnVyberu,
  type Prijemce,
} from '@/lib/komunikace/prijemci'

/**
 * Výběr příjemců nové zprávy.
 *
 * Hledá se v seznamu, který dodala databáze (`komu_muzu_psat`) — lidé s
 * účtem z téže firmy, kolegové z mé pobočky nahoře. Klientská komponenta
 * jen třídí a hledá; komu smí kdo psát, drží databáze.
 *
 * Vybraní se odesílají jako opakované pole `ucastnik`. Zaškrtávátka samotná
 * jméno nemají — do formuláře by jinak šla dvakrát.
 *
 * Bez JavaScriptu formulář nefunguje (nedá se v něm vybírat); volba příjemců
 * je vědomě jediná obrazovka, která ho potřebuje.
 */
export default function VyberPrijemcu({
  lide,
  pobocky,
  akce,
  rozsah,
  chyba,
}: {
  lide: Prijemce[]
  /** [id, název] — Map se přes hranici server → klient nepřenáší. */
  pobocky: [string, string][]
  akce: (formData: FormData) => void | Promise<void>
  rozsah: string
  chyba?: string | null
}) {
  const [dotaz, setDotaz] = useState('')
  const [vybrani, setVybrani] = useState<string[]>([])
  const [nazev, setNazev] = useState('')

  const nazvyPobocek = useMemo(() => new Map(pobocky), [pobocky])
  const nalezeni = useMemo(() => hledatPrijemce(lide, dotaz), [lide, dotaz])
  const skupiny = useMemo(() => seskupitPrijemce(nalezeni, nazvyPobocek), [nalezeni, nazvyPobocek])
  const vybraniLide = useMemo(
    () => vybrani.map((id) => lide.find((p) => p.employee_id === id)).filter((p): p is Prijemce => Boolean(p)),
    [vybrani, lide],
  )

  function prepni(id: string) {
    setVybrani((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))
  }

  return (
    <form action={akce} className="pc-vyber">
      <input type="hidden" name="rozsah" value={rozsah} />
      {vybrani.map((id) => (
        <input key={id} type="hidden" name="ucastnik" value={id} />
      ))}

      {chyba ? (
        <p className="hlaska-chyba" role="alert" style={{ margin: 0 }}>
          {chyba}
        </p>
      ) : null}

      <input
        type="search"
        className="pc-vyber-hledani"
        value={dotaz}
        onChange={(e) => setDotaz(e.target.value)}
        placeholder="Hledat jméno…"
        aria-label="Hledat kolegu"
        autoComplete="off"
      />

      <div className="pc-vyber-vybrani" aria-live="polite">
        {vybraniLide.length === 0 ? (
          <span className="pc-prazdno">Nikdo není vybraný. Zaškrtněte jednoho nebo víc lidí.</span>
        ) : (
          vybraniLide.map((p) => (
            <button
              key={p.employee_id}
              type="button"
              onClick={() => prepni(p.employee_id)}
              aria-label={`Odebrat ${p.jmeno}`}
            >
              {p.jmeno}
              <Ikona klic="zavrit" />
            </button>
          ))
        )}
      </div>

      {lide.length === 0 ? (
        <p className="pc-prazdno">
          Nikdo, komu by šlo napsat, tu zatím není. Kolega musí mít ve Foodtabu účet.
        </p>
      ) : skupiny.length === 0 ? (
        <p className="pc-prazdno">Nikdo takový se nenašel.</p>
      ) : (
        skupiny.map((s) => (
          <section key={s.klic} className="pc-vyber-skupina">
            <h3>{s.nazev}</h3>
            {s.lide.map((p) => {
              const je = vybrani.includes(p.employee_id)
              return (
                <label key={p.employee_id} className="pc-vyber-radek" data-vybran={je ? '1' : undefined}>
                  <input type="checkbox" checked={je} onChange={() => prepni(p.employee_id)} />
                  <span className="pc-avatar" aria-hidden="true">
                    {p.jmeno.trim().charAt(0).toUpperCase()}
                  </span>
                  <span>
                    {p.jmeno}
                    {p.branch_id ? <small>{nazvyPobocek.get(p.branch_id) ?? ''}</small> : null}
                  </span>
                </label>
              )
            })}
          </section>
        ))
      )}

      <div>
        <label htmlFor="pc-nazev" style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
          Název rozhovoru (nepovinné)
        </label>
        <input
          id="pc-nazev"
          type="text"
          name="nazev"
          className="pc-vyber-hledani"
          maxLength={120}
          value={nazev}
          onChange={(e) => setNazev(e.target.value)}
          placeholder={vybraniLide.length > 0 ? souhrnVyberu(vybraniLide) : 'Když nic nezadáte, použijí se jména'}
        />
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <TlacitkoOdeslat className="ft-tl ft-tl-hlavni" disabled={vybrani.length === 0} pracuje="Zakládám…">
          {vybrani.length === 0 ? 'Založit rozhovor' : `Založit rozhovor (${vybrani.length})`}
        </TlacitkoOdeslat>
      </div>
    </form>
  )
}
