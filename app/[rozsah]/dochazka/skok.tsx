'use client'

import { useEffect, useRef } from 'react'

/**
 * Skok na předvyplněný formulář.
 *
 * Odkaz „Doplnit odchod" mířil na `#rucni` a spoléhal na to, že
 * prohlížeč na kotvu doroluje sám. Šéfík hlásí, že v ostré aplikaci
 * klik nedělal nic — v dev prostředí se to reprodukovat nepodařilo,
 * takže tady nespoléháme na kotvu vůbec: formulář si po předvyplnění
 * doroluje sám.
 *
 * Rozdíl je v tom, že tohle nezáleží na tom, jestli prohlížeč
 * navigaci vyhodnotí jako „nová stránka" nebo „skok v téže" — komponenta
 * se prostě připojí a doroluje.
 */
export default function SkokNaFormular() {
  const kam = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const prvek = kam.current?.closest('section') ?? kam.current
    prvek?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return <span ref={kam} aria-hidden="true" />
}
