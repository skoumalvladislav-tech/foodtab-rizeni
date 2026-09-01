'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { naHalere } from '@/lib/mzdy'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zálohy — zápisy.
 *
 * Všechno jde přes průzory v databázi (`vyplatit_zalohu`,
 * `stornovat_zalohu`). Do tabulky `advances` nemá aplikace právo
 * zapisovat přímo: kdyby měla, dal by se cizí zálohu dopsat i potvrdit.
 *
 * Rozhodnutí padá tam, ne tady. Kontrola přístupu na začátku je první
 * obranná linie (pravidlo 3), ne jediná.
 */

export type StavVyplaceni =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | { stav: 'hotovo'; komu: string; castka: string; varovani: string | null }

export async function vyplatitZalohu(
  _predchozi: StavVyplaceni,
  formData: FormData,
): Promise<StavVyplaceni> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '')
  const castkaText = String(formData.get('castka') ?? '')
  const poznamka = String(formData.get('poznamka') ?? '').trim()

  if (!zamestnanec) return { stav: 'chyba', text: 'Vyberte, komu se záloha vyplácí.' }

  const halere = naHalere(castkaText)
  if (halere === null || halere <= 0) {
    return {
      stav: 'chyba',
      text: 'Částka musí být kladné číslo v korunách, nejvýš na dvě desetinná místa.',
    }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  const pristup = await zkusPristup(tenantId, 'advances.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Na vyplácení záloh nemáte oprávnění.' }
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('vyplatit_zalohu', {
    p_tenant: tenantId,
    p_employee: zamestnanec,
    p_castka: halere,
    p_poznamka: poznamka,
  })

  // Hlášku psala databáze a je pro člověka — projde se dál, ať se
  // nevymýšlí druhá.
  if (error) return { stav: 'chyba', text: error.message }

  const r = (data as { zaloha: string; varovani: string | null }[])?.[0]
  if (!r?.zaloha) return { stav: 'chyba', text: 'Záloha se nezapsala.' }

  const { data: kdo } = await supabase
    .from('employees')
    .select('full_name')
    .eq('id', zamestnanec)
    .maybeSingle()

  revalidatePath(`/${rozsah}/zalohy`)

  return {
    stav: 'hotovo',
    komu: kdo?.full_name ?? 'zaměstnanci',
    castka: castkaText.trim(),
    varovani: r.varovani,
  }
}

export async function stornovatZalohu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zaloha = String(formData.get('zaloha') ?? '')
  const duvod = String(formData.get('duvod') ?? '').trim()

  const zpet = `/${rozsah}/zalohy`
  if (!zaloha) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'advances.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('stornovat_zalohu', {
    p_tenant: tenantId,
    p_zaloha: zaloha,
    p_duvod: duvod,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=storno`)
}

/**
 * Volba, jak se zálohy ukazují zaměstnancům.
 *
 * Mění JEN zobrazení, nikdy uložené záznamy — přepnutí tedy nic
 * nepřepočítává a projeví se hned i zpětně. Do auditu jde v databázi.
 */
export async function ulozitNastaveniZaloh(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const volba = String(formData.get('zobrazeni') ?? 'odecitat')
  const mezText = String(formData.get('mez') ?? '').trim()

  const zpet = `/${rozsah}/zalohy`

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  // Prázdná mez znamená „firma žádnou nestanovila“, ne nulu.
  const mez = mezText === '' ? null : naHalere(mezText)
  if (mezText !== '' && (mez === null || mez <= 0)) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Horní mez musí být kladné číslo, nebo prázdná.')}`)
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_zalohy_zobrazeni', {
    p_tenant: tenantId,
    p_volba: volba,
    p_max_haleru: mez,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  // I obrazovka výdělku — volba mění, co na ní zaměstnanec uvidí.
  revalidatePath('/', 'layout')
  redirect(`${zpet}?ulozeno=nastaveni`)
}
