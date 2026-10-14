import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { canSee, TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { nactiFinanceKpi, type FinanceKpi } from '@/lib/finance-kpi'
import { nactiKombinovanyCashflowGraf } from '@/lib/finance-rolling-prehled'
import { nactiPolozkyKPozornosti, type PolozkaPozornosti } from '@/lib/finance-pozornost'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
import { pokladnaPatriPobocce } from '@/lib/pokladna-trzby'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import DataTable from '@/components/ui/DataTable'
import StatusIndicator from '@/components/ui/StatusIndicator'
import Badge from '@/components/ui/Badge'
import LineChart from '@/components/ui/LineChart'
import HorizontalBarChart from '@/components/ui/HorizontalBarChart'
import Nadpis from '../nadpis'
import Navigace from './navigace'
import FinanceKpiKarta, { type TrendKpi, type JednotkaTrendu } from './kpi-karta'

export const dynamic = 'force-dynamic'

/**
 * Finance — Přehled.
 *
 * Dashboard podle rozvržení, které Šéfík poslal 3. 10. 2026 (KPI karty
 * s trendem, graf vývoje zůstatku, graf nákladů podle kategorie,
 * „co vyžaduje pozornost", stav integrací) — layout a grafy, barvy
 * beze změny (`app/_tokeny.css`, zadání appky). Čísla jsou pořád
 * jen to, co appka SKUTEČNĚ spočítala (`lib/finance-kpi.ts`,
 * `lib/finance-rolling-prehled.ts`, `lib/finance-pozornost.ts`) —
 * žádná ukázková/vymyšlená hodnota.
 *
 * Karty SE NESCHOVÁVAJÍ, když appka nemá číslo — zobrazí „–" (stejný
 * vzor jako „Neúplné"/„–" u receptur). Jediná výjimka je „Náklady
 * práce": tu appka vynechá úplně, protože její nepřítomnost je dána
 * chybějícím oprávněním `payroll.read` (`finance.read` ho nezaručuje),
 * ne chybějícími daty — schovaná karta tu znamená „na tohle nemáte
 * právo", ne „appka nemá co počítat".
 *
 * POBOČKA (Šéfík 13. 10. 2026: „mám otevřený Bernard Bar, budou vidět
 * finance, které se týkají jen Bernard Baru"): na rozsahu pobočky je
 * každé číslo jen za ni (`pobockaFinanci`, lib/finance-kpi.ts) — nadpis
 * nese její jméno, firemní řádky (společný účet, faktury) tu nejsou
 * a nerozpočítávají se, odkazy na obrazovky jen pro celou firmu
 * (Kontakty, Faktury, Import, AI analytik) se nekreslí. Stav integrací
 * ukazuje jen pokladny, které posílají tržby TÉHLE pobočky. Kdo sem smí,
 * hlídá finance/layout.tsx (finance.read za celou firmu).
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

function tentoMesic(): string {
  return new Date().toISOString().slice(0, 7)
}

function hraniceMesice(mesic: string): { od: string; doData: string } {
  const [y, m] = mesic.split('-').map(Number)
  const od = `${mesic}-01`
  const posledni = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { od, doData: `${mesic}-${String(posledni).padStart(2, '0')}` }
}

function sousedniMesic(mesic: string, posun: 1 | -1): string {
  const [y, m] = mesic.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + posun, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function nazevMesice(mesic: string): string {
  const d = new Date(`${mesic}-01T00:00:00Z`)
  const popis = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  return popis.charAt(0).toUpperCase() + popis.slice(1)
}

/** Zkrácený tvar pro osu grafu — „1,2 mil. Kč" / „600 tis. Kč", ne celé číslo. */
function zkratka(haleru: number): string {
  const kc = haleru / 100
  if (Math.abs(kc) >= 1_000_000) return `${(kc / 1_000_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} mil. Kč`
  if (Math.abs(kc) >= 1_000) return `${(kc / 1_000).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} tis. Kč`
  return koruny(haleru)
}

function kratkyDen(isoDatum: string): string {
  const [, m, d] = isoDatum.split('-')
  return `${Number(d)}. ${Number(m)}.`
}

/** Zobrazitelná hodnota KPI procenta — „–", když appka nemá podklad (ne 0 %, to by byla lež). */
function procentoNeboPomlcka(hodnota: number | null): string {
  return hodnota !== null ? `${hodnota.toFixed(1).replace('.', ',')} %` : '–'
}

/** Procentuální/bodová změna vůči předchozímu období — `null`, když se nedá srovnat (nulový základ nebo chybějící údaj). */
function trend(aktualni: number, predchozi: number | null, jednotka: JednotkaTrendu, rustJeDobre: boolean): TrendKpi {
  if (predchozi === null) return null
  if (jednotka === 'p. b.') return { zmena: aktualni - predchozi, jednotka, rustJeDobre }
  if (predchozi === 0) return null
  return { zmena: ((aktualni - predchozi) / Math.abs(predchozi)) * 100, jednotka, rustJeDobre }
}

/**
 * Má karta Tržby číslo? Ne, když se nenačetly, když je pobočka nemá
 * odkud vzít, nebo když pokladna pobočky za měsíc nic neposlala (data
 * má jen v tom předchozím) — „0 Kč" by tvrdilo, že nic neprodala.
 * Celá firma beze změny: tam „0 Kč · 0 z N provozoven" zůstává.
 */
function trzbyMajiCislo(kpi: FinanceKpi, naPobocce: boolean): boolean {
  if (kpi.zdrojTrzeb === 'nenacteno' || kpi.zdrojTrzeb === 'bez_zdroje') return false
  return !(naPobocce && kpi.zdrojTrzeb === 'pokladna' && kpi.pokrytiPokladnou?.maji === 0)
}

function zdrojTrzeb(kpi: FinanceKpi, naPobocce: boolean): string {
  if (kpi.zdrojTrzeb === 'nenacteno') return 'tržby z pokladen se nepodařilo načíst'
  if (kpi.zdrojTrzeb === 'bez_zdroje') return 'pobočka nemá data z pokladny ani vlastní platební účet'
  if (kpi.zdrojTrzeb === 'platby') return naPobocce ? 'z přijatých plateb na účty pobočky' : 'z přijatých plateb'
  if (naPobocce) return kpi.pokrytiPokladnou?.maji === 0 ? 'pokladna pobočky za tento měsíc nic neposlala' : 'z pokladny pobočky'
  return kpi.pokrytiPokladnou && kpi.pokrytiPokladnou.maji < kpi.pokrytiPokladnou.celkem
    ? `z pokladen · ${kpi.pokrytiPokladnou.maji} z ${kpi.pokrytiPokladnou.celkem} provozoven`
    : 'z pokladen'
}

const STAV_INTEGRACE: Record<string, { stav: 'aktivni' | 'neaktivni' | 'cekajici' | 'chyba'; text: string }> = {
  pripojeno: { stav: 'aktivni', text: 'Připojeno' },
  pripojuje_se: { stav: 'cekajici', text: 'Připojuje se' },
  vyzaduje_pozornost: { stav: 'cekajici', text: 'Vyžaduje pozornost' },
  chyba: { stav: 'chyba', text: 'Chyba' },
  nepripojeno: { stav: 'neaktivni', text: 'Čeká na připojení' },
  odpojeno: { stav: 'neaktivni', text: 'Odpojeno' },
}

export default async function FinancePrehled({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ mesic?: string }>
}) {
  const { rozsah } = await params
  const { mesic: mesicParam } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Finance vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  // `null` = celá firma; jinak id pobočky z adresy — každé číslo jen za ni.
  const pobocka = pobockaFinanci(pristup.scope)
  const naPobocce = pobocka !== null
  const nazevPobocky = pristup.scope.branchName ?? 'Pobočka'
  // Odkaz na obrazovku celé firmy jen tomu, kdo na „Celou firmu" smí (jako JenProFirmu).
  const smiNaFirmu = pristup.ctx.membership.scope === 'tenant'

  const mesic = mesicParam && /^\d{4}-\d{2}$/.test(mesicParam) ? mesicParam : tentoMesic()
  const { od, doData } = hraniceMesice(mesic)
  const mesicPredchozi = sousedniMesic(mesic, -1)
  const { od: odPredchozi, doData: doDataPredchozi } = hraniceMesice(mesicPredchozi)

  const supabase = await getServerSupabase()
  const { data: branchesData } = await supabase
    .from('branches')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .is('deleted_at', null)
  const branches = (branchesData ?? []) as { id: string; name: string }[]

  const [kpi, bodyGrafu, pozornost, integraceRes] = await Promise.all([
    nactiFinanceKpi(tenantId, pristup.ctx, branches, { od, doData }, { od: odPredchozi, doData: doDataPredchozi }, pobocka).catch((): FinanceKpi | null => null),
    nactiKombinovanyCashflowGraf(tenantId, 'zakladni', pobocka).catch(() => []),
    nactiPolozkyKPozornosti(tenantId, rozsah, canSee(pristup.ctx, 'faktury.read'), pobocka).catch((): PolozkaPozornosti[] => []),
    supabase.from('integrace_pripojeni').select('id, oblast, poskytovatel, nazev, stav, branch_id, externi_ucet').eq('tenant_id', tenantId).is('odpojeno_kdy', null).order('oblast'),
  ])

  type Pripojeni = { id: string; oblast: string; poskytovatel: string; nazev: string; stav: string; branch_id: string | null; externi_ucet: unknown }
  // Na pobočce jen pokladny, které posílají JEJÍ tržby (vlastní připojení,
  // nebo firemní s provozovnou přiřazenou téhle pobočce). Banka, účetnictví
  // a e-mail dokladů jsou napojení celé firmy — pod pobočkou nemají co dělat.
  const integrace = ((integraceRes.data ?? []) as Pripojeni[])
    .filter((i) => pobocka === null || (i.oblast === 'pokladna' && pokladnaPatriPobocce(i, pobocka)))
  const zaklad = `/${rozsah}/finance`
  const smiVidetMzdy = canSee(pristup.ctx, 'payroll.read')

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={
          naPobocce
            ? `Jen ${nazevPobocky}: tržby z její pokladny, peníze z jejích účtů — appka počítá, nikdy neodhaduje.`
            : 'Tržby z pokladen, peníze ze zapsaných plateb a výsledovky — appka počítá, nikdy neodhaduje.'
        }
        vpravo={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link href={`${zaklad}?mesic=${sousedniMesic(mesic, -1)}`} className="ft-tl">← Dřívější</Link>
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{nazevMesice(mesic)}</span>
            <Link href={`${zaklad}?mesic=${sousedniMesic(mesic, 1)}`} className="ft-tl">Pozdější →</Link>
          </div>
        }
      >
        {naPobocce ? `Přehled — ${nazevPobocky}` : 'Přehled'}
      </Nadpis>

      {/* containerType: karty `.ds-kpi-mrizka` se skládají podle šířky obsahu (@container) — bez kontejneru zůstaly na telefonu čtyři vedle sebe. */}
      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', containerType: 'inline-size' }}>
        {naPobocce ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{POZNAMKA_FIREMNI}</p> : null}

        {kpi ? (
          <div className="ds-kpi-mrizka">
            <FinanceKpiKarta
              ikona="mince" titulek="Tržby" hodnota={trzbyMajiCislo(kpi, naPobocce) ? koruny(kpi.trzbyHaleru) : '–'}
              zdroj={zdrojTrzeb(kpi, naPobocce)}
              trend={trzbyMajiCislo(kpi, naPobocce) ? trend(kpi.trzbyHaleru, kpi.trzbyHaleruPredchozi, '%', true) : null}
              srovnaniS={nazevMesice(mesicPredchozi)}
            />
            {/* Pobočka bez vlastního účtu cashflow NEMÁ — „0 Kč" by tvrdilo, že se nic nepohnulo. */}
            <FinanceKpiKarta
              ikona="blesk" titulek="Cashflow" hodnota={kpi.pobockaBezUctu ? '–' : koruny(kpi.cashflowHaleru)}
              zdroj={kpi.pobockaBezUctu ? 'pobočka nemá vlastní platební účet' : naPobocce ? 'příjmy − výdaje z účtů pobočky' : 'příjmy − výdaje z plateb'}
              trend={kpi.pobockaBezUctu ? null : trend(kpi.cashflowHaleru, kpi.cashflowHaleruPredchozi, '%', true)}
              srovnaniS={nazevMesice(mesicPredchozi)}
            />
            <FinanceKpiKarta
              ikona="vidlicka" titulek="Foodcost" hodnota={procentoNeboPomlcka(kpi.foodcostProcento)}
              // Na pobočce „–" s důvodem (za celou firmu beze změny).
              zdroj={naPobocce && kpi.foodcostProcento === null ? 'bez prodejů jídel se spárovanou recepturou' : undefined}
              trend={kpi.foodcostProcento !== null ? trend(kpi.foodcostProcento, kpi.foodcostProcentoPredchozi, 'p. b.', false) : null}
              srovnaniS={nazevMesice(mesicPredchozi)}
            />
            <FinanceKpiKarta
              ikona="napoj" titulek="Beverage cost" hodnota={procentoNeboPomlcka(kpi.beverageCostProcento)}
              zdroj={naPobocce && kpi.beverageCostProcento === null ? 'bez prodejů nápojů se spárovanou recepturou' : undefined}
              trend={kpi.beverageCostProcento !== null ? trend(kpi.beverageCostProcento, kpi.beverageCostProcentoPredchozi, 'p. b.', false) : null}
              srovnaniS={nazevMesice(mesicPredchozi)}
            />
            {smiVidetMzdy ? (
              <FinanceKpiKarta
                ikona="lide" titulek="Náklady práce" hodnota={procentoNeboPomlcka(kpi.nakladyPraceProcento)}
                // Na pobočce mzdy lidí s DOMOVSKOU pobočkou (vydelky_prehled) — viz ROZHODNOUT v lib/finance-kpi.ts.
                // „–" musí říct proč, jinak by popisek vedle pomlčky vypadal jako výše mezd.
                zdroj={
                  !naPobocce
                    ? undefined
                    : kpi.nakladyPraceProcento !== null
                      ? `mzdy lidí s domovskou pobočkou „${nazevPobocky}“`
                      : !trzbyMajiCislo(kpi, naPobocce)
                        ? 'bez tržeb pobočky to nejde spočítat'
                        : 'tržby pobočky za tento měsíc chybí nebo nejsou úplné'
                }
                trend={kpi.nakladyPraceProcento !== null ? trend(kpi.nakladyPraceProcento, kpi.nakladyPraceProcentoPredchozi, 'p. b.', false) : null}
                srovnaniS={nazevMesice(mesicPredchozi)}
              />
            ) : null}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Přehled se nepodařilo načíst.</p>
        )}

        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
          <div style={{ ...karta, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Vývoj zůstatku</h2>
            <LineChart
              body={bodyGrafu.map((b) => ({ popisek: kratkyDen(b.tydenOd), hodnotaHaleru: b.zustatekHaleru, budouci: b.budouci }))}
              formatovatOsu={zkratka}
              formatovatHodnotu={koruny}
              prazdno={
                naPobocce
                  ? 'Pobočka zatím nemá vlastní aktivní platební účet, takže appka její zůstatek nezná. Účty celé firmy jsou v pohledu Celá firma.'
                  : 'Zatím bez platebních účtů nebo transakcí.'
              }
            />
          </div>
          <div style={{ ...karta, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Náklady podle kategorie</h2>
            <HorizontalBarChart
              radky={(kpi?.nakladyPodleKategorie ?? []).map((r) => ({
                klic: r.kategorie, popisek: r.nazev, hodnota: r.castkaHaleru, zformatovanaHodnota: koruny(r.castkaHaleru),
              }))}
              prazdno={
                kpi?.pobockaBezUctu
                  ? 'Pobočka zatím nemá vlastní platební účet — náklady z plateb za ni appka nemá.'
                  : 'Zatím žádné kategorizované náklady za tohle období.'
              }
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ ...karta, flex: '2 1 420px', minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Co vyžaduje pozornost</h2>
            <DataTable<PolozkaPozornosti>
              zebra
              klicRadku={(r) => r.klic}
              // Na pobočce se seznam nenačítá (faktury pobočku nemají) — neříkat „nic", když se nehledalo.
              prazdno={naPobocce ? 'Párování plateb s fakturami a kontrola faktur jsou v pohledu Celá firma.' : 'Nic nevyžaduje pozornost.'}
              sloupce={[
                { klic: 'popis', hlavicka: 'Popis', vykresli: (r) => r.popis },
                { klic: 'stredisko', hlavicka: 'Středisko', vykresli: (r) => r.stredisko },
                { klic: 'castka', hlavicka: 'Částka', zarovnaniVpravo: true, vykresli: (r) => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{koruny(r.castkaHaleru)}</span> },
                { klic: 'stav', hlavicka: 'Stav', vykresli: (r) => <Badge tone={r.stav === 'nutne' ? 'danger' : 'warning'}>{r.stav === 'nutne' ? 'Nutné' : 'Ke zpracování'}</Badge> },
                { klic: 'akce', hlavicka: '', vykresli: (r) => <Link href={r.akceHref} className="ft-tl ft-tl-male">{r.akceText}</Link> },
              ]}
              radky={pozornost}
            />
          </div>

          <div style={{ ...karta, flex: '1 1 260px', minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>{naPobocce ? 'Pokladny pobočky' : 'Stav integrací'}</h2>
            {integrace.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
                {naPobocce ? 'K téhle pobočce zatím není připojená ani přiřazená žádná pokladna.' : 'Zatím žádná připojení.'}
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {integrace.map((i) => {
                  const popis = STAV_INTEGRACE[i.stav] ?? { stav: 'neaktivni' as const, text: i.stav }
                  return (
                    <StatusIndicator key={i.id} stav={popis.stav}>
                      {(i.nazev || i.poskytovatel)} — {popis.text}
                    </StatusIndicator>
                  )
                })}
              </div>
            )}
            {/* Integrace patří celé firmě (JenProFirmu) — z pobočky rovnou na firemní správu. */}
            {naPobocce ? (
              smiNaFirmu ? (
                <div style={{ marginTop: '14px' }}>
                  <Link href={`/${TENANT_SCOPE_SEGMENT}/finance/integrace`} className="ft-tl">Správa integrací (celá firma) →</Link>
                </div>
              ) : null
            ) : (
              <div style={{ marginTop: '14px' }}>
                <Link href={`${zaklad}/integrace`} className="ft-tl">Správa integrací →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Na pobočce jen to, co pobočka má: import výpisů, Kontakty, Faktury a AI analytik patří celé firmě. */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link href={`${zaklad}/platby`} className="ft-tl">Zapsat platbu</Link>
          {naPobocce ? null : (
            <>
              <Link href={`${zaklad}/platby/import`} className="ft-tl">Importovat výpis (CSV)</Link>
              <Link href={`${zaklad}/kontakty`} className="ft-tl">Kontakty</Link>
              <Link href={`${zaklad}/faktury`} className="ft-tl">Faktury</Link>
              <Link href={`${zaklad}/analytik`} className="ft-tl">Zeptat se AI analytika</Link>
            </>
          )}
        </div>
      </div>
    </Navigace>
  )
}
