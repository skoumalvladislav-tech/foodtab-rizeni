import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getContext, getUser } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'

export const dynamic = 'force-dynamic'

/**
 * Účet je hotový, oprávnění zatím žádné.
 *
 * Vlastní adresa mimo `/[rozsah]/` (docs/odpovedi-pozvanky-2026-09-01.md,
 * oddíl 2): tahle obrazovka se ze své podstaty ukazuje člověku, který
 * žádný rozsah nemá, takže by se na adresu s rozsahem nedostal.
 *
 * Musí to být VĚTA, ne prázdný rozcestník. Je to první, co člověk
 * z Foodtabu uvidí, a prázdná obrazovka bez vysvětlení vypadá jako
 * porucha.
 *
 * Kdo sem přijde omylem a oprávnění dávno má, se nemá kde zaseknout —
 * pošle se rovnou do aplikace.
 */
export default async function ZatimBezOpravneni() {
  const user = await getUser()
  if (!user) redirect('/prihlaseni')

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni samostatne nadpis="Účet zatím nepatří k žádné firmě">
        Přihlášení proběhlo v pořádku, ale k žádné firmě zatím nemáte
        členství. Požádejte o pozvánku někoho, kdo firmu ve Foodtabu už
        spravuje.
      </Sdeleni>
    )
  }

  const ctx = await getContext(tenantId)
  if (ctx?.role) redirect('/')

  return (
    <main style={obal}>
      <div style={karta}>
        <h1 style={nadpis}>Účet je hotový</h1>
        <p style={odstavec}>
          Přihlášení proběhlo v pořádku a do firmy{' '}
          <strong>{ctx?.tenant.name ?? 'Foodtab'}</strong> patříte. Zatím
          vám ale nikdo nepřidělil oprávnění, takže tu není co otevřít —
          ozvěte se vedoucímu.
        </p>
        <p style={odstavec}>
          Jakmile vám oprávnění přidělí, uvidíte tady rovnou svůj rozpis
          směn a docházku. Do té doby si můžete zkontrolovat, co o vás
          aplikace vede.
        </p>
        <Link href="/moje-udaje" className="ft-tl ft-tl-hlavni">
          Moje údaje
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
  maxWidth: '480px',
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  boxShadow: 'var(--shadow)',
  padding: '32px',
} as const

const nadpis = {
  margin: '0 0 12px',
  fontSize: '20px',
  color: 'var(--branch)',
} as const

const odstavec = {
  margin: '0 0 14px',
  color: 'var(--muted)',
  fontSize: '14px',
  lineHeight: 1.55,
} as const
