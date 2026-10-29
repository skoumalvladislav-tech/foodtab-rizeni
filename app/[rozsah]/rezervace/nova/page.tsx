import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'

import Sdeleni from '@/app/sdeleni'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { denZAdresy } from '@/lib/rezervace-kalendar'

import Nadpis from '../../nadpis'
import { dnesPobocky } from '../data'
import FormularRezervace from '../formular'
import { zkusPristupRezervacim } from '../pristup'
import { ZalozkyRezervaci } from '../prvky'

export const dynamic = 'force-dynamic'

/** Nová rezervace nebo akce. `?datum=` předvyplní den, `?druh=akce` akci. */
export default async function NovaRezervace({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ datum?: string; druh?: string }>
}) {
  const { rozsah } = await params
  const { datum: datumText, druh } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.</Sdeleni>
  }
  const pristup = await zkusPristupRezervacim(tenantId, rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  const kZapisu = pristup.stav === 'ok' ? pristup.pobocky.filter((p) => p.zapis) : []
  if (pristup.stav === 'odepren' || kZapisu.length === 0) {
    return (
      <Sdeleni nadpis="Rezervace tady zapsat nemůžete">
        Zapisovat rezervace a akce smí ten, kdo má právo „Zapisovat rezervace a akce“ na téhle pobočce.
      </Sdeleni>
    )
  }

  const datum = denZAdresy(datumText, await dnesPobocky(kZapisu[0]))
  const jeAkce = druh === 'akce'

  return (
    <>
      <Nadpis oci="Provoz · Rezervace a akce" popis={jeAkce ? 'Uzavřená společnost, oslava, catering…' : undefined}>
        {jeAkce ? 'Nová akce' : 'Nová rezervace'}
      </Nadpis>
      <div className="ds-rez" style={{ padding: '0 16px 32px' }}>
        <ZalozkyRezervaci rozsah={rozsah} aktivni="kalendar" />
        <section className="ds-plocha" style={{ maxWidth: '920px' }}>
          <FormularRezervace
            rozsah={rozsah}
            id={null}
            pobocky={kZapisu.map((p) => ({ id: p.id, nazev: p.nazev }))}
            pobocka={kZapisu[0].id}
            jenFoodtab={false}
            klic={randomUUID()}
            tenantId={tenantId}
            hodnoty={{
              druh: jeAkce ? 'akce' : 'rezervace',
              stav: jeAkce ? 'ceka' : 'potvrzeno',
              jmeno_hosta: '',
              nazev: '',
              typ_akce: '',
              datum,
              od: jeAkce ? '18:00' : '19:00',
              do: '',
              pocet_osob: '',
              prostor: '',
              menu: '',
              zaloha: '',
              zaloha_hosta_stav: 'zadna',
              telefon: '',
              email: '',
            }}
          />
        </section>
      </div>
    </>
  )
}
