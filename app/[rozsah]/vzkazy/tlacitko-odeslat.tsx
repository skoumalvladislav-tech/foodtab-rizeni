'use client'

import type { ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Odesílací tlačítko, které se po kliknutí zamkne, dokud akce běží.
 *
 * Bez toho dvojklik (nebo netrpělivé druhé klepnutí na telefonu) odešle formulář
 * dvakrát a vznikne druhý rozhovor nebo druhý úkol — databáze duplicitu u těchhle
 * akcí záměrně nezakazuje (dva úkoly z jedné zprávy jsou legitimní). Musí být
 * uvnitř `<form action={…}>`; `useFormStatus` čte stav toho formuláře.
 */
export default function TlacitkoOdeslat({
  children,
  className,
  disabled = false,
  pracuje = 'Odesílá se…',
}: {
  children: ReactNode
  className?: string
  disabled?: boolean
  /** Text tlačítka, dokud akce běží. */
  pracuje?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={disabled || pending} aria-busy={pending}>
      {pending ? pracuje : children}
    </button>
  )
}
