import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'

export const dynamic = 'force-dynamic'

/**
 * „Přihlášeno. Naskenujte kód znovu.“
 *
 * Zadání: docs/qr-na-kiosku-zadani.md, oddíl 4, druhý případ.
 *
 * Kdo naskenoval QR a nebyl přihlášený, přistane na přihlášení,
 * přihlásí se — a než to doklikne, kód je dávno mrtvý. Nemá smysl ho
 * posílat na Docházku, aby si tam sáhl na kód, který už neplatí,
 * a dozvěděl se to až z chybové hlášky.
 *
 * Je to JINÁ SITUACE než vypršelý kód při ťuknutí a má jiné řešení,
 * proto vlastní obrazovka a vlastní věta. Schovat to za obecnou hlášku
 * o vypršení by znamenalo poslat člověka hledat chybu tam, kde žádná
 * není.
 */
export default async function PrihlasenoZQr() {
  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  return (
    <main style={obal}>
      <div style={karta}>
        <h1 style={nadpis}>Přihlášeno</h1>
        <p style={popis}>
          <strong>Naskenujte kód na tabletu znovu</strong> — ten
          předchozí už mezitím vypršel. Kódy platí necelou minutu,
          takže se to při přihlašování stane skoro vždycky.
        </p>
        <p style={{ ...popis, fontSize: '13px' }}>
          Příště už půjde naskenovat rovnou: přihlášení drží i po
          zavření prohlížeče.
        </p>
        <Link href="/" className="ft-tl ft-tl-vedlejsi" style={tlacitko}>
          Do aplikace
        </Link>
      </div>
    </main>
  )
}

const obal = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  padding: '24px',
  background: 'var(--paper)',
} as const

const karta = {
  width: '100%',
  maxWidth: '420px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '28px',
} as const

const nadpis = { margin: '0 0 10px', fontSize: '22px', color: 'var(--ink)' } as const

const popis = {
  margin: '0 0 16px',
  fontSize: '14.5px',
  color: 'var(--muted)',
  lineHeight: 1.55,
} as const

const tlacitko = { width: '100%', minHeight: '48px' } as const
