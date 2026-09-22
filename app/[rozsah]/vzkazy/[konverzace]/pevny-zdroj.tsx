'use client'

import { useState } from 'react'

/**
 * Média s PEVNÝM zdrojem.
 *
 * Soubory z úložiště se otevírají přes podepsaný odkaz, který stránka vydává
 * znovu při každém vykreslení — a živá aktualizace (router.refresh po každém
 * upozornění) stránku vykresluje často. Nový odkaz by se propsal do `src`,
 * prohlížeč by zdroj načetl znovu a přehrávaná hlasovka by se přerušila
 * (fotky by se stahovaly dokola). Tady se proto drží ODKAZ Z PRVNÍHO
 * VYKRESLENÍ; teprve když přestane platit (podepsaný odkaz platí hodinu a
 * načtení selže), přejde se na ten nejnovější.
 */

export function PevnaHlasovka({ src }: { src: string }) {
  const [pouzity, setPouzity] = useState(src)
  return (
    <audio
      controls
      preload="none"
      src={pouzity}
      onError={() => {
        if (pouzity !== src) setPouzity(src)
      }}
    />
  )
}

export function PevnyObrazek({ src, alt }: { src: string; alt: string }) {
  const [pouzity, setPouzity] = useState(src)
  return (
    // eslint-disable-next-line @next/next/no-img-element -- podepsaný odkaz na soukromý kbelík, next/image by ho zbytečně proháněl přes optimalizátor
    <img
      src={pouzity}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (pouzity !== src) setPouzity(src)
      }}
    />
  )
}
