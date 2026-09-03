'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ulozitSmenu, type StavSmeny } from './smena'

export type SmenaKUprave = {
  id: string
  branch_id: string
  employee_id: string | null
  position_id: string | null
  shift_date: string
  starts_at: string
  ends_at: string
  note: string
}

/**
 * Formulář na směnu — zakládání i úprava.
 *
 * Zadání docs/nocni-prace-2026-09-03.md, bod 2.
 *
 * ---------------------------------------------------------------------
 * NA TELEFONU CELÁ OBRAZOVKA
 *
 * Kalendář je hustý a bublina, do které se nedá trefit, je horší než
 * žádná. Pod 640 px se okno roztáhne přes celou plochu; nad ní je to
 * karta uprostřed.
 *
 * ---------------------------------------------------------------------
 * VAROVÁNÍ SE UKÁŽÍ PO ULOŽENÍ, NE MÍSTO NĚJ
 *
 * Překryv a začátek před provozním dnem směnu nezakazují. Okno proto
 * po uložení nezmizí hned — nejdřív řekne, co se stalo, a zavře se až
 * kliknutím. Kdyby zmizelo, varování by nikdo nepřečetl.
 */
export default function FormularSmeny({
  rozsah,
  den,
  smena,
  pobocky,
  vychoziPobocka,
  lide,
  pozice,
  onZavrit,
}: {
  rozsah: string
  /** Předvyplněné datum u nové směny. */
  den: string
  /** Když se upravuje. */
  smena?: SmenaKUprave | null
  pobocky: { id: string; nazev: string }[]
  vychoziPobocka: string | null
  lide: { id: string; jmeno: string }[]
  pozice: { id: string; label: string }[]
  onZavrit: () => void
}) {
  const router = useRouter()
  const [stav, akce, ceka] = useActionState<StavSmeny, FormData>(ulozitSmenu, {
    stav: 'nic',
  })
  const [zavreno, setZavreno] = useState(false)
  const prvni = useRef<HTMLSelectElement>(null)

  // Po uložení se rozpis překreslí hned; okno zůstane kvůli varováním.
  useEffect(() => {
    if (stav.stav === 'hotovo') router.refresh()
  }, [stav, router])

  useEffect(() => {
    prvni.current?.focus()
  }, [])

  function zavrit() {
    setZavreno(true)
    onZavrit()
  }

  if (zavreno) return null

  const hotovo = stav.stav === 'hotovo'

  return (
    <div style={zaclona} role="dialog" aria-modal="true" aria-labelledby="smena-nadpis">
      <div style={okno}>
        <h2 id="smena-nadpis" style={nadpis}>
          {smena ? 'Upravit směnu' : 'Nová směna'}
        </h2>

        {hotovo ? (
          <>
            <p style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--dobre)' }}>
              {smena ? 'Změna uložena.' : 'Směna přidána do rozpisu.'}
            </p>

            {/*
              Varování až tady, u výsledku. Kdyby se ukazovala předem,
              člověk by je odklikl dřív, než by měl co odklikávat.
            */}
            {stav.varovani.length > 0 ? (
              <ul style={varovaniSeznam}>
                {stav.varovani.map((v, i) => (
                  <li key={i} style={varovaniRadek}>
                    {v}
                  </li>
                ))}
              </ul>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={zavrit} className="ft-tl ft-tl-hlavni">
                Hotovo
              </button>
            </div>
          </>
        ) : (
          <form action={akce} style={{ display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            {smena ? <input type="hidden" name="smena" value={smena.id} /> : null}

            <label style={poleLabel}>
              <span>Kdo</span>
              <select
                ref={prvni}
                name="zamestnanec"
                defaultValue={smena?.employee_id ?? ''}
                style={pole}
              >
                {/*
                  Prázdné je platná volba, ne chybějící údaj: neobsazená
                  směna znamená „sem někoho potřebujeme“.
                */}
                <option value="">— zatím nikdo (volná směna) —</option>
                {lide.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.jmeno}
                  </option>
                ))}
              </select>
            </label>

            <label style={poleLabel}>
              <span>Pozice</span>
              <select name="pozice" defaultValue={smena?.position_id ?? ''} style={pole}>
                <option value="">— bez pozice —</option>
                {pozice.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {pozice.length === 0 ? (
                <span style={vysvetlivka}>
                  Firma zatím žádnou pozici nemá. Založí se v Nastavení →
                  Pozice; směna jde uložit i bez ní.
                </span>
              ) : null}
            </label>

            <label style={poleLabel}>
              <span>Kde</span>
              <select
                name="pobocka"
                required
                defaultValue={smena?.branch_id ?? vychoziPobocka ?? ''}
                style={pole}
              >
                {pobocky.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nazev}
                  </option>
                ))}
              </select>
            </label>

            <label style={poleLabel}>
              <span>Datum</span>
              <input
                name="den"
                type="date"
                required
                defaultValue={smena?.shift_date ?? den}
                style={pole}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={poleLabel}>
                <span>Od</span>
                <input
                  name="od"
                  type="time"
                  required
                  defaultValue={(smena?.starts_at ?? '08:00').slice(0, 5)}
                  style={pole}
                />
              </label>
              <label style={poleLabel}>
                <span>Do</span>
                <input
                  name="do"
                  type="time"
                  required
                  defaultValue={(smena?.ends_at ?? '16:00').slice(0, 5)}
                  style={pole}
                />
              </label>
            </div>

            <p style={vysvetlivka}>
              Konec dřív než začátek znamená, že směna končí druhý den —
              22:00–06:00 je osm hodin, ne mínus šestnáct.
            </p>

            <label style={poleLabel}>
              <span>Poznámka</span>
              <input
                name="poznamka"
                maxLength={200}
                defaultValue={smena?.note ?? ''}
                placeholder="nepovinná"
                style={pole}
              />
            </label>

            {stav.stav === 'chyba' ? (
              <p className="hlaska-chyba">{stav.text}</p>
            ) : null}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={zavrit} className="ft-tl ft-tl-vedlejsi">
                Zpět
              </button>
              <button type="submit" className="ft-tl ft-tl-hlavni" disabled={ceka}>
                {ceka ? 'Ukládám…' : smena ? 'Uložit změnu' : 'Přidat směnu'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/* --- styly ---------------------------------------------------------- */

const zaclona = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 70,
  background: 'rgba(0,0,0,.45)',
  display: 'grid',
  placeItems: 'center',
  padding: '0',
}

/*
  Na telefonu celá obrazovka, na širším okně karta uprostřed. Řeší se
  to jednotkami, ne dotazem na šířku: `min(560px, 100vw)` a
  `min(100dvh, …)` udělají totéž bez druhé sady stylů.
*/
const okno = {
  width: 'min(560px, 100vw)',
  maxHeight: '100dvh',
  overflowY: 'auto' as const,
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'clamp(0px, calc((100vw - 560px) * 100), 16px)',
  boxShadow: 'var(--shadow)',
  padding: '20px',
}

const nadpis = { margin: '0 0 14px', fontSize: '18px', color: 'var(--ink)' } as const

const poleLabel = {
  display: 'grid',
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.06em',
} as const

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: '10px',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
} as const

const vysvetlivka = {
  margin: 0,
  fontSize: '12.5px',
  color: 'var(--muted)',
  lineHeight: 1.45,
  textTransform: 'none' as const,
  letterSpacing: 'normal',
} as const

const varovaniSeznam = {
  listStyle: 'none',
  margin: '0 0 14px',
  padding: 0,
  display: 'grid',
  gap: '8px',
} as const

const varovaniRadek = {
  padding: '10px 12px',
  border: '1px solid var(--pozor)',
  borderRadius: '10px',
  background: 'var(--pozor-bg)',
  color: 'var(--pozor)',
  fontSize: '13.5px',
  lineHeight: 1.5,
} as const
