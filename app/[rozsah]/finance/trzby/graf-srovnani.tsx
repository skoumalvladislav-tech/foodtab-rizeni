'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * Kresba grafu srovnání tržeb — sloupce = zobrazené období, čára =
 * srovnávací období, slot po slotu (dny měsíce / měsíce roku).
 *
 * Jen kreslí: všechna čísla a texty dostane hotové od karty
 * (srovnani.tsx), která je spočítala z `lib/trzby-srovnani.ts`. Funkce
 * se ze serveru do klienta předat nedají, proto žádné formátovací
 * callbacky jako u LineChart.
 *
 * Ruční SVG (appka knihovnu grafů nemá), barvy jen z tokenů
 * (`--graf-obdobi`, `--graf-srovnani`, app/_tokeny.css — ověřené
 * validátorem dataviz ve světlém i tmavém režimu). SVG se kreslí
 * v SKUTEČNÉ šířce (ResizeObserver), ne roztažené `preserveAspectRatio=
 * "none"` — jinak by se na telefonu smrsklo i písmo os.
 *
 * Hodnota nikdy jen v bublině: stejná čísla jsou v tabulce pod grafem
 * (karta) a z klávesnice je čte skrytý živý region. Slot bez dat nemá
 * sloupec ani bod čáry — čára se v něm přeruší, žádná nula.
 */

export type SlotKresby = {
  /** Popisek osy — číslo dne/měsíce, nebo zkratka měsíce na širší ose. */
  osa: string
  osaSlovem: string
  /** „po 12. 10." / „Říjen 2026". */
  popis: string
  popisSrovnani: string | null
  /** Haléře; `null` = bez dat (sloupec / bod čáry se nekreslí). */
  aktualni: number | null
  srovnani: number | null
  textAktualni: string
  textSrovnani: string
  /** „+12,4 %" — jen kde se dá poctivě srovnat. */
  rozdil: string | null
  poznamka: string | null
  stav: 'uzavrene' | 'bezi' | 'budouci'
}

const VYSKA_PLOCHY = 220
const NAHORE = 10
const DOLE = 26
const VYCHOZI_SIRKA = 720
const SIRKA_BUBLINY = 232

/** Horní hrana sloupce zaoblená (4 px), u základny rovná. */
function cestaSloupce(x: number, vrch: number, sirka: number, dno: number): string | null {
  const vyska = dno - vrch
  if (vyska <= 0) return null
  const r = Math.min(4, sirka / 2, vyska)
  return `M${x} ${dno}V${vrch + r}Q${x} ${vrch} ${x + r} ${vrch}H${x + sirka - r}Q${x + sirka} ${vrch} ${x + sirka} ${vrch + r}V${dno}Z`
}

export default function GrafSrovnaniKresba({
  sloty,
  dilky,
  popiskyDilku,
  nazevAktualniho,
  nazevSrovnani,
  srovnaniBezDat,
  osaX,
  popisGrafu,
}: {
  sloty: SlotKresby[]
  /** Dílky svislé osy v haléřích od nuly (lib/trzby-srovnani.ts `dilkyOsy`). */
  dilky: number[]
  popiskyDilku: string[]
  nazevAktualniho: string
  nazevSrovnani: string
  /** Srovnání nemá data vůbec — legenda to řekne u čáry. */
  srovnaniBezDat: boolean
  /** Titulek vodorovné osy („Den v měsíci" / „Měsíc"). */
  osaX: string
  /** Přístupný název grafu (čtečka obrazovky). */
  popisGrafu: string
}) {
  const obal = useRef<HTMLDivElement>(null)
  const [sirka, setSirka] = useState(VYCHOZI_SIRKA)
  const [aktivni, setAktivni] = useState<number | null>(null)
  const [zKlavesnice, setZKlavesnice] = useState(false)
  const idNavodu = useId()

  useEffect(() => {
    const el = obal.current
    if (!el) return
    const zmerit = () => setSirka(Math.max(240, Math.round(el.clientWidth)))
    zmerit()
    const pozorovatel = new ResizeObserver(zmerit)
    pozorovatel.observe(el)
    return () => pozorovatel.disconnect()
  }, [])

  const n = sloty.length
  if (n === 0) return null

  const nejdelsi = Math.max(...popiskyDilku.map((p) => p.length))
  const vlevo = Math.round(nejdelsi * 6.8) + 12
  const vpravo = 6
  const plocha = Math.max(1, sirka - vlevo - vpravo)
  const pas = plocha / n
  const sirkaSloupce = Math.max(2, Math.min(24, pas * 0.62))
  const vyska = NAHORE + VYSKA_PLOCHY + DOLE
  const dno = NAHORE + VYSKA_PLOCHY
  const horni = Math.max(1, dilky[dilky.length - 1] ?? 1)
  const y = (haleru: number) => dno - (Math.max(0, haleru) / horni) * VYSKA_PLOCHY
  const stred = (i: number) => vlevo + pas * (i + 0.5)

  // Čára srovnání: úseky jen mezi sousedy s daty — slot bez dat ji přeruší.
  let cesta = ''
  let navazuje = false
  sloty.forEach((s, i) => {
    if (s.srovnani === null) { navazuje = false; return }
    cesta += `${navazuje ? 'L' : 'M'}${stred(i).toFixed(1)} ${y(s.srovnani).toFixed(1)}`
    navazuje = true
  })
  const samotny = (i: number) => (sloty[i - 1]?.srovnani ?? null) === null && (sloty[i + 1]?.srovnani ?? null) === null
  const bodyVzdy = pas >= 16

  // Popisky vodorovné osy: slovem, kde je místo; jinak čísla a jen každé k-té.
  const slovem = pas >= 34
  const krok = pas >= 22 ? 1 : ([2, 5, 7, 10].find((k) => k * pas >= 22) ?? 10)

  const vyberZUdalosti = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0) return
    const x = ((e.clientX - r.left) / r.width) * sirka
    const i = Math.floor((x - vlevo) / pas)
    setZKlavesnice(false)
    setAktivni(i >= 0 && i < n ? i : null)
  }

  const vychoziSlot = () => {
    const bezi = sloty.findIndex((s) => s.stav === 'bezi')
    if (bezi >= 0) return bezi
    const posledni = sloty.findLastIndex((s) => s.aktualni !== null)
    return posledni >= 0 ? posledni : 0
  }

  const klavesa = (e: KeyboardEvent<HTMLDivElement>) => {
    const ted = aktivni ?? vychoziSlot()
    let dalsi: number | null = null
    if (e.key === 'ArrowRight') dalsi = Math.min(n - 1, ted + 1)
    else if (e.key === 'ArrowLeft') dalsi = Math.max(0, ted - 1)
    else if (e.key === 'Home') dalsi = 0
    else if (e.key === 'End') dalsi = n - 1
    else if (e.key === 'Escape') { setAktivni(null); return }
    if (dalsi === null) return
    e.preventDefault()
    setZKlavesnice(true)
    setAktivni(dalsi)
  }

  const a = aktivni !== null ? sloty[aktivni] : null
  const xBubliny = aktivni !== null ? stred(aktivni) : 0
  const vlevoOdBodu = xBubliny + 14 + SIRKA_BUBLINY > sirka
  const leva = Math.max(0, Math.min(sirka - SIRKA_BUBLINY, vlevoOdBodu ? xBubliny - 14 - SIRKA_BUBLINY : xBubliny + 14))

  const hlaseni = a
    ? `${a.popis}: ${a.textAktualni}. ${a.popisSrovnani ?? nazevSrovnani}: ${a.textSrovnani}.${a.rozdil ? ` Rozdíl ${a.rozdil}.` : ''}${a.poznamka ? ` ${a.poznamka}.` : ''}`
    : ''

  return (
    <div className="ds-graf">
      <ul className="ds-graf-legenda">
        <li>
          <span className="ds-graf-vzorek ds-graf-vzorek-sloupec" aria-hidden="true" />
          {nazevAktualniho}
        </li>
        <li>
          <span className="ds-graf-vzorek ds-graf-vzorek-cara" aria-hidden="true" />
          {nazevSrovnani}
          {srovnaniBezDat ? <strong className="ds-graf-legenda-bez">bez dat — čára chybí</strong> : null}
        </li>
        {sloty.some((s) => s.stav === 'bezi' && s.aktualni !== null) ? (
          <li>
            <span className="ds-graf-vzorek ds-graf-vzorek-sloupec ds-graf-vzorek-bezi" aria-hidden="true" />
            ještě běží
          </li>
        ) : null}
      </ul>

      <div
        ref={obal}
        className="ds-graf-plocha"
        tabIndex={0}
        role="group"
        aria-label={popisGrafu}
        aria-describedby={idNavodu}
        onKeyDown={klavesa}
        // Jen zaměření z klávesnice (Tab) vybere výchozí sloupec. Klepnutí
        // prstem/myší zaměří taky, ale sloupec už vybral pointerdown —
        // přepsat ho výchozím by bublina skočila jinam, než se klepalo.
        onFocus={(e) => {
          if (!e.currentTarget.matches(':focus-visible')) return
          setZKlavesnice(true)
          setAktivni((a) => a ?? vychoziSlot())
        }}
        onBlur={() => { setAktivni(null); setZKlavesnice(false) }}
      >
        <span className="ds-graf-jednotka" aria-hidden="true">Kč</span>
        <svg
          viewBox={`0 0 ${sirka} ${vyska}`}
          width="100%"
          height={vyska}
          aria-hidden="true"
          onPointerMove={vyberZUdalosti}
          onPointerDown={vyberZUdalosti}
          // Prst „odjede" při každém zvednutí — bublina po klepnutí zůstane, zmizí klepnutím jinam (blur).
          onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !zKlavesnice) setAktivni(null) }}
        >
          {aktivni !== null ? (
            <rect className="ds-graf-pas" x={vlevo + pas * aktivni} y={NAHORE} width={pas} height={VYSKA_PLOCHY} rx={4} />
          ) : null}

          {dilky.map((d, i) => (
            <g key={d}>
              <line className={i === 0 ? 'ds-graf-zakladna' : 'ds-graf-mrizka'} x1={vlevo} x2={sirka - vpravo} y1={y(d)} y2={y(d)} />
              <text className="ds-graf-popisek ds-graf-popisek-y" x={vlevo - 8} y={y(d)} textAnchor="end" dominantBaseline="middle">
                {popiskyDilku[i]}
              </text>
            </g>
          ))}

          {sloty.map((s, i) => {
            if (s.aktualni === null) return null
            const vrch = Math.min(dno - (s.aktualni > 0 ? 2 : 0), y(s.aktualni))
            const d = cestaSloupce(stred(i) - sirkaSloupce / 2, vrch, sirkaSloupce, dno)
            return d ? (
              <path
                key={`s${i}`}
                d={d}
                className={`ds-graf-sloupec${s.stav === 'bezi' ? ' ds-graf-sloupec-bezi' : ''}${aktivni === i ? ' ds-graf-aktivni' : ''}`}
              />
            ) : null
          })}

          {cesta ? (
            <>
              <path d={cesta} className="ds-graf-cara-lem" />
              <path d={cesta} className="ds-graf-cara" />
            </>
          ) : null}
          {sloty.map((s, i) =>
            s.srovnani !== null && (bodyVzdy || samotny(i) || aktivni === i) ? (
              <circle key={`b${i}`} className="ds-graf-bod" cx={stred(i)} cy={y(s.srovnani)} r={aktivni === i ? 5 : 4} />
            ) : null,
          )}

          {sloty.map((s, i) =>
            i % krok === 0 ? (
              <text key={`x${i}`} className="ds-graf-popisek" x={stred(i)} y={vyska - 8} textAnchor="middle">
                {slovem ? s.osaSlovem : s.osa}
              </text>
            ) : null,
          )}
        </svg>

        {a ? (
          <div className="ds-graf-bublina" style={{ left: `${leva}px`, width: `${SIRKA_BUBLINY}px` }} aria-hidden="true">
            <div className="ds-graf-bublina-hlava">{a.popis}</div>
            <div className="ds-graf-bublina-radek">
              <span className="ds-graf-klic ds-graf-klic-sloupec" />
              <strong>{a.textAktualni}</strong>
              <span>{nazevAktualniho}</span>
            </div>
            <div className="ds-graf-bublina-radek">
              <span className="ds-graf-klic ds-graf-klic-cara" />
              <strong>{a.textSrovnani}</strong>
              <span>{a.popisSrovnani ?? nazevSrovnani}</span>
            </div>
            {a.rozdil ? (
              <div className="ds-graf-bublina-radek">
                <span className="ds-graf-klic" />
                <strong>{a.rozdil}</strong>
                <span>proti srovnání</span>
              </div>
            ) : null}
            {a.poznamka ? <div className="ds-graf-bublina-pozn">{a.poznamka}</div> : null}
          </div>
        ) : null}
      </div>

      <p className="ds-graf-osa-x" aria-hidden="true">{osaX}</p>
      <p id={idNavodu} className="ds-graf-skryte">
        Šipkami vlevo a vpravo projdete jednotlivé sloupce. Všechna čísla jsou i v tabulce srovnání pod grafem.
      </p>
      <p className="ds-graf-skryte" aria-live="polite">{zKlavesnice ? hlaseni : ''}</p>
    </div>
  )
}
