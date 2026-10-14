import type { ReactNode } from 'react'

import JenProFirmu, { jeRozsahFirmy } from '../../jen-pro-firmu'

/**
 * Import výpisu (CSV) — jen za celou firmu (Finance po pobočkách,
 * 13. 10. 2026).
 *
 * Importní dávka (`import_davky`) pobočku nemá a jednoznačné shody
 * z výpisu se hned párují s fakturami — tím se mění stav faktury celé
 * firmy. Na pobočce proto místo formuláře věta a odkaz na celou firmu.
 * Serverové akce (akce-nahled.ts, akce.ts) si firemní právo hlídají
 * samy — tenhle layout hlídá jen kreslení.
 */
export default async function PlatbyImportLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params
  if (jeRozsahFirmy(rozsah)) return <>{children}</>

  return (
    <JenProFirmu rozsah={rozsah} nazev="Import výpisu" segment="finance/platby/import">
      Výpis se nahrává za celou firmu a jednoznačné platby z něj se hned párují s fakturami celé
      firmy. Platby nahrané na účet této pobočky pak uvidíte v jejích Platbách.
    </JenProFirmu>
  )
}
