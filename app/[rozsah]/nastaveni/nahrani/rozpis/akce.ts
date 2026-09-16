'use server'

import { revalidatePath } from 'next/cache'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import {
  NEJVIC_RADKU,
  sestavPlan,
  type Mapovani,
  type Plan,
  type Zdroje,
} from '@/lib/nahrani-rozpisu'

/**
 * Nahrání rozpisu z tabulky — serverová část.
 *
 * Stejná stavba jako ../lide/akce.ts: náhled i zápis počítají plán touž
 * funkcí (sestavPlan) nad daty čerstvě přečtenými z databáze, poslaný
 * plán z prohlížeče se zahazuje. Import běží pod přihlášeným člověkem
 * (obyčejný klient, RLS zapnutá) — kdo nesmí zapisovat směny, nezapíše
 * je ani souborem.
 */

export type Vstup = {
  rozsah: string
  radky: string[][]
  mapovani: Mapovani
  soubor: string
}

export type Vysledek =
  | { stav: 'plan'; plan: Plan }
  | {
      stav: 'hotovo'
      zalozeno: number
      aktualizovano: number
      preskoceno: number
      chyby: { cislo: number; jmeno: string; text: string }[]
    }
  | { stav: 'chyba'; text: string }

const PRAVO = 'shifts.manage'

type Priprava =
  | { chyba: string }
  | {
      chyba?: undefined
      tenantId: string
      supabase: Awaited<ReturnType<typeof getServerSupabase>>
      plan: Plan
    }

/** Společný začátek obou akcí: kontrola práv a obraz dat z databáze. */
async function pripravit(vstup: Vstup): Promise<Priprava> {
  if (!vstup.radky.length) return { chyba: 'V souboru nejsou žádné řádky.' }
  if (vstup.radky.length > NEJVIC_RADKU) {
    return {
      chyba:
        `Najednou jde nahrát nejvýš ${NEJVIC_RADKU} řádků, tenhle soubor jich má ` +
        `${vstup.radky.length}. Rozdělte ho — nahrání po částech nic nezdvojí.`,
    }
  }
  if (vstup.mapovani.jmeno === undefined) {
    return { chyba: 'Není přiřazený sloupec se jménem.' }
  }
  if (vstup.mapovani.datum === undefined) {
    return { chyba: 'Není přiřazený sloupec s datem.' }
  }
  if (vstup.mapovani.zacatek === undefined || vstup.mapovani.konec === undefined) {
    return { chyba: 'Není přiřazený sloupec se začátkem nebo koncem směny.' }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { chyba: 'Účet nepatří k žádné firmě.' }

  const pristup = await zkusPristup(tenantId, PRAVO, vstup.rozsah)
  if (pristup.stav !== 'ok') {
    return { chyba: 'Na zapisování směn nemáte právo.' }
  }

  // Rozpis se nahrává na konkrétní pobočku — na firemní úrovni se
  // sloupec Pobočka v tabulce stává povinným (sestavPlan to pozná sám,
  // protože vychoziPobocka bude null).
  const vychoziPobocka = pristup.scope.level === 'branch' ? pristup.scope.branchId : null

  const supabase = await getServerSupabase()

  /*
    Stejná úvaha jako u lidí: prázdný obraz dat by tu byl nejdražší
    tichá chyba. Kdyby dotaz na existující směny selhal a vrátil
    prázdno, nepoznala by se ani jedna existující směna a náhled by
    nabídl založit celý rozpis znovu — duplicitně. Proto přes seznam(),
    který při chybě vyhodí.
  */
  const [lide, pobocky, pozice, smeny] = await Promise.all([
    seznam<Zdroje['lide'][number]>(
      'zaměstnanci firmy',
      supabase
        .from('employees')
        .select('id, full_name')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
    ),
    seznam<Zdroje['pobocky'][number]>(
      'pobočky firmy',
      supabase.from('branches').select('id, name, slug').eq('tenant_id', tenantId),
    ),
    seznam<Zdroje['pozice'][number]>(
      'pozice firmy',
      supabase.from('positions').select('id, label').eq('tenant_id', tenantId),
    ),
    seznam<Zdroje['smeny'][number]>(
      'existující směny',
      supabase
        .from('shifts')
        .select('id, employee_id, branch_id, shift_date, starts_at, ends_at, position_id')
        .eq('tenant_id', tenantId)
        .neq('status', 'cancelled'),
    ),
  ])

  const zdroje: Zdroje = { lide, pobocky, pozice, smeny }

  return {
    tenantId,
    supabase,
    plan: sestavPlan(vstup.radky, vstup.mapovani, zdroje, vychoziPobocka),
  }
}

export type ZamestnanecSDomovem = {
  id: string
  jmeno: string
  branchId: string | null
  positionId: string | null
}

/**
 * Domovská pobočka a pozice každého zaměstnance — pro krok "značky"
 * maticového dovozu (../../../smeny/rozpis.tsx přes pruvodce.tsx).
 *
 * ZAMĚSTNANEC UŽ DOMOVSKOU POBOČKU A POZICI MÁ (branch_id, position_id
 * na employees) — Šéfík 16.9.2026: "mělo by se to automaticky rozlišit
 * dle jména". Buňka bez přípony ("X" bez "-B"/"-P") proto NENÍ nejednoznačná
 * — patří tomu, kdo tu směnu má, na JEHO pobočce a pozici. Přípona je
 * jen výjimka (výpomoc na druhé pobočce), ne pravidlo pro každého.
 */
export async function nactiZamestnance(rozsah: string): Promise<ZamestnanecSDomovem[]> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return []

  const pristup = await zkusPristup(tenantId, PRAVO, rozsah)
  if (pristup.stav !== 'ok') return []

  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, branch_id, position_id')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
  if (error) return []

  return (data ?? []).map((e) => ({
    id: e.id as string,
    jmeno: String(e.full_name ?? ''),
    branchId: (e.branch_id as string | null) ?? null,
    positionId: (e.position_id as string | null) ?? null,
  }))
}

/** Krok 4 zadání: co se stane, ještě než se cokoli stane. */
export async function pripravitNahled(vstup: Vstup): Promise<Vysledek> {
  const p = await pripravit(vstup)
  if (p.chyba !== undefined) return { stav: 'chyba', text: p.chyba }
  return { stav: 'plan', plan: p.plan }
}

/** Krok 5: potvrzení. Teprve tady se zapisuje. */
export async function nahratRozpis(vstup: Vstup): Promise<Vysledek> {
  const p = await pripravit(vstup)
  if (p.chyba !== undefined) return { stav: 'chyba', text: p.chyba }

  const { tenantId, supabase, plan } = p
  const chyby: { cislo: number; jmeno: string; text: string }[] = []

  const zalozit = plan.zaznamy.filter((z) => z.co === 'zalozit')
  let zalozeno = 0
  for (let i = 0; i < zalozit.length; i += 200) {
    const davka = zalozit.slice(i, i + 200)
    const { error } = await supabase
      .from('shifts')
      .insert(davka.map((z) => ({ tenant_id: tenantId, ...z.zapis })))
    if (error) {
      for (const z of davka) chyby.push({ cislo: z.cislo, jmeno: z.jmeno, text: error.message })
    } else {
      zalozeno += davka.length
    }
  }

  let aktualizovano = 0
  for (const z of plan.zaznamy) {
    if (z.co !== 'aktualizovat' || !z.id) continue
    const { error } = await supabase
      .from('shifts')
      .update(z.zapis)
      .eq('id', z.id)
      .eq('tenant_id', tenantId)
    if (error) chyby.push({ cislo: z.cislo, jmeno: z.jmeno, text: error.message })
    else aktualizovano++
  }

  /*
    Do auditu jde, kdo co kdy nahrál (oddíl B zadání). `audit_import`
    dnes zná jen `p_co='lide'` — rozšíření na 'rozpis' je napsaná,
    nenasazená migrace (docs/pracovni-rezim-codea.md: nasazení dělá
    Šéfík). Dokud nedoběhne, volání skončí očekávanou chybou
    „Neznámý druh nahrávání" a nahrání samo se kvůli tomu nezastaví —
    jednotlivé směny do auditu jdou i tak vlastní spouští na `shifts`.
  */
  const { error: auditChyba } = await supabase.rpc('audit_import', {
    p_tenant: tenantId,
    p_co: 'rozpis',
    p_soubor: vstup.soubor,
    p_zalozeno: zalozeno,
    p_aktualizovano: aktualizovano,
    p_preskoceno: plan.preskocit,
  })
  if (auditChyba && !auditChyba.message.includes('Neznámý druh nahrávání')) {
    chyby.push({
      cislo: 0,
      jmeno: '',
      text: `Souhrnný zápis do auditu se nepovedl: ${auditChyba.message}`,
    })
  }

  revalidatePath(`/${vstup.rozsah}/smeny`)

  return {
    stav: 'hotovo',
    zalozeno,
    aktualizovano,
    preskoceno: plan.preskocit,
    chyby,
  }
}
