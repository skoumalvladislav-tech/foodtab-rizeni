import { redirect } from 'next/navigation'
import Link from 'next/link'

import { ZONA_VYCHOZI, denVPasmu } from '@/lib/cas'
import { getContext, getUser, hasAccess } from '@/lib/authz'
import { bezpecnyRozsah, getCurrentTenantId } from '@/lib/firma'
import { KBELIK, PLATNOST_ODKAZU_S } from '@/lib/hlasove-zpravy'
import { KBELIK_PRILOH, PLATNOST_ODKAZU_PRILOH_S } from '@/lib/komunikace/prilohy'
import { poskladatVlakno } from '@/lib/komunikace/vlakno'
import { DotazSelhal, sloupecNeexistuje, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import PcZalozky from '../../provozni-centrum/zalozky'
import VetaOPushi from '../../provozni-centrum/veta-o-pushi'
import SeznamRozhovoru, { NAZVY_DRUHU, type Rozhovor } from '../seznam-rozhovoru'
import HlasovkaNahravac from './hlasovka-nahravac'
import PanelKonverzace, { type UcastnikUI, type UkolUI } from './panel-konverzace'
import PosunNaKonec from './posun-na-konec'
import PridatPrilohu from './priloha-pridat'
import SkladaniZpravy from './skladani-zpravy'
import VlaknoZprav, { type ZpravaUI } from './vlakno-zprav'

export const dynamic = 'force-dynamic'

/**
 * Jeden rozhovor — tři sloupce: seznam | vlákno | O konverzaci.
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
  const posledniText = new Map<string, string>()
  if (rozhovory.length > 0) {
    const { data: zpravyPreview } = await supabase
      .from('konverzace_zpravy')
      .select('konverzace_id, text, vytvoreno_kdy')
      .in('konverzace_id', rozhovory.map((r) => r.konverzace_id))
      .is('stornovano_kdy', null)
      .order('vytvoreno_kdy', { ascending: false })
      .limit(300)
    for (const z of zpravyPreview ?? []) {
      const kid = z.konverzace_id as string
      if (posledniText.has(kid)) continue
      const t = String(z.text ?? '').trim()
      posledniText.set(kid, t.length > 72 ? `${t.slice(0, 72)}…` : t)
    }
  }

  const { data: hlavicka, error: chybaHlavicka } = await supabase
    .from('konverzace')
    .select('id, druh, branch_id, usek_id, nazev, adresat, uzavreno_kdy, zalozeno_kdy')
    .eq('id', konverzace)
    .maybeSingle()

  if (tabulkaNeexistuje(chybaHlavicka)) {
    return (
      <>
        <Nadpis oci="Provoz" popis="Rozhovor.">
          Rozhovor
        </Nadpis>
        <div style={{ padding: '16px' }}>
          <p style={ramecek}>
            <strong>Tahle obrazovka čeká na nasazení databáze.</strong>{' '}
            Rozhovory přibudou migrací{' '}
            <code>20260903100000_komunikace_zaklad</code> a dvěma dalšími.
          </p>
        </div>
      </>
    )
  }
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
      .order('vytvoreno_kdy', { ascending: true })
      .limit(POCET)
    zpravyData = r.data as unknown[] | null
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

  // Účastníci s výslovným záznamem. Kanál pobočky a úseku je odvozený
  // (řádky tu nejsou), takže tam se místo seznamu píše věta.
  const { data: ucastniciData } = await supabase
    .from('konverzace_ucastnici')
    .select('employee_id')
    .eq('konverzace_id', konverzace)
    .is('odesel_kdy', null)
  const idUcastniku = ((ucastniciData ?? []) as { employee_id: string }[]).map((u) => u.employee_id)

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

  const smiNalehavou = await hasAccess(tenantId, 'communication.urgent', null)
  const smiUkoly = await hasAccess(tenantId, 'tasks.manage', scope.branchId)

  // Do kdy mám přečteno — pro dělítko „Nové zprávy“. Čas přečtení vidí jen
  // vlastník (moje_precteno_do), ne ostatní účastníci. Chyba = žádné dělítko.
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
  const nazev = (hlavicka.nazev as string | null) ?? nazevPobocky ?? 'Rozhovor'
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

  const polozky = poskladatVlakno(zpravyUI, {
    ja: mojeId,
    zona: ZONA,
    dnes: denVPasmu(new Date(), ZONA),
    precetoDo,
  })

  const ucastniciPanel: UcastnikUI[] | null =
    druh === 'pobocka' || druh === 'usek'
      ? null
      : idUcastniku
          .map((id) => ({ id, jmeno: jmena.get(id) ?? 'kdosi', jeJa: id === mojeId }))
          .sort((a, b) => Number(b.jeJa) - Number(a.jeJa) || a.jmeno.localeCompare(b.jmeno, 'cs'))

  const zpravaProUkol =
    [...zpravyUI].reverse().find((z) => z.typ === 'zprava' && !z.stornovana && z.text.trim() !== '')?.id ?? null

  const neprecteneCelkem = rozhovory.reduce((s, r) => s + r.neprectenych, 0)

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis={
          hlavicka.adresat === 'majitel'
            ? 'Tenhle vzkaz čtou jen majitelé. Vedoucí pobočky se k němu nedostane.'
            : 'Nejstarší nahoře.'
        }
      >
        {nazev}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '1440px' }}>
        <PcZalozky
          rozsah={rozsah}
          aktivni="komunikace"
          pocty={{ komunikace: neprecteneCelkem }}
          skryte={smiUkoly ? [] : ['ukoly', 'checklisty']}
        />

        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}
        {novyUkol ? (
          <p className="pc-poznamka-navrhu" style={{ marginBottom: '14px' }}>
            Úkol je vytvořený. <Link href={`/${rozsah}/ukoly/ukol/${novyUkol}`}>Otevřít úkol</Link>
          </p>
        ) : null}

        {/*
          TŘI SLOUPCE (od 1280 px): seznam | vlákno | O konverzaci. Pod
          1280 px jde panel pod vlákno, pod 900 px je vidět jen vlákno
          (seznam se otevírá tlačítkem „Zpět na rozhovory“).
        */}
        <div className="ds-vzkazy-split" data-zobrazit="detail" data-tri="1">
          <div className="ds-vzkazy-seznam">
            <SeznamRozhovoru
              rozsah={rozsah}
              rozhovory={rozhovory}
              nazvyPobocek={nazvyPobocek}
              aktivniId={konverzace}
              posledniText={posledniText}
            />
          </div>

          <div className="ds-vzkazy-detail">
            <section className="ds-plocha pc-vlakno-karta" aria-label={`Rozhovor ${nazev}`}>
              <div className="pc-vlakno-hlava">
                <Link href={`/${rozsah}/vzkazy`} className="ft-tl ft-tl-vedlejsi ft-tl-male pc-zpet">
                  Zpět
                </Link>
                <div style={{ minWidth: 0 }}>
                  <h2>{nazev}</h2>
                  <p>
                    {[NAZVY_DRUHU[druh], nazevPobocky, hlavicka.uzavreno_kdy ? 'uzavřeno' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>

              <VlaknoZprav
                rozsah={rozsah}
                konverzace={konverzace}
                polozky={polozky}
                jmena={Object.fromEntries(jmena)}
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
                <>
                  <SkladaniZpravy
                    rozsah={rozsah}
                    konverzace={konverzace}
                    smiNalehavou={smiNalehavou}
                  />
                  <div style={{ padding: '0 18px 16px' }}>
                    <HlasovkaNahravac rozsah={rozsah} konverzace={konverzace} />
                  </div>
                  {prilohyDostupne ? (
                    <div style={{ padding: '0 18px 16px' }}>
                      <PridatPrilohu rozsah={rozsah} konverzace={konverzace} tenantId={tenantId} />
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {/*
              Push do mobilu zatím nechodí a NEPÍŠE SE, že chodí. Věta
              o telefonu, která není pravda, je horší než žádná: člověk by
              na ni spoléhal a zprávu by si nepřišel přečíst.
            */}
            <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
              <VetaOPushi rozsah={rozsah} />
            </p>
          </div>

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
              ukoly={ukolyPanel}
              udalosti={zpravyUI
                .filter((z) => z.typ === 'system')
                .map((z) => ({ id: z.id, text: z.text, kdy: z.vytvoreno, ukolId: z.objektTyp === 'ukol' ? z.objektId : null }))}
              zona={ZONA}
              smiUkoly={smiUkoly}
              zpravaProUkol={zpravaProUkol}
              jeUzavrena={Boolean(hlavicka.uzavreno_kdy)}
              prilohyDostupne={prilohyDostupne}
            />
          </div>
        </div>
      </div>
    </>
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
