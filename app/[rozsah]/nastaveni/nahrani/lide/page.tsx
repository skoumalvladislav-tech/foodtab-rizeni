import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Pruvodce from './pruvodce'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Nahrání dat → Lidé
 *
 * Stránka jen ověří právo a pustí průvodce. Všechno ostatní se děje
 * v prohlížeči (čtení souboru) a v serverových akcích (náhled a zápis),
 * protože soubor se nikam neukládá — ani na server, ani do session.
 *
 * Právo je people.manage, stejné jako u ručního zakládání. Import nesmí
 * být obchvat oprávnění: kdo nesmí zakládat lidi, nezaloží je ani
 * souborem. Druhá obranná linie je RLS na employees.
 */
export default async function NahraniLidi({
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

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nahrávat lidi smí jen ten, kdo je smí zakládat — právo{' '}
        <code>people.manage</code>.
      </Sdeleni>
    )
  }

  return (
    <>
      <Nadpis
        oci="Nahrání dat"
        popis="Tabulka z Excelu nebo CSV. Nic se nezapíše, dokud neuvidíte, co se stane."
      >
        Lidé z tabulky
      </Nadpis>
      <Pruvodce rozsah={rozsah} />
    </>
  )
}
