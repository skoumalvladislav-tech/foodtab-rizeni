'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getUser, type Permission } from '@/lib/authz'
import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { navrhnoutSerii, pristiBeh } from '@/lib/marketing-kampane'
import { otiskVerze, prazdnyObsah } from '@/lib/marketing'
import { jeden, pruzor, seznam } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Kampaně a automatizace — akce.
 *
 * Zadání: master prompt, oddíl 15.
 *
 * ---------------------------------------------------------------------
 * SÉRIE VYRÁBÍ KONCEPTY, NIC VÍC
 *
 * Z akce vznikne pozvánka, připomínka, poslední výzva a poděkování —
 * všechno jako KONCEPT s navrženým termínem. Žádný z nich se
 * nenaplánuje ke zveřejnění: to umí jen `naplanovat` v `../akce.ts`
 * a ta vyžaduje schválenou verzi s platným schválením.
 *
 * Kdyby se tady naplánovalo, byla by to druhá cesta ven a obešla by
 * čtyři spouště, na kterých stojí celé schvalování. Stačilo by jednou
 * špatně zadat akci a odešly by čtyři příspěvky, které nikdo neviděl.
 */

/** Kdo jsem v téhle firmě. Ptá se na `user_id` — viz `../akce.ts`. */
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

async function pripravit(rozsah: string, pravo: Permission) {
  const tenantId = await getCurrentTenantId()
  if (!tenantId) redirect('/')

  const pristup = await zkusPristup(tenantId, pravo, rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') redirect(`/${rozsah}/marketing/kampane`)

  return {
    tenantId,
    branchId: pristup.scope.branchId,
    supabase: await getServerSupabase(),
  }
}

function zpetNa(rozsah: string, dotaz: string): never {
  redirect(`/${rozsah}/marketing/kampane?${dotaz}`)
}

/*
  Typ je na PROMĚNNÉ, ne na šipce, a není to jedno: jen tak vezme
  překladač v potaz, že se za `chybne(…)` nepokračuje. S anotací
  u šipky by dál hlídal, že kampaň může být prázdná — a psalo by se
  `kampan!`, což umlčí i to, co umlčet nemá.
*/
const chybne: (rozsah: string, text: string) => never = (rozsah, text) =>
  zpetNa(rozsah, `chyba=${encodeURIComponent(text)}`)


/* ===================================================================
   KAMPAŇ
   =================================================================== */

export async function zalozitKampan(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const cil = String(formData.get('cil') ?? '').trim()
  const datum = String(formData.get('datum') ?? '')
  const cas = String(formData.get('cas') ?? '18:00')
  const pobocka = String(formData.get('pobocka') ?? '')

  const { tenantId, branchId, supabase } = await pripravit(rozsah, 'marketing.manage')

  if (!nazev) chybne(rozsah, 'Kampaň potřebuje název.')

  /*
    ROZSAH Z PROHLÍŽEČE JE NÁVRH, NE OPRÁVNĚNÍ (CLAUDE.md, pravidlo 4).
    Když se pobočka posílá formulářem, ověří se proti tomu, na co
    přihlášený dosáhne — jinak by stačilo přepsat jedno číslo.
  */
  const cilovaPobocka = pobocka || branchId
  if (!cilovaPobocka) chybne(rozsah, 'Vyberte provozovnu.')

  if (pobocka && pobocka !== branchId) {
    const smi = await zkusPristup(tenantId, 'marketing.manage', pobocka)
    if (smi.stav !== 'ok') chybne(rozsah, 'Na tu provozovnu nemáte oprávnění.')
  }

  /*
    Termín akce je hodina na zdi. Okamžik z něj dělá databáze s pásmem
    pobočky (pravidlo 11) — `new Date('…T18:00')` by se přečetlo
    v pásmu serveru, a ten je na Vercelu v UTC.
  */
  let konaSe: string | null = null
  if (datum) {
    konaSe = await pruzor<string>(
      'převod termínu akce',
      supabase.rpc('marketing_okamzik', { p_branch: cilovaPobocka, p_kdy: `${datum}T${cas}:00` }),
    )
    if (!konaSe) chybne(rozsah, 'Termín se nepodařilo převést do pásma provozovny.')
  }

  const ja = await mujZamestnanec(tenantId)

  const { error } = await supabase.from('marketing_kampane').insert({
    tenant_id: tenantId,
    branch_id: cilovaPobocka,
    nazev,
    cil,
    kona_se_kdy: konaSe,
    pilir: String(formData.get('pilir') ?? 'akce'),
    zalozil: ja,
  })

  if (error) chybne(rozsah, error.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  zpetNa(rozsah, 'zalozeno=1')
}


/**
 * SÉRIE KE KAMPANI
 *
 * Zadání, oddíl 15: „série příspěvků: pozvánka → připomínka →
 * poslední výzva → report po akci".
 */
export async function vyrobitSerii(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const kampanId = String(formData.get('kampan') ?? '')

  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.manage')

  const kampan = await jeden<{
    id: string; branch_id: string; nazev: string; kona_se_kdy: string | null; pilir: string
  }>(
    'kampaň',
    supabase.from('marketing_kampane')
      .select('id, branch_id, nazev, kona_se_kdy, pilir')
      .eq('id', kampanId).eq('tenant_id', tenantId).maybeSingle(),
  )

  if (!kampan) chybne(rozsah, 'Ta kampaň se nenašla.')
  if (!kampan.kona_se_kdy) {
    chybne(rozsah, 'Sérii jde vyrobit jen ke kampani, která má termín akce. Doplňte ho.')
  }

  /*
    UŽ VYROBENOU SÉRII NEDĚLÁME PODRUHÉ.

    Zadání chce ochranu před duplicitní publikací. Tohle je o krok
    dřív: dvojí klik na „Vyrobit sérii" by založil osm konceptů a čtyři
    z nich by nikdo nečekal. Pozná se to podle toho, že ke kampani už
    nějaké příspěvky jsou.
  */
  const uz = await seznam<{ id: string }>(
    'příspěvky kampaně',
    supabase.from('marketing_prispevky').select('id').eq('kampan_id', kampanId).limit(1),
  )
  if (uz.length > 0) {
    chybne(rozsah, 'K téhle kampani už příspěvky jsou. Sérii vyrábíme jen jednou — '
      + 'další přidejte ručně.')
  }

  /*
    DEN AKCE I DNEŠEK SE BEROU Z PÁSMA POBOČKY, NE ZE SERVERU.

    Počítá je databáze (`app.business_date`), protože jen ta zná
    pravidla letního času pro to konkrétní datum. `new Date(...)
    .toISOString().slice(0,10)` by po 22:00 tvrdilo, že je zítra —
    a pozvánka by se označila jako pozdní o den dřív.
  */
  const denAkce = await pruzor<string>(
    'den akce v pásmu pobočky',
    supabase.rpc('business_date', { p_branch: kampan.branch_id, p_at: kampan.kona_se_kdy }),
  ).catch(() => null)

  /*
    Dnešek se taky ptá databáze — s `p_at` vynechaným, takže si vezme
    `now()` a převede ho pásmem pobočky. `new Date().toISOString()
    .slice(0,10)` by dalo den v UTC a po 22:00 by tvrdilo, že je zítra.
  */
  const dnes = await pruzor<string>(
    'dnešek v pásmu pobočky',
    supabase.rpc('business_date', { p_branch: kampan.branch_id }),
  ).catch(() => null)

  if (!denAkce || !dnes) {
    chybne(rozsah, 'Nepodařilo se určit den akce v pásmu provozovny. Zkuste to znovu.')
  }

  const kroky = navrhnoutSerii({ denAkce, dnes })
  const ja = await mujZamestnanec(tenantId)
  let zalozeno = 0

  for (const k of kroky) {
    /*
      TERMÍN JEN U TOHO, CO JEŠTĚ NEBYLO.

      Naplánovat příspěvek na včerejšek by v kalendáři vypadalo jako
      chyba a u fronty by to byla past. Pozdní krok se založí jako
      koncept bez data — pořád se hodí, jen si termín zvolí člověk.
    */
    const kdy = k.jePozde
      ? null
      : await pruzor<string>(
        'termín kroku',
        supabase.rpc('marketing_okamzik', { p_branch: kampan.branch_id, p_kdy: `${k.datum}T${k.cas}:00` }),
      ).catch(() => null)

    const { data: prispevek, error } = await supabase.from('marketing_prispevky').insert({
      tenant_id: tenantId,
      branch_id: kampan.branch_id,
      kampan_id: kampanId,
      nazev: `${kampan.nazev} — ${k.nazev}`,
      pilir: k.pilir,
      kanaly: ['instagram', 'facebook'],
      planovano_na: kdy,
      vytvoril: ja,
    }).select('id').single()

    if (error || !prispevek) continue

    /*
      PRVNÍ VERZE NESE POKYN, NE HOTOVÝ TEXT.

      Do `zadani` jde věta pro AI návrh. Vymyslet text tady by
      znamenalo šablonu v kódu — a pravidlo 1 z CLAUDE.md říká, že nic
      o provozu nepatří do kódu. Text napíše člověk nebo model.
    */
    const obsah = prazdnyObsah()
    obsah.zadani = k.pokyn

    await supabase.from('marketing_verze').insert({
      tenant_id: tenantId,
      prispevek_id: prispevek.id,
      cislo: 1,
      zadani: obsah.zadani,
      vstupy: obsah.vstupy,
      texty: obsah.texty,
      media_ids: obsah.media_ids,
      otisk: otiskVerze(obsah),
      poznamka: `Série ke kampani „${kampan.nazev}"`,
      vytvoril: ja,
    })

    zalozeno++
  }

  if (zalozeno === 0) chybne(rozsah, 'Nepodařilo se založit ani jeden koncept.')

  await supabase.from('marketing_kampane')
    .update({ stav: 'bezi', zmeneno_kdy: new Date().toISOString() })
    .eq('id', kampanId)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  zpetNa(rozsah, `serie=${zalozeno}`)
}


/* ===================================================================
   AUTOMATIZACE
   =================================================================== */

export async function zalozitAutomatizaci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const nazev = String(formData.get('nazev') ?? '').trim()
  const druh = String(formData.get('druh') ?? '')
  const cas = String(formData.get('cas') ?? '08:00')
  const predstih = Number(formData.get('predstih') ?? 0)
  const dny = formData.getAll('den').map((d) => Number(d)).filter((d) => d >= 1 && d <= 7)

  const { tenantId, branchId, supabase } = await pripravit(rozsah, 'marketing.publish')

  if (!nazev) chybne(rozsah, 'Automatizace potřebuje název.')
  if (!branchId) chybne(rozsah, 'Automatizace se zakládá na provozovně, ne za celou firmu.')

  const ja = await mujZamestnanec(tenantId)

  /*
    ZAKLÁDÁ SE VYPNUTÁ, i když by to uživatel chtěl jinak.

    Automatizace, která se rozběhne v okamžiku, kdy ji člověk založí,
    je přesně to, co nikdo nechce: napoprvé se nastavuje naslepo
    a první běh by přišel dřív, než si to stihne přečíst. Zapíná se
    zvlášť, jedním kliknutím — a je u toho vidět, kdy poběží.
  */
  const { error } = await supabase.from('marketing_automatizace').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    nazev,
    druh,
    cas_spusteni: cas,
    dny_v_tydnu: dny,
    predstih_dnu: Number.isFinite(predstih) ? Math.max(0, Math.min(30, predstih)) : 0,
    kanaly: formData.getAll('kanal').map(String),
    vlastnik: ja,
    zapnuta: false,
  })

  if (error) chybne(rozsah, error.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  zpetNa(rozsah, 'automat=1')
}

/**
 * VYPÍNAČ
 *
 * Zadání, oddíl 15: „možnost bezpečně ji pozastavit". Pozastavení je
 * změna jednoho příznaku — řádek i historie zůstávají. Smazání by
 * historii vzalo s sebou a nedalo by se zjistit, co ta automatizace
 * kdy udělala.
 */
export async function prepnoutAutomatizaci(formData: FormData): Promise<void> {
  const rozsah = String(formData.get('rozsah') ?? '')
  const id = String(formData.get('automatizace') ?? '')
  const zapnout = String(formData.get('zapnout') ?? '') === '1'

  const { tenantId, supabase } = await pripravit(rozsah, 'marketing.publish')

  const a = await jeden<{
    id: string; branch_id: string; cas_spusteni: string; dny_v_tydnu: number[]
  }>(
    'automatizace',
    supabase.from('marketing_automatizace')
      .select('id, branch_id, cas_spusteni, dny_v_tydnu')
      .eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
  )

  if (!a) chybne(rozsah, 'Ta automatizace se nenašla.')

  /*
    PŘI ZAPNUTÍ SE ROVNOU SPOČÍTÁ, KDY POBĚŽÍ.

    Zadání chce u každé automatizace vidět příští spuštění. Kdyby se
    dopočítávalo až při běhu úlohy, stálo by tam do prvního běhu
    prázdno — a zapnutá automatizace bez termínu vypadá jako porucha.

    Dnešek i hodina se berou z pásma POBOČKY, ne ze serveru
    (pravidlo 11).
  */
  let pristi: string | null = null

  if (zapnout) {
    const ted = await jeden<{ den: string; cas: string }>(
      'čas v pásmu pobočky',
      supabase.rpc('marketing_ted_v_pasmu', { p_branch: a.branch_id }).maybeSingle(),
    ).catch(() => null)

    if (ted) {
      const den = pristiBeh({
        dnes: ted.den,
        ted: ted.cas,
        cas: a.cas_spusteni.slice(0, 5),
        dnyVTydnu: a.dny_v_tydnu ?? [],
      })

      if (den) {
        pristi = await pruzor<string>(
          'příští běh',
          supabase.rpc('marketing_okamzik', {
            p_branch: a.branch_id,
            p_kdy: `${den}T${a.cas_spusteni.slice(0, 5)}:00`,
          }),
        ).catch(() => null)
      }
    }
  }

  const { error } = await supabase.from('marketing_automatizace')
    .update({
      zapnuta: zapnout,
      pristi_beh_kdy: zapnout ? pristi : null,
      zmeneno_kdy: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) chybne(rozsah, error.message)

  revalidatePath(`/${rozsah}/marketing`, 'layout')
  zpetNa(rozsah, zapnout ? 'zapnuto=1' : 'vypnuto=1')
}
