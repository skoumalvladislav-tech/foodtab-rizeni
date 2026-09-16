import Link from 'next/link'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'

const ZONA = ZONA_VYCHOZI

export type Rozhovor = {
  konverzace_id: string
  druh: 'osobni' | 'pobocka' | 'mezi_pobockami' | 'vedeni'
  branch_id: string | null
  nazev: string | null
  adresat: string | null
  posledni_kdy: string | null
  neprectenych: number
  ceka: number
  uzavreno_kdy: string | null
}

export const NAZVY_DRUHU: Record<Rozhovor['druh'], string> = {
  osobni: 'Osobní',
  pobocka: 'Pobočka',
  mezi_pobockami: 'Mezi pobočkami',
  vedeni: 'Vedení',
}

/**
 * Seznam rozhovorů — sloupec vlevo v ConversationList/ChatView rozvržení
 * (master prompt, sekce 21). Sdílený mezi `/vzkazy` (kde je to jediný
 * obsah na mobilu) a `/vzkazy/[konverzace]` (kde vedle sebe stojí
 * s vybraným vláknem) — ať se karta rozhovoru nekreslí na dvou místech
 * dvěma různými styly.
 *
 * ČISTÉ SERVEROVÉ VYKRESLOVÁNÍ, ŽÁDNÝ KLIENTSKÝ STAV. Aktivní položka
 * se pozná z `aktivniId`, který obě stránky znají už z vlastní adresy
 * (`params.konverzace`) — přepínání jde přes normální odkazy, funguje
 * i bez JavaScriptu, stejně jako zbytek appky.
 */
export default function SeznamRozhovoru({
  rozsah,
  rozhovory,
  nazvyPobocek,
  aktivniId,
}: {
  rozsah: string
  rozhovory: Rozhovor[]
  nazvyPobocek: Map<string, string>
  aktivniId?: string
}) {
  if (rozhovory.length === 0) {
    return (
      <p style={{ fontSize: '13.5px', color: 'var(--muted)', padding: '4px 2px' }}>
        Kanál své pobočky otevřete tlačítkem nahoře. Osobní rozhovor
        zatím zakládá vedoucí.
      </p>
    )
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '8px' }}>
      {rozhovory.map((r) => {
        const nazev =
          r.nazev ??
          (r.branch_id
            ? (nazvyPobocek.get(r.branch_id) ?? 'jiná pobočka')
            : NAZVY_DRUHU[r.druh])
        const aktivni = r.konverzace_id === aktivniId

        return (
          <li key={r.konverzace_id}>
            <Link
              href={`/${rozsah}/vzkazy/${r.konverzace_id}`}
              aria-current={aktivni ? 'page' : undefined}
              style={{
                display: 'block',
                textDecoration: 'none',
                color: 'inherit',
                background: aktivni ? 'var(--sunken)' : 'var(--card)',
                border: '1px solid var(--line)',
                borderLeft:
                  r.neprectenych > 0
                    ? '3px solid var(--mosaz)'
                    : aktivni
                      ? '3px solid var(--line-2)'
                      : '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                opacity: r.neprectenych > 0 || aktivni ? 1 : 0.78,
                boxShadow: r.neprectenych > 0 ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--muted)' }}>
                {[
                  NAZVY_DRUHU[r.druh],
                  r.branch_id ? (nazvyPobocek.get(r.branch_id) ?? 'jiná pobočka') : null,
                  r.adresat === 'majitel' ? 'jen majitelům' : null,
                  r.uzavreno_kdy ? 'uzavřeno' : null,
                  r.posledni_kdy ? datumACasVPasmu(r.posledni_kdy, ZONA) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>

              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '15px',
                  fontWeight: r.neprectenych > 0 || aktivni ? 600 : 400,
                  color: 'var(--ink)',
                }}
              >
                {nazev}
              </p>

              {r.neprectenych > 0 ? (
                <p
                  style={{
                    margin: '6px 0 0',
                    fontSize: '12.5px',
                    color: r.ceka > 0 ? 'var(--muted)' : 'var(--mosaz)',
                  }}
                >
                  {r.ceka > 0
                    ? `${r.ceka} z ${r.neprectenych} čeká na píchnutí`
                    : `${r.neprectenych} nepřečtené`}
                </p>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
