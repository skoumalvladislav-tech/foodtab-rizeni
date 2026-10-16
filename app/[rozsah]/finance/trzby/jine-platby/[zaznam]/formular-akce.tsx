'use client'

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'

import { zameritKdyzSeZtratil } from '@/components/ui/fokus-okna'

import { KLID, type StavAkce } from './logika'

/** Serverová akce detailu: `useActionState` se stavem `{ stav, text }`. */
export type AkceZaznamu = (predchozi: StavAkce, formData: FormData) => Promise<StavAkce>

/**
 * Jeden formulář akce nad záznamem Jiných plateb.
 *
 * Odesílá se přes `onSubmit` + `startTransition`, NE přes `<form action>`:
 * React by po akci formulář sám vyprázdnil — i když akce vrátila chybu,
 * a člověk by přišel o napsaný důvod. Po úspěchu se vyprázdní jen
 * s `vycistit`.
 *
 * Nese vždy `zaznam`, `verze` (optimistický zámek) a `rozsah` — firmu
 * ne (tu si akce bere z členství).
 *
 * `potvrzeni` = dvoukrokové odeslání pro to, co nejde vzít zpět (výdej
 * do POS, zrušení): první klik jen ukáže, CO se tím stane, fokus jde na
 * to varování (ne rovnou na „Ano“ — druhý Enter by potvrdil nečtené),
 * teprve druhé tlačítko odešle. Vzor
 * app/[rozsah]/dochazka/zalohy/potvrzeni-za-zamestnance.tsx.
 */
export default function FormularAkce({
  akce,
  zaznam,
  verze,
  rozsah,
  skryte,
  tlacitko,
  vzhled = 'vedlejsi',
  potvrzeni,
  vycistit = false,
  popisek,
  children,
}: {
  akce: AkceZaznamu
  zaznam: string
  verze: number
  rozsah: string
  /** Další skrytá pole (`druh`, `rezim`, `otisk`…). */
  skryte?: Record<string, string>
  tlacitko: string
  vzhled?: 'hlavni' | 'vedlejsi' | 'nebezpecne'
  potvrzeni?: { text: ReactNode; ano: string }
  vycistit?: boolean
  /** Přístupný název formuláře (aria-label), když nad ním není nadpis. */
  popisek?: string
  children?: ReactNode
}) {
  const [stav, odeslat, ceka] = useActionState<StavAkce, FormData>(akce, KLID)
  const [potvrzuje, setPotvrzuje] = useState(false)
  const formular = useRef<HTMLFormElement>(null)
  const varovani = useRef<HTMLParagraphElement>(null)
  const hlaska = useRef<HTMLParagraphElement>(null)
  const prvni = useRef<HTMLButtonElement>(null)
  const bylo = useRef(false)

  useEffect(() => {
    if (potvrzuje) varovani.current?.focus()
    else if (bylo.current) prvni.current?.focus()
    bylo.current = potvrzuje
  }, [potvrzuje])

  useEffect(() => {
    if (stav.stav === 'nic') return
    if (stav.stav === 'ok' && vycistit) formular.current?.reset()
    zameritKdyzSeZtratil(hlaska.current)
  }, [stav, vycistit])

  function poOdeslani(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (ceka) return
    if (potvrzeni && !potvrzuje) {
      setPotvrzuje(true)
      return
    }
    const data = new FormData(e.currentTarget)
    setPotvrzuje(false)
    startTransition(() => odeslat(data))
  }

  const trida = `ft-tl ${vzhled === 'hlavni' ? 'ft-tl-hlavni' : vzhled === 'nebezpecne' ? 'ft-tl-nebezpecne' : 'ft-tl-vedlejsi'}`

  return (
    <form ref={formular} onSubmit={poOdeslani} aria-label={popisek} style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
      <input type="hidden" name="zaznam" value={zaznam} />
      <input type="hidden" name="verze" value={String(verze)} />
      <input type="hidden" name="rozsah" value={rozsah} />
      {Object.entries(skryte ?? {}).map(([n, v]) => (
        <input key={n} type="hidden" name={n} value={v} />
      ))}

      {children}

      {potvrzeni && potvrzuje ? (
        <div style={{ display: 'grid', gap: '8px' }}>
          <p
            ref={varovani}
            tabIndex={-1}
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid var(--pozor)',
              background: 'var(--pozor-bg)',
              color: 'var(--ink)',
              fontSize: '14px',
              lineHeight: 1.45,
            }}
          >
            {potvrzeni.text}
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="submit" className={trida} disabled={ceka}>
              {ceka ? 'Pracuji…' : potvrzeni.ano}
            </button>
            <button type="button" className="ft-tl ft-tl-vedlejsi" onClick={() => setPotvrzuje(false)} disabled={ceka}>
              Zpět
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button ref={prvni} type="submit" className={trida} disabled={ceka} style={{ maxWidth: '100%', whiteSpace: 'normal' }}>
            {ceka ? 'Pracuji…' : tlacitko}
          </button>
        </div>
      )}

      {stav.stav === 'chyba' ? (
        <p ref={hlaska} tabIndex={-1} role="alert" className="hlaska-chyba" style={{ margin: 0 }}>
          {stav.text}
        </p>
      ) : stav.stav === 'ok' ? (
        <p ref={hlaska} tabIndex={-1} role="status" style={{ margin: 0, fontSize: '14px', color: 'var(--dobre)' }}>
          {stav.text}
        </p>
      ) : null}
    </form>
  )
}
