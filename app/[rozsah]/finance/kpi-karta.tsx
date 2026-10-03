import Ikona from '../ikona'
import type { IkonaKlic } from '../nabidka'

/**
 * KPI karta pro Finance → Přehled — stejné CSS jako `.ds-kpi`/
 * `.ds-kpi-mrizka` z Dnes obrazovky (app/_komponenty.css), rozšířené
 * o trendovou šipku. Žije ve Finance, ne v components/ui — potřebuje
 * `Ikona`/`IkonaKlic` z `app/[rozsah]/...`, a ty tam zůstávají mimo
 * sdílené komponenty (stejná hranice jako u `dnes/prvky.tsx`).
 */

export type JednotkaTrendu = '%' | 'p. b.'

export type TrendKpi = {
  /** Kladné i záporné — znaménko už nese směr, karta ho jen barví. */
  zmena: number
  jednotka: JednotkaTrendu
  /** `true`, když RŮST znamená dobrou zprávu (tržby) — `false` u nákladů/foodcostu. */
  rustJeDobre: boolean
} | null

function barvaTrendu(trend: TrendKpi): 'dobre' | 'bad' | undefined {
  if (!trend || trend.zmena === 0) return undefined
  const roste = trend.zmena > 0
  return roste === trend.rustJeDobre ? 'dobre' : 'bad'
}

export default function FinanceKpiKarta({
  ikona,
  titulek,
  hodnota,
  trend,
  srovnaniS,
}: {
  ikona: IkonaKlic
  titulek: string
  hodnota: string
  trend: TrendKpi
  /** Text co se srovnává, např. „srpen 2026“. */
  srovnaniS?: string
}) {
  const tonTrendu = barvaTrendu(trend)

  return (
    <article className="ds-kpi">
      <div className="ds-kpi-hlava">
        <span className="ds-kpi-ikona" data-tone={tonTrendu} aria-hidden="true">
          <Ikona klic={ikona} />
        </span>
        <h2 className="ds-kpi-titulek">{titulek}</h2>
      </div>
      <p className="ds-kpi-hodnota ds-cislo">{hodnota}</p>
      {trend ? (
        <p className="ds-kpi-popis" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              color: tonTrendu === 'dobre' ? 'var(--dobre)' : tonTrendu === 'bad' ? 'var(--bad)' : 'var(--muted)',
              transform: trend.zmena < 0 ? 'scaleY(-1)' : undefined,
            }}
          >
            <Ikona klic="trend" velikost={13} />
          </span>
          <strong style={{ color: tonTrendu === 'dobre' ? 'var(--dobre)' : tonTrendu === 'bad' ? 'var(--bad)' : 'var(--ink)', fontWeight: 600 }}>
            {trend.zmena > 0 ? '+' : ''}{trend.zmena.toFixed(1).replace('.', ',')} {trend.jednotka}
          </strong>
          {srovnaniS ? <span>vs. {srovnaniS}</span> : null}
        </p>
      ) : null}
    </article>
  )
}
