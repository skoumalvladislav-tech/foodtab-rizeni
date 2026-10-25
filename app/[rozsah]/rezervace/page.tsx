import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import {
  denZAdresy,
  dnyTydne,
  mrizkaMesice,
  pohledZAdresy,
  podleDne,
  rozsahPohledu,
} from '@/lib/rezervace-kalendar'
import { zkratkyPobocek } from '@/lib/rozpis-desktop'

import Nadpis from '../nadpis'
import { dnesPobocky, nacistRezervace, nacistZnackyDnu } from './data'
import { zkusPristupRezervacim } from './pristup'
import { MesicKalendar, NastrojePohledu, TydenKalendar, ZalozkyRezervaci, adresaPohledu } from './prvky'

export const dynamic = 'force-dynamic'

/**
 * Provoz → Rezervace a akce: kalendář (týden, měsíc). Den je vlastní
 * stránka (den/[datum]) — tam jsou i poznámky a dokumenty ke dni.
 *
 * Zadání Šéfíka 25. 10. 2026, návrh docs/rezervace-navrh.md.
 *
 * Přístup se ověřuje TADY, prvním řádkem (layout stránku nechrání).
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
  const poDnech = podleDne(rezervace)
  const znackyDne = (den: string) =>
    pobocky.reduce(
      (s, p) => {
        const z = znacky.get(`${p.id}|${den}`)
        return { poznamek: s.poznamek + (z?.poznamek ?? 0), priloh: s.priloh + (z?.priloh ?? 0) }
      },
      { poznamek: 0, priloh: 0 },
    )

  // Víc poboček najednou (firemní rozsah): karta nese zkratku pobočky.
  const zkratky = new Map<string, string>()
  if (pobocky.length > 1) {
    const podleNazvu = zkratkyPobocek(pobocky.map((p) => p.nazev))
    for (const p of pobocky) zkratky.set(p.id, podleNazvu.get(p.nazev) ?? p.nazev)
  }
  const smiZapisovat = pobocky.some((p) => p.zapis)

  return (
    <>
      <Nadpis
        oci="Provoz"
        popis={
          pobocky.length > 1
            ? `Rezervace hostů a akce všech poboček (${pobocky.map((p) => p.nazev).join(', ')}).`
            : 'Rezervace hostů a akce — uzavřené společnosti, catering, oslavy.'
        }
      >
        Rezervace a akce
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <NastrojePohledu rozsah={rozsah} pohled={pohled} datum={datum} dnes={dnes} smiZapisovat={smiZapisovat} />
        {pohled === 'tyden' ? (
          <TydenKalendar
            rozsah={rozsah}
            dnes={dnes}
            smiZapisovat={smiZapisovat}
            zkratkyPobocek={zkratky}
            dny={dnyTydne(datum).map((den) => ({ den, rezervace: poDnech.get(den) ?? [], ...znackyDne(den) }))}
          />
        ) : (
          <MesicKalendar
            rozsah={rozsah}
            dnes={dnes}
            tydny={mrizkaMesice(datum).map((tyden) =>
              tyden.map((d) => ({ ...d, rezervace: poDnech.get(d.den) ?? [], poznamek: znackyDne(d.den).poznamek })),
            )}
          />
        )}
      </div>
    </>
  )
}
