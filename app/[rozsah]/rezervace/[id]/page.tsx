import Link from 'next/link'
import { redirect } from 'next/navigation'

import Badge from '@/components/ui/Badge'
import Sdeleni from '@/app/sdeleni'
import { datetimeLocalVPasmu, datumACasSRokemVPasmu } from '@/lib/cas'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { denDlouze } from '@/lib/rezervace-kalendar'
import { najitSystem } from '@/lib/rezervace-poskytovatele'
import { NAZVY_DRUHU, NAZVY_STAVU, STAVY, type StavRezervace } from '@/lib/rezervace-typy'

import { PanelHlava } from '../../dnes/prvky'
import Ikona from '../../ikona'
import Nadpis from '../../nadpis'
import { zmenitStav } from '../akce'
import { nacistKontakt, nacistPoznamky, nacistPrilohy, nacistRezervaci } from '../data'
import FormularRezervace from '../formular'
import { zkusPristupRezervacim } from '../pristup'
import { HlaskaAkce, PanelPoznamek, PanelPriloh, StitekStavu, UdajeRezervace, ZalozkyRezervaci, casRezervace, titulek } from '../prvky'

export const dynamic = 'force-dynamic'

const VZOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Detail rezervace nebo akce: údaje, stav, poznámky a další informace,
 * dokumenty. Kontakt hosta jen s `rezervace.manage`.
 *
 * U rezervace z rezervačního systému se čas, počet, stav, jméno a kontakt
 * mění v tom systému (docs/rezervace-navrh.md, „čí je pravda“) — stránka
 * to říká a nenabízí to.
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

  const nalez = VZOR_ID.test(id) ? await nacistRezervaci(tenantId, id, pristup.pobocky) : null
  if (!nalez) {
    return (
      <Sdeleni nadpis="Rezervace tu není">
        Buď neexistuje, nebo patří pobočce, kterou v tomhle rozsahu nevidíte. <Link href={`/${rozsah}/rezervace`}>Zpět na kalendář</Link>
      </Sdeleni>
    )
  }

  const r = nalez.radek
  const pobocka = pristup.pobocky.find((p) => p.id === r.branch_id)!
  const smiZapisovat = pobocka.zapis
  const zRezervacnihoSystemu = r.zdroj !== 'rucne'
  const [poznamky, prilohy, kontakt] = await Promise.all([
    nacistPoznamky({ rezervace: r.id }),
    nacistPrilohy({ rezervace: r.id }),
    smiZapisovat ? nacistKontakt(r.id) : Promise.resolve(null),
  ])
  const zpet = `/${rozsah}/rezervace/${r.id}`
  const zacatek = datetimeLocalVPasmu(r.zacatek, r.zona)
  const konec = r.konec ? datetimeLocalVPasmu(r.konec, r.zona) : ''
  const system = nalez.poskytovatel ? najitSystem(nalez.poskytovatel) : null

  return (
    <>
      <Nadpis
        oci={`Provoz · ${NAZVY_DRUHU[r.druh]}`}
        popis={`${denDlouze(r.den)} · ${casRezervace(r, r.zona)} · ${pobocka.nazev}`}
        vpravo={
          <Link href={`/${rozsah}/rezervace/den/${r.den}`} className="ft-tl ft-tl-vedlejsi">
            <Ikona klic="sipkaVlevo" /> Na celý den
          </Link>
        }
      >
        {titulek(r)}
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <HlaskaAkce stav={stav} chyba={chyba} />

        <div className="ds-dnes">
          <div className="ds-dnes-hlavni">
            <section className="ds-plocha">
              <div className="ds-plocha-hlava">
                <Ikona klic={r.druh === 'akce' ? 'praporek' : 'rezervace'} />
                <h2>Údaje</h2>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {r.druh === 'akce' ? <Badge tone="vino">Akce</Badge> : null}
                  <StitekStavu stav={r.stav} />
                </span>
              </div>
              <UdajeRezervace
                r={r}
                nazevPobocky={pobocka.nazev}
                zaloha={nalez.zaloha}
                menu={nalez.menu}
                poznamkaZdroje={nalez.poznamkaZdroje}
                kontakt={kontakt}
              />
              {zRezervacnihoSystemu ? (
                <p className="ds-rez-zdroj" style={{ marginTop: '14px' }}>
                  {r.zdroj === 'csv' ? 'Načteno ze souboru' : 'Převzato z rezervačního systému'}
                  {system ? ` (${system.nazev})` : nalez.poskytovatel ? ` (${nalez.poskytovatel})` : ''}
                  {nalez.importovanoKdy ? `, naposledy ${datumACasSRokemVPasmu(nalez.importovanoKdy, r.zona)}` : ''}.
                  {nalez.stavZdroje ? ` Stav ve zdroji: „${nalez.stavZdroje}“.` : ''} Čas, počet osob, stav, jméno a kontakt se mění
                  tam; poznámky, dokumenty, prostor, menu a záloha patří Foodtabu a příští načtení je nepřepíše.
                </p>
              ) : null}
              {smiZapisovat && !zRezervacnihoSystemu ? (
                <div className="ds-rez-tlacitka" style={{ marginTop: '14px' }} role="group" aria-label="Změnit stav">
                  {(STAVY as readonly StavRezervace[])
                    .filter((s) => s !== r.stav)
                    .map((s) => (
                      <form key={s} action={zmenitStav}>
                        <input type="hidden" name="rozsah" value={rozsah} />
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="stav" value={s} />
                        <button type="submit" className="ft-tl ft-tl-vedlejsi ft-tl-male">
                          {s === 'zrusena' ? 'Zrušit' : `Označit: ${NAZVY_STAVU[s].toLowerCase()}`}
                        </button>
                      </form>
                    ))}
                </div>
              ) : null}
            </section>

            {smiZapisovat ? (
              <section className="ds-plocha">
                <details>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <PanelHlava ikona="tuzka" nadpis="Upravit údaje" />
                  </summary>
                  <FormularRezervace
                    rozsah={rozsah}
                    id={r.id}
                    pobocky={[{ id: pobocka.id, nazev: pobocka.nazev }]}
                    pobocka={pobocka.id}
                    jenFoodtab={zRezervacnihoSystemu}
                    klic=""
                    hodnoty={{
                      druh: r.druh,
                      stav: r.stav,
                      jmeno_hosta: r.jmeno_hosta,
                      nazev: r.nazev,
                      typ_akce: r.typ_akce,
                      datum: zacatek.slice(0, 10),
                      od: zacatek.slice(11, 16),
                      do: konec.slice(11, 16),
                      pocet_osob: r.pocet_osob === null ? '' : String(r.pocet_osob),
                      prostor: r.prostor,
                      menu: nalez.menu,
                      zaloha: nalez.zaloha.haleru === null ? '' : String(nalez.zaloha.haleru / 100).replace('.', ','),
                      zaloha_hosta_stav: nalez.zaloha.stav,
                      telefon: kontakt?.telefon ?? '',
                      email: kontakt?.email ?? '',
                    }}
                  />
                </details>
              </section>
            ) : null}
          </div>
          <div className="ds-dnes-bok">
            <PanelPoznamek rozsah={rozsah} cil={{ rezervace: r.id }} zpet={zpet} poznamky={poznamky} zona={r.zona} smiZapisovat={smiZapisovat} />
            <PanelPriloh
              rozsah={rozsah}
              cil={{ rezervace: r.id }}
              zpet={zpet}
              prilohy={prilohy}
              zona={r.zona}
              smiZapisovat={smiZapisovat}
              tenantId={tenantId}
              branchId={r.branch_id}
            />
          </div>
        </div>
      </div>
    </>
  )
}
