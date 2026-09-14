'use server'

import { randomUUID } from 'node:crypto'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KBELIK, cestaVUlozisti } from '@/lib/marketing-media'
import { precistObrazek } from '@/lib/marketing-obrazek'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jeden } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Marketing — knihovna fotek.
 *
 * Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4.
 *
 * ---------------------------------------------------------------------
 * NAHRÁVÁ SE POD PŘIHLÁŠENÝM ČLOVĚKEM, NE SERVISNÍM KLÍČEM
 *
 * `getServerSupabase` jede na veřejný klíč a sezení uživatele, takže
 * na úložiště dosáhnou pravidla z
 * `20260913170000_marketing_ulozne.sql`. Servisní klíč by je obešel
 * (pravidlo 6) a zůstala by jen kontrola tady — tedy jedna linie
 * místo dvou.
 *
 * ---------------------------------------------------------------------
 * KBELÍK JE SOUKROMÝ
 *
 * Fotky se nikdy nezobrazují přímou adresou. Náhled na obrazovce jede
 * přes podepsaný odkaz s omezenou platností, který se vydává až po
 * dotazu na oprávnění.
 */

async function pripravit(rozsah: string, pravo: 'marketing.read' | 'marketing.manage') {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing`)

  return {
    tenantId,
    branchId: pristup.scope.branchId,
    supabase: await getServerSupabase(),
  }
}

function zpetSChybou(rozsah: string, zprava: string): never {
  redirect(`/${rozsah}/marketing/media?chyba=${encodeURIComponent(zprava)}`)
}

export async function nahratFotku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { tenantId, branchId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const soubor = formData.get('soubor')
  if (!(soubor instanceof File) || soubor.size === 0) {
    zpetSChybou(rozsah, 'Vyberte fotku.')
  }

  const data = new Uint8Array(await soubor.arrayBuffer())
  const precteno = precistObrazek(data)
  if (precteno.stav === 'chyba') {
    zpetSChybou(rozsah, precteno.duvod)
  }

  const obrazek = precteno.obrazek

  /*
    DUPLICITA SE POZNÁ PODLE OTISKU OBSAHU, NE PODLE JMÉNA.

    `IMG_2831.jpg` a `svickova.jpg` bývá jedna a tatáž fotka. Bez
    tohohle by knihovna během měsíce zarostla kopiemi a člověk by při
    výběru nevěděl, která je ta pravá.

    Kontroluje se PŘED nahráním, ať se soubor zbytečně neposílá.
  */
  const uz = await jeden<{ id: string; nazev_souboru: string }>(
    'fotka s týmž otiskem',
    supabase
      .from('marketing_media')
      .select('id, nazev_souboru')
      .eq('tenant_id', tenantId)
      .eq('otisk', obrazek.otisk)
      .is('archivovano_kdy', null)
      .limit(1)
      .maybeSingle(),
  )

  if (uz) {
    zpetSChybou(rozsah, `Tuhle fotku už v knihovně máte — je uložená jako „${uz.nazev_souboru}".`)
  }

  const kam = cestaVUlozisti(tenantId, branchId, randomUUID(), obrazek.pripona)

  const nahrano = await supabase.storage.from(KBELIK).upload(kam, data, {
    contentType: obrazek.typ,
    // Náhodné jméno se nikdy neopakuje, takže přepis by znamenal, že
    // je něco jinak, než si myslíme. Ať to radši spadne.
    upsert: false,
  })

  if (nahrano.error) {
    zpetSChybou(rozsah, `Fotku se nepodařilo uložit: ${nahrano.error.message}`)
  }

  const { error } = await supabase.from('marketing_media').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    druh: 'foto',
    sbirka: String(formData.get('sbirka') ?? 'ostatni'),
    nazev_souboru: soubor.name.slice(0, 200),
    cesta: kam,
    mime: obrazek.typ,
    velikost_bajtu: obrazek.bajtu,
    sirka: obrazek.sirka,
    vyska: obrazek.vyska,
    otisk: obrazek.otisk,
    popis: String(formData.get('popis') ?? '').slice(0, 500),
    alt_text: String(formData.get('alt_text') ?? '').slice(0, 300),
    puvod: String(formData.get('puvod') ?? '').slice(0, 300),
    pouzitelne_do: neboNull(formData.get('pouzitelne_do')),
  })

  if (error) {
    /*
      ÚKLID PO SOBĚ.

      Soubor je nahraný, řádek nevznikl. Bez tohohle by v kbelíku
      zůstal soubor, na který se z aplikace nedá dostat a nikdo o něm
      neví — a platí se za něj. Když se úklid nepovede, chyba se
      nepřebíjí: pro člověka je důležitější ta první.
    */
    await supabase.storage.from(KBELIK).remove([kam])
    zpetSChybou(rozsah, `Fotka se nahrála, ale nešlo ji zapsat do knihovny: ${error.message}`)
  }

  revalidatePath(`/${rozsah}/marketing/media`)
  redirect(`/${rozsah}/marketing/media`)
}

/**
 * Smazání fotky.
 *
 * Maže se doopravdy, ne označením. Fotka není člověk ani docházka —
 * u ní nemá co na čem viset (pravidlo 9 se týká lidí). Zůstane po ní
 * záznam v auditu, což je přesně to, co je potřeba vědět.
 *
 * Nejdřív soubor, pak řádek. Obráceně by se při chybě ztratila jediná
 * stopa, kde ten soubor v kbelíku leží.
 */
export async function smazatFotku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const fotka = await jeden<{ cesta: string }>(
    'fotka ke smazání',
    supabase
      .from('marketing_media')
      .select('cesta')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle(),
  )

  if (!fotka) {
    zpetSChybou(rozsah, 'Ta fotka už v knihovně není.')
  }

  const smazano = await supabase.storage.from(KBELIK).remove([fotka.cesta])
  if (smazano.error) {
    zpetSChybou(rozsah, `Soubor se nepodařilo smazat: ${smazano.error.message}`)
  }

  const { error } = await supabase.from('marketing_media').delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) {
    zpetSChybou(rozsah, `Soubor je smazaný, ale řádek v knihovně zůstal: ${error.message}`)
  }

  revalidatePath(`/${rozsah}/marketing/media`)
  redirect(`/${rozsah}/marketing/media`)
}

/**
 * Práva k použití.
 *
 * `pouzitelne_do` je datum, do kdy smí fotka ven — svolení hosta,
 * licence od fotografa. Hlídá to fronta těsně před odesláním
 * (20260910040000_marketing_fronta.sql), ne tahle obrazovka: mezi
 * naplánováním a zveřejněním uplyne i týden.
 */
export async function ulozitPrava(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const { error } = await supabase
    .from('marketing_media')
    .update({
      puvod: String(formData.get('puvod') ?? '').slice(0, 300),
      souhlas_poznamka: String(formData.get('souhlas_poznamka') ?? '').slice(0, 500),
      pouzitelne_do: neboNull(formData.get('pouzitelne_do')),
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) zpetSChybou(rozsah, `Nepovedlo se uložit: ${error.message}`)

  revalidatePath(`/${rozsah}/marketing/media`)
  redirect(`/${rozsah}/marketing/media`)
}

/** Prázdné políčko je `null`, ne prázdný řetězec — datum by na něm spadlo. */
function neboNull(hodnota: FormDataEntryValue | null): string | null {
  const t = String(hodnota ?? '').trim()
  return t === '' ? null : t
}
