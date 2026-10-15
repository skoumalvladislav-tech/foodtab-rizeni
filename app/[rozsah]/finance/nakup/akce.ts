'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { naHalere } from '@/lib/mzdy'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { pobockaZaznamu, zaznamPatriRozsahu } from '@/lib/finance-evidence-pobocka'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * Vstup akcí Nákupu. Vrací i pobočku rozsahu (`pobocka`, `null` = celá
 * firma) — akce si ji berou odsud, NIKDY z formuláře (Finance po
 * pobočkách, 13. 10. 2026).
 *
 * Právo zůstává `purchasing.manage` za rozsah adresy, ne `finance.*`
 * za celou firmu: objednávky a příjemky mají pobočku na řádku a jejich
 * RLS ji hlídá (`can_read_scoped`/`has_access` s `branch_id`), takže
 * nákupčí jedné pobočky na cizí objednávky nedosáhne ani tudy.
 */
async function pripravit(rozsah: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'purchasing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/nakup`)

  return { supabase: await getServerSupabase(), tenantId, pobocka: pobockaFinanci(pristup.scope) }
}

/**
 * Aktivní pobočky TÉHLE firmy jako seznam pro `pobockaZaznamu` (prázdný
 * = nejde přečíst → vybraná pobočka neprojde). Firemní správce má
 * `has_access` na jakékoli id pobočky — databáze by objednávku založila
 * i s pobočkou, která firmě nepatří.
 */
async function aktivniPobockyFirmy(supabase: Supabase, tenantId: string): Promise<string[]> {
  const { data } = await supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null)
  return ((data ?? []) as { id: string }[]).map((b) => b.id)
}

/** Až 10 řádků položek z formuláře — pole `nazev_1`..`nazev_10` atd., prázdné se přeskočí. */
function vytahniPolozky(formData: FormData) {
  const polozky: { nazev: string; jednotka: string; mnozstvi_objednano: number; cena_za_jednotku_haleru: number }[] = []
  for (let i = 1; i <= 10; i++) {
    const nazev = String(formData.get(`nazev_${i}`) ?? '').trim()
    if (!nazev) continue
    const mnozstvi = Number(String(formData.get(`mnozstvi_${i}`) ?? '').replace(',', '.'))
    const cena = naHalere(String(formData.get(`cena_${i}`) ?? '').trim())
    if (!mnozstvi || mnozstvi <= 0 || cena === null) continue
    polozky.push({
      nazev,
      jednotka: String(formData.get(`jednotka_${i}`) ?? '').trim(),
      mnozstvi_objednano: mnozstvi,
      cena_za_jednotku_haleru: cena,
    })
  }
  return polozky
}

export async function zalozitObjednavku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  const kontaktId = String(formData.get('kontakt_id') ?? '')
  const pozadovaneDatum = String(formData.get('pozadovane_datum_dodani') ?? '') || null
  const poznamka = String(formData.get('poznamka') ?? '')
  const polozky = vytahniPolozky(formData)

  if (!kontaktId || polozky.length === 0) {
    redirect(`/${rozsah}/finance/nakup?chyba=${encodeURIComponent('Vyberte dodavatele a vyplňte alespoň jednu položku.')}`)
  }

  // Na pobočce VŽDY pobočka rozsahu (pole formuláře se nečte), za celou
  // firmu výběr z formuláře — prázdný = objednávka celé firmy.
  const volba = pobockaZaznamu(
    pobocka,
    String(formData.get('branch_id') ?? ''),
    pobocka ? [] : await aktivniPobockyFirmy(supabase, tenantId),
  )
  if (volba.stav === 'chyba') redirect(`/${rozsah}/finance/nakup?chyba=${encodeURIComponent(volba.text)}`)

  const { data: objednavkaId, error } = await supabase.rpc('zalozit_objednavku', {
    p_tenant: tenantId,
    p_branch: volba.branchId,
    p_kontakt: kontaktId,
    p_pozadovane_datum_dodani: pozadovaneDatum,
    p_poznamka: poznamka,
    p_polozky: polozky,
  })

  if (error || !objednavkaId) {
    redirect(`/${rozsah}/finance/nakup?chyba=${encodeURIComponent('Objednávku se nepodařilo založit.')}`)
  }

  revalidatePath(`/${rozsah}/finance/nakup`)
  redirect(`/${rozsah}/finance/nakup/${objednavkaId}`)
}

export async function zapsatPrijem(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const objednavkaId = String(formData.get('objednavka_id') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah)

  // Pobočka příjemky = pobočka OBJEDNÁVKY z databáze, ne skryté pole
  // formuláře (do 13. 10. 2026 se brala odtud). `zapsat_prijem_zbozi`
  // hlídá právo jen na pobočku, kterou dostane, ne na pobočku objednávky
  // — s přepsaným polem by šel zapsat příjem na objednávku jiné pobočky.
  // Na pobočce navíc jen objednávka TÉ pobočky (ne celé firmy).
  const { data: objednavka } = objednavkaId
    ? await supabase.from('objednavky_dodavatelum').select('id, branch_id').eq('id', objednavkaId).eq('tenant_id', tenantId).maybeSingle()
    : { data: null }
  if (!objednavka || !zaznamPatriRozsahu(pobocka, objednavka)) {
    redirect(`/${rozsah}/finance/nakup?chyba=${encodeURIComponent(pobocka ? 'Tahle objednávka nepatří této pobočce.' : 'Objednávka se nenašla.')}`)
  }

  const fakturaId = String(formData.get('faktura_id') ?? '') || null
  const poznamka = String(formData.get('poznamka') ?? '')

  const polozkyRaw = String(formData.get('polozky') ?? '[]')
  let polozky: unknown
  try {
    polozky = JSON.parse(polozkyRaw)
  } catch {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Vyplňte alespoň jednu přijatou položku.')}`)
  }

  if (!Array.isArray(polozky) || polozky.length === 0) {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Vyplňte alespoň jednu přijatou položku.')}`)
  }

  // Položky jen z TÉHLE objednávky. `zapsat_prijem_zbozi` (SECURITY
  // DEFINER) přičte přijaté množství k jakékoli položce firmy, jejíž id
  // dostane — z Bernard Baru by tak šlo „přijmout" zboží na objednávku
  // jiné pobočky. Formulář posílá jen položky stránky, takže běžný zápis
  // tahle kontrola nezmění.
  const { data: polozkyObjednavky } = await supabase
    .from('objednavky_polozky')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('objednavka_id', objednavka.id)
  const idPolozek = new Set(((polozkyObjednavky ?? []) as { id: string }[]).map((p) => p.id))
  const cizi = (polozky as { objednavky_polozka_id?: unknown }[]).some(
    (p) => p?.objednavky_polozka_id != null && !idPolozek.has(String(p.objednavky_polozka_id)),
  )
  if (cizi) {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Příjem obsahuje položku, která k téhle objednávce nepatří.')}`)
  }

  const { data, error } = await supabase.rpc('zapsat_prijem_zbozi', {
    p_tenant: tenantId,
    p_branch: objednavka.branch_id,
    p_objednavka: objednavka.id,
    p_faktura_id: fakturaId,
    p_prijal: null,
    p_poznamka: poznamka,
    p_polozky: polozky,
  })

  if (error) {
    redirect(`/${rozsah}/finance/nakup/${objednavkaId}?chyba=${encodeURIComponent('Příjem se nepodařilo zapsat.')}`)
  }

  const upozorneni = (data ?? []).some((r: { prekrocene_mnozstvi: boolean; jina_cena: boolean }) => r.prekrocene_mnozstvi || r.jina_cena)

  revalidatePath(`/${rozsah}/finance/nakup/${objednavkaId}`)
  redirect(`/${rozsah}/finance/nakup/${objednavkaId}${upozorneni ? '?upozorneni=1' : '?prijato=1'}`)
}
