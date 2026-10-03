'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import Odhlaseni from '@/components/shell/Odhlaseni'
import { aktivniKlic, sestavNavigaci, type FinanceIkona, type PolozkaNavigace } from '@/lib/finance-navigace'

/** Mřížka 24×24, stejný vzor jako finance/faktury/navigace.tsx. */
const TVARY: Record<FinanceIkona, ReactNode> = {
  prehled: (
    <>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M2 20h20" />
    </>
  ),
  kontakty: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6" />
      <path d="M16 8.3c1.4.3 2.4 1.5 2.4 3 0 1.3-.8 2.4-1.9 2.9" />
      <path d="M17.5 14.4c1.9.6 3.3 2.4 3.3 5.6" />
    </>
  ),
  platby: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 14.5h4" />
    </>
  ),
  integrace: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M3 12h2.5M18.5 12H21M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  faktury: (
    <>
      <path d="M7 3h10l3 3v15H4V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  cashflow: (
    <>
      <path d="M3 17l5-5 4 4 8-8" />
      <path d="M15 8h5v5" />
    </>
  ),
  nakup: (
    <>
      <path d="M4 7h16l-1.5 11a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8L4 7z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
    </>
  ),
  zakazky: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </>
  ),
  rozpocty: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  vybaveni: (
    <>
      <rect x="4" y="3" width="16" height="12" rx="1.5" />
      <path d="M8 21h8M12 15v6" />
    </>
  ),
}

function Ikona({ klic }: { klic: FinanceIkona }) {
  return (
    <svg className="ft-i" viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 2 }}>
      {TVARY[klic]}
    </svg>
  )
}

/**
 * Chrome modulu Finance — vykresluje si ji KAŽDÁ z obrazovek Přehled/
 * Kontakty/Platby/Integrace sama (ne společný layout). Důvod je ve
 * finance/layout.tsx: Faktury mají vlastní vnořený `modul-ram` a dva
 * by se vnořily do sebe.
 */
export default function Navigace({ rozsah, children }: { rozsah: string; children: ReactNode }) {
  const { hlavni, mobil } = sestavNavigaci(rozsah)
  const aktivni = aktivniKlic(usePathname() ?? '', hlavni)

  const odkaz = (p: PolozkaNavigace, kratce: boolean) => {
    const on = p.klic === aktivni
    return (
      <Link
        key={p.klic}
        href={p.href}
        className={on ? 'on' : undefined}
        aria-current={on ? 'page' : undefined}
        title={kratce ? undefined : p.nazev}
      >
        <Ikona klic={p.ikona} />
        <span className="stitek">{kratce ? p.kratky : p.nazev}</span>
      </Link>
    )
  }

  return (
    <div className="modul-ram">
      <div className="modul-sloupec">
        <nav className="modul-sloupec-nav" aria-label="Finance">
          <div className="modul-skupina">Finance</div>
          {hlavni.map((p) => odkaz(p, false))}
        </nav>
        <div className="ft-side-pata">
          <Odhlaseni varianta="sloupec" />
        </div>
      </div>

      <div className="modul-obsah">
        <div className="modul-obsah-vnitrek">{children}</div>
      </div>

      <nav className="modul-spodni" aria-label="Finance">
        {mobil.map((p) => odkaz(p, true))}
      </nav>
    </div>
  )
}
