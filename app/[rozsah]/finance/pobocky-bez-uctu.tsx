import Link from 'next/link'

import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import {
  KDO_SPRAVUJE_UCTY,
  KOTVA_UCTU,
  vetaPobockyBezUctu,
  vetaUctuMimoPobocekFirmy,
  type PobockyBezUctu as Vysledek,
  type UctyMimoPobocek,
} from '@/lib/finance-ucty-pobocek'

/**
 * Pohled Celá firma: které aktivní pobočky nemají aktivní platební účet
 * a že jejich platby proto nejsou v součtech po pobočkách (Finance Fáze 0,
 * krok 3, bod 1). Jedna definice pro Přehled, Platby, Platby bez faktury,
 * Cashflow i Rozpočty — databázová funkce pobocky_bez_aktivniho_uctu
 * (lib/finance-ucty-pobocek.ts).
 *
 * `mimoPobocky` (Přehled, Cashflow, Rozpočty): účty, které patří vypnuté
 * nebo smazané pobočce — jejich platby nejsou v součtech po pobočkách ani
 * ve firemních účtech. Na Platbách to stránka říká u každého účtu sama.
 *
 * Odkaz na místo, kde se účet přiřazuje (Platby celé firmy → Platební
 * účty), dostane jen ten, kdo to smí (`smiPrirazovat` = finance.manage za
 * celou firmu); ostatním se řekne, kdo to udělá.
 *
 * Když se nepodařilo zjistit, kdo účet nemá, řekne to — mlčení by
 * znamenalo „všechny pobočky mají účet".
 */
export default function PobockyBezUctu({
  vysledek,
  smiPrirazovat,
  naPlatbach = false,
  mimoPobocky = null,
}: {
  vysledek: Vysledek
  smiPrirazovat: boolean
  /** Na stránce Plateb celé firmy stačí kotva — sekce účtů je o kus níž. */
  naPlatbach?: boolean
  mimoPobocky?: UctyMimoPobocek | null
}) {
  const chyby: string[] = []
  const vety: string[] = []
  if (vysledek.stav === 'chyba') chyby.push(vysledek.text)
  else {
    const veta = vetaPobockyBezUctu(vysledek.pobocky)
    if (veta) vety.push(veta)
  }
  if (mimoPobocky?.stav === 'chyba') chyby.push(mimoPobocky.text)
  else if (mimoPobocky?.stav === 'ok') {
    const veta = vetaUctuMimoPobocekFirmy(mimoPobocky.ucty)
    if (veta) vety.push(veta)
  }
  if (chyby.length === 0 && vety.length === 0) return null

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {chyby.map((t) => (
        <p key={t} role="status" style={{ margin: 0, fontSize: '13px', color: 'var(--pozor)' }}>{t}</p>
      ))}
      {vety.length > 0 ? (
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
          {vety.map((t) => <p key={t} style={{ margin: 0, fontSize: '13.5px' }}>{t}</p>)}
          {smiPrirazovat ? (
            <div>
              <Link
                href={naPlatbach ? `#${KOTVA_UCTU}` : `/${TENANT_SCOPE_SEGMENT}/finance/platby#${KOTVA_UCTU}`}
                className="ft-tl ft-tl-male"
              >
                Upravit platební účty →
              </Link>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--muted)' }}>
              Pobočku účtu přiřadí nebo opraví {KDO_SPRAVUJE_UCTY}.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
