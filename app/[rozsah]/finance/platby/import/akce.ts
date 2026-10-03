'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import type { RadekImportu } from '@/lib/finance-csv-import'

/**
 * Krok 2 ze dvou: POTVRZENÍ náhledu z akce-nahled.ts — teprve tady se
 * zapisuje. Řádky chodí jako JSON ve skrytém poli (náhled se spočítal
 * v předchozím kroku a appka ho nikam neukládá) — formulář to jen
 * vrací tak, jak ho klient dostal, nic se tu znovu neparsuje.
 */
export async function potvrditImport(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav !== 'ok') redirect(`/${rozsah}/finance/platby/import`)

  const ucetId = String(formData.get('ucet_id') ?? '')
  const zdroj = String(formData.get('zdroj') ?? '')
  const souborHash = String(formData.get('soubor_hash') ?? '')
  const souborNazev = String(formData.get('soubor_nazev') ?? '')
  const radkyRaw = String(formData.get('radky') ?? '[]')

  let radky: RadekImportu[]
  try {
    radky = JSON.parse(radkyRaw) as RadekImportu[]
  } catch {
    redirect(`/${rozsah}/finance/platby/import?chyba=${encodeURIComponent('Náhled vypršel, nahrajte soubor znovu.')}`)
  }

  if (!ucetId || !souborHash || !Array.isArray(radky) || radky.length === 0) {
    redirect(`/${rozsah}/finance/platby/import?chyba=${encodeURIComponent('Náhled vypršel, nahrajte soubor znovu.')}`)
  }

  const supabase = await getServerSupabase()

  const { data: davka, error: chybaDavky } = await supabase
    .from('import_davky')
    .insert({
      tenant_id: tenantId,
      typ: zdroj === 'csv_banka' ? 'banka_csv' : 'pokladna_csv',
      soubor_nazev: souborNazev,
      soubor_hash: souborHash,
      pocet_radku: radky.length,
      stav: 'zpracovano',
    })
    .select('id')
    .single()

  if (chybaDavky || !davka) {
    const zprava = chybaDavky?.code === '23505' ? 'Tenhle soubor už byl jednou importován.' : 'Dávku se nepodařilo založit.'
    redirect(`/${rozsah}/finance/platby/import?chyba=${encodeURIComponent(zprava)}`)
  }

  const { data: pocetVlozenych, error: chybaImportu } = await supabase.rpc('importovat_transakce', {
    p_tenant: tenantId,
    p_ucet: ucetId,
    p_davka: davka.id,
    p_zdroj: zdroj,
    p_radky: radky,
  })

  if (chybaImportu) {
    // Dávka zůstává zapsaná i při neúspěchu vložení řádků — je to
    // dohledatelná stopa po pokusu, ne tiše zahozená informace.
    redirect(`/${rozsah}/finance/platby/import?chyba=${encodeURIComponent('Import se nepodařilo dokončit — zkuste to znovu.')}`)
  }

  await supabase
    .from('import_davky')
    .update({ pocet_novych: pocetVlozenych ?? 0 })
    .eq('id', davka.id)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby?importovano=${pocetVlozenych ?? 0}`)
}
