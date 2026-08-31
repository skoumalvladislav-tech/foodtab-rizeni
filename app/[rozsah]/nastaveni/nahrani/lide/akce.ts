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
} from '@/lib/nahrani-lidi'
import { najdiNeboZaloz } from '../../pozice/akce'

/**
 * Nahrání lidí z tabulky — serverová část.
 *
 * Dvě akce a jedna pravda: náhled i zápis počítají plán touž funkcí
 * (sestavPlan) nad daty čerstvě přečtenými z databáze. Náhled proto
 * neslibuje nic, co by zápis neudělal.
 *
 * Plán poslaný z prohlížeče se ZAHAZUJE a počítá se znovu. Z prohlížeče
 * přicházejí jen buňky tabulky a přiřazení sloupců — tedy to, co člověk
 * opravdu zadal. Kdyby se věřilo poslanému plánu, stačilo by ho cestou
 * přepsat a založit si kohokoli s čímkoli.
 *
 * Import běží pod přihlášeným člověkem: obyčejný klient, RLS zapnutá,
 * žádné security definer a žádný servisní klíč. Kdo nesmí zakládat lidi,
 * nezaloží je ani souborem.
 */

export type Vstup = {
  rozsah: string
  /** Buňky pod záhlavím, tak jak je přečetl prohlížeč. */
  radky: string[][]
  mapovani: Mapovani
  /** Jen do auditu — soubor sám se nikam neukládá. */
  soubor: string
}

export type Vysledek =
  | { stav: 'plan'; plan: Plan }
  | {
      stav: 'hotovo'
      zalozeno: number
      aktualizovano: number
      preskoceno: number
      novePozice: string[]
      /** Řádky, na kterých zápis spadl. Prázdné pole = všechno prošlo. */
      chyby: { cislo: number; jmeno: string; text: string }[]
    }
  | { stav: 'chyba'; text: string }

const PRAVO = 'people.manage'

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

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { chyba: 'Účet nepatří k žádné firmě.' }

  const pristup = await zkusPristup(tenantId, PRAVO, vstup.rozsah)
  if (pristup.stav !== 'ok') {
    return { chyba: 'Na zakládání lidí nemáte právo.' }
  }

  const supabase = await getServerSupabase()

  /*
    Prázdný obraz dat by tady byl nejdražší tichá chyba v aplikaci:
    kdyby dotaz na lidi selhal a vrátil prázdno, nepoznal by se ani
    jeden stávající člověk a náhled by nabídl založit celou firmu
    znovu. Proto se přes seznam(), který při chybě vyhodí.
  */
  const [lide, pobocky, pozice] = await Promise.all([
    seznam<Zdroje['lide'][number]>(
      'zaměstnanci firmy',
      supabase
        .from('employees')
        .select('id, full_name, branch_id, position_id, employment_type, started_on')
        .eq('tenant_id', tenantId)
        .is('deleted_at', null),
    ),
    seznam<Zdroje['pobocky'][number]>(
      'pobočky firmy',
      supabase.from('branches').select('id, name, slug').eq('tenant_id', tenantId),
    ),
    seznam<Zdroje['pozice'][number]>(
      'pozice firmy',
      supabase.from('positions').select('id, label, active').eq('tenant_id', tenantId),
    ),
  ])

  const zdroje: Zdroje = { lide, pobocky, pozice }

  return { tenantId, supabase, plan: sestavPlan(vstup.radky, vstup.mapovani, zdroje) }
}

/** Krok 4 zadání: co se stane, ještě než se cokoli stane. */
export async function pripravitNahled(vstup: Vstup): Promise<Vysledek> {
  const p = await pripravit(vstup)
  if (p.chyba !== undefined) return { stav: 'chyba', text: p.chyba }
  return { stav: 'plan', plan: p.plan }
}

/** Krok 5: potvrzení. Teprve tady se zapisuje. */
export async function nahratLidi(vstup: Vstup): Promise<Vysledek> {
  const p = await pripravit(vstup)
  if (p.chyba !== undefined) return { stav: 'chyba', text: p.chyba }

  const { tenantId, supabase, plan } = p
  const chyby: { cislo: number; jmeno: string; text: string }[] = []

  /*
    Pozice napřed. najdiNeboZaloz drží rozpoznávací klíč z oddílu A:
    kdo má v tabulce „číšník“ a ve firmě je „Číšník“, dostane tu
    stávající. Druhá pozice nevznikne a nic nespadne na jedinečnost.
  */
  const idPozice = new Map<string, string>()
  for (const nazev of plan.novePozice) {
    const v = await najdiNeboZaloz(tenantId, nazev)
    if (v.stav === 'chyba') {
      return { stav: 'chyba', text: `Pozici ${nazev} se nepodařilo založit.` }
    }
    idPozice.set(nazev, v.id)
  }

  const dopln = (z: (typeof plan.zaznamy)[number]) => {
    const zapis: Record<string, unknown> = { ...z.zapis }
    delete zapis.novaPozice
    if (z.zapis.novaPozice) zapis.position_id = idPozice.get(z.zapis.novaPozice) ?? null
    return zapis
  }

  /*
    Zakládání po dávkách, aktualizace po řádcích: každý řádek mění něco
    jiného. Zvlášť velkou tabulku proto zastaví strop NEJVIC_RADKU.

    Jedna transakce to není — PostgREST ji neumí. Nevadí to díky
    rozpoznávacímu klíči: když se to v půlce zlomí, druhé spuštění
    dodělá zbytek a nic nezdvojí. Přesně proto klíč v oddílu A je.
  */
  const zalozit = plan.zaznamy.filter((z) => z.co === 'zalozit')
  let zalozeno = 0
  for (let i = 0; i < zalozit.length; i += 200) {
    const davka = zalozit.slice(i, i + 200)
    const { error } = await supabase
      .from('employees')
      .insert(davka.map((z) => ({ tenant_id: tenantId, ...dopln(z) })))
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
      .from('employees')
      .update(dopln(z))
      .eq('id', z.id)
      .eq('tenant_id', tenantId)
    if (error) chyby.push({ cislo: z.cislo, jmeno: z.jmeno, text: error.message })
    else aktualizovano++
  }

  /*
    Do auditu jde, kdo co kdy nahrál a kolik řádků to změnilo. Jednotlivé
    řádky tam jdou samy spouští na employees — tohle je zápis o nahrání
    jako celku, aby šlo poznat, že těch dvacet změn patří k sobě.
  */
  const { error: auditChyba } = await supabase.rpc('audit_import', {
    p_tenant: tenantId,
    p_co: 'lide',
    p_soubor: vstup.soubor,
    p_zalozeno: zalozeno,
    p_aktualizovano: aktualizovano,
    p_preskoceno: plan.preskocit,
  })
  if (auditChyba) {
    chyby.push({
      cislo: 0,
      jmeno: '',
      text: `Zápis do auditu se nepovedl: ${auditChyba.message}`,
    })
  }

  revalidatePath(`/${vstup.rozsah}/nastaveni/lide`)
  revalidatePath(`/${vstup.rozsah}/nastaveni/pozice`)

  return {
    stav: 'hotovo',
    zalozeno,
    aktualizovano,
    preskoceno: plan.preskocit,
    novePozice: plan.novePozice,
    chyby,
  }
}
