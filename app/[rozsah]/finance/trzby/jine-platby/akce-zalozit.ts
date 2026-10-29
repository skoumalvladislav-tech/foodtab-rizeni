'use server'

import { redirect } from 'next/navigation'

import { hasAccess, TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { pobockaZaznamu } from '@/lib/finance-evidence-pobocka'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupJinymPlatbam } from '@/lib/jine-platby-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Založení záznamu Jiných plateb — krok 1 průvodce (provozovna, pokladna,
 * označení). Doklad se nahrává až na detailu záznamu.
 *
 * Z formuláře se NEBERE firma (vždy `getCurrentTenantId`, tedy členství)
 * a na pobočce ani pobočka (vždy pobočka rozsahu, `pobockaZaznamu`).
 * Za celou firmu se pobočka z formuláře přijme jen mezi aktivními
 * pobočkami téhle firmy a jen tam, kde má člověk `jine_platby.zadat`.
 * Pokladnu, oprávnění i firmu ověřuje znovu `jine_platby_zalozit`
 * (SECURITY DEFINER) — tohle je první linie.
 *
 * DVOJKLIK: formulář nese `klient_id` (uuid vygenerované při vykreslení).
 * Databáze ho má unikátní na firmu a na stejný klíč vrátí tentýž záznam,
 * takže druhé odeslání nezaloží druhý záznam.
 */

export type StavZalozeni = { stav: 'klid' } | { stav: 'chyba'; text: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const chyba = (text: string): StavZalozeni => ({ stav: 'chyba', text })

export async function zalozitZaznam(_predchozi: StavZalozeni, formData: FormData): Promise<StavZalozeni> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return chyba('Účet zatím nepatří k žádné firmě.')

  const pristup = await zkusPristupJinymPlatbam(tenantId, String(formData.get('rozsah') ?? ''))
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return chyba('K Jiným platbám nemáte přístup.')
  const pobockaRozsahu = pobockaFinanci(pristup.scope)

  const supabase = await getServerSupabase()
  const { data: pobocky, error: chybaPobocek } = await supabase
    .from('branches')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .is('deleted_at', null)
  if (chybaPobocek) return chyba('Provozovny firmy se nepodařilo načíst. Zkuste to prosím znovu.')

  const volba = pobockaZaznamu(
    pobockaRozsahu,
    String(formData.get('branch_id') ?? ''),
    ((pobocky ?? []) as { id: string }[]).map((b) => b.id),
  )
  if (volba.stav === 'chyba') return chyba(volba.text)
  // Jiná platba patří vždycky provozovně (branch_id je v databázi povinné).
  if (volba.branchId === null) return chyba('Vyberte provozovnu.')
  const branchId = volba.branchId

  if (!(await hasAccess(tenantId, 'jine_platby.zadat', branchId))) {
    return chyba('Na této provozovně nemáte právo zakládat Jiné platby.')
  }

  // Prázdná hodnota = výslovná volba „bez pokladny".
  const pokladna = String(formData.get('pripojeni') ?? '').trim()
  if (pokladna !== '' && !UUID.test(pokladna)) return chyba('Vybraná pokladna není platná.')

  const klientId = String(formData.get('klient_id') ?? '').trim()
  if (!UUID.test(klientId)) return chyba('Formulář je zastaralý — načtěte stránku znovu.')

  const oznaceni = String(formData.get('oznaceni') ?? '').trim().slice(0, 200)

  const { data, error } = await supabase.rpc('jine_platby_zalozit', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_pripojeni: pokladna === '' ? null : pokladna,
    p_oznaceni: oznaceni,
    p_klient_id: klientId,
  })
  if (error) {
    // 23514 = obchodní pravidlo s českou hláškou z databáze — smí se ukázat
    // („Tahle pokladna provozovnu neobsluhuje…"). Nic jiného ne: hláška
    // z neznámé chyby může nést názvy tabulek a sloupců.
    if (error.code === '23514') return chyba(error.message)
    if (error.code === '42501') return chyba('Na této provozovně nemáte právo zakládat Jiné platby.')
    if (funkceNeexistuje(error)) return chyba('Jiné platby čekají na aktualizaci databáze. Zkuste to později.')
    console.error('jine_platby_zalozit selhalo:', error.code, error.message)
    return chyba('Záznam se nepodařilo založit. Zkuste to prosím znovu.')
  }

  const id = String(data ?? '')
  if (!UUID.test(id)) return chyba('Záznam se nepodařilo založit. Zkuste to prosím znovu.')

  // Adresa z OVĚŘENÉHO rozsahu (slug z členství), ne z textu formuláře.
  redirect(`/${pristup.scope.branchSlug ?? TENANT_SCOPE_SEGMENT}/finance/trzby/jine-platby/${id}`)
}
