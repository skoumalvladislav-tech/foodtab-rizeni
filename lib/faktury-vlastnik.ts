/**
 * Komu patří databáze Faktur (`ctqtwahlzhyjerqulqyn`).
 *
 * Ta databáze je JEDNOFIREMNÍ: nemá sloupec `tenant_id` (SQL z
 * docs/hlaseni/faktury-tenant-izolace-2026-10-02.md nikdy neproběhlo a
 * bez přihlášení do toho Supabase projektu ani proběhnout nemůže) a
 * všechny řádky v ní zapsal n8n pro Foodtab s.r.o. Izolace firem proto
 * nestojí na filtru v dotazu, ale na tom, KDO se k databázi vůbec
 * dostane: jen firma, které patří. Ostatní firmy dostanou „nenapojeno",
 * ne cizí faktury.
 *
 * Bez `server-only`, ať se rozhodnutí dá testovat i v CI bez Next.js.
 */

export const FAKTURY_DB_ICO_VLASTNIKA = '21249946'

/** IČO se v různých zdrojích píše s mezerami nebo s předponou „CZ" (DIČ). */
export function normalizovatIco(ico: string | null | undefined): string {
  return (ico ?? '').replace(/\s+/g, '').replace(/^CZ/i, '')
}

/**
 * `tenantIdVlastnika` je výslovné nastavení (FAKTURY_DB_TENANT_ID) pro
 * případ, že firma nemá v appce vyplněné IČO — má přednost, protože ho
 * někdo nastavil vědomě. Prázdné nastavení se ignoruje, nikdy nepovolí
 * všechny.
 */
export function jeVlastnikFakturyDb(firma: { id: string; ico: string | null | undefined }, tenantIdVlastnika?: string | null): boolean {
  const vynuceny = (tenantIdVlastnika ?? '').trim()
  if (vynuceny) return firma.id === vynuceny
  return normalizovatIco(firma.ico) === FAKTURY_DB_ICO_VLASTNIKA
}
