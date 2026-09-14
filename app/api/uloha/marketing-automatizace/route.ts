import { NextResponse } from 'next/server'

import type { SupabaseClient } from '@supabase/supabase-js'

import { otiskVerze, prazdnyObsah } from '@/lib/marketing'
import { pristiBeh } from '@/lib/marketing-kampane'
import { klientUlohy, tajemstviSedi } from '@/lib/supabase/uloha'

/**
 * Naplánovaná úloha: automatizace marketingu.
 *
 * Zadání: master prompt, oddíl 15 („Každá automatizace má mít vypínač,
 * vlastníka, provozovnu, poslední a příští spuštění, historii výsledků
 * a možnost bezpečně ji pozastavit").
 *
 * ---------------------------------------------------------------------
 * NIC SE NEZVEŘEJNÍ. VZNIKNOU KONCEPTY.
 *
 * Tahle úloha zakládá `marketing_prispevky` a `marketing_verze`.
 * NIKDY `marketing_publikace_ulohy` ani `marketing_schvaleni`. Kdyby
 * je zakládala, byla by to druhá cesta ven a obešla by čtyři spouště,
 * na kterých stojí celé schvalování — stačilo by jednou špatně
 * nastavit opakování a restaurace by měsíc zveřejňovala nesmysly.
 *
 * ---------------------------------------------------------------------
 * „NENÍ Z ČEHO" NENÍ CHYBA
 *
 * Když na dnešek není potvrzené menu, zapíše se běh jako
 * `preskoceno`, ne jako `chyba`. Je to normální stav: kuchař menu
 * ještě nepotvrdil. Kdyby to spadlo pod chybu, svítilo by to
 * v přehledu červeně a někdo by šel opravovat něco, co není rozbité.
 *
 * ---------------------------------------------------------------------
 * DVAKRÁT ZA DEN NE — A NESPOLÉHÁME SE PŘITOM NA VÝJIMKU
 *
 * Jedinečný index `marketing_automatizace_jeden_denne` to odmítne, ale
 * to je POJISTKA, ne řízení toku. Kdyby se úloha spoléhala na
 * výjimku, spadla by uprostřed a stav by zůstal rozpůlený: koncepty
 * založené, běh nezapsaný. Ptá se proto předem.
 *
 * ---------------------------------------------------------------------
 * PROVOZNÍ DEN, NE KALENDÁŘNÍ
 *
 * Menu „na dnešek" se hledá podle `app.business_date` pobočky
 * (CLAUDE.md, pravidlo 10). Provozní den začíná v 05:00, takže se
 * s kalendářním každý den pět hodin rozchází — a automatizace puštěná
 * v 06:00 by jinak sáhla po menu ze včerejška.
 */

export const dynamic = 'force-dynamic'

/**
 * Kolik automatizací na jeden běh.
 *
 * Dvanáct. Každá znamená pár dotazů do databáze a žádné volání ven,
 * takže je to řádově rychlejší než fronta publikací (osm kvůli n8n).
 * Zbytek počká na další běh — plánovač jede po hodinách a automatizace
 * mají čas na minuty, ne na vteřiny.
 */
const DAVKA = 12

type Automatizace = {
  id: string
  tenant_id: string
  branch_id: string
  nazev: string
  druh: string
  cas_spusteni: string
  dny_v_tydnu: number[] | null
  predstih_dnu: number
  kanaly: string[] | null
  vlastnik: string | null
}

type Vysledek = {
  vysledek: 'hotovo' | 'preskoceno' | 'chyba'
  duvod: string
  prispevky: string[]
}

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

  /*
    Berou se jen ZAPNUTÉ, kterým nastal čas. `pristi_beh_kdy` je
    okamžik spočítaný při zapnutí; prázdný znamená, že se ho nepodařilo
    spočítat — takovou automatizaci nechceme pustit naslepo.
  */
  const { data, error } = await supabase
    .from('marketing_automatizace')
    .select(`
      id, tenant_id, branch_id, nazev, druh, cas_spusteni,
      dny_v_tydnu, predstih_dnu, kanaly, vlastnik
    `)
    .eq('zapnuta', true)
    .not('pristi_beh_kdy', 'is', null)
    .lte('pristi_beh_kdy', new Date().toISOString())
    .order('pristi_beh_kdy')
    .limit(DAVKA)

  if (error) {
    return NextResponse.json({ chyba: error.message }, { status: 500 })
  }

  const automatizace = (data ?? []) as Automatizace[]
  const pocty = { hotovo: 0, preskoceno: 0, chyba: 0 }

  for (const a of automatizace) {
    /*
      Každá zvlášť, včetně `try`. Neošetřená výjimka u jedné by shodila
      celý běh a zbylé by zůstaly s prošlým `pristi_beh_kdy` — tedy
      navždy „na řadě", ale nikdy nespuštěné.
    */
    try {
      const v = await zpracovat(supabase, a)
      await zapsatBeh(supabase, a, v)
      pocty[v.vysledek]++
    } catch (e) {
      const duvod = e instanceof Error ? e.message : 'Neznámá chyba.'
      await zapsatBeh(supabase, a, { vysledek: 'chyba', duvod, prispevky: [] })
      pocty.chyba++
    }
  }

  return NextResponse.json({ zpracovano: automatizace.length, ...pocty })
}


/* ===================================================================
   JEDNA AUTOMATIZACE
   =================================================================== */

async function zpracovat(
  supabase: SupabaseClient,
  a: Automatizace,
): Promise<Vysledek> {
  /*
    PROVOZNÍ DEN POBOČKY. Ne `new Date()` na serveru — ten běží v UTC
    a v 06:00 pražského času by po přechodu na letní čas vyšel jiný
    den (pravidlo 10 a 11).
  */
  const { data: den } = await supabase
    .rpc('business_date', { p_branch: a.branch_id })

  const dnes = typeof den === 'string' ? den : null
  if (!dnes) {
    return { vysledek: 'chyba', duvod: 'Nepodařilo se určit provozní den pobočky.', prispevky: [] }
  }

  /*
    UŽ TO DNESKA BĚŽELO? Ptáme se PŘEDEM, ne přes výjimku z indexu —
    viz hlavička. Index zůstává jako pojistka pro souběh dvou běhů.
  */
  const { data: uz } = await supabase
    .from('marketing_automatizace_behy')
    .select('id')
    .eq('automatizace_id', a.id)
    .eq('provozni_den', dnes)
    .eq('vysledek', 'hotovo')
    .limit(1)

  if ((uz ?? []).length > 0) {
    return { vysledek: 'preskoceno', duvod: 'Dneska už to jednou proběhlo.', prispevky: [] }
  }

  if (a.druh === 'denni_menu' || a.druh === 'vikendove_menu') {
    return zMenu(supabase, a, dnes)
  }

  if (a.druh === 'evergreen') {
    return { vysledek: 'preskoceno', duvod: 'Zásoba na prázdné dny se zatím nevyrábí.', prispevky: [] }
  }

  return { vysledek: 'chyba', duvod: `Neznámý druh automatizace: ${a.druh}.`, prispevky: [] }
}


/**
 * Koncept z potvrzeného menu.
 *
 * ---------------------------------------------------------------------
 * JEN POTVRZENÉ MENU
 *
 * `stav = 'potvrzeno'` schválně. Koncept je sice jen koncept, ale
 * vzniká z cen a názvů — a nepotvrzené menu je to, co se právě čte
 * z fotky a může mít prázdné ceny označené ke kontrole. Vyrobit z něj
 * příspěvek znamená nachystat text, který někdo odklepne, aniž ví, že
 * čísla nikdo neviděl.
 */
async function zMenu(
  supabase: SupabaseClient,
  a: Automatizace,
  dnes: string,
): Promise<Vysledek> {
  const cilovyDen = posunutyDen(dnes, a.predstih_dnu)

  const { data: menu } = await supabase
    .from('marketing_menu')
    .select('id, nazev, druh, plati_od')
    .eq('tenant_id', a.tenant_id)
    .eq('branch_id', a.branch_id)
    .eq('stav', 'potvrzeno')
    .eq('druh', a.druh === 'vikendove_menu' ? 'vikendove' : 'denni')
    .lte('plati_od', cilovyDen)
    .or(`plati_do.is.null,plati_do.gte.${cilovyDen}`)
    .order('plati_od', { ascending: false })
    .limit(1)

  const nalezene = (menu ?? [])[0] as { id: string; nazev: string; plati_od: string | null } | undefined

  if (!nalezene) {
    return {
      vysledek: 'preskoceno',
      duvod: `Na ${cilovyDen} není potvrzené menu.`,
      prispevky: [],
    }
  }

  /*
    UŽ JE NA TEN DEN PŘÍSPĚVEK Z TOHOHLE MENU?

    Ochrana před duplicitou (zadání, oddíl 15) — jiná než „jeden běh
    na den": ta hlídá dvojí spuštění automatizace, tahle dvojí
    příspěvek na týž obsah. Člověk si mohl koncept udělat ručně a pak
    by tam byly dva.
  */
  /*
    HLEDÁ SE VE `vstupy` VERZE, NE NA PŘÍSPĚVKU.

    Napsal jsem to nejdřív jako `.contains('vstupy_menu', […])` na
    `marketing_prispevky` — takový sloupec neexistuje. A hůř: chybu
    jsem si spolkl `.then(r => r, () => ({ data: null }))`, takže by
    se ta kontrola tvářila, že proběhla, a duplicity by nehlídala nic.
    Přesně ten druh mlčení, kvůli kterému CLAUDE.md říká, že kontrola,
    která nemůže spadnout, je horší než žádná.

    Z čeho příspěvek vznikl, drží `marketing_verze.vstupy` — tam se
    zapisuje `menu_id`. Ptáme se tedy jí, a chybu dotazu bereme jako
    chybu běhu, ne jako „nic tam není".
  */
  const { data: verze, error: chybaHledani } = await supabase
    .from('marketing_verze')
    .select('prispevek_id')
    .eq('tenant_id', a.tenant_id)
    .eq('vstupy->>menu_id', nalezene.id)
    .limit(1)

  if (chybaHledani) {
    return { vysledek: 'chyba', duvod: chybaHledani.message, prispevky: [] }
  }

  if ((verze ?? []).length > 0) {
    return { vysledek: 'preskoceno', duvod: 'Na to menu už příspěvek je.', prispevky: [] }
  }

  const { data: prispevek, error } = await supabase
    .from('marketing_prispevky')
    .insert({
      tenant_id: a.tenant_id,
      branch_id: a.branch_id,
      nazev: `${nalezene.nazev || 'Menu'} — ${cilovyDen}`,
      pilir: 'menu',
      kanaly: a.kanaly && a.kanaly.length > 0 ? a.kanaly : ['instagram'],
      vytvoril: a.vlastnik,
    })
    .select('id')
    .single()

  if (error || !prispevek) {
    return { vysledek: 'chyba', duvod: error?.message ?? 'Koncept se nepodařilo založit.', prispevky: [] }
  }

  /*
    VERZE NESE ODKAZ NA MENU A POKYN, NE HOTOVÝ TEXT.

    Napsat text tady by znamenalo šablonu příspěvku v kódu — a pravidlo
    1 z CLAUDE.md říká, že nic o provozu do kódu nepatří. Text napíše
    člověk nebo model z `zadani`; `vstupy` drží, z čeho to vzniklo,
    takže je dohledatelné, které menu za tím stojí.
  */
  const obsah = prazdnyObsah()
  obsah.zadani = `Nabídka na ${cilovyDen} z menu „${nalezene.nazev || 'bez názvu'}". `
    + 'Krátký příspěvek: co dnes vaříme a proč se na to těšíme. '
    + 'Ceny a názvy ber z menu, nic nedomýšlej.'
  obsah.vstupy = { menu_id: nalezene.id, den: cilovyDen, automatizace_id: a.id }

  const { error: chybaVerze } = await supabase.from('marketing_verze').insert({
    tenant_id: a.tenant_id,
    prispevek_id: prispevek.id,
    cislo: 1,
    zadani: obsah.zadani,
    vstupy: obsah.vstupy,
    texty: obsah.texty,
    media_ids: obsah.media_ids,
    otisk: otiskVerze(obsah),
    poznamka: `Automatizace „${a.nazev}"`,
    vytvoril: a.vlastnik,
  })

  if (chybaVerze) {
    return { vysledek: 'chyba', duvod: chybaVerze.message, prispevky: [prispevek.id] }
  }

  return {
    vysledek: 'hotovo',
    duvod: `Z menu „${nalezene.nazev || 'bez názvu'}".`,
    prispevky: [prispevek.id],
  }
}


/* ===================================================================
   ZÁPIS BĚHU A POSUN NA PŘÍŠTĚ
   =================================================================== */

async function zapsatBeh(
  supabase: SupabaseClient,
  a: Automatizace,
  v: Vysledek,
): Promise<void> {
  /*
    Běh se zapisuje VŽDYCKY, i když se nic nevyrobilo. Historie, ve
    které jsou jen úspěchy, neodpoví na otázku „proč už týden nic
    nechodí" — a to je jediná otázka, kvůli které se do ní člověk
    podívá.
  */
  await supabase.from('marketing_automatizace_behy').insert({
    tenant_id: a.tenant_id,
    automatizace_id: a.id,
    vysledek: v.vysledek,
    zalozeno_konceptu: v.prispevky.length,
    duvod: v.duvod,
    prispevky: v.prispevky,
  })

  /*
    PŘÍŠTÍ BĚH SE POSOUVÁ I PO CHYBĚ.

    Kdyby se posouval jen po úspěchu, zůstala by automatizace
    s prošlým termínem navždy „na řadě": každý běh úlohy by ji zkusil
    znovu, pokaždé by spadla a historie by se zaplnila stejnou chybou
    stokrát za den. Posune se, a příští den se to zkusí znovu.
  */
  const { data: ted } = await supabase
    .rpc('marketing_ted_v_pasmu', { p_branch: a.branch_id })
    .maybeSingle()

  const vPasmu = ted as { den: string; cas: string } | null
  let pristi: string | null = null

  if (vPasmu) {
    const den = pristiBeh({
      dnes: vPasmu.den,
      ted: vPasmu.cas,
      cas: a.cas_spusteni.slice(0, 5),
      dnyVTydnu: a.dny_v_tydnu ?? [],
    })

    if (den) {
      const { data: okamzik } = await supabase.rpc('marketing_okamzik', {
        p_branch: a.branch_id,
        p_kdy: `${den}T${a.cas_spusteni.slice(0, 5)}:00`,
      })
      pristi = typeof okamzik === 'string' ? okamzik : null
    }
  }

  await supabase.from('marketing_automatizace')
    .update({
      posledni_beh_kdy: new Date().toISOString(),
      pristi_beh_kdy: pristi,
      zmeneno_kdy: new Date().toISOString(),
    })
    .eq('id', a.id)
}

/**
 * Posun dne o N dnů dopředu.
 *
 * Přes `Date.UTC` nad samotným datem, ne nad okamžikem: posun o den
 * se nesmí pokazit přechodem na letní čas (CLAUDE.md, pravidlo 11).
 * Je to totéž, co `terminKroku` v `lib/marketing-kampane.ts` — tady
 * se nepoužije, protože ta počítá opačným směrem (dny PŘED akcí).
 */
function posunutyDen(datum: string, oDnu: number): string {
  const [r, m, d] = datum.split('-').map(Number)
  const cil = new Date(Date.UTC(r, m - 1, d + oDnu))
  return `${cil.getUTCFullYear()}-${String(cil.getUTCMonth() + 1).padStart(2, '0')}-${String(cil.getUTCDate()).padStart(2, '0')}`
}
