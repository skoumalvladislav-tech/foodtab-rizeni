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
import { zmenitStavZakazky, zapsatPlatbuZakazky } from '../akce'

export const dynamic = 'force-dynamic'

type Polozka = { id: string; popis: string; mnozstvi: number; cena_za_jednotku_haleru: number }
type PlatebniUcet = { id: string; nazev: string }

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

const NAZVY_STAVU: Record<string, string> = {
  poptavka: 'Poptávka',
  nabidka: 'Nabídka',
  potvrzeno: 'Potvrzeno',
  realizovano: 'Realizováno',
  vyfakturovano: 'Vyfakturováno',
  uhrazeno: 'Uhrazeno',
  'zrušeno': 'Zrušeno',
}

export default async function FinanceZakazkaDetail({
  params,
  searchParams,
}: {
  params: Promise<{ rozsah: string; zakazka: string }>
  searchParams: Promise<{ chyba?: string; zapsano?: string }>
}) {
  const { rozsah, zakazka: zakazkaId } = await params
  const { chyba, zapsano } = await searchParams

  const tenantId = await getCurrentTenantId()
  if (!tenantId) return <Sdeleni nadpis="Účet zatím nepatří k žádné firmě">Požádejte o pozvánku.</Sdeleni>

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Zakázky vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const supabase = await getServerSupabase()

  const [zakazkaRes, polozkyRes, uhrazenoRes, uctyRes] = await Promise.all([
    supabase
      .from('zakazky')
      .select('id, cislo, nazev, stav, datum_akce, pocet_hostu, cena_celkem_haleru, zaloha_pozadovana_haleru, faktura_id, poznamka, kontakty(nazev)')
      .eq('tenant_id', tenantId)
      .eq('id', zakazkaId)
      .maybeSingle(),
    supabase.from('zakazky_polozky').select('id, popis, mnozstvi, cena_za_jednotku_haleru').eq('tenant_id', tenantId).eq('zakazka_id', zakazkaId),
    supabase.rpc('zakazka_uhrazeno', { p_tenant: tenantId, p_zakazka: zakazkaId }),
    supabase.from('platebni_ucty').select('id, nazev').eq('tenant_id', tenantId).eq('aktivni', true),
  ])

  const zakazkaData = zakazkaRes.data as {
    id: string; cislo: string; nazev: string; stav: string; datum_akce: string | null
    pocet_hostu: number | null; cena_celkem_haleru: number; zaloha_pozadovana_haleru: number
    faktura_id: string | null; poznamka: string; kontakty: { nazev: string } | { nazev: string }[] | null
  } | null

  if (!zakazkaData) return <Sdeleni nadpis="Zakázka nenalezena">Zkontrolujte adresu nebo se vraťte na seznam.</Sdeleni>

  const odberatel = Array.isArray(zakazkaData.kontakty) ? zakazkaData.kontakty[0]?.nazev : zakazkaData.kontakty?.nazev
  const polozky = (polozkyRes.data ?? []) as Polozka[]
  const uhrazenoHaleru = Number(uhrazenoRes.data ?? 0)
  const ucty = (uctyRes.data ?? []) as PlatebniUcet[]
  const zbyvaHaleru = zakazkaData.cena_celkem_haleru - uhrazenoHaleru

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis
        oci="Finance"
        popis={`Odběratel: ${odberatel ?? '—'}${zakazkaData.datum_akce ? ` · akce ${zakazkaData.datum_akce}` : ''}${zakazkaData.pocet_hostu ? ` · ${zakazkaData.pocet_hostu} hostů` : ''}`}
        vpravo={<Link href={`/${rozsah}/finance/zakazky`} className="ft-tl">← Zpět na Zakázky</Link>}
      >
        {zakazkaData.cislo} — {zakazkaData.nazev}
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '900px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}
        {zapsano ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--dobre)' }}>Platba zapsána.</p> : null}

        <section style={{ ...karta, display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Celková cena</div>
            <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px' }}>{koruny(zakazkaData.cena_celkem_haleru)}</strong>
          </div>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Uhrazeno</div>
            <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px', color: 'var(--dobre)' }}>{koruny(uhrazenoHaleru)}</strong>
          </div>
          <div>
            <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Zbývá uhradit</div>
            <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: '18px', color: zbyvaHaleru > 0 ? 'var(--pozor)' : 'var(--dobre)' }}>
              {koruny(Math.max(0, zbyvaHaleru))}
            </strong>
          </div>
          {smiPsat ? (
            <form action={zmenitStavZakazky} style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <input type="hidden" name="rozsah" value={rozsah} />
              <input type="hidden" name="zakazka_id" value={zakazkaData.id} />
              <select name="stav" defaultValue={zakazkaData.stav} style={pole}>
                {Object.entries(NAZVY_STAVU).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
              <button type="submit" className="ft-tl">Uložit stav</button>
            </form>
          ) : (
            <span>{NAZVY_STAVU[zakazkaData.stav] ?? zakazkaData.stav}</span>
          )}
        </section>

        <div style={{ ...karta, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '6px 8px' }}>Položka</th>
                <th style={{ padding: '6px 8px' }}>Množství</th>
                <th style={{ padding: '6px 8px' }}>Cena/j.</th>
                <th style={{ padding: '6px 8px' }}>Celkem</th>
              </tr>
            </thead>
            <tbody>
              {polozky.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                  <td style={{ padding: '6px 8px' }}>{p.popis}</td>
                  <td style={{ padding: '6px 8px' }}>{p.mnozstvi}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(p.cena_za_jednotku_haleru)}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(Math.round(p.mnozstvi * p.cena_za_jednotku_haleru))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {smiPsat && ucty.length > 0 ? (
          <form action={zapsatPlatbuZakazky} style={{ ...karta, display: 'grid', gap: '12px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <input type="hidden" name="zakazka_id" value={zakazkaData.id} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Zapsat platbu (zálohu nebo doplatek)</h2>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>
              Platba se zapíše do Plateb jako běžný příjem a propojí se s touto zakázkou — žádné dvojí počítání v cashflow.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <select name="ucet_id" required style={pole}>
                {ucty.map((u) => <option key={u.id} value={u.id}>{u.nazev}</option>)}
              </select>
              <input type="text" name="castka" required placeholder="Částka Kč" style={pole} />
            </div>
            <div>
              <button type="submit" className="ft-tl ft-tl-hlavni">Zapsat platbu</button>
            </div>
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
