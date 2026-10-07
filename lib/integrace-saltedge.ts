/**
 * Salt Edge Partners Account Information API — AIS adaptér (zadání §7:
 * „Finbricks MULTIBANK a Salt Edge Partners Account Information" jako
 * hlavní kandidáti na multibankovního agregátora; Enable Banking se
 * 7.10.2026 přehodnocuje pro uvízlou aktivaci u poskytovatele).
 *
 * ENDPOINTY NÍŽE JSOU OVĖŘENÉ přímo z `docs.saltedge.com/partners/v1/`
 * (WebFetch 7.10.2026), ne vymyšlené. CO V DOKUMENTACI NENÍ (a proto
 * tady NENÍ domýšleno): přesný formát `vs`/variabilního symbolu u
 * českých bank (Salt Edge je obecný EU formát, žádné dedikované pole
 * pro VS se nenašlo — appka ho nechává prázdné, ne hádá z `description`).
 *
 * ———————————————————————————————————————————————————————————————
 * NEOVĖŘENO PROTI ŽIVÉMU API — appka nemá partnerský účet.
 *
 * Salt Edge NENÍ samoobslužný: `App-id`/`Secret` appka dostane až po
 * „request invitation" (obchodní krok u Salt Edge, appka ho sama
 * nesmí iniciovat — zadání §1: „neposílej obchodní poptávky"). Dokud
 * účet nevznikne, appka nemá ani sandbox — tenhle soubor je proto
 * kontraktově správný tvar, NE vyzkoušený klient. `jeNakonfigurovano()`
 * appku chrání před tím, aby to předstírala (stejný vzor jako
 * `integrace-enablebanking.ts`).
 * ———————————————————————————————————————————————————————————————
 */

import 'server-only'

import type { RadekImportu } from './finance-csv-import.ts'
import type { BankDataProvider, VysledekOvereni, VysledekTransakci, VysledekZustatku } from './bank-provider-contract.ts'

const ZAKLAD = 'https://www.saltedge.com/api/partners/v1'

/** Appka se nikdy nepokusí volat API bez obou klíčů — appka je nedomýšlí ani nezkouší prázdné. */
export function jeNakonfigurovano(): boolean {
  return Boolean(process.env.SALTEDGE_APP_ID && process.env.SALTEDGE_SECRET)
}

function hlavicky(): Record<string, string> {
  return {
    'App-id': process.env.SALTEDGE_APP_ID ?? '',
    Secret: process.env.SALTEDGE_SECRET ?? '',
    Accept: 'application/json',
    'Content-type': 'application/json',
  }
}

type SaltEdgeAccount = {
  id: string
  connection_id: string
  name: string
  nature: string
  balance: number
  available_balance?: number
  currency_code: string
}

type SaltEdgeTransaction = {
  id: string
  amount: number
  currency_code: string
  made_on: string
  description: string
  status: 'posted' | 'pending'
  duplicated: boolean
}

async function zavolatSaltEdge<T>(cesta: string): Promise<{ stav: 'ok'; data: T; nextId: string | null } | { stav: 'chyba'; duvod: string }> {
  let odpoved: Response
  try {
    odpoved = await fetch(`${ZAKLAD}${cesta}`, { headers: hlavicky() })
  } catch (e) {
    return { stav: 'chyba', duvod: `Salt Edge API se nepodařilo spojit: ${e instanceof Error ? e.message : 'neznámá chyba'}` }
  }

  if (!odpoved.ok) {
    let detail = ''
    try {
      const telo = (await odpoved.json()) as { error?: { message?: string } }
      detail = telo.error?.message ?? ''
    } catch {
      // Appka u chyby bez čitelného těla ukáže aspoň stavový kód.
    }
    return { stav: 'chyba', duvod: `Salt Edge API odpovědělo chybou ${odpoved.status}${detail ? `: ${detail}` : '.'}` }
  }

  const telo = (await odpoved.json()) as { data: T; meta?: { next_id?: string } }
  return { stav: 'ok', data: telo.data, nextId: telo.meta?.next_id ?? null }
}

/**
 * Zahájení souhlasu (Connect Widget přes Lead Session) — appka
 * přesměruje uživatele na vrácenou `redirect_url`, stejný vzor jako
 * `enableBankingProvider.zahajitPripojeni`. `return_to` appka posílá
 * explicitně (dokumentace: bez něj appka musí mít `home_url` nastavené
 * v Client Dashboardu — appka na tohle nastavení nespoléhá, posílá
 * adresu vždy).
 */
export async function zahajitPripojeniSaltEdge(
  navratovaAdresa: string,
  zeme = 'CZ',
): Promise<{ stav: 'ok'; presmerovatNa: string } | { stav: 'chyba'; duvod: string }> {
  if (!jeNakonfigurovano()) return { stav: 'chyba', duvod: 'Salt Edge není nastaven (chybí partnerský účet — appka ho nesmí sama zřídit).' }

  let odpoved: Response
  try {
    odpoved = await fetch(`${ZAKLAD}/lead_sessions/create`, {
      method: 'POST',
      headers: hlavicky(),
      body: JSON.stringify({
        country_code: zeme,
        consent: {
          scopes: ['account_details', 'transactions_details'],
        },
        attempt: {
          return_to: navratovaAdresa,
        },
      }),
    })
  } catch (e) {
    return { stav: 'chyba', duvod: `Salt Edge API se nepodařilo spojit: ${e instanceof Error ? e.message : 'neznámá chyba'}` }
  }

  if (!odpoved.ok) return { stav: 'chyba', duvod: `Salt Edge API odpovědělo chybou ${odpoved.status}.` }

  const telo = (await odpoved.json()) as { data?: { redirect_url?: string } }
  if (!telo.data?.redirect_url) return { stav: 'chyba', duvod: 'Salt Edge API nevrátilo adresu pro přesměrování.' }

  return { stav: 'ok', presmerovatNa: telo.data.redirect_url }
}

export async function nactiUctySaltEdge(connectionId: string): Promise<VysledekOvereni> {
  const vysledek = await zavolatSaltEdge<SaltEdgeAccount[]>(`/accounts?connection_id=${encodeURIComponent(connectionId)}`)
  if (vysledek.stav === 'chyba') return vysledek

  return {
    stav: 'ok',
    ucty: vysledek.data.map((u) => ({
      providerAccountId: u.id,
      cisloUctu: u.name || null,
      iban: null,
      mena: u.currency_code,
      firemniUcet: null,
    })),
  }
}

export async function nactiZustatkySaltEdge(connectionId: string, accountId: string): Promise<VysledekZustatku> {
  const vysledek = await zavolatSaltEdge<SaltEdgeAccount[]>(`/accounts?connection_id=${encodeURIComponent(connectionId)}`)
  if (vysledek.stav === 'chyba') return vysledek

  const ucet = vysledek.data.find((u) => u.id === accountId)
  if (!ucet) return { stav: 'chyba', duvod: 'Účet se v odpovědi Salt Edge nenašel.' }

  const platnyK = new Date().toISOString()
  const zustatky = [{ typ: 'knihovni' as const, castkaHaleru: Math.round(ucet.balance * 100), mena: ucet.currency_code, platnyK }]
  if (ucet.available_balance != null) {
    zustatky.push({ typ: 'disponibilni' as const, castkaHaleru: Math.round(ucet.available_balance * 100), mena: ucet.currency_code, platnyK })
  }
  return { stav: 'ok', zustatky }
}

/**
 * Jen ZAÚČTOVANÉ (`status: 'posted'`) pohyby — `pending` appka
 * nevrací vůbec (`transakce` je ledger zaúčtovaných pohybů, ne
 * rozpracovaných; pending se appce vrátí jako posted při dalším
 * běhu, ne že by appka musela řešit přechod stavu).
 */
export async function nactiTransakceSaltEdge(connectionId: string, accountId: string): Promise<VysledekTransakci> {
  const vysledek = await zavolatSaltEdge<SaltEdgeTransaction[]>(
    `/transactions?connection_id=${encodeURIComponent(connectionId)}&account_id=${encodeURIComponent(accountId)}`,
  )
  if (vysledek.stav === 'chyba') return vysledek

  const radky: RadekImportu[] = vysledek.data
    .filter((t) => t.status === 'posted' && !t.duplicated)
    .map((t) => ({
      datum: t.made_on,
      smer: t.amount < 0 ? 'vydaj' : 'prijem',
      castkaHaleru: Math.round(Math.abs(t.amount) * 100),
      mena: t.currency_code,
      protistrana: t.description ?? '',
      // Salt Edge nemá dedikované pole pro VS — appka si ho nedomýšlí z popisu.
      vs: '',
      poznamka: t.description ?? '',
      externiId: t.id,
    }))

  return { stav: 'ok', radky }
}

export const saltEdgeProvider: BankDataProvider = {
  klic: 'saltedge',
  nazev: 'Salt Edge Partners Account Information',
  schopnosti: {
    zpusobPripojeni: 'souhlas_redirect',
    firemniUcty: true,
    soukromeUcty: true,
    dostupneZustatky: ['knihovni', 'disponibilni'],
    // Dokumentace neudává konkrétní strop historie per banka — appka ho nedomýšlí.
    historieDnu: null,
    // Salt Edge nemá dedikované pole pro VS (viz komentář u nactiTransakceSaltEdge).
    vsReference: false,
    pendingTransakce: true,
    inkrementalniSync: true,
  },

  async zahajitPripojeni(navratovaAdresa: string, zeme: string) {
    return zahajitPripojeniSaltEdge(navratovaAdresa, zeme)
  },

  // Kontrakt dává appce jen `ucet` (providerAccountId), ale Salt Edge
  // vyžaduje k němu i `connection_id` (appka ho má uložené z
  // `externi_ucet` při zahájení připojení) — appka proto v praxi volá
  // `nactiZustatkySaltEdge(connectionId, accountId)`/`nactiTransakceSaltEdge`
  // přímo, ne přes tyhle dvě metody kontraktu. Zůstávají tu jen pro
  // typovou shodu s `BankDataProvider` a hlásí to nahlas, ne tiše.
  async nactiZustatky(ucet: string): Promise<VysledekZustatku> {
    return { stav: 'chyba', duvod: `Salt Edge vyžaduje connection_id navíc k účtu ${ucet} — volejte nactiZustatkySaltEdge přímo.` }
  },

  async nactiTransakce(ucet: string): Promise<VysledekTransakci> {
    return { stav: 'chyba', duvod: `Salt Edge vyžaduje connection_id navíc k účtu ${ucet} — volejte nactiTransakceSaltEdge přímo.` }
  },
}
