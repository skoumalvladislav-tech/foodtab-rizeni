'use server'

import { revalidatePath } from 'next/cache'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Odebrat z firmy účet, se kterým se v Lidech nedá nic udělat — nepatří
 * k nikomu (bez záznamu), nebo jeho člověk je smazaný. Okno „čeká na
 * oprávnění" a karta čekajících v Lidech.
 *
 * O všem rozhoduje `public.odebrat_z_firmy` (20260925150000): pozastaví
 * členství, jen když účet ve firmě nemá živý záznam — majitele ani sebe
 * tudy odebrat nejde. Kontrola práva tady je první linie, aby člověk bez
 * správy lidí dostal větu, ne chybu z databáze.
 *
 * Právo za CELOU firmu (`null`, ne pobočka z adresy): tak se ptá
 * i databáze a okno se ukazuje jen takovým správcům.
 */

export type StavOdebrani =
  | { stav: 'nic' }
  | { stav: 'hotovo' }
  | { stav: 'chyba'; text: string }

export async function odebratZFirmy(
  _predchozi: StavOdebrani,
  formData: FormData,
): Promise<StavOdebrani> {
  const ucet = String(formData.get('ucet') ?? '')
  if (!ucet) return { stav: 'chyba', text: 'Chybí, koho odebrat.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  if (!(await hasAccess(tenantId, 'people.manage', null))) {
    return { stav: 'chyba', text: 'Odebírat lidi z firmy může jen ten, kdo spravuje lidi za celou firmu.' }
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('odebrat_z_firmy', { p_tenant: tenantId, p_user: ucet })

  // Hlášky píše databáze a jsou pro člověka („patří k člověku v Lidech…").
  if (error) return { stav: 'chyba', text: error.message || 'Odebrat se to nepovedlo.' }

  // Seznam čekajících se bere z dat — po obnovení rámu v něm účet není.
  revalidatePath('/', 'layout')
  return { stav: 'hotovo' }
}
