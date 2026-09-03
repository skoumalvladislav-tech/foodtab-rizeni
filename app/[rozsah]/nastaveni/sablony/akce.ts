'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Nastavení → Šablony směn.
 *
 * Zadání docs/sablony-smen-zadani.md.
 *
 * ---------------------------------------------------------------------
 * ŠABLONA JE PŘEDVYPLNĚNÍ, NE VAZBA
 *
 * Nejdůležitější vlastnost celého návrhu: směna si při založení časy
 * OPÍŠE a odkaz na šablonu si nedrží. Změna šablony proto s už zadanými
 * směnami nehne — jinak by přejmenování „D“ z 8–16 na 9–17 posunulo
 * rozpis, který lidé už mají v telefonu a podle kterého si zařídili
 * hlídání dětí.
 *
 * Ta věta stojí i na obrazovce, ne jen tady. Uživatel ji musí vidět,
 * ne doufat.
 *
 * ---------------------------------------------------------------------
 * HLÁŠKY PÍŠE DATABÁZE
 *
 * `ulozit_sablonu` kontroluje právo, prázdné údaje, cizí pobočku
 * i srážku zkratek a hlášky má napsané pro člověka. Projdou se sem
 * tak, jak jsou — druhá sada hlášek by se rozešla s tou první.
 * Stejná úvaha jako u `ulozitSmenu`.
 */

/** Hláška z databáze do adresy. Delší by se do řádku stejně nevešla. */
function zkrat(text: string): string {
  const t = text.trim()
  return t.length > 200 ? t.slice(0, 197) + '…' : t
}

function zpet(rozsah: string, dotaz: string): never {
  redirect(`/${rozsah}/nastaveni/sablony${dotaz}`)
}

export async function ulozitSablonu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const sablona = String(formData.get('sablona') ?? '').trim() || null
  const pobocka = String(formData.get('pobocka') ?? '').trim() || null
  const pozice = String(formData.get('pozice') ?? '').trim() || null
  const klic = String(formData.get('klic') ?? '').trim()
  const nazev = String(formData.get('nazev') ?? '').trim()
  const od = String(formData.get('od') ?? '')
  const doKdy = String(formData.get('do') ?? '')
  const poradiText = String(formData.get('poradi') ?? '').trim()

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  /*
    První obranná linie. Druhá je uvnitř `ulozit_sablonu`, která si
    `settings.manage` ověří na TÉ pobočce, která přišla. Pobočka
    z prohlížeče je návrh (pravidlo 4).
  */
  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  // Prázdné pořadí není nula. Nula by novou šablonu vystřelila na
  // začátek nabídky, což nikdo nechtěl — chtěl jen nevyplnit.
  const poradi = poradiText === '' ? 100 : Number(poradiText)
  if (!Number.isFinite(poradi)) {
    zpet(rozsah, '?chyba=' + encodeURIComponent('Pořadí musí být číslo.'))
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('ulozit_sablonu', {
    p_tenant: tenantId,
    p_sablona: sablona,
    p_branch: pobocka,
    p_position: pozice,
    p_key: klic,
    p_label: nazev,
    // „HH:MM“ jde do sloupce `time` tak, jak přišlo. Žádné `new Date()`
    // — čas na zdi se v pásmu serveru převádět nemá (viz lib/cas.ts).
    p_od: od,
    p_do: doKdy,
    p_poradi: Math.trunc(poradi),
  })

  if (error) zpet(rozsah, '?chyba=' + encodeURIComponent(zkrat(error.message)))

  revalidatePath(`/${rozsah}/nastaveni/sablony`)
  zpet(rozsah, `?stav=${sablona ? 'upravena' : 'zalozena'}`)
}

/**
 * Vyřazení z nabídky a vrácení zpět.
 *
 * Šablona se NEMAŽE. Visí na ní historie a lidé tu zkratku znají;
 * smazaná by navíc uvolnila „D“ a někdo by pod ním založil jiné časy.
 * Na už zadané směny to nemá vliv ani takhle — ty si své časy drží.
 */
export async function prepnoutSablonu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const sablona = String(formData.get('sablona') ?? '').trim()
  const zapnout = String(formData.get('zapnout') ?? '') === 'ano'
  if (!sablona) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('prepnout_sablonu', {
    p_tenant: tenantId,
    p_sablona: sablona,
    p_active: zapnout,
  })

  if (error) zpet(rozsah, '?chyba=' + encodeURIComponent(zkrat(error.message)))

  revalidatePath(`/${rozsah}/nastaveni/sablony`)
  zpet(rozsah, `?stav=${zapnout ? 'vracena' : 'vyrazena'}`)
}
