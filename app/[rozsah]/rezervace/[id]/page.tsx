import Link from 'next/link'
import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'

import { nacistKontakt, nacistPoznamky, nacistPrilohy, nacistRezervaci } from '../data'
import { DetailObsah } from '../obsah'
import { zkusPristupRezervacim } from '../pristup'

export const dynamic = 'force-dynamic'

const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Detail rezervace nebo akce: údaje, stav, poznámky a další informace,
 * dokumenty. Kontakt hosta jen s `rezervace.manage`.
 *
 * U rezervace z rezervačního systému se čas, počet, stav, jméno a kontakt
 * mění v tom systému (docs/rezervace-navrh.md, „čí je pravda“) — obrazovka
 * to říká a nenabízí to. Kreslí obsah.tsx.
 */
export default async function RezervaceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; id: string }>
  searchParams: Promise<{ stav?: string; chyba?: string }>
}) {
  const { rozsah, id } = await params
  const { stav, chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rezervace vidí ten, kdo má právo „Vidět rezervace a kalendář akcí“.</Sdeleni>
  }

  const detail = VZOR_ID.test(id) ? await nacistRezervaci(tenantId, id, pristup.pobocky) : null
  const pobocka = detail ? pristup.pobocky.find((p) => p.id === detail.radek.branch_id) : undefined
  if (!detail || !pobocka) {
    return (
      <Sdeleni nadpis="Rezervace tu není">
        Buď neexistuje, nebo patří pobočce, kterou v tomhle rozsahu nevidíte. <Link href={`/${rozsah}/rezervace`}>Zpět na kalendář</Link>
      </Sdeleni>
    )
  }

  const smiZapisovat = pobocka.zapis
  const [poznamky, prilohy, kontakt] = await Promise.all([
    nacistPoznamky({ rezervace: detail.radek.id }),
    nacistPrilohy({ rezervace: detail.radek.id }),
    smiZapisovat ? nacistKontakt(detail.radek.id) : Promise.resolve(null),
  ])

  return (
    <DetailObsah
      rozsah={rozsah}
      tenantId={tenantId}
      detail={detail}
      pobocka={pobocka}
      poznamky={poznamky}
      prilohy={prilohy}
      kontakt={kontakt}
      stav={stav}
      chyba={chyba}
    />
  )
}
