'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getServerSupabase } from '@/lib/supabase/server'
import { zaklad } from './zaklad'

/**
 * Akce úkolů. Checklisty mají vlastní soubor (checklisty/akce.ts).
 *
 * Společné pravidlo: z formuláře se berou jen identifikátory a hodnoty,
 * nikdy ne firma, pobočka ani zaměstnanec (zaklad.ts). Vlastní
 * rozhodnutí o právu zůstává na databázi.
 */

/**
 * Odškrtnutí úkolu.
 *
 * Jde přes public.complete_task(), ne přes update. Politika tasks_write
 * žádá tasks.manage na jakoukoli změnu úkolu, takže adresát by si vlastní
 * úkol zavřít nemohl. Funkce mění jen status, done_at a done_by a sama
 * rozhodne, kdo na to má — aplikace se neptá dopředu, jen ukáže výsledek.
 */
export async function dokoncitUkol(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const ukolId = String(formData.get('ukol') ?? '')
  if (!ukolId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('complete_task', { p_task: ukolId })

  if (error) {
    // 42501 = insufficient_privilege, P0002 = no_data_found. Obojí funkce
    // vyhazuje schválně; kód je spolehlivější než text hlášky.
    const duvod =
      error.code === '42501'
        ? 'cizi'
        : error.code === 'P0002'
          ? 'chybi'
          : 'nepovedlo'
    redirect(`/${rozsah}/ukoly?ukol=${ukolId}&chyba=${duvod}`)
  }

  revalidatePath(`/${rozsah}/ukoly`)
}

/**
 * Zadání úkolu.
 *
 * JEDEN CÍL NA ÚKOL. Z formuláře chodí přepínač `komu` a k němu tři
 * možné hodnoty; použije se jen ta, na kterou přepínač ukazuje.
 * Ostatní se schválně zahodí — kdyby se posílaly všechny vyplněné,
 * dal by se odesláním upraveného formuláře poslat úkol dvěma adresátům
 * naráz. Databáze to sice odmítne (`tasks_jeden_cil` a průzor
 * `zadat_ukol`), ale spoléhat na to, že to chytí až poslední linie,
 * není důvod pouštět nesmysl.
 *
 * PRIORITA: jen běžná a přednostní (high). Třetí úroveň „kritická" je
 * vyhrazená úkolům z checklistu (Šéfík 23. 9.) a zadat_ukol ji i tak
 * srazí.
 *
 * TERMÍN SE NEPŘEVÁDÍ TADY. `datetime-local` je hodina na zdi bez
 * pásma a přesně tak se posílá dál; okamžik z ní dělá databáze podle
 * pásma pobočky. `new Date('2026-09-07T22:00')` by ten řetězec přečetl
 * v pásmu serveru — a ten je na Vercelu v UTC (pravidlo 11).
 */
export async function zadatUkol(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zaklad(rozsah)
  if (!z) return

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (nazev === '') return

  const komu = String(formData.get('komu') ?? 'pobocka')
  const vybrane = (klic: string): string | null => {
    const v = String(formData.get(klic) ?? '').trim()
    return v === '' ? null : v
  }

  const usek = komu === 'usek' ? vybrane('usek') : null
  const pozice = komu === 'pozice' ? vybrane('pozice') : null
  const clovek = komu === 'clovek' ? vybrane('clovek') : null

  // Přepínač ukazuje na adresáta, ale výběr zůstal prázdný. Radši nic
  // než úkol, který zní na někoho jiného, než kdo ho měl dostat.
  if (komu !== 'pobocka' && usek === null && pozice === null && clovek === null) {
    redirect(`/${rozsah}/ukoly?chyba=bez-adresata`)
  }

  const termin = String(formData.get('termin') ?? '').trim()
  const priorita = String(formData.get('priorita') ?? '') === 'high' ? 'high' : 'normal'

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('zadat_ukol', {
    p_tenant: z.tenantId,
    p_branch: z.branchId,
    p_nazev: nazev,
    p_poznamka: String(formData.get('poznamka') ?? '').trim(),
    // Prázdný řetězec ≠ „teď“. Bez termínu se posílá NULL.
    p_termin: termin === '' ? null : termin,
    p_priorita: priorita,
    p_usek: usek,
    p_pozice: pozice,
    p_clovek: clovek,
  })

  // Hlášku psala databáze a je pro člověka — nepřepisuje se.
  if (error) {
    redirect(`/${rozsah}/ukoly?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/ukoly`)
  redirect(`/${rozsah}/ukoly`)
}
