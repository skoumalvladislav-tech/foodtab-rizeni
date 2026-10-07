/**
 * Salt Edge Partners Account Information API — AIS adaptér.
 *
 * ROZHODNUTÍ ŠÉFÍKA (7.10.2026): první bankovní integrace Foodtab jde
 * přes Salt Edge Partner Program / Partners Account Information API
 * — ne přes Enable Banking (ten zůstává v kódu, ale dál se nerozvíjí;
 * uvízl na aktivaci u poskytovatele) a ne přes běžné (nepartnerské)
 * Account Information API (to je pro licencované AISP subjekty samotné,
 * jiný smluvní režim — appka ho NEPOUŽÍVÁ jako náhradu za partnerský
 * produkt).
 *
 * ENDPOINTY NÍŽE JSOU OVĖŘENÉ přímo z `docs.saltedge.com/partners/v1/`
 * (WebFetch 7.10.2026), ne vymyšlené. Zdroj pravdy pro cokoli
 * nejasného je VŽDY aktuální dokumentace, ne tenhle komentář.
 *
 * ———————————————————————————————————————————————————————————————
 * NEOVĖŘENO PROTI ŽIVÉMU API — appka nemá partnerský účet.
 *
 * Salt Edge NENÍ samoobslužný: `App-id`/`Secret` appka dostane až po
 * „request invitation" (obchodní krok u Salt Edge, appka ho sama
 * nesmí iniciovat — zadání §1: „neposílej obchodní poptávky",
 * „neuzavírej placenou smlouvu"). Dokud účet nevznikne, appka nemá
 * ani sandbox (dokumentace: „sandbox/fake poskytovatelé se odemknou
 * až po vzniku pozvaného účtu") — tenhle soubor je proto kontraktově
 * správný tvar, NE vyzkoušený klient. `jeNakonfigurovano()` appku
 * chrání před tím, aby to předstírala.
 *
 * DOKUMENTAČNÍ MEZERY (appka je NEDOMÝŠLÍ, jen je tu zapisuje, ať se
 * ověří s partnerským přístupem v ruce):
 *   - Přesný zdroj `callback_url` pro ověření podpisu webhooku —
 *     dokumentace neříká, jde-li o URL ZAREGISTROVANOU appkou v
 *     Partner Dashboardu, nebo URL PŘÍCHOZÍHO requestu. Appka používá
 *     `SALTEDGE_WEBHOOK_URL` (zaregistrovanou appkou), ne URL z
 *     requestu — bezpečnější výchozí bod, ale je to appčin výběr, ne
 *     dokumentovaný fakt.
 *   - Aktuální PRODUKČNÍ veřejný klíč pro ověření podpisu — appka ho
 *     NEHARDCODUJE z ukázky v dokumentaci (ta je výslovně neoznačená
 *     jako produkční/testovací), čte ho z `SALTEDGE_WEBHOOK_PUBLIC_KEY`.
 *   - Maximální `per_page` u transakcí — nespecifikováno, appka
 *     stránkuje přes `from_id`, dokud API vrací další stránku.
 * ———————————————————————————————————————————————————————————————
 */

import 'server-only'

import { createVerify } from 'node:crypto'
import type { RadekImportu } from './finance-csv-import.ts'
import type { BankDataProvider, BodZustatku, VysledekOvereni, VysledekTransakci, VysledekZustatku } from './bank-provider-contract.ts'

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

type SaltEdgeProvider = {
  code: string
  name: string
  country_code: string
  supported_account_types: ('personal' | 'business')[]
  mode: string
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

async function zavolatSaltEdge<T>(cesta: string): Promise<{ stav: 'ok'; data: T; dalsiId: string | null } | { stav: 'chyba'; duvod: string }> {
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
  return { stav: 'ok', data: telo.data, dalsiId: telo.meta?.next_id ?? null }
}

export type CeskaBanka = { kod: string; nazev: string; firemniUcty: boolean; osobniUcty: boolean }

/**
 * Skutečně dostupné banky PRO NÁŠ PARTNERSKÝ ÚČET — appka nikdy
 * nenabízí pevný seznam 10 požadovaných bank jako by byl potvrzený
 * (zadání: „Nabízej české banky podle skutečné dostupnosti pro náš
 * partnerský účet. Nezaměňuj osobní a firemní pokrytí."). Dokud appka
 * nemá klíče, vrátí se `chyba` — UI to NIKDY nenahradí pevným seznamem.
 */
export async function nactiBankyCz(): Promise<{ stav: 'ok'; banky: CeskaBanka[] } | { stav: 'chyba'; duvod: string }> {
  if (!jeNakonfigurovano()) return { stav: 'chyba', duvod: 'Salt Edge není nastaven (chybí partnerský účet).' }

  const vysledek = await zavolatSaltEdge<SaltEdgeProvider[]>('/providers?country_code=CZ')
  if (vysledek.stav === 'chyba') return vysledek

  return {
    stav: 'ok',
    banky: vysledek.data.map((p) => ({
      kod: p.code,
      nazev: p.name,
      firemniUcty: p.supported_account_types.includes('business'),
      osobniUcty: p.supported_account_types.includes('personal'),
    })),
  }
}

/**
 * Zahájení souhlasu (Connect Widget přes Lead Session) — appka
 * přesměruje uživatele na vrácenou `redirect_url`. `customer_id`
 * appka nastaví na `tenantId` — Salt Edge tím dostane STEJNÉ oddělení
 * klientů appka, ne jen appčina DB (zadání §5: „Odděl připojení,
 * externí identity a souhlasy jednotlivých klientů. Stejný e-mail
 * nesmí propojit data různých tenantů." — appka navíc žádný e-mail
 * Salt Edge nepředává vůbec, jen neprůhledné `tenantId`).
 * `return_connection_id: true` appka posílá, aby se po návratu
 * z banky dalo hned zkusit najít připojení — AUTORITATIVNÍ stav ale
 * appka čte z webhooku (`app/api/integrace/saltedge/webhook`), ne
 * jen z téhle redirect hodnoty (dokumentace: „nejdůležitější části
 * — správa připojení — jsou asynchronní").
 */
export async function zahajitPripojeniSaltEdge(
  navratovaAdresa: string,
  tenantId: string,
  providerCode: string,
): Promise<{ stav: 'ok'; presmerovatNa: string } | { stav: 'chyba'; duvod: string }> {
  if (!jeNakonfigurovano()) return { stav: 'chyba', duvod: 'Salt Edge není nastaven (chybí partnerský účet — appka ho nesmí sama zřídit).' }

  let odpoved: Response
  try {
    odpoved = await fetch(`${ZAKLAD}/lead_sessions/create`, {
      method: 'POST',
      headers: hlavicky(),
      body: JSON.stringify({
        customer_id: tenantId,
        provider_code: providerCode,
        country_code: 'CZ',
        consent: {
          scopes: ['account_details', 'transactions_details'],
        },
        attempt: {
          return_to: navratovaAdresa,
          return_connection_id: true,
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
  const zustatky: BodZustatku[] = [{ typ: 'knihovni', castkaHaleru: Math.round(ucet.balance * 100), mena: ucet.currency_code, platnyK }]
  if (ucet.available_balance != null) {
    zustatky.push({ typ: 'disponibilni', castkaHaleru: Math.round(ucet.available_balance * 100), mena: ucet.currency_code, platnyK })
  }
  return { stav: 'ok', zustatky }
}

export type VysledekTransakciStrankovane = (VysledekTransakci & { dalsiId: string | null })

/**
 * Jen ZAÚČTOVANÉ (`status: 'posted'`) pohyby — `pending` appka
 * nevrací vůbec (`transakce` je ledger zaúčtovaných pohybů, ne
 * rozpracovaných; pending se appce vrátí jako posted při dalším
 * běhu, ne že by appka musela řešit přechod stavu).
 *
 * JEDNA STRÁNKA na volání (`odId` → parametr `from_id`, `dalsiId` ←
 * `meta.next_id`) — volající (sync job, `lib/integrace-saltedge-sync.ts`)
 * stránkuje smyčkou, appka tady nepředpokládá, kolik stránek bude.
 */
export async function nactiTransakceSaltEdge(connectionId: string, accountId: string, odId?: string | null): Promise<VysledekTransakciStrankovane> {
  const dalsiParametr = odId ? `&from_id=${encodeURIComponent(odId)}` : ''
  const vysledek = await zavolatSaltEdge<SaltEdgeTransaction[]>(
    `/transactions?connection_id=${encodeURIComponent(connectionId)}&account_id=${encodeURIComponent(accountId)}${dalsiParametr}`,
  )
  if (vysledek.stav === 'chyba') return { ...vysledek, dalsiId: null }

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

  return { stav: 'ok', radky, dalsiId: vysledek.dalsiId }
}

/**
 * Odvolání souhlasu (Partner Consent Revoke) — appka ho volá při
 * odpojení, ne jen smaže lokální tajemství (zadání §6: „bezpečně
 * zpracuj... odvolání souhlasu"). `consentId` appka má uložené z
 * doby, kdy ho Salt Edge vrátil (webhook/success callback) — pokud
 * appka žádné nemá (připojení skončilo dřív, než dorazil webhook),
 * revoke se nepovede a appka to řekne nahlas, ne tiše přeskočí.
 */
export async function odvolatSouhlasSaltEdge(consentId: string): Promise<{ stav: 'ok' } | { stav: 'chyba'; duvod: string }> {
  if (!jeNakonfigurovano()) return { stav: 'chyba', duvod: 'Salt Edge není nastaven.' }

  let odpoved: Response
  try {
    odpoved = await fetch(`${ZAKLAD}/partner_consents/${encodeURIComponent(consentId)}/revoke`, { method: 'POST', headers: hlavicky() })
  } catch (e) {
    return { stav: 'chyba', duvod: `Salt Edge API se nepodařilo spojit: ${e instanceof Error ? e.message : 'neznámá chyba'}` }
  }

  if (!odpoved.ok) return { stav: 'chyba', duvod: `Odvolání souhlasu spadlo na chybě ${odpoved.status}.` }
  return { stav: 'ok' }
}

/**
 * Ověření podpisu webhooku (RSA-SHA256, dokumentace: „base64 encoded
 * SHA256 signature of the string callback_url|post_body, signed with
 * Salt Edge's private key"). Čistá funkce — žádné IO, testovatelná
 * bez živého API (`scripts/integrace-saltedge.test.mjs`).
 *
 * `callbackUrl` appka posílá jako URL, kterou má ZAREGISTROVANOU
 * (`SALTEDGE_WEBHOOK_URL`), ne URL příchozího requestu — dokumentace
 * neříká, které z toho dvojího appka má použít, tohle je appčin
 * bezpečnější výchozí předpoklad, ne dokumentovaný fakt (viz hlavička
 * souboru).
 */
export function overitPodpisWebhookuSaltEdge(
  callbackUrl: string,
  syroveTelo: string,
  podpisBase64: string,
  verejnyKlicPem: string,
): boolean {
  try {
    const overovac = createVerify('RSA-SHA256')
    overovac.update(`${callbackUrl}|${syroveTelo}`, 'utf8')
    return overovac.verify(verejnyKlicPem, podpisBase64, 'base64')
  } catch {
    // Poškozený/cizí podpis appka hlásí jako „neplatný", ne jako pád.
    return false
  }
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

  // Kontrakt `zahajitPripojeni(navratovaAdresa, odkaz)` nemá místo pro
  // `tenantId`/`providerCode` — appka proto u Salt Edge nevolá tuhle
  // metodu kontraktu, ale `zahajitPripojeniSaltEdge` přímo (stejná
  // mezera jako u `nactiZustatky`/`nactiTransakce` níž).
  async zahajitPripojeni(navratovaAdresa: string, odkaz: string) {
    return { stav: 'chyba' as const, duvod: `Salt Edge vyžaduje tenantId a providerCode navíc (odkaz: ${odkaz}) — volejte zahajitPripojeniSaltEdge přímo.` }
  },

  async nactiZustatky(ucet: string): Promise<VysledekZustatku> {
    return { stav: 'chyba', duvod: `Salt Edge vyžaduje connection_id navíc k účtu ${ucet} — volejte nactiZustatkySaltEdge přímo.` }
  },

  async nactiTransakce(ucet: string): Promise<VysledekTransakci> {
    return { stav: 'chyba', duvod: `Salt Edge vyžaduje connection_id navíc k účtu ${ucet} — volejte nactiTransakceSaltEdge přímo.` }
  },
}
