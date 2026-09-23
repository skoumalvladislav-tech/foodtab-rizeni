'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { provozniDen } from '@/lib/provozni-den'
import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { bezpecnyNavrat, UUID, zaklad } from '../zaklad'
import { ROZVRHY } from './spolecne'

/**
 * Akce checklistů.
 *
 * Pravidla (výběr, meze, souběh, povinné položky, dvojí kontrola) drží
 * databáze v RPC z 20260923160000_checklisty_rpc.sql — tady se jen
 * posílá, co člověk vyplnil, a výsledek se převede na hlášku.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE: dokud RPC v databázi nejsou,
 * `funkceNeexistuje` přepne na dosavadní chování (přímý zápis jako do
 * 23. 9.), ať se po sloučení do main checklisty dají vyplňovat dál.
 * Co bez migrace nejde vůbec (fotky, potvrzení, úprava šablony), řekne
 * obrazovka rovnou — tlačítko se neukáže.
 */

const zakladni = (rozsah: string) => `/${rozsah}/ukoly/checklisty`
const naDetail = (rozsah: string, beh: string) => `/${rozsah}/ukoly/checklisty/${beh}`

function obnovit(rozsah: string, beh?: string) {
  revalidatePath(zakladni(rozsah), 'layout')
  if (beh) revalidatePath(naDetail(rozsah, beh), 'layout')
}

/* ======================================================================
   SPUŠTĚNÍ A ODPOVĚDNOST
   ====================================================================== */

/**
 * Spuštění checklistu na dnešní provozní den (ruční; plánované rozvrhy
 * zakládá plánovač sám). Dvojice (šablona, pobočka, den) je jedinečná —
 * druhé kliknutí nevyrobí druhý běh, jen otevře ten existující.
 * `started_by` je ze session, ne z formuláře.
 */
export async function spustitChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const sablonaId = String(formData.get('sablona') ?? '')
  if (!UUID.test(sablonaId)) return

  const z = await zaklad(rozsah)
  if (!z || !z.branchId) return

  const den = await provozniDen(z.branchId)
  if (!den) redirect(bezpecnyNavrat(null, rozsah, zakladni(rozsah), { chyba: 'Nepodařilo se zjistit provozní den.' }))

  const komu = String(formData.get('komu') ?? '').trim()
  const doKdy = String(formData.get('doKdy') ?? '').trim()
  const smena = String(formData.get('smena') ?? '').trim().slice(0, 120)

  const supabase = await getServerSupabase()
  const zakladRadku = {
    tenant_id: z.tenantId,
    branch_id: z.branchId,
    template_id: sablonaId,
    business_date: den,
    assigned_employee_id: UUID.test(komu) ? komu : null,
    // `datetime-local` = hodina na zdi; okamžik z ní dělá databáze (pravidlo 11).
    due_at: doKdy === '' ? null : doKdy,
  }

  let { error } = await supabase
    .from('checklist_runs')
    .upsert(
      { ...zakladRadku, shift_label: smena, started_by: z.employeeId },
      { onConflict: 'template_id,branch_id,business_date', ignoreDuplicates: true },
    )
  if (error && sloupecNeexistuje(error)) {
    ;({ error } = await supabase
      .from('checklist_runs')
      .upsert(zakladRadku, { onConflict: 'template_id,branch_id,business_date', ignoreDuplicates: true }))
  }
  if (error) {
    // 42501 = přiřazený člověk nepatří k firmě (trg_checklist_run_prirazeny).
    redirect(bezpecnyNavrat(formData.get('zpet'), rozsah, zakladni(rozsah), {
      chyba: error.code === '42501' ? 'Vybraný člověk nepatří k vaší firmě.' : 'Checklist se nepodařilo spustit.',
    }))
  }

  const { data, error: chybaBehu } = await supabase
    .from('checklist_runs')
    .select('id')
    .eq('template_id', sablonaId)
    .eq('branch_id', z.branchId)
    .eq('business_date', den)
    .limit(1)
  if (chybaBehu) throw new DotazSelhal('spuštěný běh', chybaBehu)
  const beh = data?.[0]?.id as string | undefined

  obnovit(rozsah, beh)
  redirect(beh ? naDetail(rozsah, beh) : zakladni(rozsah))
}

/**
 * Změna odpovědnosti (kdo / do kdy / směna) na běžícím checklistu.
 * Prázdné pole = zrušit. Druhou linii (cizí člověk) drží spoušť.
 */
export async function nastavitOdpovednost(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const beh = String(formData.get('beh') ?? '')
  if (!UUID.test(beh)) return

  const z = await zaklad(rozsah)
  if (!z) return

  const komu = String(formData.get('komu') ?? '').trim()
  const doKdy = String(formData.get('doKdy') ?? '').trim()
  const smena = String(formData.get('smena') ?? '').trim().slice(0, 120)
  const zmena = {
    assigned_employee_id: UUID.test(komu) ? komu : null,
    due_at: doKdy === '' ? null : doKdy,
  }

  const supabase = await getServerSupabase()
  let { error } = await supabase
    .from('checklist_runs')
    .update({ ...zmena, shift_label: smena })
    .eq('id', beh)
    .eq('tenant_id', z.tenantId)
    .eq('status', 'open')
  if (error && sloupecNeexistuje(error)) {
    ;({ error } = await supabase
      .from('checklist_runs')
      .update(zmena)
      .eq('id', beh)
      .eq('tenant_id', z.tenantId)
      .eq('status', 'open'))
  }

  const zpet = formData.get('zpet')
  if (error) {
    redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {
      chyba: error.code === '42501' ? 'Vybraný člověk nepatří k vaší firmě.' : 'Odpovědnost se nepodařilo uložit.',
    }))
  }
  obnovit(rozsah, beh)
  redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {}))
}

/* ======================================================================
   POLOŽKA
   ====================================================================== */

type Rezim = 'splnit' | 'nelze' | 'vratit'

/**
 * Zápis jedné položky: splnit (s hodnotou, když ji položka chce), nelze
 * splnit (s důvodem), nebo vrátit na nezaškrtnutou. Poznámka jede vždy
 * s ním. `verze` z formuláře je ta, kterou člověk viděl — když ji mezitím
 * někdo změnil, databáze zápis odmítne (40001) a řekne se to nahlas.
 */
export async function ulozitPolozku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const beh = String(formData.get('beh') ?? '')
  const polozka = String(formData.get('polozka') ?? '')
  if (!UUID.test(beh) || !UUID.test(polozka)) return

  const rezimRaw = String(formData.get('rezim') ?? 'splnit')
  const rezim: Rezim = rezimRaw === 'nelze' || rezimRaw === 'vratit' ? rezimRaw : 'splnit'
  const hodnota = String(formData.get('hodnota') ?? '').trim()
  // Nepřišla-li poznámka vůbec (rychlé odškrtnutí z řádku), nesmaže se:
  // databáze u NULL nechá původní text.
  const poznamkaRaw = formData.get('poznamka')
  const poznamka = poznamkaRaw === null ? null : String(poznamkaRaw).slice(0, 500)
  const duvod = String(formData.get('duvod') ?? '').trim().slice(0, 500)
  const verzeRaw = String(formData.get('verze') ?? '').trim()
  const verze = /^\d+$/.test(verzeRaw) ? Number(verzeRaw) : null

  const z = await zaklad(rozsah)
  if (!z) return

  const zpet = formData.get('zpet')
  const supabase = await getServerSupabase()

  const { error } = await supabase.rpc('zapsat_polozku_checklistu', {
    p_tenant: z.tenantId,
    p_run: beh,
    p_item: polozka,
    p_hodnota: hodnota === '' ? null : hodnota,
    p_note: poznamka,
    p_nelze_splnit: rezim === 'nelze',
    p_nelze_splnit_duvod: duvod,
    p_ocekavana_verze: verze,
    p_zrusit: rezim === 'vratit',
  })

  if (error && funkceNeexistuje(error)) {
    await ulozitPolozkuPostaru(z.tenantId, z.employeeId, rozsah, beh, polozka, rezim, hodnota, zpet)
    return
  }

  if (error) {
    const hlaska =
      error.code === '40001'
        ? 'Někdo jiný mezitím tuhle položku upravil. Stránka ukazuje aktuální stav — zkontrolujte ho a zkuste to znovu.'
        : error.message
    redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), { chyba: hlaska, polozka }))
  }

  obnovit(rozsah, beh)
  redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {}))
}

/**
 * Dosavadní zápis (do nasazení 20260923160000): jen „splnit", meze
 * z databáze, přímý upsert. Nelze splnit / vrátit bez migrace nejde —
 * obrazovka ty volby bez ní nenabízí.
 */
async function ulozitPolozkuPostaru(
  tenantId: string,
  employeeId: string | null,
  rozsah: string,
  beh: string,
  polozka: string,
  rezim: Rezim,
  hodnota: string,
  zpet: FormDataEntryValue | null,
): Promise<void> {
  const chyba = (text: string): never =>
    redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), { chyba: text, polozka }))

  if (rezim !== 'splnit') chyba('Tahle volba bude dostupná po nasazení databáze.')

  const supabase = await getServerSupabase()
  const { data: behy, error: chybaBehu } = await supabase
    .from('checklist_runs')
    .select('id, template_id, status')
    .eq('id', beh)
    .eq('tenant_id', tenantId)
    .limit(1)
  if (chybaBehu) throw new DotazSelhal('běh checklistu', chybaBehu)
  const run = behy?.[0] as { template_id: string; status: string } | undefined
  if (!run) chyba('Checklist nenalezen.')
  if (run!.status !== 'open') chyba('Uzavřený checklist už nejde měnit.')

  const { data: polozky, error: chybaPolozky } = await supabase
    .from('checklist_items')
    .select('id, requires_value, value_type, min_value, max_value')
    .eq('id', polozka)
    .eq('template_id', run!.template_id)
    .limit(1)
  if (chybaPolozky) throw new DotazSelhal('položka checklistu', chybaPolozky)
  const p = polozky?.[0] as
    | { requires_value: boolean; value_type: string | null; min_value: number | null; max_value: number | null }
    | undefined
  if (!p) chyba('Ta položka k tomuhle checklistu nepatří.')

  let valueNumber: number | null = null
  let valueText: string | null = null
  if (p!.requires_value) {
    if (p!.value_type === 'photo') chyba('Fotky budou dostupné po nasazení databáze.')
    if (hodnota === '') chyba('Hodnota je povinná.')
    if (p!.value_type === 'number') {
      const n = Number(hodnota.replace(',', '.'))
      if (!Number.isFinite(n)) chyba('Zadejte platné číslo.')
      if ((p!.min_value !== null && n < p!.min_value) || (p!.max_value !== null && n > p!.max_value)) {
        chyba('Hodnota je mimo povolené meze.')
      }
      valueNumber = n
    } else {
      valueText = hodnota.slice(0, 500)
    }
  }

  const { error } = await supabase.from('checklist_entries').upsert(
    {
      run_id: beh,
      item_id: polozka,
      checked: true,
      value_number: valueNumber,
      value_text: valueText,
      employee_id: employeeId,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: 'run_id,item_id' },
  )
  if (error) chyba('Položku se nepodařilo zapsat.')

  obnovit(rozsah, beh)
  redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {}))
}

/* ======================================================================
   UZAVŘENÍ A POTVRZENÍ
   ====================================================================== */

/**
 * Uzavření běhu. Stav (hotovo / s výhradami) a kontrolu povinných
 * položek dělá databáze; `completed_by` je ze session.
 */
export async function uzavritChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const beh = String(formData.get('beh') ?? '')
  if (!UUID.test(beh)) return

  const z = await zaklad(rozsah)
  if (!z) return

  const zpet = formData.get('zpet')
  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('uzavrit_checklist', { p_tenant: z.tenantId, p_run: beh })

  if (error && funkceNeexistuje(error)) {
    // Dosavadní chování: přímý zápis (obrazovka tlačítko ukáže, až je
    // všechno odškrtnuté — kontrolu povinných bez migrace nemá kdo držet).
    const { error: chybaZapisu } = await supabase
      .from('checklist_runs')
      .update({ status: 'done', finished_at: new Date().toISOString(), completed_by: z.employeeId })
      .eq('id', beh)
      .eq('tenant_id', z.tenantId)
      .eq('status', 'open')
    if (chybaZapisu) {
      redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), { chyba: 'Checklist se nepodařilo uzavřít.' }))
    }
  } else if (error) {
    redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), { chyba: error.message }))
  }

  obnovit(rozsah, beh)
  redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {}))
}

/** Manažerské potvrzení (dvojí kontrola). Kdo běh uzavřel, ho nepotvrdí. */
export async function potvrditChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const beh = String(formData.get('beh') ?? '')
  if (!UUID.test(beh)) return

  const z = await zaklad(rozsah)
  if (!z) return

  const zpet = formData.get('zpet')
  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('potvrdit_checklist', { p_tenant: z.tenantId, p_run: beh })
  if (error) {
    redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {
      chyba: funkceNeexistuje(error) ? 'Potvrzování bude dostupné po nasazení databáze.' : error.message,
    }))
  }
  obnovit(rozsah, beh)
  redirect(bezpecnyNavrat(zpet, rozsah, naDetail(rozsah, beh), {}))
}

/* ======================================================================
   NAHLÁSIT PROBLÉM → ÚKOL
   ====================================================================== */

/**
 * Úkol z položky (nebo z celého běhu). Pobočku a právo tasks.manage bere
 * databáze z běhu. Priorita „kritická" jen tady — obecné zadání úkolu ji
 * nezná a databáze ji mimo checklist nepustí (tasks_critical_jen_checklist).
 */
export async function zalozitUkolZChecklistu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zaklad(rozsah)
  if (!z) return

  const beh = String(formData.get('beh') ?? '')
  if (!UUID.test(beh)) return

  const polozkaVstup = String(formData.get('polozka') ?? '')
  const polozka = UUID.test(polozkaVstup) ? polozkaVstup : null

  const zpetFormular = `${naDetail(rozsah, beh)}/problem${polozka ? `?polozka=${polozka}` : ''}`
  const chyba = (text: string): never =>
    redirect(`${zpetFormular}${polozka ? '&' : '?'}chyba=${encodeURIComponent(text)}`)

  const poznamka = String(formData.get('poznamka') ?? '').trim().slice(0, 1000)
  if (poznamka === '') chyba('Napište, co je špatně.')
  // Název je nepovinný: bez něj se vezme první řádek popisu (zadání bod 12 —
  // appka předvyplní, člověk nemusí psát totéž dvakrát).
  const nazev = (String(formData.get('nazev') ?? '').trim() || poznamka.split('\n')[0].trim()).slice(0, 120)

  let komu = String(formData.get('komu') ?? 'pobocka')
  const vybrane = (klic: string): string | null => {
    const v = String(formData.get(klic) ?? '').trim()
    return UUID.test(v) ? v : null
  }
  // Vybraný adresát v rozbalovátku platí i bez přepnutí „Komu" (formulář
  // bez JavaScriptu to za člověka neudělá).
  if (komu === 'pobocka') {
    const zvolene = (['usek', 'pozice', 'clovek'] as const).filter((k) => vybrane(k) !== null)
    if (zvolene.length === 1) komu = zvolene[0]
    else if (zvolene.length > 1) chyba('Vyberte jen jednoho adresáta a přepněte volbu „Komu".')
  }
  const usek = komu === 'usek' ? vybrane('usek') : null
  const pozice = komu === 'pozice' ? vybrane('pozice') : null
  const clovek = komu === 'clovek' ? vybrane('clovek') : null
  if (komu !== 'pobocka' && usek === null && pozice === null && clovek === null) {
    chyba('Vyberte, komu je úkol určený.')
  }

  const den = String(formData.get('termin_datum') ?? '').trim()
  const cas = String(formData.get('termin_cas') ?? '').trim()
  let termin: string | null = null
  if (den !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(den)) chyba('Termín není platné datum.')
    if (cas !== '' && !/^\d{2}:\d{2}$/.test(cas)) chyba('Čas termínu není platný.')
    termin = `${den}T${cas === '' ? '23:59' : cas}`
  }

  const prioritaRaw = String(formData.get('priorita') ?? '')
  const priorita = prioritaRaw === 'critical' || prioritaRaw === 'high' ? prioritaRaw : 'normal'

  const supabase = await getServerSupabase()
  const { data: ukol, error } = await supabase.rpc('zalozit_ukol_z_checklistu', {
    p_tenant: z.tenantId,
    p_run: beh,
    p_polozka: polozka,
    p_nazev: nazev,
    p_poznamka: poznamka,
    p_termin: termin,
    p_priorita: priorita,
    p_usek: usek,
    p_pozice: pozice,
    p_clovek: clovek,
  })

  if (error) {
    if (funkceNeexistuje(error)) chyba('Nahlášení problému čeká na nasazení databáze.')
    // 23514 u 'critical' před nasazením migrace priority: tabulka třetí
    // úroveň ještě nezná.
    if (error.code === '23514' && priorita === 'critical') {
      chyba('Priorita „Kritická" bude dostupná po nasazení databáze. Zvolte „Důležitá".')
    }
    chyba(error.message)
  }

  obnovit(rozsah, beh)
  revalidatePath(`/${rozsah}/ukoly`)
  const cil = polozka ? `${naDetail(rozsah, beh)}/polozka/${polozka}` : naDetail(rozsah, beh)
  redirect(`${cil}?ukol=${String(ukol ?? '')}`)
}

/* ======================================================================
   ŠABLONY
   ====================================================================== */

const TYPY_HODNOTY = ['number', 'text', 'photo'] as const
const MAX_RADKU = 60

type RadekSablony = {
  id: string | null
  position: number
  label: string
  section: string | null
  instructions: string
  povinna: boolean
  requires_value: boolean
  value_type: string | null
  value_unit: string | null
  min_value: number | null
  max_value: number | null
}

/** Řádky položek z formuláře v pořadí, prázdné se přeskočí. */
function radkySablony(formData: FormData): RadekSablony[] {
  const pocet = Math.max(0, Math.min(MAX_RADKU, Number(formData.get('pocetRadku') ?? 0) || 0))
  const radky: RadekSablony[] = []
  for (let i = 0; i < pocet; i++) {
    const label = String(formData.get(`polozka-${i}-nazev`) ?? '').trim().slice(0, 200)
    if (label === '') continue
    const idRaw = String(formData.get(`polozka-${i}-id`) ?? '')
    const vyzaduje = formData.get(`polozka-${i}-vyzaduje`) === 'on'
    const typRaw = String(formData.get(`polozka-${i}-typ`) ?? 'number')
    const typ = (TYPY_HODNOTY as readonly string[]).includes(typRaw) ? typRaw : 'number'
    const jednotka = String(formData.get(`polozka-${i}-jednotka`) ?? '').trim().slice(0, 20)
    const minRaw = String(formData.get(`polozka-${i}-min`) ?? '').trim().replace(',', '.')
    const maxRaw = String(formData.get(`polozka-${i}-max`) ?? '').trim().replace(',', '.')
    const jeCislo = vyzaduje && typ === 'number'
    const min = jeCislo && minRaw !== '' && Number.isFinite(Number(minRaw)) ? Number(minRaw) : null
    const max = jeCislo && maxRaw !== '' && Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : null
    radky.push({
      id: UUID.test(idRaw) ? idRaw : null,
      position: radky.length + 1,
      label,
      section: String(formData.get(`polozka-${i}-sekce`) ?? '').trim().slice(0, 80) || null,
      instructions: String(formData.get(`polozka-${i}-instrukce`) ?? '').trim().slice(0, 1000),
      // Checkbox „Povinná" posílá hodnotu jen zaškrtnutý; skryté pole
      // `-povinna-pole` říká, že řádek tu volbu vůbec nabízel (jinak výchozí ano).
      povinna: formData.get(`polozka-${i}-povinna-pole`) === null || formData.get(`polozka-${i}-povinna`) === 'on',
      requires_value: vyzaduje,
      value_type: vyzaduje ? typ : null,
      value_unit: vyzaduje && jednotka !== '' ? jednotka : null,
      min_value: min,
      max_value: max,
    })
  }
  return radky
}

function rozvrhZFormulare(formData: FormData): { rozvrh: string; dny: number[] } {
  const rozvrhRaw = String(formData.get('rozvrh') ?? 'daily')
  const rozvrh = ROZVRHY.includes(rozvrhRaw) ? rozvrhRaw : 'daily'
  const dny = formData
    .getAll('dny')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return { rozvrh, dny: [...new Set(dny)].sort() }
}

/**
 * Založení nové šablony i s položkami. Právo drží politika
 * checklist_templates_write/checklist_items_write (tasks.manage na
 * pobočce); obrazovka formulář bez něj ani neukáže. Verze obsahu vznikne
 * sama při prvním běhu (app.zajistit_verzi_sablony).
 */
export async function vytvoritSablonuChecklistu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zaklad(rozsah)
  if (!z || !z.branchId) return

  const zpetChyba = (text: string): never =>
    redirect(`/${rozsah}/ukoly/sablona/nova?chyba=${encodeURIComponent(text)}`)

  const nazev = String(formData.get('nazev') ?? '').trim().slice(0, 200)
  if (nazev === '') zpetChyba('Checklist potřebuje název.')

  const usekRaw = String(formData.get('usek') ?? '').trim()
  const { rozvrh, dny } = rozvrhZFormulare(formData)
  const radky = radkySablony(formData)

  const supabase = await getServerSupabase()
  const zakladSablony = {
    tenant_id: z.tenantId,
    branch_id: z.branchId,
    usek_id: UUID.test(usekRaw) ? usekRaw : null,
    name: nazev,
  }

  // Bez migrace nezná databáze nové rozvrhy (a CHECK) ani sloupce; stará
  // cesta pak uloží nejbližší platný rozvrh a jen původní sloupce.
  let { data: sablona, error } = await supabase
    .from('checklist_templates')
    .insert({
      ...zakladSablony,
      schedule: rozvrh,
      dny_v_tydnu: dny,
      vyzaduje_potvrzeni: formData.get('potvrzeni') === 'on',
    })
    .select('id')
    .limit(1)
  let plne = true
  if (error && sloupecNeexistuje(error)) {
    plne = false
    ;({ data: sablona, error } = await supabase
      .from('checklist_templates')
      .insert({
        ...zakladSablony,
        schedule: ['opening', 'closing', 'haccp', 'weekly'].includes(rozvrh) ? rozvrh : 'opening',
      })
      .select('id')
      .limit(1))
  }
  if (error || !sablona?.[0]) zpetChyba('Checklist se nepodařilo založit. Zkuste to prosím znovu.')
  const sablonaId = sablona![0].id as string

  if (radky.length > 0) {
    const polozky = radky.map((r) => {
      const zaklad = {
        template_id: sablonaId,
        position: r.position,
        label: r.label,
        requires_value: r.requires_value,
        value_type: r.value_type,
        value_unit: r.value_unit,
        min_value: r.min_value,
        max_value: r.max_value,
      }
      return plne ? { ...zaklad, section: r.section, instructions: r.instructions, povinna: r.povinna } : zaklad
    })
    const { error: chybaPolozek } = await supabase.from('checklist_items').insert(polozky)
    if (chybaPolozek) {
      // Šablona už existuje, jen bez položek — dá se doplnit v úpravě.
      redirect(`/${rozsah}/ukoly/sablona/${sablonaId}?chyba=${encodeURIComponent('Šablona vznikla, ale položky se nepodařilo uložit. Doplňte je prosím.')}`)
    }
  }

  obnovit(rozsah)
  redirect(`${zakladni(rozsah)}?cl=sablony&ulozeno=1`)
}

/** Úprava existující šablony — přes RPC (verze, vyřazení místo mazání). */
export async function upravitSablonu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const sablonaId = String(formData.get('sablona') ?? '')
  if (!UUID.test(sablonaId)) return

  const z = await zaklad(rozsah)
  if (!z) return

  const zpet = `/${rozsah}/ukoly/sablona/${sablonaId}`
  const nazev = String(formData.get('nazev') ?? '').trim()
  if (nazev === '') redirect(`${zpet}?chyba=${encodeURIComponent('Checklist potřebuje název.')}`)

  const usekRaw = String(formData.get('usek') ?? '').trim()
  const { rozvrh, dny } = rozvrhZFormulare(formData)
  const radky = radkySablony(formData)

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('upravit_sablonu_checklistu', {
    p_tenant: z.tenantId,
    p_sablona: sablonaId,
    p_nazev: nazev,
    p_usek: UUID.test(usekRaw) ? usekRaw : null,
    p_rozvrh: rozvrh,
    p_dny_v_tydnu: dny,
    p_vyzaduje_potvrzeni: formData.get('potvrzeni') === 'on',
    p_aktivni: formData.get('aktivni') === 'on',
    p_polozky: radky.map((r) => ({
      id: r.id,
      position: r.position,
      label: r.label,
      section: r.section,
      instructions: r.instructions,
      povinna: r.povinna,
      requires_value: r.requires_value,
      value_type: r.value_type,
      value_unit: r.value_unit,
      min_value: r.min_value === null ? null : String(r.min_value),
      max_value: r.max_value === null ? null : String(r.max_value),
    })),
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(
      funkceNeexistuje(error) ? 'Úprava šablon bude dostupná po nasazení databáze.' : error.message,
    )}`)
  }

  obnovit(rozsah)
  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=1`)
}
