import { jeNoveProMe, type CtenarNastenky, type OznameniKRazeni } from '@/lib/komunikace/nastenka'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import type { getServerSupabase } from '@/lib/supabase/server'

/**
 * Jeden dotaz na Nástěnku — pro seznam i pro číslo u záložky.
 *
 * Do 27. 9. seznam bral jen „moje pobočka nebo celá firma“, kdežto
 * číslo u záložky a ve zvonečku počítalo všechna oznámení, na která
 * člověk dosáhne. Kdo dělá na dvou pobočkách, měl u Nástěnky číslo,
 * které nikdy nezmizelo: oznámení druhé pobočky v seznamu neviděl,
 * a tak je nemohl ani označit za přečtená. Teď oba berou tenhle dotaz,
 * takže se rozejít nemůžou.
 *
 * Zpráva bez pobočky (`branch_id` prázdné) patří celé firmě a vidí ji
 * i ten, kdo je na pobočce. Kdo nemá `communication.read`, dostane od
 * RLS prázdno (politika `announcements_read`).
 *
 * ČÍSLO POČÍTÁ JEN OZNÁMENÍ PRO MĚ (28. 9.) — `jeProMe`
 * v lib/komunikace/nastenka.ts. Vlastní oznámení a oznámení pro jiné
 * úseky, pozice a lidi, která vedoucímu pustí RLS, se do čísla
 * nepočítají; v seznamu se ukážou bez štítku a bez tlačítka.
 */

export const POCET_NASTENKY = 50

/** Sloupce, které potřebuje `jeProMe` (adresát a autor). */
export const SLOUPCE_ADRESY = 'id, pinned, requires_acknowledgment, created_at, author_id, employee_id, usek_id, position_id, branch_id'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

export function dotazNastenky(
  supabase: Supabase,
  tenantId: string,
  /** Pobočka z rozsahu adresy (`scope.branchId`); null = firemní úroveň. */
  branchId: string | null,
  sloupce: string,
) {
  let dotaz = supabase
    .from('announcements')
    .select(sloupce)
    .eq('tenant_id', tenantId)
    // Připnuté napřed, ať se do limitu vejdou vždycky; výsledné pořadí
    // na obrazovce skládá `seraditOznameni` (lib/komunikace/nastenka.ts).
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(POCET_NASTENKY)

  if (branchId) {
    dotaz = dotaz.or(`branch_id.eq.${branchId},branch_id.is.null`)
  }
  return dotaz
}

/**
 * Kdo čte: vlastní řádek v `employees` (politika employees_select pustí
 * vlastní řádek vždy). Když se nenačte, je čtenář bez zaměstnaneckého
 * záznamu a pro něj není nic — stejně jako u upozornění.
 */
export async function nactiCtenare(supabase: Supabase, tenantId: string, userId: string): Promise<CtenarNastenky> {
  const { data } = await supabase
    .from('employees')
    .select('id, branch_id, usek_id, position_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle()
  const e = (data ?? null) as { id: string; branch_id: string | null; usek_id: string | null; position_id: string | null } | null
  return {
    userId,
    employeeId: e?.id ?? null,
    branchId: e?.branch_id ?? null,
    usekId: e?.usek_id ?? null,
    positionId: e?.position_id ?? null,
  }
}

/**
 * Kdo z předaných lidí Nástěnku smí číst (`communication.read`).
 *
 * Právo JINÉHO člověka aplikace sama nezjistí — počítá ho databáze
 * (`public.ctenari_nastenky`, migrace 20260927100000, oddíl 12). Funkce
 * vrátí jen podmnožinu předaných id a jen volajícímu, který oznámení
 * psát smí.
 *
 * 'bez-funkce' = migrace ještě není v databázi (PR se sloučí dřív než
 * `db push`). Pak se chová jako dosud: nabízí a přijme každého s účtem.
 * Není to bezpečnostní hranice — oznámení ani tak nikomu neukáže víc,
 * než smí (to hlídá RLS), jen by tiše nedošlo.
 */
export type CtenariNastenky = { stav: 'ok'; ids: Set<string> } | { stav: 'bez-funkce' } | { stav: 'chyba' }

export async function ctenariNastenky(supabase: Supabase, tenantId: string, lide: string[]): Promise<CtenariNastenky> {
  if (lide.length === 0) return { stav: 'ok', ids: new Set() }
  const { data, error } = await supabase.rpc('ctenari_nastenky', { p_tenant: tenantId, p_lide: lide })
  if (error) return funkceNeexistuje(error) ? { stav: 'bez-funkce' } : { stav: 'chyba' }
  return { stav: 'ok', ids: new Set(((data ?? []) as { employee_id: string }[]).map((r) => r.employee_id)) }
}

/** Kolik oznámení z `dotazNastenky` PRO MĚ ještě nemám přečtených. Chyba = 0 (pomocné číslo). */
export async function neprectenaNastenka(
  supabase: Supabase,
  tenantId: string,
  userId: string,
  branchId: string | null,
): Promise<number> {
  const { data, error } = await dotazNastenky(supabase, tenantId, branchId, SLOUPCE_ADRESY)
  if (error || !data || data.length === 0) return 0
  const oznameni = data as unknown as OznameniKRazeni[]

  const ja = await nactiCtenare(supabase, tenantId, userId)
  const kandidati = oznameni.filter((z) => jeNoveProMe(z, new Set(), ja))
  if (kandidati.length === 0) return 0

  const { data: prectene, error: chybaCteni } = await supabase
    .from('announcement_reads')
    .select('announcement_id')
    .eq('user_id', userId)
    .in(
      'announcement_id',
      kandidati.map((z) => z.id),
    )
  if (chybaCteni) return 0

  const uz = new Set((prectene ?? []).map((c) => c.announcement_id as string))
  return kandidati.filter((z) => jeNoveProMe(z, uz, ja)).length
}
