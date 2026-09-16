import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Pruvodce from './pruvodce'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Nahrání dat → Rozpis směn
 *
 * Stránka jen ověří právo a pustí průvodce — stejné dělení jako
 * ../lide/page.tsx. Soubor se nikam neukládá, čte se v prohlížeči.
 *
 * Právo je shifts.manage, stejné jako u ručního zakládání směn v
 * Rozpisu. Import nesmí být obchvat oprávnění.
 */
export default async function NahraniRozpisu({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'shifts.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nahrávat rozpis směn smí jen ten, kdo je smí zakládat — právo{' '}
        <code>shifts.manage</code>.
      </Sdeleni>
    )
  }

  return (
    <>
      <Nadpis
        oci="Nahrání dat"
        popis="Tabulka z Excelu nebo CSV. Nic se nezapíše, dokud neuvidíte, co se stane."
      >
        Rozpis směn z tabulky
      </Nadpis>
      <Pruvodce rozsah={rozsah} />
    </>
  )
}
