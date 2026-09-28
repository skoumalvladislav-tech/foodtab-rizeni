'use client'

import { useEffect } from 'react'

import { oznacitPrectenoPoZobrazeni } from '../akce'

/**
 * Označí rozhovor za přečtený, až je vlákno OPRAVDU na obrazovce.
 *
 * Proč v prohlížeči, a ne při vykreslení na serveru: odkaz v seznamu
 * rozhovorů si stránku umí načíst dopředu (prefetch), a kdyby zápis
 * dělal server při vykreslení, rozhovor by se označil jako přečtený,
 * aniž by ho kdo otevřel. Efekt se spustí až po zobrazení — a když je
 * karta prohlížeče zrovna na pozadí, počká, až se na ni člověk vrátí.
 *
 * `klic` se mění s nejnovější zprávou od ostatních. Když během čtení
 * přijde další (živá aktualizace stránku překreslí), označí se znovu.
 * Když nepřečtené není nic, nezapisuje se nic.
 *
 * Nic nekreslí. Dělítko „Nové zprávy“ drží vlákno z prvního vykreslení
 * (`vlakno-zprav.tsx`), takže po zápisu nezmizí zpod rukou.
 */
export default function OznacitPoZobrazeni({
  rozsah,
  konverzace,
  neprectenych,
  klic,
}: {
  rozsah: string
  konverzace: string
  /** Kolik nepřečtených zpráv mám v rozhovoru podle `moje_rozhovory`. */
  neprectenych: number
  /** Čas nejnovější zprávy od ostatních — nová zpráva = nové označení. */
  klic: string
}) {
  useEffect(() => {
    if (neprectenych <= 0) return

    let hotovo = false
    const oznacit = () => {
      if (hotovo || document.visibilityState !== 'visible') return
      hotovo = true
      // Výsledek se neukazuje: když zápis selže, zůstane rozhovor
      // nepřečtený a zkusí se to při dalším otevření.
      void oznacitPrectenoPoZobrazeni({ rozsah, konverzace }).catch(() => {})
    }

    oznacit()
    document.addEventListener('visibilitychange', oznacit)
    return () => document.removeEventListener('visibilitychange', oznacit)
  }, [rozsah, konverzace, neprectenych, klic])

  return null
}
