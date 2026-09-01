import type { ReactNode } from 'react'
import Link from 'next/link'

/**
 * Rám osobních obrazovek.
 *
 * Moje údaje leží MIMO `/[rozsah]/` — osobní údaje patří člověku, ne
 * provozovně (docs/odpovedi-pozvanky-2026-09-01.md, oddíl 2). Kdyby
 * zůstaly uvnitř rozsahu, nedostal by se na ně ten, komu ještě nikdo
 * nepřidělil oprávnění: žádný platný rozsah nemá.
 *
 * Rám je proto vlastní a hodně tichý. Nabídka modulů sem nepatří —
 * část lidí, kteří se sem dostanou, ještě žádný modul otevřený nemá.
 * Zůstává jen cesta zpátky; ta vede na `/`, které si rozsah dopočítá
 * samo, takže funguje i tomu, kdo zatím žádný nemá.
 */
export default function MojeUdajeLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--paper)' }}>
      <header className="ft-topbar">
        <Link href="/" className="ft-brand">
          Food<em>tab</em>
        </Link>
        <span style={{ flex: 1 }} />
        <Link href="/" className="ft-tl ft-tl-vedlejsi ft-tl-male">
          Zpět do aplikace
        </Link>
      </header>

      <main className="ft-main">{children}</main>
    </div>
  )
}
