'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { BRANCH_COLORS, getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Úprava pobočky.
 *
 * Zapisuje se běžným updatem do branches; kdo smí, rozhoduje politika
 * branches_update, tedy settings.manage v rozsahu firmy. Aplikace se
 * dopředu neptá — jen neposílá nesmysl a odmítnutí ukáže.
 *
 * Barvy si nastavuje zákazník sám, do kódu nepatří. Ověřuje se jen to,
 * že klíč je z palety, kterou zná i podmínka na sloupci.
 */
export async function upravitPobocku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const barva = String(formData.get('barva') ?? '')
  const zacatek = String(formData.get('zacatek') ?? '').trim()

  if (!pobocka) return

  const user = await getUser()
  if (!user) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const ctx = await getContext(tenantId)
  if (!ctx) return

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return

  const zpet = (duvod: string) =>
    `/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&chyba=${duvod}`

  let chyba: string | null = null

  if (nazev === '') chyba = 'nazev'
  else if (!(BRANCH_COLORS as readonly string[]).includes(barva)) chyba = 'barva'
  else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(zacatek)) chyba = 'hodina'

  // Až za kontrolami: redirect() vyhazuje výjimku.
  if (chyba) redirect(zpet(chyba))

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('branches')
    .update({
      name: nazev,
      color: barva,
      // Sloupec je typu time, takže stačí HH:MM.
      day_starts_at: zacatek,
    })
    .eq('id', pobocka)
    .eq('tenant_id', tenantId)

  if (error) {
    // 42501 = insufficient_privilege. Politika branches_update žádá
    // settings.manage; bez něj se sem člověk dostane jen obejitím
    // rozhraní, ale hlášku si zaslouží stejně.
    redirect(zpet(error.code === '42501' ? 'pravo' : 'nepovedlo'))
  }

  revalidatePath(`/${rozsah}/nastaveni/pobocky`)
  redirect(`/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&ulozeno=1`)
}
