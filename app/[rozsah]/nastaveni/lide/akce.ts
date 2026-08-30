'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Přidání nebo úprava zaměstnance.
 *
 * Zaměstnanec může být:
 * - s účtem (user_id vyplněné) — přihlášeného člena firmy
 * - bez účtu — brigádník nebo občasná výpomoc
 *
 * Mazání je soft — deleted_at se nastaví, řádek zůstane v DB kvůli
 * návaznosti na docházku.
 */
export async function upravitZamestnance(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = formData.get('id') ? String(formData.get('id')) : null
  const jmeno = String(formData.get('jmeno') ?? '').trim()
  const pozice = formData.get('pozice') ? String(formData.get('pozice')) : null
  const pobocka = formData.get('pobocka') ? String(formData.get('pobocka')) : null
  const typ = String(formData.get('typ') ?? 'hpp')

  if (!jmeno) {
    redirect(`/${rozsah}/nastaveni/lide?chyba=jmeno`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()

  if (id) {
    // Úprava
    const { error } = await supabase
      .from('employees')
      .update({
        full_name: jmeno,
        position_id: pozice,
        branch_id: pobocka,
        employment_type: typ,
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) {
      redirect(`/${rozsah}/nastaveni/lide?chyba=nepovedlo`)
    }
  } else {
    // Přidání
    const { error } = await supabase
      .from('employees')
      .insert({
        tenant_id: tenantId,
        full_name: jmeno,
        position_id: pozice,
        branch_id: pobocka,
        employment_type: typ,
      })

    if (error) {
      redirect(`/${rozsah}/nastaveni/lide?chyba=nepovedlo`)
    }
  }

  revalidatePath(`/${rozsah}/nastaveni/lide`)
  redirect(`/${rozsah}/nastaveni/lide?ulozeno=1`)
}

/**
 * Soft-delete zaměstnance.
 *
 * Bere FormData jako ostatní akce v tomhle souboru, aby šla pověsit
 * rovnou na <form action={…}>. Volat ji z onClick nešlo: stránka je
 * serverová a obsluha události se do prohlížeče nemá jak dostat.
 */
export async function smazatZamestnance(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const rozsah = String(formData.get('rozsah') ?? '')
  if (!id) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') return

  const supabase = await getServerSupabase()
  await supabase
    .from('employees')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  revalidatePath(`/${rozsah}/nastaveni/lide`)
}

/**
 * Zadání hodinové sazby.
 *
 * Zakládá NOVÝ řádek historie, nikdy nepřepisuje starý — sazba je
 * historie, ne údaj u zaměstnance. Zvýšení od 1. října tak nesmí sáhnout
 * na září a oprava překlepu se dělá dalším řádkem se stejným valid_from.
 *
 * O právu rozhoduje public.set_rate: bez payroll.manage vyhodí chybu
 * a zapíše se nic. Kontrola tady je druhá linie, ne jediná.
 *
 * Částka přichází z formuláře v korunách, v databázi jsou haléře.
 */
export async function nastavitSazbu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanec = String(formData.get('zamestnanec') ?? '')
  const korunyRaw = String(formData.get('koruny') ?? '').trim()
  const odKdy = String(formData.get('od') ?? '').trim()
  const poznamka = String(formData.get('poznamka') ?? '').trim()

  if (!zamestnanec || korunyRaw === '' || odKdy === '') {
    redirect(`/${rozsah}/nastaveni/lide?upravuji=${zamestnanec}&chyba=sazba-neuplna`)
  }

  // Čárka i tečka: kdo píše sazbu, píše ji tak, jak je zvyklý.
  const korun = Number(korunyRaw.replace(',', '.'))
  if (!Number.isFinite(korun) || korun < 0) {
    redirect(`/${rozsah}/nastaveni/lide?upravuji=${zamestnanec}&chyba=sazba-cislo`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('set_rate', {
    p_tenant: tenantId,
    p_employee: zamestnanec,
    p_haleru: Math.round(korun * 100),
    p_valid_from: odKdy,
    p_note: poznamka,
  })

  if (error) {
    // 42501 = insufficient_privilege. Funkce ho vyhazuje schválně, když
    // volajícímu chybí payroll.manage.
    const duvod = error.code === '42501' ? 'sazba-pravo' : 'sazba-nepovedlo'
    redirect(`/${rozsah}/nastaveni/lide?upravuji=${zamestnanec}&chyba=${duvod}`)
  }

  revalidatePath(`/${rozsah}/nastaveni/lide`)
  redirect(`/${rozsah}/nastaveni/lide?ulozeno=1`)
}

/**
 * Vystavení pozvánky.
 *
 * Volá public.create_invitation, která je průzor do app schématu.
 * Vrací {token, chyba} — token se zobrazí, chyba se řeší podle kódu.
 */
export async function vystavitPozvankuAction(formData: FormData): Promise<{
  token?: string
  chyba?: string
}> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zamestnanecId = formData.get('zamestnanec')
    ? String(formData.get('zamestnanec'))
    : null
  const email = String(formData.get('email') ?? '').trim()
  const kanal = String(formData.get('kanal') ?? 'email')

  if (!zamestnanecId) {
    return { chyba: 'Vyberte zaměstnance' }
  }

  if (kanal === 'email' && !email) {
    return { chyba: 'Zadejte e-mailovou adresu' }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { chyba: 'Chyba při načítání firmy' }

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') return { chyba: 'Nemáte oprávnění' }

  const supabase = await getServerSupabase()

  // Zjistit ID role — nyní se bere default role zaměstnance
  // Později se bude vybírat v UI. Prozatím řekneme "zaměstnanec"
  const { data: zaměstnanec } = await supabase
    .from('employees')
    .select('id')
    .eq('id', zamestnanecId)
    .eq('tenant_id', tenantId)
    .single()

  if (!zaměstnanec) {
    return { chyba: 'Zaměstnanec nenalezen' }
  }

  // Procházíme přes RPC — public.create_invitation
  const { data, error } = await supabase.rpc('create_invitation', {
    p_tenant: tenantId,
    p_role: null, // Později nastavit na vybranou roli
    p_channel: kanal,
    p_contact: email,
    p_scope: 'branch',
    p_branches: [],
    p_employee: zamestnanecId,
    p_valid_days: 7,
  })

  if (error) {
    console.error('create_invitation error:', error)

    // Chyby z SQL
    if (error.code === '42501') {
      return { chyba: 'Oprávnění zamítnuté (42501)' }
    }
    if (error.code === '23503') {
      return { chyba: 'Zaměstnanec nebo role neexistuje (23503)' }
    }
    if (error.code === '23514') {
      return { chyba: 'Omezení porušeno (23514)' }
    }

    return { chyba: error.message || 'Chyba při vystavení pozvánky' }
  }

  if (!data || data.length === 0) {
    return { chyba: 'Pozvánka nebyla vystavena' }
  }

  // RPC vrací pole řádků [{ invitation_id, token }]
  const { token } = data[0]

  revalidatePath(`/${rozsah}/nastaveni/lide`)

  return { token }
}
