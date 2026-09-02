import 'server-only'

import { timingSafeEqual } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Klient pro naplánované úlohy.
 *
 * ---------------------------------------------------------------------
 * PROČ EXISTUJE
 *
 * Naplánovaná úloha nemá přihlášeného člověka. Běžný serverový klient
 * jede pod účtem toho, kdo se ptá — a tady se neptá nikdo, takže by
 * politiky nepustily nic.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLO 6
 *
 * `service_role` obchází politiky, takže se do prohlížeče nesmí dostat
 * NIKDY. Proto:
 *
 *   * `import 'server-only'` — když se tenhle modul omylem dostane do
 *     klientského grafu, překlad SPADNE. Ne varování, chyba.
 *   * proměnná se jmenuje bez `NEXT_PUBLIC_`, takže ji Next do balíčku
 *     pro prohlížeč nedá ani nedopatřením.
 *
 * Klíč otevírá celou databázi. Volat se s ním smí jen to, co je
 * v `app/api/uloha/…`, a jen za tajemstvím.
 *
 * ---------------------------------------------------------------------
 * KDYŽ KLÍČ CHYBÍ
 *
 * Vrací `null`, ne výjimku s obsahem prostředí. Adresa pak odpoví
 * srozumitelně, že úloha není nastavená — a nikdo se z odpovědi
 * nedozví, co v prostředí je a co ne.
 */
export function klientUlohy(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const klic = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !klic) return null

  return createClient(url, klic, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Porovnání tajemství v konstantním čase.
 *
 * `a === b` u řetězců končí na prvním rozdílném znaku, takže se dá
 * z doby odpovědi uhodnout, kolik znaků sedí. U tajemství, které chrání
 * adresu volatelnou z internetu, to není teoretická úvaha.
 */
export function tajemstviSedi(prislo: string | null, ocekavane: string | undefined): boolean {
  if (!ocekavane || !prislo) return false

  const a = Buffer.from(prislo, 'utf8')
  const b = Buffer.from(ocekavane, 'utf8')

  // Délky se porovnávají zvlášť; `timingSafeEqual` na různé délky spadne.
  // Rozdílná délka se pozná i tak, ale samotný obsah se neprozradí.
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
