import { redirect } from 'next/navigation'

import { getUser, hasAccess } from '@/lib/authz'
import { getCurrentTenantId } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import Sdeleni from '@/app/sdeleni'
import Card from '@/components/ui/Card'
import Nadpis from '../../nadpis'
import { vytvoritSurovinu } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Nová surovina.
 *
 * `density_g_per_ml` a `weight_g_per_ks` zůstávají prázdné, dokud je
 * nikdo nevyplní výslovně — appka mezi gramy a mililitry nepřevádí sama
 * (zadání, komentář u `ingredients.density_g_per_ml` v migraci). Jsou
 * tu jen pro surovinu, která se bude NĚKDY přepočítávat mezi jednotkami.
 */
export default async function NovaSurovina({
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

  const uzivatel = await getUser()
  if (!uzivatel) redirect(await odkazNaPrihlaseni())

  // `null` schválně — surovina je sdílená napříč pobočkami, viz akce.ts.
  const smiZapisovat = await hasAccess(tenantId, 'purchasing.manage', null)
  if (!smiZapisovat) {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nové suroviny zakládá ten, kdo má právo <code>purchasing.manage</code>.
      </Sdeleni>
    )
  }

  return (
    <>
      <Nadpis oci="Provoz" popis="Jméno a základní jednotka. Ostatní se dolaďuje v detailu.">
        Nová surovina
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '520px' }}>
        {chyba ? <p className="hlaska-chyba">{popisChyby(chyba)}</p> : null}

        <Card>
          <form action={vytvoritSurovinu} style={{ display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />

            <label style={poleLabel}>
              <span>Název</span>
              <input name="nazev" type="text" required maxLength={120} placeholder="např. Mouka hladká" style={pole} />
            </label>

            <label style={poleLabel}>
              <span>Základní jednotka</span>
              <select name="zakladni_jednotka" defaultValue="g" style={pole}>
                <option value="g">gramy (g)</option>
                <option value="ml">mililitry (ml)</option>
                <option value="ks">kusy (ks)</option>
              </select>
              <span style={vysvetlivka}>
                V téhle jednotce se surovina počítá v receptech a v cenách
                nákupu. Později se nedá změnit.
              </span>
            </label>

            <fieldset style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '12px', display: 'grid', gap: '12px' }}>
              <legend style={{ fontSize: '13px', color: 'var(--muted)', padding: '0 4px' }}>
                Nepovinné — jen pro přepočet mezi jednotkami
              </legend>

              <label style={poleLabel}>
                <span>Hustota (g na ml)</span>
                <input name="density_g_per_ml" type="number" min="0" step="0.0001" style={pole} />
                <span style={vysvetlivka}>
                  Vyplňte jen tehdy, když se tahle surovina bude někdy
                  přepočítávat mezi hmotností a objemem (např. olej).
                  Appka mezi g a ml sama nepřevádí — bez podkladu by šlo
                  o odhad, ne o výpočet.
                </span>
              </label>

              <label style={poleLabel}>
                <span>Hmotnost jednoho kusu (g)</span>
                <input name="weight_g_per_ks" type="number" min="0" step="0.001" style={pole} />
                <span style={vysvetlivka}>
                  Jen u surovin v kusech, které se zároveň potřebují
                  počítat podle hmotnosti (např. vejce).
                </span>
              </label>
            </fieldset>

            <button type="submit" className="ft-tl ft-tl-hlavni" style={{ justifySelf: 'start' }}>
              Založit surovinu
            </button>
          </form>
        </Card>
      </div>
    </>
  )
}

function popisChyby(kod: string): string {
  switch (kod) {
    case 'neuplne':
      return 'Vyplňte název a základní jednotku.'
    case 'hustota':
      return 'Hustota musí být kladné číslo.'
    case 'vaha-kusu':
      return 'Hmotnost kusu musí být kladné číslo.'
    case 'duplicitni':
      return 'Surovina s tímhle názvem už existuje.'
    case 'pravo':
      return 'Na tuhle změnu nemáte právo.'
    default:
      return 'Založení se nepovedlo. Zkuste to prosím znovu.'
  }
}

const poleLabel = {
  display: 'grid' as const,
  gap: '6px',
  fontSize: '13px',
  color: 'var(--muted)',
}

const pole = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '16px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-2)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  minHeight: '44px',
}

const vysvetlivka = {
  fontSize: '12.5px',
  color: 'var(--muted)',
  lineHeight: 1.45,
}
