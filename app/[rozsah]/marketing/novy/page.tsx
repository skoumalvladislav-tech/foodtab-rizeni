import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { KANALY } from '@/lib/marketing'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import { zalozitPrispevek } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Nový příspěvek.
 *
 * Jen kostra: název, k čemu je a kam má jít. Text se píše až v detailu,
 * protože se ukládá jako VERZE — a verze se schvaluje. Kdyby se text
 * psal už tady, první uložení by rovnou vytvořilo něco, co se tváří
 * jako hotové.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '14px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const UCELY = [
  { klic: 'denni_menu', nazev: 'Denní menu' },
  { klic: 'vikendove_menu', nazev: 'Víkendová nabídka' },
  { klic: 'jidlo_dne', nazev: 'Jídlo dne' },
  { klic: 'pozvanka_na_akci', nazev: 'Pozvánka na akci' },
  { klic: 'atmosfera', nazev: 'Atmosféra podniku' },
  { klic: 'lide', nazev: 'Lidé z podniku' },
]

export default async function NovyPrispevek({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'marketing.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Na tohle nemáte oprávnění">
        Příspěvky připravuje ten, kdo má právo „Připravovat příspěvky“.
      </Sdeleni>
    )
  }

  /*
    Na firemní úrovni se příspěvek zakládat nedá: vždycky někdo zve
    k sobě, ne „do firmy". Říká se to tady, ne až po odeslání formuláře.
  */
  if (pristup.scope.branchId === null) {
    return (
      <>
        <Nadpis oci="Marketing">Nový příspěvek</Nadpis>
        <div style={{ padding: '16px' }}>
          <Sdeleni nadpis="Vyberte provozovnu">
            Příspěvek patří pobočce — pozvání je vždycky do konkrétního
            podniku. Přepněte se nahoře na provozovnu, pro kterou ho
            připravujete.
          </Sdeleni>
        </div>
      </>
    )
  }

  return (
    <>
      <Nadpis oci="Marketing" popis={`Připravujete pro: ${pristup.scope.branchName ?? ''}`}>
        Nový příspěvek
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '620px', display: 'grid', gap: '16px' }}>
        {chyba ? <p className="hlaska-chyba">{chyba}</p> : null}

        <form action={zalozitPrispevek} style={{ ...karta, display: 'grid', gap: '16px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />

          <label>
            <span style={popisek}>Název — pro vás, na příspěvek se nedostane</span>
            <input name="nazev" required placeholder="Denní menu na čtvrtek" style={pole} />
          </label>

          <label>
            <span style={popisek}>K čemu to je</span>
            <select name="ucel" defaultValue="denni_menu" style={pole}>
              {UCELY.map((u) => (
                <option key={u.klic} value={u.klic}>{u.nazev}</option>
              ))}
            </select>
          </label>

          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={popisek}>Kam to má jít</legend>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {KANALY.map((k) => (
                <label key={k.klic} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '14px' }}>
                  <input type="checkbox" name="kanaly" value={k.klic} defaultChecked />
                  {k.nazev}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <button type="submit" className="ft-tl ft-tl-hlavni">Založit a psát text</button>
          </div>
        </form>

        <p style={{ margin: 0, fontSize: '13px' }}>
          <Link href={`/${rozsah}/marketing`}>Zpět na Marketing</Link>
        </p>
      </div>
    </>
  )
}
