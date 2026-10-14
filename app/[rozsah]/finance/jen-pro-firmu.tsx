import Link from 'next/link'
import type { ReactNode } from 'react'

import { getContext, TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import Nadpis from '../nadpis'
import Navigace from './navigace'

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
  display: 'grid',
  gap: '10px',
} as const

/**
 * Obrazovka Financí, která patří celé firmě, otevřená na pobočce.
 *
 * Šéfík 13. 10. 2026 chce Finance po pobočkách. Kontakty (bez pobočky),
 * Integrace (napojení celé firmy), import výpisů a AI analytik ale na
 * pobočce nemají co filtrovat — místo čísel celé firmy pod hlavičkou
 * pobočky tu stojí věta, proč tu nic není, a odkaz na stejnou obrazovku
 * za celou firmu (jen tomu, kdo na „Celou firmu" smí — firemní členství).
 *
 * Kreslí ji vnořený layout dané obrazovky (např. finance/kontakty/layout.tsx),
 * ne každá stránka zvlášť — jedno místo, žádná zapomenutá podstránka.
 * Serverové akce té obrazovky si firemní právo hlídají samy.
 */
export default async function JenProFirmu({
  rozsah,
  nazev,
  segment,
  children,
}: {
  rozsah: string
  /** Název obrazovky v nadpisu, např. „Kontakty". */
  nazev: string
  /** Cesta za rozsahem pro odkaz na celou firmu, např. `finance/kontakty`. */
  segment: string
  /** Jedna dvě věty, proč obrazovka patří celé firmě. */
  children: ReactNode
}) {
  const tenantId = await getCurrentTenantId()
  const ctx = tenantId ? await getContext(tenantId) : null
  const smiNaFirmu = ctx?.membership.scope === 'tenant'

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance" popis="Tahle obrazovka patří celé firmě, ne jedné pobočce.">
        {nazev}
      </Nadpis>
      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        <div style={karta}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>{nazev} — jen za celou firmu</h2>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>{children}</p>
          {smiNaFirmu ? (
            <div>
              <Link href={`/${TENANT_SCOPE_SEGMENT}/${segment}`} className="ft-tl">
                Otevřít za celou firmu →
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </Navigace>
  )
}

/** Je rozsah z adresy celá firma? (Vnořené layouty obrazovek jen pro firmu.) */
export function jeRozsahFirmy(rozsah: string): boolean {
  return rozsah === TENANT_SCOPE_SEGMENT
}
