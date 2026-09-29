'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import { getServerSupabase } from '@/lib/supabase/server'
import { odkazUpozorneni } from '@/lib/upozorneni-odkaz'
import { pocetUpozorneni, vyzadujePotvrzeni, type TeloUpozorneni } from '@/lib/upozorneni-text'
import { zakladZRozsahu } from '../vzkazy/zaklad'

/**
 * Akce panelu u zvonečku (27. 9.).
 *
 * Do té doby panel jen náhlížel a každá položka vedla na obecnou
 * stránku Upozornění. Teď klepnutí upozornění označí za přečtené
 * a otevře věc, ke které patří.
 *
 * Z formuláře se bere JEN id upozornění a rozsah. Cíl se počítá
 * z uloženého řádku (`odkazUpozorneni`), ne z formuláře — jinak by šlo
 * podstrčit odkaz kamkoli (pravidlo 4). Řádek pustí RLS jen vlastníkovi;
 * `user_id` je v dotazu navíc, ať je z něj vidět, čí řádky to jsou.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function otevritUpozorneni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')

  const z = await zakladZRozsahu(rozsah)
  if (!z) redirect('/')
  const user = await getUser()
  if (!user) redirect('/prihlaseni')
  if (!UUID.test(id)) redirect(`/${z.rozsah}/upozorneni`)

  const supabase = await getServerSupabase()
  const { data: radek } = await supabase
    .from('notifications')
    .select('id, druh, telo, shift_id, zdroj_typ, zdroj_id, read_at, acknowledged_at')
    .eq('id', id)
    .eq('tenant_id', z.tenantId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!radek) redirect(`/${z.rozsah}/upozorneni`)

  /*
    Změna nebo zrušení směny, kterou člověk ještě NEPOTVRDIL, se klepnutím
    za přečtenou neoznačí (28. 9.). Přečte se až tlačítkem „Potvrdit“ na
    stránce Upozornění (to zapíše acknowledged_at i read_at). Do té doby
    ji klepnutí označilo a kdo stránku zavřel, neměl ve zvonečku nic,
    co by mu nepotvrzenou změnu připomnělo.
  */
  const cekaNaPotvrzeni = vyzadujePotvrzeni(String(radek.druh)) && !radek.acknowledged_at

  if (!radek.read_at && !cekaNaPotvrzeni) {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', z.tenantId)
      .eq('user_id', user.id)
  }

  // „Nový vzkaz“ nese id ZPRÁVY. Rozhovor se dohledá přes RLS — kdo už
  // účastníkem není, nic nenajde a skončí na seznamu rozhovorů. Jen když
  // za upozorněním stojí jedna zpráva: sloučené „3 nové zprávy“ můžou být
  // ze tří rozhovorů a vedou na nepřečtené (`odkazUpozorneni`).
  let konverzace: string | null = null
  if (
    radek.druh === 'vzkaz.novy' &&
    pocetUpozorneni((radek.telo ?? {}) as TeloUpozorneni) === 1 &&
    radek.zdroj_typ === 'zprava' &&
    UUID.test(String(radek.zdroj_id ?? ''))
  ) {
    const { data: zprava } = await supabase
      .from('konverzace_zpravy')
      .select('konverzace_id')
      .eq('id', radek.zdroj_id as string)
      .maybeSingle()
    konverzace = (zprava?.konverzace_id as string | undefined) ?? null
  }

  const cil = odkazUpozorneni(
    z.rozsah,
    {
      druh: String(radek.druh),
      telo: (radek.telo ?? {}) as TeloUpozorneni,
      shift_id: (radek.shift_id as string | null) ?? null,
      zdroj_typ: (radek.zdroj_typ as string | null) ?? null,
      zdroj_id: (radek.zdroj_id as string | null) ?? null,
    },
    konverzace,
  )

  revalidatePath(`/${z.rozsah}`, 'layout')
  redirect(cil)
}

/**
 * „Označit vše za přečtené“ z panelu zvonečku. Zůstává se na místě —
 * na rozdíl od stejnojmenné akce stránky Upozornění, která se na ni
 * vrací. Nepřečtené ROZHOVORY a OZNÁMENÍ se tím neoznačí: ty se čtou
 * otevřením rozhovoru a „Beru na vědomí“, ne hromadně.
 */
export async function oznacitVsePrectene(formData: FormData): Promise<void> {
  const z = await zakladZRozsahu(String(formData.get('rozsah') ?? ''))
  if (!z) return
  const user = await getUser()
  if (!user) return

  const supabase = await getServerSupabase()
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', z.tenantId)
    .eq('user_id', user.id)
    .is('read_at', null)

  revalidatePath(`/${z.rozsah}`, 'layout')
}
