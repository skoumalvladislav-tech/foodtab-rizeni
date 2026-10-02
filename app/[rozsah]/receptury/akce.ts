'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser, hasAccess } from '@/lib/authz'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { UUID, zakladZRozsahu } from './zaklad'

/**
 * Akce receptur.
 *
 * Založení zapisuje přímo do recipes/recipe_ingredients — totéž, co
 * dovolí RLS politika (recipes_write/recipe_ingredients_write,
 * 20260823130000_provoz.sql:543-559), žádná výsada navíc.
 *
 * Úprava jde přes RPC (public.upravit_recepturu,
 * 20261002110000_receptury_api.sql) — recepturu i celý seznam surovin
 * přepíše v JEDNÉ transakci (smazat staré, vložit nové), což dvěma
 * samostatnými voláními supabase-js (DELETE + INSERT) zaručit nejde.
 * Bezpečné je to jen proto, že recipe_ingredients.id nemá historii
 * běhů ani cizí klíč odjinud (ověřeno gentepem přes celý repozitář).
 */

const zakladniCesta = (rozsah: string) => `/${rozsah}/receptury`
const naDetail = (rozsah: string, recept: string) => `/${rozsah}/receptury/${recept}`

function obnovit(rozsah: string, recept?: string) {
  revalidatePath(zakladniCesta(rozsah), 'layout')
  if (recept) revalidatePath(naDetail(rozsah, recept), 'layout')
}

const MAX_RADKU = 80

type RadekFormulare = {
  id: string | null
  position: number
  name: string
  ingredientId: string | null
  amount: number
  unit: string
  note: string
}

/** Řádky surovin z formuláře v pořadí vykreslení; bez názvu se přeskočí. */
function radkySurovin(formData: FormData): RadekFormulare[] {
  const pocet = Math.max(0, Math.min(MAX_RADKU, Number(formData.get('pocetRadku') ?? 0) || 0))
  const radky: RadekFormulare[] = []
  for (let i = 0; i < pocet; i++) {
    const nazev = String(formData.get(`polozka-${i}-nazev`) ?? '').trim().slice(0, 200)
    if (nazev === '') continue
    const idRaw = String(formData.get(`polozka-${i}-id`) ?? '')
    const surovinaRaw = String(formData.get(`polozka-${i}-surovina`) ?? '').trim()
    const mnozstviRaw = String(formData.get(`polozka-${i}-mnozstvi`) ?? '').trim().replace(',', '.')
    const mnozstvi = Number.isFinite(Number(mnozstviRaw)) ? Number(mnozstviRaw) : 0
    const jednotka = String(formData.get(`polozka-${i}-jednotka`) ?? '').trim().slice(0, 20) || 'g'
    radky.push({
      id: UUID.test(idRaw) ? idRaw : null,
      position: radky.length + 1,
      name: nazev,
      ingredientId: UUID.test(surovinaRaw) ? surovinaRaw : null,
      amount: Math.max(0, mnozstvi),
      unit: jednotka,
      note: String(formData.get(`polozka-${i}-poznamka`) ?? '').trim().slice(0, 500),
    })
  }
  return radky
}

function porceZFormulare(formData: FormData): number {
  const raw = Number(formData.get('porce') ?? 1)
  if (!Number.isFinite(raw)) return 1
  return Math.max(1, Math.min(999, Math.round(raw)))
}

/**
 * Založení nové receptury i se surovinami. Právo drží politika
 * recipes_write/recipe_ingredients_write (recipes.manage na rozsahu);
 * stránka bez něj formulář ani neukáže, kontrola tady je druhá linie
 * (shodně se suroviny/akce.ts), ne jediná.
 */
export async function vytvoritRecepturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const z = await zakladZRozsahu(rozsah)
  if (!z) return

  const zpetChyba = (text: string): never =>
    redirect(`/${rozsah}/receptury/novy?chyba=${encodeURIComponent(text)}`)

  if (!(await hasAccess(z.tenantId, 'recipes.manage', z.branchId))) {
    zpetChyba('Na založení receptury vaše oprávnění nedosáhne.')
  }

  const nazev = String(formData.get('nazev') ?? '').trim().slice(0, 200)
  if (nazev === '') zpetChyba('Receptura potřebuje název.')

  const kategorie = String(formData.get('kategorie') ?? '').trim().slice(0, 100)
  const instrukce = String(formData.get('instrukce') ?? '').trim().slice(0, 5000)
  const porce = porceZFormulare(formData)
  const radky = radkySurovin(formData)

  const user = await getUser()
  const supabase = await getServerSupabase()

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      tenant_id: z.tenantId,
      branch_id: z.branchId,
      name: nazev,
      category: kategorie,
      portions: porce,
      instructions: instrukce,
      created_by: user?.id ?? null,
    })
    .select('id')
    .limit(1)
  if (error || !data?.[0]) zpetChyba('Recepturu se nepodařilo založit. Zkuste to prosím znovu.')
  const receptId = data![0].id as string

  if (radky.length > 0) {
    const { error: chybaSurovin } = await supabase.from('recipe_ingredients').insert(
      radky.map((r) => ({
        recipe_id: receptId,
        position: r.position,
        name: r.name,
        ingredient_id: r.ingredientId,
        amount: r.amount,
        unit: r.unit,
        note: r.note,
      })),
    )
    if (chybaSurovin) {
      // Receptura vznikla, jen bez surovin — dá se doplnit v úpravě.
      redirect(
        `${naDetail(rozsah, receptId)}?chyba=${encodeURIComponent(
          'Receptura vznikla, ale suroviny se nepodařilo uložit. Doplňte je prosím.',
        )}`,
      )
    }
  }

  obnovit(rozsah)
  redirect(`${naDetail(rozsah, receptId)}?ulozeno=1`)
}

/** Úprava existující receptury — přes RPC (recept i suroviny naráz, v jedné transakci). */
export async function upravitRecepturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const receptId = String(formData.get('recept') ?? '')
  if (!UUID.test(receptId)) return

  const z = await zakladZRozsahu(rozsah)
  if (!z) return

  const zpet = naDetail(rozsah, receptId)

  if (!(await hasAccess(z.tenantId, 'recipes.manage', z.branchId))) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Na úpravu receptury vaše oprávnění nedosáhne.')}`)
  }

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (nazev === '') redirect(`${zpet}?chyba=${encodeURIComponent('Receptura potřebuje název.')}`)

  const kategorie = String(formData.get('kategorie') ?? '').trim()
  const instrukce = String(formData.get('instrukce') ?? '').trim()
  const porce = porceZFormulare(formData)
  const radky = radkySurovin(formData)

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('upravit_recepturu', {
    p_tenant: z.tenantId,
    p_recept: receptId,
    p_nazev: nazev,
    p_kategorie: kategorie,
    p_porce: porce,
    p_instrukce: instrukce,
    p_aktivni: formData.get('aktivni') === 'on',
    p_polozky: radky.map((r) => ({
      position: r.position,
      name: r.name,
      ingredient_id: r.ingredientId,
      amount: r.amount,
      unit: r.unit,
      note: r.note,
    })),
  })

  if (error) {
    redirect(
      `${zpet}?chyba=${encodeURIComponent(
        funkceNeexistuje(error) ? 'Úprava receptur bude dostupná po nasazení databáze.' : error.message,
      )}`,
    )
  }

  obnovit(rozsah, receptId)
  revalidatePath(zpet)
  redirect(`${zpet}?ulozeno=1`)
}
