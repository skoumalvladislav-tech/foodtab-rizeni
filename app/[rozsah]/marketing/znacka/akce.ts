'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { SBIRKA_KANDIDAT_ZNACKY } from '@/lib/marketing-media'
import { delkaVidea, neboNull, seznamVyrazu } from '@/lib/marketing-text'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jeden } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Uložení značky provozovny (nebo firmy).
 *
 * Rozsah se NEBERE z formuláře, ale z adresy a ověřuje se proti
 * členství (`zkusPristup`) — pravidlo 4. Kdyby se bral ze skrytého
 * pole, stačilo by přepsat jedno id a vedoucí jedné pobočky by
 * přemaloval značku celé firmy.
 *
 * Druhá obranná linie je RLS: politika `marketing_nastaveni_write` se
 * ptá `app.has_access(tenant, 'marketing.manage', branch)`. Ani jedna
 * se nevynechává s tím, že to hlídá ta druhá (pravidlo 3).
 */

export async function ulozitZnacku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing`)

  const branchId = pristup.scope.branchId
  const supabase = await getServerSupabase()

  /*
    LOGO SE PŘEBÍRÁ JEN JAKO ODKAZ NA JIŽ EXISTUJÍCÍ ZÁZNAM, NE JAKO
    SOUBOR — formulář tu neumí nahrát logo ručně (to zůstává mimo
    rozsah, viz docs zadání 1. 10. 2026), jen PŘEVZÍT id, které už dřív
    vytvořil buď návrh z webu (`./akce-ai.ts`), nebo dřívější nahrání.

    Vlastnictví se ověřuje TADY, ne až v databázi: skryté pole v
    formuláři je stejně nedůvěryhodné jako `branch_id` (pravidlo 4) —
    kdokoli přihlášený by si mohl zkusit podstrčit cizí `id`. RLS
    (`marketing_media_select`) by cizí firmě stejně nic nevrátila, ale
    tahle kontrola je DRUHÁ linie, ne náhrada za ni (pravidlo 3).
  */
  const logoMediaIdVstup = neboNull(String(formData.get('logo_media_id') ?? ''))
  let logoMediaId: string | null = null

  if (logoMediaIdVstup) {
    const logo = await jeden<{ id: string }>(
      'logo pro značku',
      supabase
        .from('marketing_media')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('id', logoMediaIdVstup)
        .is('archivovano_kdy', null)
        .maybeSingle(),
    )

    if (!logo) {
      redirect(`/${rozsah}/marketing/znacka?chyba=${encodeURIComponent('Vybrané logo v knihovně není — zkuste návrh znovu.')}`)
    }

    logoMediaId = logo.id

    /*
      Přijetí kandidátního loga z „Najít na webu" (./akce-ai.ts) — řádek
      v `marketing_media` dostal `sbirka = 'kandidat_znacky'` právě proto,
      aby se neobjevil ve sdílené Knihovně fotek ani ve výběru pro
      příspěvek, dokud ho člověk nepřijme (nález kontroly konzistence).
      Teď, když se značka opravdu ukládá s tímhle logem, se promění na
      běžnou fotku — stejnou `sbirka` jako cokoli jiné v knihovně. Nic
      se nestane, když to není kandidát (ruční nahrání, starší logo):
      `.eq('sbirka', 'kandidat_znacky')` zasáhne jen tenhle jeden případ.
    */
    await supabase
      .from('marketing_media')
      .update({ sbirka: 'ostatni' })
      .eq('tenant_id', tenantId)
      .eq('id', logoMediaId)
      .eq('sbirka', SBIRKA_KANDIDAT_ZNACKY)
  }

  const radek = {
    tenant_id: tenantId,
    branch_id: branchId,
    ton_hlasu: String(formData.get('ton_hlasu') ?? 'neformalni'),
    pouzivat_emoji: formData.get('pouzivat_emoji') === 'ano',
    barva_hlavni: neboNull(String(formData.get('barva_hlavni') ?? '')),
    barva_doplnkova: neboNull(String(formData.get('barva_doplnkova') ?? '')),
    barva_pozadi: neboNull(String(formData.get('barva_pozadi') ?? '')),
    pismo_nadpisy: neboNull(String(formData.get('pismo_nadpisy') ?? '')),
    pismo_text: neboNull(String(formData.get('pismo_text') ?? '')),
    logo_media_id: logoMediaId,
    podpis: String(formData.get('podpis') ?? '').trim(),
    kontakt: String(formData.get('kontakt') ?? '').trim(),
    vyrazy_ano: seznamVyrazu(String(formData.get('vyrazy_ano') ?? '')),
    vyrazy_ne: seznamVyrazu(String(formData.get('vyrazy_ne') ?? '')),
    video_sekundy: delkaVidea(formData.get('video_sekundy')),
    // Stejná úvaha jako u podpisu/kontaktu: prázdný řetězec JE hodnota
    // „nezadáno“, ne NULL (viz migrace 20260929140000).
    popis_firmy: String(formData.get('popis_firmy') ?? '').trim().slice(0, 2000),
    web_url: String(formData.get('web_url') ?? '').trim().slice(0, 300),
    instagram_url: String(formData.get('instagram_url') ?? '').trim().slice(0, 300),
    facebook_url: String(formData.get('facebook_url') ?? '').trim().slice(0, 300),
    zmeneno_kdy: new Date().toISOString(),
  }

  /*
    Nejdřív se hledá stávající řádek a teprve pak se rozhoduje mezi
    insertem a updatem. `upsert` by tu byl kratší, jenže jedinečnost
    stojí na indexu s `nulls not distinct` — a u firemního rozsahu je
    `branch_id` NULL, tedy přesně ten případ, na kterém by se rozešlo,
    co si o konfliktu myslí PostgREST a co index.
  */
  const stavajici = await jeden<{ id: string }>(
    'stávající značka',
    branchId === null
      ? supabase.from('marketing_nastaveni').select('id')
          .eq('tenant_id', tenantId).is('branch_id', null).maybeSingle()
      : supabase.from('marketing_nastaveni').select('id')
          .eq('tenant_id', tenantId).eq('branch_id', branchId).maybeSingle(),
  )

  const { error } = stavajici
    ? await supabase.from('marketing_nastaveni').update(radek).eq('id', stavajici.id)
    : await supabase.from('marketing_nastaveni').insert(radek)

  if (error) {
    redirect(`/${rozsah}/marketing/znacka?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/znacka?ulozeno=1`)
}
