import { redirect } from 'next/navigation'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { fakturyFirmy, pristupKFakturam } from '@/lib/faktury-pristup'
import {
  popisFaktury,
  sestavitRadkyExportu,
  vygenerovatCsvExportu,
  type ZdrojovaTransakce,
  type ZdrojovaPlatba,
} from '@/lib/ucetni-export'

export const dynamic = 'force-dynamic'

/**
 * CSV export pro účetního (zadání, oddíl 7) — zobecnění
 * app/api/faktury/export/route.ts na neutrální tvar doklad/datum/
 * středisko/kategorie/částka. Zdroj: `transakce` + `platby_faktury`
 * (jen potvrzené páry). Rozsah dat je povinný (`od`/`do`), ať export
 * nikdy netiše nevytáhne celou historii.
 *
 * Na pobočce (`?rozsah=<pobočka>`, od 13. 10. 2026) jen platby z účtů
 * té pobočky — a jen pro toho, kdo má finance.read za celou firmu.
 * Do té doby export s pobočkovým rozsahem vracel transakce CELÉ firmy:
 * RLS transakcí (`can_read_scoped(…, null)`) rozsah členství nehlídá,
 * takže by je stáhl i vedoucí jedné pobočky (kontrola 13. 10. 2026).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rozsah = searchParams.get('rozsah') ?? ''
  const od = searchParams.get('od') ?? ''
  const doData = searchParams.get('do') ?? ''

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return new Response('Účet zatím nepatří k žádné firmě.', { status: 400 })

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return new Response('Na tohle nemáte oprávnění.', { status: 403 })

  const pobocka = pobockaFinanci(pristup.scope)
  if (pobocka && !(await hasAccess(tenantId, 'finance.read', null))) {
    return new Response('Export pobočky zatím jen s finančním přehledem za celou firmu.', { status: 403 })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doData)) {
    return new Response('Vyplňte rozsah dat (od/do, formát RRRR-MM-DD).', { status: 400 })
  }

  const supabase = await getServerSupabase()

  // Na pobočce `!inner` + filtr na účet: transakce firemních účtů a účtů
  // jiných poboček v exportu nejsou.
  let dotazTransakci = supabase
    .from('transakce')
    .select(`id, datum, smer, castka_haleru, protistrana, vs, kategorie, zdroj, platebni_ucty${pobocka ? '!inner' : ''}(branch_id)`)
    .eq('tenant_id', tenantId)
    .gte('datum', od)
    .lte('datum', doData)
  if (pobocka) dotazTransakci = dotazTransakci.eq('platebni_ucty.branch_id', pobocka)

  const [transakceRes, branchesRes] = await Promise.all([
    dotazTransakci.order('datum'),
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId),
  ])

  if (transakceRes.error) return new Response('Nepodařilo se načíst transakce.', { status: 500 })

  type RadekTransakceSDotazem = {
    id: string
    datum: string
    smer: ZdrojovaTransakce['smer']
    castka_haleru: number
    protistrana: string
    vs: string
    kategorie: string | null
    zdroj: string
    platebni_ucty: { branch_id: string | null } | { branch_id: string | null }[]
  }

  const transakce: ZdrojovaTransakce[] = ((transakceRes.data ?? []) as RadekTransakceSDotazem[]).map((t) => {
    const ucet = Array.isArray(t.platebni_ucty) ? t.platebni_ucty[0] : t.platebni_ucty
    return {
      id: t.id,
      datum: t.datum,
      smer: t.smer,
      castkaHaleru: t.castka_haleru,
      protistrana: t.protistrana,
      vs: t.vs,
      kategorie: t.kategorie,
      zdroj: t.zdroj,
      branchId: ucet?.branch_id ?? null,
    }
  })

  const idTransakci = transakce.map((t) => t.id)
  let platby: ZdrojovaPlatba[] = []
  if (idTransakci.length > 0) {
    const { data } = await supabase
      .from('platby_faktury')
      .select('transakce_id, faktura, faktura_id, stav')
      .eq('tenant_id', tenantId)
      .in('transakce_id', idTransakci)
    platby = ((data ?? []) as { transakce_id: string; faktura: string | null; faktura_id: string; stav: ZdrojovaPlatba['stav'] }[]).map((p) => ({
      transakceId: p.transakce_id,
      fakturaId: p.faktura ?? p.faktura_id,
      stav: p.stav,
    }))
  }

  // Číslo faktury a dodavatel místo id — jen když exportující Faktury vidí
  // (faktury.read za celou firmu) a jsou otevřené; jinak zůstane id.
  const popisyFaktur: Record<string, string> = {}
  const idFaktur = [...new Set(platby.filter((p) => p.stav === 'potvrzeno').map((p) => p.fakturaId))]
  if (idFaktur.length > 0 && (await hasAccess(tenantId, 'faktury.read', null))) {
    const pristupFaktury = await pristupKFakturam(tenantId)
    if (pristupFaktury.stav === 'ok') {
      const uuid = idFaktur.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      for (let i = 0; i < uuid.length; i += 200) {
        const { data } = await fakturyFirmy(pristupFaktury, 'id, cislo_faktury, dodavatel').in('id', uuid.slice(i, i + 200))
        for (const f of (data ?? []) as unknown as { id: string; cislo_faktury: string | null; dodavatel: string | null }[]) {
          popisyFaktur[f.id] = popisFaktury(f.cislo_faktury, f.dodavatel)
        }
      }
    }
  }

  const nazvyPobocek: Record<string, string> = {}
  for (const b of (branchesRes.data ?? []) as { id: string; name: string }[]) nazvyPobocek[b.id] = b.name

  const radky = sestavitRadkyExportu(transakce, platby, nazvyPobocek, popisyFaktur)
  const csv = vygenerovatCsvExportu(radky)

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ucetni-export-${od}-${doData}.csv"`,
    },
  })
}
