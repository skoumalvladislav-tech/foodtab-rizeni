/**
 * Čárový graf se dvěma úseky — Skutečnost (plná čára) navazující na
 * Predikci (čárkovaná), s výplní pod skutečností. Ruční SVG, žádná
 * knihovna (appka žádnou nemá, viz package.json) — stejná konvence
 * jako ostrý vzhled ikon (app/[rozsah]/ikona.tsx): obrysy, žádné
 * vlastní barvy mimo CSS proměnné.
 *
 * Barva NIKDY sama (house rule, app/_komponenty.css) — proto má graf
 * vlastní legendu s textem, ne jen styl čáry.
 *
 * Žádná závislost na `lib/`/`app/` (stejná konvence jako zbytek
 * `components/ui/`) — formátování čísel chodí přes callback.
 */

export type BodCaroveGrafu = {
  popisek: string
  hodnotaHaleru: number
  /** `false` = skutečnost (plná čára), `true` = predikce (čárkovaná). */
  budouci: boolean
}

const SIRKA = 1000
const VYSKA = 300
const OKRAJ_LEVY = 68
const OKRAJ_PRAVY = 16
const OKRAJ_HORNI = 14
const OKRAJ_SPODNI = 28
const POCET_MRIZEK = 4

export default function LineChart({
  body,
  formatovatOsu,
  formatovatHodnotu,
  vyska = 240,
  prazdno,
}: {
  body: BodCaroveGrafu[]
  formatovatOsu: (haleru: number) => string
  formatovatHodnotu: (haleru: number) => string
  vyska?: number
  prazdno?: string
}) {
  if (body.length < 2) {
    return <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>{prazdno ?? 'Nedostatek dat pro graf.'}</p>
  }

  const n = body.length
  const hodnoty = body.map((b) => b.hodnotaHaleru)
  let min = Math.min(...hodnoty, 0)
  let max = Math.max(...hodnoty, 0)
  if (min === max) { min -= 100; max += 100 }
  const odsazeni = (max - min) * 0.12
  min -= odsazeni
  max += odsazeni

  const sirkaPlochy = SIRKA - OKRAJ_LEVY - OKRAJ_PRAVY
  const vyskaPlochy = VYSKA - OKRAJ_HORNI - OKRAJ_SPODNI

  const xAt = (i: number) => OKRAJ_LEVY + (n === 1 ? 0 : (i / (n - 1)) * sirkaPlochy)
  const yAt = (hodnota: number) => OKRAJ_HORNI + vyskaPlochy - ((hodnota - min) / (max - min)) * vyskaPlochy
  const dnoPlochy = OKRAJ_HORNI + vyskaPlochy

  // Hranice: poslední bod, který ještě NENÍ budoucí (poslední skutečnost).
  // Predikce z něj vychází, ať je přechod plná→čárkovaná čára souvislý.
  let hranice = 0
  body.forEach((b, i) => { if (!b.budouci) hranice = i })

  const cestaProRozsah = (odKonce: number, poKonec: number) => {
    const body2: string[] = []
    for (let i = odKonce; i <= poKonec; i++) {
      body2.push(`${i === odKonce ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(hodnoty[i]).toFixed(1)}`)
    }
    return body2.join(' ')
  }

  const cestaSkutecnost = cestaProRozsah(0, hranice)
  const cestaPredikce = hranice < n - 1 ? cestaProRozsah(hranice, n - 1) : null

  const areaSkutecnost = `${cestaSkutecnost} L ${xAt(hranice).toFixed(1)} ${dnoPlochy} L ${xAt(0).toFixed(1)} ${dnoPlochy} Z`

  // Vodorovné mřížky — rovnoměrně po hodnotě, vč. nulové linky zvlášť,
  // pokud se do rozsahu vejde (kdy je někdy pod nulou).
  const mrizky = Array.from({ length: POCET_MRIZEK + 1 }, (_, i) => min + ((max - min) * i) / POCET_MRIZEK)
  const nulaVRozsahu = min < 0 && max > 0

  // Popisky na X ose — jen část bodů, ať se nepřekrývají.
  const krokPopisku = Math.max(1, Math.ceil(n / 6))

  const idPrechodu = `lc-grad-${Math.round(min)}-${Math.round(max)}-${n}`

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke="var(--mosaz)" strokeWidth="2" /></svg>
          Skutečnost
        </span>
        {cestaPredikce ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <svg width="16" height="8" aria-hidden="true"><line x1="0" y1="4" x2="16" y2="4" stroke="var(--mosaz)" strokeWidth="2" strokeDasharray="4 3" /></svg>
            Predikce
          </span>
        ) : null}
      </div>

      <svg viewBox={`0 0 ${SIRKA} ${VYSKA}`} preserveAspectRatio="none" style={{ width: '100%', height: `${vyska}px` }} role="img" aria-label="Vývoj zůstatku v čase">
        <defs>
          <linearGradient id={idPrechodu} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--mosaz)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--mosaz)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {mrizky.map((hodnota, i) => (
          <g key={i}>
            <line
              x1={OKRAJ_LEVY} x2={SIRKA - OKRAJ_PRAVY} y1={yAt(hodnota)} y2={yAt(hodnota)}
              stroke="var(--line-2)" strokeWidth="1"
            />
            <text x={OKRAJ_LEVY - 8} y={yAt(hodnota)} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="var(--muted)">
              {formatovatOsu(hodnota)}
            </text>
          </g>
        ))}

        {nulaVRozsahu ? (
          <line x1={OKRAJ_LEVY} x2={SIRKA - OKRAJ_PRAVY} y1={yAt(0)} y2={yAt(0)} stroke="var(--line)" strokeWidth="1.3" />
        ) : null}

        {/* Svislá značka "Dnes" na hranici skutečnost/predikce. */}
        {cestaPredikce ? (
          <line
            x1={xAt(hranice)} x2={xAt(hranice)} y1={OKRAJ_HORNI} y2={dnoPlochy}
            stroke="var(--line-2)" strokeWidth="1" strokeDasharray="2 3"
          />
        ) : null}

        <path d={areaSkutecnost} fill={`url(#${idPrechodu})`} stroke="none" />
        <path d={cestaSkutecnost} fill="none" stroke="var(--mosaz)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {cestaPredikce ? (
          <path d={cestaPredikce} fill="none" stroke="var(--mosaz)" strokeOpacity="0.55" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" />
        ) : null}

        {body.map((b, i) => (
          i % krokPopisku === 0 ? (
            <text key={i} x={xAt(i)} y={VYSKA - 8} textAnchor="middle" fontSize="12" fill="var(--muted)">
              {b.popisek}
            </text>
          ) : null
        ))}
      </svg>

      <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
        Dnes: <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{formatovatHodnotu(hodnoty[hranice])}</strong>
      </p>
    </div>
  )
}
