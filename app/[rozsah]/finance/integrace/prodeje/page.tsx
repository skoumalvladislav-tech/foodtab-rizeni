import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import Navigace from '../../navigace'
import ImportFormular from './formular'

export const dynamic = 'force-dynamic'

/**
 * Finance — Integrace — Prodeje (Dotykačka adaptér, P1).
 *
 * Provider-neutrální denní souhrn prodeje po produktu — appka žádnou
 * pokladnu nepřipojuje živě (zadání, oddíl 2), tahle obrazovka je CSV
 * fallback registrovaný přes `integrace_pripojeni` (`oblast='pokladna'`).
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

type DenniSouhrn = { datum: string; trzbaHaleru: number; pocetProduktu: number }

export default async function FinanceIntegraceProdeje({
  params,
}: {
  params: Promise<{ rozsah: string }>
}) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Prodeje vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }
  if (!canSee(pristup.ctx, 'finance.manage')) {
    return <Sdeleni nadpis="Na import nemáte oprávnění">Import prodejů smí ten, kdo má právo „Správa financí“.</Sdeleni>
  }

  const supabase = await getServerSupabase()

  // Denní součty počítá databáze jedním dotazem (`pokladna_prodeje_souhrn`,
  // 20261012100000): stejné pravidlo jako foodcost — CSV se za den a pobočku
  // nepočítá, má-li data z napojené pokladny. Dřív se sčítalo v appce z řádků,
  // kterých databáze vrátí nejvýš 1000: s napojenou pokladnou by se ukázalo
  // jen pár dní a nejstarší s useknutou tržbou.
  const [branchesRes, souhrnRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
    supabase.rpc('pokladna_prodeje_souhrn', { p_tenant: tenantId, p_dnu: 14 }),
  ])

  const branches = (branchesRes.data ?? []) as { id: string; name: string }[]
  const souhrnChyba = Boolean(souhrnRes.error)
  const posledniDny: DenniSouhrn[] = ((souhrnRes.data ?? []) as { datum: string; trzba_haleru: number | string; polozek: number | string }[])
    .map((d) => ({ datum: d.datum, trzbaHaleru: Number(d.trzba_haleru), pocetProduktu: Number(d.polozek) }))

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Ruční nahrání denních prodejů ze souboru — pro pokladnu bez API. Napojenou pokladnu spravujete v Pokladních systémech."
        vpravo={<Link href={`/${rozsah}/finance/integrace/pokladna`} className="ft-tl">← Pokladní systémy</Link>}
      >
        Prodeje
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {branches.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Nejdřív založte pobočku.</p>
        ) : (
          <ImportFormular rozsah={rozsah} branches={branches} />
        )}

        <div style={{ ...karta, display: 'grid', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '15px' }}>Posledních 14 dní s daty</h2>
          {souhrnChyba ? (
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--pozor)' }}>Přehled dní se teď nepodařilo načíst — zkuste stránku obnovit.</p>
          ) : posledniDny.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--muted)' }}>Zatím žádné importované prodeje.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '6px 8px' }}>Datum</th>
                  <th style={{ padding: '6px 8px' }}>Položek</th>
                  <th style={{ padding: '6px 8px' }}>Tržba</th>
                </tr>
              </thead>
              <tbody>
                {posledniDny.map((d) => (
                  <tr key={d.datum} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '6px 8px' }}>{d.datum}</td>
                    <td style={{ padding: '6px 8px' }}>{d.pocetProduktu}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(d.trzbaHaleru)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Navigace>
  )
}
