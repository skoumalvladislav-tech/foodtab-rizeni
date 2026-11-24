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
 * zkoušet Nodem: scripts/finance-ucty-pobocek.test.mjs.
 */

/** Hodnota výběru pobočky pro účet BEZ pobočky — výslovná volba, ne prázdné pole. */
export const FIREMNI_VOLBA = 'firma'

/** Popisek účtu bez pobočky (výběr, výpis účtů, sloupec „Účet / pobočka"). */
export const FIREMNI_UCET = 'Firemní účet (bez pobočky)'

/** Řádek firemních účtů v Cashflow a výsledovce celé firmy. */
export const FIREMNI_UCTY = 'Firemní účty (bez pobočky)'

/** Odkaz na místo, kde se účet pobočce přiřazuje (Platby celé firmy, sekce Platební účty). */
export const KOTVA_UCTU = 'platebni-ucty'

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
    : `${zaklad} Účet pobočce může přiřadit ten, kdo má právo „Správa financí“ za celou firmu.`
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
