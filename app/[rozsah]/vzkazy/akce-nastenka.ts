'use server'

import { revalidatePath } from 'next/cache'

import { getUser } from '@/lib/authz'
import { getServerSupabase } from '@/lib/supabase/server'
import { ctenariNastenky } from './nastenka-dotaz'
import { zakladZRozsahu } from './zaklad'

/**
 * Akce Nástěnky.
 *
 * Do 27. 9. bydlely ve složce staré adresy (`app/[rozsah]/zpravy/akce.ts`)
 * a po odeslání obnovovaly `/zpravy`, která jen přesměrovává — nová
 * zpráva se proto na Nástěnce objevila až po ručním obnovení. Adresa
 * `/zpravy` dál přesměrovává, akce žijí tady.
 *
 * Přečtení si eviduje každý sám za sebe — politika announcement_reads_own
 * pustí jen řádek s vlastním `user_id`. Psát oznámení smí jen
 * communication.manage, což hlídá announcements_write; tady se o to
 * nepokoušíme podruhé, jen neposíláme nesmysl.
 */

/** Označení oznámení za přečtené / potvrzené. Druhé kliknutí nic nerozbije. */
export async function oznacitPrectene(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zpravaId = String(formData.get('zprava') ?? '')
  if (!zpravaId) return

  const user = await getUser()
  if (!user) return

  const supabase = await getServerSupabase()
  await supabase.from('announcement_reads').upsert(
    { announcement_id: zpravaId, user_id: user.id },
    { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
  )

  // Číslo u záložky a ve zvonečku je v rámu → celý layout.
  revalidatePath(`/${rozsah}`, 'layout')
}

export type StavOznameni = { ok: true; kdy: number } | { ok: false; chyba: string } | null

/**
 * Nové oznámení.
 *
 * TICHÉ CHYBY UŽ NE (27. 9.). Do té doby akce při chybějícím adresátovi
 * jen skončila a výsledek zápisu do databáze nečetla — formulář „nic
 * neudělal“ a člověk nevěděl proč. Teď každá cesta, která oznámení
 * nezaloží, vrátí českou větu a formulář ji ukáže (text v poli zůstane).
 *
 * Adresát se bere z komu_typ + komu_id_* polí, ne ze scope v adrese:
 * vedoucí celé firmy může z firemní adresy napsat jen jednomu člověku
 * nebo jednomu úseku, ne nutně všem. Scope v adrese se ověřuje jen
 * kvůli autorizaci (bezpecnyRozsah); cíl zprávy volí formulář.
 *
 * Cílové id se před zápisem ověří proti firmě. RLS by cizí id stejně
 * nepustila, ale hláška z insertu by byla nesrozumitelná.
 */
export async function napsatOznameni(_pred: StavOznameni, formData: FormData): Promise<StavOznameni> {
  const z = await zakladZRozsahu(String(formData.get('rozsah') ?? ''))
  if (!z) return { ok: false, chyba: 'Nejste přihlášen(a) nebo sem nemáte přístup.' }

  const text = String(formData.get('text') ?? '').trim()
  const pripnout = String(formData.get('pripnout') ?? '') === 'ano'
  const vyzadatPotvrzeni = String(formData.get('vyzadat_potvrzeni') ?? '') === 'ano'
  const komuTyp = String(formData.get('komu_typ') ?? 'firma')
  if (text === '') return { ok: false, chyba: 'Napište, co mají lidé vědět.' }
  if (text.length > 4000) return { ok: false, chyba: 'Oznámení je moc dlouhé (nejvíc 4000 znaků).' }

  const user = await getUser()
  if (!user) return { ok: false, chyba: 'Nejste přihlášen(a).' }

  const supabase = await getServerSupabase()

  let branchId: string | null = null
  let usekId: string | null = null
  let positionId: string | null = null
  let employeeId: string | null = null

  const komuId = (klic: string) => String(formData.get(klic) ?? '').trim()

  /*
    ROZPOR MEZI „KOMU“ A VYBRANÝM ADRESÁTEM (28. 9.). Formulář posílá
    jen druhý výběr k té volbě, která je zvolená. Když přijde vyplněné
    id JINÉ volby — typicky „Celá firma“ + vybraný člověk — rozešel se
    formulář s tím, co člověk vidí (React ho po chybě vrátil do výchozího
    stavu, viz formular-oznameni.tsx). Poslat to celé firmě by z osobního
    oznámení udělalo veřejné; radši se zeptat znovu.
  */
  const POLE_ADRESATA: Record<string, string> = {
    pobocka: 'komu_id_pobocka',
    usek: 'komu_id_usek',
    pozice: 'komu_id_pozice',
    clovek: 'komu_id_clovek',
  }
  for (const [typ, pole] of Object.entries(POLE_ADRESATA)) {
    if (typ !== komuTyp && komuId(pole) !== '') {
      return { ok: false, chyba: 'Vyberte znovu, komu je oznámení určené.' }
    }
  }

  if (komuTyp === 'firma') {
    // branchId zůstane null → celá firma
  } else if (komuTyp === 'pobocka') {
    const id = komuId('komu_id_pobocka')
    if (!id) return { ok: false, chyba: 'Vyberte pobočku, které je oznámení určené.' }
    const { data } = await supabase.from('branches').select('id').eq('id', id).eq('tenant_id', z.tenantId).maybeSingle()
    if (!data) return { ok: false, chyba: 'Vybraná pobočka ve firmě není.' }
    branchId = id
  } else if (komuTyp === 'usek') {
    const id = komuId('komu_id_usek')
    if (!id) return { ok: false, chyba: 'Vyberte úsek, kterému je oznámení určené.' }
    const { data } = await supabase
      .from('useky')
      .select('id, branch_id')
      .eq('id', id)
      .eq('tenant_id', z.tenantId)
      .maybeSingle()
    if (!data) return { ok: false, chyba: 'Vybraný úsek ve firmě není.' }
    // Úsekové oznámení zdědí branch_id úseku, aby can_read_scoped správně
    // ověřilo přístup k pobočce. Pokud úsek patří celé firmě, branch_id = null.
    branchId = (data as { id: string; branch_id: string | null }).branch_id
    usekId = id
  } else if (komuTyp === 'pozice') {
    const id = komuId('komu_id_pozice')
    if (!id) return { ok: false, chyba: 'Vyberte pozici, které je oznámení určené.' }
    const { data } = await supabase
      .from('positions')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', z.tenantId)
      .eq('active', true)
      .maybeSingle()
    if (!data) return { ok: false, chyba: 'Vybraná pozice ve firmě není.' }
    positionId = id
  } else if (komuTyp === 'clovek') {
    const id = komuId('komu_id_clovek')
    if (!id) return { ok: false, chyba: 'Vyberte člověka, kterému je oznámení určené.' }
    const { data } = await supabase
      .from('employees')
      .select('id, user_id')
      .eq('id', id)
      .eq('tenant_id', z.tenantId)
      .is('deleted_at', null)
      .maybeSingle()
    if (!data) return { ok: false, chyba: 'Vybraný člověk ve firmě není.' }
    // Bez účtu by oznámení nikdy neviděl — Nástěnka se čte jen po přihlášení.
    if (!(data as { user_id: string | null }).user_id) {
      return { ok: false, chyba: 'Tenhle člověk nemá účet ve Foodtabu, oznámení by neuviděl.' }
    }
    // Bez `communication.read` by ho nikdy neviděl (RLS) a od 27. 9. na
    // něj nedostane ani upozornění (T9). Formulář takové lidi nenabízí;
    // tady je to pojistka proti formuláři odeslanému jinak.
    const ctenari = await ctenariNastenky(supabase, z.tenantId, [id])
    if (ctenari.stav === 'chyba') {
      return { ok: false, chyba: 'Oznámení se nepodařilo uložit. Zkuste to prosím znovu.' }
    }
    if (ctenari.stav === 'ok' && !ctenari.ids.has(id)) {
      return { ok: false, chyba: 'Tenhle člověk Nástěnku číst nemůže, oznámení by neuviděl.' }
    }
    employeeId = id
  } else {
    return { ok: false, chyba: 'Vyberte, komu je oznámení určené.' }
  }

  const { error } = await supabase.from('announcements').insert({
    tenant_id: z.tenantId,
    branch_id: branchId,
    usek_id: usekId,
    position_id: positionId,
    employee_id: employeeId,
    body: text,
    pinned: pripnout,
    author_id: user.id,
    requires_acknowledgment: vyzadatPotvrzeni,
  })

  if (error) {
    // 42501 = politika announcements_write odmítla (nemá communication.manage
    // na té pobočce). Ostatní chyby jsou výpadek a dají se zkusit znovu.
    return {
      ok: false,
      chyba:
        error.code === '42501'
          ? 'Na tuhle pobočku oznámení psát nemůžete.'
          : 'Oznámení se nepodařilo uložit. Zkuste to prosím znovu.',
    }
  }

  revalidatePath(`/${z.rozsah}`, 'layout')
  return { ok: true, kdy: Date.now() }
}
