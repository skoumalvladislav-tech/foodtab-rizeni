import 'server-only'

/**
 * Načtení fronty Platby bez faktury (stránka i CSV pro účetní) — pod
 * přihlášeným (RLS: finance.read), jen za celou firmu. Výběr dělá čistá
 * funkce `platbyBezFaktury` (lib/finance-bez-faktury.ts).
 */

import type { getServerSupabase } from './supabase/server.ts'
import { protistranaNeboUcet } from './banka/ucet.ts'
import { platbyBezFaktury, type PlatbaBezFaktury, type PohybKPosouzeni } from './finance-bez-faktury.ts'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/** Víc pohybů v období appka najednou nebere — ať stránka nespadne na limitu PostgRESTu. */
export const NEJVIC_POHYBU = 2000
const NAJEDNOU = 200

export type VysledekBezFaktury =
  | { stav: 'ok'; platby: PlatbaBezFaktury[] }
  | { stav: 'moc'; text: string }
  | { stav: 'chyba'; text: string }

export async function nactiPlatbyBezFaktury(supabase: Supabase, tenantId: string, od: string, doData: string): Promise<VysledekBezFaktury> {
  const { data, error } = await supabase.from('transakce')
    .select('id, datum, smer, castka_haleru, mena, protistrana, protiucet, vs, storno_of, platebni_ucty(nazev)')
    .eq('tenant_id', tenantId).eq('smer', 'vydaj')
    .gte('datum', od).lte('datum', doData)
    .order('datum', { ascending: false }).order('id', { ascending: true })
    .limit(NEJVIC_POHYBU + 1)
  if (error) return { stav: 'chyba', text: 'Platby se nepodařilo načíst — zkuste stránku obnovit.' }
  type Radek = {
    id: string; datum: string; smer: string; castka_haleru: number; mena: string | null
    protistrana: string | null; protiucet: string | null; vs: string | null; storno_of: string | null
    platebni_ucty: { nazev: string } | { nazev: string }[] | null
  }
  const radky = (data ?? []) as unknown as Radek[]
  if (radky.length > NEJVIC_POHYBU) {
    return { stav: 'moc', text: `V období je víc než ${NEJVIC_POHYBU} odchozích plateb — zkraťte ho.` }
  }

  const ids = radky.map((r) => r.id)
  const sparovano = new Map<string, number>()
  const jine = new Map<string, number>()
  const rucne = new Set<string>()
  const sNavrhem = new Set<string>()
  const stornovane = new Set<string>()
  for (let i = 0; i < ids.length; i += NAJEDNOU) {
    const kus = ids.slice(i, i + NAJEDNOU)
    const [parovani, jinePlatby, uhrady, storna] = await Promise.all([
      supabase.from('platby_faktury').select('transakce_id, castka_haleru, stav')
        .eq('tenant_id', tenantId).in('transakce_id', kus).in('stav', ['potvrzeno', 'navrzeno']),
      supabase.from('jine_platby').select('uhrada_transakce_id, uhrada_castka_haleru')
        .eq('tenant_id', tenantId).in('uhrada_transakce_id', kus),
      supabase.from('faktury_rucni_uhrady').select('transakce_id')
        .eq('tenant_id', tenantId).in('transakce_id', kus).is('zruseno_kdy', null),
      supabase.from('transakce').select('storno_of').eq('tenant_id', tenantId).in('storno_of', kus),
    ])
    // Chybějící souvislost by z placené platby udělala „bez faktury" — radši nic.
    if (parovani.error || jinePlatby.error || uhrady.error || storna.error) {
      return { stav: 'chyba', text: 'Párování plateb se nepodařilo načíst — zkuste stránku obnovit.' }
    }
    for (const p of (parovani.data ?? []) as { transakce_id: string; castka_haleru: number; stav: string }[]) {
      if (p.stav === 'navrzeno') sNavrhem.add(p.transakce_id)
      else sparovano.set(p.transakce_id, (sparovano.get(p.transakce_id) ?? 0) + p.castka_haleru)
    }
    for (const j of (jinePlatby.data ?? []) as { uhrada_transakce_id: string; uhrada_castka_haleru: number | null }[]) {
      jine.set(j.uhrada_transakce_id, (jine.get(j.uhrada_transakce_id) ?? 0) + (j.uhrada_castka_haleru ?? 0))
    }
    for (const u of (uhrady.data ?? []) as { transakce_id: string }[]) rucne.add(u.transakce_id)
    for (const s of (storna.data ?? []) as { storno_of: string }[]) stornovane.add(s.storno_of)
  }

  const pohyby: PohybKPosouzeni[] = radky.map((r) => {
    const ucet = Array.isArray(r.platebni_ucty) ? r.platebni_ucty[0] : r.platebni_ucty
    return {
      id: r.id, datum: r.datum, smer: r.smer, castkaHaleru: r.castka_haleru, mena: r.mena,
      protistrana: protistranaNeboUcet(r.protistrana, r.protiucet), protiucet: r.protiucet ?? '', vs: r.vs ?? '',
      ucet: ucet?.nazev ?? '', stornovano: r.storno_of !== null || stornovane.has(r.id),
    }
  })
  return {
    stav: 'ok',
    platby: platbyBezFaktury(pohyby, { sparovanoNaPohyb: sparovano, jinePlatbyNaPohyb: jine, rucneUhrazene: rucne, sNavrhem }),
  }
}
