'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { naHalere } from '@/lib/mzdy'
import { STAV_UHRAZENO, STAV_CASTECNE, STAV_NEUHRAZENO } from '@/lib/faktury-types'

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
 * Potvrzení párování — vždy lidský klik, nikdy automaticky (zadání,
 * oddíl 5). Používá se pro NÁVRH (hodnoty přijdou skryté z formuláře)
 * i pro RUČNÍ párování (zadání, oddíl 7: „hromadné platby" — jedna
 * platba na víc faktur, appka to podpoří tím, že se tahle akce
 * zavolá vícekrát se stejnou platbou a jinou fakturou/zbývající
 * částkou). Zapisuje VÝHRADNĖ přes `app.potvrdit_alokaci_platby`
 * (20261004100000) — přímý INSERT do `platby_faktury` appka od téhle
 * migrace nemá (grant odebraný), protože jen tahle RPC hlídá souběh
 * (advisory zámek) a to, že alokace nepřesáhne ani částku platby, ani
 * nezaplacený zůstatek faktury. Stav Faktur (`invoices.status`) se
 * pak zapisuje best-effort podle toho, jestli RPC vrátila
 * `plne_uhrazeno` — PLNĖ, nebo ČÁSTEČNĖ, nikdy natvrdo „Uhrazeno"
 * jako dřív (ta chyba dovolila, aby částečná úhrada appku nahlásila
 * jako plně zaplacenou fakturu).
 *
 * Celková částka faktury (`castka_faktury_celkem_haleru`) se NEBERE
 * z formuláře — appka si ji od 7.10.2026 zjistí SAMA z databáze
 * Faktur podle `faktura_id`. Dřív to posílal klient skrytým polem
 * (fungovalo jen u návrhu, který appka sama spočítala) — ruční
 * párování žádnou takovou předpočítanou hodnotu nemá a appka by si
 * jinak musela důvěřovat, že ji klient nepodvrhl.
 */
export async function potvrditParovani(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const transakceId = String(formData.get('transakce_id') ?? '')
  const fakturaId = String(formData.get('faktura_id') ?? '')
  // Návrh posílá přesnou haléřovou hodnotu skrytým polem; ruční
  // párování ji nemá předpočítanou a člověk ji zadává v Kč.
  const castkaHaleruSkryte = formData.get('castka_haleru')
  const castkaHaleru =
    castkaHaleruSkryte != null && castkaHaleruSkryte !== ''
      ? Number(castkaHaleruSkryte)
      : naHalere(String(formData.get('castka') ?? '').trim())
  const jistotaRaw = formData.get('jistota')
  const jistota = jistotaRaw ? Number(jistotaRaw) : null

  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  if (!transakceId || !fakturaId || castkaHaleru === null || castkaHaleru <= 0) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyberte platbu, fakturu a vyplňte kladnou částku.')}`)
  }

  let castkaFakturyCelkemHaleru: number | null = null
  try {
    const { data: faktura } = await getFakturySupabase()
      .from('invoices')
      .select('amount')
      .eq('id', fakturaId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    castkaFakturyCelkemHaleru = faktura?.amount != null ? Math.round(faktura.amount * 100) : null
  } catch {
    castkaFakturyCelkemHaleru = null
  }

  if (castkaFakturyCelkemHaleru === null) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Faktura se nenašla — zkontrolujte číslo faktury.')}`)
  }

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
  const prebytekHaleru = Number(data?.[0]?.prebytek_haleru ?? 0)

  try {
    const faktury = getFakturySupabase()
    await faktury.from('invoices').update({ status: plneUhrazeno ? STAV_UHRAZENO : STAV_CASTECNE }).eq('id', fakturaId).eq('tenant_id', tenantId)
  } catch {
    // Best-effort — viz komentář funkce. Nesoulad zůstává dohledatelný
    // přímo ve Fakturách (stav tam neodpovídá platby_faktury tady).
  }

  revalidatePath(`/${rozsah}/finance/platby`)
  // Přeplatek appka od 7.10.2026 nezakazuje (zadání: „podporuj...
  // přeplatky"), jen o něm nahlas řekne — co se s penězi navíc stane
  // (jiná faktura, dobropis, vrácení), rozhoduje člověk.
  redirect(
    prebytekHaleru > 0
      ? `/${rozsah}/finance/platby?prebytek=${prebytekHaleru}`
      : `/${rozsah}/finance/platby`
  )
}

/**
 * Zrušení potvrzené alokace — vratné s auditem
 * (`app.zrusit_alokaci_platby`). Řádek zůstává (historie), jen stav
 * jde na `zamitnuto` — uvolní se tím místo pro novou alokaci.
 *
 * Stav faktury ve Fakturách se po zrušení PŘEPOČÍTÁ znovu (best-effort,
 * stejně jako `potvrditParovani`) — dřív appka po zrušení JEDINÉ
 * alokace nechávala fakturu nahlášenou jako „Uhrazeno"/„Částečně
 * uhrazeno", i když se platba zrušila (nález 6.–7. 10. 2026).
 */
export async function zrusitAlokaci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const alokaceId = String(formData.get('alokace_id') ?? '')
  const duvod = String(formData.get('duvod') ?? '').trim()

  const { supabase, tenantId } = await pripravit(rozsah, 'finance.manage')

  const { data: alokace } = await supabase
    .from('platby_faktury')
    .select('faktura_id')
    .eq('id', alokaceId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { error } = await supabase.rpc('zrusit_alokaci_platby', {
    p_tenant: tenantId,
    p_alokace: alokaceId,
    p_duvod: duvod || null,
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Zrušení párování se nepodařilo.')}`)

  if (alokace?.faktura_id) {
    try {
      const { data: zbyvajici } = await supabase
        .from('platby_faktury')
        .select('castka_haleru')
        .eq('faktura_id', alokace.faktura_id)
        .eq('tenant_id', tenantId)
        .eq('stav', 'potvrzeno')

      const soucetHaleru = (zbyvajici ?? []).reduce((s, r) => s + r.castka_haleru, 0)

      const faktury = getFakturySupabase()
      const { data: faktura } = await faktury
        .from('invoices')
        .select('amount')
        .eq('id', alokace.faktura_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      const celkemHaleru = faktura?.amount != null ? Math.round(faktura.amount * 100) : null
      const novyStav =
        soucetHaleru <= 0 ? STAV_NEUHRAZENO : celkemHaleru !== null && soucetHaleru >= celkemHaleru ? STAV_UHRAZENO : STAV_CASTECNE

      await faktury.from('invoices').update({ status: novyStav }).eq('id', alokace.faktura_id).eq('tenant_id', tenantId)
    } catch {
      // Best-effort — viz komentář funkce. Nesoulad zůstává dohledatelný
      // přímo ve Fakturách (stav tam neodpovídá platby_faktury tady).
    }
  }

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}
