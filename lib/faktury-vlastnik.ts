/**
 * Komu patří databáze Faktur (`ctqtwahlzhyjerqulqyn`).
 *
 * Ta databáze je JEDNOFIREMNÍ: nemá sloupec `tenant_id` (SQL z
 * docs/hlaseni/faktury-tenant-izolace-2026-10-02.md nikdy neproběhlo a
 * bez přihlášení do toho Supabase projektu ani proběhnout nemůže) a
 * všechny řádky v ní zapsal n8n pro Foodtab s.r.o. Izolace firem proto
 * nestojí na filtru v dotazu, ale na tom, KDO se k databázi vůbec
 * dostane: jen firma, jejíž id je v nastavení prostředí
 * FAKTURY_DB_TENANT_ID. Bez nastavení se nedostane nikdo.
 *
 * PROČ NE PODLE IČO: IČO si správce firmy (settings.manage) může v
 * tabulce `tenants` přepsat sám a není unikátní — kdo by si napsal
 * 21249946, dostal by faktury Foodtabu. Nastavení prostředí uživatel
 * appky změnit nemůže a id firmy se nemění.
 *
 * Bez `server-only`, ať se rozhodnutí dá testovat i v CI bez Next.js.
 */

export function jeVlastnikFakturyDb(tenantId: string, tenantIdVlastnika: string | null | undefined): boolean {
  const vlastnik = (tenantIdVlastnika ?? '').trim().toLowerCase()
  return vlastnik !== '' && tenantId.trim().toLowerCase() === vlastnik
}
