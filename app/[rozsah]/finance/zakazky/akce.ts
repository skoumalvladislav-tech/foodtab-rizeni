'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { hasAccess } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { pobockaZaznamu, zaznamPatriRozsahu } from '@/lib/finance-evidence-pobocka'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * Vstup akcí Zakázek. Vrací i pobočku rozsahu (`pobocka`, `null` = celá
 * firma) — akce si ji berou odsud, NIKDY z formuláře (Finance po
 * pobočkách, 13. 10. 2026).
 *
 * Na pobočce navíc stejná brána jako app/[rozsah]/finance/layout.tsx:
 * jen s `finance.read` za celou firmu. Layout hlídá jen kreslení —
 * serverovou akci jde zavolat i bez stránky.
 */
async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/zakazky`)

  const pobocka = pobockaFinanci(pristup.scope)
  // ROZHODNOUT: (docs/hlaseni/otazky.md, ot. 47 bod 1) — kdyby Finance pobočky dostal
  // i vedoucí jedné pobočky, musí se uvolnit i tahle druhá linie, ne jen
  // finance/layout.tsx.
  if (pobocka && !(await hasAccess(tenantId, 'finance.read', null))) redirect(`/${rozsah}/finance/zakazky`)

  return { supabase: await getServerSupabase(), tenantId, pobocka }
}

/**
 * Aktivní pobočky TÉHLE firmy jako seznam pro `pobockaZaznamu` (prázdný
 * = nejde přečíst → vybraná pobočka neprojde). Firemní správce má
 * `has_access` na jakékoli id pobočky — databáze by zakázku založila
 * i s pobočkou, která firmě nepatří.
 */
async function aktivniPobockyFirmy(supabase: Supabase, tenantId: string): Promise<string[]> {
  const { data } = await supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null)
  return ((data ?? []) as { id: string }[]).map((b) => b.id)
}

/**
 * Zakázka podle id, jen pokud patří rozsahu (na pobočce jen zakázka TÉ
 * pobočky, ne celé firmy ani jiné pobočky). Jinak zpět na seznam
 * s větou — akce s cizí zakázkou nic neudělá.
 */
async function zakazkaVRozsahu(supabase: Supabase, tenantId: string, pobocka: string | null, rozsah: string, zakazkaId: string) {
  const { data: zakazka } = zakazkaId
    ? await supabase.from('zakazky').select('id, branch_id').eq('id', zakazkaId).eq('tenant_id', tenantId).maybeSingle()
    : { data: null }
  if (!zakazka || !zaznamPatriRozsahu(pobocka, zakazka)) {
    redirect(`/${rozsah}/finance/zakazky?chyba=${encodeURIComponent(pobocka ? 'Tahle zakázka nepatří této pobočce.' : 'Zakázka se nenašla.')}`)
  }
  return zakazka
}

function vytahniPolozky(formData: FormData) {
  const polozky: { popis: string; mnozstvi: number; cena_za_jednotku_haleru: number }[] = []
  for (let i = 1; i <= 10; i++) {
    const popis = String(formData.get(`popis_${i}`) ?? '').trim()
    if (!popis) continue
    const mnozstvi = Number(String(formData.get(`mnozstvi_${i}`) ?? '1').replace(',', '.')) || 1
    const cena = naHalere(String(formData.get(`cena_${i}`) ?? '').trim())
    if (cena === null) continue
    polozky.push({ popis, mnozstvi, cena_za_jednotku_haleru: cena })
  }
  return polozky
}

export async function zalozitZakazku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  const kontaktId = String(formData.get('kontakt_id') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const datumAkce = String(formData.get('datum_akce') ?? '') || null
  const pocetHostuRaw = String(formData.get('pocet_hostu') ?? '').trim()
  const pocetHostu = pocetHostuRaw ? Number(pocetHostuRaw) : null
  const zalohaRaw = String(formData.get('zaloha_pozadovana') ?? '').trim()
  const zaloha = zalohaRaw ? naHalere(zalohaRaw) : 0
  const poznamka = String(formData.get('poznamka') ?? '')
  const polozky = vytahniPolozky(formData)

  if (!kontaktId || !nazev) {
    redirect(`/${rozsah}/finance/zakazky?chyba=${encodeURIComponent('Vyplňte odběratele a název zakázky.')}`)
  }

  // Na pobočce VŽDY pobočka rozsahu (pole formuláře se nečte), za celou
  // firmu výběr z formuláře — prázdný = zakázka celé firmy.
  const volba = pobockaZaznamu(
    pobocka,
    String(formData.get('branch_id') ?? ''),
    pobocka ? [] : await aktivniPobockyFirmy(supabase, tenantId),
  )
  if (volba.stav === 'chyba') redirect(`/${rozsah}/finance/zakazky?chyba=${encodeURIComponent(volba.text)}`)

  const { data: zakazkaId, error } = await supabase.rpc('zalozit_zakazku', {
    p_tenant: tenantId,
    p_branch: volba.branchId,
    p_kontakt: kontaktId,
    p_nazev: nazev,
    p_datum_akce: datumAkce,
    p_pocet_hostu: pocetHostu,
    p_zaloha_pozadovana_haleru: zaloha ?? 0,
    p_poznamka: poznamka,
    p_polozky: polozky,
  })

  if (error || !zakazkaId) {
    redirect(`/${rozsah}/finance/zakazky?chyba=${encodeURIComponent('Zakázku se nepodařilo založit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/zakazky`)
  redirect(`/${rozsah}/finance/zakazky/${zakazkaId}`)
}

export async function zmenitStavZakazky(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zakazkaId = String(formData.get('zakazka_id') ?? '')
  const stav = String(formData.get('stav') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  let dotaz = supabase.from('zakazky').update({ stav }).eq('id', zakazkaId).eq('tenant_id', tenantId)
  // Na pobočce jen zakázka TÉ pobočky — `zakazka_id` si kdokoli přepíše
  // a firemní správce má na zakázky celé firmy právo i v databázi.
  if (pobocka) dotaz = dotaz.eq('branch_id', pobocka)
  await dotaz

  revalidatePath(`/${rozsah}/finance/zakazky/${zakazkaId}`)
  redirect(`/${rozsah}/finance/zakazky/${zakazkaId}`)
}

export async function zapsatPlatbuZakazky(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zakazkaId = String(formData.get('zakazka_id') ?? '')
  const ucetId = String(formData.get('ucet_id') ?? '')
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  if (!ucetId || castka === null || castka <= 0) {
    redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?chyba=${encodeURIComponent('Vyberte účet a vyplňte částku.')}`)
  }

  // Na pobočce jen zakázka TÉ pobočky a jen platební účet TÉ pobočky —
  // ověřené tady, ne podle toho, co výběr na stránce nabídl (`ucet_id`
  // si kdokoli přepíše). Platba na firemní účet by se z Bernard Baru
  // zapsala do čísel, která pohled pobočky vůbec neukazuje. Za celou
  // firmu beze změny (účet hlídá spoušť `app.hlida_firmu_transakce`).
  if (pobocka) {
    await zakazkaVRozsahu(supabase, tenantId, pobocka, rozsah, zakazkaId)
    const { data: ucet } = await supabase
      .from('platebni_ucty')
      .select('branch_id')
      .eq('id', ucetId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!zaznamPatriRozsahu(pobocka, ucet)) {
      redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?chyba=${encodeURIComponent('Na pobočce jde platbu zapsat jen na platební účet této pobočky.')}`)
    }
  }

  const { error } = await supabase.from('transakce').insert({
    tenant_id: tenantId,
    ucet_id: ucetId,
    smer: 'prijem',
    castka_haleru: castka,
    datum: new Date().toISOString().slice(0, 10),
    zdroj: 'rucni',
    zakazka_id: zakazkaId,
    protistrana: 'Platba na zakázku',
  })

  if (error) {
    redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?chyba=${encodeURIComponent('Platbu se nepodařilo zapsat.')}`)
  }

  revalidatePath(`/${rozsah}/finance/zakazky/${zakazkaId}`)
  redirect(`/${rozsah}/finance/zakazky/${zakazkaId}?zapsano=1`)
}
