import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { ADAPTERY_POKLADEN } from '@/lib/pokladna-adaptery'
import { najitPokladnu } from '@/lib/pokladna-poskytovatele'

/**
 * Netajné údaje o pokladně záznamu pro detail Jiných plateb: název,
 * poskytovatel, co pokladna umí (katalog, dohledání účtů, skladový výdej)
 * a provozovna u poskytovatele.
 *
 * `integrace_pripojeni` čte přes RLS jen ten, kdo má `finance.read`.
 * Schvalovatel výdeje (`jine_platby.vydej_pos`) ani obsluha ho mít
 * nemusí — a přitom musí vidět, DO KTERÉ pokladny a provozovny se výdej
 * zapisuje. Proto databázová funkce `jine_platby_pokladny` (SECURITY
 * DEFINER, jen s právem agendy NA pobočce záznamu, jen netajné sloupce),
 * volaná UŽIVATELSKÝM klientem — žádný service_role.
 *
 * Funkce vrací jen neodpojené pokladny, které pobočku obsluhují. Pokladna
 * záznamu mezi nimi chybí = mezitím odpojená nebo přeřazená → `null`
 * (stránka pak nezná její schopnosti, takže dohledání v pokladně
 * nenabídne). Tlačítko ale nic nechrání: kontrolu odmítne akce, když
 * uložená provozovna záznamu už nepatří jeho pobočce (akce-pos.ts,
 * `zjistitVPokladne`), a zápis kontroly i výdej databáze
 * (`app.jp_pokladna_obsluhuje`).
 *
 * Schopnosti jsou z adaptéru (`ADAPTERY_POKLADEN`), ne z databáze: o tom,
 * co pokladna umí, rozhoduje kód adaptéru (Dotykačka: `skladovyVydej:
 * 'rucne'`, dokud zápis nikdo nepřipojí).
 */

export type MetadataPokladny = {
  nazev: string
  nazevPoskytovatele: string
  odpojena: boolean
  katalog: boolean
  dohledaniUctu: boolean
  /** Chybí v kontraktu = 'rucne' (lib/pos-provider-contract.ts). */
  skladovyVydej: 'api' | 'rucne' | 'nepodporovano'
  provozovny: { id: string; nazev: string; branchId: string | null }[]
}

type RadekPokladny = {
  id: string
  nazev: string | null
  poskytovatel: string
  stav: string
  pos_provozovna: string | null
  provozovna_nazev: string | null
}

export async function metadataPokladny(
  supabase: SupabaseClient,
  pripojeniId: string,
  tenantId: string,
  branchId: string,
): Promise<MetadataPokladny | null> {
  const { data, error } = await supabase.rpc('jine_platby_pokladny', { p_tenant: tenantId, p_branch: branchId })
  if (error || !Array.isArray(data)) return null
  const r = (data as RadekPokladny[]).find((p) => p.id === pripojeniId)
  if (!r) return null

  const adapter = ADAPTERY_POKLADEN[r.poskytovatel]
  const popis = najitPokladnu(r.poskytovatel)
  const nazevPoskytovatele = popis?.nazev ?? r.poskytovatel
  return {
    nazev: (r.nazev ?? '').trim() || nazevPoskytovatele,
    nazevPoskytovatele,
    odpojena: false,
    katalog: adapter?.schopnosti.katalog === true,
    dohledaniUctu: adapter?.schopnosti.dohledaniUctu === true,
    // Pokladna bez adaptéru (posílá data sama): appka se jí ptát neumí, výdej dělá člověk v pokladně.
    skladovyVydej: adapter?.schopnosti.skladovyVydej ?? 'rucne',
    provozovny: r.pos_provozovna
      ? [{ id: r.pos_provozovna, nazev: (r.provozovna_nazev ?? '').trim() || r.pos_provozovna, branchId }]
      : [],
  }
}
