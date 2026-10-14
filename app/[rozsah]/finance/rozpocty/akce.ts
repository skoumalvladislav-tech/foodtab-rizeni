'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { hodnotaPohleduRozpoctu, pobockaZaznamu } from '@/lib/finance-evidence-pobocka'

export async function zalozitRozpocet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/rozpocty`)

  // Pobočka z rozsahu adresy (Finance po pobočkách, 13. 10. 2026),
  // `null` = celá firma. Na pobočce stejná brána jako
  // app/[rozsah]/finance/layout.tsx — serverovou akci jde zavolat i bez
  // stránky.
  const pobocka = pobockaFinanci(pristup.scope)
  // ROZHODNOUT: (docs/hlaseni/otazky.md, ot. 47 bod 1) — kdyby Finance pobočky dostal
  // i vedoucí jedné pobočky, musí se uvolnit i tahle druhá linie, ne jen
  // finance/layout.tsx.
  if (pobocka && !(await hasAccess(tenantId, 'finance.read', null))) redirect(`/${rozsah}/finance/rozpocty`)

  const supabase = await getServerSupabase()

  const kategorie = String(formData.get('kategorie') ?? '')
  const smer = String(formData.get('smer') ?? '')
  const rok = Number(formData.get('rok'))
  const mesic = Number(formData.get('mesic'))
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const jeFixni = formData.get('je_fixni') === 'on'

  if (!kategorie || !smer || !rok || !mesic || castka === null || castka <= 0) {
    redirect(`/${rozsah}/finance/rozpocty?chyba=${encodeURIComponent('Vyplňte kategorii, směr, období a částku.')}`)
  }

  // Na pobočce VŽDY pobočka rozsahu (pole formuláře se nečte) — rozpočet
  // z Bernard Baru nesmí přepsat firemní rozpočet ani rozpočet jiné
  // pobočky (upsert na stejný klíč by ho tiše nahradil). Za celou firmu
  // výběr z formuláře, prázdný = firemní rozpočet, jinak jen aktivní
  // pobočka TÉHLE firmy.
  let povolene: string[] = []
  if (!pobocka) {
    const { data } = await supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null)
    povolene = ((data ?? []) as { id: string }[]).map((b) => b.id)
  }
  const volba = pobockaZaznamu(pobocka, String(formData.get('branch_id') ?? ''), povolene)
  if (volba.stav === 'chyba') redirect(`/${rozsah}/finance/rozpocty?chyba=${encodeURIComponent(volba.text)}`)

  const { error } = await supabase
    .from('rozpocty')
    .upsert(
      { tenant_id: tenantId, branch_id: volba.branchId, kategorie, smer, rok, mesic, castka_haleru: castka, je_fixni: jeFixni },
      { onConflict: 'tenant_id,branch_id,kategorie,smer,rok,mesic' },
    )

  if (error) {
    redirect(`/${rozsah}/finance/rozpocty?chyba=${encodeURIComponent('Rozpočet se nepodařilo uložit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/rozpocty`)
  // Za celou firmu zpět na pohled, do kterého se rozpočet uložil (i na
  // firemní rozpočty) — jinak by se ukázala první pobočka a uložený
  // řádek by nebyl vidět. Na pobočce pohled určuje rozsah.
  const pohled = pobocka ? '' : `&pobocka=${encodeURIComponent(hodnotaPohleduRozpoctu(volba.branchId))}`
  redirect(`/${rozsah}/finance/rozpocty?rok=${rok}&mesic=${mesic}${pohled}`)
}
