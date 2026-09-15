import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../../nadpis'
import { zalozitFakturu } from '../akce'

export const dynamic = 'force-dynamic'

/**
 * Faktury — ruční zadání.
 *
 * Přeneseno z faktury-app (src/app/faktury/nova/page.tsx) — pro doklady
 * mimo e-mailový příjem (papírový doklad, platba na místě). Odkaz na
 * tuhle stránku je jen tlačítko na Přehledu (`+ Zadat fakturu ručně"),
 * ne položka levého sloupce — stejně jako v originále.
 */

const karta = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  padding: '16px',
} as const

const pole = {
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--bg)',
  color: 'inherit',
  fontSize: '13.5px',
  width: '100%',
} as const

const popisek = { display: 'block', fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' } as const

const STAVY_UHRADY = ['Ke kontrole úhrady', 'Neuhrazeno', 'Částečně uhrazeno', 'Uhrazeno']

export default async function FakturyNova({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string }>
  searchParams: Promise<{ chyba?: string }>
}) {
  const { rozsah } = await params
  const { chyba } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'faktury.manage', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Zadávat faktury smí ten, kdo má právo „Zadávat, schvalovat a mazat faktury“.</Sdeleni>
  }

  return (
    <>
      <Nadpis
        oci="Faktury"
        popis="Pro doklady mimo e-mailový příjem — papírový doklad nebo platba na místě. Položky s * jsou povinné."
        vpravo={<Link href={`/${rozsah}/finance/faktury`} className="ft-tl">← Zpět na faktury</Link>}
      >
        Zadat fakturu ručně
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', maxWidth: '640px' }}>
        {chyba ? (
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--bad)' }}>
            Fakturu se nepodařilo uložit: {chyba}. Zkontrolujte, že jsou vyplněny dodavatel a částka (číslo), a zkuste to znovu.
          </p>
        ) : null}

        <form action={zalozitFakturu} encType="multipart/form-data" style={{ ...karta, display: 'grid', gap: '14px' }}>
          <input type="hidden" name="rozsah" value={rozsah} />

          <label>
            <span style={popisek}>Vyfotit / nahrát fakturu</span>
            <input type="file" name="fotografie" accept="image/*" style={pole} />
            <small style={{ display: 'block', marginTop: '6px', fontSize: '12px', color: 'var(--muted)' }}>
              Volitelné — nahradí odkaz na PDF níže, pokud vyplníte obojí.
            </small>
          </label>

          <label>
            <span style={popisek}>Dodavatel *</span>
            <input type="text" name="supplier" required placeholder="např. Bidfood Czech Republic" style={pole} />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <label>
              <span style={popisek}>IČO dodavatele</span>
              <input type="text" name="supplier_ico" placeholder="12345678" style={pole} />
            </label>
            <label>
              <span style={popisek}>Číslo účtu dodavatele</span>
              <input type="text" name="supplier_account" placeholder="123456789/0100" style={pole} />
            </label>
            <label>
              <span style={popisek}>Číslo faktury</span>
              <input type="text" name="invoice_number" style={pole} />
            </label>
            <label>
              <span style={popisek}>Variabilní symbol</span>
              <input type="text" name="variable_symbol" style={pole} />
            </label>
            <label>
              <span style={popisek}>Částka *</span>
              <input type="number" name="amount" step="0.01" min="0" required placeholder="0.00" style={pole} />
            </label>
            <label>
              <span style={popisek}>Měna</span>
              <select name="currency" defaultValue="CZK" style={pole}>
                <option value="CZK">CZK</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>
              <span style={popisek}>Stav úhrady</span>
              <select name="status" defaultValue="Ke kontrole úhrady" style={pole}>
                {STAVY_UHRADY.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>
              <span style={popisek}>Datum vystavení</span>
              <input type="date" name="issue_date" style={pole} />
            </label>
            <label>
              <span style={popisek}>DUZP</span>
              <input type="date" name="duzp" style={pole} />
            </label>
            <label>
              <span style={popisek}>Splatnost</span>
              <input type="date" name="due_date" style={pole} />
            </label>
          </div>

          <label>
            <span style={popisek}>Odkaz na PDF (OneDrive, volitelné)</span>
            <input type="url" name="onedrive_url" placeholder="https://..." style={pole} />
          </label>

          <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
            <button type="submit" className="ft-tl ft-tl-hlavni">Uložit fakturu</button>
            <Link href={`/${rozsah}/finance/faktury`} className="ft-tl">Zrušit</Link>
          </div>
        </form>
      </div>
    </>
  )
}
