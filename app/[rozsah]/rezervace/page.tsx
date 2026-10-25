import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { denZAdresy, pohledZAdresy, rozsahPohledu } from '@/lib/rezervace-kalendar'
import { zkratkyPobocek } from '@/lib/rozpis-desktop'

import { dnesPobocky, nacistRezervace, nacistZnackyDnu } from './data'
import { KalendarObsah } from './obsah'
import { zkusPristupRezervacim } from './pristup'
import { adresaPohledu } from './prvky'

export const dynamic = 'force-dynamic'

/**
 * Provoz → Rezervace a akce: kalendář (týden, měsíc). Den je vlastní
 * stránka (den/[datum]) — tam jsou i poznámky a dokumenty ke dni.
 *
 * Zadání Šéfíka 25. 10. 2026, návrh docs/rezervace-navrh.md.
 *
 * Přístup se ověřuje TADY, prvním řádkem (layout stránku nechrání).
 * Kreslí obsah.tsx.
 */
export default async function RezervaceKalendar({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ pohled?: string; datum?: string }>
}) {
  const { rozsah } = await params
  const { pohled: pohledText, datum: datumText } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rezervace vidí ten, kdo má právo „Vidět rezervace a kalendář akcí“.</Sdeleni>
  }

  const { pobocky } = pristup
  const dnes = await dnesPobocky(pobocky[0])
  const datum = denZAdresy(datumText, dnes)
  const pohled = pohledZAdresy(pohledText)
  if (pohled === 'den') redirect(adresaPohledu(rozsah, 'den', datum))

  const { od, do: doDne } = rozsahPohledu(pohled, datum)
  const [rezervace, znacky] = await Promise.all([
    nacistRezervace(tenantId, pobocky, od, doDne),
    nacistZnackyDnu(tenantId, pobocky, od, doDne),
  ])

  // Víc poboček najednou (firemní rozsah): karta nese zkratku pobočky.
  const zkratky = new Map<string, string>()
  if (pobocky.length > 1) {
    const podleNazvu = zkratkyPobocek(pobocky.map((p) => p.nazev))
    for (const p of pobocky) zkratky.set(p.id, podleNazvu.get(p.nazev) ?? p.nazev)
  }

  return (
    <KalendarObsah
      rozsah={rozsah}
      pohled={pohled}
      datum={datum}
      dnes={dnes}
      pobocky={pobocky}
      rezervace={rezervace}
      znacky={znacky}
      zkratky={zkratky}
    />
  )
}
