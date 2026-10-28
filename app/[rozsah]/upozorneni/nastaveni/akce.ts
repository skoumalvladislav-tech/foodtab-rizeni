'use server'

import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Musí sedět s check `notification_preferences_kategorie_check`
 * (20261103100000_rezervace_souhrn_dne.sql).
 *
 * Vzkazy a nástěnka se nabízejí každému a zapisují se vždy. Ranní přehled
 * rezervací jen tehdy, když ho formulář nabídl (`nabidnuto`) — kdo ho
 * neviděl, tomu se nesmí tiše přepsat na „vypnuto“.
 */
const KATEGORIE_VZDY = ['vzkazy', 'nastenka'] as const
const KATEGORIE_NABIDNUTE = ['rezervace_souhrn'] as const

/**
 * Uložit nastavení upozornění.
 *
 * Formulář posílá jen vypnutelné kategorie — směny (smena.*) se sem
 * vůbec nedostanou, natož aby šly zapsat jako vypnuté (viz page.tsx
 * a app.upozorneni_povoleno). Zápis jde přímo na tabulku: politika
 * `notification_preferences_vlastni` pustí jen vlastní řádek, takže tu
 * není co dalšího ověřovat.
 */
export async function ulozitNastaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const nabidnuto = new Set(String(formData.get('nabidnuto') ?? '').split(','))
  const radek = (kategorie: string) => ({
    tenant_id: tenantId,
    user_id: user.id,
    kategorie,
    povoleno: String(formData.get(kategorie) ?? '') === 'ano',
    updated_at: new Date().toISOString(),
  })

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(KATEGORIE_VZDY.map(radek), { onConflict: 'tenant_id,user_id,kategorie' })

  if (error) {
    redirect(`/${rozsah}/upozorneni/nastaveni?chyba=${encodeURIComponent(error.message)}`)
  }

  /*
    Zvlášť, ať se vzkazy a nástěnka uloží, i když databáze novou kategorii
    ještě nezná (kód se nasazuje dřív než db push → check 23514).
  */
  const dalsi = KATEGORIE_NABIDNUTE.filter((k) => nabidnuto.has(k)).map(radek)
  if (dalsi.length > 0) {
    const { error: chybaDalsi } = await supabase
      .from('notification_preferences')
      .upsert(dalsi, { onConflict: 'tenant_id,user_id,kategorie' })
    if (chybaDalsi) {
      const hlaska =
        chybaDalsi.code === '23514'
          ? 'Zprávy a nástěnka jsou uložené. Ranní přehled rezervací půjde nastavit, až se nasadí databáze.'
          : chybaDalsi.message
      redirect(`/${rozsah}/upozorneni/nastaveni?chyba=${encodeURIComponent(hlaska)}`)
    }
  }

  redirect(`/${rozsah}/upozorneni/nastaveni?ulozeno=1`)
}

/**
 * Zapsat zařízení pro upozornění do telefonu (web push).
 *
 * Volá se z klientské komponenty po tom, co prohlížeč vydal předplatné.
 * Zapisuje `public.push_odber_ulozit`: zařízení se váže na PŘIHLÁŠENÉHO
 * (auth.uid), takže cizí účet tu nejde podvrhnout, a zařízení dříve zapsané
 * pod jiným účtem (sdílený telefon) přejde na nového.
 */
export async function ulozitZarizeniPush(odber: {
  endpoint: string
  p256dh: string
  auth: string
  agent: string
}): Promise<{ ok: true } | { ok: false; chyba: string }> {
  const user = await getUser()
  if (!user) return { ok: false, chyba: 'Nejste přihlášen(a).' }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('push_odber_ulozit', {
    p_endpoint: String(odber.endpoint ?? ''),
    p_p256dh: String(odber.p256dh ?? ''),
    p_auth: String(odber.auth ?? ''),
    p_user_agent: String(odber.agent ?? '').slice(0, 300),
  })
  if (error) {
    // Kód se nasazuje dřív než migrace.
    if (funkceNeexistuje(error)) {
      return { ok: false, chyba: 'Upozornění do telefonu čekají na nasazení databáze.' }
    }
    return { ok: false, chyba: error.message }
  }
  return { ok: true }
}

/** Zrušit zařízení. Zruší jen vlastní (push_odber_zrusit kontroluje vlastníka). */
export async function zrusitZarizeniPush(
  endpoint: string,
): Promise<{ ok: true } | { ok: false; chyba: string }> {
  const user = await getUser()
  if (!user) return { ok: false, chyba: 'Nejste přihlášen(a).' }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('push_odber_zrusit', { p_endpoint: String(endpoint ?? '') })
  return error ? { ok: false, chyba: error.message } : { ok: true }
}
