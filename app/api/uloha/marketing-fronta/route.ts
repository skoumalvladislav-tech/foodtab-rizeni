import { NextResponse } from 'next/server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { KBELIK } from '@/lib/marketing-media'
import type { Obrazek } from '@/lib/marketing-n8n'
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
 * Osm, a je to spočítané, ne odhadnuté: jedno předání do n8n čeká na
 * odpověď nejvýš půl minuty, takže nejhorší možný běh trvá čtyři
 * minuty. Plánovač dává na volání pět minut (`--max-time 300`
 * v `.github/workflows/marketing-fronta.yml`), takže se dávka vejde
 * i celá zaseknutá.
 *
 * Dvacet by se nevešlo: deset minut proti pěti. Useknuté volání by
 * nechalo část úloh ve stavu `odesila_se` — zabrané, neodeslané a bez
 * zápisu proč. Zbytek dávky radši počká na další běh za čtvrt hodiny.
 */
const DAVKA = 8

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
      const vysledek = await odeslat(uloha, await odkazyNaFotky(supabase, uloha))

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

/**
 * Podepsané odkazy na fotky příspěvku.
 *
 * ---------------------------------------------------------------------
 * PROČ ODKAZY A NE SOUBORY
 *
 * Instagram si obrázek stahuje sám podle adresy, kterou dostane.
 * Kbelík je ale soukromý, takže se pro každou fotku vydá podepsaný
 * odkaz s omezenou platností — je to jediný způsob, jak dát cizí
 * službě přístup k jedné fotce, aniž by se otevřel celý kbelík.
 *
 * ---------------------------------------------------------------------
 * PLATNOST MUSÍ PŘEČKAT CELÉ ZVEŘEJNĚNÍ, NE JEN VOLÁNÍ
 *
 * Meta si obrázek nestáhne hned, když jí pošlete adresu — udělá to
 * někdy během zpracování kontejneru. Kdyby odkaz platil pár minut,
 * skončilo by to chybou od Mety, ze které se příčina nepozná.
 * Dvě hodiny jsou se zásobou i na opakování.
 *
 * ---------------------------------------------------------------------
 * POŘADÍ JE POŘADÍ Z VERZE
 *
 * `media_ids` drží pořadí, ve kterém člověk fotky vybral, a první je
 * titulní. Databáze vrací řádky, jak se jí zlíbí, takže se to musí
 * seřadit zpátky — jinak by koláž vyšla jinak, než jak ji schvalovatel
 * viděl.
 */
const PLATNOST_PRO_METU_S = 7200

async function odkazyNaFotky(supabase: SupabaseClient, uloha: Uloha): Promise<Obrazek[]> {
  const ids = uloha.media_ids ?? []
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('marketing_media')
    .select('id, cesta, alt_text')
    .eq('tenant_id', uloha.tenant_id)
    .in('id', ids)

  if (error || !data || data.length === 0) return []

  const podleId = new Map(data.map((m) => [m.id as string, m]))
  const vPoradi = ids.map((id) => podleId.get(id)).filter((m) => m !== undefined)
  if (vPoradi.length === 0) return []

  const podepsane = await supabase.storage
    .from(KBELIK)
    .createSignedUrls(vPoradi.map((m) => m.cesta as string), PLATNOST_PRO_METU_S)

  const podleCesty = new Map(
    (podepsane.data ?? [])
      .filter((s) => s.signedUrl && s.path)
      .map((s) => [s.path as string, s.signedUrl as string]),
  )

  /*
    Fotka bez odkazu se VYNECHÁ, ne nahradí prázdnou adresou. Prázdná
    adresa by u Mety skončila chybou o neplatném obrázku a hledalo by
    se to u ní; vynechaná fotka znamená, že příspěvek buď odejde
    s ostatními, nebo — když nezbyde žádná — selže na srozumitelné
    hlášce „bez fotky to nepřijme".
  */
  return vPoradi
    .map((m) => ({
      url: podleCesty.get(m.cesta as string) ?? '',
      alt: String(m.alt_text ?? ''),
    }))
    .filter((o) => o.url !== '')
}
