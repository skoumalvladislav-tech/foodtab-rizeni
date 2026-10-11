'use client'

import { useEffect } from 'react'

/**
 * Odešle formulář pro Dotykačku hned po načtení. Podpis v něm platí
 * jen ±1 minutu (Connector v2), takže čekat na kliknutí by riskovalo
 * „vypršelý podpis". Bez JavaScriptu zůstává tlačítko.
 */
export default function OdeslatHned({ formular }: { formular: string }) {
  useEffect(() => {
    const f = document.getElementById(formular)
    if (f instanceof HTMLFormElement) f.submit()
  }, [formular])
  return null
}
