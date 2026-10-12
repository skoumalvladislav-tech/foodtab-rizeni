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

/** Datum (RRRR-MM-DD, UTC) před `dny` dny — mimo komponentu, ať render zůstane čistý. */
function datumPred(dny: number): string {
  return new Date(Date.now() - dny * 86_400_000).toISOString().slice(0, 10)
}

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

  type Radek = { datum: string; branch_id: string; zdroj: string; trzba_haleru: number }

  /**
   * Řádky posledních 60 dní PO STRÁNKÁCH. Databáze vrací nejvýš 1000
   * řádků na dotaz (max_rows) — s napojenou pokladnou (stovky produktů
   * denně) by dřívější `.limit(2000)` ukázal jen pár dní a nejstarší
   * z nich useknutý v půlce (s nižší tržbou, než měl).
   */
  const nacistRadky = async (): Promise<Radek[]> => {
    const od = datumPred(60)
    const vse: Radek[] = []
    for (let strana = 0; strana < 50; strana++) {
      const { data } = await supabase
        .from('pokladna_prodeje_denni')
        .select('datum, branch_id, zdroj, trzba_haleru')
        .eq('tenant_id', tenantId)
        .gte('datum', od)
        .order('datum', { ascending: false })
        .order('id')
        .range(strana * 1000, strana * 1000 + 999)
      const cast = (data ?? []) as Radek[]
      vse.push(...cast)
      if (cast.length < 1000) break
    }
    return vse
  }

  const [branchesRes, radky] = await Promise.all([
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
    nacistRadky(),
  ])

  const branches = (branchesRes.data ?? []) as { id: string; name: string }[]

  // Stejné pravidlo jako foodcost (20261011100000): má-li pobočka v daný
  // den data z napojené pokladny, CSV téhož dne se nepočítá — jinak by se
  // den, který API dohnalo, ukázal dvakrát.
  const dnyZPokladny = new Set(radky.filter((r) => r.zdroj !== 'csv').map((r) => `${r.branch_id}|${r.datum}`))

  const podleDne = new Map<string, DenniSouhrn>()
  for (const r of radky) {
    if (r.zdroj === 'csv' && dnyZPokladny.has(`${r.branch_id}|${r.datum}`)) continue
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
