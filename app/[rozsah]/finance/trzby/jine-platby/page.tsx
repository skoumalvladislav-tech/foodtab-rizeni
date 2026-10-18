import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { pobockaFinanci } from '@/lib/finance-rozsah'
import { pobockySPravem, zkusPristupJinymPlatbam } from '@/lib/jine-platby-pristup'
import { SLOUPCE_ZAZNAMU, zDbZaznam } from '@/lib/jine-platby-db'
import { STAVY_SKLADU, type StavSkladu, type ZaznamJinePlatby } from '@/lib/jine-platby-typy'
import { formatHaleru } from '@/lib/jine-platby-castky'
import { moznaDvakrat, popisStavuFaktury, popisStavuKontroly, popisStavuSkladu, popisStavuTrzby, popisStavuUhrady, type PopisStavu } from '@/lib/jine-platby-stav'
import { ZONA_VYCHOZI } from '@/lib/cas'
import { provozniDen } from '@/lib/pokladna-cas'
import { dalsiObdobi, popisObdobi } from '@/lib/pokladna-trzby'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { DotazSelhal, tabulkaNeexistuje } from '@/lib/supabase/dotaz'
import { getServerSupabase } from '@/lib/supabase/server'
import Sdeleni from '@/app/sdeleni'
import DataTable from '@/components/ui/DataTable'
import EmptyState from '@/components/ui/EmptyState'
import { PanelHlava } from '../../../dnes/prvky'
import Ikona from '../../../ikona'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import ZnackaStavu from './znacka-stavu'

export const dynamic = 'force-dynamic'

/**
 * Finance → Tržby → Jiné platby: přehled záznamů (docs/jine-platby-navrh.md).
 *
 * Jeden záznam = jeden doklad (sjetina, otevřený účet, ručně psané
 * položky). Každá část má VLASTNÍ stav — kontrola, tržba, sklad, faktura,
 * úhrada — a přehled je ukazuje zvlášť: zapsaná tržba neznamená odečtený
 * sklad, propojená faktura neznamená zaplaceno.
 *
 * Vstup přes `zkusPristupJinymPlatbam` (i obsluha bez `finance.read`),
 * data uživatelským klientem — RLS `app.jine_platby_vidi` pustí jen
 * pobočky, kde má člověk některé právo agendy nebo finanční přehled.
 *
 * Filtry v adrese, každý přes vlastní seznam povolených hodnot:
 *   * `obdobi` RRRR-MM (výchozí aktuální PROVOZNÍ měsíc). Záznam bez data
 *     prodeje (čerstvě založený, AI ho ještě nepřečetla) se ukazuje
 *     v KAŽDÉM měsíci, dokud se datum nedoplní — jinak by se neměl kde
 *     objevit a zapadl by;
 *   * `pobocka` jen za celou firmu a jen pobočka, kde člověk záznamy vidí;
 *   * `stav` (FILTRY_STAVU níž). „Možná zapsáno dvakrát" = tržba zapsaná
 *     v Ostatních tržbách a dodatečná kontrola proti pokladně prodej našla
 *     (`moznaDvakrat`) — filtruje databáze (`kontrola_trzby->>vysledek`),
 *     ať strop řádků neusekne právě tyhle;
 *   * `pohled=schvaleni` — fronta „Čeká na schválení výdeje", jen
 *     s `jine_platby.vydej_pos` a jen z poboček, kde to právo má; bez
 *     ohledu na období (schvalovat se má i to, co přišlo minulý měsíc).
 *     Zrušený záznam do fronty ani do filtru „Čeká na schválení" nepatří,
 *     i kdyby mu stav skladu zůstal.
 */

const LIMIT = 300

const FILTRY_STAVU = ['vse', 'ke_kontrole', 'trzba_nezapsana', 'mozna_dvakrat', 'ceka_na_schvaleni', 'sklad_neuzavreny', 'bez_faktury', 'zrusene'] as const
type FiltrStavu = (typeof FILTRY_STAVU)[number]

const NAZVY_FILTRU: Record<FiltrStavu, string> = {
  vse: 'Vše',
  ke_kontrole: 'Ke kontrole',
  trzba_nezapsana: 'Tržba nezapsána',
  mozna_dvakrat: 'Možná zapsáno dvakrát',
  ceka_na_schvaleni: 'Čeká na schválení výdeje',
  sklad_neuzavreny: 'Sklad neuzavřený',
  bez_faktury: 'Bez faktury',
  zrusene: 'Zrušené',
}

function jeFiltrStavu(v: string | undefined): v is FiltrStavu {
  return (FILTRY_STAVU as readonly string[]).includes(v ?? '')
}

/** Výsledky dodatečné kontroly tržby, při kterých je tržba nejspíš započítaná dvakrát (stejně jako `moznaDvakrat`). */
const VYSLEDKY_DVAKRAT = ['nalezeno', 'pravdepodobne']

/** Značka u řádku, kde je tržba možná zapsaná dvakrát — s ikonou varování (barva sama význam nenese). */
const ZNACKA_DVAKRAT: PopisStavu = { text: 'Možná zapsáno dvakrát', ton: 'danger', varovani: true }

/**
 * Sklad je UZAVŘENÝ, když se ho záznam netýká nebo je výdej hotový
 * (ověřený v pokladně, propojený, ručně doložený, opravený korekcí).
 * Všechno ostatní — i zamítnuto, nepodporováno a chyba — čeká na člověka.
 */
const SKLAD_UZAVRENY: readonly StavSkladu[] = ['nevyzaduje', 'odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'opraveno']
const SKLAD_OTEVRENY: StavSkladu[] = STAVY_SKLADU.filter((s) => !SKLAD_UZAVRENY.includes(s))

/**
 * Aktuální PROVOZNÍ měsíc (den začíná v 05:00, jako v Tržbách): v 1:30
 * v noci 1. 11. ještě běží 31. 10. a přehled nesmí skočit na prázdný listopad.
 */
function provozniMesic(): string {
  return provozniDen(Date.now(), '05:00', ZONA_VYCHOZI).slice(0, 7)
}

/** Měsíc z adresy, nebo aktuální provozní měsíc (budoucí a nesmyslné → aktuální). */
function urcitMesic(parametr: string | undefined, aktualni: string) {
  const klic =
    parametr && /^\d{4}-(0[1-9]|1[0-2])$/.test(parametr) && parametr >= '2000-01' && parametr <= aktualni ? parametr : aktualni
  const od = `${klic}-01`
  const dalsi = dalsiObdobi(od, 'mesic')
  const doData = new Date(Date.parse(`${dalsi}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  const predchozi = new Date(Date.parse(`${od}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7)
  return {
    klic,
    od,
    doData,
    popis: popisObdobi(od, 'mesic'),
    predchozi: predchozi >= '2000-01' ? predchozi : null,
    dalsi: dalsi.slice(0, 7) <= aktualni ? dalsi.slice(0, 7) : null,
  }
}

/** „2026-10-14" → „14. 10. 2026" (bez Date — datum nemá pásmo). */
function datumCesky(datum: string): string {
  const [r, m, d] = datum.split('-').map(Number)
  return `${d}. ${m}. ${r}`
}

type Radek = ZaznamJinePlatby & { souboru: number }

export default async function JinePlatby({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ obdobi?: string; pobocka?: string; stav?: string; pohled?: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupJinymPlatbam(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Jiné platby vidí ten, kdo má některé z práv Jiných plateb nebo „Vidět finanční přehled“.</Sdeleni>
  }
  // `null` = celá firma (s výběrem provozovny); jinak pobočka z adresy.
  const pobockaRozsahu = pobockaFinanci(pristup.scope)

  const { obdobi: obdobiParam, pobocka: pobockaParam, stav: stavParam, pohled: pohledParam } = await searchParams
  const smiSchvalovat = pristup.prava.has('jine_platby.vydej_pos')
  const smiZadat = pristup.prava.has('jine_platby.zadat')
  const pohledSchvaleni = pohledParam === 'schvaleni' && smiSchvalovat
  const stav: FiltrStavu = jeFiltrStavu(stavParam) ? stavParam : 'vse'
  const mesic = urcitMesic(obdobiParam, provozniMesic())

  const supabase = await getServerSupabase()
  const { data: pobockyData, error: chybaPobocek } = await supabase
    .from('branches')
    .select('id, name, active')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('name')
  if (chybaPobocek) throw new DotazSelhal('pobočky firmy', chybaPobocek)
  const pobocky = (pobockyData ?? []) as { id: string; name: string; active: boolean }[]
  const nazvyPobocek = new Map(pobocky.map((b) => [b.id, b.active ? b.name : `${b.name} (vypnutá)`]))

  // Za celou firmu: pobočky, kde člověk záznamy vidí. Stačí se ptát na práva,
  // která má za celou firmu (`pristup.prava`) — člen firmy má právo na
  // každé pobočce právě tehdy, když ho má za firmu (app.has_access).
  const viditelne = pobockaRozsahu
    ? new Set([pobockaRozsahu])
    : await pobockySPravem(tenantId, pobocky.map((b) => b.id), [...pristup.prava])
  const nabidkaPobocek = pobocky.filter((b) => b.active && viditelne.has(b.id))
  const vybranaPobocka = pobockaRozsahu ?? (pobockaParam && nabidkaPobocek.some((b) => b.id === pobockaParam) ? pobockaParam : null)

  // Fronta schvalování: jen pobočky, kde smí výdej potvrdit.
  const pobockySchvaleni = !pohledSchvaleni
    ? new Set<string>()
    : pobockaRozsahu
      ? new Set([pobockaRozsahu])
      : await pobockySPravem(tenantId, [...viditelne], ['jine_platby.vydej_pos'])

  let dotaz = supabase
    .from('jine_platby')
    .select(`${SLOUPCE_ZAZNAMU}, jine_platby_soubory(count)`)
    .eq('tenant_id', tenantId)
  if (pohledSchvaleni) {
    dotaz = dotaz.eq('stav_skladu', 'ceka_na_schvaleni').neq('stav_kontroly', 'zruseno').in('branch_id', [...pobockySchvaleni])
  } else {
    dotaz = dotaz.or(`datum_prodeje.is.null,and(datum_prodeje.gte.${mesic.od},datum_prodeje.lte.${mesic.doData})`)
    if (vybranaPobocka) dotaz = dotaz.eq('branch_id', vybranaPobocka)
    else dotaz = dotaz.in('branch_id', [...viditelne])
    if (stav === 'vse') dotaz = dotaz.neq('stav_kontroly', 'zruseno')
    else if (stav === 'ke_kontrole') dotaz = dotaz.in('stav_kontroly', ['rozpracovano', 'ke_kontrole'])
    else if (stav === 'trzba_nezapsana') dotaz = dotaz.eq('stav_trzby', 'nezapsano').neq('stav_kontroly', 'zruseno')
    else if (stav === 'mozna_dvakrat') dotaz = dotaz.eq('stav_trzby', 'zapsano').in('kontrola_trzby->>vysledek', VYSLEDKY_DVAKRAT)
    else if (stav === 'ceka_na_schvaleni') dotaz = dotaz.eq('stav_skladu', 'ceka_na_schvaleni').neq('stav_kontroly', 'zruseno')
    else if (stav === 'sklad_neuzavreny') dotaz = dotaz.in('stav_skladu', SKLAD_OTEVRENY).neq('stav_kontroly', 'zruseno')
    else if (stav === 'bez_faktury') dotaz = dotaz.eq('stav_faktury', 'bez_faktury').neq('stav_kontroly', 'zruseno')
    else if (stav === 'zrusene') dotaz = dotaz.eq('stav_kontroly', 'zruseno')
  }
  const { data: zaznamyData, error: chybaZaznamu } = await dotaz
    .order('datum_prodeje', { ascending: false, nullsFirst: true })
    .order('vytvoreno', { ascending: false })
    .limit(LIMIT + 1)

  // Migrace ještě nenasazená: karta místo pádu. Jiná chyba = porucha, nahlas.
  const cekaNaDatabazi = chybaZaznamu !== null && tabulkaNeexistuje(chybaZaznamu)
  if (chybaZaznamu && !cekaNaDatabazi) throw new DotazSelhal('záznamy Jiných plateb', chybaZaznamu)

  const nactene = ((zaznamyData ?? []) as Record<string, unknown>[]).map((r): Radek => {
    const pocet = Array.isArray(r.jine_platby_soubory) ? Number((r.jine_platby_soubory[0] as { count?: unknown } | undefined)?.count ?? 0) : 0
    return { ...zDbZaznam(r), souboru: Number.isFinite(pocet) ? pocet : 0 }
  })
  const oriznuto = nactene.length > LIMIT
  const radky = oriznuto ? nactene.slice(0, LIMIT) : nactene

  // Jména autorů přes existující RLS `profiles_select_colleagues` (jen
  // kolegové s aktivním členstvím). Autor, který už ve firmě není,
  // zůstane bez jména — nic se nedomýšlí.
  const idAutoru = [...new Set(radky.map((r) => r.vytvoril).filter((v): v is string => Boolean(v)))]
  const autori = new Map<string, string>()
  if (idAutoru.length > 0) {
    const { data: profily, error: chybaProfilu } = await supabase.from('profiles').select('user_id, full_name').in('user_id', idAutoru)
    if (chybaProfilu) throw new DotazSelhal('jména autorů', chybaProfilu)
    for (const p of (profily ?? []) as { user_id: string; full_name: string | null }[]) {
      const jmeno = String(p.full_name ?? '').trim()
      if (jmeno) autori.set(p.user_id, jmeno)
    }
  }

  const zaklad = `/${rozsah}/finance/trzby/jine-platby`
  const odkaz = (zmena: { obdobi?: string | null; pobocka?: string | null; stav?: FiltrStavu; pohled?: 'schvaleni' | null }) => {
    const p = new URLSearchParams()
    const ph = zmena.pohled === undefined ? (pohledSchvaleni ? 'schvaleni' : null) : zmena.pohled
    if (ph) {
      p.set('pohled', ph)
    } else {
      const o = zmena.obdobi === undefined ? mesic.klic : zmena.obdobi
      if (o) p.set('obdobi', o)
      // Na pobočce ji nese adresa, ne parametr.
      const b = pobockaRozsahu ? null : zmena.pobocka === undefined ? vybranaPobocka : zmena.pobocka
      if (b) p.set('pobocka', b)
      const s = zmena.stav ?? stav
      if (s !== 'vse') p.set('stav', s)
    }
    const q = p.toString()
    return q ? `${zaklad}?${q}` : zaklad
  }

  const nazevRozsahu = vybranaPobocka ? (nazvyPobocek.get(vybranaPobocka) ?? pristup.scope.branchName ?? 'Provozovna') : 'Celá firma'
  const filtrovano = !pohledSchvaleni && (stav !== 'vse' || (vybranaPobocka !== null && pobockaRozsahu === null))

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance · Tržby"
        popis="Prodeje mimo pokladnu podle fotky dokladu. Tržba, sklad, faktura a úhrada mají u každého záznamu vlastní stav — hotová jedna část neznamená hotovou jinou."
        vpravo={
          smiZadat ? (
            <Link href={`${zaklad}/novy`} className="ft-tl ft-tl-hlavni">
              <Ikona klic="plus" />
              Přidat záznam
            </Link>
          ) : null
        }
      >
        {pobockaRozsahu ? `Jiné platby — ${nazevRozsahu}` : 'Jiné platby'}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', minWidth: 0 }}>
        {smiSchvalovat ? (
          <nav className="ds-zalozky" aria-label="Pohled" style={{ margin: 0 }}>
            <Link href={odkaz({ pohled: null })} aria-current={pohledSchvaleni ? undefined : 'page'}>
              Záznamy
            </Link>
            <Link href={odkaz({ pohled: 'schvaleni' })} aria-current={pohledSchvaleni ? 'page' : undefined}>
              Čeká na schválení výdeje
            </Link>
          </nav>
        ) : null}

        {cekaNaDatabazi ? (
          <section className="ds-plocha" aria-label="Čeká na aktualizaci databáze">
            <PanelHlava ikona="faktura" nadpis="Jiné platby čekají na aktualizaci databáze" />
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
              Kód je nasazený dřív než úprava databáze. Jakmile proběhne, objeví se tady záznamy Jiných plateb a půjde přidat první.
            </p>
          </section>
        ) : (
          <>
            {pohledSchvaleni ? (
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
                Skladové výdeje, které čekají na „Potvrdit výdej do POS“ — ze všech období, jen z provozoven, kde výdej potvrdit smíte.
                Potvrzuje se na kartě záznamu.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '10px', minWidth: 0 }}>
                <div role="group" aria-label="Období" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {mesic.predchozi ? (
                    <Link href={odkaz({ obdobi: mesic.predchozi })} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      ← Dřívější
                    </Link>
                  ) : null}
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>{mesic.popis}</span>
                  {mesic.dalsi ? (
                    <Link href={odkaz({ obdobi: mesic.dalsi })} className="ft-tl ft-tl-vedlejsi ft-tl-male">
                      Pozdější →
                    </Link>
                  ) : null}
                </div>

                {pobockaRozsahu === null && nabidkaPobocek.length > 1 ? (
                  <div role="group" aria-label="Provozovna" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Link href={odkaz({ pobocka: null })} className="ft-tl ft-tl-vedlejsi ft-tl-male" aria-current={vybranaPobocka === null ? 'true' : undefined}>
                      Všechny provozovny
                    </Link>
                    {nabidkaPobocek.map((b) => (
                      <Link
                        key={b.id}
                        href={odkaz({ pobocka: b.id })}
                        className="ft-tl ft-tl-vedlejsi ft-tl-male"
                        aria-current={vybranaPobocka === b.id ? 'true' : undefined}
                      >
                        {b.name}
                      </Link>
                    ))}
                  </div>
                ) : null}

                <div role="group" aria-label="Stav" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {FILTRY_STAVU.map((s) => (
                    <Link key={s} href={odkaz({ stav: s })} className="ft-tl ft-tl-vedlejsi ft-tl-male" aria-current={s === stav ? 'true' : undefined}>
                      {NAZVY_FILTRU[s]}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {radky.length === 0 ? (
              <div className="ds-plocha">
                <EmptyState
                  ikona={<Ikona klic="faktura" velikost={32} />}
                  nadpis={pohledSchvaleni ? 'Nic nečeká na schválení' : filtrovano ? 'Filtru nic neodpovídá' : 'Za tohle období tu nic není'}
                  akce={
                    smiZadat && !pohledSchvaleni ? (
                      <Link href={`${zaklad}/novy`} className="ft-tl ft-tl-hlavni">
                        <Ikona klic="plus" />
                        Přidat záznam
                      </Link>
                    ) : null
                  }
                >
                  {pohledSchvaleni
                    ? 'Žádný skladový výdej teď nečeká na potvrzení.'
                    : 'Jiná platba je prodej mimo pokladnu — vyfotíte doklad, appka ho přečte a vy zkontrolujete položky.'}
                </EmptyState>
              </div>
            ) : (
              <section style={{ display: 'grid', gap: '8px', minWidth: 0 }} aria-labelledby="jine-platby-seznam">
                <h2 id="jine-platby-seznam" style={{ margin: 0, fontSize: '15px' }}>
                  {pohledSchvaleni ? 'Čeká na schválení výdeje' : `${NAZVY_FILTRU[stav]} — ${nazevRozsahu} · ${mesic.popis}`}
                </h2>
                <DataTable<Radek>
                  zebra
                  klicRadku={(r) => r.id}
                  sloupce={[
                    {
                      klic: 'prodej',
                      hlavicka: 'Prodej',
                      vykresli: (r) => (
                        <span style={{ display: 'grid', gap: '2px' }}>
                          <Link href={`${zaklad}/${r.id}`} className="ds-plocha-odkaz" style={{ marginLeft: 0, whiteSpace: 'nowrap' }}>
                            {r.datumProdeje ? datumCesky(r.datumProdeje) : 'Datum neurčeno'}
                          </Link>
                          <span style={{ fontSize: '12.5px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {nazvyPobocek.get(r.branchId) ?? 'Jiná provozovna'}
                          </span>
                        </span>
                      ),
                    },
                    {
                      klic: 'oznaceni',
                      hlavicka: 'Zákazník / označení',
                      vykresli: (r) => (
                        <span style={{ display: 'grid', gap: '2px' }}>
                          <Link href={`${zaklad}/${r.id}`} className="ds-plocha-odkaz" style={{ marginLeft: 0, whiteSpace: 'normal' }}>
                            {r.oznaceni.trim() || 'Bez označení'}
                          </Link>
                          <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
                            {r.souboru === 0 ? 'bez dokladu' : r.souboru === 1 ? '1 doklad' : r.souboru < 5 ? `${r.souboru} doklady` : `${r.souboru} dokladů`}
                          </span>
                        </span>
                      ),
                    },
                    {
                      klic: 'castka',
                      hlavicka: 'Částka',
                      zarovnaniVpravo: true,
                      vykresli: (r) => (
                        <span className="ds-cislo" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>
                          {r.castkaHaleru === null ? '–' : formatHaleru(r.castkaHaleru, r.mena)}
                        </span>
                      ),
                    },
                    {
                      klic: 'autor',
                      hlavicka: 'Založil(a)',
                      vykresli: (r) => <span style={{ color: 'var(--muted)' }}>{(r.vytvoril && autori.get(r.vytvoril)) || '–'}</span>,
                    },
                    {
                      klic: 'kontrola',
                      hlavicka: 'Kontrola a tržba',
                      vykresli: (r) => (
                        <span style={{ display: 'grid', gap: '4px', justifyItems: 'start' }}>
                          <ZnackaStavu popis={popisStavuKontroly(r.stavKontroly)} />
                          <ZnackaStavu popis={popisStavuTrzby(r.stavTrzby)} />
                          {moznaDvakrat(r) ? <ZnackaStavu popis={ZNACKA_DVAKRAT} /> : null}
                        </span>
                      ),
                    },
                    {
                      klic: 'sklad',
                      hlavicka: 'Schválení a sklad',
                      vykresli: (r) => <ZnackaStavu popis={popisStavuSkladu(r.stavSkladu)} />,
                    },
                    {
                      klic: 'faktura',
                      hlavicka: 'Faktura a úhrada',
                      vykresli: (r) => (
                        <span style={{ display: 'grid', gap: '4px', justifyItems: 'start' }}>
                          <ZnackaStavu popis={popisStavuFaktury(r.stavFaktury)} />
                          {r.fakturaCislo ? <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>č. {r.fakturaCislo}</span> : null}
                          {/* Úhrada se páruje s fakturou; u prodeje bez faktury by „neověřeno" jen strašilo. */}
                          {r.stavFaktury !== 'bez_faktury' || r.stavUhrady !== 'neovereno' ? <ZnackaStavu popis={popisStavuUhrady(r.stavUhrady)} /> : null}
                        </span>
                      ),
                    },
                  ]}
                  radky={radky}
                />
                {oriznuto ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                    Zobrazeno prvních {LIMIT} záznamů. Zužte výběr filtrem nebo obdobím.
                  </p>
                ) : null}
                {!pohledSchvaleni ? (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                    Záznamy bez data prodeje se ukazují v každém měsíci, dokud se datum nedoplní. „Vše“ nezahrnuje zrušené záznamy.
                  </p>
                ) : null}
              </section>
            )}
          </>
        )}
      </div>
    </Navigace>
  )
}
