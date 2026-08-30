import { redirect } from 'next/navigation'

import { getUser } from '@/lib/authz'
import PrijmoutPozvankuFormular from './prijeti'

export const dynamic = 'force-dynamic'

/**
 * Přijetí pozvánky.
 *
 * Pozvaný si vezme token z e-mailu a otevře si tuhle stránku.
 * Zadá heslo a je připraven v databázi.
 *
 * Teď už musí být přihlášen — token se přijímá na úrovni RLS funkce
 * app.accept_invitation, což zajistí, že token zná jen ten,
 * komu byl poslán. Nic se tu neověřuje veřejně.
 */
export default async function PrijmoutPozvankuPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  // Token existuje? Zjednoduší se Later, teď jen vrátíme formulář.
  // Validaci udělá accept_invitation sám.

  // Stránka stojí mimo rám aplikace, takže hlavní oblast musí založit
  // sama — jinak nemá odečítač na téhle adrese kam skočit.
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        background: 'var(--paper)',
      }}
    >
      <div style={{ maxWidth: '420px', width: '100%' }}>
        <h1 style={{ fontSize: '24px', letterSpacing: '-.02em', margin: '0 0 8px' }}>
          Pozvánka do firmy
        </h1>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--muted)',
            margin: '0 0 28px',
          }}
        >
          Abyste mohli pokračovat, potvrďte svou pozvánku.
        </p>

        <PrijmoutPozvankuFormular token={token} />
      </div>
    </main>
  )
}
