'use client'

import { useEffect } from 'react'

import Ikona from '../../ikona'

/**
 * „Vytisknout“ na tiskové stránce — otevře okno tisku prohlížeče.
 *
 * `hned`: přišlo se tlačítkem z kalendáře nebo z Rozpisu (`?hned=1`),
 * takže okno tisku se otevře samo, jednou. Parametr se pak z adresy
 * odebere, ať se po obnovení stránky nebo po změně voleb neotevírá znovu.
 */
export function TlacitkoTisku({ hned }: { hned: boolean }) {
  // Bez „už jsem tiskl“ v useRef: React ve vývoji pouští efekt dvakrát
  // (s úklidem mezi tím) a zámek by úklidem zrušený tisk už nepustil.
  // Jednou to zajistí úklid časovače a závislost jen na `hned`.
  useEffect(() => {
    if (!hned) return
    const adresa = new URL(window.location.href)
    adresa.searchParams.delete('hned')
    window.history.replaceState(window.history.state, '', adresa.pathname + adresa.search)
    // Až po vykreslení listu — jinak by náhled tisku mohl zachytit stránku bez písma.
    const casovac = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(casovac)
  }, [hned])

  return (
    <button type="button" className="ft-tl ft-tl-male ft-tl-hlavni" onClick={() => window.print()}>
      <Ikona klic="tisk" velikost={15} /> Vytisknout
    </button>
  )
}
