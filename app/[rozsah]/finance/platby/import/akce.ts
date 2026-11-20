'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import type { RadekImportu } from '@/lib/finance-csv-import'
import { zapsatVypis } from '@/lib/banka/zapis'
import { automatickyParovatPlatby } from '@/lib/finance-automaticke-parovani'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'

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

  // Import výpisu je jen za celou firmu (import/layout.tsx, Finance po
  // pobočkách 13. 10. 2026): dávka pobočku nemá a jednoznačné shody se
  // rovnou párují s fakturami celé firmy. Právo proto VŽDY za celou
  // firmu, ne za rozsah z formuláře — na pobočce by jinak prošel i
  // vedoucí jedné pobočky. `rozsah` zůstává jen pro návratovou adresu.
  const pristup = await zkusPristup(tenantId, 'finance.manage', TENANT_SCOPE_SEGMENT)
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

  if (zdroj !== 'csv_banka' && zdroj !== 'csv_pokladna') {
    redirect(`/${rozsah}/finance/platby/import?chyba=${encodeURIComponent('Náhled vypršel, nahrajte soubor znovu.')}`)
  }

  const supabase = await getServerSupabase()

  // Dávka i pohyby v JEDNÉ transakci (`importovat_vypis`, migrace
  // 20261119100000). Dřív se dávka založila jako „zpracováno" dřív, než
  // se zapsaly řádky — a když zápis spadl, zůstala a stejný soubor pak
  // náhled navždy odmítal jako „už importovaný". Teď po chybě nezůstane
  // nic a soubor jde nahrát znovu. Dvojí import téhož pohybu hlídá
  // databáze: řádek s id podle id, řádek bez id podle obsahu (zapíše se
  // tolik stejných řádků, o kolik jich je v souboru víc než na účtu).
  // Protiúčet znovu normalizuje `radkyProImport` — řádky přišly z prohlížeče.
  const zapis = await zapsatVypis(supabase, {
    tenantId,
    ucetId,
    zdroj,
    souborNazev,
    souborHash,
    pohyby: radky,
  })

  if (zapis.stav === 'chyba' || !zapis.davkaId) {
    const uzImportovano = zapis.stav === 'chyba' && zapis.kod === '23505' && zapis.duvod.includes('import_davky_tenant_hash')
    const zprava = uzImportovano ? 'Tenhle soubor už byl jednou importován.' : 'Import se nepodařilo dokončit — nic se nezapsalo, zkuste to znovu.'
    redirect(`/${rozsah}/finance/platby/import?chyba=${encodeURIComponent(zprava)}`)
  }
  const davkaId = zapis.davkaId
  const pocetVlozenych = zapis.pocetNovych

  // Nové platby z výpisu → jednoznačné shody s fakturami se spárují samy
  // a faktura přejde na „Uhrazeno" (Šéfík 8. 10. 2026). Jen když import
  // dělá člověk, který smí spravovat Faktury za celou firmu — CSV si může
  // napsat kdokoli s financemi a bez téhle podmínky by jím „zaplatil"
  // fakturu, kterou sám ručně označit nesmí. Důvěryhodná je jen TAHLE dávka.
  const smiFaktury = (await zkusPristup(tenantId, 'faktury.manage', TENANT_SCOPE_SEGMENT)).stav === 'ok'
  const parovani = smiFaktury
    ? await automatickyParovatPlatby(tenantId, { konecMs: Date.now() + 20_000, duveryhodneDavky: [{ id: davkaId, pocet: pocetVlozenych }] })
    : { sparovano: 0 }

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby?importovano=${pocetVlozenych}&sparovano=${parovani.sparovano}`)
}
