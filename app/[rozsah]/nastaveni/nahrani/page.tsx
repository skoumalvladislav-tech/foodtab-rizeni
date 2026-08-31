import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'

export const dynamic = 'force-dynamic'

/**
 * Nastavení → Nahrání dat
 *
 * První krok průběhu ze zadání: vyberu, co nahrávám. Zatím umí aplikace
 * jen lidi — ostatní jsou tady vidět zašedle, aby bylo poznat, že se
 * chystají, a aby se nikdo neptal, jestli to nepřehlédl.
 *
 * Pořadí je podle oddílu D zadání: lidi, rozpis, receptury. Není to
 * abecedně ani náhodně — na lidech se odlaďuje celý průběh.
 */

const CO_JDE: {
  segment: string
  nazev: string
  popis: string
  hotovo: boolean
}[] = [
  {
    segment: 'lide',
    nazev: 'Lidé',
    popis:
      'Jména, pobočky, pozice a typ poměru. Nejmenší z importů a nejčastější potřeba.',
    hotovo: true,
  },
  {
    segment: 'rozpis',
    nazev: 'Rozpis směn',
    popis:
      'Značky jako R, O, X si firma nastaví sama — slovník je tabulka, ne pravidlo v aplikaci.',
    hotovo: false,
  },
  {
    segment: 'receptury',
    nazev: 'Receptury',
    popis: 'Suroviny, množství a postupy.',
    hotovo: false,
  },
]

export default async function NahraniRozcestnik({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) {
    return (
      <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">
        Požádejte o pozvánku někoho, kdo firmu ve Foodtabu spravuje.
      </Sdeleni>
    )
  }

  const pristup = await zkusPristup(tenantId, 'people.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect('/prihlaseni')
  if (pristup.stav === 'odepren') {
    return (
      <Sdeleni nadpis="Sem nemáte přístup">
        Nahrávat data smí ten, kdo je smí zadávat i ručně. U lidí je to
        právo <code>people.manage</code>.
      </Sdeleni>
    )
  }

  return (
    <>
      <Nadpis
        oci="Nastavení"
        popis="Několik hodin opisování je nejčastější důvod, proč nový zákazník skončí v prvním týdnu. Tohle je cesta dovnitř."
      >
        Nahrání dat
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '12px', maxWidth: '760px' }}>
          {CO_JDE.map((c) => {
            const obsah = (
              <>
                <span style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '17px' }}>{c.nazev}</strong>
                  {c.hotovo ? null : (
                    <span
                      style={{
                        padding: '1px 8px',
                        borderRadius: '999px',
                        border: '1px solid var(--line)',
                        fontSize: '11.5px',
                        color: 'var(--muted)',
                      }}
                    >
                      brzy
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
                  {c.popis}
                </span>
              </>
            )

            return (
              <li key={c.segment}>
                {c.hotovo ? (
                  <Link href={`/${rozsah}/nastaveni/nahrani/${c.segment}`} style={{ ...karta, display: 'block' }}>
                    {obsah}
                  </Link>
                ) : (
                  <div style={{ ...karta, opacity: 0.55 }}>{obsah}</div>
                )}
              </li>
            )
          })}
        </ul>

        <p style={{ margin: '20px 0 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '62ch' }}>
          Nahrání jde pustit vícekrát. Co ve firmě už je, se pozná a
          neduplikuje — u lidí podle jména, u pozic podle názvu. Nic se
          nemaže: opakované nahrání starý záznam aktualizuje, nenahrazuje.
        </p>
      </div>
    </>
  )
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  boxShadow: 'var(--shadow)',
  padding: '16px 18px',
  color: 'var(--ink)',
  textDecoration: 'none',
} as const
