'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { zakladZRozsahu } from '../../zaklad'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Vytvořit úkol ze zprávy.
 *
 * Úkol vzniká z NÁVRHU, který člověk viděl a potvrdil: název, poznámku,
 * termín i adresáta posílá formulář. Žádný text ze zprávy se tu znovu
 * nečte a žádný model se nevolá.
 *
 * JEDEN CÍL NA ÚKOL (stejně jako `zadatUkol`): z formuláře chodí přepínač
 * `komu` a k němu tři možné výběry; použije se jen ten, na který přepínač
 * ukazuje. Ostatní se zahodí — odesláním upraveného formuláře se nemá dát
 * úkol poslat dvěma adresátům naráz. Databáze to odmítne taky (`tasks_jeden_cil`),
 * ale nemá se tam posílat nesmysl.
 *
 * TERMÍN SE NEPŘEVÁDÍ TADY. Den a čas z formuláře jsou hodina na zdi bez
 * pásma a přesně tak se posílají dál; okamžik z ní dělá databáze podle
 * pásma pobočky. `new Date('2026-09-25T12:00')` by ten řetězec přečetl
 * v pásmu serveru — na Vercelu v UTC (pravidlo 11). Den bez času platí do
 * konce dne (23:59): „do pátku“ znamená celý pátek.
 *
 * Práva (`tasks.manage`), účastnictví v rozhovoru a firma adresáta se
 * ověřují v databázi (`zalozit_ukol_ze_zpravy`) — tahle akce je první
 * linie, ne jediná.
 */
export async function zalozitUkolZeZpravy(formData: FormData): Promise<void> {
  const z = await zakladZRozsahu(String(formData.get('rozsah') ?? ''))
  if (!z) return

  const konverzace = String(formData.get('konverzace') ?? '')
  const zprava = String(formData.get('zprava') ?? '')
  if (!UUID.test(konverzace) || !UUID.test(zprava)) return

  const zpetFormular = `/${z.rozsah}/vzkazy/${konverzace}/ukol?zprava=${zprava}`
  const chyba = (text: string): never =>
    redirect(`${zpetFormular}&chyba=${encodeURIComponent(text)}`)

  const nazev = String(formData.get('nazev') ?? '').trim().slice(0, 120)
  if (nazev === '') chyba('Název úkolu je povinný.')

  let komu = String(formData.get('komu') ?? 'pobocka')
  const vybrane = (klic: string): string | null => {
    const v = String(formData.get(klic) ?? '').trim()
    return UUID.test(v) ? v : null
  }

  // Člověk vybral adresáta v rozbalovátku a nepřepnul přepínač „Komu“ (formulář
  // bez JavaScriptu to za něj neudělá). Jeden vybraný adresát se použije — úkol
  // by jinak tiše skončil u celé pobočky. Víc vybraných adresátů bez přepnutí
  // se nehádá: chyba.
  if (komu === 'pobocka') {
    const zvolene = (['usek', 'pozice', 'clovek'] as const).filter((k) => vybrane(k) !== null)
    if (zvolene.length === 1) komu = zvolene[0]
    else if (zvolene.length > 1) chyba('Vyberte jen jednoho adresáta a přepněte volbu „Komu“.')
  }
  const usek = komu === 'usek' ? vybrane('usek') : null
  const pozice = komu === 'pozice' ? vybrane('pozice') : null
  const clovek = komu === 'clovek' ? vybrane('clovek') : null

  // Přepínač ukazuje na adresáta, ale výběr zůstal prázdný: radši nic než
  // úkol, který zní na někoho jiného, než kdo ho měl dostat.
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
  const { data, error } = await supabase.rpc('zalozit_ukol_ze_zpravy', {
    p_tenant: z.tenantId,
    p_zprava: zprava,
    p_branch: z.branchId,
    p_nazev: nazev,
    p_poznamka: String(formData.get('poznamka') ?? '').trim().slice(0, 1000),
    p_termin: termin,
    p_priorita: priorita,
    p_usek: usek,
    p_pozice: pozice,
    p_clovek: clovek,
  })

  if (error) {
    // Kód se nasazuje dřív než migrace: řekne se to srozumitelně.
    if (funkceNeexistuje(error)) chyba('Úkoly ze zpráv čekají na nasazení databáze.')
    // Hlášku psala databáze a je pro člověka — nepřepisuje se.
    chyba(error.message)
  }

  revalidatePath(`/${z.rozsah}/vzkazy/${konverzace}`)
  revalidatePath(`/${z.rozsah}/ukoly`)
  redirect(`/${z.rozsah}/vzkazy/${konverzace}?ukol=${String(data)}`)
}
