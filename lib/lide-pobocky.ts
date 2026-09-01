import { funkceNeexistuje, DotazSelhal } from './supabase/dotaz'
import { getServerSupabase } from './supabase/server'
import { posunDatum } from './provozni-den'

/**
 * Kdo dnes patří na pobočku.
 *
 * JEDNO MÍSTO, DVĚ OBRAZOVKY. Ruční zápis docházky a vyplácení záloh
 * potřebují týž seznam a z téhož důvodu: kdo tu dnes stojí směnu, tomu
 * může být potřeba dopsat docházku i vyplatit zálohu — a kdo patří na
 * Bernard, tomu se dnes na Perle nedělá ani jedno.
 *
 * Dřív to bylo napsané dvakrát a rozešlo se to: ruční docházka nabízela
 * i zaskakující, zálohy je nenabízely vůbec
 * (docs/ukoly-codea-drobnosti-2026-09-01.md, bod 2).
 *
 * Samotný výběr dělá `public.lide_pro_pobocku` v databázi — aby se dal
 * zkontrolovat scénářem a nevznikal počtvrté znovu. Tohle je jen jeho
 * jediné volání.
 */

export type ClovekPobocky = {
  id: string
  jmeno: string
  /** Patří sem, nebo tu jen zaskakuje? V nabídce se to musí poznat. */
  domovska: boolean
}

export async function lideProPobocku(
  tenantId: string,
  branchId: string,
  den: string,
  /** Kolik dní zpět a dopřed se hledá směna. Týden na obě strany stačí. */
  okno = 7,
): Promise<ClovekPobocky[]> {
  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('lide_pro_pobocku', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_od: posunDatum(den, -okno),
    p_do: posunDatum(den, okno),
  })

  /*
    Dokud neproběhne migrace 20260901150000, průzor neexistuje.
    Vrací se prázdno a volající se rozhodne, co s tím — formulář, do
    kterého nejde nic vybrat, je horší než žádný.
  */
  if (error) {
    if (funkceNeexistuje(error)) return []
    throw new DotazSelhal('lidé pro pobočku', error)
  }

  return ((data ?? []) as {
    employee_id: string
    jmeno: string
    domovska: boolean
  }[]).map((c) => ({ id: c.employee_id, jmeno: c.jmeno, domovska: c.domovska }))
}

/** Jméno do nabídky. Kdo tu jen zaskakuje, to má u sebe napsané. */
export function jmenoDoNabidky(c: ClovekPobocky): string {
  return c.domovska ? c.jmeno : `${c.jmeno} — zaskakuje`
}
