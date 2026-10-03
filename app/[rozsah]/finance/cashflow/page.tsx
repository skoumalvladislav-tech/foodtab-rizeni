import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { nactiRollingVyhledy } from '@/lib/finance-rolling-prehled'
import { KOEFICIENTY_SCENARU, type Scenar } from '@/lib/finance-rolling-vyhled'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'

export const dynamic = 'force-dynamic'

/**
 * Finance — Cashflow.
 *
 * Rolling výhled na 13 týdnů, po pobočkách a firmě, se třemi scénáři
 * s viditelnými předpoklady (zadání, oddíl 5). Zůstatek se VŽDY počítá
 * z plánu — skutečnost aktuálního týdne je jen informativní srovnání,
 * viz lib/finance-rolling-vyhled.ts.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const NAZVY_SCENARU: Record<Scenar, string> = {
  zakladni: 'Základní',
  konzervativni: 'Konzervativní',
  optimisticky: 'Optimistický',
}

function popisPredpokladu(scenar: Scenar): string {
  const k = KOEFICIENTY_SCENARU[scenar]
  if (scenar === 'zakladni') return 'plán beze změny'
  return `příjmy ×${k.prijmy}, výdaje ×${k.vydaje}`
}

export default async function FinanceCashflow({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ scenar?: string }>
}) {
  const { rozsah } = await params
  const { scenar: scenarParam } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Cashflow vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const scenar: Scenar = scenarParam === 'konzervativni' || scenarParam === 'optimisticky' ? scenarParam : 'zakladni'

  let vyhledy: Awaited<ReturnType<typeof nactiRollingVyhledy>> = []
  try {
    vyhledy = await nactiRollingVyhledy(tenantId, scenar)
  } catch {
    vyhledy = []
  }

  const zaklad = `/${rozsah}/finance/cashflow`

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={`Scénář: ${NAZVY_SCENARU[scenar]} (${popisPredpokladu(scenar)}). Zůstatek se počítá z plánu, skutečnost aktuálního týdne je jen informativní.`}
        vpravo={
          <div style={{ display: 'flex', gap: '8px' }}>
            {(Object.keys(NAZVY_SCENARU) as Scenar[]).map((s) => (
              <a
                key={s}
                href={`${zaklad}?scenar=${s}`}
                className="ft-tl"
                style={s === scenar ? { fontWeight: 700, borderColor: 'var(--accent)' } : undefined}
              >
                {NAZVY_SCENARU[s]}
              </a>
            ))}
          </div>
        }
      >
        Cashflow — 13 týdnů
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '20px' }}>
        {vyhledy.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            Zatím žádné platební účty, nebo se výhled nepodařilo načíst.
          </p>
        ) : (
          vyhledy.map((v) => (
            <section key={v.branchId ?? 'firma'} style={{ display: 'grid', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '15px' }}>
                {v.pobocka}
                {v.vyhled.nekdyPodNulou ? (
                  <span style={{ marginLeft: '10px', fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--bad-bg)', color: 'var(--bad)' }}>
                    Pozor — zůstatek klesne pod nulu
                  </span>
                ) : null}
              </h2>
              <div style={{ ...karta, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                      <th style={{ padding: '6px 8px' }}>Týden od</th>
                      <th style={{ padding: '6px 8px' }}>Plán příjmy</th>
                      <th style={{ padding: '6px 8px' }}>Plán výdaje</th>
                      <th style={{ padding: '6px 8px' }}>Skutečnost (tento týden)</th>
                      <th style={{ padding: '6px 8px' }}>Zůstatek na konci</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.vyhled.tydny.map((t) => (
                      <tr
                        key={t.tydenOd}
                        style={{
                          borderBottom: '1px solid var(--line-2)',
                          background: t.jeAktualni ? 'var(--sunken)' : undefined,
                        }}
                      >
                        <td style={{ padding: '6px 8px' }}>{t.tydenOd}{t.jeAktualni ? ' (teď)' : ''}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', color: 'var(--dobre)' }}>{koruny(t.planPrijmyHaleru)}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', color: 'var(--bad)' }}>{koruny(t.planVydajeHaleru)}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', color: 'var(--muted)' }}>
                          {t.skutecnostPrijmyHaleru !== null ? `+${koruny(t.skutecnostPrijmyHaleru)} / -${koruny(t.skutecnostVydajeHaleru ?? 0)}` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: t.zustatekNaKonciHaleru < 0 ? 'var(--bad)' : 'inherit' }}>
                          {koruny(t.zustatekNaKonciHaleru)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </div>
    </Navigace>
  )
}
