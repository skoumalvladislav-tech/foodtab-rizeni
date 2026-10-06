/**
 * Fio banka — read-only adaptér (zadání §2: „čeká na připojení", nikdy
 * „připojeno" bez ověřeného přístupu).
 *
 * Fio je jediná česká banka, u které appka smí napojit bankovní účet
 * BEZ licence AISP u ČNB — majitel účtu si token (64 znaků, viz
 * `fio.cz/docs/cz/API_Bankovnictvi.pdf`, kap. 2) vygeneruje SÁM ve
 * svém internetovém bankovnictví, s výslovnou volbou „Sledování účtu"
 * (ne „…a zadávání platebních příkazů" — appka tu druhou volbu NIKDY
 * nenabízí ani nevyžaduje, banka zůstává výhradně pro čtení, CLAUDE.md).
 * Ostatní banky (KB/ČSOB/ČS/Raiffeisenbank, PSD2 open banking) by appka
 * směla napojit jen přes licencovaného zprostředkovatele (AISP) —
 * viz `lib/integrace-gocardless.ts`, kostra.
 *
 * Token je vázaný na JEDEN konkrétní účet (ne na klienta) a omezený na
 * jedno volání za 30 sekund (HTTP 409 při porušení) — appka proto NIKDY
 * nevolá stejný token dvakrát v jednom běhu synchronizace a cron běží
 * v řádu hodin, ne sekund.
 *
 * Čistá logika (parsování odpovědi) je testovatelná bez sítě
 * (`node --experimental-strip-types --conditions=react-server
 * scripts/integrace-fio.test.mjs`); `zavolatFioApi` je jediné místo
 * s IO, žádné jiné volání z appky na `fioapi.fio.cz` nechodí.
 */

import 'server-only'

import type { RadekImportu } from './finance-csv-import.ts'

const ZAKLAD = 'https://fioapi.fio.cz/v1/rest'

/** Appka žádá jen posledních ~14 dní na jedno volání — hluboko pod
 * limitem 90 dní (HTTP 422 bez dočasného odemčení) a pod stropem
 * 50 000 pohybů (HTTP 413). Opakovaný/přesahující se dotaz nezdvojí
 * nic — dedup je na `(ucet_id, externi_id)` v `importovat_transakce`. */
export const POCET_DNU_ZPATKY = 14

export type FioInfo = {
  cisloUctu: string
  kodBanky: string
  mena: string
  zustatekHaleru: number
}

export type FioVysledek =
  | { stav: 'ok'; info: FioInfo; radky: RadekImportu[] }
  | { stav: 'chyba'; duvod: string }

/** `column22`..`column0` apod. — číslovaná pole, ne jmenovaná (Fio JSON tvar). */
type FioSloupec = { value: unknown; name: string; id: number } | null
type FioTransakceRaw = Record<string, FioSloupec>

const SLOUPEC = {
  idPohybu: 22,
  datum: 0,
  objem: 1,
  protiucet: 2,
  nazevProtiuctu: 10,
  vs: 5,
  ks: 4,
  ss: 6,
  zprava: 16,
} as const

function hodnotaSloupce(t: FioTransakceRaw, index: number): unknown {
  return t[`column${index}`]?.value ?? null
}

/**
 * Fio v JSONu vrací datum jako epoch v milisekundách (číslo), ne ISO
 * text — na rozdíl od XML/CSV. Epoch je PRAŽSKÁ půlnoc (ověřeno proti
 * `API_Bankovnictvi.pdf`, kap. 5.3.1.6 — dotaz „od 26. 6. 2012" vrací
 * `dateStart: 1340661600000`, což je `2012-06-26T00:00:00+02:00`).
 * `toISOString().slice(0,10)` by vzal UTC den, a protože Praha je
 * +1/+2 podle letního času, vyšel by o den dřív — ne jednou za čas,
 * ale u KAŽDÉ transakce. `en-CA` formát dá rok-měsíc-den přímo
 * v pražském pásmu, správně v zimě (CET) i v létě (CEST).
 */
function epochNaIsoDatum(hodnota: unknown): string | null {
  if (typeof hodnota !== 'number' || !Number.isFinite(hodnota)) return null
  const d = new Date(hodnota)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(d)
}

function naHalereSeZnamenkem(objem: unknown): number | null {
  if (typeof objem !== 'number' || !Number.isFinite(objem)) return null
  return Math.round(objem * 100)
}

/**
 * Čistá logika — rozparsuje odpověď `accountStatement` na info o účtu
 * a seznam `RadekImportu` (stejný tvar jako CSV import, stejná
 * navazující cesta — `importovat_transakce`). Žádné IO, testovatelné
 * přímo Nodem.
 */
export function naparsovatOdpovedFio(telo: unknown): FioVysledek {
  const statement = (telo as { accountStatement?: unknown })?.accountStatement as
    | { info?: Record<string, unknown>; transactionList?: { transaction?: unknown } }
    | undefined

  if (!statement || !statement.info) {
    return { stav: 'chyba', duvod: 'Odpověď Fio API nemá očekávaný tvar (chybí accountStatement.info).' }
  }

  const info = statement.info
  const zustatek = naHalereSeZnamenkem(info.closingBalance)
  if (typeof info.accountId !== 'string' || typeof info.bankId !== 'string' || typeof info.currency !== 'string' || zustatek === null) {
    return { stav: 'chyba', duvod: 'Odpověď Fio API má neúplné údaje o účtu.' }
  }

  // Bez nových pohybů Fio vrátí jen `info`, `transaction` chybí. Když je
  // pohyb jen jeden, bývá to objekt, ne pole — ošetřeno pro oba tvary.
  const syrove = statement.transactionList?.transaction
  const seznam: FioTransakceRaw[] = Array.isArray(syrove) ? syrove : syrove ? [syrove as FioTransakceRaw] : []

  const radky: RadekImportu[] = []
  for (const t of seznam) {
    const datum = epochNaIsoDatum(hodnotaSloupce(t, SLOUPEC.datum))
    const castkaSeZnamenkem = naHalereSeZnamenkem(hodnotaSloupce(t, SLOUPEC.objem))
    const idPohybu = hodnotaSloupce(t, SLOUPEC.idPohybu)

    // Řádek bez data/částky/id pohybu appka přeskočí, ne spadne celý
    // import — jedna poškozená položka ve statement nemá shodit zbytek.
    if (!datum || castkaSeZnamenkem === null || idPohybu === null) continue

    const nazevProtiuctu = hodnotaSloupce(t, SLOUPEC.nazevProtiuctu)
    const protiucet = hodnotaSloupce(t, SLOUPEC.protiucet)

    radky.push({
      datum,
      smer: castkaSeZnamenkem < 0 ? 'vydaj' : 'prijem',
      castkaHaleru: Math.abs(castkaSeZnamenkem),
      // Fio nedává měnu per transakci v tomhle výpisu — appka použije
      // měnu ÚČTU (info.currency, o pár řádků výš ověřená jako string).
      // Fio účet má jednu měnu; cizoměnová platba na něj dojde už
      // přepočtená do měny účtu (appka si tohle nevymýšlí, jen ho
      // nedomýšlí jako CZK natvrdo, jak appka dřív dělala).
      mena: info.currency,
      protistrana: (typeof nazevProtiuctu === 'string' && nazevProtiuctu) || (typeof protiucet === 'string' && protiucet) || '',
      vs: String(hodnotaSloupce(t, SLOUPEC.vs) ?? ''),
      poznamka: String(hodnotaSloupce(t, SLOUPEC.zprava) ?? ''),
      externiId: String(idPohybu),
    })
  }

  return {
    stav: 'ok',
    info: { cisloUctu: info.accountId, kodBanky: info.bankId, mena: info.currency, zustatekHaleru: zustatek },
    radky,
  }
}

/** Srozumitelná hláška pro známé chybové kódy Fio API (zadání, kap. 8 dokumentace). */
function hlaskaProStav(status: number): string {
  if (status === 409) return 'Fio API: mezi dvěma voláními musí uplynout aspoň 30 sekund (token je omezen).'
  if (status === 422) return 'Fio API: data starší než 90 dní vyžadují dočasné odemčení v internetovém bankovnictví.'
  if (status === 500) return 'Fio API: token neexistuje nebo není aktivní — zkontrolujte ho v Integracích.'
  if (status === 413) return 'Fio API: příliš mnoho pohybů najednou, zkuste kratší období.'
  if (status === 404) return 'Fio API: adresa požadavku není platná.'
  return `Fio API odpovědělo chybou ${status}.`
}

async function zavolatFioApi(url: string): Promise<FioVysledek> {
  let odpoved: Response
  try {
    odpoved = await fetch(url, { method: 'GET' })
  } catch (e) {
    return { stav: 'chyba', duvod: `Fio API se nepodařilo spojit: ${e instanceof Error ? e.message : 'neznámá chyba'}` }
  }

  if (!odpoved.ok) return { stav: 'chyba', duvod: hlaskaProStav(odpoved.status) }

  let telo: unknown
  try {
    telo = await odpoved.json()
  } catch {
    return { stav: 'chyba', duvod: 'Fio API vrátilo odpověď, které nešlo rozumět (ne JSON).' }
  }

  return naparsovatOdpovedFio(telo)
}

/** Pohyby za posledních `POCET_DNU_ZPATKY` dní — bezpečně hluboko pod limity (90 dní, 50 000 pohybů). */
export async function nactiPosledniPohybyFio(token: string): Promise<FioVysledek> {
  const dnes = new Date()
  const od = new Date(dnes)
  od.setDate(od.getDate() - POCET_DNU_ZPATKY)
  const naIso = (d: Date) => d.toISOString().slice(0, 10)
  return zavolatFioApi(`${ZAKLAD}/periods/${token}/${naIso(od)}/${naIso(dnes)}/transactions.json`)
}

/**
 * Jen info o účtu (bez zápisu pohybů) — pro ověření tokenu při
 * zakládání připojení. I nulový rozsah (dnes–dnes) vrátí `info`
 * (Fio ho vrací vždycky, i bez nových pohybů).
 */
export async function overitPripojeniFio(token: string): Promise<FioVysledek> {
  const dnes = new Date().toISOString().slice(0, 10)
  return zavolatFioApi(`${ZAKLAD}/periods/${token}/${dnes}/${dnes}/transactions.json`)
}
