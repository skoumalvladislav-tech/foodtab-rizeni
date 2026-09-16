'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Úseky — do jakého týmu/oddělení člověk patří (Kuchyně, Bar, Vedení).
 *
 * ÚSEK NENÍ ZAŘAZENÍ. Zařazení (Nastavení → Zařazení, dřív Pozice) říká
 * ČÍM člověk je a CO SMÍ — Číšník, Kuchař, a k tomu oprávnění. Úsek říká,
 * do kterého TÝMU patří kvůli organizaci a rozpisu — Kuchař může patřit
 * do úseku Kuchyně na jedné pobočce, ale zaskakovat u Baru jinde. Dvě
 * různé osy, dvě různá pole u zaměstnance (position_id / usek_id).
 *
 * Tabulka `useky` v databázi měla RLS hotovou (migrace, kterou psala
 * jiná relace), ale žádnou obrazovku, kde by šla spravovat — Šéfík
 * 16.9.2026: "nefungují úseky". Tenhle soubor a page.tsx jsou ta
 * chybějící obrazovka. Žádná nová RPC: `useky_write` politika už
 * dovoluje `settings.manage` zapisovat přímo, stejně jako u Šablon
 * směn a Pozic před RPC.
 */

export type VysledekUseku = { stav: 'ok' } | { stav: 'chyba'; text: string }

/** Založení nového úseku. */
export async function zalozitUsek(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const pobocka = String(formData.get('pobocka') ?? '').trim() || null

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  if (nazev === '') {
    redirect(`/${rozsah}/nastaveni/useky?chyba=prazdny`)
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('useky')
    .insert({ tenant_id: tenantId, branch_id: pobocka, nazev })

  if (error) {
    redirect(
      `/${rozsah}/nastaveni/useky?chyba=${error.code === '42501' ? 'pravo' : 'nepovedlo'}`,
    )
  }

  revalidatePath(`/${rozsah}/nastaveni/useky`)
  redirect(`/${rozsah}/nastaveni/useky?stav=zalozen`)
}

/** Přejmenování a přeřazení pobočky. */
export async function upravitUsek(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('usek') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const pobocka = String(formData.get('pobocka') ?? '').trim() || null
  if (!id || nazev === '') {
    redirect(`/${rozsah}/nastaveni/useky?chyba=prazdny`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('useky')
    .update({ nazev, branch_id: pobocka })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(
      `/${rozsah}/nastaveni/useky?chyba=${error.code === '42501' ? 'pravo' : 'nepovedlo'}`,
    )
  }

  revalidatePath(`/${rozsah}/nastaveni/useky`)
  redirect(`/${rozsah}/nastaveni/useky?stav=upraven`)
}

/**
 * Vyřazení z nabídky a vrácení zpět.
 *
 * Úsek se NEMAŽE — lidé, kteří ho mají, by o něj přišli beze slova.
 * Vyřazený se jen přestane nabízet při zakládání nového přiřazení.
 */
export async function prepnoutUsek(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('usek') ?? '')
  const zapnout = String(formData.get('zapnout') ?? '') === 'ano'
  if (!id) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('useky')
    .update({ active: zapnout })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(
      `/${rozsah}/nastaveni/useky?chyba=${error.code === '42501' ? 'pravo' : 'nepovedlo'}`,
    )
  }

  revalidatePath(`/${rozsah}/nastaveni/useky`)
  redirect(`/${rozsah}/nastaveni/useky?stav=${zapnout ? 'vracen' : 'vyrazen'}`)
}

/*
  Přiřazení úseku zaměstnanci se řeší přímo v Nastavení → Lidé
  (app/[rozsah]/nastaveni/lide/akce.ts, `upravitZamestnance`) — je to
  jedno pole ve stejném formuláři jako Zařazení a Pobočka, ne
  samostatná akce tady. Tenhle soubor spravuje jen samotný SEZNAM úseků.
*/
