'use server'

import { getServerSupabase } from '@/lib/supabase/server'
import { getUser } from '@/lib/authz'

/**
 * Přijetí pozvánky.
 *
 * Volá public.accept_invitation, která je průzor do app.accept_invitation.
 * Vrací {success, chyba}.
 */
export async function prijmoutPozvankuAction(
  token: string
): Promise<{
  success?: boolean
  chyba?: string
}> {
  const user = await getUser()
  if (!user) return { chyba: 'Musíte se přihlásit' }

  const supabase = await getServerSupabase()

  // RPC call
  const { data, error } = await supabase.rpc('accept_invitation', {
    p_token: token,
  })

  if (error) {
    console.error('accept_invitation error:', error)

    // Chyby z SQL
    if (error.code === '42501') {
      return { chyba: 'Token není platný (42501)' }
    }
    if (error.code === '42P02') {
      return { chyba: 'Token neexistuje nebo vypršel (42P02)' }
    }

    return { chyba: error.message || 'Chyba při přijetí pozvánky' }
  }

  if (!data) {
    return { chyba: 'Pozvánka nebyla přijata' }
  }

  return { success: true }
}
