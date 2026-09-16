'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { BRANCH_COLORS, getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { precistObrazek } from '@/lib/marketing-obrazek'
import { KBELIK, cestaVUlozisti } from '@/lib/pobocky-pozadi'
import { sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Úprava pobočky.
 *
 * Zapisuje se běžným updatem do branches; kdo smí, rozhoduje politika
 * branches_update, tedy settings.manage v rozsahu firmy. Aplikace se
 * dopředu neptá — jen neposílá nesmysl a odmítnutí ukáže.
 *
 * Barvy si nastavuje zákazník sám, do kódu nepatří. Ověřuje se jen to,
 * že klíč je z palety, kterou zná i podmínka na sloupci.
 */
export async function upravitPobocku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const barva = String(formData.get('barva') ?? '')
  const zacatek = String(formData.get('zacatek') ?? '').trim()
  // Nepovinné — prázdné pole má zůstat NULL (žádný widget počasí),
  // ne se rozbít na NaN. Viz popisChyby('souradnice') v page.tsx.
  const latText = String(formData.get('lat') ?? '').trim()
  const lonText = String(formData.get('lon') ?? '').trim()

  if (!pobocka) return

  const user = await getUser()
  if (!user) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const ctx = await getContext(tenantId)
  if (!ctx) return

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return

  const zpet = (duvod: string) =>
    `/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&chyba=${duvod}`

  const lat = latText === '' ? null : Number(latText)
  const lon = lonText === '' ? null : Number(lonText)

  let chyba: string | null = null

  if (nazev === '') chyba = 'nazev'
  else if (!(BRANCH_COLORS as readonly string[]).includes(barva)) chyba = 'barva'
  else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(zacatek)) chyba = 'hodina'
  // Obě souřadnice, nebo žádná — jen jedna by widgetu počasí nebyla
  // k ničemu a tiše by se nekreslil, což vypadá jako druhá zapomenutá.
  else if ((lat === null) !== (lon === null)) chyba = 'souradnice'
  else if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) chyba = 'souradnice'
  else if (lon !== null && (Number.isNaN(lon) || lon < -180 || lon > 180)) chyba = 'souradnice'

  // Až za kontrolami: redirect() vyhazuje výjimku.
  if (chyba) redirect(zpet(chyba))

  const supabase = await getServerSupabase()
  let { error } = await supabase
    .from('branches')
    .update({
      name: nazev,
      color: barva,
      // Sloupec je typu time, takže stačí HH:MM.
      day_starts_at: zacatek,
      lat,
      lon,
    })
    .eq('id', pobocka)
    .eq('tenant_id', tenantId)

  /*
    Sloupce lat/lon čekají na migraci 20260916170000_pobocka_pocasi —
    dokud neproběhne, zápis s nimi selže. Beze souřadnic (ty appka
    beztak zatím nekreslí, viz lib/pocasi.ts) se zbytek — jméno, barva,
    začátek dne — má uložit stejně jako dřív, ne spadnout kvůli
    nehotové věci, o kterou tady vůbec nejde.
  */
  if (error && sloupecNeexistuje(error)) {
    ;({ error } = await supabase
      .from('branches')
      .update({ name: nazev, color: barva, day_starts_at: zacatek })
      .eq('id', pobocka)
      .eq('tenant_id', tenantId))
  }

  if (error) {
    // 42501 = insufficient_privilege. Politika branches_update žádá
    // settings.manage; bez něj se sem člověk dostane jen obejitím
    // rozhraní, ale hlášku si zaslouží stejně.
    redirect(zpet(error.code === '42501' ? 'pravo' : 'nepovedlo'))
  }

  revalidatePath(`/${rozsah}/nastaveni/pobocky`)
  redirect(`/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&ulozeno=1`)
}

/**
 * Nahrání fotky pozadí — hero banner na Dnes.
 *
 * Jedna fotka na pobočku, ne knihovna: cesta je odvozená z id pobočky
 * (lib/pobocky-pozadi.ts), nahrání jede s upsert:true a novou fotkou
 * se prostě přepíše ta stará. Typ a rozměr se ověřují stejnou funkcí
 * jako v marketingové knihovně fotek (lib/marketing-obrazek.ts) —
 * kontrola typu z obsahu, ne z přípony, platí tady stejně.
 *
 * O zápis se dál stará i RLS na storage.objects
 * (20260916160000_pobocka_pozadi.sql, settings.manage) — kontrola tady
 * je jen první linie, ne jediná.
 */
export async function nahratPozadiPobocky(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  if (!pobocka) return

  const user = await getUser()
  if (!user) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const ctx = await getContext(tenantId)
  if (!ctx) return

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return

  const zpet = (duvod: string) =>
    `/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&chyba=${duvod}`

  const soubor = formData.get('fotka')
  if (!(soubor instanceof File) || soubor.size === 0) {
    redirect(zpet('fotka'))
  }

  const data = new Uint8Array(await soubor.arrayBuffer())
  const precteno = precistObrazek(data)
  if (precteno.stav === 'chyba') {
    redirect(zpet('fotka'))
  }

  const supabase = await getServerSupabase()
  const kam = cestaVUlozisti(tenantId, pobocka, precteno.obrazek.pripona)

  const nahrano = await supabase.storage.from(KBELIK).upload(kam, data, {
    contentType: precteno.obrazek.typ,
    // Na rozdíl od marketingové knihovny tu upsert dává smysl — jedna
    // fotka na pobočku, nová cesta stará jen přepíše.
    upsert: true,
  })
  if (nahrano.error) redirect(zpet('nahrani'))

  const { error } = await supabase
    .from('branches')
    .update({ hero_photo_path: kam })
    .eq('id', pobocka)
    .eq('tenant_id', tenantId)

  if (error) {
    // Fotka je nahraná, sloupec se nezapsal — bez úklidu by v kbelíku
    // zůstal soubor, na který appka nikdy neukáže.
    await supabase.storage.from(KBELIK).remove([kam])
    redirect(zpet(error.code === '42501' ? 'pravo' : 'nepovedlo'))
  }

  revalidatePath(`/${rozsah}/nastaveni/pobocky`)
  revalidatePath(`/${rozsah}/dnes`)
  redirect(`/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&ulozeno=1`)
}

/** Smazání fotky pozadí — vrátí hero banner na barvu pobočky. */
export async function smazatPozadiPobocky(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const pobocka = String(formData.get('pobocka') ?? '')
  if (!pobocka) return

  const user = await getUser()
  if (!user) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const ctx = await getContext(tenantId)
  if (!ctx) return

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return

  const zpet = (duvod: string) =>
    `/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&chyba=${duvod}`

  const supabase = await getServerSupabase()

  const { data: radek } = await supabase
    .from('branches')
    .select('hero_photo_path')
    .eq('id', pobocka)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const { error } = await supabase
    .from('branches')
    .update({ hero_photo_path: null })
    .eq('id', pobocka)
    .eq('tenant_id', tenantId)

  if (error) redirect(zpet(error.code === '42501' ? 'pravo' : 'nepovedlo'))

  const cesta = (radek as { hero_photo_path: string | null } | null)?.hero_photo_path
  if (cesta) await supabase.storage.from(KBELIK).remove([cesta])

  revalidatePath(`/${rozsah}/nastaveni/pobocky`)
  revalidatePath(`/${rozsah}/dnes`)
  redirect(`/${rozsah}/nastaveni/pobocky?pobocka=${pobocka}&ulozeno=1`)
}
