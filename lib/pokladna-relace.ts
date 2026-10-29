import 'server-only'

import { klientUlohy } from './supabase/uloha.ts'
import { rozsifrovat } from './integrace-klice.ts'
import { ADAPTERY_POKLADEN } from './pokladna-adaptery.ts'
import type { ExterniUcetPokladny } from './pokladna-prirazeni.ts'
import type { RelacePos, SchopnostiPosProvidera } from './pos-provider-contract.ts'

/**
 * Otevřená relace pokladny pro Jiné platby — katalog, dohledání účtů,
 * kontrola proti pokladně (docs/jine-platby-navrh.md, oddíly 3.7 a 7).
 * Agenda se ptá jen kontraktu (`RelacePos` + `SchopnostiPosProvidera`),
 * konkrétní pokladnu nezná.
 *
 * Rozšifrování přístupu a otevření je ZKOPÍROVANÉ z `lib/pokladna-sync.ts`
 * (`synchronizovatPokladnu`, část „integrace_tajemstvi → rozsifrovat →
 * adapter.otevrit"). Sdílená funkce by znamenala zásah do synchronizace;
 * rozdíl je schválný: tady se NIC nezapisuje — ani stav připojení
 * („vyžaduje pozornost" po neplatném tokenu zapíše až synchronizace),
 * ani zámek běhu. Kdo mění jedno, ať zkontroluje i druhé.
 *
 * SERVICE_ROLE: `klientUlohy()` obchází RLS. Volat se smí jen ze serverové
 * akce Jiných plateb PO ověření práva (`zkusPristupJinymPlatbam` a právo
 * agendy na pobočce záznamu) a jen s `tenantId` firmy ověřené stejnou
 * kontrolou — nikdy s id z prohlížeče, které nikdo neověřil. Připojení se
 * hledá s `tenant_id` firmy, takže cizí připojení nevrátí, ani když by
 * `pripojeniId` bylo cizí.
 */

export type RelacePokladny =
  | {
      stav: 'ok'
      relace: RelacePos
      schopnosti: SchopnostiPosProvidera
      /** Provozovny pokladny a jejich přiřazení k pobočkám (`externi_ucet.provozovny[]`). */
      provozovny: { id: string; branch_id: string | null }[]
    }
  | { stav: 'chyba'; duvod: string }

type Pripojeni = {
  id: string
  poskytovatel: string
  externi_ucet: ExterniUcetPokladny | null
}

export async function otevritRelaciPokladny(pripojeniId: string, tenantId: string): Promise<RelacePokladny> {
  const supabase = klientUlohy()
  if (!supabase) return { stav: 'chyba', duvod: 'Spojení s pokladnou není na serveru nastavené — chybí SUPABASE_SERVICE_ROLE_KEY.' }

  const { data } = await supabase
    .from('integrace_pripojeni')
    .select('id, poskytovatel, externi_ucet')
    .eq('id', pripojeniId)
    .eq('tenant_id', tenantId)
    .eq('oblast', 'pokladna')
    .is('odpojeno_kdy', null)
    .maybeSingle()

  const p = data as Pripojeni | null
  if (!p) return { stav: 'chyba', duvod: 'Připojení pokladny neexistuje nebo je odpojené.' }

  const adapter = ADAPTERY_POKLADEN[p.poskytovatel]
  // Pokladna přes příjmové API (`obecne`) data posílá sama — appka se jí ptát neumí.
  if (!adapter) return { stav: 'chyba', duvod: 'Tahle pokladna posílá data sama — appka se jí na účty ani katalog ptát neumí.' }

  // --- zkopírováno z lib/pokladna-sync.ts (rozšifrování), bez zápisu stavu připojení ---
  const { data: tajemstvi } = await supabase
    .from('integrace_tajemstvi')
    .select('sifra')
    .eq('pripojeni_id', p.id)
    .maybeSingle()

  let udaje: Record<string, string>
  try {
    if (!tajemstvi) throw new Error('chybí')
    udaje = rozsifrovat(tajemstvi.sifra)
  } catch {
    return { stav: 'chyba', duvod: tajemstvi ? 'Uložený přístup k pokladně se nepodařilo rozšifrovat — vložte token znovu.' : 'Chybí uložený přístup k pokladně — vložte token znovu.' }
  }

  const otevreni = await adapter.otevrit(udaje)
  if (otevreni.stav === 'chyba') return { stav: 'chyba', duvod: otevreni.duvod }
  // --- konec kopie ---

  const provozovny = (p.externi_ucet?.provozovny ?? [])
    .filter((o) => typeof o?.id === 'string' && o.id !== '')
    .map((o) => ({ id: o.id, branch_id: o.branch_id ?? null }))

  return { stav: 'ok', relace: otevreni.relace, schopnosti: adapter.schopnosti, provozovny }
}
