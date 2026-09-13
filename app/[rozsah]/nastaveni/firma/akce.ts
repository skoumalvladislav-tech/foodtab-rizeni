'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Nastavení firmy — ranní přehled.
 *
 * Adresáti jsou na POBOČCE (každá může mít jiného), čas je firemní.
 * Ukládá se obojí najednou průzorem `nastavit_ranni_email`: kdyby se
 * ukládalo zvlášť, dala by se firma nechat ve stavu „adresáti jsou,
 * čas není“, což je jen jinak zapsané „neposílá se“ — a nikdo by
 * nevěděl proč.
 */
export async function ulozitRanniEmail(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  const cas = String(formData.get('cas') ?? '').trim()

  /*
    Adresy se píšou do jednoho pole, oddělené čárkou nebo novým řádkem.
    Dvě políčka na dvě adresy by znamenala hádat dopředu, kolik jich
    firma bude chtít.
  */
  const komu = String(formData.get('komu') ?? '')
    .split(/[\n,;]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)

  const zpet = `/${rozsah}/nastaveni/firma`
  if (!pobocka) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_ranni_email', {
    p_tenant: tenantId,
    // Prázdný čas znamená „neposílat“, ne půlnoc.
    p_kdy: cas === '' ? null : cas,
    p_pobocka: pobocka,
    p_komu: komu,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=email`)
}

/**
 * Nastavení firmy — upozornění na zapomenutý odchod.
 *
 * Dvacet hodin a devátá jsou dnešní rozhodnutí, ne zákon přírody
 * (docs/zapomenuty-odchod-zadani.md, oddíl 1). Jiná restaurace bude
 * chtít jiná čísla a nemá kvůli tomu vznikat nová verze aplikace.
 *
 * Rozhoduje průzor `nastavit_zapomenuty_odchod`: kontrola tady je
 * první obranná linie, ne jediná.
 */
export async function ulozitZapomenutyOdchod(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const hodin = Number(String(formData.get('hodin') ?? '').trim())
  const kdy = String(formData.get('kdy') ?? '').trim()

  const zpet = `/${rozsah}/nastaveni/firma`

  if (!Number.isInteger(hodin) || hodin < 1 || hodin > 168) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Hranice musí být celé číslo mezi 1 a 168 hodinami.')}`)
  }
  if (!kdy) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Vyplňte, v kolik se má ozvat.')}`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_zapomenuty_odchod', {
    p_tenant: tenantId,
    p_hodin: hodin,
    p_kdy: kdy,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=zapomenuty`)
}

/**
 * Nastavení firmy — paušální přestávky.
 *
 * Průzor nastavit_prestavku zapíše do tenant_settings a do auditu.
 * Přímý zápis obchází audit — a tohle je změna, která hýbe penězi.
 */
export async function ulozitPrestavku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  // Uživatel zadává minuty a hodiny; do DB jdou minuty a minuty.
  const minut = Number(String(formData.get('prestavka_minut') ?? '').trim())
  const odHodin = Number(String(formData.get('prestavka_od_hodin') ?? '').trim())
  const platnaOd = String(formData.get('prestavka_platna_od') ?? '').trim()

  const zpet = `/${rozsah}/nastaveni/firma`

  if (!Number.isInteger(minut) || minut < 0 || minut > 240) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Počet minut musí být 0–240.')}`)
  }
  const odMinut = Math.round(odHodin * 60)
  if (!Number.isFinite(odMinut) || odMinut < 0 || odMinut > 1440) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Práh musí být 0–24 hodin.')}`)
  }
  if (!platnaOd) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Vyplňte datum platnosti.')}`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_prestavku', {
    p_tenant: tenantId,
    p_minut: minut,
    p_od_minut: odMinut,
    p_platna_od: platnaOd,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=prestavka`)
}
