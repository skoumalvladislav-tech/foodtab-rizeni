import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele, inicialyDodavatele } from '@/lib/faktury-color'
import { formatCastku, formatDatum } from '@/lib/faktury-format'
import { dniPoSplatnosti, jeNezaplacena, type Faktura } from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { oznacitUpominkuVyresenou } from '../akce'

export const dynamic = 'force-dynamic'

const MIN_DNI_PO_SPLATNOSTI = 7

/**
 * Faktury — upomínky.
 *
 * Přeneseno z faktury-app (src/app/upominky/page.tsx + actions.ts),
 * beze změny logiky — interní přehled faktur po splatnosti 7+ dní, bez
 * automatického odesílání dodavatelům. „Označit jako vyřešeno" jen
 * zapíše `reminder_sent_at`, nevyřadí fakturu ze seznamu.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

async function nactiPoSplatnosti(): Promise<Faktura[]> {
  const supabase = getFakturySupabase()
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    const { data, error } = await supabase
      .from('invoices').select('*').not('due_date', 'is', null)
      .order('due_date', { ascending: true }).order('id', { ascending: true })
      .range(od, od + velikostStranky - 1)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }
  return vse.filter(jeNezaplacena).filter((f) => dniPoSplatnosti(f.due_date) >= MIN_DNI_PO_SPLATNOSTI)
}

export default async function FakturyUpominky({ params }: { params: Promise<{ rozsah: string }> }) {
  const { rozsah } = await params

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'faktury.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Faktury vidí ten, kdo má právo „Vidět přijaté faktury“.</Sdeleni>
  }
  const smiSpravovat = (await zkusPristup(tenantId, 'faktury.manage', rozsah)).stav === 'ok'

  const faktury = await nactiPoSplatnosti()

  return (
    <>
      <Nadpis
        oci="Faktury"
        popis={`Interní přehled faktur po splatnosti více než ${MIN_DNI_PO_SPLATNOSTI} dní (bez automatického odesílání dodavatelům).`}
      >
        Po splatnosti {MIN_DNI_PO_SPLATNOSTI}+ dní
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px' }}>
        {faktury.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Žádné faktury nevyžadují upomínku.</p>
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
                  <th style={{ padding: '10px 12px', fontWeight: 500 }}>Upomínka odeslána</th>
                  {smiSpravovat ? <th style={{ padding: '10px 12px' }} /> : null}
                </tr>
              </thead>
              <tbody>
                {faktury.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '22px', height: '22px', borderRadius: 'var(--radius-full)', background: barvaDodavatele(f.supplier), color: '#fff', fontSize: '10px', display: 'grid', placeItems: 'center', flex: 'none' }}>
                          {inicialyDodavatele(f.supplier)}
                        </span>
                        {f.supplier || '–'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{formatCastku(f.amount, f.currency)}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>{formatDatum(f.due_date)}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace', color: 'var(--bad)', fontWeight: 600 }}>
                      {dniPoSplatnosti(f.due_date)} dní
                    </td>
                    <td style={{ padding: '10px 12px', fontFamily: 'ui-monospace, monospace' }}>{f.reminder_sent_at ? formatDatum(f.reminder_sent_at) : '–'}</td>
                    {smiSpravovat ? (
                      <td style={{ padding: '10px 12px' }}>
                        <form action={oznacitUpominkuVyresenou}>
                          <input type="hidden" name="rozsah" value={rozsah} />
                          <input type="hidden" name="id" value={f.id} />
                          <button type="submit" className="ft-tl ft-tl-male">Označit jako vyřešeno</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
