/**
 * Čtení šifry přístupových údajů k bance — logika bez IO, klienty
 * dává volající (lib/banka/tajemstvi.ts). Testuje ji Node přímo
 * (scripts/banka-tajemstvi.test.mjs).
 *
 * Dřív si server šifru bral přes RPC `integrace_precti_tajemstvi`,
 * které měl i přihlášený — tedy i prohlížeč přes /rest/v1/rpc. Od
 * migrace 20261119100000 to RPC u banky odmítne a jde se takhle:
 *
 *   1. přihlášený (jeho klient, jeho JWT) se zeptá databáze, jestli
 *      smí připojení spravovat — `integrace_overit_spravu` vrátí jen
 *      firmu připojení, šifru ne;
 *   2. teprve potom si server šifru přečte sám klientem služby — jen
 *      řádek toho připojení A té firmy, kterou vrátila databáze (ne
 *      firmu z prohlížeče).
 *
 * Když krok 1 neprojde, krok 2 se neudělá vůbec. Šifra ani její
 * obsah nikdy nejdou do odpovědi klientovi ani do logu — volající
 * dostane jen rozšifrované údaje, nebo null.
 */

type VysledekDotazu<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>

/** Přihlášený klient — umí jen zavolat RPC (víc tu nepotřebuje). */
export type KlientPrihlaseneho = {
  rpc(funkce: string, parametry: Record<string, unknown>): VysledekDotazu<unknown>
}

/** Klient služby — jen tvar dotazu, který se tu opravdu volá. */
export type KlientSluzby = {
  from(tabulka: string): {
    select(sloupce: string): {
      eq(sloupec: string, hodnota: string): {
        eq(sloupec: string, hodnota: string): {
          maybeSingle(): VysledekDotazu<{ sifra?: unknown }>
        }
      }
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Šifra přístupových údajů připojení, nebo null (bez práva, bez šifry, bez klienta služby). */
export async function precistSifruPoOvereni(
  prihlaseny: KlientPrihlaseneho,
  sluzba: KlientSluzby | null,
  pripojeniId: string,
): Promise<string | null> {
  if (!UUID.test(pripojeniId)) return null

  // 1. Právo ověří databáze pod účtem přihlášeného.
  const { data: firma, error } = await prihlaseny.rpc('integrace_overit_spravu', { p_pripojeni: pripojeniId })
  if (error || typeof firma !== 'string' || !UUID.test(firma)) return null

  // 2. Šifru čte server sám — jen řádek téhle firmy.
  if (!sluzba) return null
  const { data, error: chybaCteni } = await sluzba
    .from('integrace_tajemstvi')
    .select('sifra')
    .eq('pripojeni_id', pripojeniId)
    .eq('tenant_id', firma)
    .maybeSingle()
  if (chybaCteni || typeof data?.sifra !== 'string') return null
  return data.sifra
}
