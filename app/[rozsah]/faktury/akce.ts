'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { STAV_KE_SCHVALENI } from '@/lib/faktury-types'

/**
 * Server akce modulu Faktury.
 *
 * Přeneseno z faktury-app (src/app/faktury/actions.ts), STEJNÁ obchodní
 * logika (viz komentáře u jednotlivých funkcí — z velké části doslovně
 * převzaté), ale se dvěma skutečnými změnami:
 *
 * 1. AUTORIZACE. Původní appka žádnou neměla (byla to appka bez
 *    přihlášení). Tady si každá mutující akce ověřuje `faktury.manage`
 *    přes `zkusPristup` — přesně jak to dělá `marketing/akce.ts`
 *    (CLAUDE.md, pravidlo 2 a 3). Bez toho by sloučení do Foodtabu
 *    přineslo jen jiný vzhled na stejně otevřená data.
 *
 * 2. ŽÁDNÝ confirm() V PROHLÍŽEČI. Foodtab tenhle vzor nikde nemá
 *    (např. smazatFotku v marketing/media/akce.ts) — destruktivní akce
 *    je čisté odeslání formuláře, ne JS dialog. Sjednoceno s tím.
 */

async function pripravit(rozsah: string, pravo: 'faktury.read' | 'faktury.manage') {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/faktury`)

  return { supabase: getFakturySupabase() }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

/** Ruční zadání faktury (papírový doklad, platba na místě) — viz `faktury/nova`. */
export async function zalozitFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  const dodavatel = String(formData.get('supplier') ?? '').trim()
  const castkaRaw = String(formData.get('amount') ?? '').replace(',', '.')
  const castka = parseFloat(castkaRaw)

  if (!dodavatel || Number.isNaN(castka)) {
    redirect(`/${rozsah}/faktury/nova?chyba=${encodeURIComponent('Vyplňte dodavatele a částku.')}`)
  }

  const foto = formData.get('fotografie')
  let pdfUrl: string | null = null
  if (foto instanceof File && foto.size > 0) {
    const pripona = foto.name.includes('.') ? foto.name.split('.').pop() : 'jpg'
    const cesta = `rucne-zadane/${Date.now()}-${crypto.randomUUID()}.${pripona}`
    const nahrano = await supabase.storage
      .from('faktury-pdf')
      .upload(cesta, foto, { contentType: foto.type || 'image/jpeg' })
    if (!nahrano.error) {
      pdfUrl = supabase.storage.from('faktury-pdf').getPublicUrl(cesta).data.publicUrl
    }
  }

  const { error } = await supabase.from('invoices').insert({
    received_at: new Date().toISOString(),
    email_sender: null,
    email_subject: 'Ručně zadáno v appce',
    supplier: dodavatel,
    supplier_ico: nepovinnePole(formData, 'supplier_ico'),
    invoice_number: nepovinnePole(formData, 'invoice_number'),
    variable_symbol: nepovinnePole(formData, 'variable_symbol'),
    amount: castka,
    currency: nepovinnePole(formData, 'currency') || 'CZK',
    issue_date: nepovinnePole(formData, 'issue_date'),
    duzp: nepovinnePole(formData, 'duzp'),
    due_date: nepovinnePole(formData, 'due_date'),
    supplier_account: nepovinnePole(formData, 'supplier_account'),
    status: nepovinnePole(formData, 'status') || 'Ke kontrole úhrady',
    needs_review: false,
    onedrive_url: nepovinnePole(formData, 'onedrive_url'),
    pdf_url: pdfUrl,
    is_archived: false,
  })

  if (error) {
    redirect(`/${rozsah}/faktury/nova?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/faktury`)
  redirect(`/${rozsah}/faktury/seznam`)
}

/** Upomínky — poznamená, že se dodavateli ozvalo (telefonem/mailem mimo appku).
 * Nemění stav faktury ani ji nevyřazuje ze seznamu po splatnosti — jen datum
 * se objeví ve sloupci „Upomínka odeslána". */
export async function oznacitUpominkuVyresenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ reminder_sent_at: new Date().toISOString() }).eq('id', id)
  revalidatePath(`/${rozsah}/faktury/upominky`)
  redirect(`/${rozsah}/faktury/upominky`)
}

export async function archivovatFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ is_archived: true }).eq('id', id)
  revalidatePath(`/${rozsah}/faktury/seznam`)
  redirect(`/${rozsah}/faktury/seznam`)
}

export async function obnovitFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ is_archived: false }).eq('id', id)
  revalidatePath(`/${rozsah}/faktury/seznam`)
  redirect(`/${rozsah}/faktury/seznam`)
}

/** Natvrdo smazat. Žádná druhá cesta zpět — appka to neschovává za potvrzovací dialog
 * (Foodtab tenhle vzor nemá), ale ani nic neskrývá: řádek prostě zmizí. */
export async function smazatFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').delete().eq('id', id)
  revalidatePath(`/${rozsah}/faktury/seznam`)
  redirect(`/${rozsah}/faktury/seznam`)
}

/** Potvrzení dokumentu čekajícího na schválení (AI klasifikace si nebyla jistá, člověk
 * potvrdil, že jde o fakturu) — přeřadí do běžného stavu „Ke kontrole úhrady". */
export async function potvrditFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ status: 'Ke kontrole úhrady', review_note: null }).eq('id', id)
  revalidatePath(`/${rozsah}/faktury`)
  redirect(`/${rozsah}/faktury/schvaleni`)
}

/** Odmítnutí dokumentu ve frontě ke schválení BEZ zapamatování (jen smazání) —
 * zjednodušené tlačítko „Není to faktura" vedle podrobnějšího `odmitnoutAZapamatovat`. */
export async function odmitnoutFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').delete().eq('id', id)
  revalidatePath(`/${rozsah}/faktury`)
  redirect(`/${rozsah}/faktury/schvaleni`)
}

/**
 * Označení dokumentu ve frontě ke schválení jako upomínky (výzvy k úhradě) se
 * zapamatováním pro ostatní čekající dokumenty od stejného dodavatele/odesílatele.
 * Na rozdíl od odmítnutí se dokument NEMAŽE ani nearchivuje — upomínka je platný,
 * užitečný dokument (viz `faktury/upominky`), jen jiného typu než faktura.
 */
export async function oznacitJakoUpominku(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  const { data: faktura } = await supabase.from('invoices')
    .select('supplier, email_sender').eq('id', id).maybeSingle()

  await supabase.from('invoices')
    .update({ status: 'Upomínka - zkontrolovat', review_note: null, is_archived: false })
    .eq('id', id)

  const vyrazeno = await najitSouvisejiciFaktury(supabase, id, faktura?.supplier, faktura?.email_sender, STAV_KE_SCHVALENI)
  if (vyrazeno.size > 0) {
    const poznamka = faktura?.supplier
      ? `Automaticky přeřazeno na upomínku – jiný dokument od dodavatele „${faktura.supplier}“ byl právě označen jako upomínka.`
      : `Automaticky přeřazeno na upomínku – jiný dokument od stejného odesílatele byl právě označen jako upomínka.`
    await supabase.from('invoices')
      .update({ status: 'Upomínka - zkontrolovat', review_note: poznamka, is_archived: false })
      .in('id', Array.from(vyrazeno))
  }

  revalidatePath(`/${rozsah}/faktury`)
  redirect(`/${rozsah}/faktury/schvaleni${vyrazeno.size > 0 ? `?prerazeno=${vyrazeno.size}` : ''}`)
}

type DruhOdmitnuti = 'not_invoice' | 'not_supplier'

/** Normalizace jména dodavatele pro porovnání — appka a n8n občas uloží kratší/delší
 * variantu téhož jména (jen obchodní jméno vs. jméno + celá adresa). */
function normalizovatDodavatele(jmeno: string): string {
  return jmeno.trim().toLowerCase()
}

function escapovatIlike(hodnota: string): string {
  return hodnota.replace(/[%_]/g, (ch) => `\\${ch}`)
}

/**
 * Najde ID jiných existujících řádků, které patří ke stejnému dokumentu jako ten,
 * co člověk právě zpracoval — sdílená logika pro vyřazení i přeřazení na upomínku.
 * Nikdy nevyhodí výjimku ven, při chybě dotazu vrátí, co se do té doby našlo.
 *
 * Dvě nezávislé strategie (výsledky se sečtou, bez duplicit): (1) shoda podle
 * dodavatele, tolerantní k tomu, že jeden název je delší varianta druhého,
 * (2) fallback podle odesílatele pro dokumenty bez rozpoznaného dodavatele —
 * nikdy nesáhne na řádek, který dodavatele MÁ, mohla by to být reálná faktura.
 */
async function najitSouvisejiciFaktury(
  supabase: ReturnType<typeof getFakturySupabase>,
  fakturaId: string,
  dodavatel: string | null | undefined,
  odesilatel: string | null | undefined,
  filtrStavu?: string,
): Promise<Set<string>> {
  const nalezene = new Set<string>()
  const jmenoDodavatele = dodavatel?.trim()
  const jmenoOdesilatele = odesilatel?.trim()

  if (jmenoDodavatele) {
    const normalizovane = normalizovatDodavatele(jmenoDodavatele)
    const predpona = escapovatIlike(normalizovane.slice(0, 15))

    let dotaz = supabase.from('invoices').select('id, supplier')
      .neq('id', fakturaId).ilike('supplier', `${predpona}%`)
    if (filtrStavu) dotaz = dotaz.eq('status', filtrStavu)
    const { data, error } = await dotaz

    if (!error) {
      for (const radek of (data ?? []) as { id: string; supplier: string | null }[]) {
        if (!radek.supplier) continue
        const jine = normalizovatDodavatele(radek.supplier)
        if (jine.startsWith(normalizovane) || normalizovane.startsWith(jine)) nalezene.add(radek.id)
      }
    }
  }

  if (!jmenoDodavatele && jmenoOdesilatele) {
    let dotaz = supabase.from('invoices').select('id, supplier')
      .neq('id', fakturaId).ilike('email_sender', escapovatIlike(jmenoOdesilatele))
    if (filtrStavu) dotaz = dotaz.eq('status', filtrStavu)
    const { data, error } = await dotaz

    if (!error) {
      for (const radek of (data ?? []) as { id: string; supplier: string | null }[]) {
        if (!radek.supplier?.trim()) nalezene.add(radek.id)
      }
    }
  }

  return nalezene
}

/** Vyřadí jiné existující faktury od stejného dodavatele/odesílatele po kliknutí
 * „Není faktura — odmítnout a zapamatovat". Nikdy nevyhodí výjimku — volající na
 * tomhle kroku nesmí nikdy selhat. Vrací počet vyřazených řádků. */
async function vyradSouvisejiciFaktury(
  supabase: ReturnType<typeof getFakturySupabase>,
  fakturaId: string,
  dodavatel: string | null | undefined,
  odesilatel: string | null | undefined,
  druh: DruhOdmitnuti,
): Promise<number> {
  const jmenoDodavatele = dodavatel?.trim()
  const jmenoOdesilatele = odesilatel?.trim()
  if (!jmenoDodavatele && !jmenoOdesilatele) return 0

  try {
    const nalezene = await najitSouvisejiciFaktury(supabase, fakturaId, jmenoDodavatele, jmenoOdesilatele)
    if (nalezene.size === 0) return 0
    const ids = Array.from(nalezene)

    const poznamka = druh === 'not_supplier'
      ? `Automaticky vyřazeno – dodavatel „${jmenoDodavatele}“ byl právě označen jako neplatný dodavatel.`
      : jmenoDodavatele
        ? `Automaticky vyřazeno – jiný dokument od dodavatele „${jmenoDodavatele}“ byl právě označen, že to není faktura.`
        : `Automaticky vyřazeno – jiný dokument od stejného odesílatele (${jmenoOdesilatele}) byl právě označen, že to není faktura.`

    const { error } = await supabase.from('invoices')
      .update({ status: 'Odmítnuto', review_note: poznamka, is_archived: true })
      .in('id', ids)

    return error ? 0 : ids.length
  } catch {
    return 0
  }
}

/**
 * Odmítnutí dokumentu ve frontě ke schválení se zapamatováním příkladu pro AI (n8n).
 * Smaže primární řádek a uloží úryvek textu do `rejection_examples`, aby AI příště
 * podobný dokument (podle OBSAHU, ne podle odesílatele — viz zadání, „AI musí
 * rozhodovat podle obsahu přílohy a textu v mailu a ne podle odesílatele") rozpoznala
 * sama. Zápis příkladu je jen „nice to have" — selhání nikdy neblokuje odmítnutí.
 *
 * ⚠️ Zápis do `rejection_examples` dnes tiše selhává — tabulka má RLS zapnuté bez
 * jediné politiky (otevřený bod #1 ze zadání, SQL připravené, čeká na Šéfíka).
 */
export async function odmitnoutAZapamatovat(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const druh = String(formData.get('druh') ?? 'not_invoice') as DruhOdmitnuti
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  const { data: faktura } = await supabase.from('invoices')
    .select('document_text_excerpt, supplier, email_subject, email_sender')
    .eq('id', id).maybeSingle()

  const vyrazeno = await vyradSouvisejiciFaktury(supabase, id, faktura?.supplier, faktura?.email_sender, druh)

  await supabase.from('invoices').delete().eq('id', id)

  const excerpt = (faktura?.document_text_excerpt as string | null)?.trim()
  if (excerpt) {
    await supabase.from('rejection_examples').insert({
      kind: druh,
      excerpt,
      supplier_guess: faktura?.supplier || null,
      email_subject: faktura?.email_subject || null,
    })
  }

  revalidatePath(`/${rozsah}/faktury`)
  redirect(`/${rozsah}/faktury/seznam${vyrazeno > 0 ? `?vyrazeno=${vyrazeno}` : ''}`)
}
