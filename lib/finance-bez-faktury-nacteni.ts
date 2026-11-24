import 'server-only'

/**
 * Načtení fronty Platby bez faktury (stránka i CSV pro účetní) — pod
 * přihlášeným (RLS: finance.read na účtu). Výběr dělá čistá funkce
 * `platbyBezFaktury` (lib/finance-bez-faktury.ts), účty fronty
 * `filtrUctuFronty` (celá firma, pobočka, jeden účet).
 *
 * Ruční úhrady a návrhy (data Faktur) fronta nečte přímo — člověk s právem
 * jen na Finance je vidět nesmí. Ptá se databáze funkcí
 * `platby_bez_faktury_vyrizeni`: jen „je pohyb vyřízený ruční úhradou /
 * čeká na něj návrh k faktuře, kterou jde pořád zaplatit?".
 */

import type { getServerSupabase } from './supabase/server.ts'
import { protistranaNeboUcet } from './banka/ucet.ts'
import { platbyBezFaktury, type PlatbaBezFaktury, type PohybKPosouzeni, type UcetFronty } from './finance-bez-faktury.ts'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/** Víc pohybů v období appka najednou nebere — ať stránka nespadne na limitu PostgRESTu. */
export const NEJVIC_POHYBU = 2000
const NAJEDNOU = 200

export type VysledekBezFaktury =
  | { stav: 'ok'; platby: PlatbaBezFaktury[] }
  | { stav: 'moc'; text: string }
  | { stav: 'chyba'; text: string }

/** Platební účty firmy, které přihlášený vidí (i vypnuté — historie plateb nezmizí). */
export async function nactiUctyFronty(
  supabase: Supabase,
  tenantId: string,
): Promise<{ stav: 'ok'; ucty: UcetFronty[] } | { stav: 'chyba'; text: string }> {
  const { data, error } = await supabase.from('platebni_ucty')
    .select('id, nazev, branch_id')
    .eq('tenant_id', tenantId)
    .order('nazev')
  if (error) return { stav: 'chyba', text: 'Platební účty se nepodařilo načíst — zkuste stránku obnovit.' }
  return {
    stav: 'ok',
    ucty: ((data ?? []) as { id: string; nazev: string; branch_id: string | null }[])
      .map((u) => ({ id: u.id, nazev: u.nazev, branchId: u.branch_id })),
  }
}

/**
 * `ucty` = výsledek `filtrUctuFronty(…).filtr`: null = všechny účty, které
 * přihlášený vidí; seznam = jen tyhle (prázdný = nic, pobočka bez účtu).
 */
export async function nactiPlatbyBezFaktury(
  supabase: Supabase,
  tenantId: string,
  od: string,
  doData: string,
  ucty: readonly string[] | null,
): Promise<VysledekBezFaktury> {
  if (ucty && ucty.length === 0) return { stav: 'ok', platby: [] }
  let dotaz = supabase.from('transakce')
    .select('id, datum, smer, castka_haleru, mena, protistrana, protiucet, vs, storno_of, platebni_ucty(nazev, branch_id)')
    .eq('tenant_id', tenantId).eq('smer', 'vydaj')
    .gte('datum', od).lte('datum', doData)
  if (ucty) dotaz = dotaz.in('ucet_id', [...ucty])
  const { data, error } = await dotaz
    .order('datum', { ascending: false }).order('id', { ascending: true })
    .limit(NEJVIC_POHYBU + 1)
  if (error) return { stav: 'chyba', text: 'Platby se nepodařilo načíst — zkuste stránku obnovit.' }
  type Radek = {
    id: string; datum: string; smer: string; castka_haleru: number; mena: string | null
    protistrana: string | null; protiucet: string | null; vs: string | null; storno_of: string | null
    platebni_ucty: { nazev: string; branch_id: string | null } | { nazev: string; branch_id: string | null }[] | null
  }
  const radky = (data ?? []) as unknown as Radek[]
  if (radky.length > NEJVIC_POHYBU) {
    return { stav: 'moc', text: `V období je víc než ${NEJVIC_POHYBU} odchozích plateb — zkraťte ho nebo vyberte účet.` }
  }

  const ids = radky.map((r) => r.id)
  const sparovano = new Map<string, number>()
  const jine = new Map<string, number>()
  const rucne = new Set<string>()
  const sNavrhem = new Set<string>()
  const stornovane = new Set<string>()
  for (let i = 0; i < ids.length; i += NAJEDNOU) {
    const kus = ids.slice(i, i + NAJEDNOU)
    const [parovani, jinePlatby, vyrizeni, storna] = await Promise.all([
      supabase.from('platby_faktury').select('transakce_id, castka_haleru')
        .eq('tenant_id', tenantId).in('transakce_id', kus).eq('stav', 'potvrzeno'),
      supabase.from('jine_platby').select('uhrada_transakce_id, uhrada_castka_haleru')
        .eq('tenant_id', tenantId).in('uhrada_transakce_id', kus),
      supabase.rpc('platby_bez_faktury_vyrizeni', { p_tenant: tenantId, p_transakce: kus }),
      supabase.from('transakce').select('storno_of').eq('tenant_id', tenantId).in('storno_of', kus),
    ])
    // Chybějící souvislost by z placené platby udělala „bez faktury" — radši nic.
    if (parovani.error || jinePlatby.error || vyrizeni.error || storna.error) {
      return { stav: 'chyba', text: 'Párování plateb se nepodařilo načíst — zkuste stránku obnovit.' }
    }
    for (const p of (parovani.data ?? []) as { transakce_id: string; castka_haleru: number }[]) {
      sparovano.set(p.transakce_id, (sparovano.get(p.transakce_id) ?? 0) + p.castka_haleru)
    }
    for (const j of (jinePlatby.data ?? []) as { uhrada_transakce_id: string; uhrada_castka_haleru: number | null }[]) {
      jine.set(j.uhrada_transakce_id, (jine.get(j.uhrada_transakce_id) ?? 0) + (j.uhrada_castka_haleru ?? 0))
    }
    for (const v of (vyrizeni.data ?? []) as { transakce_id: string; rucni_uhrada: boolean; otevreny_navrh: boolean }[]) {
      if (v.rucni_uhrada) rucne.add(v.transakce_id)
      if (v.otevreny_navrh) sNavrhem.add(v.transakce_id)
    }
    for (const s of (storna.data ?? []) as { storno_of: string }[]) stornovane.add(s.storno_of)
  }

  const pohyby: PohybKPosouzeni[] = radky.map((r) => {
    const ucet = Array.isArray(r.platebni_ucty) ? r.platebni_ucty[0] : r.platebni_ucty
    return {
      id: r.id, datum: r.datum, smer: r.smer, castkaHaleru: r.castka_haleru, mena: r.mena,
      protistrana: protistranaNeboUcet(r.protistrana, r.protiucet), protiucet: r.protiucet ?? '', vs: r.vs ?? '',
      ucet: ucet?.nazev ?? '', firemniUcet: ucet ? ucet.branch_id === null : undefined,
      stornovano: r.storno_of !== null || stornovane.has(r.id),
    }
  })
  return {
    stav: 'ok',
    platby: platbyBezFaktury(pohyby, { sparovanoNaPohyb: sparovano, jinePlatbyNaPohyb: jine, rucneUhrazene: rucne, sNavrhem }),
  }
}
