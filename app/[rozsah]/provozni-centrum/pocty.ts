import { hasAccess } from '@/lib/authz'
import { skryteZalozky, type KlicZalozky } from '@/lib/komunikace/zalozky'
import type { getServerSupabase } from '@/lib/supabase/server'
import { neprectenaNastenka } from '../vzkazy/nastenka-dotaz'

/**
 * Čísla a skryté záložky „Vzkazy a úkoly“ — JEDNA funkce pro všechny
 * stránky pod touhle položkou (Komunikace, rozhovor, nový rozhovor,
 * úkol ze zprávy, Úkoly, detail úkolu, Checklisty, Nástěnka).
 *
 * Do 27. 9. si každá stránka počítala po svém: na Komunikaci bylo
 * číslo u Nástěnky, na Úkolech jen u Úkolů, v rozhovoru jen
 * u Komunikace. Při přepínání se čísla objevovala a mizela.
 *
 *   * Komunikace — nepřečtené zprávy v rozhovorech (`moje_rozhovory`).
 *     Stránka, která seznam už má, ho předá, ať se nepočítá dvakrát.
 *   * Úkoly — OTEVŘENÉ úkoly pobočky (nebo celé firmy), tentýž filtr
 *     jako seznam na /ukoly. Není to „nepřečtené“ a čtečka to tak čte.
 *   * Nástěnka — nepřečtená oznámení ze STEJNÉHO dotazu jako seznam
 *     (`dotazNastenky`).
 *   * Checklisty číslo nemají (otevřené běhy visí i týdny, P14).
 *
 * Chyby se nevyhazují: číslo u záložky je pomocný údaj a kvůli němu
 * nemá padat obrazovka. Když se nepovede, záložka je bez čísla.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

export type ZalozkyVzkazu = {
  pocty: Partial<Record<KlicZalozky, number>>
  skryte: KlicZalozky[]
}

export async function nactiZalozky(
  supabase: Supabase,
  vstup: {
    tenantId: string
    userId: string
    /** `scope.branchId` — null na firemní úrovni. */
    branchId: string | null
    /** Už načtený `moje_rozhovory`, pokud ho stránka má. */
    rozhovory?: { neprectenych: number }[] | null
  },
): Promise<ZalozkyVzkazu> {
  const { tenantId, userId, branchId } = vstup

  const [smiUkoly, smiNastenku] = await Promise.all([
    hasAccess(tenantId, 'tasks.read', branchId),
    hasAccess(tenantId, 'communication.read', branchId),
  ])

  const [komunikace, ukoly, nastenka] = await Promise.all([
    (async () => {
      if (vstup.rozhovory) return soucetNeprectenych(vstup.rozhovory)
      const { data, error } = await supabase.rpc('moje_rozhovory', { p_tenant: tenantId })
      return error ? 0 : soucetNeprectenych((data ?? []) as { neprectenych: number }[])
    })(),
    (async () => {
      if (!smiUkoly) return 0
      let q = supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'open')
      // Firemní úkoly (branch_id prázdné) patří i pobočce — jako na /ukoly.
      if (branchId) q = q.or(`branch_id.eq.${branchId},branch_id.is.null`)
      const { count, error } = await q
      return error ? 0 : (count ?? 0)
    })(),
    smiNastenku ? neprectenaNastenka(supabase, tenantId, userId, branchId) : Promise.resolve(0),
  ])

  return {
    pocty: { komunikace, ukoly, nastenka },
    skryte: skryteZalozky({ ukoly: smiUkoly, nastenka: smiNastenku }),
  }
}

function soucetNeprectenych(rozhovory: { neprectenych: number }[]): number {
  return rozhovory.reduce((s, r) => s + (Number(r.neprectenych) || 0), 0)
}
