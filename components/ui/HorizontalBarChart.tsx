/**
 * Horizontální pruhový graf — zobecnění vzoru z
 * app/[rozsah]/finance/faktury/prehledy/page.tsx („Měsíční náklady
 * podle DUZP"): řádek = popisek + stopa s podílovou výplní + hodnota.
 *
 * Žádná závislost na `lib/`/`app/` (stejná konvence jako zbytek
 * `components/ui/`) — čísla na zobrazení chodí už zformátovaná.
 */
export type RadekPruhovehoGrafu = {
  klic: string
  popisek: string
  hodnota: number
  zformatovanaHodnota: string
  /** CSS proměnná výplně (např. 'var(--mosaz)'). Výchozí mosaz pro všechny řádky. */
  barva?: string
}

export default function HorizontalBarChart({
  radky,
  prazdno,
}: {
  radky: RadekPruhovehoGrafu[]
  prazdno?: string
}) {
  if (radky.length === 0) {
    return <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>{prazdno ?? 'Žádná data.'}</p>
  }

  const maximum = Math.max(1, ...radky.map((r) => r.hodnota))

  return (
    <ul style={{ display: 'grid', gap: '10px', margin: 0, padding: 0, listStyle: 'none' }}>
      {radky.map((r) => (
        <li key={r.klic} style={{ display: 'grid', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span>{r.popisek}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--muted)' }}>{r.zformatovanaHodnota}</span>
          </div>
          <div style={{ height: '8px', borderRadius: 'var(--radius-full)', background: 'var(--sunken)', overflow: 'hidden' }}>
            <span
              style={{
                display: 'block',
                height: '100%',
                borderRadius: 'var(--radius-full)',
                width: `${Math.max(2, (r.hodnota / maximum) * 100)}%`,
                background: r.barva ?? 'var(--mosaz)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
