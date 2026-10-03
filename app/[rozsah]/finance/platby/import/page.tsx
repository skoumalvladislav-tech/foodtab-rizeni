import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import ImportFormular from './formular'

export const dynamic = 'force-dynamic'

/**
 * Finance — Platby — Import výpisu (CSV).
 *
 * Vlastní jednoduchá šablona (lib/finance-csv-import.ts), ne nativní
 * export konkrétní banky — appka žádnou banku nepřipojuje (zadání,
 * oddíl 2: „čeká na připojení“, nikdy „připojeno“).
 */
export default async function FinancePlatbyImport({
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
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Platby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }
  if (!canSee(pristup.ctx, 'finance.manage')) {
    return <Sdeleni nadpis="Na import nemáte oprávnění">Import výpisů smí ten, kdo má právo „Správa financí“.</Sdeleni>
  }

  const supabase = await getServerSupabase()
  const { data } = await supabase
    .from('platebni_ucty')
    .select('id, nazev')
    .eq('tenant_id', tenantId)
    .eq('aktivni', true)
    .order('nazev')

  const ucty = (data ?? []) as { id: string; nazev: string }[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Soubor se nejdřív jen přečte a ukáže — zapíše se, až potvrdíte náhled."
        vpravo={<Link href={`/${rozsah}/finance/platby`} className="ft-tl">← Zpět na platby</Link>}
      >
        Import výpisu
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '760px' }}>
        {ucty.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Nejdřív založte platební účet na stránce{' '}
            <Link href={`/${rozsah}/finance/platby`} className="ft-tl">Platby</Link>.
          </p>
        ) : (
          <ImportFormular rozsah={rozsah} ucty={ucty} />
        )}
      </div>
    </Navigace>
  )
}
