'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zařízení pobočky — vystavení kódu a odvolání.
 *
 * Registrační kód se vrací volajícímu JEDNOU a nikam se neukládá.
 * Nejde proto přes redirect s parametrem v adrese: adresa se pamatuje
 * v historii prohlížeče, v protokolu serveru i v odkazovači. Vrací se
 * jako výsledek akce a zůstane jen na té jedné obrazovce.
 */

export type StavKodu =
  | { stav: 'nic' }
  | { stav: 'kod'; kod: string; nazev: string }
  | { stav: 'chyba'; text: string }

export async function vystavitKod(
  _predchozi: StavKodu,
  formData: FormData,
): Promise<StavKodu> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()

  if (!pobocka || !nazev) {
    return { stav: 'chyba', text: 'Vyberte pobočku a pojmenujte zařízení.' }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Účet nepatří k žádné firmě.' }

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Na registraci zařízení nemáte právo.' }
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('vytvorit_registracni_kod', {
    p_tenant: tenantId,
    p_branch: pobocka,
    p_nazev: nazev,
  })

  if (error) return { stav: 'chyba', text: error.message }

  const radek = (data as { kod: string }[])?.[0]
  if (!radek?.kod) return { stav: 'chyba', text: 'Server kód nevrátil.' }

  revalidatePath(`/${rozsah}/nastaveni/zarizeni`)
  return { stav: 'kod', kod: radek.kod, nazev }
}

/**
 * Odvolání zařízení.
 *
 * Ztracený tablet přestane platit z jednoho místa a hned — odvolané
 * zařízení neukáže kód ani nepíchne. Řádek zůstává, ať je dohledatelné,
 * co na provozovně kdy bylo.
 */
export async function odvolatZarizeni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('zarizeni') ?? '')

  if (!id) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('branch_devices')
    .update({ stav: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(
      `/${rozsah}/nastaveni/zarizeni?chyba=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/nastaveni/zarizeni`)
  redirect(`/${rozsah}/nastaveni/zarizeni?odvolano=1`)
}
