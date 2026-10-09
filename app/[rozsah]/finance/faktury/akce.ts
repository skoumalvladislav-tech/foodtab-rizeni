'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { pristupKFakturam, type FakturyKlient } from '@/lib/supabase/faktury'
import { STAV_KE_SCHVALENI, STAV_UHRAZENO } from '@/lib/faktury-types'
import { klientUlohy } from '@/lib/supabase/uloha'
import { STAVY_PRO_RUCNI_UHRAZENI, stavPoVraceni } from '@/lib/finance-parovani'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { getServerSupabase } from '@/lib/supabase/server'

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
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/faktury`)

  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') redirect(`/${rozsah}/finance/faktury`)

  return { supabase: pristupFaktury.faktury, tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

/** Ruční zadání faktury (papírový doklad, platba na místě) — viz `faktury/nova`. */
export async function zalozitFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravit(rozsah, 'faktury.manage')

  const dodavatel = String(formData.get('supplier') ?? '').trim()
  const castkaRaw = String(formData.get('amount') ?? '').replace(',', '.')
  const castka = parseFloat(castkaRaw)

  if (!dodavatel || Number.isNaN(castka)) {
    redirect(`/${rozsah}/finance/faktury/nova?chyba=${encodeURIComponent('Vyplňte dodavatele a částku.')}`)
  }

  const foto = formData.get('fotografie')
  let pdfUrl: string | null = null
  if (foto instanceof File && foto.size > 0) {
    const pripona = foto.name.includes('.') ? foto.name.split('.').pop() : 'jpg'
    // Tenant v cestě je jen pro pořádek (lepší přehled v Storage) — izolaci
    // dělá `pristupKFakturam` (databáze Faktur je jednofiremní), ne cesta.
    const cesta = `rucne-zadane/${tenantId}/${Date.now()}-${crypto.randomUUID()}.${pripona}`
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
    redirect(`/${rozsah}/finance/faktury/nova?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/** Upomínky — poznamená, že se dodavateli ozvalo (telefonem/mailem mimo appku).
 * Nemění stav faktury ani ji nevyřazuje ze seznamu po splatnosti — jen datum
 * se objeví ve sloupci „Upomínka odeslána". */
export async function oznacitUpominkuVyresenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ reminder_sent_at: new Date().toISOString() }).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/upominky`)
  redirect(`/${rozsah}/finance/faktury/upominky`)
}

export async function archivovatFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ is_archived: true }).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/seznam`)
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

export async function obnovitFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ is_archived: false }).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/seznam`)
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/**
 * Ručně „Uhrazeno" — zaplaceno mimo výpis (hotově, kartou, z jiného účtu).
 * Šéfík 8. 10. 2026: „…a nebo přesunout ručně". Jen ze SCHVÁLENÝCH stavů
 * (Ke kontrole úhrady, Neuhrazeno, Částečně uhrazeno): neschválený doklad,
 * upomínka nebo nečitelný dokument by se jinak přes „Uhrazeno" a „Vrátit
 * mezi neuhrazené" dostal mezi schválené faktury bez kontroly.
 */
export async function oznacitUhrazenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  // Faktury patří celé firmě — stav úhrady mění jen správce za celou firmu.
  const { supabase } = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')

  const { data } = await supabase.from('invoices').update({ status: STAV_UHRAZENO }).eq('id', id)
    .in('status', [...STAVY_PRO_RUCNI_UHRAZENI]).select('id')
  revalidatePath(`/${rozsah}/finance/faktury`)
  if ((data ?? []).length === 0) {
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Fakturu nejde označit jako uhrazenou — není schválená k úhradě (nejdřív ji schvalte).')}`)
  }
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/**
 * Zpět mezi neuhrazené. Člověk tím říká, že faktura zaplacená NENÍ:
 * AUTOMATICKÁ párování k ní se proto zruší (zamítnutá — automatika je
 * znovu nezaloží). Z ručních párování pak: bez nich → „Ke kontrole úhrady",
 * část → „Částečně uhrazeno", celá → nejde (ruční párování ruší ten, kdo
 * má právo na Platby — jinak by stav neodpovídal penězům). Rozhodnutí je
 * stavPoVraceni v lib/finance-parovani.ts. Párování se čtou a ruší
 * službou (výjimka zapsaná v lib/supabase/uloha.ts): kdo nemá právo na
 * Platby, by je jinak neviděl.
 */
export async function vratitNeuhrazenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  // Ruší i párování plateb (službou) — jen správce Faktur za CELOU firmu.
  const { supabase, tenantId } = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')

  // Když se párování nedají zjistit, radši nic — jinak by se stav
  // přepínal tam a zpátky s každou synchronizací banky.
  const nelze: () => never = () => redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Nepodařilo se ověřit platby k faktuře — zkuste to znovu.')}`)
  const sluzba = klientUlohy()
  if (!sluzba) nelze()
  const { data: faktura } = await supabase.from('invoices').select('amount, status, currency').eq('id', id).maybeSingle()
  const platby = await sluzba.from('platby_faktury').select('id, castka_haleru, zpusob')
    .eq('tenant_id', tenantId).eq('faktura_id', id).eq('stav', 'potvrzeno')
  if (platby.error || !platby.data || !faktura) nelze()
  // Stav se ověří PŘED rušením párování (zrušené párování je natrvalo
  // zamítnuté — nesmí zůstat zamítnuté, když se vrácení stejně neprovede).
  if (faktura.status !== STAV_UHRAZENO) {
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Faktura není ve stavu Uhrazeno — nic se nezměnilo.')}`)
  }
  const radky = platby.data as { id: string; castka_haleru: number; zpusob: string }[]
  const rucne = radky.filter((p) => p.zpusob !== 'automaticky').reduce((s, p) => s + p.castka_haleru, 0)
  // Párování se vede v haléřích (Kč); u faktury v cizí měně se částky
  // porovnat nedají — ruční párování pak rozhodne člověk v Platbách.
  const vKc = ((faktura.currency as string | null) ?? 'CZK').trim().toUpperCase() === 'CZK'
  if (!vKc && rucne > 0) {
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Faktura je v cizí měně a má ručně potvrzenou platbu — párování zkontrolujte ve Financích → Platby.')}`)
  }
  const castka = typeof faktura.amount === 'number' ? Math.round(faktura.amount * 100) : 0
  // Rozhodnout NEJDŘÍV (podle ručních párování) — automatická se ruší, až
  // když je jisté, že vrácení projde; jinak by zůstala zbytečně zamítnutá.
  const cil = stavPoVraceni(rucne, castka)
  if (cil === null) {
    const vidiPlatby = (await zkusPristup(tenantId, 'finance.read', rozsah)).stav === 'ok'
    const zprava = 'Faktura je podle ručně potvrzené platby z výpisu zaplacená celá. Když platba k faktuře nepatří, musí párování zrušit někdo s právem na Finance → Platby.'
    redirect(vidiPlatby
      ? `/${rozsah}/finance/platby?faktura=${encodeURIComponent(id)}&chyba=${encodeURIComponent(zprava)}`
      : `/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(zprava)}`)
  }

  const { data: prihlaseny } = await (await getServerSupabase()).auth.getUser()
  for (const p of radky) {
    if (p.zpusob !== 'automaticky') continue
    const { error } = await sluzba.rpc('zrusit_automaticke_parovani', {
      p_tenant: tenantId, p_alokace: p.id,
      p_duvod: `Ve Fakturách vráceno mezi neuhrazené (uživatel ${prihlaseny.user?.id ?? 'neznámý'}).`,
    })
    if (error) nelze()
  }

  const { data: zmeneno, error: chybaZmeny } = await supabase.from('invoices').update({ status: cil }).eq('id', id).eq('status', STAV_UHRAZENO).select('id')
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (chybaZmeny || (zmeneno ?? []).length === 0) {
    // Automatická párování už jsou zrušená; další klik to dokončí.
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Stav faktury se nepodařilo změnit (mezitím ho mohl změnit někdo jiný) — zkuste to znovu.')}`)
  }
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/** Natvrdo smazat. Žádná druhá cesta zpět — appka to neschovává za potvrzovací dialog
 * (Foodtab tenhle vzor nemá), ale ani nic neskrývá: řádek prostě zmizí. */
export async function smazatFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').delete().eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/seznam`)
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/** Potvrzení dokumentu čekajícího na schválení (AI klasifikace si nebyla jistá, člověk
 * potvrdil, že jde o fakturu) — přeřadí do běžného stavu „Ke kontrole úhrady". */
export async function potvrditFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').update({ status: 'Ke kontrole úhrady', review_note: null }).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/schvaleni`)
}

/** Odmítnutí dokumentu ve frontě ke schválení BEZ zapamatování (jen smazání) —
 * zjednodušené tlačítko „Není to faktura" vedle podrobnějšího `odmitnoutAZapamatovat`. */
export async function odmitnoutFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const { supabase } = await pripravit(rozsah, 'faktury.manage')

  await supabase.from('invoices').delete().eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/schvaleni`)
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

  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/schvaleni${vyrazeno.size > 0 ? `?prerazeno=${vyrazeno.size}` : ''}`)
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
  supabase: FakturyKlient,
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
  supabase: FakturyKlient,
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
 * Zápis do `rejection_examples` byl opraven a živě ověřen 15. 9. 2026 (RLS politika
 * „allow all with anon key", `docs/hlaseni/faktury-rejection-examples-rls-2026-09-15.md`).
 * `rejection_examples` dnes nemá vlastní `tenant_id` (sdílí se napříč zákazníky jako
 * trénovací příklady pro AI, žádná osobní/finanční data, jen úryvek textu) — to je
 * vědomý rozdíl od `invoices`, ne opomenutí.
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

  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/seznam${vyrazeno > 0 ? `?vyrazeno=${vyrazeno}` : ''}`)
}
