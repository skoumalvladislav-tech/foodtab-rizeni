'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Pozice — čím ten člověk je.
 *
 * Pozice NENÍ oprávnění. Pozice říká, čím je (číšník, kuchař), oprávnění
 * říká, co smí v aplikaci. Brigádník má pozici a žádné oprávnění. Proto
 * to jsou dvě obrazovky a dvě pole, ne jedno.
 *
 * Zakládat a měnit smí jen `people.manage` — pozice se přiřazují lidem
 * a patří k jejich správě.
 */

/** Strojový klíč z názvu. Sloupec `key` má check ^[a-z0-9_]+$. */
function klicZNazvu(nazev: string): string {
  // NFD rozloží „č“ na „c“ + háček; ten háček se pak zahodí podle
  // rozsahu spojovacích znamének U+0300–U+036F. Escapovaný zápis je
  // schválně — literální háčky by v editoru vypadaly jako smetí.
  const DIAKRITIKA = new RegExp("[\u0300-\u036f]", "gu")

  const bezDiakritiky = nazev.normalize("NFD").replace(DIAKRITIKA, "").toLowerCase()
  const orezany = bezDiakritiky.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  // Prázdný klíč check neprojde — název psaný jen emoji nebo azbukou by
  // ho vyrobil. Radši náhradní než pád.
  return orezany === '' ? 'pozice' : orezany.slice(0, 40)
}

export type VysledekPozice =
  | { stav: 'zalozena'; id: string; nazev: string }
  | { stav: 'uz_existuje'; id: string; nazev: string }
  | { stav: 'chyba'; duvod: string }

/**
 * Najdi podle názvu, nebo založ.
 *
 * Rozpoznávací klíč `(tenant_id, lower(btrim(label)))` z oddílu A zadání
 * o nahrávání dat platí i tady: kdo napíše „číšník“ a v databázi je
 * „Číšník“, dostane tu stávající. Nesmí to spadnout na porušení
 * jedinečnosti — proto se nejdřív hledá a chyba 23505 se odchytává
 * i tak, kdyby někdo stihl založit tutéž pozici mezitím.
 *
 * Používá to obrazovka Lidé (volba „+ Nová pozice…“) i správa pozic,
 * ať se obě chovají stejně.
 */
export async function najdiNeboZaloz(
  tenantId: string,
  nazev: string,
): Promise<VysledekPozice> {
  const cisty = nazev.trim()
  if (cisty === '') return { stav: 'chyba', duvod: 'prazdny' }
  if (cisty.length > 60) return { stav: 'chyba', duvod: 'dlouhy' }

  const supabase = await getServerSupabase()

  const najdi = async (): Promise<{ id: string; label: string } | null> => {
    const { data, error: chyba } = await supabase
      .from('positions')
      .select('id, label')
      .eq('tenant_id', tenantId)
    // Tiché prázdno by tady znamenalo, že se pozice nenajde a založí
    // se podruhé — přesně to, čemu má rozpoznávací klíč zabránit.
    if (chyba) throw new DotazSelhal('pozice firmy', chyba)
    const hledane = cisty.toLocaleLowerCase('cs')
    return (
      (data ?? []).find(
        (p) => String(p.label).trim().toLocaleLowerCase('cs') === hledane,
      ) ?? null
    )
  }

  const uz = await najdi()
  if (uz) return { stav: 'uz_existuje', id: uz.id, nazev: uz.label }

  // Klíč musí být jedinečný v rámci firmy. Dva různé názvy můžou dát
  // týž klíč („Číšník“ a „cisnik“), tak se přečísluje.
  const zaklad = klicZNazvu(cisty)
  const { data: klice, error: chybaKlice } = await supabase
    .from('positions')
    .select('key')
    .eq('tenant_id', tenantId)
  if (chybaKlice) throw new DotazSelhal('klíče pozic', chybaKlice)
  const obsazene = new Set((klice ?? []).map((k) => String(k.key)))
  let klic = zaklad
  for (let i = 2; obsazene.has(klic); i++) klic = `${zaklad}_${i}`

  const { data, error } = await supabase
    .from('positions')
    .insert({ tenant_id: tenantId, key: klic, label: cisty })
    .select('id, label')
    .single()

  if (error) {
    // 23505 = porušení jedinečnosti. Někdo byl rychlejší; vezmi jeho.
    if (error.code === '23505') {
      const znovu = await najdi()
      if (znovu) return { stav: 'uz_existuje', id: znovu.id, nazev: znovu.label }
    }
    if (error.code === '42501') return { stav: 'chyba', duvod: 'pravo' }
    return { stav: 'chyba', duvod: 'nepovedlo' }
  }

  return { stav: 'zalozena', id: data.id as string, nazev: data.label as string }
}

/** Založení ze správy pozic. */
export async function zalozitPozici(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const nazev = String(formData.get('nazev') ?? '')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const v = await najdiNeboZaloz(tenantId, nazev)
  revalidatePath(`/${rozsah}/nastaveni/pozice`)

  if (v.stav === 'chyba') {
    redirect(`/${rozsah}/nastaveni/pozice?chyba=${v.duvod}`)
  }
  redirect(
    `/${rozsah}/nastaveni/pozice?stav=${v.stav}&nazev=${encodeURIComponent(v.nazev)}`,
  )
}

/** Přejmenování. Stejná pravidla o shodě názvů jako u zakládání. */
export async function prejmenovatPozici(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('pozice') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  if (!id || nazev === '') {
    redirect(`/${rozsah}/nastaveni/pozice?chyba=prazdny`)
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()

  // Přejmenovat na název, který už jiná pozice má, nejde — spadlo by to
  // na klíči. Radši to řekneme než ať to spadne.
  const { data: vsechny, error: chybaVsechny } = await supabase
    .from('positions')
    .select('id, label')
    .eq('tenant_id', tenantId)
  if (chybaVsechny) throw new DotazSelhal('pozice firmy', chybaVsechny)
  const hledane = nazev.toLocaleLowerCase('cs')
  const koliduje = (vsechny ?? []).find(
    (p) =>
      p.id !== id && String(p.label).trim().toLocaleLowerCase('cs') === hledane,
  )
  if (koliduje) {
    redirect(
      `/${rozsah}/nastaveni/pozice?chyba=kolize&nazev=${encodeURIComponent(nazev)}`,
    )
  }

  const { error } = await supabase
    .from('positions')
    .update({ label: nazev })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(
      `/${rozsah}/nastaveni/pozice?chyba=${error.code === '42501' ? 'pravo' : 'nepovedlo'}`,
    )
  }

  revalidatePath(`/${rozsah}/nastaveni/pozice`)
  redirect(`/${rozsah}/nastaveni/pozice?stav=prejmenovana`)
}

/**
 * Vyřazení z nabídky a vrácení zpět.
 *
 * Pozice se NEMAŽE. U lidí, kteří ji mají, by zmizelo, čím byli —
 * a v rozpisu směn je pozice u každé směny. Vyřazená se jen přestane
 * nabízet u nových: `active = false`.
 */
export async function prepnoutPozici(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('pozice') ?? '')
  const zapnout = String(formData.get('zapnout') ?? '') === 'ano'
  if (!id) return

  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav !== 'ok') redirect('/')

  const supabase = await getServerSupabase()
  const { error } = await supabase
    .from('positions')
    .update({ active: zapnout })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(
      `/${rozsah}/nastaveni/pozice?chyba=${error.code === '42501' ? 'pravo' : 'nepovedlo'}`,
    )
  }

  revalidatePath(`/${rozsah}/nastaveni/pozice`)
  redirect(`/${rozsah}/nastaveni/pozice?stav=${zapnout ? 'vracena' : 'vyrazena'}`)
}
