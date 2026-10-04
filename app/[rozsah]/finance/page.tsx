import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { nactiFinanceKpi, type FinanceKpi } from '@/lib/finance-kpi'
import { nactiKombinovanyCashflowGraf } from '@/lib/finance-rolling-prehled'
import { nactiPolozkyKPozornosti, type PolozkaPozornosti } from '@/lib/finance-pozornost'
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
 * žádná ukázková/vymyšlená hodnota, žádná karta, která by předstírala
 * číslo, na které appka nemá podklad (foodcost/náklady práce chybí,
 * když chybí kategorizace transakcí nebo `payroll.read`).
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

/** Procentuální/bodová změna vůči předchozímu období — `null`, když se nedá srovnat (nulový základ nebo chybějící údaj). */
function trend(aktualni: number, predchozi: number | null, jednotka: JednotkaTrendu, rustJeDobre: boolean): TrendKpi {
  if (predchozi === null) return null
  if (jednotka === 'p. b.') return { zmena: aktualni - predchozi, jednotka, rustJeDobre }
  if (predchozi === 0) return null
  return { zmena: ((aktualni - predchozi) / Math.abs(predchozi)) * 100, jednotka, rustJeDobre }
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

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Finance vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

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
    nactiFinanceKpi(tenantId, pristup.ctx, branches, { od, doData }, { od: odPredchozi, doData: doDataPredchozi }).catch((): FinanceKpi | null => null),
    nactiKombinovanyCashflowGraf(tenantId, 'zakladni').catch(() => []),
    nactiPolozkyKPozornosti(tenantId, rozsah).catch((): PolozkaPozornosti[] => []),
    supabase.from('integrace_pripojeni').select('id, oblast, poskytovatel, nazev, stav').eq('tenant_id', tenantId).is('odpojeno_kdy', null).order('oblast'),
  ])

  const integrace = (integraceRes.data ?? []) as { id: string; oblast: string; poskytovatel: string; nazev: string; stav: string }[]
  const zaklad = `/${rozsah}/finance`

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Skutečnost ze zapsaných plateb a výsledovky — appka počítá, nikdy neodhaduje."
        vpravo={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link href={`${zaklad}?mesic=${sousedniMesic(mesic, -1)}`} className="ft-tl">← Dřívější</Link>
            <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{nazevMesice(mesic)}</span>
            <Link href={`${zaklad}?mesic=${sousedniMesic(mesic, 1)}`} className="ft-tl">Pozdější →</Link>
          </div>
        }
      >
        Přehled
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        {kpi ? (
          <div className="ds-kpi-mrizka">
            <FinanceKpiKarta
              ikona="mince" titulek="Tržby" hodnota={koruny(kpi.trzbyHaleru)}
              trend={trend(kpi.trzbyHaleru, kpi.trzbyHaleruPredchozi, '%', true)}
              srovnaniS={nazevMesice(mesicPredchozi)}
            />
            <FinanceKpiKarta
              ikona="blesk" titulek="Cashflow" hodnota={koruny(kpi.cashflowHaleru)}
              trend={trend(kpi.cashflowHaleru, kpi.cashflowHaleruPredchozi, '%', true)}
              srovnaniS={nazevMesice(mesicPredchozi)}
            />
            {kpi.foodcostProcento !== null ? (
              <FinanceKpiKarta
                ikona="vidlicka" titulek="Foodcost" hodnota={`${kpi.foodcostProcento.toFixed(1).replace('.', ',')} %`}
                trend={trend(kpi.foodcostProcento, kpi.foodcostProcentoPredchozi, 'p. b.', false)}
                srovnaniS={nazevMesice(mesicPredchozi)}
              />
            ) : null}
            {kpi.beverageCostProcento !== null ? (
              <FinanceKpiKarta
                ikona="napoj" titulek="Beverage cost" hodnota={`${kpi.beverageCostProcento.toFixed(1).replace('.', ',')} %`}
                trend={trend(kpi.beverageCostProcento, kpi.beverageCostProcentoPredchozi, 'p. b.', false)}
                srovnaniS={nazevMesice(mesicPredchozi)}
              />
            ) : null}
            {kpi.nakladyPraceProcento !== null ? (
              <FinanceKpiKarta
                ikona="lide" titulek="Náklady práce" hodnota={`${kpi.nakladyPraceProcento.toFixed(1).replace('.', ',')} %`}
                trend={trend(kpi.nakladyPraceProcento, kpi.nakladyPraceProcentoPredchozi, 'p. b.', false)}
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
              prazdno="Zatím bez platebních účtů nebo transakcí."
            />
          </div>
          <div style={{ ...karta, minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Náklady podle kategorie</h2>
            <HorizontalBarChart
              radky={(kpi?.nakladyPodleKategorie ?? []).map((r) => ({
                klic: r.kategorie, popisek: r.nazev, hodnota: r.castkaHaleru, zformatovanaHodnota: koruny(r.castkaHaleru),
              }))}
              prazdno="Zatím žádné kategorizované náklady za tohle období."
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ ...karta, flex: '2 1 420px', minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Co vyžaduje pozornost</h2>
            <DataTable<PolozkaPozornosti>
              zebra
              klicRadku={(r) => r.klic}
              prazdno="Nic nevyžaduje pozornost."
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
            <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>Stav integrací</h2>
            {integrace.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>Zatím žádná připojení.</p>
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
            <div style={{ marginTop: '14px' }}>
              <Link href={`${zaklad}/integrace`} className="ft-tl">Správa integrací →</Link>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link href={`${zaklad}/platby`} className="ft-tl">Zapsat platbu</Link>
          <Link href={`${zaklad}/platby/import`} className="ft-tl">Importovat výpis (CSV)</Link>
          <Link href={`${zaklad}/kontakty`} className="ft-tl">Kontakty</Link>
          <Link href={`${zaklad}/faktury`} className="ft-tl">Faktury</Link>
          <Link href={`${zaklad}/analytik`} className="ft-tl">Zeptat se AI analytika</Link>
        </div>
      </div>
    </Navigace>
  )
}
