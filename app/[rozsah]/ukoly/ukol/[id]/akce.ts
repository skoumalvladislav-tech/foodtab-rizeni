'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getServerSupabase } from '@/lib/supabase/server'
import { zakladZRozsahu } from '../../../vzkazy/zaklad'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Označit úkol za hotový z jeho detailu.
 *
 * Jde přes `public.complete_task()` stejně jako odškrtnutí v seznamu: politika
 * `tasks_write` žádá `tasks.manage` na jakoukoli změnu úkolu, takže adresát by
 * si vlastní úkol zavřít nemohl. Funkce mění jen status, done_at a done_by a
 * sama rozhodne, kdo na to má právo (a zapíše do auditu).
 */
export async function dokoncitUkolZDetailu(formData: FormData): Promise<void> {
  const z = await zakladZRozsahu(String(formData.get('rozsah') ?? ''))
  if (!z) return

  const ukol = String(formData.get('ukol') ?? '')
  if (!UUID.test(ukol)) return

  const detail = `/${z.rozsah}/ukoly/ukol/${ukol}`
  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('complete_task', { p_task: ukol })

  if (error) {
    // 42501 = insufficient_privilege, P0002 = no_data_found: funkce je
    // vyhazuje schválně; kód je spolehlivější než text hlášky.
    const text =
      error.code === '42501'
        ? 'Tenhle úkol nemůžete uzavřít.'
        : error.code === 'P0002'
          ? 'Úkol už neexistuje.'
          : 'Úkol se nepodařilo uzavřít, zkuste to znovu.'
    redirect(`${detail}?chyba=${encodeURIComponent(text)}`)
  }

  revalidatePath(detail)
  revalidatePath(`/${z.rozsah}/ukoly`)
  redirect(detail)
}
