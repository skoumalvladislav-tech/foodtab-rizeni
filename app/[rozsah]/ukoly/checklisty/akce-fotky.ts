'use server'

import { revalidatePath } from 'next/cache'

import { KBELIK_FOTEK, MAX_BAJTU_FOTKY, cestaSedi, jeTypFotky } from '@/lib/checklisty/fotky'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { UUID, zaklad } from '../zaklad'

/**
 * Připojení fotky k položce checklistu.
 *
 * Soubor už je v úložišti — nahrál ho prohlížeč rovnou (Server Action má
 * strop 1 MB na tělo požadavku, fotka z telefonu je větší). Tahle akce
 * jen ověří, že cesta patří TÉHLE firmě, běhu a položce, a zavolá
 * public.pripojit_checklist_fotku, která to ověří znovu (spolu s právem,
 * stavem běhu a stropem počtu).
 *
 * Když připojení selže, soubor se uklidí — politika úložiště
 * `checklist_fotky_delete_sirotka` smazání dovolí jen dokud na soubor
 * žádná fotka neukazuje.
 */
export async function pripojitFotku(vstup: {
  rozsah: string
  beh: string
  polozka: string
  cesta: string
  nazev: string
  mime: string
  velikost: number
}): Promise<{ ok: true } | { ok: false; chyba: string }> {
  const { rozsah, beh, polozka, cesta, nazev, mime, velikost } = vstup
  if (!UUID.test(beh) || !UUID.test(polozka)) return { ok: false, chyba: 'Neplatná položka.' }

  const z = await zaklad(rozsah)
  if (!z) return { ok: false, chyba: 'Nejste přihlášen(a).' }

  const supabase = await getServerSupabase()
  const uklidit = async () => {
    await supabase.storage.from(KBELIK_FOTEK).remove([cesta])
  }

  if (!cestaSedi(cesta, z.tenantId, beh, polozka) || !jeTypFotky(mime) || !(velikost > 0 && velikost <= MAX_BAJTU_FOTKY)) {
    await uklidit()
    return { ok: false, chyba: 'Fotka neodpovídá téhle položce.' }
  }

  const { error } = await supabase.rpc('pripojit_checklist_fotku', {
    p_run: beh,
    p_item: polozka,
    p_cesta: cesta,
    p_nazev: nazev,
    p_mime: mime,
    p_velikost: Math.round(velikost),
  })

  if (error) {
    // 23505 = tahle cesta už připojená je (opakování po výpadku) — hotovo.
    if (error.code === '23505') return { ok: true }
    await uklidit()
    return {
      ok: false,
      chyba: funkceNeexistuje(error) ? 'Fotky budou dostupné po nasazení databáze.' : error.message,
    }
  }

  revalidatePath(`/${rozsah}/ukoly/checklisty/${beh}`, 'layout')
  return { ok: true }
}
