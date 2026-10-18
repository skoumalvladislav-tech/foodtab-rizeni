'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { fakturyFirmy, pristupKFakturam, type PristupKFakturam } from '@/lib/faktury-pristup'
import { halereZFormulare } from '@/lib/faktury-sloupce'
import { typPrilohy, MAX_VELIKOST_PRILOHY } from '@/lib/faktury-prevod'
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
 * převzaté), ale se skutečnými změnami:
 *
 * 1. AUTORIZACE. Původní appka žádnou neměla (byla to appka bez
 *    přihlášení). Tady si každá mutující akce ověřuje `faktury.manage`
 *    přes `zkusPristup` — přesně jak to dělá `marketing/akce.ts`
 *    (CLAUDE.md, pravidlo 2 a 3).
 *
 * 2. ŽÁDNÝ confirm() V PROHLÍŽEČI. Foodtab tenhle vzor nikde nemá —
 *    destruktivní akce je čisté odeslání formuláře, ne JS dialog.
 *
 * 3. OD 18. 10. 2026 JEDNA DATABÁZE (docs/faktury-slouceni-navrh.md).
 *    Faktury jsou `public.faktury` v hlavní databázi: zapisuje se klientem
 *    PŘIHLÁŠENÉHO (RLS: faktury.manage za celou firmu), každý dotaz
 *    s `tenant_id` firmy ze serveru. Fakturu s párováním plateb databáze
 *    smazat nedovolí (cizí klíč) — appka to řekne větou.
 */

type OtevreneFaktury = Extract<PristupKFakturam, { stav: 'ok' }>

async function pripravit(rozsah: string, pravo: 'faktury.read' | 'faktury.manage'): Promise<OtevreneFaktury> {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  // Právo VŽDY za celou firmu, ne za rozsah z formuláře: faktury pobočku
  // nemají, takže „faktury.manage na Bernard Baru“ by jinak pustilo
  // vedoucího jedné pobočky k fakturám celé firmy (kontrola 13. 10. 2026).
  // `rozsah` zůstává jen pro návratovou adresu.
  const pristup = await zkusPristup(tenantId, pravo, TENANT_SCOPE_SEGMENT)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/faktury`)

  // Faktury zavřené (stěhují se, vráceno, nezapnuto) — rám to vysvětlí.
  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') redirect(`/${rozsah}/finance/faktury`)

  return pristupFaktury
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

/** Faktura má párování plateb (i zrušené) — databáze ji smazat nedovolí (cizí klíč). */
const MA_PAROVANI = 'Faktura má v Platbách párování s platbou (i zrušené), proto ji nejde smazat — historie plateb musí zůstat dohledatelná. Archivujte ji.'

/** Ruční zadání faktury (papírový doklad, platba na místě) — viz `faktury/nova`. */
export async function zalozitFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')
  const chyba = (text: string): never => redirect(`/${rozsah}/finance/faktury/nova?chyba=${encodeURIComponent(text)}`)

  const dodavatel = String(formData.get('supplier') ?? '').trim()
  const castkaHaleru = halereZFormulare(String(formData.get('amount') ?? ''))

  if (!dodavatel || castkaHaleru === null) {
    chyba('Vyplňte dodavatele a částku (nejvýš dvě desetinná místa).')
  }

  // Fotka/PDF do SOUKROMÉHO kbelíku (dřív veřejný faktury-pdf ve staré
  // databázi, otázka 46), do vlastní složky <firma>/rucne/ — typ podle
  // obsahu souboru, ne podle jména. Když se nahrát nepodaří, faktura se
  // nezaloží: dřív vznikla bez fotky a nikdo se to nedozvěděl.
  const foto = formData.get('fotografie')
  let prilohaCesta: string | null = null
  if (foto instanceof File && foto.size > 0) {
    if (foto.size > MAX_VELIKOST_PRILOHY) chyba('Soubor je větší než 10 MB.')
    const data = new Uint8Array(await foto.arrayBuffer())
    const typ = typPrilohy(data)
    if (!typ || typ.pripona === 'xml') chyba('Fotka nebo dokument musí být JPEG, PNG, WebP nebo PDF.')
    const cesta = `${p.tenantId}/rucne/${crypto.randomUUID()}.${typ!.pripona}`
    const nahrano = await p.supabase.storage.from('faktury-prilohy').upload(cesta, data, { contentType: typ!.mime, upsert: false })
    if (nahrano.error) chyba('Fotku se nepodařilo nahrát — zkuste to znovu.')
    prilohaCesta = cesta
  }

  const { error } = await p.supabase.from('faktury').insert({
    tenant_id: p.tenantId,
    prijato_kdy: new Date().toISOString(),
    email_odesilatel: null,
    email_predmet: 'Ručně zadáno v appce',
    dodavatel,
    dodavatel_ico: nepovinnePole(formData, 'supplier_ico'),
    cislo_faktury: nepovinnePole(formData, 'invoice_number'),
    variabilni_symbol: nepovinnePole(formData, 'variable_symbol'),
    castka_haleru: castkaHaleru,
    mena: nepovinnePole(formData, 'currency') || 'CZK',
    datum_vystaveni: nepovinnePole(formData, 'issue_date'),
    duzp: nepovinnePole(formData, 'duzp'),
    splatnost: nepovinnePole(formData, 'due_date'),
    ucet_dodavatele: nepovinnePole(formData, 'supplier_account'),
    stav: nepovinnePole(formData, 'status') || 'Ke kontrole úhrady',
    ke_kontrole: false,
    odkaz_onedrive: nepovinnePole(formData, 'onedrive_url'),
    priloha_cesta: prilohaCesta,
    archivovano: false,
  })

  if (error) chyba(error.message)

  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/** Upomínky — poznamená, že se dodavateli ozvalo (telefonem/mailem mimo appku).
 * Nemění stav faktury ani ji nevyřazuje ze seznamu po splatnosti — jen datum
 * se objeví ve sloupci „Upomínka odeslána". */
export async function oznacitUpominkuVyresenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')

  await p.supabase.from('faktury').update({ upominka_odeslana_kdy: new Date().toISOString() })
    .eq('tenant_id', p.tenantId).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/upominky`)
  redirect(`/${rozsah}/finance/faktury/upominky`)
}

export async function archivovatFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')

  await p.supabase.from('faktury').update({ archivovano: true }).eq('tenant_id', p.tenantId).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/seznam`)
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

export async function obnovitFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')

  await p.supabase.from('faktury').update({ archivovano: false }).eq('tenant_id', p.tenantId).eq('id', id)
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
  const p = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')

  const { data } = await p.supabase.from('faktury').update({ stav: STAV_UHRAZENO })
    .eq('tenant_id', p.tenantId).eq('id', id)
    .in('stav', [...STAVY_PRO_RUCNI_UHRAZENI]).select('id')
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
  const p = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')
  const tenantId = p.tenantId

  // Když se párování nedají zjistit, radši nic — jinak by se stav
  // přepínal tam a zpátky s každou synchronizací banky.
  const nelze: () => never = () => redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Nepodařilo se ověřit platby k faktuře — zkuste to znovu.')}`)
  const sluzba = klientUlohy()
  if (!sluzba) nelze()
  const { data: faktura } = await fakturyFirmy(p, 'castka_haleru, stav, mena').eq('id', id).maybeSingle()
  const platby = await sluzba.from('platby_faktury').select('id, castka_haleru, zpusob')
    .eq('tenant_id', tenantId).eq('faktura', id).eq('stav', 'potvrzeno')
  if (platby.error || !platby.data || !faktura) nelze()
  const f = faktura as unknown as { castka_haleru: number; stav: string; mena: string | null }
  // Stav se ověří PŘED rušením párování (zrušené párování je natrvalo
  // zamítnuté — nesmí zůstat zamítnuté, když se vrácení stejně neprovede).
  if (f.stav !== STAV_UHRAZENO) {
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Faktura není ve stavu Uhrazeno — nic se nezměnilo.')}`)
  }
  const radky = platby.data as { id: string; castka_haleru: number; zpusob: string }[]
  const rucne = radky.filter((r) => r.zpusob !== 'automaticky').reduce((s, r) => s + r.castka_haleru, 0)
  // Párování se vede v haléřích (Kč); u faktury v cizí měně se částky
  // porovnat nedají — ruční párování pak rozhodne člověk v Platbách.
  const vKc = (f.mena ?? 'CZK').trim().toUpperCase() === 'CZK'
  if (!vKc && rucne > 0) {
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Faktura je v cizí měně a má ručně potvrzenou platbu — párování zkontrolujte ve Financích → Platby.')}`)
  }
  // Rozhodnout NEJDŘÍV (podle ručních párování) — automatická se ruší, až
  // když je jisté, že vrácení projde; jinak by zůstala zbytečně zamítnutá.
  const cil = stavPoVraceni(rucne, f.castka_haleru)
  if (cil === null) {
    const vidiPlatby = (await zkusPristup(tenantId, 'finance.read', rozsah)).stav === 'ok'
    const zprava = 'Faktura je podle ručně potvrzené platby z výpisu zaplacená celá. Když platba k faktuře nepatří, musí párování zrušit někdo s právem na Finance → Platby.'
    redirect(vidiPlatby
      ? `/${rozsah}/finance/platby?faktura=${encodeURIComponent(id)}&chyba=${encodeURIComponent(zprava)}`
      : `/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(zprava)}`)
  }

  const { data: prihlaseny } = await (await getServerSupabase()).auth.getUser()
  for (const r of radky) {
    if (r.zpusob !== 'automaticky') continue
    const { error } = await sluzba.rpc('zrusit_automaticke_parovani_faktury', {
      p_tenant: tenantId, p_alokace: r.id,
      p_duvod: `Ve Fakturách vráceno mezi neuhrazené (uživatel ${prihlaseny.user?.id ?? 'neznámý'}).`,
    })
    if (error) nelze()
  }

  const { data: zmeneno, error: chybaZmeny } = await p.supabase.from('faktury').update({ stav: cil })
    .eq('tenant_id', tenantId).eq('id', id).eq('stav', STAV_UHRAZENO).select('id')
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (chybaZmeny || (zmeneno ?? []).length === 0) {
    // Automatická párování už jsou zrušená; další klik to dokončí.
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent('Stav faktury se nepodařilo změnit (mezitím ho mohl změnit někdo jiný) — zkuste to znovu.')}`)
  }
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/** Natvrdo smazat. Žádná druhá cesta zpět — appka to neschovává za potvrzovací dialog
 * (Foodtab tenhle vzor nemá), ale ani nic neskrývá: řádek prostě zmizí. Fakturu
 * s párováním plateb databáze nedovolí smazat — appka to řekne. */
export async function smazatFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')

  const { error } = await p.supabase.from('faktury').delete().eq('tenant_id', p.tenantId).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury/seznam`)
  if (error) {
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(error.code === '23503' ? MA_PAROVANI : 'Fakturu se nepodařilo smazat — zkuste to znovu.')}`)
  }
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/** Potvrzení dokumentu čekajícího na schválení (AI klasifikace si nebyla jistá, člověk
 * potvrdil, že jde o fakturu) — přeřadí do běžného stavu „Ke kontrole úhrady". */
export async function potvrditFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')

  await p.supabase.from('faktury').update({ stav: 'Ke kontrole úhrady', poznamka_kontroly: null })
    .eq('tenant_id', p.tenantId).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/schvaleni`)
}

/** Odmítnutí dokumentu ve frontě ke schválení BEZ zapamatování (jen smazání) —
 * zjednodušené tlačítko „Není to faktura" vedle podrobnějšího `odmitnoutAZapamatovat`. */
export async function odmitnoutFakturu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(rozsah, 'faktury.manage')

  const { error } = await p.supabase.from('faktury').delete().eq('tenant_id', p.tenantId).eq('id', id)
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (error) {
    redirect(`/${rozsah}/finance/faktury/schvaleni?chyba=${encodeURIComponent(error.code === '23503' ? MA_PAROVANI : 'Dokument se nepodařilo odmítnout — zkuste to znovu.')}`)
  }
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
  const p = await pripravit(rozsah, 'faktury.manage')

  const { data } = await fakturyFirmy(p, 'dodavatel, email_odesilatel').eq('id', id).maybeSingle()
  const faktura = data as unknown as { dodavatel: string | null; email_odesilatel: string | null } | null

  await p.supabase.from('faktury')
    .update({ stav: 'Upomínka - zkontrolovat', poznamka_kontroly: null, archivovano: false })
    .eq('tenant_id', p.tenantId).eq('id', id)

  const vyrazeno = await najitSouvisejiciFaktury(p, id, faktura?.dodavatel, faktura?.email_odesilatel, STAV_KE_SCHVALENI)
  if (vyrazeno.size > 0) {
    const poznamka = faktura?.dodavatel
      ? `Automaticky přeřazeno na upomínku – jiný dokument od dodavatele „${faktura.dodavatel}“ byl právě označen jako upomínka.`
      : `Automaticky přeřazeno na upomínku – jiný dokument od stejného odesílatele byl právě označen jako upomínka.`
    await p.supabase.from('faktury')
      .update({ stav: 'Upomínka - zkontrolovat', poznamka_kontroly: poznamka, archivovano: false })
      .eq('tenant_id', p.tenantId).in('id', Array.from(vyrazeno))
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
  p: OtevreneFaktury,
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

    let dotaz = fakturyFirmy(p, 'id, dodavatel')
      .neq('id', fakturaId).ilike('dodavatel', `${predpona}%`)
    if (filtrStavu) dotaz = dotaz.eq('stav', filtrStavu)
    const { data, error } = await dotaz

    if (!error) {
      for (const radek of (data ?? []) as unknown as { id: string; dodavatel: string | null }[]) {
        if (!radek.dodavatel) continue
        const jine = normalizovatDodavatele(radek.dodavatel)
        if (jine.startsWith(normalizovane) || normalizovane.startsWith(jine)) nalezene.add(radek.id)
      }
    }
  }

  if (!jmenoDodavatele && jmenoOdesilatele) {
    let dotaz = fakturyFirmy(p, 'id, dodavatel')
      .neq('id', fakturaId).ilike('email_odesilatel', escapovatIlike(jmenoOdesilatele))
    if (filtrStavu) dotaz = dotaz.eq('stav', filtrStavu)
    const { data, error } = await dotaz

    if (!error) {
      for (const radek of (data ?? []) as unknown as { id: string; dodavatel: string | null }[]) {
        if (!radek.dodavatel?.trim()) nalezene.add(radek.id)
      }
    }
  }

  return nalezene
}

/** Vyřadí jiné existující faktury od stejného dodavatele/odesílatele po kliknutí
 * „Není faktura — odmítnout a zapamatovat". Nikdy nevyhodí výjimku — volající na
 * tomhle kroku nesmí nikdy selhat. Vrací počet vyřazených řádků. */
async function vyradSouvisejiciFaktury(
  p: OtevreneFaktury,
  fakturaId: string,
  dodavatel: string | null | undefined,
  odesilatel: string | null | undefined,
  druh: DruhOdmitnuti,
): Promise<number> {
  const jmenoDodavatele = dodavatel?.trim()
  const jmenoOdesilatele = odesilatel?.trim()
  if (!jmenoDodavatele && !jmenoOdesilatele) return 0

  try {
    const nalezene = await najitSouvisejiciFaktury(p, fakturaId, jmenoDodavatele, jmenoOdesilatele)
    if (nalezene.size === 0) return 0
    const ids = Array.from(nalezene)

    const poznamka = druh === 'not_supplier'
      ? `Automaticky vyřazeno – dodavatel „${jmenoDodavatele}“ byl právě označen jako neplatný dodavatel.`
      : jmenoDodavatele
        ? `Automaticky vyřazeno – jiný dokument od dodavatele „${jmenoDodavatele}“ byl právě označen, že to není faktura.`
        : `Automaticky vyřazeno – jiný dokument od stejného odesílatele (${jmenoOdesilatele}) byl právě označen, že to není faktura.`

    const { error } = await p.supabase.from('faktury')
      .update({ stav: 'Odmítnuto', poznamka_kontroly: poznamka, archivovano: true })
      .eq('tenant_id', p.tenantId).in('id', ids)

    return error ? 0 : ids.length
  } catch {
    return 0
  }
}

/**
 * Odmítnutí dokumentu ve frontě ke schválení se zapamatováním příkladu pro AI.
 * Smaže primární řádek a uloží úryvek textu do `faktury_vzory_odmitnuti`, aby AI
 * příště podobný dokument (podle OBSAHU, ne podle odesílatele — viz zadání, „AI
 * musí rozhodovat podle obsahu přílohy a textu v mailu a ne podle odesílatele")
 * rozpoznala sama. Zápis příkladu je jen „nice to have" — selhání nikdy neblokuje
 * odmítnutí.
 *
 * Do 18. 10. 2026 šly příklady do `rejection_examples` ve staré databázi bez
 * firmy; úryvek je ale text dokladu konkrétní firmy, takže teď s `tenant_id`.
 */
export async function odmitnoutAZapamatovat(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const druh = String(formData.get('druh') ?? 'not_invoice') as DruhOdmitnuti
  const p = await pripravit(rozsah, 'faktury.manage')

  const { data } = await fakturyFirmy(p, 'vytah_textu, dodavatel, email_predmet, email_odesilatel').eq('id', id).maybeSingle()
  const faktura = data as unknown as { vytah_textu: string | null; dodavatel: string | null; email_predmet: string | null; email_odesilatel: string | null } | null

  const vyrazeno = await vyradSouvisejiciFaktury(p, id, faktura?.dodavatel, faktura?.email_odesilatel, druh)

  const { error } = await p.supabase.from('faktury').delete().eq('tenant_id', p.tenantId).eq('id', id)
  if (error) {
    revalidatePath(`/${rozsah}/finance/faktury`)
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(error.code === '23503' ? MA_PAROVANI : 'Dokument se nepodařilo odmítnout — zkuste to znovu.')}`)
  }

  const vytah = faktura?.vytah_textu?.trim()
  if (vytah) {
    await p.supabase.from('faktury_vzory_odmitnuti').insert({
      tenant_id: p.tenantId,
      druh,
      vytah,
      dodavatel_odhad: faktura?.dodavatel || null,
      email_predmet: faktura?.email_predmet || null,
    })
  }

  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/faktury/seznam${vyrazeno > 0 ? `?vyrazeno=${vyrazeno}` : ''}`)
}
