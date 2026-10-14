import type { ReactNode } from 'react'

import JenProFirmu, { jeRozsahFirmy } from '../jen-pro-firmu'

/**
 * Integrace — jen za celou firmu (Finance po pobočkách, 13. 10. 2026).
 *
 * Platí pro celý strom pod /finance/integrace: přehled, banku, e-mail
 * dokladů, pokladny (i přihlášení přes Dotykačku) a import prodejů.
 * Napojení banky, pokladny i schránky se zakládá za celou firmu
 * (připojení bez pobočky, společný bankovní účet) a na pobočce není
 * co filtrovat — místo registru celé firmy pod hlavičkou pobočky tu
 * stojí věta a odkaz na celou firmu.
 *
 * Tenhle layout hlídá jen KRESLENÍ. Next vyrenderuje stránku souběžně
 * s layoutem i tehdy, když layout `children` nepoužije (výsledek jde
 * klientovi v datech stránky) — proto si pobočku odmítá i každá
 * page.tsx prvním řádkem a serverové akce chtějí právo za celou firmu
 * (akce.ts, banka/akce.ts, email/akce.ts, prodeje/akce*.ts; pokladna
 * má vlastní `overitFiremniPravo`). Hlídá scripts/finance-pobocky.test.mjs.
 */
export default async function IntegraceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params
  if (jeRozsahFirmy(rozsah)) return <>{children}</>

  return (
    <JenProFirmu rozsah={rozsah} nazev="Integrace" segment="finance/integrace">
      Napojení banky, pokladny a e-mailu se zakládají za celou firmu, ne za jednu pobočku.
      Připojit, odpojit nebo synchronizovat je jde v pohledu Celá firma.
    </JenProFirmu>
  )
}
