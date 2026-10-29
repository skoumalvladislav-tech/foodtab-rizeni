import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { jePlatneDatum } from '@/lib/rezervace-typy'
import { svatekDne } from '@/lib/svatky'
import { zemeSvatkuFirmy } from '@/lib/svatky-firmy'

import { dnesPobocky, nacistPoznamky, nacistPrilohy, nacistRezervace } from '../../data'
import { DenObsah } from '../../obsah'
import { zkusPristupRezervacim } from '../../pristup'

export const dynamic = 'force-dynamic'

/**
 * Den v Rezervacích: kdo přijde, kolik jich bude, jaké akce — a k dnu
 * poznámky („kapela od 20:00, sál zavřený“) a dokumenty (plán sálu,
 * objednávka cateringu). Poznámky a dokumenty patří DNI POBOČKY, ne
 * kalendářnímu dni: den je provozní (rezervace v 1:30 patří k večeru
 * předtím), stejně jako v databázi.
 *
 * Na firemním rozsahu s víc pobočkami má každá pobočka svůj oddíl —
 * poznámka ke dni Perly nepatří Baru. Kreslí obsah.tsx.
 */
export default async function RezervaceDen({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; datum: string }>
  searchParams: Promise<{ stav?: string; chyba?: string }>
}) {
  const { rozsah, datum } = await params
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
  if (!jePlatneDatum(datum)) redirect(`/${rozsah}/rezervace`)

  const { pobocky } = pristup
  const dnes = await dnesPobocky(pobocky[0])
  const [rezervace, zemeSvatku] = await Promise.all([nacistRezervace(tenantId, pobocky, datum, datum), zemeSvatkuFirmy(tenantId)])
  const kDnu = await Promise.all(
    pobocky.map(async (p) => {
      const filtr = { tenantId, pobocka: p.id, den: datum }
      const [poznamky, prilohy] = await Promise.all([nacistPoznamky(filtr), nacistPrilohy(filtr)])
      return { pobocka: p, poznamky, prilohy, rezervace: rezervace.filter((r) => r.branch_id === p.id) }
    }),
  )

  // Svátek patří kalendářnímu datu z adresy; provozní den se jmenuje stejně (lib/svatky.ts).
  return (
    <DenObsah
      rozsah={rozsah}
      datum={datum}
      dnes={dnes}
      tenantId={tenantId}
      kDnu={kDnu}
      svatek={svatekDne(datum, zemeSvatku)}
      stav={stav}
      chyba={chyba}
    />
  )
}
