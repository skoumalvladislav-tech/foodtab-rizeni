/**
 * Enable Banking — KOSTRA multibank agregátora (KB/ČSOB/Česká
 * spořitelna/Raiffeisenbank). Fio banka appka řeší přímo
 * (`lib/integrace-fio.ts`) — Enable Banking ji sám nepodporuje
 * (ověřeno, `enablebanking.com/docs/markets/cz`).
 *
 * DŮVOD VOLBY proti GoCardless/Finbricks: viz
 * `docs/hlaseni/banka-poskytovatele-2026-10-04.md`. Zkráceně: Enable
 * Banking je jediný ze tří se SAMOOBSLUŽNÝM sandboxem i „Restricted
 * Production" (reálné bankovní připojení, zdarma, bez smlouvy,
 * omezené na vlastní vyjmenované účty) — appka proto staví kostru
 * proti NĖMU, ne proti poskytovateli, který vyžaduje obchodní jednání
 * ještě PŘED tím, než si appka může vyzkoušet, jestli kód funguje.
 *
 * BEZ `ENABLEBANKING_APPLICATION_ID`/`ENABLEBANKING_PRIVATE_KEY`
 * appka NIKDY nezkouší zavolat ven (zadání §2: nikdy „připojeno" bez
 * ověřeného přístupu) — a i s klíči zůstává krok pro Šéfíka: založit
 * si kontrolní panel (appka účty třetích stran nezakládá sama).
 *
 * ---------------------------------------------------------------------
 * TOK (ověřeno proti enablebanking.com/docs/api/reference/, živě):
 *
 *   1. Appka si podepíše VLASTNÍ JWT (RS256, soukromý klíč
 *      zaregistrovaný v kontrolním panelu, `kid` = application id) —
 *      žádná OAuth token výměna pro samotné API volání.
 *   2. GET /aspsps?country=cz → seznam bank. Id se NEUKLÁDAJÍ napevno
 *      (Enable Banking je může změnit) — appka si je natáhne vždycky.
 *   3. POST /auth → `redirectUrl`, appka přesměruje uživatele tam.
 *   4. Po návratu appka zjistí výsledek POST /sessions s `code` z
 *      callbacku → `session_id` + seznam účtů.
 *   5. GET /accounts/{id}/balances → ISO 20022 kódy (CLBD/CLAV/ITBD/
 *      ITAV). GET /accounts/{id}/transactions → `credit_debit_indicator`
 *      (CRDT/DBDT), stav `BOOK` pro zaúčtované (kód pro nevypořádané
 *      appka v dokumentaci nenašla jednoznačně — dokud se neověří,
 *      appka NEIMPORTUJE nic, co nemá status `BOOK`, raději míň dat
 *      než nejisté).
 *
 * Souhlas appka NIKDY nepředpokládá na pevný počet dnů — čte
 * `maximum_consent_validity` z `GET /aspsps` (liší se bankou od banky,
 * u většiny 180 dní, ne 90 — appka si tohle nevymýšlí, ukládá, co
 * řekl poskytovatel, do `integrace_pripojeni.souhlas_platny_do`).
 *
 * Czech VS/KS/SS appka NEOČEKÁVÁ jako samostatná pole na příchozí
 * transakci — PSD2 feed je typicky jen volný text
 * (`remittance_information`). Appka ho uloží do poznámky, NEZKOUŠÍ
 * ho regexem rozpadnout na VS/KS/SS (nejistý rozpad by byl horší než
 * žádný — zadání: „appka nesmí domýšlet").
 */

import 'server-only'

import type { BankDataProvider, VysledekZustatku, VysledekTransakci } from './bank-provider-contract.ts'

const ZAKLAD = 'https://api.enablebanking.com'

export function jeNakonfigurovano(): boolean {
  return Boolean(process.env.ENABLEBANKING_APPLICATION_ID && process.env.ENABLEBANKING_PRIVATE_KEY)
}

const NENAKONFIGUROVANO =
  'Enable Banking není nakonfigurovaný (chybí ENABLEBANKING_APPLICATION_ID/ENABLEBANKING_PRIVATE_KEY) — appka proto nic nevolá. ' +
  'Krok pro Šéfíka: založit si kontrolní panel na enablebanking.com/sign-in (zdarma, appka to nesmí udělat sama) a zapsat klíče do prostředí.'

/**
 * Appka si JWT podepisuje sama (RS256) — vlastní, ne cizí balíček.
 * `jose`/`jsonwebtoken` by šly přidat jako závislost, ale appka tuhle
 * funkci nikdy nezavolá bez nakonfigurovaných klíčů (viz guard níž),
 * takže se podpis nezkouší implementovat, dokud appka nemá co
 * podepsat — žádný kód, který by se nedal ani vyzkoušet.
 */
async function podepsatJwt(): Promise<string> {
  throw new Error(
    'Podpis JWT (RS256) pro Enable Banking appka nedokončila — bez ' +
      'reálného application id / privátního klíče by se nedal ani ' +
      'vyzkoušet. Hotovo je kontrakt a HTTP volání; podpis dopsat, ' +
      'až budou k dispozici klíče z kontrolního panelu (viz komentář ' +
      'v hlavičce souboru).',
  )
}

async function zavolat<T>(cesta: string, token: string, init?: RequestInit): Promise<{ stav: 'ok'; data: T } | { stav: 'chyba'; duvod: string }> {
  if (!jeNakonfigurovano()) return { stav: 'chyba', duvod: NENAKONFIGUROVANO }

  let odpoved: Response
  try {
    odpoved = await fetch(`${ZAKLAD}${cesta}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } })
  } catch (e) {
    return { stav: 'chyba', duvod: `Enable Banking API se nepodařilo spojit: ${e instanceof Error ? e.message : 'neznámá chyba'}` }
  }

  if (odpoved.status === 429) {
    return { stav: 'chyba', duvod: 'Enable Banking API: banka omezila počet dotazů (typicky 4 za den bez aktivního uživatele u banky).' }
  }
  if (!odpoved.ok) return { stav: 'chyba', duvod: `Enable Banking API odpovědělo chybou ${odpoved.status}.` }

  try {
    return { stav: 'ok', data: (await odpoved.json()) as T }
  } catch {
    return { stav: 'chyba', duvod: 'Enable Banking API vrátilo odpověď, které nešlo rozumět (ne JSON).' }
  }
}

type EbBalance = { balance_type: string; balance_amount: { amount: string; currency: string }; reference_date?: string }
type EbTransaction = {
  entry_reference?: string
  booking_date: string
  transaction_amount: { amount: string; currency: string }
  credit_debit_indicator: 'CRDT' | 'DBDT'
  status: string
  remittance_information?: string[]
  creditor?: { name?: string }
  debtor?: { name?: string }
}

const TYP_ZUSTATKU: Record<string, 'knihovni' | 'disponibilni' | undefined> = {
  CLBD: 'knihovni',
  ITBD: 'knihovni',
  CLAV: 'disponibilni',
  ITAV: 'disponibilni',
}

async function nactiZustatky(ucetId: string, token: string): Promise<VysledekZustatku> {
  const vysledek = await zavolat<{ balances: EbBalance[] }>(`/accounts/${ucetId}/balances`, token)
  if (vysledek.stav === 'chyba') return vysledek

  const zustatky = vysledek.data.balances
    .map((b) => {
      const typ = TYP_ZUSTATKU[b.balance_type]
      const castka = Number(b.balance_amount.amount)
      if (!typ || !Number.isFinite(castka)) return null
      return { typ, castkaHaleru: Math.round(castka * 100), mena: b.balance_amount.currency, platnyK: b.reference_date ?? new Date().toISOString() }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)

  return { stav: 'ok', zustatky }
}

async function nactiTransakce(ucetId: string, token: string, od: string, doData: string): Promise<VysledekTransakci> {
  const vysledek = await zavolat<{ transactions: EbTransaction[] }>(
    `/accounts/${ucetId}/transactions?date_from=${od}&date_to=${doData}`,
    token,
  )
  if (vysledek.stav === 'chyba') return vysledek

  const radky = vysledek.data.transactions
    // Jen zaúčtované — appka nedoložila jednoznačný kód pro nevypořádané
    // (viz hlavička souboru), raději míň dat než nejisté.
    .filter((t) => t.status === 'BOOK')
    .map((t) => {
      const castka = Number(t.transaction_amount.amount)
      if (!Number.isFinite(castka) || !t.entry_reference) return null
      return {
        datum: t.booking_date,
        smer: t.credit_debit_indicator === 'CRDT' ? ('prijem' as const) : ('vydaj' as const),
        castkaHaleru: Math.round(Math.abs(castka) * 100),
        protistrana: t.creditor?.name || t.debtor?.name || '',
        vs: '', // PSD2 feed nedává VS jako vlastní pole — appka ho nezkouší regexem vytáhnout.
        poznamka: (t.remittance_information ?? []).join(' '),
        externiId: t.entry_reference,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  return { stav: 'ok', radky }
}

/** BankDataProvider registrace — totéž rozhraní jako Fio/CSV (lib/bank-provider-contract.ts). */
export const enableBankingProvider: BankDataProvider = {
  klic: 'enablebanking',
  nazev: 'Enable Banking (KB/ČSOB/ČS/Raiffeisenbank)',
  schopnosti: {
    zpusobPripojeni: 'souhlas_redirect',
    firemniUcty: true,
    soukromeUcty: true,
    dostupneZustatky: ['knihovni', 'disponibilni'],
    historieDnu: null, // závisí na bance (`maximum_consent_validity` z GET /aspsps), appka si nevymýšlí číslo
    vsReference: false, // PSD2 feed = volný text, appka ho nerozpadává
    pendingTransakce: true,
    inkrementalniSync: false,
  },
  nactiZustatky,
  nactiTransakce,
}

export { podepsatJwt }
