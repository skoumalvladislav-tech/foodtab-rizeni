/**
 * Fotka pozadí pobočky — společné údaje pro obrazovku i akce.
 *
 * Vlastní soubor proto, že modul označený `'use server'` smí vyvážet
 * jen funkce (viz stejný důvod u lib/marketing-media.ts).
 */

/** Jméno kbelíku. Musí sedět s 20260916160000_pobocka_pozadi.sql. */
export const KBELIK = 'pobocky'

/**
 * Jak dlouho platí podepsaný odkaz na fotku.
 *
 * Hodina — stejná úvaha jako u marketingové knihovny
 * (lib/marketing-media.ts): kratší by rozbila Dnes někomu, kdo ji má
 * otevřenou přes oběd; delší by znamenala odkaz fungující ještě dlouho
 * po odebrání práv.
 */
export const PLATNOST_ODKAZU_S = 3600

/**
 * Cesta v úložišti: firma / pobočka.přípona.
 *
 * Jedna fotka na pobočku, ne knihovna — proto žádné náhodné jméno,
 * cesta je odvozená přímo z id pobočky a nahrání jede s upsert:true.
 * Musí sedět s app.pobocky_cesta_rozsah v migraci.
 */
export function cestaVUlozisti(tenantId: string, branchId: string, pripona: string): string {
  return `${tenantId}/${branchId}.${pripona}`
}
