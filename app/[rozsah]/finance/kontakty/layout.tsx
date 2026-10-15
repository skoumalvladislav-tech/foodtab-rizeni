import type { ReactNode } from 'react'

import JenProFirmu, { jeRozsahFirmy } from '../jen-pro-firmu'

/**
 * Kontakty — jen za celou firmu (Finance po pobočkách, 13. 10. 2026).
 *
 * Tabulka `kontakty` pobočku nemá: dodavatel nebo odběratel je společný
 * celé firmě (stejně jako suroviny a receptury). Na pobočce by tu byl
 * seznam celé firmy pod hlavičkou pobočky — místo něj věta a odkaz na
 * celou firmu.
 *
 * Tenhle layout hlídá jen KRESLENÍ. Next vyrenderuje stránku souběžně
 * s layoutem i tehdy, když layout `children` nepoužije (výsledek jde
 * klientovi v datech stránky) — proto si pobočku odmítá i page.tsx
 * prvním řádkem a serverové akce (akce.ts) chtějí právo za celou firmu.
 */
export default async function KontaktyLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params
  if (jeRozsahFirmy(rozsah)) return <>{children}</>

  return (
    <JenProFirmu rozsah={rozsah} nazev="Kontakty" segment="finance/kontakty">
      Dodavatelé a odběratelé jsou společní pro celou firmu — žádný kontakt nepatří jedné pobočce.
      Seznam a jeho úpravy najdete v pohledu Celá firma.
    </JenProFirmu>
  )
}
