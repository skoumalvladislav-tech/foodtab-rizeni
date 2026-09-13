import { NextResponse } from 'next/server'

import { odeslat, type Uloha } from '@/lib/marketing-odeslani'
import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: fronta publikací.
 *
 * Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4.
 *
 * ---------------------------------------------------------------------
 * ROZDĚLENÍ PRÁCE
 *
 * O TOM, CO SE SMÍ POSLAT, ROZHODUJE DATABÁZE.
 * `public.marketing_vyzvednout_publikace` znovu ověří platnost
 * schválení i práva k fotkám a co neprojde, vůbec nevrátí. Tahle
 * adresa jen vezme, co dostala, pošle to ven a zapíše, jak to
 * dopadlo.
 *
 * Je to stejné rozdělení jako u `app/api/uloha/zapomenuty-odchod`:
 * databáze rozhoduje, adresa jen obsluhuje to, co vede ven.
 *
 * ---------------------------------------------------------------------
 * PROČ JE TAHLE ADRESA VŮBEC POTŘEBA
 *
 * Databáze neumí volat ven a nemá to umět. Volání k Metě, Claudovi
 * nebo Shotstacku musí udělat něco, co má síť a klíče — a to je
 * server aplikace.
 *
 * ---------------------------------------------------------------------
 * ČTYŘI VĚCI, KTERÉ SE U NAPLÁNOVANÝCH ÚLOH POKAZÍ VŽDYCKY
 *
 * 1. NECHRÁNĚNÁ ADRESA. Stejné tajemství jako u zapomenutého odchodu
 *    (`CRON_SECRET`), porovnané v konstantním čase.
 *
 * 2. DVOJÍ SPUŠTĚNÍ. Vercel umí spustit úlohu podruhé dřív, než první
 *    doběhne. Hlídá to `for update skip locked` ve vyzvednutí a
 *    unikátní `uloha_id` u zveřejnění — ne tenhle soubor.
 *
 * 3. JEDNA ÚLOHA POLOŽÍ CELÝ BĚH. Každá se proto posílá zvlášť a její
 *    pád se zapíše k NÍ, ne k běhu. Kdyby se celá dávka poslala
 *    najednou a jedna spadla, zbytek by zůstal v `odesila_se`
 *    a nikdo by nevěděl, jestli odešel.
 *
 * 4. ČASOVÝ LIMIT UPROSTŘED ODESÍLÁNÍ. Proto se bere po dávkách
 *    (`DAVKA`) a zbytek počká na další běh — ne tisíc úloh naráz.
 *
 * ---------------------------------------------------------------------
 * ODPOVĚDI
 *
 * Bez tajemství 401 a nic dalšího. Kdo netrefí, se z odpovědi nesmí
 * dozvědět ani to, jestli tahle adresa něco dělá.
 */

export const dynamic = 'force-dynamic'

/**
 * Kolik úloh na jeden běh.
 *
 * Vercel dává funkci omezený čas a jedno odeslání k Metě trvá
 * i vteřiny. Dvacet je odhad se zásobou; zbytek počká na další běh,
 * což je lepší než dávka useknutá uprostřed.
 */
const DAVKA = 20

export async function GET(request: Request): Promise<NextResponse> {
  const hlavicka = request.headers.get('authorization')
  const prislo = hlavicka?.startsWith('Bearer ') ? hlavicka.slice(7) : null

  if (!tajemstviSedi(prislo, process.env.CRON_SECRET)) {
    return NextResponse.json({ chyba: 'Nepovoleno.' }, { status: 401 })
  }

  const supabase = klientUlohy()
  if (!supabase) {
    // Až za ověřením tajemství: kdo netrefí, se nedozví ani tohle.
    return NextResponse.json(
      { chyba: 'Úloha není nastavená — chybí SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    )
  }

  const { data, error } = await supabase.rpc('marketing_vyzvednout_publikace', {
    p_kolik: DAVKA,
  })

  if (error) {
    return NextResponse.json({ chyba: error.message }, { status: 500 })
  }

  const ulohy = (data ?? []) as Uloha[]
  const pocty = { zverejneno: 0, nanecisto: 0, rucne: 0, selhalo: 0 }

  for (const uloha of ulohy) {
    /*
      Každá úloha zvlášť, včetně `try`. Neošetřená výjimka u jedné by
      shodila celý běh a zbytek dávky by zůstal v `odesila_se` — tedy
      zabraný, ale neodeslaný a bez zápisu proč.
    */
    try {
      const vysledek = await odeslat(uloha)

      if (vysledek.stav === 'hotovo') {
        await supabase.rpc('marketing_publikace_hotova', {
          p_uloha: uloha.id,
          p_externi_id: vysledek.externiId,
          p_odkaz: vysledek.odkaz,
          p_odpoved: vysledek.odpoved,
          p_nanecisto: vysledek.nanecisto,
        })
        if (vysledek.nanecisto) pocty.nanecisto++
        else pocty.zverejneno++
      } else if (vysledek.stav === 'rucne') {
        await supabase.rpc('marketing_publikace_k_rukam', {
          p_uloha: uloha.id,
          p_duvod: vysledek.duvod,
        })
        pocty.rucne++
      } else {
        await supabase.rpc('marketing_publikace_selhala', {
          p_uloha: uloha.id,
          p_chyba: vysledek.duvod,
        })
        pocty.selhalo++
      }
    } catch (e) {
      /*
        Hláška z výjimky jde do `posledni_chyba`, kterou čte člověk na
        obrazovce. Ať tam nestojí „[object Object]".
      */
      await supabase.rpc('marketing_publikace_selhala', {
        p_uloha: uloha.id,
        p_chyba: e instanceof Error ? e.message : 'Neznámá chyba při odesílání.',
      })
      pocty.selhalo++
    }
  }

  return NextResponse.json({ vyzvednuto: ulohy.length, ...pocty })
}
