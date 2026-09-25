'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getContext } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { naplanovatPushKeZdroji } from '@/lib/komunikace/push-hned'
import { naHalere } from '@/lib/mzdy'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Zálohy — zápisy.
 *
 * Všechno jde přes průzory v databázi (`vyplatit_zalohu`,
 * `stornovat_zalohu`, `potvrdit_moji_zalohu`,
 * `potvrdit_zalohu_za_zamestnance`). Do tabulky `advances` nemá aplikace
 * právo zapisovat přímo: kdyby měla, dal by se cizí zálohu dopsat
 * i potvrdit.
 *
 * Rozhodnutí padá tam, ne tady. Kontrola přístupu na začátku je první
 * obranná linie (pravidlo 3), ne jediná.
 *
 * PUSH HNED (25. 9. 2026): po výplatě a po potvrzení se upozornění
 * (příjemci, vydávajícímu) pošlou na telefon hned po odpovědi, ne až
 * s plánovačem. Zdroj je záloha a její id se bere z odpovědi DATABÁZE,
 * ne z formuláře. Volá se až po kontrole chyby — co se nezapsalo, nemá
 * co posílat.
 */

/**
 * Kam se po zápisu vrací. Od 24. 9. jsou Zálohy záložkou Docházky;
 * stará /zalohy by sice přesměrovala, ale s hláškou v adrese by to byla
 * zbytečná zajížďka navíc — a revalidatePath na starou cestu by
 * obnovil stránku, která už neexistuje.
 */
const adresaZaloh = (rozsah: string) => `/${rozsah}/dochazka/zalohy`

export type StavVyplaceni =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | { stav: 'hotovo'; komu: string; castka: string; varovani: string | null }

export async function vyplatitZalohu(
  _predchozi: StavVyplaceni,
  formData: FormData,
): Promise<StavVyplaceni> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '')
  const castkaText = String(formData.get('castka') ?? '')
  const poznamka = String(formData.get('poznamka') ?? '').trim()

  if (!zamestnanec) return { stav: 'chyba', text: 'Vyberte, komu se záloha vyplácí.' }

  const halere = naHalere(castkaText)
  if (halere === null || halere <= 0) {
    return {
      stav: 'chyba',
      text: 'Částka musí být kladné číslo v korunách, nejvýš na dvě desetinná místa.',
    }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  const pristup = await zkusPristup(tenantId, 'advances.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Na vyplácení záloh nemáte oprávnění.' }
  }

  /*
    Záloha se vydává NA POBOČCE, kde se hotovost podává z ruky do ruky
    (24. 9. 2026) — ne na domovské pobočce toho člověka. Jinak nešlo
    vyplatit nikomu bez domovské pobočky a zaskakujícímu se záloha
    zaúčtovala jinam (a vedoucí s právem jen na téhle pobočce ji
    nevyplatil vůbec). Pobočka se bere z rozsahu ověřeného na serveru,
    ne z formuláře; právo na ní hlídá znovu databáze.
  */
  const pobocka = pristup.scope.branchId
  if (!pobocka) {
    return {
      stav: 'chyba',
      text: 'Zálohu vydáváte na konkrétní pobočce — přepněte se nahoře na ni.',
    }
  }

  const supabase = await getServerSupabase()
  let { data, error } = await supabase.rpc('vyplatit_zalohu', {
    p_tenant: tenantId,
    p_employee: zamestnanec,
    p_castka: halere,
    p_poznamka: poznamka,
    p_branch: pobocka,
  })
  // Do nasazení migrace 20260924120000 databáze pobočku výdeje nezná —
  // pak jako dřív (domovská pobočka).
  if (error && funkceNeexistuje(error)) {
    ;({ data, error } = await supabase.rpc('vyplatit_zalohu', {
      p_tenant: tenantId,
      p_employee: zamestnanec,
      p_castka: halere,
      p_poznamka: poznamka,
    }))
  }

  // Hlášku psala databáze a je pro člověka — projde se dál, ať se
  // nevymýšlí druhá.
  if (error) return { stav: 'chyba', text: error.message }

  const r = (data as { zaloha: string; varovani: string | null }[])?.[0]
  if (!r?.zaloha) return { stav: 'chyba', text: 'Záloha se nezapsala.' }

  // Příjemci na telefon hned — „máte zálohu k potvrzení".
  naplanovatPushKeZdroji({ typ: 'zaloha', id: r.zaloha }, tenantId)

  const { data: kdo } = await supabase
    .from('employees')
    .select('full_name')
    .eq('id', zamestnanec)
    .maybeSingle()

  revalidatePath(adresaZaloh(rozsah))

  return {
    stav: 'hotovo',
    komu: kdo?.full_name ?? 'zaměstnanci',
    castka: castkaText.trim(),
    varovani: r.varovani,
  }
}

export async function stornovatZalohu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zaloha = String(formData.get('zaloha') ?? '')
  const duvod = String(formData.get('duvod') ?? '').trim()

  const zpet = adresaZaloh(rozsah)
  if (!zaloha) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'advances.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('stornovat_zalohu', {
    p_tenant: tenantId,
    p_zaloha: zaloha,
    p_duvod: duvod,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=storno`)
}

/**
 * Příjemce potvrdí ve svém telefonu, že zálohu dostal (25. 9. 2026).
 *
 * Volá se z karty na Docházce. ČÍ záloha to je, rozhoduje databáze
 * (`potvrdit_moji_zalohu`: jen vlastní, nepotvrzená, nestornovaná, téhle
 * firmy) — id z formuláře je jen návrh. Kdo si ho podvrhne, dostane
 * od databáze „Takovou zálohu tu nemáte". Tady se hlídá jen, že je
 * přihlášený ve firmě.
 *
 * Výsledek jde do adresy Docházky jako `zaloha=…`, ne `chyba=…`: tu už
 * Docházka používá pro ruční zápis a píchnutí.
 */
export async function potvrditMojiZalohu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zaloha = String(formData.get('zaloha') ?? '')

  const zpet = `/${rozsah}/dochazka`
  if (!zaloha) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('potvrdit_moji_zalohu', {
    p_tenant: tenantId,
    p_zaloha: zaloha,
  })

  if (error) {
    const duvod = funkceNeexistuje(error)
      ? 'Potvrzení v telefonu čeká na nasazení databáze. Zatím zálohu potvrďte PINem na tabletu.'
      : error.message
    redirect(`${zpet}?zaloha=chyba&duvod=${encodeURIComponent(duvod)}`)
  }

  // Vydávajícímu na telefon hned — „záloha je potvrzená".
  naplanovatPushKeZdroji({ typ: 'zaloha', id: String(data) }, tenantId)

  revalidatePath(zpet)
  redirect(`${zpet}?zaloha=potvrzena`)
}

/**
 * Majitel potvrdí zálohu za zaměstnance (25. 9. 2026: „já jako majitel
 * potřebuji umět potvrdit zálohu každému zaměstnanci").
 *
 * Jen MAJITEL — ne `advances.manage`: kdo zálohy vydává, si je nesmí
 * sám potvrzovat. První linie je `jeMajitel` z kontextu (databáze,
 * `employees.je_majitel`); o zápisu rozhoduje znovu `app.is_owner`
 * v `potvrdit_zalohu_za_zamestnance` (pravidlo 2 a 3).
 */
export async function potvrditZaZamestnance(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zaloha = String(formData.get('zaloha') ?? '')

  const zpet = adresaZaloh(rozsah)
  if (!zaloha) redirect(zpet)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const ctx = await getContext(tenantId)
  if (!ctx?.jeMajitel) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Potvrdit zálohu za zaměstnance smí jen majitel.')}`)
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('potvrdit_zalohu_za_zamestnance', {
    p_tenant: tenantId,
    p_zaloha: zaloha,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  // Vydávajícímu a zaměstnanci na telefon hned.
  naplanovatPushKeZdroji({ typ: 'zaloha', id: String(data) }, tenantId)

  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=potvrzeno`)
}

/**
 * Pozastavení výplaty záloh — u člověka, nebo za celou firmu.
 *
 * Prázdný zaměstnanec znamená celou firmu. O právu rozhoduje
 * `public.pozastavit_zalohy`: smí jen payroll.manage, schválně ne ten,
 * kdo zálohy vyplácí. Kontrola tady je první linie, ne jediná.
 */
export async function prepnoutPozastaveni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '').trim() || null
  const pozastavit = String(formData.get('pozastavit') ?? '') === '1'

  const zpet = adresaZaloh(rozsah)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('pozastavit_zalohy', {
    p_tenant: tenantId,
    p_employee: zamestnanec,
    p_pozastavit: pozastavit,
  })

  // Hlášku píše databáze a je pro člověka: „Pozastavit zálohy smí jen
  // ten, kdo spravuje mzdy.“ Projde se dál.
  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  // I obrazovka výdělku — zaměstnanec svůj stav vidí u sebe.
  revalidatePath('/', 'layout')
  redirect(`${zpet}?ulozeno=${pozastavit ? 'pozastaveno' : 'povoleno'}`)
}

/**
 * Volba, jak se zálohy ukazují zaměstnancům.
 *
 * Mění JEN zobrazení, nikdy uložené záznamy — přepnutí tedy nic
 * nepřepočítává a projeví se hned i zpětně. Do auditu jde v databázi.
 */
export async function ulozitNastaveniZaloh(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const volba = String(formData.get('zobrazeni') ?? 'odecitat')
  const mezText = String(formData.get('mez') ?? '').trim()

  const zpet = adresaZaloh(rozsah)

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'settings.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  // Prázdná mez znamená „firma žádnou nestanovila“, ne nulu.
  const mez = mezText === '' ? null : naHalere(mezText)
  if (mezText !== '' && (mez === null || mez <= 0)) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Horní mez musí být kladné číslo, nebo prázdná.')}`)
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_zalohy_zobrazeni', {
    p_tenant: tenantId,
    p_volba: volba,
    p_max_haleru: mez,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  // I obrazovka výdělku — volba mění, co na ní zaměstnanec uvidí.
  revalidatePath('/', 'layout')
  redirect(`${zpet}?ulozeno=nastaveni`)
}
