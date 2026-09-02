'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'

/**
 * Okno „někdo čeká na oprávnění“.
 *
 * Zadání docs/upozorneni-na-prijeti-zadani.md, oddíl 3.
 *
 * ---------------------------------------------------------------------
 * PROČ TAK ÚZCE
 *
 * Ukazuje se JEN TEHDY, KDYŽ NĚKDO ČEKÁ. Když pozvánka oprávnění nesla,
 * stačí zvoneček. Okno, které se odklikává, i když není co dělat, se za
 * týden odklikává bez čtení — a pak přijde to jediné, na kterém
 * záleželo, a odklikne se taky.
 *
 * ---------------------------------------------------------------------
 * PRAVIDLA
 *
 *  * Vypíše VŠECHNY čekající, ne jednoho. Po víkendu jich může být pět.
 *  * Tlačítko vede rovnou na přidělení oprávnění tomu člověku, ne na
 *    seznam lidí. Cesta ke splnění úkolu má být jedno kliknutí.
 *  * Zavřít jde vždycky. Nic se tím nerozbije.
 *  * Jakmile lidé oprávnění mají, okno se přestane ukazovat samo —
 *    seznam se bere z dat, nic se neodškrtává.
 *
 * ---------------------------------------------------------------------
 * JEDNOU ZA PŘIHLÁŠENÍ
 *
 * Zavření si pamatuje `sessionStorage`, ne databáze. Je to údaj
 * o jednom sezení v jednom prohlížeči a nikam jinam nepatří — a hlavně
 * se tím nezavádí „přečteno“, které by se muselo udržovat. Když sezení
 * skončí, okno se při dalším přihlášení ukáže znovu, přesně jak zadání
 * chce.
 *
 * Čte se přes `useSyncExternalStore`, ne setState v efektu. Je to
 * tentýž případ jako klíč zařízení na kiosku: stav nežije v Reactu, ale
 * v prohlížeči, a dosazovat ho v efektu znamená vykreslit se dvakrát.
 * Server o `sessionStorage` neví, proto se mu odpovídá „zavřeno“ — po
 * připojení se okno objeví.
 */

const KLIC = 'foodtab-ceka-na-opravneni-zavreno'

let posluchaci: (() => void)[] = []

function odebirat(zmena: () => void) {
  posluchaci.push(zmena)
  return () => {
    posluchaci = posluchaci.filter((p) => p !== zmena)
  }
}

function zavrenoKlient(): boolean {
  try {
    return window.sessionStorage.getItem(KLIC) === '1'
  } catch {
    // Prohlížeč s vypnutým úložištěm okno ukáže pokaždé. Lepší než
    // ho neukázat vůbec — je to úkol, ne ozdoba.
    return false
  }
}

function zavrenoServer(): boolean {
  return true
}

export default function CekaNaOpravneni({
  rozsah,
  lide,
}: {
  rozsah: string
  lide: { user_id: string; jmeno: string }[]
}) {
  const zavreno = useSyncExternalStore(odebirat, zavrenoKlient, zavrenoServer)

  if (zavreno || lide.length === 0) return null

  function zavrit() {
    try {
      window.sessionStorage.setItem(KLIC, '1')
    } catch {
      /* Nevadí. Okno se pak ukáže znovu. */
    }
    for (const p of posluchaci) p()
  }

  return (
    <div style={zaclona} role="dialog" aria-modal="true" aria-labelledby="ceka-nadpis">
      <div style={okno}>
        <h2 id="ceka-nadpis" style={nadpis}>
          {lide.length === 1
            ? 'Jeden člověk čeká na oprávnění'
            : `${lide.length} ${lide.length <= 4 ? 'lidé čekají' : 'lidí čeká'} na oprávnění`}
        </h2>

        <p style={popis}>
          Přijali pozvánku a jsou ve firmě. Dokud jim oprávnění
          nepřidělíte, v aplikaci neuvidí nic než své údaje.
        </p>

        <ul style={seznam}>
          {lide.map((c) => (
            <li key={c.user_id} style={radek}>
              <span style={{ fontSize: '15px' }}>{c.jmeno}</span>
              <Link
                href={`/${rozsah}/nastaveni/lide?clovek=${encodeURIComponent(c.user_id)}`}
                className="ft-tl ft-tl-hlavni ft-tl-male"
                onClick={zavrit}
              >
                Přidělit oprávnění
              </Link>
            </li>
          ))}
        </ul>

        <div style={{ marginTop: '16px', textAlign: 'right' }}>
          <button type="button" onClick={zavrit} className="ft-tl ft-tl-vedlejsi">
            Teď ne
          </button>
        </div>
      </div>
    </div>
  )
}

const zaclona = {
  position: 'fixed' as const,
  inset: 0,
  zIndex: 60,
  background: 'rgba(0,0,0,.45)',
  display: 'grid',
  placeItems: 'center',
  padding: '20px',
}

const okno = {
  width: '100%',
  maxWidth: '520px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '20px',
}

const nadpis = { margin: '0 0 8px', fontSize: '18px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 14px',
  fontSize: '13.5px',
  color: 'var(--muted)',
  lineHeight: 1.5,
  maxWidth: '52ch',
} as const

const seznam = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '8px',
} as const

const radek = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap' as const,
  padding: '10px 0',
  borderTop: '1px solid var(--line)',
}
