/**
 * Zápis jednoho dne pokladny do databáze a sonda „umí databáze platby?" —
 * bez `server-only` a s podstrčeným klientem, ať je jde ověřit bez
 * databáze (`scripts/pokladna-napojeni.test.mjs`). Volá je
 * `lib/pokladna-sync.ts`.
 *
 * Záložní cesty, které jinak nikdy neběží v testu, protože nastávají jen
 * mezi nasazením kódu a migrace nebo u nečekaných dat:
 *   * funkce `p_platby` nezná (PGRST202 / 42883) → den znovu bez plateb,
 *     zbytek běhu už bez nich (kurzor plateb se pak neposune);
 *   * databáze platby odmítne datovou chybou → den znovu s prázdnými
 *     platbami: prodeje se uloží, starý snímek plateb dne zmizí;
 *   * když neprojde ani tohle, chyba byla v prodejích — vrátí se.
 */

/** Chyba z PostgRESTu — jen to, co tu appka potřebuje. */
export type ChybaRpc = { code?: string; message?: string } | null

export type VolatZapis = (parametry: Record<string, unknown>) => PromiseLike<{ data: unknown; error: ChybaRpc }>

/** Funkce s takovými parametry neexistuje (PostgREST / Postgres). */
const FUNKCE_NEEXISTUJE = new Set(['PGRST202', '42883'])

/**
 * Datové chyby zápisu (mimo rozsah, neplatná hodnota, CHECK, NOT NULL):
 * když je způsobí platby, den se zapíše znovu s prázdnými platbami —
 * prodeje dne nesmí padnout kvůli rozpadu plateb (po třech pokusech by se
 * den přeskočil a prodeje by chyběly natrvalo).
 */
const DATOVE_CHYBY = new Set(['22003', '22P02', '22023', '23502', '23514'])

export type VysledekZapisuDne = {
  /** Počet zapsaných řádků prodeje. */
  pocet: number
  /** Chyba, kvůli které den neprošel ani bez plateb. */
  chyba: ChybaRpc
  /** Databáze `p_platby` nezná — zbytek běhu bez plateb, kurzor plateb neposouvat. */
  databazeNeumiPlatby: boolean
  /** Kód datové chyby, kvůli které se platby dne nezapsaly (prodeje ano). */
  platbyOdmitnuty: string | null
}

export async function zapsatDen(volat: VolatZapis, parametry: Record<string, unknown>, platby: unknown[] | null): Promise<VysledekZapisuDne> {
  let { data, error } = await volat(platby ? { ...parametry, p_platby: platby } : parametry)
  let databazeNeumiPlatby = false
  let platbyOdmitnuty: string | null = null

  if (platby && error && FUNKCE_NEEXISTUJE.has(error.code ?? '')) {
    databazeNeumiPlatby = true
    ;({ data, error } = await volat(parametry))
  } else if (platby && platby.length > 0 && error && DATOVE_CHYBY.has(error.code ?? '')) {
    const kod = error.code ?? ''
    ;({ data, error } = await volat({ ...parametry, p_platby: [] }))
    if (!error) platbyOdmitnuty = kod
  }

  return { pocet: typeof data === 'number' ? data : 0, chyba: error, databazeNeumiPlatby, platbyOdmitnuty }
}

/** Minimum klienta Supabase, které sonda potřebuje. */
export type KlientSondy = {
  from(tabulka: string): { select(sloupce: string): { limit(n: number): PromiseLike<{ error: ChybaRpc }> } }
}

/**
 * Má databáze tabulku plateb (migrace 20261012200000)? Jakákoli chyba = ne
 * — běh pak jede jako dřív.
 *
 * Schválně GET, ne `head: true`: na chybějící tabulku vrací PostgREST 404
 * a u HEAD bez těla to klient Supabase přepíše na „204 bez chyby" — sonda
 * by tvrdila, že tabulka je, a běh by plánoval podle kurzoru plateb dřív,
 * než je databáze umí uložit.
 */
export async function databazeMaPlatby(klient: KlientSondy): Promise<boolean> {
  const { error } = await klient.from('pokladna_platby_denni').select('id').limit(1)
  return !error
}
