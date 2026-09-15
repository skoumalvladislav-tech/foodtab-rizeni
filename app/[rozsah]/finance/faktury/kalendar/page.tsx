import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele, inicialyDodavatele } from '@/lib/faktury-color'
import { formatCastku, formatDatum } from '@/lib/faktury-format'
import { dniPoSplatnosti, jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import StavZnacka from '../stav-znacka'

export const dynamic = 'force-dynamic'

/**
 * Faktury — kalendář splatností.
 *
 * Přeneseno z faktury-app (src/app/kalendar/page.tsx), beze změny
 * logiky — nezaplacené faktury s vyplněnou splatností, řazené podle
 * dodavatele a pak podle data.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

async function nactiNezaplacene(): Promise<Faktura[]> {
  const supabase = getFakturySupabase()
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    const { data, error } = await supabase
      .from('invoices').select('*').not('due_date', 'is', null)
      .order('supplier', { ascending: true }).order('due_date', { ascending: true }).order('id', { ascending: true })
      .range(od, od + velikostStranky - 1)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }
  return vse.filter(jeNezaplacena)
}

export default async function FakturyKalendar({ params }: { params: Promise<{ rozsah: string }> }) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Faktury vidí ten, kdo má právo „Vidět přijaté faktury“.</Sdeleni>
  }

  const faktury = await nactiNezaplacene()
  const celkem = faktury.reduce((s, f) => s + Number(f.amount || 0), 0)
  const mena = faktury[0]?.currency ?? 'CZK'
  const poSplatnosti = faktury.filter((f) => dniPoSplatnosti(f.due_date) > 0).length

  return (
    <>
      <Nadpis oci="Faktury" popis="Seřazeno podle dodavatele, pak podle data splatnosti.">
        Kalendář splatností
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Celkem neuhrazeno</span>
            <div style={{ fontSize: '20px', marginTop: '4px' }}>{formatCastku(celkem, mena)}</div>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{faktury.length} faktur</span>
          </div>
          <div style={karta}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Počet faktur</span>
            <div style={{ fontSize: '20px', marginTop: '4px' }}>{faktury.length}</div>
          </div>
          <div style={{ ...karta, borderColor: poSplatnosti > 0 ? 'var(--mosaz)' : undefined }}>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Po splatnosti</span>
            <div style={{ fontSize: '20px', marginTop: '4px', color: poSplatnosti > 0 ? 'var(--mosaz)' : undefined }}>{poSplatnosti}</div>
          </div>
        </div>

        {faktury.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Žádné neuhrazené faktury.</p>
          </div>
        ) : (
          <div style={{ ...karta, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Dodavatel</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500, textAlign: 'right' }}>Částka</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Splatnost</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Po splatnosti</th>
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Stav</th>
                </tr>
              </thead>
              <tbody>
                {faktury.map((f) => {
                  const dni = dniPoSplatnosti(f.due_date)
                  return (
                    <tr key={f.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '22px', height: '22px', borderRadius: '999px', background: barvaDodavatele(f.supplier), color: '#fff', fontSize: '10px', display: 'grid', placeItems: 'center', flex: 'none' }}>
                            {inicialyDodavatele(f.supplier)}
                          </span>
                          {f.supplier || '–'}
                        </div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{formatCastku(f.amount, f.currency)}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>{formatDatum(f.due_date)}</td>
                      <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>
                        {dni > 0 ? <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{dni} dní</span> : '–'}
                      </td>
                      <td style={{ padding: '10px 12px' }}><StavZnacka stav={f.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
