'use client'

import { useEffect } from 'react'

/**
 * Odešle formulář pro Dotykačku hned po načtení. Podpis v něm platí
 * jen ±1 minutu (Connector v2), takže čekat na kliknutí by riskovalo
 * „vypršelý podpis". Bez JavaScriptu zůstává tlačítko.
 *
 * Před odesláním přepíše svůj záznam v historii na stránku Pokladní
 * systémy (`zpet`): tlačítko Zpět z přihlášení do Dotykačky pak vede
 * tam, ne znovu sem — jinak by se formulář odeslal hned zase a člověk
 * by z Dotykačky nemohl odejít. Kdyby prohlížeč stránku obnovil z mezipaměti
 * (bez nového podpisu), přesměruje ji tamtéž.
 */
export default function OdeslatHned({ formular, zpet }: { formular: string; zpet: string }) {
  useEffect(() => {
    const zMezipameti = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.replace(zpet)
    }
    window.addEventListener('pageshow', zMezipameti)
    const f = document.getElementById(formular)
    if (f instanceof HTMLFormElement) {
      window.history.replaceState(null, '', zpet)
      f.submit()
    }
    return () => window.removeEventListener('pageshow', zMezipameti)
  }, [formular, zpet])
  return null
}
