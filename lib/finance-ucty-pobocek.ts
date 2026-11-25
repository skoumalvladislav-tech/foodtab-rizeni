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
 * Název práva `finance.manage` tak, jak ho majitel vidí v Nastavení →
 * Role (katalog `permissions`, 20260823120100_catalog.sql). Hlášky „kdo to
 * smí" ho musí jmenovat stejně — dřív psaly „Správa financí", právo, které
 * na obrazovce práv není.
 */
export const PRAVO_SPRAVY_FINANCI = 'Zadávat faktury a náklady'

/** Kdo spravuje platební účty (přiřazení pobočky, úprava, import výpisů). */
export const KDO_SPRAVUJE_UCTY = `ten, kdo má právo „${PRAVO_SPRAVY_FINANCI}“ za celou firmu`

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

/**
 * Krátká věta pro stránku POBOČKY (Platby bez faktury): nemá aktivní účet,
 * nebo se to nepodařilo zjistit. `null` = účet má, nic se neříká.
 * Chyba se řekne nahlas — prázdná fronta by jinak vypadala jako „žádné
 * platby bez faktury".
 */
export function vetaUctuPobocky(vysledek: PobockyBezUctu, pobocka: string): { text: string; chyba: boolean } | null {
  if (vysledek.stav === 'chyba') return { text: vysledek.text, chyba: true }
  return maPobockaAktivniUcet(vysledek, pobocka) === false
    ? { text: 'Pobočka nemá aktivní platební účet.', chyba: false }
    : null
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
 */
export function hlaskaBezUctuPobocky(smiPrirazovat: boolean): string {
  const zaklad = 'Pobočka zatím nemá aktivní platební účet, takže skutečné příjmy a výdaje se pro ni nedají spočítat.'
  return smiPrirazovat
    ? `${zaklad} Účet pobočce přiřadíte v pohledu Celá firma → Platby → Platební účty.`
    : `${zaklad} Účet pobočce může přiřadit ${KDO_SPRAVUJE_UCTY}.`
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
 * Adresa zpět na Platební účty po úpravě účtu. Stránka sjede na kotvu
 * sekce účtů — hláška (chyba i „Účet uložen") se proto kreslí U ÚČTU
 * (`ucet`), ne nahoře, kde by byla mimo obrazovku. Prázdné `ucet` = účet
 * neznáme, hláška nahoře v sekci účtů.
 */
export function adresaUctu(rozsah: string, hlaska: { chyba: string } | { upraveno: true }, ucetId: string | null): string {
  const parametr = 'chyba' in hlaska ? `chyba=${encodeURIComponent(hlaska.chyba)}` : 'ucet_upraven=1'
  return `/${rozsah}/finance/platby?${parametr}&ucet=${encodeURIComponent(ucetId ?? '')}#${KOTVA_UCTU}`
}

/**
 * Kam na stránce Plateb patří hláška z adresy: bez `ucet` nahoru (zápis
 * platby, import…), s `ucet` jednoho z vypsaných účtů k němu, jinak na
 * začátek sekce účtů.
 */
export function mistoHlaskyUctu(
  ucetParam: string | string[] | undefined,
  idUctu: readonly string[],
): { kde: 'nahore' } | { kde: 'sekce' } | { kde: 'ucet'; id: string } {
  if (typeof ucetParam !== 'string') return { kde: 'nahore' }
  return idUctu.includes(ucetParam) ? { kde: 'ucet', id: ucetParam } : { kde: 'sekce' }
}
