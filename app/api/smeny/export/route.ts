import { redirect } from 'next/navigation'

import { datumACasSRokemVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import type { OsobaD, SmenaD } from '@/lib/rozpis-desktop'
import { dnyMesice, jeMesic, listyXlsx, nazevSouboru, sestavitExportMesice } from '@/lib/rozpis-export'
import { pdfZExportu } from '@/lib/rozpis-export-pdf'
import { DotazSelhal, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { zapsatXlsx } from '@/lib/xlsx-zapis'

export const dynamic = 'force-dynamic'

/**
 * Export rozpisu směn za měsíc do Excelu nebo PDF.
 *
 *   GET /api/smeny/export?rozsah=<firma|slug pobočky>&mesic=2026-09&format=xlsx|pdf
 *
 * Stojí mimo `app/[rozsah]/…` stejně jako export faktur — je to soubor,
 * ne obrazovka. Model tabulky a obě podoby jsou v `lib/rozpis-export*`
 * (zkouší se Nodem); tady se jen ověří přístup, načtou data a odešle
 * soubor.
 *
 * PRÁVO: `shifts.manage`. Export je hromadná kopie rozpisu všech lidí
 * najednou, takže chce právo plánovat, ne jen číst — stejné, které
 * otevírá tlačítko na obrazovce. Právo se ověřuje tady (první linie) a
 * řádky, které člověk číst nesmí, mu nevydá RLS (druhá): export
 * pobočky, na kterou nedosáhne, vyjde prázdný, ne cizí.
 *
 * NEEXPORTUJE se nic, co obrazovka Rozpis nezná: žádné mzdy, kontakty
 * ani docházka. Jen kdo, kdy, kde a kolik hodin je naplánováno.
 */

const SLOUPCE =
  'id, branch_id, employee_id, position_id, shift_date, starts_at, ends_at, status, note, published_at, published_employee_id, published_starts_at, published_ends_at, published_status'

const STRANKA = 1000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const rozsah = searchParams.get('rozsah') ?? ''
  const mesic = searchParams.get('mesic')
  const format = searchParams.get('format')
  /*
    Nepovinné zúžení na jednu pobočku — obrazovka ho posílá, když je
    v nabídce Zobrazit vybraná jedna (jinak by stažený soubor obsahoval
    celou firmu, ačkoli na obrazovce je vidět jedna pobočka).

    Adrese se nevěří: id se porovná s pobočkami, které uživateli vrátila
    databáze, a co nesedí, se odmítne. I kdyby projelo, RLS cizí řádky
    stejně nevydá — tohle je první linie, ne jediná.
  */
  const pobockaZAdresy = searchParams.get('pobocka')

  if (!jeMesic(mesic) || Number(mesic.slice(0, 4)) < 2020 || Number(mesic.slice(0, 4)) > 2100) {
    return new Response('Měsíc má mít tvar RRRR-MM.', { status: 400 })
  }
  if (format !== 'xlsx' && format !== 'pdf') {
    return new Response('Formát je xlsx, nebo pdf.', { status: 400 })
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return new Response('Účet zatím nepatří k žádné firmě.', { status: 400 })

  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') return new Response('Na tohle nemáte oprávnění.', { status: 403 })
  const { ctx, scope } = pristup

  const jenPobocka = pobockaZAdresy ? (ctx.branches.find((b) => b.id === pobockaZAdresy) ?? null) : null
  if (pobockaZAdresy && !jenPobocka) return new Response('Taková pobočka tu není.', { status: 400 })
  // Na pobočkovém rozsahu rozhoduje rozsah; jiná pobočka z adresy by ho obcházela.
  if (jenPobocka && scope.level === 'branch' && scope.branchId !== jenPobocka.id) {
    return new Response('Tahle pobočka do zvoleného rozsahu nepatří.', { status: 400 })
  }

  const supabase = await getServerSupabase()
  const dny = dnyMesice(mesic)

  /* --- směny (po stránkách; jeden dotaz vrací nejvýš 1000 řádků) ------ */

  async function nactiStranku(od: number, sPauzou: boolean) {
    let dotaz = supabase
      .from('shifts')
      .select(sPauzou ? `${SLOUPCE}, pauza_od, pauza_do` : SLOUPCE)
      .eq('tenant_id', tenantId)
      .gte('shift_date', dny[0])
      .lte('shift_date', dny[dny.length - 1])
      .neq('status', 'cancelled')
      .order('shift_date', { ascending: true })
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
    const jedna = jenPobocka?.id ?? (scope.level === 'branch' ? scope.branchId : null)
    if (jedna) dotaz = dotaz.eq('branch_id', jedna)
    return dotaz.range(od, od + STRANKA - 1)
  }

  // Sloupce pauza_od/pauza_do přidává migrace 20260916200000; než proběhne,
  // dotaz na ně selže. Export se pak zopakuje bez nich — a nepočítá pauzy,
  // které v databázi ještě nejsou.
  let sPauzou = true
  const smeny: SmenaD[] = []
  for (let od = 0; ; od += STRANKA) {
    let { data, error } = await nactiStranku(od, sPauzou)
    if (error && sPauzou && sloupecNeexistuje(error)) {
      sPauzou = false
      ;({ data, error } = await nactiStranku(od, false))
    }
    if (error) throw new DotazSelhal('směny', error)
    const radky = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      pauza_od: null,
      pauza_do: null,
      ...r,
    })) as unknown as SmenaD[]
    smeny.push(...radky)
    if (radky.length < STRANKA) break
  }

  /* --- lidé, úseky, pozice ---------------------------------------------- */

  const { data: lide, error: chybaLide } = await supabase
    .from('employees')
    .select('id, full_name, usek_id, position_id')
    .eq('tenant_id', tenantId)
  if (chybaLide) throw new DotazSelhal('zaměstnanci', chybaLide)

  const osoby = new Map<string, OsobaD>(
    (lide ?? []).map((c) => [
      c.id as string,
      {
        id: c.id as string,
        jmeno: c.full_name as string,
        usekId: (c.usek_id as string | null) ?? null,
        poziceId: (c.position_id as string | null) ?? null,
        barva: null,
      },
    ]),
  )

  const { data: useky, error: chybaUseky } = await supabase
    .from('useky')
    .select('id, nazev')
    .eq('tenant_id', tenantId)
    .order('poradi', { ascending: true })
    .order('nazev', { ascending: true })
  if (chybaUseky) throw new DotazSelhal('úseky', chybaUseky)

  const { data: pozice, error: chybaPozice } = await supabase
    .from('positions')
    .select('id, label')
    .eq('tenant_id', tenantId)
  if (chybaPozice) throw new DotazSelhal('pozice', chybaPozice)

  /* --- sestavení -------------------------------------------------------- */

  const pobocky = new Map(ctx.branches.map((b) => [b.id, b.name]))
  const zona =
    jenPobocka?.timezone ??
    (scope.branchId ? ctx.branches.find((b) => b.id === scope.branchId)?.timezone : ctx.branches[0]?.timezone) ??
    ZONA_VYCHOZI
  // Co je v souboru napsané jako rozsah, musí sedět s tím, co v něm opravdu je.
  const popisRozsahu = jenPobocka?.name ?? scope.branchName ?? ctx.tenant.name

  const model = sestavitExportMesice({
    mesic,
    smeny,
    osoby,
    useky: new Map((useky ?? []).map((u) => [u.id as string, u.nazev as string])),
    pozice: new Map((pozice ?? []).map((p) => [p.id as string, p.label as string])),
    pobocky,
    rozsah: popisRozsahu,
    vytvoreno: datumACasSRokemVPasmu(new Date(), zona),
  })

  const bajty = format === 'xlsx' ? zapsatXlsx(listyXlsx(model)) : pdfZExportu(model)
  const soubor = nazevSouboru(jenPobocka?.name ?? scope.branchName ?? 'firma', mesic, format)

  return new Response(bajty as BodyInit, {
    headers: {
      'Content-Type':
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      'Content-Disposition': `attachment; filename="${soubor}"`,
      // Osobní údaje (kdo kdy pracuje) se nemají ukládat do sdílených mezipamětí.
      'Cache-Control': 'private, no-store',
    },
  })
}
