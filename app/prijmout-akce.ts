'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Přijetí čekající pozvánky zevnitř aplikace.
 *
 * Bez tokenu: kdo se přihlásil adresou, na kterou pozvánka přišla,
 * prošel přesně tou kontrolou, kterou pozvánka dělá. Shodu adresy
 * ověřuje `app.prijmout_pozvanku` znovu — tohle je pohodlí, ne
 * povolení.
 */

export type StavPrijeti = { stav: 'nic' } | { stav: 'chyba'; text: string }

export async function prijmoutMojiPozvanku(
  _predchozi: StavPrijeti,
  formData: FormData,
): Promise<StavPrijeti> {
  const pozvanka = String(formData.get('pozvanka') ?? '')
  if (!pozvanka) return { stav: 'chyba', text: 'Chybí, kterou pozvánku přijmout.' }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('prijmout_moji_pozvanku', {
    p_pozvanka: pozvanka,
  })

  /*
    Hlášku píše databáze a je pro člověka: „Pozvánka byla vystavena na
    jinou e-mailovou adresu“ řekne víc než cokoli, co bychom napsali
    tady. Chybové kódy jsou na větvení, ne na text.
  */
  if (error) return { stav: 'chyba', text: error.message }

  revalidatePath('/', 'layout')
  redirect('/')
}
