import type { ReactNode } from 'react'

import JenProFirmu, { jeRozsahFirmy } from '../jen-pro-firmu'

/**
 * AI analytik — jen za celou firmu (Finance po pobočkách, 13. 10. 2026).
 *
 * Podklady pro analytika (akce.ts) jsou výsledovka celé firmy, rozpočet
 * bez pobočky a cashflow celé firmy. Na pobočce by odpovídal čísly celé
 * firmy pod hlavičkou pobočky — dokud podklady po pobočkách neumí,
 * stojí tu věta a odkaz na celou firmu.
 *
 * Tenhle layout hlídá jen KRESLENÍ. Next vyrenderuje stránku souběžně
 * s layoutem i tehdy, když layout `children` nepoužije — proto si
 * pobočku odmítá i page.tsx prvním řádkem a akce `zeptatSeAnalytika`
 * chce finance.read za celou firmu.
 */
export default async function AnalytikLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params
  if (jeRozsahFirmy(rozsah)) return <>{children}</>

  return (
    <JenProFirmu rozsah={rozsah} nazev="AI analytik" segment="finance/analytik">
      AI analytik zatím pracuje jen s čísly celé firmy (výsledovka, rozpočet a cashflow za celou firmu),
      ne s čísly jedné pobočky. Zeptat se ho jde v pohledu Celá firma.
    </JenProFirmu>
  )
}
