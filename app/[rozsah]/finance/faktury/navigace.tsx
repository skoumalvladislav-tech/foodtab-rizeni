'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  aktivniKlic,
  type FakturyIkona,
  type PolozkaNavigace,
} from '@/lib/faktury-navigace'

/** Tvary z původní appky (faktury-app, Shell.tsx), mřížka 24×24. */
const TVARY: Record<FakturyIkona, ReactNode> = {
  prehled: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  seznam: (
    <>
      <path d="M7 3h10l3 3v15H4V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  dodavatele: (
    <>
      <path d="M3 21V7l6-4 6 4v14" />
      <path d="M9 21V11h6v10" />
      <path d="M15 21V9l6-2v14" />
    </>
  ),
  schvaleni: (
    <>
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  prehledy: (
    <>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M2 20h20" />
    </>
  ),
  kalendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  upominky: (
    <>
      <path d="M12 8v5" />
      <circle cx="12" cy="16.5" r="0.6" />
      <path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </>
  ),
  nova: <path d="M12 5v14M5 12h14" />,
}

function Ikona({ klic }: { klic: FakturyIkona }) {
  return (
    <svg className="ft-i" viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 2 }}>
      {TVARY[klic]}
    </svg>
  )
}

export default function Navigace({
  hlavni,
  mobil,
  children,
}: {
  hlavni: PolozkaNavigace[]
  mobil: PolozkaNavigace[]
  children: ReactNode
}) {
  const aktivni = aktivniKlic(usePathname() ?? '', hlavni)

  const odkaz = (p: PolozkaNavigace, kratce: boolean) => {
    if (!p.hotovo) {
      return (
        <span key={p.klic} className="polozka soon" title={`${p.nazev} — připravujeme`}>
          <Ikona klic={p.ikona} />
          <span className="stitek">{kratce ? p.kratky : p.nazev}</span>
          <small>brzy</small>
        </span>
      )
    }

    const on = p.klic === aktivni
    return (
      <Link
        key={p.klic}
        href={p.href}
        className={on ? 'on' : undefined}
        aria-current={on ? 'page' : undefined}
        aria-label={p.cislo > 0 ? `${p.nazev}, ${p.cislo}` : undefined}
        title={kratce ? undefined : p.nazev}
      >
        <Ikona klic={p.ikona} />
        <span className="stitek">{kratce ? p.kratky : p.nazev}</span>
        {p.cislo > 0 ? (
          <span className="modul-cislo" aria-hidden="true">
            {p.cislo > 99 ? '99+' : p.cislo}
          </span>
        ) : null}
      </Link>
    )
  }

  return (
    <div className="modul-ram">
      <nav className="modul-sloupec" aria-label="Faktury">
        <div className="modul-skupina">Faktury</div>
        {hlavni.map((p) => odkaz(p, false))}
      </nav>

      <div className="modul-obsah">
        <div className="modul-obsah-vnitrek">{children}</div>
      </div>

      <nav className="modul-spodni" aria-label="Faktury">
        {mobil.map((p) => odkaz(p, true))}
      </nav>
    </div>
  )
}
