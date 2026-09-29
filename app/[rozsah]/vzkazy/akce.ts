'use server'

import { randomUUID } from 'node:crypto'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

import { getUser } from '@/lib/authz'
import { KBELIK, MAX_DELKA_S, cestaVUlozisti, priponaZMime } from '@/lib/hlasove-zpravy'
import { naplanovatPushKeZprave } from '@/lib/komunikace/push-hned'
import { funkceNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import { zakladZRozsahu, type Zaklad } from './zaklad'

/**
 * Akce obrazovky Rozhovory.
 *
 * VŠECHNO JDE PŘES PRŮZORY, ne přes tabulky. Přímý zápis do
 * `konverzace`, `konverzace_ucastnici` a `konverzace_zpravy` je pro
 * `authenticated` odepřený (20260903100000) — a je to schválně:
 * kdyby se psalo přímo, dopsal by si kdokoli zprávu cizím jménem,
 * označil cizí konverzaci za přečtenou a hlavně obešel kontrolu práva
 * na naléhavost. `supabase.from('konverzace_zpravy').insert(...)` by
 * tady spadl na 42501, ne prošel.
 *
 * Firmu ani pobočku nebereme z formuláře. Rozsah se čte z adresy a
 * ověřuje proti členství (`bezpecnyRozsah`, pravidlo 4); kdyby si
 * úroveň volil prohlížeč, dal by se rozsah obejít přepsáním jednoho
 * čísla.
 */

/** Společný začátek každé akce. Vrací null, když cokoli nesedí. */
async function zaklad(formData: FormData): Promise<Zaklad | null> {
  return zakladZRozsahu(String(formData.get('rozsah') ?? ''))
}

/**
 * Otevřít kanál pobočky.
 *
 * Nezakládá ho tahle akce — jen si o něj řekne. Když ještě neexistuje,
 * vyrobí ho `public.kanal_pobocky`, a to jen tomu, kdo na pobočku
 * dosáhne. Účastníci se nikam nezapisují: členství v kanálu je průmět
 * přiřazení k pobočce, ne seznam.
 */
export async function otevritKanalPobocky(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z || !z.branchId) return

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('kanal_pobocky', {
    p_tenant: z.tenantId,
    p_branch: z.branchId,
  })

  // Hlášku psala databáze a je pro člověka — nepřepisuje se.
  if (error) {
    redirect(
      `/${z.rozsah}/vzkazy?chyba=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${z.rozsah}/vzkazy`)
  redirect(`/${z.rozsah}/vzkazy/${String(data)}`)
}

/**
 * Otevřít kanál úseku.
 *
 * Stejná úvaha jako u kanálu pobočky: tahle akce ho nezakládá, jen si
 * o něj řekne. `usek` v poli je NÁVRH z prohlížeče (pravidlo 4) —
 * obrazovka ho tam dá jen tomu, kdo v tom úseku sám je, ale skutečné
 * ověření dělá až `kanal_useku` v databázi proti `employees.usek_id`.
 */
export async function otevritKanalUseku(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return
  const usek = String(formData.get('usek') ?? '')
  if (!usek) return

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('kanal_useku', {
    p_tenant: z.tenantId,
    p_usek: usek,
  })

  if (error) {
    redirect(
      `/${z.rozsah}/vzkazy?chyba=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/${z.rozsah}/vzkazy`)
  redirect(`/${z.rozsah}/vzkazy/${String(data)}`)
}

const PRIORITY: readonly string[] = ['normal', 'important', 'urgent']

const CHYBA_POTVRZENI_NALEHAVE =
  'Naléhavou zprávu je třeba potvrdit — upozorní příjemce i mimo směnu.'

/** Nejdelší zpráva, kterou aplikace pošle. Databáze limit nemá; tohle je pojistka proti vložení celého dokumentu. */
const MAX_DELKA_ZPRAVY = 4000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VysledekOdeslani =
  | { ok: true; id: string }
  /** `trvale` = zopakovat nemá smysl (nemáte přístup, chybí potvrzení…); jinak se dá zkusit znovu. */
  | { ok: false; chyba: string; trvale: boolean }

/**
 * Odeslání zprávy z klientské komponenty — s klientským id.
 *
 * Aplikace si při psaní zprávy vygeneruje id. Když se spojení přeruší
 * a odeslání se zopakuje, databáze díky němu pozná, že je to tatáž zpráva,
 * a druhou nezaloží (`poslat_zpravu`, parametr `p_klient_id`).
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE. Dokud databáze sedmiparametrovou
 * podobu nemá, volání s `p_klient_id` skončí „funkce neexistuje“ — pak se
 * zpráva pošle po staru (bez ochrany proti zdvojení) místo aby zmizela.
 *
 * Nic nepřesměrovává: volající (klient) ukáže výsledek sám.
 */
export async function odeslatZpravuKlient(vstup: {
  rozsah: string
  konverzace: string
  text: string
  priorita: string
  klientId: string
  potvrzeno: boolean
}): Promise<VysledekOdeslani> {
  const z = await zakladZRozsahu(String(vstup.rozsah ?? ''))
  if (!z) return { ok: false, chyba: 'Nejste přihlášen(a) nebo nemáte přístup.', trvale: true }

  const konverzace = String(vstup.konverzace ?? '')
  const text = String(vstup.text ?? '').trim()
  const priorita = PRIORITY.includes(vstup.priorita) ? vstup.priorita : 'normal'

  if (!UUID.test(konverzace)) return { ok: false, chyba: 'Neplatný rozhovor.', trvale: true }
  if (text === '') return { ok: false, chyba: 'Zpráva je prázdná.', trvale: true }
  if (text.length > MAX_DELKA_ZPRAVY) {
    return { ok: false, chyba: `Zpráva je moc dlouhá (nejvíc ${MAX_DELKA_ZPRAVY} znaků).`, trvale: true }
  }
  if (priorita === 'urgent' && vstup.potvrzeno !== true) {
    return { ok: false, chyba: CHYBA_POTVRZENI_NALEHAVE, trvale: true }
  }

  const klientId = UUID.test(String(vstup.klientId ?? '')) ? vstup.klientId : null

  const supabase = await getServerSupabase()
  let { data, error } = await supabase.rpc('poslat_zpravu', {
    p_konverzace: konverzace,
    p_text: text,
    p_priorita: priorita,
    ...(klientId ? { p_klient_id: klientId } : {}),
  })

  if (error && klientId && funkceNeexistuje(error)) {
    ;({ data, error } = await supabase.rpc('poslat_zpravu', {
      p_konverzace: konverzace,
      p_text: text,
      p_priorita: priorita,
    }))
  }

  if (error) {
    // Chyby, které vrací sama funkce (přístup, uzavřený rozhovor, priorita),
    // mají SQLSTATE; výpadek spojení nebo pád služby ne — ten se opakuje.
    const trvale = /^(42501|23514|P0002|PT\d{3})$/.test(error.code ?? '')
    return { ok: false, chyba: error.message, trvale }
  }

  // Push příjemcům hned, ne až s plánovačem — po odpovědi, odesílatel nečeká.
  const zpravaId = String(data)
  naplanovatPushKeZprave(zpravaId, z.tenantId)

  // Kdo odpověděl, rozhovor četl. Počty jsou v rámu → celý layout.
  await zapsatPrecteni(supabase, z.tenantId, konverzace)
  revalidatePath(`/${z.rozsah}`, 'layout')
  return { ok: true, id: zpravaId }
}

/**
 * Odeslat zprávu do rozhovoru.
 *
 * `priorita` se posílá jako přání, ne jako fakt. Jestli databáze
 * `urgent` splní, rozhoduje právo `communication.urgent` — a když ho
 * člověk nemá, vrátí se chyba místo tichého odeslání obyčejné zprávy.
 * Tiché „skoro splněno“ by bylo horší: odesílatel by si myslel, že
 * zpráva dorazí hned, a ona by čekala na píchnutí. Cokoli mimo
 * `PRIORITY` je pokus o podvržení pole z prohlížeče — spadne na
 * stejnou skutečnou kontrolu v `poslat_zpravu`, tady se jen nemá
 * posílat dál nesmysl.
 */
export async function poslatZpravu(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const konverzace = String(formData.get('konverzace') ?? '')
  const text = String(formData.get('text') ?? '').trim()
  const prioritaVstup = String(formData.get('priorita') ?? '')
  const priorita = PRIORITY.includes(prioritaVstup) ? prioritaVstup : 'normal'
  if (konverzace === '' || text === '') return

  const zpet = `/${z.rozsah}/vzkazy/${konverzace}`

  // Naléhavá zpráva upozorní i mimo směnu, proto se odesílá jen s výslovným
  // potvrzením — a hlídá se TADY, ne jen v prohlížeči, ať ho nejde obejít
  // upraveným formulářem.
  if (priorita === 'urgent' && formData.get('potvrzeno') !== 'on') {
    redirect(`${zpet}?chyba=${encodeURIComponent(CHYBA_POTVRZENI_NALEHAVE)}`)
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('poslat_zpravu', {
    p_konverzace: konverzace,
    p_text: text,
    p_priorita: priorita,
  })

  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  const zpravaId = String(data)
  naplanovatPushKeZprave(zpravaId, z.tenantId)

  await zapsatPrecteni(supabase, z.tenantId, konverzace)
  revalidatePath(`/${z.rozsah}`, 'layout')
  redirect(zpet)
}

/**
 * Odeslat hlasovku do rozhovoru.
 *
 * ŽÁDNÝ AI PŘEPIS (rozhodnutí Šéfíka 17.9.2026 v noci — viz hlavička
 * 20260917060000_hlasove_zpravy.sql). Zvuk se jen nahraje a pošle.
 *
 * NAHRÁVÁ SE POD PŘIHLÁŠENÝM ČLOVĚKEM, NE SERVISNÍM KLÍČEM —
 * `getServerSupabase` jede na veřejný klíč a sezení uživatele, takže
 * na úložiště dosáhnou politiky z 20260917060000_hlasove_zpravy.sql.
 * Stejná úvaha jako u nahrátFotku v marketingu.
 */
export async function odeslatHlasovku(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const konverzace = String(formData.get('konverzace') ?? '')
  const zvuk = formData.get('zvuk')
  const delkaVstup = Number(formData.get('delka_s') ?? 0)
  if (konverzace === '') return

  const zpet = `/${z.rozsah}/vzkazy/${konverzace}`

  if (!(zvuk instanceof File) || zvuk.size === 0) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Nahrávka se nepovedla, zkuste to znovu.')}`)
  }

  // Délka je jen pro zobrazení (mm:ss) — nesmyslnou hodnotu z prohlížeče
  // radši zahodit, než ji tahat dál do databáze.
  const delkaS =
    Number.isFinite(delkaVstup) && delkaVstup > 0 && delkaVstup <= MAX_DELKA_S
      ? Math.round(delkaVstup)
      : null

  const supabase = await getServerSupabase()
  const kam = cestaVUlozisti(z.tenantId, konverzace, randomUUID(), priponaZMime(zvuk.type))

  /*
    Storage porovnává Content-Type s allowed_mime_types DOSLOVA — typ
    z MediaRecorder ale v Chrome/Firefoxu nese i kodek
    ("audio/webm;codecs=opus"), zatímco kbelík zná jen holé typy.
    Bez odseknutí ";codecs=..." by se nahrání odmítlo v přesně tom
    prohlížeči, který je výchozí. Kbelík dál kontroluje kontejner
    (webm/ogg/mp4/mpeg) — na kodeku uvnitř mu nezáleží.

    `zvuk` je File (Blob) a storage-js ho umí nahrát přímo — ruční
    arrayBuffer()/Uint8Array by celou nahrávku zbytečně natáhl celou
    do paměti Node procesu, než by se poslala dál.
  */
  const nahrano = await supabase.storage.from(KBELIK).upload(kam, zvuk, {
    contentType: (zvuk.type || 'audio/webm').split(';')[0].trim(),
    upsert: false,
  })

  if (nahrano.error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(`Hlasovku se nepodařilo uložit: ${nahrano.error.message}`)}`)
  }

  const { data, error } = await supabase.rpc('poslat_zpravu', {
    p_konverzace: konverzace,
    p_text: '',
    p_priorita: 'normal',
    p_zvuk_cesta: kam,
    p_zvuk_delka_s: delkaS,
  })

  if (error) {
    // Úklid po sobě — stejná úvaha jako u nahrátFotku v marketingu:
    // soubor je nahraný, zpráva nevznikla, a bez úklidu by v kbelíku
    // zůstal soubor, na který se z appky nedá dostat.
    await supabase.storage.from(KBELIK).remove([kam])
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  const zpravaId = String(data)
  naplanovatPushKeZprave(zpravaId, z.tenantId)

  await zapsatPrecteni(supabase, z.tenantId, konverzace)
  revalidatePath(`/${z.rozsah}`, 'layout')
  redirect(zpet)
}

/**
 * Zapsat, že mám rozhovor přečtený — a když už nemám nepřečtený žádný,
 * označit za přečtená i svoje upozornění „nový vzkaz“ ve zvonečku.
 *
 * Jedna zpráva měla dřív dvě nezávislá „nepřečteno“: rozhovor a řádek
 * ve zvonečku. Kdo si všechno přečetl v rozhovorech, měl ve zvonečku
 * dál „nový vzkaz“ (plán 27. 9., oddíl 4, bod 2). Upozornění „nový
 * vzkaz“ je slučované za den a nenese rozhovor, takže se nedá říct,
 * ke kterému rozhovoru patří — proto se označí, až když nepřečtené
 * nezbude žádné, ne po každém rozhovoru.
 *
 * Záložka je v databázi jen „kam jsem dočetl“. U kanálu pobočky
 * a úseku přístup nedává (migrace 20260927100000, pojistka), takže
 * přečtením kanálu se do něj nikdo nezapíše natrvalo.
 *
 * Chyby se nevyhazují: přečtení je pomocný zápis a kvůli němu nemá
 * spadnout odeslání zprávy ani otevření rozhovoru.
 */
async function zapsatPrecteni(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
  konverzace: string,
): Promise<boolean> {
  /*
    `precist_rozhovor`, ne `oznacit_precteno`: nová funkce vzniká TOUŽ
    migrací jako pojistka kanálů (20260927100000). Kód se nasazuje
    sloučením PR, migrace až ručně — kdyby aplikace zapisovala čtení
    dřív, než je v databázi pojistka, zapsala by čtenáře kanálu natrvalo.
    Dokud funkce není, čtení se nezapisuje vůbec (jako do 27. 9.).
  */
  const { error } = await supabase.rpc('precist_rozhovor', { p_konverzace: konverzace })
  if (error) return false

  const user = await getUser()
  if (!user) return true

  const { data: rozhovory, error: chybaSeznam } = await supabase.rpc('moje_rozhovory', { p_tenant: tenantId })
  if (chybaSeznam) return true
  const zbyva = ((rozhovory ?? []) as { neprectenych: number }[]).reduce((s, r) => s + (r.neprectenych ?? 0), 0)
  if (zbyva === 0) {
    // Politika na `notifications` pustí úpravu jen u vlastních řádků;
    // `user_id` je tu navíc, ať je z dotazu vidět, čí řádky to jsou.
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('druh', 'vzkaz.novy')
      .is('read_at', null)
  }
  return true
}

/**
 * Označit rozhovor za přečtený — po ZOBRAZENÍ, ne při vykreslení.
 *
 * Volá ji klientská součástka `oznacit-po-zobrazeni.tsx`, až je vlákno
 * opravdu na obrazovce. Na serveru při vykreslení se to dělat nesmí:
 * odkaz v seznamu rozhovorů si stránku umí načíst dopředu (prefetch)
 * a rozhovor by se označil jako přečtený, aniž by ho kdo otevřel.
 *
 * Nic nepřesměrovává — volá se z efektu, ne z formuláře. Počty ve
 * zvonečku, na liště a u záložek jsou v rámu, proto se překresluje
 * celý layout.
 */
export async function oznacitPrectenoPoZobrazeni(vstup: {
  rozsah: string
  konverzace: string
}): Promise<{ ok: boolean }> {
  const z = await zakladZRozsahu(String(vstup.rozsah ?? ''))
  if (!z) return { ok: false }
  const konverzace = String(vstup.konverzace ?? '')
  if (!UUID.test(konverzace)) return { ok: false }

  const supabase = await getServerSupabase()
  const ok = await zapsatPrecteni(supabase, z.tenantId, konverzace)
  if (ok) revalidatePath(`/${z.rozsah}`, 'layout')
  return { ok }
}

/**
 * Zrušit vlastní zprávu (v rozhraní „Zrušit zprávu“; do 27. 9. se
 * tlačítko jmenovalo „Stáhnout“ a četlo se jako stažení souboru).
 *
 * Mazání je STORNO, ne výmaz (pravidlo 9). Řádek zůstane a je vidět,
 * že ho někdo zrušil — zpráva, která zmizí beze stopy, je v pracovním
 * nástroji horší než zpráva se škrtnutím. Potvrzení se ptá prohlížeč
 * (`vlakno-zprav.tsx`).
 */
export async function stornovatZpravu(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const zprava = String(formData.get('zprava') ?? '')
  const konverzace = String(formData.get('konverzace') ?? '')
  if (zprava === '' || konverzace === '') return

  const supabase = await getServerSupabase()
  const { error } = await supabase.rpc('stornovat_zpravu', { p_zprava: zprava })

  const zpet = `/${z.rozsah}/vzkazy/${konverzace}`
  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(zpet)
  redirect(zpet)
}

/**
 * Založit osobní rozhovor s vybranými lidmi (výběr příjemců).
 *
 * Účastníky posílá formulář jako opakované pole `ucastnik`; jsou to NÁVRH z
 * prohlížeče (pravidlo 4). Že patří do firmy, ověřuje `zalozit_rozhovor`.
 */
export async function zalozitOsobniRozhovor(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const zpet = `/${z.rozsah}/vzkazy/nova`
  const ucastnici = [
    ...new Set(formData.getAll('ucastnik').map((v) => String(v)).filter((v) => UUID.test(v))),
  ].slice(0, 50)

  if (ucastnici.length === 0) {
    redirect(`${zpet}?chyba=${encodeURIComponent('Vyberte aspoň jednoho člověka.')}`)
  }

  // Délka první zprávy se ověří DŘÍV, než rozhovor vznikne (28. 9.).
  // Do té doby šel dlouhý text (formulář odeslaný mimo prohlížeč, pole
  // má maxLength) až po založení — rozhovor zůstal bez zprávy.
  const prvni = String(formData.get('zprava') ?? '').trim()
  if (prvni.length > MAX_DELKA_ZPRAVY) {
    redirect(`${zpet}?chyba=${encodeURIComponent(`Zpráva je moc dlouhá (nejvíc ${MAX_DELKA_ZPRAVY} znaků).`)}`)
  }

  const supabase = await getServerSupabase()

  // Bez názvu se NEukládají jména příjemců: název je jeden pro všechny
  // účastníky a každý má vidět toho druhého, ne sám sebe. Skládá se při
  // zobrazení (`jmena_osobnich_rozhovoru`).
  const nazev = String(formData.get('nazev') ?? '').trim().slice(0, 120)

  const { data, error } = await supabase.rpc('zalozit_rozhovor', {
    p_tenant: z.tenantId,
    p_druh: 'osobni',
    p_branch: null,
    p_nazev: nazev === '' ? null : nazev,
    p_adresat: null,
    p_ucastnici: ucastnici,
  })

  // Hlášku psala databáze a je pro člověka — nepřepisuje se.
  if (error) {
    redirect(`${zpet}?chyba=${encodeURIComponent(error.message)}`)
  }

  const konverzace = String(data)

  // První zpráva je NEPOVINNÁ (T3, 27. 9.): osobní rozhovor bez textu
  // dává smysl — člověk ho založí a napíše hned v rozhovoru. S textem
  // ale odejde rovnou a příjemce dostane upozornění hned.
  if (prvni !== '') {
    const chybaZpravy = await poslatPrvniZpravu(supabase, z.tenantId, konverzace, prvni, formData)
    revalidatePath(`/${z.rozsah}`, 'layout')
    if (chybaZpravy) {
      redirect(`/${z.rozsah}/vzkazy/${konverzace}?chyba=${encodeURIComponent(chybaZpravy)}`)
    }
  } else {
    revalidatePath(`/${z.rozsah}/vzkazy`)
  }
  redirect(`/${z.rozsah}/vzkazy/${konverzace}`)
}

/**
 * První zpráva nového rozhovoru — hned po založení, s klientským id.
 *
 * Proč hned: do 27. 9. vznikal vzkaz vedení jen s názvem a text se psal
 * až v rozhovoru. Upozornění vedení ale vzniká až první ZPRÁVOU —
 * a kdo po založení odešel, vedení nic nedoručil. V ostré databázi
 * takhle zůstalo 11 ze 14 vzkazů vedení bez jediné zprávy.
 *
 * Klientské id přišlo s formulářem (vyrobené při vykreslení).
 * `poslat_zpravu` podle něj pozná tutéž zprávu JEN UVNITŘ JEDNOHO
 * rozhovoru (unikátní index na konverzaci + klientské id). Dvojí
 * odeslání celého formuláře ale napřed založí DRUHÝ rozhovor, a v něm
 * je zpráva nová — proti tomu chrání jen `TlacitkoOdeslat` v prohlížeči
 * (po načtení JavaScriptu). Založení podle klientského id by chtělo
 * změnu `zalozit_rozhovor` v databázi (plán, oddíl 7, P23).
 *
 * Délku textu hlídají akce DŘÍV, než rozhovor založí; tady je to jen
 * pojistka pro volání odjinud.
 *
 * Vrací hlášku pro člověka, nebo null. TEXT SE DO ADRESY NEDÁVÁ —
 * zpráva může být stížnost na vedoucího a adresa zůstává v historii
 * prohlížeče i v logu serveru.
 */
async function poslatPrvniZpravu(
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  tenantId: string,
  konverzace: string,
  text: string,
  formData: FormData,
): Promise<string | null> {
  if (text.length > MAX_DELKA_ZPRAVY) {
    return `Rozhovor je založený, ale zpráva byla moc dlouhá (nejvíc ${MAX_DELKA_ZPRAVY} znaků). Napište ji prosím znovu, kratší.`
  }
  const klientVstup = String(formData.get('klient_id') ?? '')
  const klientId = UUID.test(klientVstup) ? klientVstup : randomUUID()

  const { data, error } = await supabase.rpc('poslat_zpravu', {
    p_konverzace: konverzace,
    p_text: text,
    p_priorita: 'normal',
    p_klient_id: klientId,
  })
  if (error) {
    return `Rozhovor je založený, ale zprávu se nepodařilo odeslat (${error.message}). Napište ji prosím znovu.`
  }

  naplanovatPushKeZprave(String(data), tenantId)
  return null
}

/**
 * Založit vzkaz vedení.
 *
 * POBOČKU VYBÍRÁ ODESÍLATEL, ne jeho domovský záznam. Člověk, který
 * dělá na dvou provozovnách, si stěžuje na to, co zažil TAM, KDE
 * ZROVNA BYL — a odvozená domovská pobočka by vzkaz poslala vedoucímu
 * té druhé. Rozhodnutí Šéfíka 6. 9. 2026.
 *
 * Adresáty formulář NEPOSÍLÁ. Odvodí si je databáze z volby
 * `adresat` a z pobočky — jinak by šlo odesláním upraveného formuláře
 * adresovat stížnost na vedoucího právě tomu vedoucímu, a to je horší
 * než žádná cesta: člověk si myslí, že si postěžoval, a jediné, čeho
 * dosáhl, je že si na sebe řekl.
 */
export async function zalozitVzkazVedeni(formData: FormData): Promise<void> {
  const z = await zaklad(formData)
  if (!z) return

  const nazev = String(formData.get('nazev') ?? '').trim()
  const zprava = String(formData.get('zprava') ?? '').trim()
  const zpetFormular = `/${z.rozsah}/vzkazy?vedeni=1`

  // Bez textu se vzkaz NEZAKLÁDÁ (27. 9.). Prázdný vzkaz vedení nic
  // nedoručí — upozornění vzniká až zprávou — a přesně takhle jich
  // v ostré databázi zůstalo 11 ze 14. Pole je v prohlížeči povinné;
  // tady je to pojistka proti formuláři odeslanému jinak.
  if (nazev === '') {
    redirect(`${zpetFormular}&chyba=${encodeURIComponent('Napište krátce, čeho se vzkaz týká.')}`)
  }
  if (zprava === '') {
    redirect(`${zpetFormular}&chyba=${encodeURIComponent('Napište zprávu, kterou má vedení dostat.')}`)
  }
  // Délka se ověří DŘÍV, než vzkaz vznikne (28. 9.): jinak by dlouhý
  // text (formulář odeslaný mimo prohlížeč) založil vzkaz vedení bez
  // zprávy — přesně to, co T3 odstraňuje.
  if (zprava.length > MAX_DELKA_ZPRAVY) {
    redirect(`${zpetFormular}&chyba=${encodeURIComponent(`Zpráva je moc dlouhá (nejvíc ${MAX_DELKA_ZPRAVY} znaků). Zkraťte ji prosím.`)}`)
  }

  // Cokoli jiného než tyhle dvě volby je pokus o podvržení. Databáze
  // by to odmítla taky (omezení na sloupci), ale posílat nesmysl dál
  // nemá důvod.
  const adresatVstup = String(formData.get('adresat') ?? '')
  if (adresatVstup !== 'vedouci' && adresatVstup !== 'majitel') return

  /*
    U majitele na pobočce nezáleží a posílá se NULL. Kdyby se posílala,
    vypadalo by z dat, že vzkaz patří pobočce — a on patří firmě.
  */
  const pobocka =
    adresatVstup === 'vedouci'
      ? (String(formData.get('pobocka') ?? '').trim() || z.branchId)
      : null

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.rpc('zalozit_rozhovor', {
    p_tenant: z.tenantId,
    p_druh: 'vedeni',
    p_branch: pobocka,
    p_nazev: nazev,
    p_adresat: adresatVstup,
    p_ucastnici: [],
  })

  // Hlášku psala databáze a je pro člověka — nepřepisuje se. Patří sem
  // i „Vyberte pobočku, ke které vzkaz patří.“
  if (error) {
    redirect(`${zpetFormular}&chyba=${encodeURIComponent(error.message)}`)
  }

  // Zpráva jde HNED, ať vedení dostane upozornění. Když neodejde,
  // rozhovor už existuje — přesměruje se do něj s hláškou a zprávu jde
  // napsat znovu tam (text se do adresy nedává).
  const konverzace = String(data)
  const chybaZpravy = await poslatPrvniZpravu(supabase, z.tenantId, konverzace, zprava, formData)
  revalidatePath(`/${z.rozsah}`, 'layout')
  if (chybaZpravy) {
    redirect(`/${z.rozsah}/vzkazy/${konverzace}?chyba=${encodeURIComponent(chybaZpravy)}`)
  }
  redirect(`/${z.rozsah}/vzkazy/${konverzace}`)
}
