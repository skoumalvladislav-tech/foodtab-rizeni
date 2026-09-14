'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import type { Permission } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { navrhnout } from '@/lib/marketing-ai'
import { rozsifrovat } from '@/lib/marketing-klice'
import { otiskVerze, prazdnyObsah, type ObsahVerze } from '@/lib/marketing'
import { jeden, pruzor, seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Marketing — akce nad příspěvkem.
 *
 * Zadání: docs/marketing-je-modul.md.
 *
 * ---------------------------------------------------------------------
 * CO TENHLE SOUBOR NEHLÍDÁ, PROTOŽE TO HLÍDÁ DATABÁZE
 *
 * Že se bez schválení nic nezveřejní. Kdyby to bylo tady, dalo by se to
 * obejít jedním voláním mimo obrazovku — u Supabase se do tabulek dá
 * psát i přímo přes PostgREST. Drží to čtyři spouště
 * (20260909200000_marketing_obsah.sql, 20260910000000_marketing_vystup.sql)
 * a scénáře marketing3 a marketing5.
 *
 * Tady je druhá obranná linie: rozsah z adresy ověřený proti členství
 * (pravidlo 4) a `zkusPristup` před každým zápisem (pravidlo 3). Ani
 * jedna se nevynechává s tím, že to hlídá ta druhá.
 */

/** Kdo jsem v téhle firmě. Zápisy se podepisují zaměstnancem, ne účtem. */
async function mujZamestnanec(tenantId: string): Promise<string | null> {
  const supabase = await getServerSupabase()
  const r = await jeden<{ id: string }>(
    'můj záznam zaměstnance',
    supabase.from('employees').select('id').eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle(),
  )
  return r?.id ?? null
}

/** Společný začátek každé akce: firma, právo, rozsah. */
async function pripravit(rozsah: string, pravo: Permission) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing`)

  return {
    tenantId,
    branchId: pristup.scope.branchId,
    supabase: await getServerSupabase(),
  }
}

/**
 * Nový příspěvek.
 *
 * Příspěvek vždycky patří pobočce — firemní příspěvek neexistuje,
 * vždycky někdo zve k sobě. Na firemní úrovni se proto zakládat nedá
 * a obrazovka to říká dřív, než se člověk pustí do psaní.
 */
export async function zalozitPrispevek(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { tenantId, branchId, supabase } = await pripravit(rozsah, 'marketing.manage')

  if (!branchId) {
    redirect(`/${rozsah}/marketing/novy?chyba=${encodeURIComponent(
      'Příspěvek patří pobočce. Přepněte se na provozovnu, pro kterou ho připravujete.')}`)
  }

  const nazev = String(formData.get('nazev') ?? '').trim()
  if (!nazev) {
    redirect(`/${rozsah}/marketing/novy?chyba=${encodeURIComponent('Příspěvek potřebuje název.')}`)
  }

  const kanaly = formData.getAll('kanaly').map(String).filter((k) => k === 'instagram' || k === 'facebook')
  if (kanaly.length === 0) {
    redirect(`/${rozsah}/marketing/novy?chyba=${encodeURIComponent('Vyberte aspoň jeden kanál.')}`)
  }

  const ja = await mujZamestnanec(tenantId)

  const prispevek = await jeden<{ id: string }>(
    'založení příspěvku',
    supabase.from('marketing_prispevky').insert({
      tenant_id: tenantId,
      branch_id: branchId,
      nazev,
      ucel: String(formData.get('ucel') ?? 'atmosfera'),
      kanaly,
      vytvoril: ja,
    }).select('id').single(),
  )

  if (!prispevek) {
    redirect(`/${rozsah}/marketing/novy?chyba=${encodeURIComponent('Příspěvek se nepodařilo založit.')}`)
  }

  // První verze je prázdná. Není to zbytečnost: příspěvek bez verze by
  // neměl na co vázat schválení a stav by se neměl kde vzít.
  const obsah = prazdnyObsah()
  const { error } = await supabase.from('marketing_verze').insert({
    tenant_id: tenantId,
    prispevek_id: prispevek.id,
    cislo: 1,
    zadani: obsah.zadani,
    vstupy: obsah.vstupy,
    texty: obsah.texty,
    media_ids: obsah.media_ids,
    otisk: otiskVerze(obsah),
    poznamka: 'Založení',
    vytvoril: ja,
  })

  if (error) {
    redirect(`/${rozsah}/marketing/novy?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/${prispevek.id}`)
}

/**
 * Úprava textu → NOVÁ VERZE, nikdy přepis.
 *
 * Spoušť v databázi tím zruší schválení a zneplatní čekající žádost.
 * Je to záměr, ne vedlejší účinek: kdo text změní, posílá ho ke
 * schválení znovu.
 */
export async function ulozitVerzi(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const prispevekId = String(formData.get('prispevek') ?? '')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const soucasna = await jeden<{ id: string; cislo: number; zadani: string; vstupy: Record<string, unknown>; media_ids: string[]; titulni_media_id: string | null }>(
    'aktuální verze',
    supabase.from('marketing_verze')
      .select('id, cislo, zadani, vstupy, media_ids, titulni_media_id')
      .eq('prispevek_id', prispevekId)
      .order('cislo', { ascending: false })
      .limit(1)
      .maybeSingle(),
  )

  if (!soucasna) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('Příspěvek nemá žádnou verzi.')}`)
  }

  const texty: Record<string, { popisek: string }> = {}
  for (const kanal of ['instagram', 'facebook']) {
    const popisek = String(formData.get(`text_${kanal}`) ?? '').trim()
    if (popisek) texty[kanal] = { popisek }
  }

  /*
    FOTKY SE OVĚŘUJÍ PROTI KNIHOVNĚ, NE JEN PŘEVEZMOU Z FORMULÁŘE.

    Zaškrtávátka jsou údaj z prohlížeče, tedy návrh (pravidlo 4). Bez
    tohohle dotazu by stačilo přepsat jedno id a do verze by se uložila
    fotka cizí firmy — RLS by ji sice nikdy neukázala, ale otisk verze
    by ji zahrnul a fronta by se ji pokusila poslat ven.

    Dotaz jede pod přihlášeným člověkem, takže cizí id prostě nenajde
    a tiše vypadne. Nehlásí se to jako chyba: kdo poslal cizí id, ten
    to udělal schválně.
  */
  const vybrane = formData.getAll('media').map(String).filter(Boolean)
  let mediaIds: string[] = []

  if (vybrane.length > 0) {
    const nalezene = await seznam<{ id: string }>(
      'vybrané fotky',
      supabase
        .from('marketing_media')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('id', vybrane)
        .is('archivovano_kdy', null),
    )
    const platne = new Set(nalezene.map((m) => m.id))
    // Pořadí se drží podle formuláře, ne podle databáze — je to pořadí,
    // ve kterém fotky půjdou do koláže.
    mediaIds = vybrane.filter((id) => platne.has(id))
  }

  /*
    Titulní fotka je ta první vybraná. Zvláštní přepínač na ni zatím
    není: dokud se dá pořadí měnit jen zaškrtáváním, byl by to druhý
    ovladač na tutéž věc.
  */
  const titulni = mediaIds[0] ?? null

  const obsah: ObsahVerze = {
    zadani: String(formData.get('zadani') ?? '').trim(),
    vstupy: soucasna.vstupy ?? {},
    vybrana_varianta: null,
    texty,
    storyboard: null,
    media_ids: mediaIds,
    titulni_media_id: titulni,
  }

  const ja = await mujZamestnanec(tenantId)

  const { error } = await supabase.from('marketing_verze').insert({
    tenant_id: tenantId,
    prispevek_id: prispevekId,
    cislo: soucasna.cislo + 1,
    zadani: obsah.zadani,
    vstupy: obsah.vstupy,
    texty: obsah.texty,
    media_ids: obsah.media_ids,
    titulni_media_id: obsah.titulni_media_id,
    otisk: otiskVerze(obsah),
    poznamka: String(formData.get('poznamka') ?? 'Úprava textu').trim() || 'Úprava textu',
    vytvoril: ja,
  })

  if (error) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/${prispevekId}?ulozeno=1`)
}

/** Žádost o schválení aktuální verze. Otisk se kopíruje — schvaluje se přesně tenhle obsah. */
export async function pozadatOSchvaleni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const prispevekId = String(formData.get('prispevek') ?? '')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const verze = await jeden<{ id: string; otisk: string; texty: Record<string, unknown> }>(
    'aktuální verze k schválení',
    supabase.from('marketing_verze').select('id, otisk, texty')
      .eq('prispevek_id', prispevekId).order('cislo', { ascending: false }).limit(1).maybeSingle(),
  )

  if (!verze) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('Příspěvek nemá žádnou verzi.')}`)
  }
  if (Object.keys(verze.texty ?? {}).length === 0) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(
      'Nejdřív napište text. Prázdný příspěvek nemá co schvalovat.')}`)
  }

  const ja = await mujZamestnanec(tenantId)

  const { error } = await supabase.from('marketing_schvaleni').insert({
    tenant_id: tenantId,
    prispevek_id: prispevekId,
    verze_id: verze.id,
    otisk_verze: verze.otisk,
    zadal: ja,
    shrnuti: String(formData.get('shrnuti') ?? '').trim(),
  })

  if (error) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(error.message)}`)
  }

  await supabase.from('marketing_prispevky')
    .update({ stav: 'ceka_na_schvaleni', zmeneno_kdy: new Date().toISOString() })
    .eq('id', prispevekId)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/${prispevekId}?ulozeno=1`)
}

/**
 * Rozhodnutí o schválení.
 *
 * Právo `marketing.publish` se tu ověřuje, ale rozhoduje o něm spoušť
 * `app.marketing_strez_rozhodnuti` — ta hlídá i čtyři oči, což aplikace
 * spolehlivě neumí (nevidí, kdo všechno ve firmě smí schvalovat, aniž
 * by si autorizaci napsala podruhé).
 */
export async function rozhodnoutOSchvaleni(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const prispevekId = String(formData.get('prispevek') ?? '')
  const zadostId = String(formData.get('zadost') ?? '')
  const schvalit = String(formData.get('rozhodnuti') ?? '') === 'schvalit'
  const pripominka = String(formData.get('pripominka') ?? '').trim()

  const { supabase } = await pripravit(rozsah, 'marketing.publish')

  if (!schvalit && !pripominka) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(
      'K zamítnutí napište důvod — bez něj neví ten, kdo to psal, co má změnit.')}`)
  }

  const { error } = await supabase.from('marketing_schvaleni')
    .update({ stav: schvalit ? 'schvaleno' : 'zamitnuto', pripominka })
    .eq('id', zadostId)

  if (error) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/${prispevekId}?ulozeno=1`)
}

/**
 * Naplánování publikace.
 *
 * Hodina na zdi se převádí přes pásmo POBOČKY, ne serveru
 * (CLAUDE.md, pravidlo 11) — dělá to databáze funkcí `at time zone`,
 * protože jen ona zná pravidla letního času pro to konkrétní datum.
 * Proto se sem posílá datum a čas zvlášť, ne hotový okamžik.
 */
export async function naplanovat(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const prispevekId = String(formData.get('prispevek') ?? '')
  const datum = String(formData.get('datum') ?? '')
  const cas = String(formData.get('cas') ?? '')

  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.publish')

  if (!datum || !cas) redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('Vyplňte datum i čas.')}`)

  const prispevek = await jeden<{ branch_id: string; schvalena_verze_id: string | null; kanaly: string[] }>(
    'příspěvek k naplánování',
    supabase.from('marketing_prispevky').select('branch_id, schvalena_verze_id, kanaly')
      .eq('id', prispevekId).maybeSingle(),
  )

  if (!prispevek?.schvalena_verze_id) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('Naplánovat jde jen schválená verze. Pošlete příspěvek ke schválení.')}`)
  }

  const zadost = await jeden<{ id: string; otisk_verze: string }>(
    'platné schválení',
    supabase.from('marketing_schvaleni').select('id, otisk_verze')
      .eq('prispevek_id', prispevekId)
      .eq('verze_id', prispevek.schvalena_verze_id)
      .eq('stav', 'schvaleno')
      .order('rozhodnuto_kdy', { ascending: false })
      .limit(1).maybeSingle(),
  )

  if (!zadost) redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('K té verzi se nenašlo platné schválení.')}`)

  /*
    Hodina na zdi se na okamžik převádí V DATABÁZI, ne tady — pásmo
    dodá pobočka a jen Postgres zná pravidla letního času pro to
    konkrétní datum (pravidlo 11). `new Date('…T18:00')` by se přečetlo
    v pásmu serveru, a ten je na Vercelu v UTC.
  */
  const okamzik = await pruzor<string>(
    'převod času na okamžik',
    supabase.rpc('marketing_okamzik', { p_branch: prispevek.branch_id, p_kdy: `${datum}T${cas}:00` }),
  )

  if (!okamzik) redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('Čas se nepodařilo převést do pásma pobočky.')}`)

  /*
    JAK SE TO MÁ POSLAT.

    Byla tu natvrdo ruční cesta a bylo to špatně: ať se nastavilo
    cokoli, každý naplánovaný příspěvek skončil „k ručnímu
    zveřejnění" a k n8n se nikdy nic nedostalo. Kód, který nikdo
    nespustí, je horší než chybějící — vypadá hotově.

    Způsob je teď volba na obrazovce, ne domněnka:

      zverejnit  — pošle to ven přes n8n,
      nanecisto  — projde celá cesta a nikam se nic neodešle,
      rucne      — zveřejní to člověk sám.

    Cokoli mimo tenhle výčet je ruční cesta. Neznámá hodnota
    z formuláře nesmí skončit zveřejněním.
  */
  const zvoleno = String(formData.get('zpusob') ?? '')
  const zpusob =
    zvoleno === 'zverejnit' ? { rezim: 'zakaznicky', poskytovatel: 'n8n' }
    : zvoleno === 'nanecisto' ? { rezim: 'demo', poskytovatel: 'n8n' }
    : { rezim: 'rucni', poskytovatel: 'rucni_export' }

  const ja = await mujZamestnanec(tenantId)
  let zalozeno = 0

  for (const kanal of prispevek.kanaly) {
    const { error } = await supabase.from('marketing_publikace_ulohy').insert({
      tenant_id: tenantId,
      prispevek_id: prispevekId,
      verze_id: prispevek.schvalena_verze_id,
      otisk_verze: zadost.otisk_verze,
      schvaleni_id: zadost.id,
      kanal,
      format: 'prispevek',
      poskytovatel: zpusob.poskytovatel,
      rezim: zpusob.rezim,
      planovano_na: okamzik,
      idempotencni_klic: `publikace:${prispevek.schvalena_verze_id}:${kanal}:prispevek`,
      vytvoril: ja,
    })
    if (error && !error.message.includes('duplicate key')) redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(error.message)}`)
    if (!error) zalozeno++
  }

  await supabase.from('marketing_prispevky')
    .update({ stav: 'naplanovano', planovano_na: okamzik, zmeneno_kdy: new Date().toISOString() })
    .eq('id', prispevekId)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(zalozeno > 0
    ? `/${rozsah}/marketing/${prispevekId}?ulozeno=1`
    : `/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent('Na tuhle verzi už je publikace naplánovaná.')}`)
}

/**
 * AI NÁVRH
 *
 * Zadání: master prompt, oddíl 11.
 *
 * ---------------------------------------------------------------------
 * NÁVRH JE VERZE, NE POLÍČKO
 *
 * Návrh se ukládá jako nová verze — se vším, co k tomu patří: zruší
 * schválení, dostane vlastní otisk a je vidět v historii. Kdyby se
 * zapsal do stávající verze, přepsal by text, který už někdo schválil,
 * a schválení by přestalo znamenat cokoli.
 *
 * ---------------------------------------------------------------------
 * VARIANTY SE UKLÁDAJÍ VŠECHNY
 *
 * Model vrací dvě až tři. Do `texty` jde první, ale celý návrh zůstává
 * v `navrh_ai`, takže se dá přepnout na jinou, aniž se volá znovu.
 * Přepnutí je zase nová verze — viz výš.
 */
export async function navrhnoutText(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const prispevekId = String(formData.get('prispevek') ?? '')
  const pokyn = String(formData.get('pokyn') ?? '').trim()
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const zpet = (co: string) =>
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(co)}`)

  if (pokyn.length < 5) {
    zpet('Napište aspoň větu o tom, co má příspěvek říct.')
  }

  const prispevek = await jeden<{ branch_id: string; kanaly: string[] }>(
    'příspěvek',
    supabase.from('marketing_prispevky')
      .select('branch_id, kanaly')
      .eq('id', prispevekId)
      .maybeSingle(),
  )
  if (!prispevek) zpet('Příspěvek neexistuje.')

  const soucasna = await jeden<{ cislo: number; vstupy: Record<string, unknown>; media_ids: string[]; titulni_media_id: string | null }>(
    'aktuální verze',
    supabase.from('marketing_verze')
      .select('cislo, vstupy, media_ids, titulni_media_id')
      .eq('prispevek_id', prispevekId)
      .order('cislo', { ascending: false })
      .limit(1)
      .maybeSingle(),
  )
  if (!soucasna) zpet('Příspěvek nemá žádnou verzi.')

  // Značka: pobočkový řádek přebíjí firemní, rozhoduje o tom databáze.
  const znacka = await jeden<{
    ton_hlasu: string; pouzivat_emoji: boolean; podpis: string; kontakt: string
    vyrazy_ano: string[]; vyrazy_ne: string[]
  }>(
    'značka',
    supabase.rpc('marketing_znacka', { p_tenant: tenantId, p_branch: prispevek!.branch_id })
      .maybeSingle(),
  )

  /*
    Popisky fotek, ne fotky samotné. Model dostane text „talíř svíčkové
    shora", ne obrázek — obrázky by stály násobek a k napsání popisku
    nepřidají tolik.
  */
  let fotky: string[] = []
  if ((soucasna!.media_ids ?? []).length > 0) {
    const media = await seznam<{ alt_text: string; popis: string }>(
      'popisky fotek',
      supabase.from('marketing_media')
        .select('alt_text, popis')
        .eq('tenant_id', tenantId)
        .in('id', soucasna!.media_ids),
    )
    fotky = media.map((m) => (m.alt_text || m.popis).trim()).filter(Boolean)
  }

  const vysledek = await navrhnout(
    {
      pokyn,
      kanal: prispevek!.kanaly?.[0] ?? 'instagram',
      format: 'prispevek',
      znacka: {
        tonHlasu: znacka?.ton_hlasu ?? 'neformalni',
        pouzivatEmoji: znacka?.pouzivat_emoji ?? true,
        podpis: znacka?.podpis ?? '',
        kontakt: znacka?.kontakt ?? '',
        vyrazyAno: znacka?.vyrazy_ano ?? [],
        vyrazyNe: znacka?.vyrazy_ne ?? [],
      },
      fotky,
    },
    await klicZakaznika(supabase, tenantId, prispevek!.branch_id),
  )

  if (vysledek.stav === 'chyba') zpet(vysledek.duvod)
  if (vysledek.stav !== 'hotovo') return

  const prvni = vysledek.navrh.varianty[0]
  const kanal = prispevek!.kanaly?.[0] ?? 'instagram'

  const obsah: ObsahVerze = {
    zadani: pokyn,
    vstupy: soucasna!.vstupy ?? {},
    vybrana_varianta: prvni.nazev,
    texty: { [kanal]: { popisek: `${prvni.hook}\n\n${prvni.popisek}\n\n${prvni.cta}`.trim() } },
    storyboard: vysledek.navrh.storyboard.length > 0 ? vysledek.navrh.storyboard : null,
    media_ids: soucasna!.media_ids ?? [],
    titulni_media_id: soucasna!.titulni_media_id ?? null,
  }

  const ja = await mujZamestnanec(tenantId)

  const { error } = await supabase.from('marketing_verze').insert({
    tenant_id: tenantId,
    prispevek_id: prispevekId,
    cislo: soucasna!.cislo + 1,
    zadani: obsah.zadani,
    vstupy: obsah.vstupy,
    navrh_ai: vysledek.navrh,
    vybrana_varianta: obsah.vybrana_varianta,
    texty: obsah.texty,
    storyboard: obsah.storyboard,
    media_ids: obsah.media_ids,
    titulni_media_id: obsah.titulni_media_id,
    otisk: otiskVerze(obsah),
    poznamka: vysledek.jeUkazka ? 'Ukázka bez připojené AI' : 'Návrh od AI',
    ai_model: vysledek.model,
    ai_verze_zadani: vysledek.verzeZadani,
    vytvoril: ja,
  })

  if (error) zpet(error.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/${prispevekId}?navrh=1`)
}

/**
 * Klíč zákazníka k AI, pokud si ho připojil.
 *
 * Čte se přes `app.marketing_precti_tajemstvi`, která se sama ptá na
 * `marketing.publish` — přímo do tabulky s klíči se nesahá, ta pro
 * přihlášeného nemá žádný grant.
 *
 * Když připojení není, vrátí se null a rozhodne `lib/marketing-ai`:
 * klíč Foodtabu, nebo ukázka. Chybějící připojení NENÍ chyba.
 */
async function klicZakaznika(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
  branchId: string,
): Promise<string | null> {
  const pripojeni = await jeden<{ id: string }>(
    'připojení k AI',
    supabase.from('marketing_pripojeni')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('kategorie', 'ai_text')
      .is('odpojeno_kdy', null)
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .order('branch_id', { nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ).catch(() => null)

  if (!pripojeni) return null

  const { data, error } = await supabase.rpc('marketing_precti_tajemstvi', {
    p_pripojeni: pripojeni.id,
  })
  if (error || typeof data !== 'string' || !data) return null

  try {
    return rozsifrovat(data).klic ?? null
  } catch {
    // Rozbitá šifra není důvod obrazovku položit — spadne se na ukázku.
    return null
  }
}
