import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { smiSpravovatUctyFirmy, zkusPristupFinanci } from '@/lib/finance-pristup'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { fakturyFirmy, pristupKFakturam } from '@/lib/faktury-pristup'
import { hlaskaBrany } from '@/lib/faktury-brana'
import { naFaktury, type RadekFaktury } from '@/lib/faktury-sloupce'
import { jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import {
  jeVKorunach,
  jeVracena,
  SLOUPCE_POTVRZENEHO_PAROVANI,
  SLOUPCE_PRIJMU_PRO_VRACENI,
  sloupceSeznamuPlateb,
  type KandidatFaktura,
} from '@/lib/finance-parovani'
import { protistranaNeboUcet } from '@/lib/banka/ucet'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
import { hodnotaPobockyUctu, nazevPobockyUctu, volbyPobockyUctu, type PobockaFirmy } from '@/lib/finance-platby-pobocka'
import {
  FIREMNI_UCET,
  FIREMNI_VOLBA,
  hlaskaBezUctuPobocky,
  KDO_SPRAVUJE_UCTY,
  KOTVA_UCTU,
  kotvaUctu,
  maPobockaAktivniUcet,
  mistoHlaskyUctu,
  nactiFiremniUcet,
  nactiPobockyBezUctu,
  platiPresFiremniUcet,
  popisUctuPlatby,
  uctyMimoAktivnichPobocek,
  vetaUctuMimoPobocky,
} from '@/lib/finance-ucty-pobocek'
import { DotazSelhal } from '@/lib/supabase/dotaz'
import Sdeleni from '@/app/sdeleni'
import SdeleniPobockyBezFirmy from '../pobocka-bez-firmy'
import PobockyBezUctu from '../pobocky-bez-uctu'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitPlatebniUcet, zapsatTransakci, potvrditParovani, zrusitAlokaci, upravitPlatebniUcet } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Platby.
 *
 * Ruční zápis pohybu, přehled posledních transakcí, ruční párování
 * a odkazy na dvě fronty (Finance Fáze 0, krok 2): Návrhy párování
 * (uložené `platby_faktury` 'navrzeno', hledá je synchronizace banky
 * a import výpisu — lib/finance-navrhy-parovani.ts) a Platby bez faktury
 * (pro účetní). Návrh nic neplatí: potvrzuje ho vždy člověk.
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
 *
 * ---------------------------------------------------------------------
 * POBOČKY A ÚČTY (Finance Fáze 0, krok 3)
 *
 * Za celou firmu: nahoře které aktivní pobočky nemají aktivní účet
 * (jedna definice — lib/finance-ucty-pobocek.ts), u každé platby sloupec
 * „Účet / pobočka" (platba firemního účtu je tak označená) a sekce
 * Platební účty se VŠEMI účty firmy, i vypnutými a těmi na vypnuté,
 * smazané nebo cizí pobočce — s úpravou (pobočka, číslo účtu, název,
 * aktivní) jen pro Správu financí za celou firmu. Nový účet chce
 * výslovnou volbu: pobočka, nebo „Firemní účet (bez pobočky)".
 */

const TYPY_UCTU: Record<string, string> = { banka: 'Banka', pokladna: 'Pokladna', karta: 'Karta' }

type PlatebniUcet = { id: string; nazev: string; typ: string; branch_id: string | null; cislo_uctu: string; aktivni: boolean }
type Transakce = {
  id: string
  smer: 'prijem' | 'vydaj' | 'prevod_dovnitr' | 'prevod_ven'
  castka_haleru: number
  datum: string
  protistrana: string
  protiucet: string
  vs: string
  zdroj: string
  /** Jen za celou firmu (sloupceSeznamuPlateb) — sloupec „Účet / pobočka". */
  platebni_ucty?: { nazev: string | null; branch_id: string | null } | { nazev: string | null; branch_id: string | null }[] | null
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
    .select(SLOUPCE_POTVRZENEHO_PAROVANI)
    .in('id', transakceIds)
  const transakceRadky = (transakceData ?? []) as { id: string; datum: string; protistrana: string; protiucet: string; vs: string; castka_haleru: number }[]
  // Protistrana = jméno, jinak číslo účtu (dřív stálo přímo v protistraně).
  const transakceMapa = new Map(transakceRadky.map((t) => [t.id, { ...t, protistrana: protistranaNeboUcet(t.protistrana, t.protiucet) }]))

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
    const { data: prijmyData } = await supabase.from('transakce').select(SLOUPCE_PRIJMU_PRO_VRACENI)
      .eq('tenant_id', tenantId).eq('smer', 'prijem')
      .gte('datum', t.datum).lte('datum', plusDny(t.datum, 30))
      .gte('castka_haleru', Math.floor(t.castka_haleru * 0.97)).lte('castka_haleru', t.castka_haleru)
      .order('datum', { ascending: true })
    const prijmy = ((prijmyData ?? []) as { vs: string | null; castka_haleru: number; datum: string; protistrana: string | null; protiucet: string | null }[])
      .map((p) => ({ vs: p.vs ?? '', castkaHaleru: p.castka_haleru, datum: p.datum, protistrana: protistranaNeboUcet(p.protistrana, p.protiucet), protiucet: p.protiucet ?? '' }))
    if (jeVracena({ vs: t.vs ?? '', castkaHaleru: t.castka_haleru, datum: t.datum, protistrana: t.protistrana, protiucet: t.protiucet ?? '' }, prijmy)) vracene.add(a.id)
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

/**
 * Faktury pro ruční párování a počet návrhů ve frontě. Návrhy se tu už
 * nepočítají (dřív při každém načtení jen z 30 posledních plateb) —
 * fronta je uložená a stejná pro Platby, Návrhy párování i Přehled.
 */
async function nactiParovani(
  tenantId: string,
  supabase: Awaited<ReturnType<typeof getServerSupabase>>,
  vidiFaktury: boolean,
): Promise<{ pocetNavrhu: number; faktury: KandidatFaktura[]; zavreno: string | null }> {
  if (!vidiFaktury) return { pocetNavrhu: 0, faktury: [], zavreno: null }
  const pristupFaktury = await pristupKFakturam(tenantId)
  // Zavřené Faktury (stěhují se, vrácené, chyba) — říct proč, ne mlčet.
  if (pristupFaktury.stav !== 'ok') {
    return { pocetNavrhu: 0, faktury: [], zavreno: `${hlaskaBrany(pristupFaktury).text} Párování s fakturami teď nejde.` }
  }
  const nenacteno = { pocetNavrhu: 0, faktury: [], zavreno: 'Faktury pro párování se nepodařilo načíst — zkuste stránku obnovit.' }
  const { count: pocetNavrhu, error: chybaNavrhu } = await supabase.from('platby_faktury')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('stav', 'navrzeno')
  if (chybaNavrhu) return nenacteno

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

  // Ruční párování nabízí všechny nezaplacené; jinou měnu než platba
  // databáze odmítne s větou (párování se vede v jedné měně).
  const kandidati: KandidatFaktura[] = faktury.map((f) => ({
    id: f.id,
    vs: f.variable_symbol,
    castkaHaleru: f.castka_haleru,
    dodavatel: f.supplier,
    datum: f.due_date ?? f.issue_date,
    mena: f.currency,
  }))
  return { pocetNavrhu: pocetNavrhu ?? 0, faktury: kandidati, zavreno: null }
}

export default async function FinancePlatby({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; importovano?: string; prebytek?: string; sparovano?: string; faktura?: string; ucet_upraven?: string; ucet?: string }>
}) {
  const { rozsah } = await params
  const { chyba, importovano, prebytek, sparovano, faktura: fakturaFiltr, ucet_upraven: ucetUpraven, ucet: ucetHlasky } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'pobocka_bez_firmy') return <SdeleniPobockyBezFirmy rozsah={rozsah} />
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Platby vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const supabase = await getServerSupabase()

  // Pobočka z rozsahu adresy (lib/finance-rozsah.ts), `null` = celá firma.
  const pobocka = pobockaFinanci(pristup.scope)
  const nazevPobocky = pristup.scope.branchName ?? 'pobočka'

  // I vypnuté účty: za celou firmu je ukazuje sekce Platební účty (i s opravou
  // účtu na vypnuté nebo smazané pobočce). Zápis platby a výpis na pobočce
  // berou jen aktivní (`platebniUcty` níž).
  let dotazUctu = supabase.from('platebni_ucty').select('id, nazev, typ, branch_id, cislo_uctu, aktivni').eq('tenant_id', tenantId)
  if (pobocka) dotazUctu = dotazUctu.eq('branch_id', pobocka)

  // Na pobočce `!inner` + filtr na pobočku účtu (stejně jako export pro
  // účetního): platby firemních účtů a účtů jiných poboček tu nejsou.
  // I platby z vypnutých účtů pobočky — historie nezmizí tím, že účet
  // přestal být aktivní. Za celou firmu navíc název a pobočka účtu
  // (sloupec „Účet / pobočka“, krok 3) — bez !inner, nic se nevyřadí.
  // `string`, ne sjednocení dvou literálů — typový parser supabase-js
  // takové sjednocení v `select` neumí přečíst; řádky se proto níž
  // přetypují přes `unknown` (tvar hlídá výčet sloupců v sloupceSeznamuPlateb).
  const sloupceTransakci: string = sloupceSeznamuPlateb(Boolean(pobocka))
  let dotazTransakci = supabase.from('transakce').select(sloupceTransakci).eq('tenant_id', tenantId)
  if (pobocka) dotazTransakci = dotazTransakci.eq('platebni_ucty.branch_id', pobocka)

  const [ucty, transakceRes, alokaceRes, pobockyRes, bezUctu, firemni] = await Promise.all([
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
    // Kdo nemá aktivní účet — jedna definice pro všechny stránky Financí
    // (pobocky_bez_aktivniho_uctu, krok 3). Na pobočce se ptá jen na ni.
    nactiPobockyBezUctu((fn, argumenty) => supabase.rpc(fn, argumenty), tenantId, pobocka),
    // Platí firma přes firemní účet (dodatek 3d)? Mění jen to, co se
    // o pobočce bez účtu říká; chyba = stav „chyba", ne „ne".
    nactiFiremniUcet((fn, argumenty) => supabase.rpc(fn, argumenty), tenantId),
  ])

  // Na pobočce věta „pobočka nemá účet" nesmí být spadlý dotaz
  // (lib/supabase/dotaz.ts) — za celou firmu chování beze změny.
  if (pobocka && ucty.error) throw new DotazSelhal('platební účty pobočky', ucty.error)
  if (pobocka && transakceRes.error) throw new DotazSelhal('platby pobočky', transakceRes.error)
  if (pobockyRes.error) throw new DotazSelhal('pobočky firmy', pobockyRes.error)

  const vsechnyUcty = (ucty.data ?? []) as PlatebniUcet[]
  // Zápis platby a výpis na pobočce: jen AKTIVNÍ účty (jako dřív).
  const platebniUcty = vsechnyUcty.filter((u) => u.aktivni)
  // Za celou firmu chyba dotazu nesmí vypadat jako „firma nemá účty".
  const chybaUctu = !pobocka && ucty.error ? 'Platební účty se nepodařilo načíst — zkuste stránku obnovit.' : null
  // Protistrana = jméno, jinak číslo účtu (do kroku 1 stálo číslo účtu
  // přímo v protistraně — seznam i návrhy párování ho tak ukazují dál).
  const transakce = ((transakceRes.data ?? []) as unknown as Transakce[])
    .map((t) => ({ ...t, protistrana: protistranaNeboUcet(t.protistrana, t.protiucet) }))
  const pobockyFirmy = (pobockyRes.data ?? []) as PobockaFirmy[]
  const aktivniPobocky = pobockyFirmy.filter((b) => b.active)
  // Účty, jejichž pobočka není aktivní (vypnutá, smazaná, cizí) — platby
  // z nich nejsou v součtech žádné aktivní pobočky. Jen ukázat a nabídnout
  // opravu, nic nepřesouvat (krok 3, bod 4).
  const mimoPobocky = new Map((pobocka ? [] : uctyMimoAktivnichPobocek(vsechnyUcty, pobockyFirmy)).map((u) => [u.id, u]))
  // Odkaz „kde se účet přiřazuje" a úprava účtů jen pro Správu financí za celou firmu.
  const smiSpravovatUcty = await smiSpravovatUctyFirmy(tenantId, pristup.ctx)
  // Na pobočce: nemá aktivní účet? Rozhoduje táž funkce jako za celou firmu;
  // když se nepodařilo zjistit, rozhodne výpis aktivních účtů pobočky.
  const pobockaBezUctu = pobocka !== null && (maPobockaAktivniUcet(bezUctu, pobocka) ?? platebniUcty.length > 0) === false
  const presFiremni = platiPresFiremniUcet(firemni)

  // Hláška po úpravě účtu (chyba i „Účet uložen"): stránka po ní sjede na
  // kartu upraveného účtu (kotvaUctu, adresaUctu v akce.ts), takže se
  // kreslí v ní, U ÚČTU — ne nahoře mimo obrazovku. Bez `ucet` v adrese
  // nahoře jako dřív.
  const mistoHlasky = pobocka ? { kde: 'nahore' as const } : mistoHlaskyUctu(ucetHlasky, vsechnyUcty.map((u) => u.id))
  const hlaskaUctu = chyba
    ? { text: chyba, barva: 'var(--bad)' }
    : ucetUpraven
      ? { text: 'Účet uložen. Když se změnila jeho pobočka, dosavadní i nové platby účtu se teď počítají tam.', barva: 'var(--dobre)' }
      : null
  /** Hláška z adresy, když patří sem: 'nahore', 'sekce', nebo id účtu. */
  const hlaskaZde = (kde: string) => {
    if (!hlaskaUctu) return null
    const sedi = mistoHlasky.kde === 'ucet' ? kde === mistoHlasky.id : kde === mistoHlasky.kde
    if (!sedi) return null
    // Účet z adresy na stránce není (zmizel, seznam se nenačetl): kotvu
    // jeho karty nese hláška na začátku sekce, ať stránka sjede k ní.
    const kotva = mistoHlasky.kde === 'sekce' ? mistoHlasky.kotva ?? undefined : undefined
    return (
      <p role="status" id={kotva} style={{ margin: 0, fontSize: '13px', color: hlaskaUctu.barva, scrollMarginTop: '16px' }}>
        {hlaskaUctu.text}
      </p>
    )
  }

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
  const parovani: Awaited<ReturnType<typeof nactiParovani>> = pobocka
    ? { pocetNavrhu: 0, faktury: [], zavreno: null }
    : await nactiParovani(tenantId, supabase, vidiFaktury)
  const { pocetNavrhu, faktury: fakturyKandidati } = parovani
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
        {hlaskaZde('nahore')}
        {importovano ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>
            Import hotový — zapsáno {importovano} {importovano === '1' ? 'nová platba' : 'nových plateb'}.
            {sparovano && sparovano !== '0' ? ` Jistě spárováno s fakturami (VS, částka i účet dodavatele): ${sparovano} — faktury jsou rovnou vedené jako uhrazené.` : ''}
          </p>
        ) : null}
        {prebytek ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>
            Párování uloženo — faktura je přeplacená o {koruny(Number(prebytek))}. Appka to sama na jinou
            fakturu nepřevede, rozhodněte, co se s přebytkem stane (jiná faktura, dobropis, vrácení).
          </p>
        ) : null}

        {/* Celá firma: aktivní pobočky bez aktivního účtu (krok 3, bod 1). */}
        {!pobocka ? <PobockyBezUctu vysledek={bezUctu} firemni={firemni} smiPrirazovat={smiSpravovatUcty} naPlatbach /> : null}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {/* Import výpisu je jen za celou firmu (import/layout.tsx) — na pobočce odkaz nestojí. */}
          {!pobocka ? <Link href={`/${rozsah}/finance/platby/import`} className="ft-tl">Importovat výpis (CSV)</Link> : null}
          {/* Export zná pobočku sám (app/api/ucetni/export): na pobočce jen platby z jejích účtů. */}
          <a href={`/api/ucetni/export?rozsah=${encodeURIComponent(rozsah)}&od=${prvniDenMesice}&do=${posledniDenMesice}`} className="ft-tl">
            Export pro účetního (tento měsíc)
          </a>
        </div>

        {pobockaBezUctu ? (
          <div role="status" style={{ ...karta, display: 'grid', gap: '6px' }}>
            {/* Firma platí přes firemní účet (dodatek 3d): normální stav, ne „zatím nemá". */}
            <h2 style={{ margin: 0, fontSize: '15px' }}>
              {presFiremni ? `${nazevPobocky} platí přes firemní účet` : 'Pobočka zatím nemá aktivní platební účet'}
            </h2>
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
              {presFiremni
                ? 'Platby patří pobočce přes platební účet a vlastní účet pobočka nemá. Platby firemního účtu jsou v pohledu Celá firma, ne tady, takže prázdný seznam neznamená, že pobočce nic nepřišlo.'
                : `Platby patří pobočce přes platební účet a ${nazevPobocky} zatím žádný aktivní nemá. Účty založené dosud jsou firemní (bez pobočky) — jejich platby jsou v pohledu Celá firma, ne tady, takže prázdný seznam neznamená, že pobočce nic nepřišlo.`}
            </p>
            {/* Kde se účet přiřazuje — jen tomu, kdo to smí (krok 3, bod 5). */}
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
              {hlaskaBezUctuPobocky(smiSpravovatUcty, firemni)}
              {smiPsat ? ' Nový účet pobočky můžete založit i tady níž.' : ''}
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

        {!pobocka && vidiFaktury && !parovani.zavreno ? (
          <section style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px' }}>Návrhy párování ({pocetNavrhu})</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                {pocetNavrhu > 0
                  ? 'Platby, ke kterým appka našla pravděpodobnou fakturu. Sama je nezaplatí — potvrďte nebo odmítněte.'
                  : 'Žádný návrh nečeká. Appka hledá nové po každé synchronizaci banky a importu výpisu.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <Link href={`/${rozsah}/finance/platby/navrhy`} className={pocetNavrhu > 0 ? 'ft-tl ft-tl-hlavni' : 'ft-tl'}>Návrhy párování</Link>
              <Link href={`/${rozsah}/finance/platby/bez-faktury`} className="ft-tl">Platby bez faktury</Link>
            </div>
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
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Spárováno automaticky (stejný VS, částka i účet dodavatele) — když nesedí, zrušte.</div>
                  ) : null}
                  {a.moznaVracena ? (
                    <div role="alert" style={{ fontSize: '12px', color: 'var(--pozor)' }}>
                      Banka platbu možná vrátila (přišel příjem stejné částky) — když ano, párování zrušte, ať faktura není vedená jako zaplacená.
                    </div>
                  ) : null}
                </div>
                {smiPsat ? (
                  <form action={zrusitAlokaci} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="alokace_id" value={a.id} />
                    {/* Důvod zrušení je povinný — zůstane v historii (audit). */}
                    <input
                      type="text"
                      name="duvod"
                      required
                      minLength={5}
                      maxLength={300}
                      aria-label="Důvod zrušení párování"
                      placeholder="Proč párování rušíte"
                      style={{ ...pole, width: 'auto', minWidth: '200px' }}
                    />
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
                    {/* Za celou firmu: kam se platba počítá — firemní účet je výslovně označený (krok 3, bod 2). */}
                    {!pobocka ? <th style={{ padding: '6px 8px' }}>Účet / pobočka</th> : null}
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
                      {!pobocka ? (() => {
                        const popis = popisUctuPlatby(Array.isArray(t.platebni_ucty) ? t.platebni_ucty[0] : t.platebni_ucty, pobockyFirmy)
                        return (
                          <td style={{ padding: '6px 8px' }}>
                            <div>{popis.ucet}</div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{popis.kam}</div>
                          </td>
                        )
                      })() : null}
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
                  ? `Na pobočce jde platbu zapsat jen na účet této pobočky — nejdřív ho níže založte${smiSpravovatUcty ? ', nebo v pohledu Celá firma přiřaďte pobočce existující účet' : ''}.`
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

        {/* Na pobočce jen její aktivní účty; za celou firmu VŽDY (i prázdná nebo s chybou) — sem míří odkaz „Upravit platební účty" i návrat po úpravě účtu. */}
        {(pobocka ? platebniUcty.length > 0 : true) ? (
          <section id={pobocka ? undefined : KOTVA_UCTU} style={{ display: 'grid', gap: '10px', scrollMarginTop: '16px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '15px' }}>Platební účty</h2>
              <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)' }}>
                {pobocka
                  ? `Aktivní účty této pobočky. ${smiSpravovatUcty ? 'Pobočku účtu, číslo účtu a další údaje upravíte v pohledu Celá firma.' : `Účty upravuje ${KDO_SPRAVUJE_UCTY}.`}`
                  : 'Pobočka účtu určuje, kam se počítají jeho platby. Když ji změníte, přesunou se k nové pobočce i všechny dosavadní platby účtu — v Platbách, Cashflow, Tržbách i v exportu pro účetního. Vypnutý účet se nenabízí k zápisu plateb a nepočítá se jako účet pobočky.'}
              </p>
            </div>
            {/* Hláška úpravy účtu, který se nenašel nebo nejde přečíst — na začátek sekce, kam stránka sjede. */}
            {hlaskaZde('sekce')}
            {chybaUctu ? (
              <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chybaUctu}</p>
            ) : (pobocka ? platebniUcty : vsechnyUcty).length === 0 ? (
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>Firma zatím nemá žádný platební účet.</p>
            ) : (
              <div style={{ ...karta, display: 'grid', gap: '10px' }}>
                {(pobocka ? platebniUcty : vsechnyUcty).map((u, i) => {
                  const mimo = mimoPobocky.get(u.id)
                  return (
                    // Kotva karty: sem se stránka vrací po úpravě účtu (adresaUctu) — hláška je hned pod názvem.
                    <div
                      key={u.id}
                      id={pobocka ? undefined : kotvaUctu(u.id)}
                      style={{
                        display: 'grid', gap: '8px', scrollMarginTop: '16px',
                        ...(i > 0 ? { borderTop: '1px solid var(--line-2)', paddingTop: '10px' } : {}),
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '13.5px' }}>
                          {u.nazev}
                          {!u.aktivni ? <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--muted)' }}>(vypnutý)</span> : null}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {TYPY_UCTU[u.typ] ?? u.typ}
                          {u.cislo_uctu ? ` · ${u.cislo_uctu}` : ' · bez čísla účtu'}
                          {pobocka ? '' : ` · ${nazevPobockyUctu(u.branch_id, pobockyFirmy)}`}
                        </div>
                        {mimo ? (
                          <p role="status" style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--pozor)' }}>{vetaUctuMimoPobocky(mimo)}</p>
                        ) : null}
                      </div>
                      {/* Hláška úpravy TOHOTO účtu (chyba i „Účet uložen") — u něj, kde je vidět. */}
                      {hlaskaZde(u.id)}
                      {/* Úprava účtu jen za celou firmu a jen se Správou financí za celou firmu (upravitPlatebniUcet + politika platebni_ucty_update). */}
                      {!pobocka && smiSpravovatUcty ? (
                        <form
                          action={upravitPlatebniUcet}
                          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: '8px', alignItems: 'end' }}
                        >
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="ucet_id" value={u.id} />
                          <label>
                            <span style={popisek}>Název</span>
                            <input type="text" name="nazev" required defaultValue={u.nazev} aria-label={`Název účtu ${u.nazev}`} style={pole} />
                          </label>
                          <label>
                            <span style={popisek}>Číslo účtu nebo IBAN</span>
                            <input
                              type="text" name="cislo_uctu" inputMode="text" autoComplete="off" defaultValue={u.cislo_uctu}
                              aria-label={`Číslo účtu ${u.nazev}`} style={pole}
                            />
                          </label>
                          <label>
                            <span style={popisek}>Pobočka</span>
                            <select
                              name="branch_id"
                              aria-label={`Pobočka účtu ${u.nazev}`}
                              defaultValue={hodnotaPobockyUctu(u.branch_id)}
                              style={pole}
                            >
                              {volbyPobockyUctu(pobockyFirmy, u.branch_id).map((v) => (
                                <option key={v.value} value={v.value}>{v.label}</option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', minHeight: '44px' }}>
                            <input type="checkbox" name="aktivni" defaultChecked={u.aktivni} /> Aktivní
                          </label>
                          <div>
                            <button type="submit" className="ft-tl">Uložit účet</button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
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
              <label>
                <span style={popisek}>Číslo účtu nebo IBAN</span>
                <input type="text" name="cislo_uctu" inputMode="text" autoComplete="off" placeholder="např. 19-2000145399/0800" style={pole} />
              </label>
              {!pobocka ? (
                // Bez výchozí volby (krok 3, bod 3): pobočka, nebo výslovně
                // firemní účet. Prázdné pole odmítne prohlížeč (required)
                // i akce (pobockaUctu).
                <label>
                  <span style={popisek}>Pobočka *</span>
                  <select name="branch_id" required style={pole} defaultValue="">
                    <option value="" disabled>Vyberte pobočku…</option>
                    {aktivniPobocky.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    <option value={FIREMNI_VOLBA}>{FIREMNI_UCET}</option>
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
