import 'server-only'

import { timingSafeEqual } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { funkceNeexistuje } from '@/lib/supabase/dotaz'

/**
 * Klient pro naplánované úlohy.
 *
 * ---------------------------------------------------------------------
 * PROČ EXISTUJE
 *
 * Naplánovaná úloha nemá přihlášeného člověka. Běžný serverový klient
 * jede pod účtem toho, kdo se ptá — a tady se neptá nikdo, takže by
 * politiky nepustily nic.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLO 6
 *
 * `service_role` obchází politiky, takže se do prohlížeče nesmí dostat
 * NIKDY. Proto:
 *
 *   * `import 'server-only'` — když se tenhle modul omylem dostane do
 *     klientského grafu, překlad SPADNE. Ne varování, chyba.
 *   * proměnná se jmenuje bez `NEXT_PUBLIC_`, takže ji Next do balíčku
 *     pro prohlížeč nedá ani nedopatřením.
 *
 * Klíč otevírá celou databázi. Volat se s ním smí jen to, co je
 * v `app/api/uloha/…`, a jen za tajemstvím. Výjimky (vždy jen na
 * serveru, nikdy s daty z prohlížeče jako filtrem na cizí řádky):
 *   * `app/k/[klic]` — krátký odkaz,
 *   * `lib/komunikace/push-hned.ts` — push hned po odeslání zprávy, jen
 *     k upozorněním zprávy, kterou databáze právě přijala pod účtem
 *     odesílatele (id vrací `poslat_zpravu`),
 *   * `app/pozvanka/[token]/akce.ts` (`poslatPrvniKod`) — založení účtu
 *     pro nově pozvaného, JEN pro adresu z platné pozvánky v databázi
 *     (`pozvanka_info`), nikdy pro adresu z prohlížeče.
 *   * `app/[rozsah]/finance/integrace/email/akce.ts` (`spustitPrijemTed`,
 *     `zapsatNavrhyAkce` → `lib/faktury-prijem-sync.ts`) — příjem faktur
 *     hned / zápis návrhů, až po `integrace.manage` + `faktury.manage`
 *     a dohledání schránky uživatelským klientem s `tenant_id` firmy.
 *   * `app/[rozsah]/finance/faktury/akce.ts` (`vratitNeuhrazenou`) — jen
 *     součet párování JEDNÉ faktury vlastní firmy, po `faktury.manage`
 *     (uživatelský klient by bez práva na Platby viděl nulu).
 *   * `app/api/pokladna/prodeje` — příjmové API pro pokladny: klíč
 *     nahrazuje přihlášení, určuje připojení a tím firmu i pobočku;
 *     z těla se bere jen obsah prodeje (zápis přes
 *     `pokladna_nahradit_prodeje`, která pobočku hlídá znovu).
 *   * `lib/pokladna-sync.ts` z `app/[rozsah]/finance/integrace/pokladna/akce.ts`
 *     a `app/api/integrace/dotykacka/vratit` („Synchronizovat teď",
 *     první stažení po připojení) a `pokladna_odebrat_prodeje` po změně
 *     přiřazení provozovny — až po `integrace.manage` a dohledání
 *     připojení uživatelským klientem s `tenant_id` firmy.
 *   * `lib/kb-adaa-sync.ts` z `app/[rozsah]/finance/integrace/banka/akce.ts`
 *     („Synchronizovat teď", výběr účtu) a `app/api/integrace/kb/vratit`
 *     (první stažení po souhlasu v KB) — až po dohledání připojení
 *     uživatelským klientem (RLS) a uložení tajemství přes RPC, které
 *     samo ověří `integrace.manage`.
 *   * `app/[rozsah]/finance/platby/import/akce.ts` (`potvrditImport` →
 *     `lib/finance-automaticke-parovani.ts`) — automatické párování po
 *     importu výpisu, jen když importující má `finance.manage`
 *     i `faktury.manage`, jen vlastní firma a z CSV jen právě nahraná dávka.
 *
 * ---------------------------------------------------------------------
 * KDYŽ KLÍČ CHYBÍ
 *
 * Vrací `null`, ne výjimku s obsahem prostředí. Adresa pak odpoví
 * srozumitelně, že úloha není nastavená — a nikdo se z odpovědi
 * nedozví, co v prostředí je a co ne.
 */
export function klientUlohy(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const klic = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !klic) return null

  return createClient(url, klic, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Porovnání tajemství v konstantním čase.
 *
 * `a === b` u řetězců končí na prvním rozdílném znaku, takže se dá
 * z doby odpovědi uhodnout, kolik znaků sedí. U tajemství, které chrání
 * adresu volatelnou z internetu, to není teoretická úvaha.
 */
export function tajemstviSedi(prislo: string | null, ocekavane: string | undefined): boolean {
  if (!ocekavane || !prislo) return false

  const a = Buffer.from(prislo, 'utf8')
  const b = Buffer.from(ocekavane, 'utf8')

  // Délky se porovnávají zvlášť; `timingSafeEqual` na různé délky spadne.
  // Rozdílná délka se pozná i tak, ale samotný obsah se neprozradí.
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * Zámek proti dvojímu spuštění téže úlohy.
 *
 * ---------------------------------------------------------------------
 * PROČ
 *
 * Úlohy volají dva plánovače: pg_cron v databázi a GitHub Actions jako
 * záloha (docs/planovac-pg-cron.md). Když přijdou naráz, některé úlohy
 * udělají práci dvakrát — dva pushe „Čekají na vás zprávy", dva
 * koncepty příspěvku. Zámek drží `public.uloha_zabrat` v databázi:
 * první volání úlohu zabere na její limit, každé další v té době
 * dostane `{ bezi_jinde: true }` a nedělá nic. Zámek vyprší sám.
 *
 * ---------------------------------------------------------------------
 * POUŽITÍ — hned za ověřením tajemství, nikdy před ním
 *
 *   const bezi = await uzBezi('jmeno-ulohy')
 *   if (bezi) return bezi
 *
 * Jméno = složka v `app/api/uloha/` = řádek v `app.planovac_ulohy`.
 * Hlídá to scripts/planovac.test.mjs.
 *
 * Vrací odpověď, kterou má adresa hned vrátit, nebo `null` = pokračuj.
 *
 * ---------------------------------------------------------------------
 * KDY SE POKRAČUJE BEZ ZÁMKU
 *
 * Jen když funkce v databázi ještě NENÍ (kód se nasadí sloučením,
 * migrace až db push). Úloha pak běží jako dřív. Jiná chyba zámku je
 * porucha a končí 500 — tiše pustit úlohu bez zámku by vypadalo stejně
 * jako zámek, který funguje.
 */
export async function uzBezi(uloha: string): Promise<NextResponse | null> {
  const supabase = klientUlohy()
  // Bez klíče úloha stejně nic neudělá a řekne to sama (503).
  if (!supabase) return null

  const { data, error } = await supabase.rpc('uloha_zabrat', { p_uloha: uloha })

  if (error) {
    if (funkceNeexistuje(error)) {
      console.warn(`[${uloha}] zámek úlohy čeká na migraci 20261014120000_planovac_pg_cron — běží bez něj`)
      return null
    }
    console.error(`[${uloha}] zámek úlohy selhal:`, error.code, error.message)
    // Bez textu chyby: odpověď končí ve veřejném logu GitHub Actions.
    return NextResponse.json({ chyba: 'Zámek úlohy selhal.' }, { status: 500 })
  }

  if (data === true) return null
  if (data === false) return NextResponse.json({ bezi_jinde: true })

  console.error(`[${uloha}] zámek úlohy vrátil nečekanou hodnotu:`, data)
  return NextResponse.json({ chyba: 'Zámek úlohy selhal.' }, { status: 500 })
}

/**
 * Uvolnit zámek hned po doběhnutí — jen u úlohy, kterou plánovač volá
 * ve SMYČCE, dokud odpovídá `pokracovat: true` (faktury-z-emailu.yml,
 * až 15 kol za sebou). Bez uvolnění by druhé kolo narazilo na vlastní
 * zámek z prvního a dohánění by se zastavilo po jednom kole.
 *
 * Ostatní úlohy zámek schválně nechávají vypršet: drží tak i krátký
 * odstup mezi plánovači (Fio odmítne druhé volání do 30 s).
 *
 * Chyba se jen zapíše — zámek stejně vyprší sám.
 */
export async function uvolnitUlohu(uloha: string): Promise<void> {
  const supabase = klientUlohy()
  if (!supabase) return

  const { error } = await supabase.rpc('uloha_uvolnit', { p_uloha: uloha })
  if (error && !funkceNeexistuje(error)) {
    console.error(`[${uloha}] uvolnění zámku selhalo:`, error.code, error.message)
  }
}
