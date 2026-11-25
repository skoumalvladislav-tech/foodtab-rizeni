/**
 * Pobočky a platební účty — jedna definice pro všechny stránky Financí
 * (Finance Fáze 0, krok 3).
 *
 * Platba (`transakce`) pobočku sama nemá: patří jí přes platební účet
 * (`platebni_ucty.branch_id`). Pobočka bez AKTIVNÍHO účtu proto v součtech
 * po pobočkách chybí — a stránky to musí říct nahlas, ne ukázat „0 Kč".
 *
 * Kdo nemá účet, rozhoduje JEN databáze: funkce
 * `public.pobocky_bez_aktivniho_uctu` (migrace 20261121100000). Vypnutý
 * účet je totéž co žádný. Dřív si to každá stránka počítala sama a Rozpočty
 * s KPI braly i vypnuté účty.
 *
 * Čisté funkce bez importů za běhu — `nactiPobockyBezUctu` dostane volání
 * databáze zvenku (`(fn, args) => supabase.rpc(fn, args)`), takže jde
 * zkoušet Nodem: scripts/finance-ucty-pobocek.test.mjs. Totéž
 * `nactiUctyMimoPobocek` — klient Supabase je jen typ, test podvrhne vlastní.
 *
 * SPOLEČNÝ FIREMNÍ ÚČET (dodatek 3d, rozhodnutí Šéfíka 25. 11. 2026 —
 * otázky 98 a 114): Bernard Bar Tábor i Restaurace Černá Perla platí přes
 * jeden firemní účet bez pobočky. Pobočka bez vlastního účtu je u firmy
 * s AKTIVNÍM firemním účtem normální stav, ne chyba — stránky ji místo
 * varováním jen klidně vysvětlí (`rozhodnoutBezUctuFirmy`). Jestli firma
 * aktivní firemní účet má, říká zase jen databáze (`nactiFiremniUcet`,
 * public.firma_ma_firemni_ucet) — i na pobočce, kde ho přes RLS vidět
 * není. Platby firemního účtu se žádné pobočce nepřipisují (otázka 280).
 */

import type { getServerSupabase } from './supabase/server.ts'

/** Hodnota výběru pobočky pro účet BEZ pobočky — výslovná volba, ne prázdné pole. */
export const FIREMNI_VOLBA = 'firma'

/** Popisek účtu bez pobočky (výběr, výpis účtů, sloupec „Účet / pobočka"). */
export const FIREMNI_UCET = 'Firemní účet (bez pobočky)'

/** Řádek firemních účtů v Cashflow a výsledovce celé firmy. */
export const FIREMNI_UCTY = 'Firemní účty (bez pobočky)'

/** Odkaz na místo, kde se účet pobočce přiřazuje (Platby celé firmy, sekce Platební účty). */
export const KOTVA_UCTU = 'platebni-ucty'

/**
 * Kotva karty JEDNOHO účtu v sekci Platební účty. Na ni se stránka vrací
 * po úpravě účtu — karta má pod sebou formulář, takže u čtvrtého a dalšího
 * účtu (na telefonu u třetího) by kotva celé sekce nechala účet i jeho
 * hlášku pod okrajem obrazovky.
 */
export function kotvaUctu(ucetId: string): string {
  return `ucet-${ucetId}`
}

/**
 * Název práva `finance.manage` tak, jak ho majitel vidí v Nastavení →
 * Role (katalog `permissions`, 20260823120100_catalog.sql). Hlášky „kdo to
 * smí" ho musí jmenovat stejně — dřív psaly „Správa financí", právo, které
 * na obrazovce práv není.
 */
export const PRAVO_SPRAVY_FINANCI = 'Zadávat faktury a náklady'

/** Kdo spravuje platební účty (přiřazení pobočky, úprava, import výpisů). */
export const KDO_SPRAVUJE_UCTY = `ten, kdo má právo „${PRAVO_SPRAVY_FINANCI}“ za celou firmu`

/** Název práva `faktury.read` z obrazovky Role (20260915100000_modul_faktury.sql). */
export const PRAVO_CIST_FAKTURY = 'Vidět přijaté faktury'

/**
 * Kdo hledá a potvrzuje návrhy párování (`smi_potvrdit_parovani`): obě
 * práva za celou firmu, pojmenovaná jako na obrazovce Role.
 */
export const KDO_PARUJE = `ten, kdo má právo „${PRAVO_SPRAVY_FINANCI}“ i „${PRAVO_CIST_FAKTURY}“ za celou firmu`

export type PobockaBezUctu = { branchId: string; nazev: string }

export type PobockyBezUctu =
  | { stav: 'ok'; pobocky: PobockaBezUctu[] }
  /** `kod` = SQLSTATE z databáze (42501 = bez práva), když nějaký přišel. */
  | { stav: 'chyba'; text: string; kod?: string }

export const CHYBA_POBOCEK_BEZ_UCTU =
  'Nepodařilo se zjistit, které pobočky nemají platební účet — součty po pobočkách proto berte s rezervou a zkuste stránku obnovit.'

type VysledekRpc = { data: unknown; error: { message?: string | null; code?: string | null } | null }
export type VolaniRpc = (funkce: string, argumenty: Record<string, unknown>) => PromiseLike<VysledekRpc>

/**
 * Pobočky bez aktivního platebního účtu. `pobocka` null = všechny aktivní
 * pobočky firmy; s pobočkou jen ta (prázdný seznam = má účet).
 *
 * Chyba NIKDY není prázdný seznam: prázdný by znamenal „všechny pobočky
 * mají účet" a stránka by mlčela přesně tam, kde má mluvit.
 */
export async function nactiPobockyBezUctu(
  rpc: VolaniRpc,
  tenantId: string,
  pobocka: string | null = null,
): Promise<PobockyBezUctu> {
  let vysledek: VysledekRpc
  try {
    vysledek = await rpc('pobocky_bez_aktivniho_uctu', { p_tenant: tenantId, p_branch: pobocka })
  } catch {
    return { stav: 'chyba', text: CHYBA_POBOCEK_BEZ_UCTU }
  }
  if (vysledek.error) return { stav: 'chyba', text: CHYBA_POBOCEK_BEZ_UCTU, kod: vysledek.error.code ?? undefined }
  if (!Array.isArray(vysledek.data)) return { stav: 'chyba', text: CHYBA_POBOCEK_BEZ_UCTU }
  const pobocky: PobockaBezUctu[] = []
  for (const radek of vysledek.data as { pobocka_id?: unknown; nazev?: unknown }[]) {
    if (typeof radek?.pobocka_id !== 'string') return { stav: 'chyba', text: CHYBA_POBOCEK_BEZ_UCTU }
    pobocky.push({ branchId: radek.pobocka_id, nazev: typeof radek.nazev === 'string' ? radek.nazev : '' })
  }
  return { stav: 'ok', pobocky }
}

/** Má pobočka aktivní účet? `null` = nevíme (chyba načtení). */
export function maPobockaAktivniUcet(vysledek: PobockyBezUctu, pobocka: string): boolean | null {
  if (vysledek.stav !== 'ok') return null
  return !vysledek.pobocky.some((p) => p.branchId === pobocka)
}

// ---------------------------------------------------------------------
// Společný firemní účet (dodatek 3d)
// ---------------------------------------------------------------------

export type FiremniUcet =
  | { stav: 'ok'; ma: boolean }
  /** `kod` = SQLSTATE z databáze (42501 = bez práva), když nějaký přišel. */
  | { stav: 'chyba'; text: string; kod?: string }

export const CHYBA_FIREMNIHO_UCTU =
  'Nepodařilo se zjistit, jestli má firma aktivní firemní účet (bez pobočky), přes který pobočky platí — zkuste stránku obnovit.'

/**
 * Má firma AKTIVNÍ platební účet bez pobočky? Jen ano/ne z databáze
 * (public.firma_ma_firemni_ucet, migrace 20261121100000) — funguje i na
 * pobočce, kde firemní účet přes RLS vidět není, a nic o účtu neprozradí.
 *
 * Chyba NIKDY není „ne": „ne" by stránku přepnulo na varování, jako by
 * firma žádný účet neměla. Stránka chybu řekne (`CHYBA_FIREMNIHO_UCTU`).
 */
export async function nactiFiremniUcet(rpc: VolaniRpc, tenantId: string): Promise<FiremniUcet> {
  let vysledek: VysledekRpc
  try {
    vysledek = await rpc('firma_ma_firemni_ucet', { p_tenant: tenantId })
  } catch {
    return { stav: 'chyba', text: CHYBA_FIREMNIHO_UCTU }
  }
  if (vysledek.error) return { stav: 'chyba', text: CHYBA_FIREMNIHO_UCTU, kod: vysledek.error.code ?? undefined }
  if (typeof vysledek.data !== 'boolean') return { stav: 'chyba', text: CHYBA_FIREMNIHO_UCTU }
  return { stav: 'ok', ma: vysledek.data }
}

/**
 * Platí pobočky bez vlastního účtu přes firemní účet? `true` jen tehdy,
 * když to databáze řekla. Chyba = `false` — stránka zůstane u dosavadní
 * věty „nemá účet" a chybu řekne zvlášť (`hlaskaBezUctuPobocky`,
 * `rozhodnoutBezUctuFirmy`); klidné vysvětlení se neukáže naslepo.
 */
export function platiPresFiremniUcet(firemni: FiremniUcet): boolean {
  return firemni.stav === 'ok' && firemni.ma
}

/** Pohled pobočky: pobočka bez vlastního účtu u firmy, která platí přes firemní účet. */
export const PRES_FIREMNI_UCET_POBOCKA =
  'Platby pobočky můžou chodit přes firemní účet, který tady nevidíte; jsou v přehledu za celou firmu.'

/** Krátký důvod „–" v kartě nebo buňce pobočky, která platí přes firemní účet (KPI, Rozpočty). */
export const KRATCE_PRES_FIREMNI_UCET = 'platí přes firemní účet — čísla jsou v přehledu za celou firmu'

/** Text odkazu na přiřazení vlastního účtu — jen nenápadná možnost pro toho, kdo smí, ne výzva. */
export const ODKAZ_VLASTNI_UCET = 'Přiřadit pobočce vlastní účet'

/**
 * Štítek u pobočky bez vlastního aktivního účtu v Cashflow celé firmy.
 * Čísla zůstávají, jak jsou — mění se jen to, co se o nich říká.
 */
export function stitekPobockyBezUctu(firemni: FiremniUcet): string {
  return platiPresFiremniUcet(firemni)
    ? 'Platí přes firemní účet — zůstatek je v přehledu za celou firmu'
    : 'Bez aktivního účtu — zůstatek appka nezná'
}

/**
 * Co stránka CELÉ FIRMY řekne o pobočkách bez vlastního aktivního účtu:
 *   * `nic` — každá aktivní pobočka účet má;
 *   * `chyba` — nepodařilo se zjistit, kdo účet nemá;
 *   * `varovani` — firma nemá žádný aktivní firemní účet: pobočky bez
 *     účtu se jmenují varováním (jako do dodatku 3d);
 *   * `vysvetleni` — firma má aktivní firemní účet: pobočky platí přes
 *     něj, to je normální stav, stačí klidná věta;
 *   * `nevime` — nepodařilo se zjistit, jestli firma firemní účet má:
 *     varování zůstane a k němu věta o chybě. Chyba není „ne".
 */
export type BezUctuFirmy =
  | { druh: 'nic' }
  | { druh: 'chyba'; text: string }
  | { druh: 'varovani'; pobocky: PobockaBezUctu[] }
  | { druh: 'vysvetleni'; pobocky: PobockaBezUctu[] }
  | { druh: 'nevime'; pobocky: PobockaBezUctu[]; text: string }

export function rozhodnoutBezUctuFirmy(bezUctu: PobockyBezUctu, firemni: FiremniUcet): BezUctuFirmy {
  if (bezUctu.stav === 'chyba') return { druh: 'chyba', text: bezUctu.text }
  if (bezUctu.pobocky.length === 0) return { druh: 'nic' }
  if (firemni.stav === 'chyba') return { druh: 'nevime', pobocky: bezUctu.pobocky, text: firemni.text }
  return firemni.ma
    ? { druh: 'vysvetleni', pobocky: bezUctu.pobocky }
    : { druh: 'varovani', pobocky: bezUctu.pobocky }
}

/**
 * Klidná věta pro pohled Celá firma: pobočky bez vlastního účtu platí
 * přes firemní účet. Jména poboček z dat. `null` = žádná taková.
 */
export function vetaPobockyPresFiremniUcet(pobocky: readonly PobockaBezUctu[]): string | null {
  if (pobocky.length === 0) return null
  const nazvy = pobocky.map((p) => p.nazev.trim() || 'Pobočka bez názvu')
  const jedna = pobocky.length === 1
  return `${vycet(nazvy)} ${jedna ? 'nemá' : 'nemají'} vlastní platební účet a platí přes firemní účet. `
    + `Jeho platby jsou v přehledu za celou firmu, do čísel ${jedna ? 'pobočky' : 'poboček'} se nepočítají.`
}

/**
 * Krátká věta pro stránku POBOČKY (Platby bez faktury): nemá aktivní účet,
 * nebo se to nepodařilo zjistit. `null` = účet má, nic se neříká.
 * Chyba se řekne nahlas — prázdná fronta by jinak vypadala jako „žádné
 * platby bez faktury".
 *
 * Firma s aktivním firemním účtem (dodatek 3d): pobočka bez vlastního
 * účtu platí přes něj — věta to řekne klidně. Nevíme-li, jestli firma
 * firemní účet má, je to chyba, ne „nemá".
 */
export function vetaUctuPobocky(
  vysledek: PobockyBezUctu,
  pobocka: string,
  firemni: FiremniUcet,
): { text: string; chyba: boolean } | null {
  if (vysledek.stav === 'chyba') return { text: vysledek.text, chyba: true }
  if (maPobockaAktivniUcet(vysledek, pobocka) !== false) return null
  if (firemni.stav === 'chyba') return { text: `Pobočka nemá aktivní platební účet. ${firemni.text}`, chyba: true }
  return firemni.ma
    ? { text: PRES_FIREMNI_UCET_POBOCKA, chyba: false }
    : { text: 'Pobočka nemá aktivní platební účet.', chyba: false }
}

/** „A", „A a B", „A, B a C". */
function vycet(nazvy: readonly string[]): string {
  if (nazvy.length <= 1) return nazvy[0] ?? ''
  return `${nazvy.slice(0, -1).join(', ')} a ${nazvy[nazvy.length - 1]}`
}

/**
 * Věta pro pohled Celá firma: které aktivní pobočky nemají aktivní účet
 * a co to znamená pro součty. `null` = všechny mají účet (nic se neříká).
 */
export function vetaPobockyBezUctu(pobocky: readonly PobockaBezUctu[]): string | null {
  if (pobocky.length === 0) return null
  const nazvy = pobocky.map((p) => p.nazev.trim() || 'Pobočka bez názvu')
  const jedna = pobocky.length === 1
  return `${jedna ? 'Pobočka' : 'Pobočky'} ${vycet(nazvy)} ${jedna ? 'nemá' : 'nemají'} aktivní platební účet, `
    + `takže ${jedna ? 'její' : 'jejich'} příjmy a výdaje v součtech po pobočkách nejsou. `
    + 'Co jde přes firemní účet (bez pobočky), je jen v číslech celé firmy.'
}

/**
 * Věta pro stránku pobočky bez účtu — a KDE se účet přiřazuje, jen tomu,
 * kdo to smí (Správa financí za celou firmu). Ostatním se řekne, kdo to
 * udělá, ne cesta, na které by narazili na „nemáte oprávnění".
 *
 * Firma s aktivním firemním účtem (dodatek 3d): pobočka platí přes něj —
 * žádná výzva k přiřazení, jen klidná věta; kdo smí, dostane cestu jako
 * nenápadnou možnost. Nevíme-li, jestli firma firemní účet má, zůstane
 * dosavadní věta a k ní, že se to nepodařilo zjistit.
 */
export function hlaskaBezUctuPobocky(smiPrirazovat: boolean, firemni: FiremniUcet): string {
  if (platiPresFiremniUcet(firemni)) {
    return smiPrirazovat
      ? `${PRES_FIREMNI_UCET_POBOCKA} Kdyby pobočka měla mít vlastní účet, přiřadíte ho v pohledu Celá firma → Platby → Platební účty.`
      : PRES_FIREMNI_UCET_POBOCKA
  }
  const zaklad = 'Pobočka zatím nemá aktivní platební účet, takže skutečné příjmy a výdaje se pro ni nedají spočítat.'
  const veta = smiPrirazovat
    ? `${zaklad} Účet pobočce přiřadíte v pohledu Celá firma → Platby → Platební účty.`
    : `${zaklad} Účet pobočce může přiřadit ${KDO_SPRAVUJE_UCTY}.`
  return firemni.stav === 'chyba' ? `${veta} ${firemni.text}` : veta
}

/**
 * Aktivní pobočky firmy pro KPI Přehledu z odpovědi dotazu na `branches`.
 * Chyba dotazu NENÍ „firma nemá pobočky" (dodatek 3d, stejně jako
 * Rozpočty): KPI by se spočítaly nad prázdným seznamem a tiše ukázaly
 * nuly a „0 z 0 provozoven". `null` = nepodařilo se načíst — stránka KPI
 * nepočítá a řekne „Přehled se nepodařilo načíst.".
 */
export function pobockyProKpi(odpoved: { data: unknown; error: unknown }): { id: string; name: string }[] | null {
  if (odpoved.error || !Array.isArray(odpoved.data)) return null
  return odpoved.data as { id: string; name: string }[]
}

/** Pobočka firmy, jak ji čtou Platby (`branches`, bez smazaných). */
type Pobocka = { id: string; name: string; active: boolean }

/**
 * Sloupec „Účet / pobočka" v seznamu plateb celé firmy: název účtu a kam
 * se jeho platby počítají. Platba firemního účtu je výslovně označená —
 * v pohledu pobočky není a nikam se nerozpočítává.
 */
export function popisUctuPlatby(
  ucet: { nazev?: string | null; branch_id?: string | null } | null | undefined,
  pobocky: readonly Pobocka[],
): { ucet: string; kam: string } {
  if (!ucet) return { ucet: '—', kam: '' }
  const nazev = (ucet.nazev ?? '').trim() || 'Účet bez názvu'
  if (!ucet.branch_id) return { ucet: nazev, kam: FIREMNI_UCET }
  const pobocka = pobocky.find((b) => b.id === ucet.branch_id)
  if (!pobocka) return { ucet: nazev, kam: 'Pobočka mimo seznam' }
  return { ucet: nazev, kam: pobocka.active ? pobocka.name : `${pobocka.name} (vypnutá)` }
}

export type UcetMimoPobocky = { id: string; nazev: string; duvod: 'vypnuta' | 'mimo_seznam'; pobocka: string | null }

/**
 * Účty, jejichž pobočka není mezi AKTIVNÍMI pobočkami firmy: vypnutá,
 * smazaná nebo jiné firmy. Jejich platby se nepočítají do součtů žádné
 * aktivní pobočky ani firemních účtů — stránka je ukáže s nabídkou opravy.
 * Nic se nepřesouvá samo (krok 3, bod 4).
 */
export function uctyMimoAktivnichPobocek(
  ucty: readonly { id: string; nazev: string; branch_id: string | null }[],
  pobocky: readonly Pobocka[],
): UcetMimoPobocky[] {
  const vysledek: UcetMimoPobocky[] = []
  for (const u of ucty) {
    if (u.branch_id === null) continue
    const pobocka = pobocky.find((b) => b.id === u.branch_id)
    if (pobocka?.active) continue
    vysledek.push({
      id: u.id,
      nazev: u.nazev,
      duvod: pobocka ? 'vypnuta' : 'mimo_seznam',
      pobocka: pobocka ? pobocka.name : null,
    })
  }
  return vysledek
}

/** Věta k účtu mimo aktivní pobočky (u účtu ve výpisu Platebních účtů). */
export function vetaUctuMimoPobocky(u: UcetMimoPobocky): string {
  const kde = u.duvod === 'vypnuta'
    ? `patří vypnuté pobočce ${u.pobocka ?? ''}`.trimEnd()
    : 'patří pobočce, která už v seznamu není (smazaná, nebo jiné firmy)'
  return `Účet ${kde} — jeho platby se nepočítají do součtů žádné aktivní pobočky ani firemních účtů. `
    + 'Vyberte mu aktivní pobočku, nebo „Firemní účet (bez pobočky)“ — sám se nepřesune.'
}

export type UctyMimoPobocek =
  | { stav: 'ok'; ucty: UcetMimoPobocky[] }
  | { stav: 'chyba'; text: string }

export const CHYBA_UCTU_MIMO_POBOCKY =
  'Nepodařilo se zjistit, jestli některý platební účet nepatří vypnuté nebo smazané pobočce — zkuste stránku obnovit.'

type VysledekDotazu = { data: unknown; error: unknown }
/** Klient Supabase pod přihlášeným (jen typ — za běhu se nic nenačítá; Node test podvrhne vlastní). */
type KlientUctu = Awaited<ReturnType<typeof getServerSupabase>>

/**
 * Účty firmy mimo aktivní pobočky — pro stránky CELÉ FIRMY (Přehled,
 * Cashflow, Rozpočty). Stejná definice jako u výpisu účtů v Platbách
 * (`uctyMimoAktivnichPobocek` nad všemi účty a nesmazanými pobočkami):
 * jejich platby nejsou v součtech po pobočkách ani ve firemních účtech
 * (app.cashflow_prehled bere jen aktivní pobočky), takže stránka musí
 * říct, že něco chybí, ne mlčet.
 *
 * Přes RLS jako přihlášený: Správa financí za celou firmu vidí i účty na
 * smazané pobočce (politika platebni_ucty_spravce_cte), čtenář bez správy
 * ne (app.visible_branch_ids smazané pobočky vynechá) — jemu věta řekne
 * jen o tom, co vidí. Opravit to stejně smí jen správa za celou firmu.
 */
export async function nactiUctyMimoPobocek(klient: KlientUctu, tenantId: string): Promise<UctyMimoPobocek> {
  let ucty: VysledekDotazu
  let pobocky: VysledekDotazu
  try {
    ;[ucty, pobocky] = await Promise.all([
      klient.from('platebni_ucty').select('id, nazev, branch_id').eq('tenant_id', tenantId),
      klient.from('branches').select('id, name, active').eq('tenant_id', tenantId).is('deleted_at', null),
    ])
  } catch {
    return { stav: 'chyba', text: CHYBA_UCTU_MIMO_POBOCKY }
  }
  if (ucty.error || pobocky.error || !Array.isArray(ucty.data) || !Array.isArray(pobocky.data)) {
    return { stav: 'chyba', text: CHYBA_UCTU_MIMO_POBOCKY }
  }
  return {
    stav: 'ok',
    ucty: uctyMimoAktivnichPobocek(
      ucty.data as { id: string; nazev: string; branch_id: string | null }[],
      pobocky.data as Pobocka[],
    ),
  }
}

/**
 * Věta pro stránky celé firmy: které účty patří vypnuté nebo smazané
 * pobočce a co to znamená pro čísla. `null` = žádný takový.
 */
export function vetaUctuMimoPobocekFirmy(ucty: readonly UcetMimoPobocky[]): string | null {
  if (ucty.length === 0) return null
  const nazvy = ucty.map((u) => `„${u.nazev.trim() || 'Účet bez názvu'}“`)
  const jeden = ucty.length === 1
  return `${jeden ? 'Platební účet' : 'Platební účty'} ${vycet(nazvy)} patří vypnuté nebo smazané pobočce, `
    + `takže ${jeden ? 'jeho' : 'jejich'} platby nejsou v součtech po pobočkách ani ve firemních účtech. `
    + 'Sám se žádný nepřesune.'
}

/**
 * Hláška, když databáze odmítla založit připojení banky k platebnímu účtu
 * (app/[rozsah]/finance/integrace/banka/akce.ts).
 *   * 23505 = na účet už míří živé připojení (index jednoho připojení na účet);
 *   * 23514 + „vypnutý" = účet je vypnutý (spoušť
 *     app.hlida_pripojeni_vypnuteho_uctu, 20261121100000).
 */
export function hlaskaZalozeniPripojeni(chyba: { code?: string | null; message?: string | null } | null | undefined): string {
  if (chyba?.code === '23505') return 'Tenhle platební účet už má živé bankovní připojení.'
  if (chyba?.code === '23514' && /vypnut/i.test(chyba.message ?? '')) {
    return 'Platební účet je vypnutý. Nejdřív ho zapněte v pohledu Celá firma → Platby → Platební účty, pak k němu připojte banku.'
  }
  return 'Připojení se nepodařilo založit.'
}

/**
 * Adresa zpět na Platební účty po úpravě účtu. Stránka sjede na kartu
 * TOHO účtu (`kotvaUctu`) a hláška (chyba i „Účet uložen") se kreslí
 * v ní, hned pod názvem účtu. Účet neznáme (`ucetId` null) = kotva
 * začátku sekce účtů, hláška tam.
 */
export function adresaUctu(rozsah: string, hlaska: { chyba: string } | { upraveno: true }, ucetId: string | null): string {
  const parametr = 'chyba' in hlaska ? `chyba=${encodeURIComponent(hlaska.chyba)}` : 'ucet_upraven=1'
  const kotva = ucetId ? kotvaUctu(ucetId) : KOTVA_UCTU
  return `/${rozsah}/finance/platby?${parametr}&ucet=${encodeURIComponent(ucetId ?? '')}#${encodeURIComponent(kotva)}`
}

/**
 * Kam na stránce Plateb patří hláška z adresy: bez `ucet` nahoru (zápis
 * platby, import…), s `ucet` jednoho z vypsaných účtů k němu, jinak na
 * začátek sekce účtů.
 *
 * `kotva` u začátku sekce: adresa míří na kartu účtu, která na stránce
 * není (účet mezitím zmizel, nebo se seznam účtů nenačetl). Hláška na
 * začátku sekce pak tu kotvu nese sama — jinak by stránka zůstala nahoře
 * a hláška by byla mimo obrazovku.
 */
export function mistoHlaskyUctu(
  ucetParam: string | string[] | undefined,
  idUctu: readonly string[],
): { kde: 'nahore' } | { kde: 'sekce'; kotva: string | null } | { kde: 'ucet'; id: string } {
  if (typeof ucetParam !== 'string') return { kde: 'nahore' }
  if (idUctu.includes(ucetParam)) return { kde: 'ucet', id: ucetParam }
  return { kde: 'sekce', kotva: ucetParam ? kotvaUctu(ucetParam) : null }
}
