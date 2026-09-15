'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  aktivniKlic,
  type MarketingIkona,
  type PolozkaNavigace,
} from '@/lib/marketing-navigace'

/** Tvary z původní aplikace (mřížka 24×24). */
const TVARY: Record<MarketingIkona, ReactNode> = {
  prehled: (
    <>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  tvorba: <path d="M12 5v14M5 12h14" />,
  media: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 15l5-5 4 4 3-3 6 6" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h10" />,
  sablony: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </>
  ),
  kalendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  schvaleni: <path d="M5 12l4 4L19 6" />,
  kampane: (
    <>
      <path d="M4 14v-4l12-5v14L4 14z" />
      <path d="M8 14v5" />
    </>
  ),
  publikace: <path d="M4 12l16-8-6 16-2-7-8-1z" />,
  analytika: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  integrace: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  brand: <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6L7.1 18.2l.9-5.5-4-3.9L9.5 8z" />,
  tym: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 20c0-2.5 1.5-4.5 4-4.5" />
    </>
  ),
}

function Ikona({ klic }: { klic: MarketingIkona }) {
  // .ft-i má tloušťku pro mřížku 20×20; na 24×24 by čára vyšla tenčí.
  return (
    <svg className="ft-i" viewBox="0 0 24 24" aria-hidden="true" style={{ strokeWidth: 2 }}>
      {TVARY[klic]}
    </svg>
  )
}

export default function Navigace({
  hlavni,
  nastaveni,
  spodni,
  children,
}: {
  hlavni: PolozkaNavigace[]
  nastaveni: PolozkaNavigace[]
  spodni: PolozkaNavigace[]
  children: ReactNode
}) {
  const aktivni = aktivniKlic(usePathname() ?? '', [...hlavni, ...nastaveni])

  const odkaz = (p: PolozkaNavigace, kratce: boolean) => {
    const on = p.klic === aktivni
    return (
      <Link
        key={p.klic}
        href={p.href}
        className={on ? 'on' : undefined}
        aria-current={on ? 'page' : undefined}
        aria-label={p.cislo > 0 ? `${p.nazev}, čeká ${p.cislo}` : undefined}
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
      <nav className="modul-sloupec" aria-label="Marketing">
        <div className="modul-skupina">Provozovna</div>
        {hlavni.map((p) => odkaz(p, false))}
        {nastaveni.length > 0 ? <div className="modul-skupina">Nastavení</div> : null}
        {nastaveni.map((p) => odkaz(p, false))}
      </nav>

      <div className="modul-obsah">
        <div className="modul-obsah-vnitrek">{children}</div>
      </div>

      <nav className="modul-spodni" aria-label="Marketing">
        {spodni.map((p) => odkaz(p, true))}
      </nav>
    </div>
  )
}
