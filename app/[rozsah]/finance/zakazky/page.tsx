import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentTenantId, zkusPristup } from '@/lib/firma'
import { odkazNaPrihlaseni } from '@/lib/prihlaseni-adresa'
import { getServerSupabase } from '@/lib/supabase/server'
import { canSee } from '@/lib/authz'
import { koruny } from '@/lib/mzdy'
import Sdeleni from '@/app/sdeleni'
import Nadpis from '../../nadpis'
import Navigace from '../navigace'
import { zalozitZakazku } from './akce'

export const dynamic = 'force-dynamic'

type Zakazka = {
  id: string
  cislo: string
  nazev: string
  stav: string
  datum_akce: string | null
  cena_celkem_haleru: number
  kontakty: { nazev: string } | { nazev: string }[] | null
}
type Kontakt = { id: string; nazev: string }
type Branch = { id: string; name: string }

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

const popisek = { display: 'block', fontSize: '12.5px', color: 'var(--muted)', marginBottom: '4px' } as const

const NAZVY_STAVU: Record<string, string> = {
  poptavka: 'Poptávka',
  nabidka: 'Nabídka',
  potvrzeno: 'Potvrzeno',
  realizovano: 'Realizováno',
  vyfakturovano: 'Vyfakturováno',
  uhrazeno: 'Uhrazeno',
  'zrušeno': 'Zrušeno',
}

function nazevOdberatele(k: Zakazka['kontakty']): string {
  if (!k) return '—'
  return Array.isArray(k) ? (k[0]?.nazev ?? '—') : k.nazev
}

export default async function FinanceZakazky({
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

  const pristup = await zkusPristup(tenantId, 'finance.read', rozsah)
  if (pristup.stav === 'neprihlasen') redirect(await odkazNaPrihlaseni())
  if (pristup.stav === 'odepren') {
    return <Sdeleni nadpis="Na tohle nemáte oprávnění">Zakázky vidí ten, kdo má právo „Vidět finanční přehled“.</Sdeleni>
  }

  const smiPsat = canSee(pristup.ctx, 'finance.manage')
  const supabase = await getServerSupabase()

  const [zakazkyRes, kontaktyRes, branchesRes] = await Promise.all([
    supabase
      .from('zakazky')
      .select('id, cislo, nazev, stav, datum_akce, cena_celkem_haleru, kontakty(nazev)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('kontakty').select('id, nazev').eq('tenant_id', tenantId).eq('je_odberatel', true).is('deleted_at', null).order('nazev'),
    supabase.from('branches').select('id, name').eq('tenant_id', tenantId).eq('active', true).is('deleted_at', null),
  ])

  const zakazky = (zakazkyRes.data ?? []) as Zakazka[]
  const odberatele = (kontaktyRes.data ?? []) as Kontakt[]
  const branches = (branchesRes.data ?? []) as Branch[]

  return (
    <Navigace rozsah={rozsah}>
      <Nadpis oci="Finance" popis={`${zakazky.length} ${zakazky.length === 1 ? 'zakázka' : 'zakázek'}.`}>
        Zakázky
      </Nadpis>

      <div style={{ padding: '16px', paddingBottom: '32px', display: 'grid', gap: '16px', maxWidth: '960px' }}>
        {chyba ? <p style={{ margin: 0, fontSize: '13px', color: 'var(--bad)' }}>{chyba}</p> : null}

        {zakazky.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>Zatím žádné zakázky.</p>
        ) : (
          <div style={{ ...karta, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                  <th style={{ padding: '6px 8px' }}>Číslo</th>
                  <th style={{ padding: '6px 8px' }}>Název</th>
                  <th style={{ padding: '6px 8px' }}>Odběratel</th>
                  <th style={{ padding: '6px 8px' }}>Stav</th>
                  <th style={{ padding: '6px 8px' }}>Datum akce</th>
                  <th style={{ padding: '6px 8px' }}>Cena</th>
                </tr>
              </thead>
              <tbody>
                {zakazky.map((z) => (
                  <tr key={z.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <Link href={`/${rozsah}/finance/zakazky/${z.id}`} className="ft-tl">{z.cislo}</Link>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{z.nazev}</td>
                    <td style={{ padding: '6px 8px' }}>{nazevOdberatele(z.kontakty)}</td>
                    <td style={{ padding: '6px 8px' }}>{NAZVY_STAVU[z.stav] ?? z.stav}</td>
                    <td style={{ padding: '6px 8px' }}>{z.datum_akce ?? '—'}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{koruny(z.cena_celkem_haleru)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {smiPsat ? (
          <form action={zalozitZakazku} style={{ ...karta, display: 'grid', gap: '14px' }}>
            <input type="hidden" name="rozsah" value={rozsah} />
            <h2 style={{ margin: 0, fontSize: '15px' }}>Nová zakázka</h2>

            {odberatele.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
                Nejdřív založte odběratele v{' '}
                <Link href={`/${rozsah}/finance/kontakty`} className="ft-tl">Kontaktech</Link> (zaškrtněte „Odběratel“).
              </p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <label>
                    <span style={popisek}>Odběratel *</span>
                    <select name="kontakt_id" required style={pole}>
                      {odberatele.map((d) => <option key={d.id} value={d.id}>{d.nazev}</option>)}
                    </select>
                  </label>
                  <label>
                    <span style={popisek}>Název akce *</span>
                    <input type="text" name="nazev" required placeholder="např. Vánoční večírek" style={pole} />
                  </label>
                  <label>
                    <span style={popisek}>Pobočka</span>
                    <select name="branch_id" style={pole} defaultValue="">
                      <option value="">Celá firma</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span style={popisek}>Datum akce</span>
                    <input type="date" name="datum_akce" style={pole} />
                  </label>
                  <label>
                    <span style={popisek}>Počet hostů</span>
                    <input type="number" name="pocet_hostu" min={1} style={pole} />
                  </label>
                  <label>
                    <span style={popisek}>Požadovaná záloha (Kč)</span>
                    <input type="text" name="zaloha_pozadovana" placeholder="5000" style={pole} />
                  </label>
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <span style={popisek}>Položky nabídky (vyplňte alespoň jednu)</span>
                  {Array.from({ length: 5 }, (_, i) => i + 1).map((i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                      <input type="text" name={`popis_${i}`} placeholder="Popis položky" style={pole} />
                      <input type="text" name={`mnozstvi_${i}`} placeholder="Množství" style={pole} />
                      <input type="text" name={`cena_${i}`} placeholder="Cena/j. Kč" style={pole} />
                    </div>
                  ))}
                </div>

                <label>
                  <span style={popisek}>Poznámka</span>
                  <input type="text" name="poznamka" style={pole} />
                </label>

                <div>
                  <button type="submit" className="ft-tl ft-tl-hlavni">Založit zakázku</button>
                </div>
              </>
            )}
          </form>
        ) : null}
      </div>
    </Navigace>
  )
}
