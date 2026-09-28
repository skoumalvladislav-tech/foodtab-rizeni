'use server'

import { revalidatePath } from 'next/cache'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zrušit čekající pozvánku (karta „Čekající pozvánky" v Lidech).
 *
 * Od 20260925150000 do tabulky pozvánek z aplikace nikdo nezapisuje,
 * takže ani nezruší — dělá to `public.zrusit_pozvanku`. Ta rozhoduje
 * o všem: správce lidí za celou firmu, pozvánku k PŘESUNU účtu jen
 * majitel, jen čekající. Kontrola práva tady je první linie, aby člověk
 * bez správy lidí dostal větu, ne chybu z databáze.
 *
 * Právo za CELOU firmu (`null`, ne pobočka z adresy): tak se ptá
 * databáze i čtení pozvánek (politika `invitations_manage`).
 */

export type StavZruseni =
  | { stav: 'nic' }
  | { stav: 'hotovo' }
  | { stav: 'chyba'; text: string }

export async function zrusitPozvanku(
  _predchozi: StavZruseni,
  formData: FormData,
): Promise<StavZruseni> {
  const pozvanka = String(formData.get('pozvanka') ?? '')
  if (!pozvanka) return { stav: 'chyba', text: 'Chybí, kterou pozvánku zrušit.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  if (!(await hasAccess(tenantId, 'people.manage', null))) {
    return { stav: 'chyba', text: 'Rušit pozvánky může jen ten, kdo spravuje lidi za celou firmu.' }
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('zrusit_pozvanku', { p_tenant: tenantId, p_pozvanka: pozvanka })

  // Hlášky píše databáze a jsou pro člověka („zruší jen majitel", „už je zrušená").
  if (error) return { stav: 'chyba', text: error.message || 'Zrušit se to nepovedlo.' }

  revalidatePath('/', 'layout')
  return { stav: 'hotovo' }
}
