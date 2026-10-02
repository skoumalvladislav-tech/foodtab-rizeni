'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser, hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { naHalere } from '@/lib/mzdy'
import { getServerSupabase } from '@/lib/supabase/server'
import {
  jednotkyBaleni,
  jeZakladniJednotka,
  naZakladniJednotku,
  type ZakladniJednotka,
} from './jednotky'

/**
 * Suroviny — katalog a historie nákupních cen.
 *
 * Zadání: supabase/migrations/20261002100000_sklad_suroviny_zaklad.sql.
 * Surovina nemá branch_id (sdílená napříč pobočkami, jako recipes) —
 * proto se `hasAccess` volá vždycky s pobočkou `null`, nikdy s tou
 * z adresy (viz komentář u `ingredients_write` v migraci: RLS kontroluje
 * `has_access(tenant_id, 'purchasing.manage', null)` natvrdo, takže
 * pobočkové členství by appka pustila dál, ale zápis by spadl na RLS).
 */

/** Kladné číslo z formuláře, čárka i tečka jako desetinná. Null = nevyplněno nebo nevalidní. */
function kladneCislo(vstup: string): number | null {
  const t = vstup.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Založení nové suroviny. */
export async function vytvoritSurovinu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const zakladniJednotka = String(formData.get('zakladni_jednotka') ?? '')
  const hustotaVstup = String(formData.get('density_g_per_ml') ?? '').trim()
  const vahaKusuVstup = String(formData.get('weight_g_per_ks') ?? '').trim()

  const zpet = `/${rozsah}/suroviny/nova`

  if (nazev === '' || !jeZakladniJednotka(zakladniJednotka)) {
    redirect(`${zpet}?chyba=neuplne`)
  }

  const hustota = hustotaVstup === '' ? null : kladneCislo(hustotaVstup)
  if (hustotaVstup !== '' && hustota === null) {
    redirect(`${zpet}?chyba=hustota`)
  }
  const vahaKusu = vahaKusuVstup === '' ? null : kladneCislo(vahaKusuVstup)
  if (vahaKusuVstup !== '' && vahaKusu === null) {
    redirect(`${zpet}?chyba=vaha-kusu`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  if (!(await hasAccess(tenantId, 'purchasing.manage', null))) {
    redirect(`${zpet}?chyba=pravo`)
  }

  const uzivatel = await getUser()
  const supabase = await getServerSupabase()

  const { data, error } = await supabase
    .from('ingredients')
    .insert({
      tenant_id: tenantId,
      name: nazev,
      base_unit: zakladniJednotka,
      density_g_per_ml: hustota,
      weight_g_per_ks: vahaKusu,
      created_by: uzivatel?.id ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    const duvod = error?.code === '23505' ? 'duplicitni' : 'nepovedlo'
    redirect(`${zpet}?chyba=${duvod}`)
  }

  revalidatePath(`/${rozsah}/suroviny`)
  redirect(`/${rozsah}/suroviny/${data.id}?stav=zalozena`)
}

/** Přejmenování suroviny. base_unit se neupravuje — viz detail suroviny. */
export async function prejmenovatSurovinu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const surovina = String(formData.get('surovina') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()

  const zpet = `/${rozsah}/suroviny/${surovina}`
  if (!surovina) redirect(`/${rozsah}/suroviny`)
  if (nazev === '') redirect(`${zpet}?chyba=neuplne`)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  if (!(await hasAccess(tenantId, 'purchasing.manage', null))) {
    redirect(`${zpet}?chyba=pravo`)
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('ingredients')
    .update({ name: nazev })
    .eq('id', surovina)
    .eq('tenant_id', tenantId)

  if (error) {
    const duvod = error.code === '23505' ? 'duplicitni' : 'nepovedlo'
    redirect(`${zpet}?chyba=${duvod}`)
  }

  revalidatePath(zpet)
  revalidatePath(`/${rozsah}/suroviny`)
  redirect(`${zpet}?stav=prejmenovana`)
}

/**
 * Nová nákupní cena. Historie je immutabilní (migrace) — žádná úprava
 * ani mazání, jen přidání dalšího řádku s novým `valid_from`.
 */
export async function pridatCenu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const surovina = String(formData.get('surovina') ?? '')
  const dodavatel = String(formData.get('dodavatel') ?? '').trim()
  const popisBaleni = String(formData.get('popis_baleni') ?? '').trim()
  const mnozstviVstup = String(formData.get('mnozstvi') ?? '').trim()
  const balenoV = String(formData.get('baleno_v') ?? '').trim()
  const cenaVstup = String(formData.get('cena_kc') ?? '').trim()
  const platnostOd = String(formData.get('platnost_od') ?? '').trim()

  const zpet = `/${rozsah}/suroviny/${surovina}`
  if (!surovina) redirect(`/${rozsah}/suroviny`)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  if (!(await hasAccess(tenantId, 'purchasing.manage', null))) {
    redirect(`${zpet}?chyba=pravo`)
  }

  const supabase = await getServerSupabase()

  // Základní jednotka suroviny rozhoduje o převodu — čte se znovu tady,
  // ne z formuláře (skryté pole by šlo v DevTools přepsat na jinou
  // surovinu a zapsat cenu přepočtenou podle cizí jednotky).
  const { data: surovinaData, error: chybaSuroviny } = await supabase
    .from('ingredients')
    .select('id, base_unit')
    .eq('id', surovina)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()

  if (chybaSuroviny || !surovinaData) {
    redirect(`/${rozsah}/suroviny?chyba=nenalezena`)
  }

  const mnozstvi = kladneCislo(mnozstviVstup)
  if (mnozstvi === null || !jednotkyBaleni(surovinaData.base_unit as ZakladniJednotka).includes(balenoV)) {
    redirect(`${zpet}?chyba=mnozstvi`)
  }

  const cenaHaleru = naHalere(cenaVstup)
  if (cenaHaleru === null || cenaHaleru < 0) {
    redirect(`${zpet}?chyba=cena`)
  }

  const { error } = await supabase.from('ingredient_purchase_prices').insert({
    tenant_id: tenantId,
    ingredient_id: surovina,
    supplier_name: dodavatel,
    package_description: popisBaleni,
    package_amount: naZakladniJednotku(mnozstvi, balenoV),
    package_price_haleru: cenaHaleru,
    // Prázdné pole = dnešní datum, stejná výchozí hodnota jako v DB
    // (sloupec `valid_from default current_date`) — tady se vypisuje
    // výslovně, ať náhled ve formuláři a skutečný zápis nejdou rozejít.
    valid_from: platnostOd === '' ? undefined : platnostOd,
  })

  if (error) {
    const duvod = error.code === '42501' ? 'pravo' : 'nepovedlo'
    redirect(`${zpet}?chyba=${duvod}`)
  }

  revalidatePath(zpet)
  revalidatePath(`/${rozsah}/suroviny`)
  redirect(`${zpet}?stav=cena-pridana`)
}

/**
 * Smazání suroviny (soft-delete). Odmítá se, pokud na surovinu odkazuje
 * jakákoli položka receptury — jinak by receptura ztratila napojení na
 * katalog beze zprávy a `app.recipe_cost_per_portion` by ji nahlásila
 * jako "nenapojenou", aniž by kdo rozuměl proč.
 */
export async function smazatSurovinu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const surovina = String(formData.get('surovina') ?? '')
  const zpet = `/${rozsah}/suroviny/${surovina}`
  if (!surovina) redirect(`/${rozsah}/suroviny`)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  if (!(await hasAccess(tenantId, 'purchasing.manage', null))) {
    redirect(`${zpet}?chyba=pravo`)
  }

  const supabase = await getServerSupabase()

  /*
    `recipe_ingredients` se čte přes `app.surovina_pouzita_v_receptu`
    (20261002105000), ne přímým SELECTem: ten by podléhal RLS
    `recipe_ingredients_read`, která vidí jen skrz `recipes.read` —
    a kdo smí mazat suroviny, `recipes.read` mít nemusí. Přímý dotaz by
    tak u takového člověka vrátil "nepoužitá" i u skutečně použité
    suroviny.
  */
  const { data: pouzita, error: chybaPouziti } = await supabase.rpc(
    'surovina_pouzita_v_receptu',
    { p_tenant: tenantId, p_ingredient: surovina },
  )

  if (chybaPouziti) redirect(`${zpet}?chyba=nepovedlo`)
  if (pouzita) redirect(`${zpet}?chyba=pouzita-v-receptu`)

  const { error } = await supabase
    .from('ingredients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', surovina)
    .eq('tenant_id', tenantId)

  if (error) redirect(`${zpet}?chyba=nepovedlo`)

  revalidatePath(`/${rozsah}/suroviny`)
  redirect(`/${rozsah}/suroviny?stav=smazana`)
}
