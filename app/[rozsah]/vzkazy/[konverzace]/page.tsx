import { redirect } from 'next/navigation'
import Link from 'next/link'

import { ZONA_VYCHOZI, denVPasmu } from '@/lib/cas'
import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { KBELIK, PLATNOST_ODKAZU_S } from '@/lib/hlasove-zpravy'
import { KBELIK_PRILOH, PLATNOST_ODKAZU_PRILOH_S } from '@/lib/komunikace/prilohy'
import { vetaODoruceni } from '@/lib/komunikace/veta-o-pushi'
import { nactiKliceVapid } from '@/lib/komunikace/web-push'
import { OCI_VZKAZU } from '@/lib/komunikace/zalozky'
import { DotazSelhal, sloupecNeexistuje, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Ikona from '../../ikona'
import Nadpis from '../../nadpis'
import { nactiZalozky } from '../../provozni-centrum/pocty'
import PcZalozky from '../../provozni-centrum/zalozky'
import VetaOPushi from '../../provozni-centrum/veta-o-pushi'
import SeznamRozhovoru, { NAZVY_DRUHU, type Rozhovor } from '../seznam-rozhovoru'
import { nactiJmenaVRozhovoru, nactiNazvyOsobnich, nactiPosledniTexty } from '../nazvy'
import HlasovkaNahravac from './hlasovka-nahravac'
import OznacitPoZobrazeni from './oznacit-po-zobrazeni'
import PanelKonverzace, { type UcastnikUI, type UkolUI } from './panel-konverzace'
import PanelUkolyUdalosti from './panel-ukoly-udalosti'
import PosunNaKonec from './posun-na-konec'
import PridatPrilohu from './priloha-pridat'
import Psani from './psani'
import VlaknoZprav, { type ZpravaUI } from './vlakno-zprav'

export const dynamic = 'force-dynamic'

/**
 * Jeden rozhovor — čtyři sloupce: seznam | vlákno | O rozhovoru | Úkoly a události.
 * Poslední dva jsou od 22. 9. oddělené (vzhled podle Šéfíkova obrázku) —
 * dřív byly jeden dlouhý panel, dnes dvě karty vedle sebe.
 *
 * PŘEČTENÍ (27. 9.). Rozhovor se označí za přečtený, až je vlákno na
 * obrazovce (`oznacit-po-zobrazeni.tsx`), a když do něj člověk odpoví.
 * Ne při vykreslení tady na serveru: odkaz v seznamu si stránku umí
 * načíst dopředu a označil by nepřečtené, aniž by je kdo viděl.
 * Dělítko „Nové zprávy“ drží vlákno z prvního vykreslení.
 *
 * NA TELEFONU (T7, 27. 9.) nad vláknem zmizí velký nadpis a záložky
 * (`.pc-rozhovor-stranka`, stejně jako Checklisty) — nahoře zůstane
 * „← Komunikace“ a název rozhovoru. Panely „O rozhovoru“ a „Úkoly
 * a události“ jsou sbalené pod „Podrobnosti“.
 *
 * OBSAH SE TU NESCHOVÁVÁ, ANI MIMO SMĚNU. Pravidlo o doručení chrání
 * před vyrušením, ne před informací — kdo si sám otevře aplikaci, čte.
 * Co se mění, je jen to, jestli se o zprávě smělo dát vědět; proto je
 * u zadržených zpráv štítek, ne zámek.
 *
 * Že sem člověk vůbec smí, nerozhoduje tahle stránka. Rozhoduje RLS na
 * `konverzace_zpravy`: kdo není účastník, dostane prázdno — a dostal by
 * ho i při přímém volání rozhraní, ne jen tady. Prázdný seznam proto
 * NEZNAMENÁ „rozhovor je prázdný“, ale „není váš“, a tak se to i píše.
 *
 * KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE. Sloupce z pozdějších migrací (typ
 * zprávy, vazba úkolu na rozhovor) se čtou tolerantně: dokud v databázi
 * nejsou, stránka funguje jako dřív a panel to řekne, ne spadne.
 */

const ZONA = ZONA_VYCHOZI
const POCET = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Priorita = 'normal' | 'important' | 'urgent'

type PrilohaUI = ZpravaUI['prilohy'][number]

type Zprava = {
  id: string
  autor: string | null
  text: string
  priorita: Priorita
  vytvoreno_kdy: string
  stornovano_kdy: string | null
  zvuk_cesta: string | null
  zvuk_delka_s: number | null
  typ: 'zprava' | 'system'
  objekt_typ: string | null
  objekt_id: string | null
}

/**
 * Varianty dotazu na zprávy od nejnovější po nejstarší schéma. Bere se
 * první, kterou databáze zná — viz „KÓD SE NASAZUJE DŘÍV NEŽ MIGRACE“.
 */
const VARIANTY_ZPRAV = [
  { sloupce: 'id, autor, text, priorita, vytvoreno_kdy, stornovano_kdy, zvuk_cesta, zvuk_delka_s, typ, objekt_typ, objekt_id', priorita: true, zvuk: true, typ: true },
  { sloupce: 'id, autor, text, priorita, vytvoreno_kdy, stornovano_kdy, zvuk_cesta, zvuk_delka_s', priorita: true, zvuk: true, typ: false },
  { sloupce: 'id, autor, text, priorita, vytvoreno_kdy, stornovano_kdy', priorita: true, zvuk: false, typ: false },
  { sloupce: 'id, autor, text, nalehava, vytvoreno_kdy, stornovano_kdy', priorita: false, zvuk: false, typ: false },
] as const

export default async function Rozhovor({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; konverzace: string }>
  searchParams: Promise<{ chyba?: string; ukol?: string }>
}) {
  const { rozsah, konverzace } = await params
  const { chyba, ukol: novyUkol } = await searchParams

  /* --- 1. KONTROLA PŘÍSTUPU ------------------------------------- */

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  // Neplatné id v adrese (`/vzkazy/abc`) je hláška, ne pád stránky na chybě databáze.
  if (!UUID.test(konverzace)) {
    return (
      <Sdeleni nadpis="Tenhle rozhovor neexistuje">
        Odkaz není platný. <Link href={`/${rozsah}/vzkazy`}>Zpět na rozhovory</Link>.
      </Sdeleni>
    )
  }

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (!ctx) {
    return (
      <Sdeleni nadpis="Firmu se nepodařilo načíst">
        Zkuste to prosím za chvíli znovu.
      </Sdeleni>
    )
  }

  const scope = bezpecnyRozsah(ctx, rozsah)
  if (!scope) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Tahle část Foodtabu vám není otevřená.
      </Sdeleni>
    )
  }

  /* --- 2. NAČTENÍ DAT ------------------------------------------- */

  const supabase = await getServerSupabase()

  /*
    Seznam pro levý sloupec — TÁŽ RPC a TÝŽ typ jako na /vzkazy
    (`SeznamRozhovoru`), jen se tu navíc zvýrazní `konverzace` jako
    aktivní. Chyba se nevyhazuje: bez seznamu se ukáže aspoň vlákno.
  */
  const { data: seznamData } = await supabase.rpc('moje_rozhovory', { p_tenant: tenantId })
  const rozhovory = (seznamData ?? []) as Rozhovor[]
  const nazvyPobocek = new Map(ctx.branches.map((b) => [b.id, b.name]))

  // Náhled poslední zprávy do seznamu vlevo — stejný postup jako na /vzkazy.
  const posledniText = await nactiPosledniTexty(supabase, rozhovory.map((r) => r.konverzace_id))
  // Osobní rozhovor bez názvu = jména ostatních účastníků (každý vidí toho druhého).
  const nazvyOsobnich = await nactiNazvyOsobnich(supabase, tenantId)

  const { data: hlavicka, error: chybaHlavicka } = await supabase
    .from('konverzace')
    .select('id, druh, branch_id, usek_id, nazev, adresat, uzavreno_kdy, zalozeno_kdy')
    .eq('id', konverzace)
    .maybeSingle()

  // Rámeček „čeká na nasazení databáze“ tu byl do 27. 9.; tabulky jsou
  // nasazené od 3. 9. a mrtvý rámeček jen mátl. Chyba je chyba.
  if (chybaHlavicka) throw new DotazSelhal('hlavička rozhovoru', chybaHlavicka)

  /*
    Prázdno tady znamená „nejste účastník“, ne „neexistuje“.

    Rozlišovat ty dva stavy by byl únik sám o sobě: kdo zkouší cizí id,
    by se z různých hlášek dozvěděl, které konverzace ve firmě existují.
    Proto je odpověď stejná pro obojí.
  */
  if (!hlavicka) {
    return (
      <Sdeleni nadpis="Tenhle rozhovor vám nepatří">
        Otevřít jde jen rozhovor, kterého jste účastníkem. Ani vedení
        nečte cizí vlákna — je to tak schválně.
      </Sdeleni>
    )
  }

  let varianta = 0
  let zpravyData: unknown[] | null = null
  let chybaZpravy: Parameters<typeof sloupecNeexistuje>[0] = null
  for (; varianta < VARIANTY_ZPRAV.length; varianta++) {
    const r = await supabase
      .from('konverzace_zpravy')
      .select(VARIANTY_ZPRAV[varianta].sloupce)
      .eq('konverzace_id', konverzace)
      // NEJNOVĚJŠÍCH POCET zpráv: seřazené od nejnovější a níž se obrátí. Vzestupné
      // řazení s limitem by od 201. zprávy nové vůbec neukázalo.
      .order('vytvoreno_kdy', { ascending: false })
      .limit(POCET)
    zpravyData = r.data ? [...(r.data as unknown[])].reverse() : null
    chybaZpravy = r.error
    if (!r.error || !sloupecNeexistuje(r.error)) break
  }
  if (chybaZpravy) throw new DotazSelhal('zprávy rozhovoru', chybaZpravy)
  const v = VARIANTY_ZPRAV[Math.min(varianta, VARIANTY_ZPRAV.length - 1)]

  const zpravy: Zprava[] = ((zpravyData ?? []) as Record<string, unknown>[]).map((z) => ({
    id: z.id as string,
    autor: z.autor as string | null,
    text: String(z.text ?? ''),
    priorita: v.priorita
      ? (z.priorita as Priorita)
      : ((z.nalehava as boolean) ? 'urgent' : 'normal'),
    vytvoreno_kdy: z.vytvoreno_kdy as string,
    stornovano_kdy: z.stornovano_kdy as string | null,
    zvuk_cesta: v.zvuk ? (z.zvuk_cesta as string | null) : null,
    zvuk_delka_s: v.zvuk ? (z.zvuk_delka_s as number | null) : null,
    typ: v.typ && z.typ === 'system' ? 'system' : 'zprava',
    objekt_typ: v.typ ? ((z.objekt_typ as string | null) ?? null) : null,
    objekt_id: v.typ ? ((z.objekt_id as string | null) ?? null) : null,
  }))

  // Podepsané odkazy na hlasovky — kbelík je soukromý, přehrává se jen
  // přes krátkodobý odkaz vydaný až po kontrole app.je_ucastnik
  // (politika úložiště). Jeden dávkový dotaz pro celé vlákno.
  const cestyHlasovek = zpravy
    .map((z) => z.zvuk_cesta)
    .filter((c): c is string => c !== null)
  const odkazyHlasovek = new Map<string, string>()
  if (cestyHlasovek.length > 0) {
    const { data: podepsane } = await supabase.storage
      .from(KBELIK)
      .createSignedUrls(cestyHlasovek, PLATNOST_ODKAZU_S)
    for (const p of podepsane ?? []) {
      if (p.signedUrl && p.path) odkazyHlasovek.set(p.path, p.signedUrl)
    }
  }

  // Přílohy zpráv (fotky, PDF). Tabulka přibývá migrací 20260921130000; bez ní
  // se přílohy nenačtou, tlačítko „Přidat přílohu“ se neukáže a rozhovor jede
  // jako dřív. Kbelík je soukromý, otevírá se jen přes krátkodobý odkaz vydaný
  // až po kontrole účastnictví (politika úložiště).
  let prilohyDostupne = false
  const prilohyZpravy = new Map<string, PrilohaUI[]>()
  {
    const { data: prilohyData, error: chybaPrilohy } = await supabase
      .from('konverzace_prilohy')
      .select('id, zprava_id, cesta, nazev, mime, velikost')
      .eq('konverzace_id', konverzace)
      .order('vytvoreno_kdy', { ascending: true })
      .limit(500)

    if (!chybaPrilohy) {
      prilohyDostupne = true
      const radky = (prilohyData ?? []) as Record<string, unknown>[]
      const odkazyPriloh = new Map<string, string>()
      if (radky.length > 0) {
        const { data: podepsane } = await supabase.storage
          .from(KBELIK_PRILOH)
          .createSignedUrls(radky.map((r) => String(r.cesta)), PLATNOST_ODKAZU_PRILOH_S)
        for (const p of podepsane ?? []) {
          if (p.signedUrl && p.path) odkazyPriloh.set(p.path, p.signedUrl)
        }
      }
      for (const r of radky) {
        const zid = String(r.zprava_id)
        const seznam = prilohyZpravy.get(zid) ?? []
        seznam.push({
          id: String(r.id),
          nazev: String(r.nazev ?? ''),
          mime: String(r.mime ?? ''),
          velikost: Number(r.velikost) || 0,
          odkaz: odkazyPriloh.get(String(r.cesta)) ?? null,
        })
        prilohyZpravy.set(zid, seznam)
      }
    } else if (!tabulkaNeexistuje(chybaPrilohy)) {
      throw new DotazSelhal('přílohy zpráv', chybaPrilohy)
    }
  }

  // Kdo je tady „já“ — kvůli zarovnání, dělítku „Nové“ a tomu, co jde stornovat.
  const { data: ja, error: chybaJa } = await supabase
    .from('employees')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (chybaJa) throw new DotazSelhal('můj zaměstnanecký záznam', chybaJa)
  const mojeId = (ja?.id as string | undefined) ?? null

  /*
    Účastníci s výslovným záznamem — JEN u druhů, kde řádek znamená
    účastníka (osobní, mezi pobočkami, vzkaz vedení; v databázi
    `app.ucastnici_vypsani`). Kanál pobočky a úseku je odvozený: od
    27. 9. v něm řádek vzniká prvním čtením a je to jen záložka „kam
    jsem dočetl“. Kdyby se četl i tady, šla by jména lidí, kteří si kanál
    jen otevřeli (a třeba z úseku mezitím odešli), do klientského vlákna
    (`jmena`). U kanálu se místo seznamu píše věta a jména autorů dodá
    `lide_v_rozhovoru`.
  */
  const DRUHY_S_UCASTNIKY = ['osobni', 'mezi_pobockami', 'vedeni']
  let idUcastniku: string[] = []
  if (DRUHY_S_UCASTNIKY.includes(String(hlavicka.druh))) {
    const { data: ucastniciData } = await supabase
      .from('konverzace_ucastnici')
      .select('employee_id')
      .eq('konverzace_id', konverzace)
      .is('odesel_kdy', null)
    idUcastniku = ((ucastniciData ?? []) as { employee_id: string }[]).map((u) => u.employee_id)
  }

  // Jména autorů a účastníků. `full_name` je ve sloupcovém grantu, telefon
  // a e-mail schválně ne — ty se čtou jen průzorem v Lidech.
  const jmena = new Map<string, string>()
  const idLidi = [
    ...new Set([
      ...zpravy.map((z) => z.autor).filter((i): i is string => Boolean(i)),
      ...idUcastniku,
    ]),
  ]
  if (idLidi.length > 0) {
    const { data: lide, error: chybaLide } = await supabase
      .from('employees')
      .select('id, full_name')
      .in('id', idLidi)
    if (chybaLide) throw new DotazSelhal('jména autorů', chybaLide)
    for (const l of lide ?? []) {
      jmena.set(l.id as string, String(l.full_name ?? '').trim())
    }
  }

  // Běžný zaměstnanec z `employees` nepřečte jména kolegů (RLS), takže by
  // v rozhovoru viděl samé „kdosi“. Jména lidí TÉHLE konverzace dává
  // `lide_v_rozhovoru` (jen účastníkovi). Bez funkce (migrace ještě není)
  // zůstává staré čtení výš.
  const jmenaZRozhovoru = await nactiJmenaVRozhovoru(supabase, konverzace)
  if (jmenaZRozhovoru) {
    for (const [id, jmeno] of jmenaZRozhovoru) {
      if (jmeno !== '') jmena.set(id, jmeno)
    }
  }

  const smiNalehavou = await hasAccess(tenantId, 'communication.urgent', null)
  const smiUkoly = await hasAccess(tenantId, 'tasks.manage', scope.branchId)
  // Čísla a skryté záložky — jedna funkce pro všechny stránky „Vzkazy a úkoly“
  // (Úkoly a Checklisty se skrývají podle ČTENÍ, ne podle zadávání).
  const zalozky = await nactiZalozky(supabase, {
    tenantId,
    userId: user.id,
    branchId: scope.branchId,
    rozhovory: seznamData ? rozhovory : null,
  })

  // Do kdy mám přečteno — pro dělítko „Nové zprávy“. Čas přečtení vidí jen
  // vlastník (moje_precteno_do), ne ostatní účastníci. Chyba = žádné dělítko.
  // Čte se PŘED označením za přečtené (to udělá až prohlížeč po zobrazení),
  // a vlákno si z prvního vykreslení hodnotu podrží.
  const { data: precetoDoData } = await supabase.rpc('moje_precteno_do', { p_konverzace: konverzace })
  const precetoDo = typeof precetoDoData === 'string' ? precetoDoData : null

  // Úkoly založené z téhle konverzace. Sloupec přibývá migrací; bez ní panel
  // řekne, že čeká, a nespadne.
  let ukolyPanel: UkolUI[] | null = null
  {
    const { data: ukolyData, error: chybaUkoly } = await supabase
      .from('tasks')
      .select('id, title, due_at, status, priority')
      .eq('konverzace_id', konverzace)
      .order('created_at', { ascending: false })
      .limit(20)
    if (!chybaUkoly) {
      const ted = Date.now()
      ukolyPanel = ((ukolyData ?? []) as Record<string, unknown>[]).map((u) => ({
        id: u.id as string,
        nazev: String(u.title ?? ''),
        termin: (u.due_at as string | null) ?? null,
        stav: u.status as UkolUI['stav'],
        priorita: u.priority === 'high' ? 'high' : 'normal',
        poTerminu: u.due_at ? new Date(u.due_at as string).getTime() < ted : false,
      }))
    } else if (!sloupecNeexistuje(chybaUkoly)) {
      throw new DotazSelhal('úkoly rozhovoru', chybaUkoly)
    }
  }
  // Stejná data jako výš, jen podle id — ať karta „Úkol vytvořen“ ve vlákně
  // umí ukázat termín, aniž by se sahalo do databáze podruhé.
  const ukolyPodleId = new Map((ukolyPanel ?? []).map((u) => [u.id, u]))

  let nazevUseku: string | null = null
  if (hlavicka.druh === 'usek' && hlavicka.usek_id) {
    const { data: usekData } = await supabase
      .from('useky')
      .select('nazev')
      .eq('id', hlavicka.usek_id as string)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    nazevUseku = (usekData?.nazev as string | undefined) ?? null
  }

  /* --- 3. VYKRESLENÍ -------------------------------------------- */

  const nazevPobocky = hlavicka.branch_id
    ? (nazvyPobocek.get(hlavicka.branch_id as string) ?? 'jiná pobočka')
    : null
  const nazev =
    (hlavicka.nazev as string | null) ??
    (hlavicka.druh === 'osobni' ? nazvyOsobnich.get(konverzace) : undefined) ??
    nazevPobocky ??
    'Rozhovor'
  const druh = hlavicka.druh as Rozhovor['druh']

  const kdoCte =
    druh === 'pobocka'
      ? `Všichni z pobočky ${nazevPobocky ?? ''}`.trim()
      : druh === 'usek'
        ? `Všichni z úseku ${nazevUseku ?? ''}`.trim()
        : druh === 'vedeni'
          ? hlavicka.adresat === 'majitel'
            ? 'Jen majitelé firmy'
            : 'Vedoucí pobočky, jmenovitě'
          : 'Jen uvedení účastníci'

  const zpravyUI: ZpravaUI[] = zpravy.map((z) => ({
    id: z.id,
    autor: z.autor,
    vytvoreno: z.vytvoreno_kdy,
    typ: z.typ,
    text: z.text,
    priorita: z.priorita,
    stornovana: z.stornovano_kdy !== null,
    zvukOdkaz: z.zvuk_cesta ? (odkazyHlasovek.get(z.zvuk_cesta) ?? null) : null,
    zvukDelkaS: z.zvuk_delka_s,
    maZvuk: z.zvuk_cesta !== null,
    objektTyp: z.objekt_typ,
    objektId: z.objekt_id,
    prilohy: prilohyZpravy.get(z.id) ?? [],
  }))

  // Nejnovější zpráva od ostatních — nová zpráva během čtení (živá
  // aktualizace) = nové označení za přečtené.
  const posledniCizi =
    [...zpravyUI].reverse().find((z) => z.typ === 'zprava' && z.autor !== mojeId)?.vytvoreno ?? ''
  const mojeNeprectene = rozhovory.find((r) => r.konverzace_id === konverzace)?.neprectenych ?? 0

  const ucastniciPanel: UcastnikUI[] | null =
    druh === 'pobocka' || druh === 'usek'
      ? null
      : idUcastniku
          .map((id) => ({ id, jmeno: jmena.get(id) ?? 'kdosi', jeJa: id === mojeId }))
          .sort((a, b) => Number(b.jeJa) - Number(a.jeJa) || a.jmeno.localeCompare(b.jmeno, 'cs'))

  const zpravaProUkol =
    [...zpravyUI].reverse().find((z) => z.typ === 'zprava' && !z.stornovana && z.text.trim() !== '')?.id ?? null

  return (
    <div className="pc-rozhovor-stranka">
      {/*
        JEDNA HLAVIČKA (27. 9.): nadpisek „Vzkazy a úkoly“ jako na všech
        záložkách, velký nadpis = název rozhovoru. Na telefonu se hlavička
        i záložky schovají (`.pc-rozhovor-stranka` v _komponenty.css)
        a název nese hlavička vlákna s „← Komunikace“.
      */}
      <Nadpis oci={OCI_VZKAZU} popis={[NAZVY_DRUHU[druh], nazevPobocky].filter(Boolean).join(' · ')}>
        {nazev}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '1440px' }}>
        <PcZalozky rozsah={rozsah} aktivni="komunikace" {...zalozky} />

        {/* Rozhovor se označí za přečtený, až je vlákno opravdu vidět. */}
        <OznacitPoZobrazeni
          rozsah={rozsah}
          konverzace={konverzace}
          neprectenych={mojeNeprectene}
          klic={posledniCizi}
        />

        {chyba ? <p className="hlaska-chyba" role="alert">{chyba}</p> : null}
        {novyUkol ? (
          <p className="pc-poznamka-navrhu" style={{ marginBottom: '14px' }}>
            Úkol je vytvořený. <Link href={`/${rozsah}/ukoly/ukol/${novyUkol}`}>Otevřít úkol</Link>
          </p>
        ) : null}

        {/*
          ČTYŘI SLOUPCE (od 1480 px): seznam | vlákno | O rozhovoru |
          Úkoly a události. Pod 1480 px jdou panely pod vlákno, pod 900 px
          je vidět jen vlákno („← Komunikace“ vede na seznam) a panely jsou
          sbalené pod „Podrobnosti“ (přepínač níž, bez JavaScriptu).
        */}
        <div className="ds-vzkazy-split" data-zobrazit="detail" data-ctyri="1">
          <div className="ds-vzkazy-seznam">
            <SeznamRozhovoru
              rozsah={rozsah}
              rozhovory={rozhovory}
              nazvyPobocek={nazvyPobocek}
              aktivniId={konverzace}
              posledniText={posledniText}
              nazvyOsobnich={nazvyOsobnich}
            />
          </div>

          <div className="ds-vzkazy-detail">
            <section className="ds-plocha pc-vlakno-karta" aria-label={`Rozhovor ${nazev}`}>
              <div className="pc-vlakno-hlava">
                <Link href={`/${rozsah}/vzkazy`} className="ft-tl ft-tl-vedlejsi ft-tl-male pc-zpet">
                  <Ikona klic="sipkaVlevo" /> Komunikace
                </Link>
                <div style={{ minWidth: 0 }}>
                  {/* Na počítači nese název velký nadpis stránky; tady je pro telefon. */}
                  <h2 className="pc-vlakno-nazev">{nazev}</h2>
                  <p>
                    {[NAZVY_DRUHU[druh], nazevPobocky, hlavicka.uzavreno_kdy ? 'uzavřeno' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {hlavicka.adresat === 'majitel' ? (
                    <p className="pc-poznamka-navrhu" style={{ margin: '2px 0 0' }}>
                      Tenhle vzkaz čtou jen majitelé. Vedoucí pobočky se k němu nedostane.
                    </p>
                  ) : null}
                </div>
              </div>

              {zpravy.length >= POCET ? (
                <p className="pc-poznamka-navrhu" style={{ margin: '12px 18px 0' }}>
                  Zobrazuje se posledních {POCET} zpráv rozhovoru; starší tu nejsou.
                </p>
              ) : null}

              <VlaknoZprav
                key={konverzace}
                rozsah={rozsah}
                konverzace={konverzace}
                zpravy={zpravyUI}
                ja={mojeId}
                dnes={denVPasmu(new Date(), ZONA)}
                precetoDo={precetoDo}
                jmena={Object.fromEntries(jmena)}
                ukolyPodleId={Object.fromEntries(ukolyPodleId)}
                zona={ZONA}
                smiUkoly={smiUkoly}
              />
              <div id="konec" />
              <PosunNaKonec />

              {hlavicka.uzavreno_kdy ? (
                <p style={{ ...ramecek, margin: '0 18px 18px' }}>
                  Tenhle rozhovor je uzavřený. Psát do něj už nejde.
                </p>
              ) : (
                /*
                  Hlasovka a příloha jsou od 27. 9. dvě ikony v řádku psaní
                  (`psani.tsx`), ne dva velké bloky pod sebou.
                */
                <Psani
                  rozsah={rozsah}
                  konverzace={konverzace}
                  uzivatel={user.id}
                  smiNalehavou={smiNalehavou}
                  vetaODoruceni={vetaODoruceni({ smiNalehavou, pushNastaveny: nactiKliceVapid(process.env) !== null })}
                  hlasovka={<HlasovkaNahravac rozsah={rozsah} konverzace={konverzace} />}
                  priloha={
                    prilohyDostupne ? (
                      <PridatPrilohu rozsah={rozsah} konverzace={konverzace} tenantId={tenantId} />
                    ) : null
                  }
                />
              )}
            </section>

            {/*
              Věta o telefonu podle toho, kdo ji čte (majiteli chodí
              kdykoli, ostatním během směny a naléhavé i mimo ni). Věta,
              která není pravda, je horší než žádná.
            */}
            <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
              <VetaOPushi rozsah={rozsah} jeMajitel={ctx.jeMajitel} />
            </p>
          </div>

          {/*
            „Podrobnosti“ na telefonu — přepínač bez JavaScriptu. Na počítači
            ho CSS schová a panely jsou vidět pořád; na telefonu jsou
            sbalené, dokud se na „Podrobnosti“ neklepne. Do 27. 9. o tom
            CSS mluvilo, ale přepínač neexistoval a panely stály pod
            vláknem pořád.
          */}
          <input type="checkbox" id="pc-podrobnosti" className="sr-only pc-podrobnosti-prepinac" />
          <label htmlFor="pc-podrobnosti" className="ft-tl ft-tl-vedlejsi pc-podrobnosti-tlacitko">
            <Ikona klic="seznam" /> Podrobnosti rozhovoru
          </label>

          <div className="ds-vzkazy-panel">
            <PanelKonverzace
              rozsah={rozsah}
              konverzace={konverzace}
              druhNazev={NAZVY_DRUHU[druh]}
              kdoCte={kdoCte}
              zalozeno={(hlavicka.zalozeno_kdy as string | null) ?? null}
              ucastnici={ucastniciPanel}
              soubory={zpravyUI
                .filter((z) => !z.stornovana && (z.maZvuk || z.prilohy.length > 0))
                .flatMap((z) =>
                  z.maZvuk
                    ? [{ id: z.id, kdy: z.vytvoreno, delkaS: z.zvukDelkaS }]
                    : z.prilohy.map((p) => ({
                        id: z.id,
                        klic: p.id,
                        kdy: z.vytvoreno,
                        delkaS: null,
                        nazev: p.nazev,
                      })),
                )}
              zona={ZONA}
              smiUkoly={smiUkoly}
              zpravaProUkol={zpravaProUkol}
              jeUzavrena={Boolean(hlavicka.uzavreno_kdy)}
              prilohyDostupne={prilohyDostupne}
            />
          </div>

          <div className="ds-vzkazy-panel">
            <PanelUkolyUdalosti
              rozsah={rozsah}
              ukoly={ukolyPanel}
              udalosti={zpravyUI
                .filter((z) => z.typ === 'system')
                .map((z) => ({ id: z.id, text: z.text, kdy: z.vytvoreno, ukolId: z.objektTyp === 'ukol' ? z.objektId : null }))}
              zona={ZONA}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const ramecek: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-md)',
  padding: '14px',
  margin: '0 0 16px',
  fontSize: '14px',
  lineHeight: 1.5,
}
