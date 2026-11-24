import Link from 'next/link'

import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import { KOTVA_UCTU, vetaPobockyBezUctu, type PobockyBezUctu as Vysledek } from '@/lib/finance-ucty-pobocek'

/**
 * Pohled Celá firma: které aktivní pobočky nemají aktivní platební účet
 * a že jejich platby proto nejsou v součtech po pobočkách (Finance Fáze 0,
 * krok 3, bod 1). Jedna definice pro Přehled, Platby, Platby bez faktury,
 * Cashflow i Rozpočty — databázová funkce pobocky_bez_aktivniho_uctu
 * (lib/finance-ucty-pobocek.ts).
 *
 * Odkaz na místo, kde se účet přiřazuje (Platby celé firmy → Platební
 * účty), dostane jen ten, kdo to smí (`smiPrirazovat` = Správa financí za
 * celou firmu); ostatním se řekne, kdo to udělá.
 *
 * Když se nepodařilo zjistit, kdo účet nemá, řekne to — mlčení by
 * znamenalo „všechny pobočky mají účet".
 */
export default function PobockyBezUctu({
  vysledek,
  smiPrirazovat,
  naPlatbach = false,
}: {
  vysledek: Vysledek
  smiPrirazovat: boolean
  /** Na stránce Plateb celé firmy stačí kotva — sekce účtů je o kus níž. */
  naPlatbach?: boolean
}) {
  if (vysledek.stav === 'chyba') {
    return <p role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>{vysledek.text}</p>
  }
  const veta = vetaPobockyBezUctu(vysledek.pobocky)
  if (!veta) return null
  return (
    <div
      role="status"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        display: 'grid',
        gap: '8px',
      }}
    >
      <p style={{ margin: 0, fontSize: '13.5px' }}>{veta}</p>
      {smiPrirazovat ? (
        <div>
          <Link
            href={naPlatbach ? `#${KOTVA_UCTU}` : `/${TENANT_SCOPE_SEGMENT}/finance/platby#${KOTVA_UCTU}`}
            className="ft-tl ft-tl-male"
          >
            Přiřadit účet pobočce →
          </Link>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
          Účet pobočce může přiřadit ten, kdo má právo „Správa financí“ za celou firmu.
        </p>
      )}
    </div>
  )
}
