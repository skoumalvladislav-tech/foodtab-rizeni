'use server'

import { revalidatePath } from 'next/cache'

import { getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { vyzadujePotvrzeni, zmenaSmeny, type TeloUpozorneni } from '@/lib/upozorneni-text'

/**
 * Upozornění a potvrzení u konkrétní směny — pro Detail směny.
 *
 * ---------------------------------------------------------------------
 * DVĚ STRANY TÉŽE VĚCI
 *
 *   `moje`      upozornění, které dostal PŘIHLÁŠENÝ — může ho potvrdit.
 *               Čte se z `notifications` (RLS: každý jen svoje) a navíc
 *               filtrem `user_id`, ať se nespoléhá na jedinou linii.
 *   `vedouci`   kdy dotčený člověk upozornění dostal, přečetl a
 *               potvrdil. Jde přes `stav_potvrzeni_smeny`: vrací jen
 *               časy a jméno a ověřuje `shifts.manage` na pobočce TÉ
 *               SMĚNY. Obsah cizího upozornění se sem nikdy nedostane.
 *
 * Obojí je NEPOVINNÉ. Migrace 20260919120000 se nasazuje ručně a kód
 * sám; dokud neproběhne, sloupec `shift_id` a průzor neexistují — detail
 * se pak jen ukáže bez potvrzení, nespadne.
 *
 * OTEVŘENÍ DETAILU JE PŘEČTENÍ. Kdo si směnu rozklikne, upozornění na ni
 * si přečetl; bez toho by vedoucí u člověka, který změnu viděl, vždycky
 * četl „nepřečteno“. Čas přečtení se přitom nepřepisuje.
 */

export type MojeUpozorneni = {
  id: string
  druh: string
  puvodne: string | null
  nove: string | null
  potvrzeno_at: string | null
  /** Vyžaduje tenhle druh výslovné potvrzení (tlačítko)? */
  vyzaduje: boolean
}

export type UpozorneniVedouciho = {
  jmeno: string
  druh: string
  prijato_at: string
  precteno_at: string | null
  potvrzeno_at: string | null
}

export type StavUpozorneniSmeny = {
  moje: MojeUpozorneni | null
  vedouci: UpozorneniVedouciho | null
}

const PRAZDNO: StavUpozorneniSmeny = { moje: null, vedouci: null }

export async function nactiStavSmeny(smenaId: string): Promise<StavUpozorneniSmeny> {
  if (!smenaId) return PRAZDNO

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return PRAZDNO
  const user = await getUser()
  if (!user) return PRAZDNO

  const supabase = await getServerSupabase()
  const stav: StavUpozorneniSmeny = { moje: null, vedouci: null }

  /* --- moje upozornění --------------------------------------------- */

  const { data: radky, error: chybaMoje } = await supabase
    .from('notifications')
    .select('id, druh, telo, read_at, acknowledged_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .eq('shift_id', smenaId)
    .in('druh', ['smena.nova', 'smena.zmenena'])
    .order('created_at', { ascending: false })
    .limit(1)

  // Chyba (typicky chybějící sloupec před nasazením migrace) = žádné
  // upozornění. Detail se ukáže, jen bez potvrzení.
  const radek = chybaMoje ? null : (radky?.[0] as
    | { id: string; druh: string; telo: TeloUpozorneni; read_at: string | null; acknowledged_at: string | null }
    | undefined)

  if (radek) {
    if (!radek.read_at) {
      await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', radek.id)
        .eq('tenant_id', tenantId)
        .eq('user_id', user.id)
        .is('read_at', null)
    }

    const zmena = zmenaSmeny(radek.telo ?? {})
    stav.moje = {
      id: radek.id,
      druh: radek.druh,
      puvodne: zmena?.puvodne ?? null,
      nove: zmena?.nove ?? null,
      potvrzeno_at: radek.acknowledged_at ?? null,
      vyzaduje: vyzadujePotvrzeni(radek.druh),
    }
  }

  /* --- pro vedoucího ----------------------------------------------- */

  const { data: vedouci, error: chybaVedouci } = await supabase.rpc('stav_potvrzeni_smeny', {
    p_tenant: tenantId,
    p_smena: smenaId,
  })
  // Bez práva, nebo před nasazením migrace, je to chyba — a pro obrazovku
  // to znamená jen „tenhle pohled není“.
  if (!chybaVedouci && Array.isArray(vedouci) && vedouci[0]) {
    const v = vedouci[0] as UpozorneniVedouciho
    stav.vedouci = {
      jmeno: v.jmeno,
      druh: v.druh,
      prijato_at: v.prijato_at,
      precteno_at: v.precteno_at ?? null,
      potvrzeno_at: v.potvrzeno_at ?? null,
    }
  }

  return stav
}

/**
 * Potvrzení změny z detailu směny.
 *
 * Stejná úvaha jako `potvrditZmenu` u upozornění: politika pustí úpravu
 * jen u vlastních řádků, id se ověřuje proti přihlášenému, a potvrdit jde
 * jen druh, který to vyžaduje (`vyzadujePotvrzeni`, jediné místo s tímhle
 * pravidlem). Čas přečtení se nepřepisuje — potvrzení a přečtení jsou dva
 * okamžiky a vedoucí je vidí zvlášť.
 */
export async function potvrditZmenuSmeny(
  notifikaceId: string,
  rozsah: string,
): Promise<{ stav: 'ok' } | { stav: 'chyba'; text: string }> {
  if (!notifikaceId) return { stav: 'chyba', text: 'Nevím, co potvrdit.' }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }
  const user = await getUser()
  if (!user) return { stav: 'chyba', text: 'Nejste přihlášeni.' }

  const supabase = await getServerSupabase()
  const ted = new Date().toISOString()

  const { data, error } = await supabase
    .from('notifications')
    .update({ acknowledged_at: ted })
    .eq('id', notifikaceId)
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .in('druh', DRUHY_S_POTVRZENIM)
    .is('acknowledged_at', null)
    .select('id')

  if (error) return { stav: 'chyba', text: 'Potvrzení se nepodařilo uložit.' }
  if (!data || data.length === 0) {
    // Buď už je potvrzeno, nebo to není upozornění, které jde potvrdit.
    // Pro člověka je výsledek stejný: nic dalšího dělat nemusí.
    return { stav: 'ok' }
  }

  // Potvrzení znamená i přečtení — ale jen když ještě přečtené nebylo.
  await supabase
    .from('notifications')
    .update({ read_at: ted })
    .eq('id', notifikaceId)
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('read_at', null)

  revalidatePath(`/${rozsah}`, 'layout')
  return { stav: 'ok' }
}

/** `.in()` chce pole, ne funkci — a musí sedět s vyzadujePotvrzeni(). */
const DRUHY_S_POTVRZENIM = ['smena.zmenena', 'smena.zrusena'].filter(vyzadujePotvrzeni)
