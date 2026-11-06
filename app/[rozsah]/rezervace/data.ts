import 'server-only'

import { denVPasmu } from '@/lib/cas'
import { provozniDen } from '@/lib/provozni-den'
import { KBELIK_REZERVACI, dokumentyRezervace, type DokumentRezervace } from '@/lib/rezervace-prilohy'
import { DotazSelhal, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

import type { PobockaRezervaci } from './pristup'
import type { Poznamka, Priloha, RezervaceRadek, RezervaceSDokumenty } from './prvky'

/**
 * Dotazy Rezervací a akcí. Vždycky uživatelským klientem — RLS
 * (`rezervace_cist`…) je druhá linie pod tím, že stránka ptá jen na
 * pobočky, které jí vrátil `zkusPristupRezervacim`.
 *
 * Chyba dotazu se nezahazuje (`DotazSelhal`): prázdný kalendář by
 * vypadal jako „nic zapsaného“ a host by přišel k obsazenému stolu.
 */

const SLOUPCE_REZERVACE =
  'id, branch_id, den, druh, stav, nazev, jmeno_hosta, zacatek, konec, pocet_osob, prostor, typ_akce, zdroj'

/**
 * Stoly a číslo rezervace ze zdroje (migrace 20261107100000). Vercel
 * nasadí kód dřív, než proběhne db push — do té doby sloupce nejsou
 * a dotaz se zopakuje bez nich (`sloupecNeexistuje`): rezervace se
 * ukážou bez stolů, ne chybou. `prostor_ze_zdroje` (kdo napsal prostor)
 * je ze stejné migrace; bez něj (`null`) rozhodne shoda s přáním.
 */
const SLOUPCE_ZDROJE = {
  kalendar: ', misto_zdroje, prani_zdroje, prostor_ze_zdroje',
  detail: ', misto_zdroje, cislo_zdroje, prani_zdroje, prostor_ze_zdroje',
} as const

type RadekDb = Omit<RezervaceRadek, 'zona' | 'misto_zdroje' | 'prani_zdroje' | 'prostor_ze_zdroje'> & {
  misto_zdroje?: unknown
  prani_zdroje?: unknown
  prostor_ze_zdroje?: unknown
}

function sZonou<T extends RadekDb>(
  radky: T[],
  pobocky: PobockaRezervaci[],
): (T & { zona: string; misto_zdroje: string; prani_zdroje: string; prostor_ze_zdroje: boolean | null })[] {
  const zony = new Map(pobocky.map((p) => [p.id, p.zona]))
  return radky.map((r) => ({
    ...r,
    misto_zdroje: typeof r.misto_zdroje === 'string' ? r.misto_zdroje : '',
    prani_zdroje: typeof r.prani_zdroje === 'string' ? r.prani_zdroje : '',
    prostor_ze_zdroje: typeof r.prostor_ze_zdroje === 'boolean' ? r.prostor_ze_zdroje : null,
    zona: zony.get(r.branch_id) ?? 'Europe/Prague',
  }))
}

/** Dotaz se sloupci zdroje; nezná-li je databáze ještě, znovu bez nich. Jiná chyba se vrátí beze změny. */
async function sloupciZdroje<T, E extends { message: string; code?: string } | null>(
  navic: string,
  dotaz: (navic: string) => PromiseLike<{ data: T; error: E }>,
): Promise<{ data: T; error: E }> {
  const prvni = await dotaz(navic)
  return sloupecNeexistuje(prvni.error) ? dotaz('') : prvni
}

/** Dnešní provozní den první pobočky; když ho databáze nedá, kalendářní den v jejím pásmu. */
export async function dnesPobocky(pobocka: PobockaRezervaci): Promise<string> {
  return (await provozniDen(pobocka.id)) ?? denVPasmu(new Date(), pobocka.zona)
}

/**
 * Rezervace v kalendáři i s dokumenty, které k nim kdo připojil (přílohy
 * ke dni ne — ty mají značku dne). Dokumenty jdou vnořeně stejným
 * dotazem, takže je hlídá i RLS `rezervace_prilohy_cist`.
 */
export async function nacistRezervace(tenantId: string, pobocky: PobockaRezervaci[], od: string, doDne: string): Promise<RezervaceSDokumenty[]> {
  const supabase = await getServerSupabase()
  const { data, error } = await sloupciZdroje(SLOUPCE_ZDROJE.kalendar, (navic) =>
    supabase
      .from('rezervace')
      .select(`${SLOUPCE_REZERVACE}${navic}, rezervace_prilohy(id, nazev, mime, nahrano)`)
      .eq('tenant_id', tenantId)
      .in('branch_id', pobocky.map((p) => p.id))
      .gte('den', od)
      .lte('den', doDne)
      .order('zacatek')
      .limit(3000),
  )
  if (error) throw new DotazSelhal('rezervace v kalendáři', error)
  const radky = (data ?? []) as unknown as (RadekDb & { rezervace_prilohy: (DokumentRezervace & { nahrano: string })[] | null })[]
  return sZonou(
    radky.map(({ rezervace_prilohy, ...r }) => ({ ...r, dokumenty: dokumentyRezervace(rezervace_prilohy) })),
    pobocky,
  )
}

export async function nacistRezervaci(tenantId: string, id: string, pobocky: PobockaRezervaci[]) {
  const supabase = await getServerSupabase()
  const { data: nalezeno, error } = await sloupciZdroje(SLOUPCE_ZDROJE.detail, (navic) =>
    supabase
      .from('rezervace')
      .select(`${SLOUPCE_REZERVACE}, menu, zaloha_hosta_haleru, zaloha_hosta_stav, poznamka_zdroje, stav_zdroje, poskytovatel, importovano_kdy, externi_zmeneno_kdy${navic}`)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle(),
  )
  if (error) throw new DotazSelhal('rezervace', error)
  const data = nalezeno as unknown as (RadekDb & Record<string, unknown>) | null
  if (!data) return null
  // Rezervace jiné pobočky, než je v adrese, se tady neukáže, i když ji
  // člověk smí vidět jinde — rozsah z adresy platí.
  if (!pobocky.some((p) => p.id === data.branch_id)) return null
  const [radek] = sZonou([data], pobocky)
  return {
    radek,
    menu: String(data.menu ?? ''),
    zaloha: { haleru: (data.zaloha_hosta_haleru as number | null) ?? null, stav: String(data.zaloha_hosta_stav) },
    poznamkaZdroje: String(data.poznamka_zdroje ?? ''),
    stavZdroje: String(data.stav_zdroje ?? ''),
    poskytovatel: (data.poskytovatel as string | null) ?? null,
    importovanoKdy: (data.importovano_kdy as string | null) ?? null,
    cisloZdroje: typeof data.cislo_zdroje === 'string' ? data.cislo_zdroje : '',
  }
}

/** Telefon a e-mail. Volá se jen pro `rezervace.manage` (ostatním RLS řádek nevydá). */
export async function nacistKontakt(id: string): Promise<{ telefon: string; email: string } | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.from('rezervace_kontakty').select('telefon, email').eq('rezervace_id', id).maybeSingle()
  if (error) throw new DotazSelhal('kontakt hosta', error)
  return data ? { telefon: String(data.telefon), email: String(data.email) } : { telefon: '', email: '' }
}

/** Kolik poznámek a příloh má který den pobočky (značky v kalendáři). Klíč `pobočka|den`. */
export async function nacistZnackyDnu(
  tenantId: string,
  pobocky: PobockaRezervaci[],
  od: string,
  doDne: string,
): Promise<Map<string, { poznamek: number; priloh: number }>> {
  const supabase = await getServerSupabase()
  const ids = pobocky.map((p) => p.id)
  const [poznamky, prilohy] = await Promise.all([
    supabase.from('rezervace_poznamky').select('branch_id, den').eq('tenant_id', tenantId).in('branch_id', ids).gte('den', od).lte('den', doDne).limit(5000),
    supabase.from('rezervace_prilohy').select('branch_id, den').eq('tenant_id', tenantId).in('branch_id', ids).gte('den', od).lte('den', doDne).limit(5000),
  ])
  if (poznamky.error) throw new DotazSelhal('poznámky ke dnům', poznamky.error)
  if (prilohy.error) throw new DotazSelhal('přílohy ke dnům', prilohy.error)
  const mapa = new Map<string, { poznamek: number; priloh: number }>()
  const pricti = (r: { branch_id: string; den: string }, co: 'poznamek' | 'priloh') => {
    const klic = `${r.branch_id}|${r.den}`
    const z = mapa.get(klic) ?? { poznamek: 0, priloh: 0 }
    z[co] += 1
    mapa.set(klic, z)
  }
  for (const r of (poznamky.data ?? []) as { branch_id: string; den: string }[]) pricti(r, 'poznamek')
  for (const r of (prilohy.data ?? []) as { branch_id: string; den: string }[]) pricti(r, 'priloh')
  return mapa
}

type Filtr = { rezervace: string } | { tenantId: string; pobocka: string; den: string }

async function jmenaAutoru(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.from('employees').select('id, full_name').in('id', ids)
  if (error) throw new DotazSelhal('autoři poznámek', error)
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((e) => [e.id, e.full_name]))
}

export async function nacistPoznamky(filtr: Filtr): Promise<Poznamka[]> {
  const supabase = await getServerSupabase()
  let dotaz = supabase.from('rezervace_poznamky').select('id, nadpis, obsah, autor, vytvoreno_kdy, zmeneno_kdy')
  dotaz = 'rezervace' in filtr
    ? dotaz.eq('rezervace_id', filtr.rezervace)
    : dotaz.eq('tenant_id', filtr.tenantId).eq('branch_id', filtr.pobocka).eq('den', filtr.den)
  const { data, error } = await dotaz.order('vytvoreno_kdy')
  if (error) throw new DotazSelhal('poznámky', error)
  const radky = (data ?? []) as { id: string; nadpis: string; obsah: string; autor: string | null; vytvoreno_kdy: string; zmeneno_kdy: string }[]
  const jmena = await jmenaAutoru([...new Set(radky.map((r) => r.autor).filter((a): a is string => !!a))])
  return radky.map((r) => ({ ...r, autor: r.autor ? jmena.get(r.autor) ?? null : null }))
}

export async function nacistPrilohy(filtr: Filtr): Promise<Priloha[]> {
  const supabase = await getServerSupabase()
  let dotaz = supabase.from('rezervace_prilohy').select('id, nazev, mime, velikost, nahrano')
  dotaz = 'rezervace' in filtr
    ? dotaz.eq('rezervace_id', filtr.rezervace)
    : dotaz.eq('tenant_id', filtr.tenantId).eq('branch_id', filtr.pobocka).eq('den', filtr.den)
  const { data, error } = await dotaz.order('nahrano')
  if (error) throw new DotazSelhal('přílohy', error)
  return (data ?? []) as Priloha[]
}

export type PrilohaNahledu = Priloha & {
  cesta: string
  branch_id: string
  rezervace_id: string | null
  den: string | null
}

/**
 * Jedna příloha pro náhled dokumentu. Pobočku v rozsahu adresy ověří
 * stránka (`pobocky`); RLS `rezervace_prilohy_cist` je druhá linie.
 */
export async function nacistPrilohu(tenantId: string, id: string, pobocky: PobockaRezervaci[]): Promise<PrilohaNahledu | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase
    .from('rezervace_prilohy')
    .select('id, nazev, mime, velikost, nahrano, cesta, branch_id, rezervace_id, den')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new DotazSelhal('příloha', error)
  if (!data || !pobocky.some((p) => p.id === data.branch_id)) return null
  return data as PrilohaNahledu
}

/**
 * Obsah souboru z úložiště — UŽIVATELSKÝM klientem, takže čtení hlídá
 * i politika kbelíku `rezervace_soubory_cist`. `null` = nejde načíst
 * (chybí, nebo ho úložiště nevydalo); stránka nabídne stažení.
 */
export async function stahnoutPrilohu(cesta: string): Promise<Uint8Array | null> {
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.storage.from(KBELIK_REZERVACI).download(cesta)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}
