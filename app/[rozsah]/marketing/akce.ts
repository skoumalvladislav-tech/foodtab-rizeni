'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser, type Permission } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { navrhnout } from '@/lib/marketing-ai'
import { rozsifrovat } from '@/lib/marketing-klice'
import { precistMenu } from '@/lib/marketing-menu-ai'
import { rozpoznatMenuZTextu, type MenuRozpoznanaPolozka } from '@/lib/marketing-menu-text'
import { precistObrazek } from '@/lib/marketing-obrazek'
import { doporuceneRadky } from '@/lib/marketing-sablony'
import { otiskVerze, prazdnyObsah, type ObsahVerze } from '@/lib/marketing'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
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

/**
 * Kdo jsem v téhle firmě. Zápisy se podepisují zaměstnancem, ne účtem.
 *
 * PTÁ SE NA `user_id`, A TO NENÍ OZDOBA. Politika `employees_select`
 * pouští ke všem zaměstnancům každého, kdo má `shifts.read` nebo
 * `people.manage` — tedy skoro každého vedoucího. Dotaz bez `user_id`
 * proto nevrací mě, ale prvního zaměstnance, kterého jsem směl vidět.
 * Žádost o schválení by se pak podepsala cizím jménem a pravidlo čtyř
 * očí by hlídalo někoho jiného, než kdo ji poslal.
 */
async function mujZamestnanec(tenantId: string): Promise<string | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await getServerSupabase()
  const r = await jeden<{ id: string }>(
    'můj záznam zaměstnance',
    supabase.from('employees').select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle(),
  )
  return r?.id ?? null
}

/** Společný začátek každé akce: firma, právo, rozsah. */
async function pripravit(rozsah: string, pravo: Permission) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
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

  /*
    ČÍM SE TO POŠLE, ŘÍKÁ PŘIPOJENÍ — NE TENHLE SOUBOR.

    Do 14. 9. 2026 tu stálo natvrdo `{ rezim: 'zakaznicky', poskytovatel:
    'n8n' }`. Bylo to špatně dvakrát: `zakaznicky` znamená účet
    zákazníka, jenže n8n se volá podle adresy z prostředí serveru, tedy
    účtem Foodtabu — a hlavně se tím zveřejňovalo i tehdy, když si firma
    žádný nástroj nevybrala. Obrazovka Nástroje (oddíl 3.1 zadání) je
    od toho, aby si volbu udělal zákazník; kdyby ji tenhle řádek obešel,
    byla by k ničemu.
  */
  const pripojeni = await jeden<{ id: string; poskytovatel: string; rezim: string }>(
    'připojený nástroj na zveřejňování',
    supabase.from('marketing_pripojeni')
      .select('id, poskytovatel, rezim')
      .eq('tenant_id', tenantId)
      .eq('kategorie', 'publikovani')
      .is('odpojeno_kdy', null)
      .or(`branch_id.eq.${prispevek.branch_id},branch_id.is.null`)
      .order('branch_id', { nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ).catch(() => null)

  const zpusob =
    zvoleno === 'zverejnit'
      ? (pripojeni && pripojeni.rezim !== 'rucni'
          ? { rezim: pripojeni.rezim, poskytovatel: pripojeni.poskytovatel, pripojeniId: pripojeni.id }
          : null)
      : zvoleno === 'nanecisto'
        ? { rezim: 'demo', poskytovatel: pripojeni?.poskytovatel ?? 'n8n', pripojeniId: pripojeni?.id ?? null }
        : { rezim: 'rucni', poskytovatel: 'rucni_export', pripojeniId: null }

  /*
    Nepřipojené zveřejňování NENÍ chyba modulu. Příspěvek je hotový,
    schválený a naplánovaný — jen ho musí někdo poslat ven sám. Proto
    se to říká větou, která vede na Nástroje, ne hláškou o chybě.
  */
  if (!zpusob) {
    redirect(`/${rozsah}/marketing/${prispevekId}?chyba=${encodeURIComponent(
      'Zveřejňování zatím není připojené. Vyberte nástroj v Marketing → Nástroje, ' +
      'nebo zvolte ruční zveřejnění — příspěvek zůstane naplánovaný a pustíte ho ven sami.')}`)
  }

  const ja = await mujZamestnanec(tenantId)

  /*
    ÚČET POBOČKY, NE ÚČET FIRMY.

    Černá Perla a Bernard Bar mají každý svůj profil. Do 14. 9. 2026 se
    `ucet_id` nevyplňovalo vůbec — tabulka `marketing_ucty` existovala
    a nikdo ji nečetl. Fungovalo to jen proto, že n8n má dnes napevno
    jeden účet; jakmile bude druhá pobočka, odešel by její příspěvek
    na cizí profil. To není chyba, které by si někdo všiml v logu:
    všimne si jí host, kterému se v profilu objeví cizí menu.

    Když účet není zavedený, `ucet_id` zůstane prázdné a posílá se dál
    jako dosud. Zastavit kvůli tomu zveřejňování by bylo přísnější než
    dnešní stav a nic by to nespravilo.
  */
  const ucty = await seznam<{ id: string; sit: string; schopnosti: string[] }>(
    'účty pobočky',
    supabase.from('marketing_ucty')
      .select('id, sit, schopnosti')
      .eq('tenant_id', tenantId)
      .eq('branch_id', prispevek.branch_id)
      .eq('aktivni', true),
  ).catch(() => [])

  const ucetProSit = new Map(ucty.map((u) => [u.sit, u]))

  let zalozeno = 0

  for (const kanal of prispevek.kanaly) {
    const ucet = ucetProSit.get(kanal)

    const { error } = await supabase.from('marketing_publikace_ulohy').insert({
      tenant_id: tenantId,
      prispevek_id: prispevekId,
      verze_id: prispevek.schvalena_verze_id,
      otisk_verze: zadost.otisk_verze,
      schvaleni_id: zadost.id,
      ucet_id: ucet?.id ?? null,
      kanal,
      format: 'prispevek',
      poskytovatel: zpusob.poskytovatel,
      pripojeni_id: zpusob.pripojeniId,
      rezim: zpusob.rezim,
      planovano_na: okamzik,
      /*
        Formát v klíči zůstává `prispevek`, i když se jinde rozlišují
        podrobnější (`feed`, `page_post`). Klíč drží jedinečnost —
        změnit ho znamená, že už odeslaná úloha se přestane poznávat
        a při opakování by odešla podruhé. Most mezi tvary je
        v `lib/marketing-kanaly.ts`.
      */
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

/**
 * NAČTENÍ DOPORUČENÝCH ŠABLON
 *
 * Zadání: master prompt, oddíl 9 („Knihovna gastro šablon").
 *
 * ---------------------------------------------------------------------
 * KATALOG JE NABÍDKA, ŠABLONA FIRMY JE ŘÁDEK
 *
 * Doporučené šablony jsou v `lib/marketing-sablony.ts` jako produktová
 * data. Tahle akce z nich udělá řádky té firmy — a od té chvíle si je
 * firma upravuje, vypíná a maže sama (CLAUDE.md, pravidlo 1).
 *
 * ---------------------------------------------------------------------
 * OPAKOVANÉ NAČTENÍ NESMÍ PŘEPSAT ÚPRAVY
 *
 * Kdo si šablonu přejmenoval nebo vypnul, o to nesmí přijít tím, že
 * někdo znovu klikne na „Načíst doporučené". Vkládá se proto jen to,
 * co ve firmě ještě není — podle `klic`, na kterém je jedinečnost
 * (`marketing_sablony_klic`).
 */
export async function nacistDoporuceneSablony(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const zpet = (co: string) =>
    redirect(`/${rozsah}/marketing/sablony?chyba=${encodeURIComponent(co)}`)

  const stavajici = await seznam<{ klic: string }>(
    'stávající šablony',
    supabase.from('marketing_sablony').select('klic').eq('tenant_id', tenantId),
  )
  const uz = new Set(stavajici.map((s) => s.klic))

  const chybejici = doporuceneRadky(tenantId).filter((r) => !uz.has(String(r.klic)))

  if (chybejici.length === 0) {
    redirect(`/${rozsah}/marketing/sablony?nic=1`)
  }

  const { error } = await supabase.from('marketing_sablony').insert(chybejici)
  if (error) zpet(error.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`/${rozsah}/marketing/sablony?nacteno=${chybejici.length}`)
}

/** Zapnout nebo vypnout šablonu. Vypnutá se nenabízí při tvorbě. */
export async function prepnoutSablonu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('sablona') ?? '')
  const zapnout = String(formData.get('zapnout') ?? '') === '1'
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const { error } = await supabase.from('marketing_sablony')
    .update({ aktivni: zapnout, zmeneno_kdy: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(`/${rozsah}/marketing/sablony?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing/sablony`)
  redirect(`/${rozsah}/marketing/sablony?ulozeno=1`)
}

/**
 * MENU — ZALOŽENÍ Z VLOŽENÉHO TEXTU
 *
 * Zadání: master prompt, oddíl 10.
 *
 * ---------------------------------------------------------------------
 * ČTE SE DETERMINISTICKY, NE MODELEM
 *
 * Vložený text je strukturovaný a model by u něj hádal — a zadání
 * hádání zakazuje: „AI nesmí domýšlet cenu, datum, alergen ani
 * složení." `lib/marketing-menu-text.ts` buď cenu najde, nebo ji nechá
 * prázdnou a označí položku ke kontrole.
 *
 * ---------------------------------------------------------------------
 * PŮVODNÍ TEXT SE ZACHOVÁ
 *
 * Do `puvodni_import` jde to, co člověk vložil. Když se za měsíc
 * ukáže, že cena sedí špatně, musí jít poznat, jestli ji přečetl
 * špatně import, nebo ji přepsal člověk.
 */
export async function zalozitMenuZTextu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const branchId = String(formData.get('pobocka') ?? '')
  const text = String(formData.get('text') ?? '')
  const druh = String(formData.get('druh') ?? 'denni')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const zpet = (co: string) =>
    redirect(`/${rozsah}/marketing/menu?chyba=${encodeURIComponent(co)}`)

  if (text.trim().length < 10) {
    zpet('Vložte text menu — aspoň pár řádků.')
  }

  /*
    Pobočka z formuláře je NÁVRH, ne oprávnění (pravidlo 4). Ověřuje se
    dotazem pod přihlášeným člověkem: cizí id prostě nenajde.
  */
  const pobocka = await jeden<{ id: string }>(
    'pobočka',
    supabase.from('branches').select('id').eq('id', branchId).eq('tenant_id', tenantId).maybeSingle(),
  )
  if (!pobocka) zpet('Vyberte provozovnu.')

  const rozpoznane = rozpoznatMenuZTextu(text)
  const ja = await mujZamestnanec(tenantId)

  const { data: menu, error: chybaMenu } = await supabase.from('marketing_menu').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    druh,
    nazev: rozpoznane.title || 'Menu bez názvu',
    plati_od: rozpoznane.valid_from,
    plati_do: rozpoznane.valid_to,
    zdroj: 'text',
    puvodni_import: { text, rozpoznane },
    vytvoril: ja,
  }).select('id').single()

  if (chybaMenu || !menu) zpet(chybaMenu?.message ?? 'Menu se nepodařilo založit.')

  /*
    Dny se zakládají jen u týdenního menu — u denního visí položky
    přímo na menu. Prázdná tabulka dnů není nedodělek.
  */
  const polozky: Record<string, unknown>[] = []
  let poradi = 0

  for (const p of rozpoznane.items) {
    polozky.push(polozkaDoRadku(p, tenantId, menu!.id, null, poradi++))
  }

  for (const [i, den] of rozpoznane.days.entries()) {
    const { data: radekDne } = await supabase.from('marketing_menu_dny').insert({
      tenant_id: tenantId,
      menu_id: menu!.id,
      den: den.day_date,
      nazev: den.label,
      poradi: i,
    }).select('id').single()

    for (const p of den.items) {
      polozky.push(polozkaDoRadku(p, tenantId, menu!.id, radekDne?.id ?? null, poradi++))
    }
  }

  if (polozky.length > 0) {
    const { error } = await supabase.from('marketing_menu_polozky').insert(polozky)
    if (error) zpet(error.message)
  }

  revalidatePath(`/${rozsah}/marketing/menu`)
  redirect(`/${rozsah}/marketing/menu/${menu!.id}?nacteno=${polozky.length}`)
}

/** Rozpoznaná položka jako řádek. Prázdná cena se NEPŘEVÁDÍ na nulu. */
function polozkaDoRadku(
  p: MenuRozpoznanaPolozka,
  tenantId: string,
  menuId: string,
  denId: string | null,
  poradi: number,
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    menu_id: menuId,
    den_id: denId,
    kategorie: p.category,
    nazev: p.name,
    popis: p.description,
    cena_haleru: p.price_cents,
    alergeny: p.allergens,
    poznamka: p.note,
    vyzaduje_kontrolu: p.needs_review,
    duvod_kontroly: p.review_reason,
    poradi,
  }
}

/**
 * Nové menu ručním formulářem.
 *
 * Zadání krok 2 (`docs/hlaseni/zadani-pro-ai-marketing-faktury.md`):
 * čtvrtá cesta vedle textu, fotky a PDF — mřížka řádků, žádný model,
 * žádné rozpoznávání. Co člověk napíše, to se uloží.
 *
 * ---------------------------------------------------------------------
 * PRÁZDNÁ CENA SE KE KONTROLE OZNAČÍ STEJNĚ JAKO U IMPORTU
 *
 * Pravidlo „cena se nikdy nedomýšlí" neplatí jen pro AI. Kdo řádek
 * vyplní bez ceny, ať už zapomněl nebo ji ještě nezná, má tu položku
 * vidět stejně zvýrazněnou jako tu, kterou nedokázala přečíst fotka —
 * `marketing_menu_potvrdit` mezi nimi taky nerozlišuje (`opravitPolozkuMenu`
 * výš dělá totéž).
 */
const RADKU_RUCNE = 8

export async function zalozitMenuRucne(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const branchId = String(formData.get('pobocka') ?? '')
  const druh = String(formData.get('druh') ?? 'denni')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const platiOd = String(formData.get('plati_od') ?? '').trim()
  const platiDo = String(formData.get('plati_do') ?? '').trim()
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const zpet = (co: string) =>
    redirect(`/${rozsah}/marketing/menu/nove?zpusob=rucne&chyba=${encodeURIComponent(co)}`)

  const pobocka = await jeden<{ id: string }>(
    'pobočka',
    supabase.from('branches').select('id').eq('id', branchId).eq('tenant_id', tenantId).maybeSingle(),
  )
  if (!pobocka) zpet('Vyberte provozovnu.')

  if (!platiOd) zpet('Vyplňte, od kdy menu platí.')

  const polozky: Record<string, unknown>[] = []
  let poradi = 0

  for (let i = 0; i < RADKU_RUCNE; i++) {
    const nazevPolozky = String(formData.get(`nazev_${i}`) ?? '').trim()
    // Prázdný řádek se přeskočí — mřížka má vždycky pár řádků navíc.
    if (!nazevPolozky) continue

    const cena = String(formData.get(`cena_${i}`) ?? '').trim()
    const haleru = cena === '' ? null : Math.round(Number(cena.replace(',', '.')) * 100)
    if (haleru !== null && (!Number.isFinite(haleru) || haleru < 0)) {
      zpet(`Řádek ${i + 1}: cena musí být číslo v korunách.`)
    }

    const alergeny = String(formData.get(`alergeny_${i}`) ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)

    polozky.push({
      tenant_id: tenantId,
      kategorie: String(formData.get(`kategorie_${i}`) ?? 'hlavni'),
      nazev: nazevPolozky,
      popis: String(formData.get(`popis_${i}`) ?? '').trim(),
      cena_haleru: haleru,
      alergeny,
      dostupnost: String(formData.get(`dostupnost_${i}`) ?? 'k_dispozici'),
      vyzaduje_kontrolu: haleru === null,
      duvod_kontroly: haleru === null ? 'Cena zatím není známá' : null,
      poradi: poradi++,
    })
  }

  const ja = await mujZamestnanec(tenantId)

  const { data: menu, error: chybaMenu } = await supabase.from('marketing_menu').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    druh,
    nazev: nazev || 'Menu bez názvu',
    plati_od: platiOd,
    plati_do: platiDo || null,
    zdroj: 'rucne',
    vytvoril: ja,
  }).select('id').single()

  if (chybaMenu || !menu) zpet(chybaMenu?.message ?? 'Menu se nepodařilo založit.')

  if (polozky.length > 0) {
    const { error } = await supabase.from('marketing_menu_polozky')
      .insert(polozky.map((p) => ({ ...p, menu_id: menu!.id })))
    if (error) zpet(error.message)
  }

  revalidatePath(`/${rozsah}/marketing/menu`)
  redirect(`/${rozsah}/marketing/menu/${menu!.id}?ulozeno=1`)
}

/** Oprava jedné položky člověkem. Tím z ní zmizí i příznak kontroly. */
export async function opravitPolozkuMenu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const menuId = String(formData.get('menu') ?? '')
  const id = String(formData.get('polozka') ?? '')
  const cena = String(formData.get('cena') ?? '').trim()
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  /*
    Prázdné políčko znamená „pořád nevíme", ne nula. Proto null, a
    příznak kontroly se v tom případě NESUNDÁVÁ.
  */
  const haleru = cena === '' ? null : Math.round(Number(cena.replace(',', '.')) * 100)

  if (haleru !== null && (!Number.isFinite(haleru) || haleru < 0)) {
    redirect(`/${rozsah}/marketing/menu/${menuId}?chyba=${encodeURIComponent('Cena musí být číslo v korunách.')}`)
  }

  const { error } = await supabase.from('marketing_menu_polozky')
    .update({
      nazev: String(formData.get('nazev') ?? '').trim() || 'Bez názvu',
      cena_haleru: haleru,
      vyzaduje_kontrolu: haleru === null,
      duvod_kontroly: haleru === null ? 'Cena zatím není známá' : null,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    redirect(`/${rozsah}/marketing/menu/${menuId}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing/menu/${menuId}`)
  redirect(`/${rozsah}/marketing/menu/${menuId}?ulozeno=1`)
}

/** Potvrzení menu. Rozhoduje databáze — viz migrace 20260914060000. */
export async function potvrditMenu(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const menuId = String(formData.get('menu') ?? '')
  const { supabase } = await pripravit(rozsah, 'marketing.manage')

  const { error } = await supabase.rpc('marketing_menu_potvrdit', { p_menu: menuId })

  if (error) {
    redirect(`/${rozsah}/marketing/menu/${menuId}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/${rozsah}/marketing/menu/${menuId}`)
  redirect(`/${rozsah}/marketing/menu/${menuId}?potvrzeno=1`)
}

/**
 * MENU Z FOTKY NEBO PDF
 *
 * Zadání: master prompt, oddíl 10 — třetí a čtvrtý způsob.
 *
 * ---------------------------------------------------------------------
 * SOUBOR SE NEUKLÁDÁ DO ÚLOŽIŠTĚ
 *
 * Přečte se a zahodí. Do `puvodni_import` jde výsledek čtení, ne
 * obrázek. Je to schválně: fotka tabule s dnešním menu nemá cenu
 * uchovávat, a kdyby se ukládala, přibyla by knihovna, kterou nikdo
 * neprochází a nikdo neuklízí.
 *
 * Kdyby se ukázalo, že je podklad potřeba dohledat, uloží se přes
 * `marketing_media` a zapíše do `zdroj_media_id` — sloupec na to
 * v tabulce je.
 */
export async function zalozitMenuZeSouboru(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const branchId = String(formData.get('pobocka') ?? '')
  const druh = String(formData.get('druh') ?? 'denni')
  const soubor = formData.get('soubor')
  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const zpet = (co: string) =>
    redirect(`/${rozsah}/marketing/menu?chyba=${encodeURIComponent(co)}`)

  if (!(soubor instanceof File) || soubor.size === 0) {
    zpet('Vyberte fotku nebo PDF.')
  }

  const pobocka = await jeden<{ id: string }>(
    'pobočka',
    supabase.from('branches').select('id').eq('id', branchId).eq('tenant_id', tenantId).maybeSingle(),
  )
  if (!pobocka) zpet('Vyberte provozovnu.')

  const bajty = new Uint8Array(await (soubor as File).arrayBuffer())

  /*
    Typ se bere ze SOUBORU, ne z toho, co napsal prohlížeč. `File.type`
    je údaj z klienta — a údaj z klienta je návrh (pravidlo 4).
    `precistObrazek` typ pozná z prvních bajtů; u PDF stačí jeho
    značka na začátku.
  */
  const jePdf = bajty.length > 4
    && bajty[0] === 0x25 && bajty[1] === 0x50 && bajty[2] === 0x44 && bajty[3] === 0x46
  // Čte se JEDNOU. Dvojí volání by otisk počítalo dvakrát zbytečně.
  const jakoObrazek = jePdf ? null : precistObrazek(bajty)
  const mime = jePdf
    ? 'application/pdf'
    : jakoObrazek?.stav === 'ok' ? jakoObrazek.obrazek.typ : ''

  if (!mime) {
    zpet('Tenhle soubor neumíme přečíst. Pošlete fotku (JPEG, PNG, WebP) nebo PDF.')
  }

  const vysledek = await precistMenu(
    bajty,
    mime,
    await klicZakaznika(supabase, tenantId, branchId),
  )

  if (vysledek.stav === 'chyba') zpet(vysledek.duvod)
  if (vysledek.stav !== 'hotovo') return

  const rozpoznane = vysledek.menu
  const ja = await mujZamestnanec(tenantId)

  const { data: menu, error: chybaMenu } = await supabase.from('marketing_menu').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    druh,
    nazev: rozpoznane.title || 'Menu bez názvu',
    plati_od: rozpoznane.valid_from,
    plati_do: rozpoznane.valid_to,
    zdroj: jePdf ? 'pdf' : 'fotka',
    puvodni_import: {
      rozpoznane,
      model: vysledek.model,
      verze_zadani: vysledek.verzeZadani,
      nazev_souboru: (soubor as File).name,
    },
    vytvoril: ja,
  }).select('id').single()

  if (chybaMenu || !menu) zpet(chybaMenu?.message ?? 'Menu se nepodařilo založit.')

  const polozky: Record<string, unknown>[] = []
  let poradi = 0

  for (const p of rozpoznane.items) {
    polozky.push(polozkaDoRadku(p, tenantId, menu!.id, null, poradi++))
  }

  for (const [i, den] of rozpoznane.days.entries()) {
    const { data: radekDne } = await supabase.from('marketing_menu_dny').insert({
      tenant_id: tenantId,
      menu_id: menu!.id,
      den: den.day_date,
      nazev: den.label,
      poradi: i,
    }).select('id').single()

    for (const p of den.items) {
      polozky.push(polozkaDoRadku(p, tenantId, menu!.id, radekDne?.id ?? null, poradi++))
    }
  }

  if (polozky.length > 0) {
    const { error } = await supabase.from('marketing_menu_polozky').insert(polozky)
    if (error) zpet(error.message)
  }

  revalidatePath(`/${rozsah}/marketing/menu`)
  redirect(`/${rozsah}/marketing/menu/${menu!.id}?nacteno=${polozky.length}`)
}

/**
 * HROMADNÉ SCHVÁLENÍ
 *
 * Zadání: master prompt, oddíl 14 — „umožni hromadné schválení více
 * příspěvků s jasným souhrnem".
 *
 * ---------------------------------------------------------------------
 * KAŽDÁ ŽÁDOST ZVLÁŠŤ, I KDYŽ SE ODKLEPNOU NAJEDNOU
 *
 * Jeden `update … in (…)` by byl rychlejší, ale spoušť
 * `app.marketing_strez_rozhodnuti` hlídá u KAŽDÉ žádosti zvlášť, kdo
 * o ní rozhoduje a jestli to není jeho vlastní. Hromadný zápis by na
 * první odmítnuté žádosti spadl celý a člověk by nevěděl, co se
 * schválilo a co ne.
 *
 * Takhle projde, co projít může, a na konci se řekne, kolik jich bylo
 * a proč zbytek ne. Zadání chce „jasný souhrn", ne tichý úspěch.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLO ČTYŘ OČÍ SE TÍM NEOBCHÁZÍ
 *
 * Rozhoduje pořád spoušť v databázi. Kdo si zaškrtne vlastní žádost,
 * dostane ji zpátky mezi neschválené — obrazovka mu ji ani nenabídne,
 * ale spoléhat se na to nesmí.
 */
export async function schvalitVice(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const zadosti = formData.getAll('zadost').map(String).filter(Boolean)
  const { supabase } = await pripravit(rozsah, 'marketing.publish')

  const zpet = (dotaz: string) => redirect(`/${rozsah}/marketing/schvalovani?${dotaz}`)

  if (zadosti.length === 0) {
    zpet(`chyba=${encodeURIComponent('Nevybrali jste žádný příspěvek.')}`)
  }

  let hotovo = 0
  const neproslo: string[] = []

  for (const id of zadosti) {
    const { error } = await supabase.from('marketing_schvaleni')
      .update({ stav: 'schvaleno' })
      .eq('id', id)

    if (error) neproslo.push(error.message)
    else hotovo++
  }

  revalidatePath(`/${rozsah}/marketing`, 'layout')

  if (neproslo.length === 0) {
    zpet(`schvaleno=${hotovo}`)
  }

  /*
    Do hlášky jde PRVNÍ důvod, ne všechny. Pět stejných vět pod sebou
    nikomu nepomůže a ta první bývá tatáž jako zbytek — typicky „o svou
    vlastní žádost nerozhodujte".
  */
  zpet(
    `schvaleno=${hotovo}&neproslo=${neproslo.length}`
    + `&duvod=${encodeURIComponent(neproslo[0])}`,
  )
}

/**
 * PŘESUN TERMÍNU Z KALENDÁŘE
 *
 * Zadání: master prompt, oddíl 15 — „přesunutí termínu s kontrolou
 * oprávnění a auditním záznamem".
 *
 * ---------------------------------------------------------------------
 * NENÍ TO `naplanovat` ZNOVU, A NESMÍ TO JÍ BÝT
 *
 * `naplanovat` teprve ZAKLÁDÁ publikační úlohy: ověří schválenou verzi,
 * platné schválení, vybere nástroj a založí úlohu na každý kanál.
 * Tady se nic nezakládá — příspěvek je naplánovaný, mění se jen KDY.
 *
 * Kdyby se sem zavolalo `naplanovat`, narazilo by to na idempotenční
 * klíč (`publikace:verze:kanal:format`), skončilo hláškou „na tuhle
 * verzi už je publikace naplánovaná" a čas by se neposunul. Nebo, což
 * je horší, kdyby ten klíč někdo uvolnil, vznikly by dvě úlohy a
 * příspěvek by šel ven dvakrát.
 *
 * ---------------------------------------------------------------------
 * POSOUVÁ SE I ÚLOHA, NE JEN PŘÍSPĚVEK
 *
 * TOHLE JE NA CELÉM PŘESUNU TO JEDINÉ, CO SE DÁ POKAZIT TIŠE.
 *
 * `planovano_na` je na dvou místech: na příspěvku (co se ukazuje
 * v kalendáři) a na publikační úloze (podle čeho si ji fronta
 * vyzvedne — `public.marketing_vyzvednout_publikace` čte úlohu, ne
 * příspěvek). Kdyby se posunul jen příspěvek, v kalendáři by seděl
 * nový termín a ven by to odešlo v ten starý. Nic by nespadlo a přišlo
 * by se na to až z Instagramu.
 *
 * ---------------------------------------------------------------------
 * CO UŽ ODEŠLO, SE NEPŘESOUVÁ
 *
 * Posouvají se jen úlohy ve stavu `naplanovano` nebo `selhalo`. Úlohu,
 * která je `ve_fronte`, `odesila_se` nebo `zverejneno`, nemá smysl
 * přesouvat — odeslané se neodešle zpátky a rozdělaná by se posunula
 * uprostřed práce. Když se nepřesune nic, řekne se to a termín
 * příspěvku se nemění: kalendář, který ukazuje jiný den než fronta,
 * je horší než přesun, který se nepovedl.
 */
export async function presunoutTermin(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const prispevekId = String(formData.get('prispevek') ?? '')
  const datum = String(formData.get('datum') ?? '')
  const cas = String(formData.get('cas') ?? '')
  const zpet = String(formData.get('zpet') ?? `/${rozsah}/marketing/kalendar`)

  const { supabase } = await pripravit(rozsah, 'marketing.publish')

  /*
    ANOTACE JE NA PROMĚNNÉ, NE NA FUNKCI, A NENÍ TO JEDNO.

    `redirect` vyhazuje výjimku, takže se za `chyba(…)` nepokračuje.
    Překladač to ale vezme v potaz jen tehdy, když má typ napsaný
    u PROMĚNNÉ (`const chyba: (t: string) => never`); s anotací
    u šipky (`(text: string): never =>`) to nestačí a za
    `chyba('nenašel se')` dál hlídá, že příspěvek může být prázdný.
    Psalo by se pak `prispevek!` — a vykřičník umlčí i to, co umlčet
    nemá.
  */
  const chyba: (text: string) => never = (text) =>
    redirect(`${zpet}${zpet.includes('?') ? '&' : '?'}chyba=${encodeURIComponent(text)}`)

  if (!datum || !cas) chyba('Vyplňte datum i čas.')

  const prispevek = await jeden<{ branch_id: string; planovano_na: string | null; stav: string }>(
    'příspěvek k přesunutí',
    supabase.from('marketing_prispevky').select('branch_id, planovano_na, stav')
      .eq('id', prispevekId).maybeSingle(),
  )

  if (!prispevek) chyba('Ten příspěvek se nenašel.')
  if (!prispevek.planovano_na) {
    chyba('Ten příspěvek zatím termín nemá. Naplánujte ho v detailu — tam se vybírá i způsob odeslání.')
  }
  if (prispevek.stav === 'zverejneno' || prispevek.stav === 'zverejnuje_se') {
    chyba('Zveřejněný příspěvek se přesunout nedá.')
  }

  /*
    Hodina na zdi se na okamžik převádí V DATABÁZI (pravidlo 11).
    Stejná cesta jako v `naplanovat` — `new Date('…T18:00')` by se
    přečetlo v pásmu serveru a ten je na Vercelu v UTC.
  */
  const okamzik = await pruzor<string>(
    'převod času na okamžik',
    supabase.rpc('marketing_okamzik', { p_branch: prispevek.branch_id, p_kdy: `${datum}T${cas}:00` }),
  )

  if (!okamzik) chyba('Čas se nepodařilo převést do pásma pobočky.')

  /*
    NEJDŘÍV ÚLOHY, POTOM PŘÍSPĚVEK.

    Kdyby se posunul nejdřív příspěvek a posun úloh pak selhal (třeba
    na oprávnění), zůstal by kalendář s novým termínem a fronta se
    starým. V tomhle pořadí je horší případ ten, že se posunou úlohy
    a příspěvek ne — a to je vidět hned, protože kalendář ukazuje
    starý den.
  */
  const { data: posunute, error: chybaUloh } = await supabase
    .from('marketing_publikace_ulohy')
    .update({ planovano_na: okamzik, zmeneno_kdy: new Date().toISOString() })
    .eq('prispevek_id', prispevekId)
    .in('stav', ['naplanovano', 'selhalo'])
    .select('id')

  if (chybaUloh) chyba(chybaUloh.message)

  if ((posunute?.length ?? 0) === 0) {
    chyba('Žádná čekající publikace k přesunutí — nejspíš už je odeslaná nebo se odesílá.')
  }

  const { error: chybaPrispevku } = await supabase.from('marketing_prispevky')
    .update({ planovano_na: okamzik, zmeneno_kdy: new Date().toISOString() })
    .eq('id', prispevekId)

  if (chybaPrispevku) chyba(chybaPrispevku.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  redirect(`${zpet}${zpet.includes('?') ? '&' : '?'}presunuto=1`)
}
