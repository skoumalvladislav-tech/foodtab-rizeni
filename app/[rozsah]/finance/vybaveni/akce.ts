'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { pobockaZaznamu } from '@/lib/finance-evidence-pobocka'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * Vstup akcí Vybavení. Vrací i pobočku rozsahu (`pobocka`, `null` =
 * celá firma) — akce si ji berou odsud, NIKDY z formuláře (Finance po
 * pobočkách, 13. 10. 2026).
 *
 * Na pobočce navíc stejná brána jako app/[rozsah]/finance/layout.tsx:
 * jen s `finance.read` za celou firmu. Layout hlídá jen kreslení —
 * serverovou akci jde zavolat i bez stránky.
 */
async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/vybaveni`)

  const pobocka = pobockaFinanci(pristup.scope)
  // ROZHODNOUT: (docs/hlaseni/otazky.md, ot. 47 bod 1) — kdyby Finance pobočky dostal
  // i vedoucí jedné pobočky, musí se uvolnit i tahle druhá linie, ne jen
  // finance/layout.tsx.
  if (pobocka && !(await hasAccess(tenantId, 'finance.read', null))) redirect(`/${rozsah}/finance/vybaveni`)

  return { supabase: await getServerSupabase(), tenantId, pobocka }
}

/**
 * Aktivní pobočky TÉHLE firmy jako seznam pro `pobockaZaznamu` (prázdný
 * = nejde přečíst → vybraná pobočka neprojde). Firemní správce má
 * `has_access` na jakékoli id pobočky — databáze by vybavení uložila
 * i s pobočkou, která firmě nepatří.
 */
async function aktivniPobockyFirmy(supabase: Supabase, tenantId: string): Promise<string[]> {
  const { data } = await supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null)
  return ((data ?? []) as { id: string }[]).map((b) => b.id)
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

export async function zalozitVybaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (!nazev) {
    redirect(`/${rozsah}/finance/vybaveni?chyba=${encodeURIComponent('Vyplňte název.')}`)
  }

  // Na pobočce VŽDY pobočka rozsahu (pole formuláře se nečte), za celou
  // firmu výběr z formuláře — prázdný = vybavení celé firmy.
  const volba = pobockaZaznamu(
    pobocka,
    nepovinnePole(formData, 'branch_id'),
    pobocka ? [] : await aktivniPobockyFirmy(supabase, tenantId),
  )
  if (volba.stav === 'chyba') redirect(`/${rozsah}/finance/vybaveni?chyba=${encodeURIComponent(volba.text)}`)

  const cenaRaw = nepovinnePole(formData, 'cena')
  const cena = cenaRaw ? naHalere(cenaRaw) : null

  const { error } = await supabase.from('vybaveni').insert({
    tenant_id: tenantId,
    branch_id: volba.branchId,
    nazev,
    kategorie: nepovinnePole(formData, 'kategorie') ?? '',
    datum_porizeni: nepovinnePole(formData, 'datum_porizeni'),
    cena_haleru: cena,
    zaruka_do: nepovinnePole(formData, 'zaruka_do'),
    servis_dalsi_kdy: nepovinnePole(formData, 'servis_dalsi_kdy'),
    poznamka: nepovinnePole(formData, 'poznamka') ?? '',
  })

  if (error) {
    redirect(`/${rozsah}/finance/vybaveni?chyba=${encodeURIComponent('Vybavení se nepodařilo uložit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/vybaveni`)
  redirect(`/${rozsah}/finance/vybaveni`)
}

export async function smazatVybaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  let dotaz = supabase.from('vybaveni').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('tenant_id', tenantId)
  // Na pobočce jen vybavení TÉ pobočky — `id` si kdokoli přepíše
  // a firemní správce má na vybavení celé firmy právo i v databázi.
  if (pobocka) dotaz = dotaz.eq('branch_id', pobocka)
  await dotaz

  revalidatePath(`/${rozsah}/finance/vybaveni`)
  redirect(`/${rozsah}/finance/vybaveni`)
}
