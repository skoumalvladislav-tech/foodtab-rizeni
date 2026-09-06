'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getContext, getUser } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Akce obrazovky Rozhovory.
 *
 * VŠECHNO JDE PŘES PRŮZORY, ne přes tabulky. Přímý zápis do
 * `konverzace`, `konverzace_ucastnici` a `konverzace_zpravy` je pro
 * `authenticated` odepřený (20260903100000) — a je to schválně:
 * kdyby se psalo přímo, dopsal by si kdokoli zprávu cizím jménem,
 * označil cizí konverzaci za přečtenou a hlavně obešel kontrolu práva
 * na naléhavost. `supabase.from('konverzace_zpravy').insert(...)` by
 * tady spadl na 42501, ne prošel.
 *
 * Firmu ani pobočku nebereme z formuláře. Rozsah se čte z adresy a
 * ověřuje proti členství (`bezpecnyRozsah`, pravidlo 4); kdyby si
 * úroveň volil prohlížeč, dal by se rozsah obejít přepsáním jednoho
 * čísla.
 */

type Zaklad = {
  tenantId: string
  rozsah: string
  branchId: string | null
}

/** Společný začátek každé akce. Vrací null, když cokoli nesedí. */
async function zaklad(formData: FormData): Promise<Zaklad | null> {
  const rozsah = String(formData.get('rozsah') ?? '')

  const user = await getUser()
  if (!user) return null
  const tenantId = await getCurrentTenantId()
  if (!tenantId) return null
  const ctx = await getContext(tenantId)
  if (!ctx) return null
  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) return null

  return { tenantId, rozsah, branchId: scope.branchId }
}

/**
 * Otevřít kanál pobočky.
 *
 * Nezakládá ho tahle akce — jen si o něj řekne. Když ještě neexistuje,
 * vyrobí ho `public.kanal_pobocky`, a to jen tomu, kdo na pobočku
 * dosáhne. Účastníci se nikam nezapisují: členství v kanálu je průmět
 * přiřazení k pobočce, ne seznam.
 */
export async function otevritKanalPobocky(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z || !z.branchId) return

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('kanal_pobocky', {
    p_tenant: z.tenantId,
    p_branch: z.branchId,
  })

  // Hlášku psala databáze a je pro člověka — nepřepisuje se.
  if (error) {
    redirect(
      `/${z.rozsah}/rozhovory?chyba=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${z.rozsah}/rozhovory`)
  redirect(`/${z.rozsah}/rozhovory/${String(data)}`)
}

/**
 * Odeslat zprávu do rozhovoru.
 *
 * `nalehava` se posílá jako přání, ne jako fakt. Jestli ho databáze
 * splní, rozhoduje právo `communication.urgent` — a když ho člověk
 * nemá, vrátí se chyba místo tichého odeslání obyčejné zprávy.
 * Tiché „skoro splněno“ by bylo horší: odesílatel by si myslel, že
 * zpráva dorazí hned, a ona by čekala na píchnutí.
 */
export async function poslatZpravu(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const konverzace = String(formData.get('konverzace') ?? '')
  const text = String(formData.get('text') ?? '').trim()
  const nalehava = String(formData.get('nalehava') ?? '') === 'ano'
  if (konverzace === '' || text === '') return

  const zpet = `/${z.rozsah}/rozhovory/${konverzace}`

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('poslat_zpravu', {
    p_konverzace: konverzace,
    p_text: text,
    p_nalehava: nalehava,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(zpet)
}

/**
 * Označit rozhovor za přečtený.
 *
 * Na kliknutí, ne při vykreslení. Zápis do databáze jen proto, že si
 * někdo otevřel stránku, je vedlejší účinek, který do vykreslování
 * nepatří — a u rozhovorů navíc: „přečteno“ je údaj o člověku, ne
 * o tom, že se načetlo HTML.
 */
export async function oznacitPrecteno(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const konverzace = String(formData.get('konverzace') ?? '')
  if (konverzace === '') return

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('oznacit_precteno', {
    p_konverzace: konverzace,
  })
  if (error) {
    redirect(
      `/${z.rozsah}/rozhovory/${konverzace}?chyba=${encodeURIComponent(error.message)}`,
    )
  }

  // Odznak s nepřečtenými je v rámu, takže se překresluje i layout.
  revalidatePath(`/${z.rozsah}`, 'layout')
  redirect(`/${z.rozsah}/rozhovory/${konverzace}`)
}

/**
 * Stáhnout vlastní zprávu.
 *
 * Mazání je STORNO, ne výmaz (pravidlo 9). Řádek zůstane a je vidět,
 * že ho někdo stáhl — zpráva, která zmizí beze stopy, je v pracovním
 * nástroji horší než zpráva se škrtnutím.
 */
export async function stornovatZpravu(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const zprava = String(formData.get('zprava') ?? '')
  const konverzace = String(formData.get('konverzace') ?? '')
  if (zprava === '' || konverzace === '') return

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('stornovat_zpravu', { p_zprava: zprava })

  const zpet = `/${z.rozsah}/rozhovory/${konverzace}`
  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(zpet)
}
