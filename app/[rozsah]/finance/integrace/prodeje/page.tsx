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

  const [branchesRes, prodejeRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
    supabase
      .from('pokladna_prodeje_denni')
      .select('datum, trzba_haleru')
      .eq('tenant_id', tenantId)
      .order('datum', { ascending: false })
      .limit(2000),
  ])

  const branches = (branchesRes.data ?? []) as { id: string; name: string }[]

  const podleDne = new Map<string, DenniSouhrn>()
  for (const r of (prodejeRes.data ?? []) as { datum: string; trzba_haleru: number }[]) {
    const souhrn = podleDne.get(r.datum) ?? { datum: r.datum, trzbaHaleru: 0, pocetProduktu: 0 }
    souhrn.trzbaHaleru += r.trzba_haleru
    souhrn.pocetProduktu += 1
    podleDne.set(r.datum, souhrn)
  }
  const posledniDny = [...podleDne.values()].sort((a, b) => (a.datum < b.datum ? 1 : -1)).slice(0, 14)

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis="Denní souhrn prodeje po produktu — vstup pro budoucí porovnání s teoretickou spotřebou. Bez živého připojení jde jen o CSV."
        vpravo={<Link href={`/${rozsah}/finance/integrace`} className="ft-tl">← Zpět na integrace</Link>}
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
          {posledniDny.length === 0 ? (
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
