'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { fakturyFirmy, pristupKFakturam, type PristupKFakturam } from '@/lib/faktury-pristup'
import { halereZFormulare } from '@/lib/faktury-sloupce'
import { typPrilohy, MAX_VELIKOST_PRILOHY } from '@/lib/faktury-prevod'
import { MENY_RUCNIHO_ZADANI, STAV_CASTECNE, STAV_KE_SCHVALENI, STAV_UHRAZENO, STAVY_RUCNIHO_ZADANI } from '@/lib/faktury-types'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'

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

/**
 * Faktura má párování s platbou nebo ruční úhradu (i zrušené) — databáze
 * ji smazat nedovolí (cizí klíč). Automatický návrh, který nikdo
 * nepotvrdil, smazání nebrání: smaže ho spolu s fakturou databáze
 * (spoušť trg_faktury_smazat_navrhy, Finance Fáze 0, krok 2).
 */
const MA_PAROVANI = 'Faktura má v Platbách párování s platbou nebo ruční úhradu (i zrušené), proto ji nejde smazat — historie plateb musí zůstat dohledatelná. Archivujte ji.'

const VZOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  // Stav a měna jen z nabídky formuláře — podvržený formulář by jinak
  // založil fakturu rovnou „Uhrazeno" s libovolnou měnou.
  const stav = nepovinnePole(formData, 'status') || 'Ke kontrole úhrady'
  const mena = nepovinnePole(formData, 'currency') || 'CZK'
  if (!STAVY_RUCNIHO_ZADANI.includes(stav) || !MENY_RUCNIHO_ZADANI.includes(mena)) {
    chyba('Neplatný stav nebo měna faktury.')
  }

  // Fotka/PDF do SOUKROMÉHO kbelíku (dřív veřejný faktury-pdf ve staré
  // databázi, otázka 46), do vlastní složky <firma>/rucne/ — typ podle
  // obsahu souboru, ne podle jména. Když se nahrát nepodaří, faktura se
  // nezaloží: dřív vznikla bez fotky a nikdo se to nedozvěděl.
  const foto = formData.get('fotografie')
  let prilohaCesta: string | null = null
  if (foto instanceof File && foto.size > 0) {
    // Strop formuláře (serverová akce) je 1 MB na celý odeslaný formulář —
    // větší soubor Next odmítne dřív, než se sem dostane. MAX_VELIKOST_PRILOHY
    // (10 MB) platí pro přílohy z e-mailu a převodu, ne pro tenhle formulář.
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
    mena,
    datum_vystaveni: nepovinnePole(formData, 'issue_date'),
    duzp: nepovinnePole(formData, 'duzp'),
    splatnost: nepovinnePole(formData, 'due_date'),
    ucet_dodavatele: nepovinnePole(formData, 'supplier_account'),
    stav,
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

/** Hláška databáze pro člověka (česky, bez id), jinak obecná věta. */
function hlaskaProLidi(error: { code?: string; message: string }, zalozni: string): string {
  const vlastni = (error.code === '23514' || error.code === '42501' || error.code === 'P0001')
    && !/violates|relation|constraint|function|column/i.test(error.message)
  return vlastni ? error.message : zalozni
}

/**
 * Ručně „Uhrazeno" — zaplaceno mimo výpis (hotově, kartou, z jiného účtu).
 * Šéfík 8. 10. 2026: „…a nebo přesunout ručně". Finance Fáze 0, krok 2:
 * „Ruční zaplaceno zůstává, ale s důvodem a autorem" — zapisuje se
 * ruční úhrada (`rucne_uhradit_fakturu`: částka v měně faktury, důvod
 * aspoň 5 znaků, autor = přihlášený) a stav přepočítá databáze ze všech
 * plateb. Jen schválená faktura (Ke kontrole úhrady, Neuhrazeno,
 * Částečně uhrazeno) — rozhoduje databáze, ne formulář.
 */
export async function oznacitUhrazenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  // Faktury patří celé firmě — stav úhrady mění jen správce za celou firmu.
  const p = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')
  const chyba = (text: string): never => redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(text)}`)

  const castkaHaleru = halereZFormulare(String(formData.get('castka') ?? ''))
  const duvod = String(formData.get('duvod') ?? '').trim().slice(0, 300)
  if (castkaHaleru === null || castkaHaleru <= 0) chyba('Vyplňte uhrazenou částku v měně faktury (kladnou, nejvýš dvě desetinná místa).')
  if (duvod.length < 5) chyba('Napište, proč je faktura zaplacená mimo výpis (aspoň 5 znaků) — např. „hotově z pokladny 12. 11.".')

  const { error } = await p.supabase.rpc('rucne_uhradit_fakturu', {
    p_tenant: p.tenantId, p_faktura: id, p_castka_haleru: castkaHaleru, p_duvod: duvod,
  })
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (error) chyba(hlaskaProLidi(error, 'Úhradu se nepodařilo zapsat — zkuste to znovu.'))
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/**
 * Zpět mezi neuhrazené. Člověk tím říká, že faktura zaplacená NENÍ.
 * Celé v JEDNÉ databázové transakci (`vratit_fakturu_mezi_neuhrazene`,
 * Finance Fáze 0 krok 2): zruší ruční úhrady a automatická párování
 * faktury a stav přepočítá z toho, co zbyde. Jde z „Uhrazeno" i ze
 * „Částečně uhrazeno" (tlačítko je u obou). Ručně potvrzená párování
 * zůstanou — když kryjí celou fakturu, nebo ji zčásti platí jen ona,
 * nezmění se nic a člověk jde do Plateb (ruší je ten, kdo má právo na
 * Platby). Návrh platby v jiné měně, ze kterého zrušená úhrada vznikla,
 * se vrátí do Návrhů párování. Dřív to appka skládala ze tří kroků službou
 * a po chybě uprostřed zůstala párování zrušená a stav nezměněný.
 */
export async function vratitNeuhrazenou(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('id') ?? '')
  const p = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')
  const duvod = String(formData.get('duvod') ?? '').trim().slice(0, 300)

  const { error } = await p.supabase.rpc('vratit_fakturu_mezi_neuhrazene', {
    p_tenant: p.tenantId, p_faktura: id, p_duvod: duvod || null,
  })
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (error) {
    const zprava = hlaskaProLidi(error, 'Fakturu se nepodařilo vrátit mezi neuhrazené — zkuste to znovu.')
    // Zaplacená celá nebo zčásti jen ručně potvrzenou platbou → do Plateb
    // (kdo je vidí). Obě hlášky píše vratit_fakturu_mezi_neuhrazene.
    const vidiPlatby = /zaplacená celá|zčásti zaplacená/.test(zprava) &&(await zkusPristup(p.tenantId, 'finance.read', TENANT_SCOPE_SEGMENT)).stav === 'ok'
    redirect(vidiPlatby
      ? `/${rozsah}/finance/platby?faktura=${encodeURIComponent(id)}&chyba=${encodeURIComponent(zprava)}`
      : `/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(zprava)}`)
  }
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/**
 * Zrušit jednu ruční úhradu (i započtení dobropisu — databáze zruší oba
 * jeho řádky) s důvodem. Stav faktury přepočítá databáze ze všeho, co
 * zbyde (`zrusit_rucni_uhradu`: správce Faktur za celou firmu, důvod
 * aspoň 5 znaků, úhrada jen téhle firmy). Z formuláře jen id úhrady
 * a důvod.
 */
export async function zrusitRucniUhradu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const uhradaId = String(formData.get('uhrada_id') ?? '')
  const p = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')
  const chyba = (text: string): never => redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(text)}`)

  const duvod = String(formData.get('duvod') ?? '').trim().slice(0, 300)
  if (!VZOR_UUID.test(uhradaId)) chyba('Ruční úhrada se nenašla.')
  if (duvod.length < 5) chyba('Napište, proč ruční úhradu rušíte (aspoň 5 znaků).')

  const { error } = await p.supabase.rpc('zrusit_rucni_uhradu', {
    p_tenant: p.tenantId, p_uhrada: uhradaId, p_duvod: duvod,
  })
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (error) chyba(hlaskaProLidi(error, 'Ruční úhradu se nepodařilo zrušit — zkuste to znovu.'))
  redirect(`/${rozsah}/finance/faktury/seznam`)
}

/**
 * Započíst dobropis proti otevřené faktuře téhož dodavatele (stejné IČO,
 * nebo stejné jméno, když IČO chybí). Databáze (`zapocitat_dobropis`)
 * ověří znovu všechno: že jde o dobropis a kladnou fakturu, stejnou měnu,
 * stejného dodavatele (IČO vlastní firmy ani sporné IČO nepustí), že
 * částka nepřesáhne zbytek dobropisu ani faktury — a zapíše dvě ruční
 * úhrady s jedním označením započtení (zrušit jde jen obě najednou).
 */
export async function zapocitatDobropis(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const dobropisId = String(formData.get('id') ?? '')
  const fakturaId = String(formData.get('faktura') ?? '')
  const p = await pripravit(TENANT_SCOPE_SEGMENT, 'faktury.manage')
  const chyba = (text: string): never => redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(text)}`)

  const castkaHaleru = halereZFormulare(String(formData.get('castka') ?? ''))
  const duvod = String(formData.get('duvod') ?? '').trim().slice(0, 300)
  if (!VZOR_UUID.test(dobropisId) || !VZOR_UUID.test(fakturaId)) chyba('Vyberte fakturu, proti které se dobropis započte.')
  if (castkaHaleru === null || castkaHaleru <= 0) chyba('Vyplňte částku započtení (kladnou, nejvýš dvě desetinná místa).')
  if (duvod.length < 5) chyba('Napište důvod započtení (aspoň 5 znaků) — např. „dobropis za vrácené zboží".')

  const { error } = await p.supabase.rpc('zapocitat_dobropis', {
    p_tenant: p.tenantId, p_dobropis: dobropisId, p_faktura: fakturaId, p_castka_haleru: castkaHaleru, p_duvod: duvod,
  })
  revalidatePath(`/${rozsah}/finance/faktury`)
  if (error) chyba(hlaskaProLidi(error, 'Dobropis se nepodařilo započíst — zkuste to znovu.'))
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

  // Jen dokument z fronty ke schválení — podvržený formulář by jinak vrátil
  // do „Ke kontrole úhrady" i fakturu uhrazenou párováním plateb.
  await p.supabase.from('faktury').update({ stav: 'Ke kontrole úhrady', poznamka_kontroly: null })
    .eq('tenant_id', p.tenantId).eq('id', id).eq('stav', STAV_KE_SCHVALENI)
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

  // Jen dokument z fronty ke schválení (jako potvrditFakturu) — podvržený
  // formulář by jinak udělal upomínku i ze zaplacené faktury (databáze
  // změnu stavu faktury s platbou odmítne, spoušť trg_faktury_hlida_uhradu).
  await p.supabase.from('faktury')
    .update({ stav: 'Upomínka - zkontrolovat', poznamka_kontroly: null, archivovano: false })
    .eq('tenant_id', p.tenantId).eq('id', id).eq('stav', STAV_KE_SCHVALENI)

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

    // Zaplacené a spárované faktury se nevyřazují: zaplacená faktura je
    // účetní fakt (Finance Fáze 0, krok 2) a databáze změnu stavu faktury
    // s platbou odmítne. Po jedné, ať jedno odmítnutí nezastaví ostatní.
    let vyrazeno = 0
    for (const fakturaId of ids) {
      const { data, error } = await p.supabase.from('faktury')
        .update({ stav: 'Odmítnuto', poznamka_kontroly: poznamka, archivovano: true })
        .eq('tenant_id', p.tenantId).eq('id', fakturaId)
        .not('stav', 'in', `("${STAV_UHRAZENO}","${STAV_CASTECNE}")`)
        .select('id')
      if (!error) vyrazeno += (data ?? []).length
    }
    return vyrazeno
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

  // Nejdřív smazat, až potom vyřadit ostatní od stejného dodavatele: faktura
  // s párováním plateb smazat nejde (cizí klíč) — a pak se nesmí vyřadit
  // nic jiného, jinak by zůstala jen ona a ostatní by zmizely z přehledů.
  const { error } = await p.supabase.from('faktury').delete().eq('tenant_id', p.tenantId).eq('id', id)
  if (error) {
    revalidatePath(`/${rozsah}/finance/faktury`)
    redirect(`/${rozsah}/finance/faktury/seznam?chyba=${encodeURIComponent(error.code === '23503' ? MA_PAROVANI : 'Dokument se nepodařilo odmítnout — zkuste to znovu.')}`)
  }

  const vyrazeno = await vyradSouvisejiciFaktury(p, id, faktura?.dodavatel, faktura?.email_odesilatel, druh)

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
