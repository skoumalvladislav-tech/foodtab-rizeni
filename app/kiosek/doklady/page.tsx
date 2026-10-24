import type { Metadata } from 'next'

import KiosekDoklady from './kiosek-doklady'

export const dynamic = 'force-dynamic'

/** Vlastní manifest: ikona na ploše telefonu otevře tuhle adresu, ne kiosek Docházky (viz docs/kiosek-vlastni-manifest.md). */
export const metadata: Metadata = {
  title: 'Foodtab — doklady',
  manifest: '/kiosek/doklady.webmanifest',
}

/**
 * Kiosek Jiných plateb na telefonu pobočky (zadání Šéfíka 22. 10. 2026).
 *
 * Adresa je schválně MIMO /[rozsah] a mimo přihlášení, stejně jako
 * kiosek Docházky (app/kiosek/page.tsx): telefon na baru nemá mít
 * přihlášený účet. Totožnost dává klíč zařízení; server podle něj pozná
 * pobočku a nic víc nepustí — jen založit záznam Jiných plateb a nahrát
 * k němu fotky (app/kiosek/doklady/akce.ts, migrace
 * 20261022100000_jine_platby_kiosek). Finanční data ani cizí záznamy
 * telefon nevidí.
 */
export default function KiosekDokladuStranka() {
  return <KiosekDoklady />
}
