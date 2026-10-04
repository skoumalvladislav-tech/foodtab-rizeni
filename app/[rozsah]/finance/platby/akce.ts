'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { naHalere } from '@/lib/mzdy'

async function pripravit(rozsah: string, pravo: 'finance.read' | 'finance.manage') {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/platby`)

  return { supabase: await getServerSupabase(), tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

export async function zalozitPlatebniUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const nazev = String(formData.get('nazev') ?? '').trim()
  const typ = String(formData.get('typ') ?? '')
  if (!nazev || !['banka', 'pokladna', 'karta'].includes(typ)) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyplňte název a typ účtu.')}`)
  }

  const branchId = nepovinnePole(formData, 'branch_id')

  const { error } = await supabase.from('platebni_ucty').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    nazev,
    typ,
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Účet se nepodařilo uložit.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

export async function zapsatTransakci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const ucetId = String(formData.get('ucet_id') ?? '')
  const smer = String(formData.get('smer') ?? '')
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const datum = String(formData.get('datum') ?? '')

  if (!ucetId || !['prijem', 'vydaj'].includes(smer) || castka === null || castka <= 0 || !datum) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyplňte účet, směr, částku a datum.')}`)
  }

  const { error } = await supabase.from('transakce').insert({
    tenant_id: tenantId,
    ucet_id: ucetId,
    smer,
    castka_haleru: castka,
    datum,
    protistrana: nepovinnePole(formData, 'protistrana') ?? '',
    vs: nepovinnePole(formData, 'vs') ?? '',
    poznamka: nepovinnePole(formData, 'poznamka') ?? '',
    zdroj: 'rucni',
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Platbu se nepodařilo zapsat.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

/**
 * Potvrzení návrhu párování — vždy lidský klik, nikdy automaticky
 * (zadání, oddíl 5). Zapisuje VÝHRADNĖ přes `app.potvrdit_alokaci_platby`
 * (20261004100000) — přímý INSERT do `platby_faktury` appka od téhle
 * migrace nemá (grant odebraný), protože jen tahle RPC hlídá souběh
 * (advisory zámek) a to, že alokace nepřesáhne ani částku platby, ani
 * nezaplacený zůstatek faktury. Stav Faktur (`invoices.status`) se
 * pak zapisuje best-effort podle toho, jestli RPC vrátila
 * `plne_uhrazeno` — PLNĖ, nebo ČÁSTEČNĖ, nikdy natvrdo „Uhrazeno"
 * jako dřív (ta chyba dovolila, aby částečná úhrada appku nahlásila
 * jako plně zaplacenou fakturu).
 */
export async function potvrditParovani(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const transakceId = String(formData.get('transakce_id') ?? '')
  const fakturaId = String(formData.get('faktura_id') ?? '')
  const castkaHaleru = Number(formData.get('castka_haleru') ?? 0)
  const castkaFakturyCelkemHaleru = Number(formData.get('castka_faktury_celkem_haleru') ?? 0)
  const jistotaRaw = formData.get('jistota')
  const jistota = jistotaRaw ? Number(jistotaRaw) : null

  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const { data, error } = await supabase.rpc('potvrdit_alokaci_platby', {
    p_tenant: tenantId,
    p_transakce: transakceId,
    p_faktura: fakturaId,
    p_castka_haleru: castkaHaleru,
    p_castka_faktury_celkem: castkaFakturyCelkemHaleru,
    p_jistota: jistota,
  })

  if (error) {
    const zprava = /přesahuje/.test(error.message) ? error.message : 'Párování se nepodařilo uložit.'
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(zprava)}`)
  }

  const plneUhrazeno = Boolean(data?.[0]?.plne_uhrazeno)

  try {
    const faktury = getFakturySupabase()
    await faktury.from('invoices').update({ status: plneUhrazeno ? 'Uhrazeno' : 'Částečně uhrazeno' }).eq('id', fakturaId).eq('tenant_id', tenantId)
  } catch {
    // Best-effort — viz komentář funkce. Nesoulad zůstává dohledatelný
    // přímo ve Fakturách (stav tam neodpovídá platby_faktury tady).
  }

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

/**
 * Zrušení potvrzené alokace — vratné s auditem
 * (`app.zrusit_alokaci_platby`). Řádek zůstává (historie), jen stav
 * jde na `zamitnuto` — uvolní se tím místo pro novou alokaci.
 */
export async function zrusitAlokaci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const alokaceId = String(formData.get('alokace_id') ?? '')
  const duvod = String(formData.get('duvod') ?? '').trim()

  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const { error } = await supabase.rpc('zrusit_alokaci_platby', {
    p_tenant: tenantId,
    p_alokace: alokaceId,
    p_duvod: duvod || null,
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Zrušení párování se nepodařilo.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}
