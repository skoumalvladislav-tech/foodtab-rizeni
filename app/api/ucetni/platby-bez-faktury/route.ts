import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { csvPlatebBezFaktury, filtrUctuFronty } from '@/lib/finance-bez-faktury'
import { nactiPlatbyBezFaktury, nactiUctyFronty } from '@/lib/finance-bez-faktury-nacteni'

export const dynamic = 'force-dynamic'

/**
 * CSV „Platby bez faktury" pro účetní (Finance Fáze 0, krok 2) — totéž
 * co stránka Finance → Platby → Platby bez faktury. Rozsah dat povinný
 * (`od`/`do`), právo „Vidět finanční přehled“. Na pobočce jen účty
 * pobočky a jen s přehledem za celou firmu (stejná brána jako stránka,
 * `zkusPristupFinanci`); `ucet` jen z účtů, které rozsah dovolí.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rozsah = searchParams.get('rozsah') ?? ''
  const od = searchParams.get('od') ?? ''
  const doData = searchParams.get('do') ?? ''

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return new Response('Účet zatím nepatří k žádné firmě.', { status: 400 })

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return new Response('Na tohle nemáte oprávnění.', { status: 403 })
  if (pristup.stav === 'pobocka_bez_firmy') {
    return new Response('Platby pobočky vidí ten, kdo má finanční přehled za celou firmu.', { status: 403 })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doData)) {
    return new Response('Vyplňte rozsah dat (od/do, formát RRRR-MM-DD).', { status: 400 })
  }

  const supabase = await getServerSupabase()
  const ucty = await nactiUctyFronty(supabase, tenantId)
  if (ucty.stav !== 'ok') return new Response(ucty.text, { status: 500 })
  const { filtr } = filtrUctuFronty(ucty.ucty, pobockaFinanci(pristup.scope), searchParams.get('ucet'))

  const vysledek = await nactiPlatbyBezFaktury(supabase, tenantId, od, doData, filtr)
  if (vysledek.stav !== 'ok') return new Response(vysledek.text, { status: vysledek.stav === 'moc' ? 400 : 500 })

  return new Response(csvPlatebBezFaktury(vysledek.platby), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="platby-bez-faktury-${od}-${doData}.csv"`,
    },
  })
}
