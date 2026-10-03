import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import AnalytikFormular from './formular'

export const dynamic = 'force-dynamic'

/**
 * Finance — AI analytik (omezený, auditovatelný).
 *
 * Vysvětluje čísla, která appka už spočítala (výsledovka, rozpočet vs.
 * skutečnost, rolling cashflow) — nikdy je sám nepočítá. Žádné jméno
 * zaměstnance, mzda, kontakt ani záloha nejde do modelu (CLAUDE.md,
 * pravidlo 8; lib/finance-ai-analytik.ts).
 */
export default async function FinanceAnalytik({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Analytika vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Vysvětluje čísla za aktuální měsíc, nikdy je sám nepočítá. Bez klíče k AI vrátí jen ukázku."
      >
        AI analytik
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        <AnalytikFormular rozsah={rozsah} />
      </div>
    </Navigace>
  )
}
