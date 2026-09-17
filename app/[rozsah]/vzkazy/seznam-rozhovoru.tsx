import Link from 'next/link'

import { datumACasVPasmu, ZONA_VYCHOZI } from '@/lib/cas'
import Ikona from '../ikona'
import type { IkonaKlic } from '../nabidka'

const ZONA = ZONA_VYCHOZI

/** Ikona avataru podle druhu rozhovoru — jen vzhledová zkratka, žádné právo se z ní neodvozuje. */
const IKONA_DRUHU: Record<Rozhovor['druh'], IkonaKlic> = {
  osobni: 'clovek',
  pobocka: 'zprava',
  mezi_pobockami: 'zprava',
  vedeni: 'praporek',
  usek: 'kolo',
}

export type Rozhovor = {
  konverzace_id: string
  druh: 'osobni' | 'pobocka' | 'mezi_pobockami' | 'vedeni' | 'usek'
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
  usek: 'Úsek',
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
  posledniText,
}: {
  rozsah: string
  rozhovory: Rozhovor[]
  nazvyPobocek: Map<string, string>
  aktivniId?: string
  /** Poslední zpráva rozhovoru, zkrácená — pro náhled v seznamu (oddíl 8). */
  posledniText?: Map<string, string>
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
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
      {rozhovory.map((r) => {
        const nazev =
          r.nazev ??
          (r.branch_id
            ? (nazvyPobocek.get(r.branch_id) ?? 'jiná pobočka')
            : NAZVY_DRUHU[r.druh])
        const aktivni = r.konverzace_id === aktivniId
        const nalehave = r.druh === 'vedeni'
        const nahled = posledniText?.get(r.konverzace_id)

        return (
          <li key={r.konverzace_id}>
            <Link
              href={`/${rozsah}/vzkazy/${r.konverzace_id}`}
              aria-current={aktivni ? 'page' : undefined}
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
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
                padding: '10px 12px',
                opacity: r.neprectenych > 0 || aktivni ? 1 : 0.78,
                boxShadow: r.neprectenych > 0 ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: 'none', width: '30px', height: '30px', borderRadius: '50%',
                  background: nalehave ? 'var(--pozor-bg)' : 'var(--sunken)',
                  color: nalehave ? 'var(--pozor)' : 'var(--muted)',
                  display: 'grid', placeItems: 'center',
                }}
              >
                <Ikona klic={IKONA_DRUHU[r.druh]} />
              </span>

              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <span
                    style={{
                      fontSize: '14.5px',
                      fontWeight: r.neprectenych > 0 || aktivni ? 600 : 400,
                      color: 'var(--ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {nazev}
                  </span>
                  {r.posledni_kdy ? (
                    <span style={{ flex: 'none', fontSize: '11px', color: 'var(--muted)' }}>
                      {datumACasVPasmu(r.posledni_kdy, ZONA)}
                    </span>
                  ) : null}
                </span>

                <span style={{ display: 'block', margin: '2px 0 0', fontSize: '11.5px', color: 'var(--muted)' }}>
                  {[
                    NAZVY_DRUHU[r.druh],
                    r.branch_id ? (nazvyPobocek.get(r.branch_id) ?? 'jiná pobočka') : null,
                    r.adresat === 'majitel' ? 'jen majitelům' : null,
                    r.uzavreno_kdy ? 'uzavřeno' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>

                {nahled ? (
                  <span
                    style={{
                      display: 'block', margin: '4px 0 0', fontSize: '12.5px', color: 'var(--muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {nahled}
                  </span>
                ) : null}

                {r.neprectenych > 0 ? (
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: '5px',
                      fontSize: '11.5px',
                      fontWeight: 600,
                      color: r.ceka > 0 ? 'var(--pozor)' : 'var(--mosaz)',
                    }}
                  >
                    {r.ceka > 0
                      ? `${r.ceka} z ${r.neprectenych} čeká na píchnutí`
                      : `${r.neprectenych} nepřečtené`}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
