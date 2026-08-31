'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { provozniDen } from '@/lib/provozni-den'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Akce úkolů a checklistů.
 *
 * Společné pravidlo: z formuláře se berou jen identifikátory a hodnoty,
 * nikdy ne firma, pobočka ani zaměstnanec. Ty se dohledávají na serveru,
 * aby se nedaly podvrhnout. Vlastní rozhodnutí o právu zůstává na
 * databázi — tyhle funkce jen nesmí poslat nesmysl.
 */

type Zaklad = {
  tenantId: string
  employeeId: string | null
  branchId: string | null
  rozsah: string
}

async function zaklad(rozsah: string): Promise<Zaklad | null> {
  const user = await getUser()
  if (!user) return null

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null

  const ctx = await getContext(tenantId)
  if (!ctx) return null

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return null

  const supabase = await getServerSupabase()
  const { data, error: chybaJa } = await supabase
    .from('employees')
    .select('id, branch_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .limit(1)
  if (chybaJa) throw new DotazSelhal('můj zaměstnanecký záznam', chybaJa)

  const ja = data?.[0] as { id: string; branch_id: string | null } | undefined

  return {
    tenantId,
    employeeId: ja?.id ?? null,
    branchId: scope.branchId ?? ja?.branch_id ?? null,
    rozsah,
  }
}

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
 * Spuštění checklistu na dnešní provozní den.
 *
 * Dvojice (šablona, pobočka, provozní den) je v databázi jedinečná, takže
 * druhé kliknutí nevyrobí druhý běh — konflikt se ignoruje a pokračuje se
 * v tom existujícím.
 */
export async function spustitChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const sablonaId = String(formData.get('sablona') ?? '')
  if (!sablonaId) return

  const z = await zaklad(rozsah)
  if (!z || !z.branchId) return

  const den = await provozniDen(z.branchId)
  if (!den) return

  const supabase = await getServerSupabase()
  await supabase.from('checklist_runs').upsert(
    {
      tenant_id: z.tenantId,
      branch_id: z.branchId,
      template_id: sablonaId,
      business_date: den,
    },
    { onConflict: 'template_id,branch_id,business_date', ignoreDuplicates: true },
  )

  revalidatePath(`/${rozsah}/ukoly`)
}

/**
 * Zápis jedné položky checklistu.
 *
 * Meze a typ hodnoty se čtou z databáze, ne z formuláře — jinak by si je
 * volající mohl přepsat. Když hodnota neprojde, vracíme se zpět na
 * stránku s ?polozka= a ?chyba=, aby se hláška dala vykreslit přímo
 * u dotčené položky. Serverově, bez stavu na straně prohlížeče.
 */
export async function zapsatPolozku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const runId = String(formData.get('beh') ?? '')
  const itemId = String(formData.get('polozka') ?? '')
  const hodnotaRaw = String(formData.get('hodnota') ?? '').trim()
  if (!runId || !itemId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const supabase = await getServerSupabase()

  const { data: polozky, error: chybaPolozky } = await supabase
    .from('checklist_items')
    .select('id, requires_value, value_type, min_value, max_value')
    .eq('id', itemId)
    .limit(1)
  if (chybaPolozky) throw new DotazSelhal('položka checklistu', chybaPolozky)

  const polozka = polozky?.[0] as
    | {
        id: string
        requires_value: boolean
        value_type: string | null
        min_value: number | null
        max_value: number | null
      }
    | undefined
  if (!polozka) return

  let valueNumber: number | null = null
  let valueText: string | null = null

  // Důvod odmítnutí, se kterým se vrátíme zpět na stránku. Vlastní
  // přesměrování je až za tímhle blokem: redirect() vyhazuje výjimku
  // a uvnitř větvení by se hůř četlo, co se kdy stane.
  let chyba: string | null = null

  if (polozka.requires_value) {
    if (hodnotaRaw === '') {
      chyba = 'prazdna'
    } else if (polozka.value_type === 'number') {
      const cislo = Number(hodnotaRaw.replace(',', '.'))
      if (!Number.isFinite(cislo)) {
        chyba = 'cislo'
      } else if (
        (polozka.min_value !== null && cislo < polozka.min_value) ||
        (polozka.max_value !== null && cislo > polozka.max_value)
      ) {
        chyba = 'meze'
      } else {
        valueNumber = cislo
      }
    } else if (polozka.value_type === 'text') {
      valueText = hodnotaRaw
    } else {
      // 'photo' zatím neumíme nahrávat.
      chyba = 'foto'
    }
  }

  if (chyba) {
    redirect(`/${rozsah}/ukoly/${runId}?polozka=${itemId}&chyba=${chyba}`)
  }

  await supabase.from('checklist_entries').upsert(
    {
      run_id: runId,
      item_id: itemId,
      checked: true,
      value_number: valueNumber,
      value_text: valueText,
      employee_id: z.employeeId,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: 'run_id,item_id' },
  )

  revalidatePath(`/${rozsah}/ukoly/${runId}`)
}

/** Uzavření checklistu, když jsou všechny položky hotové. */
export async function uzavritChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const runId = String(formData.get('beh') ?? '')
  if (!runId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const supabase = await getServerSupabase()
  await supabase
    .from('checklist_runs')
    .update({ status: 'done', finished_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('tenant_id', z.tenantId)

  revalidatePath(`/${rozsah}/ukoly`)
}
