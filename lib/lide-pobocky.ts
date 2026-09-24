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

/** Jméno do nabídky. Kdo tu jen zaskakuje (nebo nemá pobočku), to má u sebe napsané. */
export function jmenoDoNabidky(c: ClovekPobocky & { bezPobocky?: boolean }): string {
  if (c.domovska) return c.jmeno
  return c.bezPobocky ? `${c.jmeno} — bez pobočky` : `${c.jmeno} — zaskakuje`
}

/**
 * Komu jde na pobočce VYPLATIT ZÁLOHU (24. 9. 2026).
 *
 * Dřív se bralo `lideProPobocku` — průzor pro RUČNÍ ZÁPIS DOCHÁZKY,
 * který vrací lidi jen tomu, kdo má `attendance.manage`. Kdo měl jen
 * právo vyplácet zálohy (`advances.manage`, třeba zařazení
 * Číšník/servírka), viděl prázdnou nabídku „Komu" a nevyplatil nikomu.
 *
 * `lide_pro_zalohy` má vlastní bránu (`advances.manage` na téhle
 * pobočce) a stejné pravidlo „kdo sem patří" jako `vyplatit_zalohu`:
 * domovská pobočka, směna tady v okně, nebo bez pobočky (ne majitel).
 * Dokud migrace 20260924120000 neproběhne, vrací se to, co dřív.
 */
export async function lideProZalohy(
  tenantId: string,
  branchId: string,
  den: string,
  okno = 7,
): Promise<(ClovekPobocky & { bezPobocky: boolean })[]> {
  const supabase = await getServerSupabase()

  const { data, error } = await supabase.rpc('lide_pro_zalohy', {
    p_tenant: tenantId,
    p_branch: branchId,
    p_od: posunDatum(den, -okno),
    p_do: posunDatum(den, okno),
  })

  if (error) {
    if (funkceNeexistuje(error)) {
      return (await lideProPobocku(tenantId, branchId, den, okno)).map((c) => ({
        ...c,
        bezPobocky: false,
      }))
    }
    throw new DotazSelhal('lidé pro zálohy', error)
  }

  return ((data ?? []) as {
    employee_id: string
    jmeno: string
    domovska: boolean
    bez_pobocky: boolean
  }[]).map((c) => ({
    id: c.employee_id,
    jmeno: c.jmeno,
    domovska: c.domovska,
    bezPobocky: c.bez_pobocky,
  }))
}
