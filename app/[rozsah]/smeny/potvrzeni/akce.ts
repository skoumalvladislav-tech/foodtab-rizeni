'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Potvrzovací tabulka směn — zápisy.
 *
 * Zadání Šéfíka 29. 9. 2026: hromadné potvrzení všech směn a možnost
 * jednu (nebo víc) odmítnout. Všechno jde přes RPC v databázi
 * (`potvrdit_smenu`, `potvrdit_vsechny_moje_smeny`, `odmitnout_smenu`,
 * migrace 20260929100000) — aplikace do `smeny_potvrzeni` přímo
 * nezapisuje. Čí je která směna a kdo je „já“, rozhoduje pokaždé
 * databáze (auth.uid() → employees), odsud jde jen id směny a u
 * odmítnutí povinný důvod.
 *
 * Hlášku z databáze (PT403/PT409/check_violation) je pro člověka a jde
 * dál beze změny — vymýšlet druhou by ji jen zdvojilo.
 */

const adresaPotvrzeni = (rozsah: string) => `/${rozsah}/smeny/potvrzeni`

/** Nenasazená migrace se překládá tady; jinak jde chyba z RPC beze změny. */
function textChyby(chyba: { message: string } | null): string | null {
  if (!chyba) return null
  return funkceNeexistuje(chyba)
    ? 'Potvrzování směn čeká na nasazení databáze.'
    : chyba.message
}

/**
 * „Potvrdit vše“ nahoře tabulky — potvrdí všechny vydané, dosud
 * nerozhodnuté směny volajícího (`public.potvrdit_vsechny_moje_smeny`).
 * Nic se nevybírá: databáze sama pozná, co je moje a nerozhodnuté.
 */
export async function potvrditVsechnyMojeSmeny(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zpet = adresaPotvrzeni(rozsah)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('potvrdit_vsechny_moje_smeny', {
    p_tenant: tenantId,
  })

  const text = textChyby(error)
  if (text) redirect(`${zpet}?chyba=${encodeURIComponent(text)}`)

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=vse&pocet=${Number(data ?? 0)}`)
}

/**
 * Potvrzení JEDNÉ směny z řádku tabulky (`public.potvrdit_smenu`).
 * Znění (den, časy, pauza) jde z řádku, který člověk na obrazovce vidí —
 * nesedí-li už s databází (směna se mezitím změnila), RPC potvrzení
 * odmítne (PT409) a po obnovení se řádek ukáže v novém znění.
 */
export async function potvrditRadekSmeny(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zpet = adresaPotvrzeni(rozsah)
  const smena = String(formData.get('smena') ?? '')
  if (!smena) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('potvrdit_smenu', {
    p_tenant: tenantId,
    p_smena: smena,
    p_den: String(formData.get('den') ?? ''),
    p_od: String(formData.get('od') ?? ''),
    p_do: String(formData.get('do') ?? ''),
    p_pauza_od: (formData.get('pauza_od') as string | null) || null,
    p_pauza_do: (formData.get('pauza_do') as string | null) || null,
  })

  const text = textChyby(error)
  if (text) redirect(`${zpet}?chyba=${encodeURIComponent(text)}`)

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=jedna`)
}

/**
 * Odmítnutí SVÉ vydané směny s povinným důvodem
 * (`public.odmitnout_smenu`). Žádné „znění, které vidím“ se neposílá —
 * odmítnutí není tvrzení o obsahu, jen že tuhle směnu člověk nechce/
 * nemůže vzít (viz migrace, bod 5). Databáze zároveň notifikuje vedoucí
 * pobočky (`app.notifikovat`, `smena.odmitnuta`) — odsud se nic dalšího
 * neposílá.
 */
export async function odmitnoutSmenu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zpet = adresaPotvrzeni(rozsah)
  const smena = String(formData.get('smena') ?? '')
  const duvod = String(formData.get('duvod') ?? '').trim()
  if (!smena) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('odmitnout_smenu', {
    p_tenant: tenantId,
    p_smena: smena,
    p_duvod: duvod,
  })

  const text = textChyby(error)
  if (text) redirect(`${zpet}?chyba=${encodeURIComponent(text)}`)

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=odmitnuto`)
}
