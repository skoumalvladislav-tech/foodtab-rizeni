import type { KrokPruvodce, StavKroku } from '@/lib/jine-platby-stav'

import Ikona from '../../../../ikona'
import type { IkonaKlic } from '../../../../nabidka'

/**
 * Ukazatel devíti kroků průvodce (`krokyPruvodce`, lib/jine-platby-stav.ts).
 *
 * Každý krok se vyhodnocuje ze SVÉHO stavu — aktuálních může být víc
 * najednou (tržba a sklad jdou nezávisle). `aria-current="step"` nese
 * první aktuální krok (vzor app/[rozsah]/nastaveni/nahrani/rozpis/pruvodce.tsx);
 * stav každého kroku je napsaný i slovem — barva ani ikona nenesou význam
 * samy.
 */

const POPIS: Record<StavKroku, { text: string; ikona: IkonaKlic }> = {
  hotovo: { text: 'Hotovo', ikona: 'fajfkaKruh' },
  aktualni: { text: 'Teď', ikona: 'sipkaVpravo' },
  ceka: { text: 'Čeká', ikona: 'hodiny' },
  blokovano: { text: 'Blokováno', ikona: 'varovani' },
  nepotrebny: { text: 'Netýká se', ikona: 'tecky' },
}

export default function Kroky({ kroky }: { kroky: KrokPruvodce[] }) {
  const prvniAktualni = kroky.find((k) => k.stav === 'aktualni')?.cislo ?? null
  return (
    <nav aria-label="Průvodce záznamem" className="ds-plocha" style={{ padding: '14px 16px' }}>
      <ol
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: '8px',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))',
        }}
      >
        {kroky.map((k) => {
          const p = POPIS[k.stav]
          const aktualni = k.stav === 'aktualni'
          return (
            <li
              key={k.cislo}
              aria-current={k.cislo === prvniAktualni ? 'step' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                gap: '2px 8px',
                alignItems: 'start',
                padding: '8px 10px',
                borderRadius: '10px',
                border: `1px solid ${aktualni ? 'var(--mosaz)' : 'var(--line)'}`,
                background: aktualni ? 'color-mix(in srgb, var(--mosaz-sv) 22%, var(--card))' : k.stav === 'hotovo' ? 'var(--card)' : 'transparent',
                color: k.stav === 'nepotrebny' || k.stav === 'ceka' ? 'var(--muted)' : 'var(--ink)',
                minWidth: 0,
              }}
            >
              <span aria-hidden="true" style={{ paddingTop: '2px' }}>
                <Ikona klic={p.ikona} velikost={16} />
              </span>
              <span style={{ fontSize: '13.5px', fontWeight: aktualni ? 700 : 600, overflowWrap: 'anywhere' }}>
                {k.cislo}. {k.nazev}
              </span>
              <span />
              <span style={{ fontSize: '12.5px', overflowWrap: 'anywhere' }}>
                <strong style={{ fontWeight: 600 }}>{p.text}</strong> — {k.popis}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
