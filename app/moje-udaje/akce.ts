'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Moje údaje — zápisy.
 *
 * Všechno tady dělá člověk sám za sebe. Není to správa lidí: kdo si
 * opravuje telefon nebo odvolává souhlas, nepotřebuje k tomu žádné
 * oprávnění kromě toho, že do firmy patří. Proto se tu neověřuje žádné
 * `Permission`, jen členství.
 *
 * A proto se nikde nepředává, KOHO se zápis týká. Vždycky je to
 * přihlášený uživatel; kdyby šlo id poslat z prohlížeče, dalo by se
 * přepsat a odvolat souhlas za někoho jiného.
 */

type Kdo = { tenantId: string; userId: string }

async function kdo(): Promise<Kdo | null> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null

  const user = await getUser()
  if (!user) return null

  // Členství se ověřuje kontextem — kdo do firmy nepatří, nemá tu co
  // zapisovat. Politiky v databázi to drží znovu.
  const ctx = await getContext(tenantId)
  if (!ctx) return null

  return { tenantId, userId: user.id }
}

/** Kontakt. Prázdné pole znamená vymazat. */
export async function ulozitKontakt(formData: FormData): Promise<void> {
  const telefon = String(formData.get('telefon') ?? '')
  const email = String(formData.get('email') ?? '')

  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('set_my_contact', {
    p_tenant: ja.tenantId,
    p_phone: telefon,
    p_email: email,
  })

  if (error) {
    // Hlášku o tvaru telefonu nebo adresy napsala databáze a je pro
    // člověka — projde se dál, ať se nevymýšlí druhá.
    redirect(
      `/moje-udaje?chyba=kontakt&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/moje-udaje`)
  redirect(`/moje-udaje?ulozeno=kontakt`)
}

/**
 * Dobrovolný souhlas.
 *
 * Odvolání se zapisuje jako řádek s `granted = false`, ne smazáním. Ze
 * smazaného řádku by nešlo poznat, jestli člověk souhlas odvolal, nebo
 * ho nikdy neudělil — a v auditu by po odvolání nezůstalo nic.
 */
export async function prepnoutSouhlas(formData: FormData): Promise<void> {
  const druh = String(formData.get('druh') ?? '')
  const udelit = String(formData.get('udelit') ?? '') === 'ano'

  if (!druh) return

  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.from('consents').upsert(
    {
      tenant_id: ja.tenantId,
      user_id: ja.userId,
      kind: druh,
      granted: udelit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,user_id,kind' },
  )

  if (error) {
    redirect(
      `/moje-udaje?chyba=souhlas&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/moje-udaje`)
  redirect(`/moje-udaje?ulozeno=${udelit ? 'souhlas' : 'odvolani'}`)
}

/**
 * „Beru na vědomí“ — ne „souhlasím“.
 *
 * Informace o zpracování se nepodepisuje, jen sděluje. Zaznamenává se
 * proto jen to, že ji člověk dostal, a KTEROU verzi: až se text změní,
 * musí se ukázat znovu.
 */
export async function vzitNaVedomi(formData: FormData): Promise<void> {
  const notice = String(formData.get('notice') ?? '')

  if (!notice) return

  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('privacy_acknowledgements')
    .insert({ tenant_id: ja.tenantId, user_id: ja.userId, notice_id: notice })

  // Druhé kliknutí na totéž je v pořádku, ne chyba (23505 = už tam je).
  if (error && error.code !== '23505') {
    redirect(
      `/moje-udaje?chyba=vedomi&text=${encodeURIComponent(error.message)}`,
    )
  }

  // Přepočítat i rám: podle záznamu se kreslí pruh s informací.
  // Pruh s informací kreslí layout uvnitř rozsahu — ten je jinde než
  // tahle obrazovka, tak se přepočítá celá aplikace, ne jedna adresa.
  revalidatePath('/', 'layout')
  redirect(`/moje-udaje?ulozeno=vedomi`)
}

/**
 * Vlastní PIN ke kiosku.
 *
 * Volí si ho zaměstnanec SÁM a nikdo mu ho nesděluje — proto se odsud
 * neposílá, komu patří. Vždycky přihlášenému.
 *
 * PIN není přihlášení do aplikace. Platí jen na registrovaném tabletu
 * pobočky: čtyři číslice vidí kolega přes rameno, takže samotné nesmí
 * stačit k ničemu.
 */
export async function nastavitPin(formData: FormData): Promise<void> {
  const pin = String(formData.get('pin') ?? '')

  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_pin', {
    p_tenant: ja.tenantId,
    p_pin: pin,
  })

  if (error) {
    redirect(`/moje-udaje?chyba=pin&text=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/moje-udaje`)
  redirect(`/moje-udaje?ulozeno=pin`)
}

/**
 * Chci upozornění i e-mailem?
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 4: kdo chce
 * dostávat co, ať je nastavení u člověka, ne konstanta.
 *
 * ZVONEČEK SE NEVYPÍNÁ a přepínač na něj tady schválně není — je to
 * záznam, ne oznámení. O pushi do mobilu se nepíše, protože nechodí.
 */
export async function prepnoutEmailyUpozorneni(formData: FormData): Promise<void> {
  const chci = String(formData.get('chci') ?? '') === 'ano'

  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()
  // Politika profiles_update_self pustí jen vlastní řádek; sloupcový
  // grant je jen na tenhle jediný sloupec.
  const { error } = await supabase
    .from('profiles')
    .update({ upozorneni_emailem: chci })
    .eq('user_id', ja.userId)

  if (error) {
    redirect(`/moje-udaje?chyba=emaily&text=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/moje-udaje')
  redirect('/moje-udaje?ulozeno=emaily')
}

/**
 * Zrušení vlastního PINu.
 *
 * Zadání docs/pin-prideleni-zadani.md, oddíl 2: „PIN máte nastavený ·
 * Změnit · Zrušit“. Vlastní klíč si člověk zrušit smí — stejně si ho
 * může kdykoli přenastavit. Cizí zůstává na attendance.manage a hlídá
 * to `zrusit_pin`, ne tahle akce.
 */
export async function zrusitMujPin(): Promise<void> {
  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()

  // Vlastní zaměstnanecký záznam. Cizí id se sem nedostane ani omylem:
  // nebere se z formuláře, hledá se podle přihlášeného účtu.
  const { data: muj } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', ja.tenantId)
    .eq('user_id', ja.userId)
    .maybeSingle()

  if (!muj) redirect('/moje-udaje')

  const { error } = await supabase.rpc('zrusit_pin', {
    p_tenant: ja.tenantId,
    p_employee: (muj as { id: string }).id,
  })

  if (error) {
    redirect(`/moje-udaje?chyba=pin&text=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/moje-udaje')
  redirect('/moje-udaje?ulozeno=pin-zrusen')
}
