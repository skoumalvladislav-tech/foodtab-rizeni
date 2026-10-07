import 'server-only'

import { cache } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getServerSupabase } from '@/lib/supabase/server'
import { jeVlastnikFakturyDb } from '@/lib/faktury-vlastnik'

/**
 * Připojení k databázi Faktur — SAMOSTATNÝ Supabase projekt.
 *
 * Zadání: docs/hlaseni/zadani-pro-ai-marketing-faktury.md, „PROJEKT 2:
 * Faktury — sloučení s Foodtabem", možnost A (zachovat oddělené DB).
 * Modul žije uvnitř Foodtabu, ale data faktur zůstávají v projektu
 * `ctqtwahlzhyjerqulqyn` — jiná databáze, jiný anon klíč, žádné
 * sdílené přihlášení.
 *
 * ---------------------------------------------------------------------
 * KDO SEM SMÍ, ROZHODUJE FOODTAB — NE TAHLE DATABÁZE
 *
 * Faktura-DB nemá vlastní přihlašování (RLS „allow all" pro anon roli)
 * a NEMÁ sloupec `tenant_id` — ověřeno živě 7.10.2026 dotazem
 * (`column invoices.tenant_id does not exist`). Kód z 2.10. na ten
 * sloupec filtroval, takže každý dotaz padal a modul ukazoval prázdno.
 *
 * Izolace proto stojí na jediné bráně: `pristupKFakturam()` pustí dál
 * jen firmu, které databáze patří (lib/faktury-vlastnik.ts). Klient
 * k databázi Faktur se mimo tenhle soubor NEVYTVÁŘÍ — hlídá to
 * scripts/faktury-tenant-izolace.test.mjs. Oprávnění na obrazovku
 * (`faktury.read`/`faktury.manage`) si dál ověřuje každá stránka sama.
 *
 * ---------------------------------------------------------------------
 * VEŘEJNÝ KLÍČ, NE SERVISNÍ
 *
 * Stejné pravidlo jako u `getServerSupabase()` (pravidlo č. 6) — i když
 * má tahle databáze otevřenou RLS, servisní klíč by ji obcházel natvrdo
 * a do aplikační vrstvy nepatří nikdy.
 */

export type FakturyKlient = SupabaseClient

/** `true`, jen když jsou obě proměnné prostředí vyplněné. */
export function fakturyJsouNastavene(): boolean {
  return Boolean(process.env.FAKTURY_SUPABASE_URL && process.env.FAKTURY_SUPABASE_ANON_KEY)
}

function vytvoritKlienta(): FakturyKlient {
  return createClient(process.env.FAKTURY_SUPABASE_URL!, process.env.FAKTURY_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })
}

export type PristupKFakturam =
  | { stav: 'ok'; faktury: FakturyKlient }
  | { stav: 'nenastaveno' }
  | { stav: 'jina_firma'; icoFirmy: string | null }

const icoFirmy = cache(async (tenantId: string): Promise<string | null> => {
  const supabase = await getServerSupabase()
  const { data } = await supabase.from('tenants').select('ico').eq('id', tenantId).maybeSingle()
  return (data?.ico as string | null | undefined) ?? null
})

/**
 * Jediná cesta k databázi Faktur pro přihlášeného uživatele.
 *
 * `tenantId` musí pocházet ze serveru (`getCurrentTenantId()`), nikdy
 * z formuláře. IČO se čte pod RLS přihlášeného uživatele — firmu, do
 * které nepatří, appka ani neuvidí.
 */
export async function pristupKFakturam(tenantId: string): Promise<PristupKFakturam> {
  if (!fakturyJsouNastavene()) return { stav: 'nenastaveno' }
  const ico = await icoFirmy(tenantId)
  if (!jeVlastnikFakturyDb({ id: tenantId, ico }, process.env.FAKTURY_DB_TENANT_ID)) {
    return { stav: 'jina_firma', icoFirmy: ico }
  }
  return { stav: 'ok', faktury: vytvoritKlienta() }
}

/**
 * Totéž pro naplánovanou úlohu bez přihlášeného uživatele. IČO firmy
 * dodá volající ze servisního klienta podle `tenant_id` připojení —
 * nikdy z požadavku.
 */
export function pristupKFakturamUlohy(firma: { id: string; ico: string | null }): PristupKFakturam {
  if (!fakturyJsouNastavene()) return { stav: 'nenastaveno' }
  if (!jeVlastnikFakturyDb(firma, process.env.FAKTURY_DB_TENANT_ID)) return { stav: 'jina_firma', icoFirmy: firma.ico }
  return { stav: 'ok', faktury: vytvoritKlienta() }
}
