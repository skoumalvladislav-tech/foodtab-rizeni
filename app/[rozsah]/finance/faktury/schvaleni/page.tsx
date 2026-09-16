import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getFakturySupabase } from '@/lib/supabase/faktury'
import { barvaDodavatele, inicialyDodavatele } from '@/lib/faktury-color'
import { formatCastku, formatDatum } from '@/lib/faktury-format'
import { STAV_KE_SCHVALENI, type Faktura } from '@/lib/faktury-types'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { odmitnoutAZapamatovat, odmitnoutFakturu, oznacitJakoUpominku, potvrditFakturu } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Faktury — fronta ke schválení.
 *
 * Přeneseno z faktury-app (src/app/schvaleni/page.tsx +
 * ApprovalActions.tsx). Bez `confirm()` v prohlížeči a bez toastu
 * s počtem přeřazených/vyřazených — Foodtab tenhle vzor nemá, počet
 * se místo toho ukáže jako obyčejná zpráva po přesměrování
 * (`?prerazeno=`, stejně jako `?vyrazeno=` na seznamu).
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

async function nactiCekajici(): Promise<Faktura[]> {
  const supabase = getFakturySupabase()
  const velikostStranky = 1000
  const vse: Faktura[] = []
  let od = 0
  for (;;) {
    const { data, error } = await supabase
      .from('invoices').select('*').eq('status', STAV_KE_SCHVALENI)
      .order('received_at', { ascending: false }).order('id', { ascending: true })
      .range(od, od + velikostStranky - 1)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    vse.push(...(data as Faktura[]))
    if (data.length < velikostStranky) break
    od += velikostStranky
  }
  return vse
}

export default async function FakturySchvaleni({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ prerazeno?: string }>
}) {
  const { rozsah } = await params
  const sp = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'faktury.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Schvalovat smí ten, kdo má právo „Zadávat, schvalovat a mazat faktury“.</Sdeleni>
  }

  const cekajici = await nactiCekajici()

  return (
    <>
      <Nadpis
        oci="Faktury"
        popis="Nové dokumenty, u kterých si AI není jistá, že jde skutečně o fakturu. Dokud je nepotvrdíte, nepočítají se do žádných součtů ani přehledů."
      >
        Fronta ke schválení
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '720px', display: 'grid', gap: '12px' }}>
        {sp.prerazeno ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--mosaz)' }}>
            Zároveň přeřazeno jako upomínka {sp.prerazeno} dalších dokumentů od stejného dodavatele.
          </p>
        ) : null}

        {cekajici.length === 0 ? (
          <div style={karta}>
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Žádné dokumenty nečekají na schválení.</p>
          </div>
        ) : (
          cekajici.map((f) => (
            <div key={f.id} style={{ ...karta, display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-full)', background: barvaDodavatele(f.supplier), color: '#fff', fontSize: '12px', display: 'grid', placeItems: 'center', flex: 'none' }}>
                  {inicialyDodavatele(f.supplier)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: '14.5px' }}>{f.supplier || 'Neznámý dodavatel'}</strong>
                  <br />
                  <small style={{ color: 'var(--muted)' }}>
                    {f.invoice_number || 'bez čísla'} · přijato {formatDatum(f.received_at)}
                    {f.email_subject ? ` · ${f.email_subject}` : ''}
                  </small>
                </div>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '15px' }}>{formatCastku(f.amount, f.currency)}</span>
              </div>

              {f.review_note ? (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--mosaz)' }}>
                  <strong>Proč se AI zeptala:</strong> {f.review_note}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px' }}>
                {f.pdf_url ? <a href={f.pdf_url} target="_blank" rel="noreferrer">Otevřít PDF →</a> : null}
                {f.onedrive_url ? <a href={f.onedrive_url} target="_blank" rel="noreferrer">OneDrive</a> : null}
                {!f.pdf_url && !f.onedrive_url ? <span style={{ color: 'var(--faint)' }}>Bez přiloženého souboru</span> : null}
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: '10px' }}>
                <form action={potvrditFakturu}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="ft-tl ft-tl-hlavni ft-tl-male">✓ Je to faktura</button>
                </form>
                <form action={odmitnoutFakturu}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="ft-tl ft-tl-male">✕ Není to faktura</button>
                </form>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12.5px' }}>
                <form action={odmitnoutAZapamatovat}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="druh" value="not_invoice" />
                  <button type="submit" style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Není faktura – odmítnout a zapamatovat
                  </button>
                </form>
                <form action={odmitnoutAZapamatovat}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="druh" value="not_supplier" />
                  <button type="submit" style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Dodavatel neplatný – odmítnout a zapamatovat
                  </button>
                </form>
                <form action={oznacitJakoUpominku}>
                  <input type="hidden" name="rozsah" value={rozsah} />
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" style={{ background: 'none', border: 0, padding: 0, color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Je to upomínka, zapamatovat a uložit
                  </button>
                </form>
              </div>
              <small style={{ color: 'var(--faint)', fontSize: '11px' }}>
                AI se z tohoto dokumentu příště poučí a podobné automaticky přeskočí; existující
                faktury od stejného dodavatele se navíc rovnou vyřadí z aktivního přehledu.
              </small>
            </div>
          ))
        )}
      </div>
    </>
  )
}
