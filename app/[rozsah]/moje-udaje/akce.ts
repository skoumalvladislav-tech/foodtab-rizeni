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
  const rozsah = String(formData.get('rozsah') ?? '')
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
      `/${rozsah}/moje-udaje?chyba=kontakt&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/moje-udaje`)
  redirect(`/${rozsah}/moje-udaje?ulozeno=kontakt`)
}

/**
 * Dobrovolný souhlas.
 *
 * Odvolání se zapisuje jako řádek s `granted = false`, ne smazáním. Ze
 * smazaného řádku by nešlo poznat, jestli člověk souhlas odvolal, nebo
 * ho nikdy neudělil — a v auditu by po odvolání nezůstalo nic.
 */
export async function prepnoutSouhlas(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
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
      `/${rozsah}/moje-udaje?chyba=souhlas&text=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${rozsah}/moje-udaje`)
  redirect(`/${rozsah}/moje-udaje?ulozeno=${udelit ? 'souhlas' : 'odvolani'}`)
}

/**
 * „Beru na vědomí“ — ne „souhlasím“.
 *
 * Informace o zpracování se nepodepisuje, jen sděluje. Zaznamenává se
 * proto jen to, že ji člověk dostal, a KTEROU verzi: až se text změní,
 * musí se ukázat znovu.
 */
export async function vzitNaVedomi(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
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
      `/${rozsah}/moje-udaje?chyba=vedomi&text=${encodeURIComponent(error.message)}`,
    )
  }

  // Přepočítat i rám: podle záznamu se kreslí pruh s informací.
  revalidatePath(`/${rozsah}`, 'layout')
  redirect(`/${rozsah}/moje-udaje?ulozeno=vedomi`)
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
  const rozsah = String(formData.get('rozsah') ?? '')
  const pin = String(formData.get('pin') ?? '')

  const ja = await kdo()
  if (!ja) redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('nastavit_pin', {
    p_tenant: ja.tenantId,
    p_pin: pin,
  })

  if (error) {
    redirect(`/${rozsah}/moje-udaje?chyba=pin&text=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/moje-udaje`)
  redirect(`/${rozsah}/moje-udaje?ulozeno=pin`)
}
