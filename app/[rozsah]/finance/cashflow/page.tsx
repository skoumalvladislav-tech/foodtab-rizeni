import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId } from '@/lib/firma'
import { zkusPristupFinanci } from '@/lib/finance-pristup'
import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { nactiRollingVyhledy } from '@/lib/finance-rolling-prehled'
import { KOEFICIENTY_SCENARU, type Scenar } from '@/lib/finance-rolling-vyhled'
import { pobockaFinanci, POZNAMKA_FIREMNI } from '@/lib/finance-rozsah'
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
 *
 * Na pobočce (Šéfík 13. 10. 2026) jen výhled té pobočky — její účty a její
 * předpisy, bez oddílu „Celá firma (účty bez pobočky)". Pobočka bez
 * aktivního platebního účtu výhled nedostane: její zůstatek appka nezná
 * a třináct týdnů od vymyšlené nuly by bylo horší než věta, proč tu nic není.
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

  const pristup = await zkusPristupFinanci(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Cashflow vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  // `null` = celá firma (všechny pobočky + firemní účty); jinak jen ta pobočka.
  const pobocka = pobockaFinanci(pristup.scope)
  const naPobocce = pobocka !== null
  const nazevPobocky = pristup.scope.branchName ?? 'Pobočka'

  const scenar: Scenar = scenarParam === 'konzervativni' || scenarParam === 'optimisticky' ? scenarParam : 'zakladni'

  let vyhledy: Awaited<ReturnType<typeof nactiRollingVyhledy>> = []
  let chybaNacteni = false
  try {
    vyhledy = await nactiRollingVyhledy(tenantId, scenar, pobocka)
  } catch {
    vyhledy = []
    chybaNacteni = true
  }

  const zaklad = `/${rozsah}/finance/cashflow`
  // Na pobočce: výhled jen s účtem (známý zůstatek). Celá firma beze změny —
  // tam se kreslí každá pobočka i bez účtu, jako dřív.
  // ROZHODNOUT: pobočce bez účtu ukázat aspoň plán z jejích předpisů plateb
  // (bez sloupce zůstatku)? Teď nejopatrněji nic — jen věta, proč.
  const bezUctu = naPobocce && !chybaNacteni && vyhledy.length > 0 && !vyhledy.some((v) => v.maUcet)
  const zobrazit = bezUctu ? [] : vyhledy

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={`${naPobocce ? 'Výhled na 13 týdnů. ' : ''}Scénář: ${NAZVY_SCENARU[scenar]} (${popisPredpokladu(scenar)}). Zůstatek se počítá z plánu, skutečnost aktuálního týdne je jen informativní.`}
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
        {naPobocce ? `Cashflow — ${nazevPobocky}` : 'Cashflow — 13 týdnů'}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '20px' }}>
        {naPobocce ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>{POZNAMKA_FIREMNI}</p> : null}

        {bezUctu ? (
          <div style={karta}>
            <h2 style={{ margin: '0 0 6px', fontSize: '15px' }}>{nazevPobocky} zatím nemá vlastní platební účet</h2>
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>
              Bez aktivního účtu pobočky appka nezná její zůstatek, takže výhled by začínal vymyšlenou nulou.
              Platební účty jsou zatím vedené za celou firmu — výhled společných účtů je v pohledu Celá firma.
            </p>
            {pristup.ctx.membership.scope === 'tenant' ? (
              <div style={{ marginTop: '10px' }}>
                <Link href={`/${TENANT_SCOPE_SEGMENT}/finance/cashflow${scenar === 'zakladni' ? '' : `?scenar=${scenar}`}`} className="ft-tl">
                  Cashflow celé firmy →
                </Link>
              </div>
            ) : null}
          </div>
        ) : zobrazit.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            {naPobocce
              ? chybaNacteni
                ? 'Výhled se nepodařilo načíst. Zkuste stránku obnovit.'
                : 'Pobočka je vypnutá — výhled se počítá jen aktivním pobočkám.'
              : 'Zatím žádné platební účty, nebo se výhled nepodařilo načíst.'}
          </p>
        ) : (
          zobrazit.map((v) => (
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
