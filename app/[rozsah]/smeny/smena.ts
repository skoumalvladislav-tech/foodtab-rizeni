'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Založení a úprava směny z kalendáře.
 *
 * Zadání docs/nocni-prace-2026-09-03.md, bod 2.
 *
 * ---------------------------------------------------------------------
 * ČASY SE TU NEPŘEVÁDÍ
 *
 * Z políčka `type="time"` chodí „HH:MM“ a do sloupce `time` se ukládá
 * beze změny. Rozpis je plán: „ve dvě odpoledne“ znamená ve dvě
 * odpoledne na té pobočce, ať je zrovna letní čas nebo zimní.
 *
 * Žádné `new Date()` — ranní chyba (viz docs/odpoved-na-nalez-casu-
 * 2026-09-02.md) vznikla přesně tím, že se hodina na zdi převedla
 * v pásmu serveru.
 *
 * ---------------------------------------------------------------------
 * VAROVÁNÍ NEJSOU CHYBY
 *
 * Překryv a začátek před provozním dnem se vracejí jako varování
 * a směna se uloží. Dělené směny a záskoky existují a aplikace o nich
 * neví dost na to, aby je zakázala — stejná úvaha jako u horní meze
 * u záloh.
 */

export type StavSmeny =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | { stav: 'hotovo'; varovani: string[] }

export async function ulozitSmenu(
  _predchozi: StavSmeny,
  formData: FormData,
): Promise<StavSmeny> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const smena = String(formData.get('smena') ?? '').trim() || null
  const pobocka = String(formData.get('pobocka') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '').trim() || null
  const pozice = String(formData.get('pozice') ?? '').trim() || null
  const den = String(formData.get('den') ?? '')
  const od = String(formData.get('od') ?? '')
  const doKdy = String(formData.get('do') ?? '')
  const poznamka = String(formData.get('poznamka') ?? '')
  /*
    Zkratka šablony se jen OPÍŠE — je to popiska, ne odkaz. Formulář ji
    posílá jen tehdy, když časy pořád odpovídají té šabloně; kdo je
    přepsal, poslal prázdno a v řádku pak žádná zkratka nestojí. „D“
    u směny od devíti do pěti by lhalo.
  */
  const sablona = String(formData.get('sablona') ?? '').trim() || null

  if (!pobocka) return { stav: 'chyba', text: 'Vyberte pobočku.' }
  if (!den || !od || !doKdy) return { stav: 'chyba', text: 'Vyplňte datum a čas od–do.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  /*
    První obranná linie. Druhá je uvnitř `ulozit_smenu`, která si
    `shifts.manage` ověří na TÉ POBOČCE, která přišla — a při úpravě
    i na té původní. Pobočka z prohlížeče je návrh (pravidlo 4).
  */
  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Plánovat směny nemáte oprávnění.' }
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('ulozit_smenu', {
    p_tenant: tenantId,
    p_smena: smena,
    p_branch: pobocka,
    p_employee: zamestnanec,
    p_position: pozice,
    p_den: den,
    // „HH:MM“ jde do `time` tak, jak přišlo. Viz hlavička.
    p_od: od,
    p_do: doKdy,
    p_poznamka: poznamka,
    p_sablona_key: sablona,
  })

  // Hlášku píše databáze a je pro člověka — projde se dál, ať se
  // nevymýšlí druhá.
  if (error) return { stav: 'chyba', text: error.message }

  const r = (data as { smena: string; varovani: string[] }[])?.[0]
  if (!r?.smena) return { stav: 'chyba', text: 'Směna se nezapsala.' }

  revalidatePath(`/${rozsah}/smeny`)

  return { stav: 'hotovo', varovani: r.varovani ?? [] }
}
