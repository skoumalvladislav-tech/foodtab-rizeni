'use server'

import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/** Musí sedět s KATEGORIE ve `20260917050000_nastaveni_upozorneni.sql`. */
const KATEGORIE = ['vzkazy', 'nastenka'] as const

/**
 * Uložit nastavení upozornění.
 *
 * Formulář posílá jen ty dvě vypnutelné kategorie — směny (smena.*)
 * se sem vůbec nedostanou, natož aby šly zapsat jako vypnuté (viz
 * page.tsx a app.upozorneni_povoleno). Zápis jde přímo na tabulku:
 * politika `notification_preferences_vlastni` pustí jen vlastní
 * řádek, takže tu není co dalšího ověřovat.
 */
export async function ulozitNastaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const supabase = await getServerSupabase()
  const radky = KATEGORIE.map((kategorie) => ({
    tenant_id: tenantId,
    user_id: user.id,
    kategorie,
    povoleno: String(formData.get(kategorie) ?? '') === 'ano',
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('notification_preferences')
    .upsert(radky, { onConflict: 'tenant_id,user_id,kategorie' })

  if (error) {
    redirect(`/${rozsah}/upozorneni/nastaveni?chyba=${encodeURIComponent(error.message)}`)
  }

  redirect(`/${rozsah}/upozorneni/nastaveni?ulozeno=1`)
}
