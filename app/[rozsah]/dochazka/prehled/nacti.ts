import { hodinaVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import {
  sestavitPrehledDne,
  type SmenaDne,
  type StavRadku,
  type UdalostDochazky,
} from '@/lib/dochazka-dnes'
import { posunDatum } from '@/lib/provozni-den'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import type { getServerSupabase } from '@/lib/supabase/server'

/**
 * Data živého přehledu docházky pro jednu pobočku a jeden provozní den.
 *
 * Čte přes RLS (`attendance.read` na téhle pobočce) — nic si nebere přes
 * definer funkci, takže druhá obranná linie je databáze sama. Kdo je v
 * práci, se počítá týmž pravidlem jako `app.otevreny_prichod`
 * (`lib/dochazka-dnes`); tenhle soubor jen sbírá vstupy a překládá výsledek
 * na hotové texty (časy v pásmu pobočky), ať klientská komponenta nemusí
 * nic počítat ani znát pásmo.
 *
 * ---------------------------------------------------------------------
 * CO SE NEVIDÍ
 *
 * Záznamy z pobočky, na kterou vedoucí `attendance.read` nemá, mu RLS
 * nevydá. Kdo se píchl jinde, se pak tady ukáže jako „ještě nepřišel“. To
 * je hranice oprávnění, ne chyba — ale je dobré ji znát.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

export type UdalostDne = { druh: string; cas: string }

export type RadekPrehledu = {
  osobaId: string
  jmeno: string
  usek: string | null
  pozice: string | null
  /** Plán dne: „08:00–16:00“, u víc směn „08:00–12:00 · 16:00–20:00“. */
  plan: string | null
  /** První směna dne — pro odkaz do rozpisu. */
  smenaId: string | null
  stav: StavRadku
  bezSmeny: boolean
  naPrestavce: boolean
  /** „07:57“ */
  prichod: string | null
  odchod: string | null
  /** Hrubé minuty na místě dnes. */
  minut: number
  /** Provozní den otevřeného příchodu z dřívějška („2026-09-20“), jinak `null`. */
  otevrenyZeDne: string | null
  /** Název pobočky, kde se píchl, když je to jiná než tahle. */
  pobockaPrichodu: string | null
  /** Kdy směna začíná / končí — pro popisky „začíná v 12:00“. */
  zacatekPlanu: string | null
  konecPlanu: string | null
  /** Dnešní platné záznamy (bez stornovaných) pro osu v detailu. */
  udalosti: UdalostDne[]
}

export type PrehledProps = {
  radky: RadekPrehledu[]
  souhrn: { vPraci: number; cekame: number; poZacatku: number; odesli: number; minutNaMiste: number }
  /** „10:42“ — kdy se přehled spočítal (pásmo pobočky). */
  aktualizovano: string
}

const NAZVY_DRUHU: Record<string, string> = {
  in: 'Příchod',
  out: 'Odchod',
  break_start: 'Začátek přestávky',
  break_end: 'Konec přestávky',
}

export async function nactiPrehledDne(v: {
  supabase: Supabase
  tenantId: string
  branchId: string
  den: string
  zona: string | null | undefined
  /** id pobočky → název, kvůli „píchl se na jiné pobočce“. */
  pobocky: Map<string, string>
  /** „Teď“ v ms — parametr, ne `Date.now()` uvnitř, aby šlo volat čistě. */
  ted: number
}): Promise<PrehledProps> {
  const { supabase, tenantId, branchId, den } = v
  const zona = v.zona ?? ZONA_VYCHOZI
  const vcera = posunDatum(den, -1)

  /* --- směny dne a kdo se dnes na téhle pobočce píchl ---------------- */

  const [smenyOdp, udalostiPobocky] = await Promise.all([
    supabase
      .from('shifts')
      .select('id, branch_id, employee_id, shift_date, starts_at, ends_at')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .eq('shift_date', den)
      .neq('status', 'cancelled')
      .not('employee_id', 'is', null),
    supabase
      .from('attendance_events')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .gte('business_date', vcera)
      .lte('business_date', den),
  ])
  if (smenyOdp.error) throw new DotazSelhal('směny', smenyOdp.error)
  if (udalostiPobocky.error) throw new DotazSelhal('záznamy docházky', udalostiPobocky.error)

  const smeny = (smenyOdp.data ?? []) as SmenaDne[]
  const idLidi = [
    ...new Set([
      ...smeny.map((s) => s.employee_id),
      ...(udalostiPobocky.data ?? []).map((r) => r.employee_id as string),
    ]),
  ]

  const prazdny: PrehledProps = {
    radky: [],
    souhrn: { vPraci: 0, cekame: 0, poZacatku: 0, odesli: 0, minutNaMiste: 0 },
    aktualizovano: hodinaVPasmu(new Date(v.ted), zona),
  }
  if (idLidi.length === 0) return prazdny

  /* --- celé dny těch lidí, ze všech poboček, které smíme číst -------- */

  const [udalostiOdp, lideOdp] = await Promise.all([
    supabase
      .from('attendance_events')
      .select('employee_id, kind, occurred_at, business_date, branch_id, stornovano_kdy, uzavreno_systemem')
      .eq('tenant_id', tenantId)
      .in('employee_id', idLidi)
      .gte('business_date', vcera)
      .lte('business_date', den)
      .order('occurred_at', { ascending: true }),
    supabase.from('employees').select('id, full_name, usek_id, position_id').in('id', idLidi),
  ])
  if (udalostiOdp.error) throw new DotazSelhal('záznamy docházky', udalostiOdp.error)
  if (lideOdp.error) throw new DotazSelhal('zaměstnanci', lideOdp.error)

  const udalosti = (udalostiOdp.data ?? []) as UdalostDochazky[]
  const lide = new Map(
    (lideOdp.data ?? []).map((c) => [
      c.id as string,
      {
        jmeno: c.full_name as string,
        usekId: (c.usek_id as string | null) ?? null,
        poziceId: (c.position_id as string | null) ?? null,
      },
    ]),
  )

  const idUseku = [...new Set([...lide.values()].map((l) => l.usekId).filter((i): i is string => !!i))]
  const idPozic = [...new Set([...lide.values()].map((l) => l.poziceId).filter((i): i is string => !!i))]
  const [useky, pozice] = await Promise.all([
    idUseku.length
      ? supabase.from('useky').select('id, nazev').in('id', idUseku)
      : Promise.resolve({ data: [], error: null }),
    idPozic.length
      ? supabase.from('positions').select('id, label').in('id', idPozic)
      : Promise.resolve({ data: [], error: null }),
  ])
  const nazvyUseku = new Map((useky.data ?? []).map((u) => [u.id as string, u.nazev as string]))
  const nazvyPozic = new Map((pozice.data ?? []).map((p) => [p.id as string, p.label as string]))

  /* --- výpočet a překlad na texty ------------------------------------ */

  const jmeno = (id: string) => lide.get(id)?.jmeno ?? 'Neznámý'
  const prehled = sestavitPrehledDne({
    den,
    ted: v.ted,
    smeny,
    udalosti,
    zona: () => zona,
    jmeno,
  })

  const cas = (iso: string | null) => (iso ? hodinaVPasmu(iso, zona) : null)
  const hhmm = (t: string) => t.slice(0, 5)

  const radky: RadekPrehledu[] = prehled.radky.map((r) => {
    const clovek = lide.get(r.osobaId)
    const smenyOsoby = smeny.filter((s) => s.employee_id === r.osobaId).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    const dnesniUdalosti = udalosti
      .filter((u) => u.employee_id === r.osobaId && u.stornovano_kdy == null && u.business_date === den)
      .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
    const jinaPobocka = r.pritomnost.pobockaId && r.pritomnost.pobockaId !== branchId ? r.pritomnost.pobockaId : null

    return {
      osobaId: r.osobaId,
      jmeno: jmeno(r.osobaId),
      usek: clovek?.usekId ? (nazvyUseku.get(clovek.usekId) ?? null) : null,
      pozice: clovek?.poziceId ? (nazvyPozic.get(clovek.poziceId) ?? null) : null,
      plan: smenyOsoby.length ? smenyOsoby.map((s) => `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}`).join(' · ') : null,
      smenaId: smenyOsoby[0]?.id ?? null,
      stav: r.stav,
      bezSmeny: r.bezSmeny,
      naPrestavce: r.pritomnost.naPrestavce,
      prichod: cas(r.pritomnost.prichod),
      odchod: cas(r.pritomnost.odchod),
      minut: r.pritomnost.minutNaMiste,
      otevrenyZeDne: r.pritomnost.otevrenyZeDne,
      pobockaPrichodu: jinaPobocka ? (v.pobocky.get(jinaPobocka) ?? null) : null,
      zacatekPlanu: smenyOsoby[0] ? hhmm(smenyOsoby[0].starts_at) : null,
      konecPlanu: smenyOsoby.length ? hhmm(smenyOsoby[smenyOsoby.length - 1].ends_at) : null,
      udalosti: dnesniUdalosti.map((u) => ({
        druh: NAZVY_DRUHU[u.kind] ?? u.kind,
        cas: hodinaVPasmu(u.occurred_at, zona),
      })),
    }
  })

  return { radky, souhrn: prehled.souhrn, aktualizovano: hodinaVPasmu(new Date(v.ted), zona) }
}
