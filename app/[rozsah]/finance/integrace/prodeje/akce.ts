'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import type { RadekPokladny } from '@/lib/pokladna-csv-import'

/** Krok 2 ze dvou: POTVRZENÍ náhledu z akce-nahled.ts — teprve tady se zapisuje. */
export async function potvrditImportProdeje(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'finance.manage', rozsah)
  if (pristup.stav !== 'ok') redirect(`/${rozsah}/finance/integrace/prodeje`)

  const branchId = String(formData.get('branch_id') ?? '')
  const souborHash = String(formData.get('soubor_hash') ?? '')
  const souborNazev = String(formData.get('soubor_nazev') ?? '')
  const radkyRaw = String(formData.get('radky') ?? '[]')

  let radky: RadekPokladny[]
  try {
    radky = JSON.parse(radkyRaw) as RadekPokladny[]
  } catch {
    redirect(`/${rozsah}/finance/integrace/prodeje?chyba=${encodeURIComponent('Náhled vypršel, nahrajte soubor znovu.')}`)
  }

  if (!branchId || !souborHash || !Array.isArray(radky) || radky.length === 0) {
    redirect(`/${rozsah}/finance/integrace/prodeje?chyba=${encodeURIComponent('Náhled vypršel, nahrajte soubor znovu.')}`)
  }

  const supabase = await getServerSupabase()

  const { data: davka, error: chybaDavky } = await supabase
    .from('import_davky')
    .insert({
      tenant_id: tenantId,
      typ: 'pokladna_prodeje_csv',
      soubor_nazev: souborNazev,
      soubor_hash: souborHash,
      pocet_radku: radky.length,
      stav: 'zpracovano',
    })
    .select('id')
    .single()

  if (chybaDavky || !davka) {
    const zprava = chybaDavky?.code === '23505' ? 'Tenhle soubor už byl jednou importován.' : 'Dávku se nepodařilo založit.'
    redirect(`/${rozsah}/finance/integrace/prodeje?chyba=${encodeURIComponent(zprava)}`)
  }

  const { data: pocetVlozenych, error: chybaImportu } = await supabase.rpc('importovat_pokladna_prodeje', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_davka: davka.id,
    p_zdroj: 'csv',
    p_radky: radky.map((r) => ({
      datum: r.datum,
      produkt_nazev: r.produktNazev,
      mnozstvi: r.mnozstvi,
      trzba_haleru: r.trzbaHaleru,
    })),
  })

  if (chybaImportu) {
    redirect(`/${rozsah}/finance/integrace/prodeje?chyba=${encodeURIComponent('Import se nepodařilo dokončit — zkuste to znovu.')}`)
  }

  await supabase.from('import_davky').update({ pocet_novych: pocetVlozenych ?? 0 }).eq('id', davka.id)

  revalidatePath(`/${rozsah}/finance/integrace/prodeje`)
  redirect(`/${rozsah}/finance/integrace/prodeje?importovano=${pocetVlozenych ?? 0}`)
}
