/**
 * Stavová značka faktury — přeneseno z faktury-app
 * (src/components/StatusBadge.tsx), barvy přes Foodtabovy tokeny
 * (`var(--dobre-bg)` apod. z `_tokeny.css`) místo vlastních `.badge-*`.
 */

const BARVY: Record<string, { bg: string; barva: string }> = {
  Uhrazeno: { bg: 'var(--dobre-bg)', barva: 'var(--dobre)' },
  Neuhrazeno: { bg: 'var(--bad-bg)', barva: 'var(--bad)' },
  'Částečně uhrazeno': { bg: 'var(--pozor-bg)', barva: 'var(--pozor)' },
  'Ke kontrole úhrady': { bg: 'var(--sunken)', barva: 'var(--muted)' },
  'Ke schválení': { bg: 'var(--pozor-bg)', barva: 'var(--pozor)' },
  Odmítnuto: { bg: 'var(--bad-bg)', barva: 'var(--bad)' },
}

const POPISKY: Record<string, string> = {
  'Upomínka - zkontrolovat': 'Upomínka',
}

export default function StavZnacka({ stav }: { stav: string }) {
  const vyzadujeKontrolu = stav.startsWith('Nutná ruční kontrola')
  const { bg, barva } = vyzadujeKontrolu
    ? { bg: 'var(--pozor-bg)', barva: 'var(--pozor)' }
    : BARVY[stav] ?? (stav === 'Upomínka - zkontrolovat'
      ? { bg: 'var(--pozor-bg)', barva: 'var(--pozor)' }
      : { bg: 'var(--sunken)', barva: 'var(--muted)' })
  const popisek = vyzadujeKontrolu ? 'Nutná kontrola' : POPISKY[stav] ?? stav

  return (
    <span
      title={stav}
      style={{
        display: 'inline-block',
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        background: bg,
        color: barva,
        whiteSpace: 'nowrap',
      }}
    >
      {popisek}
    </span>
  )
}
