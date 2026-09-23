'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { provozniDen } from '@/lib/provozni-den'
import { DotazSelhal, funkceNeexistuje, sloupecNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Akce úkolů a checklistů.
 *
 * Společné pravidlo: z formuláře se berou jen identifikátory a hodnoty,
 * nikdy ne firma, pobočka ani zaměstnanec. Ty se dohledávají na serveru,
 * aby se nedaly podvrhnout. Vlastní rozhodnutí o právu zůstává na
 * databázi — tyhle funkce jen nesmí poslat nesmysl.
 */

type Zaklad = {
  tenantId: string
  employeeId: string | null
  branchId: string | null
  rozsah: string
}

async function zaklad(rozsah: string): Promise<Zaklad | null> {
  const user = await getUser()
  if (!user) return null

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null

  const ctx = await getContext(tenantId)
  if (!ctx) return null

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return null

  const supabase = await getServerSupabase()
  const { data, error: chybaJa } = await supabase
    .from('employees')
    .select('id, branch_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .limit(1)
  if (chybaJa) throw new DotazSelhal('můj zaměstnanecký záznam', chybaJa)

  const ja = data?.[0] as { id: string; branch_id: string | null } | undefined

  return {
    tenantId,
    employeeId: ja?.id ?? null,
    branchId: scope.branchId ?? ja?.branch_id ?? null,
    rozsah,
  }
}

/**
 * Odškrtnutí úkolu.
 *
 * Jde přes public.complete_task(), ne přes update. Politika tasks_write
 * žádá tasks.manage na jakoukoli změnu úkolu, takže adresát by si vlastní
 * úkol zavřít nemohl. Funkce mění jen status, done_at a done_by a sama
 * rozhodne, kdo na to má — aplikace se neptá dopředu, jen ukáže výsledek.
 */
export async function dokoncitUkol(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const ukolId = String(formData.get('ukol') ?? '')
  if (!ukolId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('complete_task', { p_task: ukolId })

  if (error) {
    // 42501 = insufficient_privilege, P0002 = no_data_found. Obojí funkce
    // vyhazuje schválně; kód je spolehlivější než text hlášky.
    const duvod =
      error.code === '42501'
        ? 'cizi'
        : error.code === 'P0002'
          ? 'chybi'
          : 'nepovedlo'
    redirect(`/${rozsah}/ukoly?ukol=${ukolId}&chyba=${duvod}`)
  }

  revalidatePath(`/${rozsah}/ukoly`)
}

/**
 * Spuštění checklistu na dnešní provozní den.
 *
 * Dvojice (šablona, pobočka, provozní den) je v databázi jedinečná, takže
 * druhé kliknutí nevyrobí druhý běh — konflikt se ignoruje a pokračuje se
 * v tom existujícím (`ignoreDuplicates`). To platí i pro `komu`/`doKdy`:
 * na existující běh se nepřepíšou — kdyby dvě kliknutí odeslala různé
 * hodnoty, vyhrálo by to první, tiše. Změna odpovědnosti u BĚŽÍCÍHO
 * běhu jde přes nastavitOdpovednost níž.
 */
export async function spustitChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const sablonaId = String(formData.get('sablona') ?? '')
  if (!sablonaId) return

  const z = await zaklad(rozsah)
  if (!z || !z.branchId) return

  const den = await provozniDen(z.branchId)
  if (!den) return

  const komu = String(formData.get('komu') ?? '').trim() || null
  const doKdyRaw = String(formData.get('doKdy') ?? '').trim()
  // `datetime-local` nese hodinu na zdi bez pásma — okamžik z ní udělá
  // databáze podle pásma pobočky, stejně jako u termínu úkolu (zadatUkol
  // níž). Sem se posílá jen řetězec, žádný Date() na serveru.
  const doKdy = doKdyRaw === '' ? null : doKdyRaw

  const supabase = await getServerSupabase()
  let { error } = await supabase.from('checklist_runs').upsert(
    {
      tenant_id: z.tenantId,
      branch_id: z.branchId,
      template_id: sablonaId,
      business_date: den,
      assigned_employee_id: komu,
      due_at: doKdy,
    },
    { onConflict: 'template_id,branch_id,business_date', ignoreDuplicates: true },
  )
  // KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE. Dokud 20260923100000 neproběhne,
  // sloupce assigned_employee_id/due_at v databázi ještě nejsou — bez
  // tohohle by „Spustit" přestalo fungovat úplně (ne jen bez odpovědnosti),
  // protože by celý insert spadl na neznámý sloupec.
  if (error && sloupecNeexistuje(error)) {
    ;({ error } = await supabase.from('checklist_runs').upsert(
      { tenant_id: z.tenantId, branch_id: z.branchId, template_id: sablonaId, business_date: den },
      { onConflict: 'template_id,branch_id,business_date', ignoreDuplicates: true },
    ))
  }
  if (error) {
    // 42501 = insufficient_privilege — komu poslaný z formuláře nepatří
    // k firmě (trigger checklist_run_prirazeny_trg). Nesmyslné id ve
    // formuláři je bug na klientu (select se plní ze seznamu firmy),
    // ne uživatelská chyba, ale radši hláška než tiché nic.
    redirect(`/${rozsah}/ukoly?chyba=odpovednost#checklisty`)
  }

  revalidatePath(`/${rozsah}/ukoly`)
}

/**
 * Zápis jedné položky checklistu.
 *
 * Meze a typ hodnoty se čtou z databáze, ne z formuláře — jinak by si je
 * volající mohl přepsat. Když hodnota neprojde, vracíme se zpět na
 * stránku s ?polozka= a ?chyba=, aby se hláška dala vykreslit přímo
 * u dotčené položky. Serverově, bez stavu na straně prohlížeče.
 */
export async function zapsatPolozku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const runId = String(formData.get('beh') ?? '')
  const itemId = String(formData.get('polozka') ?? '')
  const hodnotaRaw = String(formData.get('hodnota') ?? '').trim()
  if (!runId || !itemId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const supabase = await getServerSupabase()

  const { data: polozky, error: chybaPolozky } = await supabase
    .from('checklist_items')
    .select('id, requires_value, value_type, min_value, max_value')
    .eq('id', itemId)
    .limit(1)
  if (chybaPolozky) throw new DotazSelhal('položka checklistu', chybaPolozky)

  const polozka = polozky?.[0] as
    | {
        id: string
        requires_value: boolean
        value_type: string | null
        min_value: number | null
        max_value: number | null
      }
    | undefined
  if (!polozka) return

  let valueNumber: number | null = null
  let valueText: string | null = null

  // Důvod odmítnutí, se kterým se vrátíme zpět na stránku. Vlastní
  // přesměrování je až za tímhle blokem: redirect() vyhazuje výjimku
  // a uvnitř větvení by se hůř četlo, co se kdy stane.
  let chyba: string | null = null

  if (polozka.requires_value) {
    if (hodnotaRaw === '') {
      chyba = 'prazdna'
    } else if (polozka.value_type === 'number') {
      const cislo = Number(hodnotaRaw.replace(',', '.'))
      if (!Number.isFinite(cislo)) {
        chyba = 'cislo'
      } else if (
        (polozka.min_value !== null && cislo < polozka.min_value) ||
        (polozka.max_value !== null && cislo > polozka.max_value)
      ) {
        chyba = 'meze'
      } else {
        valueNumber = cislo
      }
    } else if (polozka.value_type === 'text') {
      valueText = hodnotaRaw
    } else {
      // 'photo' zatím neumíme nahrávat.
      chyba = 'foto'
    }
  }

  if (chyba) {
    redirect(`/${rozsah}/ukoly/${runId}?polozka=${itemId}&chyba=${chyba}`)
  }

  await supabase.from('checklist_entries').upsert(
    {
      run_id: runId,
      item_id: itemId,
      checked: true,
      value_number: valueNumber,
      value_text: valueText,
      employee_id: z.employeeId,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: 'run_id,item_id' },
  )

  revalidatePath(`/${rozsah}/ukoly/${runId}`)
}

/**
 * Uzavření checklistu, když jsou všechny položky hotové.
 *
 * `completed_by` je z. employeeId ze serverové session (zaklad()), ne
 * z formuláře — stejná záruka jako u employee_id v zapsatPolozku výš.
 * Bez zaměstnaneckého záznamu (z.employeeId === null) se zapíše
 * NULL — uzavření samo se nezakáže, jen se historii ztratí „kým“.
 */
export async function uzavritChecklist(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const runId = String(formData.get('beh') ?? '')
  if (!runId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const supabase = await getServerSupabase()
  await supabase
    .from('checklist_runs')
    .update({ status: 'done', finished_at: new Date().toISOString(), completed_by: z.employeeId })
    .eq('id', runId)
    .eq('tenant_id', z.tenantId)

  revalidatePath(`/${rozsah}/ukoly`)
}

/**
 * Změna odpovědnosti (kdo/do kdy) na už běžícím checklistu.
 *
 * Oddělené od spustitChecklist schválně — ten smí zapsat odpovědnost
 * jen jednou, při vzniku běhu (ignoreDuplicates); tohle je jediná
 * cesta, jak ji později změnit nebo smazat (prázdné pole = zrušit).
 */
export async function nastavitOdpovednost(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const runId = String(formData.get('beh') ?? '')
  if (!runId) return

  const z = await zaklad(rozsah)
  if (!z) return

  const komu = String(formData.get('komu') ?? '').trim() || null
  const doKdyRaw = String(formData.get('doKdy') ?? '').trim()
  const doKdy = doKdyRaw === '' ? null : doKdyRaw

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('checklist_runs')
    .update({ assigned_employee_id: komu, due_at: doKdy })
    .eq('id', runId)
    .eq('tenant_id', z.tenantId)
  if (error) {
    redirect(`/${rozsah}/ukoly/${runId}?chyba=odpovednost`)
  }

  revalidatePath(`/${rozsah}/ukoly/${runId}`)
  revalidatePath(`/${rozsah}/ukoly`)
}

/** Kolik čísel typu hodnoty databáze zná — jediné místo, které to říká. */
const TYPY_HODNOTY = ['number', 'text', 'photo'] as const
const ROZVRHY = ['opening', 'closing', 'haccp', 'weekly'] as const

/**
 * Vytvoření nové šablony checklistu i s položkami, jedním odesláním.
 *
 * O právo se nestará tahle funkce — obě tabulky (checklist_templates,
 * checklist_items) mají politiku na `tasks.manage` na dané pobočce a bez
 * něj insert prostě neprojde. Formulář sám navíc obrazovka `nova/page.tsx`
 * nevykreslí tomu, kdo ho nemá — dvě linie, ne jedna.
 *
 * ŘÁDKY POLOŽEK JSOU STATICKY VYKRESLENÉ (`polozka-N-*`), NE PŘIDÁVANÉ
 * SKRIPTEM. Prázdný řádek (bez názvu) se tiše přeskočí — formulář tak
 * funguje i bez JavaScriptu a nikdo nemusí mazat nepoužité řádky.
 *
 * Šablona bez jediné položky je platný, už dřív ošetřený stav
 * (`ukoly/[beh]/page.tsx`: „Checklist nemá žádné položky.“) — nezakazuje
 * se tu, jen by asi nikdo takovou nechtěl.
 */
export async function vytvoritSablonuChecklistu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zaklad(rozsah)
  if (!z || !z.branchId) return

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (nazev === '') {
    redirect(`/${rozsah}/ukoly/sablona/nova?chyba=nazev`)
  }

  const usekRaw = String(formData.get('usek') ?? '').trim()
  const usekId = usekRaw === '' ? null : usekRaw

  const rozvrhRaw = String(formData.get('rozvrh') ?? 'opening')
  const rozvrh = (ROZVRHY as readonly string[]).includes(rozvrhRaw) ? rozvrhRaw : 'opening'

  const pocetRadku = Math.max(0, Math.min(50, Number(formData.get('pocetRadku') ?? 0) || 0))
  const polozky: {
    position: number
    label: string
    requires_value: boolean
    value_type: string | null
    value_unit: string | null
    min_value: number | null
    max_value: number | null
  }[] = []

  for (let i = 0; i < pocetRadku; i++) {
    const label = String(formData.get(`polozka-${i}-nazev`) ?? '').trim()
    if (label === '') continue

    const vyzadujeHodnotu = formData.get(`polozka-${i}-vyzaduje`) === 'on'
    const typRaw = String(formData.get(`polozka-${i}-typ`) ?? 'number')
    const typ = (TYPY_HODNOTY as readonly string[]).includes(typRaw) ? typRaw : 'number'
    const jednotka = String(formData.get(`polozka-${i}-jednotka`) ?? '').trim()
    const minRaw = String(formData.get(`polozka-${i}-min`) ?? '').trim()
    const maxRaw = String(formData.get(`polozka-${i}-max`) ?? '').trim()
    const jeCislo = vyzadujeHodnotu && typ === 'number'

    polozky.push({
      position: i,
      label,
      requires_value: vyzadujeHodnotu,
      value_type: vyzadujeHodnotu ? typ : null,
      value_unit: vyzadujeHodnotu && jednotka !== '' ? jednotka : null,
      min_value: jeCislo && minRaw !== '' ? Number(minRaw.replace(',', '.')) : null,
      max_value: jeCislo && maxRaw !== '' ? Number(maxRaw.replace(',', '.')) : null,
    })
  }

  const supabase = await getServerSupabase()

  const { data: sablona, error: chybaSablony } = await supabase
    .from('checklist_templates')
    .insert({
      tenant_id: z.tenantId,
      branch_id: z.branchId,
      usek_id: usekId,
      name: nazev,
      schedule: rozvrh,
    })
    .select('id')
    .limit(1)
  if (chybaSablony || !sablona?.[0]) {
    redirect(`/${rozsah}/ukoly/sablona/nova?chyba=nepovedlo`)
  }
  const sablonaId = sablona[0].id as string

  if (polozky.length > 0) {
    const { error: chybaPolozek } = await supabase
      .from('checklist_items')
      .insert(polozky.map((p) => ({ ...p, template_id: sablonaId })))
    if (chybaPolozek) {
      // Šablona už existuje, jen se jí nepodařilo dodat položky — necháme
      // ji být (dá se doplnit později) a řekneme to rovnou, ne že se nic
      // nestalo.
      redirect(`/${rozsah}/ukoly?chyba=polozky#checklisty`)
    }
  }

  revalidatePath(`/${rozsah}/ukoly`)
  redirect(`/${rozsah}/ukoly#checklisty`)
}

/**
 * Zadání úkolu.
 *
 * JEDEN CÍL NA ÚKOL. Z formuláře chodí přepínač `komu` a k němu tři
 * možné hodnoty; použije se jen ta, na kterou přepínač ukazuje.
 * Ostatní se schválně zahodí — kdyby se posílaly všechny vyplněné,
 * dal by se odesláním upraveného formuláře poslat úkol dvěma adresátům
 * naráz. Databáze to sice odmítne (`tasks_jeden_cil` a průzor
 * `zadat_ukol`), ale spoléhat na to, že to chytí až poslední linie,
 * není důvod pouštět nesmysl.
 *
 * TERMÍN SE NEPŘEVÁDÍ TADY. `datetime-local` je hodina na zdi bez
 * pásma a přesně tak se posílá dál; okamžik z ní dělá databáze podle
 * pásma pobočky. `new Date('2026-09-07T22:00')` by ten řetězec přečetl
 * v pásmu serveru — a ten je na Vercelu v UTC (pravidlo 11).
 */
export async function zadatUkol(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zaklad(rozsah)
  if (!z) return

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (nazev === '') return

  const komu = String(formData.get('komu') ?? 'pobocka')
  const vybrane = (klic: string): string | null => {
    const v = String(formData.get(klic) ?? '').trim()
    return v === '' ? null : v
  }

  const usek = komu === 'usek' ? vybrane('usek') : null
  const pozice = komu === 'pozice' ? vybrane('pozice') : null
  const clovek = komu === 'clovek' ? vybrane('clovek') : null

  // Přepínač ukazuje na adresáta, ale výběr zůstal prázdný. Radši nic
  // než úkol, který zní na někoho jiného, než kdo ho měl dostat.
  if (komu !== 'pobocka' && usek === null && pozice === null && clovek === null) {
    redirect(`/${rozsah}/ukoly?chyba=bez-adresata`)
  }

  const termin = String(formData.get('termin') ?? '').trim()
  const priorita = String(formData.get('priorita') ?? '') === 'high' ? 'high' : 'normal'

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('zadat_ukol', {
    p_tenant: z.tenantId,
    p_branch: z.branchId,
    p_nazev: nazev,
    p_poznamka: String(formData.get('poznamka') ?? '').trim(),
    // Prázdný řetězec ≠ „teď“. Bez termínu se posílá NULL.
    p_termin: termin === '' ? null : termin,
    p_priorita: priorita,
    p_usek: usek,
    p_pozice: pozice,
    p_clovek: clovek,
  })

  // Hlášku psala databáze a je pro člověka — nepřepisuje se.
  if (error) {
    redirect(`/${rozsah}/ukoly?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/ukoly`)
  redirect(`/${rozsah}/ukoly`)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Nahlásit problém z checklistu — úkol vzniká z položky (nebo z celého
 * běhu, když se problém netýká jedné řádky).
 *
 * JEDEN CÍL NA ÚKOL, stejná úvaha jako `zadatUkol` a `zalozitUkolZeZpravy`
 * ve vzkazech: přepínač `komu` vybírá jen JEDEN ze tří adresátů, ostatní se
 * zahazují — nemá se tam posílat nesmysl, i když poslední slovo má databáze.
 *
 * TERMÍN SE NEPŘEVÁDÍ TADY (pravidlo 11) — den a čas z formuláře jsou hodina
 * na zdi bez pásma a přesně tak se posílají dál; okamžik z nich udělá
 * databáze podle pásma POBOČKY BĚHU (ne podle rozsahu, ve kterém se
 * formulář zrovna otvírá).
 *
 * Pobočka a právo tasks.manage se neposílají — bere je databáze z běhu
 * samotného (public.zalozit_ukol_z_checklistu), ať se nedá podvrhnout jiná
 * pobočka, než odkud checklist je.
 */
export async function zalozitUkolZChecklistu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zaklad(rozsah)
  if (!z) return

  const beh = String(formData.get('beh') ?? '')
  if (!UUID.test(beh)) return

  const polozkaVstup = String(formData.get('polozka') ?? '')
  const polozka = UUID.test(polozkaVstup) ? polozkaVstup : null

  const zpetFormular = `/${rozsah}/ukoly/${beh}/problem${polozka ? `?polozka=${polozka}` : ''}`
  const chyba = (text: string): never =>
    redirect(`${zpetFormular}${polozka ? '&' : '?'}chyba=${encodeURIComponent(text)}`)

  const nazev = String(formData.get('nazev') ?? '').trim().slice(0, 120)
  if (nazev === '') chyba('Název úkolu je povinný.')

  let komu = String(formData.get('komu') ?? 'pobocka')
  const vybrane = (klic: string): string | null => {
    const v = String(formData.get(klic) ?? '').trim()
    return UUID.test(v) ? v : null
  }

  // Vybraný adresát v rozbalovátku platí i bez přepnutí přepínače „Komu“
  // (formulář bez JavaScriptu to za člověka neudělá) — stejná oprava jako
  // u úkolu ze zprávy.
  if (komu === 'pobocka') {
    const zvolene = (['usek', 'pozice', 'clovek'] as const).filter((k) => vybrane(k) !== null)
    if (zvolene.length === 1) komu = zvolene[0]
    else if (zvolene.length > 1) chyba('Vyberte jen jednoho adresáta a přepněte volbu „Komu“.')
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

  const priorita = String(formData.get('priorita') ?? '') === 'high' ? 'high' : 'normal'

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('zalozit_ukol_z_checklistu', {
    p_tenant: z.tenantId,
    p_run: beh,
    p_polozka: polozka,
    p_nazev: nazev,
    p_poznamka: String(formData.get('poznamka') ?? '').trim().slice(0, 1000),
    p_termin: termin,
    p_priorita: priorita,
    p_usek: usek,
    p_pozice: pozice,
    p_clovek: clovek,
  })

  if (error) {
    if (funkceNeexistuje(error)) chyba('Nahlášení problému čeká na nasazení databáze.')
    // Hlášku psala databáze a je pro člověka — nepřepisuje se.
    chyba(error.message)
  }

  revalidatePath(`/${rozsah}/ukoly/${beh}`)
  revalidatePath(`/${rozsah}/ukoly`)
  redirect(`/${rozsah}/ukoly/${beh}`)
}
