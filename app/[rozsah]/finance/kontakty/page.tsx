import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitKontakt, smazatKontakt } from './akce'

export const dynamic = 'force-dynamic'

/**
 * Finance — Kontakty (CRM dodavatelů/odběratelů/partnerů).
 *
 * Firemní úroveň, bez vazby na pobočku (stejně jako suroviny/receptury).
 * Historie Faktur (`invoices.supplier`, prostý text v oddělené databázi)
 * se sem nemigruje — tahle tabulka slouží novým tokům (objednávky,
 * párování plateb), ne přepisu minulosti.
 */

type Kontakt = {
  id: string
  nazev: string
  ico: string | null
  dic: string | null
  je_dodavatel: boolean
  je_odberatel: boolean
  je_partner: boolean
  platebni_podminky_dni: number | null
  poznamka: string
}

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-lg)',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--paper)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
  minHeight: '44px',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

function Stitek({ text }: { text: string }) {
  return (
    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'var(--sunken)', color: 'var(--muted)' }}>
      {text}
    </span>
  )
}

export default async function FinanceKontakty({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string; hledat?: string }>
}) {
  const { rozsah } = await params
  const { chyba, hledat } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Kontakty vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const dotaz = (hledat ?? '').trim()

  const supabase = await getServerSupabase()
  let kontaktyDotaz = supabase
    .from('kontakty')
    .select('id, nazev, ico, dic, je_dodavatel, je_odberatel, je_partner, platebni_podminky_dni, poznamka')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('nazev', { ascending: true })

  if (dotaz) kontaktyDotaz = kontaktyDotaz.ilike('nazev', `%${dotaz}%`)

  const { data } = await kontaktyDotaz
  const kontakty = (data ?? []) as Kontakt[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance" popis={`${kontakty.length} ${kontakty.length === 1 ? 'kontakt' : 'kontaktů'}.`}>
        Kontakty
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}

        <form action={`/${rozsah}/finance/kontakty`} method="get" style={{ maxWidth: '320px' }}>
          <input type="text" name="hledat" placeholder="Hledat kontakt…" defaultValue={dotaz} style={pole} />
        </form>

        {kontakty.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
            {dotaz ? 'Žádný kontakt neodpovídá hledání.' : 'Zatím žádné kontakty.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {kontakty.map((k) => (
              <div key={k.id} style={{ ...karta, display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{k.nazev}</strong>
                    {k.je_dodavatel ? <Stitek text="Dodavatel" /> : null}
                    {k.je_odberatel ? <Stitek text="Odběratel" /> : null}
                    {k.je_partner ? <Stitek text="Partner" /> : null}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '4px' }}>
                    {k.ico ? `IČO ${k.ico}` : null}
                    {k.ico && k.dic ? ' · ' : null}
                    {k.dic ? `DIČ ${k.dic}` : null}
                    {(k.ico || k.dic) && k.platebni_podminky_dni ? ' · ' : null}
                    {k.platebni_podminky_dni ? `splatnost ${k.platebni_podminky_dni} dní` : null}
                  </div>
                </div>
                {smiPsat ? (
                  <form action={smazatKontakt}>
                    <input type="hidden" name="rozsah" value={rozsah} />
                    <input type="hidden" name="id" value={k.id} />
                    <button type="submit" className="ft-tl">Smazat</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {smiPsat ? (
          <form action={zalozitKontakt} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nový kontakt</h2>

            <label>
              <span style={popisek}>Název *</span>
              <input type="text" name="nazev" required placeholder="např. Bidfood Czech Republic" style={pole} />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <label>
                <span style={popisek}>IČO</span>
                <input type="text" name="ico" style={pole} />
              </label>
              <label>
                <span style={popisek}>DIČ</span>
                <input type="text" name="dic" style={pole} />
              </label>
              <label>
                <span style={popisek}>Splatnost (dní)</span>
                <input type="number" name="platebni_podminky_dni" min="0" step="1" style={pole} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '16px', fontSize: '13.5px' }}>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="checkbox" name="je_dodavatel" /> Dodavatel
              </label>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="checkbox" name="je_odberatel" /> Odběratel
              </label>
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input type="checkbox" name="je_partner" /> Partner
              </label>
            </div>

            <label>
              <span style={popisek}>Poznámka</span>
              <textarea name="poznamka" rows={2} style={{ ...pole, minHeight: '60px', resize: 'vertical' }} />
            </label>

            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Uložit kontakt</button>
            </div>
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
