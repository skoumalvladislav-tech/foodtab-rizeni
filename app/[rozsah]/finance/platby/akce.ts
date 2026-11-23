'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { hasAccess, TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { getServerSupabase } from '@/lib/supabase/server'
import { pristupKFakturam } from '@/lib/faktury-pristup'
import { hlaskaBrany } from '@/lib/faktury-brana'
import { naHalere } from '@/lib/mzdy'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { hlaskaZmenyPobockyUctu, pobockaUctu, ucetPatriRozsahu } from '@/lib/finance-platby-pobocka'
import { overitCisloUctu } from '@/lib/banka/ucet'

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * Vstup akcí, které se týkají účtů a plateb V ROZSAHU adresy.
 *
 * Vrací i pobočku rozsahu (`pobocka`, `null` = celá firma) — akce si ji
 * berou odsud, NIKDY z formuláře (Finance po pobočkách, 13. 10. 2026).
 *
 * Na pobočce navíc stejná brána jako app/[rozsah]/finance/layout.tsx:
 * jen s `finance.read` za celou firmu. Layout hlídá jen kreslení —
 * serverovou akci jde zavolat i bez stránky, a vedoucí jedné pobočky by
 * si jinak tudy založil účet, který na stránce nikdy neuvidí.
 */
async function pripravit(rozsah: string, pravo: 'finance.read' | 'finance.manage') {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/platby`)

  const pobocka = pobockaFinanci(pristup.scope)
  // ROZHODNOUT: (docs/hlaseni/otazky.md, ot. 47 bod 1) — kdyby Finance
  // pobočky dostal i vedoucí jedné pobočky, musí se uvolnit i tahle
  // druhá linie, ne jen finance/layout.tsx.
  if (pobocka && !(await hasAccess(tenantId, 'finance.read', null))) redirect(`/${rozsah}/finance/platby`)

  return { supabase: await getServerSupabase(), tenantId, pobocka }
}

/**
 * Vstup akcí, které mění něco CELÉ FIRMY — párování s fakturami (stav
 * faktury v databázi Faktur, ta pobočku nemá) a pobočka účtu. Právo
 * VŽDY za celou firmu, ne za rozsah z formuláře — stejně jako
 * faktury/akce.ts (kontrola 13. 10. 2026): „finance.manage na Bernard
 * Baru“ by jinak pustilo vedoucího jedné pobočky k fakturám celé firmy
 * (databázová `potvrdit_alokaci_platby` hlídá jen pobočku účtu platby).
 * `rozsah` zůstává jen pro návratovou adresu.
 */
async function pripravitFiremni(rozsah: string, pravo: 'finance.manage', duvod: string) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, TENANT_SCOPE_SEGMENT)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(duvod)}`)

  return { supabase: await getServerSupabase(), tenantId }
}

function nepovinnePole(formData: FormData, nazev: string): string | null {
  const hodnota = String(formData.get(nazev) ?? '').trim()
  return hodnota ? hodnota : null
}

/**
 * Aktivní pobočka TÉHLE firmy s daným id, jako seznam pro `pobockaUctu`
 * (prázdný = id k firmě nepatří, pobočka je vypnutá, nebo nejde
 * přečíst — vždy „nepustit"). Databáze sama nehlídá, že `branch_id`
 * účtu patří stejné firmě, a firemní správce má `has_access` na
 * jakékoli id pobočky.
 */
async function aktivniPobockaFirmy(supabase: Supabase, tenantId: string, branchId: string | null): Promise<string[]> {
  if (!branchId) return []
  const { data } = await supabase
    .from('branches')
    .select('id')
    .eq('id', branchId)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .is('deleted_at', null)
  return ((data ?? []) as { id: string }[]).map((b) => b.id)
}

export async function zalozitPlatebniUcet(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah, 'finance.manage')

  const nazev = String(formData.get('nazev') ?? '').trim()
  const typ = String(formData.get('typ') ?? '')
  if (!nazev || !['banka', 'pokladna', 'karta'].includes(typ)) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyplňte název a typ účtu.')}`)
  }

  // Na pobočce VŽDY pobočka rozsahu (skryté pole formuláře se nečte),
  // za celou firmu výběr z formuláře — prázdný = účet celé firmy.
  const vybrana = nepovinnePole(formData, 'branch_id')
  const volba = pobockaUctu(pobocka, vybrana, pobocka ? [] : await aktivniPobockaFirmy(supabase, tenantId, vybrana))
  if (volba.stav === 'chyba') redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(volba.text)}`)

  // Číslo účtu (nepovinné) ve stejném tvaru jako protiúčet pohybu
  // (lib/banka/ucet.ts) — import a párování ho pak poznají. Překlep
  // v IBANu nebo českém čísle účtu se odmítne, ne uloží.
  const cislo = overitCisloUctu(String(formData.get('cislo_uctu') ?? ''))
  if (cislo.stav === 'chyba') redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(cislo.text)}`)

  const { error } = await supabase.from('platebni_ucty').insert({
    tenant_id: tenantId,
    branch_id: volba.branchId,
    nazev,
    typ,
    cislo_uctu: cislo.ucet,
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Účet se nepodařilo uložit.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

export async function zapsatTransakci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId, pobocka } = await pripravit(rozsah, 'finance.manage')

  const ucetId = String(formData.get('ucet_id') ?? '')
  const smer = String(formData.get('smer') ?? '')
  const castka = naHalere(String(formData.get('castka') ?? '').trim())
  const datum = String(formData.get('datum') ?? '')

  if (!ucetId || !['prijem', 'vydaj'].includes(smer) || castka === null || castka <= 0 || !datum) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyplňte účet, směr, částku a datum.')}`)
  }

  // Na pobočce jen na účet TÉ pobočky — ověřené tady, ne podle toho,
  // co výběr na stránce nabídl (`ucet_id` si kdokoli přepíše). Platba
  // na firemní účet nebo účet jiné pobočky by se z Bernard Baru zapsala
  // do čísel, která tahle stránka vůbec neukazuje.
  if (pobocka) {
    const { data: ucet } = await supabase
      .from('platebni_ucty')
      .select('branch_id')
      .eq('id', ucetId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!ucetPatriRozsahu(pobocka, ucet)) {
      redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Na pobočce jde platbu zapsat jen na platební účet této pobočky.')}`)
    }
  }

  const { error } = await supabase.from('transakce').insert({
    tenant_id: tenantId,
    ucet_id: ucetId,
    smer,
    castka_haleru: castka,
    datum,
    protistrana: nepovinnePole(formData, 'protistrana') ?? '',
    vs: nepovinnePole(formData, 'vs') ?? '',
    poznamka: nepovinnePole(formData, 'poznamka') ?? '',
    zdroj: 'rucni',
  })

  if (error) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Platbu se nepodařilo zapsat.')}`)

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby`)
}

/**
 * Pobočka EXISTUJÍCÍHO platebního účtu (Finance po pobočkách, 13. 10.
 * 2026). Dnes je každý účet založený v appce firemní, takže banka
 * a platby pobočky by bez téhle akce zůstaly prázdné — a nový účet by
 * přišel o historii.
 *
 * Jen v pohledu Celá firma a jen se „Správa financí" ZA CELOU FIRMU:
 * spolu s účtem se přesunou VŠECHNY jeho dosavadní platby (transakce
 * pobočku nemá, patří jí přes účet) — v Platbách, Cashflow, Tržbách
 * i v exportu pro účetního. Stránka to říká u výběru.
 */
export async function zmenitPobockuUctu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { supabase, tenantId } = await pripravitFiremni(
    rozsah,
    'finance.manage',
    'Pobočku účtu mění jen ten, kdo má právo „Správa financí“ za celou firmu.',
  )

  const ucetId = String(formData.get('ucet_id') ?? '')
  const { data: ucet } = ucetId
    ? await supabase.from('platebni_ucty').select('id, branch_id').eq('id', ucetId).eq('tenant_id', tenantId).maybeSingle()
    : { data: null }
  if (!ucet) redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Účet se nenašel.')}`)

  // Beze změny se nic nezapisuje (ani do auditu). Výběr nabízí i vypnutou
  // pobočku, ve které účet už je (volbyPobockyUctu) — její „Uložit" není
  // nová volba, jen potvrzení stávající.
  const vybrana = nepovinnePole(formData, 'branch_id')
  if (vybrana === ucet.branch_id) redirect(`/${rozsah}/finance/platby`)

  const volba = pobockaUctu(null, vybrana, await aktivniPobockaFirmy(supabase, tenantId, vybrana))
  if (volba.stav === 'chyba') redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(volba.text)}`)

  // `.select()` vrací změněné řádky: RLS umí UPDATE odmítnout tiše
  // (0 řádků, žádná chyba) — bez vráceného řádku se nic nezměnilo.
  const { data: zmenene, error } = await supabase
    .from('platebni_ucty')
    .update({ branch_id: volba.branchId })
    .eq('id', ucet.id)
    .eq('tenant_id', tenantId)
    .select('id')
  if (error || (zmenene ?? []).length !== 1) {
    // Účet, na který míří připojení banky jiné pobočky, databáze
    // nepřestěhuje — řekne se proč, ne jen „nepodařilo".
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(hlaskaZmenyPobockyUctu(error))}`)
  }

  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`/${rozsah}/finance/platby?pobocka_uctu=1`)
}

const VZOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Proč teď párovat nejde — věta podle stavu brány Faktur (stěhují se, vrácené, chyba…). */
function fakturyZavrene(pristup: Parameters<typeof hlaskaBrany>[0]): string {
  return `${hlaskaBrany(pristup).text} Párování s fakturami teď nejde.`
}

const BEZ_FAKTUR = 'Párovat s fakturami (a rušit párování) smí ten, kdo má právo „Vidět přijaté faktury“ — mění stav faktury.'

/**
 * Hláška databáze pro člověka, nebo obecná věta. Funkce párování
 * (migrace 20261120100000) hlásí česky a bez id — kód 23514/42501
 * s vlastní větou se ukáže; technická hláška omezení („violates…")
 * ne.
 */
function hlaskaProLidi(error: { code?: string; message: string }, zalozni: string): string {
  const vlastni = (error.code === '23514' || error.code === '42501' || error.code === 'P0001')
    && !/violates|relation|constraint|function|column/i.test(error.message)
  return vlastni ? error.message : zalozni
}

/** Důvod (zrušení, ruční úhrada): aspoň 5 znaků, nejvýš 300. */
function duvodZFormulare(formData: FormData): string | null {
  const duvod = String(formData.get('duvod') ?? '').trim().slice(0, 300)
  return duvod.length >= 5 ? duvod : null
}

/** Odmítnutí párování mimo celou firmu — viz `pripravitFiremni`. */
const PAROVANI_JEN_FIRMA =
  'Párování plateb s fakturami smí jen ten, kdo má právo „Správa financí“ za celou firmu — mění stav faktury celé firmy.'

/**
 * Potvrzení párování — vždy lidský klik, nikdy automaticky (zadání,
 * oddíl 5). Používá se pro NÁVRH (hodnoty přijdou skryté z formuláře)
 * i pro RUČNÍ párování (zadání, oddíl 7: „hromadné platby" — jedna
 * platba na víc faktur, appka to podpoří tím, že se tahle akce
 * zavolá vícekrát se stejnou platbou a jinou fakturou/zbývající
 * částkou). Zapisuje VÝHRADNĖ přes `sparovat_platbu_s_fakturou`
 * (20261018100000) — přímý INSERT do `platby_faktury` appka nemá
 * (grant odebraný). Funkce hlídá souběh (advisory zámek + zámek řádku
 * faktury), to, že alokace nepřesáhne částku platby, a ve STEJNÉ
 * transakci přepne stav faktury („Uhrazeno" / „Částečně uhrazeno").
 * Dřív to byl best-effort zápis do druhé databáze, který mohl nevyjít.
 *
 * Celkovou částku faktury si funkce přečte sama z `public.faktury` —
 * z formuláře se nebere nic kromě id a alokované částky.
 *
 * Faktura v jiné měně než CZK nebo bez kladné částky: párování se
 * zapíše, stav faktury se NEZMĚNÍ (platby jsou v Kč a porovnat se
 * nedají) — appka to řekne, rozhodne člověk (otázka 62).
 *
 * Od 13. 10. 2026 jen s právem za celou firmu (`pripravitFiremni`) —
 * stránka párování na pobočce neukazuje vůbec.
 */
export async function potvrditParovani(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const transakceId = String(formData.get('transakce_id') ?? '')
  const fakturaId = String(formData.get('faktura_id') ?? '')
  // Návrh posílá přesnou haléřovou hodnotu skrytým polem; ruční
  // párování ji nemá předpočítanou a člověk ji zadává v Kč.
  const castkaHaleruSkryte = formData.get('castka_haleru')
  const castkaHaleru =
    castkaHaleruSkryte != null && castkaHaleruSkryte !== ''
      ? Number(castkaHaleruSkryte)
      : naHalere(String(formData.get('castka') ?? '').trim())
  const jistotaRaw = formData.get('jistota')
  const jistota = jistotaRaw ? Number(jistotaRaw) : null

  const { supabase, tenantId } = await pripravitFiremni(rozsah, 'finance.manage', PAROVANI_JEN_FIRMA)

  if (!transakceId || !fakturaId || castkaHaleru === null || castkaHaleru <= 0) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Vyberte platbu, fakturu a vyplňte kladnou částku.')}`)
  }

  // Párování čte částku faktury — bez práva na faktury nejde (stejně jako na stránce Plateb).
  // Faktury pobočku nemají: právo za celou firmu, jako faktury/akce.ts.
  if ((await zkusPristup(tenantId, 'faktury.read', TENANT_SCOPE_SEGMENT)).stav !== 'ok') {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(BEZ_FAKTUR)}`)
  }

  if (!VZOR_UUID.test(fakturaId)) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Faktura se nenašla — zkontrolujte číslo faktury.')}`)
  }

  // Faktury zavřené (stěhují se) → párování počká; databáze by ho odmítla taky.
  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(fakturyZavrene(pristupFaktury))}`)
  }

  const { data, error } = await supabase.rpc('sparovat_platbu_s_fakturou', {
    p_tenant: tenantId,
    p_transakce: transakceId,
    p_faktura: fakturaId,
    p_castka_haleru: castkaHaleru,
    p_jistota: jistota,
  })

  if (error) {
    // Hlášky funkce jsou psané pro lidi (česky, bez id) — ukázat je:
    // jiná měna, směr platby, storno, neschválená faktura, přesah platby…
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(hlaskaProLidi(error, 'Párování se nepodařilo uložit.'))}`)
  }

  const vysledek = (data as { prebytek_haleru: number | null; stav_faktury: string | null }[] | null)?.[0]
  const prebytekHaleru = Number(vysledek?.prebytek_haleru ?? 0)

  revalidatePath(`/${rozsah}/finance/platby`)
  revalidatePath(`/${rozsah}/finance/faktury`)
  // Přeplatek appka od 7.10.2026 nezakazuje (zadání: „podporuj...
  // přeplatky"), jen o něm nahlas řekne — co se s penězi navíc stane
  // (jiná faktura, dobropis, vrácení), rozhoduje člověk. Stav faktury
  // přepočítala databáze ve stejné transakci (jiná měna se spárovat nedá).
  redirect(
    prebytekHaleru > 0
      ? `/${rozsah}/finance/platby?prebytek=${prebytekHaleru}`
      : `/${rozsah}/finance/platby`
  )
}

/* ---------------------------------------------------------------------
 * Fronta Návrhy párování (Finance Fáze 0, krok 2). Potvrzení i odmítnutí
 * rozhoduje databáze podle id návrhu — částku, platbu ani fakturu appka
 * z formuláře nebere. Právo stejné jako ruční párování.
 * ------------------------------------------------------------------ */

const FRONTA = (rozsah: string) => `/${rozsah}/finance/platby/navrhy`

async function pripravitNavrh(formData: FormData) {
  const rozsah = String(formData.get('rozsah') ?? '')
  const navrhId = String(formData.get('navrh_id') ?? '')
  const { supabase, tenantId } = await pripravitFiremni(rozsah, 'finance.manage', PAROVANI_JEN_FIRMA)
  if ((await zkusPristup(tenantId, 'faktury.read', TENANT_SCOPE_SEGMENT)).stav !== 'ok') {
    redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent(BEZ_FAKTUR)}`)
  }
  if (!VZOR_UUID.test(navrhId)) redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent('Návrh se nenašel.')}`)
  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent(fakturyZavrene(pristupFaktury))}`)
  return { supabase, tenantId, rozsah, navrhId }
}

export async function potvrditNavrh(formData: FormData): Promise<void> {
  const { supabase, tenantId, rozsah, navrhId } = await pripravitNavrh(formData)
  const { data, error } = await supabase.rpc('potvrdit_navrh_parovani', { p_tenant: tenantId, p_navrh: navrhId })
  if (error) redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent(hlaskaProLidi(error, 'Návrh se nepodařilo potvrdit.'))}`)
  const vysledek = (data as { prebytek_haleru: number | null }[] | null)?.[0]
  const prebytekHaleru = Number(vysledek?.prebytek_haleru ?? 0)
  revalidatePath(`/${rozsah}/finance/platby`)
  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(prebytekHaleru > 0 ? `${FRONTA(rozsah)}?prebytek=${prebytekHaleru}` : `${FRONTA(rozsah)}?potvrzeno=1`)
}

export async function odmitnoutNavrh(formData: FormData): Promise<void> {
  const { supabase, tenantId, rozsah, navrhId } = await pripravitNavrh(formData)
  const { error } = await supabase.rpc('odmitnout_navrh_parovani', { p_tenant: tenantId, p_navrh: navrhId })
  if (error) redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent(hlaskaProLidi(error, 'Návrh se nepodařilo odmítnout.'))}`)
  revalidatePath(`/${rozsah}/finance/platby`)
  redirect(`${FRONTA(rozsah)}?odmitnuto=1`)
}

/**
 * Návrh „jiná měna": platba v Kč na fakturu v EUR (a naopak). Spárovat
 * v haléřích nejde — zapíše se RUČNÍ ÚHRADA v měně faktury s důvodem
 * a odkazem na platbu (`rucne_uhradit_fakturu` s p_transakce; databáze
 * ověří, že měny opravdu nesedí, a návrh tím uzavře).
 */
export async function uhraditVJineMene(formData: FormData): Promise<void> {
  const { supabase, tenantId, rozsah, navrhId } = await pripravitNavrh(formData)
  const castkaHaleru = naHalere(String(formData.get('castka') ?? '').trim())
  const duvod = duvodZFormulare(formData)
  if (castkaHaleru === null || castkaHaleru <= 0 || !duvod) {
    redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent('Vyplňte částku v měně faktury a důvod (aspoň 5 znaků).')}`)
  }
  // Platbu a fakturu bere z NÁVRHU (čte ho databáze pod přihlášením), ne z formuláře.
  const { data: navrh } = await supabase.from('platby_faktury')
    .select('transakce_id, faktura, duvod, stav').eq('tenant_id', tenantId).eq('id', navrhId).maybeSingle()
  const n = navrh as { transakce_id: string; faktura: string | null; duvod: string | null; stav: string } | null
  if (!n || !n.faktura || n.stav !== 'navrzeno' || n.duvod !== 'jina_mena') {
    redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent('Návrh už není otevřený nebo není v jiné měně.')}`)
  }
  const { error } = await supabase.rpc('rucne_uhradit_fakturu', {
    p_tenant: tenantId, p_faktura: n.faktura, p_castka_haleru: castkaHaleru, p_duvod: duvod, p_transakce: n.transakce_id,
  })
  if (error) redirect(`${FRONTA(rozsah)}?chyba=${encodeURIComponent(hlaskaProLidi(error, 'Úhradu se nepodařilo zapsat.'))}`)
  revalidatePath(`/${rozsah}/finance/platby`)
  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`${FRONTA(rozsah)}?potvrzeno=1`)
}

/**
 * Zrušení potvrzené alokace — vratné s auditem
 * (`zrusit_parovani_faktury`, 20261018100000). Řádek zůstává (historie),
 * jen stav jde na `zamitnuto` — uvolní se tím místo pro novou alokaci —
 * a stav faktury se přepočítá ve STEJNÉ transakci (dřív best-effort
 * zápis do druhé databáze; nález 6.–7. 10. 2026: po zrušení zůstávala
 * faktura „Uhrazeno"). Párování na fakturu, která ve staré databázi
 * zmizela (převod ho vykázal), jde zrušit taky — stav není čemu přepočítat.
 *
 * Stejně jako potvrzení jen s právem za celou firmu (`pripravitFiremni`)
 * a s právem „Vidět přijaté faktury" (mění stav faktury).
 */
export async function zrusitAlokaci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const alokaceId = String(formData.get('alokace_id') ?? '')
  // Důvod je povinný (Finance Fáze 0, krok 2) — zůstane v auditu.
  const duvod = duvodZFormulare(formData)

  const { supabase, tenantId } = await pripravitFiremni(rozsah, 'finance.manage', PAROVANI_JEN_FIRMA)
  if (!duvod) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent('Napište důvod zrušení párování (aspoň 5 znaků).')}`)
  }

  // Právo na Faktury výslovně a PRVNÍ: bez něj by brána (stav převodu čte
  // jen ten, kdo Faktury vidí) vypadala jako „Faktury se stěhují".
  if ((await zkusPristup(tenantId, 'faktury.read', TENANT_SCOPE_SEGMENT)).stav !== 'ok') {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(BEZ_FAKTUR)}`)
  }
  const pristupFaktury = await pristupKFakturam(tenantId)
  if (pristupFaktury.stav !== 'ok') {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(fakturyZavrene(pristupFaktury))}`)
  }

  const { error } = await supabase.rpc('zrusit_parovani_faktury', {
    p_tenant: tenantId,
    p_alokace: alokaceId,
    p_duvod: duvod,
  })

  if (error) {
    redirect(`/${rozsah}/finance/platby?chyba=${encodeURIComponent(hlaskaProLidi(error, 'Zrušení párování se nepodařilo.'))}`)
  }

  revalidatePath(`/${rozsah}/finance/platby`)
  revalidatePath(`/${rozsah}/finance/faktury`)
  redirect(`/${rozsah}/finance/platby`)
}
