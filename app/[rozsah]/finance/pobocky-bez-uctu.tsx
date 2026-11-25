import Link from 'next/link'

import { TENANT_SCOPE_SEGMENT } from '@/lib/authz'
import {
  KDO_SPRAVUJE_UCTY,
  KOTVA_UCTU,
  ODKAZ_VLASTNI_UCET,
  rozhodnoutBezUctuFirmy,
  vetaPobockyBezUctu,
  vetaPobockyPresFiremniUcet,
  vetaUctuMimoPobocekFirmy,
  type FiremniUcet,
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
 * SPOLEČNÝ FIREMNÍ ÚČET (dodatek 3d, rozhodnutí Šéfíka 25. 11. 2026):
 * firma, která má aktivní firemní účet bez pobočky (`firemni`,
 * public.firma_ma_firemni_ucet), přes něj platí — pobočka bez vlastního
 * účtu tu je normální stav. Místo varování pak klidné vysvětlení
 * (`rozhodnoutBezUctuFirmy`) a odkaz na přiřazení účtu jen jako
 * nenápadná možnost pro toho, kdo smí. Varování zůstává beze změny, když
 * firma žádný aktivní účet bez pobočky nemá. Nepodařilo-li se zjistit,
 * jestli ho má, zůstane varování a k němu věta o chybě — chyba není „ne".
 *
 * `mimoPobocky` (Přehled, Cashflow, Rozpočty): účty, které patří vypnuté
 * nebo smazané pobočce — jejich platby nejsou v součtech po pobočkách ani
 * ve firemních účtech. Na Platbách to stránka říká u každého účtu sama.
 * To je varování vždycky, i u firmy s firemním účtem.
 *
 * Odkaz na místo, kde se účet přiřazuje (Platby celé firmy → Platební
 * účty), dostane jen ten, kdo to smí (`smiPrirazovat` = finance.manage za
 * celou firmu); ostatním se u varování řekne, kdo to udělá.
 *
 * Když se nepodařilo zjistit, kdo účet nemá, řekne to — mlčení by
 * znamenalo „všechny pobočky mají účet".
 */
export default function PobockyBezUctu({
  vysledek,
  firemni,
  smiPrirazovat,
  naPlatbach = false,
  mimoPobocky = null,
}: {
  vysledek: Vysledek
  /** Má firma aktivní firemní účet (nactiFiremniUcet)? */
  firemni: FiremniUcet
  smiPrirazovat: boolean
  /** Na stránce Plateb celé firmy stačí kotva — sekce účtů je o kus níž. */
  naPlatbach?: boolean
  mimoPobocky?: UctyMimoPobocek | null
}) {
  const stav = rozhodnoutBezUctuFirmy(vysledek, firemni)
  const chyby: string[] = []
  const vety: string[] = []
  let vysvetleni: string | null = null
  if (stav.druh === 'chyba') chyby.push(stav.text)
  else if (stav.druh === 'nevime') {
    chyby.push(stav.text)
    const veta = vetaPobockyBezUctu(stav.pobocky)
    if (veta) vety.push(veta)
  } else if (stav.druh === 'varovani') {
    const veta = vetaPobockyBezUctu(stav.pobocky)
    if (veta) vety.push(veta)
  } else if (stav.druh === 'vysvetleni') {
    vysvetleni = vetaPobockyPresFiremniUcet(stav.pobocky)
  }
  if (mimoPobocky?.stav === 'chyba') chyby.push(mimoPobocky.text)
  else if (mimoPobocky?.stav === 'ok') {
    const veta = vetaUctuMimoPobocekFirmy(mimoPobocky.ucty)
    if (veta) vety.push(veta)
  }
  if (chyby.length === 0 && vety.length === 0 && !vysvetleni) return null

  const odkazNaUcty = naPlatbach ? `#${KOTVA_UCTU}` : `/${TENANT_SCOPE_SEGMENT}/finance/platby#${KOTVA_UCTU}`

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
              <Link href={odkazNaUcty} className="ft-tl ft-tl-male">
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
      {/* Firma platí přes firemní účet: jen klidná věta, žádná karta ani výzva (dodatek 3d). */}
      {vysvetleni ? (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          {vysvetleni}
          {smiPrirazovat ? (
            <>
              {' '}
              <Link href={odkazNaUcty} style={{ color: 'inherit', textDecoration: 'underline' }}>{ODKAZ_VLASTNI_UCET}</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
