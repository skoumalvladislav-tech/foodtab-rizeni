'use server'

import { randomUUID } from 'node:crypto'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { rozsifrovat } from '@/lib/marketing-klice'
import { KBELIK, PLATNOST_ODKAZU_S, SBIRKA_KANDIDAT_ZNACKY, cestaVUlozisti } from '@/lib/marketing-media'
import { precistObrazek } from '@/lib/marketing-obrazek'
import { navrhnoutProfil, type NavrhProfil } from '@/lib/marketing-profil-ai'
import { stahnoutObrazekBezpecne } from '@/lib/marketing-ssrf'
import { jeden } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Návrh značky z odkazu na web/sociální síť — Marketing → Značka.
 *
 * Zadání Šéfíka 1. 10. 2026, upřesnění 4: tlačítko žije PŘÍMO na
 * obrazovce Značka (`app/[rozsah]/marketing/znacka/`), vedle dnešních
 * polí tónu a barev — ne jako samostatný průvodce. Návrh se tu jen
 * SESTAVÍ a vrátí klientovi k doladění; jediné místo, které cokoliv
 * zapisuje do `marketing_nastaveni`, zůstává `ulozitZnacku()` v
 * `./akce.ts` — člověk musí pořád sám stisknout „Uložit“.
 *
 * ---------------------------------------------------------------------
 * PRÁVO A ROZSAH STEJNĚ JAKO `ulozitZnacku`
 *
 * `marketing.manage`, rozsah z ADRESY ověřený proti členství
 * (`zkusPristup`) — NIKDY z formuláře (pravidlo 4 CLAUDE.md). Žádné
 * skryté pole s `branch_id` tu není a nesmí být.
 *
 * ---------------------------------------------------------------------
 * LOGO SE PŘESTO DO KNIHOVNY MÉDIÍ ZAPÍŠE — A PROČ TO NENÍ VÝJIMKA
 *
 * Kbelík `marketing` je soukromý (foodtab-marketing) — bez uloženého
 * záznamu v `marketing_media` by nešlo kandidátní logo vůbec ukázat
 * k náhledu (podepsaný odkaz potřebuje `cesta` v tabulce). Zápis sem
 * je tedy nutná součást „ukázat návrh k doladění“, ne zápis značky
 * samotné — `marketing_nastaveni.logo_media_id` se nastaví až tehdy,
 * když člověk návrh přijme a stiskne „Uložit“ v `ulozitZnacku`.
 *
 * Nahrávání samo je DOSLOVA stejná cesta jako ruční nahrání fotky
 * (`app/[rozsah]/marketing/media/akce.ts`): `precistObrazek()`,
 * `cestaVUlozisti()`, kbelík `KBELIK`, úklid osiřelého souboru při
 * chybě zápisu řádku. Nepíše se tu druhá validace ani druhý upload.
 *
 * ---------------------------------------------------------------------
 * ALE NENÍ TO BĚŽNÁ FOTKA — `sbirka = 'kandidat_znacky'`
 *
 * Nález kontroly konzistence: bez rozlišení by tenhle řádek měl stejnou
 * `sbirka`/`archivovano_kdy` jako běžně nahraná fotka, a byl by tak
 * hned vidět ve sdílené Knihovně fotek (`media/page.tsx`) i ve výběru
 * pro příspěvek (`tvorba/page.tsx`, `[prispevek]/page.tsx`, `akce.ts`),
 * ačkoli ho nikdo nepřijal — opakované zkoušení odkazů by tak potichu
 * plnilo knihovnu neoznačenými kandidáty. Vlastní hodnota `sbirka`
 * (`'kandidat_znacky'`, povolená migrací `20260929150000_…`) tyhle
 * tři výpisy vyřazuje; `ulozitZnacku` v `./akce.ts` řádek při přijetí
 * přeřadí zpátky na `'ostatni'`, ať se po uložení chová jako kterákoli
 * jiná fotka v knihovně.
 */

export type NavrhZnackyProKlienta = {
  popis: string | null
  barva_hlavni: string | null
  barva_doplnkova: string | null
  barva_pozadi: string | null
  web_url: string | null
  instagram_url: string | null
  facebook_url: string | null
  /** `id` v `marketing_media`, pokud se logo podařilo stáhnout a uložit. */
  logo_media_id: string | null
  /** Podepsaný odkaz na náhled loga — kbelík je soukromý, přímá adresa nejde. */
  logo_nahled: string | null
  zdroje: string[]
  nejiste: string[]
}

export type StavNavrhuZnacky =
  | { stav: 'nic' }
  | { stav: 'chyba'; text: string }
  | { stav: 'hotovo'; navrh: NavrhZnackyProKlienta }

export async function navrhnoutZnackuZOdkazu(
  _predchozi: StavNavrhuZnacky,
  formData: FormData,
): Promise<StavNavrhuZnacky> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const odkaz = String(formData.get('odkaz') ?? '').trim()

  if (!odkaz) {
    return { stav: 'chyba', text: 'Vyplňte odkaz na web, Instagram nebo Facebook firmy.' }
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return { stav: 'chyba', text: 'Firmu se nepodařilo načíst.' }

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav !== 'ok') {
    return { stav: 'chyba', text: 'Na úpravu značky nemáte oprávnění.' }
  }

  const branchId = pristup.scope.branchId
  const supabase = await getServerSupabase()

  const vysledek = await navrhnoutProfil(
    { odkaz },
    await klicZakaznikaProRozsah(supabase, tenantId, branchId),
  )

  if (vysledek.stav === 'chyba') {
    return { stav: 'chyba', text: vysledek.duvod }
  }

  const { navrh } = vysledek
  const logo = await ulozitNavrzeneLogo(supabase, tenantId, branchId, navrh)

  return {
    stav: 'hotovo',
    navrh: {
      popis: navrh.popis,
      barva_hlavni: navrh.barva_hlavni,
      barva_doplnkova: navrh.barva_doplnkova,
      barva_pozadi: navrh.barva_pozadi,
      web_url: navrh.web_url,
      instagram_url: navrh.instagram_url,
      facebook_url: navrh.facebook_url,
      logo_media_id: logo.logoMediaId,
      logo_nahled: logo.logoNahled,
      zdroje: navrh.zdroje,
      nejiste: logo.nejiste,
    },
  }
}

/**
 * Klíč zákazníka k AI, pro DANÝ ROZSAH (firma i pobočka).
 *
 * Záměrně malá VLASTNÍ kopie `klicZakaznika()` z `../akce.ts`, ne import
 * odtamtud: tahle obrazovka pracuje i na FIREMNÍ úrovni, kde je
 * `branchId === null` — a `.or('branch_id.eq.'+branchId+',branch_id.is.null')`
 * ve sdílené verzi by s prázdným/`null` `branchId` sestavilo nesmyslný
 * filtr. Tady se null rozsah ošetří zvlášť, ne obchází.
 */
async function klicZakaznikaProRozsah(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
  branchId: string | null,
): Promise<string | null> {
  const zaklad = supabase
    .from('marketing_pripojeni')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('kategorie', 'ai_text')
    .is('odpojeno_kdy', null)

  const dotaz =
    branchId === null
      ? zaklad.is('branch_id', null).limit(1).maybeSingle()
      : zaklad
          .or(`branch_id.eq.${branchId},branch_id.is.null`)
          .order('branch_id', { nullsFirst: false })
          .limit(1)
          .maybeSingle()

  const pripojeni = await jeden<{ id: string }>('připojení k AI', dotaz).catch(() => null)
  if (!pripojeni) return null

  const { data, error } = await supabase.rpc('marketing_precti_tajemstvi', {
    p_pripojeni: pripojeni.id,
  })
  if (error || typeof data !== 'string' || !data) return null

  try {
    return rozsifrovat(data).klic ?? null
  } catch {
    // Rozbitá šifra není důvod návrh položit — pokračuje se bez zákaznického klíče.
    return null
  }
}

/**
 * Stažení a uložení kandidátního loga.
 *
 * Cokoli se tu pokazí (zamítnutá IP, moc velké, špatný typ, timeout,
 * síť, zápis do databáze), se NESMÍ rozbít celý návrh — logo se jen
 * vynechá a důvod se přidá do `nejiste`, ať to Šéfík vidí, ne aby se
 * tvářilo, že logo nikdy nebylo nabídnuté.
 */
async function ulozitNavrzeneLogo(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
  branchId: string | null,
  navrh: NavrhProfil,
): Promise<{ logoMediaId: string | null; logoNahled: string | null; nejiste: string[] }> {
  const nejiste = [...navrh.nejiste]

  if (!navrh.logo_url) {
    return { logoMediaId: null, logoNahled: null, nejiste }
  }

  const stazeno = await stahnoutObrazekBezpecne(navrh.logo_url)
  if (stazeno.stav === 'chyba') {
    nejiste.push(`logo (${stazeno.duvod})`)
    return { logoMediaId: null, logoNahled: null, nejiste }
  }

  const precteno = precistObrazek(stazeno.data)
  if (precteno.stav === 'chyba') {
    nejiste.push(`logo (${precteno.duvod})`)
    return { logoMediaId: null, logoNahled: null, nejiste }
  }

  const obrazek = precteno.obrazek

  // Týž otisk obsahu už v knihovně je → nabídne se ten, nenahrává se podruhé.
  const uz = await jeden<{ id: string; cesta: string }>(
    'logo se stejným otiskem',
    supabase
      .from('marketing_media')
      .select('id, cesta')
      .eq('tenant_id', tenantId)
      .eq('otisk', obrazek.otisk)
      .is('archivovano_kdy', null)
      .limit(1)
      .maybeSingle(),
  ).catch(() => null)

  if (uz) {
    return { logoMediaId: uz.id, logoNahled: await podepsanyOdkaz(supabase, uz.cesta), nejiste }
  }

  const kam = cestaVUlozisti(tenantId, branchId, randomUUID(), obrazek.pripona)

  const nahrano = await supabase.storage.from(KBELIK).upload(kam, stazeno.data, {
    contentType: obrazek.typ,
    upsert: false,
  })

  if (nahrano.error) {
    nejiste.push(`logo (uložení selhalo: ${nahrano.error.message})`)
    return { logoMediaId: null, logoNahled: null, nejiste }
  }

  const vlozeno = await supabase
    .from('marketing_media')
    .insert({
      tenant_id: tenantId,
      branch_id: branchId,
      druh: 'foto',
      // Vlastní sbírka, ne 'ostatni' — nález konzistence: dokud návrh
      // nikdo nepřijme uložením značky, nesmí se objevit ve sdílené
      // Knihovně fotek ani jít vybrat do příspěvku (media/page.tsx,
      // tvorba/page.tsx, [prispevek]/page.tsx a akce.ts ho proto
      // vyřazují). Přijetí (`ulozitZnacku` v ./akce.ts) ho přeřadí
      // zpátky na 'ostatni'.
      sbirka: SBIRKA_KANDIDAT_ZNACKY,
      nazev_souboru: `logo-z-webu.${obrazek.pripona}`,
      cesta: kam,
      mime: obrazek.typ,
      velikost_bajtu: obrazek.bajtu,
      sirka: obrazek.sirka,
      vyska: obrazek.vyska,
      otisk: obrazek.otisk,
      popis: 'Logo navržené nástrojem „Najít na webu“',
      puvod: navrh.web_url ?? '',
    })
    .select('id')
    .single()

  if (vlozeno.error || !vlozeno.data) {
    // Úklid sirotka — stejný vzor jako nahratFotku() v media/akce.ts.
    await supabase.storage.from(KBELIK).remove([kam])
    nejiste.push(`logo (zápis do knihovny selhal: ${vlozeno.error?.message ?? 'neznámá chyba'})`)
    return { logoMediaId: null, logoNahled: null, nejiste }
  }

  return {
    logoMediaId: vlozeno.data.id as string,
    logoNahled: await podepsanyOdkaz(supabase, kam),
    nejiste,
  }
}

async function podepsanyOdkaz(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  cesta: string,
): Promise<string | null> {
  const podepsano = await supabase.storage.from(KBELIK).createSignedUrl(cesta, PLATNOST_ODKAZU_S)
  return podepsano.data?.signedUrl ?? null
}
