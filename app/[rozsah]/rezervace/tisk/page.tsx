import Link from 'next/link'
import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { datumACasSRokemVPasmu } from '@/lib/cas'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { NEJDELSI_OBDOBI, sestavitTisk, volbyZAdresy, zpatkyZTisku } from '@/lib/rezervace-tisk'

import { STROP_TISKU, dnesPobocky, nacistTisk } from '../data'
import { zkusPristupRezervacim } from '../pristup'
import { TiskObsah } from './obsah'

export const dynamic = 'force-dynamic'

/**
 * Tisk přehledu akcí a rezervací za období, které bylo vidět na obrazovce
 * (kalendář Rezervací: den, týden, měsíc; Rozpis směn: jeho okno).
 * Odkazy sem skládá `adresaTisku` (lib/rezervace-tisk.ts).
 *
 * Přístup se ověřuje TADY, prvním řádkem (layout stránku nechrání —
 * stránka se vykreslí souběžně a její data by odešla v RSC payloadu).
 * Stejná otázka jako kalendář: `zkusPristupRezervacim`, rozsah z adresy,
 * pak pobočka po pobočce. `?pobocky=` z Rozpisu výběr jen ZÚŽÍ.
 *
 * Data uživatelským klientem (data.ts, `nacistTisk`), RLS pod tím.
 * Kreslí tisk/obsah.tsx; na papír ho připraví app/_tisk.css.
 */
export default async function RezervaceTisk({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { rozsah } = await params
  const hledani = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Rezervace vidí ten, kdo má právo „Vidět rezervace a kalendář akcí“.</Sdeleni>
  }

  const dnes = await dnesPobocky(pristup.pobocky[0])
  const volby = volbyZAdresy(hledani, dnes)
  if (!volby) {
    return (
      <Sdeleni nadpis="Tohle období vytisknout nejde">
        Odkaz nemá platné období (nejvýš {NEJDELSI_OBDOBI} dní). Otevřete kalendář a tiskněte odtamtud.{' '}
        <Link href={`/${rozsah}/rezervace`}>Zpět do Rezervací</Link>
      </Sdeleni>
    )
  }

  const pobocky = volby.pobocky.length > 0 ? pristup.pobocky.filter((p) => volby.pobocky.includes(p.id)) : pristup.pobocky
  if (pobocky.length === 0) {
    return (
      <Sdeleni nadpis="Rezervace téhle pobočky nevidíte">
        Na rezervace vybrané pobočky nemáte v tomhle rozsahu právo. <Link href={`/${rozsah}/rezervace`}>Zpět do Rezervací</Link>
      </Sdeleni>
    )
  }

  const zpet = zpatkyZTisku(rozsah, volby.zpet, volby.od)
  const data = await nacistTisk(tenantId, pobocky, volby.od, volby.do)
  if (data.stav === 'prilisMnoho') {
    return (
      <Sdeleni nadpis="Na jeden přehled je toho moc">
        V období je víc než {STROP_TISKU} záznamů. Vytiskněte kratší období (týden nebo den). <Link href={zpet.href}>{zpet.text}</Link>
      </Sdeleni>
    )
  }

  const tisk = sestavitTisk({ pobocky, rezervace: data.rezervace, poznamkyDnu: data.poznamkyDnu, telefony: data.telefony, volby })
  return (
    <TiskObsah
      tisk={tisk}
      volby={volby}
      zpet={zpet}
      nazvyPobocek={pobocky.map((p) => p.nazev)}
      vytisteno={datumACasSRokemVPasmu(new Date(), pobocky[0].zona)}
      hned={hledani.hned === '1'}
    />
  )
}
