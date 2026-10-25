import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { denDlouze, hosteText, souhrnDne } from '@/lib/rezervace-kalendar'
import { jePlatneDatum } from '@/lib/rezervace-typy'

import { KpiKarta, PanelHlava } from '../../../dnes/prvky'
import Nadpis from '../../../nadpis'
import { dnesPobocky, nacistPoznamky, nacistPrilohy, nacistRezervace } from '../../data'
import { zkusPristupRezervacim } from '../../pristup'
import { HlaskaAkce, NastrojePohledu, PanelPoznamek, PanelPriloh, SeznamRezervaci, ZalozkyRezervaci } from '../../prvky'

export const dynamic = 'force-dynamic'

/**
 * Den v Rezervacích: kdo přijde, kolik jich bude, jaké akce — a k dnu
 * poznámky („kapela od 20:00, sál zavřený“) a dokumenty (plán sálu,
 * objednávka cateringu). Poznámky a dokumenty patří DNI POBOČKY, ne
 * kalendářnímu dni: den je provozní (rezervace v 1:30 patří k večeru
 * předtím), stejně jako v databázi.
 *
 * Na firemním rozsahu s víc pobočkami má každá pobočka svůj oddíl —
 * poznámka ke dni Perly nepatří Baru.
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
  const rezervace = await nacistRezervace(tenantId, pobocky, datum, datum)
  const kDnu = await Promise.all(
    pobocky.map(async (p) => {
      const filtr = { tenantId, pobocka: p.id, den: datum }
      const [poznamky, prilohy] = await Promise.all([nacistPoznamky(filtr), nacistPrilohy(filtr)])
      return { pobocka: p, poznamky, prilohy, rezervace: rezervace.filter((r) => r.branch_id === p.id) }
    }),
  )

  const s = souhrnDne(rezervace)
  const zpet = `/${rozsah}/rezervace/den/${datum}`
  const vic = pobocky.length > 1

  return (
    <>
      <Nadpis oci="Provoz · Rezervace a akce" popis={datum === dnes ? 'Dnešní provozní den.' : undefined}>
        {denDlouze(datum)}
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <NastrojePohledu rozsah={rozsah} pohled="den" datum={datum} dnes={dnes} smiZapisovat={pobocky.some((p) => p.zapis)} />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <div className="ds-rez-kpi">
          <KpiKarta ikona="rezervace" ton="info" titulek="Rezervace" hodnota={String(s.rezervaci)} popisy={[s.zrusenych ? `${s.zrusenych} zrušených nebo nedorazili` : null]} />
          <KpiKarta ikona="lide" ton="dobre" titulek="Hosté" hodnota={hosteText(s)} popisy={['bez zrušených']} />
          <KpiKarta ikona="praporek" ton={s.akci ? 'pozor' : 'neutral'} titulek="Akce" hodnota={String(s.akci)} popisy={[s.akci ? 'uzavřené společnosti, catering' : 'žádná akce']} />
        </div>

        <div className="ds-dnes">
          <div className="ds-dnes-hlavni">
            {kDnu.map((k) => (
              <section key={k.pobocka.id} className="ds-plocha">
                <PanelHlava ikona="rezervace" nadpis={vic ? `Rezervace — ${k.pobocka.nazev}` : 'Rezervace a akce dne'} />
                <SeznamRezervaci rozsah={rozsah} rezervace={k.rezervace} />
              </section>
            ))}
          </div>
          <div className="ds-dnes-bok">
            {kDnu.map((k) => (
              <div key={k.pobocka.id} style={{ display: 'grid', gap: '16px' }}>
                {vic ? <p className="ds-rez-pobocka">{k.pobocka.nazev}</p> : null}
                <PanelPoznamek
                  rozsah={rozsah}
                  cil={{ den: datum, pobocka: k.pobocka.id }}
                  zpet={zpet}
                  poznamky={k.poznamky}
                  zona={k.pobocka.zona}
                  smiZapisovat={k.pobocka.zapis}
                  nadpis="Poznámky ke dni"
                />
                <PanelPriloh
                  rozsah={rozsah}
                  cil={{ den: datum, pobocka: k.pobocka.id }}
                  zpet={zpet}
                  prilohy={k.prilohy}
                  zona={k.pobocka.zona}
                  smiZapisovat={k.pobocka.zapis}
                  tenantId={tenantId}
                  branchId={k.pobocka.id}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
