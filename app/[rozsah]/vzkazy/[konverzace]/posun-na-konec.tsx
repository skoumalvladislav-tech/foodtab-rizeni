'use client'

import { useEffect } from 'react'

/**
 * Po otevření rozhovoru se stránka posune tam, kde člověk skončil:
 * k dělítku „Nové zprávy“, a když žádné není, na konec vlákna.
 *
 * Bez toho by byl rozhovor otevřený nahoře u nejstarší zprávy a člověk
 * by u dlouhého vlákna ručně hledal, co je nové — přesně to, co se na
 * telefonu nechce.
 */
export default function PosunNaKonec() {
  useEffect(() => {
    const cil = document.getElementById('nove') ?? document.getElementById('konec')
    // `block: 'start'` u dělítka (nové čtu odshora), `end` u konce vlákna.
    cil?.scrollIntoView({ block: cil.id === 'nove' ? 'start' : 'end' })
  }, [])
  return null
}
