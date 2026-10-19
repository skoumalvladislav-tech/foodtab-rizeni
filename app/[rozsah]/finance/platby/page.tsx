import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { fakturyFirmy, pristupKFakturam } from '@/lib/faktury-pristup'
import { hlaskaBrany } from '@/lib/faktury-brana'
import { naFaktury, type RadekFaktury } from '@/lib/faktury-sloupce'
import { jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import { jeVKorunach, jeVracena, kandidatiProNavrhy, navrhnoutParovani, type KandidatFaktura, type KandidatTransakce, type Navrh } from '@/lib/finance-parovani'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
import { CELA_FIRMA, nazevPobockyUctu, volbyPobockyUctu, type PobockaFirmy } from '@/lib/finance-platby-pobocka'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitPlatebniUcet, zapsatTransakci, potvrditParovani, zrusitAlokaci, zmenitPobockuUctu } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Platby.
 *
 * Ruční zápis pohybu, přehled posledních transakcí a fronta návrhů
 * párování s fakturami. Návrhy se POČÍTAJÍ při každém načtení (nic se
 * neukládá jako „navrženo“) — uložený řádek v `platby_faktury` vzniká
 * teprve potvrzením, vždy lidským kliknutím (zadání, oddíl 5).
 *
 * ---------------------------------------------------------------------
 * NA POBOČCE (Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou
 * vidět finance, které se týkají jen Bernard Baru“)
 *
 * Platba pobočku sama nemá — patří jí přes platební účet
 * (`platebni_ucty.branch_id`). Na pobočce jsou proto jen účty TÉ
 * pobočky a platby z nich; firemní účet a jeho platby tu nejsou
 * (`POZNAMKA_FIREMNI`), ani rozpočítané. Párování s fakturami a import
 * výpisu jsou jen za celou firmu: faktury pobočku nemají a potvrzené
 * párování mění stav faktury celé firmy. Dnes je každý účet založený
 * v appce firemní — stránka pobočky bez účtu to řekne větou, ne „0 Kč“.
 * Pobočku účtu jde nastavit v pohledu Celá firma (sekce Platební účty).
 */

const TYPY_UCTU: Record<string, string> = { banka: 'Banka', pokladna: 'Pokladna', karta: 'Karta' }

type PlatebniUcet = { id: string; nazev: string; typ: string; branch_id: string | null }
type Transakce = {
  id: string
  smer: 'prijem' | 'vydaj' | 'prevod_dovnitr' | 'prevod_ven'
  castka_haleru: number
  datum: string
  protistrana: string
  vs: string
  zdroj: string
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

type PotvrzenaAlokace = {
  id: string
  transakceId: string
  fakturaId: string
  castkaHaleru: number
  potvrzenoKdy: string | null
  automaticky: boolean
  /** Automatické párování, jehož platbu banka po spárování (možná) vrátila — k ruční kontrole. */
  moznaVracena: boolean
  transakce: { datum: string; protistrana: string } | null
  dodavatel: string | null
}

async function nactiPotvrzeneAlokace(
  tenantId: string,
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  vidiFaktury: boolean,
  fakturaId: string | null = null,
): Promise<PotvrzenaAlokace[]> {
  // S filtrem `faktura`: VŠECHNA párování té faktury (odkaz z Faktur, když
  // nejde vrátit „Uhrazeno" — chybné párování musí jít najít a zrušit
  // i po měsících). Bez filtru: 20 nejnovějších RUČNÍCH a 50 nejnovějších
  // automatických zvlášť — automatika nesmí ruční párování vytlačit.
  // Před db push migrace 20261008120000 sloupec `zpusob` neexistuje:
  // pak se načte jen to, co šlo dřív.
  const zaklad = () => supabase
    .from('platby_faktury')
    .select('id, transakce_id, faktura, faktura_id, castka_haleru, potvrzeno_kdy, zpusob')
    .eq('tenant_id', tenantId)
    .eq('stav', 'potvrzeno')
    .order('potvrzeno_kdy', { ascending: false })
  // Filtr z adresy jen jako uuid — jinak by dotaz spadl na přetypování.
  const fakturaUuid = fakturaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fakturaId) ? fakturaId : null
  const [rucni, automaticka] = fakturaId
    ? [fakturaUuid ? await zaklad().eq('faktura', fakturaUuid).limit(200) : { data: [], error: null }, { data: [], error: null }]
    : await Promise.all([zaklad().eq('zpusob', 'rucne').limit(20), zaklad().eq('zpusob', 'automaticky').limit(50)])
  const zalozni = () => {
    const dotaz = supabase
      .from('platby_faktury')
      .select('id, transakce_id, faktura_id, castka_haleru, potvrzeno_kdy')
      .eq('tenant_id', tenantId)
      .eq('stav', 'potvrzeno')
      .order('potvrzeno_kdy', { ascending: false })
    return fakturaId ? dotaz.eq('faktura_id', fakturaId).limit(200) : dotaz.limit(20)
  }
  const { data } = rucni.error || automaticka.error
    ? await zalozni()
    : { data: [...(rucni.data ?? []), ...(automaticka.data ?? [])] }

  const alokace = ((data ?? []) as {
    id: string
    transakce_id: string
    faktura?: string | null
    faktura_id: string
    castka_haleru: number
    potvrzeno_kdy: string | null
    zpusob?: string | null
  }[]).map((a) => ({ ...a, faktura_id: a.faktura ?? a.faktura_id }))
  if (alokace.length === 0) return []

  const transakceIds = [...new Set(alokace.map((a) => a.transakce_id))]
  const { data: transakceData } = await supabase
    .from('transakce')
    .select('id, datum, protistrana, vs, castka_haleru')
    .in('id', transakceIds)
  const transakceRadky = (transakceData ?? []) as { id: string; datum: string; protistrana: string; vs: string; castka_haleru: number }[]
  const transakceMapa = new Map(transakceRadky.map((t) => [t.id, t]))

  // Vrátila banka platbu z automatického párování až po spárování? Pro
  // každé zvlášť cílený dotaz: příjmy 0–30 dní po platbě, částka 97–100 %
  // (stejné okno jako jeVracena) — úzké okno dá malý výsledek bez vlastního
  // stropu řádků (jen obecný strop PostgRESTu 1000), takže čerstvé vrácení
  // mezi tisíci příjmy (karty, pokladna) nepřehlédne.
  const plusDny = (datum: string, dny: number) => new Date(Date.parse(`${datum}T00:00:00Z`) + dny * 86_400_000).toISOString().slice(0, 10)
  const vracene = new Set<string>()
  await Promise.all(alokace.filter((a) => a.zpusob === 'automaticky').map(async (a) => {
    const t = transakceMapa.get(a.transakce_id)
    if (!t) return
    const { data: prijmyData } = await supabase.from('transakce').select('vs, castka_haleru, datum, protistrana')
      .eq('tenant_id', tenantId).eq('smer', 'prijem')
      .gte('datum', t.datum).lte('datum', plusDny(t.datum, 30))
      .gte('castka_haleru', Math.floor(t.castka_haleru * 0.97)).lte('castka_haleru', t.castka_haleru)
      .order('datum', { ascending: true })
    const prijmy = ((prijmyData ?? []) as { vs: string | null; castka_haleru: number; datum: string; protistrana: string | null }[])
      .map((p) => ({ vs: p.vs ?? '', castkaHaleru: p.castka_haleru, datum: p.datum, protistrana: p.protistrana ?? '' }))
    if (jeVracena({ vs: t.vs ?? '', castkaHaleru: t.castka_haleru, datum: t.datum, protistrana: t.protistrana ?? '' }, prijmy)) vracene.add(a.id)
  }))

  // Jméno dodavatele jen pro zobrazení. Párování bez faktury (ve staré
  // databázi zmizela) zůstane jen s číslem — jde zrušit.
  let dodavateleMapa = new Map<string, string>()
  const pristupFaktury = vidiFaktury ? await pristupKFakturam(tenantId) : null
  if (pristupFaktury?.stav === 'ok') {
    try {
      const fakturyIds = [...new Set(alokace.map((a) => a.faktura_id))]
      const { data: fakturyData } = await fakturyFirmy(pristupFaktury, 'id, dodavatel').in('id', fakturyIds)
      dodavateleMapa = new Map(
        ((fakturyData ?? []) as unknown as { id: string; dodavatel: string | null }[]).map((f) => [f.id, f.dodavatel ?? '']),
      )
    } catch {
      // Best-effort — bez dodavatele appka ukáže jen číslo faktury.
    }
  }

  return alokace.map((a) => ({
    id: a.id,
    transakceId: a.transakce_id,
    fakturaId: a.faktura_id,
    castkaHaleru: a.castka_haleru,
    potvrzenoKdy: a.potvrzeno_kdy,
    automaticky: a.zpusob === 'automaticky',
    moznaVracena: vracene.has(a.id),
    transakce: transakceMapa.get(a.transakce_id) ?? null,
    dodavatel: dodavateleMapa.get(a.faktura_id) ?? null,
  }))
}

/** PostgREST vrací nejvýš 1000 řádků na dotaz; aktivních faktur je víc (7.10.2026: 1872). */
const STRANKA_FAKTUR = 1000

async function nactiNavrhyParovani(
  tenantId: string,
  transakce: readonly Transakce[],
  alokovanoMapa: ReadonlyMap<string, number>,
  vidiFaktury: boolean,
): Promise<{ navrhy: { navrh: Navrh; faktura: KandidatFaktura }[]; faktury: KandidatFaktura[]; zavreno: string | null }> {
  if (!vidiFaktury) return { navrhy: [], faktury: [], zavreno: null }
  const pristupFaktury = await pristupKFakturam(tenantId)
  // Zavřené Faktury (stěhují se, vrácené, chyba) — říct proč, ne mlčet.
  if (pristupFaktury.stav !== 'ok') {
    return { navrhy: [], faktury: [], zavreno: `${hlaskaBrany(pristupFaktury).text} Párování s fakturami teď nejde.` }
  }
  const nenacteno = { navrhy: [], faktury: [], zavreno: 'Faktury pro párování se nepodařilo načíst — zkuste stránku obnovit.' }

  const faktury: Faktura[] = []
  try {
    for (let strana = 0; strana < 10; strana++) {
      const { data, error } = await fakturyFirmy(pristupFaktury,
        'id, supplier:dodavatel, variable_symbol:variabilni_symbol, castka_haleru, currency:mena, due_date:splatnost, issue_date:datum_vystaveni, status:stav')
        .eq('archivovano', false)
        .order('id', { ascending: true })
        .range(strana * STRANKA_FAKTUR, strana * STRANKA_FAKTUR + STRANKA_FAKTUR - 1)
      if (error) return nenacteno
      faktury.push(...naFaktury(data as unknown as RadekFaktury[]).filter(jeNezaplacena))
      if (!data || data.length < STRANKA_FAKTUR) break
    }
  } catch {
    return nenacteno
  }

  if (faktury.length === 0) return { navrhy: [], faktury: [], zavreno: null }

  const naKandidata = (f: Faktura): KandidatFaktura => ({
    id: f.id,
    vs: f.variable_symbol,
    castkaHaleru: f.castka_haleru,
    dodavatel: f.supplier,
    datum: f.due_date ?? f.issue_date,
    mena: f.currency,
  })
  // Ruční párování nabízí všechny; NÁVRHY jen faktury v Kč — platby jsou
  // v Kč a centy eurové faktury by se porovnaly s haléři (stejně jako
  // automatické párování, vybratAutomatickaParovani).
  const kandidati: KandidatFaktura[] = faktury.map(naKandidata)
  const kandidatiNavrhu: KandidatFaktura[] = kandidatiProNavrhy(faktury)

  const vysledky: { navrh: Navrh; faktura: KandidatFaktura }[] = []
  for (const t of transakce) {
    // Jen plně nespárované NEBO částečně spárované s nevyčerpaným
    // zbytkem (hromadná platba) — appka transakci nepustí z očí jen
    // proto, že na ni leží JEDNA dřívější alokace.
    const zbyva = t.castka_haleru - (alokovanoMapa.get(t.id) ?? 0)
    if (t.smer !== 'vydaj' || zbyva <= 0) continue
    const kandidatTransakce: KandidatTransakce = {
      id: t.id,
      vs: t.vs,
      castkaHaleru: zbyva,
      protistrana: t.protistrana,
      datum: t.datum,
    }
    const navrh = navrhnoutParovani(kandidatTransakce, kandidatiNavrhu)
    if (!navrh) continue
    const faktura = kandidatiNavrhu.find((k) => k.id === navrh.fakturaId)
    if (faktura) vysledky.push({ navrh, faktura })
  }
  return { navrhy: vysledky, faktury: kandidati, zavreno: null }
}

export default async function FinancePlatby({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; importovano?: string; prebytek?: string; sparovano?: string; faktura?: string; pobocka_uctu?: string }>
}) {
  const { rozsah } = await params
  const { chyba, importovano, prebytek, sparovano, faktura: fakturaFiltr, pobocka_uctu: pobockaUctuZmenena } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Platby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const supabase = await getServerSupabase()

  // Pobočka z rozsahu adresy (lib/finance-rozsah.ts), `null` = celá firma.
  const pobocka = pobockaFinanci(pristup.scope)
  const nazevPobocky = pristup.scope.branchName ?? 'pobočka'

  let dotazUctu = supabase.from('platebni_ucty').select('id, nazev, typ, branch_id').eq('tenant_id', tenantId).eq('aktivni', true)
  if (pobocka) dotazUctu = dotazUctu.eq('branch_id', pobocka)

  // Na pobočce `!inner` + filtr na pobočku účtu (stejně jako export pro
  // účetního): platby firemních účtů a účtů jiných poboček tu nejsou.
  // I platby z vypnutých účtů pobočky — historie nezmizí tím, že účet
  // přestal být aktivní. Za celou firmu dotaz beze změny.
  // `string`, ne sjednocení dvou literálů — typový parser supabase-js
  // takové sjednocení v `select` neumí přečíst; řádky se proto níž
  // přetypují přes `unknown` (tvar hlídá výčet sloupců tady).
  const sloupceTransakci: string = pobocka
    ? 'id, smer, castka_haleru, datum, protistrana, vs, zdroj, platebni_ucty!inner(branch_id)'
    : 'id, smer, castka_haleru, datum, protistrana, vs, zdroj'
  let dotazTransakci = supabase.from('transakce').select(sloupceTransakci).eq('tenant_id', tenantId)
  if (pobocka) dotazTransakci = dotazTransakci.eq('platebni_ucty.branch_id', pobocka)

  const [ucty, transakceRes, alokaceRes, pobockyRes] = await Promise.all([
    dotazUctu.order('nazev'),
    dotazTransakci
      .order('datum', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30),
    // Jen POTVRZENÉ alokace — zamítnutá (zrušená) alokace nesmí
    // transakci navždy vyřadit z návrhů párování (nález 7.10.2026:
    // dřív se počítala každá existující řádka bez ohledu na stav).
    // Na pobočce se párování nenačítá vůbec (viz komentář nahoře).
    pobocka
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('platby_faktury').select('transakce_id, castka_haleru').eq('tenant_id', tenantId).eq('stav', 'potvrzeno'),
    // Pobočky pro výběr u účtů — jen za celou firmu (na pobočce je
    // pobočka účtu daná rozsahem). I vypnuté: účet v nich může ležet.
    pobocka
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('branches').select('id, name, active').eq('tenant_id', tenantId).is('deleted_at', null).order('name'),
  ])

  // Na pobočce věta „pobočka nemá účet" nesmí být spadlý dotaz
  // (lib/supabase/dotaz.ts) — za celou firmu chování beze změny.
  if (pobocka && ucty.error) throw new DotazSelhal('platební účty pobočky', ucty.error)
  if (pobocka && transakceRes.error) throw new DotazSelhal('platby pobočky', transakceRes.error)
  if (pobockyRes.error) throw new DotazSelhal('pobočky firmy', pobockyRes.error)

  const platebniUcty = (ucty.data ?? []) as PlatebniUcet[]
  const transakce = (transakceRes.data ?? []) as unknown as Transakce[]
  const pobockyFirmy = (pobockyRes.data ?? []) as PobockaFirmy[]
  const aktivniPobocky = pobockyFirmy.filter((b) => b.active)

  // Součet potvrzených alokací PER TRANSAKCE — appka podle toho pozná,
  // kolik z platby ještě zbývá nepárováno (zadání oddíl 7: hromadná
  // platba na víc faktur musí jít párovat opakovaně, dokud zbývá
  // částka, ne jen jednou a pak transakce navždy zmizí z návrhů).
  const alokovanoMapa = new Map<string, number>()
  for (const r of (alokaceRes.data ?? []) as { transakce_id: string; castka_haleru: number }[]) {
    alokovanoMapa.set(r.transakce_id, (alokovanoMapa.get(r.transakce_id) ?? 0) + r.castka_haleru)
  }
  const zbyvaNaTransakci = (t: Transakce) => t.castka_haleru - (alokovanoMapa.get(t.id) ?? 0)

  // Platby stačí `finance.read`, data faktur (dodavatel, částka, VS) ale chtějí `faktury.read`.
  const vidiFaktury = canSee(pristup.ctx, 'faktury.read')
  // Párování (návrhy, ruční, potvrzená) jen za celou firmu — na pobočce
  // se nenačítá ani databáze Faktur.
  const parovani: Awaited<ReturnType<typeof nactiNavrhyParovani>> = pobocka
    ? { navrhy: [], faktury: [], zavreno: null }
    : await nactiNavrhyParovani(tenantId, transakce, alokovanoMapa, vidiFaktury)
  const { navrhy, faktury: fakturyKandidati } = parovani
  const potvrzeneAlokace: PotvrzenaAlokace[] = pobocka
    ? []
    : await nactiPotvrzeneAlokace(tenantId, supabase, vidiFaktury, fakturaFiltr?.trim() || null)

  // Pro ruční párování (hromadná platba) — jen výdaje s nevyčerpaným
  // zbytkem, ať appka nenabízí platbu, která už je plně spárovaná.
  const transakceSeZbytkem = transakce.filter((t) => t.smer === 'vydaj' && zbyvaNaTransakci(t) > 0)

  const dnes = new Date()
  const prvniDenMesice = `${dnes.getFullYear()}-${String(dnes.getMonth() + 1).padStart(2, '0')}-01`
  const posledniDenMesice = new Date(dnes.getFullYear(), dnes.getMonth() + 1, 0).toISOString().slice(0, 10)

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={pobocka
          ? `Platby z platebních účtů pobočky ${nazevPobocky}.`
          : 'Ruční zápis pohybu a fronta návrhů párování s fakturami.'}
      >
        Platby
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {importovano ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>
            Import hotový — zapsáno {importovano} {importovano === '1' ? 'nová platba' : 'nových plateb'}.
            {sparovano && sparovano !== '0' ? ` Jednoznačně spárováno s fakturami: ${sparovano} (ve Fakturách se přepnou na Uhrazeno nejpozději při příští synchronizaci).` : ''}
          </p>
        ) : null}
        {prebytek ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>
            Párování uloženo — faktura je přeplacená o {koruny(Number(prebytek))}. Appka to sama na jinou
            fakturu nepřevede, rozhodněte, co se s přebytkem stane (jiná faktura, dobropis, vrácení).
          </p>
        ) : null}
        {pobockaUctuZmenena ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>
            Pobočka účtu uložena — jeho dosavadní i nové platby se teď počítají tam.
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* Import výpisu je jen za celou firmu (import/layout.tsx) — na pobočce odkaz nestojí. */}
          {!pobocka ? <Link href={`/${rozsah}/finance/platby/import`} className="ft-tl">Importovat výpis (CSV)</Link> : null}
          {/* Export zná pobočku sám (app/api/ucetni/export): na pobočce jen platby z jejích účtů. */}
          <a href={`/api/ucetni/export?rozsah=${encodeURIComponent(rozsah)}&od=${prvniDenMesice}&do=${posledniDenMesice}`} className="ft-tl">
            Export pro účetního (tento měsíc)
          </a>
        </div>

        {pobocka && platebniUcty.length === 0 ? (
          <div role="status" style={{ ...karta, display: 'grid', gap: '6px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Pobočka zatím nemá aktivní platební účet</h2>
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
              Platby patří pobočce přes platební účet a {nazevPobocky} zatím žádný aktivní nemá. Účty založené
              dosud jsou firemní (bez pobočky) — jejich platby jsou v pohledu Celá firma, ne tady, takže prázdný
              seznam neznamená, že pobočce nic nepřišlo. Existující účet přiřadíte pobočce v pohledu Celá firma
              (Platby → Platební účty){smiPsat ? ', nebo tu níž založte nový účet pobočky' : ''}.
            </p>
          </div>
        ) : null}

        {pobocka ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
            Párování plateb s fakturami je jen v pohledu Celá firma — faktury pobočku nemají a potvrzené
            párování mění stav faktury celé firmy.
          </p>
        ) : !vidiFaktury ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
            Párování plateb s fakturami vidí ten, kdo má právo „Vidět přijaté faktury“.
          </p>
        ) : parovani.zavreno ? (
          <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>{parovani.zavreno}</p>
        ) : null}

        {navrhy.length > 0 ? (
          <section style={{ display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>Návrhy párování ({navrhy.length})</h2>
            {navrhy.map(({ navrh, faktura }) => {
              const transakceNavrhu = transakce.find((t) => t.id === navrh.transakceId)
              // Zbytek platby, ne celá — u hromadné platby (víc faktur na
              // jednu transakci) UŽ část mohla být alokovaná dřív.
              const zbyvaHaleru = transakceNavrhu ? zbyvaNaTransakci(transakceNavrhu) : 0
              // Alokovat NEJVÝŠ tolik, kolik z platby ještě zbývá — dřív
              // se sem natvrdo dávala celá částka faktury, takže platba
              // nižší než faktura (částečná úhrada) by appku nahlásila
              // jako plně uhrazenou. `app.potvrdit_alokaci_platby` tohle
              // i tak ověří (nikdy nedůvěřuje jen klientovi), tohle je
              // jen rozumná výchozí hodnota pro tlačítko.
              const castkaKAlokaciHaleru = Math.min(zbyvaHaleru, faktura.castkaHaleru)
              return (
                <div key={`${navrh.transakceId}-${navrh.fakturaId}`} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '13.5px' }}>
                      Zbývá {koruny(zbyvaHaleru)} ↔ faktura {faktura.dodavatel ?? '—'} ({koruny(faktura.castkaHaleru)})
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Jistota {Math.round(navrh.jistota * 100)} %</div>
                  </div>
                  {smiPsat ? (
                    <form action={potvrditParovani}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="transakce_id" value={navrh.transakceId} />
                      <input type="hidden" name="faktura_id" value={navrh.fakturaId} />
                      <input type="hidden" name="castka_haleru" value={castkaKAlokaciHaleru} />
                      <input type="hidden" name="jistota" value={navrh.jistota} />
                      <button type="submit" className="ft-tl ft-tl-hlavni">Potvrdit párování</button>
                    </form>
                  ) : null}
                </div>
              )
            })}
          </section>
        ) : null}

        {smiPsat && fakturyKandidati.length > 0 && transakceSeZbytkem.length > 0 ? (
          <section style={{ ...karta, display: 'grid', gap: '12px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px' }}>Ruční párování</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                Pro hromadnou platbu (jedna platba na víc faktur) nebo když návrh výš nenabídl tu
                správnou fakturu — zopakujte se stejnou platbou a zbývající částkou.
              </p>
            </div>
            <form action={potvrditParovani} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: '12px', alignItems: 'end' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <label>
                <span style={popisek}>Platba *</span>
                <select name="transakce_id" required style={pole} defaultValue="">
                  <option value="" disabled>— vyberte —</option>
                  {transakceSeZbytkem.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.datum} · {t.protistrana || '—'} · zbývá {koruny(zbyvaNaTransakci(t))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span style={popisek}>Faktura *</span>
                <select name="faktura_id" required style={pole} defaultValue="">
                  <option value="" disabled>— vyberte —</option>
                  {fakturyKandidati.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.dodavatel ?? '—'} · {jeVKorunach(f.mena) ? koruny(f.castkaHaleru) : `${(f.castkaHaleru / 100).toFixed(2).replace('.', ',')} ${f.mena}`}{f.vs ? ` · VS ${f.vs}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span style={popisek}>Částka k alokaci (Kč) *</span>
                <input type="text" name="castka" required placeholder="1234,50" style={pole} />
              </label>
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Potvrdit</button>
              </div>
            </form>
          </section>
        ) : null}

        {potvrzeneAlokace.length > 0 ? (
          <section style={{ display: 'grid', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '15px' }}>
              {fakturaFiltr ? `Párování faktury ${fakturaFiltr}` : 'Potvrzená párování'} ({potvrzeneAlokace.length})
            </h2>
            {fakturaFiltr ? <Link href={`/${rozsah}/finance/platby`} className="ft-tl ft-tl-male">← Všechna párování</Link> : null}
            {potvrzeneAlokace.map((a) => (
              <div key={a.id} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '13.5px' }}>
                    {koruny(a.castkaHaleru)} ↔ faktura {a.dodavatel || a.fakturaId}
                    {a.transakce ? ` · ${a.transakce.protistrana || '—'} (${a.transakce.datum})` : ''}
                  </div>
                  {a.automaticky ? (
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Spárováno automaticky (stejný VS a částka) — když nesedí, zrušte.</div>
                  ) : null}
                  {a.moznaVracena ? (
                    <div role="alert" style={{ fontSize: '12px', color: 'var(--pozor)' }}>
                      Banka platbu možná vrátila (přišel příjem stejné částky) — když ano, párování zrušte, ať faktura není vedená jako zaplacená.
                    </div>
                  ) : null}
                </div>
                {smiPsat ? (
                  <form action={zrusitAlokaci}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="alokace_id" value={a.id} />
                    <button type="submit" className="ft-tl">Zrušit párování</button>
                  </form>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        <section style={{ display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>Poslední pohyby</h2>
          {transakce.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
              {!pobocka
                ? 'Zatím žádné zapsané pohyby.'
                : platebniUcty.length === 0
                  ? 'Bez platebního účtu pobočky tu žádné platby nejsou (viz výš).'
                  : 'Na účtech pobočky zatím nejsou žádné zapsané pohyby.'}
            </p>
          ) : (
            <div style={{ ...karta, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '6px 8px' }}>Datum</th>
                    <th style={{ padding: '6px 8px' }}>Směr</th>
                    <th style={{ padding: '6px 8px' }}>Částka</th>
                    <th style={{ padding: '6px 8px' }}>Protistrana</th>
                    <th style={{ padding: '6px 8px' }}>Zdroj</th>
                  </tr>
                </thead>
                <tbody>
                  {transakce.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                      <td style={{ padding: '6px 8px' }}>{t.datum}</td>
                      <td style={{ padding: '6px 8px' }}>{t.smer === 'prijem' ? 'Příjem' : t.smer === 'vydaj' ? 'Výdaj' : t.smer}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(t.castka_haleru)}</td>
                      <td style={{ padding: '6px 8px' }}>{t.protistrana || '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{t.zdroj}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {smiPsat ? (
          <form action={zapsatTransakci} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Zapsat platbu</h2>

            {platebniUcty.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                {pobocka
                  ? 'Na pobočce jde platbu zapsat jen na účet této pobočky — nejdřív ho níže založte, nebo v pohledu Celá firma přiřaďte pobočce existující účet.'
                  : 'Nejdřív založte platební účet níže.'}
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '12px' }}>
                <label>
                  <span style={popisek}>Účet *</span>
                  <select name="ucet_id" required style={pole}>
                    {platebniUcty.map((u) => <option key={u.id} value={u.id}>{u.nazev}</option>)}
                  </select>
                </label>
                <label>
                  <span style={popisek}>Směr *</span>
                  <select name="smer" required style={pole}>
                    <option value="prijem">Příjem</option>
                    <option value="vydaj">Výdaj</option>
                  </select>
                </label>
                <label>
                  <span style={popisek}>Částka (Kč) *</span>
                  <input type="text" name="castka" required placeholder="1234,50" style={pole} />
                </label>
                <label>
                  <span style={popisek}>Datum *</span>
                  <input type="date" name="datum" required defaultValue={new Date().toISOString().slice(0, 10)} style={pole} />
                </label>
                <label>
                  <span style={popisek}>Protistrana</span>
                  <input type="text" name="protistrana" style={pole} />
                </label>
                <label>
                  <span style={popisek}>Variabilní symbol</span>
                  <input type="text" name="vs" style={pole} />
                </label>
              </div>
            )}

            <label>
              <span style={popisek}>Poznámka</span>
              <input type="text" name="poznamka" style={pole} />
            </label>

            {platebniUcty.length > 0 ? (
              <div>
                <button type="submit" className="ft-tl ft-tl-hlavni">Zapsat platbu</button>
              </div>
            ) : null}
          </form>
        ) : null}

        {platebniUcty.length > 0 ? (
          <section style={{ display: 'grid', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px' }}>Platební účty</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                {pobocka
                  ? 'Aktivní účty této pobočky. Pobočku účtu jde změnit v pohledu Celá firma.'
                  : 'Pobočka účtu určuje, kam se počítají jeho platby. Když ji změníte, přesunou se k nové pobočce i všechny dosavadní platby účtu — v Platbách, Cashflow, Tržbách i v exportu pro účetního.'}
              </p>
            </div>
            <div style={{ ...karta, display: 'grid', gap: '10px' }}>
              {platebniUcty.map((u, i) => (
                <div
                  key={u.id}
                  style={{
                    display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
                    ...(i > 0 ? { borderTop: '1px solid var(--line-2)', paddingTop: '10px' } : {}),
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13.5px' }}>{u.nazev}</div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {TYPY_UCTU[u.typ] ?? u.typ}
                      {pobocka ? '' : ` · ${nazevPobockyUctu(u.branch_id, pobockyFirmy)}`}
                    </div>
                  </div>
                  {/* Pobočku účtu mění jen celá firma (zmenitPobockuUctu chce právo za celou firmu). */}
                  {!pobocka && smiPsat ? (
                    <form action={zmenitPobockuUctu} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="hidden" name="rozsah" value={rozsah} />
                      <input type="hidden" name="ucet_id" value={u.id} />
                      <select
                        name="branch_id"
                        aria-label={`Pobočka účtu ${u.nazev}`}
                        defaultValue={u.branch_id ?? ''}
                        style={{ ...pole, width: 'auto', minWidth: '180px' }}
                      >
                        {volbyPobockyUctu(pobockyFirmy, u.branch_id).map((v) => (
                          <option key={v.value || 'firma'} value={v.value}>{v.label}</option>
                        ))}
                      </select>
                      <button type="submit" className="ft-tl">Uložit pobočku</button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {smiPsat ? (
          <form action={zalozitPlatebniUcet} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            {/* Na pobočce jen pro úplnost — akce bere pobočku z rozsahu, toto pole nečte. */}
            {pobocka ? <input type="hidden" name="branch_id" value={pobocka} /> : null}
            <h2 style={{ margin: 0, fontSize: '15px' }}>{pobocka ? 'Nový platební účet pobočky' : 'Nový platební účet'}</h2>
            {pobocka ? (
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
                Účet se založí pro pobočku {nazevPobocky} — jeho platby uvidíte tady i v pohledu Celá firma.
              </p>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: '12px' }}>
              <label>
                <span style={popisek}>Název *</span>
                <input type="text" name="nazev" required placeholder="např. Hlavní bankovní účet" style={pole} />
              </label>
              <label>
                <span style={popisek}>Typ *</span>
                <select name="typ" required style={pole}>
                  <option value="banka">Banka</option>
                  <option value="pokladna">Pokladna</option>
                  <option value="karta">Karta</option>
                </select>
              </label>
              {!pobocka ? (
                <label>
                  <span style={popisek}>Pobočka</span>
                  <select name="branch_id" style={pole} defaultValue="">
                    <option value="">{CELA_FIRMA}</option>
                    {aktivniPobocky.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <div>
              <button type="submit" className="ft-tl">Založit účet</button>
            </div>
          </form>
        ) : null}

        {pobocka ? (
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>{POZNAMKA_FIREMNI}</p>
        ) : null}
      </div>
    </Navigace>
  )
}
