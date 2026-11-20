/**
 * Zápis staženého nebo importovaného výpisu — jedna cesta pro všechny
 * banky i pro soubor (`importovat_vypis`, migrace 20261119100000).
 *
 * Dávka i pohyby vzniknou v JEDNÉ databázové transakci: když zápis
 * pohybů spadne, nezůstane po něm dávka, která by opakovaný import
 * téhož souboru odmítla jako „už importovaný". Dvojí import hlídá
 * databáze — id od banky, a kde id není, otisk pohybu i s pořadím
 * stejného řádku ve výpisu (dvě stejné platby v jednom výpisu zůstanou
 * dvě).
 *
 * Bez `server-only` a bez vlastního klienta: klienta dává volající
 * (přihlášený u importu souboru, služba u úlohy), takže kód jde zkusit
 * s podstrčeným klientem (scripts/banka-konektor.test.mjs).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { radkyProImport, ZDROJ_BANKY_API, type PohybBanky } from './konektor.ts'

/** Zdroje, které `importovat_vypis` přijme. */
export type ZdrojVypisu = typeof ZDROJ_BANKY_API | 'csv_banka' | 'csv_pokladna'

export type VysledekZapisu =
  | { stav: 'ok'; davkaId: string | null; pocetNovych: number }
  | { stav: 'chyba'; kod: string | null; duvod: string }

export async function zapsatVypis(
  supabase: Pick<SupabaseClient, 'rpc'>,
  v: { tenantId: string; ucetId: string; zdroj: ZdrojVypisu; souborNazev: string; souborHash: string; pohyby: readonly PohybBanky[] },
): Promise<VysledekZapisu> {
  // Prázdné stažení nic nezakládá (stejně jako dřív) — dávka bez řádků by
  // jen zabrala hash.
  if (v.pohyby.length === 0) return { stav: 'ok', davkaId: null, pocetNovych: 0 }

  const { data, error } = await supabase.rpc('importovat_vypis', {
    p_tenant: v.tenantId,
    p_ucet: v.ucetId,
    p_zdroj: v.zdroj,
    p_soubor_nazev: v.souborNazev,
    p_soubor_hash: v.souborHash,
    p_radky: radkyProImport(v.pohyby),
  })
  if (error) return { stav: 'chyba', kod: error.code ?? null, duvod: error.message }

  // Funkce vrací tabulku o jednom řádku.
  const radek = (Array.isArray(data) ? data[0] : data) as { davka_id?: unknown; pocet_novych?: unknown } | null | undefined
  const davkaId = typeof radek?.davka_id === 'string' ? radek.davka_id : null
  if (!davkaId) return { stav: 'chyba', kod: null, duvod: 'Databáze nevrátila dávku importu.' }
  return { stav: 'ok', davkaId, pocetNovych: Number(radek?.pocet_novych ?? 0) }
}
